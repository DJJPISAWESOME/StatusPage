// Local SVG artwork: no icon font, external asset, or emoji rendering dependency.
export function weatherInfo(value) {
  const code = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(code)) return { kind: 'unknown', label: 'Conditions unavailable' };
  if (code === 0) return { kind: 'sun', label: 'Clear' };
  if (code === 1) return { kind: 'partly', label: 'Mostly clear' };
  if (code === 2) return { kind: 'partly', label: 'Partly cloudy' };
  if (code === 3) return { kind: 'cloud', label: 'Overcast' };
  if ([45,48].includes(code)) return { kind: 'fog', label: 'Fog' };
  if ([51,53,55].includes(code)) return { kind: 'rain', label: 'Drizzle' };
  if ([56,57,66,67].includes(code)) return { kind: 'sleet', label: 'Freezing rain' };
  if ([61,63,65,80,81,82].includes(code)) return { kind: 'rain', label: code >= 80 ? 'Rain showers' : 'Rain' };
  if ([71,73,75,77,85,86].includes(code)) return { kind: 'snow', label: 'Snow' };
  if ([95,96,99].includes(code)) return { kind: 'storm', label: code === 95 ? 'Thunderstorms' : 'Thunderstorms / hail' };
  return { kind: 'unknown', label: 'Conditions unavailable' };
}
export function weatherIcon(value, className = 'tv-forecast-symbol') {
  const {kind,label}=weatherInfo(value);
  const svg=(tag,attrs={})=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,val] of Object.entries(attrs))el.setAttribute(key,String(val));return el;};
  const root=svg('svg',{viewBox:'0 0 128 112',width:128,height:112,role:'img','aria-label':label,class:`${className} tv-weather-icon tv-icon-${kind}`});
  const title=svg('title');title.textContent=label;root.append(title);
  if(kind==='unknown'){root.append(svg('circle',{cx:64,cy:52,r:32,fill:'#284760',stroke:'#aac3d8','stroke-width':3}));const mark=svg('text',{x:64,y:66,'text-anchor':'middle',fill:'#f2f7fc','font-size':40,'font-family':'Arial'});mark.textContent='?';root.append(mark);return root;}
  if(['sun','partly'].includes(kind)){
    const rays=svg('g',{class:'tv-sun-rays',stroke:'#ffd36b','stroke-width':4,'stroke-linecap':'round'}),cx=kind==='sun'?64:44,cy=kind==='sun'?52:38;
    for(let i=0;i<8;i++){const a=i*Math.PI/4;rays.append(svg('line',{x1:cx+Math.cos(a)*27,y1:cy+Math.sin(a)*27,x2:cx+Math.cos(a)*36,y2:cy+Math.sin(a)*36}));}
    root.append(rays,svg('circle',{cx,cy,r:21,fill:'#ffce5d',stroke:'#ffe6a3','stroke-width':2}));
  }
  if(kind!=='sun')root.append(svg('path',{class:'tv-cloud-shape',d:'M28 76C9 76 8 49 28 47C28 21 65 15 76 40C94 30 110 43 107 57C124 61 119 78 104 78H28Z',fill:'#e4eff7',stroke:'#c4d8e8','stroke-width':2}));
  if(['rain','sleet','storm'].includes(kind)){const drops=svg('g',{class:'tv-rain-drops',stroke:'#79cfff','stroke-width':5,'stroke-linecap':'round'});for(const x of [35,65,95])drops.append(svg('line',{x1:x,y1:87,x2:x-5,y2:99}));root.append(drops);}
  if(kind==='storm')root.append(svg('path',{d:'M69 54L52 84H65L57 105L88 72H73L84 54Z',fill:'#ffcf5e',stroke:'#fff0ab','stroke-width':1}));
  if(['snow','sleet'].includes(kind)){const snow=svg('g',{class:'tv-snow-flakes',stroke:'#e4f4ff','stroke-width':2,'stroke-linecap':'round'});for(const x of [35,65,95]){snow.append(svg('path',{d:`M${x-5} 94H${x+5}M${x} 89V99M${x-4} 90L${x+4} 98M${x+4} 90L${x-4} 98`}));}root.append(snow);}
  if(kind==='fog'){const fog=svg('g',{class:'tv-fog-lines',stroke:'#aacbdc','stroke-width':4,'stroke-linecap':'round'});for(const y of [87,98])fog.append(svg('line',{x1:24,x2:106,y1:y,y2:y}));root.append(fog);}
  return root;
}
