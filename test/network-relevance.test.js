import test from 'node:test';import assert from 'node:assert/strict';
import {curateNetworkEvents} from '../public/network-relevance.js';
const at=Date.parse('2026-10-01T13:00:00Z'),networks=[{asn:25710,upstream:[174],neighboursAvailable:true}];
const event=(id,extra={})=>({id,type:'Route leak',actorASN:999,asns:[999,174],countries:['US'],state:'Ongoing',start:'2026-10-01T12:00:00Z',lastSeen:'2026-10-01T12:55:00Z',...extra});
test('transit-segment appearances do not qualify as upstream incident roles',()=>{const p=curateNetworkEvents([event('transit'),event('actor',{actorASN:174})],networks,{at});assert.deepEqual(p.events.map(e=>e.id),['actor']);assert.equal(p.selection.transitOnly,1);assert.equal(p.events[0].localImpactConfirmed,false);});
test('high-confidence current provider actors/victims qualify but ended, stale and old observations do not',()=>{
 const events=[event('victim',{type:'Potential route hijack',victimASNs:[174],confidence:8}),event('low',{type:'Potential route hijack',victimASNs:[174],confidence:4}),event('ended',{actorASN:174,state:'Ended'}),event('stale',{actorASN:174,state:'Stale detection'}),event('old',{actorASN:174,lastSeen:'2026-09-28T00:00:00Z'})];const p=curateNetworkEvents(events,networks,{at});assert.deepEqual(p.events.map(e=>e.id),['victim']);assert.equal(p.selection.historical,2);assert.equal(p.selection.olderOrUnknown,2);
});
test('every direct ongoing report is retained even beyond context cap, without claiming impact or freshness',()=>{
 const events=Array.from({length:9},(_,i)=>event(String(i),{actorASN:25710,asns:[25710],lastSeen:null,start:'2026-09-20T00:00:00Z'}));events.push(event('context',{actorASN:174}));const p=curateNetworkEvents(events,networks,{at,limit:4});assert.equal(p.events.length,9);assert.equal(p.selection.omittedByLimit,1);assert.ok(p.events.every(e=>e.relevance==='Direct monitored-ASN report'&&e.localImpactConfirmed===false));
});
test('recent direct recovery is shown for six hours; ended historical incidents are counted separately',()=>{const p=curateNetworkEvents([event('recovery',{asns:[25710],state:'Ended',endAt:'2026-10-01T10:00:00Z'}),event('history',{asns:[25710],state:'Ended',endAt:'2026-09-30T10:00:00Z'})],networks,{at});assert.deepEqual(p.events.map(e=>e.id),['recovery']);assert.equal(p.selection.historical,1);});
test('regional context is current outage reporting rather than every unrelated routing participant',()=>{
 const p=curateNetworkEvents([event('unrelated'),event('US-outage',{type:'Internet outage',asns:[],state:'No end reported'}),event('foreign',{type:'Internet outage',asns:[],countries:['JP']})],networks,{at,scope:'northAmerica'});assert.deepEqual(p.events.map(e=>e.id),['US-outage']);assert.equal(p.events[0].relevance,'Regional outage context');
});
test('missing direct source data and unknown upstream topology remain independent coverage failures',async()=>{
 const {buildNetworkReport}=await import('../public/network-report.js');const p=buildNetworkReport([{asn:25710,upstream:[],neighboursAvailable:true}],[{kind:'outages',asn:0,available:false,events:[]}],{at});assert.equal(p.northAmerica.available,false);assert.equal(p.upstream.available,false);assert.equal(p.upstream.topologyIncomplete,true);assert.equal(p.northAmerica.events.length,0);
});
test('missing upstream incident-role metadata is unknown coverage rather than reassuring empty results',async()=>{const {buildNetworkReport}=await import('../public/network-report.js');const feeds=['outages','leaks','hijacks'].map(kind=>({asn:0,kind,available:true,events:kind==='leaks'?[event('unknown',{actorASN:null})]:[]}));const p=buildNetworkReport(networks,feeds,{at});assert.equal(p.northAmerica.available,false);assert.equal(p.upstream.available,false);assert.equal(p.upstream.selection.roleUnknown,1);});
