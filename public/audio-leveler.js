// Feedback control in dB. Silence is gated; gain never exceeds the user's volume.
export function levelGain(gain,rms,volume,dt=.25){
 if(!Number.isFinite(rms)||rms<.0005||volume<.02)return gain;
 const measured=20*Math.log10(rms/volume),error=-20-measured;
 if(Math.abs(error)<1.5)return gain;
 const change=Math.max(-6*dt,Math.min(.8*dt,error*.25));
 return Math.min(1,Math.max(.2,gain*10**(change/20)));
}
export function initAudioLeveler({button,requestRadio}){
 const dialog=document.getElementById('audio-level-dialog'),start=document.getElementById('audio-level-start'),status=document.getElementById('audio-level-status');
 let stream=null,context=null,source=null,interval=null,pending=false,generation=0,gain=1,power=null,lastTrack=null;
 const handle=crypto.randomUUID();
 let supported=Boolean(navigator.mediaDevices?.getDisplayMedia&&navigator.mediaDevices?.setCaptureHandleConfig&&globalThis.AudioContext);
 if(supported)try{navigator.mediaDevices.setCaptureHandleConfig({handle,exposeOrigin:true,permittedOrigins:[location.origin]});}catch{supported=false;}
 function stop(message='Auto leveling is off.'){
  generation++;clearInterval(interval);interval=null;source?.disconnect();source=null;
  const old=stream;stream=null;old?.getTracks().forEach(track=>track.stop());void context?.close().catch(()=>{});context=null;
  gain=1;power=null;lastTrack=null;requestRadio.setLevelGain(1);button.textContent='Auto level audio';button.setAttribute('aria-pressed','false');status.textContent=message;
 }
 button.addEventListener('click',()=>{if(stream){stop();return;}status.textContent=supported?'Choose this Board tab, with tab audio enabled.':'This browser does not support verified tab-audio capture. Use current desktop Chrome on the Board.';start.disabled=!supported||pending;dialog.showModal();});
 document.getElementById('audio-level-close').onclick=()=>dialog.close();
 start.onclick=async()=>{
  if(pending)return;pending=true;start.disabled=true;const version=++generation;
  document.body.dataset.audioCapturePrompt='true';
  try{
   const captured=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:1},audio:{suppressLocalAudioPlayback:false,echoCancellation:false,noiseSuppression:false,autoGainControl:false},preferCurrentTab:true,selfBrowserSurface:'include',systemAudio:'exclude',surfaceSwitching:'exclude',monitorTypeSurfaces:'exclude'});
   if(version!==generation){captured.getTracks().forEach(track=>track.stop());return;}
   stream=captured;
   const video=stream.getVideoTracks()[0],audio=stream.getAudioTracks()[0];
   if(video?.getSettings().displaySurface!=='browser'||video.getCaptureHandle?.()?.handle!==handle)throw Error('Choose this Signal Local Board tab, not another tab, window, or screen.');
   if(!audio)throw Error('No tab audio was shared. Try again with Share tab audio enabled.');
   context=new AudioContext();await context.resume();
   if(version!==generation)return;
   const analyser=context.createAnalyser();analyser.fftSize=4096;
   source=context.createMediaStreamSource(new MediaStream([audio]));source.connect(analyser);
   // Deliberately no connection to the audio output: original playback stays audible, without echo.
   const samples=new Float32Array(analyser.fftSize);
   gain=.75;requestRadio.setLevelGain(gain);
   interval=setInterval(()=>{
    const state=requestRadio.levelingState;
    if(!state.playing||document.querySelector('.tv-notice')||globalThis.speechSynthesis?.speaking){power=null;return;}
    if(state.track!==lastTrack){lastTrack=state.track;power=null;}
    analyser.getFloatTimeDomainData(samples);const samplePower=samples.reduce((sum,value)=>sum+value*value,0)/samples.length;
    power=power===null?samplePower:power*.75+samplePower*.25;
    gain=levelGain(gain,Math.sqrt(power),state.volume);requestRadio.setLevelGain(gain);
    button.textContent=`Auto level on · ${Math.round(gain*100)}%`;
   },250);
   for(const track of stream.getTracks())track.addEventListener('ended',()=>stop('Tab sharing ended. Enable auto leveling to reconnect.'),{once:true});
   video.addEventListener('capturehandlechange',()=>{if(video.getCaptureHandle?.()?.handle!==handle)stop('The shared tab changed. Auto leveling stopped.');});
   button.textContent='Auto level on';button.setAttribute('aria-pressed','true');status.textContent='Listening locally. Click Auto level again to stop.';dialog.close();
  }catch(error){stop(error.name==='NotAllowedError'?'Sharing was cancelled or blocked. Audio playback is unchanged.':error.message||'Tab audio capture could not start.');}
  finally{pending=false;start.disabled=!supported;delete document.body.dataset.audioCapturePrompt;}
 };
 document.addEventListener('request-radio-layout',()=>stop());
 window.addEventListener('pagehide',()=>stop());
 return {stop};
}
