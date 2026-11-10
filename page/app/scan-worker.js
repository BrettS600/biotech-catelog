/* Slab Show Scanner's barcode reader, off the page's own thread: the camera's frames arrive here at full size - an
   ImageBitmap when this browser can draw one in a worker (OffscreenCanvas), else the raw pixels. The page stays smooth
   while a 4K frame is read.
   g13 (2026-11-10), AFTER BRETT'S SEVEN TEST FILES - real camera frames of the printed sheet, the first time the reader
   could be tried on what his phone really gives (until then: simulated pictures, which were easier). What they showed:
   - one frame of the old reader (the frame to zxing whole + four quarters drawn 1.5x bigger, with the whole frame's light
     evened first) read 49% of the codes in view at 9 inches, 22% at 13 inches, 15% tilted, 7% in a dim room - and took
     343 ms, 139 of them the evening: 2.5 frames a second on his iPhone;
   - zxing looks at one row in seven of a picture 3840 dots high, and a slab's bars are 16-38 dots high; it decides black
     or white with one threshold a row; and at 1.4-2 dots a bar its run lengths come out wrong: 5 wrong numbers in 7 tests.
   So the frame's LINEAR codes are now FOUND first and read from their own folded lines (finder.js: the finder, and a
   Code 128 reader that never decides black or white). The same frames: 83%, 64%, 44%, 74%, no wrong number among 677
   sure or strong readings - and the same again with the frames turned any way round (a code lying aslant, or upside
   down for the grey-line reader, was not read at all at first). What comes back for each code says how sure it is (cls):
     'A' sure   - the grey-line reader and zxing agree (or a QR / Data Matrix, which correct their own errors)
     'B' strong - the grey-line reader alone, well ahead of its next best reading; zxing's ITF on four lines or more
     'C' weak   - anything less; and whatever only the whole-frame pass read (strong, on a frame the finder did not read)
   and the page takes a number once it has two points (A = 2, B = 1, C = half).
   THE WHOLE-FRAME PASS (plan.full; the page asks for it on one frame in four): zxing on the frame as it is, for the QR
   and Data Matrix codes the finder does not look for, and as a net under the finder.
   SHARPNESS: every frame gets a score, the variance of the Laplacian of a 512 x 512 patch from its middle.
   KEPT PICTURES (plan.keep, Test mode; Brett: "the data that was collected from the test runs was insufficient"): the
   frame as the camera gave it, as a JPEG (keep.orig; made before the reading and outside its timings), the lossless
   middle of the first one (keep.crop), and the first picture of lines zxing was handed (keep.rows, a PNG).
   Gone with g13: the whole-frame evening (color-dodge blend), the boosted frames, the enlarged quarters - their history is
   in CLAUDE.md under g11h-g11l. */
'use strict';
importScripts('zxing/reader.js', 'finder.js');
const READY = ZXingWASM.prepareZXingModule({
  overrides: {locateFile: (p, prefix) => p.endsWith('.wasm') ? new URL('zxing/' + p, self.location.href).href : prefix + p},
  fireImmediately: true
});
const OFFSCREEN = typeof OffscreenCanvas !== 'undefined';
let CV = null, CX = null;
function draw(bm) {                           // the frame on one reused canvas
  if (!CV || CV.width !== bm.width || CV.height !== bm.height) { CV = new OffscreenCanvas(bm.width, bm.height); CX = CV.getContext('2d', {willReadFrequently: true}); }
  CX.drawImage(bm, 0, 0);
}
// zxing on the finder's lines: every row of the picture is one line of one code - so every row is looked at (a picture
// under 1024 rows), one row is enough (minLineCount 1: a line is already many rows of the frame folded), nothing is turned
const ROWS = {formats: ['Code128', 'ITF'], tryHarder: true, tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 255, binarizer: 'GlobalHistogram', minLineCount: 1};
const is2D = f => /qr|matrix|aztec|pdf|maxi/i.test(String(f || ''));
function sharpness(d, rowW, x0, y0, n) {      // variance of the 4-neighbour Laplacian of the grey levels in an n x n patch
  const g = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = ((y0 + y) * rowW + x0 + x) * 4; g[y * n + x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
  let s = 0, s2 = 0, c = 0;
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = y * n + x, l = g[i - 1] + g[i + 1] + g[i - n] + g[i + n] - 4 * g[i];
    s += l; s2 += l * l; c++;
  }
  return c ? Math.round(s2 / c - (s / c) * (s / c)) : 0;
}
const RANK = {A: 3, B: 2, C: 1};
self.onmessage = async e => {
  const m = e.data, plan = m.plan || {find: true, full: true};
  try {
    await READY;
    const W = m.bm ? m.bm.width : m.w, H = m.bm ? m.bm.height : m.h, out = [], seen = new Map(), t = {};
    // one entry a code; the surer reading wins; the finder's grey-line reading and the whole pass's zxing agreeing = sure
    const add = r => {
      const k = r.format + '|' + r.text, have = seen.get(k);
      if (!have) { seen.set(k, r); out.push(r); return; }
      const g = /g/.test(have.by) || /g/.test(r.by), w = have.by === 'w' || r.by === 'w';
      if (RANK[r.cls] > RANK[have.cls]) { have.cls = r.cls; if (r.pos) have.pos = r.pos; }
      if (w && have.by !== r.by) { if (g) have.cls = 'A'; else if (have.cls === 'C') have.cls = 'B'; have.by = (have.by + r.by).replace(/w+/, 'w'); }
      have.lines = Math.max(have.lines || 0, r.lines || 0);
    };
    let kept = null;
    if (m.bm) {
      draw(m.bm);
      if (plan.keep) {                         // Test mode keeps this frame's picture for the test-data file: as the camera gave it
        kept = {};
        try {
          kept.orig = await CV.convertToBlob({type: 'image/jpeg', quality: plan.keep.q || 0.92});
          if (plan.keep.crop) {                // ...and its middle without any loss (how much does the JPEG cost? how grainy is the camera?)
            const c = Math.min(plan.keep.crop, W, H), cv = new OffscreenCanvas(c, c);
            cv.getContext('2d').drawImage(CV, Math.round((W - c) / 2), Math.round((H - c) / 2), c, c, 0, 0, c, c);
            kept.crop = await cv.convertToBlob({type: 'image/png'});
          }
        } catch (err) { kept.err = String(err && err.message || err).slice(0, 120); }
      }
    }
    const t0 = performance.now();
    const img = m.bm ? CX.getImageData(0, 0, W, H) : new ImageData(new Uint8ClampedArray(m.buf), W, H);
    t.get = performance.now() - t0;
    const n = Math.min(512, W, H), sharp = sharpness(img.data, W, Math.round((W - n) / 2), Math.round((H - n) / 2), n);
    let lost = 0, found = false;               // lost: time spent on a kept picture after t0 - not the reader's
    if (plan.find !== false && self.SlabFinder) {
      // (should the finder ever throw on a phone - it could be tried on none - the frame is not lost: t.ferr says why,
      // and the whole-frame pass below reads it, its linear codes then taken as strong)
      try {
        const job = SlabFinder.prepare(img.data, W, H), lay = job.lines(), zres = [];
        const tz = performance.now();
        for (const pic of lay.pics) zres.push(await ZXingWASM.readBarcodes(pic, ROWS));   // {data, width, height}: zxing-wasm takes it as it is
        t.rows = performance.now() - tz;
        const d = job.decide(lay, zres);
        for (const r of d.reads) add({text: r.text, format: r.format, pos: r.pos, cls: r.cls, by: r.by, lines: r.lines || 0, fit: r.fit == null ? null : Math.round(r.fit * 100) / 100, gap: r.gap == null ? null : Math.round(r.gap * 100) / 100});
        t.find = job.t.find + job.t.cut + job.t.lean; t.lines = job.t.lines; t.grey = job.t.grey; t.st = d.st; t.glare = job.glare; t.len = Math.round(job.medLen);
        found = true;
        if (kept && plan.keep.rows && lay.pics.length) {       // what zxing was handed for this frame (its first thousand lines)
          const tk = performance.now();
          try { const p = lay.pics[0], cv = new OffscreenCanvas(p.width, p.height); cv.getContext('2d').putImageData(new ImageData(p.data, p.width, p.height), 0, 0); kept.rows = await cv.convertToBlob({type: 'image/png'}); } catch (err) { kept.err = String(err && err.message || err).slice(0, 120); }
          lost = performance.now() - tk;
        }
      } catch (err) { t.ferr = String(err && err.message || err).slice(0, 120); }
    }
    if (plan.full || !found) {
      const t1 = performance.now();
      for (const r of await ZXingWASM.readBarcodes(img, m.opts)) if (r.isValid !== false) add({text: r.text, format: r.format, pos: r.position, version: r.version, cls: is2D(r.format) ? 'A' : found ? 'C' : 'B', by: 'w', lines: r.lineCount || 0});
      t.full = performance.now() - t1;
    }
    if (m.bm) m.bm.close();
    self.postMessage({id: m.id, w: W, h: H, ms: performance.now() - t0 - lost, sharp, res: out, t, keep: kept});
  } catch (err) {
    self.postMessage({id: m.id, err: String(err && err.message || err)});
  }
};
self.postMessage({hello: 1, offscreen: OFFSCREEN, finder: !!self.SlabFinder, blob: OFFSCREEN && typeof OffscreenCanvas.prototype.convertToBlob === 'function'});
