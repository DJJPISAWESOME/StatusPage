# Kiosk report relevance

The seven-day source feeds remain complete/progressive source evidence; the TV pages show a much smaller operational view. A public report involving an overseas customer or a transit path is not evidence that Justin's circuit is affected.

## Display policy

1. Retain every ongoing report returned for a monitored ASN or explicitly involving AS25710 (i3 Broadband), AS32145 (OpenCape), or AS402280 (BWRSD). They outrank indirect context. Do not suppress these with the page cap, confidence threshold or recency cutoff. Label old/missing observation times as unconfirmed freshness. Show direct recoveries for six hours; count older ended history as excluded.
2. Upstream candidates qualify for routing context only when the source names one as the leaking ASN, potential hijacker or victim. Merely appearing in `leak_seg` does not qualify. Require an ongoing/non-ended observation within 24 hours and confidence at least 8 for potential hijacks. Actual source last-seen timestamps are retained; an old start can still qualify if the source reports recent activity.
3. North America adds recent non-ended regional outage/traffic-anomaly annotations. It does not add every unrelated routing event with a participant registered somewhere in North America.
4. Show up to four upstream context reports and six regional context reports, including direct reports first. Excess non-direct context is counted explicitly. Every direct ongoing report survives even when it exceeds that cap. Prefer current direct events over recoveries, then higher source confidence/prefix count and recent observations within each group.
5. Show reviewed, excluded and omitted counts. Keep source completeness, pagination, stale data and unknown upstream topology independent from relevance. Missing incident-role metadata leaves relevance coverage unknown. Empty means **no relevant recent detections**, never guaranteed network health. Every displayed event has `localImpactConfirmed: false`; the UI retains the explicit source/impact caveat.

The 24-hour/six-hour windows and context caps are display policy, not provider service-level or contractual relationship claims. RIPE left-side adjacency still does not verify ISP contracts. The source does not establish which provider prefixes carry a watched circuit, so indirect provider reports are explicitly context, not local incidents.

## Same-snapshot comparison

Recorded production snapshot: **2026-10-01 13:12:44 UTC**, seven-day window ending **13:10 UTC**. All continuations succeeded. Global counts: 5 outage annotations, 1,655 leaks, 230 high-confidence potential hijacks, **1,890 total**. This is later than the original 12:45 investigation and must not be confused with its 852-record regional count.

| View | Before | Proposed |
| --- | ---: | ---: |
| North America | 853 reports, 214 four-card pages | 2 reports, one page |
| Upstream watch | 212 reports, 106 two-card pages | 2 reports, one page |

Classification across all source reports: **1,224** ended/stale/no-ongoing historical reports; **574** unrelated ongoing reports; **90** ongoing reports where an upstream appeared only in the transit segment; **2** retained role-qualified recent detections. There were no direct watched-ASN reports in this snapshot. No context was omitted by the cap in this case.

Included examples:

- `hijacks-166381`: source identifies AS9009 as potential hijacker, AS2914 (NTT) among victims, confidence 10, ongoing, start Sep 30 15:12 UTC. It involves overseas and North American participants. **Local circuit impact unconfirmed.**
- `hijacks-166498`: source identifies AS174 (Cogent) as potential hijacker and AS138754 (Kerala Vision, India) as victim, confidence 8, ongoing, start Oct 1 12:48 UTC. **Local circuit impact unconfirmed.** It qualifies because a candidate upstream has an explicit source role, not because India is local.

Excluded examples:

- `leaks-628896`: AS53486 is the leaking actor; AS174 and AS6939 occur in the segment. An ongoing two-prefix transit association is not a reported Cogent leak or a watched-ASN incident.
- Ended outage annotation `outage-1679` describes planned power outages in Eswatini, outside local/regional relevance.
- Ended leaks, stale hijack detections and ongoing unrelated ASNs remain source history instead of flooding the kiosk.

The recorded older normalizer did not return actor/victim/last-seen fields separately. For this comparison only, actor/confidence were recovered from its fixed source-derived descriptions and hijack victims from its actor/victim ASN list. The recorded start was used conservatively where last-seen was missing; no fresh observation times were invented. New source normalization returns the documented actor/victim fields and latest source timestamp directly.

## Regression evidence

Final combined `npm test`: **107 passed**. Build, local Worker dry-run/runtime, and installed Chrome full regression suite passed; the narrowed same-snapshot Chrome rendering verifies two reports, one page, full-height cards and visible local-impact caveats.

Tests cover transit-only exclusion, actual provider roles, confidence/freshness, ended/stale history, direct incidents beyond the cap, direct recoveries, regional context, unknown role metadata, and independent missing-feed/topology states. Task `artifacts/relevance-snapshot-audit.json` records counts and examples from exactly one snapshot. `artifacts/relevance-rebuilt-live.json` is the proposed rendering of recorded source evidence; it is distinct from synthetic fixtures. Chrome captures: `artifacts/relevance-upstream.png`, `artifacts/relevance-north-america.png`. These do not claim deployment of the follow-up.

This change accompanies the separate cold-cache budget fix. No source scope, provider access controls, credentials, permissions, deployment configuration or CI policy are expanded.
