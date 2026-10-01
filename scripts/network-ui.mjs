import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { fixtureNetworkWatch } from '../test/fixtures.mjs';
export async function verifyNetworkStates(browser){
 const context=await browser.newContext({viewport:{width:1920,height:1080},colorScheme:'dark'});
 const empty=fixtureNetworkWatch();
 empty.names={25710:'I3-BROADBAND-RI - i3 Broadband',32145:'OPENCAPE - OpenCape Corporation',402280:'BWRSD - Bristol Warren Regional School District',10271:'MEGANET-TCIX - Meganet Communications',11499:'WHOI-WOODSHOLE - Woods Hole Oceanographic Institution',32278:'Getwireless.net',393690:'AS-MARITIME - Massachusetts Maritime Academy',400357:'SOUTHCOAST-HEALTH-01 - Southcoast Health System, Inc.',40194:'MBL',40207:'Cape Cod Healthcare Inc.'};
 for(const n of empty.networks){n.name=empty.names[n.asn];n.events=[];n.upstream=n.asn===32145?[10271,11499,32278,393690,400357,40194,40207]:[];n.announced=n.asn!==402280;}
 empty.upstream.events=[];empty.northAmerica.events=[];
 empty.feeds=[0,25710,32145,402280].flatMap(asn=>['outages','leaks','hijacks'].map(kind=>({asn,kind,available:true,events:[]})));
 let report=structuredClone(empty),failed=false;
 await context.route('**/api/network-watch',async route=>{const checkedAt=await route.request().frame().evaluate(()=>new Date().toISOString());await route.fulfill(failed?{status:503,json:{error:'Test refresh interruption'}}:{json:{...report,checkedAt}});});
 await context.route('**/api/asn-names?**',route=>route.fulfill({json:{names:empty.names}}));
 const errors=[];
 async function open(){const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto('http://127.0.0.1:4173');await page.waitForSelector('.service-card');await page.locator('#board').click({delay:100});await page.clock.runFor(1000);await page.getByRole('button',{name:'Show network channel',exact:true}).click({delay:100});await page.clock.runFor(100);await page.waitForFunction(()=>document.getElementById('tv-board').dataset.scene==='network');await page.getByRole('button',{name:'03 Upstream watch',exact:true}).click({delay:100});await page.clock.runFor(100);await page.locator(failed?'.tv-watch-empty[data-state=error]':'.tv-watch-path').first().waitFor();return page;}
 if(process.env.SIGNAL_CAPTURE_BEFORE){
  const old=await readFile('artifacts/network-channel-before.js','utf8'),oldCss=await readFile('artifacts/tv-before.css','utf8'),oldTv=await readFile('artifacts/tv-before.js','utf8');await context.route('**/tv.js',route=>route.fulfill({contentType:'text/javascript',body:oldTv}));await context.route('**/tv.css',route=>route.fulfill({contentType:'text/css',body:oldCss}));await context.route('**/network-channel.js',route=>route.fulfill({contentType:'text/javascript',body:old}));
  const before=await context.newPage();await before.clock.install();await before.goto('http://127.0.0.1:4173');await before.waitForSelector('.service-card');await before.locator('#board').click({delay:100});for(const scene of ['weather','power','network']){await before.locator('#tv-skip').press('Enter');await before.waitForFunction(scene=>document.getElementById('tv-board').dataset.scene===scene,scene);}await before.getByRole('button',{name:'03 Upstream watch',exact:true}).click({delay:100});await before.locator('.tv-empty').waitFor();await before.mouse.move(1,1);await before.clock.fastForward(5000);await before.screenshot({path:'artifacts/network-before-empty.png',animations:'disabled'});await before.close();await context.unroute('**/network-channel.js');await context.unroute('**/tv.css');await context.unroute('**/tv.js');
 }
 const page=await open();
 async function capture(path){await page.mouse.move(1,1);await page.clock.fastForward(5000);await page.screenshot({path,animations:'disabled'});}
 await page.locator('.tv-watch-empty[data-state=empty]').waitFor();
 assert.equal(await page.locator('.tv-watch-path').count(),3);
 assert.match(await page.locator('.tv-watch-path').nth(1).innerText(),/7 observed network links[\s\S]*5 other observed links/);
 assert.equal(await page.locator('.tv-watch-paths').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true);
 assert.equal(await page.locator('#tv-content').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true);
 await capture('artifacts/network-after-empty.png');
 await page.bringToFront();await page.mouse.move(500,200);await page.clock.runFor(500);await page.getByRole('button',{name:'02 Your ASNs',exact:true}).click({delay:100});await page.clock.runFor(100);assert.match(await page.locator('.tv-asn-card').first().innerText(),/i3 Broadband/);assert.equal(await page.locator('#tv-content').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true);await capture('artifacts/network-after-asns.png');
 async function refresh(next,error=false){report=next;failed=error;const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/network-watch');await page.clock.fastForward(300000);await response;await page.getByRole('button',{name:'Show network channel',exact:true}).click({delay:100});await page.clock.runFor(100);await page.waitForFunction(()=>document.getElementById('tv-board').dataset.scene==='network');await page.getByRole('button',{name:'04 North America',exact:true}).click({delay:100});await page.clock.runFor(100);}
 report=structuredClone(empty);report.northAmerica.available=false;Object.assign(report.feeds.find(f=>f.asn===0&&f.kind==='leaks'),{available:false,detail:'http_429'});
 await refresh(report);await page.locator('.tv-watch-empty[data-state=incomplete]').waitFor();assert.match(await page.locator('.tv-watch-coverage').innerText(),/Route leaks\s+Rate limited \(429\)/);await capture('artifacts/network-after-partial.png');
 report=structuredClone(empty);report.northAmerica.limited=true;await refresh(report);await page.locator('.tv-watch-empty[data-state=partial]').waitFor();assert.match(await page.locator('.tv-watch-empty').innerText(),/loaded so far/);
 report=structuredClone(empty);report.radarConfigured=false;report.northAmerica.available=false;await refresh(report);await page.locator('.tv-watch-empty[data-state=disconnected]').waitFor();await capture('artifacts/network-after-unavailable.png');
 await refresh(empty);await page.locator('.tv-watch-empty[data-state=empty]').waitFor();
 await refresh(empty,true);await page.locator('.tv-watch-empty[data-state=stale]').waitFor();assert.match(await page.locator('#tv-content').innerText(),/previous observations/);await capture('artifacts/network-after-stale.png');
 await refresh(empty);await page.locator('.tv-watch-empty[data-state=empty]').waitFor();assert.equal(await page.locator('#tv-content').getByText(/Refresh interrupted/).count(),0);
 // One complete unattended twelve-minute rotation, including Power and all network pages.
 await page.getByRole('button',{name:'Show services channel',exact:true}).click({delay:100});await page.clock.runFor(100);
 const weatherPositions=new Set(),networkPositions=new Set(),cycle=['services','weather','power','network'];
 for(let step=1;step<=16;step++){
  await page.clock.fastForward(45000);const scene=cycle[Math.floor(step/4)%4];assert.equal(await page.locator('#tv-board').getAttribute('data-scene'),scene);
  if(scene==='weather')weatherPositions.add(await page.locator('#tv-board').getAttribute('data-weather-page'));
  if(scene==='network')networkPositions.add(await page.locator('#tv-board').getAttribute('data-network-page'));
 }
 assert.equal(weatherPositions.size,4);assert.equal(networkPositions.size,4);
 await page.getByRole('button',{name:'Show network channel',exact:true}).click({delay:100});await page.clock.runFor(100);await page.waitForFunction(()=>document.getElementById('tv-board').dataset.scene==='network');await page.getByRole('button',{name:'03 Upstream watch',exact:true}).click({delay:100});await page.clock.runFor(100);await page.emulateMedia({reducedMotion:'reduce'});
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 await page.locator('#tv-exit').press('Enter');await page.waitForFunction(()=>!document.fullscreenElement);await page.setViewportSize({width:390,height:844});await page.locator('#board').click({delay:100});await page.clock.runFor(1000);await page.getByRole('button',{name:'Show network channel',exact:true}).press('Enter');await page.getByRole('button',{name:'03 Upstream watch',exact:true}).click({delay:100});await page.clock.runFor(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await capture('artifacts/network-after-mobile.png');
 failed=true;const unavailable=await open();await unavailable.clock.fastForward(5000);assert.match(await unavailable.locator('.tv-watch-empty').innerText(),/retry automatically/);await unavailable.screenshot({path:'artifacts/network-after-error.png',animations:'disabled'});await unavailable.close();failed=false;
 assert.deepEqual(errors,[]);await context.close();console.log('Network UI checks passed: TV layout, empty/partial/loading/unconfigured/error/stale/recovery, complete unattended rotation, responsive width and axe.');
}
