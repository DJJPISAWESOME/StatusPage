import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioFades} from '../public/audio-fades.js';
function setup(){const audio=new EventTarget();audio.volume=.4;const player={setVolume(value){this.volume=value;}};return {audio,player,fades:createAudioFades(audio,()=>player)};}
test('transition gains preserve user volume and cancellation prevents stale handoffs',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});const {audio,player,fades}=setup();let switched=false;
 fades.fade('radio',0,600,()=>{switched=true;});t.mock.timers.tick(300);assert.ok(audio.volume>0&&audio.volume<.4);assert.equal(fades.volume,.4);
 fades.volumeTo(.2);assert.equal(fades.volume,.2);assert.ok(audio.volume<.2);
 fades.reset();assert.equal(audio.volume,.2);t.mock.timers.tick(1000);assert.equal(switched,false);assert.equal(audio.volume,.2);
 fades.set('youtube',0);assert.equal(player.volume,0);fades.fade('youtube',1,1100);t.mock.timers.tick(1200);assert.equal(player.volume,10);assert.equal(fades.volume,.2);
});
test('external Board volume changes update both sources at their current gain',()=>{const {audio,player,fades}=setup();fades.set('youtube',.5);audio.volume=.6;audio.dispatchEvent(new Event('volumechange'));assert.equal(fades.volume,.6);assert.equal(player.volume,15);fades.reset();assert.equal(player.volume,30);});
test('trim, mute and volume edits stay authoritative during a fade',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});const {audio,player,fades}=setup();
 fades.set('youtube',0);fades.fade('youtube',1,1200);t.mock.timers.tick(300);
 assert.ok(player.volume>0&&player.volume<20);fades.volumeTo(0);t.mock.timers.tick(300);assert.equal(player.volume,0);
 fades.volumeTo(.8);fades.trimTo(.25);t.mock.timers.tick(700);assert.equal(player.volume,20);assert.equal(audio.volume,.8);
 fades.set('youtube',0);fades.fade('youtube',1,1200);t.mock.timers.tick(300);fades.holdYoutube();const held=player.volume;t.mock.timers.tick(2000);assert.equal(player.volume,held);
 fades.fade('youtube',1,1200);t.mock.timers.tick(1300);assert.equal(player.volume,20);
 fades.volumeTo(NaN);assert.equal(audio.volume,0);assert.equal(player.volume,0);
});
test('radio connection stays silent until playing and reconnect cancels an old ramp',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});const {audio,fades}=setup();
 fades.set('radio',0);t.mock.timers.tick(15000);assert.equal(audio.volume,0);
 fades.fade('radio',1,1100);t.mock.timers.tick(300);assert.ok(audio.volume>0&&audio.volume<.4);
 fades.set('radio',0);t.mock.timers.tick(1500);assert.equal(audio.volume,0);
 fades.volumeTo(.6);fades.fade('radio',1,1100);t.mock.timers.tick(1200);assert.equal(audio.volume,.6);
});
