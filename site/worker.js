// Cloudflare Worker entry (Workers + static assets): routes /api/* to the secured AI endpoints.
import { onRequestPost as llm } from './functions/api/llm.js';
import { onRequestPost as research } from './functions/api/research.js';
import { onRequestPost as image } from './functions/api/image.js';
import { onRequestPost as vision } from './functions/api/vision.js';
import { onRequestGet as health } from './functions/api/health.js';
import { publish, unpublish, report, serveApp } from './functions/api/publish.js';
import { onRequest as sync } from './functions/api/sync.js';
export { AppStore, SyncStore } from './functions/_lib/do.js';

const json = (code, body, extra = {}) => new Response(JSON.stringify(body), {
  status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
const POST = { '/api/llm': llm, '/api/research': research, '/api/image': image, '/api/vision': vision, '/api/publish': publish, '/api/unpublish': unpublish, '/api/report': report };

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/health') return request.method === 'GET' || request.method === 'HEAD' ? health({ env }) : json(405, { error: 'GET only' }, { Allow: 'GET' });
    if (POST[pathname]) return request.method === 'POST' ? POST[pathname]({ request, env }) : json(405, { error: 'POST only' }, { Allow: 'POST' });
    if (pathname === '/api/sync') return sync({ request, env });
    if (pathname.startsWith('/a/')) return request.method === 'GET' || request.method === 'HEAD' ? serveApp({ request, env, id: pathname.slice(3) }) : json(405, { error: 'GET only' }, { Allow: 'GET' });
    if (pathname.startsWith('/api/')) return json(404, { error: 'Not found' });
    return env.ASSETS.fetch(request);
  },
};
