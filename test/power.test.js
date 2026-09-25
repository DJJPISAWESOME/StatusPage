import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePowerCount, powerRegion, powerStatus } from '../src/power.js';

test('regional utility selection uses a specified state when border coordinates overlap', () => {
  assert.equal(powerRegion({latitude:41.94,longitude:-71.28},'MA'),'MA');
  assert.equal(powerRegion({latitude:41.68,longitude:-71.27}),'RI');
  assert.equal(powerRegion({latitude:35,longitude:-80}),null);
});

test('unavailable or redesigned utility response never implies zero or active outages', async () => {
  assert.equal(parsePowerCount('<p>Customers currently without electric power: <b>1,234</b></p>',/Customers currently without electric power\s*:?\s*([\d,]+)/i),1234);
  const response = await powerStatus({latitude:41.68,longitude:-71.27},'RI',async()=>new Response('<p>Map unavailable</p>',{headers:{'content-type':'text/html'}}),null);
  assert.equal(response.available,false); assert.equal(response.active,false); assert.equal(response.count,null);
  const active = await powerStatus({latitude:41.68,longitude:-71.27},'RI',async()=>new Response('<p>Customers currently without electric power: 12</p>',{headers:{'content-type':'text/html'}}),null);
  assert.equal(active.active,true); assert.equal(active.provider,'Rhode Island Energy');
});

test('National Grid summary derives its rotating data path from current state', async () => {
  const calls=[];
  const result=await powerStatus({latitude:42.1,longitude:-71.2},'MA',async url=>{
    calls.push(url);
    return new Response(JSON.stringify(calls.length===1?{data:{interval_generation_data:'data/2026/09/25'}}:{summaryFileData:{totals:[{total_outages:3}]}}),{headers:{'content-type':'application/json'}});
  },null);
  assert.equal(result.count,3); assert.equal(result.countKind,'outages'); assert.equal(result.active,true);
  assert.match(calls[1],/data\/2026\/09\/25\/public\/summary-1\/data\.json$/);
});
