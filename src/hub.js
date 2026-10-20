import { RequestQueue } from './requests.js';
import { History } from './history.js';
import { SERVICES } from './catalog.js';
import { collectServices } from './collection.js';
import { json, secretMap } from './security.js';

export const FEED_FAILURE_THRESHOLD = 2;
const FORBIDDEN_CLOSE = new Set([1004, 1005, 1006, 1015]);

export function mergeResult(previous, next, mode) {
  const failures = next.error ? (previous?.consecutiveFailures || 0) + 1 : 0;
  const previousStatus = next.error ? previous?.status === 'unknown' ? previous?.previousStatus : previous?.status : null;
  return {
    ...next,
    mode,
    consecutiveFailures: failures,
    lastSuccessAt: next.lastSuccessAt || previous?.lastSuccessAt || null,
    previousStatus
  };
}

// Recent-changes only records a collection failure after it repeats, so one
// blip does not appear as operational → unknown → operational.
export function feedTransition(before, result, merged) {
  if (!before) return null;
  if (result.error) {
    const confirmed = (merged?.consecutiveFailures || 0) >= FEED_FAILURE_THRESHOLD;
    const origin = before.status === 'unknown' ? before.previousStatus : before.status;
    if (!confirmed || !origin || origin === result.status) return null;
    if ((before.consecutiveFailures || 0) >= FEED_FAILURE_THRESHOLD) return null;
    return { from: origin, to: result.status };
  }
  if (before.status === result.status) return null;
  const streak = before.consecutiveFailures || 0;
  if (before.status === 'unknown' && streak > 0 && streak < FEED_FAILURE_THRESHOLD) {
    if (!before.previousStatus || before.previousStatus === result.status) return null;
    return { from: before.previousStatus, to: result.status };
  }
  return { from: before.status, to: result.status };
}

export function safeCloseCode(code) {
  if (!Number.isInteger(code) || code < 1000 || code > 4999 || FORBIDDEN_CLOSE.has(code) || (code >= 1016 && code <= 2999)) return 1000;
  return code;
}

function serviceSnapshot(service, stored, webhook) {
  const { url, parser, ...fields } = service;
  const interval = webhook ? 3600000 : 300000;
  return {
    ...fields,
    status: 'unknown',
    incidents: [],
    ...stored,
    sourceType: parser,
    componentSupport: parser === 'statuspage',
    nextCheckAt: stored?.checkedAt ? new Date(Date.parse(stored.checkedAt) + interval).toISOString() : null,
    mode: webhook ? 'webhook' : 'scheduled',
    staleAfterMs: webhook ? 75 * 60000 : 12 * 60000
  };
}

export class StatusHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.music = new RequestQueue(ctx.storage);
    this.state = { services: {}, updatedAt: null, history: [], lastPollAt: 0, receipts: {} };
    this.queue = Promise.resolve();
    this.history = ctx.storage.sql ? new History(ctx.storage.sql) : null;
    ctx.blockConcurrencyWhile(async () => { this.state = await ctx.storage.get('snapshot') || this.state; });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  webhookServices() {
    const secrets = { ...secretMap(this.env.WEBHOOK_SECRETS), ...secretMap(this.env.STATUSPAGE_TOKENS) };
    return new Set((this.env.WEBHOOK_SERVICES || '').split(',').map(id => id.trim()).filter(id => typeof secrets[id] === 'string' && secrets[id].length >= 32));
  }
  snapshot() {
    const hooks = this.webhookServices();
    return {
      type: 'snapshot',
      updatedAt: this.state.updatedAt,
      history: this.state.history,
      retentionDays: 30,
      webhookActivity: this.state.webhookActivity || {},
      services: SERVICES.map(service => serviceSnapshot(service, this.state.services[service.id], hooks.has(service.id)))
    };
  }
  enqueue(ids, force = false) {
    const run = this.queue.then(() => this.refresh(ids, force));
    this.queue = run.catch(() => {});
    return run;
  }
  async refresh(ids, force) {
    const now = Date.now();
    if (!ids && !force && now - this.state.lastPollAt < 240000) return;
    const hooks = this.webhookServices();
    const selected = SERVICES.filter(service => {
      if (ids) return ids.includes(service.id);
      const current = this.state.services[service.id];
      return !hooks.has(service.id) || !current?.lastSuccessAt || now - Date.parse(current.lastSuccessAt) >= 3600000 || current?.error;
    });
    const results = await collectServices(selected);
    for (const result of results) {
      const before = this.state.services[result.id];
      this.history?.record(result, hooks.has(result.id) ? 75 * 60000 : 12 * 60000);
      const merged = mergeResult(before, result, hooks.has(result.id) ? 'webhook' : 'scheduled');
      this.state.services[result.id] = merged;
      const change = feedTransition(before, result, merged);
      if (change) this.state.history.unshift({ id: crypto.randomUUID(), serviceId: result.id, ...change, at: result.checkedAt });
    }
    if (!this.state.prunedAt || now - this.state.prunedAt > 86400000) { this.history?.prune(now); this.state.prunedAt = now; }
    this.state.history = this.state.history.slice(0, 60);
    // Persist a strict ordering even when forced checks share a millisecond or
    // the wall clock moves back. Clients use this value to reject older snapshots.
    const previousUpdate = Date.parse(this.state.updatedAt);
    this.state.updatedAt = new Date(Math.max(Date.now(), Number.isFinite(previousUpdate) ? previousUpdate + 1 : 0)).toISOString();
    if (!ids) this.state.lastPollAt = now;
    this.state.receipts = Object.fromEntries(Object.entries(this.state.receipts).filter(([, time]) => now - time < 600000));
    await this.ctx.storage.put('snapshot', this.state);
    const payload = JSON.stringify(this.snapshot());
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); }
      catch { try { socket.close(1011, 'Reconnect'); } catch { /* Peer is already gone. */ } }
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/requests') return this.music.handle(request);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
      if (this.ctx.getWebSockets().length >= 200) return json({ error: 'Connection capacity reached' }, 503);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify(this.snapshot()));
      if (!this.state.updatedAt) this.ctx.waitUntil(this.enqueue());
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/history') {
      const query = {
        service: url.searchParams.get('service') || '',
        days: Number(url.searchParams.get('days') || 7),
        status: url.searchParams.get('status') || '',
        before: Number(url.searchParams.get('before') || 0)
      };
      return json(this.history?.query(query) || { rows: [], totals: [] });
    }
    if (url.pathname === '/refresh') {
      if (Object.keys(await this.ctx.storage.get('pending') || {}).length && !await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 1000);
      await this.enqueue();
      return json({ ok: true });
    }
    if (url.pathname === '/invalidate') {
      const { service, receipt } = await request.json();
      const key = `${service}:${receipt}`;
      let duplicate = false;
      await this.ctx.blockConcurrencyWhile(async () => {
        const now = Date.now();
        this.state.receipts = Object.fromEntries(Object.entries(this.state.receipts).filter(([, time]) => now - time < 600000));
        if (this.state.receipts[key]) { duplicate = true; return; }
        if (Object.keys(this.state.receipts).length >= 2000) throw new Error('Webhook capacity reached');
        const pending = await this.ctx.storage.get('pending') || {};
        pending[service] = crypto.randomUUID();
        this.state.receipts[key] = now;
        this.state.webhookActivity ||= {};
        const activity = this.state.webhookActivity[service];
        this.state.webhookActivity[service] = { lastAcceptedAt: new Date(now).toISOString(), count: (activity?.count || 0) + 1 };
        // Schedule before committing the receipt, so an acknowledged hint cannot lose its alarm.
        if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now + 1000);
        await this.ctx.storage.put({ snapshot: this.state, pending });
      });
      return json({ accepted: true, duplicate }, 202);
    }
    if (!this.state.updatedAt) this.ctx.waitUntil(this.enqueue());
    return json(this.snapshot());
  }
  async alarm() {
    const pending = await this.ctx.storage.get('pending') || {};
    try {
      if (Object.keys(pending).length) await this.enqueue(Object.keys(pending), true);
      await this.ctx.blockConcurrencyWhile(async () => {
        const latest = await this.ctx.storage.get('pending') || {};
        for (const [id, version] of Object.entries(pending)) if (latest[id] === version) delete latest[id];
        await this.ctx.storage.put('pending', latest);
        if (Object.keys(latest).length) await this.ctx.storage.setAlarm(Date.now() + 1000);
      });
    } catch (error) {
      await this.ctx.storage.setAlarm(Date.now() + 30000);
      throw error;
    }
  }
  webSocketMessage(socket, message) { if (message !== 'ping') socket.close(1008, 'Read-only connection'); }
  webSocketClose(socket, code) {
    try { socket.close(safeCloseCode(code)); }
    catch { /* Already closed, or the runtime rejected the status code. */ }
  }
  webSocketError(socket) { socket.close(1011, 'Reconnect'); }
}
