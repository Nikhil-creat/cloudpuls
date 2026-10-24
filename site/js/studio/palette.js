import { h, $ } from './core.js';
const TOOLS = [['build', 'Build'], ['image', 'Images'], ['research', 'Research'], ['tasks', 'Tasks'], ['knowledge', 'Knowledge'], ['automations', 'Automations'], ['activity', 'Activity'], ['settings', 'Settings']];
const CMDS = [...TOOLS.map(([id, n]) => ['Go to ' + n, () => { location.hash = id; }]), ['Open agent', () => { const a = $('#agent'); a.hidden = false; $('#ag-in').focus(); }], ['Go to home page', () => { location.href = './'; }]];
let pal = null, prev = null, sel = 0, shown = CMDS;
function close() { if (!pal) return; pal.remove(); pal = null; if (prev && prev.focus) prev.focus(); }
function paint(ul) { ul.replaceChildren(...shown.map((c, i) => h('li', { role: 'option', 'aria-selected': String(i === sel), onclick: () => { close(); c[1](); } }, c[0]))); }
function open() {
  if (pal) return; prev = document.activeElement; sel = 0; shown = CMDS;
  const inp = h('input', { placeholder: 'Type a command…', 'aria-label': 'Command' }), ul = h('ul', { role: 'listbox' });
  pal = h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette', onmousedown: (e) => { if (e.target === pal) close(); } }, h('div', null, inp, ul));
  document.body.append(pal); paint(ul); inp.focus();
  inp.addEventListener('input', () => { const q = inp.value.toLowerCase(); shown = CMDS.filter((c) => c[0].toLowerCase().includes(q)); sel = 0; paint(ul); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); paint(ul); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(ul); }
    else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); const f = shown[sel][1]; close(); f(); }
    else if (e.key === 'Escape') close(); else if (e.key === 'Tab') e.preventDefault();
  });
}
export function startPalette() {
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal ? close() : open(); } });
}
