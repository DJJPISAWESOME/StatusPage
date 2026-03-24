import routes from '../routes.json';

const { static: ROUTES, special } = routes;
const UA = 'Mozilla/5.0 (compatible; StatusMonitor/1.0)';
const SPECIAL_KEYS = new Set(special);
const SVC_KEY_RE = /^[a-z0-9][a-z0-9\-]{0,63}$/;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_CONTENT_TYPES = ['application/json', 'application/xml', 'text/xml', 'text/plain', 'text/html', 'application/rss+xml', 'application/atom+xml'];

function sanitizeContentType(raw) {
  if (!raw) return 'text/plain';
  const mime = raw.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(mime) ? raw : 'text/plain';
}

async function fetchSpecialRoute(key, env) {
  if (key === 'wror-now-playing') {
    const resp = await fetch('https://playerservices.streamtheworld.com/api/livestream-redirect/WRORFM.mp3', {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': UA,
        Range: 'bytes=0-65535',
      },
    });
    if (!resp.ok || !resp.body) throw new Error(`upstream ${resp.status}`);
    const metaInt = Number(resp.headers.get('icy-metaint') || 0);
    if (!Number.isFinite(metaInt) || metaInt <= 0) {
      throw new Error('missing icy-metaint');
    }

    const reader = resp.body.getReader();
    let chunk = new Uint8Array(0);
    let totalRead = 0;
    // Read enough bytes to cover several metadata blocks so we can skip
    // station-identification announcements ("Station ID", call-sign-only, etc.)
    // and find a real song title.
    const targetBytes = Math.min(metaInt * 6 + 4096, 360000);
    while (totalRead < targetBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      totalRead += value.length;
      const merged = new Uint8Array(chunk.length + value.length);
      merged.set(chunk);
      merged.set(value, chunk.length);
      chunk = merged;
    }
    await reader.cancel().catch(() => {});

    // Titles that are station housekeeping, not a song.
    const isNonSong = t => /^(station\s+id|sign[\s-]?off|[\w-]+fm|[\w-]+am|[\w-]+hd\d?)$/i.test(t);

    let songtitle = '';
    for (let pos = metaInt; pos < chunk.length; ) {
      const metaLen = (chunk[pos] || 0) * 16;
      const metaStart = pos + 1;
      const metaEnd = Math.min(chunk.length, metaStart + metaLen);
      const rawMeta = new TextDecoder('utf-8').decode(chunk.slice(metaStart, metaEnd));
      const m = rawMeta.match(/StreamTitle='([^']*)';/i);
      if (m?.[1]) {
        const title = m[1].trim();
        if (title && !isNonSong(title)) { songtitle = title; break; }
      }
      pos = metaEnd + metaInt;
    }

    return new Response(JSON.stringify({ songtitle }), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    });
  }

  if (key === 'iheart-hjy-now-playing') {
    const resp = await fetch('https://stream.revma.ihrhls.com/zc2049', {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': UA,
        Range: 'bytes=0-65535',
      },
    });
    if (!resp.ok || !resp.body) throw new Error(`upstream ${resp.status}`);
    const metaInt = Number(resp.headers.get('icy-metaint') || 0);
    if (!Number.isFinite(metaInt) || metaInt <= 0) {
      throw new Error('missing icy-metaint');
    }

    const reader = resp.body.getReader();
    let chunk = new Uint8Array(0);
    let totalRead = 0;
    const targetBytes = Math.min(metaInt * 6 + 4096, 360000);
    while (totalRead < targetBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      totalRead += value.length;
      const merged = new Uint8Array(chunk.length + value.length);
      merged.set(chunk);
      merged.set(value, chunk.length);
      chunk = merged;
    }
    await reader.cancel().catch(() => {});

    let songtitle = '';
    for (let pos = metaInt; pos < chunk.length; ) {
      const metaLen = (chunk[pos] || 0) * 16;
      const metaStart = pos + 1;
      const metaEnd = Math.min(chunk.length, metaStart + metaLen);
      const rawMeta = new TextDecoder('utf-8').decode(chunk.slice(metaStart, metaEnd));
      const m = rawMeta.match(/StreamTitle='([^']*)';/i);
      if (m?.[1]) {
        const raw = m[1].trim();
        // iHeart RevMA embeds key=value attributes in StreamTitle.
        // song_spot="M" = music; "T" = talk/station-id; skip anything non-music.
        const songSpot = (raw.match(/\bsong_spot="([^"]*)"/i) || [])[1] || '';
        if (songSpot && songSpot.toUpperCase() !== 'M') { pos = metaEnd + metaInt; continue; }
        // Strip all key=value attribute pairs appended after the title
        const title = raw.replace(/\s+\w[\w-]*="[^"]*".*$/s, '').replace(/\s*-\s*$/, '').trim();
        if (title) { songtitle = title; break; }
      }
      pos = metaEnd + metaInt;
    }

    return new Response(JSON.stringify({ songtitle }), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    });
  }

  if (key === 'ioda-na-outages') {
    const until = Math.floor(Date.now() / 1000);
    const from = until - 86400;
    const url = `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=${from}&until=${until}&entityType=country&relatedTo=continent/NA&limit=50`;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!resp.ok) throw new Error(`upstream ${resp.status}`);
    return new Response(await resp.text(), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': sanitizeContentType(resp.headers.get('content-type')),
      },
    });
  }

  if (key === 'radar-us-anomalies') {
    const token = env.CF_RADAR_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ noToken: true }), {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
        },
      });
    }

    const resp = await fetch(
      'https://api.cloudflare.com/client/v4/radar/traffic_anomalies?location=US&location=CA&location=MX&status=VERIFIED&format=json',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': UA,
        },
      },
    );
    if (!resp.ok) throw new Error(`upstream ${resp.status}`);
    return new Response(await resp.text(), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': sanitizeContentType(resp.headers.get('content-type')),
      },
    });
  }

  // Adobe status endpoints block generic bot User-Agents; use a browser-like UA
  // with a Referer so their WAF passes the request through.
  if (key === 'adobe-registry' || key === 'adobe-events') {
    const adobeUrls = {
      'adobe-registry': 'https://data.status.adobe.com/adobestatus/SnowServiceRegistry',
      'adobe-events':   'https://data.status.adobe.com/adobestatus/StatusEvents',
    };
    const resp = await fetch(adobeUrls[key], {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://status.adobe.com/',
      },
    });
    if (!resp.ok) throw new Error(`upstream ${resp.status}`);
    const body = await resp.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': sanitizeContentType(resp.headers.get('content-type')),
      },
    });
  }

  if (key === 'time-gov') {
    const t0 = Date.now();
    const resp = await fetch('https://time.gov/', { method: 'HEAD' });
    const t1 = Date.now();
    const serverDateStr = resp.headers.get('Date');
    let epochMs = t1; // fallback to proxy's own clock
    if (serverDateStr) {
      const parsed = Date.parse(serverDateStr);
      if (Number.isFinite(parsed)) {
        // Correct for proxy-to-time.gov RTT so epochMs ≈ "now" on the proxy
        epochMs = parsed + Math.round((t1 - t0) / 2);
      }
    }
    return new Response(JSON.stringify({ epochMs }), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    });
  }

  throw new Error('unknown special key');
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('svc');

  if (!key || !SVC_KEY_RE.test(key)) {
    return new Response(JSON.stringify({ error: 'Invalid or missing svc parameter' }), {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  if (SPECIAL_KEYS.has(key)) {
    try {
      return await fetchSpecialRoute(key, env);
    } catch {
      return new Response(JSON.stringify({ error: 'Upstream service error' }), {
        status: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }
  }

  if (!ROUTES[key]) {
    return new Response(JSON.stringify({ error: 'Unknown service key' }), {
      status: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    const upstream = await fetch(ROUTES[key], {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, application/xml, text/html, text/plain, */*',
      },
    });

    const contentLength = parseInt(upstream.headers.get('content-length'), 10);
    if (contentLength > MAX_RESPONSE_BYTES) {
      return new Response(JSON.stringify({ error: 'Upstream response too large' }), {
        status: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    const body = await upstream.text();
    if (body.length > MAX_RESPONSE_BYTES) {
      return new Response(JSON.stringify({ error: 'Upstream response too large' }), {
        status: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    return new Response(body, {
      status: upstream.ok || upstream.status === 204 ? 200 : 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': sanitizeContentType(upstream.headers.get('content-type')),
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Upstream fetch error' }), {
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }
}
