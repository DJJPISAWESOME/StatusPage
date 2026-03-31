// Server-side polling + parsing for all status services.
// Replaces client-side fetchOne() — runs in Cloudflare Workers environment.

const UA = 'Mozilla/5.0 (compatible; StatusMonitor/1.0)';
const FETCH_TIMEOUT = 15000;

// ── Service definitions (mirrors SVCS in index.html, minus Quad9) ──
const SVCS = [
  {name:'i-Ready',su:'https://i-ready.status.io/',hu:'https://i-ready.status.io/',p:'statusio',cat:'app'},
  {name:'HMH',su:'https://status.hmhco.com/api/v2/summary.json',hu:'https://status.hmhco.com',cat:'app'},
  {name:'Follett',su:'https://status.follettsoftware.com/rest/systemstatus',hu:'https://status.follettsoftware.com',p:'follett',cat:'app'},
  {name:'IncidentIQ',su:'https://status.incidentiq.com/api/v2/summary.json',hu:'https://status.incidentiq.com',p:'iiq',cat:'app'},
  {name:'Clever',su:'https://status.clever.com/api/v2/summary.json',hu:'https://status.clever.com',cat:'app'},
  {name:'Seesaw',su:'https://status.seesaw.me/api/v2/summary.json',hu:'https://status.seesaw.me',cat:'app'},
  {name:'Jamf',su:'https://status.jamf.com/api/v2/summary.json',hu:'https://status.jamf.com',cat:'app'},
  {name:'Duo',su:'https://status.duo.com/api/v2/summary.json',hu:'https://status.duo.com',p:'duo',cat:'app'},
  {name:'Imagine Learning',su:'https://status.imaginelearning.com/api/v2/summary.json',hu:'https://status.imaginelearning.com',cat:'app'},
  {name:'FinalSite',su:'https://status.finalsite.com/api/v2/summary.json',hu:'https://status.finalsite.com',cat:'app'},
  {name:'Dexcom',su:'https://status.dexcom.com/api/v2/summary.json',hu:'https://status.dexcom.com',cat:'app'},
  {name:'Adobe CC',su:'https://data.status.adobe.com/adobestatus/SnowServiceRegistry',iu:'https://data.status.adobe.com/adobestatus/StatusEvents',hu:'https://status.adobe.com/cloud/creative_cloud',p:'adobe',cat:'app'},
  {name:'Google Workspace',su:'https://www.google.com/appsstatus/dashboard/incidents.json',hu:'https://workspace.google.com/dashboard/',p:'gworkspace',cat:'app'},
  {name:'Apple Services',su:'https://www.apple.com/support/systemstatus/data/system_status_en_US.js',hu:'https://www.apple.com/support/systemstatus/',p:'apple',cat:'app'},
  {name:'Apple Developer',su:'https://developer.apple.com/system-status/data/system_status_en_US.js',hu:'https://developer.apple.com/system-status/',p:'appledeveloper',cat:'app'},
  {name:'OpenAI',su:'https://status.openai.com/api/v2/summary.json',hu:'https://status.openai.com',cat:'app'},
  {name:'Cloudflare',su:'https://www.cloudflarestatus.com/api/v2/summary.json',hu:'https://www.cloudflarestatus.com',p:'cloudflare',cat:'infra'},
  {name:'Tailscale',su:'https://status.tailscale.com/api/v2/summary.json',hu:'https://status.tailscale.com',cat:'infra'},
  {name:'DNSFilter',su:'https://status.dnsfilter.com/api/v2/summary.json',hu:'https://status.dnsfilter.com',cat:'infra'},
  {name:'Meraki',su:'https://status.meraki.net/api/v2/summary.json',hu:'https://status.meraki.net',cat:'infra'},
  {name:'AWS',su:'https://status.aws.amazon.com/rss/all.rss',hu:'https://health.aws.amazon.com/health/status',p:'aws',cat:'infra'},
  {name:'Azure',su:'https://azure.status.microsoft/en-us/status/feed/',hu:'https://azure.status.microsoft/en-us/status',p:'azure',cat:'infra'},
  {name:'Google Cloud',su:'https://status.cloud.google.com/incidents.json',hu:'https://status.cloud.google.com',p:'gcloud',cat:'infra'},
  {name:'Oracle Cloud',su:'https://ocistatus.oraclecloud.com/api/v2/status.json',cu:'https://ocistatus.oraclecloud.com/api/v2/components.json',hu:'https://ocistatus.oraclecloud.com',p:'oci',cat:'infra'},
  {name:'IBM Cloud',su:'https://cloud.ibm.com/status/api/notifications/feed.rss',hu:'https://cloud.ibm.com/status',p:'ibm',cat:'infra'},
  {name:'Akamai',su:'https://www.akamaistatus.com/api/v2/summary.json',hu:'https://www.akamaistatus.com',cat:'infra'},
  {name:'Fastly',su:'https://www.fastlystatus.com/rss/',hu:'https://www.fastlystatus.com',p:'fastly',cat:'infra'},
  {name:'Bunny.net',su:'https://status.bunny.net/api/v2/summary.json',hu:'https://status.bunny.net',cat:'infra'},
  {name:'CacheFly',su:'https://www.cacheflystatus.com/api/v2/summary.json',hu:'https://www.cacheflystatus.com',p:'cachefly',cat:'infra'},
  {name:'Mimecast',su:'https://api.status.io/1.0/status/5d849b1c02e65b3ec45369d4',hu:'https://status.mimecast.com',p:'mimecast',cat:'app'},
  {name:'Wasabi',su:'https://status.wasabi.com/api/v2/summary.json',hu:'https://status.wasabi.com',p:'wasabi',cat:'infra'},
  {name:'MBTA Providence/Stoughton',su:'https://api-v3.mbta.com/alerts?filter[route]=CR-Providence&filter[activity]=BOARD,EXIT,RIDE',hu:'https://www.mbta.com/schedules/CR-Providence/line',p:'mbta',cat:'transit'},
  {name:'MBTA Fall River / New Bedford',su:'https://api-v3.mbta.com/alerts?filter[route]=CR-NewBedford,CR-FallRiver&filter[activity]=BOARD,EXIT,RIDE',hu:'https://www.mbta.com/schedules/CR-NewBedford/timetable',p:'mbta',cat:'transit'},
];

// ── Status config (priority for worst-indicator logic) ──
const PRI = { none:5, minor:2, major:1, maintenance:3, rerouting:3, unknown:4 };
const LABELS = { none:'Operational', minor:'Degraded', major:'Outage', maintenance:'Maintenance', rerouting:'Traffic Rerouted', unknown:'Unknown' };
const ACTIVE_STATUSES = ['investigating','identified','monitoring'];

// ── Helpers ──
function stripHtml(txt) { return String(txt||'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim(); }

function normalizeIndicator(ind) {
  const val = String(ind||'none').toLowerCase().trim();
  if (['none','operational','ok','up'].includes(val)) return 'none';
  if (['rerouting','rerouted','re-routed','re routed','traffic_rerouted','traffic shifted'].includes(val)) return 'rerouting';
  if (['minor','degraded','warning','partial_outage','partial outage'].includes(val)) return 'minor';
  if (['maintenance','under_maintenance','scheduled','scheduled_maintenance'].includes(val)) return 'maintenance';
  if (['major','critical','down','outage'].includes(val)) return 'major';
  return 'major';
}

function hasRerouteSignal(...parts) {
  const text = parts.map(p => String(p||'').toLowerCase()).join(' ');
  return /(re-?rout|rerout|traffic\s+(?:is\s+)?(?:re-?routed|shifted|redirected)|route\s+shift|partially\s+re-?routed)/.test(text);
}

function componentStatusToIndicator(status) {
  const val = String(status||'').toLowerCase().trim();
  if (val === 'operational') return 'none';
  if (['degraded_performance','partial_outage'].includes(val)) return 'minor';
  if (val === 'major_outage') return 'major';
  if (val === 'under_maintenance') return 'maintenance';
  return 'unknown';
}

function worstIndicator(components) {
  return components.reduce((worst, c) => {
    const ci = normalizeIndicator(c.status);
    return (PRI[ci]||9) < (PRI[worst]||9) ? ci : worst;
  }, 'none');
}

function eventTimeValue(item) {
  const candidates = [item?.updated_at, item?.created_at, item?.display_at, item?.started_at, item?.start, item?.start_time, item?.timestamp, item?.time, item?.date];
  for (const value of candidates) {
    if (value == null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function latestUpdateBody(event) {
  const updates = [...(Array.isArray(event?.incident_updates) ? event.incident_updates : []), ...(Array.isArray(event?.updates) ? event.updates : [])];
  if (!updates.length) return '';
  updates.sort((a, b) => eventTimeValue(a) - eventTimeValue(b));
  const latest = updates[updates.length - 1] || {};
  return stripHtml(latest.body || latest.text || latest.description || latest.summary || '');
}

function latestUpdateRawText(event) {
  const updates = [...(Array.isArray(event?.incident_updates) ? event.incident_updates : []), ...(Array.isArray(event?.updates) ? event.updates : [])];
  if (!updates.length) return '';
  updates.sort((a, b) => eventTimeValue(a) - eventTimeValue(b));
  const latest = updates[updates.length - 1] || {};
  return String(latest.text || latest.body || latest.description || latest.summary || '').trim();
}

function mostRecentEvent(events) {
  if (!Array.isArray(events) || !events.length) return null;
  return [...events].sort((a, b) => eventTimeValue(b) - eventTimeValue(a))[0] || events[0];
}

function mk(name, ind, title, body, updated, url, labelOverride, labels = [], details = null) {
  return { name, ind, label: labelOverride || LABELS[ind] || 'Unknown', title, body, updated, url, labels: Array.isArray(labels) ? labels : [], fetchedAt: Date.now(), details };
}

function errSvc(s) {
  return { name: s.name, ind: 'unknown', label: 'Stale / Unknown', title: 'Cannot reach status API', body: 'We are currently unable to reach the status API. Check the status page manually.', updated: '—', url: s.hu, fetchedAt: Date.now() };
}

function fmtTs(v) { try { return v ? new Date(v).toISOString() : new Date().toISOString(); } catch { return new Date().toISOString(); } }
function nowTs() { return new Date().toISOString(); }

// ── Fetching helpers ──
async function fetchWithTimeout(url, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'application/json, application/xml, text/html, text/plain, */*' } }); }
  finally { clearTimeout(timer); }
}

async function getJson(url) { const r = await fetchWithTimeout(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function getText(url) { const r = await fetchWithTimeout(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }

// ── XML/RSS regex parsing (Workers have no DOMParser) ──
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = stripHtml((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(block) || [])[1] || '');
    const desc = stripHtml((/<description\b[^>]*>([\s\S]*?)<\/description>/i.exec(block) || [])[1] || '');
    const pubDate = ((/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block) || [])[1] || '').trim();
    const guid = ((/<guid\b[^>]*>([\s\S]*?)<\/guid>/i.exec(block) || [])[1] || '').trim();
    items.push({ title, description: desc, pubDate, guid });
  }
  return items;
}

// ── Google Workspace markdown formatter ──
function formatGoogleWorkspaceMarkdown(raw) {
  const text = String(raw || '').trim();
  if (!text) return { summary: '', body: '' };
  const normalized = text.replace(/\r\n?/g, '\n');
  const summaryMatch = normalized.match(/(?:\*\*Summary\*\*|##\s*Summary)\s*([\s\S]*?)(?=\n(?:\*\*Description\*\*|##\s*Description)|$)/i);
  const descriptionMatch = normalized.match(/(?:\*\*Description\*\*|##\s*Description)\s*([\s\S]*)$/i);
  const summary = (summaryMatch?.[1] || '').trim();
  const description = (descriptionMatch?.[1] || '').trim();
  const fallback = normalized.replace(/^#\s+.*$/gm, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/^##\s+/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { summary: summary || fallback.split('\n')[0] || '', body: (description || fallback).replace(/\*\*(.*?)\*\*/g, '$1').replace(/^##\s+/gm, '').replace(/\n{3,}/g, '\n\n').trim() };
}

// ── Adobe helpers ──
function adobeSeverityToIndicator(sev, impact) {
  const value = String(sev || impact || '').toLowerCase().trim();
  if (!value || value === 'none' || value === 'na' || value === 'n/a') return 'none';
  if (/maint|scheduled/.test(value)) return 'maintenance';
  if (/major|critical|sev1|sev2|outage|down/.test(value)) return 'major';
  if (/minor|degrad|partial|sev3|sev4|performance/.test(value)) return 'minor';
  return 'minor';
}
function isOpenAdobeStatus(status) {
  const s = String(status || '').toLowerCase().trim();
  return !!s && !['closed','resolved','complete','completed','cancelled','canceled'].includes(s);
}

// ── AWS helpers ──
function normalizeRegionText(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function isAwsNorthAmericaEvent(event) {
  const region = normalizeRegionText(event?.region_name);
  const text = normalizeRegionText(`${event?.service_name || ''} ${event?.summary || ''} ${event?.description || ''}`);
  const directRx = [/north america/, /united states/, /u s /, /us gov/, /canada/, /mexico/];
  const awsRx = [/us east/, /us west/, /us central/, /us gov/, /ca central/];
  if (directRx.some(rx => rx.test(region)) || awsRx.some(rx => rx.test(region))) return true;
  return directRx.some(rx => rx.test(text)) || awsRx.some(rx => rx.test(text));
}
const AWS_RSS_ACTIVE_WINDOW_MS = 1000 * 60 * 60 * 72;
function awsRssItemToIndicator(item) {
  const text = `${item?.title || ''} ${item?.description || ''}`.toLowerCase();
  if (/resolved|complete(?:ly)? recovered|recovered|restored|no longer impacted|fully operational/.test(text)) return 'none';
  if (/service disruption|outage|critical|unavailable|severe/.test(text)) return 'major';
  return 'minor';
}
function isAwsRssItemFresh(pubDateText) {
  const published = Date.parse(pubDateText || '');
  if (!Number.isFinite(published)) return true;
  return (Date.now() - published) <= AWS_RSS_ACTIVE_WINDOW_MS;
}

// ── Cloudflare helpers ──
function cloudflareStatusLabel(status) {
  const val = String(status || '').toLowerCase().trim();
  if (val === 'operational') return 'Operational';
  if (val === 'under_maintenance') return 'Maintenance';
  if (val === 'degraded_performance') return 'Partially Re-routed';
  if (val === 'partial_outage') return 'Partially Re-routed';
  if (val === 'major_outage') return 'Re-routed';
  return 'Unknown';
}
function cloudflareIncidentStatusLabel(status) {
  const val = String(status || '').toLowerCase().trim();
  if (val === 'investigating') return 'Investigating';
  if (val === 'identified') return 'Identified';
  if (val === 'monitoring') return 'Monitoring';
  return '';
}

// ── IATA city lookup ──
const IATA_CITY = {
  ABQ:'Albuquerque, NM',ANC:'Anchorage, AK',ATL:'Atlanta, GA',AUS:'Austin, TX',BNA:'Nashville, TN',BOS:'Boston, MA',BUF:'Buffalo, NY',BWI:'Baltimore, MD',CLT:'Charlotte, NC',CMH:'Columbus, OH',CVG:'Cincinnati, OH',DAL:'Dallas, TX',DCA:'Washington, DC',DEN:'Denver, CO',DFW:'Dallas, TX',DSM:'Des Moines, IA',DTW:'Detroit, MI',EWR:'Newark, NJ',FLL:'Fort Lauderdale, FL',HNL:'Honolulu, HI',HOU:'Houston, TX',IAD:'Ashburn, VA',IAH:'Houston, TX',IND:'Indianapolis, IN',JAX:'Jacksonville, FL',JFK:'New York, NY',KCI:'Kansas City, MO',LAS:'Las Vegas, NV',LAX:'Los Angeles, CA',LGA:'New York, NY',LGB:'Long Beach, CA',LIT:'Little Rock, AR',MCO:'Orlando, FL',MDW:'Chicago, IL',MEM:'Memphis, TN',MEX:'Mexico City',MIA:'Miami, FL',MKE:'Milwaukee, WI',MSP:'Minneapolis, MN',MSY:'New Orleans, LA',NYC:'New York, NY',OAK:'Oakland, CA',OGG:'Maui, HI',OKC:'Oklahoma City, OK',OMA:'Omaha, NE',ONT:'Ontario, CA',ORD:'Chicago, IL',ORF:'Norfolk, VA',PAO:'Palo Alto, CA',PBI:'West Palm Beach, FL',PDX:'Portland, OR',PHL:'Philadelphia, PA',PHX:'Phoenix, AZ',PIT:'Pittsburgh, PA',RDU:'Raleigh, NC',RIC:'Richmond, VA',RSW:'Fort Myers, FL',SAN:'San Diego, CA',SAT:'San Antonio, TX',SEA:'Seattle, WA',SFO:'San Francisco, CA',SJC:'San Jose, CA',SLC:'Salt Lake City, UT',SMF:'Sacramento, CA',SNA:'Santa Ana, CA',SRQ:'Sarasota, FL',STL:'St. Louis, MO',TPA:'Tampa, FL',TUL:'Tulsa, OK',TUS:'Tucson, AZ',YVR:'Vancouver, BC',YYZ:'Toronto, ON',
};
function fmtIataName(n) {
  if (!n) return n;
  const leadM = /^([A-Z]{3,4})\b/i.exec(n.trim());
  if (!leadM) return n;
  const code = leadM[1].toUpperCase();
  const city = IATA_CITY[code];
  return city ? `${code} · ${city}` : code;
}

// Export helpers for parser modules
export { SVCS, PRI, LABELS, ACTIVE_STATUSES, stripHtml, normalizeIndicator, hasRerouteSignal, componentStatusToIndicator, worstIndicator, eventTimeValue, latestUpdateBody, latestUpdateRawText, mostRecentEvent, mk, errSvc, nowTs, getJson, getText, parseRssItems, formatGoogleWorkspaceMarkdown, adobeSeverityToIndicator, isOpenAdobeStatus, normalizeRegionText, isAwsNorthAmericaEvent, awsRssItemToIndicator, isAwsRssItemFresh, cloudflareStatusLabel, cloudflareIncidentStatusLabel, fmtIataName, IATA_CITY };

// ── Parser dispatch ──
import { parseAdobe, parseFollett, parseStatusio, parseDuo, parseAws, parseGcloud, parseGworkspace, parseAzure, parseMbta, parseOci, parseIbm, parseApple, parseAppleDeveloper, parseFastly, parseIiq, parseMimecast, parseWasabi, parseCachefly, parseStatuspage } from './_parsers.js';
import { parseCloudflare } from './_cfparser.js';

const PARSER_MAP = {
  adobe: parseAdobe,
  follett: parseFollett,
  statusio: parseStatusio,
  duo: parseDuo,
  aws: parseAws,
  gcloud: parseGcloud,
  gworkspace: parseGworkspace,
  azure: parseAzure,
  mbta: parseMbta,
  cloudflare: parseCloudflare,
  oci: parseOci,
  ibm: parseIbm,
  apple: parseApple,
  appledeveloper: parseAppleDeveloper,
  fastly: parseFastly,
  iiq: parseIiq,
  mimecast: parseMimecast,
  wasabi: parseWasabi,
  cachefly: parseCachefly,
};

async function fetchOne(s) {
  try {
    const parser = PARSER_MAP[s.p];
    if (parser) return await parser(s);
    return await parseStatuspage(s);
  } catch {
    return errSvc(s);
  }
}

// ── Main entry: poll all services, store in KV ──
export async function pollAllServices(env) {
  const results = await Promise.allSettled(
    SVCS.map(s => fetchOne(s))
  );
  const normalized = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : errSvc(SVCS[i])
  );
  const payload = { ts: Date.now(), results: normalized };
  if (env?.STATUS_KV) {
    await env.STATUS_KV.put('all-statuses', JSON.stringify(payload));
  }
  return payload;
}

// ── HTTP handler for manual trigger: GET /api/poll ──
export async function onRequestGet(context) {
  try {
    const payload = await pollAllServices(context.env);
    return new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
