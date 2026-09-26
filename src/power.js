import { coordinates, upstream } from './security.js';

// These utilities report regional totals, not a household's power status.
const SOURCES = {
  RI: { name: 'Rhode Island Energy', page: 'https://www.rienergy.com/site/outages-and-safety/outages-and-safety', map: 'https://outagemap.rienergy.com/OMAP', marker: /Customers currently without electric power\s*:?\s*([\d,]+)/i },
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

export function parseLocalPower(data) {
  const county=data?.data?.find(row=>row.nm==='Bristol');
  const towns=['Warren','Bristol'].map(name=>{
    const row=county?.mun?.find(row=>row.nm===name);
    if(!Number.isSafeInteger(row?.nc)||row.nc<0)throw Error('Missing town total');
    return {name,count:row.nc};
  });
  return {towns,count:towns.reduce((sum,town)=>sum+town.count,0)};
}
async function localPower(fetcher) {
  const root='https://outagemap.rienergy.com/OMAP/api/Omap/';
  const summary=JSON.parse(await upstream(`${root}Outage/Tabular?opco=RI`,{fetcher}));
  const local=parseLocalPower(summary);
  let locations=[],locationsAvailable=false;
  try {
    const pins=JSON.parse(await upstream(`${root}Outage/Pins?opco=RI`,{fetcher,limit:4*1024*1024}));
    if(!Array.isArray(pins))throw Error('Missing pins');
    locations=pins.filter(p=>['WARREN','BRISTOL'].includes(p.mun)&&p.cty==='BRISTOL').map(p=>{
      const latitude=Number(p.a),longitude=Number(p.o);
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<41.6||latitude>41.8||longitude< -71.4||longitude> -71.1||!Number.isSafeInteger(p.nc)||p.nc<0)throw Error('Invalid outage location');
      return {latitude,longitude,count:p.nc,town:p.mun};
    });locationsAvailable=true;
  } catch { /* Town totals remain useful if map locations are unavailable. */ }
  return {...local,locations,locationsAvailable};
}

export async function powerStatus(point, preferred = '', fetcher = fetch, cache = globalThis.caches?.default) {
  const region = powerRegion(point, preferred), source = SOURCES[region];
  if (!source) return { available: false, active: false, region: null, reason: 'No supported utility for this location' };
  const key = new Request(`https://signal-cache.invalid/power-v2/${region}`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit.json(); }
  let count = null, local={};
  try { if(region==='RI'){local=await localPower(fetcher);count=local.count;}else count = await officialCount(source, fetcher); } catch { /* Unknown is not zero outages. */ }
  const result = { available: count !== null, active: count !== null && count > 0, count, countKind: source.instance ? 'outages' : 'customers', region, provider: source.name, mapUrl: source.map, checkedAt: new Date().toISOString(), scope: region==='RI'?'Warren & Bristol, RI':`${region} regional total`, ...local };
  if (cache) await cache.put(key, new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } }));
  return result;
}
