// Local simulator of the Cloudflare deployment: static assets (+ _headers incl. path rules and "!" detach, .assetsignore,
// 404 page) in front of the REAL worker.js, with fake Groq / Gemini / Workers AI upstreams.
//   node loadtest/sim_worker.mjs [siteDir]    (PORT=8788)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const realFetch = globalThis.fetch;
const TINY_JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };

function parseHeaders(file) {
  const rules = []; let cur = null;
  if (!fs.existsSync(file)) return rules;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), set: [], detach: [] }; rules.push(cur); continue; }
    const t = line.trim();
    if (t.startsWith('!')) cur.detach.push(t.slice(1).trim().toLowerCase());
    else { const i = t.indexOf(':'); cur.set.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]); }
  }
  return rules;
}
const matches = (pattern, p) => pattern.endsWith('*') ? p.startsWith(pattern.slice(0, -1)) : pattern === p;
function headersFor(rules, p) {
  const h = new Map();
  for (const r of rules) {
    if (!matches(r.pattern, p)) continue;
    r.detach.forEach((n) => h.delete(n));
    for (const [k, v] of r.set) { const key = k.toLowerCase(); h.set(key, h.has(key) ? `${h.get(key)}, ${v}` : v); }
  }
  return h;
}

function brain(system, user, messages, who = 'groq') {
  const toolResults = messages.filter((m) => typeof m.content === 'string' && m.content.startsWith('<<UNTRUSTED_DATA')).length;
  if (system.startsWith('You are a senior front-end engineer')) {
    const ask = user.slice(0, 80).replace(/[<>&]/g, '');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sim App</title><style>body{background:#0b1020;color:#fff;font-family:sans-serif;padding:24px}</style></head><body><h1 id="h">Sim App: ${ask}</h1><button id="b">Click me</button><p id="out"></p><script>document.getElementById('b').addEventListener('click',function(){document.getElementById('out').textContent='script ran in sandbox'});try{fetch('https://example.com').then(function(){document.getElementById('out').textContent='NETWORK LEAK'}).catch(function(){})}catch(e){}</script></body></html>`;
  }
  if (system.startsWith('You are a project planner')) return JSON.stringify({ title: 'Sim project', tasks: [{ title: 'Define scope', detail: 'Write the goal', priority: 'high', days: 1 }, { title: 'Build prototype', detail: 'Ship v0', priority: 'medium', days: 3 }, { title: 'Collect feedback', detail: 'Talk to five users', priority: 'low', days: 2 }] });
  if (system.startsWith('Summarize the document')) return JSON.stringify({ summary: 'Simulated summary of the document.', tags: ['alpha', 'beta'], key_points: ['Point one', 'Point two'] });
  if (system.startsWith('You are an illustrator')) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" onload="alert(1)"><script>alert(2)</script><a href="https://evil.example"><circle cx="256" cy="256" r="120" fill="#7c3aed"/></a><foreignObject width="10" height="10"></foreignObject></svg>';
  if (system.startsWith('You answer using ONLY the numbered sources')) return 'Based on your notes, the answer is simulated [1]. Another point [2].';
  if (system.startsWith('Rewrite the user')) return 'A vivid, cinematic illustration of ' + user.slice(0, 40) + ', soft rim lighting, wide composition';
  if (system.startsWith('Answer the user helpfully')) return `Simulated answer from ${who} to: ${user.slice(0, 30)}`;
  if (/^(Describe the image|Write ONE alt-text|Transcribe all visible|Extract any tabular)/.test(system)) return `Simulated vision result (${system.split(' ').slice(0, 2).join(' ')}) via ${who}`;
  if (system.startsWith('You are CloudPulse Studio Agent') && /describe the image/i.test(messages.find((m) => m.role === 'user')?.content || '')) {
    return toolResults === 0 ? JSON.stringify({ tool: 'describe_image', args: { task: 'describe' } }) : JSON.stringify({ final: 'I described the image.' });
  }
  if (system.startsWith('You are CloudPulse Studio Agent')) {
    if (toolResults === 0) return JSON.stringify({ tool: 'create_task', args: { title: 'Agent task', priority: 'high' } });
    if (toolResults === 1) return JSON.stringify({ tool: 'add_note', args: { title: 'Agent note', text: 'Written by the agent' } });
    return JSON.stringify({ final: 'I created a task and a note.' });
  }
  return JSON.stringify({ final: 'hello from sim chat' });
}

function sse(kind, text) {
  const parts = text.match(/[\s\S]{1,24}/g) || [''], enc = new TextEncoder(), delay = Number(process.env.SIM_STREAM_DELAY || 0);
  const rs = new ReadableStream({ async start(c) {
    for (const part of parts) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      c.enqueue(enc.encode('data: ' + JSON.stringify(kind === 'groq' ? { choices: [{ delta: { content: part } }] } : { candidates: [{ content: { parts: [{ text: part }] } }] }) + '\n\n'));
    }
    if (kind === 'groq') c.enqueue(enc.encode('data: [DONE]\n\n'));
    c.close();
  } });
  return new Response(rs, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const memStorage = () => { const m = new Map(); return {
  async get(k) { if (Array.isArray(k)) { const o = new Map(); for (const x of k) if (m.has(x)) o.set(x, m.get(x)); return o; } return m.get(k); },
  async put(k, v) { if (v === undefined && k && typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
  async delete(k) { (Array.isArray(k) ? k : [k]).forEach((x) => m.delete(x)); }, async deleteAll() { m.clear(); } }; };
const fakeNamespace = (Cls, env) => { const inst = new Map(); return { idFromName: (n) => n, get: (id) => ({ fetch: (u, init) => { if (!inst.has(id)) inst.set(id, new Cls({ storage: memStorage() }, env)); return inst.get(id).fetch(u instanceof Request ? u : new Request(u, init)); } }) }; };

export async function start({ site, port = 8788, ai = true, noGemini = false, noDo = false, quiet = true } = {}) {
  const SITE = path.resolve(site || path.join(here, '..', 'site'));
  const ignore = new Set(fs.readFileSync(path.join(SITE, '.assetsignore'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
  const rules = parseHeaders(path.join(SITE, '_headers'));
  const calls = { groq: [], gemini: [], ai: [] };

  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url); const J = (code, b) => new Response(JSON.stringify(b), { status: code, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://api.groq.com/')) {
      if (u.endsWith('/models')) return J(200, { data: [{ id: 'whisper-large-v3' }, { id: 'openai/gpt-oss-120b' }] });
      const b = JSON.parse(opt.body); calls.groq.push(b);
      if (globalThis.__SIM_GROQ_DOWN) return J(429, { error: { message: 'rate limited' } });
      const text = brain(b.messages[0].content, b.messages[b.messages.length - 1].content, b.messages, 'groq');
      if (b.stream) return sse('groq', text);
      return J(200, { choices: [{ message: { content: text } }] });
    }
    if (u.startsWith('https://generativelanguage.googleapis.com/')) {
      if (u.includes('/models?')) return J(200, { models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] });
      const b = JSON.parse(opt.body); calls.gemini.push(b);
      const sys = b.systemInstruction.parts[0].text, last = b.contents[b.contents.length - 1].parts[0].text;
      if (b.tools) return J(200, { candidates: [{ content: { parts: [{ text: 'Simulated web brief.\n- Finding one\n- Finding two' }] }, groundingMetadata: { webSearchQueries: ['sim query'], groundingChunks: [{ web: { uri: 'https://example.org/a', title: 'Example A' } }, { web: { uri: 'http://insecure.example/x', title: 'Insecure' } }, { web: { uri: 'https://example.org/a', title: 'Dup' } }] } }] });
      if (u.includes(':streamGenerateContent')) return sse('gemini', brain(sys, last, [], 'gemini'));
      return J(200, { candidates: [{ content: { parts: [{ text: brain(sys, last, [], 'gemini') }] } }] });
    }
    return realFetch(url, opt);
  };

  const env = {
    GROQ_API_KEY: 'gsk_sim_key_0123456789', ...(noGemini ? {} : { GEMINI_API_KEY: 'AIzaSim_key_0123456789012345678901234567' }), RATE_PER_MIN: '1000', RATE_PER_DAY: '100000', DAILY_CAP: '1000000',
    ASSETS: { fetch: (req) => serveAsset(req) },
    ...(ai ? { AI: { run: async (model, input) => { calls.ai.push({ model, input }); return { image: TINY_JPEG }; } } } : {}),
  };
  const mod = await import(pathToFileURL(path.join(SITE, 'worker.js')).href + '?t=' + Date.now()); const worker = mod.default;
  if (!noDo) { env.APPS = fakeNamespace(mod.AppStore, env); env.SYNC = fakeNamespace(mod.SyncStore, env); }

  function serveAsset(req) {
    let p = decodeURIComponent(new URL(req.url).pathname); if (p === '/') p = '/index.html';
    const first = p.split('/')[1];
    let file = path.join(SITE, p), status = 200;
    if (ignore.has(first) || first === '_headers' || !file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(SITE, '404.html'); status = 404; }
    const h = headersFor(rules, p);
    h.set('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    return new Response(fs.readFileSync(file), { status, headers: Object.fromEntries(h) });
  }

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const hdr = new Headers(req.headers); hdr.set('cf-connecting-ip', req.headers['x-sim-ip'] || '203.0.113.7');
    const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: hdr, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const r = await worker.fetch(request, env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) for await (const chunk of r.body) res.write(chunk);
    res.end();
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  if (!quiet) console.log(`sim worker on http://localhost:${port}`);
  return { server, calls, env, close: () => new Promise((ok) => server.close(ok)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await start({ site: process.argv[2], port: Number(process.env.PORT || 8788), ai: process.env.SIM_NO_AI !== '1', noGemini: process.env.SIM_NO_GEMINI === '1', noDo: process.env.SIM_NO_DO === '1', quiet: false });
