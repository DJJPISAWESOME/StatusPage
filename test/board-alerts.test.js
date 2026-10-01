import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioFades} from '../public/audio-fades.js';
import { createBoardAlerts, spokenChange, tones, preferredAlertVoice } from '../public/board-alerts.js';
test('audible announcements name the service and both states; tones reflect the new state',()=>{assert.equal(spokenChange({name:'Aspen',from:'operational',to:'outage'}),'Aspen. Status changed from operational to an outage.');assert.notDeepEqual(tones.operational,tones.outage);assert.notDeepEqual(tones.degraded,tones.maintenance);});
test('mute and exit cancel pending announcements and restore radio volume',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let spoken=[],cancelled=0;const button={setAttribute(){},textContent:''},radio={volume:.4};
 const host={localStorage:{getItem:()=>null,setItem(){}},speechSynthesis:{speak:u=>spoken.push(u),cancel:()=>cancelled++},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}};
 const alerts=createBoardAlerts({setDuckGain:value=>{radio.volume=.4*value;},button,host});alerts.start();alerts.announce([{name:'Aspen',from:'operational',to:'outage'}]);assert.equal(radio.volume,.4);t.mock.timers.tick(1000);spoken[0].onstart();assert.equal(radio.volume,.1);assert.match(spoken[0].text,/Aspen/);button.onclick();assert.equal(radio.volume,.4);alerts.announce([{name:'Aspen',from:'outage',to:'operational'}]);t.mock.timers.tick(2000);assert.equal(spoken.length,1);assert.equal(cancelled,1);alerts.stop();assert.equal(cancelled,2);
});

test('alert voices prefer natural English, then Google, with American English as a tie-breaker',()=>{
 const legacy={name:'Microsoft David',lang:'en-US',default:true},google={name:'Google US English',lang:'en-US'},natural={name:'Microsoft Ava Online (Natural)',lang:'en-US'},british={name:'English Enhanced',lang:'en-GB'},french={name:'French Neural',lang:'fr-FR'};
 assert.equal(preferredAlertVoice([legacy,google,natural,british,french]),natural);
 assert.equal(preferredAlertVoice([legacy,google]),google);
 assert.equal(preferredAlertVoice([legacy]),legacy);
 assert.equal(preferredAlertVoice([french]),null);
 assert.equal(preferredAlertVoice([]),null);
});
test('voices loaded after Board entry are selected when the announcement starts',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let voices=[],spoken;
 const voice={name:'Google US English',lang:'en-US'};
 const host={localStorage:{getItem:()=>null},speechSynthesis:{getVoices:()=>voices,speak:u=>{spoken=u;},cancel(){}},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}};
 const alerts=createBoardAlerts({setDuckGain(){},button:{setAttribute(){}},host});
 alerts.start();alerts.announce([{name:'Test service',from:'operational',to:'outage'}]);voices=[voice];t.mock.timers.tick(1000);
 assert.equal(spoken.voice,voice);assert.equal(spoken.lang,'en-US');alerts.stop();
});

test('finishing or cancelling an alert never restores an obsolete master or bypasses a transition',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});let utterance;const radio=new EventTarget();radio.volume=.4;const player={setVolume(value){this.volume=value;}},fades=createAudioFades(radio,()=>player);
 const host={localStorage:{getItem:()=>null},speechSynthesis:{speak:value=>{utterance=value;},cancel(){}},SpeechSynthesisUtterance:class{}};
 const alerts=createBoardAlerts({setDuckGain:value=>fades.duckTo(value),button:{setAttribute(){}},host});
 alerts.start();alerts.announce([{name:'Test',from:'operational',to:'outage'}]);assert.equal(fades.volume,.4);assert.equal(radio.volume,.4);t.mock.timers.tick(1000);utterance.onstart();assert.equal(radio.volume,.1);
 fades.set('radio',0);fades.volumeTo(0);utterance.onend();assert.equal(radio.volume,0);assert.equal(player.volume,0);assert.equal(fades.volume,0);
 fades.volumeTo(.2);alerts.announce([{name:'Test',from:'outage',to:'operational'}]);alerts.stop();assert.equal(radio.volume,0);assert.equal(player.volume,20);assert.equal(fades.volume,.2);
 fades.fade('radio',1,1100);t.mock.timers.tick(1200);assert.equal(radio.volume,.2);
});

test('queued or blocked speech never ducks playback; late start after timeout cannot duck it',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const gains=[],spoken=[];
 const host={localStorage:{getItem:()=>null},speechSynthesis:{speak:u=>spoken.push(u),cancel(){}},SpeechSynthesisUtterance:class{}};
 const alerts=createBoardAlerts({setDuckGain:value=>gains.push(value),button:{setAttribute(){}},host});alerts.start();alerts.announce([{name:'Fixture',from:'operational',to:'outage'}]);
 t.mock.timers.tick(1000);assert.equal(spoken.length,1);t.mock.timers.tick(9000);assert.deepEqual(gains,[]);
 t.mock.timers.tick(16000);spoken[0].onstart();assert.deepEqual(gains,[]);alerts.stop();
});
test('running tones duck until their end, and actual speech start ducks independently',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const gains=[];let utterance;
 class AudioContext{state='running';currentTime=0;resume(){return Promise.resolve();}suspend(){return Promise.resolve();}createOscillator(){return {frequency:{},connect(){},start(){},stop(){},disconnect(){}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}}
 const host={AudioContext,localStorage:{getItem:()=>null},speechSynthesis:{speak:u=>{utterance=u;},cancel(){}},SpeechSynthesisUtterance:class{}};
 const alerts=createBoardAlerts({setDuckGain:value=>gains.push(value),button:{setAttribute(){}},host});alerts.start();alerts.announce([{name:'Fixture',from:'operational',to:'outage'}]);assert.deepEqual(gains,[.25]);
 t.mock.timers.tick(1000);assert.deepEqual(gains,[.25,1]);utterance.onstart();assert.deepEqual(gains,[.25,1,.25]);utterance.onend();assert.deepEqual(gains,[.25,1,.25,1]);alerts.stop();
});
