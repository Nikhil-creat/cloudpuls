# Deploy to Cloudflare (Workers with static assets, free, no card)

Cloudflare now deploys Pages-style sites as **Workers**. This repo ships a Worker (`site/worker.js`) that serves the static site and the secured AI proxy at `/api/llm` and `/api/health`. Both `wrangler.jsonc` (repo root) and `site/wrangler.jsonc` are provided, so either Root Directory (`/` or `site`) works.

## Set up
1. dash.cloudflare.com → **Workers & Pages** → **Create** → connect your GitHub repo `cloudpulse-ai`.
2. Build settings: Root directory `/` (or `site`), Build command empty, Deploy command `npx wrangler deploy`.
3. After the first deploy: your Worker → **Settings → Variables and Secrets → Add**
   - Type **Secret**, name `GROQ_API_KEY`, value your key
   - Type **Secret**, name `GEMINI_API_KEY`, value your key
   - Optional: `DAILY_CAP`, `RATE_PER_MIN`, `RATE_PER_DAY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
4. Open `https://<worker>.workers.dev/api/health`. It must show `"llm": true`. The Assistant then says "Server mode".

The worker name in `wrangler.jsonc` is `cloudpuls`. If your Worker has another name, change `"name"` in both files so deploys update the existing Worker.

## Troubleshooting
- Assistant says "Offline mode": `/api/health` is not returning `llm: true`. Check the secrets exist, then redeploy.
- `/api/health` returns 404: the deploy did not use `wrangler.jsonc`. Check the Deploy command is `npx wrangler deploy`.
- Free limits: static assets are unlimited, Workers get 100,000 requests per day.
- Change canonical, `og:url` and `og:image` in `site/index.html`, `sitemap.xml` and `robots.txt` when you add a custom domain.

## Models
Leave `GROQ_MODEL` and `GEMINI_MODEL` unset. The proxy tries `openai/gpt-oss-120b` and `gemini-3.6-flash`, and if a provider retires a model it reads the provider's model list and switches automatically. Set them only to pin a specific model.

## Studio features on Cloudflare
- **Server AI:** add `GROQ_API_KEY` and `GEMINI_API_KEY` as secrets (Settings → Variables and Secrets).
- **Live web research:** needs `GEMINI_API_KEY` (uses Google Search grounding).
- **Image generation:** uses the Workers AI binding `AI` declared in `wrangler.jsonc`. No key is needed; the free plan has a daily allowance.
- Check `https://<worker>.workers.dev/api/health`. It lists `capabilities`: `llm`, `research`, `image`.
- Studio badges (bottom left) show the same three states.

## Share links and cloud sync (Durable Objects)
`wrangler.jsonc` declares two SQLite-backed Durable Object classes (`AppStore`, `SyncStore`). They work on the Workers Free plan and need no IDs or dashboard setup; the first deploy creates them through the `migrations` entry.
- Check `https://<worker>.workers.dev/api/health`: `capabilities.share` and `capabilities.sync` should be `true`.
- If a deploy fails with a Durable Objects error, switch the Deploy command (Settings → Builds) to `npx wrangler deploy -c wrangler.basic.jsonc`. That deploys everything except share links and sync.
- Published apps live at `/a/<id>`; the Worker serves them (`run_worker_first` includes `/a/*`).
