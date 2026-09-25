import { upstream, HttpError } from './security.js';
import { cachedJSON } from './weather.js';
export const WATCHED_ASNS=[25710,32145,402280];
import { buildNetworkReport } from '../public/network-report.js';
export { inNorthAmerica, downstreamMatches } from '../public/network-report.js';
const asns=list=>[...new Set((list||[]).map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))];
const iso=value=>{if(!value)return null;const text=String(value);const date=new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(text)?text:`${text}Z`);return Number.isFinite(date.getTime())?date.toISOString():null;};
export function normalizeRadar(kind,event,info=[]){
  const names=Object.fromEntries([...info,...(event.asnsDetails||[])].filter(n=>n.asn&&(n.org_name||n.name)).map(n=>[n.asn,n.org_name||n.name]));
  if(kind==='outages')return {names,id:`outage-${event.id}`,type:event.eventType==='TRAFFIC_ANOMALY'?'Traffic anomaly':'Internet outage',description:String(event.description||'Reported Internet disruption').slice(0,600),asns:asns(event.asns),countries:event.locations||[],start:iso(event.startDate),state:event.endDate?'Ended':'No end reported',url:'https://radar.cloudflare.com/outage-center'};
  const leak=kind==='leaks';
  return {names,id:`${kind}-${event.id}`,type:leak?'Route leak':'Potential route hijack',description:leak?`AS${event.leak_asn} · ${event.prefix_count ?? 'Unknown'} prefixes`:`AS${event.hijacker_asn} · confidence ${event.confidence_score ?? 'unknown'}`,asns:asns(leak?[event.leak_asn,...(event.leak_seg||[])]:[event.hijacker_asn,...(event.victim_asns||[])]),countries:leak?event.countries||[]:[event.hijacker_country,...(event.victim_countries||[])].filter(Boolean),start:iso(leak?event.min_ts:event.min_hijack_ts),state:leak?(event.finished===true?'Ended':event.finished===false?'Ongoing':'Unconfirmed'):(event.is_stale?'Stale detection':event.on_going_count>0?'Ongoing':'No ongoing reports'),url:'https://radar.cloudflare.com/routing/anomalies'};
}
async function ripe(asn,fetcher,cache){
  async function read(endpoint){return cachedJSON(`network-ripe-v1/${endpoint}/${asn}`,900,async()=>{const data=JSON.parse(await upstream(`https://stat.ripe.net/data/${endpoint}/data.json?resource=AS${asn}`,{fetcher,timeout:8000}));if(data.status!=='ok'||!data.data)throw Error('Invalid RIPE response');return data.data;},cache);}
  const [overview,neighbours]=await Promise.allSettled([read('as-overview'),read('asn-neighbours')]);
  const o=overview.status==='fulfilled'?overview.value:null,n=neighbours.status==='fulfilled'?neighbours.value:null;
  const rows=Array.isArray(n?.neighbours)?n.neighbours:null;
  return {asn,name:o?.holder||`AS${asn}`,routingAvailable:typeof o?.announced==='boolean',announced:typeof o?.announced==='boolean'?o.announced:null,routingAt:iso(o?.query_endtime),neighboursAvailable:!!rows,downstream:rows?asns(rows.filter(r=>(r.type||r.position)==='right').map(r=>r.asn)):[],upstream:rows?asns(rows.filter(r=>(r.type||r.position)==='left').map(r=>r.asn)):[],neighboursAt:iso(n?.query_time||n?.query_endtime)};
}
async function radarFeed(kind,asn,token,fetcher,cache,startPage=1,at=Math.floor(Date.now()/300000)*300000){
  const unavailable={kind,asn,available:false,events:[],limited:false,nextPage:null};
  if(!token)return {...unavailable,reason:'Radar feed not configured'};
  try{return await cachedJSON(`network-radar-v2/${kind}/${asn||'global'}/${at}/${startPage}`,300,async()=>{
    const path=kind==='outages'?'annotations/outages':`bgp/${kind}/events`, events=[];
    let limited=false;
    let nextPage=null;
    for(let page=startPage-1;page<startPage+1;page++){
      const params=new URLSearchParams({dateStart:new Date(at-7*86400000).toISOString(),dateEnd:new Date(at).toISOString(),format:'JSON'});
      if(kind==='outages'){params.set('limit','100');params.set('offset',String(page*100));if(asn)params.set('asn',String(asn));}
      else{params.set('per_page','100');params.set('page',String(page+1));params.set('sortBy','TIME');params.set('sortOrder','DESC');if(asn)params.set('involvedAsn',String(asn));if(kind==='hijacks')params.set('minConfidence','8');}
      const data=JSON.parse(await upstream(`https://api.cloudflare.com/client/v4/radar/${path}?${params}`,{fetcher,timeout:8000,headers:{Authorization:`Bearer ${token}`}}));
      const rows=kind==='outages'?data.result?.annotations:data.result?.events;
      if(data.success!==true||!Array.isArray(rows))throw Error('Invalid Radar response');
      events.push(...rows.map(event=>normalizeRadar(kind,event,data.result?.asn_info||[])));
      limited=rows.length===100 && !(Number.isFinite(data.result_info?.total_count)&&(page+1)*100>=data.result_info.total_count);
      nextPage=limited?page+2:null;
      if(!limited)break;
    }
    return {kind,asn,available:true,events,limited,nextPage};
  },cache);}catch(error){
    // Keep authentication material and upstream bodies out of public diagnostics.
    const http=error.message.match(/^Upstream HTTP (\d{3})$/)?.[1];
    const detail=http?`http_${http}`:error.status===413?'response_too_large':error.name==='AbortError'?'timeout':error.message==='Invalid Radar response'?'invalid_response':'request_failed';
    return {...unavailable,reason:'Radar feed unavailable',detail};
  }
}
export async function networkWatch(env={},fetcher=fetch,cache=globalThis.caches?.default){
  const token=env.RADAR_API_TOKEN, kinds=['outages','leaks','hijacks'],at=Math.floor(Date.now()/300000)*300000;
  const [networks,globalFeeds,direct]=await Promise.all([
    Promise.all(WATCHED_ASNS.map(asn=>ripe(asn,fetcher,cache))),
    Promise.all(kinds.map(kind=>radarFeed(kind,0,token,fetcher,cache,1,at))),
    Promise.all(WATCHED_ASNS.map(asn=>Promise.all(kinds.map(kind=>radarFeed(kind,asn,token,fetcher,cache,1,at)))))
  ]);
  return buildNetworkReport(networks,[...globalFeeds,...direct.flat()],{checkedAt:new Date().toISOString(),radarConfigured:!!token,at,window:'7 days',source:'Cloudflare Radar + RIPE RIS'});
}
export async function networkWatchPage(params,env={},fetcher=fetch,cache=globalThis.caches?.default){
  const kind=params.get('kind'),asn=Number(params.get('asn')),page=Number(params.get('page')),at=Number(params.get('at'));
  if(!['outages','leaks','hijacks'].includes(kind)||!params.has('asn')||![0,...WATCHED_ASNS].includes(asn)||!Number.isSafeInteger(page)||page<3||page>100000||!Number.isSafeInteger(at)||at< Date.now()-86400000||at>Date.now()+300000)throw new HttpError(400,'Invalid network report page');
  return radarFeed(kind,asn,env.RADAR_API_TOKEN,fetcher,cache,page,at);
}

export async function networkNames(raw,fetcher=fetch,cache=globalThis.caches?.default){
  if(!raw||!/^\d+(,\d+)*$/.test(raw))throw new HttpError(400,'Invalid ASN list');
  const ids=[...new Set(raw.split(',').map(Number))];
  if(ids.length>20||ids.some(id=>!Number.isSafeInteger(id)||id<1||id>4294967295))throw new HttpError(400,'Invalid ASN list');
  const entries=await Promise.all(ids.map(async asn=>{try{const data=await cachedJSON(`asn-name-v1/${asn}`,86400,async()=>{const response=JSON.parse(await upstream(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`,{fetcher,timeout:8000}));if(response.status!=='ok'||typeof response.data?.holder!=='string')throw Error('Name unavailable');return {name:response.data.holder};},cache);return [asn,data.name];}catch{return [asn,null];}}));
  return {names:Object.fromEntries(entries)};
}
