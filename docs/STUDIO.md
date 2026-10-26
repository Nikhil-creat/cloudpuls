# CloudPulse Studio

An AI workspace that runs in the browser (`/studio.html`). Everything you create stays in your browser (IndexedDB and localStorage). The server only forwards AI calls, with keys it holds itself.

| Tool | What it does | Needs |
|---|---|---|
| Build | Prompt to working app. Refine in plain English, edit code, device preview, version history, download .html or .zip. Previews run in a sandbox with no network or storage access. | Any AI (server or your key) |
| Images | AI images (FLUX.1 schnell), AI-written SVG art (sanitized), and a local editor: filters, rotate, flip, crop, resize, captions, undo, export PNG/JPEG/WebP. Optional AI re-imagine (beta). **Understand this image:** describe, alt text, OCR, extract data (Gemini vision). | Image generation needs Cloudflare Workers AI. SVG and editor need nothing. |
| Research | Live web research with sources (Gemini with Google Search grounding), Deep mode (sub-questions then a report), Wikipedia mode, or answer from your notes. Save to the knowledge base or turn findings into tasks. | Web: Gemini key on the server. Others: any AI. |
| Compare | One prompt to Groq and Gemini side by side with timing, token estimate and voting. | Server keys or your own keys |
| Tasks | Kanban board with drag and drop, priorities, due dates, reminders, AI planning from a goal, export. | None |
| Knowledge | Notes and imported text files, BM25 search, AI summaries and tags, ask questions with citations. | AI for summaries and Q&A |
| Automations | If-this-then-that rules on tasks, documents, research, images and builds, plus schedules. Actions: notify, create task, add note, summarize with AI, run the agent. Loop guard and 20 runs per minute cap. | None (AI for summarize and agent) |
| Activity | Timeline of everything, filterable, exportable. | None |
| Agent | Give it a goal. It plans and calls the tools above (up to 8 steps) and reports back. Ctrl J opens it. | AI |
| Settings | Capability status, optional own keys in an encrypted vault, test connection, backup, import, delete everything. | None |

## New in 3.3
- **Live streaming** for Build and the Compare arena.
- **Publish link** (Build tab): gives `https://<your-site>/a/<id>` for 30 days. Published pages run in a sandbox with no network, no forms and no access to your data, show a "Made with CloudPulse Studio" badge and a Report link, and go offline automatically after three reports. You get a private delete token (kept in this browser) to unpublish. Apps with password fields are refused. Limit: 10 per day per visitor.
- **Cloud sync (Settings):** create a workspace, write down the 32-character recovery code, then enter it on another device. Everything is encrypted in the browser (HKDF to AES-256-GCM); the server stores only ciphertext and cannot read it. If you lose the code, the cloud copy cannot be recovered. Push, pull, force push, and delete cloud copy are all explicit.
- Both features use Durable Objects. If your account or config does not enable them, Studio shows a clear message and everything else keeps working.

## New in 3.2
- **Model arena** and **image understanding** (see the Compare and Images rows).

## New in 3.1
- **Self-healing builds:** if a generated app throws, the page shows the error with **Fix with AI**. Turn on auto-fix to let it try once.
- **Install it:** open Studio in Chrome, menu → Install app. It gets its own icon, long-press shortcuts (Build, Images, Research, Tasks) and works offline for tasks, notes and the image editor.
- **Ctrl K** command palette, **Ctrl J** agent, and voice input plus read-aloud in the agent.

## Keys
- **On Cloudflare (recommended):** keys are Worker secrets (`GROQ_API_KEY`, `GEMINI_API_KEY`). Visitors never see or enter them.
- **Own keys:** encrypted with AES-GCM using a non-extractable key stored in IndexedDB. Plaintext is never written to storage. The same-origin page code can still use the key, so only save keys on devices you trust.

## Security design
- Strict CSP: `script-src 'self'`, no inline scripts; `frame-ancestors 'none'`.
- Generated apps run in `preview.html` inside `<iframe sandbox="allow-scripts">` (opaque origin: no cookies, no storage, no parent access) under a CSP with `connect-src 'none'`.
- The server holds all system prompts per mode, rejects client `system` messages, enforces per-mode size limits, screens prompt injection, redacts secrets, checks origin, and meters usage in units (chat 1, research 2, build 3, image 5) per minute, per day and per site.
- Tool and research output is fenced as untrusted data before it re-enters a prompt.
- All model output is rendered with `textContent`, never HTML. SVG is parsed and stripped of scripts, handlers, external links and foreignObject.

## Limits
- Image generation uses Cloudflare Workers AI. Free plans have a daily allowance and restrict some models; the UI shows the provider's error if it is unavailable.
- Image-to-image uses an experimental model and may not be available on your account.
- Web research counts against your Gemini free-tier limits.
- Browser storage is limited (about 5 MB for settings and tasks; IndexedDB holds notes and images). Use Settings to export a backup.

## Tests
`python loadtest/e2e_studio.py` (real Chromium, 71 checks), `python loadtest/e2e_studio_v31.py` (26 checks incl. offline), `python loadtest/e2e_studio_v32.py` (19 checks), `python loadtest/e2e_studio_v33.py` (36 checks incl. accessibility and performance), `node loadtest/test_worker_v33.mjs` (42 API checks), `node loadtest/test_worker_api.mjs` (Worker API, 23 checks). Both run against `loadtest/sim_worker.mjs`, which serves the site with the real `_headers` rules in front of the real Worker code and fake AI providers.
