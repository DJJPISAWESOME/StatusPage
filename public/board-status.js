export function boardStatus(service, now = Date.now()) {
  return service.checkedAt && now - Date.parse(service.checkedAt) > service.staleAfterMs ? 'unknown' : service.status || 'unknown';
}
export function boardChanges(previous, services, now = Date.now()) {
  const next = new Map(services.map(s => [s.id, boardStatus(s, now)]));
  const changes = previous ? services.filter(s => previous.has(s.id) && previous.get(s.id) !== next.get(s.id)).map(s => ({ name:s.name, from:previous.get(s.id), to:next.get(s.id) })) : [];
  return { next, changes };
}
