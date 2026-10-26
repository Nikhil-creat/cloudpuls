// POST /api/research { query } -> { text, sources:[{title,url}], queries, grounded, model }   (Gemini + Google Search grounding)
import { gate, redact, injected, PROMPTS, MODE_CFG, geminiRaw, geminiText } from '../_lib/common.js';

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: 'Web research needs a Gemini key on the server' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const g = await gate(request, env, () => MODE_CFG.research.units);
  if (g.response) return g.response;
  const q = typeof g.body.query === 'string' ? g.body.query.trim() : '';
  if (q.length < 3 || q.length > 500) return g.send(400, { error: 'Query must be 3 to 500 characters' });
  if (injected(q)) return g.send(400, { error: 'Blocked by the LLM firewall.', blocked: true });
  const body = {
    systemInstruction: { parts: [{ text: PROMPTS.research_web }] },
    contents: [{ role: 'user', parts: [{ text: redact(q).text }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2500 },
  };
  let raw, grounded = true;
  try { raw = await geminiRaw(env, body, 45000); }
  catch (_) {
    try { delete body.tools; grounded = false; raw = await geminiRaw(env, body, 45000); }
    catch (e) { return g.send(502, { error: e.message }); }
  }
  const cand = raw.json.candidates && raw.json.candidates[0];
  const meta = (cand && cand.groundingMetadata) || {};
  const seen = new Set(); const sources = [];
  for (const c of meta.groundingChunks || []) {
    const w = c.web; if (!w || !/^https:\/\//.test(w.uri || '') || seen.has(w.uri)) continue;
    seen.add(w.uri); sources.push({ title: String(w.title || w.uri).slice(0, 140), url: w.uri });
  }
  return g.send(200, { text: redact(geminiText(raw.json)).text, sources: sources.slice(0, 8), queries: (meta.webSearchQueries || []).slice(0, 6), grounded, model: raw.model });
}
export async function onRequest() {
  return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } });
}
