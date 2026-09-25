# Signal — StatusPage 2.1

A Cloudflare Workers rewrite of the original dashboard: 32 non-transit integrations, visitor-based local weather, ECMWF AIFS and NOAA AIGFS forecasts, NWS alerts, and five radio stations including **92.5 The River**. MBTA has been removed. Version 2.1 adds all eight requested improvements; see [release notes](docs/RELEASE-2.1.md).

## Run

Use Node.js 24 or later for the complete validation suite.

```sh
npm ci
npm run build
npm test
npm run dev
```

Local development has no real visitor GeoIP, so it explicitly defaults to Providence, RI. In production, the Worker uses the visitor's `request.cf` location. A saved manual city takes precedence; the location dialog lets you reset to IP location, choose a city, or request device location. Coordinates are validated and rounded to two decimal places.

For a clearly labeled synthetic design preview:

```sh
npm run preview
```

Open `http://127.0.0.1:4173`. Test fixtures are outside deployed assets.

## Configure the dashboard

Open the gear button for service visibility, exact component/region selection, panel ordering, density, board rotation and notification preferences. All preferences stay in this browser. Notifications are disabled by default and work only while the app is open; no closed-browser push subscription is created.

Integration health distinguishes collection failures from provider incidents. Observation history can be loaded for 24 hours, seven days or 30 days, filtered by provider/state, paginated and exported. History is provider-wide and begins with this version's deployment. Coverage and operational share are shown separately; missing observations never imply uptime.

The hourly weather table includes rain chances, amounts and gusts. Coastal data loads only on request. AI model availability, fetched time, provider-run time and disagreement are visible independently. An unavailable model is not silently replaced. Current conditions and daily outlook use separately labeled best-match forecasts.

## Cloudflare architecture

Static Assets serves the UI. A Worker handles validated same-origin API requests; one SQLite Durable Object shares status collection, observation history, webhook receipts and pending invalidations. Cron runs every five minutes. Configured webhook sources reconcile hourly, with failures retried on the next scheduled cycle. Hibernating WebSockets distribute snapshots; disconnected visible clients fall back to one shared-snapshot request per minute. Hidden clients pause unless notifications are enabled and permitted.

Weather caches use coordinate-specific keys: models 30 minutes, current/hourly conditions 15 minutes, NWS five minutes, coastal forecasts 30 minutes; provider-run metadata is shared for ten minutes. These are per-data-center Cache API entries, not a globally coherent cache. Audio streams directly from broadcasters. Optional now-playing metadata is bounded and cached.

Free-tier-conscious choices include static-first routing, one shared collector, SQLite-backed Durable Objects, hibernation, Cron, Cache API, a native API rate-limiter binding, sampled logs and redacted query strings. There is no KV, D1, R2, paid AI inference or unnecessary polling per service per viewer. Cloudflare free allowances are finite; exceeding them can interrupt service. Monitor account usage, especially dynamic requests and SQL rows read/written. History stores intervals and extends current observations instead of inserting every unchanged sample. Closed intervals are pruned daily after 30 days.

## Deploy

This is a Workers + Static Assets project, not a direct replacement ZIP for a Pages upload.

1. Run `npm ci`; choose a unique Worker name in `wrangler.jsonc`.
2. Replace `WEATHER_CONTACT` with a real operator contact URL or email.
3. Run `npx wrangler login` in your environment.
4. Run `npm run build`, `npm test`, and `npm run test:runtime`.
5. Run `npm run deploy`. The included migration creates SQLite storage; no manual D1/KV setup is needed.
6. Validate your visitor location, current sources and history on the resulting URL, then configure a custom domain. Keep your old deployment until acceptance checks pass.
7. Configure actual provider subscriptions and secrets using [WEBHOOKS.md](docs/WEBHOOKS.md). Receiving endpoints alone do not subscribe to providers.

No account, deployment, DNS, domain or real webhook subscription was changed while creating this archive. Existing 2.0 deployments retain the Durable Object name and migration tag. The new SQL table is created on initialization; history begins then.

Open-Meteo's free endpoint is for non-commercial use. For commercial use, obtain an appropriate plan and set `OPEN_METEO_API_KEY` with `npx wrangler secret put OPEN_METEO_API_KEY`. Forecast and marine requests then use customer hosts. This does not enable a paid subscription automatically.

## Validate

```sh
npm run build
npm test
npm run test:runtime
npm audit --omit=dev
npx playwright install --with-deps chromium firefox webkit
SIGNAL_START_PREVIEW=1 BROWSER=chromium npm run test:ui
SIGNAL_START_PREVIEW=1 BROWSER=firefox npm run test:ui
SIGNAL_START_PREVIEW=1 BROWSER=webkit npm run test:ui
WEATHER_CONTACT=https://your-domain.example/contact npm run test:live
```

Browser checks include settings persistence, component preferences, history filtering, coastal data, desktop/mobile flows and automated axe WCAG checks. Runtime checks use real workerd and SQLite with controlled failing upstreams, including authenticated webhook replay across restart. Live checks independently probe provider responses, AI/weather/NWS/coastal APIs and audio response types. The live check intentionally exits nonzero for unavailable sources and writes `artifacts/live-check.json`.

GitHub workflows under `.github/workflows/` automate these gates after the project contents are placed at a repository root. See [validation](docs/VALIDATION.md) for the results actually observed for this release, and [the original audit](docs/AUDIT.md) for migration rationale.

## Source map

| Path | Purpose |
|---|---|
| `public/app.js`, `enhancements.js` | Main dashboard and settings/diagnostics/history/weather UI |
| `public/preferences.js`, `policy.js` | Validated preferences, scoping, notifications and coverage policy |
| `public/radio-player.js`, `stations.js` | Bounded audio recovery and radio catalog |
| `public/sw.js` | Notification click handling; no asset cache or closed-browser push |
| `src/worker.js`, `security.js` | Validated routes, visitor location, rate limiting, signatures and response bounds |
| `src/hub.js`, `history.js` | Shared collector, alarms, deduplication, WebSockets and SQL intervals |
| `src/providers.js`, `catalog.js` | Allowlisted provider adapters and endpoints |
| `src/weather.js`, `radio.js` | Cached forecasts/alerts/coastal data and optional radio metadata |
| `test/`, `scripts/` | Deterministic tests, synthetic previews and runtime/browser/live gates |
| `docs/` | Release notes, audit, validation, webhook setup and synthetic screenshots |

Primary references: [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Open-Meteo model updates](https://open-meteo.com/en/docs/model-updates), [weather API](https://open-meteo.com/en/docs), [marine API](https://open-meteo.com/en/docs/marine-weather-api).
