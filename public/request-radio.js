import {requestAPI} from './request-api.js';
let youtubeReady;
function loadYouTube(){
 if(globalThis.YT?.Player)return Promise.resolve(globalThis.YT);
 if(youtubeReady)return youtubeReady;
 youtubeReady=new Promise((resolve,reject)=>{
  const script=document.createElement('script');const timer=setTimeout(()=>{script.remove();youtubeReady=null;reject(new Error('YouTube did not load. Check the connection and try again.'));},15000);
  globalThis.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve(globalThis.YT);};
  script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{clearTimeout(timer);script.remove();youtubeReady=null;reject(new Error('YouTube could not load.'));};document.head.append(script);
 });return youtubeReady;
}
const node=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text||'';if(cls)el.className=cls;return el;};
export function initRequestRadio({container,audio,onState}){
 const panel=node('section','','request-panel');panel.hidden=true;panel.setAttribute('aria-label','YouTube request player');
 const media=node('div','','request-video');
 const skip=node('button','Skip song');skip.type='button';skip.disabled=true;
 panel.append(media,skip);container.append(panel);
 let lastData={items:[],current:null},readyTimer,revision=0;
 let selected=false,active=false,starting=false,player=null,ready=false,current=null,session=null,timer=null,generation=0,busy=false,loadedId=null;
 function status(text){onState(text,active);}
 function paint(data){lastData=data;skip.disabled=!active||!data.current;}
 const control=(action,id)=>requestAPI('/control',{action,session,id});
 function sync(data){
  paint(data);current=data.current;
  if(!current){loadedId=null;player?.stopVideo?.();status('Waiting for requests…');return;}
  if(ready&&loadedId!==current.id){loadedId=current.id;status(current.title);player.loadVideoById(current.videoId);}
 }
 async function advance(reason){
  if(!active||busy)return;busy=true;revision++;const version=generation,id=current?.id||null;
  try{const data=await control('next',id);if(version===generation&&active){sync(data);if(reason)status(`${reason} ${data.current?'Trying the next request.':'Waiting for another request.'}`);}}
  catch(error){if(version===generation){await stop();status(error.message);}}finally{busy=false;}
 }
 async function heartbeat(){
  if(!active||busy)return;const version=generation,observedRevision=revision;
  try{const data=await control('heartbeat');if(version!==generation||!active||observedRevision!==revision)return;sync(data);if(!data.current&&data.items.length)await advance();}
  catch(error){if(version===generation){await stop();status(`Playback stopped: ${error.message}`);}}
 }
 async function stop(){
  const oldSession=session;active=false;starting=false;generation++;clearInterval(timer);clearTimeout(readyTimer);timer=null;ready=false;loadedId=null;current=null;session=null;busy=false;
  player?.destroy?.();player=null;media.replaceChildren();skip.disabled=true;panel.hidden=true;status('Request mode stopped');
  if(oldSession)try{await requestAPI('/control',{action:'release',session:oldSession});}catch{}
 }
 async function begin(){
  if(!selected||active||starting)return;
  starting=true;const version=++generation;status('Connecting to YouTube…');
  try{
   const YT=await loadYouTube();if(version!==generation||!selected)return;
   session=crypto.randomUUID();const claimSession=session;const data=await control('claim');if(version!==generation||!selected){try{await requestAPI('/control',{action:'release',session:claimSession});}catch{}return;}
   active=true;starting=false;panel.hidden=false;paint(data);current=data.current;const mount=node('div');media.replaceChildren(mount);
   player=new YT.Player(mount,{width:'100%',height:'200',playerVars:{playsinline:1,origin:location.origin,autoplay:0,controls:1},events:{
    onReady:event=>{if(version!==generation)return;ready=true;clearTimeout(readyTimer);event.target.setVolume(Math.round(audio.volume*100));sync(lastData);},
    onStateChange:event=>{if(!active||version!==generation)return;if(event.data===1){status(current?.title||'Playing requests');container.dataset.playing='true';}if(event.data===2){status('Paused · use the YouTube play button to resume');container.dataset.playing='false';}if(event.data===0&&loadedId&&player.getVideoData?.().video_id===current?.videoId)void advance();},
    onAutoplayBlocked:()=>{if(version===generation)status('Press Play in the YouTube player to allow playback.');},
    onError:event=>{if(!active||version!==generation)return;if([2,5,100,101,150].includes(event.data))void advance('That video cannot play here.');else{void stop().then(()=>status('YouTube playback is unavailable. Check the connection and press Play to retry.'));}}
   }});
   readyTimer=setTimeout(()=>{if(version===generation&&!ready)void stop().then(()=>status('YouTube player did not start. Press Play to retry.'));},15000);
   timer=setInterval(()=>void heartbeat(),10000);status(current?.title||'Waiting for requests…');
  }catch(error){if(version===generation){await stop();status(error.message);}}
  finally{if(version===generation){starting=false;}}
 }
 skip.onclick=()=>void advance();
 audio.addEventListener('volumechange',()=>{if(ready)player?.setVolume(Math.round(audio.volume*100));});
 // Moving an iframe between the dashboard and Board reloads it. Stop before that move.
 document.addEventListener('request-radio-layout',()=>{if(active||starting)void stop();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))void stop();});
 return {get active(){return active||starting;},select(value){selected=value;panel.hidden=true;container.classList.toggle('request-mode',value);if(!value)void stop();else{status('Press Play to start requests.');void requestAPI().then(paint).catch(error=>{if(selected)status(error.message);});}},toggle(){if(active||starting)void stop();else void begin();}};
}
