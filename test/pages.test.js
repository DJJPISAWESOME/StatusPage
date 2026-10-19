import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

test('Pages routes only API traffic through the Worker binding', () => {
  const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url)));
  assert.deepEqual(routes, { version: 1, include: ['/api/*'], exclude: [] });
});

test('Pages forwards the original API request and Worker response', async () => {
  const request = new Request('https://statuspage-273.pages.dev/api/live', {
    headers: { Origin: 'https://statuspage-273.pages.dev' },
  });
  const expected = new Response('ok');
  let forwarded;
  const response = await onRequest({ request, env: { STATUS_API: {
    fetch(value) { forwarded = value; return expected; },
  } } });
  assert.equal(forwarded, request);
  assert.equal(response, expected);
});

test('Pages reports a missing Worker binding', async () => {
  const response = await onRequest({ request: new Request('https://statuspage-273.pages.dev/api/ping'), env: {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Status API binding is unavailable' });
});

test('Worker previews isolate status storage and rate limits from production', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url)));
  assert.deepEqual(config.previews.durable_objects.bindings, [{ name: 'STATUS_HUB', class_name: 'StatusHub' }]);
  const productionNamespaces = new Set(config.ratelimits.map(binding => binding.namespace_id));
  for (const binding of config.previews.ratelimits) {
    assert.equal(productionNamespaces.has(binding.namespace_id), false);
    assert.deepEqual(binding.simple, config.ratelimits.find(p => p.name === binding.name).simple);
  }
  assert.equal(config.previews.vars.WEBHOOK_SERVICES, '');
  assert.equal(config.previews.triggers, undefined); // Cron remains production-only.
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['StatusHub'] }]);
});
