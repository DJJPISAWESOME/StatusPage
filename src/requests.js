import { HttpError, json, upstream, readLimited, equalSecret } from './security.js';
import { cachedJSON } from './weather.js';

export function youtubeId(input){
  const raw=String(input||'').trim();if(/^[\w-]{11}$/.test(raw))return raw;
  let url;try{url=new URL(raw);}catch{throw new HttpError(400,'Enter a YouTube or YouTube Music video link.');}
  if(url.protocol!=='https:'||url.username||url.password)throw new HttpError(400,'Use an HTTPS YouTube link.');
  let id;if(url.hostname==='youtu.be')id=url.pathname.slice(1);
  else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname))id=url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)$/)?.[1];
  if(!/^[\w-]{11}$/.test(id||''))throw new HttpError(400,'Use a single video link, not a playlist or channel.');return id;
}
export async function videoDetails(id,fetcher=fetch,cache=globalThis.caches?.default){
  return cachedJSON(`request-video-v1/${id}`,3600,async()=>{
    let data;try{data=JSON.parse(await upstream(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,{fetcher,limit:32768}));}catch{throw new HttpError(422,'This video is unavailable or cannot be embedded. Try another version.');}
    if(typeof data.title!=='string')throw new HttpError(422,'Video information is unavailable.');
    return {videoId:id,title:data.title.slice(0,200),artist:String(data.author_name||'YouTube').slice(0,120)};
  },cache);
}
export async function searchYoutube(query,key,fetcher=fetch,cache=globalThis.caches?.default){
  if(!key)throw new HttpError(503,'YouTube search is not configured yet. You can still paste a video link.');
  const q=String(query||'').trim();if(q.length<2||q.length>100)throw new HttpError(400,'Search using 2–100 characters.');
  return cachedJSON(`request-search-v1/${encodeURIComponent(q.toLowerCase())}`,600,async()=>{
    const params=new URLSearchParams({part:'snippet',type:'video',videoEmbeddable:'true',videoSyndicated:'true',safeSearch:'strict',maxResults:'8',q,key});
    let data;try{data=JSON.parse(await upstream(`https://www.googleapis.com/youtube/v3/search?${params}`,{fetcher}));}catch{throw new HttpError(503,'YouTube search is unavailable or its quota was reached. Try a video link instead.');}
    if(!Array.isArray(data.items))throw new HttpError(503,'YouTube search is unavailable.');
    return {results:data.items.filter(i=>/^[\w-]{11}$/.test(i.id?.videoId||'')).map(i=>({videoId:i.id.videoId,title:String(i.snippet?.title||'YouTube video').slice(0,200),artist:String(i.snippet?.channelTitle||'YouTube').slice(0,120)}))};
  },cache);
}
export async function requestRoute(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(!['/api/requests','/api/requests/search','/api/requests/control'].includes(path))throw new HttpError(404,'Not found');
  if(request.method==='GET'&&path==='/api/requests/search')return json(await searchYoutube(url.searchParams.get('q'),env.YOUTUBE_API_KEY));
  const hub=env.STATUS_HUB.get(env.STATUS_HUB.idFromName('request-radio-v1'));
  if(request.method==='GET'&&path==='/api/requests'){
    const response=await hub.fetch('https://hub/requests');const data=await response.json();return json({...data,searchEnabled:!!env.YOUTUBE_API_KEY,playerEnabled:typeof env.REQUEST_PLAYER_TOKEN==='string'&&env.REQUEST_PLAYER_TOKEN.length>=32&&env.REQUEST_PLAYER_TOKEN.length<=256});
  }
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed');
  if(request.headers.get('Origin')!==url.origin)throw new HttpError(403,'Same-origin request required');
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'JSON required');
  let body;try{body=JSON.parse(await readLimited(request,4096));}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid JSON');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Invalid request');
  if(path==='/api/requests/control'){
    if(typeof env.REQUEST_PLAYER_TOKEN!=='string'||env.REQUEST_PLAYER_TOKEN.length<32||env.REQUEST_PLAYER_TOKEN.length>256)throw new HttpError(503,'Set REQUEST_PLAYER_TOKEN on the Worker before starting Request mode.');
    if(!await equalSecret(request.headers.get('Authorization')?.replace(/^Bearer /,''),env.REQUEST_PLAYER_TOKEN))throw new HttpError(401,'Incorrect player key.');
    return hub.fetch('https://hub/requests',{method:'POST',body:JSON.stringify({action:body.action,session:body.session,id:body.id})});
  }
  if(path!=='/api/requests')throw new HttpError(405,'Method not allowed');
  const video=await videoDetails(youtubeId(body.url));
  const ip=request.headers.get('CF-Connecting-IP')||'local';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
  const client=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  return hub.fetch('https://hub/requests',{method:'POST',body:JSON.stringify({action:'add',video,client,requestId:body.requestId})});
}

// Stored separately from service observations. Transactions serialize queue and lease changes.
export class RequestQueue{
  constructor(storage){this.storage=storage;}
  async handle(request){
    if(request.method==='GET')return json(this.public(await this.storage.get('music')||this.empty()));
    const body=await request.json();
    try{return await this.storage.transaction(async tx=>{
      const state=await tx.get('music')||this.empty(),now=Date.now();
      state.recent=state.recent.filter(r=>now-r.at<3600000);
      if(body.action==='add'){
        if(!/^[\w-]{16,80}$/.test(body.requestId||''))throw new HttpError(400,'Invalid request ID');
        if(state.recent.some(r=>r.id===body.requestId&&r.client===body.client))return json(this.public(state));
        if(state.items.some(v=>v.videoId===body.video.videoId)||state.current?.videoId===body.video.videoId)throw new HttpError(409,'That video is already playing or queued.');
        if(state.items.length>=50)throw new HttpError(409,'The queue is full. Please try again after a song plays.');
        if(state.recent.filter(r=>r.client===body.client&&now-r.at<60000).length>=3)throw new HttpError(429,'Please wait a minute before adding more songs.');
        state.items.push({...body.video,id:crypto.randomUUID(),addedAt:now});state.recent.push({id:body.requestId,client:body.client,at:now});state.recent=state.recent.slice(-1000);
      }else{
        if(!/^[\w-]{16,80}$/.test(body.session||''))throw new HttpError(400,'Invalid player session');
        if(!['claim','heartbeat','next','release'].includes(body.action))throw new HttpError(400,'Invalid player action');
        if(body.action==='claim'){
          if(state.leaseUntil>now&&state.owner!==body.session)throw new HttpError(409,'Another Board is playing this queue. Stop it first or wait one minute.');
          state.owner=body.session;
        }else if(state.owner!==body.session||state.leaseUntil<=now)throw new HttpError(409,'Player session expired. Press Play to reconnect.');
        if(body.action==='next'){
          // Compare-and-swap protects against duplicate end/error callbacks and retries.
          if((state.current?.id||null)===(body.id||null))state.current=state.items.shift()||null;
        }else if(body.action==='claim'&&!state.current)state.current=state.items.shift()||null;
        if(body.action==='release'){state.owner=null;state.leaseUntil=0;}else state.leaseUntil=now+45000;
      }
      await tx.put('music',state);return json(this.public(state));
    });}catch(error){if(error instanceof HttpError)return json({error:error.message},error.status);throw error;}
  }
  empty(){return {items:[],current:null,owner:null,leaseUntil:0,recent:[]};}
  public(state){return {current:state.current,items:state.items,playerOnline:state.leaseUntil>Date.now()};}
}
