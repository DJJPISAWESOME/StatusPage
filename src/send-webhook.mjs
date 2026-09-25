import { createHmac,randomUUID } from 'node:crypto';
const [origin,service]=process.argv.slice(2);const secret=process.env.SIGNAL_WEBHOOK_SECRET;
if(!origin||!service||!secret||secret.length<32){console.error('Usage: SIGNAL_WEBHOOK_SECRET=<per-service secret> npm run webhook -- https://your-worker.example cloudflare');process.exit(1);}
if(!/^[a-z0-9-]+$/.test(service))throw Error('Invalid service ID');
const url=new URL(`/api/webhooks/signed/${service}`,origin);if(url.protocol!=='https:'&&url.hostname!=='localhost'&&url.hostname!=='127.0.0.1')throw Error('HTTPS is required');
const timestamp=String(Math.floor(Date.now()/1000));const id=randomUUID();const body=JSON.stringify({event:'status.changed'});
const signature=createHmac('sha256',secret).update(`${timestamp}.${id}.${url.pathname}.${body}`).digest('hex');
const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Signal-Timestamp':timestamp,'X-Signal-Id':id,'X-Signal-Signature':`sha256=${signature}`},body});
console.log(response.status,await response.text());if(!response.ok)process.exitCode=1;
