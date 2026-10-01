import { curateNetworkEvents } from './network-relevance.js';
export { inNorthAmerica } from './network-relevance.js';
export function upstreamMatches(events,networks){
  const links=networks.filter(n=>!n.neighboursStale).flatMap(n=>(n.upstream||[]).map(asn=>({parent:n.asn,asn})));
  return events.map(event=>({...event,via:links.filter(link=>event.asns.includes(link.asn))})).filter(event=>event.via.length);
}

export function buildNetworkReport(networks,feeds,meta){
  const dedupe=events=>[...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>(Date.parse(b.start)||0)-(Date.parse(a.start)||0));
  const globalFeeds=feeds.filter(f=>!f.asn);
  const covered=scope=>['outages','leaks','hijacks'].every(kind=>scope.some(feed=>feed.kind===kind&&feed.available));
  const available=covered(globalFeeds),limited=globalFeeds.some(f=>f.nextPage),loadingMore=feeds.some(f=>f.nextPage&&!f.loadFailed);
  const watched=networks.map(network=>{const direct=feeds.filter(f=>f.asn===network.asn);return {...network,events:dedupe(direct.flatMap(f=>f.events)),eventsAvailable:covered(direct),limited:direct.some(f=>f.nextPage)};});
  const names={...meta.names};for(const feed of feeds)for(const event of feed.events)Object.assign(names,event.names);for(const network of networks)if(network.name&&network.name!==`AS${network.asn}`)names[network.asn]=network.name;
  const directIds=new Set(feeds.filter(f=>f.asn).flatMap(f=>f.events.map(e=>e.id)));
  const collected=dedupe(feeds.flatMap(f=>f.events));
  const at=Number.isFinite(meta.at)?meta.at:Date.parse(meta.checkedAt)||Date.now();
  const regional=curateNetworkEvents(collected,networks,{at,scope:'northAmerica',directIds,limit:6});
  const candidates=upstreamMatches(collected,networks);
  const local=curateNetworkEvents(collected,networks,{at,scope:'upstream',directIds,limit:4});
  local.events=local.events.map(event=>({...event,via:candidates.find(e=>e.id===event.id)?.via||[]}));
  const topologyIncomplete=networks.some(n=>!n.neighboursAvailable||n.neighboursStale||!n.upstream?.length);
  return {...meta,names,networks:watched,feeds,loadingMore,loadFailed:feeds.some(f=>f.loadFailed),northAmerica:{available:available&&!regional.selection.roleUnknown,limited,...regional},upstream:{available:available&&!topologyIncomplete&&!local.selection.roleUnknown,topologyIncomplete,limited,...local}};
}
export function appendNetworkFeed(report,patch){
  const feeds=report.feeds.map(feed=>feed.kind===patch.kind&&feed.asn===patch.asn?{...feed,...patch,events:[...new Map([...feed.events,...(patch.events||[])].map(e=>[e.id,e])).values()],loadFailed:!patch.available}:feed);
  return buildNetworkReport(report.networks,feeds,report);
}
export function reportPage(events,index,size=6){
  const pages=Math.max(1,Math.ceil(events.length/size)),page=((index%pages)+pages)%pages;
  return {page,pages,events:events.slice(page*size,(page+1)*size)};
}

export function asnLabel(report,asn){
  const raw=report?.names?.[asn]||report?.networks?.find(n=>n.asn===Number(asn))?.name;
  const name=raw?.replace(/^.*? - /,'');
  return `AS${asn} · ${name&&name!==`AS${asn}`?name:'Name unavailable'}`;
}
export function visibleNetworkASNs(report,page,index=0,size=6){
  if(!report?.networks)return [];
  const ids=report.networks.map(n=>n.asn);
  if(page===2)for(const n of report.networks)ids.push(...(n.upstream||[]).slice(0,8));
  const section=page===2?report.upstream:report.northAmerica;
  if(page>=2)for(const event of reportPage(section?.events||[],index,size).events)ids.push(...event.asns);
  return [...new Set(ids)];
}

// Empty data and unavailable coverage are distinct, including during refresh recovery.
export function networkReportState(report,section){
  if(!report)return 'loading';
  if(report.error)return 'error';
  if(report.refreshFailed||(report.checkedAt&&Date.now()-Date.parse(report.checkedAt)>600000))return 'stale';
  if(!report.radarConfigured)return 'disconnected';
  if(!section?.available)return 'incomplete';
  if(section.limited)return 'partial';
  return section.events?.length?'ready':'empty';
}
