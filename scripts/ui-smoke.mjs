import AxeBuilder from '@axe-core/playwright';
import { chromium, firefox, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
let preview;const suiteDeadline=setTimeout(()=>{preview?.kill();console.error('Browser suite exceeded 120 seconds');process.exit(1);},120000);
if(process.env.SIGNAL_START_PREVIEW){preview=spawn(process.execPath,['scripts/preview.mjs']);await new Promise((resolve,reject)=>{preview.stdout.once('data',resolve);preview.once('error',reject);});}
const browserType=({chromium,firefox,webkit})[process.env.BROWSER || 'chromium'];
const browser=await browserType.launch({timeout:30000,headless:true,executablePath:process.env.CHROME_PATH||undefined,args:process.env.CHROME_PATH?['--no-sandbox','--disable-dev-shm-usage']:[]}).catch(error=>{preview?.kill();throw error;});await mkdir('artifacts',{recursive:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1100},colorScheme:'dark'});const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173');await page.waitForSelector('.service-card');await page.waitForSelector('#forecast-chart svg');
 assert.equal(await page.locator('.service-card').count(),12);await page.locator('#services-more').click();assert.equal(await page.locator('.service-card').count(),32);await page.locator('#services-more').click();assert.match(await page.locator('#location-name').innerText(),/Providence/);
 assert.equal(await page.locator('#station option').count(),5);assert.equal(await page.locator('#station').inputValue(),'river');
 await page.locator('#settings-button').click();const settingsA11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(settingsA11y.violations.map(v=>v.id),[]);await page.getByLabel('Density',{exact:true}).selectOption('compact');await page.getByRole('button',{name:'Move Forecast up',exact:true}).click();
 
 await page.locator('#settings-body summary').filter({hasText:'OpenAI'}).click();await page.getByLabel('United States',{exact:true}).check();await page.keyboard.press('Escape');
 await page.reload();await page.waitForSelector('#forecast-chart svg');assert.equal(await page.locator('body').getAttribute('data-density'),'compact');
 await page.locator('#settings-button').click();assert.equal(await page.getByLabel('United States',{exact:true}).isChecked(),true);await page.locator('#settings-body summary').filter({hasText:'OpenAI'}).click();await page.getByLabel('United States',{exact:true}).uncheck();await page.getByLabel('Density',{exact:true}).selectOption('comfortable');await page.getByRole('button',{name:'Move Forecast down',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByLabel('Find an integration',{exact:true}).fill('OpenAI');assert.equal(await page.locator('#health-results tbody tr').count(),1);await page.getByLabel('Find an integration',{exact:true}).fill('');
 await page.locator('#history-refresh').click();await page.waitForSelector('#history-results tbody tr');await page.locator('#history-service').selectOption('openai');await page.waitForFunction(()=>document.querySelector('#history-message').textContent.includes('Confirmed coverage'));
 await page.locator('#coastal-button').click();await page.waitForFunction(()=>document.querySelector('#local-outlook').textContent.includes('Sea grid'));
 const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(accessibility.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
 await page.screenshot({path:'artifacts/desktop.png',fullPage:true});
 await page.locator('#service-search').fill('OpenAI');assert.equal(await page.locator('.service-card').count(),1);await page.locator('.service-open').click();assert.match(await page.locator('#service-dialog-title').innerText(),/OpenAI/);await page.keyboard.press('Escape');
 await page.locator('.star').click();assert.equal(await page.locator('.star').getAttribute('aria-pressed'),'true');await page.locator('#service-search').fill('');
 await page.locator('#location-button').click();await page.locator('#place-query').fill('Newport');await page.locator('#place-form button').click();await page.locator('.place-result').click();assert.match(await page.locator('#location-name').innerText(),/Newport/);
 await page.reload();await page.waitForSelector('#forecast-chart svg');assert.match(await page.locator('#location-name').innerText(),/Newport/);
 await page.locator('#location-button').click();await page.locator('#use-ip').click();await page.waitForSelector('#forecast-chart svg');
 await page.locator('#test-connection').click();await page.waitForFunction(()=>document.getElementById('latency-result').textContent.includes('median'));
 await page.locator('#mobile-theme').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await page.screenshot({path:'artifacts/light.png',fullPage:true});
 await page.locator('#mobile-theme').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile horizontal overflow');
 await page.locator('#board').click();assert.equal(await page.locator('#board').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#tv-channel').innerText(),'SIGNAL / SERVICES');assert.equal(await page.locator('.tv-service').count(),4);
 const firstPage = await page.locator('.tv-service strong').allTextContents();
 await page.getByRole('button',{name:'Next service page',exact:true}).click();
 assert.notDeepEqual(await page.locator('.tv-service strong').allTextContents(),firstPage);
 assert.equal(await page.locator('#tv-radio-dock #station').isVisible(),true);
 await page.locator('#station').selectOption({index:1});
 assert.equal(await page.locator('#tv-radio-dock #radio-state').isVisible(),true);
 await page.setViewportSize({width:1920,height:1080});
 await page.getByRole('button',{name:'Next service page',exact:true}).click();
 assert.equal(await page.locator('.tv-service').count(),8);
 const boardA11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(boardA11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 await page.screenshot({path:'artifacts/board-services.png'});
 await page.locator('#tv-skip').click();assert.equal(await page.locator('#tv-channel').innerText(),'SIGNAL / WEATHER');await page.screenshot({path:'artifacts/board-weather.png'});
 await page.locator('#tv-skip').click();assert.equal(await page.locator('#tv-channel').innerText(),'SIGNAL / POWER');assert.match(await page.locator('.tv-power-count').innerText(),/42 customers/);
 await page.locator('#tv-skip').click();assert.equal(await page.locator('#tv-channel').innerText(),'SIGNAL / NETWORK');
 await page.locator('#tv-exit').click();assert.equal(await page.locator('#tv-board').isHidden(),true);assert.equal(await page.locator('.content #station').isVisible(),true);assert.equal(await page.locator('audio').count(),1);
 // Stored scripts/HTML from upstream must remain inert text.
 await page.route('**/api/status',route=>route.fulfill({json:{services:[{id:'xss',name:'<img src=x onerror=alert(1)>',homepage:'https://example.com',status:'degraded',incidents:[],staleAfterMs:720000,checkedAt:new Date().toISOString()}],history:[]}}));
 await page.reload();await page.waitForSelector('.service-card');assert.equal(await page.locator('.service-card img').count(),0);
 assert.deepEqual(errors,[]);console.log('Browser checks passed: desktop/mobile, filters, details, favorites, persistent location, IP reset, theme, board, radio catalog, latency, text-only upstream rendering.');
} finally {clearTimeout(suiteDeadline);await browser.close();preview?.kill();}
