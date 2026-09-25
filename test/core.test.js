import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from '../src/catalog.js';
import { coordinates, readLimited, upstream, verifyHmac, equalSecret } from '../src/security.js';
import { parseProvider, collectService } from '../src/providers.js';
import { visitorLocation, weather } from '../src/weather.js';
import worker from '../src/worker.js';
import { mergeResult, StatusHub } from '../src/hub.js';
const parse = (parser, data) => parseProvider({ parser }, typeof data === 'string' ? data : JSON.stringify(data));
const service = SERVICES.find(s => s.id === 'cloudflare');
const secret = 'test-secret-with-at-least-32-characters';
async function signed(body='{}',stamp=Math.floor(Date.now()/1000),id='event-12345',path='/api/webhooks/signed/cloudflare'){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${stamp}.${id}.${path}.${body}`))).toString('hex');
 return new Request(`https://dashboard.test${path}`,{method:'POST',headers:{'X-Signal-Timestamp':String(stamp),'X-Signal-Id':id,'X-Signal-Signature':`sha256=${sig}`},body});
}
test('Rhode Island visitor coordinates and zero coordinates are retained',()=>{
 assert.deepEqual(coordinates('0','0'),{latitude:0,longitude:0});
 const ri=visitorLocation({latitude:'41.824',longitude:'-71.4128',city:'Providence',regionCode:'RI',country:'US'});
 assert.equal(ri.label,'Providence, RI, US');assert.equal(ri.source,'cloudflare');assert.equal(ri.latitude,41.82);
 for(const args of [[null,0],['',3],[91,2],['NaN',2],[3,181]])assert.throws(()=>coordinates(...args));
 assert.equal(visitorLocation().label,'Providence, RI');assert.equal(visitorLocation().source,'fallback');
});
test('missing provider schema never implies operational',()=>{
 for(const parser of ['statuspage','google','apple','follett','betterstack','statusio'])assert.throws(()=>parse(parser,{}));
 assert.equal(parse('statuspage',{status:{indicator:'unrecognized'}}).status,'unknown');
});
test('Statuspage includes active incidents, components, and maintenance without resurrecting resolved events',()=>{
 assert.equal(parse('statuspage',{status:{indicator:'none'},incidents:[{status:'resolved',impact:'major'}]}).status,'operational');
 const d=parse('statuspage',{status:{indicator:'none'},incidents:[{name:'Outage',status:'investigating',impact:'major',incident_updates:[{body:'Working on it'}]}]});
 assert.equal(d.status,'outage');assert.equal(d.incidents[0].body,'Working on it');
 assert.equal(parse('statuspage',{status:{indicator:'none'},scheduled_maintenances:[{status:'in_progress',name:'Work'}]}).status,'maintenance');
 assert.equal(parse('statuspage',{status:{indicator:'none'},components:[{status:'partial_outage'}]}).status,'degraded');
});
test('all custom JSON provider adapters handle healthy and active states',()=>{
 assert.equal(parse('google',[]).status,'operational');assert.equal(parse('google',[{severity:'high'}]).status,'outage');assert.equal(parse('google',[{end:'2026-09-20'}]).status,'operational');
 assert.equal(parse('apple','jsonCallback({"services":[{"events":[{"eventStatus":"resolved"}]}]});').status,'operational');
 assert.equal(parse('apple',{services:[{serviceName:'iCloud',events:[{eventStatus:'ongoing'}]}]}).status,'degraded');
 assert.equal(parse('follett',{generalStatus:'issues'}).status,'degraded');
 assert.equal(parse('betterstack',{data:{attributes:{aggregate_state:'downtime'}}}).status,'outage');
 assert.equal(parse('statusio',{result:{status_overall:{status_code:100}}}).status,'operational');
 assert.equal(parse('statusio',{result:{status_overall:{status_code:300}}}).status,'degraded');
 assert.equal(parse('statusio-html','<div id="statusbar_text">All Systems Operational</div>').status,'operational');
 assert.throws(()=>parse('statusio-html','<html>Access denied</html>'));
});
test('RSS is a feed, never a health assertion; malicious and broken XML rejected',()=>{
 const d=parse('rss','<rss><channel><item><title>Resolved issue</title><description>Fixed</description></item></channel></rss>');
 assert.equal(d.status,'unknown');assert.equal(d.incidents[0].title,'Resolved issue');
 assert.equal(parse('rss','<rss><channel></channel></rss>').status,'unknown');
 assert.throws(()=>parse('rss','<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss>&x;</rss>'));
 assert.throws(()=>parse('rss','<rss><item></rss>'));
});
test('response cap counts actual bytes even without Content-Length',async()=>{
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(8));c.enqueue(new Uint8Array(8));c.close();}});
 await assert.rejects(readLimited(new Response(body),12),/Body too large/);
 await assert.rejects(readLimited(new Response('ééé'),5),/Body too large/);
 assert.equal(await readLimited(new Response('ok'),2),'ok');
});
test('upstream requests forbid redirects and preserve timeout through the response body',async()=>{
 let init;await upstream('https://allowed.test',{fetcher:async(_url,options)=>{init=options;return new Response('{}');}});assert.equal(init.redirect,'error');
 await assert.rejects(upstream('https://allowed.test',{timeout:10,fetcher:async(_url,{signal})=>new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(new Error('timeout')));}}))}),/timeout/);
});
test('provider failures are unknown and previous freshness is preserved honestly',async()=>{
 const result=await collectService(service,async()=>new Response('bad',{status:503}));assert.equal(result.status,'unknown');assert.ok(result.error);
 const merged=mergeResult({status:'outage',lastSuccessAt:'2026-01-01'},result,'scheduled');assert.equal(merged.status,'unknown');assert.equal(merged.previousStatus,'outage');assert.equal(merged.lastSuccessAt,'2026-01-01');
});
test('HMAC authenticates body, timestamp, service path and event identity',async()=>{
 const r=await signed();assert.equal((await verifyHmac(r,'{}',secret)).id,'event-12345');
 await assert.rejects(verifyHmac(r,'{"forged":true}',secret),/Invalid/);
 await assert.rejects(verifyHmac(new Request('https://dashboard.test/api/webhooks/signed/openai',r),'{}',secret),/Invalid/);
 await assert.rejects(verifyHmac(await signed('{}',Math.floor(Date.now()/1000)-301),'{}',secret),/Invalid/);
 await assert.rejects(verifyHmac(r,'{}','short'),/not configured/);
 assert.equal(await equalSecret(secret,secret),true);assert.equal(await equalSecret('wrong',secret),false);
});
test('API geo responses cannot be cached across visitors and reject invalid methods',async()=>{
 const req=new Request('https://dashboard.test/api/location');Object.defineProperty(req,'cf',{value:{latitude:'41.82',longitude:'-71.41',city:'Providence',regionCode:'RI'}});
 const r=await worker.fetch(req,{});assert.match(r.headers.get('Cache-Control'),/no-store/);assert.match((await r.json()).label,/Providence/);
 assert.equal((await worker.fetch(new Request('https://dashboard.test/api/location',{method:'POST'}),{})).status,405);
 assert.equal((await worker.fetch(new Request('https://dashboard.test/api/location',{headers:{Origin:'https://evil.test'}}),{})).status,403);
 assert.equal((await worker.fetch(new Request('https://dashboard.test/api/proxy?url=https://evil.test'),{})).status,404);
});
test('unsigned hooks and cross-origin socket upgrades are rejected before mutation',async()=>{
 const env={WEBHOOK_SECRETS:JSON.stringify({cloudflare:secret}),STATUS_HUB:{get(){throw new Error('Must not access hub');}}};
 assert.equal((await worker.fetch(new Request('https://dashboard.test/api/webhooks/signed/cloudflare',{method:'POST',body:'{}'}),env)).status,401);
 assert.equal((await worker.fetch(new Request('https://dashboard.test/api/live',{headers:{Origin:'https://evil.test',Upgrade:'websocket'}}),env)).status,403);
});
test('weather models fail independently; official alerts failure is explicit',async()=>{
 const mock=async url=>{
  const u=new URL(url); if(u.hostname==='api.weather.gov')return new Response('down',{status:503});
  if(u.searchParams.get('models')==='ncep_aigfs025')return new Response('down',{status:503});
  if(u.searchParams.has('models'))return Response.json({hourly:{time:[1800000000],temperature_2m:[63],wind_speed_10m:[8]},timezone:'America/New_York'});
  return Response.json({current:{temperature_2m:64},daily:{time:[]},timezone:'America/New_York'});
 };
 const d=await weather({latitude:41.82,longitude:-71.41},{},mock,null);assert.equal(d.models[0].available,true);assert.equal(d.models[1].available,false);assert.equal(d.alerts.available,false);assert.equal(d.conditions.current.temperature_2m,64);
});
test('shared weather cache keys separate coordinates and preserve fetch time',async()=>{
 const entries=new Map();const cache={async match(req){return entries.get(req.url)?.clone();},async put(req,res){entries.set(req.url,res.clone());}};let calls=0;
 const mock=async url=>{calls++;return Response.json(url.includes('/data/')?{last_run_initialisation_time:1800000000,last_run_availability_time:1800000500}:url.includes('weather.gov')?{features:[]}:url.includes('models=')?{hourly:{time:[1800000000],temperature_2m:[60]},timezone:'America/New_York'}:{current:{temperature_2m:61}});};
 const a=await weather({latitude:41.82,longitude:-71.41},{},mock,cache);const first=calls;const b=await weather({latitude:41.82,longitude:-71.41},{},mock,cache);assert.equal(calls,first);assert.equal(a.models[0].fetchedAt,b.models[0].fetchedAt);
 await weather({latitude:40.71,longitude:-74},{},mock,cache);assert.equal(calls,first+4); // Model metadata is shared across coordinates.
});
test('replay receipts persist and invalidate only known service after authenticated ingress',async()=>{
 const calls=[];const env={WEBHOOK_SECRETS:JSON.stringify({cloudflare:secret}),STATUS_HUB:{idFromName(){return 'x';},get(){return{async fetch(url,init){calls.push(JSON.parse(init.body));return Response.json({accepted:true},{status:202});}};}}};
 const r=await worker.fetch(await signed(),env);assert.equal(r.status,202);assert.deepEqual(calls,[{service:'cloudflare',receipt:'event-12345'}]);
});
// Exercise the real Durable Object class with a minimal storage adapter, including restart.
test('Durable Object persists deduplication and schedules durable invalidation',async()=>{
 globalThis.WebSocketRequestResponsePair=class{constructor(a,b){this.a=a;this.b=b;}};
 const db=new Map();let alarm;let initializing;
 const ctx={storage:{async get(k){return structuredClone(db.get(k));},async put(k,v){if(typeof k==='object'){for(const [key,value] of Object.entries(k))db.set(key,structuredClone(value));}else db.set(k,structuredClone(v));},async getAlarm(){return alarm;},async setAlarm(t){alarm=t;}},blockConcurrencyWhile(fn){initializing=fn();return initializing;},setWebSocketAutoResponse(){},waitUntil(){},getWebSockets(){return[];}};
 let h=new StatusHub(ctx,{});await initializing;
 const request=()=>new Request('https://hub/invalidate',{method:'POST',body:JSON.stringify({service:'cloudflare',receipt:'event-1'})});
 assert.equal((await (await h.fetch(request())).json()).duplicate,false);assert.ok(alarm);assert.deepEqual(Object.keys(db.get('pending')),['cloudflare']);
 h=new StatusHub(ctx,{});await initializing;assert.equal((await (await h.fetch(request())).json()).duplicate,true);
});

test('radio metadata reads an ICY block and cancels the audio stream',async()=>{
 const {radioMetadata}=await import('../src/radio.js');let cancelled=false;
 const meta="StreamTitle='Artist - Song';";const size=Math.ceil(meta.length/16);const bytes=new Uint8Array(16+1+size*16);bytes[16]=size;bytes.set(new TextEncoder().encode(meta),17);
 const mock=async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes);},cancel(){cancelled=true;}}),{headers:{'icy-metaint':'16'}});
 const result=await radioMetadata('river',mock,null);assert.equal(result.title,'Artist - Song');assert.equal(cancelled,true);
});
test('radio metadata rejects untrusted redirects and unknown station IDs',async()=>{
 const {radioMetadata}=await import('../src/radio.js');let calls=0;
 const d=await radioMetadata('river',async()=>{calls++;return new Response(null,{status:302,headers:{Location:'http://169.254.169.254/'}});},null);
 assert.equal(d.available,false);assert.equal(calls,1);await assert.rejects(radioMetadata('arbitrary-url',fetch,null),/Unknown station/);
});
test('webhook mode requires configured credentials and does not accidentally disable polling',()=>{
 const hooks=StatusHub.prototype.webhookServices.call({env:{WEBHOOK_SERVICES:'cloudflare,openai',WEBHOOK_SECRETS:JSON.stringify({cloudflare:secret})}});
 assert.deepEqual([...hooks],['cloudflare']);
});
