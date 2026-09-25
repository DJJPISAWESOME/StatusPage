export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
});
export async function readLimited(response, limit = 1024 * 1024) {
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > limit) { await response.body?.cancel(); throw new HttpError(413, 'Body too large'); }
  if (!response.body) return '';
  const reader = response.body.getReader(); const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new HttpError(413, 'Body too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function upstream(url, { fetcher = fetch, accept = 'application/json', limit = 1024 * 1024, timeout = 12000, headers = {} } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    // Cloudflare Workers support manual redirects, but not redirect: 'error'.
    // A 3xx response is rejected by the non-OK check below without following it.
    const response = await fetcher(url, { headers: { Accept: accept, 'User-Agent': 'SignalStatus/2.0', ...headers }, signal: controller.signal, redirect: 'manual' });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Upstream HTTP ${response.status}`); }
    return await readLimited(response, limit);
  } finally { clearTimeout(timer); }
}
export function coordinates(lat, lon) {
  if (lat === null || lon === null || lat === undefined || lon === undefined || lat === '' || lon === '') throw new HttpError(400, 'Latitude and longitude are required');
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new HttpError(400, 'Invalid coordinates');
  return { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 };
}
export function secretMap(raw) { try { const d = JSON.parse(raw || '{}'); return d && !Array.isArray(d) && typeof d === 'object' ? d : {}; } catch { return {}; } }
const enc = new TextEncoder();
export async function verifyHmac(request, body, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'Webhook is not configured');
  const stamp = request.headers.get('X-Signal-Timestamp') || '';
  const id = request.headers.get('X-Signal-Id') || '';
  const signature = request.headers.get('X-Signal-Signature') || '';
  if (!/^\d{10}$/.test(stamp) || Math.abs(now - Number(stamp) * 1000) > 300000 || !/^[\w-]{8,100}$/.test(id) || !/^sha256=[a-f0-9]{64}$/.test(signature)) throw new HttpError(401, 'Invalid webhook authentication');
  const bytes = Uint8Array.from(signature.slice(7).match(/../g), x => parseInt(x, 16));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const message = `${stamp}.${id}.${new URL(request.url).pathname}.${body}`;
  if (!await crypto.subtle.verify('HMAC', key, bytes, enc.encode(message))) throw new HttpError(401, 'Invalid webhook authentication');
  return { id, timestamp: Number(stamp) * 1000 };
}
export async function equalSecret(a, b) {
  if (typeof b !== 'string' || b.length < 32 || typeof a !== 'string' || a.length > 256) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(b));
  return crypto.subtle.verify('HMAC', key, signature, enc.encode(a));
}
