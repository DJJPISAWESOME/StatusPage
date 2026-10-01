# Cold-cache request budget follow-up

PR #167 merged as `23631a65dab59643d3601c08afaa015cbebd8c8b`. Worker production build `edd9ae20-a837-4575-aa36-5193d499fdee`, Worker version `3c88d709-79e8-4696-a650-37aa7969a0a8`, and Pages deployment `ab728855-83c0-46f4-b1a3-9a8bd85c1f03` succeeded on that merge. Public JavaScript byte-matched the merged files. Initial API propagation briefly returned the old schema, then the new upstream schema appeared.

## Live observation and cause

At **2026-10-01 13:11:33 UTC**, the first new-cache API request retained 100 records from each global routing feed but failed later pages and several direct feeds with `request_failed`. A subsequent warm-cache read returned all twelve initial feeds successfully. Every production continuation then succeeded: **5 outage annotations, 1,655 leaks, 230 high-confidence potential hijacks** for the fixed window. The API retained accurate unknown topology for AS402280. Counts differ slightly from the earlier investigation because this is a later time window.

Cloudflare documents that fetch and Cache API operations share a [50-operation quota on Workers Free](https://developers.cloudflare.com/workers/platform/limits/#cache-api-limits). The merged cold path can exceed this even with otherwise valid source responses. An isolated budget simulation shaped like the retrieved live responses produced **60 operations** without a limit; imposing a hard 50 reproduced the same failure pattern: first 100 global routing records retained, later global pages and several last direct feeds failed. Full batches on every direct/global feed can require up to 90 operations. This is a reproducible application request-budget defect. Attribution of the specific production errors to that limit remains a strong inference, not a production-log confirmation: the existing local CLI has no authenticated session, and no credentials were created or permissions expanded.

## Fix

- Cache the independently normalized RIPE overview/neighbour result together per ASN: one cache read, two provider fetches, one successful cache write. Keep partial successes visible but do not cache failed/partial observations.
- Read one initial page per Radar feed. `nextPage=2` is explicit; the existing Board continuation loader fetches subsequent batches of up to two pages. The date window and page/offset semantics remain fixed.
- Worst-case initial budget: **12 RIPE operations + 36 Radar operations = 48**. This leaves two operations of headroom for the forwarding/rate-limit layers without changing plan, configuration, source scope or credentials. Warm initial reads use 15 operations. Continuations require at most six fetch/cache operations per invocation.

This prevents normal cold-cache retrieval from manufacturing incomplete source coverage. Genuine source failures, malformed data, absent credentials, unknown relationships, stale observations, and progressive history remain explicit.

## Checks

The quota-only validation passed **97 tests**; combined relevance validation is recorded with the final suite, including a hard shared 50-operation limit with every direct/global initial page full, exact 48 cold/15 warm accounting, unknown/partial RIPE recovery, stable-window pagination from page 2, retention and recovery when a later page fails, and the existing source/UI contract tests. Build, Worker dry-run/runtime and Chrome regression outcomes are recorded separately in task artifacts. Fixtures and the budget simulation are not represented as live provider responses.

Task evidence: `artifacts/request-budget-proof.json`, `artifacts/production-network.json` (first cold failure), `artifacts/production-network-retry.json` (warm success), production continuation JSON, `artifacts/cold-budget-tests.txt`, `artifacts/cold-budget-build.txt`, `artifacts/cold-budget-runtime.txt`, and `artifacts/cold-budget-chrome.txt`.

The follow-up is proposed separately from already-merged PR #167. No deployment settings, secrets, plan or CI policy changes are needed. Merge/deployment approval for this follow-up remains separate.
