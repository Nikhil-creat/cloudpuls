import { h, $, store, toast, vaultSet, vaultGet, dbAll, dbPut, dbClear, download, logEvent } from './core.js';
import { capabilities, llm } from './llm.js';
import * as sync from './sync.js';
export const id = 'settings', title = 'Settings';
const mask = (k) => (k ? '••••' + k.slice(-4) : 'not set');
async function syncUi() {
  const code = await sync.syncCode(), st = sync.syncState(); const on = !!code;
  $('#sy-actions').hidden = !on; $('#sy-setup').hidden = on;
  $('#sy-status').textContent = on ? `Connected · cloud version ${st ? st.version : '?'}${st && st.at ? ' · last sync ' + new Date(st.at).toLocaleTimeString() : ''}` : 'Not connected.';
}
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
    h('section', { class: 'card', id: 's-sync' }, h('h3', null, 'Cloud sync (end-to-end encrypted)'),
      h('p', { class: 'muted' }, 'Keep tasks, notes, rules and settings in sync across devices. Everything is encrypted in your browser with a recovery code that never leaves it. The server stores only unreadable bytes, and nobody (including me) can recover your data without the code.'),
      caps.sync ? null : h('p', { class: 'note' }, 'Cloud sync needs the Durable Objects binding, which is not enabled on this deployment. See docs/STUDIO.md.'),
      h('p', { id: 'sy-status', class: 'muted', 'aria-live': 'polite' }),
      h('div', { id: 'sy-code-box', hidden: true, class: 'note' }, h('b', null, 'Your recovery code: '), h('code', { id: 'sy-code' }), h('p', { class: 'muted' }, 'Write it down or store it in a password manager. Anyone with this code can read and change your cloud copy, and without it your cloud data cannot be recovered.')),
      h('div', { class: 'row gap wrap', id: 'sy-setup' }, h('button', { class: 'btn', id: 'sy-create', type: 'button', disabled: !caps.sync, onclick: async (e) => { e.target.disabled = true; try { const code = await sync.createWorkspace({ images: $('#sy-img').checked }); $('#sy-code').textContent = code; $('#sy-code-box').hidden = false; toast('Workspace created and first backup uploaded'); } catch (err) { toast(err.message, 'error'); } e.target.disabled = !caps.sync; await syncUi(); } }, 'Create sync workspace'),
        h('input', { id: 'sy-input', class: 'inp', placeholder: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567', 'aria-label': 'Sync recovery code', autocomplete: 'off', spellcheck: 'false', disabled: !caps.sync }),
        h('button', { class: 'btn ghost', id: 'sy-connect', type: 'button', disabled: !caps.sync, onclick: async (e) => { e.target.disabled = true; try { await sync.connect($('#sy-input').value); toast('Connected. Reloading…'); setTimeout(() => location.reload(), 700); } catch (err) { toast(err.message, 'error'); e.target.disabled = !caps.sync; } } }, 'Connect this device')),
      h('div', { class: 'row gap wrap', id: 'sy-actions', hidden: true },
        h('label', { class: 'row gap muted' }, h('input', { id: 'sy-img', type: 'checkbox' }), 'Include images (up to 3 MB total)'),
        h('button', { class: 'btn sm', id: 'sy-push', type: 'button', onclick: async (e) => { e.target.disabled = true; try { const v = await sync.push({ images: $('#sy-img').checked }); toast(`Uploaded (version ${v})`); } catch (err) { toast(err.code === 'conflict' ? `The cloud has newer data (version ${err.version}). Pull first, or use Force push to overwrite it.` : err.message, 'error'); } e.target.disabled = false; await syncUi(); } }, 'Push to cloud'),
        h('button', { class: 'btn sm ghost', id: 'sy-pull', type: 'button', onclick: async (e) => { if (!confirm('Replace this device’s tasks, notes and settings with the cloud copy?')) return; e.target.disabled = true; try { await sync.pull(); toast('Pulled. Reloading…'); setTimeout(() => location.reload(), 700); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; } } }, 'Pull from cloud'),
        h('button', { class: 'btn sm ghost', id: 'sy-force', type: 'button', onclick: async (e) => { if (!confirm('Overwrite the cloud copy with this device’s data?')) return; e.target.disabled = true; try { const v = await sync.push({ images: $('#sy-img').checked, force: true }); toast(`Overwrote cloud (version ${v})`); } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; await syncUi(); } }, 'Force push'),
        h('button', { class: 'btn sm ghost', id: 'sy-reveal', type: 'button', onclick: async () => { $('#sy-code').textContent = await sync.syncCode(); $('#sy-code-box').hidden = !$('#sy-code-box').hidden; } }, 'Show recovery code'),
        h('button', { class: 'btn sm ghost', id: 'sy-off', type: 'button', onclick: async () => { await sync.disconnect(); toast('Disconnected from cloud sync'); await syncUi(); } }, 'Disconnect'),
        h('button', { class: 'btn sm ghost danger', id: 'sy-del', type: 'button', onclick: async () => { if (!confirm('Delete the encrypted cloud copy and disconnect?')) return; try { await sync.disconnect({ deleteCloud: true }); toast('Cloud copy deleted'); } catch (err) { toast(err.message, 'error'); } await syncUi(); } }, 'Delete cloud copy'))),
    h('section', { class: 'card' }, h('h3', null, 'Your data'), h('p', { class: 'muted' }, 'Everything lives in this browser: tasks, rules, notes, images and app versions.'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn ghost', id: 's-export', type: 'button', onclick: async () => { const local = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('cps:') && !k.startsWith('cps:v:')) local[k] = localStorage.getItem(k); } download('studio-backup.json', JSON.stringify({ v: 1, local, kb: await dbAll('kb'), images: await dbAll('images') }), 'application/json'); } }, 'Export backup'),
        h('label', { class: 'btn ghost filebtn' }, 'Import backup', h('input', { id: 's-import', type: 'file', accept: 'application/json', onchange: async (e) => { try { const d = JSON.parse(await e.target.files[0].text()); for (const [k, v] of Object.entries(d.local || {})) if (k.startsWith('cps:') && !k.startsWith('cps:v:')) localStorage.setItem(k, v); for (const r of d.kb || []) await dbPut('kb', r); for (const r of d.images || []) await dbPut('images', r); toast('Imported. Reloading…'); setTimeout(() => location.reload(), 600); } catch (_) { toast('That file is not a valid backup', 'error'); } } })),
        h('button', { class: 'btn ghost danger', id: 's-wipe', type: 'button', onclick: async () => { if (!confirm('Delete all Studio data from this browser, including saved keys?')) return; Object.keys(localStorage).filter((k) => k.startsWith('cps:')).forEach((k) => localStorage.removeItem(k)); await dbClear('kb'); await dbClear('images'); await dbClear('kv'); location.reload(); } }, 'Delete everything'))));
  refresh(); syncUi();
}
