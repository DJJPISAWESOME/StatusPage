// Keep the listener's volume independent from temporary transition gain.
export function createAudioFades(audio,getPlayer){
 let target=audio.volume,radioGain=1,youtubeGain=1,levelGain=1,duckGain=1;
 const timers=new Map();
 const clamp=(value,min=0)=>Number.isFinite(value)?Math.max(min,Math.min(1,value)):min;
 function apply(){const radioVolume=clamp(target*radioGain*duckGain);if(audio.volume!==radioVolume)audio.volume=radioVolume;getPlayer()?.setVolume?.(Math.round(target*youtubeGain*levelGain*duckGain*100));}
 function cancel(kind){clearTimeout(timers.get(kind));timers.delete(kind);}
 function set(kind,value){cancel(kind);if(kind==='radio')radioGain=value;else youtubeGain=value;apply();}
 function fade(kind,to,ms,done=()=>{}){
  cancel(kind);const start=Date.now(),from=kind==='radio'?radioGain:youtubeGain;
  function tick(){const fraction=Math.min(1,(Date.now()-start)/ms),eased=fraction*fraction*(3-2*fraction),value=from+(to-from)*eased;if(kind==='radio')radioGain=value;else youtubeGain=value;apply();if(fraction<1)timers.set(kind,setTimeout(tick,30));else{timers.delete(kind);done();}}
  tick();
 }
 // Media volume is an output, never the source of the listener's master setting.
 return {get volume(){return target;},get youtubeGain(){return youtubeGain;},get fadingYoutube(){return timers.has('youtube');},duckTo(value){duckGain=clamp(value);apply();},holdYoutube(){cancel('youtube');},levelTo(value){levelGain=clamp(value,.2);apply();},volumeTo(value){target=clamp(value);apply();},set,fade,reset(){cancel('radio');cancel('youtube');radioGain=youtubeGain=1;apply();}};
}
