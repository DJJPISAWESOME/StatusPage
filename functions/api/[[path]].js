// Keep the existing Pages URL as the public origin while the Worker owns API,
// scheduled collection, and Durable Object state.
export function onRequest({ request, env }) {
  if (!env.STATUS_API) {
    return Response.json({ error: 'Status API binding is unavailable' }, { status: 503 });
  }
  return env.STATUS_API.fetch(request);
}
