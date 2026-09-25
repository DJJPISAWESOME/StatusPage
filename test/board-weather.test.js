import test from 'node:test';
import assert from 'node:assert/strict';
import { currentHour, localDayIndex, WARREN } from '../public/board-weather.js';
test('hour highlighting uses the containing hour, not the nearest forecast',()=>{
 const hour=Date.parse('2026-09-25T14:00:00Z')/1000;
 assert.equal(currentHour(hour,hour*1000),true);
 assert.equal(currentHour(hour,(hour+3599)*1000),true);
 assert.equal(currentHour(hour,(hour+3600)*1000),false);
 assert.equal(currentHour(hour,(hour-1)*1000),false);
 assert.equal(currentHour(null,hour*1000),false);
});
test('repeated daylight-saving hours have distinct current-hour states',()=>{
 const first=Date.parse('2026-11-01T05:00:00Z')/1000,second=first+3600;
 assert.equal(currentHour(first,(second+1800)*1000),false);
 assert.equal(currentHour(second,(second+1800)*1000),true);
});
test('daily conditions select today in Warren rather than the first cached day',()=>{
 const times=['2026-09-25T04:00:00Z','2026-09-26T04:00:00Z'].map(t=>Date.parse(t)/1000);
 assert.equal(localDayIndex(times,WARREN.timezone,Date.parse('2026-09-26T03:59:59Z')),0);
 assert.equal(localDayIndex(times,WARREN.timezone,Date.parse('2026-09-26T04:00:00Z')),1);
 assert.equal(localDayIndex(times,WARREN.timezone,Date.parse('2026-09-27T04:00:00Z')),-1);
 assert.equal(localDayIndex(undefined),-1);
});
