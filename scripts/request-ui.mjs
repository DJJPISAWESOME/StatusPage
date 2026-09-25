import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
export async function verifyRequests(browser){
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),errors=[];let current=null,items=[],online=false;
 const song={videoId:'dQw4w9WgXcQ',title:'A requested song',artist:'Example artist'},second={videoId:'aaaaaaaaaaa',title:'Second request',artist:'Another artist'};
 await context.route('**/api/requests**',async route=>{
  const req=route.request(),url=new URL(req.url());let data;
  if(url.pathname.endsWith('/search'))data={results:[song]};
  else if(req.method()==='POST'){
   const body=req.postDataJSON();
   if(url.pathname.endsWith('/control')){
    assert.equal(req.headers().authorization,undefined);
    if(body.action==='claim'){online=true;if(!current)current=items.shift()||null;}
    if(body.action==='release')online=false;
    if(body.action==='next'&&(current?.id||null)===(body.id||null))current=items.shift()||null;
   }else{assert.equal(req.headers().authorization,undefined);items.push({...(!items.length&&!current?song:second),id:crypto.randomUUID()});}
  }
  await route.fulfill({json:data||{current,items,playerOnline:online,searchEnabled:true,playerEnabled:true}});
 });
 await context.addInitScript(()=>{
  window.YT={Player:class{
   constructor(mount,options){this.options=options;this.frame=document.createElement('iframe');this.frame.title='YouTube video player';this.frame.width='356';this.frame.height='200';mount.replaceWith(this.frame);window.testYT=this;setTimeout(()=>options.events.onReady({target:this}),0);}
   setVolume(n){this.volume=n;}loadVideoById(id){this.id=id;this.options.events.onStateChange({data:1});}getVideoData(){return {video_id:this.id};}stopVideo(){}destroy(){this.frame.remove();}finish(){this.options.events.onStateChange({data:0});}
  }};
 });
 const portal=await context.newPage();portal.on('pageerror',e=>errors.push(e.message));await portal.goto('http://127.0.0.1:4173/requests.html');await portal.locator('#request-query').fill('song');await portal.locator('#request-submit').click();await portal.getByRole('button',{name:'Add to queue',exact:true}).click();await portal.waitForFunction(()=>document.getElementById('request-count').textContent==='1 / 50 songs');
 await portal.locator('#request-query').fill('https://music.youtube.com/watch?v=aaaaaaaaaaa');await portal.locator('#request-submit').click();await portal.waitForFunction(()=>document.getElementById('request-count').textContent==='2 / 50 songs');
 assert.deepEqual((await new AxeBuilder({page:portal}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
 await portal.screenshot({path:'artifacts/request-portal.png',fullPage:true});await portal.setViewportSize({width:390,height:844});assert.equal(await portal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await portal.screenshot({path:'artifacts/request-portal-mobile.png',fullPage:true});
 const board=await context.newPage();board.on('pageerror',e=>errors.push(e.message));await board.clock.install();await board.goto('http://127.0.0.1:4173');await board.waitForSelector('.service-card');await board.locator('#board').click();const originalBar=await board.locator('.radio-bar').boundingBox(),originalArt=await board.locator('.radio-art').boundingBox();await board.locator('#station').selectOption('requests');assert.equal(await board.locator('input[type=password]').count(),0);await board.locator('#radio-play').click();await board.waitForFunction(()=>window.testYT?.id==='dQw4w9WgXcQ');assert.equal(current.title,song.title);
 const requestBar=await board.locator('.radio-bar').boundingBox();assert.ok(Math.abs(requestBar.height-originalBar.height)<=1,'Request mode keeps the original radio-bar height');
 const frame=await board.locator('.request-video iframe').boundingBox();assert.equal(frame.width,originalArt.width);assert.equal(frame.height,originalArt.height);assert.ok(frame.x>=requestBar.x&&frame.y>=requestBar.y&&frame.x+frame.width<=requestBar.x+requestBar.width&&frame.y+frame.height<=requestBar.y+requestBar.height,'Video stays inside the radio bar');assert.equal(await board.locator('#audio').evaluate(a=>a.paused),true);
 await board.screenshot({path:'artifacts/board-request-mode.png',animations:'disabled'});
 await board.evaluate(()=>{const a=document.getElementById('audio');a.volume=.1;});await board.waitForFunction(()=>window.testYT.volume===10);
 await board.getByRole('button',{name:'Skip song',exact:true}).click();await board.waitForFunction(()=>window.testYT.id==='aaaaaaaaaaa');await board.evaluate(()=>window.testYT.finish());await board.waitForFunction(()=>document.querySelector('#radio-state').textContent.includes('Waiting for requests'));assert.equal(current,null);
 await board.evaluate(()=>fetch('/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://youtu.be/dQw4w9WgXcQ',requestId:crypto.randomUUID()})}));await board.clock.fastForward(11000);await board.waitForFunction(()=>window.testYT.id==='dQw4w9WgXcQ');
 await board.locator('#station').selectOption('river');await board.waitForFunction(()=>document.querySelector('.request-panel').hidden);assert.equal(await board.locator('.request-video iframe').count(),0);assert.deepEqual(errors,[]);await context.close();
 console.log('Request mode checks passed: portal search/link submissions, shared queue, Board playback contract, skip/end, volume, and station cleanup.');
}
