import {SERVICES} from '../src/catalog.js';
import {collectService} from '../src/providers.js';
import {weather,marine} from '../src/weather.js';
import {STATIONS} from '../public/stations.js';
import {mkdir,writeFile} from 'node:fs/promises';
const report={checkedAt:new Date().toISOString(),services:[],weather:{},radio:[]};let index=0;
await Promise.all(Array.from({length:4},async()=>{while(index<SERVICES.length){const service=SERVICES[index++],result=await collectService(service);report.services.push({id:service.id,available:!result.error,status:result.status,detail:result.detail,httpStatus:result.httpStatus});}}));
const point={latitude:41.82,longitude:-71.41};const w=await weather(point,{WEATHER_CONTACT:process.env.WEATHER_CONTACT || 'https://example.com/contact'},fetch,null);
report.weather={currentAvailable:!w.conditions.error,models:w.models.map(m=>({id:m.id,available:m.available,metadataAvailable:!!m.metadata})),alertsAvailable:w.alerts.available};
try{await marine(point,{},fetch,null);report.weather.marineAvailable=true;}catch(error){report.weather.marineAvailable=false;report.weather.marineError=error.message;}
for(const station of STATIONS){try{const response=await fetch(station.stream,{signal:AbortSignal.timeout(10000),headers:{Range:'bytes=0-1023'}});const type=response.headers.get('content-type')||'';await response.body?.cancel();report.radio.push({id:station.id,available:response.ok&&/audio|octet-stream/.test(type),httpStatus:response.status,contentType:type});}catch(error){report.radio.push({id:station.id,available:false,error:error.name});}}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/live-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(report.services.some(s=>!s.available)||report.radio.some(s=>!s.available)||report.weather.models.some(m=>!m.available)||!report.weather.currentAvailable||!report.weather.alertsAvailable||!report.weather.marineAvailable)process.exitCode=1;
