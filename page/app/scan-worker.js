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
     'C' weak   - zxing alone on fewer lines; and whatever only the whole-frame pass read (strong, on a frame the finder did not read)
     'D' faint  - the grey-line reader alone, not far ahead of its next best reading
   and the page takes a number once it has two points (A = 2, B = 1, C and D = half; D never by itself).
   THE WHOLE-FRAME PASS (plan.full; the page asks for it on one frame in four): zxing on the frame as it is, for the QR
   and Data Matrix codes the finder does not look for, and as a net under the finder - a net only: a linear reading of
   it at a box where the finder's own readers are sure of another is dropped (g14, t.clash counts them).
   SHARPNESS: every frame gets a score, the variance of the Laplacian of a 512 x 512 patch from its middle.
   KEPT PICTURES (plan.keep, Test mode; Brett: "the data that was collected from the test runs was insufficient"): the
   frame as the camera gave it, as a JPEG (keep.orig; made before the reading and outside its timings), the lossless
   middle of the first one (keep.crop), and the first picture of lines zxing was handed (keep.rows, a PNG).
   Gone with g13: the whole-frame evening (color-dodge blend), the boosted frames, the enlarged quarters - their history is
   in CLAUDE.md under g11h-g11l.
   g14 (2026-11-10; Brett: "i want you have access to literally all data during the barcode test experiments"): with
   plan.log (Test mode) the reply also carries EVERY BOX the finder found - read or not: where, how long, at what angle,
   whether lines were cut from it and if not why, how much of it is blown out, what the grey-line reader and zxing each
   made of it (t.boxes, the fields are app.js BOX_FIELDS) - and the frame's brightness and grain (t.img). None of it
   changes what is read. Always: t.cen, the middle of the boxes that were cut - where the page then measures how sharp
   the next frames are, to pick the ones worth reading. */
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
const RANK = {A: 4, B: 3, C: 2, D: 1};
// ---- Test mode's log (plan.log) ----
const r1 = v => v == null ? null : Math.round(v), r100 = v => v == null ? null : Math.round(v * 100);
function boxRows(job, dbg, reads) {           // one row a box, in app.js's BOX_FIELDS order
  const of = new Map(), cls = new Map();
  for (const b of dbg) of.set(b.ci, b);
  for (const r of reads) { const c = cls.get(r.ci); if (!c || RANK[r.cls] > RANK[c]) cls.set(r.ci, r.cls); }
  return job.cands.map((c, ci) => {
    const cut = job.cuts[ci], w = job.why[ci], b = of.get(ci), g = b && b.g, z = b && b.z.length ? b.z.slice().sort((x, y) => y[2] - x[2])[0] : null;
    let hot = null, mean = null;
    if (cut) {                                // the rows that hold its bars: how much is blown out, how bright they are
      let n = 0, sum = 0, h = 0; const P = cut.P, pw = cut.w;
      for (let y = cut.y0; y < cut.y1; y++) for (let x = y * pw, e = x + pw; x < e; x++) { const v = P[x]; sum += v; if (v >= 250) h++; n++; }
      if (n) { hot = Math.round(1000 * h / n) / 10; mean = Math.round(sum / n); }
    }
    return [r1(c.cx), r1(c.cy), r1(c.len), r1(c.thick), Math.round(c.ang * 1800 / Math.PI) / 10, r100(c.con), (c.side ? 1 : 0) + (c.diag ? 2 : 0) + (c.coarse ? 4 : 0),
      cut ? 0 : w ? w[0] : 9, cut ? cut.y1 - cut.y0 : w && w[1] != null ? w[1] : null, cut ? r100(cut.fold) : w && w[2] != null ? r100(w[2]) : null, hot, mean,
      g ? r100(g.fit) : null, g ? r100(g.gap) : null, g ? r100(g.sig) : null, g ? g.K : null, g ? r100(g.m) : null, g ? g.text : '',
      z ? (z[0] === 'Code128' ? 'C' : z[0] === 'ITF' ? 'I' : String(z[0]).slice(0, 3)) : '', z ? z[2] : 0, z ? z[1] : '', cls.get(ci) || ''];
  });
}
// the frame's light: the green of every 12th dot both ways - its mean, darkest and brightest percent, the share blown
// out and the share crushed to black, and the camera's GRAIN (half of the dots differ from the mean of their two
// neighbours by less than this much; on flat paper that is noise - it rises as the camera turns its gain up in poor light)
function imgStats(d, W, H) {
  const hist = new Uint32Array(256), nh = new Uint32Array(256), step = 12; let n = 0, sum = 0;
  for (let y = step >> 1; y < H; y += step) {
    let i = (y * W + (step >> 1)) * 4 + 1; const end = (y * W + W - 2) * 4;
    for (; i < end; i += step * 4) { const v = d[i]; hist[v]++; sum += v; n++; let q = v - 2 * d[i + 4] + d[i + 8]; if (q < 0) q = -q; nh[q > 255 ? 255 : q]++; }
  }
  if (!n) return null;
  const pct = (h, p) => { let a = 0; const need = n * p; for (let b = 0; b < 256; b++) { if (a + h[b] >= need) return b + (h[b] ? (need - a) / h[b] : 0); a += h[b]; } return 255; };
  let hot = 0, dark = 0; for (let b = 250; b < 256; b++) hot += hist[b]; for (let b = 0; b <= 8; b++) dark += hist[b];
  return {mean: Math.round(sum / n), p1: Math.floor(pct(hist, 0.01)), p50: Math.floor(pct(hist, 0.5)), p99: Math.floor(pct(hist, 0.99)), hot: Math.round(1000 * hot / n) / 10, dark: Math.round(1000 * dark / n) / 10, grain: Math.round(pct(nh, 0.5) / 1.652 * 100) / 100};
}
function focusOf(job) {                       // the middle of the boxes that were cut: [x, y] in the frame, or null
  const xs = [], ys = []; job.cuts.forEach((c, i) => { if (c) { xs.push(job.cands[i].cx); ys.push(job.cands[i].cy); } });
  if (!xs.length) return null;
  xs.sort((p, q) => p - q); ys.sort((p, q) => p - q);
  return [Math.round(xs[xs.length >> 1]), Math.round(ys[ys.length >> 1])];
}
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
      const td = performance.now(); draw(m.bm); t.draw = performance.now() - td;   // (the bitmap onto this thread's canvas: outside ms, told apart)
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
    let claims = null, given = null;           // what the finder's readers say stands at each box (the whole pass may not contradict it); all they were given a class for
    if (plan.find !== false && self.SlabFinder) {
      // (should the finder ever throw on a phone - it could be tried on none - the frame is not lost: t.ferr says why,
      // and the whole-frame pass below reads it, its linear codes then taken as strong)
      try {
        const job = SlabFinder.prepare(img.data, W, H), lay = job.lines(), zres = [];
        const tz = performance.now();
        for (const pic of lay.pics) zres.push(await ZXingWASM.readBarcodes(pic, ROWS));   // {data, width, height}: zxing-wasm takes it as it is
        t.rows = performance.now() - tz;
        const dbg = plan.log ? [] : null, d = job.decide(lay, zres, dbg);
        for (const r of d.reads) add({text: r.text, format: r.format, pos: r.pos, cls: r.cls, by: r.by, lines: r.lines || 0, fit: r.fit == null ? null : Math.round(r.fit * 100) / 100, gap: r.gap == null ? null : Math.round(r.gap * 100) / 100});
        t.find = job.t.find + job.t.cut + job.t.lean; t.lines = job.t.lines; t.grey = job.t.grey; t.st = d.st; t.glare = job.glare; t.len = Math.round(job.medLen);
        found = true;
        // WHERE THE FINDER'S READERS ARE SURE, THE WHOLE PASS MAY NOT SAY ANOTHER (g14). On a replayed frame of Brett's
        // 13-inch test zxing read the whole frame's code 150231577 as 530231271720 - its check symbol agreeing - while the
        // grey-line reader read that box right and strongly; the looped frame came round four times and the wrong number
        // counted (four weak sightings). So: a box where the finder's readers gave a reading class A or B (claims) takes
        // no other linear reading from the whole pass. (Not their weaker readings: on poor frames a grey-line reading that
        // merely fits is wrong more often than zxing is, and the whole pass then rescues codes - a camera of grainy,
        // blurred and dark frames counted 44 instead of 49 with those in the way.) A reading the finder's readers gave
        // a class anywhere in the frame is never dropped. On all 136 real test pictures: of 685 linear readings of the
        // whole pass the one wrong one goes and no right one; the 15 right ones only the whole pass had all stay.
        try {
          const at = new Map();
          for (const r of d.reads) if (r.cls === 'A' || r.cls === 'B') { const c = job.cands[r.ci]; (at.get(r.ci) || at.set(r.ci, {cx: c.cx, cy: c.cy, len: c.len, texts: new Set()}).get(r.ci)).texts.add(r.format + '|' + r.text); }
          claims = [...at.values()];
          given = new Set(d.reads.map(r => r.format + '|' + r.text));
        } catch (err) { claims = given = null; }
        try {                                  // (the log must never cost a frame its readings)
          const cen = focusOf(job); if (cen) t.cen = cen;
          if (plan.log) { const tk = performance.now(); t.boxes = boxRows(job, dbg, d.reads); lost += performance.now() - tk; }
        } catch (err) { t.lerr = String(err && err.message || err).slice(0, 120); }
        if (kept && plan.keep.rows && lay.pics.length) {       // what zxing was handed for this frame (its first thousand lines)
          const tk = performance.now();
          try { const p = lay.pics[0], cv = new OffscreenCanvas(p.width, p.height); cv.getContext('2d').putImageData(new ImageData(p.data, p.width, p.height), 0, 0); kept.rows = await cv.convertToBlob({type: 'image/png'}); } catch (err) { kept.err = String(err && err.message || err).slice(0, 120); }
          lost += performance.now() - tk;
        }
      } catch (err) { t.ferr = String(err && err.message || err).slice(0, 120); }
    }
    if (plan.full || !found) {
      const t1 = performance.now();
      for (const r of await ZXingWASM.readBarcodes(img, m.opts)) {
        if (r.isValid === false) continue;
        const two = is2D(r.format), P = r.position;
        if (!two && claims && P && P.topLeft) {  // a linear reading where the finder's readers are sure of another: not believed
          const x = (P.topLeft.x + P.topRight.x + P.bottomRight.x + P.bottomLeft.x) / 4, y = (P.topLeft.y + P.topRight.y + P.bottomRight.y + P.bottomLeft.y) / 4, key = r.format + '|' + r.text;
          if (!given.has(key) && claims.some(c => Math.hypot(c.cx - x, c.cy - y) < 0.6 * c.len && !c.texts.has(key))) { t.clash = (t.clash || 0) + 1; if (plan.log) (t.clashes || (t.clashes = [])).push(r.format + ' ' + r.text); continue; }
        }
        add({text: r.text, format: r.format, pos: P, version: r.version, cls: two ? 'A' : found ? 'C' : 'B', by: 'w', lines: r.lineCount || 0});
      }
      t.full = performance.now() - t1;
    }
    if (plan.log) { const tk = performance.now(); try { t.img = imgStats(img.data, W, H); } catch (err) {} lost += performance.now() - tk; }
    if (m.bm) m.bm.close();
    self.postMessage({id: m.id, w: W, h: H, ms: performance.now() - t0 - lost, sharp, res: out, t, keep: kept});
  } catch (err) {
    self.postMessage({id: m.id, err: String(err && err.message || err)});
  }
};
// (plat: what this browser's workers could do with camera frames handed to them directly - noted in Test mode's report)
self.postMessage({hello: 1, offscreen: OFFSCREEN, finder: !!self.SlabFinder, blob: OFFSCREEN && typeof OffscreenCanvas.prototype.convertToBlob === 'function',
  plat: {trackProcessor: typeof MediaStreamTrackProcessor !== 'undefined', videoFrame: typeof VideoFrame !== 'undefined', cores: (self.navigator && navigator.hardwareConcurrency) || null}});
