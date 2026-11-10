/* Slab Show Scanner's barcode reader, off the page's own thread (2026-11-09, the scanner upgrade): the camera's frames
   arrive here at full size - an ImageBitmap when this browser can draw one in a worker (OffscreenCanvas), else the raw
   pixels - and zxing reads every barcode in them. The page stays smooth while a 4K frame is read.
   ENLARGED READS (2026-11-09, after Brett's first test on the Staples sheets: slab barcodes are ~17.5 mm wide with bars
   ~0.2 mm, so at a foot the 4K camera gives only ~1.7 dots per bar and 45 degrees far less): a piece of the frame drawn
   1.5x bigger with smooth scaling before it is read. On a test frame the codes at 1.45 dots per bar went from 0 of 10
   read to 9 of 10 that way. The page says which piece (plan.up, fractions of the frame) and whether to read the whole
   frame too (plan.full); positions found in the enlarged piece are mapped back to the frame.
   SHARPNESS (2026-11-09, Brett's second test - most frames blurry, 3x held too close to focus): every frame gets a score,
   the variance of the Laplacian of a 512 x 512 patch from its middle (sharp edges -> high); Test mode's report uses it to
   tell blur apart from too little detail. A code first found in the enlarged piece is marked up: true.
   EVERY FRAME, WHOLE AND ENLARGED (2026-11-09, a code review before Brett's fourth test): plan.up may be a list of pieces,
   read one after the other with their own options (optsUp - the linear slab codes only, three times quicker than a pass
   that also looks for QR codes); the answer says how long the whole-frame pass and each piece took (t.full, t.up) so the
   page can fit as many pieces into a frame as this phone has time for.
   A SMEARED FRAME IS DROPPED EARLY (plan.gate, set by the page while whole-frame passes have been reading codes): when the
   whole pass of such a frame reads nothing, the frame is smeared - on the test pictures a smear that empties the whole pass
   empties the enlarged pieces too - so they are skipped (t.skipped) and the next frame comes sooner.
   THE LIGHT IS EVENED FIRST (2026-11-10, Brett's fourth test: 37 of 50 again, and his screenshots show why - his phone and
   hand shade the lower-left of the sheet (paper there 78-98 against 200-210 lit), and the codes never read are the ones
   in that shadow, fat-barred ITF codes among them). zxing reads a linear code with ONE brightness threshold for the
   whole row of the picture, about two thirds of the way from the row's dark group of dots to its white group; where
   part of a row lies in shadow the shaded paper IS the dark group, its codes are all "black", and the threshold is too
   high for the thin bars in the lit part too. evenLight() divides every part of the picture by how bright white paper
   is around it: the frame is shrunk to 1/16 by halving four times (each half = the mean of 2 x 2 dots - a sparse sample
   made a blotchy map that LOST codes: the plain sheet 49 -> 43); a block's white level is a CLOSING of that map - the
   brightest block within REACH, then the darkest within the same reach - so a barcode's bars and the print are filled
   with the white around them while the edge of a shadow, of glare, of the sheet stays where it is (the brightest alone
   carried the lit side's white a few millimetres into a shadow: a hard-edged shadow read 176 codes of 200, with the
   closing 200); smoothed over 3 x 3 blocks; the division is the canvas's own "color-dodge" blend (result = picture /
   (1 - layer)) of that small map drawn back over the frame. WHAT IS NOT PAPER IS LEFT ALONE: brightening a black table
   mat halfway lifts the row's dark group and the threshold with it (45 degrees fell from 123 codes to 91), so blocks
   under DARK0 of the picture's own white (the level 1 block in 100 is brighter than) keep their brightness, with a ramp
   up to DARK1. Of the PICTURE'S white, not fixed levels: with 40 and 60 a dim scene (everything at 55%) read 157 codes
   of 200 where it read 183 untouched; relative, 200. His mat is 16-25 (10% of the paper), up to 44 with the Light on
   (glare then puts the white near 250, DARK0 at ~43); his shaded paper 38-47% of the lit. A picture with nothing bright
   in it (white under 64) is left as it is.
   Simulated, summed over four frames of 50 codes (whole pass + quarters; the whole pass alone in brackets), as it is ->
   evened: his depth of shadow at 9 inches 186 (120) -> 200 (199); a hard-edged shadow 183 -> 200; where the table
   shares the rows with the sheet (a foot away) on a mat 158 -> 191, on grey felt 87 -> 183, on wood 107 -> 190; a dim
   scene 183 -> 200; the plain sheet 190 -> 193; 45 degrees 123 -> 133; slabs in 4K (three frames) 104 (72) -> 105 (89).
   ~30 ms a 2160 x 2160 frame in a desktop browser. The page asks for it on two frames in three (plan.even) and reads
   the third as it is; t.even = the time it took (absent = this frame was not evened). dodgeWorks() tries both steps
   once on tiny canvases - the blend must give 201 for 100 under 128, and a black-and-white board halved must come out
   grey (SMOOTH = the first smoothing setting that does) - and where either fails the frames are read as they are
   (hello.even false).
   THE BOOSTED FRAMES (plan.boost, 0-1; the page sends 0.7 on one frame in three). That threshold two thirds of the way
   to white suits crisp print; in a small or tilted code the thin white gaps between bars no longer reach white and are
   called black. Where there is print - a block's own mean (B, smoothed) under its white level - the divisor becomes
   white^(1-boost) x mean^boost, so the print's greys are lifted towards the threshold (at most CAP^boost more than the
   paper). Same pictures: 45 degrees 133 (99) -> 171 (124); the plain sheet's whole pass 146 -> 174, in the shadow 144
   -> 177; where the table shares the rows 191 (141) -> 195 (151); slabs 105 -> 105; at 9 inches one code of 200 is
   LOST to it (200 -> 199, boost 1: three or four) - so the unboosted evened frame stays in the turn. In the app on
   the simulated 45-degree camera: 46 codes where g11k read 39. t.boost = the boost this frame got. */
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
const DARK0 = 0.17, DARK1 = 0.25, REACH = 2;  // of the picture's own white: no paper below DARK0, full evening from DARK1; the brightest block within REACH blocks
const CLOSE = true, CAP = 2;                 // CAP: a boosted place is brightened at most CAP ^ boost times more than the paper around it
let EVEN = null, EV = null, SMOOTH = 'low';
function dodgeWorks() {                       // tried once: can this browser even the light the way evenLight() needs?
  if (EVEN !== null) return EVEN;
  EVEN = false;
  try {
    const mk = (w, h) => { const c = new OffscreenCanvas(w, h); return [c, c.getContext('2d', {willReadFrequently: true})]; };
    // 1. "color-dodge" divides as the standard says: grey 100 under a 128 layer drawn enlarged over it -> 100 / (1 - 128/255) = 201
    const [c, x] = mk(4, 4), [l, lx] = mk(2, 2);
    x.fillStyle = 'rgb(100,100,100)'; x.fillRect(0, 0, 4, 4); lx.fillStyle = 'rgb(128,128,128)'; lx.fillRect(0, 0, 2, 2);
    x.globalCompositeOperation = 'color-dodge';
    if (x.globalCompositeOperation !== 'color-dodge') return false;
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'low'; x.drawImage(l, 0, 0, 2, 2, 0, 0, 4, 4);
    const d = x.getImageData(1, 1, 2, 2).data;
    if (Math.abs(d[0] - 201) > 4 || Math.abs(d[12] - 201) > 4) return false;
    // 2. drawing at half size AVERAGES: a board of black and white dots must come out grey (picking one dot of four instead
    //    would make the blotchy map that lost codes) - with the first smoothing setting that does
    const [k, kx] = mk(8, 8), im = kx.createImageData(8, 8);
    for (let i = 0; i < 64; i++) { const v = ((i >> 3) + i) & 1 ? 255 : 0; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    kx.putImageData(im, 0, 0);
    for (const q of ['low', 'medium', 'high']) {
      const [h, hx] = mk(4, 4); hx.imageSmoothingEnabled = true; hx.imageSmoothingQuality = q; hx.drawImage(k, 0, 0, 8, 8, 0, 0, 4, 4);
      const e = hx.getImageData(0, 0, 4, 4).data; let grey = true;
      for (let i = 0; i < 64; i += 4) if (Math.abs(e[i] - 128) > 24) grey = false;
      if (grey) { SMOOTH = q; return EVEN = true; }
    }
  } catch (e) {}
  return EVEN;
}
function spread(src, tmp, dst, w, h, r, max) { // every block <- the brightest (max) or darkest of the blocks within r of it: sideways, then up and down
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = max ? 0 : 255; for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) { const v = src[y * w + k]; if (max ? v > m : v < m) m = v; } tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = max ? 0 : 255; for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) { const v = tmp[k * w + x]; if (max ? v > m : v < m) m = v; } dst[y * w + x] = m; }
}
function evenLight(boost) {                   // the frame on CV, every part divided by the white level around it; boost (0-1): printed places brightened further
  const W = CV.width, H = CV.height;
  if (!EV || EV.W !== W || EV.H !== H) {
    const st = []; let w = W, h = H;
    for (let k = 0; k < 4; k++) { w = Math.ceil(w / 2); h = Math.ceil(h / 2); const c = new OffscreenCanvas(w, h); st.push([c, c.getContext('2d', {willReadFrequently: true})]); }
    EV = {W, H, st, w, h, L: new Uint8Array(w * h), T: new Uint8Array(w * h), M: new Uint8Array(w * h), C: new Uint8Array(w * h), B: new Uint8Array(w * h), hist: new Uint32Array(256)};
  }
  let src = CV, sw = W, sh = H;
  for (const [c, x] of EV.st) { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = SMOOTH; x.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height); src = c; sw = c.width; sh = c.height; }
  const {w, h, L, T, M, B} = EV, sx = EV.st[3][1], im = sx.getImageData(0, 0, w, h), d = im.data;
  let glare = 0;                               // blocks blown out to white: glare on plastic or glass - no reader gets a code out of those
  for (let i = 0, j = 0; i < L.length; i++, j += 4) { const v = L[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; if (v >= 250) glare++; }
  EV.glare = glare / L.length;
  spread(L, T, M, w, h, REACH, true);          // the brightest block within REACH: a barcode's bars and the print are covered by the white around them...
  if (CLOSE) spread(M, T, EV.C, w, h, REACH, false);   // ...and then the darkest within the same reach (together a "closing"): the edge of a shadow, of the glare, of the sheet goes back to where it is
  const C = CLOSE ? EV.C : M;
  const hist = EV.hist.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {     // smoothed (T is free again); and how many blocks at each level
    let s = 0, s2 = 0, n = 0;
    for (let yy = Math.max(0, y - 1), ye = Math.min(h - 1, y + 1); yy <= ye; yy++) for (let xx = Math.max(0, x - 1), xe = Math.min(w - 1, x + 1); xx <= xe; xx++) { s += C[yy * w + xx]; s2 += L[yy * w + xx]; n++; }
    hist[T[y * w + x] = Math.min(255, Math.round(s / n))]++; B[y * w + x] = Math.round(s2 / n);
  }
  let S = 255; for (let c = hist[255], need = L.length / 100; c < need && S > 1; c += hist[--S]);   // the picture's white: 1 block in 100 is brighter
  if (S < 64) return false;                    // nothing bright in the picture: left as it is (evening would only amplify the grain)
  const d0 = DARK0 * S, d1 = DARK1 * S;
  for (let i = 0, j = 0; i < T.length; i++, j += 4) {
    let wl = T[i];
    if (wl >= d1) { if (boost) { const m = Math.max(B[i], wl / CAP); if (m < wl) wl *= Math.pow(m / wl, boost); } }   // B = the block's own mean (smoothed): under the white level where there is print
    else wl = wl <= d0 ? 255 : 255 + (d1 - 255) * (wl - d0) / (d1 - d0);
    d[j] = d[j + 1] = d[j + 2] = 255 - Math.round(wl); d[j + 3] = 255;
  }
  sx.putImageData(im, 0, 0);
  CX.save(); CX.globalCompositeOperation = 'color-dodge'; CX.imageSmoothingEnabled = true; CX.imageSmoothingQuality = 'low';
  CX.drawImage(EV.st[3][0], 0, 0, w, h, 0, 0, W, H); CX.restore();
  return true;
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
  return {text: r.text, format: r.format, version: r.version, up: k !== 1, pos: p && p.topLeft ? {topLeft: at(p.topLeft), topRight: at(p.topRight), bottomRight: at(p.bottomRight), bottomLeft: at(p.bottomLeft)} : p};
};
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
self.onmessage = async e => {
  const m = e.data, plan = m.plan || {full: true, up: null};
  try {
    await READY;
    const W = m.bm ? m.bm.width : m.w, H = m.bm ? m.bm.height : m.h, out = [], seen = new Set(), t = {};
    const keep = rs => { for (const r of rs) { const k = r.format + '|' + r.text; if (!seen.has(k)) { seen.add(k); out.push(r); } } };
    if (m.bm) draw(m.bm);
    const n = Math.min(512, W, H), sx = Math.round((W - n) / 2), sy = Math.round((H - n) / 2);
    const sharp = m.bm ? sharpness(CX.getImageData(sx, sy, n, n).data, n, 0, 0, n) : sharpness(new Uint8ClampedArray(m.buf), W, sx, sy, n);
    const t0 = performance.now();
    if (m.bm && plan.even !== false && dodgeWorks()) {
      if (evenLight(plan.boost || 0)) { CX.getImageData(0, 0, 1, 1); t.even = performance.now() - t0; if (plan.boost) t.boost = plan.boost; }   // (the one dot read back makes the browser finish drawing, so the time is the evening's own)
      t.glare = EV.glare;                      // the share of the picture that is blown out
    }
    if (plan.full !== false || !m.bm) {
      const img = m.bm ? CX.getImageData(0, 0, W, H) : new ImageData(new Uint8ClampedArray(m.buf), W, H);
      keep((await ZXingWASM.readBarcodes(img, m.opts)).filter(r => r.isValid !== false).map(r => slim(r, 0, 0, 1)));
      t.full = performance.now() - t0 - (t.even || 0); t.nFull = out.length;
    }
    if (plan.gate && t.nFull === 0 && m.bm && plan.up) t.skipped = true;
    const ups = m.bm && plan.up && !t.skipped ? (Array.isArray(plan.up) ? plan.up : [plan.up]) : [];
    if (ups.length) {
      const t1 = performance.now(), o = m.optsUp || m.opts;
      for (const u of ups) {
        const x0 = Math.round(u.x * W), y0 = Math.round(u.y * H), w = Math.round(u.w * W), h = Math.round(u.h * H);
        keep((await ZXingWASM.readBarcodes(enlarged(x0, y0, w, h), o)).filter(r => r.isValid !== false).map(r => slim(r, x0, y0, UP)));
      }
      t.up = (performance.now() - t1) / ups.length;
    }
    if (m.bm) m.bm.close();
    self.postMessage({id: m.id, w: W, h: H, ms: performance.now() - t0, sharp, res: out, t});
  } catch (err) {
    self.postMessage({id: m.id, err: String(err && err.message || err)});
  }
};
self.postMessage({hello: 1, offscreen: OFFSCREEN, even: OFFSCREEN && dodgeWorks() ? SMOOTH : false});
