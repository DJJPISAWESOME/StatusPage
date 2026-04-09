// Cloudflare parser — extracted due to complexity
import { PRI, LABELS, ACTIVE_STATUSES, normalizeIndicator, hasRerouteSignal, componentStatusToIndicator, eventTimeValue, latestUpdateBody, mostRecentEvent, mk, errSvc, stripHtml, getJson, cloudflareStatusLabel, cloudflareIncidentStatusLabel, fmtIataName, IATA_CITY } from './poll.js';

export async function parseCloudflare(s) {
  const sum = await getJson(s.su);
  const [sd, id, cd, md] = [sum, sum, sum, sum];
  let ind = 'none';
  const updated = sd?.page?.updated_at ? new Date(sd.page.updated_at).toISOString() : new Date().toISOString();

  const targetGroups = ['north america', 'cloudflare sites and services'];
  const components = cd?.components || [];
  const targetGroupIds = new Set(
    components.filter(c => c.group && targetGroups.includes(String(c.name || '').toLowerCase().trim())).map(c => c.id)
  );
  const northAmericaGroupId = components.find(c => c.group && String(c.name || '').toLowerCase().trim() === 'north america')?.id;
  const watched = components.filter(c => targetGroupIds.has(c.id) || targetGroupIds.has(c.group_id));
  const watchedIds = new Set(watched.map(c => c.id));
  const activeMaintenance = (md?.scheduled_maintenances || []).filter(x => {
    if (!['in_progress', 'verifying', 'monitoring'].includes((x.status || '').toLowerCase())) return false;
    if (!x.components?.length) return true;
    return x.components.some(c => watchedIds.has(c.id));
  });
  const hasActiveMaintenanceForComponent = (componentId) =>
    activeMaintenance.some(x => !x.components?.length || x.components.some(c => c.id === componentId));

  const northAmericaSubGroupIds = new Set(
    northAmericaGroupId ? components.filter(c => c.group && c.group_id === northAmericaGroupId).map(c => c.id) : []
  );
  const isNAChild = c => !!northAmericaGroupId && (c?.group_id === northAmericaGroupId || northAmericaSubGroupIds.has(c?.group_id));

  const compById = Object.fromEntries(components.map(c => [c.id, c]));
  const isNonNAOnlyIncident = evt => {
    if (!evt.components?.length) return false;
    const resolved = evt.components.map(c => compById[c.id]).filter(Boolean);
    if (!resolved.length) return false;
    return resolved.every(c => !isNAChild(c));
  };

  const active = (id?.incidents || []).filter(x => {
    if (!ACTIVE_STATUSES.includes((x.status || '').toLowerCase())) return false;
    if (!x.components?.length) return true;
    return x.components.some(c => watchedIds.has(c.id));
  });
  const componentIdsWithRealIncidents = new Set();
  active.forEach(evt => {
    if (!hasRerouteSignal(evt.name, evt.impact, evt.status, evt.description, latestUpdateBody(evt)) && !isNonNAOnlyIncident(evt)) {
      (evt.components || []).forEach(c => componentIdsWithRealIncidents.add(c.id));
    }
  });

  const cloudflareComponentIndicator = (component) => {
    const base = componentStatusToIndicator(component?.status);
    if (base === 'none' || base === 'unknown') return base;
    if (base === 'maintenance') {
      if (!hasActiveMaintenanceForComponent(component?.id)) return 'none';
      return 'maintenance';
    }
    if (componentIdsWithRealIncidents.has(component?.id)) return base;
    if (isNAChild(component) || hasRerouteSignal(component?.name, component?.description)) return 'rerouting';
    return base;
  };
  const affectedNorthAmerica = watched
    .filter(c => isNAChild(c) && cloudflareComponentIndicator(c) !== 'none')
    .sort((a, b) => ((PRI[cloudflareComponentIndicator(a)] || 9) - (PRI[cloudflareComponentIndicator(b)] || 9)) || a.name.localeCompare(b.name));

  if (watched.length) {
    const worst = watched.reduce((max, c) => {
      const ci = cloudflareComponentIndicator(c);
      return (PRI[ci] || 9) < (PRI[max] || 9) ? ci : max;
    }, 'none');
    ind = worst;
  } else {
    ind = normalizeIndicator(sd?.status?.indicator || 'none');
  }
  const hasReroutingComponents = watched.some(c => cloudflareComponentIndicator(c) === 'rerouting');

  let title = '', body = '', labelOverride = '';
  let hasRerouteNotice = false;
  const extraStatuses = [];
  let hasPriorityIncident = false;
  if (active.length) {
    const sortedActive = [...active].sort((a, b) => eventTimeValue(b) - eventTimeValue(a));
    const a = sortedActive[0];
    if (ind === 'none') { const impact = normalizeIndicator(a.impact || 'none'); if (impact !== 'none') ind = impact; }
    if (!hasRerouteSignal(a.name, a.impact, a.status, a.description, latestUpdateBody(a)) && !isNonNAOnlyIncident(a)) {
      labelOverride = cloudflareIncidentStatusLabel(a.status) || labelOverride;
    }
    const incidentSummaries = sortedActive.map(evt => {
      let desc = latestUpdateBody(evt); if (!desc) desc = stripHtml(evt.description || '');
      const isReroute = hasRerouteSignal(evt.name, evt.impact, evt.status, evt.description, desc) || isNonNAOnlyIncident(evt);
      return { name: evt.name || 'Service Disruption', desc, isReroute };
    });
    hasPriorityIncident = incidentSummaries.some((s, i) => {
      if (s.isReroute) return false;
      const evt = sortedActive[i];
      const impact = normalizeIndicator(evt.impact || 'none');
      const statusText = `${evt.name || ''} ${evt.status || ''} ${evt.impact || ''} ${s.desc}`.toLowerCase();
      return impact === 'major' || impact === 'minor' || /\binvestigating\b|\bdegraded\b|\bdown\b|\boutage\b/.test(statusText);
    });
    if (incidentSummaries.some(s => s.isReroute)) {
      hasRerouteNotice = true;
      if (ind === 'minor' && !hasPriorityIncident) ind = 'none';
    }
    const realSummaries = incidentSummaries.filter(s => !s.isReroute);
    if (realSummaries.length) {
      title = realSummaries[0].name;
      body = realSummaries[0].desc;
      if (realSummaries.length > 1) {
        const rest = realSummaries.slice(1).map(s => `• ${s.name}${s.desc ? ` — ${s.desc}` : ''}`).join('\n');
        body = `${body ? `${body}\n\n` : ''}Additional active incidents:\n${rest}`;
      }
    }
  }

  const fmtDc = n => {
    const codeM = /\(([A-Z]{3,4})\)/.exec(n);
    const code = codeM ? codeM[1] : '';
    const city = n.replace(/,?\s*[\w\s]+-\s*\([A-Z]{3,4}\)/, '').replace(/,\s*(United States|Canada|Mexico)$/i, '').trim();
    return code ? `${code} · ${city}` : (city || n);
  };

  const dcCodeMap = {};
  watched.filter(c => isNAChild(c)).forEach(c => {
    const m = /\(([A-Z]{3,4})\)/.exec(c.name);
    if (m) dcCodeMap[m[1]] = fmtDc(c.name);
  });
  const fmtMaintName = n => {
    const leadM = /^([A-Z]{3,4})\b/.exec(n);
    if (leadM) {
      if (dcCodeMap[leadM[1]]) return dcCodeMap[leadM[1]];
      const city = IATA_CITY[leadM[1]];
      if (city) return `${leadM[1]} · ${city}`;
    }
    return fmtDc(n) || n;
  };

  const stripMaintDate = n => n
    .replace(/\s*[-|]?\s*\bon\b\s+\d{4}-\d{2}-\d{2}.*$/i, '')
    .replace(/\s*[-|]\s*\d{4}-\d{2}-\d{2}.*$/, '')
    .replace(/\s*[-|,]\s*$/, '').trim();

  let detailsMaintenance = [];
  if (activeMaintenance.length) {
    extraStatuses.push('Maintenance');
    const maintSummaries = [...activeMaintenance].sort((a, b) => eventTimeValue(b) - eventTimeValue(a)).map(evt => {
      const desc = latestUpdateBody(evt) || stripHtml(evt.body || 'Cloudflare is performing ongoing maintenance.');
      const rawName = evt.name || 'Ongoing maintenance';
      const stripped = stripMaintDate(rawName) || rawName;
      return { name: fmtMaintName(stripped) || stripped, desc };
    });
    if (!hasPriorityIncident && ind !== 'major' && ind !== 'minor') ind = 'maintenance';
    if (!title) {
      title = maintSummaries.length === 1 ? maintSummaries[0].name : `Scheduled Maintenance at ${maintSummaries.length} Data Centers in North America`;
    }
    if (!body) body = maintSummaries[0].desc;
    detailsMaintenance = maintSummaries;
  }

  let detailsDcs = [];
  if (affectedNorthAmerica.length) {
    if (ind === 'minor' && affectedNorthAmerica.every(c => cloudflareComponentIndicator(c) === 'minor') && hasRerouteSignal(title, body)) {
      hasRerouteNotice = true;
      ind = 'none';
    }
    const n = affectedNorthAmerica.length;
    const numWord = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const nLabel = n <= 10 ? numWord[n] : String(n);
    if (!title) {
      title = `Traffic re-routed at ${nLabel} Data Center${n === 1 ? '' : 's'} in North America`;
    }
    detailsDcs = affectedNorthAmerica.map(c => ({ name: fmtDc(c.name), ind: cloudflareComponentIndicator(c), status: c.status }));
  } else if (watched.length && ind !== 'none' && !title) {
    const topIssue = watched.filter(c => cloudflareComponentIndicator(c) !== 'none')
      .sort((a, b) => ((PRI[cloudflareComponentIndicator(a)] || 9) - (PRI[cloudflareComponentIndicator(b)] || 9)) || a.name.localeCompare(b.name))[0];
    if (topIssue) {
      title = `${topIssue.name} is ${LABELS[cloudflareComponentIndicator(topIssue)] || 'impacted'}`;
      body = 'Monitoring Cloudflare Sites and Services + North America categories only.';
      labelOverride = cloudflareStatusLabel(topIssue.status);
    }
  }
  if (ind === 'rerouting' && !hasPriorityIncident) { hasRerouteNotice = true; ind = 'none'; }
  if (!hasPriorityIncident && !hasRerouteNotice && hasReroutingComponents && ind === 'minor') { hasRerouteNotice = true; }
  if (!labelOverride && watched.length) {
    const top = watched.filter(c => componentStatusToIndicator(c.status) !== 'none')
      .sort((a, b) => ((PRI[componentStatusToIndicator(a.status)] || 9) - (PRI[componentStatusToIndicator(b.status)] || 9)) || a.name.localeCompare(b.name))[0];
    if (top) labelOverride = cloudflareStatusLabel(top.status);
  }
  if (hasRerouteNotice && !hasPriorityIncident) {
    if (activeMaintenance.length) { ind = 'maintenance'; }
    else { ind = 'rerouting'; labelOverride = 'Operational'; }
    extraStatuses.push('Re-routed');
  }
  const statusLabels = [...new Set(extraStatuses.filter(Boolean))];
  const cfDetails = (detailsMaintenance.length || detailsDcs.length) ? { type: 'cloudflare', maintenance: detailsMaintenance, dataCenters: detailsDcs } : null;
  return mk(s.name, ind, title, body, updated, s.hu, labelOverride, statusLabels, cfDetails);
}
