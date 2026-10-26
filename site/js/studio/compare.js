import { h, $, store, toast, clip, logEvent } from './core.js';
import { llmStream } from './llm.js';

export const id = 'compare', title = 'Compare';
const PRESETS = ['Explain semantic caching in two sentences', 'Write a Python function that merges overlapping intervals', 'Give three risks of letting AI agents change cloud infrastructure', 'Summarize the pros and cons of microservices for a 3-person team'];
const NAMES = { groq: 'Groq', gemini: 'Gemini' };
let tally = store.get('arena', { groq: 0, gemini: 0, tie: 0 }), score;

const card = (p) => h('article', { class: 'card', id: 'c-' + p }, h('div', { class: 'row between' }, h('h3', null, NAMES[p]), h('span', { class: 'muted', id: 'c-' + p + '-meta' })), h('div', { id: 'c-' + p + '-out', class: 'answer' }, h('p', { class: 'muted' }, 'Waiting for a prompt.')));
function renderScore() { if (score) score.textContent = `Your votes: Groq ${tally.groq} · Gemini ${tally.gemini} · Tie ${tally.tie}`; }
async function runOne(p, prompt) {
  const out = $('#c-' + p + '-out'), meta = $('#c-' + p + '-meta'); out.replaceChildren(h('p', { class: 'muted' }, 'Thinking…')); meta.textContent = '';
  const t0 = performance.now();
  try {
    const pre = h('pre', { class: 'vision' }); out.replaceChildren(pre);
    const r = await llmStream('compare', [{ role: 'user', content: prompt }], { provider: p, onToken: (t, all) => { pre.textContent = all; } }); const ms = Math.round(performance.now() - t0), tokens = Math.round(r.text.length / 4);
    pre.textContent = r.text.trim(); meta.textContent = `${(ms / 1000).toFixed(1)}s · ~${tokens} tokens · ${r.model || ''}`; return { ok: true, ms };
  } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); return { ok: false }; }
}
export function mount(root) {
  score = h('span', { id: 'c-score', class: 'muted' });
  const prompt = h('textarea', { id: 'c-prompt', class: 'inp', rows: 3, maxlength: 2500, placeholder: 'Ask both models the same thing…', 'aria-label': 'Prompt to compare' });
  const vote = (k, label) => h('button', { class: 'btn sm ghost', type: 'button', 'data-vote': k, onclick: () => { tally[k]++; store.set('arena', tally); renderScore(); logEvent('compare', `Voted ${label}`); } }, label);
  root.append(
    h('header', { class: 'phead' }, h('h2', null, 'Model arena'), h('p', { class: 'muted' }, 'Send one prompt to Groq and Gemini at the same time. Compare quality and speed, then vote. Uses your server keys or your own keys.')),
    h('section', { class: 'card' }, prompt, h('div', { class: 'row gap wrap' }, PRESETS.map((x) => h('button', { class: 'chip-s', type: 'button', onclick: () => { prompt.value = x; } }, clip(x, 34)))),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn', id: 'c-run', type: 'button', onclick: async (e) => {
        const v = prompt.value.trim(); if (v.length < 3) return toast('Write a prompt first', 'error'); e.target.disabled = true;
        const res = await Promise.all([runOne('groq', v), runOne('gemini', v)]); logEvent('compare', `Compared: ${clip(v, 60)}`);
        if (res.every((r) => r.ok)) toast(res[0].ms < res[1].ms ? 'Groq answered faster' : 'Gemini answered faster'); e.target.disabled = false; } }, 'Compare'))),
    h('div', { class: 'grid2' }, card('groq'), card('gemini')),
    h('div', { class: 'row gap wrap' }, h('b', null, 'Which was better?'), vote('groq', 'Groq'), vote('gemini', 'Gemini'), vote('tie', 'Tie'), score));
  renderScore();
}
