const $ = id => document.getElementById(id);
const SCENES = [{ id: 'services', ms: 5 * 60_000 }, { id: 'weather', ms: 2 * 60_000 }, { id: 'power', ms: 2 * 60_000 }, { id: 'network', ms: 2 * 60_000 }];
const names = { operational: 'Operational', degraded: 'Degraded', outage: 'Outage', maintenance: 'Maintenance', unknown: 'Unconfirmed' };
const node = (tag, className, value) => { const element = document.createElement(tag); element.className = className; if (value !== undefined) element.textContent = value; return element; };
const number = (value, suffix = '') => Number.isFinite(value) ? `${Math.round(value)}${suffix}` : '—';
const condition = code => code === 0 ? 'Clear' : [1, 2, 3].includes(code) ? 'Cloudy' : [45, 48].includes(code) ? 'Fog' : code >= 95 ? 'Thunderstorms' : [71, 73, 75, 77, 85, 86].includes(code) ? 'Snow' : Number.isFinite(code) ? 'Rain or showers' : 'Conditions unavailable';

export function initTV({ api }) {
  let active = false, sceneId = 'services', deadline = 0, timer, ticker, powerRefresh, powerVersion = 0, snapshot, forecast, place, network, power;
  const screen = $('tv-board'), content = $('tv-content');
  const radio = document.querySelector('.radio-bar'), radioHome = radio.parentNode;
  const radioAnchor = document.createComment('radio home'); radio.before(radioAnchor);
  let servicePage = 0, pageDeadline = 0;
  const pageSize = () => window.innerWidth < 700 ? 4 : window.innerHeight < 850 ? 6 : 8;
  function pageCount() { return Math.max(1, Math.ceil((snapshot?.services?.length || 0) / pageSize())); }
  function turnPage(direction = 1) { servicePage = (servicePage + direction + pageCount()) % pageCount(); pageDeadline = Date.now() + 20_000; services(); }
  function ribbon() {
    const list = snapshot?.services || [];
    $('tv-overview').textContent = list.length ? `${list.filter(s => status(s) === 'operational').length} / ${list.length} services operational` : 'Services · connecting';
    $('tv-local-weather').textContent = forecast?.conditions?.current ? `${number(forecast.conditions.current.temperature_2m)}°F · ${condition(forecast.conditions.current.weather_code)}` : 'Weather · unavailable';
    $('tv-power-summary').textContent = power?.available ? `${power.region} power · ${number(power.count)} ${power.countKind === 'outages' ? 'outages' : 'affected'}` : 'Power · not confirmed';
  }
  function available() { return SCENES.filter(scene => scene.id !== 'power' || power?.available && power.active); }
  function current() { return available().find(scene => scene.id === sceneId) || available()[0]; }
  function status(service) { return service.checkedAt && Date.now() - Date.parse(service.checkedAt) > service.staleAfterMs ? 'unknown' : service.status; }
  function title(text, subtext) { content.replaceChildren(node('h1', 'tv-title', text), node('p', 'tv-subtitle', subtext)); }
  function services() {
    const list = snapshot?.services || [];
    const issues = list.filter(s => !['operational', 'unknown'].includes(status(s)));
    servicePage %= pageCount();
    title('Service report', `${list.length} services · ${issues.length} issues / maintenance · ${list.filter(s => status(s) === 'unknown').length} unconfirmed`);
    const paging = node('div', 'tv-paging');
    const previous = node('button', '', '←'); previous.type = 'button'; previous.setAttribute('aria-label', 'Previous service page'); previous.onclick = () => turnPage(-1);
    const nextPage = node('button', '', '→'); nextPage.type = 'button'; nextPage.setAttribute('aria-label', 'Next service page'); nextPage.onclick = () => turnPage();
    paging.append(node('span', '', `PAGE ${servicePage + 1} OF ${pageCount()} · changes every 20 seconds`), previous, nextPage); content.append(paging);
    const grid = node('div', 'tv-services');
    for (const s of [...list].sort((a, b) => (['outage','degraded','maintenance','unknown','operational'].indexOf(status(a)) - ['outage','degraded','maintenance','unknown','operational'].indexOf(status(b))) || a.name.localeCompare(b.name)).slice(servicePage * pageSize(), (servicePage + 1) * pageSize())) {
      const card = node('article', `tv-service tv-${status(s)}`);
      card.append(node('strong', '', s.name), node('span', '', s.error ? 'Source unavailable' : names[status(s)] || 'Unconfirmed'));
      const detail = s.incidents?.[0]?.title || s.scope || s.note;
      if (detail) card.append(node('small', '', detail));
      grid.append(card);
    }
    content.append(grid);
    if (!list.length) content.append(node('p', 'tv-empty', 'Connecting to the shared status feed…'));
  }

  function weather() {
    title('Weather report', place?.label || 'Local forecast');
    const data = forecast?.conditions;
    if (!data?.current) { content.append(node('p', 'tv-empty', 'Weather is unavailable. The next update will retry.')); return; }
    const main = node('div', 'tv-weather');
    const now = node('div', 'tv-weather-now');
    now.append(node('div', 'tv-temperature', `${number(data.current.temperature_2m)}°F`), node('div', 'tv-weather-symbol', data.current.weather_code === 0 ? '☀' : [1, 2, 3].includes(data.current.weather_code) ? '☁' : '☂'), node('h2', '', condition(data.current.weather_code)), node('p', '', `Feels like ${number(data.current.apparent_temperature, '°')} · Wind ${number(data.current.wind_speed_10m, ' mph')} · Humidity ${number(data.current.relative_humidity_2m, '%')}`));
    const days = node('div', 'tv-days');
    (data.daily?.time || []).slice(0, 5).forEach((stamp, i) => {
      const day = node('div', 'tv-day');
      const label = i ? new Date(stamp * 1000).toLocaleDateString([], { weekday: 'long', timeZone: data.timezone }) : 'Today';
      day.append(node('strong', '', label), node('span', '', condition(data.daily.weather_code?.[i])), node('span', '', `${number(data.daily.temperature_2m_max?.[i])}° / ${number(data.daily.temperature_2m_min?.[i])}°`), node('small', '', `${number(data.daily.precipitation_probability_max?.[i], '%')} rain`));
      days.append(day);
    });
    main.append(now, days); content.append(main);
    const alerts = forecast?.alerts?.items || [];
    if (alerts.length) content.append(node('p', 'tv-weather-alert', `Weather alert: ${alerts.slice(0, 2).map(a => a.event).join(' · ')} — check weather.gov for details.`));
    else if (forecast?.alerts?.available === false) content.append(node('p', 'tv-muted', 'Weather alerts could not be checked.'));
    content.append(node('p', 'tv-muted', `Model estimate · ${data.fetchedAt ? 'fetched ' + new Date(data.fetchedAt).toLocaleTimeString() : 'time unavailable'}`));
  }
  function outage() {
    title('Power outages', `${power.provider} · ${power.scope}`);
    const lead = node('p', 'tv-power-count', `${number(power.count)} ${power.countKind === 'outages' ? 'active outages' : 'customers affected'} across ${power.region}`);
    const link = node('a', 'tv-map-link', 'Open official outage map ↗'); link.href = power.mapUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const frame = node('iframe', 'tv-map'); frame.title = `${power.provider} outage map`; frame.src = power.mapUrl; frame.loading = 'eager'; frame.referrerPolicy = 'no-referrer';
    content.append(lead, frame, node('p', 'tv-muted', 'Regional total does not confirm an outage at your address. If the map cannot load here, use the official map link.'), link);
  }
  async function connectionCheck() {
    $('tv-latency').textContent = 'Checking dashboard connection…';
    try {
      const samples = [];
      for (let i = 0; i < 3 && active; i++) { const start = performance.now(); await api(`/api/ping?tv=${Date.now()}-${i}`); samples.push(performance.now() - start); }
      if (active && current().id === 'network') $('tv-latency').textContent = samples.length === 3 ? `${Math.round(samples.sort((a,b) => a-b)[1])} ms median round trip · 3 requests` : 'Connection check interrupted';
    } catch { if (active && current().id === 'network') $('tv-latency').textContent = 'Dashboard connection check unavailable'; }
  }
  function connection() {
    title('Network connection', 'This display to the Cloudflare edge');
    const grid = node('div', 'tv-network');
    for (const [label, value] of [['Connection', navigator.onLine ? 'Online' : 'Offline'], ['Cloudflare edge', network?.colo], ['Network', network?.asOrganization], ['Protocol', network?.protocol], ['Encryption', network?.tls]]) {
      const card = node('div', 'tv-network-card'); card.append(node('span', '', label), node('strong', '', value || 'Unavailable')); grid.append(card);
    }
    content.append(grid, node('p', 'tv-latency', 'Checking dashboard connection…'), node('p', 'tv-muted', 'Round-trip time includes server time. This does not test other websites or identify your DNS resolver.'));
    content.querySelector('.tv-latency').id = 'tv-latency'; void connectionCheck();
  }
  function draw() {
    if (!active) return;
    const scene = current();
    screen.dataset.scene = scene.id; servicePage = 0; pageDeadline = Date.now() + 20_000; ribbon();
    $('tv-channel').textContent = `SIGNAL / ${scene.id.toUpperCase()}`;
    $('tv-progress').style.animationDuration = `${scene.ms}ms`;
    $('tv-progress').classList.remove('tv-running'); void $('tv-progress').offsetWidth; $('tv-progress').classList.add('tv-running');
    ({ services, weather, power: outage, network: connection })[scene.id]();
    deadline = Date.now() + scene.ms;
    clearTimeout(timer); timer = setTimeout(next, scene.ms);
    tick();
  }
  function tick() { if (!active) return; ribbon(); if (sceneId === 'services' && Date.now() >= pageDeadline) turnPage(); const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); $('tv-next').textContent = `Next channel in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; $('tv-clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function next() { const scenes = available(), at = scenes.findIndex(s => s.id === sceneId); sceneId = scenes[(at + 1) % scenes.length].id; draw(); }
  async function refreshPower() {
    if (!active || !place) return;
    const version = ++powerVersion;
    try {
      const region = place.regionCode || (/Rhode Island|, RI(?:,|$)/i.test(place.label) ? 'RI' : /Massachusetts|, MA(?:,|$)/i.test(place.label) ? 'MA' : /New York|, NY(?:,|$)/i.test(place.label) ? 'NY' : '');
      const data = await api(`/api/power?lat=${place.latitude}&lon=${place.longitude}&region=${region}`);
      if (!active || version !== powerVersion) return;
      power = data;
      if (sceneId === 'power' && !data.active) { sceneId = 'network'; draw(); }
    } catch { if (version === powerVersion) { power = null; if (active && sceneId === 'power') { sceneId = 'network'; draw(); } } }
  }
  function start() { if (active) return; active = true; sceneId = 'services'; screen.hidden = false; $('tv-radio-dock').append(radio); draw(); ticker = setInterval(tick, 1000); void refreshPower(); powerRefresh = setInterval(refreshPower, 5 * 60_000); }
  function stop() { radioHome.insertBefore(radio, radioAnchor.nextSibling); active = false; ++powerVersion; screen.hidden = true; clearTimeout(timer); clearInterval(ticker); clearInterval(powerRefresh); content.replaceChildren(); }
  function update(data) { if ('snapshot' in data) snapshot = data.snapshot; if ('forecast' in data) forecast = data.forecast; if ('place' in data) { place = data.place; power = null; if (active) { if (sceneId === 'power') { sceneId = 'network'; draw(); } void refreshPower(); } } if ('network' in data) network = data.network; if (active && sceneId !== 'power') ({ services, weather, network: connection })[sceneId](); }
  $('tv-skip').addEventListener('click', next);
  return { start, stop, update };
}
