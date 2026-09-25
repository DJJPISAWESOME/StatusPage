import { SERVICES } from './catalog.js';
import { json, HttpError, readLimited, verifyHmac, secretMap, equalSecret, coordinates } from './security.js';
import { visitorLocation, weather, geocode, marine } from './weather.js';
import { radioMetadata } from './radio.js';
export { StatusHub } from './hub.js';
const hub = env => env.STATUS_HUB.get(env.STATUS_HUB.idFromName('global-v2'));
export default {
  async fetch(request, env) {
    const url = new URL(request.url); const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const isHook = path.startsWith('/api/webhooks/');
      if (!isHook && request.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      if (!isHook && request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'Cross-origin requests are not allowed');
      if (!isHook && request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed');
      if (env.API_LIMITER && !(await env.API_LIMITER.limit({ key: `${isHook ? 'hook' : 'api'}:${request.headers.get('CF-Connecting-IP') || 'local'}` })).success) return json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': '60' });
      if (path === '/api/location') return json(visitorLocation(request.cf));
      if (path === '/api/status') return hub(env).fetch('https://hub/snapshot');
      if (path === '/api/live') {
        if (request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'Same-origin WebSocket required');
        return hub(env).fetch(new Request('https://hub/ws', request));
      }
      if (path === '/api/history') {
        const service=url.searchParams.get('service') || '', days=Number(url.searchParams.get('days') || 7), status=url.searchParams.get('status') || '', before=Number(url.searchParams.get('before') || 0);
        if ((service && !SERVICES.some(s=>s.id===service)) || ![1,7,30].includes(days) || !['','operational','degraded','outage','maintenance','unknown'].includes(status) || !Number.isSafeInteger(before) || before<0) throw new HttpError(400,'Invalid history filter');
        return hub(env).fetch(`https://hub/history?${new URLSearchParams({service,days,status,before})}`);
      }
      if (path === '/api/marine') return json(await marine(coordinates(url.searchParams.get('lat'),url.searchParams.get('lon')),env));
      if (path === '/api/weather') return json(await weather(coordinates(url.searchParams.get('lat'), url.searchParams.get('lon')), env));
      if (path === '/api/places') return json({ results: await geocode(url.searchParams.get('q')) });
      if (path === '/api/radio') return json(await radioMetadata(url.searchParams.get('station')));
      if (path === '/api/ping') return json({ time: Date.now() });
      if (path === '/api/network') return json({ colo: request.cf?.colo || null, country: request.cf?.country || null, region: request.cf?.region || null, protocol: request.cf?.httpProtocol || null, tls: request.cf?.tlsVersion || null, asOrganization: request.cf?.asOrganization || null, asn: request.cf?.asn || null });
      if (isHook) {
        if (request.method !== 'POST') throw new HttpError(405, 'POST required');
        const match = path.match(/^\/api\/webhooks\/(signed|statuspage)\/([a-z0-9-]+)$/);
        if (!match || !SERVICES.some(s => s.id === match[2])) throw new HttpError(404, 'Unknown integration');
        const [, kind, service] = match;
        // Workers limit inbound transfer separately; this application caps decoded bytes.
        const body = await readLimited(request, 65536);
        let receipt;
        if (kind === 'signed') {
          const proof = await verifyHmac(request, body, secretMap(env.WEBHOOK_SECRETS)[service]); receipt = proof.id;
        } else {
          if (!await equalSecret(url.searchParams.get('token'), secretMap(env.STATUSPAGE_TOKENS)[service])) throw new HttpError(401, 'Invalid callback token');
          // The native provider doesn't sign these notifications. Treat only as a refresh hint.
          // One refresh per service per 30-second bucket; payload cannot set status or a fetch URL.
          receipt = `native-${Math.floor(Date.now() / 30000)}`;
        }
        return hub(env).fetch('https://hub/invalidate', { method: 'POST', body: JSON.stringify({ service, receipt }) });
      }
      throw new HttpError(404, 'Not found');
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : 'Service temporarily unavailable' }, error instanceof HttpError ? error.status : 503);
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(hub(env).fetch('https://hub/refresh').then(r => { if (!r.ok) throw new Error('Status refresh failed'); })); }
};
