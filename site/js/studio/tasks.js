import { h, $, uid, nowIso, store, logEvent, emit, toast, download, clip } from './core.js';
import { llmJson } from './llm.js';

export const id = 'tasks', title = 'Tasks';
export const COLS = [['todo', 'Backlog'], ['doing', 'In progress'], ['done', 'Done']];
let tasks = store.get('tasks', []), board, bar, filter = '';
const save = () => store.set('tasks', tasks);
export const taskList = () => tasks;

export function taskCreate({ title: t, detail = '', priority = 'medium', due = '', col = 'todo' }, meta = {}) {
  const task = { id: uid(), title: clip(String(t || 'Untitled'), 140), detail: clip(detail, 400), priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium', due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '', col, t: nowIso() };
  tasks.unshift(task); save(); logEvent('task', `Created “${task.title}”`); emit('task:created', { task, auto: meta.auto }); render(); return task;
}
export function taskMove(taskId, to, meta = {}) {
  const task = tasks.find((x) => x.id === taskId); if (!task || task.col === to) return;
  const from = task.col; task.col = to; save();
  logEvent('task', `Moved “${task.title}” to ${COLS.find((c) => c[0] === to)[1]}`); emit('task:moved', { task, from, to, auto: meta.auto }); render();
}
function taskDelete(taskId) { const t = tasks.find((x) => x.id === taskId); tasks = tasks.filter((x) => x.id !== taskId); save(); if (t) logEvent('task', `Deleted “${t.title}”`); render(); }
export async function planFrom(goal) {
  const { json } = await llmJson('plan', [{ role: 'user', content: String(goal).slice(0, 3500) }]);
  const made = []; const day = 86400000;
  let acc = 0;
  for (const t of (json.tasks || []).slice(0, 8)) { acc += Math.max(1, Math.min(30, Number(t.days) || 1)); made.push(taskCreate({ title: t.title, detail: t.detail, priority: t.priority, due: new Date(Date.now() + acc * day).toISOString().slice(0, 10) })); }
  logEvent('task', `AI plan “${clip(json.title || goal, 60)}” created ${made.length} tasks`);
  return { title: json.title, tasks: made };
}

const overdue = (t) => t.due && t.col !== 'done' && t.due < new Date().toISOString().slice(0, 10);
function render() {
  if (!board) return;
  const list = tasks.filter((t) => !filter || (t.title + t.detail).toLowerCase().includes(filter.toLowerCase()));
  board.replaceChildren(...COLS.map(([col, name]) => {
    const items = list.filter((t) => t.col === col);
    return h('section', { class: 'col', 'data-col': col, ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: (e) => e.currentTarget.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id) taskMove(id, col); } },
      h('h3', null, name, h('span', { class: 'count' }, items.length)),
      items.map((t) => card(t, col)), items.length ? null : h('p', { class: 'muted' }, 'Nothing here.'));
  }));
  const done = tasks.filter((t) => t.col === 'done').length, pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  bar.replaceChildren(h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })), h('span', { class: 'muted' }, `${done}/${tasks.length} done · ${pct}%`));
}
function card(t, col) {
  const i = COLS.findIndex((c) => c[0] === col);
  return h('article', { class: 'card task ' + (overdue(t) ? 'late' : ''), draggable: 'true', 'data-id': t.id, ondragstart: (e) => e.dataTransfer.setData('text/plain', t.id) },
    h('div', { class: 'row between' }, h('b', null, t.title), h('span', { class: 'pri ' + t.priority }, t.priority)),
    t.detail ? h('p', { class: 'muted' }, t.detail) : null,
    t.due ? h('p', { class: 'muted' }, (overdue(t) ? 'Overdue · ' : 'Due ') + t.due) : null,
    h('div', { class: 'row gap' },
      h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Move left', disabled: i === 0, onclick: () => taskMove(t.id, COLS[i - 1][0]) }, '←'),
      h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Move right', disabled: i === COLS.length - 1, onclick: () => taskMove(t.id, COLS[i + 1][0]) }, '→'),
      h('span', { class: 'spacer' }), h('button', { class: 'btn sm ghost danger', type: 'button', 'aria-label': 'Delete task', onclick: () => taskDelete(t.id) }, 'Delete')));
}

export function startReminders() {
  setInterval(() => {
    const today = new Date().toISOString().slice(0, 10), seen = store.get('notified', {});
    for (const t of tasks) if (t.col !== 'done' && t.due && t.due <= today && !seen[t.id]) {
      seen[t.id] = 1; store.set('notified', seen); toast(`Task due: ${t.title}`);
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Task due', { body: t.title });
    }
  }, 30000);
}

export function mount(root) {
  board = h('div', { class: 'board', id: 't-board' }); bar = h('div', { class: 'progress', id: 't-bar' });
  const ti = h('input', { id: 't-title', class: 'inp', placeholder: 'New task…', 'aria-label': 'Task title', maxlength: 140 });
  const pr = h('select', { id: 't-pri', class: 'inp narrow', 'aria-label': 'Priority' }, ['medium', 'high', 'low'].map((p) => h('option', { value: p }, p)));
  const du = h('input', { id: 't-due', class: 'inp narrow', type: 'date', 'aria-label': 'Due date' });
  const goal = h('input', { id: 't-goal', class: 'inp', placeholder: 'Describe a goal and let AI plan the tasks…', 'aria-label': 'Goal for AI planning', maxlength: 400 });
  root.append(
    h('header', { class: 'phead' }, h('h2', null, 'Tasks'), h('p', { class: 'muted' }, 'Track work on a board. Drag cards, or use the arrows on mobile. Automations can react to moves.')),
    h('div', { class: 'row gap wrap' }, ti, pr, du, h('button', { class: 'btn', id: 't-add', type: 'button', onclick: () => { if (!ti.value.trim()) return; taskCreate({ title: ti.value, priority: pr.value, due: du.value }); ti.value = ''; } }, 'Add')),
    h('div', { class: 'row gap' }, goal, h('button', { class: 'btn', id: 't-plan', type: 'button', onclick: async (e) => { if (!goal.value.trim()) return; e.target.disabled = true; try { const r = await planFrom(goal.value); toast(`Created ${r.tasks.length} tasks`); goal.value = ''; } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; } }, 'AI plan')),
    h('div', { class: 'row gap wrap' }, h('input', { class: 'inp', type: 'search', placeholder: 'Filter…', 'aria-label': 'Filter tasks', oninput: (e) => { filter = e.target.value; render(); } }), bar,
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { if ('Notification' in window) { const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Reminders enabled' : 'Notifications blocked'); } } }, 'Enable reminders'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => download('tasks.json', JSON.stringify(tasks, null, 2), 'application/json') }, 'Export JSON')),
    board);
  render();
}
