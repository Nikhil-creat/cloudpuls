// End-to-end-encrypted cloud sync. A random 160-bit recovery code is the only secret.
// HKDF derives (1) the workspace id, (2) a write-auth token and (3) an AES-256-GCM key. The server stores ciphertext only.
import { store, vaultGet, vaultSet, dbAll, dbPut, dbClear, toB64, fromB64, logEvent } from './core.js';
import { capabilities } from './llm.js';

const enc = new TextEncoder(), B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', SALT = enc.encode('cloudpulse-sync-v1');
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (u) => toB64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20)); let bits = '', out = '';
  for (const x of bytes) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i < 160; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g).join('-');
}
export function parseCode(s) {
  const c = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (c.length !== 32) throw new Error('A sync code has 32 letters and digits (8 groups of 4).');
  let bits = ''; for (const ch of c) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  return Uint8Array.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
async function derive(code) {
  const base = await crypto.subtle.importKey('raw', parseCode(code), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const bits = async (info) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) }, base, 256));
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode('enc') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { id: hex((await bits('id')).slice(0, 16)), auth: b64url(await bits('auth')), key };
}
const gz = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const gunzip = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());

export async function snapshot({ images = false } = {}) {
  const local = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('cps:') && !k.startsWith('cps:v:') && k !== 'cps:sync') local[k] = localStorage.getItem(k); }
  const kb = await dbAll('kb'); let imgs = [];
  if (images) { imgs = await dbAll('images'); while (imgs.length && JSON.stringify(imgs).length > 1800000) imgs.pop(); }
  return { v: 1, at: Date.now(), local, kb, images: imgs };
}
export async function restore(snap) {
  if (!snap || snap.v !== 1) throw new Error('This cloud copy is from an incompatible version.');
  for (const k of Object.keys(localStorage)) if (k.startsWith('cps:') && !k.startsWith('cps:v:') && k !== 'cps:sync') localStorage.removeItem(k);
  for (const [k, v] of Object.entries(snap.local || {})) if (k.startsWith('cps:') && !k.startsWith('cps:v:')) localStorage.setItem(k, v);
  await dbClear('kb'); for (const r of snap.kb || []) await dbPut('kb', r);
  if ((snap.images || []).length) { await dbClear('images'); for (const r of snap.images) await dbPut('images', r); }
}
async function seal(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), plain = await gz(enc.encode(JSON.stringify(obj)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)), out = new Uint8Array(1 + 12 + ct.length);
  out[0] = 1; out.set(iv, 1); out.set(ct, 13); return out;
}
async function unseal(bytes, key) {
  if (bytes[0] !== 1) throw new Error('Unrecognized cloud data format.');
  try { return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) }, key, bytes.slice(13)))))); }
  catch (_) { throw new Error('Could not decrypt the cloud copy. Check that the sync code is exactly right.'); }
}
async function api(method, d, { body, expected } = {}) {
  const headers = method === 'GET' ? {} : { 'X-Sync-Id': d.id, 'X-Sync-Auth': d.auth, ...(expected != null ? { 'X-Sync-Expected': String(expected) } : {}) };
  const r = await fetch(method === 'GET' ? `/api/sync?id=${d.id}` : '/api/sync', { method, headers, body });
  if (r.ok) return r;
  let j = {}; try { j = await r.json(); } catch (_) { /* binary or empty */ }
  const e = new Error(j.error || `Sync failed (${r.status})`); e.status = r.status; e.version = j.version; if (r.status === 409) e.code = 'conflict'; throw e;
}

export const syncState = () => store.get('sync', null);
export const syncCode = () => vaultGet('synccode');
export async function createWorkspace(opts) { const code = newCode(); await vaultSet('synccode', code); store.set('sync', { version: 0, at: 0 }); await push({ ...opts, force: true }); return code; }
export async function connect(code, opts) {
  const d = await derive(code); let r;
  try { r = await api('GET', d); } catch (e) { if (e.status === 404) throw new Error('No cloud copy exists for that code yet.'); throw e; }
  const snap = await unseal(new Uint8Array(await r.arrayBuffer()), d.key);
  await vaultSet('synccode', code.toUpperCase().replace(/[^A-Z2-7]/g, '').match(/.{4}/g).join('-'));
  await restore(snap); store.set('sync', { version: Number(r.headers.get('X-Sync-Version')), at: Date.now() });
  logEvent('sync', 'Connected to a cloud workspace and restored data'); return snap;
}
export async function push({ images = false, force = false } = {}) {
  const code = await syncCode(); if (!code) throw new Error('Cloud sync is not set up on this device.');
  const d = await derive(code), st = syncState() || { version: 0 };
  const blob = await seal(await snapshot({ images }), d.key);
  if (blob.length > 3 * 1024 * 1024) throw new Error('Your data is larger than the 3 MB sync limit. Turn off "Include images" or delete old items.');
  const r = await api('PUT', d, { body: blob, expected: force ? 'force' : st.version }), j = await r.json();
  store.set('sync', { version: j.version, at: Date.now() }); logEvent('sync', `Pushed to cloud (version ${j.version}, ${(blob.length / 1024).toFixed(0)} KB encrypted)`); return j.version;
}
export async function pull() {
  const code = await syncCode(); if (!code) throw new Error('Cloud sync is not set up on this device.');
  const d = await derive(code), r = await api('GET', d), snap = await unseal(new Uint8Array(await r.arrayBuffer()), d.key);
  await restore(snap); store.set('sync', { version: Number(r.headers.get('X-Sync-Version')), at: Date.now() }); logEvent('sync', 'Pulled from cloud'); return snap;
}
export async function disconnect({ deleteCloud = false } = {}) {
  const code = await syncCode();
  if (deleteCloud && code) await api('DELETE', await derive(code));
  await vaultSet('synccode', ''); localStorage.removeItem('cps:sync'); logEvent('sync', deleteCloud ? 'Deleted the cloud copy and disconnected' : 'Disconnected cloud sync');
}
export const available = () => capabilities().sync;
