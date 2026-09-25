import { reportPage, asnLabel } from './network-report.js';
const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const date=value=>value?new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time unavailable';
const link=(label,url)=>{const el=node('a','tv-map-link',label);el.href=url;el.target='_blank';el.rel='noopener noreferrer';return el;};
export function renderNetworkWatch(content,report,page,{index=0,size=6,onTurn=()=>{}}={}){
  if(!report){content.append(node('p','tv-empty','Network watch is loading…'));return;}
  if(report.error){content.append(node('p','tv-empty','Network watch is unavailable. Please try again later.'));return;}
  if(!report.radarConfigured)content.append(node('p','tv-watch-warning','Live outage and routing alerts are not connected yet. Routing observations below are independent of outage coverage.'));
  if(page===1){
    const grid=node('div','tv-asn-grid');
    for(const network of report.networks){
      const card=node('article','tv-asn-card');card.append(node('h2','',asnLabel(report,network.asn)),node('strong','tv-asn-status',network.events.length?`${network.events.length} reported events in 7 days`:network.eventsAvailable?'No matching reports in 7 days':'Outage coverage unavailable'));
      card.append(node('p','',network.routingAvailable?(network.announced?'Routes observed by RIPE RIS':'No routes observed by RIPE RIS'):'Routing observations unavailable'),node('small','tv-muted',`Routing observation: ${date(network.routingAt)}`));
      card.append(node('p','',network.neighboursAvailable?`${network.upstream.length} upstream-side / ${network.downstream.length} downstream-side neighbours`:'Neighbour data unavailable'));
      if(network.limited||!network.eventsAvailable&&network.events.length)card.append(node('p','tv-watch-warning','Partial event coverage'));
      card.append(link('View ASN on Radar ↗',`https://radar.cloudflare.com/as${network.asn}`));grid.append(card);
    }content.append(grid,node('p','tv-muted','Route visibility is not an uptime test. Event counts include ended reports; Radar does not cover every ISP incident.'));
  }else{
    const section=page===2?report.downstream:report.northAmerica;
    if(page===2){
      const paths=node('div','tv-watch-paths');
      for(const n of report.networks)paths.append(node('p','',`${asnLabel(report,n.asn)} → ${n.neighboursAvailable?(n.downstream.length?n.downstream.slice(0,8).map(a=>asnLabel(report,a)).join(', ')+(n.downstream.length>8?` · +${n.downstream.length-8} more`:''):'No downstream-side neighbours observed'):'Neighbour data unavailable'}`));
      content.append(paths,node('p','tv-muted','Matches use adjacent, origin-side AS paths observed by RIPE RIS. They do not prove customer relationships or that your connection is affected.'));
    }
    const events=section.events||[];
    if(!section.available)content.append(node('p','tv-watch-warning','Coverage is incomplete. Missing reports do not mean there are no issues.'));
    if(section.limited)content.append(node('p',report.loadFailed?'tv-watch-warning':'tv-muted',report.loadFailed?'Some older reports could not be loaded. Retrying on the next refresh.':'Loading additional reports…'));
    const slice=reportPage(events,index,size);
    if(slice.pages>1){const paging=node('div','tv-paging tv-report-paging');paging.append(node('span','',`PAGE ${slice.page+1} OF ${slice.pages} · ${events.length} reports · changes every 15 seconds`));for(const [label,direction,glyph] of [['Previous report page',-1,'←'],['Next report page',1,'→']]){const button=node('button','',glyph);button.type='button';button.setAttribute('aria-label',label);button.onclick=()=>onTurn(direction);paging.append(button);}content.append(paging);}
    const list=node('div','tv-watch-events');
    for(const event of slice.events){
      const row=node('article','tv-watch-event');row.append(node('span','tv-watch-state',event.state),node('h2','',event.type),node('p','',event.description.replace(/AS(\d+)/g,(_,asn)=>asnLabel(report,asn))),node('small','tv-muted',`${date(event.start)} · ${event.asns.map(a=>asnLabel(report,a)).join(', ')||event.countries.join(', ')}${event.via?.length?' · downstream of '+[...new Set(event.via.map(v=>asnLabel(report,v.parent)))].join(', '):''}`));list.append(row);
    }
    if(!events.length)list.append(node('p','tv-empty',section.available?'No matching Radar reports in the last 7 days.':'No verified reports available.'));
    content.append(list,node('p','tv-muted','Reports include ended events. Routing anomalies are detections, not proof of an ISP outage.'));
  }
  const sources=node('div','tv-watch-sources');sources.append(link('Outage Center ↗','https://radar.cloudflare.com/outage-center'),link('Routing anomalies ↗','https://radar.cloudflare.com/routing/anomalies'),node('span','tv-muted',`Checked ${date(report.checkedAt)} · refreshes every 5 minutes`));content.append(sources);
}
