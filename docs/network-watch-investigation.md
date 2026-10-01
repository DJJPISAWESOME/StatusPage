# Upstream watch and North America investigation — 2026-10-01

Base: `b135d7218bdb425bc5427d84f34547daa7ff3685`, verified against origin/main after the investigation. Fresh task clone; previous checkouts untouched. Audio/queue implementation and deployment configuration unchanged. Proposed changes require a separate merge/deployment decision.

## Relationships and their limits

Public RIPE `asn-neighbours` responses at **2026-10-01 00:00 UTC**, plus production overview observations at **08:00 UTC**:

| Watched ASN | Left-side observed ASNs | Interpretation |
| --- | --- | --- |
| AS25710 — i3 Broadband | AS174 — Cogent | Observer-side adjacency; possible upstream transit/peer |
| AS32145 — OpenCape | AS14325 — OSHEAN; AS174 — Cogent; AS2914 — NTT | Observer-side adjacencies; possible upstream transit/peers |
| AS402280 — Bristol Warren Regional School District | None | No announced routes or neighbours visible to RIS; upstream provider unknown |

[RIPE documentation](https://stat.ripe.net/docs/data-api/api-endpoints/asn-neighbours) defines left/right as positions relative to the requested ASN on observed AS paths. `uncertain` means a left-side neighbour observed only as a direct RIS collector peer and may be an artifact of collector peering. We exclude uncertain and right-side neighbours. Left-side neighbours do **not** prove contractual ISP/customer relationships or confirm circuit health. AS402280's absence does not establish a local outage and does not justify assigning it to OpenCape. No customer cone or recursive transit coverage is claimed.

The fix changes the data selection, event matcher, visible ASN-name requests, tab, and incident context to upstream candidates. All three watched ASNs remain; unknown topology is explicit. RIS snapshots older than 48 hours are excluded from current matching and labeled stale; 48 hours is our conservative freshness policy, not a RIPE guarantee.

## North America: findings and actual evidence

Read-only production API retrieval at **2026-10-01 12:45:42.570 UTC**, fixed window ending **12:45 UTC**:

- `radarConfigured: true`; all twelve global/direct initial feeds succeeded. This verifies the running Worker could read those feeds then; secret contents and permissions were not inspected or changed.
- Global initial data: 5 outage annotations, 200 leaks, 200 hijacks. Leaks and hijacks advertised page 3. The initial North America view already had 181 matching reports and was partial, not unavailable.
- Followed every public continuation cursor: leak pages 3, 5, 7, 9, 11, 13, 15, 17; hijack page 3. All returned available. Final totals: **5 outage annotations, 1,657 leaks, 230 high-confidence potential hijacks**, no remaining cursor.
- Rebuilding those retrieved records with the new matcher produced **852 North America reports** and **211 upstream-candidate reports**. All direct watched-ASN feeds had zero matching events. Reports include ended/stale detections; these counts are not outage counts.
- Regional selection includes Northern America, Central America, and Caribbean ISO codes; any reported participant in scope qualifies, even when other participants are overseas. The sources can miss ISP incidents. No matching reports never means healthy.

**The user's earlier incomplete result was not reproduced.** Current public endpoints/auth/pagination work. We cannot honestly attribute the earlier observation to a particular authentication, rate-limit, or source outage without the failed response. The previous UI omitted diagnostic codes, so it could not distinguish those causes. No credentials were created, access controls bypassed, production state changed, or external contacts made.

Concrete implementation defects fixed:

1. Every event repeated the full page ASN dictionary. The actual initial JSON was **3,861,349 bytes**. Keeping only names for involved ASNs reduces the same normalized initial evidence to **240,809 bytes**, with identities retained. This removes substantial transfer/memory/render overhead; it does not prove the historical failure was a timeout.
2. A failure on page two of a batch discarded page one's successful records. Per-page success caching now retains successful records and the exact failed-page cursor, including page 2. Failed reads are not cached; the next five-minute refresh retries. A 429 on the second page is tested through recovery.
3. Generic coverage messages hid causes. Cards now expose sanitized 401/403/429, timeout, malformed-response and oversized-response diagnostics, including when some reports are already visible. No upstream bodies or tokens reach the client.
4. Cached responses could be used without checking their fetch age. The network reader now rejects over-age cache entries. Last-report age/refresh failure and stale routing observations remain explicit.
5. Invalid ASN/country array shapes now fail the source parser instead of generating misleading empty regional coverage.

Endpoints/semantics checked: RIPE `as-overview`, `asn-neighbours`; Radar `/annotations/outages` (`limit`, zero-based `offset`), `/bgp/leaks/events`, `/bgp/hijacks/events` (`per_page`, one-based `page`, `involvedAsn`, `TIME`/`DESC`, hijack `minConfidence=8`). The seven-day `dateStart`/`dateEnd` window remains fixed through pagination. Radar `result_info.total_count` is respected when supplied; a full page otherwise retains a continuation.

References: [RIPE neighbours](https://stat.ripe.net/docs/data-api/api-endpoints/asn-neighbours), [Radar leaks](https://developers.cloudflare.com/api/resources/radar/subresources/bgp/subresources/leaks/subresources/events/methods/list/), [Radar hijacks](https://developers.cloudflare.com/api/resources/radar/subresources/bgp/subresources/hijacks/subresources/events/methods/list/), [Radar annotations](https://developers.cloudflare.com/api/resources/radar/subresources/annotations/methods/list/).

## Verification and evidence

Baseline `npm test`: 89 passed. Baseline `npm run build`: passed. Final `npm test`: **96 passed**. Final `npm run build`: passed. Final `npm run test:runtime`: dry-run bundle plus local Miniflare runtime passed (visitor geo, collection, WebSocket, SQL history, authenticated webhook deduplication across restart). Production dependency `npm audit --omit=dev`: zero vulnerabilities. Chrome outcomes are recorded in task `artifacts/` (ignored by Git).

Chrome uses installed Google Chrome with an isolated headless profile and muted audio. `SIGNAL_START_PREVIEW=1 CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:ui` covers four network pages, automatic report pagination, a full unattended twelve-minute channel rotation via virtual clock, TV full-height layout, responsive width, axe, disconnected/partial/incomplete/error/stale/recovery, and audio/queue regression contracts. Its synthetic fixtures are explicitly distinct from the public recorded evidence.

Real records revealed clipped event cards when topology and stale warnings occupied extra space. Upstream pages now rotate two cards, regional pages four on large screens and two on shorter screens; healthy coverage grids are omitted when records are shown, while failure diagnostics remain visible.

Additional local Chrome rendering replays the recorded public observations through the new UI, verifies the AS174 direction, AS402280 unknown state, North America real records, no page errors, and full-height layout. This is evidence of local proposed behavior, not proof of deployment. Screenshots: `artifacts/live-observations-upstream.png`, `artifacts/live-observations-north-america.png`; synthetic-state screenshots: `artifacts/network-after-*.png`. JSON responses, source docs, compacted report and exact counts are in `artifacts/live-*.json` and `artifacts/ripe-*.json`. No new source credentials were available or needed for these read-only production diagnostics; new authenticated code paths are verified with realistic isolated responses and recorded output, not falsely called live requests from the new Worker.

Remaining limitation: contractual upstream providers for all networks, especially AS402280, cannot be established from these feeds. The historical incomplete response is unavailable. No production merge/deployment has been performed.
