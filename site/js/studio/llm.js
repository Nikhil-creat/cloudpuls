// LLM client: secured server (keys held server-side) or the user's own keys (encrypted in the vault), with model auto-discovery.
import { PROMPTS, MODE_CFG } from './prompts.js';
import { vaultGet, store, extractJson } from './core.js';

let caps = { server: false, llm: false, modes: false, research: false, image: false };
export const capabilities = () => caps;
export async function probe() {
  try {
    const r = await fetch('/api/health');
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const j = await r.json();
      caps = { server: true, llm: !!j.llm, modes: !!j.modes, research: !!(j.capabilities && j.capabilities.research), image: !!(j.capabilities && j.capabilities.image) };
    }
  } catch (_) { /* static host without a server */ }
  return caps;
}

const T = (url, opt, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { ...opt, signal: c.signal }).finally(() => clearTimeout(t)); };
const body = async (r) => { try { return await r.json(); } catch (_) { return null; } };
const reason = (r, j, p) => `${p} ${r.status}${j && j.error ? ': ' + String(j.error.message || j.error).slice(0, 160) : ''}`;

export async function keys() { return { groq: await vaultGet('groq'), gemini: await vaultGet('gemini') }; }

export async function llm(mode, messages) {
  const cfg = MODE_CFG[mode]; const k = await keys(); const byo = !!(k.groq || k.gemini); const server = caps.llm && caps.modes;
  const order = (store.get('provider', 'auto') === 'byo' ? ['byo', 'server'] : ['server', 'byo']).filter((x) => (x === 'server' ? server : byo));
  if (!order.length) { const e = new Error('No AI is connected. Add a free Groq or Gemini key in Settings.'); e.code = 'no-llm'; throw e; }
  let last;
  for (const o of order) {
    try { return o === 'server' ? await viaServer(mode, messages, cfg) : await viaByo(mode, messages, cfg, k); }
    catch (e) { last = e; if (e.fatal) throw e; }
  }
  throw last;
}

async function viaServer(mode, messages, cfg) {
  const r = await T('/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, messages }) }, cfg.timeout + 15000);
  const j = await body(r);
  if (!r.ok) { const e = new Error((j && j.error) || `server ${r.status}`); e.fatal = !!(j && j.blocked); throw e; }
  return { text: j.text, provider: 'server:' + j.provider, model: j.model, ms: j.ms };
}

const GROQ_PREF = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];
const GEM_PREF = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
const picked = {};

async function viaByo(mode, messages, cfg, k) {
  const full = [{ role: 'system', content: PROMPTS[mode] }, ...messages]; const errs = [];
  for (const p of ['groq', 'gemini']) {
    if (!k[p]) continue; const t0 = performance.now();
    try { const out = p === 'groq' ? await groq(k.groq, full, cfg) : await gemini(k.gemini, full, cfg); return { text: out.text, provider: p, model: out.model, ms: Math.round(performance.now() - t0) }; }
    catch (e) { errs.push(e.message); }
  }
  throw new Error(errs.join(' | ') || 'no key');
}
async function groq(key, messages, cfg) {
  const H = { Authorization: 'Bearer ' + key };
  const call = (model) => T('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: cfg.max, ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}) }) }, cfg.timeout);
  let model = picked.groq || GROQ_PREF[0], r = await call(model), j = await body(r);
  if (!r.ok && (r.status === 404 || r.status === 400)) {
    const lr = await T('https://api.groq.com/openai/v1/models', { headers: H }, 12000), lj = await body(lr);
    if (!lr.ok) throw new Error(reason(lr, lj, 'groq'));
    const ids = (lj.data || []).map((x) => x.id), alt = GROQ_PREF.find((x) => ids.includes(x)) || ids.find((x) => /gpt-oss|qwen|llama/i.test(x) && !/guard|whisper|tts/i.test(x));
    if (alt && alt !== model) { model = alt; r = await call(model); j = await body(r); }
  }
  if (!r.ok) throw new Error(reason(r, j, 'groq'));
  picked.groq = model;
  return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', model };
}
async function gemini(key, messages, cfg) {
  const H = { 'x-goog-api-key': key };
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const call = (model) => T(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: Math.round(cfg.max * 1.3) } }) }, cfg.timeout);
  let model = picked.gemini || GEM_PREF[0], r = await call(model), j = await body(r);
  if (!r.ok && (r.status === 404 || r.status === 400)) {
    const lr = await T('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: H }, 12000), lj = await body(lr);
    if (!lr.ok) throw new Error(reason(lr, lj, 'gemini'));
    const names = (lj.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
    const flash = names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]));
    const alt = GEM_PREF.find((x) => names.includes(x)) || flash[0];
    if (alt && alt !== model) { model = alt; r = await call(model); j = await body(r); }
  }
  if (!r.ok) throw new Error(reason(r, j, 'gemini'));
  picked.gemini = model;
  const c = j.candidates && j.candidates[0];
  return { text: (c && c.content && c.content.parts.map((p) => p.text || '').join('')) || '', model };
}

export async function llmJson(mode, messages) {
  const out = await llm(mode, messages); const j = extractJson(out.text);
  if (!j) throw new Error('The model did not return valid JSON. Try again.');
  return { json: j, ...out };
}

async function serverPost(path, payload, ms) {
  const r = await T(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, ms), j = await body(r);
  if (!r.ok) { const e = new Error((j && j.error) || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
export const researchWeb = (query) => { if (!caps.research) { const e = new Error('Web research is not enabled on this deployment.'); e.code = 'no-research'; throw e; } return serverPost('/api/research', { query }, 60000); };
export const generateImage = (payload) => { if (!caps.image) { const e = new Error('Image generation needs Cloudflare Workers AI, which is not enabled on this deployment.'); e.code = 'no-image'; throw e; } return serverPost('/api/image', payload, 60000); };
