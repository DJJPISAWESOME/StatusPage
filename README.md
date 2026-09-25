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

Board view is a dedicated, full-screen TV rotation: services and incident context for five minutes, local weather for three minutes, a power outage map for two minutes when an official regional utility total reports outages or affected customers, and the network report for three minutes. The sequence repeats while Board view is open. Use **Next channel** or **Exit board** in the top bar. The normal dashboard layout does not rotate. The power screen uses Rhode Island Energy's affected-customer count for RI and National Grid's active-outage count for MA/NY; other locations, unavailable sources, and a confirmed zero total skip it. Utility totals are regional, not evidence that a particular address has lost power. The map is loaded from the utility only while its channel is on screen, and an official link remains visible if the utility blocks embedding. Outage checks are cached for five minutes; the browser refreshes them every five minutes in Board view.

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

### Board broadcast pages

The three-minute weather channel cycles through local conditions, the next six hours, a 48-hour ECMWF AIFS / NOAA AIGFS temperature comparison, and a five-day outlook (30 seconds each). Buttons select a weather page without restarting the channel timer. Missing sources remain explicitly unavailable. Network reports include edge / ASN / region / HTTP / TLS details and a five-request dashboard response check (median, range, variation, and request failures). This is not a bandwidth or packet-loss test. Scene transitions and weather / chart animations respect reduced-motion preferences. Radio remains visible throughout.

## Board weather, audio, and network watch

Board weather is pinned to Warren, RI. Local Conditions uses current values with same-hour forecast fallbacks; missing values are never replaced with a future hour. Failed refreshes keep the last successful report and show a refresh warning. Weather backgrounds follow the condition code and day/night flag; reduced-motion preferences disable motion. Weather and network page controls fade after four seconds without input, while page rotation continues and the content expands into the freed space.

Board entry enables status tones and browser speech (subject to browser audio/voice support). Speech prefers available English voices labeled Natural, Neural, Premium, or Enhanced, then Google voices, with American English preferred within each tier. It checks available voices for each announcement and falls back to the existing browser voice when needed; actual voice availability depends on the device. The **Sound alerts** button toggles and saves this preference. **Test alert** in the Board controls cycles through labeled sample outage, degradation, maintenance, recovery, and unconfirmed popups, one per click, and plays the matching tone and voice when sound alerts are enabled, without changing live service status. Outages, degradation, maintenance, recovery, and unconfirmed status use different tones. Announcements say the service and old/new statuses; the radio is lowered during speech and restored afterward. Board popups use a wide status-colored top banner, a gently pulsing icon, staggered entrance animation, and an 18-second reading timer with a smooth dismissal. Reduced-motion preferences disable these animations. Initial snapshots are silent. Leaving Board or muting cancels queued speech. This is an in-page feature, not an OS notification permission or a background push service.

The network channel has four 45-second pages: Connection, Your ASNs, Downstream Watch, and North America. `/api/network-watch` tracks AS25710, AS32145, and AS402280. Public RIPE RIS observations show routing visibility and adjacent AS paths. Right-side neighbours are used as downstream-side candidates; this is an observed routing direction, not proof of a commercial customer relationship or an outage affecting your circuit. No recursive customer-cone coverage is claimed.

To enable Cloudflare Radar outage, route-leak, and high-confidence potential-hijack feeds:

1. Create a Cloudflare API token with Radar read access as described in [Cloudflare's Radar guide](https://developers.cloudflare.com/radar/get-started/first-request/).
2. Store it as the **encrypted Worker secret** `RADAR_API_TOKEN` on `signal-status-dashboard` (Settings → Variables and Secrets), or run `npx wrangler secret put RADAR_API_TOKEN`. Do not put it in Pages public variables or client code.
3. Deploy the updated Worker and Pages assets. Check `/api/network-watch`: `radarConfigured` should be true, and each feed should be available.

Radar data is cached for five minutes; RIPE data for fifteen. Board polls every five minutes. Feeds cover seven days and include ended events. Direct queries cover each watched ASN; downstream and North American reports match the global event feeds. North America includes Canada, the US, Mexico, Central America, and the Caribbean. Radar history loads progressively in batches of up to 200 events per source using a fixed seven-day time window. Continuations load while Board is open, keeping each Worker request bounded. Failed continuations retain loaded results and show incomplete coverage; the next refresh retries them. Report cards rotate every 15 seconds (six per page on a large display, four on shorter displays, two on phones; downstream pages use fewer cards to leave room for path details), with previous/next controls and page numbers. Each report subpage remembers its position across channel rotations. ASN names come from Radar metadata and cached RIPE registry lookups; unavailable names are explicitly labeled. Source failures and absent credentials are shown as unavailable, never as healthy. Radar has incomplete ISP coverage and routing detections do not prove customer impact. The API token stays server-side; only normalized public event data is returned.

## YouTube Request mode

Listeners open **`/requests.html`** (also linked from the radio player) to search YouTube or paste a single YouTube / YouTube Music video link. Requests are stored in a shared Durable Object queue, survive Worker restarts, and play in arrival order. The public portal shows the current selection, whether a Board is connected, and up to 50 waiting songs. Duplicate videos are rejected, retries use request IDs, and public search/add traffic is rate-limited. No listener account is required; this is a public request queue, not a moderated/private room.

One-time setup on the **Worker** (`signal-status-dashboard`):

1. Enable **YouTube Data API v3** in a Google Cloud project. Store its API key as the encrypted Worker secret **`YOUTUBE_API_KEY`** (`npx wrangler secret put YOUTUBE_API_KEY`). Restrict the key to YouTube Data API v3. Search uses the project's quota and is cached for ten minutes; search errors or exhausted quota leave link requests available.
2. Create a random Board-only player key of **32–256 characters** and store it as encrypted Worker secret **`REQUEST_PLAYER_TOKEN`** (`npx wrangler secret put REQUEST_PLAYER_TOKEN`). Keep this key with Board operators; never share it on the listener portal. The Board asks for it when starting Request mode. It stays in that page's memory, is sent only in the same-origin Authorization header, and is not saved in local storage or URLs.
3. Deploy **Worker and Pages** together. The existing `STATUS_HUB` binding stores music under a separate object name; no new Durable Object migration is needed. The Worker configuration includes a dedicated `REQUEST_LIMITER` binding.
4. Enter **Board view**, choose **Request mode · YouTube** in the station picker, enter the player key, and press **Start request mode**. If the browser blocks autoplay, press Play in the visible YouTube player. Share `/requests.html` with listeners.

The YouTube player remains visible (at least 200 × 200), including YouTube's controls and branding. Playback uses the official IFrame API, not downloaded/extracted audio. YouTube Music video links play the corresponding YouTube video; playlists, albums, and authenticated Music library playback are not supported. Region/age restrictions, ads, unavailable videos, and embedding restrictions remain controlled by YouTube. Unplayable videos advance to the next request; other player failures stop with a retry message. **Skip song** advances the current track. Empty queues wait for more requests and check every ten seconds.

Only one Board may control playback at a time, using a renewable 45-second lease and idempotent advancement. Stopping, switching stations, changing Board layout, or hiding the browser tab stops playback and releases that lease. Re-entering Request mode resumes the current selection from its beginning; a browser crash also allows another Board to resume after the lease expires. This avoids silently skipping songs during a disconnect. The radio volume slider and alert volume ducking also control the YouTube player. The portal never receives the Board key or can invoke authorized skip/advance actions.

`/api/requests` exposes GET queue / POST add, `/api/requests/search` handles search, and `/api/requests/control` accepts authorized Board commands. Same-origin checks, bounded JSON bodies, provider-host allowlists, output-as-text rendering, queue limits, and request limits protect these endpoints. Search requires the API key; link submission uses YouTube's oEmbed metadata and works without it. Browser tests mock the YouTube player contract; final real-media playback must be checked on the deployed Board after secrets are configured.
