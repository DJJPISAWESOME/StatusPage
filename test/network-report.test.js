import test from 'node:test';
import assert from 'node:assert/strict';
import {reportPage,asnLabel,appendNetworkFeed,buildNetworkReport,networkReportState} from '../public/network-report.js';
test('report pages rotate through every record and wrap in both directions',()=>{const events=Array.from({length:13},(_,id)=>({id}));assert.deepEqual([0,1,2].flatMap(i=>reportPage(events,i).events),events);assert.equal(reportPage(events,3).page,0);assert.equal(reportPage(events,-1).page,2);assert.equal(reportPage([],7).pages,1);assert.equal(reportPage(events,0,2).pages,7);});
test('failed continuation retains loaded events and reports incomplete coverage',()=>{const event={id:'1',countries:['US'],asns:[]};let report=buildNetworkReport([],[{kind:'outages',asn:0,available:true,events:[event],nextPage:3}],{});report=appendNetworkFeed(report,{kind:'outages',asn:0,available:false,events:[],nextPage:null});assert.equal(report.northAmerica.events.length,1);assert.equal(report.northAmerica.available,false);assert.equal(report.loadFailed,true);assert.equal(report.loadingMore,false);});
test('ASN labels keep names beside numbers and explicitly label missing names',()=>{assert.equal(asnLabel({names:{32145:'OPENCAPE - OpenCape Corporation'}},32145),'AS32145 · OpenCape Corporation');assert.equal(asnLabel({},123),'AS123 · Name unavailable');});


test('missing or incomplete feed sets never imply complete event coverage',()=>{
 const networks=[{asn:25710,upstream:[],neighboursAvailable:true}];
 for(const feeds of [[],[{kind:'outages',asn:0,available:true,events:[]}]] ){
  const report=buildNetworkReport(networks,feeds,{});assert.equal(report.northAmerica.available,false);assert.equal(report.networks[0].eventsAvailable,false);
 }
});
test('empty network states distinguish coverage, loading and stale observations',()=>{
 const report={radarConfigured:true},section={available:true,events:[]};
 assert.equal(networkReportState(null,section),'loading');assert.equal(networkReportState({error:true},section),'error');
 assert.equal(networkReportState({radarConfigured:false},section),'disconnected');assert.equal(networkReportState(report,null),'incomplete');
 assert.equal(networkReportState(report,{...section,available:false}),'incomplete');assert.equal(networkReportState(report,{...section,limited:true}),'partial');
 assert.equal(networkReportState(report,section),'empty');assert.equal(networkReportState({...report,refreshFailed:true},section),'stale');
 assert.equal(networkReportState(report,{...section,events:[{}]}),'ready');
});
test('hyphenated registry identifiers are stripped while network names are preserved',()=>{
 assert.equal(asnLabel({names:{25710:'I3-BROADBAND-RI - i3 Broadband'}},25710),'AS25710 · i3 Broadband');
});

test('old reports remain stale even when the last request succeeded',()=>{assert.equal(networkReportState({radarConfigured:true,checkedAt:new Date(Date.now()-660000).toISOString()},{available:true,events:[]}),'stale');});
test('North America includes Central America, Caribbean and mixed overseas participants; foreign-only events are excluded',()=>{
 const events=['US','CA','MX','PA','PR','CW','GB'].map((country,id)=>({id:String(id),countries:['JP',country],asns:[174]}));const report=buildNetworkReport([{asn:25710,upstream:[174],neighboursAvailable:true}],[{asn:0,kind:'outages',available:true,events},...['leaks','hijacks'].map(kind=>({asn:0,kind,available:true,events:[]}))],{});assert.equal(report.northAmerica.events.length,6);assert.equal(report.upstream.events.length,7);assert.equal(report.upstream.available,true);
});
