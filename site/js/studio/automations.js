import { h, $, uid, nowIso, store, on, logEvent, toast, clip } from './core.js';
import { taskCreate, COLS } from './tasks.js';
import { kbAdd, kbSummarize } from './knowledge.js';

export const id = 'automations', title = 'Automations';
const TRIGGERS = [['task:moved', 'A task moves to a column'], ['task:created', 'A task is created'], ['kb:added', 'A document is added'], ['research:saved', 'Research is saved'], ['image:made', 'An image is created'], ['app:built', 'An app is built'], ['schedule', 'On a schedule (while this tab is open)']];
const ACTIONS = [['notify', 'Show a notification'], ['create_task', 'Create a task'], ['add_note', 'Add a note to the knowledge base'], ['summarize', 'Summarize the new document with AI'], ['agent', 'Run the agent with a prompt']];
const PRESETS = [
  { name: 'Summarize every new document', trigger: { type: 'kb:added' }, action: { type: 'summarize', text: '' } },
  { name: 'Celebrate finished tasks', trigger: { type: 'task:moved', col: 'done' }, action: { type: 'notify', text: 'Done: {title}. Nice work!' } },
  { name: 'Follow up on new research', trigger: { type: 'research:saved' }, action: { type: 'create_task', text: 'Review research: {title}' } },
  { name: 'Hourly review reminder', trigger: { type: 'schedule', every: 60 }, action: { type: 'notify', text: 'Time to review your board.' } },
];
let rules = store.get('rules', []), listEl; const timers = new Map(); let recent = [];
const save = () => store.set('rules', rules);
const fill = (tpl, ctx) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (ctx[k] == null ? '' : String(ctx[k])));

function ctxOf(type, e) {
  if (type.startsWith('task:')) return { title: e.task.title, col: e.to || e.task.col, from: e.from || '', to: e.to || e.task.col, text: e.task.detail };
  if (e.doc) return { title: e.doc.title, text: clip(e.doc.text, 800) };
  if (type === 'image:made') return { title: e.prompt, text: e.prompt };
  if (type === 'app:built') return { title: e.title, text: e.prompt };
  return {};
}
async function execute(rule, ctx, evt) {
  const a = rule.action;
  try {
    if (a.type === 'notify') { const m = fill(a.text, ctx) || rule.name; toast(m); if ('Notification' in window && Notification.permission === 'granted') new Notification(rule.name, { body: m }); }
    else if (a.type === 'create_task') taskCreate({ title: fill(a.text, ctx) || rule.name }, { auto: rule.id });
    else if (a.type === 'add_note') await kbAdd({ title: fill(a.title, ctx) || rule.name, text: fill(a.text, ctx) || rule.name, source: 'automation' }, { auto: rule.id });
    else if (a.type === 'summarize') { if (!(evt && evt.doc)) throw new Error('Summarize needs a document trigger'); await kbSummarize(evt.doc.id); }
    else if (a.type === 'agent') { const { runAgent } = await import('./agent.js'); await runAgent(fill(a.text, ctx)); }
    rule.runs = (rule.runs || 0) + 1; rule.last = nowIso(); save(); logEvent('automation', `“${rule.name}” ran`); render();
  } catch (e) { logEvent('automation', `“${rule.name}” failed: ${e.message}`); toast(`Automation failed: ${e.message}`, 'error'); }
}
function fire(rule, ctx, evt) {
  if (!rule.enabled || (evt && evt.auto === rule.id)) return;
  const t = Date.now(); recent = recent.filter((x) => t - x < 60000);
  if (recent.length >= 20) return toast('Automation rate limit reached (20 per minute)', 'error');
  recent.push(t); execute(rule, ctx, evt);
}
function syncTimers() {
  timers.forEach((t) => clearInterval(t)); timers.clear();
  for (const r of rules) if (r.enabled && r.trigger.type === 'schedule') timers.set(r.id, setInterval(() => fire(r, { now: new Date().toLocaleString() }, null), Math.max(1, Number(r.trigger.every) || 60) * 60000));
}
export function startAutomations() {
  for (const [type] of TRIGGERS) if (type !== 'schedule') on(type, (e) => { for (const r of rules) if (r.trigger.type === type && (type !== 'task:moved' || !r.trigger.col || r.trigger.col === e.to)) fire(r, ctxOf(type, e), e); });
  syncTimers();
}
const addRule = (r) => { rules.push({ id: uid(), enabled: true, runs: 0, ...r }); save(); syncTimers(); render(); logEvent('automation', `Created “${r.name}”`); };
const label = (list, v) => (list.find((x) => x[0] === v) || [v, v])[1];

function render() {
  if (!listEl) return;
  listEl.replaceChildren(...(rules.length ? rules.map((r) => h('article', { class: 'card rule', 'data-id': r.id },
    h('div', { class: 'row between' }, h('b', null, r.name), h('label', { class: 'row gap' }, h('input', { type: 'checkbox', class: 'r-toggle', checked: r.enabled, 'aria-label': 'Enabled', onchange: (e) => { r.enabled = e.target.checked; save(); syncTimers(); } }), 'Enabled')),
    h('p', { class: 'muted' }, `When: ${label(TRIGGERS, r.trigger.type)}${r.trigger.col ? ' → ' + label(COLS, r.trigger.col) : ''}${r.trigger.every ? ` every ${r.trigger.every} min` : ''}. Then: ${label(ACTIONS, r.action.type)}${r.action.text ? ' “' + clip(r.action.text, 60) + '”' : ''}.`),
    h('div', { class: 'row gap wrap' }, h('span', { class: 'muted' }, `${r.runs || 0} runs${r.last ? ' · last ' + new Date(r.last).toLocaleTimeString() : ''}`), h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'run', onclick: () => fire({ ...r, enabled: true }, { title: 'Sample item', text: 'Sample text', col: 'Done', from: 'In progress', to: 'Done', now: new Date().toLocaleString() }, null) }, 'Run now'),
      h('button', { class: 'btn sm ghost danger', type: 'button', 'data-act': 'delete', onclick: () => { rules = rules.filter((x) => x.id !== r.id); save(); syncTimers(); render(); } }, 'Delete')))) : [h('p', { class: 'muted' }, 'No automations yet. Add a preset or build your own.')]));
}
export function mount(root) {
  listEl = h('div', { id: 'a-list', class: 'stack' });
  const name = h('input', { id: 'a-name', class: 'inp', placeholder: 'Rule name', 'aria-label': 'Rule name', maxlength: 80 });
  const trig = h('select', { id: 'a-trigger', class: 'inp', 'aria-label': 'Trigger' }, TRIGGERS.map(([v, n]) => h('option', { value: v }, n)));
  const col = h('select', { id: 'a-col', class: 'inp narrow', 'aria-label': 'Column' }, [['', 'Any column'], ...COLS].map(([v, n]) => h('option', { value: v }, n)));
  const every = h('input', { id: 'a-every', class: 'inp narrow', type: 'number', min: 1, max: 1440, value: 60, 'aria-label': 'Minutes' });
  const act = h('select', { id: 'a-action', class: 'inp', 'aria-label': 'Action' }, ACTIONS.map(([v, n]) => h('option', { value: v }, n)));
  const text = h('input', { id: 'a-text', class: 'inp', placeholder: 'Message or prompt. Variables: {title} {text} {col} {to} {from} {now}', 'aria-label': 'Action text', maxlength: 300 });
  const sync = () => { col.hidden = trig.value !== 'task:moved'; every.hidden = trig.value !== 'schedule'; }; trig.addEventListener('change', sync); sync();
  root.append(
    h('header', { class: 'phead' }, h('h2', null, 'Automations'), h('p', { class: 'muted' }, 'If this happens, do that. Rules run in your browser while Studio is open, and every run is logged. Limited to 20 runs per minute.')),
    h('section', { class: 'card' }, h('h3', null, 'Presets'), h('div', { class: 'row gap wrap' }, PRESETS.map((p) => h('button', { class: 'chip-s', type: 'button', 'data-preset': p.name, onclick: () => addRule(JSON.parse(JSON.stringify(p))) }, p.name)))),
    h('section', { class: 'card' }, h('h3', null, 'New rule'), name, h('div', { class: 'row gap wrap' }, trig, col, every), h('div', { class: 'row gap wrap' }, act), text,
      h('button', { class: 'btn', id: 'a-add', type: 'button', onclick: () => { if (!name.value.trim()) return toast('Name the rule', 'error'); addRule({ name: name.value.trim(), trigger: { type: trig.value, ...(trig.value === 'task:moved' && col.value ? { col: col.value } : {}), ...(trig.value === 'schedule' ? { every: Number(every.value) || 60 } : {}) }, action: { type: act.value, text: text.value } }); name.value = text.value = ''; } }, 'Add rule')),
    listEl);
  render();
}
