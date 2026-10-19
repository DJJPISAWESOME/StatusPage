import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from '../src/catalog.js';
import { collectServices } from '../src/collection.js';
import { StatusHub } from '../src/hub.js';
import { acceptsSnapshot } from '../public/status-snapshot.js';
import { boardStatus } from '../public/board-status.js';

const service = { id: 'example', parser: 'statuspage', url: 'https://example.test/summary.json' };
const healthy = () => Response.json({ status: { indicator: 'none' } });

test('a transient failed observation is checked again before publishing a recovery or incident', async () => {
  for (const indicator of ['none', 'major', 'minor', 'maintenance', 'unrecognized']) {
    let calls = 0;
    const [result] = await collectServices([service], async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ status: { indicator } }));
    assert.equal(calls, 2);
    assert.equal(result.status, ({ none: 'operational', major: 'outage', minor: 'degraded', maintenance: 'maintenance' })[indicator] || 'unknown');
    assert.equal(result.attempts, 2);
    assert.equal(result.error, undefined);
    assert.ok(result.lastSuccessAt);
  }
});

test('transport and timeout failures get one retry; persistent failures remain unknown', async () => {
  for (const name of ['TypeError', 'AbortError', 'TimeoutError']) {
    let calls = 0;
    const [result] = await collectServices([service], async () => { calls++; throw Object.assign(new Error('connection lost'), { name }); });
    assert.equal(calls, 2);
    assert.equal(result.status, 'unknown');
    assert.ok(result.error);
    assert.equal(result.lastSuccessAt, undefined);
  }
});

test('provider Retry-After seconds and HTTP dates suppress early retries; expired or invalid delays do not', async t => {
  const now = Date.parse('2026-10-19T18:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  for (const retryAfter of ['60', new Date(now + 60000).toUTCString()]) {
    let calls = 0;
    const [result] = await collectServices([service], async () => { calls++; return new Response(null, { status: 503, headers: { 'Retry-After': retryAfter } }); });
    assert.equal(calls, 1, `Must respect Retry-After: ${retryAfter}`);
    assert.equal(result.status, 'unknown');
    assert.equal(result.attempts, 1);
    assert.equal(Date.parse(result.retryAfterAt), now + 60000);
  }
  for (const retryAfter of ['0', new Date(now - 60000).toUTCString(), 'invalid']) {
    let calls = 0;
    const [result] = await collectServices([service], async () => ++calls === 1 ? new Response(null, { status: 503, headers: { 'Retry-After': retryAfter } }) : healthy());
    assert.equal(calls, 2);
    assert.equal(result.status, 'operational');
    assert.equal(result.retryAfterAt, undefined);
  }
});

test('permanent, rate-limited and invalid responses do not trigger immediate retries or imply health', async () => {
  for (const response of [new Response(null, { status: 401 }), new Response(null, { status: 429 }), new Response(null, { status: 404 }), Response.json({}), new Response('invalid JSON'), new Response('too large', { headers: { 'Content-Length': '99999999' } })]) {
    let calls = 0;
    const [result] = await collectServices([service], async () => { calls++; return response; });
    assert.equal(calls, 1);
    assert.equal(result.status, 'unknown');
    assert.ok(result.error);
  }
  const [feed] = await collectServices([{ ...service, parser: 'rss' }], async () => new Response('<rss><channel/></rss>'));
  assert.equal(feed.status, 'unknown');
  assert.ok(feed.note);
  assert.equal(feed.attempts, 1);
});

test('a fleet failure checks every source and bounds retries including the two-request Adobe adapter', async () => {
  assert.ok(SERVICES.reduce((n, s) => n + (s.parser === 'adobe' ? 2 : 1), 0) <= 48, 'Catalog must fit the collector request budget');
  const calls = new Map(); let total = 0, active = 0, maxActive = 0;
  const results = await collectServices(SERVICES, async url => {
    total++; calls.set(url, (calls.get(url) || 0) + 1);
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (url.endsWith('/StatusEvents')) return Response.json({ incidentEvent: { incidents: {} }, maintenanceEvent: { maintenance: {} } });
    return new Response(null, { status: 503 });
  });
  assert.equal(results.length, SERVICES.length);
  for (const s of SERVICES) assert.ok(calls.has(s.url), `${s.id} was checked`);
  assert.equal(total, 48);
  assert.ok(maxActive <= 4);
  assert.ok(results.some(r => r.attempts === 1));
  assert.ok(results.some(r => r.attempts === 2));
  assert.ok(results.every(r => r.status === 'unknown' && r.error));
});

test('HTTP fallback and reconnect snapshots cannot roll back a newer live result', () => {
  const before = { updatedAt: '2026-10-19T14:45:00Z', services: [{ status: 'unknown' }] };
  const current = { updatedAt: '2026-10-19T14:50:00Z', services: [{ status: 'operational' }] };
  assert.equal(acceptsSnapshot(undefined, { updatedAt: null, services: [] }), true);
  assert.equal(acceptsSnapshot(before, current), true);
  assert.equal(acceptsSnapshot(current, before), false);
  assert.equal(acceptsSnapshot(current, { updatedAt: null, services: [] }), false);
  assert.equal(acceptsSnapshot(current, { updatedAt: 'invalid', services: [] }), false);
  assert.equal(acceptsSnapshot(current, current), true); // Settings can reprocess the same snapshot.
  assert.equal(acceptsSnapshot(current, { ...current, services: null }), false);
  assert.equal(acceptsSnapshot(current, { ...current, updatedAt: '2026-10-19T14:55:00Z', services: [{ status: 'unknown' }] }), true);
  const stale = { status: 'operational', checkedAt: current.updatedAt, staleAfterMs: 720000 };
  assert.equal(boardStatus(stale, Date.parse(current.updatedAt) + 720001), 'unknown');
});

test('overlapping scheduled refreshes coalesce, publish only the final observation and persist honest failures', async t => {
  const pair = Object.getOwnPropertyDescriptor(globalThis, 'WebSocketRequestResponsePair');
  globalThis.WebSocketRequestResponsePair = class {};
  t.after(() => { if (pair) Object.defineProperty(globalThis, 'WebSocketRequestResponsePair', pair); else delete globalThis.WebSocketRequestResponsePair; });
  const db = new Map(), broadcasts = []; let initialization;
  const ctx = {
    storage: { async get(key) { return structuredClone(db.get(key)); }, async put(key, value) { db.set(key, structuredClone(value)); } },
    blockConcurrencyWhile(fn) { return initialization = fn(); }, setWebSocketAutoResponse() {},
    getWebSockets() { return [{ send(value) { broadcasts.push(JSON.parse(value)); } }]; }
  };
  const hub = new StatusHub(ctx, {}); await initialization;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response(null, { status: 503 }) : healthy());
  const id = SERVICES.find(s => s.parser === 'statuspage').id;
  await hub.enqueue([id], true);
  assert.equal(broadcasts.length, 1);
  assert.equal(hub.state.services[id].status, 'operational');
  assert.equal(hub.state.services[id].attempts, 2);
  assert.equal(hub.state.history.length, 0);
  const lastSuccessAt = hub.state.services[id].lastSuccessAt;
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await hub.enqueue([id], true);
  assert.equal(hub.state.services[id].status, 'unknown');
  assert.equal(hub.state.services[id].lastSuccessAt, lastSuccessAt);
  assert.equal(hub.state.services[id].previousStatus, 'operational');
  assert.equal(hub.state.services[id].consecutiveFailures, 1);
  assert.equal(db.get('snapshot').services[id].status, 'unknown');
  // Simultaneous full scheduled checks share the serialized freshness gate.
  let fullCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { fullCalls++; return new Response(null, { status: 401 }); });
  const start = broadcasts.length;
  await Promise.all([hub.enqueue(), hub.enqueue()]);
  assert.equal(broadcasts.length, start + 1);
  assert.equal(fullCalls, SERVICES.length);
});

test('queued forced collections preserve the newer incident across timestamp ties, clock rollback and hub restart', async t => {
  const pair = Object.getOwnPropertyDescriptor(globalThis, 'WebSocketRequestResponsePair');
  globalThis.WebSocketRequestResponsePair = class {};
  t.after(() => { if (pair) Object.defineProperty(globalThis, 'WebSocketRequestResponsePair', pair); else delete globalThis.WebSocketRequestResponsePair; });
  const now = Date.parse('2026-10-19T18:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const db = new Map(), broadcasts = []; let initialization;
  const ctx = {
    storage: { async get(key) { return structuredClone(db.get(key)); }, async put(key, value) { db.set(key, structuredClone(value)); } },
    blockConcurrencyWhile(fn) { return initialization = fn(); }, setWebSocketAutoResponse() {},
    getWebSockets() { return [{ send(value) { broadcasts.push(JSON.parse(value)); } }]; }
  };
  let hub = new StatusHub(ctx, {}); await initialization;
  let release, entered, calls = 0;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) { entered(); await held; return healthy(); }
    return Response.json({ status: { indicator: 'major' } });
  });
  const id = SERVICES.find(s => s.parser === 'statuspage').id;
  const first = hub.enqueue([id], true); await started;
  const second = hub.enqueue([id], true);
  await Promise.resolve(); assert.equal(calls, 1, 'The newer forced check must wait for the in-flight collection');
  release(); await Promise.all([first, second]);
  assert.equal(broadcasts.length, 2);
  const [healthySnapshot, incidentSnapshot] = broadcasts;
  assert.equal(incidentSnapshot.services.find(s => s.id === id).status, 'outage');
  assert.ok(Date.parse(incidentSnapshot.updatedAt) > Date.parse(healthySnapshot.updatedAt));
  assert.equal(acceptsSnapshot(incidentSnapshot, healthySnapshot), false);
  // Persistence must preserve ordering even if the clock moves back across a restart.
  t.mock.timers.setTime(now - 60000);
  hub = new StatusHub(ctx, {}); await initialization;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: { indicator: 'minor' } }));
  await hub.enqueue([id], true);
  const latest = broadcasts.at(-1);
  assert.equal(latest.services.find(s => s.id === id).status, 'degraded');
  assert.ok(Date.parse(latest.updatedAt) > Date.parse(incidentSnapshot.updatedAt));
  assert.equal(acceptsSnapshot(incidentSnapshot, latest), true);
  assert.equal(acceptsSnapshot(latest, incidentSnapshot), false);
});
