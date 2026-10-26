import { h, $, store, on, download } from './core.js';
export const id = 'activity', title = 'Activity';
let listEl, filter = 'all';
const TYPES = ['all', 'build', 'image', 'research', 'task', 'kb', 'automation', 'agent'];
function render() {
  if (!listEl) return;
  const all = store.get('activity', []), rows = all.filter((e) => filter === 'all' || e.type === filter);
  listEl.replaceChildren(...(rows.length ? rows.map((e) => h('div', { class: 'logrow', 'data-type': e.type }, h('time', { class: 'muted' }, new Date(e.t).toLocaleString()), h('span', { class: 'chip-s' }, e.type), h('span', null, e.text))) : [h('p', { class: 'muted' }, 'Nothing yet. Actions across Studio are recorded here.')]));
  const c = $('#act-count'); if (c) c.textContent = `${rows.length} of ${all.length} events`;
}
export function mount(root) {
  listEl = h('div', { id: 'act-list', class: 'stack' });
  root.append(h('header', { class: 'phead' }, h('h2', null, 'Activity'), h('p', { class: 'muted' }, 'A local timeline of everything you and the agent do. Stored in this browser only.')),
    h('div', { class: 'row gap wrap' }, TYPES.map((t) => h('button', { class: 'chip-s', type: 'button', 'data-f': t, 'aria-pressed': String(t === filter), onclick: (e) => { filter = t; root.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === t))); render(); } }, t)),
      h('span', { class: 'spacer' }), h('span', { id: 'act-count', class: 'muted' }),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => download('activity.json', JSON.stringify(store.get('activity', []), null, 2), 'application/json') }, 'Export'),
      h('button', { class: 'btn sm ghost danger', id: 'act-clear', type: 'button', onclick: () => { store.set('activity', []); render(); } }, 'Clear')), listEl);
  on('activity', render); render();
}
