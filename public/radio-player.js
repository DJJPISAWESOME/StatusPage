export class RadioRecovery {
  constructor(audio,onState,{setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    this.audio=audio;this.onState=onState;this.setTimer=(fn,ms)=>setTimer(fn,ms);this.clearTimer=id=>clearTimer(id);this.active=false;this.generation=0;
    audio.addEventListener('error',()=>this.retry());audio.addEventListener('stalled',()=>this.watch());audio.addEventListener('waiting',()=>this.watch());
    audio.addEventListener('playing',()=>{if(!this.active){audio.pause();return;}this.clear();this.onState('Live stream');this.timer=this.setTimer(()=>{this.attempt=0;},30000);});
    audio.addEventListener('ended',()=>this.retry());
  }
  clear(){this.clearTimer(this.timer);this.timer=null;}
  stop(){this.active=false;this.retryPending=false;this.generation++;this.clear();this.audio.pause();}
  start(station){this.stop();this.active=true;this.attempt=0;this.sources=[station.stream,...(station.fallbacks || []).filter(x=>x.verified===true&&/^https:\/\//.test(x.url)).map(x=>x.url)];this.connect();}
  watch(){if(!this.active)return;this.clear();this.timer=this.setTimer(()=>this.retry(),15000);}
  async connect(){const generation=++this.generation;this.onState(this.attempt?'Reconnecting to station…':'Connecting to station…');this.audio.src=this.sources[Math.min(this.attempt,this.sources.length-1)];this.watch();try{await this.audio.play();}catch(error){if(generation!==this.generation||!this.active)return;if(error.name==='NotAllowedError'){this.stop();this.onState('Select play to allow audio');}else this.retry();}}
  retry(){if(!this.active||this.retryPending)return;this.clear();if(this.attempt>=3){this.stop();this.onState('Stream unavailable · retry or open station');return;}this.attempt++;this.retryPending=true;this.audio.pause();this.onState(`Reconnecting · attempt ${this.attempt} of 3`);this.timer=this.setTimer(()=>{this.retryPending=false;if(this.active)this.connect();},1000*2**this.attempt);}
}
