// SSE endpoint — streams status updates to connected clients.
// Reads from KV (populated by poll.js), sends full snapshots when data changes.
// Falls back to polling upstream directly if KV is stale or empty.
//
// Free-plan optimizations:
// - 30s check interval (vs 10s) to reduce KV reads (~120/hr per client)
// - Cache API as a read-through buffer — all clients on the same colo share
//   a single KV read per 30s window, massively reducing KV usage at scale

import { pollAllServices } from './poll.js';

const POLL_INTERVAL_MS = 120_000; // 2 minutes — how often to re-poll upstream
const CHECK_INTERVAL_MS = 30_000; // 30 seconds — how often to check for changes
const LOCK_TTL_S = 90;            // KV lock TTL in seconds
const CACHE_TTL_S = 25;           // Cache API TTL (< CHECK_INTERVAL to avoid stale reads)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function acquireLock(kv) {
  if (!kv) return true;
  const existing = await kv.get('poll-lock', 'json');
  if (existing && (Date.now() - existing.ts) < LOCK_TTL_S * 1000) return false;
  await kv.put('poll-lock', JSON.stringify({ ts: Date.now() }), { expirationTtl: LOCK_TTL_S });
  return true;
}

// Read status from Cache API first, falling back to KV.
// This dramatically reduces KV reads when multiple clients connect to the same colo.
async function getStatus(env) {
  if (!env?.STATUS_KV) return null;

  // Try Cache API first (free, unlimited, per-colo)
  const cacheKey = new Request('https://status-internal/all-statuses');
  const cache = caches.default;
  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      if (data && (Date.now() - data.ts) < POLL_INTERVAL_MS) return data;
    }
  } catch { /* cache miss or parse error — fall through to KV */ }

  // Fall back to KV
  const raw = await env.STATUS_KV.get('all-statuses', 'text');
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    // Populate cache for subsequent reads from this colo
    try {
      await cache.put(cacheKey, new Response(raw, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `s-maxage=${CACHE_TTL_S}` },
      }));
    } catch { /* cache put failure is non-fatal */ }
    return data;
  } catch { return null; }
}

async function ensureFresh(env) {
  const cached = await getStatus(env);
  if (cached && (Date.now() - cached.ts) < POLL_INTERVAL_MS) return cached;
  // Data is stale or missing — try to poll
  const gotLock = await acquireLock(env?.STATUS_KV);
  if (!gotLock) {
    // Another connection is polling; wait briefly and re-read
    await sleep(3000);
    return (await getStatus(env)) || cached;
  }
  try {
    return await pollAllServices(env);
  } catch {
    return cached;
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // Validate request method
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const write = (eventType, data) =>
    writer.write(encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`));

  const keepalive = () =>
    writer.write(encoder.encode(': keepalive\n\n'));

  // Background loop: send initial snapshot then check for updates
  context.waitUntil((async () => {
    let lastTs = 0;
    let running = true;

    // Listen for client disconnect
    request.signal.addEventListener('abort', () => { running = false; });

    try {
      // Send initial full snapshot
      const initial = await ensureFresh(env);
      if (initial) {
        await write('snapshot', { ts: initial.ts, results: initial.results });
        lastTs = initial.ts;
      }

      // Poll loop
      while (running) {
        await sleep(CHECK_INTERVAL_MS);
        if (!running) break;

        try {
          const current = await getStatus(env);
          // If data is stale, trigger a background refresh
          if (!current || (Date.now() - (current?.ts || 0)) >= POLL_INTERVAL_MS) {
            ensureFresh(env).catch(() => {});
          }
          if (current && current.ts > lastTs) {
            await write('update', { ts: current.ts, results: current.results });
            lastTs = current.ts;
          } else {
            await keepalive();
          }
        } catch {
          await keepalive();
        }
      }
    } catch {
      // Connection closed
    } finally {
      try { await writer.close(); } catch { /* already closed */ }
    }
  })());

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no', // Disable nginx buffering if behind proxy
    },
  });
}
