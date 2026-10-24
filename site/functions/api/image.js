// POST /api/image { prompt, steps?, seed?, image?, strength? } -> { image (base64), mime, model }   (Cloudflare Workers AI)
import { gate, redact, MODE_CFG } from '../_lib/common.js';

const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };

export async function onRequestPost({ request, env }) {
  if (!env.AI) return new Response(JSON.stringify({ error: 'Image generation is not enabled on this deployment (Workers AI binding missing)' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
  const g = await gate(request, env, () => 5);
  if (g.response) return g.response;
  const prompt = typeof g.body.prompt === 'string' ? redact(g.body.prompt.trim()).text : '';
  if (prompt.length < 3 || prompt.length > 1800) return g.send(400, { error: 'Prompt must be 3 to 1800 characters' });
  const steps = Math.max(1, Math.min(8, Number(g.body.steps) || 4));
  const seed = Number.isFinite(Number(g.body.seed)) ? Math.abs(Math.floor(Number(g.body.seed))) % 4294967295 : Math.floor(Math.random() * 1e9);
  try {
    if (typeof g.body.image === 'string' && g.body.image) { // experimental image-to-image
      if (g.body.image.length > 600000) return g.send(413, { error: 'Source image too large (max about 440 KB). Resize it first.' });
      const model = env.IMG2IMG_MODEL || '@cf/runwayml/stable-diffusion-v1-5-img2img';
      const bytes = Uint8Array.from(atob(g.body.image), (c) => c.charCodeAt(0));
      const out = await env.AI.run(model, { prompt, image: Array.from(bytes), strength: Math.max(0.1, Math.min(0.95, Number(g.body.strength) || 0.6)), num_steps: Math.min(steps * 3, 20) });
      const buf = out instanceof ReadableStream ? await new Response(out).arrayBuffer() : out;
      return g.send(200, { image: b64(buf), mime: 'image/png', model });
    }
    const model = env.IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell';
    const out = await env.AI.run(model, { prompt, steps, seed });
    if (!out || typeof out.image !== 'string' || !out.image) return g.send(502, { error: 'The image model returned no image' });
    return g.send(200, { image: out.image, mime: 'image/jpeg', model, seed });
  } catch (e) {
    return g.send(502, { error: `Image model error: ${String(e && e.message || e).slice(0, 200)}` });
  }
}
export async function onRequest() {
  return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } });
}
