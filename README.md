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

Open the gear button for service visibility, exact component/region selection, panel ordering, density and notification preferences. All preferences stay in this browser. Notifications are disabled by default and work only while the app is open; no closed-browser push subscription is created.

Board view is a dedicated, full-screen TV rotation: services and incident context for five minutes, local weather for two minutes, a power outage map for two minutes when an official regional utility total reports outages or affected customers, and this browser's connection to the dashboard for two minutes. The sequence repeats while Board view is open. Use **Next channel** or **Exit board** in the top bar. The normal dashboard layout does not rotate. The power screen uses Rhode Island Energy's affected-customer count for RI and National Grid's active-outage count for MA/NY; other locations, unavailable sources, and a confirmed zero total skip it. Utility totals are regional, not evidence that a particular address has lost power. The map is loaded from the utility only while its channel is on screen, and an official link remains visible if the utility blocks embedding. Outage checks are cached for five minutes; the browser refreshes them every five minutes in Board view.

Integration health distinguishes collection failures from provider incidents. Observation history can be loaded for 24 hours, seven days or 30 days, filtered by provider/state, paginated and exported. History is provider-wide and begins with this version's deployment. Coverage and operational share are shown separately; missing observations never imply uptime.

The hourly weather table includes rain chances, amounts and gusts. Coastal data loads only on request. AI model availability, fetched time, provider-run time and disagreement are visible independently. An unavailable model is not silently replaced. Current conditions and daily outlook use separately labeled best-match forecasts.

## Cloudflare architecture

The existing `statuspage` Pages project serves the UI from `public/`. Its `/api/*` Pages Function forwards requests through the `STATUS_API` service binding to the `signal-status-dashboard` Worker. The Worker handles validated same-origin API requests; one SQLite Durable Object shares status collection, observation history, webhook receipts and pending invalidations. Cron runs every five minutes. Configured webhook sources reconcile hourly, with failures retried on the next scheduled cycle. Hibernating WebSockets distribute snapshots; disconnected visible clients fall back to one shared-snapshot request per minute. Hidden clients pause unless notifications are enabled and permitted.

Weather caches use coordinate-specific keys: models 30 minutes, current/hourly conditions 15 minutes, NWS five minutes, coastal forecasts 30 minutes; provider-run metadata is shared for ten minutes. These are per-data-center Cache API entries, not a globally coherent cache. Audio streams directly from broadcasters. Optional now-playing metadata is bounded and cached.

Free-tier-conscious choices include static-first routing, one shared collector, SQLite-backed Durable Objects, hibernation, Cron, Cache API, a native API rate-limiter binding, sampled logs and redacted query strings. There is no KV, D1, R2, paid AI inference or unnecessary polling per service per viewer. Cloudflare free allowances are finite; exceeding them can interrupt service. Monitor account usage, especially dynamic requests and SQL rows read/written. History stores intervals and extends current observations instead of inserting every unchanged sample. Closed intervals are pruned daily after 30 days.

## Deploy

This repository supports the existing Pages URL while running the stateful API in a Worker. Cloudflare Pages cannot create a Durable Object class or run the five-minute Cron itself, so both projects are required.

1. In the existing `statuspage` Pages project, set the production build command to `npm run build` and output directory to `public`. The `.node-version` file selects Node.js 24. Leave the Git repository and `main` branch connected.
2. Deploy the `signal-status-dashboard` Worker from this repository with `npm run deploy`, or connect the same repository as a Worker in Cloudflare Builds. Its `wrangler.jsonc` defines the SQLite Durable Object migration, Cron, rate limiter and static assets. No manual D1 or KV setup is needed.
3. In `statuspage` > Settings > Bindings, add a **Service binding** named `STATUS_API` pointing to `signal-status-dashboard`. Add it to both production and preview if preview URLs need a working API. Redeploy Pages after adding the binding.
4. Verify `https://statuspage-273.pages.dev/`, `/api/ping`, `/api/status`, `/api/location`, the WebSocket status feed, weather, and history. Check that the Worker Cron is enabled. Configure provider subscriptions and secrets using [WEBHOOKS.md](docs/WEBHOOKS.md); receiving endpoints alone do not subscribe to providers.

The Pages Function forwards the original request, preserving the Pages origin for same-origin checks and WebSocket upgrades. `public/_routes.json` limits Function invocations to `/api/*`; ordinary assets stay on the static Pages path. The Worker can also serve the UI directly on its own `workers.dev` URL. Existing 2.0 deployments retain the Durable Object name and migration tag. The SQL history table is created on initialization; history begins then.

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
| `functions/api/[[path]].js`, `public/_routes.json` | Pages-to-Worker API forwarding and API-only Function routing |
| `src/worker.js`, `security.js` | Validated routes, visitor location, rate limiting, signatures and response bounds |
| `src/hub.js`, `history.js` | Shared collector, alarms, deduplication, WebSockets and SQL intervals |
| `src/providers.js`, `catalog.js` | Allowlisted provider adapters and endpoints |
| `src/weather.js`, `power.js`, `radio.js` | Cached forecasts/alerts/coastal data, regional utility outage checks and optional radio metadata |
| `public/tv.js` | Full-screen Board view channels and rotation |
| `test/`, `scripts/` | Deterministic tests, synthetic previews and runtime/browser/live gates |
| `docs/` | Release notes, audit, validation, webhook setup and synthetic screenshots |

Primary references: [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Open-Meteo model updates](https://open-meteo.com/en/docs/model-updates), [weather API](https://open-meteo.com/en/docs), [marine API](https://open-meteo.com/en/docs/marine-weather-api).
