import { HttpError, json, upstream, readLimited } from './security.js';
import { STATIONS } from '../public/stations.js';
import { cachedJSON } from './weather.js';

export function youtubeId(input) {
  const raw = String(input || '').trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  let url;
  try { url = new URL(raw); }
  catch { throw new HttpError(400, 'Enter a YouTube or YouTube Music video link.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new HttpError(400, 'Use an HTTPS YouTube link.');
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)$/)?.[1];
  }
  if (!/^[\w-]{11}$/.test(id || '')) throw new HttpError(400, 'Use a single video link, not a playlist or channel.');
  return id;
}
export async function videoDetails(id, fetcher = fetch, cache = globalThis.caches?.default) {
  return cachedJSON(`request-video-v1/${id}`, 3600, async () => {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
    let data;
    try { data = JSON.parse(await upstream(endpoint, { fetcher, limit: 32768 })); }
    catch { throw new HttpError(422, 'This video is unavailable or cannot be embedded. Try another version.'); }
    if (typeof data.title !== 'string') throw new HttpError(422, 'Video information is unavailable.');
    return { videoId: id, title: data.title.slice(0, 200), artist: String(data.author_name || 'YouTube').slice(0, 120) };
  }, cache);
}
// Read public search-page data as JSON only; never execute upstream scripts.
export function parseYoutubeSearch(html) {
  const match = /(?:var\s+ytInitialData|window\["ytInitialData"\]|ytInitialData)\s*=\s*(\{)/.exec(html);
  if (!match) throw new Error('Search data unavailable');
  const start = match.index + match[0].length - 1;
  let depth = 0, quoted = false, escaped = false, end = -1;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && !--depth) { end = i + 1; break; }
  }
  if (end < 0) throw new Error('Incomplete search data');
  const data = JSON.parse(html.slice(start, end));
  const root = data.contents?.twoColumnSearchResultsRenderer?.primaryContents || data.contents?.sectionListRenderer;
  if (!root) throw new Error('Search layout unavailable');
  const text = value => value?.simpleText || value?.runs?.map(run => run.text || '').join('') || value?.content || '';
  const results = [], seen = new Set(), stack = [root];
  let inspected = 0;
  const add = (videoId, title, artist) => {
    if (/^[\w-]{11}$/.test(videoId || '') && title && !seen.has(videoId)) {
      seen.add(videoId);
      results.push({ videoId, title: String(title).slice(0, 200), artist: String(artist || 'YouTube').slice(0, 120) });
    }
  };
  while (stack.length && results.length < 8 && inspected++ < 30000) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (value.videoRenderer) {
      const video = value.videoRenderer;
      add(video.videoId, text(video.title), text(video.ownerText || video.longBylineText || video.shortBylineText));
      continue;
    }
    if (value.lockupViewModel) {
      const video = value.lockupViewModel;
      const metadata = video.metadata?.lockupMetadataViewModel;
      if (video.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        const row = metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text;
        add(video.contentId, text(metadata?.title), text(row));
      }
      continue;
    }
    if (value.adSlotRenderer || value.promotedSparklesWebRenderer || value.promotedVideoRenderer) continue;
    stack.push(...(Array.isArray(value) ? value : Object.values(value)).reverse());
  }
  return { results };
}
export async function searchYoutube(query, fetcher = fetch, cache = globalThis.caches?.default) {
  const q = String(query || '').trim();
  if (q.length < 2 || q.length > 100) throw new HttpError(400, 'Search using 2–100 characters.');
  return cachedJSON(`request-public-search-v1/${encodeURIComponent(q.toLowerCase())}`, 600, async () => {
    const params = new URLSearchParams({ search_query: q, hl: 'en', gl: 'US' });
    try {
      return parseYoutubeSearch(await upstream(`https://www.youtube.com/results?${params}`, {
        fetcher, accept: 'text/html', limit: 3 * 1024 * 1024, headers: { 'Accept-Language': 'en-US,en;q=0.9' }
      }));
    } catch {
      throw new HttpError(503, 'YouTube search is temporarily unavailable. Open Search on YouTube, then paste a video link here.');
    }
  }, cache);
}
const REQUESTER_COOKIE = '__Host-signal-requester';
const HOUR = 60 * 60 * 1000;
const REQUESTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Used only when REQUESTER_SECRET is unset, so local dev and tests need no real secret.
export const DEV_REQUESTER_SECRET = 'signal-dev-requester-secret-do-not-use-in-production';
const text = new TextEncoder();

export function requesterSecret(env) {
  const configured = env?.REQUESTER_SECRET;
  if (typeof configured === 'string' && configured.length >= 32) return configured;
  return DEV_REQUESTER_SECRET;
}
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', text.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, text.encode(message)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function signaturesMatch(expected, actual) {
  if (expected.length !== actual.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return mismatch === 0;
}
async function signRequester(id, secret) {
  return `${id}.${await hmacHex(secret, `requester:${id}`)}`;
}
function requesterCookieHeader(value) {
  return `${REQUESTER_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}
export function connectingIp(request) {
  const ip = request.headers.get('CF-Connecting-IP')?.trim() || '';
  if (!ip || ip.length > 45 || /[\s,;]/.test(ip)) return null;
  return ip;
}
export async function requesterCookie(request, env) {
  const raw = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${REQUESTER_COOKIE}=`))?.slice(REQUESTER_COOKIE.length + 1);
  if (!raw) return null;
  let value = raw;
  try { value = decodeURIComponent(raw); } catch { return null; }
  const match = value.match(/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/i);
  if (!match || !REQUESTER_ID.test(match[1])) return null;
  const id = match[1].toLowerCase();
  const expected = await hmacHex(requesterSecret(env), `requester:${id}`);
  return signaturesMatch(expected, match[2].toLowerCase()) ? id : null;
}
export async function quotaKeyFor(request, env, client) {
  const ip = connectingIp(request);
  if (!ip) return client;
  return `ip:${(await hmacHex(requesterSecret(env), `quota:${ip}`)).slice(0, 32)}`;
}
function quotaIdentity(entry) {
  return entry.quotaKey || entry.client;
}
function requesterQuota(state, client, now = Date.now(), quotaKey = client) {
  const recent = state.recent.filter(entry => quotaIdentity(entry) === quotaKey && !entry.refunded && now - entry.at < HOUR);
  const tail = [state.current, ...state.items].filter(Boolean).slice(-3);
  let consecutive = 0;
  for (const item of tail.reverse()) {
    if (item.requester !== client) break;
    consecutive++;
  }
  return {
    used: recent.length,
    remaining: Math.max(0, 6 - recent.length),
    limit: 6,
    consecutive,
    consecutiveLimit: 3,
    nextResetAt: recent.length ? Math.min(...recent.map(entry => entry.at)) + HOUR : null,
    serverTime: now
  };
}
const ROUTES = ['/api/requests', '/api/requests/search', '/api/requests/control', '/api/requests/remote', '/api/requests/remove'];
async function queueView(request, env, hub) {
  const existing = await requesterCookie(request, env);
  const client = existing || crypto.randomUUID();
  const quota = await quotaKeyFor(request, env, client);
  const response = await hub.fetch(`https://hub/requests?client=${encodeURIComponent(client)}&quota=${encodeURIComponent(quota)}`);
  const data = await response.json();
  const headers = existing ? {} : { 'Set-Cookie': requesterCookieHeader(await signRequester(client, requesterSecret(env))) };
  return json({ ...data, searchEnabled: true, playerEnabled: true }, response.status, headers);
}
async function postedJson(request) {
  let body;
  try { body = JSON.parse(await readLimited(request, 4096)); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid request');
  return body;
}
async function removeRequest(request, env, hub, body) {
  const client = await requesterCookie(request, env);
  if (!client) throw new HttpError(428, 'Reload the request page and allow cookies to manage your songs.');
  const quotaKey = await quotaKeyFor(request, env, client);
  return hub.fetch('https://hub/requests', { method: 'POST', body: JSON.stringify({ action: 'remove', client, quotaKey, id: body.id }) });
}
async function remoteRequest(request, env, hub, body) {
  const client = await requesterCookie(request, env);
  const quotaKey = client ? await quotaKeyFor(request, env, client) : null;
  return hub.fetch('https://hub/requests', {
    method: 'POST',
    body: JSON.stringify({ action: 'remote', client, quotaKey, command: body.command, id: body.id, volume: body.volume })
  });
}
async function addRequest(request, env, hub, body) {
  const client = await requesterCookie(request, env);
  if (!client) throw new HttpError(428, 'Reload the request page and allow cookies to submit songs.');
  const video = await videoDetails(youtubeId(body.url));
  const quotaKey = await quotaKeyFor(request, env, client);
  return hub.fetch('https://hub/requests', { method: 'POST', body: JSON.stringify({ action: 'add', video, client, quotaKey, requestId: body.requestId }) });
}
export async function requestRoute(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!ROUTES.includes(path)) throw new HttpError(404, 'Not found');
  if (request.method === 'GET' && path === '/api/requests/search') return json(await searchYoutube(url.searchParams.get('q')));
  const hub = env.STATUS_HUB.get(env.STATUS_HUB.idFromName('request-radio-v1'));
  if (request.method === 'GET' && path === '/api/requests') return queueView(request, env, hub);
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  if (request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'Same-origin request required');
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON required');
  const body = await postedJson(request);
  if (path === '/api/requests/remove') return removeRequest(request, env, hub, body);
  if (path === '/api/requests/remote') return remoteRequest(request, env, hub, body);
  if (path === '/api/requests/control') {
    return hub.fetch('https://hub/requests', {
      method: 'POST',
      body: JSON.stringify({ action: body.action, session: body.session, id: body.id, playback: body.playback, radio: body.radio })
    });
  }
  if (path !== '/api/requests') throw new HttpError(405, 'Method not allowed');
  return addRequest(request, env, hub, body);
}

// Stored separately from service observations. Transactions serialize queue and lease changes.
export class RequestQueue {
  constructor(storage) { this.storage = storage; }
  async handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const state = await this.storage.get('music') || this.empty();
      return json(this.public(state, url.searchParams.get('client'), url.searchParams.get('quota')));
    }
    const body = await request.json();
    try {
      return await this.storage.transaction(async tx => {
        const state = await tx.get('music') || this.empty(), now = Date.now();
        state.recent = state.recent.filter(entry => now - entry.at < 3600000);
        if (body.action === 'add') {
          if (this.applyAdd(state, body, now)) return json(this.public(state, body.client, body.quotaKey));
        } else if (body.action === 'remove') this.applyRemove(state, body);
        else if (body.action === 'remote') this.applyRemote(state, body, now);
        else this.applyPlayer(state, body, now);
        await tx.put('music', state);
        return json(this.public(state, body.client, body.quotaKey));
      });
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
      throw error;
    }
  }
  applyAdd(state, body, now) {
    if (!/^[\w-]{16,80}$/.test(body.requestId || '')) throw new HttpError(400, 'Invalid request ID');
    if (state.recent.some(entry => entry.id === body.requestId && entry.client === body.client)) return true;
    const queued = state.items.some(item => item.videoId === body.video.videoId) || state.current?.videoId === body.video.videoId;
    if (queued) throw new HttpError(409, 'That video is already playing or queued.');
    if (state.items.length >= 36) throw new HttpError(409, 'The queue has reached 36 songs. Please try again after a song plays.');
    const quotaKey = body.quotaKey || body.client;
    const quota = requesterQuota(state, body.client, now, quotaKey);
    if (quota.remaining === 0) {
      const minutes = Math.max(1, Math.ceil((quota.nextResetAt - now) / 60000));
      throw new HttpError(429, `You have used all 6 requests this hour. Your next slot opens in ${minutes} minute(s).`);
    }
    if (quota.consecutive >= 3) {
      throw Object.assign(new HttpError(429, 'You already have 3 songs in a row. Let someone else request a song, wait for your songs to play, or remove one of your queued songs.'), { code: 'consecutive_limit' });
    }
    const itemId = crypto.randomUUID();
    state.items.push({ ...body.video, id: itemId, addedAt: now, requester: body.client });
    state.recent.push({ id: body.requestId, itemId, client: body.client, quotaKey, at: now });
    return false;
  }
  applyRemove(state, body) {
    if (typeof body.id !== 'string' || !body.id) throw new HttpError(400, 'Choose a queued song to remove.');
    const index = state.items.findIndex(item => item.id === body.id);
    if (index < 0) throw new HttpError(409, 'That song has already started playing or is no longer queued.');
    const item = state.items[index];
    if (!body.client || item.requester !== body.client) throw new HttpError(403, 'You can only remove songs requested from this browser.');
    state.items.splice(index, 1);
    // Keep the receipt so retrying the original add cannot resurrect a removed song.
    // Timestamp matching supports songs queued before item IDs were added to receipts.
    const receipt = state.recent.find(entry => !entry.refunded && entry.client === body.client && (entry.itemId === item.id || (!entry.itemId && entry.at === item.addedAt)));
    if (receipt) receipt.refunded = true;
  }
  applyRemote(state, body, now) {
    if (!['pause', 'resume', 'rewind', 'skip', 'volume'].includes(body.command)) throw new HttpError(400, 'Invalid playback command');
    if (state.leaseUntil <= now || (!state.current && body.command !== 'volume')) throw new HttpError(409, 'Board playback is offline or idle.');
    if (body.command !== 'volume' && body.id !== state.current.id) throw new HttpError(409, 'The song changed. Please try again.');
    if (body.command === 'volume') {
      if (!Number.isFinite(body.volume) || body.volume < 0 || body.volume > 1) throw new HttpError(400, 'Volume must be between 0 and 1');
      state.remoteVolume = { value: body.volume, revision: (state.remoteVolume?.revision || 0) + 1 };
    } else if (body.command === 'skip') {
      state.current = state.items.shift() || null;
      state.transport = null;
      state.playback = null;
    } else {
      const previous = state.transport || { revision: 0, paused: false, rewind: 0 };
      state.transport = {
        revision: previous.revision + 1,
        paused: body.command === 'pause' ? true : body.command === 'resume' ? false : previous.paused,
        rewind: previous.rewind + (body.command === 'rewind' ? 1 : 0)
      };
    }
  }
  applyPlayer(state, body, now) {
    if (!/^[\w-]{16,80}$/.test(body.session || '')) throw new HttpError(400, 'Invalid player session');
    if (!['claim', 'takeover', 'heartbeat', 'next', 'release'].includes(body.action)) throw new HttpError(400, 'Invalid player action');
    if (body.action === 'claim' || body.action === 'takeover') {
      if (body.action !== 'takeover' && state.leaseUntil > now && state.owner !== body.session) throw new HttpError(409, 'Another Board is playing this queue. Stop it first or wait one minute.');
      state.owner = body.session;
    } else if (state.owner !== body.session || state.leaseUntil <= now) throw new HttpError(409, 'Player session expired. Press Play to reconnect.');
    if (body.action === 'next') {
      // Compare-and-swap protects against duplicate end/error callbacks and retries.
      if ((state.current?.id || null) === (body.id || null)) {
        state.current = state.items.shift() || null;
        state.transport = null;
        state.playback = null;
      }
    } else if (['claim', 'takeover'].includes(body.action) && !state.current) state.current = state.items.shift() || null;
    if (['claim', 'takeover', 'release'].includes(body.action)) state.radio = null;
    if (body.action === 'heartbeat') {
      const station = STATIONS.find(item => item.id === body.radio?.station);
      const clean = value => typeof value === 'string' ? value.trim().slice(0, 200) : null;
      state.radio = !state.current && station ? {
        station: station.id, name: station.name, title: clean(body.radio.title), artist: clean(body.radio.artist),
        song: clean(body.radio.song), playing: body.radio.playing === true, at: now
      } : null;
    }
    if (body.action === 'heartbeat' && body.id === state.current?.id && body.playback) {
      const playback = body.playback;
      if (Number.isFinite(playback.position) && Number.isFinite(playback.duration) && playback.position >= 0 && playback.duration >= 0 && playback.duration <= 604800) {
        state.playback = {
          position: Math.min(playback.position, playback.duration),
          duration: playback.duration,
          paused: playback.paused === true,
          volume: Number.isFinite(playback.volume) ? Math.max(0, Math.min(1, playback.volume)) : null,
          at: now
        };
      }
    }
    if (body.action === 'release') { state.owner = null; state.leaseUntil = 0; }
    else state.leaseUntil = now + 45000;
  }
  empty() { return { items: [], current: null, owner: null, leaseUntil: 0, recent: [] }; }
  public(state, client, quotaKey) {
    const visible = item => {
      if (!item) return null;
      const { requester, ...song } = item;
      return { ...song, canRemove: !!client && requester === client && item !== state.current };
    };
    const key = quotaKey || client;
    return {
      queueLimit: 36,
      ...(client ? { requester: requesterQuota(state, client, Date.now(), key) } : {}),
      current: visible(state.current),
      items: state.items.map(visible),
      playerOnline: state.leaseUntil > Date.now(),
      radio: state.leaseUntil > Date.now() && !state.current ? state.radio || null : null,
      remoteVolume: state.remoteVolume || null,
      transport: state.transport || null,
      playback: state.playback || null
    };
  }
}
