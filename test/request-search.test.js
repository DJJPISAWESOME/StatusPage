import test from 'node:test';
import assert from 'node:assert/strict';
import {searchYoutube,requestRoute} from '../src/requests.js';

const item=(videoId='aaaaaaaaaaa',title='A song')=>({id:{videoId},snippet:{title,channelTitle:'An artist'}});
test('configured search uses the official embeddable-video API and keeps credentials out of URLs',async()=>{
 let calls=0;
 const result=await searchYoutube('  Rock & roll  ',async(url,options)=>{
  calls++;const u=new URL(url);assert.equal(u.origin,'https://www.googleapis.com');assert.equal(u.pathname,'/youtube/v3/search');
  assert.equal(u.searchParams.get('q'),'Rock & roll');assert.equal(u.searchParams.get('part'),'snippet');assert.equal(u.searchParams.get('type'),'video');assert.equal(u.searchParams.get('videoEmbeddable'),'true');assert.equal(u.searchParams.get('videoSyndicated'),'true');assert.equal(u.searchParams.get('maxResults'),'8');
  assert.equal(u.searchParams.has('key'),false);assert.equal(options.headers['X-Goog-Api-Key'],'test-private-key');assert.equal(options.redirect,'manual');
  return Response.json({items:[item(),item(),{id:{playlistId:'playlist'}},item('bad'),item('bbbbbbbbbbb','<img src=x>')]});
 },null,'test-private-key');
 assert.equal(calls,1);assert.deepEqual(result.results,[{videoId:'aaaaaaaaaaa',title:'A song',artist:'An artist'},{videoId:'bbbbbbbbbbb',title:'<img src=x>',artist:'An artist'}]);assert.equal(JSON.stringify(result).includes('test-private-key'),false);
});
test('official search distinguishes empty results, bounds output, and rejects malformed responses',async()=>{
 assert.deepEqual((await searchYoutube('empty',async()=>Response.json({items:[]}),null,'key')).results,[]);
 const data=await searchYoutube('many',async()=>Response.json({items:Array.from({length:12},(_,i)=>item(String(i).padStart(11,'0'),'x'.repeat(300)))}),null,'key');assert.equal(data.results.length,8);assert.equal(data.results[0].title.length,200);
 for(const response of [{},{items:{}},null])await assert.rejects(()=>searchYoutube('broken',async()=>Response.json(response),null,'key'),e=>e.status===503);
});
test('upstream quota, authentication, redirects and network errors are safe failures with no fallback retries',async()=>{
 for(const status of [302,403,429,503]){
  let calls=0;await assert.rejects(()=>searchYoutube('song',async()=>{calls++;return new Response('private-provider-detail',{status,headers:{Location:'https://www.google.com/sorry/'}});},null,'test-private-key'),e=>e.status===503&&!e.message.includes('private'));assert.equal(calls,1);
 }
 await assert.rejects(()=>searchYoutube('song',async()=>{throw Error('secret-key-in-network-error');},null,'key'),e=>e.status===503&&!e.message.includes('secret'));
});
test('successful search is cached independently by provider without putting the key in cache identifiers',async()=>{
 const entries=new Map(),keys=[],cache={async match(r){return entries.get(r.url)?.clone();},async put(r,response){keys.push(r.url);entries.set(r.url,response.clone());}};let calls=0;
 const fetcher=async()=>{calls++;return Response.json({items:[item()]});};
 await searchYoutube('Song',fetcher,cache,'test-private-key');await searchYoutube('song',fetcher,cache,'test-private-key');assert.equal(calls,1);assert.ok(keys.every(key=>key.includes('request-data-search-v1/')&&!key.includes('private')));
 const html='<script>var ytInitialData = {"contents":{"sectionListRenderer":{"contents":[]}}};</script>';
 assert.deepEqual((await searchYoutube('song',async()=>new Response(html),cache)).results,[]);assert.ok(keys.some(key=>key.includes('request-public-search-v1/')));
});
test('failed search is not cached, and invalid queries never call a provider',async()=>{
 let calls=0,puts=0;const cache={async match(){},async put(){puts++;}},fetcher=async()=>{calls++;return new Response('',{status:403});};
 for(let i=0;i<2;i++)await assert.rejects(()=>searchYoutube('song',fetcher,cache,'key'),e=>e.status===503);
 assert.equal(calls,2);assert.equal(puts,0);
 for(const query of ['', 'x','x'.repeat(101)])await assert.rejects(()=>searchYoutube(query,fetcher,cache,'key'),e=>e.status===400);assert.equal(calls,2);
});
test('unconfigured public search rejects an automated-traffic redirect without following it',async()=>{
 let calls=0;await assert.rejects(()=>searchYoutube('Beatles',async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'www.youtube.com');assert.equal(options.headers['X-Goog-Api-Key'],undefined);assert.equal(options.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://www.google.com/sorry/'}});},null),e=>e.status===503);assert.equal(calls,1);
});
test('search route uses the Worker secret without touching queue storage or exposing it',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(options.headers['X-Goog-Api-Key'],'worker-secret');return Response.json({items:[item()]});});
 const response=await requestRoute(new Request('https://signal.test/api/requests/search?q=song'),{YOUTUBE_API_KEY:'worker-secret',STATUS_HUB:{get(){assert.fail('Search must not touch the queue');}}});
 assert.equal(response.status,200);const body=await response.text();assert.ok(body.includes('aaaaaaaaaaa'));assert.ok(!body.includes('worker-secret'));
});
