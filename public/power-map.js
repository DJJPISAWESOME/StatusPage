// Fixed local viewport. Only visible tiles are requested; browser caching is retained.
const WIDTH=900,HEIGHT=600,ZOOM=13;
const project=(lat,lon)=>{const sine=Math.sin(lat*Math.PI/180),scale=256*2**ZOOM;return [(lon+180)/360*scale,(.5-Math.log((1+sine)/(1-sine))/(4*Math.PI))*scale];};
const center=project(41.70,-71.27);
export function renderPowerMap(report){
 const panel=document.createElement('section');panel.className='tv-map-panel tv-local-map-panel';panel.setAttribute('aria-label','Warren and Bristol outage map');
 const heading=document.createElement('div');heading.className='tv-map-toolbar';heading.textContent='WARREN / BRISTOL · RHODE ISLAND ENERGY';panel.append(heading);
 const map=document.createElement('div');map.className='tv-local-map';map.setAttribute('role','img');map.setAttribute('aria-label',report.locationsAvailable?`${report.locations?.length||0} reported outage locations in Warren and Bristol`:'Outage locations unavailable; map is for geographic reference');
 const left=center[0]-WIDTH/2,top=center[1]-HEIGHT/2;
 for(let x=Math.floor(left/256);x*256<left+WIDTH;x++)for(let y=Math.floor(top/256);y*256<top+HEIGHT;y++){
  const img=document.createElement('img');img.alt='';img.draggable=false;img.referrerPolicy='strict-origin-when-cross-origin';img.src=`https://tile.openstreetmap.org/${ZOOM}/${x}/${y}.png`;
  img.style.cssText=`left:${(x*256-left)/WIDTH*100}%;top:${(y*256-top)/HEIGHT*100}%;width:${256/WIDTH*100}%;height:${256/HEIGHT*100}%`;
  img.onerror=()=>{panel.dataset.tilesUnavailable='true';};map.append(img);
 }
 for(const point of report.locations||[]){
  const [x,y]=project(point.latitude,point.longitude);if(x<left||x>left+WIDTH||y<top||y>top+HEIGHT)continue;
  const marker=document.createElement('span');marker.className='tv-outage-pin';marker.textContent=String(point.count);marker.style.left=`${(x-left)/WIDTH*100}%`;marker.style.top=`${(y-top)/HEIGHT*100}%`;marker.title=`${point.town}: ${point.count} customers affected`;map.append(marker);
 }
 const note=document.createElement('p');note.className='tv-map-status';note.textContent=!report.locationsAvailable?'Outage locations unavailable':report.count===0?'No local outages reported':'● Customers affected at each reported location';map.append(note);
 const failure=document.createElement('p');failure.className='tv-map-tile-error';failure.textContent='Street map unavailable · use the official map link';map.append(failure);
 const credit=document.createElement('a');credit.className='tv-map-attribution';credit.href='https://www.openstreetmap.org/copyright';credit.target='_blank';credit.rel='noopener noreferrer';credit.textContent='© OpenStreetMap contributors';map.append(credit);
 panel.append(map);return panel;
}
