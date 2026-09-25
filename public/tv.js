import { WARREN, currentHour, localDayIndex, localConditions, weatherEffect } from './board-weather.js';
import { renderNetworkWatch } from './network-channel.js';
import { createBoardAlerts } from './board-alerts.js';
import { boardStatus, boardChanges } from './board-status.js';
import { weatherInfo, weatherIcon } from './weather-icons.js';
const $ = id => document.getElementById(id);
const SCENES = [{ id: 'services', ms: 5 * 60_000 }, { id: 'weather', ms: 2 * 60_000 }, { id: 'power', ms: 2 * 60_000 }, { id: 'network', ms: 2 * 60_000 }];
const names = { operational: 'Operational', degraded: 'Degraded', outage: 'Outage', maintenance: 'Maintenance', unknown: 'Unconfirmed' };
const node = (tag, className, value) => { const element = document.createElement(tag); element.className = className; if (value !== undefined) element.textContent = value; return element; };
const number = (value, suffix = '') => Number.isFinite(value) ? `${Math.round(value)}${suffix}` : '—';
const condition = code => weatherInfo(code).label;

export function initTV({ api }) {
  let active = false, sceneId = 'services', deadline = 0, timer, ticker, powerRefresh, powerVersion = 0, snapshot, forecast, place, network, power;
  const screen = $('tv-board'), content = $('tv-content');
  const radio = document.querySelector('.radio-bar'), radioHome = radio.parentNode;
  const radioAnchor = document.createComment('radio home'); radio.before(radioAnchor);
  let idleTimer, noticeTimer, previousStates, weatherRefresh, weatherVersion = 0, renderedWeatherHour, watchReport, watchRefresh, watchVersion=0;
  function wake() {
    if (!active) return;
    screen.classList.remove('tv-idle');clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>screen.classList.add('tv-idle'),4000);
  }
  for (const event of ['pointermove','pointerdown','keydown','focusin']) document.addEventListener(event,wake,{passive:true});
  const audio=$('audio');
  const sound=createBoardAlerts({radio:audio,volumeInput:$('volume'),button:$('tv-audio')});
  function radioState() { radio.dataset.playing=String(!audio.paused&&!audio.ended&&audio.readyState>=3); }
  for (const event of ['playing','pause','waiting','ended','emptied','error']) audio.addEventListener(event,radioState);
  const equalizer=node('div','tv-equalizer');equalizer.setAttribute('aria-hidden','true');for(let i=0;i<5;i++)equalizer.append(node('i',''));radio.append(equalizer);
  function announce(changes) {
    if (!active || !changes.length) return;
    sound.announce(changes);
    const panel=node('article','tv-notice');panel.append(node('span','tv-notice-kicker','SERVICE UPDATE'));
    for(const change of changes.slice(0,3)) {
      const row=node('div',`tv-notice-row tv-${change.to}`);
      row.append(node('strong','',change.name),node('span','',`${names[change.from]||'Unconfirmed'} → ${names[change.to]||'Unconfirmed'}`));panel.append(row);
    }
    if(changes.length>3)panel.append(node('p','',`+ ${changes.length-3} other services changed. See the Services channel.`));
    const close=node('button','tv-notice-close','×');close.type='button';close.setAttribute('aria-label','Dismiss service update');close.onclick=()=>$('tv-notifications').replaceChildren();panel.append(close);
    $('tv-notifications').replaceChildren(panel);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('tv-notifications').replaceChildren(),12000);
  }
  let servicePage = 0, pageDeadline = 0;
  const pageSize = () => window.innerWidth < 700 ? 4 : window.innerHeight < 850 ? 6 : 8;
  function pageCount() { return Math.max(1, Math.ceil((snapshot?.services?.length || 0) / pageSize())); }
  function turnPage(direction = 1) { servicePage = (servicePage + direction + pageCount()) % pageCount(); pageDeadline = Date.now() + 20_000; changePage(services); }
  function ribbon() {
    const list = snapshot?.services || [];
    $('tv-overview').textContent = list.length ? `${list.filter(s => status(s) === 'operational').length} / ${list.length} services operational` : 'Services · connecting';
    $('tv-local-weather').textContent = forecast?.conditions?.current ? `${number(forecast.conditions.current.temperature_2m)}°F · ${condition(forecast.conditions.current.weather_code)}` : 'Weather · unavailable';
  }
  function available() { return SCENES.filter(scene => scene.id !== 'power' || power?.available && power.active); }
  function current() { return available().find(scene => scene.id === sceneId) || available()[0]; }
  const status = boardStatus;
  function title(text, subtext) { delete screen.dataset.conditions; const heading=node('div','tv-heading');heading.append(node('h1','tv-title',text),node('p','tv-subtitle',subtext));content.replaceChildren(heading); }
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

  const weatherPages = ['Local conditions', 'Hour by hour', 'AI temperature outlook', 'The next few days'];
  let weatherPage = 0, weatherDeadline = 0, networkResult = null, probeVersion = 0, networkPage=0, networkDeadline=0;
  const networkPages=['Your connection','Your ASNs','Downstream watch','North America'];
  const localTime = stamp => new Date(stamp * 1000).toLocaleTimeString([], { hour: 'numeric', timeZone: WARREN.timezone });
  let outgoing = null, sceneAnimations = [];
  function clearTransition() { for (const animation of sceneAnimations) animation.cancel(); sceneAnimations=[]; outgoing?.remove(); outgoing=null; }
  function changePage(render) {
    clearTransition();
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && content.childElementCount) {
      const bounds=content.getBoundingClientRect();
      outgoing=content.cloneNode(true); outgoing.removeAttribute('id');outgoing.classList.add('tv-outgoing');outgoing.setAttribute('aria-hidden','true');outgoing.inert=true;
      outgoing.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
      outgoing.querySelectorAll('iframe').forEach(el=>el.remove());
      Object.assign(outgoing.style,{position:'fixed',left:`${bounds.left}px`,top:`${bounds.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`,margin:'0'});screen.append(outgoing);
    }
    render();content.scrollTop=0;
    if(reduced)return;
    if(outgoing){const old=outgoing;const exit=old.animate([{transform:'translateX(0)'},{transform:'translateX(-105%)'}],{duration:600,easing:'cubic-bezier(.65,0,.35,1)',fill:'forwards'});sceneAnimations.push(exit);exit.finished.then(()=>old.remove()).catch(()=>{});}
    const heading=content.querySelector('.tv-heading');
    if(heading)sceneAnimations.push(heading.animate([{transform:'translateX(90px)',opacity:0},{transform:'translateX(0)',opacity:1}],{duration:650,delay:130,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'}));
    const cards=content.querySelectorAll('.tv-hour,.tv-extended-day,.tv-service,.tv-current-metrics>.tv-network-card');
    if(cards.length)cards.forEach((card,i)=>sceneAnimations.push(card.animate([{transform:'perspective(1000px) translateX(110px) rotateY(-18deg)',opacity:0},{transform:'perspective(1000px) translateX(0) rotateY(0)',opacity:1}],{duration:720,delay:180+i*80,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'})));
    else for(const panel of content.querySelectorAll('.tv-model-chart,.tv-route,.tv-network,.tv-probe,.tv-map'))sceneAnimations.push(panel.animate([{transform:'translateX(100%)'},{transform:'translateX(0)'}],{duration:750,delay:120,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'}));
  }
  function weatherTurn(direction = 1) { weatherPage = (weatherPage + direction + weatherPages.length) % weatherPages.length; weatherDeadline = Date.now() + 30_000; changePage(weather); }
  function metric(label, value, className = 'tv-network-card') { const card = node('div', className); card.append(node('span', '', label), node('strong', '', value)); return card; }
  function weather() {
    renderedWeatherHour = Math.floor(Date.now()/3600000);
    title(weatherPages[weatherPage], WARREN.label);
    screen.dataset.weatherPage = String(weatherPage);
    const navigation = node('div', 'tv-weather-tabs'); navigation.setAttribute('aria-label', 'Weather pages');
    weatherPages.forEach((label, i) => { const button = node('button', i === weatherPage ? 'selected' : '', `${String(i + 1).padStart(2,'0')}  ${label}`); button.type = 'button'; button.setAttribute('aria-pressed', String(i === weatherPage)); button.onclick = () => { weatherPage = i; weatherDeadline = Date.now() + 30_000; changePage(weather); }; navigation.append(button); });
    content.append(navigation);
    [weatherCurrent, weatherHourly, weatherModels, weatherDays][weatherPage]();
    const alerts = forecast?.alerts?.items || [];
    if (alerts.length) content.append(node('p', 'tv-weather-alert', `WEATHER ALERT · ${alerts.slice(0,2).map(a => a.event).join(' · ')}`));
    else if (forecast?.alerts?.available === false) content.append(node('p', 'tv-muted', 'Weather alerts could not be checked.'));
    const stamp = forecast?.conditions?.fetchedAt;
    content.append(node('p', 'tv-muted', `${forecast?.refreshFailed?'Refresh unavailable · showing last received report · ':''}Forecast estimates · °F / mph · ${stamp ? 'updated ' + new Date(stamp).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : 'update time unavailable'} · pages change every 30 seconds`));
  }
  const detailedTime = stamp => Number.isFinite(stamp) ? new Date(stamp*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZone:WARREN.timezone}) : '—';
  function weatherCurrent() {
    const resolved=localConditions(forecast?.conditions),data=resolved.current;
    if (!Number.isFinite(data.temperature_2m)) { content.append(node('p','tv-empty','Local conditions are unavailable.')); return; }
    screen.dataset.conditions=weatherEffect(data.weather_code,data.is_day);
    const effect=node('div','tv-weather-effects');effect.setAttribute('aria-hidden','true');for(let i=0;i<16;i++){const particle=node('i','');particle.style.setProperty('--i',i);effect.append(particle);}content.append(effect);
    if(resolved.fallbackFields.length)content.append(node('p','tv-muted','Some details use this hour’s forecast where current readings are unavailable.'));
    const daily=forecast.conditions.daily, day=localDayIndex(daily?.time, WARREN.timezone);
    const main=node('div','tv-current-stage'), hero=node('div','tv-weather-now');
    hero.append(node('span','tv-now-kicker','RIGHT NOW · WARREN, RI'),node('div','tv-temperature',number(data.temperature_2m,'°')),weatherIcon(data.weather_code,'tv-weather-symbol'),node('h2','',condition(data.weather_code)),node('p','tv-feels',`Feels like ${number(data.apparent_temperature,'°F')}`));
    const range=node('div','tv-today-range');range.append(metric('Today’s high',number(daily?.temperature_2m_max?.[day],'°')),metric('Today’s low',number(daily?.temperature_2m_min?.[day],'°')));hero.append(range);
    const metrics=node('div','tv-current-metrics');
    const wind=Number.isFinite(data.wind_direction_10m)?['N','NE','E','SE','S','SW','W','NW'][Math.round(data.wind_direction_10m/45)%8]:'';
    metrics.append(metric('Wind',`${wind} ${number(data.wind_speed_10m,' mph')}`.trim()),metric('Wind gusts',number(data.wind_gusts_10m,' mph')),metric('Humidity',number(data.relative_humidity_2m,'%')),metric('Dew point',number(data.dew_point_2m,'°F')),metric('Today’s rain chance',number(daily?.precipitation_probability_max?.[day],'%')),metric('Cloud cover',number(data.cloud_cover,'%')));
    main.append(hero,metrics);content.append(main);
    const daylight=node('div','tv-daylight');daylight.append(metric('Sunrise',detailedTime(daily?.sunrise?.[day])),metric('Sunset',detailedTime(daily?.sunset?.[day])),metric('Today’s outlook',condition(daily?.weather_code?.[day])));content.append(daylight);
  }
  function weatherHourly() {
    const hourly = forecast?.conditions?.hourly;
    const indices = (hourly?.time || []).map((t,i)=>({t,i})).filter(({t})=>t >= Math.floor(Date.now()/3600000)*3600).slice(0,6);
    if (!indices.length) { content.append(node('p','tv-empty','Hourly forecast is unavailable.')); return; }
    const grid=node('div','tv-hourly');
    for (const {t,i} of indices) { const isNow=currentHour(t); const card=node('article',isNow?'tv-hour tv-hour-now':'tv-hour');card.dataset.hour=String(t);if(isNow)card.setAttribute('aria-current','time');card.append(node('span','tv-hour-label',isNow?'NOW':'FORECAST')); card.append(node('h2','',localTime(t)),weatherIcon(hourly.weather_code?.[i] ?? hourly.weathercode?.[i]),node('strong','tv-hour-temp',number(hourly.temperature_2m?.[i],'°')),node('p','',condition(hourly.weather_code?.[i] ?? hourly.weathercode?.[i])),node('span','',`${number(hourly.precipitation_probability?.[i],'%')} precip.`),node('small','',`Wind ${number(hourly.wind_speed_10m?.[i],' mph')}`));grid.append(card); }
    content.append(grid);
  }
  function weatherDays() {
    const daily=forecast?.conditions?.daily;
    if (!daily?.time?.length) { content.append(node('p','tv-empty','Daily forecast is unavailable.'));return; }
    const grid=node('div','tv-extended');
    daily.time.slice(0,5).forEach((stamp,i)=>{const day=node('article','tv-extended-day');day.append(node('h2','',i?new Date(stamp*1000).toLocaleDateString([],{weekday:'short',timeZone:forecast.conditions.timezone}):'Today'),weatherIcon(daily.weather_code?.[i]),node('p','',condition(daily.weather_code?.[i])),node('strong','tv-day-high',number(daily.temperature_2m_max?.[i],'°')),node('span','tv-day-low',`${number(daily.temperature_2m_min?.[i],'°')} low`),node('small','',`${number(daily.precipitation_probability_max?.[i],'%')} precip.`));grid.append(day);});content.append(grid);
  }
  function weatherModels() {
    const start=Math.floor(Date.now()/3600000)*3600,end=start+48*3600;
    const models=(forecast?.models || []).map(m=>({...m,points:m.available?(m.hourly?.time || []).map((t,i)=>[t,m.hourly.temperature_2m?.[i]]).filter(([t])=>t>=start&&t<=end):[]}));
    const values=models.flatMap(m=>m.points.map(p=>p[1])).filter(Number.isFinite);
    const legend=node('div','tv-model-legend'); models.forEach((m,i)=>legend.append(node('span',`tv-model-${i}`,`${m.name} · ${m.available&&m.points.some(p=>Number.isFinite(p[1]))?'48-hour forecast':'unavailable'}`)));content.append(legend);
    if (!values.length) { content.append(node('p','tv-empty','AI forecasts are unavailable. No substitute model is shown.'));return; }
    const svg=(tag,attrs={},text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=text;return el;};
    const chart=svg('svg',{viewBox:'0 0 1100 390',role:'img','aria-label':'Temperature forecast over the next 48 hours from ECMWF AIFS and NOAA AIGFS',class:'tv-model-chart'});
    const low=Math.floor((Math.min(...values)-4)/5)*5,high=Math.ceil((Math.max(...values)+4)/5)*5;
    const x=t=>75+(t-start)/(end-start)*980,y=v=>325-(v-low)/(high-low)*290;
    for(let i=0;i<=4;i++){const v=low+(high-low)*i/4;chart.append(svg('line',{x1:75,x2:1055,y1:y(v),y2:y(v),class:'tv-chart-grid'}),svg('text',{x:60,y:y(v)+6,'text-anchor':'end'},`${Math.round(v)}°`));}
    for(let h=0;h<=48;h+=12){const t=start+h*3600;chart.append(svg('text',{x:x(t),y:365,'text-anchor':'middle'},`${new Date(t*1000).toLocaleDateString([],{weekday:'short',timeZone:forecast?.conditions?.timezone})} ${localTime(t)}`));}
    models.forEach((m,i)=>{let path='',pen=false,last=0;for(const [t,v] of m.points){if(!Number.isFinite(v)){pen=false;continue;}path+=`${pen&&t-last<=3600?'L':'M'}${x(t).toFixed(1)},${y(v).toFixed(1)} `;pen=true;last=t;}chart.append(svg('path',{d:path,class:`tv-model-line tv-model-${i}`,pathLength:1}));});
    chart.dataset.start=String(start);chart.dataset.end=String(end);
    const marker=svg('g',{class:'tv-now-marker'});marker.append(svg('line',{x1:0,x2:0,y1:35,y2:325}),svg('circle',{cx:0,cy:325,r:6}),svg('rect',{x:0,y:7,width:170,height:26,rx:5}),svg('text',{x:10,y:27}));chart.append(marker);
    content.append(chart,node('p','tv-muted','Independent AI models · lines show predicted temperatures, not a confidence range. Gaps mean missing data. Hourly values may be interpolated.'));
    updateWeatherTime();
  }
  function updateWeatherTime() {
    const chart=content.querySelector('.tv-model-chart'),marker=chart?.querySelector('.tv-now-marker');
    if(!marker)return;
    const now=Date.now()/1000,start=Number(chart.dataset.start),end=Number(chart.dataset.end);
    marker.setAttribute('visibility',now<start||now>end?'hidden':'visible');
    marker.setAttribute('transform',`translate(${75+(now-start)/(end-start)*980},0)`);
    marker.querySelector('text').textContent=`NOW · ${detailedTime(now)}`;
  }
  function outage() {
    title('Power in your area', `${power.provider} · official utility map`);
    const layout=node('div','tv-power-layout'),details=node('aside','tv-power-details');
    details.append(node('span','tv-power-label','REGIONAL OUTAGE REPORT'),node('p','tv-power-count',`${number(power.count)} ${power.countKind==='outages'?'active outages':'customers affected'}`),node('p','tv-power-region',power.scope||power.region));
    details.append(node('p','tv-muted',`Last checked ${power.checkedAt?new Date(power.checkedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'unavailable'}`),node('p','tv-muted','This is a regional total, not confirmation of an outage at your address. Select an area on the map for utility details.'));
    const link=node('a','tv-map-link','Open official map ↗');link.href=power.mapUrl;link.target='_blank';link.rel='noopener noreferrer';details.append(link);
    const mapPanel=node('div','tv-map-panel'),toolbar=node('div','tv-map-toolbar');
    toolbar.append(node('strong','',`${power.provider} · ${power.region}`));
    const reload=node('button','','Reload map');reload.type='button';toolbar.append(reload);
    const frame=node('iframe','tv-map');frame.title=`${power.provider} outage map`;frame.src=power.mapUrl;frame.loading='eager';frame.referrerPolicy='no-referrer';
    reload.onclick=()=>{frame.src=power.mapUrl;};
    mapPanel.append(toolbar,frame,node('p','tv-map-help','Map blank or blocked? Use “Open official map.” Utility maps may restrict embedded display.'));
    layout.append(details,mapPanel);content.append(layout);
  }
  async function connectionCheck() {
    const version=++probeVersion,samples=[];let failures=0;
    networkResult={pending:true}; connection();
    for(let i=0;i<5;i++) {
      if(!active||sceneId!=='network'||version!==probeVersion)return;
      const start=performance.now();
      try{await api(`/api/ping?tv=${Date.now()}-${i}`,{signal:AbortSignal.timeout(5000)});samples.push(performance.now()-start);}catch{failures++;}
    }
    if(!active||sceneId!=='network'||version!==probeVersion)return;
    const sorted=[...samples].sort((a,b)=>a-b);
    networkResult={pending:false,samples,failures,median:sorted.length?sorted[Math.floor(sorted.length/2)]:null,min:sorted[0],max:sorted.at(-1),at:Date.now()};connection();
  }
  function connectionDetails() {
    title('Your connection', 'NETWORK REPORT · This display to the dashboard');
    const route=node('div','tv-route');route.append(node('span','',navigator.onLine?'This display · online':'This display · offline'),node('span','tv-route-line','→'),node('span','',network?.asOrganization||'Network unavailable'),node('span','tv-route-line','→'),node('span','',`Cloudflare · ${network?.colo||'unknown edge'}`));content.append(route);
    const grid=node('div','tv-network tv-network-expanded');
    for(const [label,value] of [['Edge location',network?.colo],['Network / ASN',network?.asn?`AS${network.asn}`:null],['Approx. region',[network?.region,network?.country].filter(Boolean).join(', ')],['HTTP protocol',network?.protocol],['Transport security',network?.tls],['Browser connectivity',navigator.onLine?'Online':'Offline']])grid.append(metric(label,value||'Unavailable'));
    content.append(grid);
    const panel=node('div','tv-probe');
    const result=networkResult;
    const headline=node('div','tv-probe-heading');headline.append(node('h2','',result?.pending?'Checking dashboard response…':'Dashboard response check'));
    const retry=node('button','',result?.pending?'Checking…':'Run again');retry.type='button';retry.disabled=!!result?.pending;retry.onclick=()=>void connectionCheck();headline.append(retry);panel.append(headline);
    const metrics=node('div','tv-probe-metrics');
    metrics.append(metric('Median round trip',number(result?.median,' ms')),metric('Fastest / slowest',result?.samples?.length?`${number(result.min)} / ${number(result.max)} ms`:'—'),metric('Response variation',result?.samples?.length>1?number(result.max-result.min,' ms'):'—'),metric('Requests completed',result&&!result.pending?`${result.samples.length} / 5`:'—'));
    panel.append(metrics);
    const bars=node('div','tv-probe-bars');bars.setAttribute('aria-label','Individual response times');
    (result?.samples||[]).forEach((ms,i)=>{const bar=node('div','tv-probe-sample',`${i+1} · ${number(ms,' ms')}`);bar.style.setProperty('--sample-width',`${Math.max(8,ms/Math.max(result.max,1)*100)}%`);bars.append(bar);});panel.append(bars);
    panel.append(node('p','tv-muted',result?.pending?'Sending 5 small requests…':result?`${result.failures} failed requests · checked ${new Date(result.at).toLocaleTimeString()} · each request times out after 5 seconds`:'No check yet.'));
    content.append(panel,node('p','tv-muted','Browser online status does not guarantee internet access. This check includes server time; it does not measure download speed, packet loss, DNS, or other websites.'));
  }
  function connection() {
    screen.dataset.networkPage=String(networkPage);
    if(networkPage===0)connectionDetails();
    else {title(networkPages[networkPage],networkPage===3?'RADAR REPORTS · Last 7 days':'AS25710 · AS32145 · AS402280');renderNetworkWatch(content,watchReport,networkPage);}
    const tabs=node('div','tv-weather-tabs tv-network-tabs');tabs.setAttribute('aria-label','Network pages');
    networkPages.forEach((label,i)=>{const button=node('button',i===networkPage?'selected':'',`${String(i+1).padStart(2,'0')} ${label}`);button.type='button';button.setAttribute('aria-pressed',String(i===networkPage));button.onclick=()=>{networkPage=i;networkDeadline=Date.now()+30000;changePage(connection);};tabs.append(button);});content.append(tabs);
  }
  async function refreshWatch(){
    if(!active)return;const version=++watchVersion;
    try{const data=await api('/api/network-watch');if(!active||version!==watchVersion)return;watchReport=data;}
    catch{if(!active||version!==watchVersion)return;watchReport={error:true};}
    if(sceneId==='network'&&networkPage!==0)connection();
  }
  function draw() {
    if (!active) return;
    const scene = current();
    ++probeVersion; networkPage=0;networkDeadline=Date.now()+30000;weatherPage = 0; weatherDeadline = Date.now() + 30_000;
    screen.dataset.scene = scene.id;
    document.querySelectorAll('[data-tv-channel]').forEach(el => { el.classList.toggle('selected',el.dataset.tvChannel===scene.id); el.hidden=el.dataset.tvChannel==='power'&&!power?.active; });
    servicePage = 0; pageDeadline = Date.now() + 20_000; ribbon();
    $('tv-progress').style.animationDuration = `${scene.ms}ms`;
    $('tv-progress').classList.remove('tv-running'); void $('tv-progress').offsetWidth; $('tv-progress').classList.add('tv-running');
    changePage(({ services, weather, power: outage, network: connection })[scene.id]); if (scene.id === 'network') void connectionCheck();
    deadline = Date.now() + scene.ms;
    clearTimeout(timer); timer = setTimeout(next, scene.ms);
    tick();
  }
  function tick() { if (!active) return; ribbon(); if(sceneId==='weather'){if(renderedWeatherHour!==Math.floor(Date.now()/3600000))weather();else updateWeatherTime();} if(sceneId==='network'&&Date.now()>=networkDeadline){networkPage=(networkPage+1)%networkPages.length;networkDeadline=Date.now()+30000;changePage(connection);} if (sceneId === 'services' && Date.now() >= pageDeadline) turnPage(); if (sceneId === 'weather' && Date.now() >= weatherDeadline) weatherTurn(); const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); $('tv-next').textContent = `Next channel in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; $('tv-clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function next() { const scenes = available(), at = scenes.findIndex(s => s.id === sceneId); sceneId = scenes[(at + 1) % scenes.length].id; draw(); }
  async function refreshPower() {
    if (!active || !place) return;
    const version = ++powerVersion;
    try {
      const region = place.regionCode || (/Rhode Island|, RI(?:,|$)/i.test(place.label) ? 'RI' : /Massachusetts|, MA(?:,|$)/i.test(place.label) ? 'MA' : /New York|, NY(?:,|$)/i.test(place.label) ? 'NY' : '');
      const data = await api(`/api/power?lat=${place.latitude}&lon=${place.longitude}&region=${region}`);
      if (!active || version !== powerVersion) return;
      power = data;
      if (sceneId === 'power' && !data.active) { sceneId = 'network'; draw(); } else if(sceneId==='power') outage();
    } catch { if (version === powerVersion) { power = null; if (active && sceneId === 'power') { sceneId = 'network'; draw(); } } }
  }
  async function refreshWeather() {
    if(!active)return;
    const version=++weatherVersion;
    try {
      const data=await api(`/api/weather?lat=${WARREN.latitude}&lon=${WARREN.longitude}`);
      if(!active||version!==weatherVersion)return;
      if(!Number.isFinite(localConditions(data.conditions).current.temperature_2m))throw Error('Missing weather');
      forecast=data;forecast.refreshFailed=false;
    } catch { if(!active||version!==weatherVersion)return;if(forecast)forecast.refreshFailed=true; }
    ribbon();if(sceneId==='weather')weather();
  }
  function start() { if (active) return; active = true; sound.start(); sceneId = 'services'; screen.hidden = false; $('tv-radio-dock').append(radio); radioState();wake(); draw(); ticker = setInterval(tick, 1000); void refreshPower(); void refreshWeather();void refreshWatch();watchRefresh=setInterval(refreshWatch,5*60_000); weatherRefresh=setInterval(refreshWeather,15*60_000); powerRefresh = setInterval(refreshPower, 5 * 60_000); }
  function stop() { sound.stop();++watchVersion;clearInterval(watchRefresh); ++weatherVersion;clearInterval(weatherRefresh);clearTimeout(idleTimer);clearTimeout(noticeTimer);screen.classList.remove('tv-idle');$('tv-notifications').replaceChildren();clearTransition(); radioHome.insertBefore(radio, radioAnchor.nextSibling); active = false; ++probeVersion; ++powerVersion; screen.hidden = true; clearTimeout(timer); clearInterval(ticker); clearInterval(powerRefresh); content.replaceChildren(); }
  function update(data) { if ('snapshot' in data) { snapshot=data.snapshot;const result=boardChanges(previousStates,snapshot?.services||[]);previousStates=result.next;announce(result.changes); } if ('forecast' in data && place?.latitude===WARREN.latitude && place?.longitude===WARREN.longitude && Number.isFinite(localConditions(data.forecast?.conditions).current.temperature_2m)) forecast = data.forecast; if ('place' in data) { place = data.place; power = null; if (active) { if (sceneId === 'power') { sceneId = 'network'; draw(); } void refreshPower(); } } if ('network' in data) network = data.network; if (active && sceneId !== 'power') ({ services, weather, network: connection })[sceneId](); }
  $('tv-skip').addEventListener('click', next);
  return { start, stop, update };
}
