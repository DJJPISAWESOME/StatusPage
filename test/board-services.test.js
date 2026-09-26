import test from 'node:test';
import assert from 'node:assert/strict';
import { servicePages, servicePageDuration, serviceSlot } from '../public/board-services.js';

test('includes every service, keeping unknown and stale services on final pages', () => {
  const services = [
    {id:'unknown',name:'A',status:'unknown'},
    {id:'ok',name:'B',status:'operational'},
    {id:'out',name:'C',status:'outage'},
    {id:'stale',name:'D',status:'operational',checkedAt:'2026-01-01T00:00:00Z',staleAfterMs:1},
    {id:'missing',name:'E'}
  ];
  const pages=servicePages(services,2,Date.parse('2026-02-01T00:00:00Z'));
  assert.deepEqual(pages.map(page=>page.map(s=>s.id)),[['out','ok'],['unknown','stale'],['missing']]);
  assert.equal(pages.flat().length,services.length);
});
test('four complete passes fit five minutes without accumulated timer rounding', () => {
  for(const count of [1,4,6,7,8,9,12]) {
    const duration=300000,step=servicePageDuration(duration,count),slots=new Set();
    assert.equal(step*count*4,duration);
    for(let elapsed=0;elapsed<duration;elapsed+=1000) slots.add(serviceSlot(elapsed,duration,count));
    const visits=Array(count).fill(0);
    for(const slot of slots) visits[slot%count]++;
    assert.deepEqual(visits,Array(count).fill(4));
    assert.equal(serviceSlot(duration,duration,count),count*4-1);
  }
});
test('empty feed retains a usable page',()=>assert.deepEqual(servicePages([],6),[[]]));
