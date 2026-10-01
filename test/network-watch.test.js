import test from 'node:test';
import assert from 'node:assert/strict';
import { networkWatch, normalizeRadar, upstreamMatches, inNorthAmerica, WATCHED_ASNS } from '../src/network-watch.js';
const event={id:'1',description:'Synthetic outage',asns:[65002],locations:['US'],startDate:new Date().toISOString(),endDate:null};
function mock({failRadar=false}={}){return async(url,options)=>{
 const u=new URL(url),asn=Number(u.searchParams.get('resource')?.replace('AS',''));
 if(u.hostname==='stat.ripe.net')return Response.json({status:'ok',data:u.pathname.includes('as-overview')?{holder:`Network ${asn}`,announced:true,query_endtime:'2026-09-25T10:00:00'}:{neighbours:[{asn:65001,type:'right'},{asn:65002,type:'left'}],query_endtime:new Date().toISOString()}});
 assert.equal(options.headers.Authorization,'Bearer test-token');
 if(failRadar)return new Response('',{status:403});
 if(u.pathname.includes('outages'))return Response.json({success:true,result:{annotations:u.searchParams.has('asn')?[]:[event]}});
 return Response.json({success:true,result:{events:[]}});
};}
test('public routing observations remain available without treating unconfigured Radar as healthy',async()=>{
 const report=await networkWatch({},mock(),null);assert.equal(report.radarConfigured,false);assert.equal(report.northAmerica.available,false);assert.equal(report.networks.length,3);assert.deepEqual(report.networks.map(n=>n.asn),WATCHED_ASNS);assert.equal(report.networks[0].announced,true);assert.equal(report.networks[0].eventsAvailable,false);assert.deepEqual(report.networks[0].upstream,[65002]);
});
test('Radar reports match North America and observed upstreams without claiming outage impact',async()=>{
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},mock(),null);assert.equal(report.northAmerica.available,true);assert.equal(report.northAmerica.events.length,1);assert.equal(report.upstream.events[0].via.length,3);assert.equal(report.upstream.events[0].state,'No end reported');
});
test('Radar errors remain unavailable and never expose authentication values',async()=>{
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},mock({failRadar:true}),null);assert.equal(report.northAmerica.available,false);assert.equal(report.networks[0].eventsAvailable,false);assert.equal(report.feeds[0].detail,'http_403');assert.equal(JSON.stringify(report).includes('test-token'),false);
});
test('routing normalizer distinguishes ended and stale detections; matching is directional',()=>{
 const leak=normalizeRadar('leaks',{id:1,leak_asn:65002,leak_seg:[65002,25710],finished:true,countries:['CA'],min_ts:'2026-09-25T10:00:00'});assert.equal(leak.state,'Ended');assert.equal(inNorthAmerica(leak),true);assert.equal(upstreamMatches([leak],[{asn:25710,upstream:[65001]}]).length,0);
 const hijack=normalizeRadar('hijacks',{id:2,hijacker_asn:65001,victim_asns:[32145],is_stale:true,on_going_count:0,hijacker_country:'GB',victim_countries:['MX']});assert.equal(hijack.state,'Stale detection');assert.equal(inNorthAmerica(hijack),true);
});
test('initial Radar batches expose continuation cursors',async()=>{
 let calls=0;const fetcher=async(url,options)=>{if(url.includes('api.cloudflare.com')){calls++;return Response.json({success:true,result:url.includes('outages')?{annotations:Array.from({length:100},(_,i)=>({...event,id:i}))}:{events:[]}});}return mock()(url,options);};
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,null);assert.equal(report.northAmerica.limited,true);assert.equal(report.networks[0].limited,true);assert.equal(calls,12);
});

test('continuations fetch records beyond 200 with a stable window and merge without duplicates',async()=>{
 const {networkWatchPage}=await import('../src/network-watch.js');const {appendNetworkFeed}=await import('../public/network-report.js');
 const requests=[];const fetcher=async(url,options)=>{if(!url.includes('api.cloudflare.com'))return mock()(url,options);const u=new URL(url);requests.push(u);const offset=Number(u.searchParams.get('offset')||0);const rows=u.pathname.includes('outages')?Array.from({length:Math.min(100,Math.max(0,250-offset))},(_,i)=>({...event,id:offset+i})):[];return Response.json({success:true,result:{annotations:rows,events:[]}});};
 let report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,null);assert.equal(report.northAmerica.events.length,100);assert.equal(report.loadingMore,true);
 const patch=await networkWatchPage(new URLSearchParams({kind:'outages',asn:'0',page:'2',at:report.at}),{RADAR_API_TOKEN:'test-token'},fetcher,null);report=appendNetworkFeed(report,patch);assert.equal(report.feeds.find(f=>f.asn===0&&f.kind==='outages').events.length,250);assert.equal(report.northAmerica.limited,false);assert.equal(patch.nextPage,null);assert.equal(new Set(requests.map(u=>u.searchParams.get('dateEnd'))).size,1);
 report=appendNetworkFeed(report,patch);assert.equal(report.feeds.find(f=>f.asn===0&&f.kind==='outages').events.length,250);
});
test('invalid continuation and ASN-name parameters are rejected before fetching',async()=>{
 const {networkWatchPage,networkNames}=await import('../src/network-watch.js');const fail=()=>{throw Error('Should not fetch');};
 await assert.rejects(()=>networkWatchPage(new URLSearchParams({kind:'bad',asn:'0',page:'3',at:Date.now()}),{},fail,null),/Invalid/);
 await assert.rejects(()=>networkNames('25710,https://example.com',fail,null),/Invalid/);
 const names=await networkNames('25710',mock(),null);assert.equal(names.names[25710],'Network 25710');
});
test('event metadata preserves network names',()=>{
 const outage=normalizeRadar('outages',{...event,asnsDetails:[{asn:'65002',name:'Example ISP'}]});assert.equal(outage.names[65002],'Example ISP');
 const leak=normalizeRadar('leaks',{id:1,leak_asn:32145,leak_seg:[]},[{asn:32145,org_name:'OpenCape'}]);assert.equal(leak.names[32145],'OpenCape');
});

test('uncertain collector neighbours and right-side customers never enter upstream watch; absent routes leave topology unknown',async()=>{
 const fetcher=async(url,options)=>url.includes('asn-neighbours')?Response.json({status:'ok',data:{neighbours:[{asn:65001,type:'right'},{asn:65003,type:'uncertain'}]}}):mock()(url,options);
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,null);
 assert.deepEqual(report.networks[0].upstream,[]);assert.deepEqual(report.networks[0].uncertain,[65003]);assert.equal(report.upstream.available,false);assert.equal(report.upstream.topologyIncomplete,true);assert.deepEqual(report.upstream.events,[]);assert.equal(report.northAmerica.available,true);
});
test('a failed continuation retains successful pages, exposes exact retry cursor and does not cache failure',async()=>{
 const {networkWatchPage}=await import('../src/network-watch.js');const {appendNetworkFeed}=await import('../public/network-report.js');
 let failed=true;const db=new Map(),cache={async match(r){return db.get(r.url)?.clone();},async put(r,v){db.set(r.url,v.clone());}};
 const fetcher=async(url,options)=>{const u=new URL(url);if(!url.includes('api.cloudflare.com'))return mock()(url,options);if(!url.includes('outages'))return Response.json({success:true,result:{events:[]}});const offset=Number(u.searchParams.get('offset'));if(offset===200&&failed)return new Response('',{status:429});return Response.json({success:true,result:{annotations:offset<200?Array.from({length:100},(_,i)=>({...event,id:offset+i})):[]}});};
 let report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,cache);assert.equal(report.feeds[0].nextPage,2);
 const params=page=>new URLSearchParams({kind:'outages',asn:'0',page:String(page),at:report.at});
 const failedPatch=await networkWatchPage(params(2),{RADAR_API_TOKEN:'test-token'},fetcher,cache);report=appendNetworkFeed(report,failedPatch);assert.equal(report.feeds[0].events.length,200);assert.equal(failedPatch.nextPage,3);assert.equal(failedPatch.detail,'http_429');assert.equal(report.northAmerica.available,false);
 failed=false;const patch=await networkWatchPage(params(3),{RADAR_API_TOKEN:'test-token'},fetcher,cache);report=appendNetworkFeed(report,patch);assert.equal(patch.available,true);assert.equal(report.northAmerica.available,true);assert.equal(report.feeds.find(f=>f.asn===0&&f.kind==='outages').events.length,200);assert.equal(report.feeds[0].loadFailed,false);
});
test('Radar metadata includes only involved ASNs to avoid duplicating the entire page dictionary per event',()=>{
 const result=normalizeRadar('leaks',{id:1,leak_asn:174,leak_seg:[174,32145]},[{asn:174,org_name:'Cogent'},{asn:32145,org_name:'OpenCape'},{asn:999,org_name:'Unrelated'}]);assert.deepEqual(result.names,{174:'Cogent',32145:'OpenCape'});
});

test('over-age cache entries are refreshed and failed source recovery stays unknown',async()=>{
 const db=new Map();let calls=0;const cache={async match(r){return db.get(r.url)?.clone();},async put(r,v){const d=await v.json();d.fetchedAt=new Date(Date.now()-3600000).toISOString();db.set(r.url,Response.json(d));}};
 const fetcher=async(...args)=>{calls++;return mock()(...args);};await networkWatch({},fetcher,cache);const first=calls;await networkWatch({},fetcher,cache);assert.equal(calls,first*2);
 const fail=async()=>new Response('',{status:503});const report=await networkWatch({},fail,cache);assert.equal(report.networks[0].neighboursAvailable,false);assert.equal(report.upstream.available,false);
});

test('malformed country or ASN collections are parser failures rather than zero regional reports',async()=>{
 const fetcher=async(url,options)=>url.includes('api.cloudflare.com')&&url.includes('outages')?Response.json({success:true,result:{annotations:[{...event,locations:'US'}]}}):mock()(url,options);
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,null);assert.equal(report.northAmerica.available,false);assert.equal(report.feeds[0].detail,'invalid_response');
});

test('cold initial request stays below the shared 50 fetch/cache operation limit even with full direct feeds',async()=>{
 let count=0;const db=new Map(),op=()=>{if(++count>50)throw Error('Too many subrequests');};
 const cache={async match(r){op();return db.get(r.url)?.clone();},async put(r,v){op();db.set(r.url,v.clone());}};
 const fetcher=async(url,options)=>{op();if(!url.includes('api.cloudflare.com'))return mock()(url,options);const rows=Array.from({length:100},(_,i)=>url.includes('outages')?{...event,id:i}:{id:i,leak_asn:65002,leak_seg:[65002],countries:['US']});return Response.json({success:true,result:url.includes('outages')?{annotations:rows}:{events:rows}});};
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,cache);assert.equal(count,48);assert.ok(report.feeds.every(f=>f.available&&f.nextPage===2));assert.equal(report.northAmerica.available,true);
 count=0;await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,cache);assert.equal(count,15);
});
test('source roles and latest hijack observation are retained for relevance without inventing local impact',()=>{
 const e=normalizeRadar('hijacks',{id:9,hijacker_asn:9009,victim_asns:[2914],confidence_score:10,max_hijack_ts:'2026-09-29T12:00:00Z',max_msg_ts:'2026-10-01T12:00:00Z',prefixes:['192.0.2.0/24']});assert.equal(e.actorASN,9009);assert.deepEqual(e.victimASNs,[2914]);assert.equal(e.confidence,10);assert.equal(e.lastSeen,'2026-10-01T12:00:00.000Z');assert.equal(e.prefixCount,1);
});
test('cache failure alone does not discard independently retrieved valid source responses',async()=>{const cache={async match(){throw Error('Cache unavailable');},async put(){throw Error('Cache unavailable');}};const report=await networkWatch({RADAR_API_TOKEN:'test-token'},mock(),cache);assert.ok(report.feeds.every(f=>f.available));assert.ok(report.networks.every(n=>n.routingAvailable&&n.neighboursAvailable));});
test('runtime subrequest errors are distinct from provider HTTP failures without exposing raw messages',async()=>{const report=await networkWatch({RADAR_API_TOKEN:'test-token'},async()=>{throw Error('Too many subrequests');},null);assert.equal(report.feeds[0].detail,'worker_request_limit');assert.equal(report.feeds[0].available,false);});
