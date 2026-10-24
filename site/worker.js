// Cloudflare Worker entry (Workers + static assets): routes /api/* to the secured AI endpoints.
import { onRequestPost as llm } from './functions/api/llm.js';
import { onRequestPost as research } from './functions/api/research.js';
import { onRequestPost as image } from './functions/api/image.js';
import { onRequestGet as health } from './functions/api/health.js';

const json = (code, body, extra = {}) => new Response(JSON.stringify(body), {
  status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
const POST = { '/api/llm': llm, '/api/research': research, '/api/image': image };

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/health') return request.method === 'GET' || request.method === 'HEAD' ? health({ env }) : json(405, { error: 'GET only' }, { Allow: 'GET' });
    if (POST[pathname]) return request.method === 'POST' ? POST[pathname]({ request, env }) : json(405, { error: 'POST only' }, { Allow: 'POST' });
    if (pathname.startsWith('/api/')) return json(404, { error: 'Not found' });
    return env.ASSETS.fetch(request);
  },
};
