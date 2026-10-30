import {addRequestQR} from './request-qr.js';
import {createAudioFades} from './audio-fades.js';
import {requestAPI} from './request-api.js';
import {STATIONS} from './stations.js';
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
export function initRequestRadio({container,audio,onState,startFallback,stopFallback,getRadio,onVolume=()=>{},onStation=()=>{}}){
 const panel=node('section','','request-panel');panel.hidden=true;panel.setAttribute('aria-label','YouTube request player');
 const media=node('div','','request-video');
 panel.append(media);container.prepend(panel);addRequestQR(container);
 let lastData={items:[],current:null},readyTimer,revision=0,appliedTransport=0,appliedRewind=0,appliedVolume=0,appliedRadioSettings=-1,appliedRemoteStation=-1;
 let selected=false,active=false,starting=false,player=null,ready=false,current=null,session=null,timer=null,generation=0,busy=false,loadedId=null,fallback=false;
 const fades=createAudioFades(audio,()=>ready?player:null);let transitioning=false;
 function status(text){onState(text,active);}
 function paint(data){lastData=data;}
 function setVolume(value){
  fades.volumeTo(value);
  // YouTube's mute flag is independent of setVolume. An explicit Board/remote
  // volume change also restores sound after the iframe was muted.
  if(ready&&fades.volume>0)player.unMute?.();
  onVolume(fades.volume);
 }
 const control=(action,id)=>requestAPI('/control',{action,session,id,station:getRadio?.().station,radioSettingsRevision:Math.max(0,appliedRadioSettings),radio:action==='heartbeat'&&fallback?getRadio?.():null,playback:action==='heartbeat'&&ready?{position:player.getCurrentTime?.()||0,duration:player.getDuration?.()||0,paused:player.getPlayerState?.()!==1,volume:fades.volume}:undefined});
 function sync(data){
  paint(data);current=data.current;
  if(data.radioSettings&&data.radioSettings.revision!==appliedRadioSettings){
   appliedRadioSettings=data.radioSettings.revision;fades.radioLevelTo(data.radioSettings.level);
   const stationRevision=data.radioSettings.stationRevision||0;
   if(stationRevision!==appliedRemoteStation){
    appliedRemoteStation=stationRevision;
    if(STATIONS.some(s=>s.id===data.radioSettings.station)&&getRadio?.().station!==data.radioSettings.station)onStation(data.radioSettings.station);
   }
  }
  if(data.remoteVolume&&data.remoteVolume.revision!==appliedVolume){appliedVolume=data.remoteVolume.revision;setVolume(data.remoteVolume.value);}
  if(transitioning)return;
  if(!current){
   loadedId=null;if(fallback)return;
   transitioning=true;
   const toRadio=()=>{player?.stopVideo?.();panel.hidden=true;fallback=true;fades.set('radio',0);transitioning=false;startFallback();sync(lastData);};
   if(ready&&player.getPlayerState?.()===1)fades.fade('youtube',0,650,toRadio);else toRadio();
   return;
  }
  if(fallback){transitioning=true;fades.fade('radio',0,650,()=>{fallback=false;stopFallback();fades.set('youtube',0);transitioning=false;sync(lastData);});return;}
  panel.hidden=false;
  if(ready&&loadedId!==current.id){
   loadedId=current.id;appliedTransport=0;appliedRewind=0;status(current.title);
   fades.set('youtube',0);
   // Clear a previous video's independent mute only while output is zero.
   // Browser autoplay policy still applies and reports through onAutoplayBlocked.
   if(fades.volume>0)player.unMute?.();
   player.loadVideoById(current.videoId);
  }
  if(ready&&data.transport&&data.transport.revision!==appliedTransport){
   const t=data.transport;appliedTransport=t.revision;
   if(t.rewind!==appliedRewind){player.seekTo(0,true);appliedRewind=t.rewind;}
   if(t.paused)player.pauseVideo();else player.playVideo();
  }
 }
 async function advance(reason){
  if(!active||busy)return;busy=true;revision++;const version=generation,id=current?.id||null;
  try{const data=await control('next',id);if(version===generation&&active){sync(data);if(reason)status(`${reason} ${data.current?'Trying the next request.':'Waiting for another request.'}`);}}
  catch(error){if(version===generation){await stop();status(error.message);}}finally{busy=false;}
 }
 async function heartbeat(){
  if(!active||busy)return;const version=generation,observedRevision=revision;
  try{const data=await control('heartbeat',current?.id||null);if(version!==generation||!active||observedRevision!==revision)return;sync(data);if(!data.current&&data.items.length)await advance();}
  catch(error){if(version===generation){await stop();status(`Playback stopped: ${error.message}`);}}
 }
 async function stop(){
  transitioning=false;
  if(fallback){fallback=false;stopFallback();}
  const oldSession=session;active=false;starting=false;generation++;clearInterval(timer);clearTimeout(readyTimer);timer=null;ready=false;loadedId=null;current=null;session=null;busy=false;
  player?.destroy?.();player=null;fades.reset();media.replaceChildren();panel.hidden=true;container.dataset.playing='false';status('Playback stopped');
  if(oldSession)try{await requestAPI('/control',{action:'release',session:oldSession});}catch{}
 }
 async function begin(takeover=false){
  if(!selected||active||starting)return;
  starting=true;const version=++generation;status('Connecting to YouTube…');
  try{
   const YT=await loadYouTube();if(version!==generation||!selected)return;
   session=crypto.randomUUID();const claimSession=session;const data=await control(takeover?'takeover':'claim');if(version!==generation||!selected){try{await requestAPI('/control',{action:'release',session:claimSession});}catch{}return;}
   active=true;starting=false;panel.hidden=false;paint(data);current=data.current;const mount=node('div');media.replaceChildren(mount);
   player=new YT.Player(mount,{width:'100%',height:'200',playerVars:{playsinline:1,origin:location.origin,autoplay:0,controls:1},events:{
    onReady:event=>{if(version!==generation)return;ready=true;clearTimeout(readyTimer);fades.set('youtube',0);sync(lastData);},
    onStateChange:event=>{
     // Ignore callbacks from an outgoing or replaced video. In particular, a
     // late PLAYING must not reverse the outgoing fade or revive its output.
     if(!active||version!==generation||fallback||transitioning||!current||loadedId!==current.id||player.getVideoData?.().video_id!==current.videoId)return;
     if(event.data===1){
      // Reapply composed output even after a completed ramp: the iframe may
      // have restored a different volume while loading, buffering or resuming.
      fades.refresh();
      if(fades.youtubeGain<1&&!fades.fadingYoutube)fades.fade('youtube',1,1100);
      status(current.title);container.dataset.playing='true';
     }
     if(event.data===3||event.data===2)fades.holdYoutube();
     if(event.data===2){status('Paused · use the YouTube play button to resume');container.dataset.playing='false';}
     if(event.data===0)void advance();
    },
    onAutoplayBlocked:()=>{if(version===generation&&!fallback)status('Press Play in the YouTube player to allow playback.');},
    onError:event=>{if(!active||version!==generation||fallback||transitioning||!current||loadedId!==current.id)return;if([2,5,100,101,150].includes(event.data))void advance('That video cannot play here.');else{void stop().then(()=>status('YouTube playback is unavailable. Check the connection and press Play to retry.'));}}
   }});
   readyTimer=setTimeout(()=>{if(version===generation&&!ready)void stop().then(()=>status('YouTube player did not start. Press Play to retry.'));},15000);
   timer=setInterval(()=>void heartbeat(),5000);status(current?.title||'Waiting for requests…');
  }catch(error){if(version===generation){await stop();status(error.message);}}
  finally{if(version===generation){starting=false;}}
 }

 // Moving an iframe between the dashboard and Board reloads it. Stop before that move.
 document.addEventListener('request-radio-layout',()=>{if(active||starting)void stop();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))void stop();});
 return {radioConnecting(){if(fallback&&!transitioning)fades.set('radio',0);},radioPlaying(){if(fallback&&!transitioning)fades.fade('radio',1,1100);},setDuckGain(value){fades.duckTo(value);},setVolume,changeStation(){if(fallback&&!transitioning){stopFallback();startFallback();}},setLevelGain(value){fades.levelTo(value);},get levelingState(){return {playing:active&&ready&&!fallback&&!transitioning&&player?.getPlayerState?.()===1&&fades.youtubeGain===1,volume:fades.volume,track:current?.id||null};},get requestPlaying(){return active&&!!current&&!fallback;},get fallbackActive(){return fallback;},get active(){return active||starting;},select(value){selected=value;panel.hidden=true;container.classList.toggle('request-mode',value);if(!value)void stop();else{status('Press Play to start radio and song requests.');void requestAPI().then(paint).catch(error=>{if(selected)status(error.message);});}},takeover(){if(!active&&!starting)void begin(true);},toggle(){if(active||starting)void stop();else void begin();}};
}
