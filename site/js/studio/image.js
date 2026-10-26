import { h, $, uid, nowIso, logEvent, emit, toast, download, clip, dbAll, dbPut, dbDel } from './core.js';
import { llm, generateImage, visionAnalyze, capabilities } from './llm.js';
import { kbAdd } from './knowledge.js';

export const id = 'image', title = 'Images';
let tab = 'generate', gallery = [], viewer, galleryBox, notice, base = null, hist = [];
const STYLES = ['photorealistic', 'digital illustration', '3D render', 'anime', 'minimal flat logo', 'watercolor'];

export const dataUrl = (r) => (r.mime === 'image/svg+xml' ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.data) : `data:${r.mime};base64,${r.data}`);
async function loadGallery() { gallery = (await dbAll('images')).sort((a, b) => b.t.localeCompare(a.t)); renderGallery(); }
async function saveImage(rec) {
  await dbPut('images', rec); gallery.unshift(rec);
  while (gallery.length > 40) { const old = gallery.pop(); await dbDel('images', old.id); }
  renderGallery(); showRec(rec);
}

export async function generate(prompt, { steps = 4, seed } = {}) {
  const out = await generateImage({ prompt, steps, seed });
  const rec = { id: uid(), t: nowIso(), kind: 'ai', prompt: clip(prompt, 300), mime: out.mime, data: out.image };
  await saveImage(rec); logEvent('image', `Generated image: ${clip(prompt, 60)}`); emit('image:made', { id: rec.id, prompt }); return rec;
}
// Strip anything executable or external from model-written SVG, then re-serialize.
export function sanitizeSvg(text) {
  const m = String(text).match(/<svg[\s\S]*<\/svg>/i); if (!m) throw new Error('The model did not return an SVG. Try again.');
  const doc = new DOMParser().parseFromString(m[0], 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('The SVG was malformed. Try again.');
  const BAD = new Set(['script', 'foreignobject', 'image', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animatetransform', 'animatemotion']);
  const walk = (el) => {
    for (const c of [...el.children]) { if (BAD.has(c.localName.toLowerCase())) { c.remove(); continue; } walk(c); }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith('on') || ((n === 'href' || n === 'xlink:href') && !v.startsWith('#')) || /url\(\s*['"]?(?!#)/.test(v) || v.startsWith('javascript:')) el.removeAttribute(a.name);
    }
    if (el.localName === 'style' && /@import|url\(/i.test(el.textContent)) el.remove();
  };
  walk(doc.documentElement);
  doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!doc.documentElement.getAttribute('viewBox')) doc.documentElement.setAttribute('viewBox', '0 0 512 512');
  return new XMLSerializer().serializeToString(doc.documentElement);
}
export async function svg(prompt) {
  const out = await llm('svg', [{ role: 'user', content: prompt }]); const clean = sanitizeSvg(out.text);
  const rec = { id: uid(), t: nowIso(), kind: 'svg', prompt: clip(prompt, 300), mime: 'image/svg+xml', data: clean };
  await saveImage(rec); logEvent('image', `Drew SVG: ${clip(prompt, 60)}`); emit('image:made', { id: rec.id, prompt }); return rec;
}

const VTASKS = [['describe', 'Describe'], ['alt', 'Alt text'], ['ocr', 'Read text (OCR)'], ['extract', 'Extract data']];
export async function understand(rec, task = 'describe') {
  const c = await toCanvas(rec, 1024); const out = await visionAnalyze({ image: c.toDataURL('image/jpeg', 0.82).split(',')[1], mime: 'image/jpeg', task });
  logEvent('image', `Analyzed image (${task})`); emit('image:analyzed', { id: rec.id, task }); return out.text;
}
export async function describeLatest(task = 'describe') { if (!gallery.length) throw new Error('There are no images in the gallery yet.'); return understand(gallery[0], ['describe', 'alt', 'ocr', 'extract'].includes(task) ? task : 'describe'); }
function visionBox(rec) {
  const out = h('div', { id: 'v-out', class: 'stack', 'aria-live': 'polite' }), sel = h('select', { id: 'v-task', class: 'inp narrow', 'aria-label': 'What to do' }, VTASKS.map(([v, n]) => h('option', { value: v }, n)));
  return h('div', { class: 'card' }, h('div', { class: 'row gap wrap' }, h('b', null, 'Understand this image'), sel,
    h('button', { class: 'btn sm', id: 'v-go', type: 'button', onclick: async (e) => { e.target.disabled = true; out.replaceChildren(h('p', { class: 'muted' }, 'Analyzing…')); try { const text = await understand(rec, sel.value); out.replaceChildren(h('pre', { class: 'vision' }, text), h('div', { class: 'row gap' },
      h('button', { class: 'btn sm ghost', id: 'v-copy', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (_) { toast('Copy failed', 'error'); } } }, 'Copy'),
      h('button', { class: 'btn sm ghost', id: 'v-save', type: 'button', onclick: async () => { await kbAdd({ title: `Image ${sel.value}: ${clip(rec.prompt || rec.kind, 50)}`, text, source: 'image' }); toast('Saved to knowledge base'); } }, 'Save to knowledge base'))); } catch (err) { out.replaceChildren(h('p', { class: 'err' }, err.message)); } e.target.disabled = false; } }, 'Analyze')), out);
}
function showRec(rec) {
  viewer.replaceChildren(h('img', { class: 'preview-img', alt: rec.prompt || 'Generated image', src: dataUrl(rec) }),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'edit', onclick: () => { loadIntoEditor(rec); setTab('edit'); } }, 'Edit this image'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => rasterDownload(rec) }, rec.mime === 'image/svg+xml' ? 'Download PNG' : 'Download'),
      rec.mime === 'image/svg+xml' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => download('image.svg', rec.data, 'image/svg+xml') }, 'Download SVG') : null,
      h('button', { class: 'btn sm ghost danger', type: 'button', onclick: async () => { await dbDel('images', rec.id); gallery = gallery.filter((g) => g.id !== rec.id); renderGallery(); viewer.replaceChildren(); } }, 'Delete')), visionBox(rec));
}
async function toCanvas(rec, max = 2048) {
  const img = new Image(); img.src = dataUrl(rec); await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth || 1024, img.naturalHeight || 1024)); const w = Math.round((img.naturalWidth || 1024) * k), hh = Math.round((img.naturalHeight || 1024) * k);
  const c = document.createElement('canvas'); c.width = w; c.height = hh; c.getContext('2d').drawImage(img, 0, 0, w, hh); return c;
}
async function rasterDownload(rec) { const c = await toCanvas(rec, 2048); c.toBlob((b) => download('image.png', b), 'image/png'); }
function renderGallery() {
  if (!galleryBox) return;
  galleryBox.replaceChildren(...(gallery.length ? gallery.map((r) => h('button', { class: 'thumb', type: 'button', 'data-id': r.id, 'aria-label': 'Open: ' + (r.prompt || r.kind), onclick: () => showRec(r) }, h('img', { alt: '', src: dataUrl(r), loading: 'lazy' }))) : [h('p', { class: 'muted' }, 'Your creations appear here.')]));
}

// ---------- editor ----------
const SL = [['brightness', 'Brightness', 100, 0, 200], ['contrast', 'Contrast', 100, 0, 200], ['saturate', 'Saturation', 100, 0, 300], ['blur', 'Blur', 0, 0, 10], ['grayscale', 'Grayscale', 0, 0, 100], ['sepia', 'Sepia', 0, 0, 100], ['hue', 'Hue', 0, 0, 360], ['invert', 'Invert', 0, 0, 100]];
const fval = (n) => Number($('#e-' + n).value);
const filterStr = () => `brightness(${fval('brightness')}%) contrast(${fval('contrast')}%) saturate(${fval('saturate')}%) blur(${fval('blur')}px) grayscale(${fval('grayscale')}%) sepia(${fval('sepia')}%) hue-rotate(${fval('hue')}deg) invert(${fval('invert')}%)`;
const mk = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
function snap() { hist.push((() => { const c = mk(base.width, base.height); c.getContext('2d').drawImage(base, 0, 0); return c; })()); if (hist.length > 8) hist.shift(); }
function paint() {
  const cv = $('#e-canvas'); if (!base) { cv.width = 1; cv.height = 1; return; }
  cv.width = base.width; cv.height = base.height; const ctx = cv.getContext('2d'); ctx.filter = filterStr(); ctx.drawImage(base, 0, 0); ctx.filter = 'none';
}
async function loadIntoEditor(rec) { base = await toCanvas(rec, 2048); hist = []; resetSliders(); paint(); $('#e-empty').hidden = true; $('#e-tools').hidden = false; }
function resetSliders() { for (const [n, , d] of SL) $('#e-' + n).value = d; }
function bake(fn) { if (!base) return; snap(); const out = fn(base); base = out; paint(); }
const op = {
  apply: () => bake((b) => { const c = mk(b.width, b.height), x = c.getContext('2d'); x.filter = filterStr(); x.drawImage(b, 0, 0); resetSliders(); return c; }),
  rotate: () => bake((b) => { const c = mk(b.height, b.width), x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(Math.PI / 2); x.drawImage(b, -b.width / 2, -b.height / 2); return c; }),
  flip: (hz) => bake((b) => { const c = mk(b.width, b.height), x = c.getContext('2d'); x.translate(hz ? b.width : 0, hz ? 0 : b.height); x.scale(hz ? -1 : 1, hz ? 1 : -1); x.drawImage(b, 0, 0); return c; }),
  crop: (ratio) => bake((b) => { const [rw, rh] = ratio.split(':').map(Number); let w = b.width, hh = Math.round((w * rh) / rw); if (hh > b.height) { hh = b.height; w = Math.round((hh * rw) / rh); } const c = mk(w, hh); c.getContext('2d').drawImage(b, (b.width - w) / 2, (b.height - hh) / 2, w, hh, 0, 0, w, hh); return c; }),
  resize: (max) => bake((b) => { const k = max / Math.max(b.width, b.height), c = mk(Math.max(1, Math.round(b.width * k)), Math.max(1, Math.round(b.height * k))); c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); return c; }),
  text: (t, size, color, pos) => bake((b) => { const c = mk(b.width, b.height), x = c.getContext('2d'); x.drawImage(b, 0, 0); const s = Math.round((size / 100) * b.width * 0.2) || 24; x.font = `bold ${s}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = Math.max(2, s / 8); x.strokeStyle = 'rgba(0,0,0,.65)'; x.fillStyle = color; const y = pos === 'top' ? s : pos === 'bottom' ? b.height - s : b.height / 2; x.strokeText(t, b.width / 2, y, b.width * 0.94); x.fillText(t, b.width / 2, y, b.width * 0.94); return c; }),
};
async function saveEdited() {
  const c = mk(base.width, base.height), x = c.getContext('2d'); x.filter = filterStr(); x.drawImage(base, 0, 0);
  const rec = { id: uid(), t: nowIso(), kind: 'edit', prompt: 'Edited image', mime: 'image/png', data: c.toDataURL('image/png').split(',')[1] };
  await saveImage(rec); toast('Saved to gallery'); logEvent('image', 'Saved an edited image'); emit('image:made', { id: rec.id, prompt: 'edit' });
}
function exportEdited() {
  const fmt = $('#e-fmt').value, c = mk(base.width, base.height), x = c.getContext('2d'); x.filter = filterStr(); x.drawImage(base, 0, 0);
  c.toBlob((b) => download('edited.' + fmt.split('/')[1].replace('jpeg', 'jpg'), b), fmt, 0.92);
}
async function reimagine() {
  const prompt = $('#e-ai-prompt').value.trim(); if (prompt.length < 3) return toast('Describe the change first', 'error');
  const small = mk(1, 1); const k = Math.min(1, 512 / Math.max(base.width, base.height)); small.width = Math.round(base.width * k); small.height = Math.round(base.height * k);
  small.getContext('2d').drawImage(base, 0, 0, small.width, small.height);
  const b64 = small.toDataURL('image/jpeg', 0.8).split(',')[1];
  const btn = $('#e-ai-go'); btn.disabled = true;
  try { const out = await generateImage({ prompt, image: b64, strength: Number($('#e-ai-str').value) / 100 }); const rec = { mime: out.mime, data: out.image }; snap(); base = await toCanvas(rec, 2048); paint(); toast('Re-imagined'); logEvent('image', `Re-imagined image: ${clip(prompt, 60)}`); }
  catch (e) { toast(e.message, 'error'); }
  btn.disabled = false;
}

function setTab(t) { tab = t; for (const x of ['generate', 'svg', 'edit']) { const p = $('#i-pane-' + x); if (p) p.hidden = x !== t; } document.querySelectorAll('[data-itab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.itab === t))); }

export function mount(root) {
  const caps = capabilities(); const canAi = caps.image;
  viewer = h('div', { id: 'i-viewer', class: 'stack' }); galleryBox = h('div', { id: 'i-gallery', class: 'gallery' });
  notice = h('p', { class: 'note', id: 'i-notice' }, canAi ? '' : 'AI image generation runs on Cloudflare Workers AI, which is not enabled on this deployment. You can still draw vector art with the SVG tab and edit any image.');
  const prompt = h('textarea', { id: 'i-prompt', class: 'inp', rows: 3, maxlength: 1500, placeholder: 'A lighthouse on a cliff at sunrise, volumetric light, cinematic', 'aria-label': 'Image prompt' });
  const steps = h('select', { id: 'i-steps', class: 'inp narrow', 'aria-label': 'Quality steps' }, [[4, 'Fast (4)'], [6, 'Better (6)'], [8, 'Best (8)']].map(([v, n]) => h('option', { value: v }, n)));
  const sprompt = h('textarea', { id: 's-prompt', class: 'inp', rows: 2, maxlength: 1500, placeholder: 'A friendly robot mascot holding a cloud, flat vector style', 'aria-label': 'SVG prompt' });
  const slider = ([n, label, d, lo, hi]) => h('label', { class: 'sl' }, label, h('input', { id: 'e-' + n, type: 'range', min: lo, max: hi, value: d, oninput: paint }));
  root.append(
    h('header', { class: 'phead' }, h('h2', null, 'Images'), h('p', { class: 'muted' }, 'Generate with AI, draw vector art from a prompt, and edit any picture right in your browser. Files you open are never uploaded.')),
    notice,
    h('div', { class: 'row gap' }, [['generate', 'AI image'], ['svg', 'SVG art'], ['edit', 'Editor']].map(([t, n]) => h('button', { class: 'chip-s', type: 'button', 'data-itab': t, 'aria-pressed': String(t === tab), onclick: () => setTab(t) }, n))),
    h('section', { id: 'i-pane-generate', class: 'card' }, prompt,
      h('div', { class: 'row gap wrap' }, STYLES.map((s) => h('button', { class: 'chip-s', type: 'button', onclick: () => { prompt.value = (prompt.value.trim() + ', ' + s).replace(/^, /, ''); } }, s))),
      h('div', { class: 'row gap wrap' }, steps,
        h('button', { class: 'btn ghost', id: 'i-improve', type: 'button', onclick: async (e) => { if (prompt.value.trim().length < 3) return; e.target.disabled = true; try { prompt.value = (await llm('imageprompt', [{ role: 'user', content: prompt.value.trim() }])).text.trim(); } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; } }, 'Improve prompt'),
        h('button', { class: 'btn', id: 'i-gen', type: 'button', disabled: !canAi, onclick: async (e) => { if (prompt.value.trim().length < 3) return toast('Write a prompt first', 'error'); e.target.disabled = true; e.target.textContent = 'Generating…'; try { await generate(prompt.value.trim(), { steps: Number(steps.value) }); } catch (err) { toast(err.message, 'error'); } e.target.disabled = !capabilities().image; e.target.textContent = 'Generate'; } }, 'Generate'))),
    h('section', { id: 'i-pane-svg', class: 'card', hidden: true }, sprompt,
      h('button', { class: 'btn', id: 's-gen', type: 'button', onclick: async (e) => { if (sprompt.value.trim().length < 3) return; e.target.disabled = true; e.target.textContent = 'Drawing…'; try { await svg(sprompt.value.trim()); } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; e.target.textContent = 'Draw SVG'; } }, 'Draw SVG')),
    h('section', { id: 'i-pane-edit', class: 'card', hidden: true },
      h('div', { class: 'row gap wrap' }, h('label', { class: 'btn ghost filebtn' }, 'Open an image', h('input', { id: 'e-file', type: 'file', accept: 'image/*', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 12e6) return toast('Image is larger than 12 MB', 'error'); const rd = new FileReader(); rd.onload = () => { const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/.exec(rd.result); if (!m) return toast('Unsupported image', 'error'); loadIntoEditor({ mime: m[1], data: m[2] }).catch(() => toast('Could not read that image', 'error')); }; rd.readAsDataURL(f); e.target.value = ''; } })), h('span', { class: 'muted' }, 'or pick one from the gallery with “Edit this image”.')),
      h('p', { id: 'e-empty', class: 'empty' }, 'No image loaded.'),
      h('div', { id: 'e-tools', hidden: true },
        h('canvas', { id: 'e-canvas', class: 'editcanvas', 'aria-label': 'Image being edited' }),
        h('div', { class: 'sliders' }, SL.map(slider)),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn sm ghost', id: 'e-apply', type: 'button', onclick: op.apply }, 'Apply filters'),
          h('button', { class: 'btn sm ghost', id: 'e-rot', type: 'button', onclick: op.rotate }, 'Rotate 90°'),
          h('button', { class: 'btn sm ghost', id: 'e-fh', type: 'button', onclick: () => op.flip(true) }, 'Flip ↔'),
          h('button', { class: 'btn sm ghost', id: 'e-fv', type: 'button', onclick: () => op.flip(false) }, 'Flip ↕'),
          h('select', { id: 'e-crop', class: 'inp narrow', 'aria-label': 'Crop ratio' }, ['1:1', '16:9', '4:5', '3:2'].map((r) => h('option', { value: r }, r))),
          h('button', { class: 'btn sm ghost', id: 'e-crop-go', type: 'button', onclick: () => op.crop($('#e-crop').value) }, 'Crop'),
          h('input', { id: 'e-max', class: 'inp narrow', type: 'number', value: 1024, min: 64, max: 4096, 'aria-label': 'Max side in pixels' }),
          h('button', { class: 'btn sm ghost', id: 'e-resize-go', type: 'button', onclick: () => op.resize(Math.max(64, Math.min(4096, Number($('#e-max').value) || 1024))) }, 'Resize'),
          h('button', { class: 'btn sm ghost', id: 'e-undo', type: 'button', onclick: () => { if (hist.length) { base = hist.pop(); paint(); } } }, 'Undo')),
        h('div', { class: 'row gap wrap' }, h('input', { id: 'e-text', class: 'inp', placeholder: 'Caption text', maxlength: 80, 'aria-label': 'Caption' }),
          h('input', { id: 'e-tsize', class: 'inp narrow', type: 'number', value: 40, min: 10, max: 100, 'aria-label': 'Text size' }), h('input', { id: 'e-tcolor', type: 'color', value: '#ffffff', 'aria-label': 'Text color' }),
          h('select', { id: 'e-tpos', class: 'inp narrow', 'aria-label': 'Text position' }, ['bottom', 'center', 'top'].map((p) => h('option', { value: p }, p))),
          h('button', { class: 'btn sm ghost', id: 'e-text-go', type: 'button', onclick: () => { const t = $('#e-text').value; if (t) op.text(t, Number($('#e-tsize').value), $('#e-tcolor').value, $('#e-tpos').value); } }, 'Add text')),
        canAi ? h('div', { class: 'row gap wrap' }, h('input', { id: 'e-ai-prompt', class: 'inp', placeholder: 'AI re-imagine: “turn it into a watercolor painting”', 'aria-label': 'AI edit prompt' }), h('input', { id: 'e-ai-str', type: 'range', min: 20, max: 90, value: 60, 'aria-label': 'Change strength' }), h('button', { class: 'btn sm', id: 'e-ai-go', type: 'button', onclick: reimagine }, 'Re-imagine (beta)')) : null,
        h('div', { class: 'row gap wrap' }, h('select', { id: 'e-fmt', class: 'inp narrow', 'aria-label': 'Export format' }, ['image/png', 'image/jpeg', 'image/webp'].map((f) => h('option', { value: f }, f.split('/')[1].toUpperCase()))),
          h('button', { class: 'btn', id: 'e-export', type: 'button', onclick: exportEdited }, 'Export'), h('button', { class: 'btn ghost', id: 'e-save', type: 'button', onclick: saveEdited }, 'Save to gallery')))),
    viewer, h('h3', null, 'Gallery'), galleryBox);
  loadGallery(); setTab(tab);
}
