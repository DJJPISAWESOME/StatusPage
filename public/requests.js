import {requestAPI,youtubeLink} from './request-api.js';
const $=id=>document.getElementById(id),make=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
let searching=false,adding=false,latest=null,controlling=false,draggingVolume=false;
const clock=value=>{const seconds=Math.max(0,Math.floor(value||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
function progress(){
 const p=latest?.playback,duration=p?.duration||0;
 const extra=latest?.playerOnline&&!p?.paused?Math.min(5,Math.max(0,(Date.now()-(p?.at||Date.now()))/1000)):0;
 const position=Math.min(duration,(p?.position||0)+extra);
 $('request-progress').max=duration||1;$('request-progress').value=position;
 $('request-elapsed').textContent=clock(position);$('request-duration').textContent=duration?clock(duration):'--:--';
}
function render(data){
 latest=data;
 $('request-volume').disabled=controlling||!data.playerOnline;
 if(!draggingVolume){const volume=data.remoteVolume?.value??data.playback?.volume??0.4;$('request-volume').value=volume;$('request-volume-value').textContent=`${Math.round(volume*100)}%`;}
 for(const id of ['request-rewind','request-pause','request-skip'])$(id).disabled=controlling||!data.playerOnline||!data.current;
 $('request-pause').textContent=(data.transport?.paused??data.playback?.paused)?'Resume':'Pause';progress();
 $('request-current').textContent=data.current?.title||'The next song could be yours';
 $('request-online').textContent=data.playerOnline?'Request mode is connected · songs play in queue order':'Board playback is offline · requests will wait in the queue';
 $('request-count').textContent=`${data.items.length} / 50 songs`;
 $('request-queue').replaceChildren(...data.items.map(item=>{const li=make('li',item.title);li.append(make('span',item.artist));return li;}));
 if(!data.items.length)$('request-queue').append(make('p','No songs waiting. Add the first request.'));
 $('request-query').placeholder=data.searchEnabled?'Search a song or paste a YouTube link':'Paste a YouTube or YouTube Music video link';
}
async function refresh(){try{render(await requestAPI());}catch(error){$('request-online').textContent=`Queue unavailable: ${error.message}`;}}
async function add(url){
 if(adding)return;adding=true;const buttons=[...document.querySelectorAll('.request-compose button')];buttons.forEach(b=>b.disabled=true);
 try{render(await requestAPI('',{url,requestId:crypto.randomUUID()}));$('request-feedback').textContent='Added to the queue. Thanks for the request!';$('request-query').value='';$('request-results').replaceChildren();}
 catch(error){$('request-feedback').textContent=error.message;}finally{adding=false;buttons.forEach(b=>b.disabled=false);}
}
$('request-form').addEventListener('submit',async event=>{
 event.preventDefault();if(searching||adding)return;const query=$('request-query').value.trim();$('request-youtube-search').href=`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
 if(/^https?:\/\//i.test(query)){await add(query);return;}
 searching=true;$('request-submit').disabled=true;$('request-feedback').textContent='Searching YouTube…';$('request-results').replaceChildren();
 try{const data=await requestAPI(`/search?q=${encodeURIComponent(query)}`);$('request-feedback').textContent=data.results.length?'Choose a video to add.':'No results found. Try another search.';
 for(const item of data.results){const row=make('article',''),copy=make('div',''),title=make('h3',item.title),by=make('p',item.artist),link=make('a','View on YouTube ↗'),button=make('button','Add to queue');link.href=youtubeLink(item.videoId);link.target='_blank';link.rel='noopener noreferrer';button.type='button';button.onclick=()=>add(youtubeLink(item.videoId));copy.append(title,by,link);row.append(copy,button);$('request-results').append(row);}}
 catch(error){$('request-feedback').textContent=error.message;}finally{searching=false;$('request-submit').disabled=false;}
});
async function command(action,volume){
 if(controlling||!latest?.playerOnline||(!latest.current&&action!=='volume'))return;controlling=true;render(latest);
 try{const data=await requestAPI('/remote',{command:action,id:latest.current?.id||null,volume});render(data);$('request-control-status').textContent='Sent to Board · updates within 5 seconds.';}
 catch(error){$('request-control-status').textContent=error.message;}
 finally{controlling=false;if(latest)render(latest);}
}
$('request-volume').oninput=()=>{draggingVolume=true;$('request-volume-value').textContent=`${Math.round(Number($('request-volume').value)*100)}%`;};
$('request-volume').onchange=()=>{const volume=Number($('request-volume').value);draggingVolume=false;void command('volume',volume);};
$('request-rewind').onclick=()=>command('rewind');$('request-skip').onclick=()=>command('skip');$('request-pause').onclick=()=>command((latest?.transport?.paused??latest?.playback?.paused)?'resume':'pause');
setInterval(progress,1000);
void refresh();setInterval(()=>{if(!document.hidden)void refresh();},5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
