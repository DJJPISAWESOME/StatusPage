export const RETENTION_MS = 30 * 86400000;
export function nextInterval(previous, result, ttl, now) {
  const reason = result.error ? 'source_error' : result.note ? 'feed_only' : result.status === 'unknown' ? 'unknown' : 'observed';
  const expiry = previous ? previous.last_seen_ms + previous.ttl_ms : now;
  return { reason, gap: previous && expiry < now ? { start: expiry, end: now } : null,
    extend: !!previous && expiry >= now && previous.status === result.status && previous.reason === reason };
}
export class History {
  constructor(sql) {
    this.sql = sql;
    sql.exec('CREATE TABLE IF NOT EXISTS intervals (id INTEGER PRIMARY KEY, service_id TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER, last_seen_ms INTEGER NOT NULL, ttl_ms INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS history_service ON intervals(service_id,start_ms)');
    sql.exec('CREATE INDEX IF NOT EXISTS history_end ON intervals(end_ms)');
  }
  record(result, ttl, now = Date.now()) {
    const previous = [...this.sql.exec('SELECT * FROM intervals WHERE service_id=? AND end_ms IS NULL ORDER BY id DESC LIMIT 1', result.id)][0];
    const next = nextInterval(previous, result, ttl, now);
    if (next.extend) { this.sql.exec('UPDATE intervals SET last_seen_ms=?,ttl_ms=? WHERE id=?', now, ttl, previous.id); return; }
    if (previous) this.sql.exec('UPDATE intervals SET end_ms=? WHERE id=?', Math.min(now, previous.last_seen_ms + previous.ttl_ms), previous.id);
    if (next.gap) this.sql.exec('INSERT INTO intervals(service_id,start_ms,end_ms,last_seen_ms,ttl_ms,status,reason) VALUES(?,?,?,?,?,?,?)', result.id, next.gap.start, now, now, 0, 'unknown', 'monitoring_gap');
    this.sql.exec('INSERT INTO intervals(service_id,start_ms,last_seen_ms,ttl_ms,status,reason) VALUES(?,?,?,?,?,?)', result.id, now, now, ttl, result.status, next.reason);
  }
  prune(now = Date.now()) { this.sql.exec('DELETE FROM intervals WHERE end_ms IS NOT NULL AND end_ms < ?', now - RETENTION_MS); }
  query({service = '', days = 7, status = '', before = 0} = {}, now = Date.now()) {
    const since = now - days * 86400000;
    const clauses = ['start_ms<=?', 'COALESCE(end_ms,last_seen_ms+ttl_ms)>?']; const args = [now, since];
    if (service) { clauses.push('service_id=?'); args.push(service); }
    // Coverage always includes all states, independently of the visible state filter.
    const effective = 'MIN(COALESCE(end_ms,last_seen_ms+ttl_ms),?)';
    const totals = [...this.sql.exec(`SELECT service_id,status,SUM(MAX(0,${effective}-MAX(start_ms,?))) AS duration_ms FROM intervals WHERE ${clauses.join(' AND ')} GROUP BY service_id,status`, now, since, ...args)];
    if (status) { clauses.push('status=?'); args.push(status); }
    if (before) { clauses.push('id<?'); args.push(before); }
    const found = [...this.sql.exec(`SELECT * FROM intervals WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT 101`, ...args)];
    const rows = found.slice(0,100).map(r => ({...r, effectiveEndMs: Math.min(now, r.end_ms ?? r.last_seen_ms + r.ttl_ms), ongoing: r.end_ms === null && r.last_seen_ms + r.ttl_ms >= now}));
    return {rows, nextCursor: found.length > 100 ? rows.at(-1).id : null, totals, since, until: now, retentionDays: 30};
  }
}
