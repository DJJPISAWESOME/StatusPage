import {PANELS,PANEL_NAMES,readPreferences,savePreferences} from './preferences.js';
import {scopeService,shouldNotify,disagreement,historySummary} from './policy.js';
const $=id=>document.getElementById(id);
function el(tag,text='',className=''){const e=document.createElement(tag);e.textContent=text;e.className=className;return e;}
function button(text,action){const b=el('button',text,'outline-button');b.type='button';b.addEventListener('click',action);return b;}
function field(title,input){input.setAttribute('aria-label',title);const label=el('label',title,'setting-field');label.append(input);return label;}
function select(values,value){const s=el('select');for(const [id,name] of values){const o=el('option',name);o.value=id;s.append(o);}s.value=value;return s;}
function check(checked,action){const c=el('input');c.type='checkbox';c.checked=checked;c.addEventListener('change',()=>action(c.checked));return c;}
const stamp=t=>t?new Date(t).toLocaleString():'Not yet';
const amount=(n,suffix='',digits=0)=>Number.isFinite(n)?n.toFixed(digits)+suffix:'—';
function table(head,rows){const t=el('table'),h=el('thead'),tr=el('tr');head.forEach(x=>tr.append(el('th',x)));h.append(tr);t.append(h);const body=el('tbody');rows.forEach(row=>{const tr=el('tr');row.forEach(x=>tr.append(el('td',String(x))));body.append(tr);});t.append(body);return t;}
function scrollTable(t,label){const d=el('div','','data-scroll');d.tabIndex=0;d.setAttribute('aria-label',label);d.append(t);return d;}
export function initEnhancements({api,onChange}) {
  let preferences=readPreferences(),raw=null,baseline=new Map(),historyData=null,historyRows=[],historyVersion=0,rotation=0,boardIndex=0;
  const backgroundAlerts=()=>preferences.alerts.enabled&&globalThis.Notification?.permission==='granted';
  function save(reset=true){preferences=savePreferences(preferences);if(reset)baseline.clear();applyLayout();onChange();}
  function applyLayout(){
    const footer=document.querySelector('.page-footer');for(const id of preferences.panelOrder){const node=$(id);node.hidden=preferences.hiddenPanels.includes(id);node.classList.remove('rotation-hidden');footer.before(node);}
    document.body.dataset.density=preferences.density;clearInterval(rotation);
    if(preferences.boardSeconds)rotation=setInterval(()=>{
      if(document.hidden||!document.body.classList.contains('board-mode')||document.querySelector('dialog[open]')||document.activeElement?.closest('main')&&document.activeElement!==document.body)return;
      const visible=preferences.panelOrder.filter(id=>!preferences.hiddenPanels.includes(id));boardIndex=(boardIndex+1)%visible.length;
      visible.forEach((id,i)=>$(id).classList.toggle('rotation-hidden',i!==boardIndex));
    },preferences.boardSeconds*1000);
  }
  new MutationObserver(()=>{if(!document.body.classList.contains('board-mode'))PANELS.forEach(id=>$(id).classList.remove('rotation-hidden'));}).observe(document.body,{attributes:true,attributeFilter:['class']});
  async function sendNotification(service,previous,next){
    const action=async()=>{try{
      const key=`${service.id}:${previous}:${next}:${service.checkedAt}`;let seen=JSON.parse(localStorage.getItem('signal:notifications')||'{}');seen=Object.fromEntries(Object.entries(seen).filter(([,at])=>Date.now()-at<86400000));if(seen[key])return;
      seen[key]=Date.now();localStorage.setItem('signal:notifications',JSON.stringify(seen));
      const title=`${service.name}: ${next==='operational'?'recovered':next}`,options={body:service.scope||service.incidents?.[0]?.title||'Open Signal for provider details.',tag:`signal-${service.id}`,icon:'/icon.svg'};
      const registration=await navigator.serviceWorker?.getRegistration();if(registration)await registration.showNotification(title,options);else new Notification(title,options);
    }catch{/* Permission or storage can change while the app is open. */}};
    if(navigator.locks)await navigator.locks.request('signal-notifications',action);else await action();
  }
  function processSnapshot(snapshot){
    raw=snapshot;renderHealth();
    const services=snapshot.services.filter(s=>!preferences.hiddenServices.includes(s.id)).map(s=>scopeService(s,preferences.components[s.id]));
    for(const service of services){const next=service.checkedAt&&Date.now()-Date.parse(service.checkedAt)<=service.staleAfterMs?service.status:'unknown';const previous=baseline.get(service.id);baseline.set(service.id,next);
      if(!snapshot.demo&&backgroundAlerts()&&shouldNotify(previous,next,preferences.alerts))void sendNotification(service,previous,next);
    }
    return {...snapshot,services};
  }
  const healthSearch=el('input');healthSearch.type='search';healthSearch.placeholder='Find an integration';healthSearch.setAttribute('aria-label','Find an integration');$('health-controls').append(healthSearch);healthSearch.addEventListener('input',renderHealth);
  function renderHealth(){if(!raw)return;const rows=raw.services.filter(s=>s.name.toLowerCase().includes(healthSearch.value.toLowerCase())).map(s=>[s.name,s.error?`${s.detail||'upstream'}${s.httpStatus?' · HTTP '+s.httpStatus:''}`:s.note?'Feed only':'Connected',stamp(s.lastSuccessAt),stamp(s.nextCheckAt),s.consecutiveFailures||0,s.mode==='webhook'?`${stamp(raw.webhookActivity?.[s.id]?.lastAcceptedAt)} · ${raw.webhookActivity?.[s.id]?.count||0} accepted`:'Scheduled']);$('health-results').replaceChildren(scrollTable(table(['Integration','Source health','Last success','Next check','Failures','Webhook'],rows),'Integration health table'));}
  function settings(){
    const body=$('settings-body');body.replaceChildren();
    const display=el('section');display.append(el('h3','Make it yours'));
    const density=select([['comfortable','Comfortable'],['compact','Compact']],preferences.density);density.onchange=()=>{preferences.density=density.value;save(false);};display.append(field('Density',density));
    const rotate=select([['0','Off'],['15','15 seconds'],['30','30 seconds'],['60','60 seconds']],String(preferences.boardSeconds));rotate.onchange=()=>{preferences.boardSeconds=Number(rotate.value);save(false);};display.append(field('Rotate panels in board view',rotate),el('p','Rotation pauses while a dialog or panel control has focus.','fine-print'));
    for(const [index,id] of preferences.panelOrder.entries()){
      const row=el('div','','panel-setting');row.append(field(PANEL_NAMES[PANELS.indexOf(id)],check(!preferences.hiddenPanels.includes(id),enabled=>{if(!enabled&&preferences.hiddenPanels.length>=PANELS.length-1){settings();return;}preferences.hiddenPanels=enabled?preferences.hiddenPanels.filter(x=>x!==id):[...preferences.hiddenPanels,id];save(false);})));const up=button('↑',()=>{[preferences.panelOrder[index-1],preferences.panelOrder[index]]=[id,preferences.panelOrder[index-1]];save(false);settings();});up.disabled=index===0;up.setAttribute('aria-label',`Move ${PANEL_NAMES[PANELS.indexOf(id)]} up`);const down=button('↓',()=>{[preferences.panelOrder[index+1],preferences.panelOrder[index]]=[id,preferences.panelOrder[index+1]];save(false);settings();});down.disabled=index===PANELS.length-1;down.setAttribute('aria-label',`Move ${PANEL_NAMES[PANELS.indexOf(id)]} down`);row.append(up,down);display.append(row);
    }body.append(display);
    const alerts=el('section');alerts.append(el('h3','Incident notifications'),el('p','Opt in to updates while this app is open, including a background tab. Closed-browser push is not enabled. Preview data never triggers notifications.','fine-print'));
    alerts.append(button(backgroundAlerts()?'Disable notifications':'Enable notifications',async()=>{
      if(backgroundAlerts()){preferences.alerts.enabled=false;save();settings();return;}
      if(!globalThis.Notification){$('settings-feedback').textContent='This browser does not support notifications.';return;}
      const permission=await Notification.requestPermission();if(permission!=='granted'){$('settings-feedback').textContent='Notifications are blocked. Review browser site permissions to enable them.';return;}
      try{await navigator.serviceWorker?.register('/sw.js');}catch{}
      preferences.alerts.enabled=true;save();settings();$('settings-feedback').textContent='Notifications enabled for future changes while the app is open.';
    }));
    const severity=select([['outage','Outages'],['degraded','Outages and degradation'],['maintenance','All issues and maintenance']],preferences.alerts.severity);severity.onchange=()=>{preferences.alerts.severity=severity.value;save();};alerts.append(field('Notify me about',severity),field('Recovery notifications',check(preferences.alerts.recoveries,v=>{preferences.alerts.recoveries=v;save();})),field('Quiet hours (this device’s timezone)',check(preferences.alerts.quiet,v=>{preferences.alerts.quiet=v;save();})));
    for(const [key,name] of [['start','Quiet hours start'],['end','Quiet hours end']]){const input=el('input');input.type='time';input.value=preferences.alerts[key];input.onchange=()=>{preferences.alerts[key]=input.value;save();};alerts.append(field(name,input));}body.append(alerts);
    const services=el('section');services.append(el('h3','Services and regions'),el('p','Select provider components to narrow status coverage where supported. Unmapped incidents retain provider-wide context. Empty component selection means provider-wide. History and diagnostics always retain provider-wide coverage.','fine-print'));
    const search=el('input');search.type='search';search.setAttribute('aria-label','Find a service or region in settings');search.placeholder='Find a service or region';services.append(search);const list=el('div');services.append(list);
    function serviceOptions(){list.replaceChildren();for(const s of raw?.services || []){
      const components=(s.components||[]).filter(c=>!c.group);const query=search.value.toLowerCase();if(!`${s.name} ${components.map(c=>c.name).join(' ')}`.toLowerCase().includes(query))continue;
      const group=el('details');const title=el('summary',s.name);group.append(title,field('Show service and allow its notifications',check(!preferences.hiddenServices.includes(s.id),enabled=>{preferences.hiddenServices=enabled?preferences.hiddenServices.filter(id=>id!==s.id):[...preferences.hiddenServices,s.id];save();})));
      if(preferences.components[s.id]?.length)group.append(button('Use provider-wide coverage',()=>{delete preferences.components[s.id];save();settings();}));
      if(components.length){for(const c of components){group.append(field(c.name,check(preferences.components[s.id]?.includes(c.id),enabled=>{const ids=preferences.components[s.id]||[];preferences.components[s.id]=enabled?[...ids,c.id]:ids.filter(id=>id!==c.id);save();})));}}else group.append(el('p','Provider-wide coverage; no component catalog available.','fine-print'));list.append(group);
    }}search.oninput=serviceOptions;serviceOptions();body.append(services);
  }
  $('settings-button').onclick=()=>{settings();$('settings-dialog').showModal();};
  const historyService=select([['','All providers']],''),historyDays=select([['1','24 hours'],['7','7 days'],['30','30 days']],'7'),historyState=select([['','All states'],['operational','Operational'],['degraded','Degraded'],['outage','Outage'],['maintenance','Maintenance'],['unknown','Unknown']],'');
  historyService.id='history-service';historyState.id='history-state';$('history-controls').append(field('Provider',historyService),field('Period',historyDays),field('State',historyState));
  async function loadHistory(more=false){const version=++historyVersion;const params=new URLSearchParams({service:historyService.value,days:historyDays.value,status:historyState.value});if(more&&historyData?.nextCursor)params.set('before',historyData.nextCursor);$('history-message').textContent='Loading observations…';
    try{const data=await api('/api/history?'+params);if(version!==historyVersion)return;historyData=data;historyRows=more?[...historyRows,...data.rows]:data.rows;const summary=historySummary(data,historyService.value?1:raw?.services.length||32);
      $('history-message').textContent=`Confirmed coverage: ${amount(summary.coverage===null?null:summary.coverage*100,'% ',1)} · Operational share of confirmed time: ${amount(summary.operationalShare===null?null:summary.operationalShare*100,'%',1)}. Missing, stale and unknown time is not counted as operational. History starts at deployment and retains 30 days.`;
      $('history-results').replaceChildren(scrollTable(table(['Provider','State','From','Duration','Evidence'],historyRows.map(r=>[raw?.services.find(s=>s.id===r.service_id)?.name||r.service_id,r.status,stamp(r.start_ms),amount(Math.max(0,r.effectiveEndMs-Math.max(r.start_ms,data.since))/60000,' min',1)+(r.ongoing?' · ongoing':''),r.reason.replaceAll('_',' ')])),'Observation history table'));
      $('history-more').hidden=!data.nextCursor;
    }catch(error){if(version!==historyVersion)return;historyData=null;historyRows=[];$('history-results').replaceChildren();$('history-more').hidden=true;$('history-message').textContent=error.message;}
  }
  for(const input of [historyService,historyDays,historyState])input.onchange=()=>loadHistory();
  $('history-refresh').onclick=()=>{const selected=historyService.value;historyService.replaceChildren(...select([['','All providers'],...(raw?.services||[]).map(s=>[s.id,s.name])],selected).children);historyService.value=selected;loadHistory();};
  $('history-more').onclick=()=>loadHistory(true);
  $('history-export').onclick=()=>{if(!historyRows.length)return;const escape=v=>'"'+String(v).replaceAll('"','""')+'"';const csv=[['provider','status','start_utc','end_utc','reason'],...historyRows.map(r=>[r.service_id,r.status,new Date(Math.max(r.start_ms,historyData.since)).toISOString(),new Date(r.effectiveEndMs).toISOString(),r.reason])].map(row=>row.map(escape).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=el('a');a.href=url;a.download='signal-observations.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  function weatherDetails(weather,place){
    $('local-outlook')?.remove();const section=el('section','','panel local-outlook');section.id='local-outlook';section.append(el('h3','The next 12 hours'));
    const hourly=weather.conditions.hourly,now=Date.now()/1000;const indices=(hourly?.time||[]).map((t,i)=>[t,i]).filter(([t])=>t>=now).slice(0,12);
    section.append(indices.length?scrollTable(table(['Local time','Rain chance','Precipitation','Gusts'],indices.map(([t,i])=>[new Date(t*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:weather.conditions.timezone}),amount(hourly.precipitation_probability?.[i],'%'),amount(hourly.precipitation?.[i],' in',2),amount(hourly.wind_gusts_10m?.[i],' mph')])),'Hourly weather table'):el('p','Hourly precipitation and gust forecasts are unavailable.','fine-print'));
    const delta=disagreement(weather.models);section.append(el('p',delta===null?'Model disagreement unavailable.':`Largest aligned model temperature difference in 48 hours: ${delta.toFixed(1)}°F${delta>=5?' · substantial disagreement':''}. This is not a probability or confidence interval.`,'fine-print'));
    for(const model of weather.models){const m=model.metadata;const initialized=Number(m?.last_run_initialisation_time),available=Number(m?.last_run_availability_time),interval=Number(m?.update_interval_seconds);const overdue=Number.isFinite(available)&&interval>0&&Date.now()/1000-available>interval*2+1200;
      section.append(el('p',`${model.name}: ${model.available?'available':'unavailable'} · fetched ${stamp(model.fetchedAt)} · latest provider run ${Number.isFinite(initialized)&&initialized>0?stamp(initialized*1000):'unavailable'}${overdue?' · provider update overdue':''}`,'fine-print'));
    }section.append(el('p','Run metadata is eventually consistent and does not identify every point in a seamless forecast. Hourly values may be interpolated.','fine-print'));
    const marineResult=el('div');const coastal=button('Load coastal outlook',async()=>{coastal.disabled=true;marineResult.textContent='Loading coastal forecast…';try{const data=await api(`/api/marine?lat=${place.latitude}&lon=${place.longitude}`);const i=data.hourly.time.findIndex(t=>t>=Date.now()/1000);marineResult.textContent=`Sea grid ${data.latitude.toFixed(2)}, ${data.longitude.toFixed(2)} · waves ${amount(data.hourly.wave_height[i],' ft',1)} · period ${amount(data.hourly.wave_period[i],' s',1)}. Not a tide or navigation forecast.`;}catch(error){marineResult.textContent=error.message;}finally{coastal.disabled=false;}});coastal.id='coastal-button';section.append(coastal,marineResult);$('forecast').append(section);
  }
  applyLayout();
  return {processSnapshot,weatherDetails,backgroundAlerts,resetBaseline:()=>baseline.clear()};
}
