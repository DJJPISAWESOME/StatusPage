// Development-only fixtures. Never included in the static production build.
export function boardQA(url,source){
  const params=new URL(url,'http://localhost').searchParams;
  if(!params.has('frame')){
    const width=Number(params.get('width'))||1920,height=Number(params.get('height'))||1080;
    const scale=Math.min(1,1200/width,780/height);
    return `<meta charset="utf-8"><body style="margin:0;background:#303846;color:white;font:16px sans-serif"><p>Board QA · ${width} × ${height} · synthetic data</p><iframe title="Board test display" src="/__board-qa?frame&case=${params.get('case')||'three'}" style="width:${width}px;height:${height}px;border:0;transform:scale(${scale});transform-origin:top left"></iframe></body>`;
  }
  const status=(name,ind,title,body,details)=>({name,ind,title,body,details,label:ind==='major'?'Outage':ind==='minor'?'Degraded':ind==='maintenance'?'Maintenance':'Operational',url:''});
  const healthy=['Google Workspace','Microsoft 365','Canvas','Clever','Zoom','Adobe','PowerSchool'].map(name=>status(name,'none','',''));
  const events=[status('Network services','major','Intermittent connectivity at district offices','Some users may experience brief interruptions when accessing online services. Our network team has identified the affected equipment and is applying a fix.\n\nClassroom Wi-Fi remains available. The next update will follow once connectivity has been verified.'),status('Google Workspace','minor','Delayed delivery of incoming mail','We are investigating reports of delayed incoming email. Messages are queued and will be delivered automatically.\n\nExisting messages, Drive files, and Google Classroom are unaffected.'),status('Cloudflare','maintenance','Scheduled network maintenance','Traffic will be redirected during this maintenance window. No action is required.',{type:'cloudflare',maintenance:[],dataCenters:[{name:'Boston, MA',ind:'maintenance'},{name:'New York, NY',ind:'maintenance'},{name:'Newark, NJ',ind:'maintenance'}]})];
  const scenario=params.get('case');
  let fixtures=scenario==='clear'?healthy:scenario==='unknown'?healthy.map(s=>({...s,ind:'unknown',label:'Awaiting status'})):events.slice(0,scenario==='two'?2:3).concat(healthy);
  if(scenario==='dense')events[0].body=Array.from({length:12},(_,i)=>`Update ${i+1}: Engineers continue to verify connectivity across district buildings. Classroom wireless access remains available. This complete notice must remain readable without scrolling or tiny text.`).join('\n\n');
  if(scenario==='five')fixtures=events.concat([status('Zoom','minor','Meeting connection delays','Some participants may need extra time to connect. Existing meetings are not affected.'),status('Canvas','maintenance','Routine maintenance window','Courses remain available while scheduled updates are completed.')],healthy);
  fixtures=fixtures.filter(s=>s.ind!=='none'||!fixtures.some(other=>other.name===s.name&&other.ind!=='none'));
  const bootstrap=source.indexOf("window.addEventListener('DOMContentLoaded',()=>{");
  const end=source.indexOf('</script>',bootstrap);
  const setup=`
    document.body.classList.add('board-page');
    document.documentElement.classList.toggle('light-mode',${JSON.stringify(scenario==='light')});
    document.querySelectorAll('.board-loading').forEach(el=>el.remove());
    _boardModeActive=true;_boardNetTimer=1;_timeGovSyncTimer=1;
    _fetchWeather=()=>{};_fetchNowPlaying=()=>{};_startBoardRadio=()=>{};
    _nowPlayingInfo={track:'Board radio',artist:'Choose a station below',station:'Radio'};
    _wxInfo={loc:'Bristol · Warren',period:{temperature:72,temperatureUnit:'F',shortForecast:'Partly Cloudy',isDaytime:true},periods:Array.from({length:5},(_,i)=>({temperature:72-i,shortForecast:'Partly Cloudy',isDaytime:true,startTime:new Date(Date.now()+i*3600000).toISOString()})),alerts:[]};
    renderBoardView(${JSON.stringify(fixtures)});
    document.getElementById('tv-net-bar').textContent='Network connected · 12 ms';
    document.getElementById('board-loading')?.remove();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const board=document.getElementById('tv-board');
      const cards=[...board.querySelectorAll('.tv-issue-tile')].map(tile=>{
        const inner=tile.querySelector('.tv-issue-body-inner'),body=inner?.parentElement;
        const parts=inner?._boardParts||[],saved=inner?.innerHTML;
        let fits=true,text='';
        for(const part of parts){inner.innerHTML=part;text+=inner.textContent;fits=fits&&inner.scrollHeight<=body.clientHeight+1&&inner.scrollWidth<=body.clientWidth+1;}
        const original=document.createElement('div');original.innerHTML=inner?._boardOriginalHTML||'';
        if(inner)inner.innerHTML=saved;
        return {name:tile.querySelector('.tv-issue-name').textContent,parts:parts.length,fits,lossless:text===original.textContent,bodyFont:body?parseFloat(getComputedStyle(body).fontSize):0};
      });
      board.dataset.qa=JSON.stringify({viewport:[innerWidth,innerHeight],pageFits:document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth,clockFits:board.querySelector('.tv-clock').scrollWidth<=board.querySelector('.tv-clock').clientWidth,cards});
    }));
  `;
  return source.slice(0,bootstrap)+setup+source.slice(end);
}
