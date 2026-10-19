import { collectService } from './providers.js';

// Leave room below the free plan's 50 external subrequests per invocation.
// Adobe needs two fetches; every other current adapter needs one.
const FETCH_BUDGET = 48;
const cost = service => service.parser === 'adobe' ? 2 : 1;
const transient = result => result.error && !(Date.parse(result.retryAfterAt) > Date.now()) && (
  result.detail === 'timeout' ||
  result.detail === 'upstream' && (result.httpStatus === null || [408, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(result.httpStatus))
);

export async function collectServices(services, fetcher = fetch) {
  const results = new Map();
  async function pass(selected, retry = false) {
    let index = 0;
    // Keep response bodies within the six-connection limit, including on retry.
    await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
      while (index < selected.length) {
        const service = selected[index++];
        const result = await collectService(service, fetcher);
        results.set(service.id, { ...result, attempts: retry ? 2 : 1 });
      }
    }));
  }
  await pass(services);
  let remaining = FETCH_BUDGET - services.reduce((sum, service) => sum + cost(service), 0);
  // Reserve every first observation before spending the remaining budget on retries.
  // Schema, size, auth and rate-limit failures wait for the next scheduled check.
  const retry = services.filter(service => {
    if (!transient(results.get(service.id)) || remaining < cost(service)) return false;
    remaining -= cost(service); return true;
  });
  if (retry.length) {
    await new Promise(resolve => setTimeout(resolve, 250));
    await pass(retry, true);
  }
  return services.map(service => results.get(service.id));
}
