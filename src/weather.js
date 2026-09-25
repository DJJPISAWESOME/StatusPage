import { coordinates, upstream, json, HttpError } from './security.js';
export const MODELS = [
  { id: 'ecmwf_aifs025_single', name: 'ECMWF AIFS', kind: 'AI', description: 'Global AI model · native 6-hour steps; hourly values interpolated' },
  { id: 'ncep_aigfs025', name: 'NOAA AIGFS', kind: 'AI', description: 'NOAA global AI forecast; hourly values may be interpolated' }
];
export function visitorLocation(cf = {}) {
  try {
    const point = coordinates(cf.latitude, cf.longitude);
    return { ...point, label: [cf.city, cf.regionCode || cf.region, cf.country].filter(Boolean).join(', ') || 'Approximate IP location', regionCode: cf.regionCode, source: 'cloudflare', timezone: cf.timezone || 'America/New_York' };
  } catch {
    return { latitude: 41.82, longitude: -71.41, label: 'Providence, RI', source: 'fallback', timezone: 'America/New_York' };
  }
}
export async function cachedJSON(key, ttl, task, cache) {
  const request = new Request(`https://signal-cache.invalid/${key}`);
  if (cache) { const hit = await cache.match(request); if (hit) return hit.json(); }
  const value = { ...await task(), fetchedAt: new Date().toISOString() };
  if (cache) await cache.put(request, json(value, 200, { 'Cache-Control': `public, max-age=${ttl}` }));
  return value;
}
export async function weather(point, env = {}, fetcher = fetch, cache = globalThis.caches?.default) {
  const { latitude, longitude } = coordinates(point.latitude, point.longitude);
  const host = env.OPEN_METEO_API_KEY ? 'customer-api.open-meteo.com' : 'api.open-meteo.com';
  const base = new URLSearchParams({ latitude, longitude, temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: 'auto', timeformat: 'unixtime', forecast_days: '5' });
  if (env.OPEN_METEO_API_KEY) base.set('apikey', env.OPEN_METEO_API_KEY);
  const tasks = MODELS.map(model => cachedJSON(`model-v2/${model.id}/${latitude}/${longitude}`, 1800, async () => {
    const query = new URLSearchParams(base); query.set('models', model.id); query.set('hourly', 'temperature_2m,wind_speed_10m');
    const data = JSON.parse(await upstream(`https://${host}/v1/forecast?${query}`, { fetcher }));
    if (!Array.isArray(data.hourly?.time) || !data.hourly.temperature_2m?.some(Number.isFinite)) throw new Error('Model data unavailable');
    const metadata = await cachedJSON(`metadata/${model.id}`,600,async()=>{const meta=JSON.parse(await upstream(`https://${host}/data/${model.id}/static/meta.json${env.OPEN_METEO_API_KEY ? '?apikey='+encodeURIComponent(env.OPEN_METEO_API_KEY) : ''}`,{fetcher,limit:10000}));if(!Number.isFinite(meta.last_run_initialisation_time)||!Number.isFinite(meta.last_run_availability_time))throw new Error('Model metadata unavailable');return meta;},cache).catch(()=>null);
    return { ...model, metadata, available: true, timezone: data.timezone, hourly: data.hourly, units: data.hourly_units };
  }, cache).catch(() => ({ ...model, available: false, error: 'Model unavailable. No substitute model is shown.' })));
  const currentTask = cachedJSON(`current-v5/${latitude}/${longitude}`, 900, async () => {
    const query = new URLSearchParams(base); query.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m,cloud_cover');
    query.set('hourly','temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation_probability,precipitation,wind_gusts_10m,dew_point_2m,cloud_cover,is_day');
    query.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset');
    const data = JSON.parse(await upstream(`https://${host}/v1/forecast?${query}`, { fetcher }));
    if (!Number.isFinite(data.current?.temperature_2m)) throw new Error('Weather unavailable');
    return { current: data.current, hourly: data.hourly, daily: data.daily, timezone: data.timezone, source: 'Open-Meteo best match · model estimate' };
  }, cache).catch(() => ({ error: 'Current weather unavailable' }));
  const alertsTask = cachedJSON(`alerts-v1/${latitude}/${longitude}`, 300, async () => {
    const data = JSON.parse(await upstream(`https://api.weather.gov/alerts/active?point=${latitude},${longitude}`, { fetcher, headers: { 'User-Agent': `SignalStatus/2.0 (${env.WEATHER_CONTACT || 'https://example.com/contact'})` } }));
    if (!Array.isArray(data.features)) throw new Error('Alerts unavailable');
    return { available: true, items: data.features.filter(x => x.properties?.status === 'Actual').slice(0, 10).map(x => ({ id: x.id, event: x.properties.event, severity: x.properties.severity, headline: x.properties.headline, description: String(x.properties.description || '').slice(0, 3000), expires: x.properties.expires, instruction: String(x.properties.instruction || '').slice(0, 2000) })) };
  }, cache).catch(() => ({ available: false, items: [], error: 'NWS alert coverage unavailable for this location' }));
  const [models, conditions, alerts] = await Promise.all([Promise.all(tasks), currentTask, alertsTask]);
  return { latitude, longitude, models, conditions, alerts, servedAt: new Date().toISOString() };
}
export async function geocode(name, fetcher = fetch) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 80) throw new HttpError(400, 'Enter a city or postal code');
  const params = new URLSearchParams({ name: name.trim(), count: '6', language: 'en', format: 'json' });
  const d = JSON.parse(await upstream(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { fetcher, limit: 100000 }));
  return (d.results || []).map(x => ({ ...coordinates(x.latitude, x.longitude), label: [x.name, x.admin1, x.country_code].filter(Boolean).join(', '), regionCode: ({'Rhode Island':'RI','Massachusetts':'MA','New York':'NY'})[x.admin1], timezone: x.timezone, source: 'manual' }));
}

export async function marine(point,env={},fetcher=fetch,cache=globalThis.caches?.default) {
  const {latitude,longitude}=coordinates(point.latitude,point.longitude);
  return cachedJSON(`marine/${latitude}/${longitude}`,1800,async()=>{
    const params=new URLSearchParams({latitude,longitude,hourly:'wave_height,wave_period,wave_direction',length_unit:'imperial',timezone:'auto',timeformat:'unixtime',forecast_days:'2',cell_selection:'sea'});
    if(env.OPEN_METEO_API_KEY)params.set('apikey',env.OPEN_METEO_API_KEY);
    const host=env.OPEN_METEO_API_KEY?'customer-marine-api.open-meteo.com':'marine-api.open-meteo.com';
    const data=JSON.parse(await upstream(`https://${host}/v1/marine?${params}`,{fetcher}));
    if(!data.hourly?.wave_height?.some(Number.isFinite))throw new HttpError(503,'Coastal forecast unavailable for this location');
    return {latitude:data.latitude,longitude:data.longitude,timezone:data.timezone,hourly:data.hourly,units:data.hourly_units};
  },cache);
}
