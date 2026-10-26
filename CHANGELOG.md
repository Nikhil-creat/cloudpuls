# Changelog
## 3.3.0 — 2026-10-25
- Live streaming: build code and arena answers appear as they are written (provider SSE passed straight through the Worker; failover happens before the first byte; automatic non-streaming fallback)
- Share links: Publish a built app to `/a/<id>` (30 days). Served with a sandbox CSP (opaque origin, no network, no forms), attribution badge, noindex, report page and auto-takedown after 3 reports, delete token, password-field apps refused
- Zero-knowledge cloud sync: recovery code to HKDF to workspace id, auth token and AES-256-GCM key; encrypted blob stored in a Durable Object (chunked, up to 3 MB); push, pull, force push, conflict detection, delete cloud copy
- Durable Objects (SQLite) declared in `wrangler.jsonc`; `wrangler.basic.jsonc` keeps the previous config if you prefer not to use them
- 5 more build templates; accessibility audit and performance budget are now part of the test suite
- Tests: 36 new browser checks (`e2e_studio_v33.py`) and 42 Worker API checks (`test_worker_v33.mjs`); all earlier suites pass (314 checks in total)
## 3.2.0 — 2026-10-24
- Model arena (Compare): send one prompt to Groq and Gemini in parallel, see speed and size, vote; scoreboard persists
- Image understanding: describe, alt text, read text (OCR), extract data. Works with the server Gemini key or the visitor's own key. Agent tool `describe_image`
- API: `provider` option for `/api/llm` (groq or gemini only), new `/api/vision`, `vision` capability in `/api/health`
- Refreshed description, keywords and metadata across the site, manifest and docs (`docs/REPO_METADATA.md`)
- Tests: 19 new browser checks (`loadtest/e2e_studio_v32.py`), Worker API suite now 38 checks
## 3.1.0 — 2026-10-24
- Build: runtime errors inside the sandboxed app are reported to the page, with a "Fix with AI" button and an optional one-attempt auto-fix (bounded, no loops)
- Build: welcome card for first-time users, "How do I publish this for free?" help
- Agent: voice input (where the browser supports it) and read-aloud
- Studio: command palette (Ctrl K); `[hidden]` now always wins over layout CSS
- Installable app: 192 and 512 icons, manifest shortcuts (Build, Images, Research, Tasks), offline service worker that precaches the whole Studio shell (27 files)
- Tests: 26 new browser checks (`loadtest/e2e_studio_v31.py`) including a real offline reload; all earlier suites still pass
## 3.0.0 — 2026-10-24
- CloudPulse Studio (`studio.html`): Build from a prompt with sandboxed preview, AI and SVG images with a full local editor, grounded research (web, deep, Wikipedia, notes), Kanban tasks, automation rules, knowledge base with AI Q&A, activity timeline, an agent that operates all tools, and an encrypted key vault
- Worker: shared gate and quotas in units, per-mode prompts and limits, `/api/research` (Gemini with Google Search grounding), `/api/image` (Workers AI), capabilities in `/api/health`
- Strict CSP everywhere, with a locked-down override for the sandbox host
- Wrangler configs now include the Workers AI binding and the observability settings from the Cloudflare dashboard
- Test suites: 71 Studio browser checks, 23 Worker API checks, plus homepage and model-fallback suites
## 2.3.2 — 2026-10-23
- Fixed: assistant returned "HTTP 404". Groq retired `llama-3.3-70b-versatile` on 2026-08-16 and Gemini scheduled `gemini-2.5-flash` for shutdown on 2026-10-16
- Defaults now `openai/gpt-oss-120b` (Groq) and `gemini-3.6-flash` (Gemini)
- Models are auto-discovered from each provider's model list when a default is retired (browser, Vercel, Cloudflare and Python backend)
- Assistant now shows the provider's real error message and falls back to the built-in knowledge base instead of a dead end
## 2.3.1 — 2026-10-22
- Fixed: AI proxy did not run on Cloudflare Workers deployments (Pages Functions are not used there). Added `site/worker.js`, `wrangler.jsonc` (root and `site/`) and `.assetsignore`
- Fixed: Vercel analytics script requested on non-Vercel hosts (console error); now loads only on `*.vercel.app`
- Fixed: headline lacked a space between its two lines for screen readers and text extraction
- Canonical, `og:*`, sitemap and robots now point at the Workers URL
- Verified with a real headless-browser test: 38 checks offline mode, 39 checks server mode, desktop and mobile
## 2.3.0 — 2026-10-22
- Cloudflare Pages support: Pages Functions port of the AI proxy, `_headers` security headers
- Render static blueprint (`render.yaml`), hosting comparison doc
## 2.2.1 — 2026-10-22
- Vercel project root is now `site/` (api, vercel.json, package.json moved inside) so Vercel no longer detects multiple services
## 2.2.0 — 2026-10-22
- Vercel deployment: serverless LLM proxy (`/api/llm`) with server-held keys, firewall, per-IP and daily limits, and health check
- Strict CSP: all site scripts moved to external files; security headers in `vercel.json`; `security.txt`
- Site: credentials section (22 items), live GitHub activity, command palette (Ctrl K), voice input and read-aloud, offline service worker, skip link, Vercel Analytics hook
- Backend: login lockout, audit-chain verification endpoint, AI alert explanations (corrective RAG), AI weekly executive report
- Console: Explain with AI on alerts, weekly report button
## 2.1.0 — 2026-10-22
- Added demo data seeder (`make seed`) so the console shows live charts, alerts and a pending plan
- Added Alembic migration scaffold (`make migrate`)
- Added SEO and social metadata, sitemap, robots, 404 page, web manifest, OG image
- Added MIT license, contributing guide, issue and PR templates, CODEOWNERS
## 2.0.0
- LLM firewall, TOTP MFA, corrective RAG, policy critic, forecasting, observability stack, Kubernetes manifests, in-browser assistant
## 1.0.0
- Initial platform: collectors, CNN, swarm, gateway, MCP, console, Pages site
