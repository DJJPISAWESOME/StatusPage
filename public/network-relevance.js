const NORTH_AMERICA=new Set('US CA MX GL BM PM BZ CR SV GT HN NI PA AI AG AW BS BB BQ VG KY CU CW DM DO GD GP HT JM MQ MS PR BL KN LC MF VC SX TT TC VI'.split(' '));
export const inNorthAmerica=event=>(event.countries||[]).some(c=>NORTH_AMERICA.has(String(c).toUpperCase()));
const DAY=86400000,RECOVERY=6*3600000;
const time=event=>Date.parse(event.lastSeen||event.start);
export function curateNetworkEvents(events,networks,{at=Date.now(),scope='upstream',directIds=new Set(),limit=6}={}){
  const watched=new Set(networks.map(n=>n.asn)),providers=new Set(networks.filter(n=>!n.neighboursStale).flatMap(n=>n.upstream||[]));
  const summary={collected:events.length,historical:0,unrelated:0,transitOnly:0,olderOrUnknown:0,roleUnknown:0,omittedByLimit:0,direct:0,relevant:0,shown:0};
  const direct=[],context=[];
  for(const event of events){
    const isDirect=directIds.has(event.id)||(event.asns||[]).some(asn=>watched.has(asn));
    const routing=event.type==='Route leak'||event.type==='Potential route hijack';
    const providerRole=routing?(providers.has(event.actorASN)||(event.type==='Potential route hijack'&&(event.victimASNs||[]).some(asn=>providers.has(asn)))):(event.asns||[]).some(asn=>providers.has(asn));
    const regional=scope==='northAmerica'&&!routing&&inNorthAmerica(event);
    const active=event.state==='Ongoing'||event.state==='No end reported';
    const recovery=isDirect&&event.state==='Ended'&&at-Date.parse(event.endAt)<=RECOVERY;
    if(!active&&!recovery){summary.historical++;continue;}
    if(!isDirect&&routing&&event.actorASN==null&&(event.asns||[]).some(asn=>providers.has(asn))){summary.roleUnknown++;continue;}
    if(!isDirect&&!providerRole&&!regional){if((event.asns||[]).some(asn=>providers.has(asn)))summary.transitOnly++;else summary.unrelated++;continue;}
    // Keep every reported direct ongoing incident even when its freshness is unknown.
    // Provider/context reports need an observation within 24h; this is a display policy, not proof of impact.
    if(!isDirect&&(!Number.isFinite(time(event))||at-time(event)>DAY)){summary.olderOrUnknown++;continue;}
    if(!isDirect&&event.type==='Potential route hijack'&&!(event.confidence>=8)){summary.olderOrUnknown++;continue;}
    const item={...event,relevance:isDirect?(recovery?'Recent direct recovery':'Direct monitored-ASN report'):providerRole?'Observed upstream named as incident actor/victim':'Regional outage context',localImpactConfirmed:false,observationFresh:Number.isFinite(time(event))&&at-time(event)<=DAY};
    if(isDirect){direct.push(item);summary.direct++;}else context.push(item);
  }
  const sort=(a,b)=>(Number(b.confidence)||0)-(Number(a.confidence)||0)||(Number(b.prefixCount)||0)-(Number(a.prefixCount)||0)||(time(b)||0)-(time(a)||0);
  direct.sort((a,b)=>Number(a.state==='Ended')-Number(b.state==='Ended')||sort(a,b));context.sort(sort);summary.relevant=direct.length+context.length;
  // A cap applies only to less-certain provider/regional context. Never hide a current direct incident behind it.
  const chosen=context.slice(0,Math.max(0,limit-direct.length));summary.omittedByLimit=context.length-chosen.length;
  const selected=[...direct,...chosen];summary.shown=selected.length;
  return {events:selected,selection:summary};
}
