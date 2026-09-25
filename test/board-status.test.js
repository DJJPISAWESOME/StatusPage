import test from 'node:test';
import assert from 'node:assert/strict';
import { boardChanges } from '../public/board-status.js';
test('Board notices ignore initial and repeated snapshots but include outages, recovery and stale data',()=>{
 const first=[{id:'a',name:'A',status:'operational',checkedAt:new Date(1000).toISOString(),staleAfterMs:5000}];
 const baseline=boardChanges(undefined,first,2000);assert.deepEqual(baseline.changes,[]);
 assert.deepEqual(boardChanges(baseline.next,first,2000).changes,[]);
 const down=boardChanges(baseline.next,[{...first[0],status:'outage'}],2000);assert.equal(down.changes[0].to,'outage');
 assert.equal(boardChanges(down.next,first,2000).changes[0].to,'operational');
 assert.equal(boardChanges(baseline.next,first,8000).changes[0].to,'unknown');
 assert.equal(boardChanges(baseline.next,[{id:'new',status:'outage'}],2000).changes.length,0);
});
