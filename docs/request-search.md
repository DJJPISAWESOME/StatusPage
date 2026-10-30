# Song-request search

The request portal supports both in-page results and direct YouTube/YouTube Music video links. Search failures do not disable the player, station selector, radio balance, queue, or link-submission path.

## Providers and configuration

With a nonempty Worker secret named `YOUTUBE_API_KEY`, search uses the documented [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list) endpoint. Requests select videos that permit embedding and syndication, return at most eight results, and cache successful responses for ten minutes. Provider caches are separate, so old public-page results cannot mask a newly configured API. Playback availability can still change or depend on region, age, or the viewer.

The key is sent in Google's documented [`X-Goog-Api-Key` header](https://cloud.google.com/apis/docs/system-parameters), never in an outgoing URL, cache key, or response to a browser. Only the Worker needs the secret; Pages forwards API requests through its existing service binding. No key belongs in public assets or source control. Do not enable or modify production credentials as part of a code-only deployment without the owner's approval.

After approval, an administrator can enable YouTube Data API v3 for their Google Cloud project, obtain a server-side API key restricted to that API, and add it as the `YOUTUBE_API_KEY` secret on `signal-status-dashboard` through the normal Cloudflare secret-management flow. See Google's [setup guide](https://developers.google.com/youtube/v3/getting-started). Requests consume that project's search quota; review its actual allowance in Google Cloud. This change does not create a Google project, enable APIs, create a key, change billing, or install a secret.

Without a key, the existing public-page parser remains available. It is not a guaranteed search service: YouTube may reject automated traffic, redirect to a challenge/consent page, or change the page format. The app does not follow challenges, spoof another client, use alternate proxies, or fall back from an authenticated API failure to scraping. A configured API's quota/authentication failure remains a safe error; it does not expose provider details or secrets.

## Recovery for listeners

When search is unavailable or returns no matches, the results area offers **Search on YouTube** with the exact entered query. Open it, copy a single video's URL, and paste the URL into the request box. Existing queue limits still apply. The app does not open an external tab or submit a request automatically. A successful later search replaces the recovery panel.

Direct links still depend on YouTube's metadata/embedding availability. The recovery UI is not a guarantee that every video can be queued or played.

## October 30, 2026 incident evidence

Production searches for ordinary artist names returned HTTP 503 from both Pages and Worker origins. The browser displayed the server's search-unavailable message without a frontend JavaScript error. PRs #173 and #174 did not change the search function or its form handler. A separate test using the same public search URL and application request headers received HTTP 302 to Google's automated-traffic challenge, with no search JSON. That demonstrates the existing public-page path can fail upstream; production's generic error alone does not reveal its exact upstream response or establish a quota issue.

This code adds the official provider option and clear recovery. It does **not** by itself establish that production in-page search is restored: without an approved, working API key it still depends on the public-page path. No production credentials or playback settings were changed during development.

## Validation

Unit tests cover official request filters and secret handling, malformed/empty responses, bounded and deduplicated results, successful caching, uncached failures, invalid queries, quota/authentication/network failures, and rejected redirects. Route tests verify search never touches queue storage. Browser tests cover success, empty/error/malformed responses, retry recovery, safe encoded external links, continued link requests, and working station/balance controls after a failed search. Upstream API tests use synthetic responses; live authenticated verification requires an approved key.
