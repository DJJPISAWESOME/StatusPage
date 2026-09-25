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
 const skip=node('button','⏭','request-skip');skip.type='button';skip.disabled=true;skip.hidden=true;skip.setAttribute('aria-label','Skip song');skip.title='Skip song';
 panel.append(media);container.prepend(panel);container.querySelector('.radio-controls').append(skip);
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
 audio.addEventListener('volumechange',()=>{if(ready)player?.setVolume(Math.round(audio.volume*100…4929 tokens truncated…elay:-.7s}@keyframes tv-equalize{to{transform:scaleY(.3)}}
.tv-power-layout{display:grid;grid-template-columns:minmax(220px,.65fr) minmax(0,2fr);gap:22px;flex:1;min-height:0}.tv-power-details{padding:26px;background:#0a2236b3;display:flex;flex-direction:column;gap:20px;border-top:4px solid var(--tv-gold)}.tv-power-label{font-size:12px;color:var(--tv-gold);letter-spacing:.13em}.tv-power-count{font-size:clamp(30px,3.4vw,58px);line-height:1.15;letter-spacing:-.04em}.tv-power-region{font-size:clamp(20px,2vw,30px);color:var(--tv-muted)}.tv-power-details .tv-map-link{margin-top:auto;display:block;padding:14px 16px;border:1px solid #c7aa70;background:#31495a;font-size:18px;text-decoration:none;text-align:center;border-radius:5px}.tv-map-panel{display:flex;flex-direction:column;min-height:0;background:#0b263b;border:1px solid #587b98}.tv-map-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 16px;flex:none}.tv-map-toolbar strong{font-size:17px;font-weight:500}.tv-map-panel .tv-map{display:block;flex:1;min-height:250px;border:0;background:#e6edf3}.tv-map-help{font-size:13px;color:var(--tv-muted);padding:9px 14px;flex:none}
#tv-notifications{position:absolute;right:4vw;bottom:140px;z-index:10;width:min(480px,calc(100% - 32px));pointer-events:none}.tv-notice{position:relative;padding:20px 44px 20px 24px;background:#102d46f7;border:1px solid #83a9c5;border-left:5px solid var(--tv-gold);box-shadow:0 12px 40px #0006;border-radius:10px;pointer-events:auto;animation:tv-notice-in .5s cubic-bezier(.16,1,.3,1)}.tv-notice-kicker{font-size:11px;letter-spacing:.15em;color:var(--tv-gold)}.tv-notice-row{display:grid;gap:4px;margin-top:12px}.tv-notice-row strong{font-size:23px;overflow-wrap:anywhere}.tv-notice-row span,.tv-notice p{font-size:16px;color:var(--tv-muted)}.tv-notice p{margin-top:12px}.tv-notice-row.tv-outage span{color:#ffb6bc}.tv-notice-row.tv-operational span{color:#a0efc9}.tv-notice-row.tv-degraded span{color:var(--tv-gold)}.tv-notice .tv-notice-close{position:absolute;right:8px;top:8px;padding:2px 8px;border:0;background:none;font-size:24px}@keyframes tv-notice-in{from{transform:translateX(50px);opacity:0}to{transform:translateX(0);opacity:1}}
@media(max-width:1400px){.tv-header{gap:18px}.tv-header .tv-program>[data-tv-channel]{padding:10px}.tv-top-summary{padding-left:16px;font-size:12px}.tv-top-summary #tv-local-weather{font-size:17px}.tv-header #tv-clock{font-size:36px}.tv-header .tv-brand strong{font-size:36px}.board-mode #tv-radio-dock{padding-top:9px;padding-bottom:9px}.board-mode #tv-radio-dock .radio-bar{padding:10px 14px}.board-mode #tv-radio-dock .radio-art{height:52px;width:52px}.tv-power-details{padding:20px;gap:16px}}
@media(max-width:1100px){.tv-header{grid-template-columns:auto 1fr auto;gap:8px 18px}.tv-header .tv-brand{grid-column:1;grid-row:1}.tv-header #tv-clock{grid-column:3;grid-row:1}.tv-header .tv-program{grid-column:2;grid-row:1;flex-wrap:wrap}.tv-top-summary{grid-column:1/-1;grid-row:2;border:0;padding:0;display:flex;justify-content:center;gap:24px;align-items:center}.tv-header .tv-actions{grid-column:auto;grid-row:auto}.board-mode #tv-radio-dock .tv-equalizer{display:none}.board-mode #tv-radio-dock .radio-info{column-gap:16px}.tv-power-layout{grid-template-columns:240px minmax(0,1fr)}}
@media(max-width:699px){.tv-header{grid-template-columns:1fr auto;gap:7px}.tv-header .tv-brand{grid-column:1;grid-row:1}.tv-header .tv-brand strong{font-size:30px}.tv-header #tv-clock{grid-column:2;grid-row:1;font-size:32px}.tv-header .tv-program{grid-column:1/-1;grid-row:2;justify-content:center}.tv-header .tv-program>[data-tv-channel]{padding:4px 10px;font-size:12px}.tv-top-summary{grid-row:3;gap:12px;font-size:10px}.tv-top-summary #tv-local-weather{font-size:12px}.tv-header .tv-actions{right:16px;top:calc(100% + 6px)}.board-mode #tv-radio-dock{padding:8px 12px}.board-mode #tv-radio-dock .radio-bar{padding:10px;gap:12px}.board-mode #tv-radio-dock .radio-art{display:none}.board-mode #tv-radio-dock .radio-info{display:flex;gap:4px}.board-mode #tv-radio-dock .radio-info:after{display:none}.board-mode #tv-radio-dock #station,.board-mode #tv-radio-dock #radio-state{font-size:16px}.board-mode #tv-radio-dock .play-button{width:44px;height:44px}.tv-power-layout{display:flex;flex-direction:column;min-height:auto}.tv-power-details{padding:16px;gap:12px}.tv-power-count{font-size:32px}.tv-map-panel{min-height:350px;flex:none}.tv-map-panel .tv-map{min-height:300px}#tv-notifications{right:16px;bottom:125px}.tv-notice-row strong{font-size:20px}}
@media(prefers-reduced-motion:reduce){.tv-board *,.tv-board *:before{animation:none!important;transition:none!important}}

/* Warren local forecast: current-time cues and a fuller conditions desk. */
.tv-hour.tv-hour-now{background:linear-gradient(160deg,#466079,#173e5d);box-shadow:inset 0 4px var(--tv-gold),inset 0 0 0 2px #ffda8566}
.tv-hour .tv-hour-label{align-self:stretch;font-size:clamp(10px,.85vw,15px);font-weight:700;letter-spacing:.16em;color:#bed1e2;padding-top:12px}
.tv-hour-now .tv-hour-label{color:var(--tv-gold)}
.tv-model-chart .tv-now-marker line{stroke:#fff;stroke-width:2;stroke-dasharray:5 5}
.tv-model-chart .tv-now-marker circle{fill:var(--tv-gold);stroke:#102a40;stroke-width:2}
.tv-model-chart .tv-now-marker rect{fill:var(--tv-gold)}
.tv-model-chart .tv-now-marker text{fill:#102a40;font:bold 16px Arial,sans-serif}
.tv-current-stage{grid-template-columns:1fr 1.15fr;gap:24px;align-items:stretch;flex:1}
.tv-weather-now{background:linear-gradient(135deg,#3b607a99,#102a4088);border-top:3px solid var(--tv-gold);padding:clamp(18px,2vw,34px);gap:8px 18px;align-content:center;position:relative;overflow:hidden}
.tv-now-kicker{grid-column:1/-1;color:var(--tv-gold);letter-spacing:.16em;font-size:clamp(12px,1vw,17px);font-weight:700}
.tv-weather-now .tv-temperature{font-size:clamp(80px,9vw,170px)}
.tv-weather-now .tv-weather-symbol{width:clamp(90px,10vw,175px)}
.tv-weather-now h2{font-size:clamp(25px,2.3vw,42px)}
.tv-feels{grid-column:1/-1;color:var(--tv-muted);font-size:clamp(17px,1.5vw,26px)}
.tv-today-range{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #a1bed144;margin-top:14px;padding-top:12px;gap:18px}
.tv-today-range .tv-network-card{background:none;border:0;padding:0}
.tv-today-range .tv-network-card strong{font-size:clamp(25px,2.5vw,44px)}
.tv-current-metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.tv-current-metrics .tv-network-card{display:flex;flex-direction:column;justify-content:center;background:#091f3499;border:0;padding:clamp(12px,1.6vw,26px)}
.tv-current-metrics .tv-network-card span{font-size:clamp(12px,1.05vw,18px)}
.tv-current-metrics .tv-network-card strong{font-size:clamp(23px,2.1vw,38px)}
.tv-daylight{display:grid;grid-template-columns:1fr 1fr 2fr;gap:20px;flex:none;background:#102b42aa;border-left:3px solid var(--tv-gold);padding:14px 24px}
.tv-daylight .tv-network-card{padding:0;background:none;border:0}
.tv-daylight .tv-network-card strong{font-size:clamp(18px,1.6vw,28px)}
@media(min-width:700px) and (max-height:849px){.tv-weather-now{padding:14px 22px}.tv-weather-now .tv-temperature{font-size:88px}.tv-weather-now .tv-weather-symbol{width:100px}.tv-today-range{margin-top:4px;padding-top:6px}.tv-daylight{padding:8px 18px}.tv-current-metrics .tv-network-card{padding:12px}.tv-weather-now h2{font-size:28px}}
@media(max-width:900px){.tv-current-stage{grid-template-columns:1fr;flex:none;gap:12px}.tv-current-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.tv-weather-now .tv-weather-symbol{justify-self:end}.tv-daylight{gap:12px;padding:12px}.tv-daylight .tv-network-card span{font-size:11px}}
@media(max-width:480px){.tv-current-metrics{grid-template-columns:1fr 1fr}.tv-daylight{grid-template-columns:1fr 1fr}.tv-daylight>.tv-network-card:last-child{grid-column:1/-1}.tv-today-range .tv-network-card{padding:0}}

/* Idle navigation collapses so report cards can fill the freed space. */
.tv-weather-tabs,.tv-network-tabs{max-height:100px;min-height:0;overflow:hidden;transition:opacity .35s ease,max-height .35s ease,margin .35s ease,border-width .35s ease}
.tv-idle .tv-weather-tabs,.tv-idle .tv-network-tabs{opacity:0;pointer-events:none;max-height:0;border-top-width:0;margin-top:-14px}
.tv-idle .tv-model-chart{max-height:none}
.tv-report-paging button{transition:opacity .3s}.tv-idle .tv-report-paging button{visibility:hidden;pointer-events:none}
@media(min-width:700px) and (max-height:849px){.tv-idle .tv-weather-tabs{margin-top:-10px}}
@media(max-width:699px){.tv-idle .tv-weather-tabs{margin-top:-12px}}
.tv-board[data-conditions]{transition:background 1.4s ease;background:linear-gradient(120deg,#163d59,#386986)}
.tv-board[data-conditions=sunny]{background:radial-gradient(ellipse at 78% 20%,#997b48 0,transparent 48%),linear-gradient(125deg,#143957,#326385)}
.tv-board[data-conditions=night],.tv-board[data-conditions=night-cloudy]{background:linear-gradient(125deg,#070f29,#1e345b)}
.tv-board[data-conditions=cloudy],.tv-board[data-conditions=fog]{background:linear-gradient(125deg,#263e51,#516976)}
.tv-board[data-conditions=rain],.tv-board[data-conditions=storm]{background:linear-gradient(125deg,#122b42,#344b65)}
.tv-board[data-conditions=snow]{background:linear-gradient(125deg,#203d59,#526e85)}
.tv-weather-effects{position:fixed;inset:100px 0 100px;pointer-events:none;overflow:hidden;z-index:-1;opacity:.4}
.tv-weather-effects i{position:absolute;left:calc(var(--i)*6.7%);top:-15%;width:2px;height:60px;background:#c5e5ff;opacity:0;animation:tv-weather-fall 1.4s linear infinite;animation-delay:calc(var(--i)*-.23s)}
.tv-weather-effects i:nth-child(3n){animation-duration:1.8s}
.tv-board[data-conditions=rain] .tv-weather-effects i,.tv-board[data-conditions=storm] .tv-weather-effects i{opacity:.4;transform:rotate(14deg)}
.tv-board[data-conditions=snow] .tv-weather-effects i{opacity:.65;width:6px;height:6px;border-radius:50%;animation:tv-weather-snow 11s linear infinite;animation-delay:calc(var(--i)*-.8s)}
.tv-board[data-conditions=cloudy] .tv-weather-effects,.tv-board[data-conditions=partly-cloudy] .tv-weather-effects,.tv-board[data-conditions=night-cloudy] .tv-weather-effects,.tv-board[data-conditions=fog] .tv-weather-effects{background:radial-gradient(ellipse at 20% 20%,#c9d9e32b,transparent 48%),radial-gradient(ellipse at 80% 50%,#e8f1ff26,transparent 55%);animation:tv-weather-clouds 24s ease-in-out infinite alternate}
.tv-board[data-conditions=sunny] .tv-weather-effects{background:radial-gradient(circle at 80% 18%,#ffdc8380 0,transparent 45%);animation:tv-weather-glow 9s ease-in-out infinite alternate}
.tv-board[data-conditions=night] .tv-weather-effects{background-image:radial-gradient(circle,#fff7 1px,transparent 2px);background-size:150px 125px}
.tv-board[data-conditions] .tv-current-metrics .tv-network-card{background:#091f34c9}
.tv-board[data-conditions] .tv-weather-now{background:linear-gradient(135deg,#365970ed,#102a40dd)}
@keyframes tv-weather-fall{to{translate:-80px 95vh}}
@keyframes tv-weather-snow{to{translate:80px 95vh;rotate:180deg}}
@keyframes tv-weather-clouds{to{translate:4% 2%;scale:1.12}}
@keyframes tv-weather-glow{to{opacity:.7;scale:1.04}}
@media(prefers-reduced-motion:reduce){.tv-board,.tv-board *,.tv-board *:before{animation:none!important;transition:none!important}.tv-weather-effects i{display:none}}
.tv-asn-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;flex:1;min-height:0}
.tv-asn-card{display:flex;flex-direction:column;gap:18px;background:#091f34bb;padding:26px;border-top:3px solid #91cbe7;min-width:0;overflow:auto}
.tv-asn-card h2{font-size:clamp(22px,2vw,34px);line-height:1.2;overflow-wrap:anywhere}
.tv-asn-card p{font-size:clamp(16px,1.2vw,22px)}
.tv-asn-status{color:var(--tv-gold);font-size:clamp(22px,1.8vw,32px);margin:auto 0}
.tv-asn-card .tv-map-link{margin-top:auto}
.tv-watch-warning{color:#ffe2a5;background:#55432688;padding:10px 16px;border-left:3px solid var(--tv-gold);font-size:clamp(14px,1vw,18px)}
.tv-watch-paths{display:flex;gap:20px;flex-wrap:wrap;font-size:clamp(16px,1.3vw,22px);color:#c8e7fb;max-height:100px;overflow:auto}
.tv-watch-events{display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:1;min-height:0;overflow:auto}
.tv-watch-events>.tv-empty{grid-column:1/-1}
.tv-watch-event{background:#091f34bb;padding:18px;border-left:3px solid #dcb674;min-width:0}
.tv-watch-event h2{font-size:clamp(20px,1.7vw,30px);margin-bottom:8px}
.tv-watch-event p{font-size:clamp(15px,1.2vw,21px);line-height:1.3;margin-bottom:8px;overflow-wrap:anywhere}
.tv-watch-state{float:right;color:var(--tv-gold);font-size:14px;padding:4px 8px}
.tv-watch-sources{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:auto}
.tv-watch-sources .tv-map-link{font-size:14px;padding:7px 12px}
@media(max-width:900px){.tv-asn-grid,.tv-watch-events{grid-template-columns:1fr;flex:none}.tv-asn-card{padding:18px;gap:12px}.tv-watch-sources{gap:10px}}

/* Keep the Board action tray within narrow displays. */
.tv-header .tv-actions{max-width:calc(100vw - 32px);flex-wrap:wrap;justify-content:flex-end}

/* Broadcast alerts: a prominent top banner with a status beacon and reading timer. */
#tv-notifications{top:16px;left:16px;right:16px;bottom:auto;width:auto;max-height:calc(100% - 32px);overflow:auto}
.tv-notice{--notice-accent:#ffd57b;padding:26px 32px 30px;background:linear-gradient(115deg,#153b55fa,#081d32fc);border:1px solid color-mix(in srgb,var(--notice-accent) 55%,transparent);border-left:7px solid var(--notice-accent);border-radius:16px;box-shadow:0 22px 70px #0009,0 0 36px color-mix(in srgb,var(--notice-accent) 18%,transparent);overflow:hidden;max-height:inherit;animation:tv-notice-arrive .65s cubic-bezier(.16,1,.3,1)}
.tv-notice-outage{--notice-accent:#ff8e9e}.tv-notice-degraded{--notice-accent:#ffd57b}.tv-notice-maintenance{--notice-accent:#bba8ff}.tv-notice-operational{--notice-accent:#83ecc1}.tv-notice-unknown{--notice-accent:#9bd9ff}
.tv-notice-heading{display:flex;align-items:center;gap:18px;padding-right:28px}.tv-notice-heading>div{display:grid;gap:5px}.tv-notice-icon{display:grid;place-items:center;flex:none;width:62px;height:62px;border:2px solid var(--notice-accent);border-radius:50%;color:var(--notice-accent);font-size:36px;font-weight:700;background:#ffffff09;animation:tv-notice-beacon 1.8s ease-out 3}
.tv-notice-kicker{font-size:12px;font-weight:700;letter-spacing:.2em;color:var(--notice-accent)}.tv-notice-title{font-size:clamp(24px,2vw,36px);font-weight:600;color:#fff;line-height:1.15}
.tv-notice-row{margin-top:20px;padding-top:16px;border-top:1px solid #ffffff24;gap:7px;animation:tv-notice-row-in .5s ease-out both;animation-delay:calc(120ms + var(--notice-order,0)*90ms)}
.tv-notice-row strong{font-size:clamp(26px,2.5vw,44px);line-height:1.15}.tv-notice-row span{font-size:clamp(18px,1.5vw,26px);line-height:1.35}.tv-notice-row.tv-maintenance span{color:#d6caff}.tv-notice-row.tv-unknown span{color:#bce7ff}
.tv-notice .tv-notice-close{right:12px;top:12px;min-width:40px;min-height:40px;font-size:28px}.tv-notice-lifetime{position:absolute;bottom:0;left:0;right:0;height:5px;background:var(--notice-accent);transform-origin:left;animation:tv-notice-countdown 18s linear forwards}
@keyframes tv-notice-arrive{from{opacity:0;transform:translateY(-48px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes tv-notice-row-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
@keyframes tv-notice-beacon{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--notice-accent) 35%,transparent)}100%{box-shadow:0 0 0 18px transparent}}
@keyframes tv-notice-countdown{to{transform:scaleX(0)}}
@media(max-width:699px){#tv-notifications{top:8px;left:8px;right:8px;bottom:auto;max-height:calc(100% - 16px)}.tv-notice{padding:18px 18px 24px;border-radius:12px}.tv-notice-heading{gap:12px}.tv-notice-icon{width:44px;height:44px;font-size:27px}.tv-notice-kicker{font-size:10px}.tv-notice-row{margin-top:14px;padding-top:12px}.tv-notice-title{font-size:22px}.tv-notice-row strong{font-size:26px}}
@media(max-height:650px){#tv-notifications{top:8px;bottom:auto;max-height:calc(100% - 16px);overflow:auto}.tv-notice{padding:14px 20px 20px}.tv-notice-icon{width:40px;height:40px;font-size:26px}.tv-notice-row{margin-top:10px;padding-top:10px}.tv-notice-row strong{font-size:24px}.tv-notice-row span{font-size:17px}.tv-notice-title{font-size:22px}}

@media(min-width:900px){.tv-notice{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(0,1.8fr);column-gap:32px;align-items:center;padding:22px 64px 26px 28px}.tv-notice-heading{grid-column:1;grid-row:1;align-self:center;padding-right:0}.tv-notice-row{grid-column:2;margin-top:0;padding:10px 0 10px 28px;border-top:0;border-left:1px solid #ffffff24}.tv-notice-row+.tv-notice-row{border-top:1px solid #ffffff24}.tv-notice>p{grid-column:2}.tv-notice-title{font-size:clamp(24px,1.8vw,34px)}}
/* Request video occupies the station artwork slot without adding a row. */
.request-panel[hidden],.request-skip[hidden]{display:none!important}
.request-panel{--request-size:42px;position:static;order:0;flex:none;width:var(--request-size);height:var(--request-size);padding:0;background:#0a2032;border-radius:8px;overflow:hidden}
.request-video,.request-video iframe{display:block;width:100%;height:100%;min-width:0;border:0}
.request-video{height:var(--request-size)}
.radio-bar:has(.request-panel:not([hidden])) .radio-art{display:none!important}
.board-mode #tv-radio-dock .request-panel{--request-size:64px}
.request-skip{flex:none;width:32px;height:32px;padding:0;border:1px solid #7294ad;border-radius:50%;background:#224963;color:white;font-size:16px;cursor:pointer}
@media(max-width:1400px){.board-mode #tv-radio-dock .request-panel{--request-size:52px}}
@media(max-width:699px){.board-mode #tv-radio-dock .request-panel{--request-size:44px}.board-mode #tv-radio-dock .request-mode{gap:8px}.board-mode #tv-radio-dock .request-mode .radio-controls{gap:8px}}
.request-mode #radio-state{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.request-portal-link{font-size:11px;color:var(--muted);width:fit-content}#tv-radio-dock .request-portal-link{grid-column:1;font-size:11px;color:#c3d9ea}
