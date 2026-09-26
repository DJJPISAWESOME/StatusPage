import {requestAPI,youtubeLink} from './request-api.js';
const $=id=>document.getElementById(id),make=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
let searching=false,adding=false,latest=null,controlling=false,draggingVolume=false;
const clock=value=>{const seconds=Math.max(0,Math.floor(value||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
function progress(){
 const p=latest?.playback,duration=p?.duration||0;
 const extra=latest?.playerOnline&&!p?.paused?Math.min(5,Math.max(0,(Date.now()-(p?.at||Date.now()))/1000)):0;
 const position=Math.min(duration,(p?.position||0)+extra);
 for(const id of ['request-progress','mini-progress']){$(id).max=duration||1;$(id).value=position;}
 $('request-elapsed').textContent=clock(position);$('request-duration').textContent=duration?clock(duration):'--:--';
}
function artwork(item){
 const art=make('div','♫');art.className='track-art';art.setAttribute('aria-hidden','true');
 if(/^[A-Za-z0-9_-]{11}$/.test(item?.videoId||'')){const img=document.createElement('img');img.alt='';img.loading='lazy';img.src=`https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`;img.onerror=()=>img.remove();art.append(img);}
 return art;
}
let artworkId=null,queueKey='';
function render(data){
 latest=data;
 document.querySelector('.request-now').dataset.online=String(data.playerOnline);
 $('player-badge').textContent=data.playerOnline?(data.current?'CONNECTED':'RADIO'):'OFFLINE';
 $('request-artist').textContent=data.current?.artist||'';
 const videoId=data.current?.videoId||'';
 if(videoId!==artworkId){artworkId=videoId;$('request-art').querySelector('img')?.remove();if(/^[A-Za-z0-9_-]{11}$/.test(videoId)){const img=document.createElement('img');img.alt='';img.src=`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;img.onerror=()=>img.remove();$('request-art').append(img);}}
 $('mini-title').textContent=data.current?.title||(data.playerOnline?'Radio is on air':'Ready for your requests');
 $('mini-subtitle').textContent=data.playerOnline?(data.current?.artist||'Signal Local · live radio'):'Board offline · requests stay queued';
 const paused=data.transport?.paused??data.playback?.paused;
 $('mini-pause').disabled=controlling||!data.playerOnline||!data.current;$('mini-pause').textContent=paused?'▶':'Ⅱ';$('mini-pause').setAttribute('aria-label',paused?'Resume Board playback':'Pause Board playback');
 $('mobile-queue-count').textContent=String(data.items.length);
 if($('mini-art').dataset.video!==videoId){$('mini-art').dataset.video=videoId;$('mini-art').replaceChildren(...artwork(data.current).childNodes);}
 $('queue-nav-count').textContent=String(data.items.length);$('queue-empty').hidden=data.items.length>0;
 $('request-volume').disabled=controlling||!data.playerOnline;
 if(!draggingVolume){const volume=data.remoteVolume?.value??data.playback?.volume??0.4;$('request-volume').value=volume;$('request-volume-value').textContent=`${Math.round(volume*100)}%`;}
 for(const id of ['request-rewind','request-pause','request-skip'])$(id).disabled=controlling||!data.playerOnline||!data.current;
 $('request-pause').textContent=(data.transport?.paused??data.playback?.paused)?'Resume':'Pause';progress();
 $('request-current').textContent=data.current?.title||'The next song could be yours';
 $('request-online').textContent=data.playerOnline?(data.current?'Request mode is connected · songs play in queue order':'Queue is empty · Board is using radio fallback'):'Board playback is offline · requests will wait in the queue';
 $('request-count').textContent=`${data.items.length} / 50 songs`;
 const key=JSON.stringify(data.items);
 if(key!==queueKey){queueKey=key;$('request-queue').replaceChildren(...data.items.map(item=>{const li=make('li',''),copy=make('div','');copy.className='track-copy';copy.append(make('strong',item.title),make('span',item.artist));li.append(artwork(item),copy);return li;}));}
 $('request-query').placeholder=data.searchEnabled?'Search a song or paste a YouTube link':'Paste a YouTube or YouTube Music video link';
}
async function refresh(){try{render(await requestAPI());}catch(error){$('request-online').textContent=`Queue unavailable: ${error.message}`;$('mini-subtitle').textContent='Connection interrupted · retrying';}}
async function add(url){
 if(adding)return;adding=true;const buttons=[...document.querySelectorAll('.request-compose button')];buttons.forEach(b=>b.disabled=true);
 try{render(await requestAPI('',{url,requestId:crypto.randomUUID()}));$('request-feedback').textContent='Added to the queue. Thanks for the request!';$('request-query').value='';$('request-submit').textContent='Search';$('request-results').replaceChildren();}
 catch(error){$('request-feedback').textContent=error.message;}finally{adding=false;buttons.forEach(b=>b.disabled=false);}
}
$('request-form').addEventListener('submit',async event=>{
 event.preventDefault();if(searching||adding)return;const query=$('request-query').value.trim();$('request-youtube-search').href=`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
 if(/^https?:\/\//i.test(query)){await add(query);return;}
 searching=true;$('request-submit').disabled=true;$('request-feedback').textContent='Searching YouTube…';$('request-results').replaceChildren();
 try{const data=await requestAPI(`/search?q=${encodeURIComponent(query)}`);$('request-feedback').textContent=data.results.length?'Choose a video to add.':'No results found. Try another search.';
 for(const item of data.results){const row=make('article',''),copy=make('div',''),title=make('h3',item.title),by=make('p',item.artist),link=make('a','View on YouTube ↗'),button=make('button','Add to queue');link.href=youtubeLink(item.videoId);link.target='_blank';link.rel='noopener noreferrer';button.type='button';button.onclick=()=>add(youtubeLink(item.videoId));copy.className='track-copy';copy.append(title,by,link);row.append(artwork(item),copy,button);$('request-results').append(row);}}
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

const mobileLayout=matchMedia('(max-width:650px)'),sheet=$('mobile-player-sheet'),fullPlayer=document.querySelector('.request-now'),playerHome=fullPlayer.parentElement;
function mobileTab(tab){document.body.dataset.mobileTab=tab;document.querySelectorAll('[data-music-tab]').forEach(button=>{if(button.dataset.musicTab===tab)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});if(mobileLayout.matches)window.scrollTo({top:0,behavior:'instant'});}
function openPlayer(){if(!mobileLayout.matches)return;$('player-sheet-content').append(fullPlayer);sheet.showModal();document.body.classList.add('player-sheet-open');}
function closePlayer(){sheet.close();}
sheet.addEventListener('close',()=>{playerHome.append(fullPlayer);document.body.classList.remove('player-sheet-open');});
$('mini-open').onclick=openPlayer;$('mobile-player').onclick=openPlayer;$('player-close').onclick=closePlayer;
$('player-queue').onclick=()=>{closePlayer();mobileTab('queue');document.querySelector('[data-music-tab="queue"]').focus();};
$('mini-pause').onclick=()=>command((latest?.transport?.paused??latest?.playback?.paused)?'resume':'pause');
document.querySelectorAll('[data-music-tab]').forEach(button=>button.onclick=()=>mobileTab(button.dataset.musicTab));
document.querySelectorAll('a[href="#add-title"]').forEach(link=>link.addEventListener('click',()=>mobileTab('search')));
document.querySelectorAll('a[href="#queue-title"]').forEach(link=>link.addEventListener('click',()=>mobileTab('queue')));
mobileLayout.addEventListener('change',()=>{if(sheet.open)closePlayer();});
$('request-query').addEventListener('input',()=>{$('request-submit').textContent=/^https?:\/\//i.test($('request-query').value.trim())?'Add link':'Search';});
