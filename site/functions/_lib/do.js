// Durable Objects (SQLite-backed, free plan compatible). Plain classes so they also run in the Node simulator.
const J = (b, c = 200, h = {}) => new Response(JSON.stringify(b), { status: c, headers: { 'Content-Type': 'application/json', ...h } });
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

// One published app per object. The delete token is stored only as a SHA-256 hash.
export class AppStore {
  constructor(state) { this.s = state.storage; }
  async fetch(request) {
    const p = new URL(request.url).pathname;
    if (p === '/create') {
      if (await this.s.get('app')) return J({ error: 'exists' }, 409);
      const r = await request.json();
      await this.s.put('app', { html: r.html, title: r.title, created: r.created, expires: r.expires, views: 0, reports: 0, disabled: false, tokenHash: await sha(r.token) });
      return J({ ok: true });
    }
    const rec = await this.s.get('app');
    if (!rec) return J({ error: 'not found' }, 404);
    if (p === '/get') {
      if (rec.expires < Date.now()) { await this.s.deleteAll(); return J({ error: 'expired' }, 404); }
      if (rec.disabled) return J({ error: 'disabled' }, 404);
      rec.views = (rec.views || 0) + 1; await this.s.put('app', rec);
      return J({ html: rec.html, title: rec.title, expires: rec.expires, views: rec.views });
    }
    if (p === '/report') { rec.reports = (rec.reports || 0) + 1; if (rec.reports >= 3) rec.disabled = true; await this.s.put('app', rec); return J({ ok: true, disabled: rec.disabled }); }
    if (p === '/delete') { const { token } = await request.json(); if ((await sha(String(token || ''))) !== rec.tokenHash) return J({ error: 'forbidden' }, 403); await this.s.deleteAll(); return J({ ok: true }); }
    return J({ error: 'bad path' }, 404);
  }
}

// One end-to-end-encrypted workspace blob per object (the server never sees keys or plaintext).
const MAX = 3 * 1024 * 1024, CHUNK = 96 * 1024;
export class SyncStore {
  constructor(state) { this.s = state.storage; }
  async fetch(request) {
    const p = new URL(request.url).pathname, meta = await this.s.get('meta');
    if (p === '/get') {
      if (!meta) return J({ error: 'not found' }, 404);
      const keys = Array.from({ length: meta.chunks }, (_, i) => 'c' + i), map = await this.s.get(keys), out = new Uint8Array(meta.size); let o = 0;
      for (const k of keys) { const c = map.get(k); out.set(c, o); o += c.length; }
      return new Response(out, { headers: { 'Content-Type': 'application/octet-stream', 'X-Sync-Version': String(meta.version), 'X-Sync-Updated': String(meta.updated) } });
    }
    const auth = request.headers.get('X-Auth-Hash');
    if (p === '/put') {
      if (meta && meta.authHash !== auth) return J({ error: 'forbidden' }, 403);
      const expected = request.headers.get('X-Sync-Expected');
      if (meta && expected !== 'force' && Number(expected) !== meta.version) return J({ error: 'conflict', version: meta.version }, 409);
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.length < 1 || body.length > MAX) return J({ error: 'Payload must be between 1 byte and 3 MB' }, 413);
      const entries = {}; let n = 0;
      for (let o = 0; o < body.length; o += CHUNK) entries['c' + n++] = body.slice(o, o + CHUNK);
      const version = (meta ? meta.version : 0) + 1;
      entries.meta = { authHash: auth, version, size: body.length, chunks: n, updated: Date.now() };
      await this.s.put(entries);
      if (meta && meta.chunks > n) await this.s.delete(Array.from({ length: meta.chunks - n }, (_, i) => 'c' + (n + i)));
      return J({ ok: true, version });
    }
    if (p === '/delete') {
      if (!meta) return J({ error: 'not found' }, 404);
      if (meta.authHash !== auth) return J({ error: 'forbidden' }, 403);
      await this.s.deleteAll(); return J({ ok: true });
    }
    return J({ error: 'bad path' }, 404);
  }
}
