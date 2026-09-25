// Real workerd + SQLite. Upstreams intentionally fail; unknown must stay unknown.
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHmac} from 'node:crypto';
await mkdir('artifacts',{recursive:true});const persistence=await mkdtemp(resolve('artifacts/runtime-'));
const secret='runtime-test-secret-not-for-production-123456';
const options=convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'signal',modules:true,scriptPath:'artifacts/worker/worker.js',compatibilityDate:'2026-09-01',durableObjects:{STATUS_HUB:{className:'StatusHub',useSQLite:true}},bindings:{WEBHOOK_SERVICES:'',WEBHOOK_SECRETS:JSON.stringify({cloudflare:secret})},outboundService:()=>new Response('Test upstream unavailable',{status:503})}]});options.resourcePersistencePath=persistence;
let mf=new Miniflare(options),watchdog;
try{
 const geo=await mf.dispatchFetch('https://signal.test/api/location',{cf:{latitude:'41.82',longitude:'-71.41',city:'Providence',regionCode:'RI'}});assert.equal((await geo.json()).source,'cloudflare');
 const data=await (await mf.dispatchFetch('https://signal.test/api/status')).json();assert.equal(data.services.length,32);
 const live=await mf.dispatchFetch('https://signal.test/api/live',{headers:{Upgrade:'websocket',Origin:'https://signal.test'}});assert.equal(live.status,101);live.webSocket.accept();
 const update=await Promise.race([new Promise(resolve=>live.webSocket.addEventListener('message',e=>{if(e.data!=='pong'){const d=JSON.parse(e.data);if(d.updatedAt)resolve(d);}})),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('No broadcast')),10000);})]);clearTimeout(watchdog);
 assert.equal(update.services.every(s=>s.status==='unknown'),true);live.webSocket.close(1000);
 const history=await (await mf.dispatchFetch('https://signal.test/api/history?days=1')).json();assert.equal(history.rows.length,32);assert.equal(history.rows.every(r=>r.reason==='source_error'),true);
 const path='/api/webhooks/signed/cloudflare',body='{}',stamp=String(Math.floor(Date.now()/1000)),id='runtime-event-123';const signature=createHmac('sha256',secret).update(`${stamp}.${id}.${path}.${body}`).digest('hex');
 const post=()=>mf.dispatchFetch('https://signal.test'+path,{method:'POST',body,headers:{'X-Signal-Timestamp':stamp,'X-Signal-Id':id,'X-Signal-Signature':'sha256='+signature}});
 assert.equal((await (await post()).json()).duplicate,false);
 await mf.dispose();mf=new Miniflare(options);
 assert.equal((await (await post()).json()).duplicate,true);
 const after=await (await mf.dispatchFetch('https://signal.test/api/status')).json();assert.equal(after.webhookActivity.cloudflare.count,1);
 const persisted=await (await mf.dispatchFetch('https://signal.test/api/history?service=cloudflare')).json();assert.ok(persisted.rows.length>0);
 console.log('Runtime passed: visitor geo, collection, WebSocket, SQL history, authenticated webhook deduplication across restart.');
}finally{clearTimeout(watchdog);await mf.dispose();await rm(persistence,{recursive:true,force:true});}
