import test from 'node:test';
import assert from 'node:assert/strict';
import {levelGain} from '../public/audio-leveler.js';
test('leveler attenuates loud audio, recovers slowly, and respects the selected maximum',()=>{
 assert.ok(levelGain(1,.2,.4)<1);assert.ok(levelGain(.5,.005,.4)>.5);
 let gain=1;for(let i=0;i<1000;i++)gain=levelGain(gain,.4,.4);assert.equal(gain,.2);
 for(let i=0;i<1000;i++)gain=levelGain(gain,.002,.4);assert.equal(gain,1);
 assert.equal(levelGain(.7,0,.4),.7);assert.equal(levelGain(.7,.2,0),.7);assert.equal(levelGain(.7,NaN,.4),.7);
});
test('leveler settles toward target on simulated tracks without exceeding volume ceiling',()=>{
 let gain=.75;for(let i=0;i<100;i++)gain=levelGain(gain,.3*.4*gain,.4);assert.ok(gain<.45&&gain>.2);
 for(let i=0;i<400;i++)gain=levelGain(gain,.08*.4*gain,.4);assert.ok(gain>.9&&gain<=1);
});
