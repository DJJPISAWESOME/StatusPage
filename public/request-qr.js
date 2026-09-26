import qrcode from './vendor/qrcode.js';
export function requestCode(origin){
 const url=new URL('/requests.html',origin).href;
 const code=qrcode(0,'M');code.addData(url,'Byte');code.make();return {url,code};
}
export function addRequestQR(container){
 const {url,code}=requestCode(location.origin),size=code.getModuleCount(),ns='http://www.w3.org/2000/svg';
 const link=document.createElement('a');link.className='board-request-qr';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.title='Scan to request a song';link.setAttribute('aria-label','Scan QR code or open the song request page');
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${size+8} ${size+8}`);svg.setAttribute('aria-hidden','true');svg.setAttribute('shape-rendering','crispEdges');
 const background=document.createElementNS(ns,'rect');background.setAttribute('width',size+8);background.setAttribute('height',size+8);background.setAttribute('fill','#fff');svg.append(background);
 let d='';for(let row=0;row<size;row++)for(let col=0;col<size;col++)if(code.isDark(row,col))d+=`M${col+4} ${row+4}h1v1h-1z`;
 const path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('fill','#000');svg.append(path);link.append(svg);container.append(link);
}
