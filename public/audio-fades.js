// Keep the listener's volume independent from temporary transition gain.
export function createAudioFades(audio,getPlayer){
 let target=audio.volume,radioGain=1,youtubeGain=1,expected=audio.volume;
 const timers=new Map();
 function apply(){expected=Math.max(0,Math.min(1,target*radioGain));if(audio.volume!==expected)audio.volume=expected;getPlayer()?.setVolume?.(Math.round(target*youtubeGain*100));}
 function cancel(kind){clearTimeout(timers.get(kind));timers.delete(kind);}
 function set(kind,value){cancel(kind);if(kind==='radio')radioGain=value;else youtubeGain=value;apply();}
 function fade(kind,to,ms,done=()=>{}){
  cancel(kind);const start=Date.now(),from=kind==='radio'?radioGain:youtubeGain;
  function tick(){const fraction=Math.min(1,(Date.now()-start)/ms),eased=fraction*fraction*(3-2*fraction),value=from+(to-from)*eased;if(kind==='radio')radioGain=value;else youtubeGain=value;apply();if(fraction<1)timers.set(kind,setTimeout(tick,30));else{timers.delete(kind);done();}}
  tick();
 }
 audio.addEventListener('volumechange',()=>{if(audio.volume===expected)return;target=audio.volume;apply();});
 return {get volume(){return target;},get youtubeGain(){return youtubeGain;},volumeTo(value){target=value;apply();},set,fade,reset(){cancel('radio');cancel('youtube');radioGain=youtubeGain=1;apply();}};
}
