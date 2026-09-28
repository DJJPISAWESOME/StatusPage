import { HttpError, json, upstream, readLimited } from './security.js';
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
// Read public search-page data as JSON only; never execute upstream scripts.
export function parseYoutubeSearch(html){
  const match=/(?:var\s+ytInitialData|window\["ytInitialData"\]|ytInitialData)\s*=\s*(\{)/.exec(html);
  if(!match)throw new Error('Search data unavailable');
  const start=match.index+match[0].length-1;let depth=0,quoted=false,escaped=false,end=-1;
  for(let i=start;i<html.length;i++){
    const char=html[i];
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}
    else if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&!--depth){end=i+1;break;}
  }
  if(end<0)throw new Error('Incomplete search data');
  const data=JSON.parse(html.slice(start,end));
  const root=data.contents?.twoColumnSearchResultsRenderer?.primaryContents||data.contents?.sectionListRenderer;
  if(!root)throw new Error('Search layout unavailable');
  const text=value=>value?.simpleText||value?.runs?.map(r=>r.text||'').join('')||value?.content||'';
  const results=[],seen=new Set(),stack=[root];let inspected=0;
  const add=(videoId,title,artist)=>{if(/^[\w-]{11}$/.test(videoId||'')&&title&&!seen.has(videoId)){seen.add(videoId);results.push({videoId,title:String(title).slice(0,200),artist:String(artist||'YouTube').slice(0,120)});}};
  while(stack.length&&results.length<8&&inspected++<30000){
    const value=stack.pop();if(!value||typeof value!=='object')continue;
    if(value.videoRenderer){const v=value.videoRenderer;add(v.videoId,text(v.title),text(v.ownerText||v.longBylineText||v.shortBylineText));continue;}
    if(value.lockupViewModel){const v=value.lockupViewModel,m=v.metadata?.lockupMetadataViewModel;if(v.contentType==='LOCKUP_CONTENT_TYPE_VIDEO')add(v.contentId,text(m?.title),text(m?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text));continue;}
    if(value.adSlotRenderer||value.promotedSparklesWebRenderer||value.promotedVideoRenderer)continue;
    stack.push(...(Array.isArray(value)?value:Object.values(value)).reverse());
  }
  return {results};
}
export async function searchYoutube(query,fetcher=fetch,cache=globalThis.caches?.default){
  const q=String(query||'').trim();if(q.length<2||q.length>100)throw new HttpError(400,'Search using 2–100 characters.');
  return cachedJSON(`request-public-search-v1/${encodeURIComponent(q.toLowerCase())}`,600,async()=>{
    const params=new URLSearchParams({search_query:q,hl:'en',gl:'US'});
    try{return parseYoutubeSearch(await upstream(`https://www.youtube.com/results?${params}`,{fetcher,accept:'text/html',limit:3*1024*1024,headers:{'Accept-Language':'en-US,en;q=0.9'}}));}
    catch{throw new HttpError(503,'YouTube search is temporarily unavailable. Open Search on YouTube, then paste a video link here.');}
  },cache);
}
const REQUESTER_COOKIE = '__Host-signal-requester';
const HOUR = 60 * 60 * 1000;
export function requesterCookie(request){
  return request.headers.get('Cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${REQUESTER_COOKIE}=`))?.slice(REQUESTER_COOKIE.length+1).match(/^[a-f0-9-]{36}$/i)?.[0] || null;
}
function requesterQuota(state,client,now=Date.now()){
  const recent=state.recent.filter(r=>r.client===client&&!r.refunded&&now-r.at<HOUR);
  const tail=[state.current,...state.items].filter(Boolean).slice(-2);
  let consecutive=0;for(const item of tail.reverse()){if(item.requester!==client)break;consecutive++;}
  return {used:recent.length,remaining:Math.max(0,5-recent.length),limit:5,consecutive,consecutiveLimit:2,nextResetAt:recent.length?Math.min(...recent.map(r=>r.at))+HOUR:null,serverTime:now};
}
export async function requestRoute(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(!['/api/requests','/api/requests/search','/api/requests/control','/api/requests/remote','/api/requests/remove'].includes(path))throw new HttpError(404,'Not found');
  if(request.method==='GET'&&path==='/api/requests/search')return json(await searchYoutube(url.searchParams.get('q')));
  const hub=env.STATUS_HUB.get(env.STATUS_HUB.idFromName('request-radio-v1'));
  if(request.method==='GET'&&path==='/api/requests'){
    const existing=requesterCookie(request),client=existing||crypto.randomUUID();
    const response=await hub.fetch(`https://hub/requests?client=${encodeURIComponent(client)}`);const data=await response.json();return json({...data,searchEnabled:true,playerEnabled:true},response.status,existing?{}:{'Set-Cookie':`${REQUESTER_COOKIE}=${client}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`});
  }
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed');
  if(request.headers.get('Origin')!==url.origin)throw new HttpError(403,'Same-origin request required');
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'JSON required');
  let body;try{body=JSON.parse(await readLimited(request,4096));}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid JSON');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Invalid request');
  if(path==='/api/requests/remove'){
    const client=requesterCookie(request);if(!client)throw new HttpError(428,'Reload the request page and allow cookies to manage your songs.');
    return hub.fetch('https://hub/requests',{method:'POST',body:JSON.stringify({action:'remove',client,id:body.id})});
  }
  if(path==='/api/requests/remote'){
    return hub.fetch('https://hub/requests',{method:'POST',body:JSON.stringify({action:'remote',client:requesterCookie(request),command:body.command,id:body.id,volume:body.volume})});
  }
  if(path==='/api/requests/control'){
    return hub.fetch('https://hub/requests',{method:'POST',body:JSON.stringify({action:body.action,session:body.session,id:body.id,playback:body.playback})});
  }
  if(path!=='/api/requests')throw new HttpError(405,'Method not allowed');
  const client=requesterCookie(request);
  if(!client)throw new HttpError(428,'Reload the request page and allow cookies to submit songs.');
  const video=await videoDetails(youtubeId(body.url));
  return hub.fetch('https://hub/requests',{method:'POST',body:JSON.stringify({action:'add',video,client,requestId:body.requestId})});
}

// Stored separately from service observations. Transactions serialize queue and lease changes.
export class RequestQueue{
  constructor(storage){this.storage=storage;}
  async handle(request){
    if(request.method==='GET')return json(this.public(await this.storage.get('music')||this.empty(),new URL(request.url).searchParams.get('client')));
    const body=await request.json();
    try{return await this.storage.transaction(async tx=>{
      const state=await tx.get('music')||this.empty(),now=Date.now();
      state.recent=state.recent.filter(r=>now-r.at<3600000);
      if(body.action==='add'){
        if(!/^[\w-]{16,80}$/.test(body.requestId||''))throw new HttpError(400,'Invalid request ID');
        if(state.recent.some(r=>r.id===body.requestId&&r.client===body.client))return json(this.public(state,body.client));
        if(state.items.some(v=>v.videoId===body.video.videoId)||state.current?.videoId===body.video.videoId)throw new HttpError(409,'That video is already playing or queued.');
        if(state.items.length>=30)throw new HttpError(409,'The queue has reached 30 songs. Please try again after a song plays.');
        const quota=requesterQuota(state,body.client,now);
        if(quota.remaining===0)throw new HttpError(429,`You have used all 5 requests this hour. Your next slot opens in ${Math.max(1,Math.ceil((quota.nextResetAt-now)/60000))} minute(s).`);
        if(quota.consecutive>=2)throw new HttpError(429,'You already have 2 songs in a row. Let someone else request a song, or wait for your songs to play.');
        const itemId=crypto.randomUUID();state.items.push({...body.video,id:itemId,addedAt:now,requester:body.client});state.recent.push({id:body.requestId,itemId,client:body.client,at:now});
      }else if(body.action==='remove'){
        if(typeof body.id!=='string'||!body.id)throw new HttpError(400,'Choose a queued song to remove.');
        const index=state.items.findIndex(item=>item.id===body.id);
        if(index<0)throw new HttpError(409,'That song has already started playing or is no longer queued.');
        const item=state.items[index];
        if(!body.client||item.requester!==body.client)throw new HttpError(403,'You can only remove songs requested from this browser.');
        state.items.splice(index,1);
        // Keep the receipt so retrying the original add cannot resurrect a removed song.
        // Timestamp matching supports songs queued before item IDs were added to receipts.
        const receipt=state.recent.find(r=>!r.refunded&&r.client===body.client&&(r.itemId===item.id||(!r.itemId&&r.at===item.addedAt)));
        if(receipt)receipt.refunded=true;
      }else if(body.action==='remote'){
        if(!['pause','resume','rewind','skip','volume'].includes(body.command))throw new HttpError(400,'Invalid playback command');
        if(state.leaseUntil<=now||(!state.current&&body.command!=='volume'))throw new HttpError(409,'Board playback is offline or idle.');
        if(body.command!=='volume'&&body.id!==state.current.id)throw new HttpError(409,'The song changed. Please try again.');
        if(body.command==='volume'){
          if(!Number.isFinite(body.volume)||body.volume<0||body.volume>1)throw new HttpError(400,'Volume must be between 0 and 1');
          state.remoteVolume={value:body.volume,revision:(state.remoteVolume?.revision||0)+1};
        }else if(body.command==='skip'){state.current=state.items.shift()||null;state.transport=null;state.playback=null;}
        else{
          const previous=state.transport||{revision:0,paused:false,rewind:0};
          state.transport={revision:previous.revision+1,paused:body.command==='pause'?true:body.command==='resume'?false:previous.paused,rewind:previous.rewind+(body.command==='rewind'?1:0)};
        }
      }else{
        if(!/^[\w-]{16,80}$/.test(body.session||''))throw new HttpError(400,'Invalid player session');
        if(!['claim','takeover','heartbeat','next','release'].includes(body.action))throw new HttpError(400,'Invalid player action');
        if(body.action==='claim'||body.action==='takeover'){
          if(body.action!=='takeover'&&state.leaseUntil>now&&state.owner!==body.session)throw new HttpError(409,'Another Board is playing this queue. Stop it first or wait one minute.');
          state.owner=body.session;
        }else if(state.owner!==body.session||state.leaseUntil<=now)throw new HttpError(409,'Player session expired. Press Play to reconnect.');
        if(body.action==='next'){
          // Compare-and-swap protects against duplicate end/error callbacks and retries.
          if((state.current?.id||null)===(body.id||null)){state.current=state.items.shift()||null;state.transport=null;state.playback=null;}
        }else if(['claim','takeover'].includes(body.action)&&!state.current)state.current=state.items.shift()||null;
        if(body.action==='heartbeat'&&body.id===state.current?.id&&body.playback){
          const p=body.playback;
          if(Number.isFinite(p.position)&&Number.isFinite(p.duration)&&p.position>=0&&p.duration>=0&&p.duration<=604800){
            state.playback={position:Math.min(p.position,p.duration),duration:p.duration,paused:p.paused===true,volume:Number.isFinite(p.volume)?Math.max(0,Math.min(1,p.volume)):null,at:now};
          }
        }
        if(body.action==='release'){state.owner=null;state.leaseUntil=0;}else state.leaseUntil=now+45000;
      }
      await tx.put('music',state);return json(this.public(state,body.client));
    });}catch(error){if(error instanceof HttpError)return json({error:error.message},error.status);throw error;}
  }
  empty(){return {items:[],current:null,owner:null,leaseUntil:0,recent:[]};}
  public(state,client){const visible=item=>{if(!item)return null;const {requester,...song}=item;return {...song,canRemove:!!client&&requester===client&&item!==state.current};};return {queueLimit:30,...(client?{requester:requesterQuota(state,client)}:{}),current:visible(state.current),items:state.items.map(visible),playerOnline:state.leaseUntil>Date.now(),remoteVolume:state.remoteVolume||null,transport:state.transport||null,playback:state.playback||null};}
}
