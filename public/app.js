import { initEnhancements } from './enhancements.js';
import { RadioRecovery } from './radio-player.js';
import { STATIONS } from './stations.js';
import { initTV } from './tv.js';
const $ = id => document.getElementById(id);
const store = { get(key, fallback = null) { try { const value = localStorage.getItem(`signal:${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(`signal:${key}`, JSON.stringify(value)); } catch {} }, delete(key) { try { localStorage.removeItem(`signal:${key}`); } catch {} } };
const state = { services: [], history: [], filter: 'all', expanded: false, search: '', favorites: new Set(Array.isArray(store.get('favorites', [])) ? store.get('favorites', []) : []), place: null, forecast: null, socket: null, reconnect: null, fallback: null, attempts: 0, weatherVersion: 0 };
const labels = { operational: 'Operational', degraded: 'Degraded', outage: 'Outage', maintenance: 'Maintenance', unknown: 'Unconfirmed' };
const rank = { outage: 0, degraded: 1, maintenance: 2, unknown: 3, operational: 4 };
function el(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function replace(id, ...nodes) { $(id).replaceChildren(...nodes); }
function num(value, suffix = '', digits = 0) { return Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—'; }
function time(value, options = {}) { const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: state.forecast?.conditions?.timezone || state.place?.timezone || undefined, ...options }) : '—'; }
function age(value) { const min = Math.floor((Date.now() - Date.parse(value)) / 60000); return !Number.isFinite(min) ? 'Not checked' : min < 1 ? 'Just now' : min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`; }
function notify(text) { $('notice').textContent = text; $('notice').hidden = !text; }
async function api(path, { signal } = {}) { const r = await fetch(path, { signal: signal || AbortSignal.timeout(25000), cache: 'no-store' }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }
function effective(s) { return s.checkedAt && Date.now() - Date.parse(s.checkedAt) > s.staleAfterMs ? 'unknown' : s.status; }
function statusLabel(s) { return effective(s) !== s.status ? 'Stale · unconfirmed' : s.error ? 'Source unavailable' : s.note ? 'Update feed' : labels[s.status] || 'Unconfirmed'; }
function renderSummary() {
  const count = key => state.services.filter(s => effective(s) === key).length;
  const issues = count('outage') + count('degraded') + count('maintenance'); const unknown = count('unknown'); const healthy = count('operational');
  $('healthy-count').textContent = healthy; $('issue-count').textContent = issues; $('unknown-count').textContent = unknown;
  $('health-title').textContent = !state.services.length ? 'Getting the picture.' : issues ? `${issues} signal${issues === 1 ? '' : 's'} to watch.` : unknown ? 'Quiet, with a few unknowns.' : 'Everything is looking good.';
  $('health-description').textContent = `${healthy} operational · ${issues} reporting issues or maintenance · ${unknown} unconfirmed. Open a service for context.`;
  $('health-badge').textContent = !state.services.length ? 'Awaiting data' : issues ? 'Attention needed' : unknown ? 'Partial visibility' : 'All operational';
  $('nav-count').textContent = state.services.length; $('service-total').textContent = state.services.length;
}
function renderServices() {
  const focus = document.activeElement?.dataset?.focus;
  const rows = state.services.filter(s => {
    const f = state.filter;
    return (f === 'all' || (f === 'attention' && effective(s) !== 'operational') || (f === 'favorites' && state.favorites.has(s.id)) || f === s.category) && `${s.name} ${statusLabel(s)}`.toLowerCase().includes(state.search);
  }).sort((a, b) => rank[effective(a)] - rank[effective(b)] || a.name.localeCompare(b.name));
  const limited = state.filter === 'all' && !state.search && !state.expanded && !document.body.classList.contains('board-mode');
  $('services-more').hidden = state.filter !== 'all' || !!state.search || rows.length <= 12 || document.body.classList.contains('board-mode');
  $('services-more').textContent = state.expanded ? 'Show fewer services' : `Show all ${rows.length} services ↓`;
  const cards = (limited ? rows.slice(0,12) : rows).map(s => {
    const card = el('article', 'service-card');
    card.append(el('span', 'service-mark', s.name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()));
    const button = el('button', 'service-open'); button.dataset.focus = `open-${s.id}`; button.setAttribute('aria-label', `${s.name}: ${statusLabel(s)}. View details`);
    const detail = el('span', `service-status status-${effective(s)}`); detail.append(el('i', 'dot'), document.createTextNode(statusLabel(s)));
    button.append(el('span', 'service-name', s.name), detail); button.addEventListener('click', () => showService(s.id));
    const star = el('button', 'star', state.favorites.has(s.id) ? '★' : '☆'); star.dataset.focus = `star-${s.id}`; star.setAttribute('aria-label', `Star ${s.name}`); star.setAttribute('aria-pressed', String(state.favorites.has(s.id)));
    star.addEventListener('click', () => { state.favorites.has(s.id) ? state.favorites.delete(s.id) : state.favorites.add(s.id); store.set('favorites', [...state.favorites]); renderServices(); });
    card.append(button, star); return card;
  });
  replace('service-grid', ...(cards.length ? cards : [el('p', 'empty', 'No services match this view. Try another filter.')]));
  if (focus) document.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}
function showService(id) {
  const s = state.services.find(x => x.id === id); if (!s) return;
  $('service-dialog-title').textContent = s.name;
  const body = $('service-dialog-body'); body.replaceChildren(el('p', `status-${effective(s)}`, statusLabel(s)), el('p', 'fine-print', `Last check: ${s.checkedAt ? new Date(s.checkedAt).toLocaleString() : 'Awaiting first check'}. ${s.mode === 'webhook' ? 'Webhook notifications with hourly reconciliation.' : 'Shared scheduled collection every five minutes.'}`));
  if (s.lastSuccessAt) body.append(el('p', 'fine-print', `Last successful fetch: ${new Date(s.lastSuccessAt).toLocaleString()}`));
  if (s.scope) body.append(el('p','fine-print',`Coverage: ${s.scope}`));
  if (s.error || s.note) body.append(el('p', 'fine-print', s.error || s.note));
  for (const item of s.incidents || []) { const row = el('section', 'incident-detail'); row.append(el('h3', '', item.title), el('p', '', item.body)); if (item.updatedAt) row.append(el('p', 'fine-print', `Provider update: ${new Date(item.updatedAt).toLocaleString()}`)); body.append(row); }
  if (!s.incidents?.length) body.append(el('p', 'fine-print', s.status === 'operational' ? 'The provider reports operational status.' : 'No incident details are currently available.'));
  const a = el('a', 'detail-link', 'Open provider status page ↗'); a.href = s.homepage; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a);
  $('service-dialog').showModal();
}
function renderActivity() {
  replace('activity', ...state.history.slice(0, 6).map(x => { const row = el('div', 'activity-row'); row.append(el('span', '', state.services.find(s => s.id === x.serviceId)?.name || x.serviceId), el('small', '', age(x.at)), el('small', `status-${x.to}`, `${labels[x.from]} → ${labels[x.to]}`)); return row; }));
  if (!state.history.length) replace('activity', el('p', 'muted small', 'No changes recorded yet. New status changes will appear here.'));
}
function receive(snapshot) {
  if (!Array.isArray(snapshot.services)) return;
  if (snapshot.demo) notify('DESIGN PREVIEW · Synthetic service and weather data. Run with Cloudflare for live data.');
  state.rawSnapshot = snapshot; snapshot = enhancements.processSnapshot(snapshot); state.services = snapshot.services; state.history = snapshot.history || []; state.updatedAt = snapshot.updatedAt;
  tv?.update({ snapshot });
  renderSummary(); renderServices(); renderActivity(); $('last-updated').textContent = snapshot.updatedAt ? `Checked ${age(snapshot.updatedAt)}` : 'First collection in progress';
}
async function loadStatus() { try { receive(await api('/api/status')); } catch { $('connection-detail').textContent = 'Status feed unavailable'; } }
function connection(live, text) { $('connection-dot').classList.toggle('live', live); $('connection-label').textContent = text; $('connection-detail').textContent = live ? 'Updates pushed as they arrive' : 'One shared fallback request / minute'; }
function connect() {
  if ((document.hidden && !enhancements.backgroundAlerts()) || state.socket?.readyState === WebSocket.OPEN || state.socket?.readyState === WebSocket.CONNECTING) return;
  clearTimeout(state.reconnect);
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`); state.socket = socket;
  socket.addEventListener('open', () => { state.attempts = 0; connection(true, 'Live connection'); clearInterval(state.fallback); state.fallback = null; });
  socket.addEventListener('message', event => { if (event.data === 'pong') return; try { const d = JSON.parse(event.data); if (d.type === 'snapshot') receive(d); } catch {} });
  socket.addEventListener('close', () => {
    if (state.socket !== socket) return;
    state.socket = null; connection(false, document.hidden ? 'Paused in background' : 'Reconnecting');
    if (!document.hidden || enhancements.backgroundAlerts()) { state.reconnect = setTimeout(connect, Math.min(60000, 1000 * 2 ** state.attempts++) + Math.random() * 1000); if (!state.fallback) state.fallback = setInterval(loadStatus, 60000); }
  });
  socket.addEventListener('error', () => socket.close());
}
function condition(code) { if (code === 0) return ['Clear sky', '☀']; if ([1, 2, 3].includes(code)) return ['Partly to mostly cloudy', '◒']; if ([45, 48].includes(code)) return ['Fog', '≋']; if (code >= 95) return ['Thunderstorms', 'ϟ']; if ([71, 73, 75, 77, 85, 86].includes(code)) return ['Snow', '❄']; if (Number.isFinite(code)) return ['Rain or showers', '☂']; return ['Conditions unavailable', '—']; }
function renderWeather() {
  const w = state.forecast; if (!w) return;
  const c = w.conditions.current || {};
  $('temperature').textContent = num(c.temperature_2m); $('weather-condition').textContent = condition(c.weather_code)[0]; $('feels-like').textContent = num(c.apparent_temperature, '°'); $('wind').textContent = num(c.wind_speed_10m, ' mph'); $('humidity').textContent = num(c.relative_humidity_2m, '%');
  $('weather-freshness').textContent = w.conditions.error || `Model estimate · fetched ${age(w.conditions.fetchedAt)}`;
  replace('weather-alerts');
  if (!w.alerts.available) $('weather-alerts').append(el('p', 'fine-print', 'NWS alerts unavailable. This does not mean there are no alerts. Check weather.gov for official guidance.'));
  for (const alert of w.alerts.items) { const d = el('details', 'weather-alert'); d.append(el('summary', '', `${alert.event} · ${alert.severity}`), el('p', '', alert.headline), el('p', '', alert.description), el('p', '', alert.instruction)); $('weather-alerts').append(d); }
  const days = w.conditions.daily;
  replace('daily-forecast', ...(days?.time || []).slice(0, 5).map((stamp, i) => {
    const day = el('div', 'daily-row'); const range = el('span', '', num(days.temperature_2m_max?.[i], '°')); range.append(el('small', '', num(days.temperature_2m_min?.[i], '°')));
    day.append(el('span', '', i === 0 ? 'Today' : new Date(stamp * 1000).toLocaleDateString([], { weekday: 'short', timeZone: w.conditions.timezone })), el('span', '', condition(days.weather_code?.[i])[1]), el('span', '', num(days.precipitation_probability_max?.[i], '% rain')), range); return day;
  }));
  if (!days?.time?.length) replace('daily-forecast', el('p', 'empty', 'Daily forecast unavailable.'));
  renderChart(); enhancements.weatherDetails(w,state.place);
}
function svgElement(tag, attrs, text) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v); if (text !== undefined) e.textContent = text; return e; }
function renderChart() {
  const models = state.forecast.models; const start = Math.floor(Date.now() / 3600000) * 3600; const end = start + 48 * 3600;
  const series = models.map(m => ({ ...m, points: m.available ? m.hourly.time.map((t, i) => [t, m.hourly.temperature_2m[i]]).filter(([t]) => t >= start && t <= end) : [] }));
  const values = series.flatMap(m => m.points.map(p => p[1])).filter(Number.isFinite);
  if (!values.length) replace('forecast-chart', el('p', 'empty', 'AI model forecasts are unavailable. No synthetic forecast is displayed.'));
  else {
    const low = Math.floor(Math.min(...values) / 5) * 5 - 2; const high = Math.ceil(Math.max(...values) / 5) * 5 + 2;
    const svg = svgElement('svg', { viewBox: '0 0 600 185', role: 'img', 'aria-label': '48-hour AI temperature comparison. Exact values in the table below.' });
    const x = t => 32 + (t - start) / (end - start) * 548, y = v => 145 - (v - low) / (high - low) * 125;
    for (let i=0;i<4;i++) { const v=low+(high-low)*i/3; const yy=y(v); svg.append(svgElement('line',{x1:32,y1:yy,x2:580,y2:yy,class:'gridline'}),svgElement('text',{x:0,y:yy+4},`${Math.round(v)}°`)); }
    for (let i=0;i<5;i++) { const t=start+i*12*3600; svg.append(svgElement('text',{x:x(t),y:177,'text-anchor':i===0?'start':i===4?'end':'middle'},time(t,{minute:undefined}))); }
    series.forEach((m,i) => { let path=''; let pen=false; for(const [t,v] of m.points) { if(!Number.isFinite(v)){pen=false;continue;} path+=`${pen?'L':'M'}${x(t).toFixed(1)},${y(v).toFixed(1)} `;pen=true; } if(path) svg.append(svgElement('path',{d:path,fill:'none',stroke:i===0?'var(--accent)':'var(--blue)','stroke-width':'2.5','stroke-dasharray':i===0?'none':'5 4','stroke-linecap':'round'})); });
    replace('forecast-chart',svg);
  }
  replace('model-notes', ...series.map(m => { const p=el('p'); p.append(el('strong','',m.name+' '),document.createTextNode(m.available ? `· ${m.kind} · fetched ${age(m.fetchedAt)}` : '· unavailable')); return p; }));
  const table=el('table');const tr=el('tr');tr.append(el('th','','Local time'),...models.map(m=>el('th','',m.name)));const head=el('thead');head.append(tr);table.append(head);const body=el('tbody');
  for(let t=start;t<=end;t+=3*3600){const row=el('tr');row.append(el('th','',new Date(t*1000).toLocaleString([],{weekday:'short',hour:'numeric',timeZone:state.forecast.conditions.timezone||state.place.timezone})));for(const m of series)row.append(el('td','',num(m.points.find(p=>p[0]===t)?.[1],'°F')));body.append(row);}table.append(body);replace('forecast-table',table);
}
function validPlace(p) { return p && typeof p.latitude === 'number' && Number.isFinite(p.latitude) && Math.abs(p.latitude)<=90 && typeof p.longitude === 'number' && Number.isFinite(p.longitude) && Math.abs(p.longitude)<=180 && typeof p.label === 'string'; }
async function choosePlace(place, persist = false) {
  if (!validPlace(place)) return;
  state.place = { ...place, latitude: Math.round(place.latitude*100)/100, longitude: Math.round(place.longitude*100)/100 };
  tv?.update({ place: state.place });
  if (persist) store.set('place',state.place);
  $('location-name').textContent=place.label; $('weather-title').textContent=place.label;
  $('location-source').textContent=({cloudflare:'Approximate IP location · Cloudflare',manual:'Your saved location',device:'Device location · chosen by you',fallback:'Rhode Island default · IP location unavailable'})[place.source] || 'Selected location';
  $('location-dialog').close(); await loadWeather();
}
async function loadWeather() {
  if(!state.place)return; const version=++state.weatherVersion; const {latitude,longitude}=state.place;
  $('weather-condition').textContent='Updating forecast…';
  try { const data=await api(`/api/weather?lat=${latitude}&lon=${longitude}`);if(version!==state.weatherVersion)return;state.forecast=data;tv?.update({ forecast:data });renderWeather(); }
  catch { if(version!==state.weatherVersion)return; state.forecast=null;tv?.update({ forecast:null });document.getElementById('local-outlook')?.remove();$('temperature').textContent='—';$('weather-condition').textContent='Weather unavailable';$('weather-freshness').textContent='Could not retrieve forecast';for(const id of ['feels-like','wind','humidity'])$(id).textContent='—';replace('forecast-chart',el('p','empty','Forecast unavailable. Retry by selecting your location.'));replace('model-notes');replace('forecast-table');replace('daily-forecast',el('p','empty','Forecast unavailable.'));replace('weather-alerts',el('p','fine-print','NWS alerts could not be checked.')); }
}
async function useIP() { store.delete('place'); try { await choosePlace(await api('/api/location')); } catch { await choosePlace({latitude:41.82,longitude:-71.41,label:'Providence, RI',source:'fallback',timezone:'America/New_York'}); } }
$('location-button').addEventListener('click',()=>$('location-dialog').showModal());
$('use-ri').addEventListener('click',()=>choosePlace({latitude:41.82,longitude:-71.41,label:'Providence, RI',source:'manual',timezone:'America/New_York'},true));
$('use-ip').addEventListener('click',useIP);
$('use-gps').addEventListener('click',()=>{if(!navigator.geolocation){replace('place-results',el('p','fine-print','Device location is unavailable. Choose a city.'));return;}navigator.geolocation.getCurrentPosition(pos=>{store.delete('place');choosePlace({latitude:pos.coords.latitude,longitude:pos.coords.longitude,label:'Device location',source:'device',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});},()=>replace('place-results',el('p','fine-print','Device location was unavailable or permission was denied. Your current location choice is unchanged.')),{timeout:10000,maximumAge:0});});
$('place-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;replace('place-results',el('p','fine-print','Searching…'));try{const d=await api(`/api/places?q=${encodeURIComponent($('place-query').value.trim())}`);replace('place-results',...d.results.map(p=>{const b=el('button','place-result',p.label);b.addEventListener('click',()=>choosePlace(p,true));return b;}));if(!d.results.length)replace('place-results',el('p','fine-print','No locations found. Try a nearby city.'));}catch(error){replace('place-results',el('p','fine-print',error.message));}finally{button.disabled=false;}});
$('services-more').addEventListener('click',()=>{state.expanded=!state.expanded;renderServices();});
$('service-search').addEventListener('input',e=>{state.search=e.target.value.trim().toLowerCase();renderServices();});
for(const b of document.querySelectorAll('[data-filter]'))b.addEventListener('click',()=>{state.filter=b.dataset.filter;for(const other of document.querySelectorAll('[data-filter]'))other.setAttribute('aria-pressed',String(other===b));renderServices();});
const savedTheme=store.get('theme');document.documentElement.dataset.theme=['light','dark'].includes(savedTheme)?savedTheme:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
$('theme').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;store.set('theme',theme);});
// The theme control remains reachable on compact layouts through a keyboard shortcut-free button.
const mobileTheme=$('theme').cloneNode(true);mobileTheme.id='mobile-theme';mobileTheme.className='outline-button';mobileTheme.textContent='◐';mobileTheme.setAttribute('aria-label','Switch theme');mobileTheme.addEventListener('click',()=>$('theme').click());document.querySelector('.top-actions').prepend(mobileTheme);
function setBoard(on){document.body.classList.toggle('board-mode',on);renderServices();$('board').setAttribute('aria-pressed',String(on));$('board').textContent=on?'↙ Exit board':'↗ Board view';if(on)tv.start();else tv.stop();}
$('board').addEventListener('click',async()=>{const on=!document.body.classList.contains('board-mode');setBoard(on);if(on){try{await document.documentElement.requestFullscreen();}catch{}}else if(document.fullscreenElement){try{await document.exitFullscreen();}catch{}}});
$('tv-exit').addEventListener('click',async()=>{setBoard(false);if(document.fullscreenElement){try{await document.exitFullscreen();}catch{}}});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.body.classList.contains('board-mode'))setBoard(false);});
for(const a of document.querySelectorAll('.nav-link'))a.addEventListener('click',()=>{document.querySelector('.nav-link.selected')?.classList.remove('selected');a.classList.add('selected');});
async function loadNetwork(){try{const d=await api('/api/network');tv?.update({network:d});replace('network-details',...[['Cloudflare edge',d.colo],['Network',d.asOrganization],['Protocol',d.protocol],['Encryption',d.tls]].map(([name,value])=>{const row=el('div','network-detail');row.append(el('span','',name),el('strong','',value||'Not available locally'));return row;}));}catch{replace('network-details',el('p','muted','Connection information unavailable.'));}}
$('test-connection').addEventListener('click',async()=>{const b=$('test-connection');b.disabled=true;$('latency-result').textContent='Checking connection…';try{const samples=[];for(let i=0;i<5;i++){const start=performance.now();await api(`/api/ping?sample=${Date.now()}`);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);$('latency-result').textContent=`${Math.round(samples[2])} ms median · 5 requests · includes server time`;}catch{$('latency-result').textContent='Connection check failed. Try again.';}finally{b.disabled=false;}});
const audio=$('audio');for(const s of STATIONS){const o=el('option','',s.name);o.value=s.id;$('station').append(o);}const savedStation=store.get('station','river');$('station').value=STATIONS.some(s=>s.id===savedStation)?savedStation:'river';
function selectedStation(){return STATIONS.find(s=>s.id===$('station').value);}
function setStation(){const s=selectedStation();recovery.stop();audio.src=s.stream;$('station-site').href=s.site;$('radio-state').textContent='Ready when you are';store.set('station',s.id);document.querySelector('.radio-art').replaceChildren(document.createTextNode(s.id==='river'?'r':'♫'),el('span','',s.frequency));}
const recovery=new RadioRecovery(audio,message=>{$('radio-state').textContent=message;$('radio-play').textContent=recovery.active?'Ⅱ':'▶';$('radio-play').setAttribute('aria-label',recovery.active?'Pause radio':'Play radio');});
function playRadio(){recovery.start(selectedStation());}
$('radio-play').addEventListener('click',()=>recovery.active?recovery.stop():playRadio());
$('station').addEventListener('change',()=>{const wasPlaying=recovery.active;setStation();if(wasPlaying)playRadio();});
const volume=store.get('volume',.4);audio.volume=Number.isFinite(volume)?Math.min(1,Math.max(0,volume)):.4;$('volume').value=audio.volume;
$('volume').addEventListener('input',e=>{audio.volume=Number(e.target.value);store.set('volume',audio.volume);});
async function nowPlaying(){if(audio.paused||document.hidden)return;const id=selectedStation().id;try{const d=await api(`/api/radio?station=${encodeURIComponent(id)}`);if(selectedStation().id===id&&!audio.paused&&d.available)$('radio-state').textContent=d.title;}catch{}}
setInterval(nowPlaying,60000);
audio.addEventListener('playing',()=>{nowPlaying();$('radio-play').textContent='Ⅱ';$('radio-play').setAttribute('aria-label','Pause radio');$('radio-state').textContent='Live stream';});
audio.addEventListener('pause',()=>{$('radio-play').textContent='▶';$('radio-play').setAttribute('aria-label','Play radio');$('radio-state').textContent='Paused';});
audio.addEventListener('waiting',()=>{$('radio-state').textContent='Buffering…';});
setStation();
function tick(){$('clock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});$('date').textContent=new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});}
setInterval(tick,30000);tick();
setInterval(()=>{if(document.hidden&&!enhancements.backgroundAlerts())return;if(state.socket?.readyState===WebSocket.OPEN)state.socket.send('ping');renderSummary();renderServices();if(state.updatedAt)$('last-updated').textContent=`Checked ${age(state.updatedAt)}`;},60000);
setInterval(()=>{if(!document.hidden)loadWeather();},15*60000);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!enhancements.backgroundAlerts()){clearTimeout(state.reconnect);clearInterval(state.fallback);state.fallback=null;state.socket?.close(1000,'Background');}else{loadStatus();connect();loadWeather();}});
window.addEventListener('offline',()=>notify('You are offline. Displayed data may be out of date.'));
window.addEventListener('online',()=>{notify('');loadStatus();connect();loadWeather();});
const enhancements=initEnhancements({api,onChange:()=>{if(state.rawSnapshot)receive(state.rawSnapshot);connect();}});
const tv=initTV({api});
loadStatus();connect();loadNetwork();const savedPlace=store.get('place');if(validPlace(savedPlace)&&savedPlace.source==='manual')choosePlace(savedPlace);else useIP();
