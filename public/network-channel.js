import { reportPage, asnLabel, networkReportState } from './network-report.js';
const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const date=value=>value?new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time unavailable';
const link=(label,url)=>{const el=node('a','tv-map-link',label);el.href=url;el.target='_blank';el.rel='noopener noreferrer';return el;};
export function feedDiagnostic(feed){
  if(!feed)return 'Missing feed';
  const reasons={http_401:'Authentication rejected (401)',http_403:'Access denied (403)',http_429:'Rate limited (429)',timeout:'Source timed out',invalid_response:'Invalid source response',response_too_large:'Source response too large',request_failed:'Source request failed',worker_request_limit:'Worker request budget exceeded'};
  return reasons[feed.detail]||feed.reason||'Unavailable';
}
const feedNames={outages:'Outage reports',leaks:'Route leaks',hijacks:'Potential hijacks'};
function emptyReport(report,section,page){
  const state=networkReportState(report,section),panel=node('article','tv-watch-empty');panel.dataset.state=state;
  const scope=page===2?'UPSTREAM ROUTING WATCH':'NORTH AMERICAN NETWORKS';
  const messages={
    loading:['Gathering network reports','The Board will update automatically when the sources respond.'],
    error:['Network reports temporarily unavailable','The next refresh will retry automatically. Current network health is unknown.'],
    disconnected:['Report feeds are not connected','Routing observations are separate from outage coverage. No incident assessment is available.'],
    stale:['Waiting for a fresh report','A fresh report is overdue. Previous observations are retained; current coverage is unconfirmed.'],
    incomplete:['Report coverage is incomplete','Coverage is unknown for the sources or networks listed below. Available reports cannot establish current health.'],
    partial:['More reports are still loading','No matches in the reports loaded so far. The remaining seven-day history is still being checked.'],
    empty:['No relevant recent detections',page===2?'No current reports identified a monitored ASN or an observed upstream as an incident participant.':'No current reports matched monitored networks, upstream incident roles, or regional outage context.']
  };
  const [heading,detail]=messages[state]||messages.incomplete;
  panel.append(node('span','tv-watch-kicker',scope),node('h2','',heading),node('p','',detail),node('p','tv-watch-empty-note','Report coverage is not an uptime test.'));
  return panel;
}
function coverage(report,asn=0){
  const feeds=report.feeds?.filter(feed=>feed.asn===asn)||[];
  if(!feeds.length)return null;
  const grid=node('div','tv-watch-coverage');
  for(const [kind,label] of Object.entries(feedNames)){
    const feed=feeds.find(feed=>feed.kind===kind),item=node('div','');
    item.append(node('span','',label),node('strong','',!report.radarConfigured?'Not connected':!feed?.available?feedDiagnostic(feed):feed.loadFailed?'History failed':feed.nextPage?'Loading history':'Available'));
    grid.append(item);
  }
  return grid;
}
export function renderNetworkWatch(content,report,page,{index=0,size=6,onTurn=()=>{}}={}){
  if(!report||report.error){content.append(emptyReport(report,null,page));return;}
  if(report.refreshFailed||(report.checkedAt&&Date.now()-Date.parse(report.checkedAt)>600000))content.append(node('p','tv-watch-warning','Report is stale · showing previous observations. Retrying automatically.'));
  if(!report.radarConfigured)content.append(node('p','tv-watch-warning','Incident feeds are not connected. Routing observations remain available separately.'));
  if(page===1){
    const grid=node('div','tv-asn-grid');
    for(const network of report.networks||[]){
      const events=network.events||[],card=node('article','tv-asn-card');
      const label=events.length?`${events.length} reports collected in 7 days`:!network.eventsAvailable?'Report coverage incomplete':network.limited?'No matches loaded so far':'No matching reports in 7 days';
      card.append(node('h2','',asnLabel(report,network.asn)),node('strong','tv-asn-status',label));
      card.append(node('p','',network.routingAvailable?(network.announced?'Routes visible to RIPE observers':'No routes visible to RIPE observers'):'Route observations unavailable'),node('small','tv-muted',`Observed ${date(network.routingAt)}`));
      card.append(node('p','',network.neighboursAvailable?`${network.upstream?.length||0} observer-side neighbours · ${network.uncertain?.length||0} uncertain links excluded`:'Adjacent network observations unavailable'));
      const feeds=coverage(report,network.asn);if(feeds)card.append(feeds);
      if(network.limited)card.append(node('p','tv-watch-warning','Seven-day history is still loading.'));
      card.append(link('View ASN on Radar ↗',`https://radar.cloudflare.com/as${network.asn}`));grid.append(card);
    }
    content.append(grid,node('p','tv-muted','Route visibility does not establish uptime. These reports include ended events and do not cover every ISP incident.'));
  }else{
    const section=(page===2?report.upstream:report.northAmerica)||{available:false,events:[]};
    if(page===2){
      const paths=node('div','tv-watch-paths');
      for(const network of report.networks||[]){
        const card=node('article','tv-watch-path'),ids=network.upstream||[];
        card.append(node('h2','',asnLabel(report,network.asn)),node('strong','',network.neighboursStale?'Stale routing observations':!network.neighboursAvailable?'Network links unavailable':!ids.length?'Upstreams unknown':`${ids.length} observed network ${ids.length===1?'link':'links'}`));
        if(network.neighboursStale)card.append(node('p','', 'Previous neighbours are retained; current upstreams are unknown.'));
        else if(!network.neighboursAvailable)card.append(node('p','', 'RIPE observations could not be retrieved.'));
        else if(!ids.length)card.append(node('p','', network.announced===false?'RIPE RIS sees no announced routes or observer-side neighbours. The ISP provider is unknown.':'RIPE RIS sees no observer-side neighbours. The ISP provider is unknown.'));
        else{card.append(node('p','',ids.slice(0,2).map(asn=>asnLabel(report,asn)).join(' · ')));if(ids.length>2)card.append(node('span','tv-muted',`+ ${ids.length-2} other observed links`));}
        paths.append(card);
      }
      content.append(paths,node('p','tv-muted','Observer-side AS-path neighbours: possible transit or peers, not confirmed ISP contracts. Matching reports do not prove local impact.'));
    }
    const events=section.events||[];
    if(section.selection){const s=section.selection;content.append(node('p','tv-muted',`${s.shown} relevant reports shown · ${s.collected} reviewed · ${s.historical+s.unrelated+s.transitOnly+s.olderOrUnknown} history or unrelated reports excluded${s.omittedByLimit?` · ${s.omittedByLimit} additional context reports omitted`:''}${s.roleUnknown?` · ${s.roleUnknown} records lack incident-role metadata; relevance coverage unknown`:''}. Direct ongoing reports are always retained; provider/context observations must be within 24 hours.`));}
    if(report.upstream?.topologyIncomplete)content.append(node('p','tv-watch-warning','Upstreams unknown for '+(report.networks||[]).filter(n=>!n.neighboursAvailable||n.neighboursStale||!n.upstream?.length).map(n=>`AS${n.asn}`).join(', ')+'. Monitoring covers only observed candidates.'));
    if(events.length&&!section.available&&!section.topologyIncomplete)content.append(node('p','tv-watch-warning','Partial coverage · reports from available sources are shown.'));
    if(events.length&&section.limited)content.append(node('p',report.loadFailed?'tv-watch-warning':'tv-muted',report.loadFailed?'Some older reports could not be loaded. Retrying on the next refresh.':'Loading additional seven-day history…'));
    const slice=reportPage(events,index,size);
    if(slice.pages>1){const paging=node('div','tv-paging tv-report-paging');paging.append(node('span','',`PAGE ${slice.page+1} OF ${slice.pages} · ${events.length} reports · changes every 15 seconds`));for(const [label,direction,glyph] of [['Previous report page',-1,'←'],['Next report page',1,'→']]){const button=node('button','',glyph);button.type='button';button.setAttribute('aria-label',label);button.onclick=()=>onTurn(direction);paging.append(button);}content.append(paging);}
    const list=node('div','tv-watch-events');
    for(const event of slice.events){
      const row=node('article','tv-watch-event');if(event.relevance)row.append(node('p','tv-watch-impact',event.relevance==='Regional outage context'?'Regional context · local impact unconfirmed':event.relevance==='Direct monitored-ASN report'?'Monitored-ASN involvement · local impact unconfirmed':event.relevance==='Recent direct recovery'?'Recent reported recovery · circuit health unconfirmed':'Upstream context · local impact unconfirmed'));row.append(node('span','tv-watch-state',event.state),node('h2','',event.type),node('p','',event.description.replace(/AS(\d+)/g,(_,asn)=>asnLabel(report,asn))),node('small','tv-muted',`${event.relevance?event.relevance+' · ':''}${event.observationFresh===false?'Observation over 24h old or time unavailable · ':''}${date(event.start)} · ${event.asns.map(a=>asnLabel(report,a)).join(', ')||event.countries.join(', ')}${event.via?.length?' · observer-side neighbour of '+[...new Set(event.via.map(v=>asnLabel(report,v.parent)))].join(', '):''}`));list.append(row);
    }
    if(!events.length)list.append(emptyReport(report,section,page));
    content.append(list);
    if(!events.length||report.feeds?.some(f=>f.asn===0&&(!f.available||f.nextPage))){const feeds=coverage(report);if(feeds)content.append(feeds);}
    content.append(node('p','tv-muted',page===3?'Includes events involving a North American network, even when other participants are overseas. Detections do not establish a local ISP outage.':'Reports include ended events. Routing detections do not establish an ISP outage.'));
  }
  const sources=node('div','tv-watch-sources');sources.append(link('Outage Center ↗','https://radar.cloudflare.com/outage-center'),link('Routing anomalies ↗','https://radar.cloudflare.com/routing/anomalies'),node('span','tv-muted',`Last report ${date(report.checkedAt)} · refreshes every 5 minutes`));content.append(sources);
}
