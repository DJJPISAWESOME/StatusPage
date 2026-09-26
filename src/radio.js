import { STATIONS } from '../public/stations.js';
import { HttpError, json } from './security.js';
export function parseRadioTitle(metadata,station){
 const raw=metadata.match(/StreamTitle='([\s\S]*?)';/i)?.[1];
 if(!raw)return null;
 const title=raw.replace(/\s+\w[\w-]*="[^"]*".*$/s,'').replace(/&amp;/gi,'&').replace(/&#0*39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim().slice(0,200);
 if(!title)return null;
 const parts=title.split(/\s+[-–—]\s+/);let artist=null,song=null;
 if(parts.length===2){[artist,song]=station.id==='x1023'?[parts[1],parts[0]]:parts;}
 return {title:artist&&song?`${artist} — ${song}`:title,artist,song};
}
// A bounded ICY read, only while a listener is playing. Audio itself never passes through this Worker.
export async function radioMetadata(id, fetcher = fetch, cache = globalThis.caches?.default) {
  const station = STATIONS.find(x => x.id === id); if (!station) throw new HttpError(404, 'Unknown station');
  const key = new Request(`https://signal-cache.invalid/radio-v2/${id}`);
  const hit = cache && await cache.match(key); if (hit) return hit.json();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 6500); let reader;
  let result = { station: id, title: null, available: false };
  try {
    let target = station.metadataStream||station.stream; let response;
    for (let hop = 0; hop < 4; hop++) {
      response = await fetcher(target, { headers: { 'Icy-MetaData': '1', Range: 'bytes=0-131071' }, signal: controller.signal, redirect: 'manual' });
      if (![301,302,303,307,308].includes(response.status)) break;
      const next = new URL(response.headers.get('Location'), target); await response.body?.cancel();
      if (next.protocol !== 'https:' || !['aiir.com','streamtheworld.com','securenetsystems.net','revma.ihrhls.com','nebcoradio.com','stream.x1023.fm'].some(host => next.hostname === host || next.hostname.endsWith('.'+host))) throw Error('Unexpected stream redirect');
      target = next.href;
    }
    if (!response.ok || !response.body) throw Error('Stream unavailable');
    const interval = Number(response.headers.get('icy-metaint'));
    if (!Number.isInteger(interval) || interval <= 0 || interval > 120000) { await response.body.cancel(); throw Error('No metadata'); }
    reader = response.body.getReader(); const bytes = new Uint8Array(131072); let length=0,offset=interval;
    while(length<bytes.length){
      const {done,value}=await reader.read();if(done)break;
      const keep=Math.min(value.length,bytes.length-length);bytes.set(value.subarray(0,keep),length);length+=keep;
      while(offset<length){
        const end=offset+1+bytes[offset]*16;if(end>length)break;
        const track=parseRadioTitle(new TextDecoder().decode(bytes.subarray(offset+1,end)),station);
        if(track){result={station:id,...track,available:true};break;}
        offset=end+interval;
      }
      if(result.available)break;
    }
  } catch { /* Metadata is optional, playback remains independent. */ }
  finally { if(reader)await reader.cancel().catch(()=>{}); clearTimeout(timer); }
  if (cache) await cache.put(key,json(result,200,{'Cache-Control':'public, max-age=30'}));
  return result;
}
