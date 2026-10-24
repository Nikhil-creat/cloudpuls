import { h, $, store, toast, vaultSet, vaultGet, dbAll, dbPut, dbClear, download, logEvent } from './core.js';
import { capabilities, llm } from './llm.js';
export const id = 'settings', title = 'Settings';
const mask = (k) => (k ? '••••' + k.slice(-4) : 'not set');
async function refresh() { const g = await vaultGet('groq'), m = await vaultGet('gemini'); $('#s-status').textContent = `Groq key: ${mask(g)} · Gemini key: ${mask(m)} (encrypted on this device)`; }

export function mount(root) {
  const caps = capabilities(), badge = (ok, t) => h('span', { class: 'cap ' + (ok ? 'on' : 'off') }, (ok ? '● ' : '○ ') + t);
  root.append(
    h('header', { class: 'phead' }, h('h2', null, 'Settings'), h('p', { class: 'muted' }, 'Connect AI, manage your data, and see what this deployment can do.')),
    h('section', { class: 'card' }, h('h3', null, 'This deployment'), h('div', { class: 'row gap wrap', id: 's-caps' }, badge(caps.llm && caps.modes, 'Server AI (keys held server-side)'), badge(caps.research, 'Live web research'), badge(caps.image, 'AI image generation')),
      h('p', { class: 'muted' }, 'When server AI is on, you do not need your own key. Your own keys are used if the server is unavailable or you prefer them.')),
    h('section', { class: 'card' }, h('h3', null, 'Your own API keys (optional)'),
      h('p', { class: 'muted' }, 'Free keys: Groq at console.groq.com/keys and Gemini at aistudio.google.com/apikey. Keys are encrypted with a non-extractable key and stay in this browser.'),
      h('input', { id: 's-groq', class: 'inp', type: 'password', placeholder: 'Groq key (gsk_…)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Groq API key' }),
      h('input', { id: 's-gem', class: 'inp', type: 'password', placeholder: 'Gemini key (AIza…)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Gemini API key' }),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', id: 's-save', type: 'button', onclick: async () => { const g = $('#s-groq').value.trim(), m = $('#s-gem').value.trim(); if (g) await vaultSet('groq', g); if (m) await vaultSet('gemini', m); $('#s-groq').value = $('#s-gem').value = ''; await refresh(); logEvent('settings', 'Saved API keys to the encrypted vault'); toast('Saved'); } }, 'Save keys'),
        h('button', { class: 'btn ghost', id: 's-clear', type: 'button', onclick: async () => { await vaultSet('groq', ''); await vaultSet('gemini', ''); await refresh(); toast('Keys removed'); } }, 'Remove keys'),
        h('button', { class: 'btn ghost', id: 's-test', type: 'button', onclick: async (e) => { e.target.disabled = true; $('#s-result').textContent = 'Testing…'; try { const r = await llm('imageprompt', [{ role: 'user', content: 'a red fox' }]); $('#s-result').textContent = `Connected via ${r.provider}${r.model ? ' (' + r.model + ')' : ''} in ${r.ms} ms`; } catch (err) { $('#s-result').textContent = err.message; } e.target.disabled = false; } }, 'Test connection')),
      h('p', { id: 's-status', class: 'muted', 'aria-live': 'polite' }), h('p', { id: 's-result', class: 'muted', 'aria-live': 'polite' }),
      h('label', { class: 'row gap' }, 'Prefer', h('select', { id: 's-provider', class: 'inp narrow', 'aria-label': 'Provider preference', onchange: (e) => store.set('provider', e.target.value) }, [['auto', 'Server first'], ['byo', 'My keys first']].map(([v, n]) => h('option', { value: v, selected: store.get('provider', 'auto') === v }, n))))),
    h('section', { class: 'card' }, h('h3', null, 'Your data'), h('p', { class: 'muted' }, 'Everything lives in this browser: tasks, rules, notes, images and app versions.'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn ghost', id: 's-export', type: 'button', onclick: async () => { const local = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('cps:') && !k.startsWith('cps:v:')) local[k] = localStorage.getItem(k); } download('studio-backup.json', JSON.stringify({ v: 1, local, kb: await dbAll('kb'), images: await dbAll('images') }), 'application/json'); } }, 'Export backup'),
        h('label', { class: 'btn ghost filebtn' }, 'Import backup', h('input', { id: 's-import', type: 'file', accept: 'application/json', onchange: async (e) => { try { const d = JSON.parse(await e.target.files[0].text()); for (const [k, v] of Object.entries(d.local || {})) if (k.startsWith('cps:') && !k.startsWith('cps:v:')) localStorage.setItem(k, v); for (const r of d.kb || []) await dbPut('kb', r); for (const r of d.images || []) await dbPut('images', r); toast('Imported. Reloading…'); setTimeout(() => location.reload(), 600); } catch (_) { toast('That file is not a valid backup', 'error'); } } })),
        h('button', { class: 'btn ghost danger', id: 's-wipe', type: 'button', onclick: async () => { if (!confirm('Delete all Studio data from this browser, including saved keys?')) return; Object.keys(localStorage).filter((k) => k.startsWith('cps:')).forEach((k) => localStorage.removeItem(k)); await dbClear('kb'); await dbClear('images'); await dbClear('kv'); location.reload(); } }, 'Delete everything'))));
  refresh();
}
