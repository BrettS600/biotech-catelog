/* Slab Show Scanner's barcode reader, off the page's own thread (2026-11-09, the scanner upgrade): the camera's frames
   arrive here at full size - an ImageBitmap when this browser can draw one in a worker (OffscreenCanvas), else the raw
   pixels - and zxing reads every barcode in them. The page stays smooth while a 4K frame is read. */
'use strict';
importScripts('zxing/reader.js');
const READY = ZXingWASM.prepareZXingModule({
  overrides: {locateFile: (p, prefix) => p.endsWith('.wasm') ? new URL('zxing/' + p, self.location.href).href : prefix + p},
  fireImmediately: true
});
const OFFSCREEN = typeof OffscreenCanvas !== 'undefined';
let CV = null, CX = null;
function pixels(bm) {                         // an ImageBitmap -> ImageData, on one reused canvas
  if (!CV || CV.width !== bm.width || CV.height !== bm.height) { CV = new OffscreenCanvas(bm.width, bm.height); CX = CV.getContext('2d', {willReadFrequently: true}); }
  CX.drawImage(bm, 0, 0);
  bm.close();
  return CX.getImageData(0, 0, CV.width, CV.height);
}
const slim = r => ({text: r.text, format: r.format, pos: r.position, version: r.version});
self.onmessage = async e => {
  const m = e.data;
  try {
    await READY;
    const img = m.bm ? pixels(m.bm) : new ImageData(new Uint8ClampedArray(m.buf), m.w, m.h);
    const t0 = performance.now();
    const res = await ZXingWASM.readBarcodes(img, m.opts);
    self.postMessage({id: m.id, w: img.width, h: img.height, ms: performance.now() - t0, res: res.filter(r => r.isValid !== false).map(slim)});
  } catch (err) {
    self.postMessage({id: m.id, err: String(err && err.message || err)});
  }
};
self.postMessage({hello: 1, offscreen: OFFSCREEN});
