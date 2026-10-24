import { h, $, $$, uid, nowIso, store, logEvent, emit, toast, download, clip } from './core.js';
import { llm } from './llm.js';
import { zip } from './zip.js';

export const id = 'build', title = 'Build';
const TEMPLATES = [
  ['Landing page', 'A modern landing page for an AI note-taking startup with hero, features, pricing and FAQ'],
  ['Dashboard', 'An analytics dashboard with KPI cards, a bar chart and a line chart drawn with inline SVG, and a data table'],
  ['Todo app', 'A todo app with add, complete, delete, filters and a progress ring'],
  ['Calculator', 'A scientific calculator with a history panel'],
  ['Quiz game', 'A five-question general knowledge quiz with score and restart'],
  ['Portfolio', 'A personal portfolio for a software engineer with a projects grid and contact section'],
];
let state = store.get('build', { html: '', prompt: '', versions: [] });
let frameBox, codeBox, statusEl, device = 'desktop', tab = 'preview', frameEl = null, autoDepth = 0;

export const currentApp = () => state;
function extractHtml(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i); if (fence) t = fence[1].trim();
  const i = t.search(/<!doctype html|<html[\s>]/i); if (i > 0) t = t.slice(i);
  if (!/<html|<!doctype/i.test(t)) t = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App</title></head><body>${t}</body></html>`;
  return t;
}
const titleOf = (html) => (html.match(/<title>([^<]*)/i) || [, 'App'])[1].trim() || 'App';
function persist() {
  let v = state.versions; while (v.length > 8 || JSON.stringify(v).length > 420000) v.shift();
  store.set('build', { ...state, versions: v });
}
function setHtml(html, prompt, kind) {
  state.html = html; state.prompt = prompt; state.versions.push({ id: uid(), t: nowIso(), prompt: clip(prompt, 140), html });
  persist(); show(); renderVersions();
  logEvent('build', `${kind === 'refine' ? 'Refined' : 'Built'} “${titleOf(html)}”`);
  emit('app:built', { title: titleOf(html), prompt });
}
export async function generate(prompt, kind = 'new', opts = {}) {
  if (!opts.auto) autoDepth = 0;
  setBusy(true, kind === 'refine' ? 'Applying your change…' : 'Generating your app… this can take 10 to 40 seconds');
  try {
    const content = kind === 'refine' ? `Change request: ${prompt}\n\nCurrent HTML:\n${state.html}` : prompt;
    if (content.length > 29000) throw new Error('This app is too large to refine in one step. Simplify the code or start a new build.');
    const out = await llm('build', [{ role: 'user', content }]);
    const html = extractHtml(out.text);
    if (html.length < 60) throw new Error('The model returned no usable HTML. Try again.');
    setHtml(html, kind === 'refine' ? state.prompt : prompt, kind);
    setBusy(false, `Done in ${(out.ms / 1000).toFixed(1)}s via ${out.provider}${out.model ? ' (' + out.model + ')' : ''}`);
    return { ok: true, title: titleOf(html), chars: html.length };
  } catch (e) { setBusy(false, ''); toast(e.message, 'error'); throw e; }
}
function setBusy(b, msg) {
  if (!statusEl) return; statusEl.textContent = msg || '';
  for (const id of ['b-gen', 'b-refine-go']) { const el = $('#' + id); if (el) el.disabled = b; }
}

function show() {
  if (!frameBox) return;
  const empty = !state.html;
  $('#b-empty').hidden = !empty; $('#b-body').hidden = empty; if (empty) return;
  codeBox.value = state.html; renderFrame();
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  $('#b-previewpane').hidden = tab !== 'preview'; $('#b-codepane').hidden = tab !== 'code';
}
// The generated app runs in a sandboxed iframe on an opaque origin with a CSP that blocks all network access.
function renderFrame() {
  frameBox.replaceChildren(); hideError();
  const f = h('iframe', { id: 'b-frame', title: 'App preview', sandbox: 'allow-scripts', src: 'preview.html', referrerpolicy: 'no-referrer', class: 'frame ' + device });
  f.addEventListener('load', () => f.contentWindow.postMessage({ type: 'load', html: state.html }, '*'));
  frameBox.append(f); frameEl = f;
}
function hideError() { const b = $('#b-error'); if (b) b.hidden = true; }
function onFrameError(msg) {
  const b = $('#b-error'); if (!b) return;
  $('#b-error-msg').textContent = 'The app hit an error: ' + msg; b.hidden = false; b.dataset.msg = msg;
  if (store.get('autofix', false) && autoDepth < 1) { autoDepth++; fixError(msg, true); }
}
function fixError(msg, auto) {
  generate(`The app throws this runtime error: ${msg}\nFix the bug. Keep every other behavior and the design unchanged.`, 'refine', { auto }).catch(() => {});
}
function renderVersions() {
  const box = $('#b-versions'); if (!box) return;
  box.replaceChildren(...state.versions.slice().reverse().map((v, i) => h('button', { class: 'chip-s ver', type: 'button', onclick: () => { state.html = v.html; persist(); show(); toast('Version restored'); } }, `${state.versions.length - i}. ${clip(v.prompt, 30)}`)));
}
const readme = (t) => `# ${t}\n\nGenerated with CloudPulse Studio.\n\nThis is a single self-contained file (index.html). To publish it for free:\n- Cloudflare Pages: Workers & Pages > Create > Upload assets, drop this folder.\n- GitHub Pages: commit index.html to a repo and enable Pages.\n- Netlify Drop: drag this folder onto app.netlify.com/drop.\n`;

export function mount(root) {
  window.addEventListener('message', (e) => { if (frameEl && e.source === frameEl.contentWindow && e.data && e.data.type === 'error') onFrameError(String(e.data.msg).slice(0, 300)); });
  statusEl = h('span', { id: 'b-status', class: 'muted', 'aria-live': 'polite' });
  const prompt = h('textarea', { id: 'b-prompt', class: 'inp', rows: 3, placeholder: 'Describe the app or page you want. Example: a habit tracker with streaks and a weekly chart', 'aria-label': 'What do you want to build?', maxlength: 3000 });
  frameBox = h('div', { class: 'framebox', id: 'b-framebox' });
  codeBox = h('textarea', { id: 'b-code', class: 'inp code', rows: 18, spellcheck: 'false', 'aria-label': 'Source code' });
  root.append(
    h('header', { class: 'phead' }, h('h2', null, 'Build from a prompt'), h('p', { class: 'muted' }, 'Describe it, get a working app, refine it in plain English, then download it. Previews run in a locked sandbox with no network access.')),
    store.get('seen', false) ? null : h('section', { class: 'card welcome', id: 'welcome' },
      h('h3', null, 'Welcome to CloudPulse Studio'),
      h('p', { class: 'muted' }, 'Build apps from a sentence, make and edit images, research with sources, track tasks and automate the boring parts. The agent (Ctrl J) can use all of them. Your data stays in this browser.'),
      h('div', { class: 'row gap wrap' }, ['A pomodoro timer with a progress ring and sound-free alerts', 'A personal budget tracker with a donut chart', 'A flashcard app for learning Spanish'].map((x) => h('button', { class: 'chip-s', type: 'button', onclick: () => { $('#b-prompt').value = x; $('#b-prompt').focus(); } }, clip(x, 34))),
        h('span', { class: 'spacer' }), h('button', { class: 'btn sm ghost', id: 'welcome-dismiss', type: 'button', onclick: (e) => { store.set('seen', true); $('#welcome').remove(); } }, 'Got it'))),
    h('section', { class: 'card' }, prompt,
      h('div', { class: 'row gap wrap' }, TEMPLATES.map(([n, p]) => h('button', { class: 'chip-s', type: 'button', onclick: () => { prompt.value = p; prompt.focus(); } }, n))),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn', id: 'b-gen', type: 'button', onclick: () => { if (prompt.value.trim().length < 5) return toast('Describe what to build first', 'error'); generate(prompt.value.trim()).catch(() => {}); } }, 'Generate'), statusEl)),
    h('div', { id: 'b-empty', class: 'empty' }, 'Your app will appear here.'),
    h('div', { id: 'b-error', class: 'note row between gap wrap', hidden: true, role: 'alert' }, h('span', { id: 'b-error-msg' }), h('button', { class: 'btn sm', id: 'b-fix', type: 'button', onclick: () => fixError($('#b-error').dataset.msg || 'unknown error', false) }, 'Fix with AI')),
    h('div', { id: 'b-body', hidden: true },
      h('section', { class: 'card' }, h('div', { class: 'row gap' },
        h('input', { id: 'b-refine', class: 'inp', placeholder: 'Change something: “make it dark with a purple accent and add a search box”', 'aria-label': 'Refine', maxlength: 600 }),
        h('button', { class: 'btn', id: 'b-refine-go', type: 'button', onclick: () => { const v = $('#b-refine').value.trim(); if (v.length < 3) return; generate(v, 'refine').then(() => ($('#b-refine').value = '')).catch(() => {}); } }, 'Apply change'))),
      h('div', { class: 'row gap wrap between' },
        h('div', { class: 'row gap' }, ['preview', 'code'].map((t) => h('button', { class: 'chip-s', type: 'button', 'data-tab': t, onclick: () => { tab = t; show(); } }, t === 'preview' ? 'Preview' : 'Code'))),
        h('div', { class: 'row gap', id: 'b-devs' }, [['mobile', 'Mobile'], ['tablet', 'Tablet'], ['desktop', 'Desktop']].map(([d, n]) => h('button', { class: 'chip-s', type: 'button', 'data-dev': d, 'aria-pressed': String(d === device), onclick: () => { device = d; $$('[data-dev]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dev === d))); renderFrame(); } }, n)))),
      h('div', { id: 'b-previewpane' }, frameBox),
      h('div', { id: 'b-codepane', hidden: true }, codeBox, h('button', { class: 'btn ghost', id: 'b-run', type: 'button', onclick: () => { autoDepth = 0; state.html = codeBox.value; persist(); renderFrame(); toast('Preview updated'); } }, 'Run edited code')),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn ghost', id: 'b-dl-html', type: 'button', onclick: () => download('index.html', state.html, 'text/html') }, 'Download .html'),
        h('button', { class: 'btn ghost', id: 'b-dl-zip', type: 'button', onclick: () => download('app.zip', zip([{ name: 'index.html', data: state.html }, { name: 'README.md', data: readme(titleOf(state.html)) }])) }, 'Download .zip'),
        h('button', { class: 'btn ghost', id: 'b-copy', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(state.html); toast('Copied'); } catch (_) { toast('Copy failed. Select the code and copy manually.', 'error'); } } }, 'Copy code')),
      h('label', { class: 'row gap muted' }, h('input', { id: 'b-autofix', type: 'checkbox', checked: store.get('autofix', false), onchange: (e) => store.set('autofix', e.target.checked) }), 'Auto-fix runtime errors (one attempt)'),
      h('details', { class: 'card', id: 'b-help' }, h('summary', null, 'How do I publish this for free?'), h('ol', { class: 'sources' }, h('li', null, 'Download the .zip and unzip it.'), h('li', null, 'Cloudflare: Workers & Pages → Create → Pages → Upload assets → drop the folder.'), h('li', null, 'Or Netlify Drop: drag the folder onto app.netlify.com/drop.'), h('li', null, 'Or GitHub Pages: commit index.html to a repo and enable Pages.'))),
      h('h3', null, 'Versions'), h('div', { class: 'row gap wrap', id: 'b-versions' })));
  show(); renderVersions();
}
