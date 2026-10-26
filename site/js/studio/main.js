import { $, h } from './core.js';
import { probe, capabilities } from './llm.js';
import * as build from './build.js';
import * as image from './image.js';
import * as research from './research.js';
import * as compare from './compare.js';
import * as tasks from './tasks.js';
import * as knowledge from './knowledge.js';
import * as automations from './automations.js';
import * as activity from './activity.js';
import * as settings from './settings.js';
import { mountAgent } from './agent.js';
import { startPalette } from './palette.js';

const PANELS = [build, image, research, compare, tasks, knowledge, automations, activity, settings];
const route = () => {
  const id = (location.hash || '#build').slice(1), cur = PANELS.find((p) => p.id === id) || build;
  for (const p of PANELS) { $('#p-' + p.id).hidden = p !== cur; const a = $(`#nav a[href="#${p.id}"]`); if (a) p === cur ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); }
  document.title = `${cur.title} · CloudPulse Studio`;
};
async function boot() {
  await probe(); const caps = capabilities(), main = $('#panel');
  for (const p of PANELS) { const sec = h('section', { id: 'p-' + p.id, class: 'panel', hidden: true, 'aria-label': p.title }); main.append(sec); p.mount(sec); }
  $('#nav').append(...PANELS.map((p) => h('a', { href: '#' + p.id }, p.title)));
  $('#cap-badges').append(h('span', { class: 'cap ' + (caps.llm && caps.modes ? 'on' : 'off') }, (caps.llm && caps.modes ? '● ' : '○ ') + 'Server AI'), h('span', { class: 'cap ' + (caps.research ? 'on' : 'off') }, (caps.research ? '● ' : '○ ') + 'Web research'), h('span', { class: 'cap ' + (caps.image ? 'on' : 'off') }, (caps.image ? '● ' : '○ ') + 'Images'));
  mountAgent($('#agent')); startPalette(); tasks.startReminders(); automations.startAutomations();
  $('#open-agent').addEventListener('click', () => { const a = $('#agent'); a.hidden = !a.hidden; if (!a.hidden) $('#ag-in').focus(); });
  addEventListener('hashchange', route); route();
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); $('#open-agent').click(); } });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.documentElement.dataset.ready = '1';
}
boot();
