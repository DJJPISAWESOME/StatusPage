import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeId,RequestQueue,searchYoutube,videoDetails,parseYoutubeSearch} from '../src/requests.js';
import worker from '../src/worker.js';
const videoId='dQw4w9WgXcQ';
class Storage{
 constructor(){this.values=new Map();this.serial=Promise.resolve();}
 async get(key){return structuredClone(this.values.get(key));}async put(key,value){this.values.set(key,structuredClone(value));}
 transaction(fn){const next=this.serial.then(()=>fn(this));this.serial=next.catch(()=>{});return next;}
}
const call=async(q,body)=>{const response=await q.handle(new Request('https://hub/requests',body?{method:'POST',body:JSON.stringify(body)}:{}));return {status:response.status,...await response.json()};};
const add=(id=videoId,client='one',requestId=crypto.randomUUID())=>({action:'add',video:{videoId:id,title:'Song',artist:'Artist'},client,requestId});
const session='test-board-session-123456';
test('YouTube, Music, shorts and short links normalize; unrelated hosts and playlists fail',()=>{
 for(const link of [videoId,`https://www.youtube.com/watch?v=${videoId}&list=ignored`,`https://music.youtube.com/watch?v=${videoId}`,`https://youtu.be/${videoId}?si=test`,`https://youtube.com/shorts/${videoId}`])assert.equal(youtubeId(link),videoId);
 for(const link of ['https://youtube.com.evil.test/watch?v='+videoId,'http://youtube.com/watch?v='+videoId,'https://youtube.com/playlist?list=123','https://user@youtube.com/watch?v='+videoId])assert.throws(()=>youtubeId(link));
});
test('queue persists, deduplicates retries and limits public requests',async()=>{
 const storage=new Storage(),q=new RequestQueue(storage),body=add();assert.equal((await call(q,body)).items.length,1);assert.equal((await call(q,body)).items.length,1);assert.equal((await call(q,add())).status,409);
 await call(q,add('aaaaaaaaaaa'));await call(q,add('bbbbbbbbbbb'));assert.equal((await call(q,add('ccccccccccc'))).status,429);
 assert.equal((await call(new RequestQueue(storage))).items.length,3);
 const view=await call(q);assert.equal('owner' in view,false);assert.equal('recent' in view,false);
});
test('only one Board owns playback and duplicate advancement never skips two tracks',async()=>{
 const q=new RequestQueue(new Storage());await call(q,add());await call(q,add('aaaaaaaaaaa'));
 const first=await call(q,{action:'claim',session});assert.equal(first.current.videoId,videoId);
 assert.equal((await call(q,{action:'claim',session:'different-board-12345'})).status,409);
 const [a,b]=await Promise.all([call(q,{action:'next',session,id:first.current.id}),call(q,{action:'next',session,id:first.current.id})]);assert.equal(a.current.id,b.current.id);assert.equal(a.current.videoId,'aaaaaaaaaaa');
 await call(q,{action:'release',session});assert.equal((await call(q,{action:'heartbeat',session})).status,409);
 assert.equal((await call(q,{action:'claim',session:'different-board-12345'})).current.id,a.current.id);
});
test('expired leases can be claimed by another Board without consuming the current song',async()=>{
 const storage=new Storage(),q=new RequestQueue(storage);await call(q,add());const before=await call(q,{action:'claim',session});const state=await storage.get('music');state.leaseUntil=Date.now()-1;await storage.put('music',state);
 assert.equal((await call(q,{action:'next',session,id:before.current.id})).status,409);assert.equal((await call(q,{action:'claim',session:'replacement-board-123'})).current.id,before.current.id);
});
test('queue capacity is bounded even with distinct clients',async()=>{
 const q=new RequestQueue(new Storage());for(let i=0;i<50;i++)assert.equal((await call(q,add(String(i).padStart(11,'0'),String(i)))).status,200);assert.equal((await call(q,add('zzzzzzzzzzz','new'))).status,409);
});
const searchHTML=contents=>`<script>var ytInitialData = ${JSON.stringify({contents:{twoColumnSearchResultsRenderer:{primaryContents:{sectionListRenderer:{contents}}}}})};</script>`;
test('key-free search parses public results in order, ignores playlists and does not execute scripts',async()=>{
 const html=searchHTML([{videoRenderer:{videoId,title:{runs:[{text:'A "song" } and \\ artist'}]},ownerText:{runs:[{text:'Artist'}]}}},{lockupViewModel:{contentType:'LOCKUP_CONTENT_TYPE_PLAYLIST',contentId:videoId}},{lockupViewModel:{contentType:'LOCKUP_CONTENT_TYPE_VIDEO',contentId:'aaaaaaaaaaa',metadata:{lockupMetadataViewModel:{title:{content:'Second song'}}}}},{videoRenderer:{videoId,title:{simpleText:'Duplicate'}}}]);
 const data=await searchYoutube('song',async url=>{const u=new URL(url);assert.equal(u.hostname,'www.youtube.com');assert.equal(u.pathname,'/results');assert.equal(u.searchParams.has('key'),false);return new Response(html);},null);
 assert.deepEqual(data.results.map(r=>r.videoId),[videoId,'aaaaaaaaaaa']);assert.equal(data.results[0].artist,'Artist');
 assert.throws(()=>parseYoutubeSearch('<script>var ytInitialData = {bad};</script>'));
 assert.throws(()=>parseYoutubeSearch('<html>Consent required</html>'));
 assert.deepEqual(parseYoutubeSearch(searchHTML([{messageRenderer:{text:{simpleText:'No results'}}}])).results,[]);
 await assert.rejects(()=>searchYoutube('song',async()=>new Response('provider details',{status:403}),null),error=>!error.message.includes('provider details'));
 const meta=await videoDetails(videoId,async url=>{assert.equal(new URL(url).hostname,'www.youtube.com');return Response.json({title:'Song',author_name:'Artist'});},null);assert.equal(meta.title,'Song');
});
test('player commands require same origin and a configured secret before reaching storage',async()=>{
 let called=false;const secret='test-player-key-at-least-32-characters';const env={REQUEST_PLAYER_TOKEN:secret,STATUS_HUB:{idFromName:x=>x,get:()=>({fetch:()=>{called=true;return Response.json({items:[]});}})}};
 const command=(origin,token)=>new Request('https://signal.test/api/requests/control',{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'claim',session})});
 assert.equal((await worker.fetch(command('https://evil.test',secret),env)).status,403);assert.equal((await worker.fetch(command('https://signal.test','bad'),env)).status,401);assert.equal(called,false);
 assert.equal((await worker.fetch(command('https://signal.test',secret),env)).status,200);assert.equal(called,true);
});
