// SSE endpoint — streams status updates to connected clients.
// Reads from KV (populated by poll.js), sends full snapshots when data changes.
// Falls back to polling upstream directly if KV is stale or empty.

import { pollAllServices } from './poll.js';

const POLL_INTERVAL_MS = 120_000; // 2 minutes — how often to re-poll upstream
const CHECK_INTERVAL_MS = 10_000; // 10 seconds — how often to check KV for changes
const LOCK_TTL_S = 90;            // KV lock TTL in seconds

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function acquireLock(kv) {
  if (!kv) return true;
  const existing = await kv.get('poll-lock', 'json');
  if (existing && (Date.now() - existing.ts) < LOCK_TTL_S * 1000) return false;
  await kv.put('poll-lock', JSON.stringify({ ts: Date.now() }), { expirationTtl: LOCK_TTL_S });
  return true;
}

async function getStatus(env) {
  if (!env?.STATUS_KV) return null;
  const raw = await env.STATUS_KV.get('all-statuses', 'text');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
          const current = await ensureFresh(env);
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
      'X-Accel-Buffering': 'no', // Disable nginx buffering if behind proxy
    },
  });
}
