import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { upstream } from './security.js';
export const RANK = { outage: 0, degraded: 1, maintenance: 2, unknown: 3, operational: 4 };
export function status(value) {
  return ({ none: 'operational', operational: 'operational', ok: 'operational', minor: 'degraded', degraded: 'degraded', degraded_performance: 'degraded', partial_outage: 'degraded', major: 'outage', critical: 'outage', major_outage: 'outage', downtime: 'outage', maintenance: 'maintenance', under_maintenance: 'maintenance' })[String(value).toLowerCase()] || 'unknown';
}
const text = value => String(value ?? '').replace(/<[^>]*>/g, '').slice(0, 1500);
const array = x => Array.isArray(x) ? x : x ? [x] : [];
const worst = states => states.sort((a, b) => RANK[a] - RANK[b])[0] || 'unknown';
const incident = x => ({ id: String(x.id || ''), componentIds: array(x.components).map(c => String(typeof c === 'string' ? c : c.id)), title: text(x.name || x.title || x.external_desc || x.service_name || 'Service incident'), body: text(x.incident_updates?.[0]?.body || x.most_recent_update?.text || x.description || ''), updatedAt: x.updated_at || x.modified || null });
export function parseProvider(service, raw) {
  let d;
  if (!['rss', 'statusio-html'].includes(service.parser)) {
    const content = service.parser === 'apple' ? raw.replace(/^\s*\w+\s*\(/, '').replace(/\)\s*;?\s*$/, '') : raw;
    d = JSON.parse(content);
  }
  if (service.parser === 'statuspage') {
    if (!d.status || typeof d.status.indicator !== 'string') throw new Error('Statuspage schema changed');
    const active = array(d.incidents).filter(x => ['investigating', 'identified', 'monitoring'].includes(x.status));
    const maintenance = array(d.scheduled_maintenances).filter(x => ['in_progress', 'verifying'].includes(x.status));
    const states = [status(d.status.indicator), ...array(d.components).map(x => status(x.status)), ...active.map(x => status(x.impact))];
    if (maintenance.length) states.push('maintenance');
    return { components: array(d.components).slice(0,1000).map(c => ({id:String(c.id),name:text(c.name),status:status(c.status),group:!!c.group,groupId:c.group_id || null})), status: worst(states), incidents: [...active, ...maintenance].slice(0, 8).map(incident) };
  }
  if (service.parser === 'google') {
    if (!Array.isArray(d)) throw new Error('Google schema changed');
    const active = d.filter(x => !x.end);
    return { status: active.length ? active.some(x => /high|critical|outage/i.test(`${x.severity} ${x.status_impact}`)) ? 'outage' : 'degraded' : 'operational', incidents: active.slice(0, 8).map(incident) };
  }
  if (service.parser === 'apple') {
    if (!Array.isArray(d.services)) throw new Error('Apple schema changed');
    const active = d.services.filter(x => x.statusType || array(x.events).some(e => e.eventStatus && !['resolved', 'completed'].includes(e.eventStatus.toLowerCase())));
    return { status: active.length ? 'degraded' : 'operational', incidents: active.slice(0, 8).map(x => ({ title: text(x.serviceName), body: text(x.events?.[0]?.message || x.statusType), updatedAt: null })) };
  }
  if (service.parser === 'follett') {
    if (!d.generalStatus) throw new Error('Follett schema changed');
    return { status: ({ ok: 'operational', issues: 'degraded', maintenance: 'maintenance' })[d.generalStatus] || 'unknown', incidents: d.systemMessage ? [{ title: 'Provider announcement', body: text(d.systemMessage) }] : [] };
  }
  if (service.parser === 'betterstack') {
    const state = d.data?.attributes?.aggregate_state;
    if (!state) throw new Error('Better Stack schema changed');
    return { status: status(state), incidents: array(d.included).filter(x => x.type === 'status_report' && x.attributes?.aggregate_state !== 'resolved').slice(0, 8).map(x => incident(x.attributes)) };
  }
  if (service.parser === 'statusio') {
    const code = Number(d.result?.status_overall?.status_code);
    if (!code) throw new Error('Status.io schema changed');
    return { status: ({ 100: 'operational', 200: 'maintenance', 300: 'degraded', 400: 'outage', 500: 'outage', 600: 'outage' })[code] || 'unknown', incidents: array(d.result?.incidents).filter(x => !['resolved', 'postmortem'].includes(x.status)).slice(0, 8).map(incident) };
  }
  if (service.parser === 'statusio-html') {
    const label = raw.match(/id=["']statusbar_text["'][^>]*>([^<]+)/i)?.[1]?.trim().toLowerCase();
    if (!label) throw new Error('Status.io HTML changed');
    const state = /^all systems operational$/.test(label) ? 'operational' : /maintenance/.test(label) ? 'maintenance' : /degraded|partial/.test(label) ? 'degraded' : /outage|critical|down/.test(label) ? 'outage' : 'unknown';
    return { status: state, incidents: state === 'operational' ? [] : [{ title: text(label), body: '' }] };
  }
  if (service.parser === 'rss') {
    if (/<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true) throw new Error('Invalid feed');
    const feed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(raw);
    if (feed.rss?.channel === undefined && feed.feed === undefined) throw new Error('Feed schema changed');
    const items = array(feed.rss?.channel?.item || feed.feed?.entry).slice(0, 6);
    // Feeds describe updates, not a complete health snapshot. Never infer uptime from an empty feed.
    return { status: 'unknown', note: 'Update feed only; open the provider page for current health.', incidents: items.map(x => ({ title: text(x.title?.['#text'] || x.title), body: text(x.description || x.summary?.['#text'] || x.summary), updatedAt: x.pubDate || x.updated || null })) };
  }
  throw new Error('Unsupported provider');
}
export async function collectService(service, fetcher = fetch) {
  const checkedAt = new Date().toISOString();
  try {
    if (service.parser === 'adobe') {
      // Documented in the migration: do not impersonate a browser to bypass Adobe's WAF.
      const raw = await upstream('https://data.status.adobe.com/adobestatus/StatusEvents', { fetcher });
      const registry = JSON.parse(await upstream(service.url, { fetcher }));
      const cc = Object.values(registry.clouds || {}).find(x => /creative cloud/i.test(x.name));
      if (!cc?.id) throw new Error('Adobe schema changed');
      const events = JSON.parse(raw);
      if (!events.incidentEvent && !events.maintenanceEvent) throw new Error('Adobe schema changed');
      const active = [];
      for (const [kind, items] of [['degraded', events.incidentEvent?.incidents], ['maintenance', events.maintenanceEvent?.maintenance]]) {
        for (const item of Object.values(items || {})) {
          if (!item.clouds || !(cc.id in item.clouds)) continue;
          const history = Object.entries(item.history || {}).sort((a, b) => Number(b[0]) - Number(a[0]));
          const latest = history[0]?.[1] || item;
          if (/resolved|closed|completed/i.test(latest.status || '')) continue;
          if (!latest.status) throw new Error('Adobe event schema changed');
          active.push({ status: kind, title: text(item.headline || item.name), body: text(latest.description) });
        }
      }
      return { id: service.id, status: active.length ? worst(active.map(x => x.status)) : 'operational', incidents: active.slice(0, 8), checkedAt, lastSuccessAt: checkedAt };
    }
    const raw = await upstream(service.url, { fetcher, accept: service.parser === 'rss' ? 'application/rss+xml, application/atom+xml, application/xml, text/xml' : '*/*' });
    return { id: service.id, ...parseProvider(service, raw), checkedAt, lastSuccessAt: checkedAt };
  } catch (error) {
    return { id: service.id, status: 'unknown', incidents: [], checkedAt, error: error.status === 413 ? 'Provider response exceeds the safe size limit. Open its status page for current details.' : 'Provider unavailable or response format changed', detail: error.status === 413 ? 'response_too_large' : /Timeout|Abort/.test(error.name) ? 'timeout' : /schema|JSON|Unexpected|XML|feed/i.test(error.message) ? 'schema' : 'upstream', httpStatus: Number(error.message.match(/Upstream HTTP (\d{3})/)?.[1]) || null };
  }
}
