# Status refresh stability — October 19, 2026

The proposed fix verifies a transient source failure once more before publishing a collection, and prevents older HTTP or WebSocket snapshots from replacing newer data. Persistent failures still publish unknown. No previous healthy value is substituted for a failed check.

## Evidence and diagnosis

Base: `origin/main` at `2c88c39dcdbe953d0e3093fda7e20fed77d94564`. Existing checkouts were inspected and left untouched; implementation is on the isolated `fix/status-refresh-stability` worktree. No software-engineering skill was available in the executor or cloud skill catalogs.

Read-only requests to the public [status API](https://statuspage-273.pages.dev/api/status) and [observation history](https://statuspage-273.pages.dev/api/history?days=1) confirmed real collector transitions, independently of browser rendering:

| Observation (UTC) | Evidence |
| --- | --- |
| 2026-10-19 14:45:51.439 | HMH, Clever, Incident IQ, Seesaw, Akamai, CacheFly, DNSFilter and Wasabi began `unknown` intervals with reason `source_error`. |
| 2026-10-19 14:50:28.703 | All eight recovered on the next collection; Wasabi returned to maintenance, the others to operational. |
| 2026-10-19 14:55:21.268 | Snapshot contained 26 operational, one outage, one maintenance and four unknown services. IBM's error remained `response_too_large`; AWS, Azure and Fastly remained feed-only unknowns. |

The verified amplification mechanism was a single failed attempt becoming the published status until the next five-minute collection. A brief request failure therefore produced minutes of unconfirmed status and a later recovery transition. Historical intervals do not retain HTTP/error details, so the exact transport cause of the 14:45 failures is **not established**. The observations do not prove every reported flip has this cause.

A second reproducible defect was in `receive()`: initial/fallback HTTP requests and WebSocket updates could arrive out of order, with no freshness comparison. A delayed older unknown snapshot could undo a newer healthy result, or an older healthy response could hide a newer incident. The Chrome regression reproduces both orders with controlled responses; it is not evidence that this race occurred in production.

Other paths inspected:

- The Durable Object already serializes collection with a promise queue and gates duplicate scheduled refreshes. Regression coverage verifies concurrent scheduled calls publish one collection.
- `/api/status` returns `Cache-Control: no-store`; the frontend requests no-store and the service worker has no fetch cache. Service collection does not use an expiring response cache.
- The existing 12-minute scheduled and 75-minute webhook freshness windows remain in force. Old operational observations still become unconfirmed.
- Existing normalization preserves unknown provider values and feed-only sources. Provider-reported outage, degradation and maintenance remain authoritative after retry.

## Implementation

`src/collection.js` runs every selected source once with four concurrent collectors. It then waits 250 ms and retries eligible timeout, transport, HTTP 408 and selected server-error results once, using the remaining request budget. No status, SQL interval, change event or socket update is published between attempts. Each result reports `attempts` (one or two).

The catalog currently reserves 33 initial fetches for 32 services, including Adobe's two-fetch adapter. The 48-fetch ceiling leaves at most 15 fetches for retries on a full run. Schema-classified errors, oversized responses, auth failures and HTTP 429 are not retried immediately. Active `Retry-After` seconds or HTTP-date delays also suppress the immediate retry; only a normalized `retryAfterAt` timestamp is propagated from the response. The worst-case fleet fixture uses exactly 48 fetches, observes every source and stays at four concurrent fetches. This conservatively respects [Cloudflare's documented free-plan subrequest and connection limits](https://developers.cloudflare.com/workers/platform/limits/).

`public/status-snapshot.js` compares snapshot `updatedAt` values. The hub allocates each update as the greater of the wall-clock time or the persisted previous update plus one millisecond. This makes the ordering strict across same-millisecond collections, clock rollback and hub restart. Once a timestamped snapshot is displayed, an older or undated snapshot is rejected before updating the dashboard, Board or notification baseline. Equal snapshots remain valid for settings reprocessing. A newer unknown result is accepted.

## Independent review and corrections

An independent reviewer inspected exact commit `d7971290fadd7c37525b2d113f7fc5f0ef014140` and its surrounding implementation/tests. The reviewer found two P2 issues: the added 503 retry ignored `Retry-After`, and equal wall-clock timestamps allowed an older snapshot to hide a newer incident. Both new regression cases failed against that commit (`artifacts/review-regressions-before.log`).

The corrections preserve and check provider backoff metadata before retry, and allocate strictly increasing persisted `updatedAt` timestamps. The reviewer independently rechecked the correction diff and reran all eight focused regressions plus `git diff --check`: passed, with no remaining supported findings. Queued forced collections also preserve the newer incident while serializing in-flight work. The reviewer made no edits.

## Validation

| Check | Result |
| --- | --- |
| Baseline Node suite | 112 passed |
| Final Node suite (`npm test`) | 120 passed, including eight new regression cases |
| Build (`npm run build`) | Passed: 32 services, static assets and Worker modules |
| Worker bundle (`wrangler deploy --dry-run --outdir artifacts/worker`) | Passed; no upload/deployment |
| Runtime (`node scripts/runtime-smoke.mjs`) | Passed in actual local workerd/SQLite: all-source failure remains unknown, WebSocket broadcast, history and restart persistence |
| Focused browser (`npm run test:status-ui`) | Passed in a fresh headless Google Chrome context: delayed HTTP rejected, older recovery rejected, new outage/unknown accepted, Board shows unknown, no page exceptions |

The eight new cases cover recovered retries with each status class, persistent network/timeouts, nonretryable errors/feed-only unknowns, fleet request/concurrency budgets, snapshot ordering/stale expiry, provider backoff, and the real hub's publication/persistence behavior including forced-run ordering, timestamp ties, clock rollback and restart. The focused browser command is also added to the Chromium CI job. Runtime and browser upstreams are synthetic. Existing installed dependencies matched the lockfile versions and were copied into the isolated worktree; no package versions were changed.

Original local evidence is in `artifacts/tests.log`, `build.log`, `worker-build.log`, `runtime.log`, `status-browser.log`, `status-race.png` and `status-live-evidence.json`. Review follow-up evidence is in `artifacts/review-regressions-before.log`, `review-regressions-after.log`, `review-full-tests.log`, `review-build.log`, `review-worker-build.log`, `review-runtime.log` and `review-status-browser.log` (artifacts are intentionally ignored by Git).

## Remaining limits and proposed release

- A source still becomes unknown if its retry fails, its error is nonretryable, or a fleet incident exhausts the retry budget. This is intentional truthful reporting. No claim is made that upstream outages are fixed.
- The underlying transport cause of past source errors needs production observation during a failing collection. Check per-source `detail`, `httpStatus`, `attempts`, `consecutiveFailures`, `checkedAt` and `lastSuccessAt` after release.
- IBM's oversized feed and the feed-only unknowns are separate existing limitations and remain visible.
- Retries can increase collection duration and upstream traffic during failures. First observations have priority; timeouts, concurrency and the request budget bound the added work. Long provider backoff delays do not defer later scheduled/forced collections; this is the existing collection cadence, while the added immediate retry now respects active backoff.
- Snapshot ordering relies on one shared hub and its retained snapshot. Source freshness still uses `checkedAt` and the client clock; changing the ordering does not expand stale-data windows or compensate for client clock skew.

The runtime fix requires **no production database migration, production configuration/binding change, new secret or dependency update**. `retryAfterAt` is additive metadata in the existing JSON snapshot; ordering continues using the existing `updatedAt` field. Worker and Pages assets should come from the same reviewed commit using the existing bindings. After approval and normal CI, observe several five-minute cycles and inspect failures/retries, live reconnects, and a client reload. Confirm genuine source errors and stale observations still appear as unconfirmed, and provider incidents remain visible. Rollback uses the prior Worker and Pages release; no schema rollback is needed.

### Release preparation follow-up

After publication was approved, branch `fix/status-refresh-stability` was pushed and PR #171 opened. The existing Cloudflare nonproduction command `npx wrangler preview` failed because newer Wrangler requires a `previews` block. A repository-only configuration addition declares an isolated preview status hub, distinct preview rate-limit namespaces and nonsecret preview variables. Top-level production configuration, migrations, account/security settings and credentials are unchanged. An independent reviewer found no supported findings in this addition; the focused isolation test passes. Preview rate namespaces are separate from production but shared across branches using this block. Normal CI and deployment checks remain required; no failing check is bypassed.
