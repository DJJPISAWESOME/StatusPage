import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherInfo } from '../public/weather-icons.js';
test('WMO icon mapping distinguishes clouds, freezing rain, snow, storms and missing data',()=>{
 for(const [code,kind] of [[0,'sun'],[1,'partly'],[2,'partly'],[3,'cloud'],[45,'fog'],[51,'rain'],[56,'sleet'],[67,'sleet'],[73,'snow'],[82,'rain'],[86,'snow'],[95,'storm'],[99,'storm'],['2','partly']])assert.equal(weatherInfo(code).kind,kind);
 for(const value of [null,undefined,'',NaN,4,999])assert.equal(weatherInfo(value).kind,'unknown');
});
