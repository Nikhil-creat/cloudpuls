// Core utilities: safe DOM builder, storage, event bus, activity log, encrypted key vault, IndexedDB, BM25, markdown-lite.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = () => crypto.randomUUID().slice(0, 8);
export const nowIso = () => new Date().toISOString();
export const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

// DOM builder: text is always inserted as text nodes (never HTML), so model output cannot inject markup.
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
export const safeUrl = (u) => (/^https:\/\//.test(u) ? u : '#');

export const store = {
  get(k, d) { try { const v = localStorage.getItem('cps:' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('cps:' + k, JSON.stringify(v)); return true; } catch (_) { toast('Browser storage is full. Export a backup in Settings, then clear old data.', 'error'); return false; } },
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

export function toast(msg, kind = 'info') {
  const box = $('#toasts'); if (!box) return;
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg); box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

export function logEvent(type, text, data) {
  const list = store.get('activity', []);
  const entry = { id: uid(), t: nowIso(), type, text: clip(text, 200), ...(data ? { data } : {}) };
  list.unshift(entry); store.set('activity', list.slice(0, 300));
  emit('activity', entry);
}

export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

// ---------- IndexedDB ----------
let dbp;
const db = () => (dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('cps', 1);
  r.onupgradeneeded = () => { for (const s of ['kv', 'kb', 'images']) r.result.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
async function tx(store_, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store_, mode); const rq = fn(t.objectStore(store_)); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
export const dbAll = (s) => tx(s, 'readonly', (st) => st.getAll());
export const dbGet = (s, k) => tx(s, 'readonly', (st) => st.get(k));
export const dbPut = (s, v) => tx(s, 'readwrite', (st) => st.put(v));
export const dbDel = (s, k) => tx(s, 'readwrite', (st) => st.delete(k));
export const dbClear = (s) => tx(s, 'readwrite', (st) => st.clear());

// ---------- Key vault: AES-GCM with a non-extractable CryptoKey kept in IndexedDB ----------
// Keys are never stored in plaintext. Scripts cannot read the key material; only use it in this browser profile.
async function vaultKey() {
  let rec = await dbGet('kv', 'vault-key');
  if (!rec) { rec = { k: 'vault-key', key: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) }; await dbPut('kv', rec); }
  return rec.key;
}
export async function vaultSet(name, value) {
  if (!value) { localStorage.removeItem('cps:v:' + name); return; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(), new TextEncoder().encode(value)));
  localStorage.setItem('cps:v:' + name, JSON.stringify({ iv: toB64(iv), ct: toB64(ct) }));
}
export async function vaultGet(name) {
  const raw = localStorage.getItem('cps:v:' + name); if (!raw) return '';
  try { const { iv, ct } = JSON.parse(raw); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await vaultKey(), fromB64(ct))); } catch (_) { return ''; }
}

// ---------- BM25 ----------
const stem = (w) => { for (const s of ['ing', 'ly', 'ed', 'es', 's']) if (w.length > s.length + 3 && w.endsWith(s)) return w.slice(0, -s.length); return w; };
const tok = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).map(stem);
export function bm25(items, query, k = 5) {
  const docs = items.map((it) => { const t = tok(`${it.title} ${it.title} ${it.text}`); const tf = {}; t.forEach((w) => (tf[w] = (tf[w] || 0) + 1)); return { it, t, tf }; });
  if (!docs.length) return [];
  const avg = docs.reduce((a, d) => a + d.t.length, 0) / docs.length || 1, df = {};
  docs.forEach((d) => Object.keys(d.tf).forEach((w) => (df[w] = (df[w] || 0) + 1)));
  const q = tok(query);
  return docs.map((d) => { let s = 0; q.forEach((w) => { if (!d.tf[w]) return; const idf = Math.log(1 + (docs.length - df[w] + 0.5) / (df[w] + 0.5)); s += (idf * d.tf[w] * 2.5) / (d.tf[w] + 1.5 * (0.25 + (0.75 * d.t.length) / avg)); }); return { item: d.it, score: s }; })
    .filter((x) => x.score > 0.05).sort((a, b) => b.score - a.score).slice(0, k);
}

// ---------- markdown-lite (bold, bullets, paragraphs) rendered with DOM nodes ----------
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/).map((p) => (p.startsWith('**') && p.endsWith('**') ? h('strong', null, p.slice(2, -2)) : p));
}
export function md(text) {
  const box = h('div', { class: 'md' });
  for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) box.append(h('ul', null, lines.map((l) => h('li', null, inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))))));
    else box.append(h('p', null, lines.flatMap((l, i) => [i ? h('br') : null, ...inline(l)])));
  }
  return box;
}
export function extractJson(text) {
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}
