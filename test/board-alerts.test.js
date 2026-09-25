import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardAlerts, spokenChange, tones } from '../public/board-alerts.js';
test('audible announcements name the service and both states; tones reflect the new state',()=>{assert.equal(spokenChange({name:'Aspen',from:'operational',to:'outage'}),'Aspen. Status changed from operational to an outage.');assert.notDeepEqual(tones.operational,tones.outage);assert.notDeepEqual(tones.degraded,tones.maintenance);});
test('mute and exit cancel pending announcements and restore radio volume',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let spoken=[],cancelled=0;const button={setAttribute(){},textContent:''},radio={volume:.4};
 const host={localStorage:{getItem:()=>null,setItem(){}},speechSynthesis:{speak:u=>spoken.push(u),cancel:()=>cancelled++},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}};
 const alerts=createBoardAlerts({radio,volumeInput:{value:'.4'},button,host});alerts.start();alerts.announce([{name:'Aspen',from:'operational',to:'outage'}]);assert.equal(radio.volume,.1);t.mock.timers.tick(1000);assert.match(spoken[0].text,/Aspen/);button.onclick();assert.equal(radio.volume,.4);alerts.announce([{name:'Aspen',from:'outage',to:'operational'}]);t.mock.timers.tick(2000);assert.equal(spoken.length,1);assert.equal(cancelled,1);alerts.stop();assert.equal(cancelled,2);
});
