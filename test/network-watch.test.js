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
test('bounded Radar pagination makes truncation visible',async()=>{
 let calls=0;const fetcher=async(url,options)=>{if(url.includes('api.cloudflare.com')){calls++;return Response.json({success:true,result:url.includes('outages')?{annotations:Array.from({length:100},(_,i)=>({...event,id:i}))}:{events:[]}});}return mock()(url,options);};
 const report=await networkWatch({RADAR_API_TOKEN:'test-token'},fetcher,null);assert.equal(report.northAmerica.limited,true);assert.equal(report.networks[0].limited,true);assert.equal(calls,16);
});
