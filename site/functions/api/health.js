// GET /api/health
export async function onRequestGet({ env }) {
  const providers = [env.GROQ_API_KEY && 'groq', env.GEMINI_API_KEY && 'gemini'].filter(Boolean);
  return new Response(JSON.stringify({
    ok: true, version: '3.3.0', llm: providers.length > 0, modes: true, providers,
    capabilities: { llm: providers.length > 0, research: !!env.GEMINI_API_KEY, image: !!env.AI, vision: !!env.GEMINI_API_KEY, stream: true, share: !!env.APPS, sync: !!env.SYNC },
  }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
