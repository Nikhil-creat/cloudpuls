// Shared server code: LLM firewall, rate limiting, request gate, provider calls with model auto-discovery.
import { PROMPTS, MODE_CFG } from '../../js/studio/prompts.js';
export { PROMPTS, MODE_CFG };
export const FENCE = '<<UNTRUSTED_DATA';

const INJECTION = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)/i,
  /(reveal|print|show|repeat) (me )?(your |the )?(system|hidden|initial) (prompt|instructions)/i,
  /you are now (dan|in developer mode|unrestricted)/i,
  /(without|bypass|disable) (any )?(restrictions|guardrails|safety|approval)/i,
  /apply .{0,30}(without|skip).{0,20}(approval|review)/i,
  /<\/?\s*(system|assistant)\s*>/i,
];
const SECRETS = {
  groq_key: /\bgsk_[A-Za-z0-9]{20,}\b/g,
  google_key: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
  aws_access_key: /\bAKIA[0-9A-Z]{16}\b/g,
  private_key: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
};
export function redact(text) {
  const found = []; let out = text;
  for (const [name, rx] of Object.entries(SECRETS)) {
    rx.lastIndex = 0;
    if (rx.test(out)) { found.push(name); rx.lastIndex = 0; out = out.replace(rx, `[REDACTED:${name}]`); }
    rx.lastIndex = 0;
  }
  return { text: out, found };
}
export const injected = (t) => INJECTION.some((r) => r.test(t));

const mem = new Map();
export async function hit(env, key, windowSec, limit, n = 1) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const r = await fetch(`${env.UPSTASH_REDIS_REST_URL}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['INCRBY', key, String(n)], ['EXPIRE', key, String(windowSec), 'NX']]),
      });
      return Number((await r.json())[0].result) <= limit;
    } catch (_) { /* fall back to memory */ }
  }
  const now = Date.now(), e = mem.get(key);
  if (!e || e.exp < now) {
    if (mem.size > 5000) for (const [k, v] of mem) if (v.exp < now) mem.delete(k);
    mem.set(key, { n, exp: now + windowSec * 1000 });
    return n <= limit;
  }
  e.n += n;
  return e.n <= limit;
}

// Origin checks, JSON parse and quota (in "units": chat=1, research=2, build=3, image=5).
export async function gate(request, env, unitsFor = () => 1) {
  const rid = crypto.randomUUID();
  const send = (code, body, extra = {}) => new Response(JSON.stringify({ ...body, requestId: rid }), {
    status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': rid, 'X-Content-Type-Options': 'nosniff', ...extra } });
  const fail = (code, body, extra) => ({ response: send(code, body, extra) });

  const sfs = request.headers.get('sec-fetch-site');
  if (sfs && sfs !== 'same-origin') return fail(403, { error: 'Cross-site requests are not allowed' });
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return fail(403, { error: 'Origin not allowed' });
  if (!(request.headers.get('content-type') || '').includes('application/json')) return fail(415, { error: 'JSON required' });
  let body; try { body = await request.json(); } catch (_) { return fail(400, { error: 'Invalid JSON' }); }

  const units = unitsFor(body) || 1;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + (env.RATE_SALT || 'cp')));
  const id = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const day = new Date().toISOString().slice(0, 10);
  const okMin = await hit(env, `rl:m:${id}`, 60, Number(env.RATE_PER_MIN || 20), units);
  const okDay = await hit(env, `rl:d:${id}:${day}`, 86400, Number(env.RATE_PER_DAY || 150), units);
  const okCap = await hit(env, `cap:${day}`, 86400, Number(env.DAILY_CAP || 1500), units);
  if (!okMin || !okDay) return fail(429, { error: 'Rate limit reached. Try again shortly or add your own key in Settings.' }, { 'Retry-After': '60' });
  if (!okCap) return fail(429, { error: 'Daily demo budget reached. Try again tomorrow or add your own key in Settings.' });
  return { rid, send, body, id };
}

// Same checks as gate() for requests whose body is binary or absent (sync).
export async function gateLite(request, env, units = 1) {
  const rid = crypto.randomUUID();
  const send = (code, body, extra = {}) => new Response(JSON.stringify({ ...body, requestId: rid }), {
    status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': rid, 'X-Content-Type-Options': 'nosniff', ...extra } });
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs && sfs !== 'same-origin') return { response: send(403, { error: 'Cross-site requests are not allowed' }) };
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return { response: send(403, { error: 'Origin not allowed' }) };
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + (env.RATE_SALT || 'cp')));
  const id = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hit(env, `rl:m:${id}`, 60, Number(env.RATE_PER_MIN || 20), units)) || !(await hit(env, `rl:d:${id}:${day}`, 86400, Number(env.RATE_PER_DAY || 150), units)) || !(await hit(env, `cap:${day}`, 86400, Number(env.DAILY_CAP || 1500), units))) {
    return { response: send(429, { error: 'Rate limit reached. Try again shortly.' }, { 'Retry-After': '60' }) };
  }
  return { rid, send, id };
}

// ---------- providers (models auto-discovered when a default is retired) ----------
const GROQ_PREF = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];
const GEM_PREF = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
const picked = {};
const errMsg = async (r) => { try { const j = await r.json(); return (j.error && (j.error.message || j.error)) || ''; } catch (_) { return ''; } };
async function call(url, opt, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opt, signal: c.signal }); } finally { clearTimeout(t); }
}

async function groqModels(env) {
  const r = await call('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` } }, 10000);
  if (!r.ok) throw new Error(`groq ${r.status}: ${await errMsg(r)}`);
  const ids = ((await r.json()).data || []).map((m) => m.id);
  for (const p of GROQ_PREF) if (ids.includes(p)) return p;
  const chat = ids.filter((i) => !/whisper|tts|guard|embed|orpheus/i.test(i));
  return chat.find((i) => /gpt-oss|qwen|llama/i.test(i)) || chat[0];
}
function groqCall(env, model, messages, max, ms, stream = false) {
  const body = { model, messages, temperature: 0.2, max_tokens: max, ...(stream ? { stream: true } : {}) };
  if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
  return call('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: JSON.stringify(body) }, ms);
}
async function groq(env, messages, { max, timeout }) {
  const pinned = env.GROQ_MODEL;
  let model = pinned || picked.groq || GROQ_PREF[0];
  let r = await groqCall(env, model, messages, max, timeout);
  if (!r.ok && (r.status === 404 || r.status === 400) && !pinned) {
    const alt = await groqModels(env);
    if (alt && alt !== model) { model = alt; r = await groqCall(env, model, messages, max, timeout); }
  }
  if (!r.ok) throw new Error(`groq ${r.status}: ${await errMsg(r)}`);
  picked.groq = model;
  const j = await r.json();
  return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', model };
}

async function geminiModels(env) {
  const r = await call('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } }, 10000);
  if (!r.ok) throw new Error(`gemini ${r.status}: ${await errMsg(r)}`);
  const names = ((await r.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
  for (const p of GEM_PREF) if (names.includes(p)) return p;
  const flash = names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]));
  return flash[0] || names.find((n) => /gemini/.test(n) && !/image|live|tts|audio|embed/.test(n));
}
function geminiStreamCall(env, model, body, ms) {
  return call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body) }, ms);
}
function geminiCall(env, model, body, ms) {
  return call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body) }, ms);
}
export async function geminiRaw(env, body, ms = 25000) {
  const pinned = env.GEMINI_MODEL;
  let model = pinned || picked.gemini || GEM_PREF[0];
  let r = await geminiCall(env, model, body, ms);
  if (!r.ok && (r.status === 404 || r.status === 400) && !pinned) {
    const alt = await geminiModels(env);
    if (alt && alt !== model) { model = alt; r = await geminiCall(env, model, body, ms); }
  }
  if (!r.ok) throw new Error(`gemini ${r.status}: ${await errMsg(r)}`);
  picked.gemini = model;
  return { json: await r.json(), model };
}
export const geminiText = (j) => (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts.map((p) => p.text || '').join('')) || '';
async function gemini(env, messages, { max, timeout }) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const { json, model } = await geminiRaw(env, { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: Math.round(max * 1.3) } }, timeout);
  return { text: geminiText(json), model };
}

// Groq first (fast), Gemini on failure.
export async function complete(env, messages, { max = 1200, timeout = 20000, only } = {}) {
  let providers = [];
  if (env.GROQ_API_KEY) providers.push(['groq', groq]);
  if (env.GEMINI_API_KEY) providers.push(['gemini', gemini]);
  if (only) providers = providers.filter((p) => p[0] === only);
  if (!providers.length) { const e = new Error(only ? `Provider ${only} is not configured on the server` : 'Server has no LLM key configured'); e.code = only ? 400 : 503; throw e; }
  const errors = [];
  for (let i = 0; i < providers.length; i++) {
    const [name, fn] = providers[i]; const t0 = Date.now();
    try {
      const out = await fn(env, messages, { max, timeout });
      return { text: out.text, provider: name, model: out.model, ms: Date.now() - t0, failover: i > 0 };
    } catch (e) { errors.push(e.name === 'AbortError' ? `${name}: timeout` : e.message); }
  }
  const err = new Error('All providers failed'); err.detail = errors; throw err;
}

// ---------- streaming: pass the provider's SSE body straight through (no per-token CPU on the Worker) ----------
const geminiBody = (messages, max) => {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  return { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: Math.round(max * 1.3) } };
};
async function groqOpen(env, messages, { max, timeout }) {
  const pinned = env.GROQ_MODEL; let model = pinned || picked.groq || GROQ_PREF[0];
  let r = await groqCall(env, model, messages, max, timeout, true);
  if (!r.ok && (r.status === 404 || r.status === 400) && !pinned) { const alt = await groqModels(env); if (alt && alt !== model) { model = alt; r = await groqCall(env, model, messages, max, timeout, true); } }
  if (!r.ok) throw new Error(`groq ${r.status}: ${await errMsg(r)}`);
  picked.groq = model; return { response: r, model };
}
async function geminiOpen(env, messages, { max, timeout }) {
  const pinned = env.GEMINI_MODEL; let model = pinned || picked.gemini || GEM_PREF[0]; const body = geminiBody(messages, max);
  let r = await geminiStreamCall(env, model, body, timeout);
  if (!r.ok && (r.status === 404 || r.status === 400) && !pinned) { const alt = await geminiModels(env); if (alt && alt !== model) { model = alt; r = await geminiStreamCall(env, model, body, timeout); } }
  if (!r.ok) throw new Error(`gemini ${r.status}: ${await errMsg(r)}`);
  picked.gemini = model; return { response: r, model };
}
export async function streamComplete(env, messages, { max = 1200, timeout = 20000, only } = {}) {
  let providers = [];
  if (env.GROQ_API_KEY) providers.push(['groq', groqOpen]);
  if (env.GEMINI_API_KEY) providers.push(['gemini', geminiOpen]);
  if (only) providers = providers.filter((p) => p[0] === only);
  if (!providers.length) { const e = new Error(only ? `Provider ${only} is not configured on the server` : 'Server has no LLM key configured'); e.code = only ? 400 : 503; throw e; }
  const errors = [];
  for (let i = 0; i < providers.length; i++) {
    const [name, open] = providers[i];
    try { const o = await open(env, messages, { max, timeout }); return { response: o.response, provider: name, model: o.model, failover: i > 0 }; }
    catch (e) { errors.push(e.name === 'AbortError' ? `${name}: timeout` : e.message); }
  }
  const err = new Error('All providers failed'); err.detail = errors; throw err;
}
