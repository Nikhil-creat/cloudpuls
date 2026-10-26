// End-to-end-encrypted cloud sync. The browser encrypts; this endpoint only stores opaque bytes.
//   GET    /api/sync?id=<32 hex>                           -> bytes + X-Sync-Version
//   PUT    /api/sync   X-Sync-Id, X-Sync-Auth, X-Sync-Expected (version | force)   body: bytes (<= 3 MB)
//   DELETE /api/sync   X-Sync-Id, X-Sync-Auth
import { gateLite } from '../_lib/common.js';

const ID = /^[0-9a-f]{32}$/, AUTH = /^[A-Za-z0-9_-]{43}$/, MAX = 3 * 1024 * 1024;
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function onRequest({ request, env }) {
  if (!env.SYNC) return new Response(JSON.stringify({ error: 'Cloud sync is not enabled on this deployment (Durable Objects binding missing)' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
  const m = request.method;
  if (!['GET', 'PUT', 'DELETE'].includes(m)) return new Response(JSON.stringify({ error: 'GET, PUT or DELETE only' }), { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'GET, PUT, DELETE' } });
  const g = await gateLite(request, env, m === 'PUT' ? 3 : 1); if (g.response) return g.response;
  const id = m === 'GET' ? new URL(request.url).searchParams.get('id') : request.headers.get('X-Sync-Id');
  if (!ID.test(id || '')) return g.send(400, { error: 'Invalid workspace id' });
  const stub = env.SYNC.get(env.SYNC.idFromName(id));
  if (m === 'GET') {
    const r = await stub.fetch('https://do/get');
    if (r.status === 404) return g.send(404, { error: 'No cloud copy found for that code' });
    return new Response(r.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Sync-Version': r.headers.get('X-Sync-Version'), 'X-Sync-Updated': r.headers.get('X-Sync-Updated'), 'X-Request-ID': g.rid } });
  }
  const auth = request.headers.get('X-Sync-Auth');
  if (!AUTH.test(auth || '')) return g.send(400, { error: 'Invalid credentials' });
  const headers = { 'X-Auth-Hash': await sha(auth) };
  if (m === 'DELETE') { const r = await stub.fetch('https://do/delete', { method: 'POST', headers }); const b = await r.json(); return g.send(r.status, b); }
  if (Number(request.headers.get('content-length') || 0) > MAX) return g.send(413, { error: 'Payload must be between 1 byte and 3 MB' });
  const expected = request.headers.get('X-Sync-Expected') || '0';
  if (expected !== 'force' && !/^\d{1,9}$/.test(expected)) return g.send(400, { error: 'Invalid expected version' });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length < 1 || body.length > MAX) return g.send(413, { error: 'Payload must be between 1 byte and 3 MB' });
  const r = await stub.fetch('https://do/put', { method: 'POST', headers: { ...headers, 'X-Sync-Expected': expected }, body });
  return g.send(r.status, await r.json());
}
