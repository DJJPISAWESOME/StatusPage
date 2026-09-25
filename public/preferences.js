export const PANELS = ['overview','services','forecast','connection-panels','integration-health','incident-history'];
export const PANEL_NAMES = ['Overview','Services','Forecast','Connection & activity','Integration health','Observation history'];
const strings = x => Array.isArray(x) ? [...new Set(x.filter(v=>typeof v==='string' && v.length<150))].slice(0,1000) : [];
export function normalizePreferences(value = {}) {
  const v=value && typeof value==='object'?value:{}, alerts=v.alerts || {};
  const order=strings(v.panelOrder).filter(x=>PANELS.includes(x));
  return {hiddenServices:strings(v.hiddenServices),components:Object.fromEntries(Object.entries(v.components || {}).filter(([key])=>/^[a-z0-9-]+$/.test(key)).map(([key,ids])=>[key,strings(ids)])),
    panelOrder:[...order,...PANELS.filter(x=>!order.includes(x))],hiddenPanels:strings(v.hiddenPanels).filter(x=>PANELS.includes(x)).slice(0,PANELS.length-1),density:v.density==='compact'?'compact':'comfortable',boardSeconds:[15,30,60].includes(v.boardSeconds)?v.boardSeconds:0,
    alerts:{enabled:alerts.enabled===true,severity:['outage','degraded','maintenance'].includes(alerts.severity)?alerts.severity:'degraded',recoveries:alerts.recoveries!==false,quiet:alerts.quiet===true,start:/^([01]\d|2[0-3]):[0-5]\d$/.test(alerts.start)?alerts.start:'22:00',end:/^([01]\d|2[0-3]):[0-5]\d$/.test(alerts.end)?alerts.end:'07:00'}};
}
export function readPreferences() {try{return normalizePreferences(JSON.parse(localStorage.getItem('signal:preferences')));}catch{return normalizePreferences();}}
export function savePreferences(value) {const p=normalizePreferences(value);try{localStorage.setItem('signal:preferences',JSON.stringify(p));}catch{}return p;}
