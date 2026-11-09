/* Slab Show Scanner's barcode reader, off the page's own thread (2026-11-09, the scanner upgrade): the camera's frames
   arrive here at full size - an ImageBitmap when this browser can draw one in a worker (OffscreenCanvas), else the raw
   pixels - and zxing reads every barcode in them. The page stays smooth while a 4K frame is read.
   ENLARGED READS (2026-11-09, after Brett's first test on the Staples sheets: slab barcodes are ~17.5 mm wide with bars
   ~0.2 mm, so at a foot the 4K camera gives only ~1.7 dots per bar and 45 degrees far less): a piece of the frame drawn
   1.5x bigger with smooth scaling before it is read. On a test frame the codes at 1.45 dots per bar went from 0 of 10
   read to 9 of 10 that way. The page says which piece (plan.up, fractions of the frame) and whether to read the whole
   frame too (plan.full); positions found in the enlarged piece are mapped back to the frame. */
'use strict';
importScripts('zxing/reader.js');
const READY = ZXingWASM.prepareZXingModule({
  overrides: {locateFile: (p, prefix) => p.endsWith('.wasm') ? new URL('zxing/' + p, self.location.href).href : prefix + p},
  fireImmediately: true
});
const OFFSCREEN = typeof OffscreenCanvas !== 'undefined';
const UP = 1.5;                               // how much bigger a piece is drawn
let CV = null, CX = null, UV = null, UX = null;
function draw(bm) {                           // the frame on one reused canvas
  if (!CV || CV.width !== bm.width || CV.height !== bm.height) { CV = new OffscreenCanvas(bm.width, bm.height); CX = CV.getContext('2d', {willReadFrequently: true}); }
  CX.drawImage(bm, 0, 0);
}
function enlarged(x0, y0, w, h) {             // a piece of the frame, UP times bigger, smoothly scaled
  const W = Math.round(w * UP), H = Math.round(h * UP);
  if (!UV || UV.width !== W || UV.height !== H) { UV = new OffscreenCanvas(W, H); UX = UV.getContext('2d', {willReadFrequently: true}); }
  UX.imageSmoothingEnabled = true; UX.imageSmoothingQuality = 'high';
  UX.drawImage(CV, x0, y0, w, h, 0, 0, W, H);
  return UX.getImageData(0, 0, W, H);
}
const slim = (r, x0, y0, k) => {
  const p = r.position, at = q => ({x: x0 + q.x / k, y: y0 + q.y / k});
  return {text: r.text, format: r.format, version: r.version, pos: p && p.topLeft ? {topLeft: at(p.topLeft), topRight: at(p.topRight), bottomRight: at(p.bottomRight), bottomLeft: at(p.bottomLeft)} : p};
};
self.onmessage = async e => {
  const m = e.data, plan = m.plan || {full: true, up: null};
  try {
    await READY;
    const W = m.bm ? m.bm.width : m.w, H = m.bm ? m.bm.height : m.h, out = [], seen = new Set();
    const keep = rs => { for (const r of rs) { const k = r.format + '|' + r.text; if (!seen.has(k)) { seen.add(k); out.push(r); } } };
    if (m.bm) draw(m.bm);
    const t0 = performance.now();
    if (plan.full !== false || !m.bm) {
      const img = m.bm ? CX.getImageData(0, 0, W, H) : new ImageData(new Uint8ClampedArray(m.buf), W, H);
      keep((await ZXingWASM.readBarcodes(img, m.opts)).filter(r => r.isValid !== false).map(r => slim(r, 0, 0, 1)));
    }
    if (plan.up && m.bm) {
      const x0 = Math.round(plan.up.x * W), y0 = Math.round(plan.up.y * H), w = Math.round(plan.up.w * W), h = Math.round(plan.up.h * H);
      keep((await ZXingWASM.readBarcodes(enlarged(x0, y0, w, h), m.opts)).filter(r => r.isValid !== false).map(r => slim(r, x0, y0, UP)));
    }
    if (m.bm) m.bm.close();
    self.postMessage({id: m.id, w: W, h: H, ms: performance.now() - t0, res: out});
  } catch (err) {
    self.postMessage({id: m.id, err: String(err && err.message || err)});
  }
};
self.postMessage({hello: 1, offscreen: OFFSCREEN});
