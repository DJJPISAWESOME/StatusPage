import { History } from './history.js';
import { SERVICES } from './catalog.js';
import { collectService } from './providers.js';
import { json, secretMap } from './security.js';
export function mergeResult(previous, next, mode) {
  return { ...next, mode, consecutiveFailures: next.error ? (previous?.consecutiveFailures || 0) + 1 : 0, lastSuccessAt: next.lastSuccessAt || previous?.lastSuccessAt || null, previousStatus: next.error ? previous?.status === 'unknown' ? previous?.previousStatus : previous?.status : null };
}
export class StatusHub {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.state = { services: {}, updatedAt: null, history: [], lastPollAt: 0, receipts: {} }; this.queue = Promise.resolve(); this.history = ctx.storage.sql ? new History(ctx.storage.sql) : null;
    ctx.blockConcurrencyWhile(async () => { this.state = await ctx.storage.get('snapshot') || this.state; });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  webhookServices() {
    const secrets = { ...secretMap(this.env.WEBHOOK_SECRETS), ...secretMap(this.env.STATUSPAGE_TOKENS) };
    return new Set((this.env.WEBHOOK_SERVICES || '').split(',').map(x => x.trim()).filter(id => typeof secrets[id] === 'string' && secrets[id].length >= 32));
  }
  snapshot() {
    const hooks = this.webhookServices();
    return { type: 'snapshot', updatedAt: this.state.updatedAt, history: this.state.history, retentionDays:30, webhookActivity:this.state.webhookActivity || {}, services: SERVICES.map(({ url, parser, ...s }) => ({ ...s, status: 'unknown', incidents: [], ...this.state.services[s.id], sourceType:parser, componentSupport:parser === 'statuspage', nextCheckAt:this.state.services[s.id]?.checkedAt ? new Date(Date.parse(this.state.services[s.id].checkedAt) + (hooks.has(s.id) ? 3600000 : 300000)).toISOString() : null, mode: hooks.has(s.id) ? 'webhook' : 'scheduled', staleAfterMs: hooks.has(s.id) ? 75 * 60000 : 12 * 60000 })) };
  }
  enqueue(ids, force = false) {
    const run = this.queue.then(() => this.refresh(ids, force));
    this.queue = run.catch(() => {}); return run;
  }
  async refresh(ids, force) {
    const now = Date.now();
    if (!ids && !force && now - this.state.lastPollAt < 240000) return;
    const hooks = this.webhookServices();
    const selected = SERVICES.filter(s => ids ? ids.includes(s.id) : !hooks.has(s.id) || !this.state.services[s.id]?.lastSuccessAt || now - Date.parse(this.state.services[s.id].lastSuccessAt) >= 3600000 || this.state.services[s.id]?.error);
    // Four workers keep the subrequest connection count under Cloudflare's limit of six.
    let index = 0; const results = [];
    await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
      while (index < selected.length) { const service = selected[index++]; results.push(await collectService(service)); }
    }));
    for (const result of results) {
      const before = this.state.services[result.id];
      this.history?.record(result, hooks.has(result.id) ? 75*60000 : 12*60000);
      this.state.services[result.id] = mergeResult(before, result, hooks.has(result.id) ? 'webhook' : 'scheduled');
      if (before && before.status !== result.status) this.state.history.unshift({ id: crypto.randomUUID(), serviceId: result.id, from: before.status, to: result.status, at: result.checkedAt });
    }
    if (!this.state.prunedAt || now - this.state.prunedAt > 86400000) { this.history?.prune(now); this.state.prunedAt = now; }
    this.state.history = this.state.history.slice(0, 60);
    this.state.updatedAt = new Date().toISOString();
    if (!ids) this.state.lastPollAt = now;
    this.state.receipts = Object.fromEntries(Object.entries(this.state.receipts).filter(([, time]) => now - time < 600000));
    await this.ctx.storage.put('snapshot', this.state);
    const payload = JSON.stringify(this.snapshot());
    for (const socket of this.ctx.getWebSockets()) { try { socket.send(payload); } catch { try { socket.close(1011, 'Reconnect'); } catch {} } }
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
      if (this.ctx.getWebSockets().length >= 200) return json({ error: 'Connection capacity reached' }, 503);
      const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]); pair[1].send(JSON.stringify(this.snapshot()));
      if (!this.state.updatedAt) this.ctx.waitUntil(this.enqueue());
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/history') return json(this.history?.query({service:url.searchParams.get('service') || '',days:Number(url.searchParams.get('days') || 7),status:url.searchParams.get('status') || '',before:Number(url.searchParams.get('before') || 0)}) || {rows:[],totals:[]});
    if (url.pathname === '/refresh') { if (Object.keys(await this.ctx.storage.get('pending') || {}).length && !await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now()+1000); await this.enqueue(); return json({ ok: true }); }
    if (url.pathname === '/invalidate') {
      const { service, receipt } = await request.json();
      const key = `${service}:${receipt}`;
      let duplicate = false;
      await this.ctx.blockConcurrencyWhile(async () => {
        const now = Date.now();
        this.state.receipts = Object.fromEntries(Object.entries(this.state.receipts).filter(([, t]) => now - t < 600000));
        if (this.state.receipts[key]) { duplicate = true; return; }
        if (Object.keys(this.state.receipts).length >= 2000) throw new Error('Webhook capacity reached');
        const pending = await this.ctx.storage.get('pending') || {};
        pending[service] = crypto.randomUUID();
        this.state.receipts[key] = now;
        this.state.webhookActivity ||= {}; const activity = this.state.webhookActivity[service]; this.state.webhookActivity[service] = {lastAcceptedAt:new Date(now).toISOString(),count:(activity?.count || 0)+1};
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
      await this.ctx.storage.setAlarm(Date.now() + 30000); throw error;
    }
  }
  webSocketMessage(socket, message) { if (message !== 'ping') socket.close(1008, 'Read-only connection'); }
  webSocketClose(socket, code) { socket.close(code === 1005 ? 1000 : code); }
  webSocketError(socket) { socket.close(1011, 'Reconnect'); }
}
