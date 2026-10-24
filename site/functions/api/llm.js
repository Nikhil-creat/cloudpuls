// POST /api/llm  { mode?, messages }  -> { text, provider, model, ms, failover, redacted }
import { gate, redact, injected, PROMPTS, MODE_CFG, FENCE, complete } from '../_lib/common.js';

export async function onRequestPost({ request, env }) {
  if (!env.GROQ_API_KEY && !env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'Server has no LLM key configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  const g = await gate(request, env, (b) => (MODE_CFG[b && b.mode || 'chat'] || MODE_CFG.chat).units);
  if (g.response) return g.response;
  const mode = g.body.mode == null ? 'chat' : g.body.mode;
  const cfg = MODE_CFG[mode];
  if (!cfg) return g.send(400, { error: 'Unknown mode' });

  const msgs = Array.isArray(g.body.messages) ? g.body.messages : null;
  if (!msgs || msgs.length < 1 || msgs.length > cfg.msgs) return g.send(400, { error: 'Invalid messages' });
  let total = 0; const clean = []; const redactions = [];
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return g.send(400, { error: 'Invalid message shape' });
    if (m.content.length > cfg.len) return g.send(413, { error: 'Message too long' });
    total += m.content.length;
    const isTool = m.role === 'user' && m.content.startsWith(FENCE);
    if (isTool && (!m.content.includes('<<END_UNTRUSTED_DATA>>') || m.content.length > 6000)) return g.send(400, { error: 'Invalid tool result' });
    if (m.role === 'user' && !isTool && injected(mode === 'build' ? m.content.slice(0, 1500) : m.content)) {
      return g.send(400, { error: 'Blocked by the LLM firewall: the message looks like a prompt-injection attempt.', blocked: true });
    }
    const r = redact(m.content); redactions.push(...r.found);
    clean.push({ role: m.role, content: r.text });
  }
  if (total > cfg.total || clean[clean.length - 1].role !== 'user') return g.send(400, { error: 'Invalid conversation' });

  try {
    const out = await complete(env, [{ role: 'system', content: PROMPTS[mode] }, ...clean], { max: cfg.max, timeout: cfg.timeout });
    const text = mode === 'build' || mode === 'svg' ? out.text : redact(out.text).text;
    return g.send(200, { ...out, text, mode, redacted: [...new Set(redactions)] });
  } catch (e) {
    return g.send(e.code || 502, { error: e.message, detail: e.detail });
  }
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } });
}
