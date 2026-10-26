// LLM client: secured server (keys held server-side) or the user's own keys (encrypted in the vault), with model auto-discovery.
import { PROMPTS, MODE_CFG } from './prompts.js';
import { vaultGet, store, extractJson } from './core.js';

let caps = { server: false, llm: false, modes: false, research: false, image: false, vision: false, stream: false, share: false, sync: false };
export const capabilities = () => caps;
export async function probe() {
  try {
    const r = await fetch('/api/health');
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const j = await r.json();
      caps = { server: true, llm: !!j.llm, modes: !!j.modes, research: !!(j.capabilities && j.capabilities.research), image: !!(j.capabilities && j.capabilities.image), vision: !!(j.capabilities && j.capabilities.vision), stream: !!(j.capabilities && j.capabilities.stream), share: !!(j.capabilities && j.capabilities.share), sync: !!(j.capabilities && j.capabilities.sync) };
    }
  } catch (_) { /* static host without a server */ }
  return caps;
}

const T = (url, opt, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { ...opt, signal: c.signal }).finally(() => clearTimeout(t)); };
const body = async (r) => { try { return await r.json(); } catch (_) { return null; } };
const reason = (r, j, p) => `${p} ${r.status}${j && j.error ? ': ' + String(j.error.message || j.error).slice(0, 160) : ''}`;

export async function keys() { return { groq: await vaultGet('groq'), gemini: await vaultGet('gemini') }; }

export async function llm(mode, messages, opts = {}) {
  const cfg = MODE_CFG[mode]; const k = await keys(); const byo = !!(k.groq || k.gemini); const server = caps.llm && caps.modes;
  const order = (store.get('provider', 'auto') === 'byo' ? ['byo', 'server'] : ['server', 'byo']).filter((x) => (x === 'server' ? server : byo));
  if (!order.length) { const e = new Error('No AI is connected. Add a free Groq or Gemini key in Settings.'); e.code = 'no-llm'; throw e; }
  let last;
  for (const o of order) {
    try { return o === 'server' ? await viaServer(mode, messages, cfg, opts.provider) : await viaByo(mode, messages, cfg, k, opts.provider); }
    catch (e) { last = e; if (e.fatal) throw e; }
  }
  throw last;
}

async function viaServer(mode, messages, cfg, provider) {
  const r = await T('/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, messages, ...(provider ? { provider } : {}) }) }, cfg.timeout + 15000);
  const j = await body(r);
  if (!r.ok) { const e = new Error((j && j.error) || `server ${r.status}`); e.fatal = !!(j && j.blocked); throw e; }
  return { text: j.text, provider: 'server:' + j.provider, model: j.model, ms: j.ms };
}

const GROQ_PREF = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];
const GEM_PREF = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
const picked = {};

async function viaByo(mode, messages, cfg, k, only) {
  const full = [{ role: 'system', content: PROMPTS[mode] }, ...messages]; const errs = [];
  for (const p of ['groq', 'gemini']) {
    if (!k[p] || (only && only !== p)) continue; const t0 = performance.now();
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
// Image understanding: server (Gemini key held server-side) or the user's own Gemini key.
export async function visionAnalyze({ image, mime = 'image/jpeg', task = 'describe', question = '' }) {
  if (caps.vision) return serverPost('/api/vision', { image, mime, task, question }, 60000);
  const key = await vaultGet('gemini');
  if (!key) { const e = new Error('Image understanding needs a Gemini key. Add one in Settings, or use a deployment with a server key.'); e.code = 'no-vision'; throw e; }
  const payload = { systemInstruction: { parts: [{ text: PROMPTS['vision_' + task] }] }, contents: [{ role: 'user', parts: [{ text: question || 'Analyze this image.' }, { inlineData: { mimeType: mime, data: image } }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1200 } };
  const call = (m) => T(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 45000);
  let model = picked.gemini || GEM_PREF[0], r = await call(model), j = await body(r);
  if (!r.ok && (r.status === 404 || r.status === 400)) {
    const lr = await T('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }, 12000), lj = await body(lr);
    if (lr.ok) { const names = (lj.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', '')); const alt = GEM_PREF.find((x) => names.includes(x)) || names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]))[0]; if (alt && alt !== model) { model = alt; r = await call(model); j = await body(r); } }
  }
  if (!r.ok) throw new Error(reason(r, j, 'gemini'));
  picked.gemini = model; const c = j.candidates && j.candidates[0];
  return { text: (c && c.content && c.content.parts.map((p) => p.text || '').join('')) || '', task, model };
}
export const researchWeb = (query) => { if (!caps.research) { const e = new Error('Web research is not enabled on this deployment.'); e.code = 'no-research'; throw e; } return serverPost('/api/research', { query }, 60000); };
export const generateImage = (payload) => { if (!caps.image) { const e = new Error('Image generation needs Cloudflare Workers AI, which is not enabled on this deployment.'); e.code = 'no-image'; throw e; } return serverPost('/api/image', payload, 60000); };

// ---------- streaming (server passthrough or your own keys) ----------
async function* sseData(res) {
  const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (line.startsWith('data:')) yield line.slice(5).trim(); }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}
const tokenOf = (provider, j) => (provider === 'groq'
  ? (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''
  : (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts.map((p) => p.text || '').join('')) || '');
async function consume(res, provider, onToken) {
  let text = '';
  for await (const d of sseData(res)) { if (d === '[DONE]') break; let j; try { j = JSON.parse(d); } catch (_) { continue; } const t = tokenOf(provider, j); if (t) { text += t; if (onToken) onToken(t, text); } }
  return text;
}
async function discoverGroq(key) {
  const lr = await T('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } }, 12000), lj = await body(lr);
  if (!lr.ok) throw new Error(reason(lr, lj, 'groq'));
  const ids = (lj.data || []).map((x) => x.id); return GROQ_PREF.find((x) => ids.includes(x)) || ids.find((x) => /gpt-oss|qwen|llama/i.test(x) && !/guard|whisper|tts/i.test(x));
}
async function discoverGemini(key) {
  const lr = await T('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }, 12000), lj = await body(lr);
  if (!lr.ok) throw new Error(reason(lr, lj, 'gemini'));
  const names = (lj.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
  return GEM_PREF.find((x) => names.includes(x)) || names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]))[0];
}
async function groqStreamOpen(key, messages, cfg) {
  const call = (model) => T('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: cfg.max, stream: true, ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}) }) }, cfg.timeout);
  let model = picked.groq || GROQ_PREF[0], r = await call(model);
  if (!r.ok && (r.status === 404 || r.status === 400)) { const alt = await discoverGroq(key); if (alt && alt !== model) { model = alt; r = await call(model); } }
  if (!r.ok) throw new Error(reason(r, await body(r), 'groq'));
  picked.groq = model; return { response: r, model };
}
async function geminiStreamOpen(key, messages, cfg) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const payload = JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: Math.round(cfg.max * 1.3) } });
  const call = (model) => T(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: payload }, cfg.timeout);
  let model = picked.gemini || GEM_PREF[0], r = await call(model);
  if (!r.ok && (r.status === 404 || r.status === 400)) { const alt = await discoverGemini(key); if (alt && alt !== model) { model = alt; r = await call(model); } }
  if (!r.ok) throw new Error(reason(r, await body(r), 'gemini'));
  picked.gemini = model; return { response: r, model };
}
export async function llmStream(mode, messages, opts = {}) {
  const cfg = MODE_CFG[mode], k = await keys(), byo = !!(k.groq || k.gemini), server = caps.llm && caps.modes && caps.stream;
  const order = (store.get('provider', 'auto') === 'byo' ? ['byo', 'server'] : ['server', 'byo']).filter((x) => (x === 'server' ? server : byo));
  if (!order.length) { if (caps.llm && caps.modes) return llm(mode, messages, opts); const e = new Error('No AI is connected. Add a free Groq or Gemini key in Settings.'); e.code = 'no-llm'; throw e; }
  let last; const t0 = performance.now();
  for (const o of order) {
    try {
      if (o === 'server') {
        const r = await T('/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, messages, stream: true, ...(opts.provider ? { provider: opts.provider } : {}) }) }, cfg.timeout + 15000);
        if (!r.ok) { const j = await body(r); const e = new Error((j && j.error) || `server ${r.status}`); e.fatal = !!(j && j.blocked); throw e; }
        const provider = r.headers.get('X-Provider'), text = await consume(r, provider, opts.onToken);
        if (!text.trim()) throw new Error('The stream returned no text');
        return { text, provider: 'server:' + provider, model: r.headers.get('X-Model') || '', ms: Math.round(performance.now() - t0) };
      }
      const full = [{ role: 'system', content: PROMPTS[mode] }, ...messages], errs = [];
      for (const p of ['groq', 'gemini']) {
        if (!k[p] || (opts.provider && opts.provider !== p)) continue;
        try { const op = p === 'groq' ? await groqStreamOpen(k.groq, full, cfg) : await geminiStreamOpen(k.gemini, full, cfg); const text = await consume(op.response, p, opts.onToken); if (!text.trim()) throw new Error(p + ' stream returned no text'); return { text, provider: p, model: op.model, ms: Math.round(performance.now() - t0) }; }
        catch (e) { errs.push(e.message); }
      }
      throw new Error(errs.join(' | ') || 'no key');
    } catch (e) { last = e; if (e.fatal) throw e; }
  }
  // Streaming failed or returned nothing (for example a proxy that buffers): try once without streaming.
  try { return await llm(mode, messages, opts); } catch (e2) { throw last || e2; }
}

// ---------- share links ----------
export function publishedApps() { return store.get('published', []); }
export async function publishApp({ html, title }) {
  if (!caps.share) { const e = new Error('Sharing needs Durable Objects, which are not enabled on this deployment. See docs/STUDIO.md.'); e.code = 'no-share'; throw e; }
  const r = await serverPost('/api/publish', { html, title }, 30000);
  const list = [{ id: r.id, url: r.url, token: r.deleteToken, title, expires: r.expires, at: Date.now() }, ...publishedApps()].slice(0, 30); store.set('published', list); return r;
}
export async function unpublishApp(id) {
  const rec = publishedApps().find((x) => x.id === id); if (!rec) throw new Error('Unknown app');
  await serverPost('/api/unpublish', { id, token: rec.token }, 20000); store.set('published', publishedApps().filter((x) => x.id !== id));
}
