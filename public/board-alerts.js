const labels={operational:'operational',degraded:'degraded',outage:'an outage',maintenance:'maintenance',unknown:'unconfirmed'};
export const tones={operational:[523,659,784],degraded:[440,349],outage:[330,220,330],maintenance:[392,494],unknown:[294,262]};
export function spokenChange(change){return `${change.name}. Status changed from ${labels[change.from]||'unconfirmed'} to ${labels[change.to]||'unconfirmed'}.`;}
export function createBoardAlerts({radio,volumeInput,button,host=globalThis}) {
  let context,enabled=true,active=false,queue=[],busy=false,timer,voiceTimer,restoreVolume=null,generation=0,oscillators=[];
  try{enabled=host.localStorage.getItem('signal:board-audio')!=='off';}catch{}
  function paint(){button.textContent=enabled?'Sound alerts on':'Sound alerts off';button.setAttribute('aria-pressed',String(enabled));}
  function restore(){if(restoreVolume!==null){radio.volume=Number.isFinite(Number(volumeInput.value))?Number(volumeInput.value):restoreVolume;restoreVolume=null;}}
  function cancel(){generation++;clearTimeout(timer);clearTimeout(voiceTimer);queue=[];busy=false;for(const osc of oscillators){try{osc.stop();}catch{}}oscillators=[];host.speechSynthesis?.cancel();restore();}
  function unlock(){if(!enabled)return;try{const Audio=host.AudioContext||host.webkitAudioContext;if(Audio){context ||= new Audio();void context.resume().catch(()=>{});}}catch{}}
  function next(){
    if(!active||!enabled||busy||!queue.length)return;
    busy=true;let finished=false;const item=queue.shift(),version=generation;
    if(restoreVolume===null){restoreVolume=radio.volume;radio.volume=restoreVolume*.25;}
    const notes=tones[item.to]||tones.unknown;
    if(context?.state==='running')notes.forEach((frequency,i)=>{const osc=context.createOscillator(),gain=context.createGain(),start=context.currentTime+i*.18;osc.type='sine';osc.frequency.value=frequency;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.12,start+.02);gain.gain.exponentialRampToValueAtTime(.001,start+.16);osc.connect(gain);gain.connect(context.destination);osc.start(start);osc.stop(start+.18);oscillators.push(osc);osc.onended=()=>{osc.disconnect();gain.disconnect();oscillators=oscillators.filter(x=>x!==osc);};});
    const finish=()=>{if(version!==generation||finished)return;finished=true;clearTimeout(voiceTimer);busy=false;restore();timer=setTimeout(next,250);};
    timer=setTimeout(()=>{
      if(version!==generation)return;
      if(host.speechSynthesis&&host.SpeechSynthesisUtterance){const utterance=new host.SpeechSynthesisUtterance(spokenChange(item));utterance.lang='en-US';utterance.rate=1;utterance.onend=finish;utterance.onerror=finish;voiceTimer=setTimeout(()=>{host.speechSynthesis.cancel();finish();},15000);try{host.speechSynthesis.speak(utterance);}catch{finish();}}
      else finish();
    },notes.length*180+100);
  }
  button.onclick=()=>{enabled=!enabled;try{host.localStorage.setItem('signal:board-audio',enabled?'on':'off');}catch{}if(enabled)unlock();else cancel();paint();};paint();
  return {start(){active=true;unlock();},stop(){active=false;cancel();void context?.suspend().catch(()=>{});},announce(changes){if(!active||!enabled)return;for(const change of changes){const i=queue.findIndex(x=>x.name===change.name);if(i>=0)queue[i]=change;else queue.push(change);}queue=queue.slice(-32);next();}};
}
