import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fixtureStatus,fixtureWeather,fixtureNetworkWatch } from '../test/fixtures.mjs';
const root=resolve('public');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let data;
 if(url.pathname==='/api/status')data=fixtureStatus();
 else if(url.pathname==='/api/location')data={latitude:41.82,longitude:-71.41,label:'Providence, RI',source:'cloudflare',timezone:'America/New_York'};
 else if(url.pathname==='/api/weather')data=fixtureWeather();
 else if(url.pathname==='/api/history'){const now=Date.now(),days=Number(url.searchParams.get('days')||7),service=url.searchParams.get('service')||'openai',status=url.searchParams.get('status')||'degraded';data={rows:[{id:1,service_id:service,status,reason:'observed',start_ms:now-3600000,effectiveEndMs:now,ongoing:true}],totals:[{service_id:service,status,duration_ms:3600000}],since:now-days*86400000,until:now,nextCursor:null,retentionDays:30};}
 else if(url.pathname==='/api/marine')data={latitude:41.4,longitude:-71.3,hourly:{time:[Math.floor(Date.now()/1000)+3600],wave_height:[2.3],wave_period:[6]}};
 else if(url.pathname==='/api/network-watch')data=fixtureNetworkWatch();
 else if(url.pathname==='/api/network')data={colo:'BOS',country:'US',region:'Rhode Island',asn:64500,asOrganization:'Example network',protocol:'HTTP/2',tls:'TLSv1.3'};
 else if(url.pathname==='/api/power')data={available:true,active:true,count:42,countKind:'customers',region:'RI',provider:'Rhode Island Energy',scope:'RI regional total',mapUrl:'about:blank',checkedAt:new Date().toISOString()};
 else if(url.pathname==='/api/ping')data={time:Date.now()};
 else if(url.pathname==='/api/places')data={results:[{latitude:41.49,longitude:-71.31,label:'Newport, Rhode Island, US',source:'manual',timezone:'America/New_York'}]};
 if(data){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));return;}
 if(url.pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Static design preview — live updates require Wrangler"}');return;}
 try{const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+sep))throw Error();const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'text/plain'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('Synthetic design preview: http://127.0.0.1:4173 — never use preview data as live status.'));
