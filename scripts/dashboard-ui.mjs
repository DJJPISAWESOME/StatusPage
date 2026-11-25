import assert from 'node:assert/strict';
import { fixtureWeather } from '../test/fixtures.mjs';

export async function verifyDashboardTransitions(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const ip = Promise.withResolvers();
    await page.route('**/api/location', async route => {
      await ip.promise;
      await route.fulfill({ json: { latitude: 42.36, longitude: -71.06, label: 'Boston, MA', source: 'cloudflare' } });
    });
    await page.goto('http://127.0.0.1:4173/');
    await page.locator('#location-button').click();
    await page.locator('#use-ri').click();
    await page.waitForSelector('#forecast-chart svg');
    const lateLocation = page.waitForResponse('**/api/location');
    ip.resolve();
    await (await lateLocation).finished();
    await page.locator('.nav-link[href="#services"]').click();
    assert.equal(await page.locator('#location-name').textContent(), 'Providence, RI');
    await page.locator('.nav-link[href="#services"][aria-current="location"]').waitFor();
    await page.locator('[data-filter="favorites"]').click();
    await page.getByRole('button', { name: 'View all services' }).click();
    assert.equal(await page.locator('.service-card').count(), 12);

    let attempts = 0;
    const firstWeather = Promise.withResolvers();
    await page.route('**/api/weather?lat=41.49&lon=-71.31', async route => {
      if (++attempts === 1) {
        await firstWeather.promise;
        await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        return;
      }
      const forecast = fixtureWeather();
      forecast.conditions.current = { temperature_2m: 31, weather_code: 66 };
      await route.fulfill({ json: forecast });
    });
    await page.locator('#location-button').click();
    await page.locator('#place-query').fill('Newport');
    await page.locator('#place-form button').click();
    await page.locator('.place-result').click();
    assert.equal(await page.locator('#temperature').textContent(), '—');
    assert.equal(await page.locator('#forecast-chart svg, .daily-row, #local-outlook').count(), 0);
    firstWeather.resolve();
    await page.locator('#weather-retry').click();
    await page.waitForFunction(() => document.getElementById('temperature').textContent === '31');
    assert.equal(await page.locator('#weather-condition').textContent(), 'Freezing rain');
    assert.equal(await page.locator('#weather-retry').isHidden(), true);

    const firstPower = Promise.withResolvers();
    await page.route('**/api/power?**', async route => { await firstPower.promise; await route.continue(); });
    await page.locator('#board').click();
    const power = page.getByRole('button', { name: 'Show power channel' });
    assert.equal(await power.isHidden(), true);
    firstPower.resolve();
    await power.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#tv-board').getAttribute('data-scene'), 'services');
    await power.click();
    assert.match(await page.locator('.tv-power-count').textContent(), /42 customers/);
    await page.locator('#tv-exit').click();

    await verifyHistoryPaging(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function verifyHistoryPaging(page) {
  assert.equal(await page.locator('#history-export').isDisabled(), true);
  assert.equal(await page.locator('#history-service option[value="openai"]').count(), 1);
  const now = Date.now();
  let nextPageAttempts = 0;
  await page.route('**/api/history?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    assert.equal(params.get('service'), 'openai');
    const more = params.has('before');
    if (more && ++nextPageAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: 'Temporary interruption' } });
      return;
    }
    const row = { id: more ? 1 : 2, service_id: 'openai', reason: 'observed', status: 'operational', start_ms: now - 3600000, effectiveEndMs: now };
    await route.fulfill({ json: { rows: [row], totals: [], nextCursor: more ? null : 2, since: now - 86400000, until: now } });
  });
  await page.locator('#history-service').selectOption('openai');
  await page.locator('#history-more').click();
  await page.waitForFunction(() => document.getElementById('history-message').textContent.includes("Couldn't load"));
  assert.equal(await page.locator('#history-results tbody tr').count(), 1);
  assert.equal(await page.locator('#history-export').isEnabled(), true);
  await page.locator('#history-more').click();
  await page.waitForFunction(() => document.querySelectorAll('#history-results tbody tr').length === 2);
  assert.equal(await page.locator('#history-more').isHidden(), true);
}
