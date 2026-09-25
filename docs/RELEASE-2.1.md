# Signal 2.1

All eight improvement areas are implemented. This archive updates the Cloudflare rewrite; it has not been deployed.

| Improvement | Delivered behavior |
|---|---|
| Integration health | Searchable diagnostics with failure category, upstream HTTP status when available, last success, next check, consecutive failures, accepted webhook count and timestamp |
| Relevant services | Hide services and choose exact provider component IDs, including regions where the provider exposes them; missing component data becomes unknown |
| Incident notifications | Explicit browser permission, severity threshold, recovery notices, local quiet hours and 24-hour event deduplication; initial and unknown transitions suppressed |
| Rhode Island weather | Existing visitor GeoIP/manual/GPS precedence; 12-hour precipitation and gust table, NWS alerts, optional coastal wave forecast with sea-grid coordinates |
| Model reliability | Independently fetched ECMWF AIFS and NOAA AIGFS, latest provider-run metadata, overdue-update indication and timestamp-aligned temperature disagreement |
| Durable history | SQLite observation intervals retained for 30 days, service/state/period filters, pagination, duration calculation and CSV export of loaded rows |
| Personal layout | Panel visibility/order, compact density and optional 15/30/60-second board rotation, paused during interaction |
| Radio resilience | 15-second connection/buffering watchdog, three delayed reconnects, stable-play retry reset, manual cancellation and support for explicitly verified alternate streams |

## Important semantics

Notifications work while the app remains open, including a background tab where the browser permits it. They are not closed-browser Web Push. Delivery depends on browser/OS permissions and background execution policies. Preview data never sends notifications. Settings changes reset the comparison baseline. Browser tabs coordinate deduplication with Web Locks when available; older browsers use best-effort local storage.

Component selection applies to the summary, service cards and notifications. Empty selection means provider-wide. An incident lacking component mapping retains provider-wide context. Diagnostics and stored history always cover the full provider; a regional preference does not retroactively transform provider history.

History starts with deployment of this version. Old recent-change entries are not reconstructed into invented durations. Observations expire after the source freshness window; late collection records a monitoring gap. Operational share excludes unknown periods, and coverage uses the full requested time window. Duration is observed provider-state time, not an official incident duration or SLA. Unobserved time before the first sample is reflected in coverage, without invented history rows.

AIGFS explicitly replaces the earlier experimental GraphCast default: the earlier live GraphCast check returned only null temperatures. Model metadata is eventually consistent and does not identify the originating run of every point in a seamless forecast. Two-model disagreement is not a calibrated confidence interval. Marine output describes the selected sea grid; it is not a tide or navigation forecast.

No alternate audio URLs have been invented. A station can define `fallbacks: [{url: 'https://…', verified: true}]` after operator verification. The included streams all returned audio responses during this release check, including 92.5 The River. This is not an audible-playback guarantee.

## Known upstream limitations

Apple Services' catalog parser and Apple Developer's redirected endpoint were corrected based on live checks. Adobe's public registry exceeds 2 MiB and its event response exceeded an 8 MiB diagnostic bound. The production collector keeps its bounded response handling and exposes `response_too_large`; use Adobe's official status page or configure an appropriately scoped authenticated Adobe Status integration in future work. AWS, Google Cloud and IBM Cloud returned “Site Unavailable” HTML in this execution environment. Their failures remain unconfirmed, never operational.

The included CI workflows run build/unit/runtime/accessibility checks, a Chromium/Firefox/WebKit browser matrix, and daily live-source checks once committed to a GitHub repository with Actions enabled. Set repository variable `WEATHER_CONTACT` for live NWS checks. Live-source failures intentionally fail that workflow while preserving the JSON report.

See `VALIDATION.md` for observed results and deployment limitations.
