const ranks={outage:0,degraded:1,maintenance:2,unknown:3,operational:4};
export function scopeService(service, ids = []) {
  if(!ids.length)return service;
  const selected=(service.components || []).filter(c=>ids.includes(c.id));
  if(service.error || selected.length!==ids.length)return {...service,status:'unknown',scope:'Selected component data unavailable'};
  const incidents=(service.incidents || []).filter(i=>!i.componentIds?.length || i.componentIds.some(id=>ids.includes(id)));
  const statuses=selected.map(c=>c.status);
  // Unmapped provider incidents may affect any selected component.
  if(incidents.some(i=>!i.componentIds?.length))statuses.push(service.status);
  return {...service,status:statuses.sort((a,b)=>ranks[a]-ranks[b])[0] || 'unknown',incidents,scope:selected.map(c=>c.name).join(', ')};
}
export function quietHours(alerts,date=new Date()) {
  if(!alerts.quiet)return false;
  const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3)), now=date.getHours()*60+date.getMinutes(), start=minutes(alerts.start),end=minutes(alerts.end);
  return start===end || (start<end ? now>=start&&now<end : now>=start||now<end);
}
export function shouldNotify(previous,next,alerts,date=new Date()) {
  if(!alerts.enabled || quietHours(alerts,date) || !previous || previous===next || previous==='unknown' || next==='unknown')return false;
  if(next==='operational')return alerts.recoveries && ranks[previous]<=ranks[alerts.severity];
  return ranks[next]<=ranks[alerts.severity];
}
export function disagreement(models,now=Date.now()/1000) {
  if(!models?.[0]?.available || !models?.[1]?.available)return null;
  const second=new Map(models[1].hourly.time.map((t,i)=>[t,models[1].hourly.temperature_2m[i]]));
  const differences=models[0].hourly.time.flatMap((t,i)=>{const a=models[0].hourly.temperature_2m[i],b=second.get(t);return t>=now&&t<=now+48*3600&&Number.isFinite(a)&&Number.isFinite(b)?[Math.abs(a-b)]:[];});
  return differences.length?Math.max(...differences):null;
}
export function historySummary(data,serviceCount) {
  const confirmed=(data.totals || []).filter(x=>x.status!=='unknown').reduce((sum,x)=>sum+x.duration_ms,0), operational=(data.totals || []).filter(x=>x.status==='operational').reduce((sum,x)=>sum+x.duration_ms,0);
  const window=Math.max(0,data.until-data.since)*serviceCount;
  return {coverage:window?confirmed/window:null,operationalShare:confirmed?operational/confirmed:null};
}
