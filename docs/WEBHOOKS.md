# Webhook integrations

Webhooks are supported, but they do not automatically exist for every vendor. Subscribe on a provider’s status page where offered. Keep scheduled collection for providers without callbacks. Do not mark a service webhook-driven until subscription and delivery have been verified.

Both ingress modes treat notifications as **invalidation hints**. They fetch the configured authoritative provider endpoint and broadcast the normalized result. Incoming text never sets service health, changes a URL, or executes as HTML.

## Signed mode — recommended for your own systems or a trusted bridge

Endpoint: `POST /api/webhooks/signed/<service-id>`.

Generate a different secret of at least 32 random characters for each service. Store a JSON map as a Cloudflare secret:

```sh
npx wrangler secret put WEBHOOK_SECRETS
```

At the prompt enter a JSON map such as `{"cloudflare":"<random-secret>","openai":"<different-random-secret>"}`. Place no secrets in `wrangler.jsonc` or browser assets. `.dev.vars.example` shows local configuration only.

Required headers:

| Header | Value |
|---|---|
| `X-Signal-Timestamp` | Unix timestamp in seconds, within five minutes |
| `X-Signal-Id` | Unique 8–100 character event ID (`A-Z`, `a-z`, `0-9`, `_`, `-`) |
| `X-Signal-Signature` | `sha256=` followed by lowercase HMAC-SHA256 hex |
| `Content-Type` | `application/json` for conventional senders |

The signed bytes are UTF-8:

```text
<timestamp>.<event-id>.<request-path>.<exact-raw-body>
```

The path is bound into the signature, so a valid Cloudflare event cannot be replayed against OpenAI. Use the exact body bytes; do not reformat JSON after signing. Web Crypto verifies the signature. Request bodies are capped at 64 KiB. Event IDs are persisted in the Durable Object and expire after ten minutes; the signed timestamp becomes invalid after five minutes. Successful duplicates return `202` with `duplicate: true` and do not re-fetch. Retry the same event ID after a failed transport response. An acknowledgement means the hint is durably queued, not that a provider fetch has already completed.

Test an integration:

```sh
# Supply SIGNAL_WEBHOOK_SECRET securely through your shell environment.
npm run webhook -- https://your-worker.workers.dev cloudflare
```

This helper sends an invalidation to the selected service. It does not fabricate an outage. For built-in provider signatures (GitHub, Stripe, etc.), use a trusted translating bridge or implement the provider’s exact authentication adapter; these payloads cannot be pasted into the custom signature contract unchanged.

## Native Statuspage mode

Some hosted status pages offer a webhook subscription but no configurable HMAC header. For those, use an independent random per-service callback token:

```sh
npx wrangler secret put STATUSPAGE_TOKENS
```

Enter a JSON map, for example `{"cloudflare":"<different-random-token>"}`. Subscribe through the provider’s UI using:

```text
https://your-worker.workers.dev/api/webhooks/statuspage/cloudflare?token=<random-token>
```

Complete any provider-required email/subscription confirmation. The endpoint accepts POST only. The application does not follow subscription-management links contained in webhook bodies.

**This is token-protected invalidation, not cryptographically authenticated provider status.** The token grants only permission to request a re-fetch of that one fixed source. Even a compromised token cannot publish a fake incident or select an upstream URL. Repeated hints coalesce into 30-second buckets and are rate limited. Rotating the token requires updating the provider subscription. Avoid sharing callback URLs or logging them; query-string redaction and disabled invocation logs are configured by default. Provider availability and their subscription feature must be checked individually.

## Enable reduced polling after confirming delivery

Set a comma-separated list in `wrangler.jsonc`:

```json
"WEBHOOK_SERVICES": "cloudflare,openai"
```

Only IDs with a corresponding secret of at least 32 characters enter webhook mode. All others keep five-minute polling. A webhook-driven provider gets hourly reconciliation and a five-minute retry after upstream failure. Hourly reconciliation catches missing deliveries; webhooks are not an excuse to assume a service is healthy forever. Configure a shorter reconciliation interval in `src/hub.js` if your missed-event tolerance is lower.

Source IDs are in `src/catalog.js`. No subscription is created automatically and no production secrets are included in the archive.

## Verify in production

1. Confirm `/api/status` lists the correct service and mode.
2. Send a signed test or the provider’s own test notification.
3. Confirm `202`, then confirm that service’s `checkedAt` advances and the browser receives an update.
4. Resend a signed event with the same ID; expect a duplicate acknowledgement.
5. Change a byte in the body; expect `401`. Try a wrong token; expect `401`.
6. Confirm Cron continues to run and freshness does not go stale after restarting the browser.

No email, Slack, SMS or mobile push messages are sent. “Push” means updates to open dashboard WebSockets.

Reference: [Atlassian webhook notifications](https://support.atlassian.com/statuspage/docs/enable-webhook-notifications/).
