// Northern America, Central America, and Caribbean ISO country/territory codes.
const NORTH_AMERICA=new Set('US CA MX GL BM PM BZ CR SV GT HN NI PA AI AG AW BS BB BQ VG KY CU CW DM DO GD GP HT JM MQ MS PR BL KN LC MF VC SX TT TC VI'.split(' '));
export const inNorthAmerica=event=>event.countries.some(c=>NORTH_AMERICA.has(c));
export function downstreamMatches(events,networks){
  const links=networks.flatMap(n=>(n.downstream||[]).map(asn=>({parent:n.asn,asn})));
  return events.map(event=>({...event,via:links.filter(link=>event.asns.includes(link.asn))})).filter(event=>event.via.length);
}

export function buildNetworkReport(networks,feeds,meta){
  const dedupe=events=>[...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>(Date.parse(b.start)||0)-(Date.parse(a.start)||0));
  const globalFeeds=feeds.filter(f=>!f.asn),all=dedupe(globalFeeds.flatMap(f=>f.events));
  const available=globalFeeds.every(f=>f.available),limited=globalFeeds.some(f=>f.nextPage),loadingMore=feeds.some(f=>f.nextPage&&!f.loadFailed);
  const watched=networks.map(network=>{const direct=feeds.filter(f=>f.asn===network.asn);return {...network,events:dedupe(direct.flatMap(f=>f.events)),eventsAvailable:direct.every(f=>f.available),limited:direct.some(f=>f.nextPage)};});
  const names={...meta.names};for(const feed of feeds)for(const event of feed.events)Object.assign(names,event.names);for(const network of networks)if(network.name&&network.name!==`AS${network.asn}`)names[network.asn]=network.name;
  return {...meta,names,networks:watched,feeds,loadingMore,loadFailed:feeds.some(f=>f.loadFailed),northAmerica:{available,limited,events:all.filter(inNorthAmerica)},downstream:{available:available&&networks.every(n=>n.neighboursAvailable),limited,events:downstreamMatches(all,networks)}};
}
export function appendNetworkFeed(report,patch){
  const feeds=report.feeds.map(feed=>feed.kind===patch.kind&&feed.asn===patch.asn?{...feed,...patch,events:[...new Map([...feed.events,...patch.events].map(e=>[e.id,e])).values()],loadFailed:!patch.available}:feed);
  return buildNetworkReport(report.networks,feeds,report);
}
export function reportPage(events,index,size=6){
  const pages=Math.max(1,Math.ceil(events.length/size)),page=((index%pages)+pages)%pages;
  return {page,pages,events:events.slice(page*size,(page+1)*size)};
}

export function asnLabel(report,asn){
  const raw=report?.names?.[asn]||report?.networks?.find(n=>n.asn===Number(asn))?.name;
  const name=raw?.replace(/^[^-]+ - /,'');
  return `AS${asn} · ${name&&name!==`AS${asn}`?name:'Name unavailable'}`;
}
export function visibleNetworkASNs(report,page,index=0,size=6){
  if(!report?.networks)return [];
  const ids=report.networks.map(n=>n.asn);
  if(page===2)for(const n of report.networks)ids.push(...n.downstream.slice(0,8));
  const section=page===2?report.downstream:report.northAmerica;
  if(page>=2)for(const event of reportPage(section?.events||[],index,size).events)ids.push(...event.asns);
  return [...new Set(ids)];
}
