import { h, $, store, logEvent, emit, toast, md, clip, safeUrl } from './core.js';
import { llm, llmJson, researchWeb, capabilities } from './llm.js';
import { kbAdd, kbAsk } from './knowledge.js';
import { planFrom } from './tasks.js';

export const id = 'research', title = 'Research';
let last = null, out, history = store.get('research', []);
const WIKI = 'https://en.wikipedia.org/w/api.php';

async function wiki(q) {
  const s = await (await fetch(`${WIKI}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json&origin=*`)).json();
  const titles = ((s.query && s.query.search) || []).map((x) => x.title); if (!titles.length) return [];
  const e = await (await fetch(`${WIKI}?action=query&prop=extracts&exintro=1&explaintext=1&exlimit=4&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`)).json();
  return Object.values((e.query && e.query.pages) || {}).filter((p) => p.extract).map((p) => ({ title: p.title, text: p.extract.slice(0, 1800), url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')) }));
}
const synth = (q, srcs) => llm('research', [{ role: 'user', content: `Question: ${q}\n\nSources:\n${srcs.map((s, i) => `[${i + 1}] ${s.title}: ${s.text}`).join('\n\n')}` }]);

export async function run(query, { mode = 'auto', deep = false, onStep = () => {} } = {}) {
  const caps = capabilities(); if (mode === 'auto') mode = caps.research ? 'web' : 'wiki';
  let res;
  if (mode === 'kb') { onStep('Searching your knowledge base…'); const r = await kbAsk(query); res = { text: r.text, sources: r.sources.map((t) => ({ title: t, url: '' })), mode }; }
  else if (mode === 'wiki') {
    onStep('Searching Wikipedia…'); const srcs = await wiki(query); if (!srcs.length) throw new Error('Wikipedia returned nothing for that query.');
    onStep(`Reading ${srcs.length} articles and writing a brief…`); const o = await synth(query, srcs); res = { text: o.text, sources: srcs.map((s) => ({ title: s.title, url: s.url })), mode };
  } else if (deep) {
    onStep('Planning sub-questions…'); const { json } = await llmJson('plan', [{ role: 'user', content: `List 3 focused research sub-questions for: ${query}` }]);
    const subs = (json.tasks || []).slice(0, 3).map((t) => t.title); const briefs = [], srcAll = [];
    for (const [i, sq] of subs.entries()) { onStep(`Researching ${i + 1}/${subs.length}: ${clip(sq, 70)}`); const r = await researchWeb(sq); briefs.push({ title: sq, text: clip(r.text, 3500) }); srcAll.push(...r.sources); }
    onStep('Writing the final report…'); const o = await synth(query, briefs);
    const seen = new Set(); res = { text: o.text, sources: srcAll.filter((s) => !seen.has(s.url) && seen.add(s.url)).slice(0, 10), subs, mode: 'web', deep: true };
  } else { onStep('Searching the web…'); const r = await researchWeb(query); res = { text: r.text, sources: r.sources, mode: 'web', grounded: r.grounded }; }
  res.query = query; res.t = new Date().toISOString(); last = res;
  history = [{ query, text: res.text, sources: res.sources, mode: res.mode, t: res.t }, ...history].slice(0, 10); store.set('research', history);
  logEvent('research', `Researched: ${clip(query, 70)} (${res.mode}${res.deep ? ', deep' : ''})`); emit('research:done', { query });
  return res;
}
const show = (res) => {
  out.replaceChildren(h('article', { class: 'card', id: 'r-card' }, md(res.text),
    res.subs ? h('p', { class: 'muted' }, 'Sub-questions: ' + res.subs.join(' · ')) : null,
    res.sources.length ? h('div', null, h('h4', null, 'Sources'), h('ol', { class: 'sources' }, res.sources.map((s) => h('li', null, s.url ? h('a', { href: safeUrl(s.url), target: '_blank', rel: 'noopener noreferrer' }, s.title) : s.title)))) : null,
    res.grounded === false ? h('p', { class: 'note' }, 'Web search was unavailable, so this answer is not grounded in live sources.') : null,
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn sm', id: 'r-save', type: 'button', onclick: async () => { const d = await kbAdd({ title: 'Research: ' + clip(res.query, 80), text: res.text + '\n\nSources:\n' + res.sources.map((s) => `${s.title} ${s.url}`).join('\n'), source: 'research' }); emit('research:saved', { doc: d }); toast('Saved to knowledge base'); } }, 'Save to knowledge base'),
      h('button', { class: 'btn sm ghost', id: 'r-tasks', type: 'button', onclick: async (e) => { e.target.disabled = true; try { const r = await planFrom('Turn these research findings into next steps: ' + res.text.slice(0, 3000)); toast(`Created ${r.tasks.length} tasks`); } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; } }, 'Turn into tasks'))));
};
export function mount(root) {
  out = h('div', { id: 'r-out', 'aria-live': 'polite' }); const caps = capabilities();
  const q = h('input', { id: 'r-q', class: 'inp', placeholder: 'What do you want to find out?', 'aria-label': 'Research question', maxlength: 400 });
  const mode = h('select', { id: 'r-mode', class: 'inp narrow', 'aria-label': 'Source' }, [['auto', 'Auto'], ['web', 'Live web'], ['wiki', 'Wikipedia'], ['kb', 'My notes']].map(([v, n]) => h('option', { value: v }, n)));
  const deep = h('input', { id: 'r-deep', type: 'checkbox' }); const prog = h('span', { id: 'r-prog', class: 'muted' });
  root.append(
    h('header', { class: 'phead' }, h('h2', null, 'Research'), h('p', { class: 'muted' }, 'Grounded answers with sources. Live web search uses Gemini with Google Search through the secured server; Wikipedia and your own notes work with any AI key.')),
    caps.research ? null : h('p', { class: 'note' }, 'Live web search is not enabled on this deployment (needs a Gemini key on the server). Wikipedia and notes still work.'),
    h('section', { class: 'card' }, h('div', { class: 'row gap wrap' }, q, mode, h('label', { class: 'row gap' }, deep, 'Deep'), h('button', { class: 'btn', id: 'r-run', type: 'button', onclick: async (e) => { const v = q.value.trim(); if (v.length < 3) return; e.target.disabled = true; out.replaceChildren(); try { const res = await run(v, { mode: mode.value, deep: deep.checked, onStep: (m) => (prog.textContent = m) }); prog.textContent = ''; show(res); } catch (err) { prog.textContent = ''; out.replaceChildren(h('p', { class: 'err' }, err.message)); } e.target.disabled = false; } }, 'Research')), prog),
    out, history.length ? h('div', null, h('h3', null, 'Recent'), h('div', { class: 'row gap wrap' }, history.map((r) => h('button', { class: 'chip-s', type: 'button', onclick: () => show({ ...r, query: r.query }) }, clip(r.query, 36))))) : null);
}
