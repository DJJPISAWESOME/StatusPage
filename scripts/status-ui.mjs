// Focused HTTP/WebSocket race regression. Uses only a fresh, isolated test browser.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureStatus } from '../test/fixtures.mjs';

const port = '4174';
const preview = spawn(process.execPath, ['scripts/preview.mjs'], { env: { ...process.env, PORT: port } });
let browser;
const deadline = setTimeout(() => { preview.kill(); process.exit(1); }, 30000);
try {
  await new Promise((resolve, reject) => { preview.stdout.once('data', resolve); preview.once('error', reject); preview.once('exit', code => reject(new Error(`Preview exited: ${code}`))); });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const base = Date.now();
  const snapshot = (offset, status) => {
    const data = fixtureStatus(); data.updatedAt = new Date(base + offset).toISOString();
    data.services = data.services.map(s => ({ ...s, status, checkedAt: data.updatedAt, incidents: [], error: undefined, note: undefined }));
    return data;
  };
  let release, socket, requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/status', async route => { requestStarted(); await pending; await route.fulfill({ json: snapshot(-300000, 'unknown') }); });
  await page.routeWebSocket('**/api/live', ws => { socket = ws; ws.send(JSON.stringify(snapshot(0, 'operational'))); });
  await page.goto(`http://127.0.0.1:${port}`);
  await started;
  await page.waitForFunction(() => document.getElementById('healthy-count').textContent === '32');
  release();
  await page.waitForResponse(response => new URL(response.url()).pathname === '/api/status');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#healthy-count').textContent(), '32', 'Delayed HTTP unknown must not overwrite live health');
  socket.send(JSON.stringify(snapshot(1000, 'outage')));
  await page.waitForFunction(() => document.getElementById('issue-count').textContent === '32');
  socket.send(JSON.stringify(snapshot(0, 'operational')));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#issue-count').textContent(), '32', 'Older recovery must not hide a newer outage');
  socket.send(JSON.stringify(snapshot(2000, 'unknown')));
  await page.waitForFunction(() => document.getElementById('unknown-count').textContent === '32');
  await page.locator('#board').click();
  assert.match(await page.locator('#tv-content .tv-subtitle').textContent(), /32 unconfirmed/);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/status-race.png' });
  assert.deepEqual(errors, []);
  console.log('Status browser regression passed: delayed HTTP and older live snapshots rejected; new outage and unknown accepted in dashboard and Board.');
} finally {
  clearTimeout(deadline); await browser?.close(); preview.kill();
}
