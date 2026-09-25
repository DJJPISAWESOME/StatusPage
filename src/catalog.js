// Fixed upstream allowlist. No client-supplied URLs are fetched.
export const SERVICES = [
  {
    "id": "i-ready",
    "name": "i-Ready",
    "category": "applications",
    "url": "https://i-ready.status.io/",
    "homepage": "https://i-ready.status.io/",
    "parser": "statusio-html"
  },
  {
    "id": "hmh",
    "name": "HMH",
    "category": "applications",
    "url": "https://status.hmhco.com/api/v2/summary.json",
    "homepage": "https://status.hmhco.com",
    "parser": "statuspage"
  },
  {
    "id": "follett",
    "name": "Follett",
    "category": "applications",
    "url": "https://status.follettsoftware.com/rest/systemstatus",
    "homepage": "https://status.follettsoftware.com",
    "parser": "follett"
  },
  {
    "id": "incidentiq",
    "name": "IncidentIQ",
    "category": "applications",
    "url": "https://status.incidentiq.com/api/v2/summary.json",
    "homepage": "https://status.incidentiq.com",
    "parser": "statuspage"
  },
  {
    "id": "clever",
    "name": "Clever",
    "category": "applications",
    "url": "https://status.clever.com/api/v2/summary.json",
    "homepage": "https://status.clever.com",
    "parser": "statuspage"
  },
  {
    "id": "seesaw",
    "name": "Seesaw",
    "category": "applications",
    "url": "https://status.seesaw.me/api/v2/summary.json",
    "homepage": "https://status.seesaw.me",
    "parser": "statuspage"
  },
  {
    "id": "jamf",
    "name": "Jamf",
    "category": "applications",
    "url": "https://status.jamf.com/api/v2/summary.json",
    "homepage": "https://status.jamf.com",
    "parser": "statuspage"
  },
  {
    "id": "duo",
    "name": "Duo",
    "category": "applications",
    "url": "https://status.duo.com/api/v2/summary.json",
    "homepage": "https://status.duo.com",
    "parser": "statuspage"
  },
  {
    "id": "imagine-learning",
    "name": "Imagine Learning",
    "category": "applications",
    "url": "https://status.imaginelearning.com/api/v2/summary.json",
    "homepage": "https://status.imaginelearning.com",
    "parser": "statuspage"
  },
  {
    "id": "finalsite",
    "name": "FinalSite",
    "category": "applications",
    "url": "https://status.finalsite.com/api/v2/summary.json",
    "homepage": "https://status.finalsite.com",
    "parser": "statuspage"
  },
  {
    "id": "dexcom",
    "name": "Dexcom",
    "category": "applications",
    "url": "https://status.dexcom.com/api/v2/summary.json",
    "homepage": "https://status.dexcom.com",
    "parser": "statuspage"
  },
  {
    "id": "adobe-cc",
    "name": "Adobe CC",
    "category": "applications",
    "url": "https://data.status.adobe.com/adobestatus/SnowServiceRegistry",
    "homepage": "https://status.adobe.com/cloud/creative_cloud",
    "parser": "adobe"
  },
  {
    "id": "google-workspace",
    "name": "Google Workspace",
    "category": "applications",
    "url": "https://www.google.com/appsstatus/dashboard/incidents.json",
    "homepage": "https://workspace.google.com/dashboard/",
    "parser": "google"
  },
  {
    "id": "apple-services",
    "name": "Apple Services",
    "category": "applications",
    "url": "https://www.apple.com/support/systemstatus/data/system_status_en_US.js",
    "homepage": "https://www.apple.com/support/systemstatus/",
    "parser": "apple"
  },
  {
    "id": "apple-developer",
    "name": "Apple Developer",
    "category": "applications",
    "url": "https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js",
    "homepage": "https://developer.apple.com/system-status/",
    "parser": "apple"
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "category": "applications",
    "url": "https://status.openai.com/api/v2/summary.json",
    "homepage": "https://status.openai.com",
    "parser": "statuspage"
  },
  {
    "id": "cloudflare",
    "name": "Cloudflare",
    "category": "infrastructure",
    "url": "https://www.cloudflarestatus.com/api/v2/summary.json",
    "homepage": "https://www.cloudflarestatus.com",
    "parser": "statuspage"
  },
  {
    "id": "tailscale",
    "name": "Tailscale",
    "category": "infrastructure",
    "url": "https://status.tailscale.com/api/v2/summary.json",
    "homepage": "https://status.tailscale.com",
    "parser": "statuspage"
  },
  {
    "id": "quad9",
    "name": "Quad9",
    "category": "infrastructure",
    "url": "https://uptime.quad9.net/index.json",
    "homepage": "https://uptime.quad9.net/",
    "parser": "betterstack"
  },
  {
    "id": "dnsfilter",
    "name": "DNSFilter",
    "category": "infrastructure",
    "url": "https://status.dnsfilter.com/api/v2/summary.json",
    "homepage": "https://status.dnsfilter.com",
    "parser": "statuspage"
  },
  {
    "id": "meraki",
    "name": "Meraki",
    "category": "infrastructure",
    "url": "https://status.meraki.net/api/v2/summary.json",
    "homepage": "https://status.meraki.net",
    "parser": "statuspage"
  },
  {
    "id": "aws",
    "name": "AWS",
    "category": "infrastructure",
    "url": "https://status.aws.amazon.com/rss/all.rss",
    "homepage": "https://health.aws.amazon.com/health/status",
    "parser": "rss"
  },
  {
    "id": "azure",
    "name": "Azure",
    "category": "infrastructure",
    "url": "https://azure.status.microsoft/en-us/status/feed/",
    "homepage": "https://azure.status.microsoft/en-us/status",
    "parser": "rss"
  },
  {
    "id": "google-cloud",
    "name": "Google Cloud",
    "category": "infrastructure",
    "url": "https://status.cloud.google.com/incidents.json",
    "homepage": "https://status.cloud.google.com",
    "parser": "google"
  },
  {
    "id": "oracle-cloud",
    "name": "Oracle Cloud",
    "category": "infrastructure",
    "url": "https://ocistatus.oraclecloud.com/api/v2/status.json",
    "homepage": "https://ocistatus.oraclecloud.com",
    "parser": "statuspage"
  },
  {
    "id": "ibm-cloud",
    "name": "IBM Cloud",
    "category": "infrastructure",
    "url": "https://cloud.ibm.com/status/api/notifications/feed.rss",
    "homepage": "https://cloud.ibm.com/status",
    "parser": "rss"
  },
  {
    "id": "akamai",
    "name": "Akamai",
    "category": "infrastructure",
    "url": "https://www.akamaistatus.com/api/v2/summary.json",
    "homepage": "https://www.akamaistatus.com",
    "parser": "statuspage"
  },
  {
    "id": "fastly",
    "name": "Fastly",
    "category": "infrastructure",
    "url": "https://www.fastlystatus.com/rss/",
    "homepage": "https://www.fastlystatus.com",
    "parser": "rss"
  },
  {
    "id": "bunny-net",
    "name": "Bunny.net",
    "category": "infrastructure",
    "url": "https://status.bunny.net/api/v2/summary.json",
    "homepage": "https://status.bunny.net",
    "parser": "statuspage"
  },
  {
    "id": "cachefly",
    "name": "CacheFly",
    "category": "infrastructure",
    "url": "https://www.cacheflystatus.com/api/v2/summary.json",
    "homepage": "https://www.cacheflystatus.com",
    "parser": "statuspage"
  },
  {
    "id": "mimecast",
    "name": "Mimecast",
    "category": "applications",
    "url": "https://api.status.io/1.0/status/5d849b1c02e65b3ec45369d4",
    "homepage": "https://status.mimecast.com",
    "parser": "statusio"
  },
  {
    "id": "wasabi",
    "name": "Wasabi",
    "category": "infrastructure",
    "url": "https://status.wasabi.com/api/v2/summary.json",
    "homepage": "https://status.wasabi.com",
    "parser": "statuspage"
  }
];
