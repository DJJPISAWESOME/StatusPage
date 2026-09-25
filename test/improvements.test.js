import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {History,nextInterval,RETENTION_MS} from '../src/history.js';
import {scopeService,quietHours,shouldNotify,disagreement,historySummary} from '../public/policy.js';
import {normalizePreferences} from '../public/preferences.js';
import {RadioRecovery} from '../public/radio-player.js';
import {marine,weather} from '../src/weather.js';
import worker from '../src/worker.js';
const settings=normalizePreferences().alerts;
test('component scope excludes unrelated mapped incidents, preserves unmapped risk and missing data',()=>{
 const service={status:'outage',components:[{id:'us',name:'US',status:'operational'},{id:'eu',name:'EU',status:'outage'}],incidents:[{componentIds:['eu'],title:'Europe'}]};
 assert.equal(scopeService(service,['us']).status,'operational');assert.equal(scopeService(service,['us']).incidents.length,0);
 assert.equal(scopeService({...service,incidents:[{title:'Global issue'}]},['us']).status,'outage');assert.equal(scopeService(service,['missing']).status,'unknown');
});
test('preferences normalize invalid values, duplicate panels and missing selections',()=>{
 const p=normalizePreferences({density:'bad',panelOrder:['forecast','forecast','bad'],hiddenPanels:['overview','services','forecast','connection-panels','integration-health','incident-history'],alerts:{start:'99:99'}});
 assert.equal(p.panelOrder.length,6);assert.equal(p.panelOrder[0],'forecast');assert.equal(p.hiddenPanels.length,5);assert.equal(p.alerts.start,'22:00');assert.equal(p.alerts.enabled,false);
});
test('notification policy suppresses initial, unknown and quiet-hour transitions',()=>{
 const a={...settings,enabled:true,quiet:true};assert.equal(quietHours(a,new Date(2026,8,1,23)),true);assert.equal(quietHours(a,new Date(2026,8,1,6)),true);
 const midday=new Date(2026,8,1,12);assert.equal(quietHours(a,midday),false);assert.equal(shouldNotify(null,'outage',a,midday),false);assert.equal(shouldNotify('unknown','outage',a,midday),false);assert.equal(shouldNotify('operational','degraded',a,midday),true);assert.equal(shouldNotify('degraded','operational',a,midday),true);assert.equal(shouldNotify('operational','maintenance',a,midday),false);
});
test('model disagreement aligns timestamps and excludes missing/out-of-window values',()=>{
 assert.equal(disagreement([{available:true,hourly:{time:[100,200,300000],temperature_2m:[10,null,100]}},{available:true,hourly:{time:[200,100,300000],temperature_2m:[20,14,0]}}],100),4);
 assert.equal(disagreement([{available:false}],100),null);
});
function history(){const db=new DatabaseSync(':memory:');const sql={exec(query,...args){const s=db.prepare(query);return /^SELECT/i.test(query)?s.all(...args): (s.run(...args),[]);}};return {db,h:new History(sql)};}
test('durable intervals bound stale observations, insert monitoring gaps and report coverage honestly',()=>{
 const {db,h}=history();h.record({id:'a',status:'operational'},1000,100);h.record({id:'a',status:'operational'},1000,500);h.record({id:'a',status:'outage'},1000,2000);
 const d=h.query({days:1},2500);assert.equal(d.rows.length,3);assert.equal(d.rows.find(r=>r.reason==='monitoring_gap').start_ms,1500);assert.equal(d.totals.find(r=>r.status==='operational').duration_ms,1400);
 assert.equal(d.totals.find(r=>r.status==='outage').duration_ms,500);const summary=historySummary(d,1);assert.equal(summary.operationalShare,1400/1900);assert.equal(summary.coverage,1900/86400000);
 assert.equal(nextInterval({last_seen_ms:500,ttl_ms:1000,status:'operational',reason:'observed'},{status:'operational'},1000,2000).extend,false);db.close();
});
test('history pagination has no duplicates, filtering does not change coverage, and retention prunes old intervals',()=>{
 const {db,h}=history();for(let i=0;i<110;i++)h.record({id:'a',status:i%2?'outage':'operational'},1000,i*1000);
 const first=h.query({days:1},110000),second=h.query({days:1,before:first.nextCursor},110000);assert.equal(first.rows.length,100);assert.equal(second.rows.length,10);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,110);
 const filtered=h.query({days:1,status:'outage'},110000);assert.deepEqual(filtered.totals,first.totals);h.prune(RETENTION_MS+200000);assert.equal([...h.sql.exec('SELECT * FROM intervals')].length,1);db.close();
});
test('radio retries are bounded, manual stop cancels retries, and stale play rejections cannot restart',async()=>{
 class Audio extends EventTarget{pause(){} async play(){throw new Error('Network');}}
 const tasks=new Map();let id=0;const player=new RadioRecovery(new Audio(),()=>{},{setTimer:(fn)=>{tasks.set(++id,fn);return id;},clearTimer:i=>tasks.delete(i)});
 player.start({stream:'https://example.com/audio'});await Promise.resolve();assert.equal(player.attempt,1);
 for(let i=0;i<3;i++){const [key,fn]=[...tasks][0];tasks.delete(key);fn();await Promise.resolve();}
 assert.equal(player.active,false);assert.equal(tasks.size,0);player.start({stream:'https://example.com/audio'});await Promise.resolve();player.stop();assert.equal(tasks.size,0);assert.equal(player.retryPending,false);
});
test('marine and history endpoints reject invalid coordinates and filter injection',async()=>{
 await assert.rejects(()=>marine({latitude:999,longitude:0}),/latitude|coordinates/i);
 const r=await worker.fetch(new Request('https://signal.test/api/history?service=unknown'),{});assert.equal(r.status,400);
 const bad=await worker.fetch(new Request('https://signal.test/api/history?before=-1'),{});assert.equal(bad.status,400);
});
test('forecast metadata failure preserves usable model data and null-only models stay unavailable',async()=>{
 const fetcher=async url=>{
   if(url.includes('/data/'))return new Response('Unavailable',{status:503});
   if(url.includes('weather.gov'))return Response.json({features:[]});
   if(url.includes('ncep_aigfs025'))return Response.json({hourly:{time:[1],temperature_2m:[null]}});
   if(url.includes('models='))return Response.json({hourly:{time:[1],temperature_2m:[65]}});
   return Response.json({current:{temperature_2m:65},hourly:{time:[1],wind_gusts_10m:[15]}});
 };
 const result=await weather({latitude:41.82,longitude:-71.41},{},fetcher,null);assert.equal(result.models[0].available,true);assert.equal(result.models[0].metadata,null);assert.equal(result.models[1].available,false);assert.equal(result.conditions.hourly.wind_gusts_10m[0],15);
});

test('alarm preserves invalidations that arrive during collection and retries failed collection',async()=>{
 const {StatusHub}=await import('../src/hub.js');globalThis.WebSocketRequestResponsePair ||= class {};
 const db=new Map([['pending',{cloudflare:'old'}]]);let alarm,initializing;
 const ctx={storage:{async get(k){return structuredClone(db.get(k));},async put(k,v){if(typeof k==='object'){for(const [a,b] of Object.entries(k))db.set(a,structuredClone(b));}else db.set(k,structuredClone(v));},async getAlarm(){return alarm;},async setAlarm(v){alarm=v;}},blockConcurrencyWhile(fn){initializing=fn();return initializing;},setWebSocketAutoResponse(){},getWebSockets(){return[];}};
 const hub=new StatusHub(ctx,{});await initializing;hub.enqueue=async()=>db.set('pending',{cloudflare:'new',openai:'arrived'});await hub.alarm();assert.deepEqual(db.get('pending'),{cloudflare:'new',openai:'arrived'});assert.ok(alarm);
 hub.enqueue=async()=>{throw Error('Storage failure');};const before=Date.now();await assert.rejects(()=>hub.alarm(),/Storage failure/);assert.ok(alarm>=before+30000);assert.equal(Object.keys(db.get('pending')).length,2);
});

test('Apple catalog uses the Apple parser and public developer endpoint',async()=>{
 const {SERVICES}=await import('../src/catalog.js');const {parseProvider}=await import('../src/providers.js');const s=SERVICES.find(s=>s.id==='apple-services');assert.equal(parseProvider(s,'{"services":[{"serviceName":"App Store","events":[]}]}').status,'operational');assert.equal(SERVICES.find(s=>s.id==='apple-developer').url,'https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js');
});
