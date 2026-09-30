import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
export async function verifyAudio(browser){
 const context=await browser.newContext();
 try{
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let current={id:'one',videoId:'aaaaaaaaaaa',title:'Loud fixture'},transport=null,remoteVolume=null;
 await page.route('**/api/requests**',route=>{
  const body=route.request().method()==='POST'?route.request().postDataJSON():{};
  if(body.action==='next')current=null;
  return route.fulfill({json:{current,items:[],transport,remoteVolume,playerEnabled:true}});
 });
 await page.route('**/audio-fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="container"></div><input id="volume"><audio id="audio"></audio><script type="module">import {initRequestRadio} from "/request-radio.js"; const audio=document.querySelector("audio");audio.volume=.4;window.fallbackStarts=0;window.radio=initRequestRadio({container:document.querySelector("#container"),audio,startFallback(){window.fallbackStarts++;window.fallback=true;radio.radioConnecting();radio.radioPlaying();},stopFallback(){window.fallback=false;},onState(text){window.statusText=text;}});radio.select(true);radio.toggle();</script>'}));
 await page.addInitScript(()=>{window.YT={Player:class{
  constructor(mount,options){this.options=options;window.player=this;this.starts=[];setTimeout(()=>options.events.onReady({target:this}),0);}
  setVolume(n){this.volume=n;}getPlayerState(){return this.state;}getVideoData(){return {video_id:this.id};}
  loadVideoById(id){this.starts.push(this.volume);this.id=id;this.emit(1);}emit(state){this.state=state;this.options.events.onStateChange({data:state});}
  playVideo(){this.emit(1);}pauseVideo(){this.emit(2);}stopVideo(){this.state=0;}destroy(){}getCurrentTime(){return 0;}
 }};});
 await page.clock.install();await page.goto('http://127.0.0.1:4173/audio-fixture');await page.waitForFunction(()=>window.player?.id==='aaaaaaaaaaa');
 assert.deepEqual(await page.evaluate(()=>player.starts),[0]);await page.evaluate(()=>{player.emit(3);player.options.events.onAutoplayBlocked();});assert.equal(await page.evaluate(()=>player.volume),0);assert.match(await page.evaluate(()=>statusText),/allow playback/);await page.evaluate(()=>player.emit(1));await page.clock.runFor(1200);assert.equal(await page.evaluate(()=>player.volume),20);
 current={id:'two',videoId:'bbbbbbbbbbb',title:'Quiet fixture'};await page.clock.runFor(4000);await page.waitForFunction(()=>player.id==='bbbbbbbbbbb');assert.deepEqual(await page.evaluate(()=>player.starts),[0,0]);
 await page.evaluate(()=>radio.setVolume(0));await page.clock.runFor(1200);assert.equal(await page.evaluate(()=>player.volume),0);
 await page.evaluate(()=>radio.setVolume(.6));assert.equal(await page.evaluate(()=>player.volume),30);
 current={id:'three',videoId:'ccccccccccc',title:'Third fixture'};await page.clock.runFor(4000);await page.waitForFunction(()=>player.id==='ccccccccccc');
 await page.evaluate(()=>{player.emit(2);window.held=player.volume;});await page.clock.runFor(1500);assert.equal(await page.evaluate(()=>player.volume===held),true);
 await page.evaluate(()=>player.emit(1));await page.clock.runFor(1200);assert.equal(await page.evaluate(()=>player.volume),30);
 transport={revision:1,paused:true,rewind:0};await page.clock.runFor(5100);await page.waitForFunction(()=>player.state===2);
 transport={revision:2,paused:false,rewind:0};remoteVolume={revision:1,value:.2};await page.clock.runFor(5100);await page.waitForFunction(()=>player.state===1&&player.volume===10);
 current=null;await page.clock.runFor(5100);await page.waitForFunction(()=>window.fallback);await page.clock.runFor(1200);assert.equal(await page.evaluate(()=>document.querySelector('audio').volume),.2);
 const starts=await page.evaluate(()=>fallbackStarts);await page.clock.runFor(5100);assert.equal(await page.evaluate(()=>fallbackStarts),starts);
 transport=null;current={id:'four',videoId:'ddddddddddd',title:'Radio to video'};await page.clock.runFor(5100);await page.clock.runFor(2000);await page.waitForFunction(()=>player.id==='ddddddddddd');await page.clock.runFor(1200);assert.equal(await page.evaluate(()=>player.volume),10);assert.equal(await page.evaluate(()=>fallback),false);assert.deepEqual(await page.evaluate(()=>player.starts),[0,0,0,0]);
 await page.evaluate(()=>player.options.events.onError({data:150}));await page.waitForFunction(()=>fallback);await page.clock.runFor(2200);
 await page.evaluate(()=>{radio.toggle();radio.toggle();});await page.clock.runFor(1200);await page.waitForFunction(()=>fallback);const simulated=await page.evaluate(async()=>{const {levelGain}=await import('/audio-leveler.js');let gain=.75;for(let i=0;i<100;i++)gain=levelGain(gain,.6*.4*.5*gain,.4);const loud=gain;for(let i=0;i<600;i++)gain=levelGain(gain,.04*.4*.5*gain,.4);return {loud,quiet:gain};});assert.ok(simulated.loud<.45);assert.equal(simulated.quiet,1);assert.deepEqual(errors,[]);
 console.log('Chrome audio contract passed (muted, mocked YouTube): zero-volume starts, four videos, mute/volume during ramps, pause/resume, remote controls, radio→video→radio, unavailable-video fallback, stop/reconnect.');
 }finally{await context.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true,args:['--mute-audio']});
 try{await verifyAudio(browser);}finally{await browser.close();}
}
