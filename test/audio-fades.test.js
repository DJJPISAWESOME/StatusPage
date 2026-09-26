import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioFades} from '../public/audio-fades.js';
function setup(){const audio=new EventTarget();audio.volume=.4;const player={setVolume(value){this.volume=value;}};return {audio,player,fades:createAudioFades(audio,()=>player)};}
test('transition gains preserve user volume and cancellation prevents stale handoffs',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});const {audio,player,fades}=setup();let switched=false;
 fades.fade('radio',0,600,()=>{switched=true;});t.mock.timers.tick(300);assert.ok(audio.volume>0&&audio.volume<.4);assert.equal(fades.volume,.4);
 fades.volumeTo(.2);assert.equal(fades.volume,.2);assert.ok(audio.volume<.2);
 fades.reset();assert.equal(audio.volume,.2);t.mock.timers.tick(1000);assert.equal(switched,false);assert.equal(audio.volume,.2);
 fades.set('youtube',0);assert.equal(player.volume,0);fades.fade('youtube',1,1100);t.mock.timers.tick(1200);assert.equal(player.volume,20);assert.equal(fades.volume,.2);
});
test('external Board volume changes update both sources at their current gain',()=>{const {audio,player,fades}=setup();fades.set('youtube',.5);audio.volume=.6;audio.dispatchEvent(new Event('volumechange'));assert.equal(fades.volume,.6);assert.equal(player.volume,30);fades.reset();assert.equal(player.volume,60);});
