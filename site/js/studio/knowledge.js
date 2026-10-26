import { h, $, uid, nowIso, clip, dbAll, dbPut, dbDel, bm25, md, logEvent, emit, toast } from './core.js';
import { llm, llmJson } from './llm.js';

export const id = 'knowledge', title = 'Knowledge';
let docs = [], list, searchBox, answerBox, query = '';

export async function kbAll() { docs = (await dbAll('kb')).sort((a, b) => b.t.localeCompare(a.t)); return docs; }
export async function kbAdd({ title: t, text, source = 'note', tags = [], summary = '' }, meta = {}) {
  await kbAll();
  const d = { id: uid(), t: nowIso(), title: clip(t || 'Untitled', 120), text: String(text).slice(0, 200000), source, tags, summary };
  await dbPut('kb', d); docs.unshift(d);
  logEvent('kb', `Added “${d.title}” (${source})`);
  emit('kb:added', { doc: d, auto: meta.auto });
  render(); return d;
}
export async function kbSearch(q, k = 4) { await kbAll(); return bm25(docs, q, k).map((x) => ({ id: x.item.id, title: x.item.title, text: x.item.text.slice(0, 1200), score: +x.score.toFixed(2) })); }
export async function kbSummarize(docId) {
  await kbAll(); const d = docs.find((x) => x.id === docId); if (!d) throw new Error('Document not found');
  const { json } = await llmJson('summarize', [{ role: 'user', content: `Title: ${d.title}\n\n${d.text.slice(0, 15000)}` }]);
  d.summary = clip(json.summary || '', 400); d.tags = (json.tags || []).slice(0, 5).map((s) => String(s).toLowerCase().slice(0, 24));
  await dbPut('kb', d); logEvent('kb', `Summarized “${d.title}”`); emit('kb:summarized', { doc: d }); render(); return d;
}
async function kbDelete(docId) { await dbDel('kb', docId); docs = docs.filter((d) => d.id !== docId); logEvent('kb', 'Deleted a document'); render(); }

const chunks = (d) => { const out = []; for (let i = 0; i < d.text.length; i += 900) out.push({ title: d.title, text: d.text.slice(i, i + 1000) }); return out.length ? out : [{ title: d.title, text: '' }]; };
export async function kbAsk(q) {
  await kbAll(); const top = bm25(docs.flatMap(chunks), q, 4);
  if (!top.length) return { text: 'Nothing in your knowledge base matches that yet. Add notes or documents first.', sources: [] };
  const src = top.map((x, i) => `[${i + 1}] ${x.item.title}: ${x.item.text}`).join('\n\n');
  const out = await llm('research', [{ role: 'user', content: `Question: ${q}\n\nSources:\n${src}` }]);
  return { text: out.text, sources: top.map((x) => x.item.title) };
}

async function addFiles(files) {
  for (const f of files) {
    if (f.size > 400000) { toast(`${f.name} is larger than 400 KB and was skipped.`, 'error'); continue; }
    if (!/\.(txt|md|markdown|json|csv|log|html?)$/i.test(f.name) && !f.type.startsWith('text/')) { toast(`${f.name}: only text files are supported.`, 'error'); continue; }
    await kbAdd({ title: f.name, text: await f.text(), source: 'file' });
  }
}

function render() {
  if (!list) return;
  const shown = query ? bm25(docs, query, 50).map((x) => x.item) : docs;
  list.replaceChildren(...(shown.length ? shown.map(card) : [h('p', { class: 'muted' }, query ? 'No matches.' : 'No documents yet. Add a note, import a text file, or save research here.')]));
  const c = $('#k-count'); if (c) c.textContent = `${docs.length} document${docs.length === 1 ? '' : 's'}`;
}
const card = (d) => h('article', { class: 'card doc', 'data-id': d.id },
  h('div', { class: 'row between' }, h('h3', null, d.title), h('span', { class: 'chip-s' }, d.source)),
  d.summary ? h('p', { class: 'muted' }, d.summary) : h('p', { class: 'muted' }, clip(d.text, 160)),
  h('div', { class: 'row gap wrap' }, d.tags.map((t) => h('span', { class: 'tag' }, '#' + t)),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'summarize', onclick: async (e) => { e.target.disabled = true; try { await kbSummarize(d.id); toast('Summarized'); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; } } }, 'Summarize with AI'),
    h('button', { class: 'btn sm ghost danger', type: 'button', 'data-act': 'delete', onclick: () => kbDelete(d.id) }, 'Delete')));

export function mount(root) {
  const t = h('input', { id: 'k-title', class: 'inp', placeholder: 'Title', 'aria-label': 'Note title', maxlength: 120 });
  const x = h('textarea', { id: 'k-text', class: 'inp', rows: 4, placeholder: 'Paste notes, meeting minutes, docs…', 'aria-label': 'Note text' });
  searchBox = h('input', { id: 'k-search', class: 'inp', type: 'search', placeholder: 'Search your knowledge base…', 'aria-label': 'Search', oninput: (e) => { query = e.target.value; render(); } });
  answerBox = h('div', { id: 'k-answer', class: 'answer', 'aria-live': 'polite' });
  list = h('div', { id: 'k-list', class: 'stack' });
  root.append(
    h('header', { class: 'phead' }, h('h2', null, 'Knowledge base'), h('p', { class: 'muted' }, 'Notes and documents stay in this browser. Ask questions with citations, and let automations summarize new documents.')),
    h('div', { class: 'grid2' },
      h('section', { class: 'card' }, h('h3', null, 'Add'), t, x,
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn', id: 'k-add', type: 'button', onclick: async () => { if (!x.value.trim()) return toast('Write something first', 'error'); await kbAdd({ title: t.value || x.value.slice(0, 40), text: x.value }); t.value = x.value = ''; } }, 'Add note'),
          h('label', { class: 'btn ghost filebtn' }, 'Import files', h('input', { id: 'k-file', type: 'file', multiple: true, accept: '.txt,.md,.markdown,.json,.csv,.log,.html,.htm,text/*', onchange: async (e) => { await addFiles([...e.target.files]); e.target.value = ''; } })))),
      h('section', { class: 'card' }, h('h3', null, 'Ask your knowledge base'),
        h('div', { class: 'row gap' }, h('input', { id: 'k-q', class: 'inp', placeholder: 'e.g. What did we decide about pricing?', 'aria-label': 'Question' }),
          h('button', { class: 'btn', id: 'k-ask', type: 'button', onclick: async (e) => { const q = $('#k-q').value.trim(); if (!q) return; e.target.disabled = true; answerBox.replaceChildren(h('p', { class: 'muted' }, 'Thinking…')); try { const r = await kbAsk(q); answerBox.replaceChildren(md(r.text), r.sources.length ? h('p', { class: 'muted' }, 'Sources: ' + r.sources.join(' · ')) : null); logEvent('kb', `Asked: ${clip(q, 80)}`); } catch (err) { answerBox.replaceChildren(h('p', { class: 'err' }, err.message)); } e.target.disabled = false; } }, 'Ask')), answerBox)),
    h('div', { class: 'row between' }, searchBox, h('span', { id: 'k-count', class: 'muted' })), list);
  kbAll().then(render);
}
