// Keep the listener's volume independent from temporary transition gain.
export function createAudioFades(audio,getPlayer,{youtubeTrim=.5}={}){
 let target=audio.volume,radioGain=1,youtubeGain=1,levelGain=1,expected=audio.volume;
 const timers=new Map();
 const clamp=(value,min=0)=>Number.isFinite(value)?Math.max(min,Math.min(1,value)):min;
 youtubeTrim=clamp(youtubeTrim,.1);
 function apply(){expected=clamp(target*radioGain);if(audio.volume!==expected)audio.volume=expected;getPlayer()?.setVolume?.(Math.round(target*youtubeGain*levelGain*youtubeTrim*100));}
 function cancel(kind){clearTimeout(timers.get(kind));timers.delete(kind);}
 function set(kind,value){cancel(kind);if(kind==='radio')radioGain=value;else youtubeGain=value;apply();}
 function fade(kind,to,ms,done=()=>{}){
  cancel(kind);const start=Date.now(),from=kind==='radio'?radioGain:youtubeGain;
  function tick(){const fraction=Math.min(1,(Date.now()-start)/ms),eased=fraction*fraction*(3-2*fraction),value=from+(to-from)*eased;if(kind==='radio')radioGain=value;else youtubeGain=value;apply();if(fraction<1)timers.set(kind,setTimeout(tick,30));else{timers.delete(kind);done();}}
  tick();
 }
 audio.addEventListener('volumechange',()=>{if(audio.volume===expected)return;target=audio.volume;apply();});
 return {get volume(){return target;},get youtubeGain(){return youtubeGain;},get fadingYoutube(){return timers.has('youtube');},holdYoutube(){cancel('youtube');},trimTo(value){youtubeTrim=clamp(value,.1);apply();},levelTo(value){levelGain=clamp(value,.2);apply();},volumeTo(value){target=clamp(value);apply();},set,fade,reset(){cancel('radio');cancel('youtube');radioGain=youtubeGain=1;apply();}};
}
