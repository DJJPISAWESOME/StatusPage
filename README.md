# Service Status Page

Real-time status dashboard monitoring cloud providers, SaaS applications, CDNs, DNS resolvers, and MBTA commuter rail. Status data is polled server-side and pushed to clients via Server-Sent Events (SSE). Includes a full-screen board/TV mode with live radio, weather, and a Network Diagnostics tab with Cloudflare edge info, DNS resolver detection, protocol support, latency probes, speed testing, and internet health monitoring.

---

## Services monitored

| Category | Services |
|----------|----------|
| **Applications** | i-Ready, HMH, Follett, IncidentIQ, Clever, Seesaw, Jamf, Duo, Imagine Learning, FinalSite, Dexcom, Adobe CC, Google Workspace, Apple Services, Apple Developer, OpenAI, Mimecast |
| **Infrastructure** | Cloudflare, Tailscale, DNSFilter, Meraki, AWS, Azure, Google Cloud, Oracle Cloud, IBM Cloud, Akamai, Fastly, Bunny.net, CacheFly, Wasabi |
| **Transit** | MBTA Providence/Stoughton Line, MBTA Fall River / New Bedford Line |

Cloudflare shows per-data-center status for North America. Non-NA incidents (e.g. Jakarta, Lisbon) are filtered out automatically.

---

## Features

- **Server-side polling + SSE** — a Cloudflare Worker polls all status endpoints every 2 minutes and pushes updates to all connected clients via Server-Sent Events; no per-client polling
- **Service directory** — filterable/searchable list with real-time status; active issues promoted to a top panel with masonry card layout
- **Board / TV mode** — full-screen dashboard designed for wall-mounted displays with auto-rotating status banners, weather, clock, and a scrolling service ticker
- **Live radio** — three stations (105.7 WROR, Cape Cod's X, Ocean 104.7) with now-playing metadata, album art via iTunes, and volume ducking during alert banners
- **Weather** — current conditions and alerts from the National Weather Service API, with geolocation via browser or ipapi.co fallback
- **Network diagnostics** — your connection info, Cloudflare edge details, TLS/HTTP/3/IPv6 protocol support, DNS resolver detection, latency probes to Cloudflare/Google/AWS/Azure, path quality analysis, download speed test, IODA BGP anomalies, and Cloudflare Radar traffic anomalies
- **Light/dark theme** — manual toggle or follows OS preference

---

## Architecture

```
Worker (server-side)
  │
  ├─ Polls all status endpoints every 2 minutes
  ├─ Parses responses (Statuspage API, RSS, custom formats)
  └─ Stores normalized results in KV

Browser
  │
  ├─ EventSource /api/sse ──► SSE endpoint reads KV, pushes snapshots/updates
  │
  ├─ GET /proxy?svc=<key> ──► Cloudflare Pages Function (functions/proxy.js)
  │                              ├─ route-table lookup (no raw URL accepted)
  │                              ├─ special-route handlers (WROR ICY metadata,
  │                              │   IODA outages, Cloudflare Radar, Adobe WAF bypass)
  │                              └─ static routes → upstream fetch → CORS response
  │
  └─ GET /                ──► Cloudflare Pages → static asset → index.html
```

**Key properties:**
- **SSE push model** — server polls upstream once per cycle, pushes to all clients; eliminates per-client polling overhead
- **KV cache** — normalized status results stored in Cloudflare KV; SSE endpoint reads from KV, so multiple clients share the same data
- **Single-file SPA** — all UI and client logic in `index.html`; parsing logic moved server-side to `functions/api/poll.js`
- **Route-table proxy** — `functions/proxy.js` only proxies URLs registered in `routes.json`; arbitrary URLs are rejected (no SSRF surface)
- **Special routes** — server-side handlers for endpoints that require non-browser protocols (ICY streaming metadata), API keys (Cloudflare Radar), or custom headers (Adobe WAF bypass)

---

## Deploying to Cloudflare Pages

### Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### KV namespace setup

The SSE endpoint stores polled status results in Cloudflare KV. Without a KV binding, the worker will poll upstream on every SSE connection (still functional, but inefficient).

**1. Create the namespace:**

```bash
wrangler kv namespace create STATUS_KV
```

This outputs a namespace ID like `abcd1234...`. Note it for the next step.

**2. Bind to your Pages project (production):**

In the Cloudflare dashboard:

1. Go to **Workers & Pages** → select your Pages project
2. Click **Settings** → **Bindings**
3. Click **Add binding** → **KV Namespace**
4. Set **Variable name** to `STATUS_KV`
5. Select the namespace you created
6. Click **Save**

Redeploy for the binding to take effect.

**3. Bind for preview environments (optional):**

Repeat the binding step under **Settings** → **Bindings** → **Preview** tab if you want KV in preview deployments too.

**4. Local development with KV:**

```bash
wrangler pages dev . --kv STATUS_KV
```

This creates a local KV store in `.wrangler/state/` — no cloud namespace needed for local testing.

**How it works:**

- `functions/api/poll.js` polls all status endpoints and writes results to the `all-statuses` key
- `functions/api/sse.js` reads from KV (via Cache API buffer) every 30s and pushes changes to connected clients
- A KV-based distributed lock (`poll-lock` key, 90s TTL) prevents multiple SSE connections from triggering concurrent polls
- The Cache API acts as a per-colo read-through buffer, so multiple clients on the same Cloudflare edge share a single KV read per 30s window — this keeps KV reads well within the free plan's 100K reads/day limit

### Deploy

```bash
wrangler pages deploy .
```

Cloudflare Pages serves `index.html` as a static asset and runs Pages Functions for `/proxy`, `/api/sse`, and `/api/poll` requests.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CF_RADAR_TOKEN` | Optional | Cloudflare API token for Radar traffic anomaly data in the Network tab |

| KV Binding | Required | Description |
|------------|----------|-------------|
| `STATUS_KV` | Required | KV namespace for caching polled status results |

### Custom domain

Attach your custom domain in the Cloudflare dashboard under **Workers & Pages → your Pages project → Custom domains**.

---

## Local development

Open `index.html` directly (`file://`) or serve it with any static server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

In local mode `_IS_DEPLOYED` is `false`; the SSE endpoint is not available. For full local testing with SSE, KV, and the proxy:

```bash
wrangler pages dev . --kv STATUS_KV
```

This runs the Pages Functions locally at `http://localhost:8788` with a local KV store. The SSE endpoint, poll trigger, and proxy all work identically to production.

---

## Adding a service

1. **Route table** — add an entry in `routes.json` under `static`:
   ```json
   "myservice-summary": "https://status.example.com/api/v2/summary.json"
   ```

2. **Sync routes** — run `node scripts/build.js` to inject the route key into `index.html` (updates `ROUTE_KEYS` and `SPECIAL_KEYS` between the `@routes-start` / `@routes-end` markers).

3. **Service definition** — add an entry to the `SVCS` array in both `index.html` and `functions/api/poll.js`:
   ```js
   {name:'My Service', su:'https://status.example.com/api/v2/summary.json',
    hu:'https://status.example.com', cat:'app'},
   ```
   Most Atlassian Statuspage-hosted services work with the default parser. For custom APIs add a `p:'myparser'` key and implement the parser in `functions/api/_parsers.js`.

---

## Security

| Control | Implementation |
|---------|---------------|
| No-SSRF proxy | Route table in `functions/proxy.js` loaded from `routes.json`; `?svc=<key>` only — raw URLs rejected with 404 |
| Response size limit | Proxy enforces a 5 MB max on upstream responses |
| Content-Type sniffing | `X-Content-Type-Options: nosniff` on all API responses (SSE, poll, proxy) |
| Method validation | SSE and poll endpoints reject non-GET requests with 405 |
| Error sanitization | Server error responses use generic messages; internal details never leaked to clients |
| XSS mitigation | All upstream API text (incident titles, bodies, service names) passed through `esc()` before `innerHTML` insertion |
| Content-Type sanitization | Proxy validates upstream Content-Type against an allowlist; unknown types are rewritten to `text/plain` |
| Poll deduplication | KV-based distributed lock (90s TTL) prevents concurrent upstream polls from multiple SSE connections |
| CORS | All API responses return `Access-Control-Allow-Origin: *` intentionally (public status data) |
| DDoS / rate limiting | Cloudflare's network-level protection; add a Rate Limiting rule in the CF dashboard for additional control |

---

## File structure

```
index.html                  — Single-file SPA (UI, board mode, network diagnostics)
functions/
  proxy.js                  — Cloudflare Pages Function (route-table proxy + special routes)
  api/
    poll.js                 — Server-side status polling + parsing orchestrator
    sse.js                  — SSE streaming endpoint (reads from KV, pushes to clients)
    _parsers.js             — Individual service parsers (Adobe, AWS, MBTA, etc.)
    _cfparser.js            — Cloudflare-specific parser (complex NA data center logic)
routes.json                 — Static and special route-key definitions (source of truth)
_routes.json                — Cloudflare Pages function routing hints
scripts/build.js            — Syncs route keys from routes.json into index.html
```
