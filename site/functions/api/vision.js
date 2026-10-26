// POST /api/vision { image (base64), mime, task: describe|alt|ocr|extract, question? } -> { text, task, model }   (Gemini multimodal)
import { gate, redact, PROMPTS, geminiRaw, geminiText } from '../_lib/common.js';

const TASKS = { describe: 'vision_describe', alt: 'vision_alt', ocr: 'vision_ocr', extract: 'vision_extract' };

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: 'Image understanding needs a Gemini key on the server' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const g = await gate(request, env, () => 3);
  if (g.response) return g.response;
  const key = TASKS[g.body.task];
  if (!key) return g.send(400, { error: 'Unknown task' });
  const mime = String(g.body.mime || '');
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return g.send(400, { error: 'Unsupported image type' });
  const data = String(g.body.image || '');
  if (data.length > 900000) return g.send(413, { error: 'Image too large. Resize to about 1024 px first.' });
  if (data.length < 20 || !/^[A-Za-z0-9+/=]+$/.test(data)) return g.send(400, { error: 'Invalid image data' });
  const question = typeof g.body.question === 'string' ? redact(g.body.question.slice(0, 300)).text : '';
  const body = {
    systemInstruction: { parts: [{ text: PROMPTS[key] }] },
    contents: [{ role: 'user', parts: [{ text: question || 'Analyze this image.' }, { inlineData: { mimeType: mime, data } }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
  };
  try {
    const raw = await geminiRaw(env, body, 45000);
    return g.send(200, { text: redact(geminiText(raw.json)).text, task: g.body.task, model: raw.model });
  } catch (e) { return g.send(502, { error: e.message }); }
}
export async function onRequest() {
  return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } });
}
