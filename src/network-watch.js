import { upstream } from './security.js';
import { cachedJSON } from './weather.js';
export const WATCHED_ASNS=[25710,32145,402280];
// Northern America, Central America, and Caribbean ISO country/territory codes.
const NORTH_AMERICA=new Set('US CA MX GL BM PM BZ CR SV GT HN NI PA AI AG AW BS BB BQ VG KY CU CW DM DO GD GP HT JM MQ MS PR BL KN LC MF VC SX TT TC VI'.split(' '));
const unique=list=>[...new Set(list)];
const asns=list=>unique((list||[]).map(Number).filter(x=>Number.isSafeInteger(x)&&x>0));
export const inNorthAmerica=event=>event.countries.some(c=>NORTH_AMERICA.has(c));
const iso=value=>{if(!value)return null;const text=String(value);const date=new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(text)?text:`${text}Z`);return Number.isFinite(date.getTime())?date.toISOString():null;};
export function normalizeRadar(kind,event){
  if(kind==='outages')return {id:`outage-${event.id}`,type:event.eventType==='TRAFFIC_ANOMALY'?'Traffic anomaly':'Internet outage',description:String(event.description||'Reported Internet disruption').slice(0,600),asns:asns(event.asns),countries:event.locations||[],start:iso(event.startDate),state:event.endDate?'Ended':'No end reported',url:'https://radar.cloudflare.com/outage-center'};
  const leak=kind==='leaks';
  return {id:`${kind}-${event.id}`,type:leak?'Route leak':'Potential route hijack',description:leak?`AS${event.leak_asn} · ${event.prefix_count ?? 'Unknown'} prefixes`:`AS${event.hijacker_asn} · confidence ${event.confidence_score ?? 'unknown'}`,asns:asns(leak?[event.leak_asn,...(event.leak_seg||[])]:[event.hijacker_asn,...(event.victim_asns||[])]),countries:leak?event.countries||[]:[event.hijacker_country,...(event.victim_countries||[])].filter(Boolean),start:iso(leak?event.min_ts:event.min_hijack_ts),state:leak?(event.finished===true?'Ended':event.finished===false?'Ongoing':'Unconfirmed'):(event.is_stale?'Stale detection':event.on_going_count>0?'Ongoing':'No ongoing reports'),url:'https://radar.cloudflare.com/routing/anomalies'};
}
export function downstreamMatches(events,networks){
  const links=networks.flatMap(n=>(n.downstream||[]).map(asn=>({parent:n.asn,asn})));
  return events.map(event=>({...event,via:links.filter(link=>event.asns.includes(link.asn))})).filter(event=>event.via.length);
}
async function ripe(asn,fetcher,cache){
  async function read(endpoint){return cachedJSON(`network-ripe-v1/${endpoint}/${asn}`,900,async()=>{const data=JSON.parse(await upstream(`https://stat.ripe.net/data/${endpoint}/data.json?resource=AS${asn}`,{fetcher,timeout:8000}));if(data.status!=='ok'||!data.data)throw Error('Invalid RIPE response');return data.data;},cache);}
  const [overview,neighbours]=await Promise.allSettled([read('as-overview'),read('asn-neighbours')]);
  const o=overview.status==='fulfilled'?overview.value:null,n=neighbours.status==='fulfilled'?neighbours.value:null;
  const rows=Array.isArray(n?.neighbours)?n.neighbours:null;
  return {asn,name:o?.holder||`AS${asn}`,routingAvailable:typeof o?.announced==='boolean',announced:typeof o?.announced==='boolean'?o.announced:null,routingAt:iso(o?.query_endtime),neighboursAvailable:!!rows,downstream:rows?asns(rows.filter(r=>(r.type||r.position)==='right').map(r=>r.asn)):[],upstream:rows?asns(rows.filter(r=>(r.type||r.position)==='left').map(r=>r.asn)):[],neighboursAt:iso(n?.query_time||n?.query_endtime)};
}
async function radarFeed(kind,asn,token,fetcher,cache){
  const unavailable={available:false,events:[],limited:false};
  if(!token)return {...unavailable,reason:'Radar feed not configured'};
  try{return await cachedJSON(`network-radar-v1/${kind}/${asn||'global'}`,300,async()=>{
    const path=kind==='outages'?'annotations/outages':`bgp/${kind}/events`, events=[];
    let limited=false;
    for(let page=0;page<2;page++){
      const params=new URLSearchParams({dateRange:'7d',format:'JSON'});
      if(kind==='outages'){params.set('limit','100');params.set('offset',String(page*100));if(asn)params.set('asn',String(asn));}
      else{params.set('per_page','100');params.set('page',String(page+1));params.set('sortBy','TIME');params.set('sortOrder','DESC');if(asn)params.set('involvedAsn',String(asn));if(kind==='hijacks')params.set('minConfidence','8');}
      const data=JSON.parse(await upstream(`https://api.cloudflare.com/client/v4/radar/${path}?${params}`,{fetcher,timeout:8000,headers:{Authorization:`Bearer ${token}`}}));
      const rows=kind==='outages'?data.result?.annotations:data.result?.events;
      if(data.success!==true||!Array.isArray(rows))throw Error('Invalid Radar response');
      events.push(...rows.map(event=>normalizeRadar(kind,event)));
      limited=rows.length===100;
      if(!limited)break;
    }
    return {available:true,events,limited};
  },cache);}catch{return {...unavailable,reason:'Radar feed unavailable'};}
}
export async function networkWatch(env={},fetcher=fetch,cache=globalThis.caches?.default){
  const token=env.RADAR_API_TOKEN, kinds=['outages','leaks','hijacks'];
  const [networks,globalFeeds,direct]=await Promise.all([
    Promise.all(WATCHED_ASNS.map(asn=>ripe(asn,fetcher,cache))),
    Promise.all(kinds.map(kind=>radarFeed(kind,null,token,fetcher,cache))),
    Promise.all(WATCHED_ASNS.map(asn=>Promise.all(kinds.map(kind=>radarFeed(kind,asn,token,fetcher,cache)))))
  ]);
  const dedupe=events=>[...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>(Date.parse(b.start)||0)-(Date.parse(a.start)||0));
  networks.forEach((network,i)=>{network.events=dedupe(direct[i].flatMap(f=>f.events));network.eventsAvailable=direct[i].every(f=>f.available);network.limited=direct[i].some(f=>f.limited);});
  const all=dedupe(globalFeeds.flatMap(f=>f.events)),available=globalFeeds.every(f=>f.available),limited=globalFeeds.some(f=>f.limited);
  return {checkedAt:new Date().toISOString(),radarConfigured:!!token,networks,feeds:kinds.map((kind,i)=>({kind,available:globalFeeds[i].available,limited:globalFeeds[i].limited,checkedAt:globalFeeds[i].fetchedAt||null})),northAmerica:{available,limited,events:all.filter(inNorthAmerica)},downstream:{available:available&&networks.every(n=>n.neighboursAvailable),limited,events:downstreamMatches(all,networks)},window:'7 days',source:'Cloudflare Radar + RIPE RIS'};
}
