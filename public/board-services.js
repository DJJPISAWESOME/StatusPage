import { boardStatus } from './board-status.js';

export function servicePages(services, size, now = Date.now()) {
  const priority = ['outage', 'degraded', 'maintenance', 'operational', 'unknown'];
  const sorted = [...services].sort((a, b) => priority.indexOf(boardStatus(a, now)) - priority.indexOf(boardStatus(b, now)) || a.name.localeCompare(b.name));
  const known = sorted.filter(service => boardStatus(service, now) !== 'unknown');
  const unknown = sorted.filter(service => boardStatus(service, now) === 'unknown');
  const pages = [];
  // Unconfirmed services get their own final page(s), never omitted or crowded.
  for (const group of [known, unknown]) for (let i = 0; i < group.length; i += size) pages.push(group.slice(i, i + size));
  return pages.length ? pages : [[]];
}
export const servicePageDuration = (duration, pages) => duration / (Math.max(1, pages) * 4);
export const serviceSlot = (elapsed, duration, pages) => Math.min(Math.max(1, pages) * 4 - 1, Math.max(0, Math.floor(elapsed / servicePageDuration(duration, pages))));
