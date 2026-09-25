import test from 'node:test';
import assert from 'node:assert/strict';
import { networkWatch, normalizeRadar, downstreamMatches, inNorthAmerica, WATCHED_ASNS } from '../src/network-watch.js';
const event={id:'1',description:'Synthetic outage',asns:[65001],locations:['US'],startDate:'2026-09-25T10:00:00Z',endDate:null};
function mock({failRadar=false}={}){return async(url,options)=>{
 const u=new URL(url),asn=Number(u.searchParams.get('resource')?.replace('AS',''));
 if(u.hostname==='stat.ripe.net')return Response.json({status:'ok',data:u.pathname.includes('as-overview')?{holder:`Network ${asn}`,announced:true,query_endtime:'2026-09-25T10:00:00'}:{neighbours:[{asn:65001,type:'right'},{asn:65002,type:'left'}],query_endtime:'2026-09-25T00:00:00'}});
 assert.equal(options.headers.Authorization,'Bearer test-token');
 if(failRadar)return new Response('',{status:403});
 if(u.pathname.includes('outages'))return Response.json({success:true,result:{annotations:[event]}});
 return Response.json({success:true,result:{events:[]}});
};}
test('public routing observations remain available without treating unconfigured Radar as healthy',async()=>{
 const report=await networkWatch({},mock(),null);assert.equal(report.radarConfigured,false);assert.equal(report.northAmerica.available,false);assert.equal(report.networks.length,3);assert.deepEqual(report.networks.map(n=>n.asn),WATCHED_ASNS);assert.equal(report.networks[0].announced,true);assert.equal(report.networks[0].eventsAvailable,false);assert.deepEqual(report.networks[0].downstream,[65001]);assert.deepEqual(report.networks[0].upstream,[65002]);
});
test('Radar reports match North America and observed downstreams without claiming outage impact',async()=>{
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},mock(),null);assert.equal(report.northAmerica.available,true);assert.equal(report.northAmerica.events.length,1);assert.equal(report.downstream.events[0].via.length,3);assert.equal(report.downstream.events[0].state,'No end reported');
});
test('Radar errors remain unavailable and never expose authentication values',async()=>{
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},mock({failRadar:true}),null);assert.equal(report.northAmerica.available,false);assert.equal(report.networks[0].eventsAvailable,false);assert.equal(report.feeds[0].detail,'http_403');assert.equal(JSON.stringify(report).includes('test-token'),false);
});
test('routing normalizer distinguishes ended and stale detections; matching is directional',()=>{
 const leak=normalizeRadar('leaks',{id:1,leak_asn:65002,leak_seg:[65002,25710],finished:true,countries:['CA'],min_ts:'2026-09-25T10:00:00'});assert.equal(leak.state,'Ended');assert.equal(inNorthAmerica(leak),true);assert.equal(downstreamMatches([leak],[{asn:25710,downstream:[65001]}]).length,0);
 const hijack=normalizeRadar('hijacks',{id:2,hijacker_asn:65001,victim_asns:[32145],is_stale:true,on_going_count:0,hijacker_country:'GB',victim_countries:['MX']});assert.equal(hijack.state,'Stale detection');assert.equal(inNorthAmerica(hijack),true);
});
test('initial Radar batches expose continuation cursors',async()=>{
 let calls=0;const fetcher=async(url,options)=>{if(url.includes('api.cloudflare.com')){calls++;return Response.json({success:true,result:url.includes('outages')?{annotations:Array.from({length:100},(_,i)=>({...event,id:i}))}:{events:[]}});}return mock()(url,options);};
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,null);assert.equal(report.northAmerica.limited,true);assert.equal(report.networks[0].limited,true);assert.equal(calls,16);
});

test('continuations fetch records beyond 200 with a stable window and merge without duplicates',async()=>{
 const {networkWatchPage}=await import('../src/network-watch.js');const {appendNetworkFeed}=await import('../public/network-report.js');
 const requests=[];const fetcher=async(url,options)=>{if(!url.includes('api.cloudflare.com'))return mock()(url,options);const u=new URL(url);requests.push(u);const offset=Number(u.searchParams.get('offset')||0);const rows=u.pathname.includes('outages')?Array.from({length:Math.min(100,Math.max(0,250-offset))},(_,i)=>({...event,id:offset+i})):[];return Response.json({success:true,result:{annotations:rows,events:[]}});};
 let report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,null);assert.equal(report.northAmerica.events.length,200);assert.equal(report.loadingMore,true);
 const patch=await networkWatchPage(new URLSearchParams({kind:'outages',asn:'0',page:'3',at:report.at}),{RADAR_API_TOKEN:'test-token'},fetcher,null);report=appendNetworkFeed(report,patch);assert.equal(report.northAmerica.events.length,250);assert.equal(report.northAmerica.limited,false);assert.equal(patch.nextPage,null);assert.equal(new Set(requests.map(u=>u.searchParams.get('dateEnd'))).size,1);
 report=appendNetworkFeed(report,patch);assert.equal(report.northAmerica.events.length,250);
});
test('invalid continuation and ASN-name parameters are rejected before fetching',async()=>{
 const {networkWatchPage,networkNames}=await import('../src/network-watch.js');const fail=()=>{throw Error('Should not fetch');};
 await assert.rejects(()=>networkWatchPage(new URLSearchParams({kind:'bad',asn:'0',page:'3',at:Date.now()}),{},fail,null),/Invalid/);
 await assert.rejects(()=>networkNames('25710,https://example.com',fail,null),/Invalid/);
 const names=await networkNames('25710',mock(),null);assert.equal(names.names[25710],'Network 25710');
});
test('event metadata preserves network names',()=>{
 const outage=normalizeRadar('outages',{...event,asnsDetails:[{asn:'65001',name:'Example ISP'}]});assert.equal(outage.names[65001],'Example ISP');
 const leak=normalizeRadar('leaks',{id:1,leak_asn:32145,leak_seg:[]},[{asn:32145,org_name:'OpenCape'},{asn:25710,org_name:'Other network'}]);assert.deepEqual(leak.names,{32145:'OpenCape'});
});
