> Historical audit of the 2.0 rewrite. The 2.1 release supersedes its feature and validation status; see RELEASE-2.1.md and VALIDATION.md.

# Application audit and rewrite

Audit date: 2026-09-24. Input: `StatusPage-main(1).zip`, archive marker `5b20c6680c4dae8d2052b58139fe3087def03670`. Scope: application source, route configuration, build/deploy scripts, integration handling, weather, radio, network diagnostics, browser state, accessibility and operations. This is a source/configuration audit with local validation, not a production penetration test or a claim that every vendor endpoint is currently reachable.

## Executive findings

The original is a 273,655-byte single HTML file with roughly 4,900 lines mixing layout, API adapters, global state, polling, audio and diagnostics. A Pages proxy adds another 11,612 bytes. The rewrite separates those responsibilities, reduces per-viewer upstream traffic, and stops treating missing data as evidence of health.

The reported New York weather is **not explained by a hard-coded New York fallback**: the supplied fallback is already in Rhode Island (`41.7226,-71.2829`). The actual defect is location precedence and transparency. `_getDeviceLocation()` first requests browser geolocation, then uses `ipapi.co` only on failure, then caches the first successful result in memory indefinitely. A browser result for New York would override Rhode Island IP data. Browser/IP discrepancies, VPNs or inaccurate geolocation remain possible; the supplied source alone cannot establish the exact result returned on the user’s device.

The new app uses the viewer’s Cloudflare metadata directly, shows the source, provides a persistent city override, and requests browser location only on an explicit button press. If Cloudflare has no usable coordinates, it labels Providence as a fallback. It does not pretend GeoIP is exact or force every visitor into Rhode Island.

## Findings and remediation

| Severity | Finding and original evidence | Resolution |
|---|---|---|
| High | `_getDeviceLocation()` prioritizes browser GPS over IP and caches for the session; no persistent location override or visible provenance. | IP-first auto mode, explicit fallback, source labels, saved city and opt-in device location; regressions test RI and zero coordinates. |
| High | `startPerServicePolling()` initiates immediate requests alongside initialization, then creates a separate two-minute cycle for every service in every browser. Proxy replies use `no-store`. | One shared backend snapshot; five-minute Cron independent of viewer count; webhook invalidation; hibernating WebSocket push; one-snapshot browser fallback. |
| High | Generic `status.indicator || 'none'`, several empty-array/default-code branches, and RSS heuristics can silently imply healthy status on schema changes. | Explicit schema checks, unknown states, separate feed semantics, per-source timestamps and staleness thresholds. |
| High | Ordinary proxy size check reads `.text()` before checking actual size and counts characters rather than UTF-8 bytes. Special routes do not consistently have caps/timeouts. | Stream-counted byte limits, per-fetch deadlines that include reading the body, bounded metadata reads and response cancellation. |
| Medium | Proxy returns HTML from allowlisted sources on the application origin, lacks CSP, and offers wildcard CORS. Allowlisting was a good existing control but does not address same-origin content exposure. | Browser receives normalized JSON only; no generic proxy; same-origin APIs, restrictive static CSP, text-only DOM rendering, MIME sniffing protection. |
| Medium | Fixed upstream URLs still permit automatic redirects; special code attempts to impersonate a browser to pass Adobe WAF. | Status/weather redirects fail closed. Radio redirects have an explicit hostname and HTTPS allowlist. Adobe is queried honestly; blocking becomes unavailable. |
| Medium | Failure state is largely global; a successful service can clear overall staleness while another source remains unavailable. | Per-service `checkedAt`, `lastSuccessAt`, errors and expiry; stale operational values become unconfirmed. |
| Medium | `normalizeIndicator()` maps unknown strings to major outage, conflating schema changes with provider outages. | Unknown remains unknown; failures do not manufacture incidents. |
| Medium | Region/PoP heuristics and hard-coded component choices (including Duo72) can suppress relevant incidents or be misleading for another location. | Provider-wide health is explicit. The legacy North-America and custom-instance filters are retired rather than silently re-applied to unverified mappings. |
| Medium | Network features infer DoH from an observed resolver address; “traceroute” is HTTP probes to unrelated hosts; HTTP failures/opaque results can mislead about packet loss. | Real request protocol/TLS/edge metadata and accurately labeled HTTP latency. No fabricated network-hop, DNS-encryption or packet-loss claims. |
| Medium | Direct third-party geolocation, album-art and diagnostic calls expose viewer connection details and increase dependency surface. | Geolocation is first-party; weather is server-side with rounded coordinates. No artwork lookup or automatic third-party diagnostic requests. User-triggered audio still reaches the broadcaster. |
| Medium | No webhook authentication, replay, durable invalidation or push architecture. | Per-source HMAC, timestamp window, persisted deduplication, versioned pending work and durable alarms. Native callback token mode can only re-fetch fixed source data. |
| Medium | Global mutable script, generated route lists and mixed parser/render code make safe changes difficult to isolate. No supplied test suite or pinned deployment dependency. | Focused ES modules, one service registry, lockfile, parser/security/location tests, local runtime and browser smoke scripts. |
| Low | Monolithic inline scripts/styles prevent a strong CSP; repeated full DOM updates and visual noise make scanning harder. | Separate assets, restrained panel layout, meaningful hierarchy, filters/favorites, details, visible unknowns and keyboard controls. |
| Low | Local storage access can throw in privacy modes; stale settings are hard to diagnose. | Safe storage access with new namespaced keys and input validation. |

The original allowlisted route registry and widespread HTML escaping are useful existing protections. No exploit of the original deployment is claimed. Source comments describing guarantees were checked against the actual implementation rather than accepted at face value.

## Feature disposition

| Original feature | Rewrite |
|---|---|
| 32 cloud/application services | Retained in registry with explicit adapters |
| Two MBTA rail feeds | Removed from source and UI; replaced with AI forecast section |
| NWS hourly weather | Replaced by clearly labeled Open-Meteo model estimates and AI comparison; NWS alerts retained |
| Three documented radio stations plus 94HJY in code | All four retained; 92.5 The River added and selected by default |
| Radio now-playing | Optional ICY metadata, bounded and cached; no promise of metadata where streams omit it |
| Album artwork, sound-alert ducking | Retired; fewer external requests, no unsolicited audio |
| Board mode, clock, themes | Retained with responsive/fullscreen layout; no forced reload loops or time.gov proxy |
| Service search | Retained; favorites, attention filter and detail dialogs added |
| NA/PoP and custom Duo filtering | Replaced with explicitly provider-wide coverage; no false location-scoped health claim |
| Speed test, resolver identification, “traceroute,” Radar/IODA panels | Retired from the core app; honest edge metadata and on-demand HTTP latency retained. Use dedicated network tooling for these functions. |
| Historical uptime/SLA | Never invented; only the most recent 60 observed transitions are stored |

These changes are intentional, documented tradeoffs of the rewrite. If per-PoP monitoring is essential, add configured component IDs and provider-specific tests before reintroducing it. RSS feeds remain linked but are not a complete health API. Confirm whether retired diagnostics or sound-alert behaviors are required before production cutover.

## AI and data correctness

AIFS is actual machine-learning forecast output, not an LLM-generated summary. GraphCast is explicitly experimental and may be unavailable. Each is fetched independently so one failure does not remove the other. Current conditions are model estimates, not station observations. The comparison chart uses a common epoch timeline, local display timezone, gaps for missing values, and a numeric table. Model disagreement is not described as a calibrated confidence interval. Attribution appears in the interface.

## Security boundaries and remaining risks

- Public dashboard by default; no authentication or authorization for viewing provider-wide status. Add Cloudflare Access if private viewing is needed, and separately allow authenticated provider callbacks through an appropriate path policy.
- HMAC callbacks authenticate senders holding per-service secrets. Native Statuspage URLs are bearer capabilities; they authenticate possession of a token, not the provider. Their payload cannot set status. Configuration reduces exposure by redacting query strings and disabling invocation logs, but external provider logs and account-level logging remain outside this code.
- Provider data is untrusted. The app uses `textContent`, does not evaluate JSONP, rejects XML DTD/entities, validates known schemas, forbids arbitrary URLs and bounds bytes/time. An allowlisted provider can still return inaccurate information.
- Cache API storage is per-colo and best-effort. Upstream availability, commercial licensing, provider rate limits and Cloudflare quotas still apply.
- The Durable Object is a single shared room capped at 200 WebSockets. It is appropriate for a personal/team board. A large public launch needs load testing, sharding and a capacity/cost review.
- The read-only UI does not require Turnstile. No paid AI inference, queue, database, mail or messaging product is silently provisioned.
- Unavailable feeds, old endpoint redirects, WAF responses, geographic audio restrictions and vendor schema changes must be checked after deployment. River’s official listen page describes regional streaming; a fallback link is always present. Embedded playback from Rhode Island was not verified here.

## Primary references

Verified on 2026-09-24. Provider URLs and policies may change.

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [SQLite Durable Objects on the free plan](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/)
- [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [Static asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Native rate-limiter binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare geolocation weather example](https://developers.cloudflare.com/workers/examples/geolocation-app-weather/)
- [Open-Meteo ECMWF models and interpolation](https://open-meteo.com/en/docs/ecmwf-api)
- [Open-Meteo model identifiers](https://github.com/open-meteo/open-meteo/blob/main/openapi/forecast.yml)
- [Open-Meteo GraphCast model definition](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Controllers/ForecastapiController.swift)
- [Open-Meteo terms](https://open-meteo.com/en/terms)
- [ECMWF AIFS dataset](https://www.ecmwf.int/en/forecasts/dataset/aifs-machine-learning-data)
- [Statuspage webhooks](https://support.atlassian.com/statuspage/docs/enable-webhook-notifications/)
- [92.5 The River official listening guidance](https://theriverboston.com/listen/)

The direct River stream URL was identified from a public directory and needs broadcaster/deployment verification. The official page verifies the station and listening options, not the continued availability of that specific URL.
