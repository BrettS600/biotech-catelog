/* Slab Show Scanner - the barcode FINDER (g13).
   Until g12 a 4K frame went to zxing whole and in quarters: zxing looks at one row in seven of a picture that tall, with one
   brightness threshold per row, and a slab's barcode is 2-3 mm of bars - 16 to 38 dots high in the picture. Brett's seven
   test files (2026-11-09: real camera frames of the printed sheet, so every answer is known) showed what that leaves
   behind: in ONE frame the app read 49% of the codes in view at 9 inches, 22% at 13 inches, 15% with the phone tilted, 7% in
   a dim room. The same frames through this file and the grey-line reader below it: 83%, 64%, 44%, 74%.
   What it does: FIND the codes (patches of fine stripes all pointing one way), cut each one out along its own direction
   WITHOUT blending dots along the code (a blend softens bars a dot and a half wide), fold its rows into a few lines of
   brightness (seven rows averaged = much less grain; three samples a dot = edges between dots), even each line's light,
   sharpen it two ways, and hand zxing all the lines stacked as one small picture: every row of that picture is one attempt
   at one code. Each code's whole fold also goes, in linear light, to the grey-line Code 128 reader (SlabC128, below).
   EVERY WAY ROUND: a code lying straight (within about 25 degrees) or on its side is found by its stripes running one way
   and cut by shearing; a code lying ASLANT (17 to 73 degrees) by its stripes running both ways at once, in step
   (findSlant), and cut by turning (turnPatch). The same frames turned by 10 to 80 degrees read as they do straight - before
   that, nothing was found between 25 and 65 degrees. Upside down is the readers' business (zxing reads a row both ways;
   SlabC128 does too).
   Plain arithmetic on the frame's own bytes (its green dots): the same file runs in the worker on the phone and under Node
   on the test frames (tools: /tmp/claude-0/ga/fx - bench5.js the straight frames, bench6.js turned by quarter turns,
   bench7.js turned by any angle). */
'use strict';
(function (root) {
const BLK = 8;                                // the stripe search works on 8 x 8 dot blocks
const DEF = {
  T: 0.22,                                    // a block has stripes when the mean change across is over T x (its brightness + 16)
  R: 0.5,                                     // ...and the change along the stripes is under R x the change across
  minLen: 80, maxCands: 110, maxKept: 80,     // a code shorter than 80 dots has bars under a dot wide: nothing reads it; the biggest 110 patches are cut, until 80 hold bars
  maxLen: 1600, maxThick: 200,                // a patch bigger than this is no slab's code in focus (a striped cloth, a fence): not cut (a huge code is the whole-frame pass's)
  S: 0,                                       // samples per picture dot in a folded line (0: 3 for a small code, fewer for a big one)
  margin: 0.14, marginPx: 8,                  // quiet zone kept either side: this share of the code's length + this many dots
  closeW: 31, blurS: 6, pct: 0.02,            // (in samples) the evening: how wide a bar it fills in, how soft, what counts as black
  sharp: [[2.45, 1.5], [3.5, 3]],             // the two sharpenings: [softness in samples, strength]
  maxRows: 32,                                // rows of a code used at most (a close code has a hundred)
  minFold: 0.5,                               // bars are the same in every row, print is not: folded rows keep this share of a row's contrast, or the patch is dropped
  cubicA: -0.5,
};
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---- where are stripes? ------------------------------------------------------------------------------------------------
// Per block: sx = how much the green changes from dot to dot ACROSS (two of the 8 rows, every dot), sy = how much it changes
// DOWN (the same rows, every second dot), sm = brightness. Bars standing upright give a big sx and a small sy; print gives
// both; a code lying on its side the reverse. D = the frame's RGBA bytes.
// For a code lying ASLANT both are big - as they are for print. What tells them apart: across slanted stripes the two
// changes rise and fall TOGETHER at every dot (their products add up: gxy against gxx and gyy), in print they do not.
function blockSums(D, W, H, rows) {
  const wb = W >> 3, hb = H >> 3, sx = new Int32Array(wb * hb), sy = new Int32Array(wb * hb), sm = new Int32Array(wb * hb);
  const gxx = new Int32Array(wb * hb), gyy = new Int32Array(wb * hb), gxy = new Int32Array(wb * hb);
  const W4 = W * 4, last = wb * 8 === W ? wb - 1 : -1;
  for (let by = 0; by < hb; by++) {
    const o = by * wb;
    for (let ri = 0; ri < rows.length; ri++) {
      const y = by * 8 + rows[ri]; if (y < 1 || y >= H - 1) continue;
      let p = y * W4 + 1;                                     // the green of dot (0, y)
      for (let bx = 0; bx < wb; bx++, p += 32) {
        let ax = 0, ay = 0, am = 0, xx = 0, yy = 0, xy = 0;
        const k0 = bx === 0 ? 1 : 0, k1 = bx === last ? 7 : 8;
        for (let k = k0; k < k1; k++) {
          const j = p + k * 4, d = D[j + 4] - D[j - 4]; ax += d < 0 ? -d : d;
          if (k & 1) { const e = D[j + W4] - D[j - W4]; ay += e < 0 ? -e : e; am += D[j]; xx += d * d; yy += e * e; xy += d * e; }
        }
        sx[o + bx] += ax; sy[o + bx] += ay; sm[o + bx] += am; gxx[o + bx] += xx; gyy[o + bx] += yy; gxy[o + bx] += xy;
      }
    }
  }
  return {wb, hb, sx, sy, sm, gxx, gyy, gxy, nr: rows.length};
}
// A LINE IS NOT A CODE (g13b). A slab's label has a border and the case an edge a few millimetres from the barcode: a line
// square to the code gives the same kind of block as the code's bars, and the patch then is a code with a fence post
// through it - not long and thin, and thrown out (a line drawn 1.5-2.5 mm from each code's ends on Brett's real frames:
// 4 codes read of 47, 1 of 50, 0 of 50; with what follows 33, 39, 37 - as without the lines). A line is one block wide
// and long ACROSS the code: blocks in a run of LINE_MIN or more across, with nothing beside them ALONG the code, go.
// (ux, uy): one step along the code for every block - or phi, each block's own direction.
const LINE_MIN = 6;
function dropLines(m, wb, hb, ux0, uy0, phi) {
  let any = false;
  for (let y = 1; y < hb - 1; y++) for (let x = 1, i = y * wb + 1; x < wb - 1; x++, i++) {
    if (!m[i]) continue;
    const ux = phi ? Math.round(Math.cos(phi[i])) : ux0, uy = phi ? Math.round(Math.sin(phi[i])) : uy0, st = uy * wb + ux;
    if (m[i + st] || m[i - st]) continue;
    let run = 1;                                                   // across: (-uy, ux)
    for (let k = 1, X = x - uy, Y = y + ux; k < LINE_MIN && X >= 0 && Y >= 0 && X < wb && Y < hb && m[Y * wb + X]; k++, X -= uy, Y += ux) run++;
    for (let k = 1, X = x + uy, Y = y - ux; k < LINE_MIN && run < LINE_MIN && X >= 0 && Y >= 0 && X < wb && Y < hb && m[Y * wb + X]; k++, X += uy, Y -= ux) run++;
    if (run >= LINE_MIN) { m[i] = 3; any = true; }
  }
  if (any) for (let i = 0, N = wb * hb; i < N; i++) if (m[i] === 3) m[i] = 0;
}
// boxes of stripe blocks: [{cx, cy, len, thick, ang (radians, the code's own direction), n, side}]
function findBoxes(bs, o, side) {
  const {wb, hb, sx, sy, sm, nr} = bs, N = wb * hb, m = new Uint8Array(N);
  // per block: sx sums 8 dots x nr rows, sy and sm 4 dots x nr rows -> mean change across > T (mean + 16) <=> sx > 2T (sm + 64 nr)
  const T2 = 2 * o.T, R = o.R, bias = 64 * nr;
  if (!side) { for (let i = 0; i < N; i++) if (sx[i] > T2 * (sm[i] + bias) && 2 * sy[i] < R * sx[i]) m[i] = 1; }
  else { for (let i = 0; i < N; i++) if (sy[i] > o.T * (sm[i] + bias) && sx[i] < 2 * R * sy[i]) m[i] = 1; }
  dropLines(m, wb, hb, side ? 0 : 1, side ? 1 : 0, null);
  // close gaps of up to 4 blocks along the code (a wide space, a worn bar)
  if (!side) {
    for (let y = 0; y < hb; y++) { let last = -1; const r = y * wb;
      for (let x = 0; x < wb; x++) if (m[r + x]) { if (last >= 0 && x - last > 1 && x - last <= 5) for (let k = last + 1; k < x; k++) m[r + k] = 1; last = x; } }
  } else {
    for (let x = 0; x < wb; x++) { let last = -1;
      for (let y = 0; y < hb; y++) if (m[y * wb + x]) { if (last >= 0 && y - last > 1 && y - last <= 5) for (let k = last + 1; k < y; k++) m[k * wb + x] = 1; last = y; } }
  }
  return patches(m, wb, hb, o, ang => { const lim = 40 * Math.PI / 180; return (side ? Math.abs(Math.abs(ang) - Math.PI / 2) : Math.abs(ang)) > lim ? -1 : side ? 1 : 0; }, null, {side: side ? 1 : 0, a: new Int32Array(Math.max(wb, hb)), b: new Int32Array(Math.max(wb, hb)), on: new Uint8Array(Math.max(wb, hb))});
}
// the patches of a mask (blocks touching, corners too) that are long and thin -> boxes; side(ang) says which way a patch
// of that direction is to be cut (0 across the picture, 1 down it) or -1 to leave it
// phi (slanted codes): the direction the stripes of each block run across - two blocks join only when theirs differ by
// less than DIAG.join degrees (a code's blocks all point one way; the print under it points every way), and side() is told
// the patch's mean direction
function patches(m, wb, hb, o, side, phi, core) {
  const N = wb * hb, out = [], stack = new Int32Array(N), mem = new Int32Array(N), tol = DIAG.join * Math.PI / 180;
  for (let s = 0; s < N; s++) {
    if (m[s] !== 1) continue;
    let sp = 0, n = 0; stack[sp++] = s; m[s] = 2;
    let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, C2 = 0, S2 = 0;
    while (sp) {
      const i = stack[--sp], x = i % wb, y = (i - x) / wb; mem[n++] = i;
      Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y;
      if (phi) { C2 += Math.cos(2 * phi[i]); S2 += Math.sin(2 * phi[i]); }
      if (!phi) {
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= hb) continue;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= wb) continue; const j = yy * wb + xx; if (m[j] === 1) { m[j] = 2; stack[sp++] = j; } } }
        continue;
      }
      // slanted: a neighbour pointing the same way joins - and so does a block up to DIAG.reach away ALONG the code
      // (a wide bar or space is a block without stripes: straight codes have their gaps closed along the row instead)
      const R = DIAG.reach, ux = Math.cos(phi[i]), uy = Math.sin(phi[i]);
      for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= hb) continue;
        for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= wb) continue; const j = yy * wb + xx; if (m[j] !== 1) continue;
          if ((dx > 1 || dx < -1 || dy > 1 || dy < -1) && Math.abs(dx * uy - dy * ux) > 0.75) continue;       // further off: only along the code, within its own thickness
          let d = Math.abs(phi[j] - phi[i]); if (d > Math.PI / 2) d = Math.PI - d; if (d > tol) continue;
          m[j] = 2; stack[sp++] = j; } }
    }
    if (n < 5) continue;
    let box = null, n2 = n;
    if (core && n >= 8) {
      // A CODE WITH A LINE HANGING ON IT (a thick border, two edges side by side: more than one block wide, so still here).
      // Seen along the code, a line is a few columns far TALLER than the code's rows are many. cntA: blocks in each row
      // (a code on its side: column), cntB: in each column (row). Core rows: at least half as wide as the widest.
      const vert = core.side, cntA = core.a, cntB = core.b; let mxc = 0, hc = 0, lines = false;
      for (let k = 0; k < n; k++) { const i = mem[k], x = i % wb, y = (i - x) / wb, qa = vert ? x : y, qb = vert ? y : x; if (++cntA[qa] > mxc) mxc = cntA[qa]; cntB[qb]++; }
      for (let k = 0; k < n; k++) { const i = mem[k], x = i % wb, qa = vert ? x : (i - x) / wb; if (cntA[qa] > 0 && 2 * cntA[qa] >= mxc) { hc++; cntA[qa] = -cntA[qa]; } }   // (a core row is counted once: its count turned negative)
      for (let k = 0; k < n && !lines; k++) { const i = mem[k], x = i % wb, qb = vert ? (i - x) / wb : x; if (cntB[qb] >= hc + 3) lines = true; }
      if (lines) {
        // the code: the longest run of columns that are no taller than a code, in the core rows
        let lo = 1e9, hi = -1;
        for (let k = 0; k < n; k++) { const i = mem[k], x = i % wb, y = (i - x) / wb, qa = vert ? x : y, qb = vert ? y : x; if (cntA[qa] < 0 && cntB[qb] < hc + 3) { if (qb < lo) lo = qb; if (qb > hi) hi = qb; core.on[qb] = 1; } }
        let bestA = 0, bestB = -1, st = -1;
        for (let q = lo; q <= hi + 1; q++) { const on = q <= hi && core.on[q]; if (on && st < 0) st = q; if (!on && st >= 0) { if (q - st > bestB - bestA + 1) { bestA = st; bestB = q - 1; } st = -1; } }
        for (let q = lo; q <= hi; q++) core.on[q] = 0;
        n2 = 0; Sx = Sy = Sxx = Syy = Sxy = 0;
        for (let k = 0; k < n; k++) { const i = mem[k], x = i % wb, y = (i - x) / wb, qa = vert ? x : y, qb = vert ? y : x; if (cntA[qa] < 0 && qb >= bestA && qb <= bestB) { const t = mem[n2]; mem[n2++] = i; mem[k] = t; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; } }
        if (n2 >= 5) box = boxOf(mem, n2, wb, o, side, Sx, Sy, Sxx, Syy, Sxy, 0, 1);
      } else {
        box = boxOf(mem, n, wb, o, side, Sx, Sy, Sxx, Syy, Sxy, 0, 1);
        if (!box) {                                             // no code as a whole: its core rows alone?
          n2 = 0; Sx = Sy = Sxx = Syy = Sxy = 0;
          for (let k = 0; k < n; k++) { const i = mem[k], x = i % wb, y = (i - x) / wb; if (cntA[vert ? x : y] < 0) { const t = mem[n2]; mem[n2++] = i; mem[k] = t; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; } }
          if (n2 >= 5 && n2 < n) box = boxOf(mem, n2, wb, o, side, Sx, Sy, Sxx, Syy, Sxy, 0, 1);
        }
      }
      for (let k = 0; k < n; k++) { const i = mem[k], x = i % wb, y = (i - x) / wb; cntA[vert ? x : y] = 0; cntB[vert ? y : x] = 0; }
    } else box = boxOf(mem, n, wb, o, side, Sx, Sy, Sxx, Syy, Sxy, S2, C2);
    if (box) out.push(box);
  }
  return out;
}
// a patch's blocks -> its box, or null when it is not long and thin the right way
function boxOf(mem, n, wb, o, side, Sx, Sy, Sxx, Syy, Sxy, S2, C2) {
  const mx = Sx / n, my = Sy / n, cxx = Sxx / n - mx * mx, cyy = Syy / n - my * my, cxy = Sxy / n - mx * my;
  const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy), sd = side(ang, 0.5 * Math.atan2(S2, C2));   // the long axis
  if (sd < 0) return null;
  const ux = Math.cos(ang), uy = Math.sin(ang);
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (let k = 0; k < n; k++) { const i = mem[k], x = i % wb, y = (i - x) / wb, a = (x - mx) * ux + (y - my) * uy, b = -(x - mx) * uy + (y - my) * ux; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
  const len = (a1 - a0 + 1) * BLK, thick = (b1 - b0 + 1) * BLK;
  if (len < o.minLen || len / thick < 2.2) return null;
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  return {cx: (mx + ca * ux - cb * uy + 0.5) * BLK, cy: (my + ca * uy + cb * ux + 0.5) * BLK, len, thick, ang, n, side: sd};
}
// CODES LYING ASLANT (g13b; slabs lie at every angle on a table, and until now a code turned more than about 25 degrees
// from straight or from upright was not found at all). A block of slanted stripes: enough change across and down taken
// together, neither much bigger than the other (18 to 72 degrees), and the two rising and falling together (DIAG.rho of
// what they could at most). The patches rising to the right and those falling are looked for apart - so a patch of
// print, where both kinds of block mix, falls to pieces. A box of 45 degrees or less is cut across the picture, a steeper
// one down it.
const DIAG = {rho: 0.6, lo: 0.32, a0: 17, a1: 73, join: 12, reach: 4};
function findSlant(bs, o) {
  const {wb, hb, sx, sy, sm, gxx, gyy, gxy, nr} = bs, N = wb * hb, bias = 64 * nr, out = [], r2 = DIAG.rho * DIAG.rho, lo = DIAG.lo, T = o.T;
  // "together" is judged over a block and its eight neighbours: 72 dots say it far more surely than 8, and bars run on
  const ms = [new Uint8Array(N), new Uint8Array(N)], any = [0, 0], phis = [new Float32Array(N), new Float32Array(N)];   // rising to the right (in the picture: y grows downwards), falling
  for (let y = 1; y < hb - 1; y++) for (let x = 1, i = y * wb + 1; x < wb - 1; x++, i++) {
    const own = gxy[i]; if (own === 0) continue;
    const ax = sx[i] * 0.5, ay = sy[i]; if (ay < lo * ax || ax < lo * ay) continue;       // (sx sums 8 dots a row, sy and sm 4)
    const t = T * (sm[i] + bias); if (ax * ax + ay * ay <= t * t) continue;
    let pxx = 0, pyy = 0, pxy = 0;
    for (let j = i - wb - 1; j <= i + wb - 1; j += wb) { pxx += gxx[j] + gxx[j + 1] + gxx[j + 2]; pyy += gyy[j] + gyy[j + 1] + gyy[j + 2]; pxy += gxy[j] + gxy[j + 1] + gxy[j + 2]; }
    if (pxy * pxy < r2 * pxx * pyy || pxy * own <= 0) continue;
    const k = pxy > 0 ? 0 : 1; ms[k][i] = 1; any[k]++;
    phis[k][i] = 0.5 * Math.atan2(2 * pxy, pxx - pyy);                                   // the way the brightness changes = the way the code runs
  }
  const a0 = DIAG.a0 * Math.PI / 180, a1 = DIAG.a1 * Math.PI / 180, agree = 20 * Math.PI / 180;
  for (let k = 0; k < 2; k++) {
    if (any[k] < 5) continue;
    const m = ms[k], phi = phis[k];
    dropLines(m, wb, hb, 0, 0, phi);
    const side = (ang, mphi) => { let d = Math.abs(ang - mphi); if (d > Math.PI / 2) d = Math.PI - d; const A = Math.abs(ang); return d <= agree && A >= a0 && A <= a1 ? (A > Math.PI / 4 ? 1 : 0) : -1; };
    for (const c of patches(m, wb, hb, o, side, phi)) { c.diag = 1; out.push(c); }
  }
  return out;
}
function find(D, W, H, opt) {
  const o = Object.assign({}, DEF, opt), bs = blockSums(D, W, H, o.findRows || [2, 6]);
  let c = findBoxes(bs, o, 0).concat(findBoxes(bs, o, 1));
  if (o.slant !== false) {                                   // a code turned 17-25 degrees can be found both ways: the bigger patch stays
    for (const d of findSlant(bs, o)) {
      const k = c.findIndex(b => !b.diag && Math.hypot(b.cx - d.cx, b.cy - d.cy) < 0.4 * Math.max(b.len, d.len));
      if (k < 0) c.push(d); else if (d.n > 1.25 * c[k].n) c[k] = d;
    }
  }
  c.sort((a, b) => b.n - a.n);                               // the biggest patches first: a code is bigger than a word of print
  if (c.length > o.maxCands) c.length = o.maxCands;
  let g = 0; const lim = 1000 * bs.nr, N = bs.wb * bs.hb; for (let i = 0; i < N; i++) if (bs.sm[i] >= lim) g++;   // blocks blown out to white
  c.glare = g / N;
  return c;
}

// ---- one code: cut out by shearing -------------------------------------------------------------------------------------
// Column x of the patch is one whole column of the picture - no blending along the code - and only its rows slide with the
// code's slope (blended between two rows: along the bars, where it costs nothing). side: a code lying on its side - the
// patch's x runs down the picture.
function shearPatch(D, W, H, c, slope, w, h, side, P) {
  const hh = (h - 1) / 2;
  if (!side) {
    const X0 = Math.round(c.cx - (w - 1) / 2);
    for (let x = 0; x < w; x++) {
      let X = X0 + x; const yb = c.cy + slope * (X - c.cx) - hh; X = X < 0 ? 0 : X > W - 1 ? W - 1 : X;
      let yi = Math.floor(yb); const f = yb - yi, col = X * 4 + 1;
      for (let r = 0; r < h; r++, yi++) {
        const a = yi < 0 ? 0 : yi > H - 1 ? H - 1 : yi, b = yi + 1 < 0 ? 0 : yi + 1 > H - 1 ? H - 1 : yi + 1;
        P[r * w + x] = D[a * W * 4 + col] * (1 - f) + D[b * W * 4 + col] * f;
      }
    }
  } else {
    const Y0 = Math.round(c.cy - (w - 1) / 2);
    for (let x = 0; x < w; x++) {
      let Y = Y0 + x; const xb = c.cx + slope * (Y - c.cy) - hh; Y = Y < 0 ? 0 : Y > H - 1 ? H - 1 : Y;
      let xi = Math.floor(xb); const f = xb - xi, row = Y * W * 4 + 1;
      for (let r = 0; r < h; r++, xi++) {
        const a = xi < 0 ? 0 : xi > W - 1 ? W - 1 : xi, b = xi + 1 < 0 ? 0 : xi + 1 > W - 1 ? W - 1 : xi + 1;
        P[r * w + x] = D[row + a * 4] * (1 - f) + D[row + b * 4] * f;
      }
    }
  }
}
// A SLANTED code is cut by TURNING: every dot of the patch is weighed from the 4 x 4 picture dots around its place (cubic),
// along the code's own direction - and each row of the patch starts ROWQ of a dot further along than the row above, so
// that the rows, folded, hold the code at three different places between the dots (as a sheared cut's rows do by themselves).
const ROWQ = 1 / 3;
function turnPatch(D, W, H, c, ang, w, h, P) {
  const ux = Math.cos(ang), uy = Math.sin(ang), hh = (h - 1) / 2, hw = (w - 1) / 2, A = -0.5, W4 = W * 4;
  const wx = new Float32Array(4), wy = new Float32Array(4);
  for (let r = 0; r < h; r++) {
    const t = r - hh, s0 = -hw + t * ROWQ; let fx = c.cx + s0 * ux - t * uy, fy = c.cy + s0 * uy + t * ux;
    for (let x = 0; x < w; x++, fx += ux, fy += uy) {
      const xi = Math.floor(fx), yi = Math.floor(fy);
      if (xi < 1 || yi < 1 || xi > W - 3 || yi > H - 3) { const X = xi < 0 ? 0 : xi > W - 1 ? W - 1 : xi, Y = yi < 0 ? 0 : yi > H - 1 ? H - 1 : yi; P[r * w + x] = D[Y * W4 + X * 4 + 1]; continue; }
      let f = fx - xi, f2 = f * f, f3 = f2 * f;
      wx[0] = A * (f3 - 2 * f2 + f); wx[1] = (A + 2) * f3 - (A + 3) * f2 + 1; wx[3] = A * (f2 - f3); wx[2] = 1 - wx[0] - wx[1] - wx[3];
      f = fy - yi; f2 = f * f; f3 = f2 * f;
      wy[0] = A * (f3 - 2 * f2 + f); wy[1] = (A + 2) * f3 - (A + 3) * f2 + 1; wy[3] = A * (f2 - f3); wy[2] = 1 - wy[0] - wy[1] - wy[3];
      let v = 0, p = (yi - 1) * W4 + (xi - 1) * 4 + 1;
      for (let j = 0; j < 4; j++, p += W4) v += wy[j] * (wx[0] * D[p] + wx[1] * D[p + 4] + wx[2] * D[p + 8] + wx[3] * D[p + 12]);
      P[r * w + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}
// how strongly each row changes across, between columns x0 and x1
function rowEnergy(P, w, h, x0, x1, e) {
  let mx = 0;
  for (let r = 0; r < h; r++) { let s = 0; const o = r * w; for (let k = x0 + 1; k < x1 - 1; k++) { const d = P[o + k + 1] - P[o + k - 1]; s += d < 0 ? -d : d; } e[r] = s; if (s > mx) mx = s; }
  return mx;
}
// the rows that hold the bars: the longest run of rows whose changes across are at least half the strongest row's
function barRows(P, w, h, e) {
  const mx = rowEnergy(P, w, h, 0, w, e);
  let best0 = 0, best1 = 0, s = -1;
  for (let r = 0; r <= h; r++) {
    const on = r < h && e[r] > mx * 0.5;
    if (on && s < 0) s = r;
    if (!on && s >= 0) { if (r - s > best1 - best0) { best0 = s; best1 = r; } s = -1; }
  }
  return [best0, best1];
}
// does the code climb or fall along the cut? the bars' middle row in the left third against the right third -> rows per dot
function climb(P, w, h, e) {
  const mid = (x0, x1) => { const mx = rowEnergy(P, w, h, x0, x1, e); let s = 0, sw = 0; for (let r = 0; r < h; r++) { const v = e[r] > mx * 0.5 ? e[r] : 0; s += v * r; sw += v; } return sw ? s / sw : (h - 1) / 2; };
  const a = Math.round(w * 0.14), b = Math.round(w * 0.38), c = Math.round(w * 0.62), d = Math.round(w * 0.86);
  return (mid(c, d) - mid(a, b)) / ((c + d) / 2 - (a + b) / 2);
}
// how crisp a few of the rows y0..y1 are when folded with a lean of k dots per row (-> the folded line's squared changes)
function crisp(P, w, rows, yc, k, tmp) {
  tmp.fill(0, 0, w);
  for (let q = 0; q < rows.length; q++) {
    const r = rows[q], sh = k * (r - yc), si = Math.floor(sh), f = sh - si, o = r * w;
    const a = Math.max(0, -si), b = Math.min(w, w - 1 - si);
    for (let x = a; x < b; x++) tmp[x] += P[o + x + si] * (1 - f) + P[o + x + si + 1] * f;
  }
  let s = 0; for (let x = 9; x < w - 8; x++) { const d = tmp[x] - tmp[x - 1]; s += d * d; }
  return s / (rows.length * rows.length);
}
// the lean that folds crispest, looked for around k0; -> [lean, how much of one row's contrast the fold keeps]
function lean(P, w, y0, y1, tmp, k0) {
  const R = y1 - y0, yc = (y0 + y1 - 1) / 2, rows = [];
  const nUse = Math.min(R, 6); for (let i = 0; i < nUse; i++) rows.push(y0 + Math.round(i * (R - 1) / Math.max(1, nUse - 1)));
  let bk = k0, bs = -1;
  const tryK = k => { const s = crisp(P, w, rows, yc, k, tmp); if (s > bs) { bs = s; bk = k; } };
  for (let k = k0 - 0.03; k <= k0 + 0.0301; k += 0.01) tryK(k);
  if (Math.abs(bk - k0) > 0.025) {                             // at the edge of the near search: look wider
    for (let k = k0 - 0.16; k <= k0 + 0.1601; k += 0.04) tryK(k);
    const k1 = bk; for (let k = k1 - 0.03; k <= k1 + 0.0301; k += 0.01) tryK(k);
  }
  let er = 0;                                                // one row's own squared changes, the mean over the rows used
  for (let q = 0; q < rows.length; q++) { const o = rows[q] * w; for (let x = 9; x < w - 8; x++) { const d = P[o + x] - P[o + x - 1]; er += d * d; } }
  er /= rows.length;
  return [bk, er > 0 ? bs / er : 0];
}
// rows of the patch folded into ONE line at S samples a dot: every row shifted by its lean, cubic between dots, ADDED into out
function addRow(P, w, r, S, sh, out, n, A) {
  const o = r * w, base = Math.floor(sh), f = sh - base;
  for (let p = 0; p < S; p++) {
    const u = p / S + f, ip = u >= 1 ? 1 : 0, t = u - ip, t2 = t * t, t3 = t2 * t;
    const w0 = A * (t3 - 2 * t2 + t), w1 = (A + 2) * t3 - (A + 3) * t2 + 1, w3 = A * (t2 - t3), w2 = 1 - w0 - w1 - w3;
    const off = base + ip;                                   // sample j = S q + p reads dots q + off - 1 .. q + off + 2
    let q0 = 1 - off; if (q0 < 0) q0 = 0; let q1 = w - 2 - off; const qn = Math.ceil((n - p) / S); if (q1 > qn) q1 = qn;
    for (let q = 0; q < q0 && q < qn; q++) out[S * q + p] += P[o + Math.min(w - 1, Math.max(0, q + off))];
    for (let q = q0, i = o + q0 + off; q < q1; q++, i++) out[S * q + p] += w0 * P[i - 1] + w1 * P[i] + w2 * P[i + 1] + w3 * P[i + 2];
    for (let q = Math.max(q1, q0); q < qn; q++) out[S * q + p] += P[o + Math.min(w - 1, Math.max(0, q + off))];
  }
}

// ---- one line of brightness -> rows zxing can read ---------------------------------------------------------------------
function slideExt(a, n, w, out, wantMax, dq) { // max (or min) over a window of w samples centred on each (monotonic queue)
  const h = w >> 1; let head = 0, tail = 0;
  for (let i = 0; i < n + h; i++) {
    if (i < n) { const v = a[i]; while (tail > head && (wantMax ? a[dq[tail - 1]] <= v : a[dq[tail - 1]] >= v)) tail--; dq[tail++] = i; }
    const c = i - h; if (c < 0) continue;
    while (dq[head] < c - h) head++;
    out[c] = a[dq[head]];
  }
}
function prefix(a, n, pre) { let s = 0; pre[0] = 0; for (let i = 0; i < n; i++) { s += a[i]; pre[i + 1] = s; } }
function boxBlur(a, n, r, pre) {              // mean over 2r+1 samples (edges: what there is), in place
  prefix(a, n, pre);
  for (let i = 0; i < n; i++) { const lo = i - r < 0 ? 0 : i - r, hi = i + r + 1 > n ? n : i + r + 1; a[i] = (pre[hi] - pre[lo]) / (hi - lo); }
}
// the white level along a line: the bright level around each sample with the bars filled in (a closing), then smoothed
function whiteLevel(src, n, cw, blurR, out, X) {
  slideExt(src, n, cw, X.a, true, X.dq); slideExt(X.a, n, cw, out, false, X.dq);
  boxBlur(out, n, blurR, X.pre); boxBlur(out, n, blurR, X.pre); boxBlur(out, n, blurR, X.pre);
}
// src / white, its darkest 2% taken as black, written as bytes
function putEven(src, n, white, pct, row, at, X) {
  const hist = X.hist.fill(0), f = X.b;
  for (let i = 0; i < n; i++) { const v = src[i] / (white[i] + 1); f[i] = v; hist[v >= 1 ? 256 : v <= 0 ? 0 : (v * 256) | 0]++; }
  let acc = 0, lo = 0; const need = n * pct;
  for (let b = 0; b <= 256; b++) { acc += hist[b]; if (acc >= need) { lo = b / 256; break; } }
  const g = 255 / (1 - lo + 1e-6);
  for (let i = 0; i < n; i++) { const v = (f[i] - lo) * g; row[at + i] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5 | 0; }
}
// src sharpened: src + amt x (src - src smoothed), clipped. Smoothed = three means over 2r+1 samples (~ a Gaussian), or
// with one = true a single mean over the width that spreads as far (a third of the work)
function sharpen(src, n, r, amt, out, X, one) {
  const t = X.c; for (let i = 0; i < n; i++) t[i] = src[i];
  if (one) boxBlur(t, n, Math.round((Math.sqrt(3 * (2 * r + 1) * (2 * r + 1) - 2) - 1) / 2), X.pre);
  else { boxBlur(t, n, r, X.pre); boxBlur(t, n, r, X.pre); boxBlur(t, n, r, X.pre); }
  for (let i = 0; i < n; i++) { const v = src[i] + amt * (src[i] - t[i]); out[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
}
const boxR = sigma => Math.max(1, Math.round(Math.sqrt(sigma * sigma * 4 + 1) / 2 - 0.5));   // three boxes of this half-width ~ a Gaussian of sigma

// ---- all of it -----------------------------------------------------------------------------------------------------------
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = 255 * Math.pow(i / 255, 1.6);   // a picture's grey -> linear light
// prepare(D, W, H) -> a job: the boxes, each one's cut; lines() lays them out as rows for zxing; decide() says what was read.
function prepare(D, W, H, opt) {
  const o = Object.assign({}, DEF, opt), t = {find: 0, cut: 0, lean: 0, lines: 0, grey: 0};
  let ta = now();
  const cands = find(D, W, H, o); t.find = now() - ta; ta = now();
  const cuts = []; let keptN = 0;
  for (let ci = 0; ci < cands.length; ci++) {
    if (keptN >= o.maxKept || cands[ci].len > o.maxLen || cands[ci].thick > o.maxThick) { cuts.push(null); continue; }
    const c = cands[ci], turn = c.diag && o.turn !== false;
    const along = c.diag && !turn ? (c.side ? Math.abs(Math.sin(c.ang)) : Math.cos(c.ang)) : 1;   // a slanted code cut by shearing: the share of its length that lies along the cut
    const span = c.len * along, mrg = Math.round(span * o.margin) + o.marginPx, w = Math.round(span) + 2 * mrg, h = Math.round(c.thick / along) + 6;
    const S = o.S || (span <= 400 ? 3 : span <= 800 ? 2 : 1);  // samples a dot: a code filling the picture needs no help
    const P = new Float32Array(w * h), e = new Float32Array(h), tmp = new Float32Array(w);
    let slope = 0, ang = c.ang, k0;
    if (turn) {
      turnPatch(D, W, H, c, ang, w, h, P);
      const cl = climb(P, w, h, e);                          // the cut is not quite along the code: follow it and cut again
      if (Math.abs(cl) > 0.006 && Math.abs(cl) < 0.25) { ang += Math.atan(cl); turnPatch(D, W, H, c, ang, w, h, P); }
      k0 = -ROWQ;
    } else {
      // the code's slope in the picture: rows per dot along it (a code on its side: dots across per row down)
      slope = c.side ? Math.cos(c.ang) / Math.sin(c.ang) : Math.tan(c.ang);
      shearPatch(D, W, H, c, slope, w, h, c.side, P);
      const cl = climb(P, w, h, e);                          // the cut is not quite along the code: follow it and cut again
      if (Math.abs(cl) > 0.006 && Math.abs(cl) < 0.25) { slope += cl; shearPatch(D, W, H, c, slope, w, h, c.side, P); }
      k0 = -slope / (1 + slope * slope);                     // in a sheared cut bars square to the code lean by this many dots a row; a sheet seen at a slant adds its own
    }
    const [y0, y1] = barRows(P, w, h, e);
    t.cut += now() - ta; ta = now();
    if (y1 - y0 < 3) { cuts.push(null); continue; }
    const [k, fold] = lean(P, w, y0, y1, tmp, k0);
    t.lean += now() - ta; ta = now();
    if (fold < o.minFold) { cuts.push(null); continue; }      // rows that do not agree: print, not bars
    cuts.push({P, w, h, y0, y1, k, slope, fold, S, n: w * S, side: c.side, len: span, axis: c.len, diag: c.diag ? 1 : 0, turn: turn ? 1 : 0, ang}); keptN++;
  }
  // a place along a box's line (samples from its left end) -> the frame, on the bars' middle row
  function toFrame(ci, xs) {
    const c = cuts[ci], b = cands[ci], x = xs / c.S, dr = (c.y0 + c.y1 - 1) / 2 - (c.h - 1) / 2;
    if (c.turn) { const s = x - (c.w - 1) / 2 + dr * ROWQ, ux = Math.cos(c.ang), uy = Math.sin(c.ang); return [b.cx + s * ux - dr * uy, b.cy + s * uy + dr * ux]; }
    if (!c.side) { const X = Math.round(b.cx - (c.w - 1) / 2) + x; return [X, b.cy + c.slope * (X - b.cx) + dr]; }
    const Y = Math.round(b.cy - (c.w - 1) / 2) + x; return [b.cx + c.slope * (Y - b.cy) + dr, Y];
  }
  function posOf(ci, xa, xb) {                                  // the four corners of the bars between two places along the line
    const c = cuts[ci], A = toFrame(ci, xa), B = toFrame(ci, xb), hb = (c.y1 - c.y0) / 2, up = c.turn ? [hb * Math.sin(c.ang), -hb * Math.cos(c.ang)] : c.side ? [-hb, 0] : [0, -hb];
    const pt = (q, sg) => ({x: q[0] + sg * up[0], y: q[1] + sg * up[1]});
    return {topLeft: pt(A, 1), topRight: pt(B, 1), bottomRight: pt(B, -1), bottomLeft: pt(A, -1)};
  }
  // every box's lines: its rows folded in 2 halves and 4 quarters, each evened / sharpened + evened (two strengths) -> rows
  // of grey bytes, stacked in pictures of at most 1000 rows (zxing then looks at every row). And each box's WHOLE fold,
  // evened, in linear light, for the grey-line reader.
  function lines(kinds) {
    const tb = now(), list = []; cuts.forEach((c, i) => { if (c) list.push(i); });
    kinds = kinds || ['n', 's1n', 's2n'];
    let width = 0; for (const i of list) if (cuts[i].n > width) width = cuts[i].n;
    const PADX = 24, MW = width + 2 * PADX, perBox = 6 * kinds.length, rowsTotal = list.length * perBox;
    const grey = new Uint8Array(MW * rowsTotal).fill(255), owner = new Int16Array(rowsTotal), kindOf = [], wholes = [];
    const X = {a: new Float32Array(width), b: new Float32Array(width), c: new Float32Array(width), pre: new Float64Array(width + 1), dq: new Int32Array(width + 1), hist: new Uint32Array(257)};
    const q4 = [0, 1, 2, 3].map(() => new Float32Array(width)), line = new Float32Array(width), white = new Float32Array(width), sh = new Float32Array(width), tmp8 = new Uint8Array(width);
    let row = 0;
    for (const ci of list) {
      const c = cuts[ci], n = c.n, S = c.S, kk = S / 3, R0 = c.y1 - c.y0, step = Math.max(1, Math.ceil(R0 / o.maxRows)), yc = (c.y0 + c.y1 - 1) / 2;
      // the evening's reach: wide enough to fill the widest bar of a code this long (a close code's bars are many dots wide)
      const cw = Math.max(Math.round(o.closeW * kk), Math.round(0.058 * c.len * S)) | 1, blurR = boxR(Math.max(o.blurS * kk, 0.011 * c.len * S));
      const used = []; for (let r = c.y0; r < c.y1; r += step) used.push(r);
      const R = used.length, cnt = [0, 0, 0, 0];
      for (let b = 0; b < 4; b++) q4[b].fill(0, 0, n);
      for (let i = 0; i < R; i++) { const b = Math.min(3, Math.floor(i * 4 / R)); addRow(c.P, c.w, used[i], S, c.k * (used[i] - yc), q4[b], n, o.cubicA); cnt[b]++; }
      // the whole code: its white level (shared by all its lines) and its own evened line in linear light
      for (let j = 0; j < n; j++) { const v = (q4[0][j] + q4[1][j] + q4[2][j] + q4[3][j]) / R; line[j] = v < 0 ? 0 : v > 255 ? 255 : v; }
      whiteLevel(line, n, cw, blurR, white, X);
      putEven(line, n, white, o.pct, tmp8, 0, X);
      const whole = new Float32Array(n); for (let j = 0; j < n; j++) whole[j] = LIN[tmp8[j]]; wholes.push(whole);
      const spans = [[0, 2], [2, 4], [0, 1], [1, 2], [2, 3], [3, 4]];           // halves, then quarters
      for (const [b0, b1] of spans) {
        let m = 0; for (let b = b0; b < b1; b++) m += cnt[b];
        if (!m) { for (const kd of kinds) { owner[row] = ci; kindOf[row] = '-'; row++; } continue; }
        const inv = 1 / m;
        if (b1 - b0 === 2) for (let j = 0; j < n; j++) { const v = (q4[b0][j] + q4[b0 + 1][j]) * inv; line[j] = v < 0 ? 0 : v > 255 ? 255 : v; }
        else { const q = q4[b0]; for (let j = 0; j < n; j++) { const v = q[j] * inv; line[j] = v < 0 ? 0 : v > 255 ? 255 : v; } }
        let have = -1;                                         // which sharpening sh holds
        for (const kd of kinds) {
          const at = row * MW + PADX;
          if (kd === 'n') putEven(line, n, white, o.pct, grey, at, X);
          else {
            const which = kd[1] === '1' ? 0 : 1, sp = o.sharp[which];
            if (have !== which) { sharpen(line, n, boxR(sp[0] * kk), sp[1], sh, X, !o.box3); have = which; }
            if (kd.endsWith('n')) putEven(sh, n, white, o.pct, grey, at, X);
            else for (let j = 0; j < n; j++) grey[at + j] = sh[j] + 0.5 | 0;
          }
          owner[row] = ci; kindOf[row] = (b1 - b0 === 2 ? '2' : '4') + kd; row++;
        }
      }
    }
    // as RGBA pictures for zxing
    const pics = [], MAXR = 1000;
    for (let s = 0; s < rowsTotal; s += MAXR) {
      const nr = Math.min(MAXR, rowsTotal - s), data = new Uint8ClampedArray(MW * nr * 4), u32 = new Uint32Array(data.buffer);
      for (let i = 0, j = s * MW, e = nr * MW; i < e; i++, j++) { const v = grey[j]; u32[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
      pics.push({data, width: MW, height: nr, first: s});
    }
    t.lines += now() - tb;
    return {pics, owner, kindOf, PADX, rows: rowsTotal, list, wholes};
  }
  // a zxing result in one of a layout's pictures -> {ci, text, format, lines, pos in the frame}
  function resolve(lay, pic, r) {
    const p = r.position, row = pic.first + Math.max(0, Math.min(pic.height - 1, Math.round(p.topLeft.y))), ci = lay.owner[row], c = cuts[ci];
    const xa = Math.min(p.topLeft.x, p.topRight.x) - lay.PADX, xb = Math.max(p.topLeft.x, p.topRight.x) - lay.PADX;
    return {ci, text: r.text, format: r.format, lines: r.lineCount || 1, kind: lay.kindOf[row], dots: (xb - xa) / c.S, pos: posOf(ci, xa, xb)};
  }
  // What was read, and how sure. zres[k] = zxing's results for lay.pics[k].
  //   sure 'A': the grey-line reader and zxing read the same Code 128 (two readers that work differently)
  //   strong 'B': the grey-line reader alone, well ahead of its next best reading; or zxing's ITF on four lines or more
  //   weak 'C': the grey-line reader ahead by less; zxing alone on two lines or more where the grey-line reader sees no Code 128
  // On Brett's 26 test frames (2026-11-09): A and B together 677 right Code 128 readings, none wrong. Over those frames
  // as they are, turned every way and with border lines drawn in (2,330 grey-line readings, 574 of them wrong): of the
  // 1,523 that were strong, none was wrong (the wrong ones were ahead of their runner-up by under 0.08; a strong one needs 0.11)
  function decide(lay, zres) {
    const tb = now(), per = new Map(), out = [], G = root.SlabC128;
    zres.forEach((rs, k) => { for (const r of rs) {
      if (r.isValid === false || !r.position) continue;
      const x = resolve(lay, lay.pics[k], r), m = per.get(x.ci) || per.set(x.ci, new Map()).get(x.ci), key = x.format + '|' + x.text, e = m.get(key);
      if (e) e.lines += x.lines; else m.set(key, x);
    } });
    const st = {boxes: cands.length, kept: lay.list.length, rows: lay.rows, grey: 0, sure: 0, strong: 0, weak: 0};
    lay.list.forEach((ci, bi) => {
      const zs = per.get(ci) ? [...per.get(ci).values()] : [], c = cuts[ci];
      const g = G && !zs.some(e => e.format !== 'Code128' && e.lines >= 4) ? G.decode(lay.wholes[bi], c.n, {expect: c.len * c.S}) : null;   // (a box zxing reads as ITF on four lines holds no Code 128)
      if (g && g.text) {
        st.grey++;
        const same = zs.find(e => e.format === 'Code128' && e.text === g.text), far = g.gap >= (g.sig >= 0.66 ? 0.2 : 0.11) && g.fit >= 0.86;
        const cls = same ? 'A' : far ? 'B' : g.fit >= 0.84 && g.gap >= 0.08 && g.sig < 0.66 ? 'C' : null;
        if (cls) out.push({text: g.text, format: 'Code128', cls, lines: same ? same.lines : 0, fit: g.fit, gap: g.gap, dots: (g.b - g.a) / c.S, ci, pos: posOf(ci, g.a, g.b), by: same ? 'gz' : 'g'});
      }
      for (const e of zs) {
        if (e.format === 'Code128') {
          if (g && g.text === e.text) continue;                // (given above)
          if (g && g.fit >= 0.8) continue;                     // the grey-line reader sees another Code 128 here: zxing's is not believed
          if (e.lines >= 2) out.push({text: e.text, format: e.format, cls: 'C', lines: e.lines, dots: e.dots, ci, pos: e.pos, by: 'z'});
        } else if (e.lines >= 2) out.push({text: e.text, format: e.format, cls: e.lines >= 4 ? 'B' : 'C', lines: e.lines, dots: e.dots, ci, pos: e.pos, by: 'z'});
      }
    });
    for (const r of out) st[r.cls === 'A' ? 'sure' : r.cls === 'B' ? 'strong' : 'weak']++;
    t.grey += now() - tb;
    return {reads: out, st};
  }
  const lens = cuts.filter(Boolean).map(c => c.axis).sort((a, b) => a - b);
  return {cands, cuts, lines, resolve, decide, t, o, glare: cands.glare, medLen: lens.length ? lens[lens.length >> 1] : 0};
}
root.SlabFinder = {DEF, DIAG, blockSums, findBoxes, findSlant, find, prepare};
})(typeof self !== 'undefined' ? self : globalThis);
/* A Code 128 reader for bars about a dot wide (g13).
   zxing turns a row into black and white first and then measures the runs: at 1.4 dots a bar a thin gap between two bars
   never gets bright enough to be called white, the runs come out wrong, and zxing either gives up or - worse - settles on
   the nearest pattern and the check symbol happens to agree (Brett's seven tests: 5 wrong numbers from the old reader).
   This one never decides black or white. It knows what each of the 103 Code 128 patterns looks like once the camera has
   blurred it, and asks, symbol by symbol, how much the grey line resembles every one of them (after Gallo & Manduchi,
   "Reading 1-D barcodes with mobile phones using deformable templates", 2011). Then it takes the one reading, out of all
   those whose CHECK SYMBOL AGREES, that resembles the line most - and says how far ahead of the next best it is.
   The line must be in LINEAR light (a camera's picture is not: its greys are stretched, and blurred bars then look thinner
   than they are - the caller raises the evened line to the power 1.6).
   decode(line, n) -> {text, vals, K, m (samples per module), fit (0..1), gap, a, b, rev (read right to left)} or null. */
'use strict';
(function (root) {
const PAT = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
const G = 4, CTX = 1, MOD = 11, WIN = (MOD + 2 * CTX) * G, WSTOP = (13 + 2 * CTX) * G;   // points per module on the common grid; a module of what stands either side
const SIG = [0.22, 0.3, 0.38, 0.46, 0.55, 0.66, 0.8], MID = 3;       // the blurs tried, in modules; the one tried first
const PHI = new Float32Array(513);
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
for (let i = 0; i <= 512; i++) PHI[i] = 0.5 * (1 + erf((i - 256) / 32 / Math.SQRT2));
const phi = z => z <= -8 ? 0 : z >= 8 ? 1 : PHI[Math.round(z * 32) + 256];
// what a pattern looks like blurred by sig modules: brightness 0..1 at len points; before it white; after it a bar (every
// Code 128 symbol ends in a space and the next one begins with a bar) or, for the stop, white
function render(widths, sig, len, after) {
  const bars = []; let x = 0, dark = true;
  for (const w of widths) { if (dark) bars.push([x, x + w]); x += w; dark = !dark; }
  if (after === 'bar') bars.push([x, x + 8]);
  const out = new Float32Array(len);
  for (let j = 0; j < len; j++) { const u = (j + 0.5) / G - CTX; let ink = 0; for (const [a, b] of bars) ink += phi((u - a) / sig) - phi((u - b) / sig); out[j] = 1 - ink; }
  return out;
}
const unit = t => { let s = 0; for (const v of t) s += v; const mu = s / t.length; let q = 0; for (let j = 0; j < t.length; j++) { t[j] -= mu; q += t[j] * t[j]; } const k = 1 / Math.sqrt(q || 1); for (let j = 0; j < t.length; j++) t[j] *= k; return t; };
const widths = v => [...PAT[v]].map(Number);
// the templates, mean taken off and unit length (to be compared by correlation): per blur, the 103 data patterns in one block
let TPL = null;
function templates() {
  return TPL || (TPL = SIG.map(sig => {
    const data = new Float32Array(103 * WIN);
    for (let v = 0; v < 103; v++) data.set(unit(render(widths(v), sig, WIN, 'bar')), v * WIN);
    return {data, start: [103, 104, 105].map(v => unit(render(widths(v), sig, WIN, 'bar'))), stop: unit(render(widths(106), sig, WSTOP, 'white'))};
  }));
}
// the line from x0 on, len points at step samples apart, mean taken off and unit length -> buf; false if it is flat
function grab(E, n, x0, step, len, buf) {
  let s = 0;
  for (let j = 0; j < len; j++) { const x = x0 + (j + 0.5) * step; let i = Math.floor(x), f = x - i; if (i < 0) { i = 0; f = 0; } else if (i > n - 2) { i = n - 2; f = 1; } const v = E[i] * (1 - f) + E[i + 1] * f; buf[j] = v; s += v; }
  const mu = s / len; let q = 0; for (let j = 0; j < len; j++) { buf[j] -= mu; q += buf[j] * buf[j]; }
  if (q < 1e-6) return false; const k = 1 / Math.sqrt(q); for (let j = 0; j < len; j++) buf[j] *= k; return true;
}
const dot = (a, b, len) => { let s = 0; for (let j = 0; j < len; j++) s += a[j] * b[j]; return s; };
const BUF = new Float32Array(WSTOP), PER = new Float32Array(103), TOPN = 16, TOP = new Int16Array(TOPN);
const STRONG = r => r && r.fit >= 0.86 && r.gap >= 0.11;
// The shortest code read: start, 4 symbols (8 digits), check, stop. A slab's cert is 8 digits or more; and a short "code"
// is what a dashed line or a row of dots can pass for (one did, on a test frame: "2525", strongly).
const KMIN = 7;
// THE CODE AMONG WHAT LIES BESIDE IT (g13b). A slab's label has a border and the case an edge a few millimetres from
// the barcode: in the line they are bars of their own, outside the code's quiet zone. The line's bars are taken in
// GROUPS - bars with no white wider than `gap` samples between them (inside a Code 128 no space is wider than 4 modules,
// its quiet zone is 10) - and the widest group is the code. -> [first dark sample, last dark sample] or null
function widest(E, n, thr, gap, lo, hi) {
  let a = -1, last = -1, ba = -1, bb = -2;
  for (let i = lo; i <= hi; i++) {
    if (E[i] >= thr) continue;
    if (a < 0 || i - last > gap) { if (a >= 0 && last - a > bb - ba) { ba = a; bb = last; } a = i; }
    last = i;
  }
  if (a >= 0 && last - a > bb - ba) { ba = a; bb = last; }
  return bb > ba ? [ba, bb] : null;
}
// where the line leaves white first and last between lo and hi (the outer feet of the first and last bar), up to two
// places each: a mark inside the quiet zone is a "bar" before the first
function feet(E, n, thr, lo, hi) {
  const as = [], bs = [];
  for (let i = Math.max(1, lo); i <= hi && as.length < 2; i++) if (E[i] < thr && E[i - 1] >= thr) { as.push(i - 1 + (E[i - 1] - thr) / (E[i - 1] - E[i])); while (i <= hi && E[i] < thr) i++; }
  for (let i = Math.min(n - 2, hi); i >= lo && bs.length < 2; i--) if (E[i] < thr && E[i + 1] >= thr) { bs.push(i + (thr - E[i]) / (E[i + 1] - E[i])); while (i >= lo && E[i] < thr) i--; }
  return [as, bs];
}
function textOf(vals) {                                               // start, data... (no check symbol) -> text
  let set = vals[0] === 105 ? 'C' : vals[0] === 104 ? 'B' : 'A', out = '', shift = false;
  for (let i = 1; i < vals.length; i++) {
    const v = vals[i];
    if (set === 'C') { if (v < 100) out += (v < 10 ? '0' : '') + v; else if (v === 100) set = 'B'; else if (v === 101) set = 'A'; continue; }
    const cur = shift ? (set === 'A' ? 'B' : 'A') : set; shift = false;
    if (v < 96) out += cur === 'B' || v < 64 ? String.fromCharCode(32 + v) : String.fromCharCode(v - 64);
    else if (v === 98) shift = true; else if (v === 99) set = 'C'; else if (v === 100 && set === 'A') set = 'B'; else if (v === 101 && set === 'B') set = 'A';
  }
  return out;
}
// how much the start and the stop of a K-symbol code look like themselves near a0 and b0, under blur si: slid in quarter modules
function endsAt(E, n, a0, b0, K, si, d0, d1, lastA, lastB) {
  const T = templates()[si], m = (b0 - a0) / (MOD * K + 2); let cs = -2, sv = -1, da = 0, ce = -2, db = 0;
  for (let d = d0; d <= d1; d++) {
    if (grab(E, n, a0 + ((lastA + d) * 0.25 - CTX) * m, m / G, WIN, BUF)) for (let q = 0; q < 3; q++) { const c = dot(BUF, T.start[q], WIN); if (c > cs) { cs = c; sv = 103 + q; da = lastA + d; } }
    if (grab(E, n, b0 + ((lastB - d) * 0.25 - 13 - CTX) * m, m / G, WSTOP, BUF)) { const c = dot(BUF, T.stop, WSTOP); if (c > ce) { ce = c; db = lastB - d; } }
  }
  return {cs, ce, sv, da, db, si};
}
// the reading of the line as a Code 128 of K symbols (start, data..., check, stop), its ends and blur as found by endsAt
function symbols(E, n, a0, b0, K, e) {
  const mods = MOD * K + 2, m0 = (b0 - a0) / mods, a = a0 + e.da * 0.25 * m0, b = b0 + e.db * 0.25 * m0, m = (b - a) / mods;
  const T = templates()[e.si], k = K - 3, step = m / G, D = T.data;    // k data symbols, then the check symbol
  // every symbol against every pattern (at three places around where it should be; the code is followed as it drifts)
  const cor = new Float32Array((k + 1) * 103); let drift = 0;
  for (let i = 1; i <= k + 1; i++) {
    const x = a + MOD * i * m + drift; PER.fill(-2); let b1 = -2, d1 = 0;
    // where it should be: against all 103; a third of a module either side: only against the TOPN that looked most like
    // it there (the others are far from being the reading, or its runner-up)
    if (grab(E, n, x - CTX * m, step, WIN, BUF)) {
      for (let v = 0, o = 0; v < 103; v++, o += WIN) { let c = 0; for (let j = 0; j < WIN; j++) c += BUF[j] * D[o + j]; PER[v] = c; if (c > b1) b1 = c; }
      let nt = 0;                                                     // the TOPN best, by insertion
      for (let v = 0; v < 103; v++) { const c = PER[v]; if (nt < TOPN) { let q = nt++; while (q > 0 && PER[TOP[q - 1]] < c) { TOP[q] = TOP[q - 1]; q--; } TOP[q] = v; } else if (c > PER[TOP[TOPN - 1]]) { let q = TOPN - 1; while (q > 0 && PER[TOP[q - 1]] < c) { TOP[q] = TOP[q - 1]; q--; } TOP[q] = v; } }
      for (let d = -1; d <= 1; d += 2) {
        if (!grab(E, n, x + (d * 0.3 - CTX) * m, step, WIN, BUF)) continue;
        for (let q = 0; q < nt; q++) { const v = TOP[q], o = v * WIN; let c = 0; for (let j = 0; j < WIN; j++) c += BUF[j] * D[o + j]; if (c > PER[v]) PER[v] = c; if (c > b1) { b1 = c; d1 = d; } }
      }
    } else {
      for (let d = -1; d <= 1; d += 2) {
        if (!grab(E, n, x + (d * 0.3 - CTX) * m, step, WIN, BUF)) continue;
        for (let v = 0, o = 0; v < 103; v++, o += WIN) { let c = 0; for (let j = 0; j < WIN; j++) c += BUF[j] * D[o + j]; if (c > PER[v]) PER[v] = c; if (c > b1) { b1 = c; d1 = d; } }
      }
    }
    cor.set(PER, (i - 1) * 103);
    drift += d1 * 0.3 * m * 0.6;
  }
  // the best and the second best reading whose check symbol agrees: start + sum of i x symbol i = the check symbol (mod 103).
  // cur[s] = the most resemblance the data symbols so far can add up to with a running sum of s; cur2[s] the next most
  const NEG = -1e9; let cur = new Float32Array(103).fill(NEG), cur2 = new Float32Array(103).fill(NEG); cur[e.sv % 103] = 0;
  const back = [];
  for (let i = 1; i <= k; i++) {
    const nx = new Float32Array(103).fill(NEG), nx2 = new Float32Array(103).fill(NEG), bk = new Int16Array(103).fill(-1), o = (i - 1) * 103;
    for (let s = 0; s < 103; s++) {
      const c0 = cur[s]; if (c0 === NEG) continue; const c20 = cur2[s];
      for (let v = 0, t = s; v < 103; v++, t = (t + i) % 103) {
        const sc = c0 + cor[o + v];
        if (sc > nx[t]) { nx2[t] = nx[t]; nx[t] = sc; bk[t] = v; } else if (sc > nx2[t]) nx2[t] = sc;
        if (c20 !== NEG) { const s2 = c20 + cor[o + v]; if (s2 > nx2[t]) nx2[t] = s2; }
      }
    }
    cur = nx; cur2 = nx2; back.push(bk);
  }
  let top = NEG, topS = -1, second = NEG; const oc = k * 103;
  for (let s = 0; s < 103; s++) { if (cur[s] === NEG) continue; const sc = cur[s] + cor[oc + s]; if (sc > top) { second = top; top = sc; topS = s; } else if (sc > second) second = sc; if (cur2[s] !== NEG) { const s2 = cur2[s] + cor[oc + s]; if (s2 > second) second = s2; } }
  if (topS < 0) return null;
  // (the top state's own runner-up is a different reading with the same check symbol: it counts as second too)
  if (cur2[topS] !== NEG && cur2[topS] + cor[oc + topS] > second) second = cur2[topS] + cor[oc + topS];
  const vals = new Array(k + 2); vals[k + 1] = topS; let s = topS;
  for (let i = k; i >= 1; i--) { const v = back[i - 1][s]; vals[i] = v; s = ((s - i * v) % 103 + 103) % 103; }
  vals[0] = e.sv;
  return {K, m, a, b, vals, fit: top / (k + 1), gap: top - second, ends: Math.min(e.cs, e.ce), sig: SIG[e.si]};
}
// E: the evened line in linear light (0..255, white high), n samples -> the best reading over the possible lengths, read
// from left to right, or null. o.expect: about how many samples long the code should be (the box it was found in).
function decodeDir(E, n, o) {
  const thr = o.thr || 190, expect = o.expect || 0.7 * n;
  let g = widest(E, n, thr, 0.06 * expect, 0, n - 1); if (!g) return null;
  const g2 = widest(E, n, thr, 0.06 * (g[1] - g[0]), g[0], g[1]); if (g2) g = g2;      // (a box that took a line in is longer than its code)
  const [as, bs] = feet(E, n, thr, Math.max(0, g[0] - 1), Math.min(n - 1, g[1] + 1));
  let r = null;
  // the group's own ends first; then with its first or last "bar" left out. All are tried and the best fit kept - unless
  // one reads strongly, or its start and stop sit where they should (then the others cannot do better).
  for (const [ai, bi] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    if (ai >= as.length || bi >= bs.length) continue;
    const a0 = as[ai], b0 = bs[bi]; if (b0 - a0 < 60) continue;
    // which lengths have a start and a stop in place at all? (a middling blur; the feet lie a little outside the bars)
    const ks = [];
    for (let K = KMIN; K <= 13; K++) {
      const m = (b0 - a0) / (MOD * K + 2); if (m < 2.2) break;        // under three quarters of a dot a module: nothing to read
      const e = endsAt(E, n, a0, b0, K, MID, -2, 4, 0, 0); if (e.cs >= 0.6 && e.ce >= 0.6) ks.push([e.cs + e.ce, K, e]);
    }
    ks.sort((x, y) => y[0] - x[0]);
    for (const [, K, e0] of ks.slice(0, 2)) {
      let e = e0;                                                     // the blur under which start and stop look most like themselves
      for (let si = 0; si < SIG.length; si++) { if (si === MID) continue; const c = endsAt(E, n, a0, b0, K, si, -1, 1, e0.da, e0.db); if (c.cs + c.ce > e.cs + e.ce) e = c; }
      if (e.cs < 0.7 || e.ce < 0.7) continue;
      const c = symbols(E, n, a0, b0, K, e); if (c && (!r || c.fit > r.fit)) r = c;
    }
    if (r && (STRONG(r) || r.ends >= 0.8)) break;
  }
  return r;
}
// A SLAB LIES ANY WAY ROUND on a table: the line is read left to right and, unless that reading is a strong one already,
// right to left as well - the better fit is the reading (bars read backwards resemble nothing: their best fit is a poor
// one). The way that read strongly last is tried first: slabs in a showcase mostly lie the same way round.
let PREF = 0, REV = new Float32Array(0);
function decode(E, n, opt) {
  const o = opt || {}; let best = null, bestRev = 0, made = false;
  for (let t = 0; t < 2; t++) {
    const rev = t ? 1 - PREF : PREF; let L = E;
    if (rev) { if (REV.length < n) REV = new Float32Array(n + 256); if (!made) { for (let i = 0; i < n; i++) REV[i] = E[n - 1 - i]; made = true; } L = REV; }
    const r = decodeDir(L, n, o);
    if (r && (!best || r.fit > best.fit)) { best = r; bestRev = rev; }
    if (STRONG(r) || o.oneWay) break;
  }
  if (!best) return null;
  if (bestRev) { const a = n - 1 - best.b, b = n - 1 - best.a; best.a = a; best.b = b; }
  best.rev = !!bestRev;
  if (STRONG(best)) PREF = bestRev;
  best.text = textOf(best.vals.slice(0, -1));
  return best;
}
root.SlabC128 = {decode, textOf, PAT};
})(typeof self !== 'undefined' ? self : globalThis);
