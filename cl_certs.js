#!/usr/bin/env node
/* cl_certs.js - the CL Cert column: the cert number on Card Ladder's picture of each grade's slab (2026-11-10, Brett:
   "we add a copy of each column, but have it start with CL Cert ... these columns will show data that from the cl cert
   number. the cl cert number can be found in the images. when you hit the review button for each, the cl listings have
   an image. on that image their is a cert number"; then "just prepare the columns for now and only fill out the column
   for cl cert").

   The picture is the one Review shows on the Card Ladder side: a card's Card Ladder profile read keeps one picture per
   grade (profiles/*.jsonl.gz "imgs", key "<grader>|<grade>|base" -> "fb:<path>" = Card Ladder's own copy on
   firebasestorage, "eb:<id>" = eBay's i.ebayimg.com, "u:<url>"). Each PSA / CGC picture is read ONCE: downloaded, its
   barcodes read with the Slab Show Scanner's own reader (page/app/zxing: zxing-wasm 3.1.6, the same build the phone
   app uses) - first the picture as it is, then enlarged 2x, then the scanner's finder (page/app/finder.js: it finds the
   barcode stripes and reads their folded lines, the grey-line reader beside zxing) on the 2x and 3x pictures, taking
   its sure, strong and weak readings (A / B / C - weak = zxing alone on two lines or more, as trustworthy as zxing on
   the whole picture; not the faint D). A cert counts only when it is the row's grader's kind (the same rules as
   the PriceCharting slab pass in Brett's Chrome): PSA = Code 128 of 8-9 digits, ITF of 8, or a QR psacard.com/cert/<n>;
   CGC = Code 128 of 10 digits, or 13 starting 1401. Two different certs in one picture (a lot, two slabs) = "many",
   none chosen. Tried on 200 random PSA / CGC pictures (this very code, in a browser, on 2026-11-10): 163 read as they
   are or at 2x, 23 more with the finder (186 = 93%; three more were weak readings, taken since), 2 did not download;
   none gave two certs, and a first try with the browser's own enlarging read the same certs on all 183 both read.

   Reads go to card-data data/cardladder/pic_certs/reads_<YYYY-MM>.csv (appended; a picture's newest row wins), which
   the site's checkout of card-data already holds (data/cardladder/ but sales/) - graded_site.py turns them into the CL
   Cert column. Columns: read_at, pc, gk, pic, status (ok / none / many / err), cert, how (1x, 2x, f2 / f3 = the finder
   at 2x / 3x, with its class), seen (everything the readers decoded, | between), w, h, ms, v (this reader's version:
   a later version may read its "none" pictures again). err = the picture did not download or decode: tried again in a
   later run, three times at most. Pictures come as JPEG (jpeg-js decodes them), PNG or WebP (about one in eight of
   Card Ladder's own copies - sharp decodes those; the first run, without it, left them "not a JPEG", which is read
   again at once and counts as no try).

   Order: the cards in the Card Ladder run's order (cardladder/queue.csv), the four grades the page shows first (PSA 10,
   PSA 9, CGC 10, CGC 10 Pristine), then every other PSA / CGC grade. Workers: one per CPU (at most 4), each with its own
   zxing; downloads run ahead of them, at most PACE a second (Card Ladder's picture store and eBay's are public, but a
   steady trickle, not a flood: the whole first pass, ~89,000 pictures, takes about a day of two-hourly runs). Stops at
   --minutes and writes what it has every 200 pictures, so a run cut short keeps its reads.

   Run by .github/workflows/cl_certs.yml (every two hours):
     npm install --no-save --prefix /tmp/clc jpeg-js@0.4.4 sharp@0.33.5
     NODE_PATH=/tmp/clc/node_modules node cl_certs.js --card-data card-data/data --app page/app --minutes 40
*/
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os'), vm = require('vm');
const {Worker, isMainThread, parentPort, workerData} = require('worker_threads');

const VERSION = 1;
const FIRST = ['psa|g10', 'psa|g9', 'cgc|g10', 'cgc|g10pristine'];
const MAXPX = 14e6;                         // the largest enlarged picture (pixels)
const PACE = 3;                             // downloads a second, at most
const COLS = ['read_at', 'pc', 'gk', 'pic', 'status', 'cert', 'how', 'seen', 'w', 'h', 'ms', 'v'];

// ---- reading one picture (also run in a browser for the trial: no Node in it) ----
const OPT = {formats: ['Code128', 'ITF', 'QRCode', 'Code39', 'DataMatrix'], tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 12};
const ROWS = {formats: ['Code128', 'ITF'], tryHarder: true, tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 255, binarizer: 'GlobalHistogram', minLineCount: 1};
function certOf(grader, format, text) {      // the cert in a reading, or null when it is not this grader's kind
  const t = String(text || '').trim(), f = String(format || '');
  if (grader === 'psa') {
    const q = /psacard\.com\/cert\/(\d{7,10})/i.exec(t); if (q) return q[1];
    if (/^\d+$/.test(t) && ((f === 'ITF' && t.length === 8) || (/Code128|Code39/.test(f) && (t.length === 8 || t.length === 9)))) return t;
    return null;
  }
  if (grader === 'cgc') return /^\d+$/.test(t) && /Code128|Code39/.test(f) && (t.length === 10 || (t.length === 13 && t.startsWith('1401'))) ? t : null;
  return null;
}
function enlarge(img, k) {                    // the picture k times as big (bicubic, Catmull-Rom), grey: what the readers look at
  const w = img.width, h = img.height, d = img.data, W = Math.round(w * k), H = Math.round(h * k);
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  const cub = t => { const a = -0.5, x = Math.abs(t); return x <= 1 ? (a + 2) * x * x * x - (a + 3) * x * x + 1 : x < 2 ? a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a : 0; };
  const taps = (n, N) => {                    // for each output position: the four source positions and their weights
    const idx = new Int32Array(N * 4), wt = new Float32Array(N * 4);
    for (let o = 0; o < N; o++) {
      const s = (o + 0.5) / k - 0.5, b = Math.floor(s); let sum = 0;
      for (let t = 0; t < 4; t++) { const p = b - 1 + t, ww = cub(s - p); idx[o * 4 + t] = p < 0 ? 0 : p >= n ? n - 1 : p; wt[o * 4 + t] = ww; sum += ww; }
      for (let t = 0; t < 4; t++) wt[o * 4 + t] /= sum;
    }
    return [idx, wt];
  };
  const [xi, xw] = taps(w, W), [yi, yw] = taps(h, H), mid = new Float32Array(W * h);
  for (let y = 0; y < h; y++) { const row = y * w, out = y * W; for (let x = 0; x < W; x++) { const q = x * 4; mid[out + x] = g[row + xi[q]] * xw[q] + g[row + xi[q + 1]] * xw[q + 1] + g[row + xi[q + 2]] * xw[q + 2] + g[row + xi[q + 3]] * xw[q + 3]; } }
  const D = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const q = y * 4, r0 = yi[q] * W, r1 = yi[q + 1] * W, r2 = yi[q + 2] * W, r3 = yi[q + 3] * W, w0 = yw[q], w1 = yw[q + 1], w2 = yw[q + 2], w3 = yw[q + 3];
    for (let x = 0, o = y * W * 4; x < W; x++, o += 4) { const v = mid[r0 + x] * w0 + mid[r1 + x] * w1 + mid[r2 + x] * w2 + mid[r3 + x] * w3; D[o] = D[o + 1] = D[o + 2] = v; D[o + 3] = 255; }
  }
  return {data: D, width: W, height: H};
}
async function readPicture(img, grader, Z, F) {   // -> {status: ok | none | many, cert, how, seen}
  const seen = new Set(), note = (f, t) => { if (seen.size < 12) seen.add(f + ':' + t); };
  const done = (found, how) => { const c = [...found]; return {status: c.length === 1 ? 'ok' : 'many', cert: c.length === 1 ? c[0] : c.join(' '), how, seen: [...seen].join('|')}; };
  const zx = async (im, how) => {
    let res = []; try { res = await Z.readBarcodes(im, OPT); } catch (e) {}
    const found = new Set(); for (const r of res) { if (r.isValid === false) continue; note(r.format, r.text); const c = certOf(grader, r.format, r.text); if (c) found.add(c); }
    return found.size ? done(found, how) : null;
  };
  const finder = async (im, how) => {
    if (!F) return null;
    let d = null;
    try {
      const job = F.prepare(im.data, im.width, im.height, {cutMs: 1e9}), lay = job.lines(), zres = [];
      for (const pic of lay.pics) { let r = []; try { r = await Z.readBarcodes(pic, ROWS); } catch (e) {} zres.push(r); }
      d = job.decide(lay, zres);
    } catch (e) { return null; }
    const found = new Set(); let cls = '';
    for (const r of d.reads) { note(r.cls + r.format, r.text); if (r.cls === 'D') continue; const c = certOf(grader, r.format, r.text); if (c) { found.add(c); cls = cls || r.cls; } }
    return found.size ? done(found, how + cls) : null;
  };
  const px = img.width * img.height;
  let out = await zx(img, '1x'); if (out) return out;
  const k2 = Math.min(2, Math.sqrt(MAXPX / px)), k3 = Math.min(3, Math.sqrt(MAXPX / px));
  let big = null;
  if (k2 >= 1.4) { big = enlarge(img, k2); out = await zx(big, '2x'); if (out) return out; }
  out = await finder(big || img, big ? 'f2' : 'f1'); if (out) return out;
  if (k3 >= (big ? k2 : 1) + 0.5) { big = null; out = await finder(enlarge(img, k3), 'f3'); if (out) return out; }
  return {status: 'none', cert: '', how: '', seen: [...seen].join('|')};
}

module.exports = {certOf, enlarge, readPicture, picUrl};

// ---- the worker: decode + read ----
if (!isMainThread) {
  const {app} = workerData;
  vm.runInThisContext(fs.readFileSync(path.join(app, 'zxing', 'reader.js'), 'utf8'));
  require(path.resolve(app, 'finder.js'));
  const jpeg = require('jpeg-js');
  const Z = globalThis.ZXingWASM, F = globalThis.SlabFinder;
  const ready = Z.prepareZXingModule({overrides: {wasmBinary: fs.readFileSync(path.join(app, 'zxing', 'zxing_reader.wasm'))}, fireImmediately: true});
  parentPort.on('message', async m => {
    const t0 = Date.now();
    try {
      await ready;
      const b = Buffer.from(m.buf);
      let img;
      if (b[0] === 0xFF && b[1] === 0xD8) {
        const im = jpeg.decode(b, {useTArray: true, formatAsRGBA: true, maxResolutionInMP: 60, maxMemoryUsageInMB: 1024});
        img = {data: new Uint8ClampedArray(im.data.buffer, im.data.byteOffset, im.data.length), width: im.width, height: im.height};
      } else {                                 // PNG / WebP (about one picture in eight on Card Ladder's store): sharp (libvips)
        let sharp; try { sharp = require('sharp'); } catch (e) { throw new Error('not a JPEG (' + b.subarray(0, 4).toString('hex') + '), no sharp'); }
        const {data, info} = await sharp(b, {limitInputPixels: 60e6}).ensureAlpha().raw().toBuffer({resolveWithObject: true});
        if (info.channels !== 4) throw new Error('decoded to ' + info.channels + ' channels');
        img = {data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height};
      }
      const r = await readPicture(img, m.grader, Z, F);
      parentPort.postMessage(Object.assign({id: m.id, w: img.width, h: img.height, ms: Date.now() - t0}, r));
    } catch (e) {
      parentPort.postMessage({id: m.id, status: 'err', cert: '', how: '', seen: String(e && e.message || e).slice(0, 120), ms: Date.now() - t0});
    }
  });
  return;
}

// ---- the main thread ----
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const CD = arg('card-data', 'card-data/data'), APP = arg('app', 'page/app');
const MINUTES = +arg('minutes', 40), MAX = +arg('max', 1e9), NW = Math.max(1, Math.min(+arg('workers', 0) || os.cpus().length, 4));
const OUTDIR = path.join(CD, 'cardladder', 'pic_certs');
const T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function csvRows(text) {                     // a CSV file -> [[cells]] (quotes, commas and newlines inside quotes)
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}
function picUrl(s) {                         // a picture's code -> its address (graded.js GR_CL_IMG: the same)
  return s.startsWith('fb:') ? 'https://firebasestorage.googleapis.com/v0/b/cardladder-71d53.appspot.com/o/' + s.slice(3) + '?alt=media'
    : s.startsWith('eb:') ? 'https://i.ebayimg.com/images/g/' + s.slice(3) + '/s-l1600.jpg' : s.startsWith('u:') ? s.slice(2) : '';
}

function loadProfiles() {                    // {pc id: newest profile read} - as graded_site.load_profiles
  const dir = path.join(CD, 'cardladder', 'profiles'), out = new Map();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl.gz')).sort()) {
    for (const line of zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      if (o.err || !o.pid) continue;
      const k = String(o.pc || ''); if (!k) continue;
      const have = out.get(k); if (!have || String(o.read || '') >= String(have.read || '')) out.set(k, o);
    }
  }
  return out;
}
function loadQueue() {                       // {pc id: rank}
  const p = path.join(CD, 'cardladder', 'queue.csv'), out = new Map(); if (!fs.existsSync(p)) return out;
  const lines = fs.readFileSync(p, 'utf8').split('\n'), head = lines[0].split(','), ir = head.indexOf('rank'), ip = head.indexOf('pricecharting_id');
  for (const l of lines.slice(1)) { const c = l.split(','), r = +c[ir], id = c[ip]; if (id && /^\d+$/.test(id) && r && !out.has(id)) out.set(id, r); }
  return out;
}
function loadReads() {                       // {pic: {status, tries, v, at}} - the newest row of each picture wins
  const out = new Map(); if (!fs.existsSync(OUTDIR)) return out;
  for (const f of fs.readdirSync(OUTDIR).filter(f => /^reads_\d{4}-\d{2}\.csv$/.test(f)).sort()) {
    const rows = csvRows(fs.readFileSync(path.join(OUTDIR, f), 'utf8')), head = rows.shift() || [], ix = Object.fromEntries(head.map((h, i) => [h, i]));
    for (const r of rows) {
      const pic = r[ix.pic]; if (!pic) continue;
      // a PNG / WebP picture the first runs could not decode ("not a JPEG") is no failed try: it is read again at once
      const prev = out.get(pic), st = r[ix.status], fmt = st === 'err' && /^not a JPEG/.test(r[ix.seen] || '');
      out.set(pic, {status: st, fmt, v: +r[ix.v] || 0, at: r[ix.read_at] || '', tries: (prev ? prev.tries : 0) + (st === 'err' && !fmt ? 1 : 0)});
    }
  }
  return out;
}

async function main() {
  const profiles = loadProfiles(), queue = loadQueue(), reads = loadReads();
  log('profiles', profiles.size, '| queue', queue.size, '| pictures read before', reads.size);
  // the pictures to read: each PSA / CGC grade's picture of each card, cards in the queue's order, the page's four grades first
  const todo = [], seenPic = new Set(), now = Date.now();
  const cards = [...profiles.keys()].sort((a, b) => (queue.get(a) || 1e9) - (queue.get(b) || 1e9) || a.localeCompare(b));
  for (const pass of [0, 1]) for (const pc of cards) {
    const imgs = profiles.get(pc).imgs || {};
    for (const k of Object.keys(imgs)) {
      if (!k.endsWith('|base')) continue;
      const gk = k.slice(0, -5), grader = gk.split('|')[0];
      if ((grader !== 'psa' && grader !== 'cgc') || gk.endsWith('|auth') || (FIRST.includes(gk) ? 1 : 0) !== 1 - pass) continue;
      const pic = imgs[k]; if (!pic || seenPic.has(pic) || !picUrl(pic)) continue;
      const r = reads.get(pic);
      if (r && (r.status === 'ok' || r.status === 'many' || (r.status === 'none' && r.v >= VERSION))) continue;
      if (r && r.status === 'err' && !r.fmt && (r.tries >= 3 || now - Date.parse(r.at) < 20 * 3600e3)) continue;
      seenPic.add(pic); todo.push({pc, gk, grader, pic});
    }
  }
  log('to read', todo.length, '(the page\'s four grades first) | workers', NW, '| minutes', MINUTES);
  if (!todo.length) return;
  fs.mkdirSync(OUTDIR, {recursive: true});
  const month = new Date().toISOString().slice(0, 7), file = path.join(OUTDIR, 'reads_' + month + '.csv');
  if (!fs.existsSync(file)) fs.writeFileSync(file, COLS.join(',') + '\n');
  let buf = [];
  const flush = () => { if (buf.length) { fs.appendFileSync(file, buf.join('')); buf = []; } };
  const tally = {ok: 0, none: 0, many: 0, err: 0}, hows = {};
  const pool = [...Array(NW)].map(() => new Worker(__filename, {workerData: {app: path.resolve(APP)}}));
  const waiting = new Map(); let seq = 0;
  for (const w of pool) w.on('message', m => { const f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m); } });
  const idle = pool.slice(), idleWait = [];
  const getWorker = () => idle.length ? Promise.resolve(idle.pop()) : new Promise(res => idleWait.push(res));
  const freeWorker = w => { const f = idleWait.shift(); if (f) f(w); else idle.push(w); };
  const deadline = T0 + MINUTES * 60e3;
  let next = 0, done = 0, slot = Date.now();
  const paced = async () => { const t = Math.max(Date.now(), slot); slot = t + 1000 / PACE; if (t > Date.now()) await new Promise(r => setTimeout(r, t - Date.now())); };
  const fetchPic = async job => {               // -> ArrayBuffer, or throws
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(picUrl(job.pic), {signal: ac.signal, headers: {'User-Agent': 'biotech-catelog cl_certs.js (github.com/BrettS600/biotech-catelog)', Accept: 'image/jpeg,image/*;q=0.8'}});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.arrayBuffer();
    } finally { clearTimeout(t); }
  };
  const one = async job => {
    let m;
    try {
      await paced();
      const ab = await fetchPic(job), w = await getWorker(), id = ++seq;
      m = await new Promise(res => { waiting.set(id, res); w.postMessage({id, grader: job.grader, buf: ab}, [ab]); });
      freeWorker(w);
    } catch (e) { m = {status: 'err', cert: '', how: '', seen: String(e && e.message || e).slice(0, 120)}; }
    tally[m.status] = (tally[m.status] || 0) + 1; if (m.how) hows[m.how] = (hows[m.how] || 0) + 1;
    buf.push([new Date().toISOString().slice(0, 19) + 'Z', job.pc, job.gk, job.pic, m.status, m.cert, m.how, m.seen, m.w || '', m.h || '', m.ms || '', VERSION].map(csvCell).join(',') + '\n');
    if (++done % 200 === 0) { flush(); log(done, 'read', JSON.stringify(tally)); }
  };
  const lanes = [...Array(NW * 2)].map(async () => { while (next < todo.length && next < MAX && Date.now() < deadline) await one(todo[next++]); });
  await Promise.all(lanes);
  flush();
  for (const w of pool) await w.terminate();
  log('done:', done, 'pictures in', Math.round((Date.now() - T0) / 1000), 's |', JSON.stringify(tally), '| how', JSON.stringify(hows), '| left', todo.length - done);
}
if (require.main === module) main().catch(e => { console.error('ERR', e); process.exit(1); });
