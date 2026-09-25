# Validation record — Signal 2.1

Recorded September 24, 2026 against the restored and completed source package. No production deployment was performed.

| Check | Observed result | Scope |
|---|---|---|
| Build checks | Passed | JavaScript syntax, required main DOM IDs, 32 unique HTTPS service entries, no transit integration in production UI/catalog |
| Automated tests | **29 passed, 0 failed** | Existing provider/security tests plus component scoping, validated settings, quiet hours/notification policy, aligned model disagreement, real SQLite history/gaps/coverage/pagination/retention, bounded audio retries, metadata failure isolation, alarm races and Apple integration regression |
| Cloudflare dry run | Passed | Wrangler 4.139.0 bundles Worker and recognizes static assets, SQLite migration, Cron and API rate limiter |
| Cloudflare runtime | Passed | Real Miniflare/workerd, visitor GeoIP, collection, WebSocket broadcast, SQLite history and authenticated webhook replay deduplication across runtime restart |
| Chromium interactions | Passed | Desktop and mobile; search/details/favorites; persistent location and IP reset; settings persistence and component selection; density/order; health search; history filtering; coastal forecast; theme, board, station catalog and inert upstream text |
| Automated accessibility | Passed | axe rules tagged WCAG 2 A/AA and 2.1 AA on the tested Chromium dashboard and settings dialog; keyboard-focusable scrolling tables |
| Browser exceptions / mobile overflow | None in tested flow | No pageerror events; no horizontal document overflow at 390 px |
| Visual review | Completed | Desktop dark and mobile screenshots inspected; synthetic preview data explicitly labeled; dark/light/mobile screenshots included |
| Production dependency audit | 0 reported vulnerabilities | `npm audit --omit=dev`; does not cover unknown vulnerabilities |
| Live integrations | **28 of 32 returned parseable responses** | Snapshot in `live-check.json`; RSS is still feed-only/unconfirmed rather than inferred operational |
| Live weather | Passed | Current conditions, AIFS and AIGFS with provider metadata, NWS alerts, and marine forecast for Providence coordinates |
| Radio endpoints | **5 of 5 returned audio responses** | Includes River, WROR, Cape Cod's X, Ocean 104.7 and 94HJY; not an audible-playback test |

## Remaining validation limits

- Firefox downloaded, but its local smoke invocation did not complete and was stopped. WebKit was not run in the restored workspace; the earlier attempt lacked required system libraries. Neither is claimed as passed. The included GitHub Actions matrix installs browser dependencies and runs Chromium, Firefox and WebKit when committed to a repository with Actions enabled. Those CI jobs have not been executed here.
- Adobe's public responses exceed the production bound. A targeted probe measured a 2,297,290-byte registry; the event response exceeded an 8 MiB diagnostic bound. Production retains its 1 MiB response cap and reports `response_too_large` rather than claiming current health. A scoped authenticated Adobe Status integration requires operator credentials and separate setup.
- AWS, Google Cloud and IBM Cloud returned “Site Unavailable” HTML from this environment. That establishes collection failure here, not actual provider downtime. Their official status-page links remain available.
- The Apple Services parser and Apple Developer URL were corrected and validated. The live report records the Apple Services recheck separately from the original batch.
- Notifications are policy-tested and require explicit user permission. OS-level delivery, background suspension, mobile-platform restrictions and closed-browser delivery have not been validated. Closed-browser Web Push is intentionally not implemented.
- Browser flows use a separate synthetic preview server. Runtime tests use controlled failing upstreams. Live checks use actual upstreams; none of these alone proves production performance or end-user availability.
- No Cloudflare login, actual deployment, domain/DNS cutover, real provider subscriptions, load test, penetration test, assistive-technology certification or audible/geographic audio validation was performed.

## Reproduction

Use Node 24+, `npm ci`, then the validation commands in README.md. `CHROME_PATH` can select an existing Chromium binary; `PLAYWRIGHT_BROWSERS_PATH` selects a browser installation directory. `SIGNAL_START_PREVIEW=1` starts the preview server in the same process environment as Playwright. An outbound proxy environment may require `NODE_USE_ENV_PROXY=1` for live checks. The test browser binaries, dependencies, local runtime state and temporary artifacts are not included in this package.
