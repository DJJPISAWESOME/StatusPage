import { servicePages, servicePageDuration, serviceSlot } from './board-services.js';
import { renderPowerMap } from './power-map.js';
import { appendNetworkFeed, visibleNetworkASNs } from './network-report.js';
import { WARREN, currentHour, localDayIndex, localConditions, weatherEffect } from './board-weather.js';
import { renderNetworkWatch } from './network-channel.js';
import { createBoardAlerts } from './board-alerts.js';
import { boardStatus, boardChanges } from './board-status.js';
import { weatherInfo, weatherIcon } from './weather-icons.js';
const $ = id => document.getElementById(id);
const SCENES = [{ id: 'services', ms: 3 * 60_000 }, { id: 'weather', ms: 3 * 60_000 }, { id: 'power', ms: 3 * 60_000 }, { id: 'network', ms: 3 * 60_000 }];
const names = { operational: 'Operational', degraded: 'Degraded', outage: 'Outage', maintenance: 'Maintenance', unknown: 'Unconfirmed' };
const node = (tag, className, value) => { const element = document.createElement(tag); element.className = className; if (value !== undefined) element.textContent = value; return element; };
const number = (value, suffix = '') => Number.isFinite(value) ? `${Math.round(value)}${suffix}` : '—';
const condition = code => weatherInfo(code).label;

export function initTV({ api, setAudioDuck }) {
  let active = false, sceneId = 'services', deadline = 0, timer, ticker, powerRefresh, powerVersion = 0, snapshot, forecast, place, network, power, powerTest=false;
  const screen = $('tv-board'), content = $('tv-content');
  const radio = document.querySelector('.radio-bar'), radioHome = radio.parentNode;
  const radioAnchor = document.createComment('radio home'); radio.before(radioAnchor);
  let idleTimer, noticeTimer, previousStates, weatherRefresh, weatherVersion = 0, renderedWeatherHour, watchReport, watchRefresh, watchVersion=0, watchMoreTimer, nameTimer, namesBusy=false;
  const attemptedNames=new Set();
  function wake() {
    if (!active) return;
    screen.classList.remove('tv-idle');clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>screen.classList.add('tv-idle'),4000);
  }
  for (const event of ['pointermove','pointerdown','keydown','focusin']) document.addEventListener(event,wake,{passive:true});
  const audio=$('audio');
  const sound=createBoardAlerts({setDuckGain:setAudioDuck,button:$('tv-audio')});
  function radioState() { radio.dataset.playing=String(!audio.paused&&!audio.ended&&audio.readyState>=3); }
  for (const event of ['playing','pause','waiting','ended','emptied','error']) audio.addEventListener(event,radioState);
  const equalizer=node('div','tv-equalizer');equalizer.setAttribute('aria-hidden','true');for(let i=0;i<5;i++)equalizer.append(node('i',''));radio.append(equalizer);
  function announce(changes, test = false) {
    if (!active || !changes.length) return;
    sound.announce(changes);
    const priority=['outage','degraded','unknown','maintenance','operational'];
    const state=priority.find(status=>changes.some(change=>change.to===status))||'unknown';
    const panel=node('article',`tv-notice tv-notice-${state}`);panel.dataset.status=state;
    const heading=node('div','tv-notice-heading'),icon=node('span','tv-notice-icon',({outage:'!',degraded:'!',unknown:'?',maintenance:'↻',operational:'✓'})[state]);icon.setAttribute('aria-hidden','true');
    const label=node('div','');label.append(node('span','tv-notice-kicker',test?'TEST ALERT':'SERVICE UPDATE'),node('strong','tv-notice-title',({outage:'Service outage',degraded:'Service degraded',unknown:'Status unconfirmed',maintenance:'Maintenance update',operational:'Service restored'})[state]));heading.append(icon,label);panel.append(heading);
    for(const change of changes.slice(0,3)) {
      const row=node('div',`tv-notice-row tv-${change.to}`);row.style.setProperty('--notice-order',panel.querySelectorAll('.tv-notice-row').length);
      row.append(node('strong','',change.name),node('span','',`${names[change.from]||'Unconfirmed'} → ${names[change.to]||'Unconfirmed'}`));panel.append(row);
    }
    if(changes.length>3)panel.append(node('p','',`+ ${changes.length-3} other services changed. See the Services channel.`));
    const close=node('button','tv-notice-close','×');close.type='button';close.setAttribute('aria-label','Dismiss service update');close.onclick=()=>dismissNotice(panel);panel.append(close);
    const progress=node('div','tv-notice-lifetime');progress.setAttribute('aria-hidden','true');panel.append(progress);
    $('tv-notifications').replaceChildren(panel);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>dismissNotice(panel),18000);
  }
  function dismissNotice(panel){
    if(!panel.isConnected||panel.dataset.leaving)return;
    panel.dataset.leaving='true';clearTimeout(noticeTimer);
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){panel.remove();return;}
    const exit=panel.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(-24px) scale(.98)'}],{duration:280,easing:'ease-in',fill:'forwards'});
    exit.finished.then(()=>panel.remove()).catch(()=>panel.remove());
  }
  const testStates=['outage','degraded','maintenance','operational','unknown'];let testIndex=0;
  $('tv-test-alert').title='Click again to test outage, degradation, maintenance, recovery, and unconfirmed alerts';
  $('tv-test-alert').addEventListener('click',()=>{const to=testStates[testIndex++%testStates.length];announce([{name:'Test service',from:to==='operational'?'outage':'operational',to}],true);});
  let servicePage = 0, serviceTimelineSlot = 0;
  const pageSize = () => window.innerWidth < 700 ? 4 : window.innerHeight < 850 ? 6 : 8;
  const pagedServices = () => servicePages(snapshot?.services || [], pageSize());
  const pageCount = () => pagedServices().length;
  function turnPage(direction = 1) { servicePage = (servicePage + direction + pageCount()) % pageCount(); changePage(services); }
  function ribbon() {
    const list = snapshot?.services || [];
    $('tv-overview').textContent = list.length ? `${list.filter(s => status(s) === 'operational').length} / ${list.length} services operational` : 'Services · connecting';
    $('tv-local-weather').textContent = forecast?.conditions?.current ? `${number(forecast.conditions.current.temperature_2m)}°F · ${condition(forecast.conditions.current.weather_code)}` : 'Weather · unavailable';
  }
  function available() { return SCENES.filter(scene => scene.id !== 'power' || powerTest || power?.available && power.active); }
  function current() { return available().find(scene => scene.id === sceneId) || available()[0]; }
  const status = boardStatus;
  function title(text, subtext) { delete screen.dataset.conditions; const heading=node('div','tv-heading');heading.append(node('h1','tv-title',text),node('p','tv-subtitle',subtext));content.replaceChildren(heading); }
  function services() {
    const list = snapshot?.services || [];
    const issues = list.filter(s => !['operational', 'unknown'].includes(status(s)));
    servicePage %= pageCount();
    if(active&&sceneId==='services'&&document.querySelector('[data-tv-channel=services] .tv-channel-progress')?.childElementCount!==pageCount()*4){serviceTimelineSlot=serviceSlot(current().ms-(deadline-Date.now()),current().ms,pageCount());servicePage=serviceTimelineSlot%pageCount();buildChannelProgress();}
    title('Service report', `${list.length} services · ${issues.length} issues / maintenance · ${list.filter(s => status(s) === 'unknown').length} unconfirmed · PAGE ${servicePage + 1} OF ${pageCount()}`);
    const paging = node('div', 'tv-paging');
    const previous = node('button', '', '←'); previous.type = 'button'; previous.setAttribute('aria-label', 'Previous service page'); previous.onclick = () => turnPage(-1);
    const nextPage = node('button', '', '→'); nextPage.type = 'button'; nextPage.setAttribute('aria-label', 'Next service page'); nextPage.onclick = () => turnPage();
    paging.append(previous, nextPage);content.querySelector('.tv-heading').append(paging);
    const grid = node('div', 'tv-services');
    for (const s of pagedServices()[servicePage]) {
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
  let weatherPage = 0, weatherDeadline = 0, networkResult = null, probeVersion = 0, networkPage=0, networkDeadline=0, reportDeadline=0;
  const reportPages={2:0,3:0};
  const reportSize=()=>window.innerWidth<700||networkPage===2?2:window.innerHeight<850?2:4;
  const networkPages=['Your connection','Your ASNs','Upstream watch','North America'];
  const channelStep = id => ({services:servicePageDuration(SCENES.find(scene=>scene.id==='services').ms,pageCount()),weather:SCENES.find(scene=>scene.id==='weather').ms/weatherPages.length,network:45000,power:SCENES.find(scene=>scene.id==='power').ms})[id];
  function channelPages(id){return id==='weather'?weatherPages:id==='network'?networkPages:id==='services'?Array.from({length:pageCount()},(_,i)=>`Service page ${i+1}`):['Local outages'];}
  function buildChannelProgress(){
    document.querySelectorAll('[data-tv-channel]').forEach(channel=>{
      const id=channel.dataset.tvChannel,scene=SCENES.find(s=>s.id===id),pages=channelPages(id);
      const select=node('button','tv-channel-name',id[0].toUpperCase()+id.slice(1));
      select.type='button';select.setAttribute('aria-label',`Show ${id} channel`);select.setAttribute('aria-pressed',String(id===sceneId));
      select.onclick=()=>{
        if(!active||id===sceneId)return;
        if(sceneId==='network')rememberNextReport();
        if(powerTest&&id!=='power')powerTest=false;
        sceneId=id;draw();channel.querySelector('.tv-channel-name').focus();wake();
      };
      channel.replaceChildren(select);
      const track=node('div','tv-channel-progress');track.setAttribute('aria-label',`${id} channel timeline`);
      track.dataset.duration=String(scene.ms);
      for(let i=0;i<(id==='services'?pages.length*4:Math.ceil(scene.ms/channelStep(id)));i++){
        const segment=node('button','tv-channel-segment');segment.type='button';segment.disabled=id!==sceneId;
        segment.setAttribute('aria-label',`${String(i+1).padStart(2,'0')} ${pages[i%pages.length]}`);
        segment.title=pages[i%pages.length];segment.append(node('span',''));
        segment.onclick=()=>{
          const now=Date.now(),step=channelStep(id);deadline=now+scene.ms-i*step;
          clearTimeout(timer);timer=setTimeout(next,deadline-now);
          if(id==='weather'){weatherPage=i%pages.length;weatherDeadline=now+step;changePage(weather);}
          if(id==='network'){rememberNextReport();networkPage=i%pages.length;networkDeadline=now+step;reportDeadline=now+15000;changePage(connection);}
          if(id==='services'){servicePage=i%pages.length;serviceTimelineSlot=i;changePage(services);}
          updatePageProgress();
        };
        track.append(segment);
      }
      channel.append(track);
    });
  }
  function updatePageProgress(){
    const now=Date.now();
    document.querySelectorAll('[data-tv-channel]').forEach(channel=>{
      const id=channel.dataset.tvChannel,scene=SCENES.find(s=>s.id===id),elapsed=id===sceneId?Math.max(0,scene.ms-(deadline-now)):0,step=channelStep(id);
      channel.querySelectorAll('.tv-channel-segment').forEach((segment,i)=>{
        const fill=Math.max(0,Math.min(1,(elapsed-i*step)/step));
        segment.firstChild.style.transform=`scaleX(${fill})`;
        if(id===sceneId&&elapsed>=i*step&&elapsed<(i+1)*step)segment.setAttribute('aria-current','step');else segment.removeAttribute('aria-current');
      });
      channel.title=id===sceneId?`${Math.max(0,Math.ceil((deadline-now)/1000))} seconds remaining`:id;
    });
  }
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
    const cards=content.querySelectorAll('.tv-hour,.tv-extended-day,.tv-service,.tv-current-metrics>.tv-network-card,.tv-watch-event,.tv-asn-card');
    if(cards.length)cards.forEach((card,i)=>sceneAnimations.push(card.animate([{transform:'perspective(1000px) translateX(110px) rotateY(-18deg)',opacity:0},{transform:'perspective(1000px) translateX(0) rotateY(0)',opacity:1}],{duration:720,delay:180+i*80,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'})));
    else for(const panel of content.querySelectorAll('.tv-model-chart,.tv-route,.tv-network,.tv-probe,.tv-map'))sceneAnimations.push(panel.animate([{transform:'translateX(100%)'},{transform:'translateX(0)'}],{duration:750,delay:120,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'}));
  }
  function weatherTurn(direction = 1) { weatherPage = Math.max(0, Math.min(weatherPages.length - 1, weatherPage + direction)); weatherDeadline = Date.now() + channelStep('weather'); changePage(weather); }
  function metric(label, value, className = 'tv-network-card') { const card = node('div', className); card.append(node('span', '', label), node('strong', '', value)); return card; }
  function weather() {
    renderedWeatherHour = Math.floor(Date.now()/3600000);
    title(weatherPages[weatherPage], WARREN.label);
    screen.dataset.weatherPage = String(weatherPage);
    [weatherCurrent, weatherHourly, weatherModels, weatherDays][weatherPage]();
    const alerts = forecast?.alerts?.items || [];
    if (alerts.length) content.append(node('p', 'tv-weather-alert', `WEATHER ALERT · ${alerts.slice(0,2).map(a => a.event).join(' · ')}`));
    else if (forecast?.alerts?.available === false) content.append(node('p', 'tv-muted', 'Weather alerts could not be checked.'));
    const stamp = forecast?.conditions?.fetchedAt;
    content.append(node('p', 'tv-muted', `${forecast?.refreshFailed?'Refresh unavailable · showing last received report · ':''}Forecast estimates · °F / mph · ${stamp ? 'updated ' + new Date(stamp).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : 'update time unavailable'} · pages change every ${channelStep('weather')/1000} seconds`));
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
    const report=power||{};
    title('Warren & Bristol power', powerTest?'TEST VIEW · live data when available · no simulated outages':'Rhode Island Energy · local outage report');
    const layout=node('div','tv-power-layout'),details=node('aside','tv-power-details');
    details.append(node('span','tv-power-label',powerTest?'POWER CHANNEL PREVIEW':'LOCAL OUTAGE REPORT'),node('p','tv-power-count',report.available?`${number(report.count)} customers affected`:'Status unavailable'),node('p','tv-power-region','Warren & Bristol, RI'));
    for(const town of report.towns||[])details.append(node('p','tv-power-town',`${town.name} · ${number(town.count)} affected`));
    details.append(node('p','tv-muted',`Last checked ${report.checkedAt?new Date(report.checkedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'unavailable'}`));
    details.append(node('p','tv-muted',report.available&&report.count===0?'No outages reported in these two towns.':'Utility reports may be delayed. Markers show approximate outage locations, not individual homes.'));
    const link=node('a','tv-map-link','Open Rhode Island Energy map ↗');link.href='https://outagemap.rienergy.com/OMAP';link.target='_blank';link.rel='noopener noreferrer';details.append(link);
    layout.append(details,renderPowerMap(report));content.append(layout);
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
    const route=node('div','tv-route');route.append(node('span','',navigator.onLine?'Browser network · connected':'Browser network · disconnected'),node('span','tv-route-line','→'),node('span','',network?.asOrganization||'Network unavailable'),node('span','tv-route-line','→'),node('span','',`Cloudflare · ${network?.colo||'unknown edge'}`));content.append(route);
    const grid=node('div','tv-network tv-network-expanded');
    for(const [label,value] of [['Edge location',network?.colo],['Network / ASN',network?.asn?`AS${network.asn} · ${network.asOrganization||'Name unavailable'}`:null],['Approx. region',[network?.region,network?.country].filter(Boolean).join(', ')],['HTTP protocol',network?.protocol],['Transport security',network?.tls],['Browser network signal',navigator.onLine?'Connected':'Disconnected']])grid.append(metric(label,value||'Unavailable'));
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
    else {title(networkPages[networkPage],networkPage===3?'RADAR · Networks involved in the last 7 days':'RIPE + RADAR · 3 monitored networks');renderNetworkWatch(content,watchReport,networkPage,{index:reportPages[networkPage]||0,size:reportSize(),onTurn:turnReport});}
    void loadVisibleNames();
  }
  async function loadVisibleNames(){
    if(namesBusy||!active||sceneId!=='network'||!watchReport||watchReport.error)return;
    const ids=visibleNetworkASNs(watchReport,networkPage,reportPages[networkPage]||0,reportSize()).filter(asn=>!watchReport.names?.[asn]&&!attemptedNames.has(asn)).slice(0,20);
    if(!ids.length)return;namesBusy=true;ids.forEach(asn=>attemptedNames.add(asn));const version=watchVersion;
    try{const data=await api(`/api/asn-names?asns=${ids.join(',')}`);if(active&&version===watchVersion){watchReport.names={...watchReport.names,...data.names};if(sceneId==='network'&&networkPage!==0)connection();}}catch{}finally{namesBusy=false;}
    clearTimeout(nameTimer);if(active)nameTimer=setTimeout(()=>void loadVisibleNames(),1800);
  }
  function turnReport(direction=1){
    const section=networkPage===2?watchReport?.upstream:watchReport?.northAmerica;
    const count=Math.max(1,Math.ceil((section?.events?.length||0)/reportSize()));
    reportDeadline=Date.now()+15000;if(count===1)return;
    reportPages[networkPage]=((reportPages[networkPage]||0)+direction+count)%count;changePage(connection);
  }
  function rememberNextReport(){if(networkPage>=2)reportPages[networkPage]=(reportPages[networkPage]||0)+1;}
  async function loadMoreWatch(version){
    if(!active||version!==watchVersion)return;
    const feed=watchReport?.feeds?.find(f=>f.nextPage&&!f.loadFailed);if(!feed)return;
    let patch;
    try{patch=await api(`/api/network-watch-page?${new URLSearchParams({kind:feed.kind,asn:feed.asn,page:feed.nextPage,at:watchReport.at})}`);}catch{patch={kind:feed.kind,asn:feed.asn,available:false,events:[],nextPage:feed.nextPage};}
    if(!active||version!==watchVersion)return;
    watchReport=appendNetworkFeed(watchReport,patch);
    if(sceneId==='network'&&networkPage!==0)connection();
    if(watchReport.loadingMore)watchMoreTimer=setTimeout(()=>void loadMoreWatch(version),1800);
  }
  async function refreshWatch(){
    if(!active)return;clearTimeout(watchMoreTimer);const version=++watchVersion;
    try{const data=await api('/api/network-watch');if(!active||version!==watchVersion)return;watchReport={...data,names:{...watchReport?.names,...data.names}};attemptedNames.clear();}
    catch{if(!active||version!==watchVersion)return;watchReport=watchReport&&!watchReport.error?{...watchReport,refreshFailed:true}:{error:true};}
    if(sceneId==='network'&&networkPage!==0)connection();
    if(watchReport.loadingMore)watchMoreTimer=setTimeout(()=>void loadMoreWatch(version),1800);
  }
  function draw() {
    if (!active) return;
    const scene = current();
    ++probeVersion; networkPage=0;networkDeadline=Date.now()+45000;reportDeadline=Date.now()+15000;weatherPage = 0; weatherDeadline = Date.now() + channelStep('weather');
    screen.dataset.scene = scene.id;
    document.querySelectorAll('[data-tv-channel]').forEach(el => { el.classList.toggle('selected',el.dataset.tvChannel===scene.id); el.hidden=el.dataset.tvChannel==='power'&&!powerTest&&!power?.active; });
    servicePage = 0; serviceTimelineSlot=0; ribbon();
    deadline = Date.now() + scene.ms;
    buildChannelProgress();
    changePage(({ services, weather, power: outage, network: connection })[scene.id]); if (scene.id === 'network') void connectionCheck();
    deadline = Date.now() + scene.ms;
    clearTimeout(timer); timer = setTimeout(next, scene.ms);
    tick();
  }
  function tick() { if (!active) return; ribbon(); if(sceneId==='weather'){if(renderedWeatherHour!==Math.floor(Date.now()/3600000))weather();else updateWeatherTime();} if(sceneId==='network'&&Date.now()>=networkDeadline){rememberNextReport();networkPage=(networkPage+1)%networkPages.length;networkDeadline=Date.now()+45000;reportDeadline=Date.now()+15000;changePage(connection);} if(sceneId==='network'&&networkPage>=2&&Date.now()>=reportDeadline)turnReport(); if (sceneId === 'services') { const duration=current().ms,slot=serviceSlot(duration-(deadline-Date.now()),duration,pageCount());if(slot!==serviceTimelineSlot){servicePage=(servicePage+slot-serviceTimelineSlot+pageCount()*4)%pageCount();serviceTimelineSlot=slot;changePage(services);} } if (sceneId === 'weather' && Date.now() >= weatherDeadline) weatherTurn(); updatePageProgress(); const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); $('tv-next').textContent = `Next channel in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; $('tv-clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function next() { const wasTest=powerTest;if(sceneId==='network')rememberNextReport(); const scenes = available(), at = scenes.findIndex(s => s.id === sceneId); sceneId = scenes[(at + 1) % scenes.length].id;if(wasTest)powerTest=false; draw(); }
  async function refreshPower() {
    if (!active) return;
    const version = ++powerVersion;
    try {
      const data = await api(`/api/power?lat=${WARREN.latitude}&lon=${WARREN.longitude}&region=RI`);
      if (!active || version !== powerVersion) return;
      power = data;
      if (sceneId === 'power' && !powerTest && !data.active) { sceneId = 'network'; draw(); } else if(sceneId==='power') outage();
    } catch { if (version === powerVersion) { power = null; if (active && sceneId === 'power') { if(powerTest)outage();else{sceneId = 'network'; draw();} } } }
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
  function stop() { powerTest=false;sound.stop();clearTimeout(nameTimer);clearTimeout(watchMoreTimer);++watchVersion;clearInterval(watchRefresh); ++weatherVersion;clearInterval(weatherRefresh);clearTimeout(idleTimer);clearTimeout(noticeTimer);screen.classList.remove('tv-idle');$('tv-notifications').replaceChildren();clearTransition(); radioHome.insertBefore(radio, radioAnchor.nextSibling); active = false; ++probeVersion; ++powerVersion; screen.hidden = true; clearTimeout(timer); clearInterval(ticker); clearInterval(powerRefresh); content.replaceChildren(); }
  function update(data) { if ('snapshot' in data) { snapshot=data.snapshot;const result=boardChanges(previousStates,snapshot?.services||[]);previousStates=result.next;announce(result.changes); } if ('forecast' in data && place?.latitude===WARREN.latitude && place?.longitude===WARREN.longitude && Number.isFinite(localConditions(data.forecast?.conditions).current.temperature_2m)) forecast = data.forecast; if ('place' in data) { place = data.place; power = null; if (active) { if (sceneId === 'power') { sceneId = 'network'; draw(); } void refreshPower(); } } if ('network' in data) network = data.network; if (active && sceneId !== 'power') ({ services, weather, network: connection })[sceneId](); }
  $('tv-test-power').addEventListener('click',()=>{powerTest=true;sceneId='power';wake();draw();void refreshPower();});
  $('tv-skip').addEventListener('click', next);
  return { start, stop, update };
}
