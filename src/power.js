import { coordinates } from './security.js';

// These utilities report regional totals, not a household's power status.
const SOURCES = {
  RI: { name: 'Rhode Island Energy', page: 'https://www.rienergy.com/site/outages-and-safety/outages-and-safety', map: 'https://outagemap.rienergy.com/omap', marker: /Customers currently without electric power\s*:?\s*([\d,]+)/i },
  MA: { name: 'National Grid', map: 'https://outagemap.ma.nationalgridus.com/', instance: '9cb2e5b7-d321-4575-a552-4ae7078cbc31', view: 'ec79df5b-2c54-4fb9-a86a-b20775678236' },
  NY: { name: 'National Grid', map: 'https://outagemap.ny.nationalgridus.com/', instance: '9cb2e5b7-d321-4575-a552-4ae7078cbc31', view: '1b69b604-7588-4753-8591-9f135a962a2f' }
};

export function powerRegion(point, preferred = '') {
  const { latitude: lat, longitude: lon } = coordinates(point.latitude, point.longitude);
  if (SOURCES[preferred]) return preferred;
  if (lat >= 41.14 && lat <= 42.02 && lon >= -71.91 && lon <= -71.12) return 'RI';
  if (lat >= 41.24 && lat <= 42.89 && lon >= -73.51 && lon <= -69.9) return 'MA';
  if (lat >= 40.48 && lat <= 45.02 && lon >= -79.77 && lon <= -71.85) return 'NY';
  return null;
}

export function parsePowerCount(html, marker) {
  // Only use a positive number with the exact source label. A redesign must fail closed.
  const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ');
  const match = text.match(marker);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

async function officialCount(source, fetcher) {
  if (source.instance) {
    const stateUrl = `https://kubra.io/stormcenter/api/v1/stormcenters/${source.instance}/views/${source.view}/currentState?preview=false`;
    const stateResponse = await fetcher(stateUrl, { signal: AbortSignal.timeout(8000) });
    if (!stateResponse.ok) return null;
    const path = (await stateResponse.json()).data?.interval_generation_data;
    if (typeof path !== 'string' || !/^[a-zA-Z0-9/_.-]{1,200}$/.test(path) || path.split('/').includes('..')) return null;
    const summaryResponse = await fetcher(`https://kubra.io/${path.replace(/^\//, '')}/public/summary-1/data.json`, { signal: AbortSignal.timeout(8000) });
    if (!summaryResponse.ok) return null;
    const count = (await summaryResponse.json()).summaryFileData?.totals?.[0]?.total_outages;
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }
  const response = await fetcher(source.page, { signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html' } });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null;
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 5_000_000) return null;
  return parsePowerCount((await response.text()).slice(0, 5_000_000), source.marker);
}

export async function powerStatus(point, preferred = '', fetcher = fetch, cache = globalThis.caches?.default) {
  const region = powerRegion(point, preferred), source = SOURCES[region];
  if (!source) return { available: false, active: false, region: null, reason: 'No supported utility for this location' };
  const key = new Request(`https://signal-cache.invalid/power-v1/${region}`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit.json(); }
  let count = null;
  try { count = await officialCount(source, fetcher); } catch { /* Unknown is not zero outages. */ }
  const result = { available: count !== null, active: count !== null && count > 0, count, countKind: source.instance ? 'outages' : 'customers', region, provider: source.name, mapUrl: source.map, checkedAt: new Date().toISOString(), scope: `${region} regional total` };
  if (cache) await cache.put(key, new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } }));
  return result;
}
