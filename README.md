# Service Status Page

Real-time status dashboard monitoring cloud providers, SaaS applications, CDNs, DNS resolvers, and MBTA commuter rail. Includes a full-screen board/TV mode with live radio, weather, and a Network Diagnostics tab with Cloudflare edge info, DNS resolver detection, protocol support, latency probes, speed testing, and internet health monitoring.

---

## Services monitored

| Category | Services |
|----------|----------|
| **Applications** | i-Ready, HMH, Follett, IncidentIQ, Clever, Seesaw, Jamf, Duo, Imagine Learning, FinalSite, Dexcom, Adobe CC, Google Workspace, Apple Services, Apple Developer, OpenAI, Mimecast |
| **Infrastructure** | Cloudflare, Tailscale, Quad9, DNSFilter, Meraki, AWS, Azure, Google Cloud, Oracle Cloud, IBM Cloud, Akamai, Fastly, Bunny.net, CacheFly, Wasabi |
| **Transit** | MBTA Providence/Stoughton Line, MBTA Fall River / New Bedford Line |

Cloudflare and Quad9 show per-PoP status for North America data centers / points of presence. Non-NA incidents (e.g. Jakarta, Lisbon) are filtered out automatically.

---

## Features

- **Service directory** — filterable/searchable list with real-time status polling; active issues promoted to a top panel with masonry card layout
- **Board / TV mode** — full-screen dashboard designed for wall-mounted displays with auto-rotating status banners, weather, clock, and a scrolling service ticker
- **Live radio** — three stations (105.7 WROR, Cape Cod's X, Ocean 104.7) with now-playing metadata, album art via iTunes, and volume ducking during alert banners
- **Weather** — current conditions and alerts from the National Weather Service API, with geolocation via browser or ipapi.co fallback
- **Network diagnostics** — your connection info, Cloudflare edge details, TLS/HTTP/3/IPv6 protocol support, DNS resolver detection, latency probes to Cloudflare/Google/AWS/Azure, path quality analysis, download speed test, IODA BGP anomalies, and Cloudflare Radar traffic anomalies
- **Light/dark theme** — manual toggle or follows OS preference

---

## Architecture

```
Browser
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
- **Single-file SPA** — all UI, parsers, and client logic in `index.html`
- **Route-table proxy** — `functions/proxy.js` only proxies URLs registered in `routes.json`; arbitrary URLs are rejected (no SSRF surface)
- **Special routes** — server-side handlers for endpoints that require non-browser protocols (ICY streaming metadata), API keys (Cloudflare Radar), or custom headers (Adobe WAF bypass)
- **Fallback chain** — when deployed, tries `/proxy?svc=<key>` first; on failure or local dev, fetches service APIs directly from the browser

---

## Deploying to Cloudflare Pages

### Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### Deploy

```bash
wrangler pages deploy .
```

Cloudflare Pages serves `index.html` as a static asset and runs `functions/proxy.js` as a Pages Function for `/proxy` requests.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CF_RADAR_TOKEN` | Optional | Cloudflare API token for Radar traffic anomaly data in the Network tab |

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

In local mode `_IS_DEPLOYED` is `false`; the app skips the `/proxy` function and fetches service APIs directly from the browser (most support CORS). Radar anomaly data requires the deployed proxy with a `CF_RADAR_TOKEN` secret.

---

## Adding a service

1. **Route table** — add an entry in `routes.json` under `static`:
   ```json
   "myservice-summary": "https://status.example.com/api/v2/summary.json"
   ```

2. **Sync routes** — run `node scripts/build.js` to inject the route key into `index.html` (updates `ROUTE_KEYS` and `SPECIAL_KEYS` between the `@routes-start` / `@routes-end` markers).

3. **Service definition** — add an entry to the `SVCS` array in `index.html`:
   ```js
   {name:'My Service', su:'https://status.example.com/api/v2/summary.json',
    hu:'https://status.example.com', cat:'app'},
   ```
   Most Atlassian Statuspage-hosted services work with the default parser. For custom APIs add a `p:'myparser'` key and implement the parser in `fetchOne()`.

---

## Security

| Control | Implementation |
|---------|---------------|
| No-SSRF proxy | Route table in `functions/proxy.js` loaded from `routes.json`; `?svc=<key>` only — raw URLs rejected with 404 |
| Response size limit | Proxy enforces a 5 MB max on upstream responses |
| XSS mitigation | All upstream API text (incident titles, bodies, service names) passed through `esc()` before `innerHTML` insertion |
| CORS | Proxy responses return `Access-Control-Allow-Origin: *` intentionally (public status data) |
| DDoS / rate limiting | Cloudflare's network-level protection; add a Rate Limiting rule in the CF dashboard for additional control |

---

## File structure

```
index.html          — Single-file SPA (UI, parsers, board mode, network diagnostics)
functions/proxy.js  — Cloudflare Pages Function (route-table proxy + special route handlers)
routes.json         — Static and special route-key definitions (source of truth)
_routes.json        — Cloudflare Pages function routing hints
scripts/build.js    — Syncs route keys from routes.json into index.html
```
