// Real workerd + SQLite. Upstreams intentionally fail; unknown must stay unknown.
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHmac} from 'node:crypto';
await mkdir('artifacts',{recursive:true});const persistence=await mkdtemp(resolve('artifacts/runtime-'));
const secret='runtime-test-secret-not-for-production-123456';
const options=convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'signal',modules:true,scriptPath:'artifacts/worker/worker.js',compatibilityDate:'2026-09-01',durableObjects:{STATUS_HUB:{className:'StatusHub',useSQLite:true}},bindings:{REQUEST_PLAYER_TOKEN:secret,WEBHOOK_SERVICES:'',WEBHOOK_SECRETS:JSON.stringify({cloudflare:secret})},outboundService:request=>new URL(request.url).hostname==='www.youtube.com'?Response.json({title:'Runtime request',author_name:'Fixture artist'}):new Response('Test upstream unavailable',{status:503})}]});options.resourcePersistencePath=persistence;
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
 const requestSong=await mf.dispatchFetch('https://signal.test/api/requests',{method:'POST',headers:{Origin:'https://signal.test','Content-Type':'application/json'},body:JSON.stringify({url:'https://music.youtube.com/watch?v=dQw4w9WgXcQ',requestId:'runtime-request-123456'})});assert.equal(requestSong.status,200);assert.equal((await requestSong.json()).items.length,1);
 const claim=await mf.dispatchFetch('https://signal.test/api/requests/control',{method:'POST',headers:{Origin:'https://signal.test','Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify({action:'claim',session:'runtime-player-12345'})});assert.equal(claim.status,200);assert.equal((await claim.json()).current.title,'Runtime request');
 await mf.dispose();mf=new Miniflare(options);
 const songs=await (await mf.dispatchFetch('https://signal.test/api/requests')).json();assert.equal(songs.current.videoId,'dQw4w9WgXcQ');assert.equal(songs.playerEnabled,true);

 assert.equal((await (await post()).json()).duplicate,true);
 const after=await (await mf.dispatchFetch('https://signal.test/api/status')).json();assert.equal(after.webhookActivity.cloudflare.count,1);
 const persisted=await (await mf.dispatchFetch('https://signal.test/api/history?service=cloudflare')).json();assert.ok(persisted.rows.length>0);
 console.log('Runtime passed: visitor geo, collection, WebSocket, SQL history, authenticated webhook deduplication across restart.');
}finally{clearTimeout(watchdog);await mf.dispose();await rm(persistence,{recursive:true,force:true});}
