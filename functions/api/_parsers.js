// Individual parser functions — imported by poll.js
// Each parser takes a service definition (s) and returns a normalized result object.

import { PRI, LABELS, stripHtml, normalizeIndicator, hasRerouteSignal, componentStatusToIndicator, worstIndicator, eventTimeValue, latestUpdateBody, latestUpdateRawText, mostRecentEvent, mk, errSvc, nowTs, getJson, getText, parseRssItems, formatGoogleWorkspaceMarkdown, adobeSeverityToIndicator, isOpenAdobeStatus, normalizeRegionText, isAwsNorthAmericaEvent, awsRssItemToIndicator, isAwsRssItemFresh, cloudflareStatusLabel, cloudflareIncidentStatusLabel, fmtIataName, IATA_CITY, ACTIVE_STATUSES } from './poll.js';

// ── Adobe CC ──
export async function parseAdobe(s) {
  const [registry, events] = await Promise.all([getJson(s.su), getJson(s.iu)]);
  const ccEntry = Object.values(registry?.clouds || {}).find(c => String(c?.name || '').toLowerCase() === 'creative cloud');
  const ccId = ccEntry?.id;
  if (!ccId) return mk(s.name, 'major', 'Adobe source format changed', 'Could not locate Creative Cloud in Adobe status registry.', nowTs(), s.hu);
  const active = [];
  const collectActive = (collection, kind) => {
    Object.values(collection || {}).forEach(item => {
      if (!item?.clouds || !(ccId in item.clouds)) return;
      const hist = item.history || {};
      const keys = Object.keys(hist).sort((a, b) => Number(a) - Number(b));
      const last = keys.length ? hist[keys[keys.length - 1]] : null;
      const status = last?.status || item.status;
      if (status && !isOpenAdobeStatus(status)) return;
      if (!status && !last) return;
      const ind = kind === 'maintenance' ? 'maintenance' : adobeSeverityToIndicator(last?.severity || item.severity, last?.customerImpact || item.customerImpact);
      const title = item.headline || item.name || last?.shortDescription || last?.description || '';
      const body = stripHtml(last?.description || last?.message || '');
      const updatedEpoch = Number(keys[keys.length - 1] || item.startedOn || 0);
      active.push({ ind, title, body, updatedEpoch });
    });
  };
  collectActive(events?.incidentEvent?.incidents, 'incident');
  collectActive(events?.maintenanceEvent?.maintenance, 'maintenance');
  if (!active.length) return mk(s.name, 'none', '', '', nowTs(), s.hu);
  active.sort((a, b) => (PRI[a.ind] || 9) - (PRI[b.ind] || 9));
  const top = active[0];
  return mk(s.name, top.ind, top.title || (top.ind === 'maintenance' ? 'Scheduled maintenance' : 'Active incident'), top.body, top.updatedEpoch ? new Date(top.updatedEpoch * 1000).toISOString() : nowTs(), s.hu);
}

// ── Follett ──
export async function parseFollett(s) {
  const d = await getJson(s.su);
  let ind = 'none';
  if (d.generalStatus === 'issues') ind = 'minor';
  else if (d.generalStatus === 'maintenance') ind = 'maintenance';
  else if (d.generalStatus && d.generalStatus !== 'ok') ind = 'major';
  const msg = stripHtml(d.systemMessage || '');
  return mk(s.name, ind, msg ? 'Follett Announcement' : '', msg, nowTs(), s.hu);
}

// ── Status.io (i-Ready) ──
export async function parseStatusio(s) {
  const h = await getText(s.su);
  let ind = 'none';
  const statusBarMatch = h.match(/id=["']statusbar_text["'][^>]*>([^<]+)/i);
  const statusBarText = (statusBarMatch?.[1] || '').toLowerCase();
  if (statusBarText) {
    if (/all systems operational|operational/.test(statusBarText)) ind = 'none';
    else if (/maintenance/.test(statusBarText)) ind = 'maintenance';
    else if (/degraded|partial/.test(statusBarText)) ind = 'minor';
    else if (/outage|critical|down/.test(statusBarText)) ind = 'major';
  }
  return mk(s.name, ind, '', '', nowTs(), s.hu);
}

// ── Duo ──
export async function parseDuo(s) {
  const compMap = { operational: 'none', degraded_performance: 'minor', partial_outage: 'minor', major_outage: 'major', under_maintenance: 'maintenance' };
  const sum = await getJson(s.su);
  const updated = sum?.page?.updated_at ? new Date(sum.page.updated_at).toISOString() : nowTs();
  const watched = (sum?.components || []).filter(c => /duo support|duo72/i.test(c.name || ''));
  let ind = 'none';
  if (watched.length) {
    for (const c of watched) { const ci = compMap[c.status] || 'none'; if ((PRI[ci] || 9) < (PRI[ind] || 9)) ind = ci; }
  }
  const watchedIds = new Set(watched.map(c => c.id));
  const active = (sum?.incidents || []).filter(x => {
    if (!ACTIVE_STATUSES.includes((x.status || '').toLowerCase())) return false;
    if (!x.components?.length) return true;
    return x.components.some(c => watchedIds.has(c.id));
  });
  let title = '', body = '';
  if (active.length) {
    const sortedActive = [...active].sort((a, b) => eventTimeValue(b) - eventTimeValue(a));
    const a = sortedActive[0];
    if (ind === 'none') { const impact = normalizeIndicator(a.impact || 'none'); if (impact !== 'none') ind = impact; }
    title = a.name || '';
    let desc = latestUpdateBody(a); if (!desc) desc = stripHtml(a.description || '');
    body = desc;
  }
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── AWS (RSS) ──
export async function parseAws(s) {
  const rss = await getText(s.su);
  const items = parseRssItems(rss)
    .filter(item => isAwsNorthAmericaEvent({ region_name: '', service_name: item.title, summary: item.description, description: item.description }))
    .filter(item => isAwsRssItemFresh(item.pubDate));
  if (!items.length) return mk(s.name, 'none', '', '', nowTs(), s.hu);
  const latest = items[0];
  const ind = awsRssItemToIndicator(latest);
  if (ind === 'none') return mk(s.name, 'none', '', '', nowTs(), s.hu);
  const title = latest.title || 'AWS Service Issue';
  const body = latest.description || '';
  const updated = latest.pubDate ? new Date(latest.pubDate).toISOString() : nowTs();
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── Google Cloud ──
export async function parseGcloud(s) {
  const incidents = await getJson(s.su);
  const active = (incidents || []).filter(x => !x.end);
  if (!active.length) return mk(s.name, 'none', '', '', nowTs(), s.hu);
  const top = mostRecentEvent(active) || active[0];
  const sev = top.severity || 'low';
  const ind = /high|critical/.test(sev.toLowerCase()) ? 'major' : 'minor';
  const latestText = latestUpdateRawText(top) || top.external_desc || '';
  const formatted = formatGoogleWorkspaceMarkdown(latestText);
  const title = formatted.summary || top.service_name || 'Google Cloud Incident';
  const body = formatted.body || stripHtml(top.external_desc || '');
  return mk(s.name, ind, title, body, nowTs(), s.hu);
}

// ── Google Workspace ──
export async function parseGworkspace(s) {
  const incidents = await getJson(s.su);
  const active = (incidents || []).filter(x => !x.end);
  if (!active.length) return mk(s.name, 'none', '', '', nowTs(), s.hu);
  const hasHigh = active.some(x => /high/i.test(x.severity || '') || /outage/i.test(x.status_impact || ''));
  const ind = hasHigh ? 'major' : 'minor';
  const top = mostRecentEvent(active) || active[0];
  const latestText = latestUpdateRawText(top) || top.external_desc || '';
  const formatted = formatGoogleWorkspaceMarkdown(latestText);
  const title = formatted.summary || 'Service Disruption';
  const affectedNames = active.map(x => x.service_name || '').filter(Boolean).join(', ');
  const affectedLine = affectedNames ? `Affected: ${affectedNames}` : '';
  const body = [formatted.body, affectedLine].filter(Boolean).join('\n\n');
  return mk(s.name, ind, title, body, nowTs(), s.hu);
}

// ── Azure (RSS) ──
export async function parseAzure(s) {
  const xml = await getText(s.su);
  const items = parseRssItems(xml);
  const updated = nowTs();
  if (!items.length) return mk(s.name, 'none', '', '', updated, s.hu);
  const hasCritical = items.some(i => /critical|outage|unavailable/i.test(i.title + ' ' + i.description));
  const ind = hasCritical ? 'major' : 'minor';
  const title = items[0].title || 'Azure Service Issue';
  const body = items.length > 1 ? `${items.length} active issues` : '';
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── MBTA ──
export async function parseMbta(s) {
  const data = await getJson(s.su);
  const now = Date.now();
  const EFFECT_LABEL = { SUSPENSION:'Service Suspended',SHUTTLE:'Bus Shuttle in Effect',NO_SERVICE:'No Service',SIGNIFICANT_DELAYS:'Significant Delays',DELAY:'Delays',DETOUR:'Detour',STOP_CLOSURE:'Stop Closure',SERVICE_CHANGE:'Service Change',TRACK_CHANGE:'Track Change',EXTRA_SERVICE:'Extra Service',SCHEDULE_CHANGE:'Schedule Change',MODIFIED_SERVICE:'Modified Schedule',CANCELLATION:'Cancellation',SPECIAL_EVENT:'Special Event Schedule' };
  const EFFECT_IND = { SUSPENSION:'major',SHUTTLE:'major',NO_SERVICE:'major',SIGNIFICANT_DELAYS:'minor',DELAY:'minor',DETOUR:'minor',STOP_CLOSURE:'minor',SERVICE_CHANGE:'minor',TRACK_CHANGE:'minor' };
  const SCHED_EFFECTS = new Set(['SCHEDULE_CHANGE','MODIFIED_SERVICE','EXTRA_SERVICE','SPECIAL_EVENT','CANCELLATION']);
  const CAUSE_LABEL = { CONSTRUCTION:'Construction',MAINTENANCE:'Maintenance',SPECIAL_EVENT:'Special Event',ACCIDENT:'Accident',WEATHER:'Weather',TRAFFIC:'Traffic',TECHNICAL_PROBLEM:'Technical Problem',STRIKE:'Strike',DEMONSTRATION:'Demonstration',MEDICAL_EMERGENCY:'Medical Emergency',POLICE_ACTIVITY:'Police Activity',POWER_PROBLEM:'Power Problem',SIGNAL_PROBLEM:'Signal Problem',SWITCH_PROBLEM:'Switch Problem',TRACK_PROBLEM:'Track Problem',VEHICLE_EQUIPMENT_PROBLEM:'Equipment Problem' };
  const isActiveOrUpcoming = (a, upcomingWindowMs = 0) => {
    const periods = a.attributes?.active_period || [];
    if (!periods.length) return true;
    return periods.some(p => { const start = p.start ? Date.parse(p.start) : 0; const end = p.end ? Date.parse(p.end) : Infinity; return start <= (now + upcomingWindowMs) && now <= end; });
  };
  const serviceAlerts = (data?.data || []).filter(a => {
    const lc = (a.attributes?.lifecycle || '').toUpperCase();
    if (lc !== 'NEW' && lc !== 'ONGOING') return false;
    const sev = a.attributes?.severity || 0;
    const eff = a.attributes?.effect || '';
    return sev >= 3 && EFFECT_IND[eff] != null && isActiveOrUpcoming(a);
  }).sort((a, b) => (b.attributes?.severity || 0) - (a.attributes?.severity || 0));
  const schedAlerts = (data?.data || []).filter(a => {
    const lc = (a.attributes?.lifecycle || '').toUpperCase();
    if (lc !== 'NEW' && lc !== 'ONGOING' && lc !== 'UPCOMING') return false;
    return SCHED_EFFECTS.has(a.attributes?.effect || '') && isActiveOrUpcoming(a, 4 * 3600 * 1000);
  }).sort((a, b) => (b.attributes?.severity || 0) - (a.attributes?.severity || 0));
  if (!serviceAlerts.length && !schedAlerts.length) return mk(s.name, 'none', '', '', nowTs(), s.hu);
  const routeNamesFor = (alert) => {
    const ids = (alert.relationships?.routes?.data || []).map(r => r.id);
    return ids.map(id => { if (id.includes('Providence')) return 'Providence/Stoughton'; if (id.includes('NewBedford')) return 'New Bedford'; if (id.includes('FallRiver')) return 'Fall River'; return id.replace('CR-', '').replace(/-/g, ' '); });
  };
  const mkAlertItem = (a, isSchedChange = false) => {
    const aAttr = a.attributes || {};
    const aEff = aAttr.effect || '';
    const aInd = isSchedChange ? 'maintenance' : (EFFECT_IND[aEff] || 'minor');
    const aLbl = EFFECT_LABEL[aEff] || aEff.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const aCause = aAttr.cause ? CAUSE_LABEL[aAttr.cause] || null : null;
    const aHdr = aAttr.short_header || aAttr.header || '';
    const aTitle = aHdr || (aLbl + (aCause ? ' (' + aCause + ')' : ''));
    return { title: aTitle, effectLabel: aLbl, ind: aInd, routes: routeNamesFor(a), timeframe: aAttr.timeframe || null, cause: aCause };
  };
  if (!serviceAlerts.length) {
    const attrS = schedAlerts[0].attributes || {};
    const effS = attrS.effect || '';
    const lblS = EFFECT_LABEL[effS] || effS.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const titleS = schedAlerts.length === 1 ? lblS : `${schedAlerts.length} Schedule Changes`;
    const updatedS = new Date(attrS.updated_at || now).toISOString();
    const schedDetails = schedAlerts.map(a => mkAlertItem(a, true));
    return mk(s.name, 'maintenance', titleS, '', updatedS, s.hu, lblS, [], { type: 'mbta', alerts: [], schedChanges: schedDetails });
  }
  const top = serviceAlerts[0];
  const attr = top.attributes || {};
  const eff = attr.effect || '';
  const ind = EFFECT_IND[eff] || 'minor';
  const effectLabel = EFFECT_LABEL[eff] || eff.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const cause = attr.cause ? CAUSE_LABEL[attr.cause] || null : null;
  const detailAlerts = serviceAlerts.map(a => mkAlertItem(a, false));
  const detailSchedChanges = schedAlerts.map(a => mkAlertItem(a, true));
  const mbtaDetails = { type: 'mbta', alerts: detailAlerts, schedChanges: detailSchedChanges };
  const n = serviceAlerts.length;
  const causeStr = (cause && cause !== 'Unknown') ? ' — ' + cause : '';
  const title = n === 1 ? (effectLabel + causeStr) : (`${n} Service Alerts`);
  const updated = new Date(attr.updated_at || now).toISOString();
  return mk(s.name, ind, title, '', updated, s.hu, effectLabel, [], mbtaDetails);
}

// ── OCI ──
export async function parseOci(s) {
  const [st, comp] = await Promise.all([getJson(s.su), getJson(s.cu).catch(() => null)]);
  let ind = normalizeIndicator(st?.status?.indicator || 'none');
  const updated = st?.page?.updated_at ? new Date(st.page.updated_at).toISOString() : nowTs();
  let title = '', body = '';
  if (comp) {
    const naRegions = (comp.regionHealthReports || []).filter(r => r.geographicAreaName === 'NAM');
    const affected = [];
    for (const region of naRegions)
      for (const svc of (region.serviceHealthReports || []))
        if (svc.serviceStatus !== 'NormalPerformance' && (svc.incidents || []).length)
          affected.push(svc.serviceName + ' (' + region.regionCanonicalName + ')');
    if (affected.length) {
      if (ind === 'none') ind = 'minor';
      title = affected.length + ' North America service' + (affected.length > 1 ? 's' : '') + ' affected';
      body = affected.slice(0, 3).join('; ');
    }
  }
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── IBM (RSS) ──
export async function parseIbm(s) {
  const text = await getText(s.su);
  const items = parseRssItems(text);
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = items.filter(it => { const pd = it.pubDate; return pd ? new Date(pd).getTime() > cutoff : true; });
  const active = recent.filter(it => /incident|outage|degraded|disruption/i.test(it.title || ''));
  const ind = active.length ? 'minor' : 'none';
  const title = active.length ? (active[0].title || '') : '';
  const body = active.length ? stripHtml(active[0].description || '').slice(0, 200) : '';
  const updated = items[0]?.pubDate ? new Date(items[0].pubDate).toISOString() : nowTs();
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── Apple Services ──
export async function parseApple(s) {
  const data = JSON.parse(await getText(s.su));
  const active = (data.services || []).filter(sv => (sv.events || []).some(ev => ev.eventStatus && ev.eventStatus !== 'resolved'));
  const ind = active.length ? 'minor' : 'none';
  const title = active.length ? active.length + ' service' + (active.length > 1 ? 's' : '') + ' affected' : '';
  const body = active.slice(0, 3).map(sv => sv.serviceName).join(', ');
  return mk(s.name, ind, title, body, nowTs(), s.hu);
}

// ── Apple Developer ──
export async function parseAppleDeveloper(s) {
  const raw = await getText(s.su);
  const jsonStr = /^\s*\w+\s*\(/.test(raw) ? raw.replace(/^\s*\w+\s*\(/, '').replace(/\)\s*;?\s*$/, '') : raw;
  const data = JSON.parse(jsonStr);
  const active = (data.services || []).filter(sv => sv.statusType ? sv.statusType !== '' : (sv.events || []).some(ev => ev.eventStatus && ev.eventStatus !== 'resolved'));
  const isOutage = active.some(sv => sv.statusType === 'Outage' || (sv.events || []).some(ev => /outage/i.test(ev.eventStatus || '')));
  const ind = active.length ? (isOutage ? 'major' : 'minor') : 'none';
  const title = active.length ? active.length + ' service' + (active.length > 1 ? 's' : '') + ' affected' : '';
  const body = active.slice(0, 3).map(sv => sv.serviceName).join(', ');
  return mk(s.name, ind, title, body, nowTs(), s.hu);
}

// ── Fastly (RSS) ──
export async function parseFastly(s) {
  const xml = await getText(s.su);
  const items = parseRssItems(xml);
  const now = Date.now();
  const NA_RE = /north.?america|united.?states|\bU\.?S\.?([-\s]|$)|canada|\bNA\b|us[-\s]east|us[-\s]west|us[-\s]central|american/i;
  const NON_NA_RE = /\b(europe|eu[-\s]|emea|asia|apac|pacific|australia|oceania|africa|middle.?east|latin.?america|south.?america|brasil|brazil|india|japan|korea|china|hong.?kong|singapore|uk\b|united.?kingdom)\b/i;
  const relevant = items.filter(item => {
    if (!item.pubDate) return false;
    const t = Date.parse(item.pubDate);
    return (now - t) < 7 * 24 * 3600000 && (t - now) < 30 * 24 * 3600000;
  }).filter(item => !/\b(resolv|complet|restor|postmortem|ended)\b/i.test(item.title))
    .filter(item => {
      const text = (item.title || '') + ' ' + (item.description || '');
      if (!NA_RE.test(text)) return false;
      if (NON_NA_RE.test(text)) return false;
      return true;
    });
  if (!relevant.length) return mk(s.name, 'none', '', '', nowTs(), s.hu);
  const latest = relevant[0];
  const title = latest.title || '';
  const body = stripHtml(latest.description || '').slice(0, 400);
  const tl = title.toLowerCase();
  let ind;
  if (/unavailable|outage|down\b/i.test(tl)) ind = 'major';
  else if (/degrad|investigat|identif|monitoring/i.test(tl)) ind = 'minor';
  else if (/re.?rout/i.test(tl)) ind = 'rerouting';
  else ind = 'maintenance';
  return mk(s.name, ind, title, body, nowTs(), s.hu);
}

// ── IIQ ──
export async function parseIiq(s) {
  const sum = await getJson(s.su);
  const updated = sum?.page?.updated_at ? new Date(sum.page.updated_at).toISOString() : nowTs();
  const comps = sum?.components || [];
  const uiGroupId = comps.find(c => c.group && /user integrations?/i.test(c.name || ''))?.id;
  const uiChildIds = new Set(uiGroupId ? comps.filter(c => c.group_id === uiGroupId).map(c => c.id) : []);
  const isOnlyUI = inc => { const affected = (inc.components || []).map(c => c.id); return affected.length > 0 && affected.every(id => uiChildIds.has(id)); };
  const active = (sum?.incidents || []).filter(x => ACTIVE_STATUSES.includes((x.status || '').toLowerCase()) && !isOnlyUI(x));
  const activeMaint = (sum?.scheduled_maintenances || []).filter(x => ['in_progress', 'verifying'].includes((x.status || '').toLowerCase()) && !isOnlyUI(x));
  let ind = normalizeIndicator(sum?.status?.indicator || 'none');
  let title = '', body = '';
  if (active.length) {
    const a = mostRecentEvent(active) || active[0];
    if (ind === 'none') { const imp = normalizeIndicator(a.impact || 'none'); if (imp !== 'none') ind = imp; }
    title = a.name || '';
    let desc = latestUpdateBody(a); if (!desc) desc = stripHtml(a.description || '');
    body = desc;
  } else if (activeMaint.length) {
    const a = activeMaint[0];
    ind = 'maintenance';
    title = a.name || '';
    let desc = latestUpdateBody(a); if (!desc) desc = stripHtml(a.description || '');
    body = desc;
  } else { ind = 'none'; }
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── Mimecast (Status.io) ──
export async function parseMimecast(s) {
  const data = await getJson(s.su);
  const res = data?.result || {};
  const updated = res.status_overall?.updated ? new Date(res.status_overall.updated).toISOString() : nowTs();
  function statusIoInd(code) { const c = Number(code); if (c === 100) return 'none'; if (c === 200 || c === 300) return 'minor'; if (c === 400 || c === 500 || c === 600) return 'major'; return 'unknown'; }
  const regions = (res.status || []);
  const usRegion = regions.find(r => /\bus\b|united states/i.test(r.name || ''));
  const overallCode = usRegion?.status_code ?? res.status_overall?.status_code ?? 100;
  let ind = statusIoInd(overallCode);
  const incidents = (res.incidents || []).filter(x => !['resolved', 'postmortem'].includes((x.status || '').toLowerCase()));
  const activeMaint = (res.maintenance?.active || []);
  let title = '', body = '';
  if (incidents.length) {
    if (incidents.length === 1) { const inc = incidents[0]; title = inc.name || inc.incidents_name || ''; const msgs = inc.messages || inc.incident_updates || []; body = msgs.length ? stripHtml(msgs[0].details || msgs[0].body || '') : ''; }
    else { title = `${incidents.length} Active Incidents`; body = incidents.map(i => i.name || i.incidents_name || '').filter(Boolean).join(' · '); }
    if (ind === 'none') ind = 'minor';
  } else if (activeMaint.length) {
    const m = activeMaint[0]; title = m.name || m.maintenance_name || ''; const msgs = m.messages || m.maintenance_updates || []; body = msgs.length ? stripHtml(msgs[0].details || msgs[0].body || '') : ''; ind = 'maintenance';
  }
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── Wasabi ──
export async function parseWasabi(s) {
  const sum = await getJson(s.su);
  const updated = sum?.page?.updated_at ? new Date(sum.page.updated_at).toISOString() : nowTs();
  const comps = sum?.components || [];
  const usGroupIds = new Set(comps.filter(c => c.group && /\bus\b|united states/i.test(c.name || '')).map(c => c.id));
  const usComps = comps.filter(c => usGroupIds.has(c.group_id) || /\bus-/i.test(c.name || '') || (c.group && /\bus\b/i.test(c.name || '')));
  const watched = usComps.length ? usComps : comps;
  const watchedIds = new Set(watched.map(c => c.id));
  const active = (sum?.incidents || []).filter(x => {
    if (!ACTIVE_STATUSES.includes((x.status || '').toLowerCase())) return false;
    const affected = (x.components || []).map(c => c.id);
    return !affected.length || affected.some(id => watchedIds.has(id));
  });
  let ind = 'none';
  const worstComp = worstIndicator(watched);
  if (worstComp !== 'none') ind = worstComp;
  let title = '', body = '';
  if (active.length) {
    const a = mostRecentEvent(active) || active[0];
    if (ind === 'none') { const imp = normalizeIndicator(a.impact || 'none'); if (imp !== 'none') ind = imp; }
    title = a.name || ''; let desc = latestUpdateBody(a); if (!desc) desc = stripHtml(a.description || ''); body = desc;
  } else if ((sum?.scheduled_maintenances || []).some(x => ['in_progress', 'verifying'].includes((x.status || '').toLowerCase()))) {
    const m = (sum.scheduled_maintenances || []).find(x => ['in_progress', 'verifying'].includes((x.status || '').toLowerCase()));
    ind = 'maintenance'; title = m.name || ''; body = latestUpdateBody(m) || stripHtml(m.description || '');
  }
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── CacheFly ──
export async function parseCachefly(s) {
  const sum = await getJson(s.su);
  const updated = sum?.page?.updated_at ? new Date(sum.page.updated_at).toISOString() : nowTs();
  const comps = sum?.components || [];
  const naGroupIds = new Set(comps.filter(c => c.group && /north.?america/i.test(c.name || '')).map(c => c.id));
  const naComps = comps.filter(c => naGroupIds.has(c.group_id) || /north.?america/i.test(c.name || '') || /^(ATL|BOS|DFW|LAX|MIA|NYC|EWR|ORD|SEA|SJC|SFO|YYZ|YVR|MEX|IAD|PHX|DEN|LAS|MSP)\d/i.test(c.name || ''));
  const watched = naComps.length ? naComps : comps;
  const watchedIds = new Set(watched.map(c => c.id));
  const worstComp = worstIndicator(watched);
  let ind = worstComp;
  const active = (sum?.incidents || []).filter(x => {
    if (!ACTIVE_STATUSES.includes((x.status || '').toLowerCase())) return false;
    const affected = (x.components || []).map(c => c.id);
    return !affected.length || affected.some(id => watchedIds.has(id));
  });
  let title = '', body = '';
  if (active.length) {
    const a = mostRecentEvent(active) || active[0];
    if (ind === 'none') { const imp = normalizeIndicator(a.impact || 'none'); if (imp !== 'none') ind = imp; }
    title = a.name || ''; let desc = latestUpdateBody(a); if (!desc) desc = stripHtml(a.description || ''); body = desc;
  } else {
    const activeMaint = (sum?.scheduled_maintenances || []).filter(x => {
      if (!['in_progress', 'verifying'].includes((x.status || '').toLowerCase())) return false;
      const affected = (x.components || []).map(c => c.id);
      return !affected.length || affected.some(id => watchedIds.has(id));
    });
    if (activeMaint.length) {
      const m = activeMaint[0]; ind = 'maintenance';
      title = fmtIataName(m.name || '') || m.name || '';
      body = latestUpdateBody(m) || stripHtml(m.description || '');
    }
  }
  return mk(s.name, ind, title, body, updated, s.hu);
}

// ── Default Statuspage v2 (Atlassian) ──
export async function parseStatuspage(s) {
  const sum = await getJson(s.su);
  let ind = normalizeIndicator(sum?.status?.indicator || 'none');
  const updated = sum?.page?.updated_at ? new Date(sum.page.updated_at).toISOString() : nowTs();
  const active = (sum?.incidents || []).filter(x => ACTIVE_STATUSES.includes((x.status || '').toLowerCase()));
  let title = '', body = '';
  if (active.length) {
    const a = mostRecentEvent(active) || active[0];
    if (ind === 'none') { const impact = normalizeIndicator(a.impact || 'none'); if (impact !== 'none') ind = impact; }
    title = a.name || '';
    let desc = latestUpdateBody(a); if (!desc) desc = stripHtml(a.description || '');
    body = desc;
  } else {
    const activeMaint = (sum?.scheduled_maintenances || []).filter(x => ['in_progress', 'verifying'].includes((x.status || '').toLowerCase()));
    if (activeMaint.length) {
      const m = activeMaint[0];
      if (ind !== 'major' && ind !== 'minor') ind = 'maintenance';
      title = m.name || '';
      body = latestUpdateBody(m) || stripHtml(m.description || '');
    }
  }
  return mk(s.name, ind, title, body, updated, s.hu);
}
