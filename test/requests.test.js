import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeId,RequestQueue,searchYoutube,videoDetails,parseYoutubeSearch,requestRoute,requesterCookie} from '../src/requests.js';
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
 await call(q,add('aaaaaaaaaaa'));assert.equal((await call(q,add('bbbbbbbbbbb'))).status,200);assert.equal((await call(q,add('ccccccccccc'))).status,429);
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
 const q=new RequestQueue(new Storage());for(let i=0;i<36;i++)assert.equal((await call(q,add(String(i).padStart(11,'0'),String(i)))).status,200);assert.equal((await call(q,add('zzzzzzzzzzz','new'))).status,409);
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
test('player commands need same origin but no configured key',async()=>{
 let called=false;const env={STATUS_HUB:{idFromName:x=>x,get:()=>({fetch:()=>{called=true;return Response.json({items:[]});}})}};
 const command=origin=>new Request('https://signal.test/api/requests/control',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'claim',session})});
 assert.equal((await worker.fetch(command('https://evil.test'),env)).status,403);assert.equal(called,false);
 assert.equal((await worker.fetch(command('https://signal.test'),env)).status,200);assert.equal(called,true);
});
test('remote controls keep ownership private, reject stale skips and report Board progress',async()=>{
 const q=new RequestQueue(new Storage());await call(q,add());await call(q,add('aaaaaaaaaaa'));
 assert.equal((await call(q,{action:'remote',command:'pause'})).status,409);
 const first=await call(q,{action:'claim',session});const remote=command=>call(q,{action:'remote',command,id:first.current.id});
 assert.equal((await remote('pause')).transport.paused,true);
 assert.equal((await remote('rewind')).transport.rewind,1);
 assert.equal((await remote('resume')).transport.paused,false);
 assert.equal((await call(q,{action:'remote',command:'volume',volume:2})).status,400);
 assert.equal((await call(q,{action:'remote',command:'volume',volume:.25})).remoteVolume.value,.25);
 const progress=await call(q,{action:'heartbeat',session,id:first.current.id,playback:{position:30,duration:180,paused:false,volume:.25}});
 assert.equal(progress.playback.position,30);assert.equal(progress.playback.duration,180);assert.equal('owner' in progress,false);
 const next=await remote('skip');assert.equal(next.current.videoId,'aaaaaaaaaaa');assert.equal(next.playback,null);assert.equal(next.transport,null);
 assert.equal((await remote('skip')).status,409);
 await call(q,{action:'heartbeat',session,id:first.current.id,playback:{position:60,duration:180}});assert.equal((await call(q)).playback,null);
 await call(q,{action:'release',session});assert.equal((await call(q,{action:'remote',command:'volume',volume:.5})).status,409);
});
test('explicit Board takeover preserves the song and revokes old player commands',async()=>{
 const q=new RequestQueue(new Storage());await call(q,add());await call(q,add('aaaaaaaaaaa'));
 const before=await call(q,{action:'claim',session});const replacement='replacement-board-12345';
 const after=await call(q,{action:'takeover',session:replacement});assert.equal(after.current.id,before.current.id);assert.equal(after.items.length,1);
 for(const action of ['heartbeat','next','release'])assert.equal((await call(q,{action,session,id:before.current.id})).status,409);
 assert.equal((await call(q,{action:'heartbeat',session:replacement})).status,200);
});

test('hourly limits persist after playback and free one slot at its rolling expiry',async()=>{
 const storage=new Storage(),q=new RequestQueue(storage);
 for(let i=0;i<6;i++){
  assert.equal((await call(q,add(String(i).padStart(11,'0'),'alice'))).status,200);
  assert.equal((await call(q,add(String(i+10).padStart(11,'0'),`other-${i}`))).status,200);
 }
 const blocked=await call(q,add('zzzzzzzzzzz','alice'));assert.equal(blocked.status,429);assert.match(blocked.error,/all 6/);
 const state=await storage.get('music');state.items=[];state.current=null;await storage.put('music',state);
 assert.equal((await call(new RequestQueue(storage),add('zzzzzzzzzzz','alice'))).status,429);
 state.recent.find(r=>r.client==='alice').at=Date.now()-3600001;await storage.put('music',state);
 const accepted=await call(q,add('zzzzzzzzzzz','alice'));assert.equal(accepted.status,200);assert.equal(accepted.requester.used,6);assert.equal(accepted.requester.remaining,0);assert.ok(accepted.requester.nextResetAt>Date.now());
 assert.equal('requester' in accepted.items[0],false);
});
test('concurrent submissions cannot exceed three consecutive songs, including the playing song',async()=>{
 const q=new RequestQueue(new Storage());
 const results=await Promise.all(['aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc','ggggggggggg'].map(id=>call(q,add(id))));
 assert.deepEqual(results.map(r=>r.status),[200,200,200,429]);assert.equal(results[3].code,'consecutive_limit');
 const first=await call(q,{action:'claim',session});assert.equal((await call(q,add('ddddddddddd'))).status,429);
 const next=await call(q,{action:'next',session,id:first.current.id});assert.equal((await call(q,add('ddddddddddd'))).status,200);
 assert.equal((await call(q,add('eeeeeeeeeee','another'))).status,200);
 assert.equal((await call(q,add('fffffffffff'))).status,200);
 assert.equal('requester' in next.current,false);
});
test('anonymous cookie is private, reused across visits and independent for browsers sharing an IP',async()=>{
 const clients=[];const q=new RequestQueue(new Storage());
 const env={STATUS_HUB:{idFromName:x=>x,get:()=>({fetch:url=>{clients.push(new URL(url).searchParams.get('client'));return q.handle(new Request(url));}})}};
 const get=cookie=>requestRoute(new Request('https://signal.test/api/requests',{headers:{'CF-Connecting-IP':'1.2.3.4',...(cookie?{Cookie:cookie}:{})}}),env);
 const first=await get(),set=first.headers.get('Set-Cookie');assert.match(set,/HttpOnly; Secure; SameSite=Lax/);
 const cookie=set.split(';')[0];assert.equal((await first.json()).requester.remaining,6);
 assert.equal((await get(cookie)).headers.has('Set-Cookie'),false);await get();
 assert.equal(clients[0],clients[1]);assert.notEqual(clients[0],clients[2]);
 assert.equal(requesterCookie(new Request('https://signal.test',{headers:{Cookie:'__Host-signal-requester=bad'}})),null);
 await assert.rejects(()=>requestRoute(new Request('https://signal.test/api/requests',{method:'POST',headers:{Origin:'https://signal.test','Content-Type':'application/json'},body:JSON.stringify({url:videoId,requestId:crypto.randomUUID()})}),env),e=>e.status===428);
});

test('only the requesting browser can remove a waiting song and recover its hourly slot',async()=>{
 const storage=new Storage(),q=new RequestQueue(storage),body=add();
 const before=await call(q,body),id=before.items[0].id;
 assert.equal(before.items[0].canRemove,true);assert.equal(before.requester.remaining,5);
 assert.equal((await call(q,{action:'remove',client:'someone-else',id})).status,403);
 assert.equal((await call(q,{action:'remove',id})).status,403);
 assert.equal((await call(q)).items[0].canRemove,false);
 const removed=await call(q,{action:'remove',client:'one',id});
 assert.equal(removed.items.length,0);assert.equal(removed.requester.used,0);assert.equal(removed.requester.remaining,6);assert.equal(removed.requester.nextResetAt,null);
 assert.equal((await call(q,{action:'remove',client:'one',id})).status,409);
 const retried=await call(q,body);assert.equal(retried.items.length,0);assert.equal(retried.requester.remaining,6);
 assert.equal((await call(q,add())).status,200);
});
test('removal cannot refund a playing song and old receipt migration refunds exactly once',async()=>{
 const storage=new Storage(),q=new RequestQueue(storage);
 const added=await call(q,add());const playing=await call(q,{action:'claim',session});
 assert.equal((await call(q,{action:'remove',client:'one',id:playing.current.id})).status,409);
 assert.equal(playing.current.canRemove,false);
 const second=await call(q,add('aaaaaaaaaaa'));const id=second.items[0].id;
 const state=await storage.get('music');for(const receipt of state.recent)delete receipt.itemId;await storage.put('music',state);
 const removed=await call(q,{action:'remove',client:'one',id});assert.equal(removed.requester.used,1);assert.equal(removed.current.id,added.items[0].id);
});
test('removing after expiry grants no extra quota, and concurrent removal never double refunds',async()=>{
 const storage=new Storage(),q=new RequestQueue(storage);const added=await call(q,add());
 const state=await storage.get('music');state.recent[0].at=Date.now()-3600001;await storage.put('music',state);
 const results=await Promise.all([1,2].map(()=>call(q,{action:'remove',client:'one',id:added.items[0].id})));
 assert.deepEqual(results.map(r=>r.status),[200,409]);assert.equal(results[0].requester.remaining,6);
});

test('only the active Board reports bounded radio metadata, hidden during requests and after release',async()=>{
 const q=new RequestQueue(new Storage());await call(q,{action:'claim',session});
 const radio={station:'river',title:'Artist — Song',artist:'Artist',song:'Song',playing:true};
 assert.equal((await call(q,{action:'heartbeat',session:'other-board-session',radio})).status,409);
 const live=await call(q,{action:'heartbeat',session,radio});assert.equal(live.radio.name,'92.5 The River');assert.equal(live.radio.song,'Song');
 await call(q,add());const playing=await call(q,{action:'next',session,id:null});assert.equal(playing.radio,null);
 await call(q,{action:'next',session,id:playing.current.id});
 assert.equal((await call(q,{action:'heartbeat',session,radio:{...radio,title:'x'.repeat(500)}})).radio.title.length,200);
 assert.equal((await call(q,{action:'heartbeat',session,radio:{station:'invalid'}})).radio,null);
 await call(q,{action:'heartbeat',session,radio});assert.equal((await call(q,{action:'release',session})).radio,null);
});

test('radio controls target the current Board, persist settings and preserve queued playback',async()=>{
 const storage=new Storage(),q=new RequestQueue(storage);
 await call(q,add());await call(q,add('aaaaaaaaaaa','two'));
 let data=await call(q,{action:'claim',session});const target=data.playerRevision;
 const remote=fields=>call(q,{action:'remote',playerRevision:target,...fields});
 const original={current:data.current,items:data.items};
 assert.equal((await remote({command:'station',station:'https://evil.test'})).status,400);
 assert.equal((await remote({command:'station',station:'wror',playerRevision:target-1})).status,409);
 data=await remote({command:'station',station:'wror'});
 assert.deepEqual({current:data.current,items:data.items},original);
 assert.equal(data.radioSettings.station,'wror');
 data=await call(q,{action:'heartbeat',session,station:'river',radioSettingsRevision:0});
 assert.equal(data.radioSettings.station,'wror','Unacknowledged old selection cannot overwrite a command');
 data=await call(q,{action:'heartbeat',session,station:'wror',radioSettingsRevision:1});
 assert.equal(data.radioSettings.station,'wror');
 for(const value of [0,1.1,null,'0.5'])assert.equal((await remote({command:'radioLevel',radioLevel:value})).status,400);
 data=await remote({command:'radioLevel',radioLevel:.5});assert.equal(data.radioSettings.level,.5);
 assert.equal(data.current.id,original.current.id);assert.deepEqual(data.items,original.items);
 assert.deepEqual((await call(new RequestQueue(storage))).radioSettings,data.radioSettings,'Settings survive storage reload');
 const replacement='new-board-session-123456';
 data=await call(q,{action:'takeover',session:replacement});assert.notEqual(data.playerRevision,target);
 assert.equal((await remote({command:'station',station:'hjy'})).status,409,'Old portal cannot target a replacement Board');
 assert.equal((await call(q,{action:'heartbeat',session,station:'hjy',radioSettingsRevision:2})).status,409);
 const newTarget=data.playerRevision;
 await call(q,{action:'next',session:replacement,id:data.current.id});data=await call(q);await call(q,{action:'next',session:replacement,id:data.current.id});
 data=await call(q,{action:'remote',command:'station',station:'hjy',playerRevision:newTarget});assert.equal(data.status,200);assert.equal(data.current,null);
 assert.equal(data.radioSettings.level,.5);
 assert.equal(JSON.stringify(data).includes(replacement),false,'Public targeting revision does not expose ownership secret');
 await call(q,{action:'release',session:replacement});assert.equal((await call(q,{action:'remote',command:'station',station:'river',playerRevision:newTarget})).status,409);
});

test('request HTTP routes forward radio settings and acknowledgments with existing origin protection',async()=>{
 const q=new RequestQueue(new Storage());const env={STATUS_HUB:{idFromName:()=>1,get:()=>({fetch:(url,options)=>q.handle(new Request(url,options))})}};
 const post=(path,body,origin='https://board.test')=>requestRoute(new Request('https://board.test/api/requests/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 let response=await post('control',{action:'claim',session});let data=await response.json();
 response=await post('remote',{command:'station',station:'wror',playerRevision:data.playerRevision});data=await response.json();assert.equal(data.radioSettings.station,'wror');
 response=await post('control',{action:'heartbeat',session,station:'hjy',radioSettingsRevision:data.radioSettings.revision});data=await response.json();assert.equal(data.radioSettings.station,'hjy','Board-local selection propagates after ack');
 response=await post('remote',{command:'radioLevel',radioLevel:.4,playerRevision:data.playerRevision});assert.equal((await response.json()).radioSettings.level,.4);
 await assert.rejects(post('remote',{command:'station',station:'river',playerRevision:data.playerRevision},'https://other.test'),/Same-origin/);
});
