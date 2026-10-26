// Share links for built apps: POST /api/publish, POST /api/unpublish, POST /api/report, GET /a/:id
import { gate, hit } from '../_lib/common.js';

const ALPHA = 'abcdefghijklmnopqrstuvwxyz234567';
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHA[b % 32]).join('');
const tok = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ID = /^[a-z2-7]{10}$/;
const off = () => new Response(JSON.stringify({ error: 'Sharing is not enabled on this deployment (Durable Objects binding missing)' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
const stubFor = (env, id) => env.APPS.get(env.APPS.idFromName(id));
const DO = (path, body) => ['https://do' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }];

export async function publish({ request, env }) {
  if (!env.APPS) return off();
  const g = await gate(request, env, () => 3); if (g.response) return g.response;
  const html = typeof g.body.html === 'string' ? g.body.html : '';
  const title = typeof g.body.title === 'string' ? g.body.title.replace(/[<>&"]/g, '').slice(0, 80) : 'App';
  if (html.length < 40) return g.send(400, { error: 'Nothing to publish' });
  if (html.length > 150000) return g.send(413, { error: 'App is too large to publish (150 KB max)' });
  if (/type\s*=\s*["']?password/i.test(html) || /autocomplete\s*=\s*["']?(current|new)-password/i.test(html)) return g.send(400, { error: 'Apps with password fields cannot be published' });
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hit(env, `pub:${g.id}:${day}`, 86400, Number(env.PUBLISH_PER_DAY || 10)))) return g.send(429, { error: 'Daily publish limit reached (10 apps per day)' });
  const id = rid(), token = tok(), expires = Date.now() + 30 * 86400000;
  const r = await stubFor(env, id).fetch(...DO('/create', { html, title, created: Date.now(), expires, token }));
  if (!r.ok) return g.send(502, { error: 'Could not store the app. Try again.' });
  return g.send(200, { id, url: `${new URL(request.url).origin}/a/${id}`, deleteToken: token, expires });
}
export async function unpublish({ request, env }) {
  if (!env.APPS) return off();
  const g = await gate(request, env, () => 1); if (g.response) return g.response;
  if (!ID.test(String(g.body.id || ''))) return g.send(400, { error: 'Invalid id' });
  const r = await stubFor(env, g.body.id).fetch(...DO('/delete', { token: g.body.token }));
  return g.send(r.status === 200 ? 200 : r.status === 403 ? 403 : 404, r.status === 200 ? { ok: true } : { error: r.status === 403 ? 'Wrong delete token' : 'Not found' });
}
export async function report({ request, env }) {
  if (!env.APPS) return off();
  const g = await gate(request, env, () => 1); if (g.response) return g.response;
  if (!ID.test(String(g.body.id || ''))) return g.send(400, { error: 'Invalid id' });
  const r = await stubFor(env, g.body.id).fetch(...DO('/report'));
  return g.send(r.ok ? 200 : 404, r.ok ? { ok: true } : { error: 'Not found' });
}
const CSP = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
export async function serveApp({ request, env, id }) {
  const gone = (c = 404) => new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px system-ui;background:#000;color:#fff;display:grid;place-content:center;height:100vh;margin:0"><p>This app is not available. It may have expired or been removed.</p>', { status: c, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
  if (!env.APPS || !ID.test(id)) return gone();
  const r = await stubFor(env, id).fetch(...DO('/get'));
  if (!r.ok) return gone();
  const rec = await r.json(), origin = new URL(request.url).origin;
  const badge = `<div style="position:fixed;right:8px;bottom:8px;z-index:2147483647;font:12px/1.4 system-ui,sans-serif;background:rgba(0,0,0,.78);color:#fff;padding:5px 10px;border-radius:999px"><a style="color:#fff" target="_blank" rel="noopener" href="${origin}/studio.html">Made with CloudPulse Studio</a> · <a style="color:#fff" target="_blank" rel="noopener" href="${origin}/report.html?id=${id}">Report</a></div>`;
  const i = rec.html.toLowerCase().lastIndexOf('</body>');
  const html = i >= 0 ? rec.html.slice(0, i) + badge + rec.html.slice(i) : rec.html + badge;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'public, max-age=30' } });
}
