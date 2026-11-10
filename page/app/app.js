/* Slab Show Scanner - Brett's card-show app (2026-11-09; the design approved on the prototype 2026-11-06..09).
   Brett: "I walk into a vendor show. I approach the first table, I press a video record button ... the bardcodes of the
   graded slabs are read ... The cards scanned in that film have their records categorized as table 1 ... I ask vendor if he
   would be willing to sell it for me at 14% under, he says no, I will do only 13%, Then I record the 13% number ... After
   visiting all tables ... I see a summary of which cards to buy and at which table I can find them."
   2026-11-09: "make the % field typable like the price field"; "remove and replace the recent card sale with the review
   button"; "add a min sales last mo variable to the show mobile tab" (default 5); "add a record purchases button so that
   they are sent to history tab on website"; a home-screen web app, everything now, the sample show kept.

   Data: data.bin next to this page (graded_site.py app_doc, the website's key = PBKDF2 of the site password, entered here
   once and kept on this phone). The money math is the website's Recording page's: Card Ladder's standard price, the
   Forecast's odds tables at the hold and today's rank, eBay's fee 13.25% with the 6.5% buyer tax, the shipping in the price.
   Scanning: the camera's frames read with zxing (zxing/reader.js + .wasm). A PSA slab is looked up with PSA's own API (the
   token Brett pastes on the Show tab, kept on this phone only; 100 a day); its spec leads to the catalog card. A CGC slab
   is found by name until the Card Hedge step. Record Purchases sends a 'gplan' to the collector, as the website's button.
   The scanner upgrade (2026-11-09; Brett: depth, angles, glare, glass cases, "the barcodes are just automatically picked
   up during the recording"): the camera at the most it gives (4K where it can), every frame read at full size in a worker
   (scan-worker.js), the main or the 3x telephoto lens, boxes on what was read, a beep, the screen kept awake; a video
   from the Camera app read frame by frame; Test mode (nothing saved, looked up or sent; every code with its detail in
   camera dots per bar). g13 (2026-11-10, the last build of the scanner, after Brett's seven test files): the barcodes
   are FOUND in the frame first, whichever way round they lie, and each is read from its own lines by two readers
   (finder.js); a number counts once the reading is sure (see "WHEN A NUMBER COUNTS"). Every real slab
   read goes to the collector ('scan') and on into card-data's data/scans/scans.csv as its PSA / CGC cert link. */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const FEE = 0.1325 * 1.065;                 // eBay's final value fee with the buyer tax on it (the website's 14.11%)
const FC_RHO = 0.5, FC_P_CAP = 0.95;        // the website's basket: the market's share of a pick's swings; no chance above 95%
const KEY_STORE = 'ssc-key', STATE_STORE = 'ssc-state-1', PSA_TOKEN = 'ssc-psa-token', PSA_DAY = 'ssc-psa-day', PSA_MAX = 100;
const SCANQ = 'ssc-scan-q', SCANN = 'ssc-scan-n';   // cert links waiting for the collector / sent so far (scans.csv)
const DEFAULTS = {show: 'Saturday Card Show', capital: 10000, hold: 3, under: 14.1, ship: 5.2, bar: 50, share: 20, minSales: 5, gate: true, beep: true, lens: 'main'};

/* ---------------- small helpers ---------------- */
function money(v) { if (v == null || !isFinite(v)) return '-'; const a = Math.abs(v); const s = a >= 100 ? Math.round(a).toLocaleString('en-US') : a.toFixed(2); return (v < 0 ? '-$' : '$') + s; }
const signed = v => v == null ? '-' : (v >= 0 ? '+' : '-') + money(Math.abs(v));
const pctS = (x, nd) => x == null || !isFinite(x) ? '-' : (Math.round(x * 100 * Math.pow(10, nd || 0)) / Math.pow(10, nd || 0)).toFixed(nd || 0) + '%';
const r2 = v => v == null ? null : Math.round(v * 100) / 100;
function ord(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function hhmm(ms) { const d = new Date(ms); const h = d.getHours(), m = d.getMinutes(); return ((h + 11) % 12 + 1) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' am' : ' pm'); }
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function numNorm(s) {                        // card numbers: "085" = "85", "SWSH050" = "swsh50", "215/203" = "215"
  const v = String(s || '').toLowerCase().split('/')[0].replace(/[^a-z0-9]/g, '');
  const m = /^([a-z]*)0*(\d+)([a-z]*)$/.exec(v);
  return m ? m[1] + m[2] + m[3] : v;
}
function gkLabel(gk) {
  if (!gk) return 'grade ?';
  const [g, k] = gk.split('|'), G = g.toUpperCase();
  if (k === 'g10pristine') return G + ' 10 Pristine';
  if (k === 'g10perfect') return G + ' 10 Perfect';
  return G + ' ' + k.slice(1).replace('_', '.');
}
const gkShort = gk => !gk ? '?' : gk.endsWith('pristine') ? '10P' : gk.endsWith('perfect') ? '10★' : gk.split('|')[1].slice(1).replace('_', '.');
const titleCase = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
// numbers typed in Show's boxes are kept as typed ("10,000") and read as numbers where used
const numSet = k => { const n = parseFloat(String(S.settings[k]).replace(/[$,\s]/g, '')); return isFinite(n) ? n : 0; };
let TOAST_T = 0;
function toast(msg) { const el = $('toast'); el.innerHTML = '<div class="toast">' + esc(msg) + '</div>'; clearTimeout(TOAST_T); TOAST_T = setTimeout(() => { el.innerHTML = ''; }, 3200); }

/* ---------------- the sample show (invented prices; Brett: "lets keep the sample data so i have something to see") ---------------- */
const SRC = [
  ['Umbreon VMAX', 'Evolving Skies', '215', 'PSA', '10', 1450], ['Umbreon VMAX', 'Evolving Skies', '215', 'PSA', '9', 720],
  ['Charizard ex', 'Obsidian Flames', '223', 'PSA', '10', 210], ['Pikachu with Grey Felt Hat', 'SVP Black Star', '085', 'PSA', '10', 640],
  ['Rayquaza VMAX', 'Evolving Skies', '218', 'PSA', '10', 890], ['Giratina V', 'Lost Origin', '186', 'PSA', '10', 520],
  ['Lugia V', 'Silver Tempest', '186', 'PSA', '10', 330], ['Charizard', 'Base Set Unlimited', '4', 'PSA', '7', 760],
  ['Blastoise', 'Base Set Unlimited', '2', 'PSA', '8', 340], ['Mew ex', '151', '205', 'PSA', '10', 160],
  ['Charizard ex', '151', '199', 'PSA', '10', 380], ['Gengar VMAX', 'Fusion Strike', '271', 'CGC', '10P', 610],
  ['Espeon VMAX', 'Evolving Skies', '270', 'PSA', '10', 330], ['Sylveon VMAX', 'Evolving Skies', '212', 'CGC', '9.5', 180],
  ['Shining Tyranitar', 'Neo Destiny', '113', 'PSA', '8', 1900], ['Lugia', 'Neo Genesis 1st Edition', '9', 'PSA', '7', 1450],
  ['Iono', 'Paldea Evolved', '269', 'PSA', '10', 95], ['Pikachu VMAX', 'Vivid Voltage', '188', 'PSA', '10', 420],
  ['Mewtwo', 'Base Set Unlimited', '10', 'PSA', '9', 160], ['Leafeon VMAX', 'Evolving Skies', '205', 'CGC', '9.5', 210],
  ['Glaceon VMAX', 'Evolving Skies', '209', 'PSA', '10', 480], ['Dragonite V', 'Evolving Skies', '192', 'PSA', '10', 190],
  ['Gardevoir ex', 'Scarlet & Violet', '245', 'PSA', '10', 70], ['Venusaur', 'Base Set Unlimited', '15', 'PSA', '8', 260],
  ['Snorlax', 'Jungle 1st Edition', '11', 'CGC', '9', 140], ['Magikarp', 'Paldea Evolved', '203', 'PSA', '10', 110],
  ['Mewtwo VSTAR', 'Crown Zenith', 'GG44', 'PSA', '10', 85], ['Rayquaza Gold Star', 'EX Deoxys', '107', 'PSA', '6', 1300],
  ['Tyranitar V', 'Battle Styles', '155', 'PSA', '10', 120], ['Zapdos', 'Base Set Unlimited', '16', 'CGC', '8.5', 95],
  ['Alakazam', 'Base Set Unlimited', '1', 'PSA', '9', 260], ['Gyarados', 'Base Set Unlimited', '6', 'PSA', '8', 120],
  ['Ninetales', 'Base Set Unlimited', '12', 'PSA', '9', 230], ['Moltres & Zapdos & Articuno GX', 'Hidden Fates', '44', 'PSA', '10', 260]
];
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const POOL = SRC.map((p, i) => {
  const r = mulberry(4242 + i * 131);
  const std = Math.round(p[5] * (0.92 + r() * 0.16) * 100) / 100, pct = Math.round(4 + r() * 94);
  const mu3 = -0.05 + 0.15 * Math.exp(-Math.pow((pct - 72) / 30, 2)), sd3 = 0.17 + r() * 0.12, cheap = std < 300;
  const n30 = Math.max(3, Math.round((cheap ? 9 : 3) + r() * (cheap ? 30 : 12))), sold = Math.max(1, Math.round(n30 * (0.8 + r() * 0.5)));
  const conf = 2 + Math.floor(r() * 4), clv = Math.round(std * (conf >= 4 ? 0.95 + r() * 0.12 : 0.78 + r() * 0.55));
  const pc = Math.round(std * (0.86 + r() * 0.26) * 100) / 100, soldPC = Math.max(0, Math.round(sold * (0.25 + r() * 0.6)));
  const grade = p[4] === '10P' ? '10' : p[4];
  return {i, name: p[0], set: p[1], num: p[2], grader: p[3], grade, pristine: p[4] === '10P', std, pct, mu3, sd3, n30, sold, conf, clv, pc, soldPC, match: r() < 0.86 ? 'ok' : 'review'};
});
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
const phi = x => 0.5 * (1 + erf(x / Math.SQRT2));
function demoCert(c, r) { const n = c.grader === 'PSA' ? 8 : 10; let s = ''; for (let k = 0; k < n; k++) s += Math.floor(r() * 10); return s[0] === '0' ? '7' + s.slice(1) : s; }

/* ---------------- state ---------------- */
function baseState() { return {settings: Object.assign({}, DEFAULTS), tables: [], slabs: {}, seq: 1, marks: {}}; }
function demoState() {
  const s = baseState(), r = mulberry(99), now = Date.now();
  const plan = [
    {vendor: 'Red Dragon Cards', ago: 95, cards: [[0, 'asked', 13], [3, 'new'], [9, 'new'], [12, 'agreed', 15], [16, 'new'], [21, 'new'], [25, 'declined', 8], [30, 'new'], [33, 'new']]},
    {vendor: 'Booth 214', ago: 52, cards: [[2, 'new'], [4, 'asked', 12], [7, 'new'], [10, 'new'], [18, 'new'], [22, 'new'], [27, 'new']]},
    {vendor: 'Slab King', ago: 18, cards: [[1, 'new'], [5, 'new'], [6, 'bought', 16], [8, 'new'], [11, 'new'], [13, 'new'], [14, 'asked', 11], [17, 'new'], [19, 'new'], [23, 'new'], [31, 'new']]}
  ];
  plan.forEach((t, ti) => {
    const id = 'd' + (ti + 1);
    s.tables.push({id, n: ti + 1, vendor: t.vendor, at: now - t.ago * 60000});
    t.cards.forEach((c, k) => {
      const sid = 's' + (s.seq++);
      s.slabs[sid] = {id: sid, demo: true, c: c[0], t: id, cert: demoCert(POOL[c[0]], r), mode: 'pct', vd: c[2] != null ? c[2] : null, vp: null, st: c[1], at: now - t.ago * 60000 + k * 1500};
    });
  });
  return s;
}
let S = LS.get(STATE_STORE, null) || demoState();
S.settings = Object.assign({}, DEFAULTS, S.settings || {});
S.marks = S.marks || {};
let UI = {tab: S.tables.length ? 'tables' : 'scan', openTable: null, sheet: null, view: 'slab', rec: false, recTable: null, recStart: 0,
  feed: [], feedN: 0, dup: null, draftVendor: '', sort: 'best', q: '', pickGk: null, confirmNew: false, sending: false, recMsg: null, addCert: '', camErr: null,
  test: false, scanMsg: null};
let SAVE_T = 0;
function save() { clearTimeout(SAVE_T); SAVE_T = setTimeout(() => LS.set(STATE_STORE, S), 150); }
const slabsArr = () => Object.values(S.slabs);
const tablesSorted = () => S.tables.slice().sort((a, b) => a.n - b.n);
const tableOf = id => S.tables.find(t => t.id === id) || null;

/* ---------------- the card data (data.bin, the website's key) ---------------- */
let KEY = LS.get(KEY_STORE, null), D = null, IDX = null, DSTATE = KEY ? 'loading' : 'locked', DERR = '';
const hex2bytes = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
async function deriveKey(pw) {
  const enc = new TextEncoder(), base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('biotech-catalog-live-v1'), iterations: 600000}, base, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function decryptGz(buf, keyHex) {
  const key = await crypto.subtle.importKey('raw', hex2bytes(keyHex), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: buf.slice(0, 12)}, key, buf.slice(12));
  return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
async function fetchData() {
  const res = await fetch('data.bin', {cache: 'no-cache'});
  if (!res.ok) throw new Error('the card data is not on the site yet (HTTP ' + res.status + ')');
  return new Uint8Array(await res.arrayBuffer());
}
function buildIdx(d) {
  const gk = d.gk, row = new Map(), spec = new Map(), list = [];
  for (const r of d.rows) row.set(r[0] + '|' + gk[r[1]], r);
  for (const [cid, c] of Object.entries(d.cards)) {
    const sp = new Set();
    if (c[3]) sp.add(String(c[3]));
    const m = /^(?:psa|matched)-(\d+)$/.exec(c[5] || ''); if (m) sp.add(m[1]);
    sp.forEach(x => { if (!spec.has(x)) spec.set(x, []); spec.get(x).push(+cid); });
    list.push({cid: +cid, hay: ' ' + norm(c[0] + ' ' + c[1] + ' ' + c[6]) + ' ', num: numNorm(c[2])});
  }
  return {row, spec, list, lines: d.fc ? d.fc.lines : []};
}
async function loadData(keyHex) {
  DSTATE = 'loading'; DERR = ''; renderTop();
  try {
    const buf = await fetchData();
    let doc;
    try { doc = await decryptGz(buf, keyHex); } catch (e) { DSTATE = 'locked'; DERR = 'That password did not open the card data.'; KEY = null; LS.del(KEY_STORE); return false; }
    D = doc; IDX = buildIdx(doc); DSTATE = 'ok'; KEY = keyHex; LS.set(KEY_STORE, keyHex);
    slabsArr().forEach(sl => { if (!sl.demo && (sl.look === 'wait' || (sl.look === 'manual' && sl.lookWhy === 'lock'))) sl.look = 'queued'; });
    pumpLookups();
    scheduleScanSend(1500);                  // cert links read while locked go out now
    return true;
  } catch (e) { DSTATE = 'err'; DERR = String(e.message || e); return false; } finally { render(); }
}

/* ---------------- the money (the website's Recording math) ---------------- */
const regOf = fc => fc.regime && fc.regime.up ? 'up' : 'down';
const tabFor = (fc, h, g) => g == null ? null : fc.tables[h + '|' + regOf(fc) + '|' + g] || fc.tables[h + '|all|all'] || null;
function cdf(fc, t, x) {                     // P(return <= x) off the 1..99% grid (graded_fc.js fcgCdf)
  const qs = fc.qs, q = t[1], n = q.length;
  if (x < q[0]) return Math.max(0, qs[0] * (1 - (q[0] - x) / Math.max(1e-6, q[1] - q[0])));
  if (x >= q[n - 1]) return Math.min(1, qs[n - 1] + (1 - qs[n - 1]) * (x - q[n - 1]) / Math.max(1e-6, q[n - 1] - q[n - 2]));
  let i = n - 1; while (i > 0 && q[i] > x) i--;
  return qs[i] + (qs[i + 1] - qs[i]) * (x - q[i]) / Math.max(1e-9, q[i + 1] - q[i]);
}
function draw(fc, t, u) {                    // a return at probability u (fcgDraw)
  const qs = fc.qs, q = t[1], n = q.length;
  if (u <= qs[0]) return Math.max(-0.95, q[0] - (q[1] - q[0]) * (qs[0] - u) / qs[0]);
  if (u >= qs[n - 1]) return q[n - 1] + (q[n - 1] - q[n - 2]) * (u - qs[n - 1]) / (1 - qs[n - 1]);
  let i = 0; while (i < n - 1 && qs[i + 1] < u) i++;
  return q[i] + (q[i + 1] - q[i]) * (u - qs[i]) / (qs[i + 1] - qs[i]);
}
const netOf = (std, r, d) => std == null ? null : std * ((1 + r) * (1 - FEE) - (1 - d));
// one slab's figures: identity, prices, and its money at the vendor's price (or your ask)
function calc(sl) {
  const s = S.settings, ship = numSet('ship'), h = s.hold;
  const x = {sl, demo: !!sl.demo};
  if (sl.demo) {
    const c = POOL[sl.c];
    Object.assign(x, {name: c.name, sub: c.set + ' #' + c.num, grader: c.grader, gk: c.grader.toLowerCase() + '|g' + (c.pristine ? '10pristine' : c.grade.replace('.', '_')),
      std: c.std, win: '30 days', n: c.n30, clv: c.clv, conf: c.conf, pc: c.pc, sold: c.sold, soldPC: c.soldPC, pct: c.pct / 100, known: true, img: null});
  } else {
    const c = D && sl.cid != null ? D.cards[String(sl.cid)] : null, r = c && sl.gk ? IDX.row.get(sl.cid + '|' + sl.gk) : null;
    const a = sl.auth || {};
    Object.assign(x, {grader: (sl.grader || '').toUpperCase(), gk: sl.gk || null, known: !!c,
      name: c ? c[0] : a.subject ? titleCase(a.subject) : (sl.grader || '').toUpperCase() + ' ' + sl.cert,
      sub: c ? (c[1] + (c[2] ? ' #' + c[2] : '')) : a.brand ? titleCase(a.brand) + (a.num ? ' #' + a.num : '')
        : sl.look === 'queued' || sl.look === 'looking' ? 'Looking it up with PSA…' : 'Tap to find the card',
      std: r ? r[2] : null, win: r && r[3] ? r[3] + ' days' : null, n: r ? r[4] : null, n12: r ? r[5] : null, conf: r ? r[6] : null,
      sold: r ? r[7] : null, pc: r ? r[8] : null, soldPC: r ? r[9] : null, clv: r ? r[10] : null, card: c, row: r, img: c ? c[7] : null});
    const fc = D && D.fc, li = fc && sl.gk ? IDX.lines.indexOf(sl.gk) : -1, pv = li >= 0 ? (fc.pct[String(sl.cid)] || {})[li] : null;
    x.pct = pv == null ? null : pv / 1000;
  }
  const std = x.std;
  if (std != null && sl.vp != null && sl.vp > 0) { x.pay = sl.vp; x.d = 1 - (sl.vp + ship) / std; }
  else { x.d = (sl.vd != null ? sl.vd : s.under) / 100; x.pay = std != null ? std * (1 - x.d) - ship : sl.vp || null; }
  x.hasVendor = sl.vp != null || sl.vd != null;
  if (std == null) { x.chance = x.net = x.roi = null; return x; }
  if (sl.demo) {
    const c = POOL[sl.c], mu = c.mu3 * h / 3, sd = c.sd3 * Math.sqrt(h / 3), be = (1 - x.d) / (1 - FEE) - 1;
    x.chance = Math.min(0.95, Math.max(0.02, 1 - phi((be - mu) / sd)));
    x.net = std * ((1 + mu) * (1 - FEE) - (1 - x.d));
  } else {
    const fc = D && D.fc, g = x.pct == null ? null : Math.min(9, Math.floor(x.pct * 10)), t = fc ? tabFor(fc, h, g) : null;
    x.g = g; x.t = t;
    x.chance = t ? Math.round(Math.min(0.95, 1 - cdf(fc, t, (1 - x.d) / (1 - FEE) - 1)) * 1000) / 1000 : null;
    x.net = t ? netOf(std, t[0], x.d) : null;
  }
  x.roi = x.net != null && x.pay > 0 ? x.net / x.pay : null;
  return x;
}
const identified = sl => sl.demo || (sl.look === 'ok' || sl.look === 'check') && sl.cid != null && !!sl.gk;
const confirmed = sl => sl.demo || sl.look === 'ok';
const marketDown = () => !!(D && D.fc && D.fc.regime && !D.fc.regime.up);
// the plan: what you already bought first, then best chance (to the whole percent), deeper rank, dearer slab; at most the
// per-slab share each, up to the capital; the chance bar, the min sales last month, and the market gate as the website's
function plan() {
  const s = S.settings, cap = numSet('capital'), per = cap * (s.share / 100), bar = s.bar / 100, minS = Math.max(0, +s.minSales || 0);
  const gated = !!(s.gate && marketDown());
  const all = slabsArr().map(sl => ({sl, x: calc(sl)}));
  let spent = 0; all.forEach(o => { if (o.sl.st === 'bought' && o.x.pay > 0) spent += o.x.pay; });
  let left = cap - spent;
  const picks = {}, chosen = [], missed = [], few = {}, blocked = [];
  const order = (a, b) => (Math.round(b.x.chance * 100) - Math.round(a.x.chance * 100)) || ((b.x.pct || 0) - (a.x.pct || 0)) || ((b.x.std || 0) - (a.x.std || 0));
  all.filter(o => o.sl.st !== 'bought' && o.sl.st !== 'declined' && o.x.pay > 0 && o.x.chance != null && o.x.chance >= bar && confirmed(o.sl))
    .sort(order).forEach(o => {
      if ((o.x.sold || 0) < minS) { few[o.sl.id] = 1; return; }
      if (gated && !o.sl.demo) { blocked.push(o); return; }
      if (o.x.pay <= per && o.x.pay <= left) { picks[o.sl.id] = 1; left -= o.x.pay; chosen.push(o); } else missed.push(o);
    });
  all.forEach(o => { if ((o.x.sold || 0) < minS && o.x.std != null) few[o.sl.id] = 1; });
  return {all, picks, chosen, missed, few, blocked, gated, spent, left, cap, per, minS};
}

/* ---------------- the collector's channel (app.js alChannel / alSend: ntfy, HMAC-signed with the key) ---------------- */
let AL_T = 0, AL_CHAIN = Promise.resolve();
const nextT = () => { AL_T = Math.max(Date.now(), AL_T + 1); return AL_T; };
async function alChannel() {
  const enc = new TextEncoder();
  const hex = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return {topic: 'pc-' + (await hex(KEY + ':alerts-topic')).slice(0, 40),
    key: await crypto.subtle.importKey('raw', enc.encode(await hex(KEY + ':alerts-key')), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify'])};
}
async function alSend(msg) {
  const ch = await alChannel(), body = JSON.stringify(msg);
  if (msg && typeof msg.t === 'number' && msg.t > AL_T) AL_T = msg.t;
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', ch.key, new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const run = async () => { const r = await fetch('https://ntfy.sh/' + ch.topic, {method: 'POST', body: JSON.stringify({m: body, s: sig})}); if (!r.ok) throw new Error('HTTP ' + r.status); };
  const p = AL_CHAIN.then(run, run); AL_CHAIN = p.catch(() => {}); return p;
}
// the basket's expected net, likely range and chance (graded_fc.js fcgMonteCarlo) at hold h
function basket(rows, h, n = 2000) {
  const fc = D && D.fc; if (!fc) return null;
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const Phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  const wm = Math.sqrt(FC_RHO), wo = Math.sqrt(1 - FC_RHO), tot = new Float64Array(n);
  const P = rows.map(x => [x.std, tabFor(fc, h, x.g), x.d]).filter(p => p[1] && p[0] != null);
  if (!P.length) return null;
  for (let k = 0; k < n; k++) { const zm = gauss(); let s = 0; for (const [std, t, d] of P) { const u = Math.min(0.9995, Math.max(0.0005, Phi(wm * zm + wo * gauss()))); s += netOf(std, draw(fc, t, u), d); } tot[k] = s; }
  const a = Array.from(tot).sort((x, y) => x - y), at = p => a[Math.min(n - 1, Math.floor(p * n))];
  return {lo: at(0.1), hi: at(0.9), mean: a.reduce((s, v) => s + v, 0) / n, p: Math.min(FC_P_CAP, a.filter(v => v > 0).length / n)};
}
// Record Purchases: the slabs marked Bought, to History > Recorded Purchases (the website's Purchases button, type 'gplan')
async function recordPurchases() {
  const real = slabsArr().filter(sl => sl.st === 'bought' && !sl.demo && !sl.rec);
  if (!real.length) { UI.recMsg = ['warn', slabsArr().some(sl => sl.st === 'bought' && sl.demo) ? 'Nothing to record: sample slabs are never sent to the website.' : slabsArr().some(sl => sl.st === 'bought' && sl.rec) ? 'Everything you bought is recorded already.' : 'Nothing to record yet: mark a slab Bought first.']; return render(); }
  if (!KEY || !D) { UI.recMsg = ['warn', 'Unlock the app first (Show tab): recording needs your site password.']; return render(); }
  const xs = real.filter(identified).map(calc).filter(x => x.std != null && x.pay > 0);
  if (!xs.length) { UI.recMsg = ['warn', 'The slabs you bought have no Card Ladder price or are not identified yet (Find the card), so there is nothing the website can follow.']; return render(); }
  const s = S.settings, fc = D.fc;
  const slabs = xs.map(x => [x.sl.cid, x.sl.gk, Math.round(x.d * 1000), r2(x.std), r2(x.pc), r2(x.pay), x.chance == null ? null : Math.round(x.chance * 1000), r2(x.net), x.pct == null ? null : Math.round(x.pct * 1000)]);
  const holds = [1, 2, 3, 4, 5, 6].map(h => { const mc = basket(xs.map(x => Object.assign({}, x, {g: x.g})), h); return mc ? [r2(mc.mean), r2(mc.lo), r2(mc.hi), Math.round(mc.p * 1000) / 1000] : null; });
  const spent = r2(xs.reduce((a, x) => a + x.pay, 0)), id = nextT(), PART = 20, n = Math.max(1, Math.ceil(slabs.length / PART));
  const head = {h: s.hold, cap: numSet('capital'), disc: Math.round((s.under / 100) * 10000) / 10000, ship: numSet('ship'), fee: Math.round(FEE * 10000) / 10000,
    month: fc ? fc.month : '', reg: fc ? regOf(fc) : '', spent, model: fc ? fc.model : '', smp: 0, holds};
  UI.sending = true; UI.recMsg = ['', 'Sending ' + xs.length + ' slab' + (xs.length > 1 ? 's' : '') + '…']; render();
  try {
    for (let k = 0; k < n; k++) await alSend(Object.assign({type: 'gplan', t: k ? nextT() : id, id, k, n, s: slabs.slice(k * PART, (k + 1) * PART)}, k ? {} : head));
    xs.forEach(x => { x.sl.rec = id; }); save();
    UI.recMsg = ['ok', 'Recorded ' + xs.length + ' slab' + (xs.length > 1 ? 's' : '') + ', ' + money(spent) + ', held ' + s.hold + ' month' + (s.hold > 1 ? 's' : '') + '. It shows on the website under History › Recorded Purchases in a minute or two.'];
  } catch (e) { UI.recMsg = ['warn', 'Could not reach the collector (' + (e.message || e) + '). Nothing was recorded - try again when you have signal.']; }
  UI.sending = false; render();
}
// Review's answer for the whole card (Card Ladder's card = PriceCharting's?), as the website's Review sends it
async function sendMark(cid, v) {
  const c = D && D.cards[String(cid)]; if (!c || !KEY) return;
  S.marks[cid] = v; save(); render();
  try { await alSend({type: 'gmark', t: nextT(), c: cid, g: 'card', p: c[5] || '', v, reason: null, note: null}); toast('Sent to the website.'); }
  catch (e) { toast('Not sent (no signal?) - kept on this phone.'); }
}
// scans.csv (Brett: "when I scan a barcode, the link will appear in the CSV file"): every real slab read is queued here
// and sent as {type: 'scan', t, c: [[grader, cert], ...]}; the collector turns each into its PSA / CGC cert link and adds
// the new ones to card-data's data/scans/scans.csv. Kept on the phone until sent (no signal, or locked: sent later).
const scanLink = (g, c) => g === 'cgc' ? 'https://www.cgccards.com/certlookup/' + c + '/' : 'https://www.psacard.com/cert/' + c;
let SCAN_SEND_T = 0, SCAN_SENDING = false;
function queueScan(grader, cert) {
  const q = LS.get(SCANQ, []);
  if (!q.some(x => x[0] === grader && x[1] === cert)) { q.push([grader, cert]); LS.set(SCANQ, q); }
  scheduleScanSend();
}
function scheduleScanSend(ms) { clearTimeout(SCAN_SEND_T); SCAN_SEND_T = setTimeout(sendScans, ms == null ? 8000 : ms); }
async function sendScans() {
  if (SCAN_SENDING || !KEY) return;
  const q = LS.get(SCANQ, []); if (!q.length) return;
  SCAN_SENDING = true;
  try {
    for (let i = 0; i < q.length; i += 80) {   // ntfy carries about 4 KB a message
      const part = q.slice(i, i + 80);
      await alSend({type: 'scan', t: nextT(), c: part});
      LS.set(SCANQ, LS.get(SCANQ, []).filter(x => !part.some(y => y[0] === x[0] && y[1] === x[1])));
      LS.set(SCANN, (+LS.get(SCANN, 0) || 0) + part.length);
    }
  } catch (e) { scheduleScanSend(30000); }    // no signal: again in half a minute
  SCAN_SENDING = false;
  const el = $('scans-line'); if (el) el.innerHTML = scansLine();
}
function scansLine() {
  const q = LS.get(SCANQ, []).length, n = +LS.get(SCANN, 0) || 0;
  return '<b>scans.csv</b> (card-data, data/scans): ' + n.toLocaleString() + ' cert link' + (n === 1 ? '' : 's') + ' sent from this phone' +
    (q ? ' · ' + q + ' waiting' + (KEY ? ' for signal' : ' - unlock to send them') : '') + '.';
}

/* ---------------- scanning (camera frames -> zxing -> certs) ---------------- */
// Brett (2026-11-09): "I want to maximize my depth for actually reading the barcode scanners. It's going to be done at
// different angles. The lighting conditions could be different ... a little bit of glare ... glass paneled showcase".
// Depth is detail: a reader needs about 2 camera dots per thin bar. So: the most the camera gives (4K where it can), each
// frame read whole at full size (no shrinking) in a worker, the binarizers by turns, the telephoto for slabs further off.
const VIDEO = document.createElement('video');
VIDEO.setAttribute('playsinline', ''); VIDEO.setAttribute('muted', ''); VIDEO.muted = true; VIDEO.autoplay = true;
const SCAN = {stream: null, timer: null, busy: false, canvas: document.createElement('canvas'), zx: null, sim: null, tick: null,
  worker: null, pend: new Map(), wid: 0, offscreen: false, k: 0, cams: null, caps: null, boxes: [], raf: 0, wake: null, audio: null,
  fpsN: 0, fpsT: 0, fps: 0, ms: 0, lastHit: 0, finder: false, seen: new Map(), lastLen: 0, lastSharp: 0, bestPx: 0, revived: 0, reviving: false, glare: 0, lastNew: 0, cntSeen: -1, blobOk: false};
const VREAD = {on: false, stop: false, el: null, pct: 0, w: 0, h: 0, frames: 0, tid: null, name: ''};
// A test's numbers. keep: the frames whose pictures are kept for the test-data file; log: one line a frame (testFrame).
const testFresh = () => ({frames: 0, sharps: [], ms: [], t0: 0, last: 0, mode: '', w: 0, h: 0, lens: '', cam: null, tget: [], tf: [], tl: [], tr: [], ty: [], tw: [], tg: [], lens_: [], maxPer: 0, empty: 0,
  stN: 0, boxes: 0, kept: 0, sure: 0, strong: 0, weak: 0, ferr: null, log: [], keep: [], keepN: 0, keepNext: Infinity, keepGap: KEEP_GAP_MS, rowsPic: null, sheetN: new Map(), live: null, keepErr: null});
const KEEP_MAX = 10, KEEP_Q = 0.92, KEEP_GAP_MS = 1500, KEEP_CROP = 640;   // pictures kept a test at most; their JPEG quality; the first gap between two; the side of the lossless middle piece
const TEST = Object.assign({reads: new Map(), zip: null, zipSeq: 0, step: 0, label: ''}, testFresh());
// THE TESTS TO RUN (2026-11-10; Brett: "this is just one lighting condition ... the angles are going to be different.
// Everything is going to be different ... I want this test to translate across other conditions"). Test mode names the
// next test - another light, distance, angle or movement each time - and every test's file and map carry its number and
// words, so the pictures that come back are labelled and cover more than one table under one lamp.
const TEST_PLAN = [
  'Sheet flat, room light, about 9 inches, 1x, hold still',
  'About 14 inches, 1x, hold still',
  'About 2 feet: tap 3x, hold still',
  'About 3 feet, 3x, hold still',
  'Phone tilted about 45 degrees, about a foot away, 1x',
  'Sheet turned: on its side, then upside down, then aslant - about a foot away, 1x',
  'Moving: glide slowly over the sheet at 8 to 10 inches, a short pause on each part',
  'Your choice: another light, another room, under glass'];
let TEST_STEP = Math.min(TEST_PLAN.length - 1, Math.max(0, +LS.get('ssc-test-step13', 0) || 0));
function testStep(by) { TEST_STEP = Math.min(TEST_PLAN.length - 1, Math.max(0, TEST_STEP + by)); LS.set('ssc-test-step13', TEST_STEP); }
function testClear() { Object.assign(TEST, testFresh()); TEST.reads.clear(); SCAN.seen.clear(); }
const APP_VERSION = 'g13a';
// THE PRINTED TEST SHEETS (slab-barcode-test-sheets.pdf, 2026-11-05: 8 sheets of 50 codes, five across, ten down - sheet by
// sheet, row by row; 10 digits = CGC Code 128, 9 = PSA Code 128 with the thinnest bars, 8 = PSA ITF). Test mode knows
// them so that a run can be shown as a map of the sheet: which codes were read and which were not (sheetCard).
const TEST_SHEETS = [
  '6175596913,6156710320,6207048375,178803452,144896338,133199428,6091736089,135717948,105296955,118351087,40854897,140501786,6229836368,40183284,4008635561,6055214474,6180858498,6254760385,4035837337,140234340,6070166575,6042916155,99797689,171090634,62520389,149027744,6128988669,6109598245,170591243,130690879,78900358,102178317,6100714319,144664020,6248145122,6245898358,6042080569,25269514,85179268,161072749,173099971,23558746,83512707,31453587,169640638,159998457,59469209,4017287006,32432112,6105883893',
  '6068973422,138342416,172100519,25173985,6257083177,27594720,43194922,175966179,169472304,44581515,6117680057,23474749,4027943418,6250671575,4070904555,157332896,119103691,6000423305,167422968,6085513611,104579433,107083108,88579265,6044559558,34100557,66828766,6183939173,112003071,6179221485,6194947440,82573761,6109560164,6064240750,6049005970,39179520,96474703,150231577,143338902,128251551,153086881,155210468,6250418325,161065775,6049128539,146189340,6085609482,6150603689,4054449650,63646197,135267209',
  '6150165941,6045183858,6121782427,48809900,36023639,156229117,6053127950,6037435619,137108511,173339134,141864726,55720246,42471720,162354213,6250049662,35665616,73996432,6107183556,120986815,6158040629,135397558,177263799,117255409,89089917,4004805265,4036806365,101547193,50246314,6107526490,6138737445,6142146575,109951108,6141610054,179814925,6156732084,154510879,166967848,6034570975,90697266,132923428,115437182,4060829025,98467889,149410716,6235649073,6043195604,6016900519,98444059,158421224,39799887',
  '166141473,149633968,47845310,50011966,6061183521,48739468,102478533,152428899,6230353763,4062772863,6140724324,6177940222,93647832,106047503,6085461122,6028183772,6058020911,6085598134,4044539165,101382860,4046251135,145928476,118937042,110188440,42711444,106209117,139387822,61388460,158034597,6100272403,117022920,6202366825,143330564,45219859,6121624756,4000782319,6098741729,162666054,57790942,6137204722,55419691,61704450,134290542,36886206,73245475,6044159359,178064184,109370464,6129736460,6119992858',
  '76745599,119320011,132360142,105898607,54082859,6058752225,82331277,6065921117,6161709910,6159334275,6035035756,158173813,78933151,111966779,6005480318,4042470880,6212236563,109728367,127029302,111411109,4064270443,79407654,136020110,153787457,6041034343,54776685,6147710809,40412649,68818020,6101098870,6014686374,42761498,134328617,144018425,136590237,6066761618,169503732,6049599001,88468829,133802695,171740137,6209530418,74623112,4059975518,159782860,6228737225,4089542057,6212184280,120907372,29741800',
  '105543040,152912826,139758451,153850347,6054908137,6174981612,6148161165,6169169861,6127920419,109470061,99921206,167619953,127143107,74379809,107366101,37851217,168377238,6032873817,6021243555,104018979,80326557,4083077799,6232402734,94746648,59780306,132770373,6184034102,98427724,114612605,130831067,6234509985,117103630,4013772485,61192358,6217349986,38013936,54029139,6173781731,6057544145,146567634,6184385581,4031893309,32416010,6036688611,158588786,4087032749,160078526,163489668,78898265,6090748754',
  '107255885,4025223452,6224690495,6248894060,6057265073,78478275,6243007308,6028441385,6025395260,6141716401,6039837421,6039338544,162976407,6130136720,59926457,176368518,169333268,55395502,106268331,157906787,86110529,64239235,6106892079,173374674,6051677560,136033093,6143957679,4030521346,6009267136,56722228,166803261,114842319,68609389,150685176,175139516,62686652,121873959,6250954964,164410475,124960622,175716726,6131286457,61955032,164099450,44356534,6053349901,6101268497,52593835,81915596,109065862',
  '165144844,106467502,6148719435,87609096,26002191,6063398028,145284840,136009868,141228108,6037188320,103579476,122831929,71345446,4093390643,124753760,141944833,28005519,161218783,6176760878,64653411,6063688511,122863127,6236225052,6207169336,139861477,44396763,4095570922,156864978,6036733711,46496999,6134746815,6041045402,6146808718,6033257089,77014565,99709310,122795450,155052343,113188598,6041417996,36233020,20292487,4028757617,6117808394,6109461035,120270477,117275964,6181157244,47149099,6034305817'];
const SHEET_OF = new Map();
TEST_SHEETS.forEach((row, i) => row.split(',').forEach((n, k) => SHEET_OF.set(n, [i + 1, k])));
const SLAB_FORMATS = ['QRCode', 'Code128', 'ITF', 'DataMatrix'];
// zxing's options: which codes to look for, and the LocalAverage binarizer (b = 0) or the GlobalHistogram one (b = 1).
// maxNumberOfSymbols 255 (2026-11-09; it was 32): with a whole 50-code sheet in view a pass stopped at its first 32 codes -
// the same 32 every frame; on the simulated sheet one pass now gives 35-37 instead of 32, at the same speed.
// WHAT EACH BINARIZER IS FOR (measured 2026-11-09 on the simulated 4K pictures): zxing reads the linear codes (Code 128,
// ITF - what a slab's front label carries) the same way whichever is named, so LINEAR_FORMATS with either takes a third of
// the time of a pass that also searches for QR and Data Matrix (33 ms against 82-118 ms). A QR needs LocalAverage: in
// uneven light it read the QR codes in 8 frames of 8, GlobalHistogram in 3 of 8. Looking for every format there is (Test
// mode's "any code", so other printed samples count too) doubles a pass again, so that is only done now and then.
const LINEAR_FORMATS = ['Code128', 'ITF'];
const wideFormats = () => UI.test ? [] : SLAB_FORMATS;
const readerOpts = (b, formats) => ({formats, maxNumberOfSymbols: 255, tryHarder: true, tryRotate: true, tryInvert: false, binarizer: b ? 'GlobalHistogram' : 'LocalAverage'});
// HOW A FRAME IS READ (g13, 2026-11-10). Brett's seven test files were the first REAL frames the reader could be tried on
// here (the sheet's answers known): one frame of g12 read 49% of the codes in view at 9 inches, 22% at 13 inches, 15% with
// the phone tilted, 7% in a dim room, and his phone read 2.5 frames a second. Now the worker FINDS the linear codes in
// every frame, whichever way round they lie, and reads each from its own folded lines (finder.js; the same frames: 83%,
// 64%, 44%, 74%), and one frame in four also goes to zxing whole, as it is, for the QR codes and as a net.
// WHEN A NUMBER COUNTS. His seven tests held 5 wrong numbers: at 1.4-2 dots a bar a Code 128's check symbol agrees with a
// misread about once in a hundred tries, and a phone tries hundreds of times a minute. Every reading now comes with how
// sure it is (scan-worker.js: A sure - two readers that work differently agree, or a QR; B strong; C weak) and a number is
// taken once it has NEED points: an A at once, a B on its second sighting, a C on its fourth. On the test frames - as
// they are, turned every way, with border lines beside the codes, enlarged, blurred, grainy, faint (106 frames) - the A
// and B readings held no wrong number (2,479 strong grey-line readings among them). D, the grey-line reader's FAINT
// reading, was wrong once in 88 - and a phone held still shows the same wrong reading again and again (a fake camera
// that looped one blurred frame counted it): D helps a number along but never makes it count - one of its two points
// must be SOLID (from A, B or C).
const NEED = 2, POINTS = {A: 2, B: 1, C: 0.5, D: 0.5};
function tally(e, cls) {                     // one more sighting on a tally {pts, solid, n, ok}
  const p = POINTS[cls] || 0.5; e.pts += p; if (cls !== 'D') e.solid += p; e.n++;
  if (e.pts >= NEED && e.solid >= 1) e.ok = true;
  return e;
}
function sighted(key, cls) {                 // one more sighting of a slab's code at a show -> its tally
  let e = SCAN.seen.get(key); if (!e) SCAN.seen.set(key, e = {pts: 0, solid: 0, n: 0, ok: false});
  return tally(e, cls);
}
const GLARE_MIN = 0.012;                     // this share of the picture blown out to white = glare worth a word (the glare hint in paintScan)
// TOO FAR FOR THIS LENS (g13; Brett: "depth is one of my biggest concerns ... at least 2 feet instead of 1 foot"). His
// 2-foot test with the 1x lens: bars 0.8-0.96 of a dot wide - under one dot nothing can be read, by any reader. The 3x
// lens (already a button on the picture) gives 2 feet what 1x gives 8 inches. The finder knows how long the codes it
// finds are: under SMALL_LEN dots (a slab's ~17.5 mm code then has bars near one dot) with nothing read, the picture says so.
const SMALL_LEN = 125;
function zxReady() {
  if (!SCAN.zx && window.ZXingWASM) SCAN.zx = ZXingWASM.prepareZXingModule({overrides: {locateFile: (p, prefix) => p.endsWith('.wasm') ? 'zxing/' + p : prefix + p}, fireImmediately: true});
  return SCAN.zx;
}
function workerReady() {                     // the reader in its own thread; false = this browser can't, read on the page
  if (SCAN.worker !== null) return SCAN.worker;
  try {
    const w = new Worker('scan-worker.js');
    w.onmessage = e => {
      const m = e.data; if (m.hello) { SCAN.offscreen = !!m.offscreen; SCAN.finder = !!m.finder; SCAN.blobOk = !!m.blob; return; }
      const p = SCAN.pend.get(m.id); if (!p) return;
      SCAN.pend.delete(m.id); if (m.err) p.rej(new Error(m.err)); else p.res(m);
    };
    w.onerror = ev => { SCAN.worker = false; SCAN.pend.forEach(p => p.rej(new Error('the reader stopped'))); SCAN.pend.clear(); if (ev && ev.preventDefault) ev.preventDefault(); };
    SCAN.worker = w;
  } catch (e) { SCAN.worker = false; }
  return SCAN.worker;
}
function grab(src, w, h) {                   // a frame's pixels at full size
  const cv = SCAN.canvas; if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
  const ctx = cv.getContext('2d', {willReadFrequently: true}); ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
const slim = r => ({text: r.text, format: r.format, pos: r.position, version: r.version, cls: /qr|matrix/i.test(String(r.format)) ? 'A' : 'B', by: 'w'});   // (read on the page, without the finder: strong)
async function readImage(src, w, h, opts, plan) {   // -> {res: [{text, format, pos, version, cls, by}], ms, sharp, t}; opts: the whole-frame pass's (plan.full)
  const wk = workerReady();
  if (wk) {
    const id = ++SCAN.wid;
    const p = new Promise((res, rej) => { SCAN.pend.set(id, {res, rej}); setTimeout(() => { if (SCAN.pend.delete(id)) rej(new Error('the reader took too long')); }, 20000); });
    let bm = null;
    if (SCAN.offscreen && window.createImageBitmap) { try { bm = window.ImageBitmap && src instanceof ImageBitmap ? src : await createImageBitmap(src); } catch (e) { bm = null; } }
    if (bm) wk.postMessage({id, bm, opts, plan}, [bm]);
    else { const img = grab(src, w, h); wk.postMessage({id, w, h, buf: img.data.buffer, opts, plan}, [img.data.buffer]); }   // raw pixels
    return p;
  }
  await zxReady();
  const img = grab(src, w, h), t0 = performance.now();
  const res = await ZXingWASM.readBarcodes(img, opts);
  return {res: res.filter(r => r.isValid !== false).map(slim), ms: performance.now() - t0};
}
function certOf(v, f) {                      // a barcode -> ['psa' | 'cgc', cert] (card-data pc_tab.js S1.kind, plus CGC's QR link)
  v = String(v || '').trim();
  let m = /psacard\.com\/cert\/(\d{7,10})/i.exec(v); if (m) return ['psa', m[1]];
  m = /cgccards\.com\/certlookup\/(\d{7,13})/i.exec(v); if (m) return ['cgc', m[1]];
  if (/^\d{13}$/.test(v) && v.startsWith('1401')) return ['cgc', v];
  if (/^\d{10}$/.test(v) && /^[3-9]/.test(v) && /code.?128/i.test(f || '')) return ['cgc', v];
  if (/^\d{8,9}$/.test(v)) return ['psa', v];
  return null;
}
// the detail a code was read at: camera dots per thin bar (per square for a QR). About 2+ reads easily, 1.5 is the edge.
function detailOf(r) {
  const P = r.pos; if (!P || !P.topLeft) return null;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), along = (d(P.topLeft, P.topRight) + d(P.bottomLeft, P.bottomRight)) / 2;
  const t = String(r.text || ''), f = String(r.format || '').replace(/[\s-]/g, '').toLowerCase();
  if (f.startsWith('qr') || f === 'microqrcode') {
    const v = parseInt(r.version, 10); if (!(v > 0)) return null;
    return (along + (d(P.topLeft, P.bottomLeft) + d(P.topRight, P.bottomRight)) / 2) / 2 / (17 + 4 * v);
  }
  let mods = null;
  if (f.startsWith('code128')) mods = 11 * ((/^\d+$/.test(t) ? Math.ceil(t.length / 2) : t.length) + 2) + 13;   // start, data, check, stop
  else if (f.startsWith('itf')) mods = 9 * t.length + 9;
  else if (f.startsWith('code39')) mods = 16 * (t.length + 2);
  else if (f.startsWith('code93')) mods = 9 * (t.length + 4) + 1;
  else if (f === 'ean13' || f === 'upca') mods = 95;
  else if (f === 'ean8') mods = 67;
  return mods && along > 0 ? along / mods : null;
}
const fmtName = f => ({qrcode: 'QR', code128: 'Code 128', itf: 'ITF', datamatrix: 'Data Matrix', ean13: 'EAN-13', upca: 'UPC-A', code39: 'Code 39'})[String(f || '').replace(/[\s-]/g, '').toLowerCase()] || String(f || '?');
function resLabel(w, h) { const m = Math.max(w, h); return !m ? '' : m >= 3800 ? '4K' : m >= 2500 ? '2.7K' : m >= 1900 ? '1080p' : m >= 1260 ? '720p' : w + '×' + h; }
function lensLabel() {
  const l = S.settings.lens;
  return l === 'tele' && SCAN.cams && SCAN.cams.tele ? '3x' : l === 'zoom2' && SCAN.caps && SCAN.caps.zoom ? '2x' : '1x';
}
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function listCams() {                  // the phone's back lenses by name (named only once the camera is allowed)
  try {
    const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'), L = d => (d.label || '').toLowerCase();
    return {main: ds.find(d => /back/.test(L(d)) && !/(ultra|tele|dual|triple)/.test(L(d))) || null, tele: ds.find(d => /tele/.test(L(d))) || null, labels: ds.map(d => d.label)};
  } catch (e) { return {main: null, tele: null, labels: []}; }
}
// 60 frames a second where the camera offers it at 4K (2026-11-09, Brett's third test: the misses were frames smeared by
// movement): a frame then can't be exposed longer than 1/60 s, half the smear of 1/30 s. If 4K60 isn't offered, the
// size wins over the rate (the browser picks the closest overall), so this never costs detail.
const WANT = {width: {ideal: 3840}, height: {ideal: 2160}, frameRate: {ideal: 60}};
async function camStart() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('this browser gives no camera');
  const pick = () => { const c = SCAN.cams; if (!c) return null; return S.settings.lens === 'tele' && c.tele ? c.tele : c.main; };
  let d = pick();
  SCAN.stream = await navigator.mediaDevices.getUserMedia({audio: false, video: d ? Object.assign({deviceId: {exact: d.deviceId}}, WANT) : Object.assign({facingMode: {ideal: 'environment'}}, WANT)});
  if (!SCAN.cams) {                          // first time: the lenses have names now - move to the main lens (or the 3x)
    SCAN.cams = await listCams(); d = pick();
    const cur = SCAN.stream.getVideoTracks()[0].getSettings().deviceId;
    if (d && cur !== d.deviceId) {
      camStop();
      SCAN.stream = await navigator.mediaDevices.getUserMedia({audio: false, video: Object.assign({deviceId: {exact: d.deviceId}}, WANT)});
    }
  }
  const tr = SCAN.stream.getVideoTracks()[0];
  try {
    SCAN.caps = tr.getCapabilities ? tr.getCapabilities() : null;
    const adv = [], caps = SCAN.caps || {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) adv.push({focusMode: 'continuous'});
    if (caps.zoom) adv.push({zoom: S.settings.lens === 'zoom2' && !isIOS() ? Math.min(caps.zoom.max, 2) : Math.max(caps.zoom.min, 1)});
    if (adv.length) await tr.applyConstraints({advanced: adv});
  } catch (e) {}
  SCAN.label = tr.label || '';
  if (SCAN.torch) { try { await tr.applyConstraints({advanced: [{torch: true}]}); } catch (e) { SCAN.torch = false; } }   // a lens change keeps the light on
  try { SCAN.settings = tr.getSettings ? tr.getSettings() : null; } catch (e) { SCAN.settings = null; }
  VIDEO.srcObject = SCAN.stream;
  try { await VIDEO.play(); } catch (e) {}
}
// the phone's light (only where the camera offers it): more light = a shorter exposure = less smear from a moving hand.
// It can put a glare spot on slab plastic - tilt a little so the spot slides off the label.
async function setTorch(on) {
  const tr = SCAN.stream && SCAN.stream.getVideoTracks()[0]; if (!tr) return;
  try { await tr.applyConstraints({advanced: [{torch: !!on}]}); SCAN.torch = !!on; } catch (e) { SCAN.torch = false; toast('The light did not switch on.'); }
  try { SCAN.settings = tr.getSettings ? tr.getSettings() : SCAN.settings; } catch (e) {}
  paintScan();
}
// what the camera really gave, for the test report: the lens, its rate and size, what it offers (zoom, light, focus)
function camInfo() {
  const st = SCAN.settings || {}, c = SCAN.caps || {}, rng = x => x && x.max != null ? [x.min, x.max] : null;
  return {device: SCAN.label || '', width: st.width || null, height: st.height || null, frameRate: st.frameRate ? Math.round(st.frameRate) : null,
    light: !!SCAN.torch, zoom: st.zoom != null ? st.zoom : null, zoomRange: rng(c.zoom), lightAvailable: !!c.torch,
    maxFrameRate: c.frameRate && c.frameRate.max ? Math.round(c.frameRate.max) : null, maxSize: c.width && c.height && c.width.max ? [c.width.max, c.height.max] : null,
    focusModes: c.focusMode || null, closestFocusMeters: c.focusDistance && c.focusDistance.min != null ? c.focusDistance.min : null,
    lenses: (SCAN.cams && SCAN.cams.labels) || []};
}
function camStop() { if (SCAN.stream) SCAN.stream.getTracks().forEach(t => t.stop()); SCAN.stream = null; VIDEO.srcObject = null; }
function camOff() { camStop(); SCAN.torch = false; }   // the recording is over: the light goes off with the camera
// THE CAMERA IS STARTED AGAIN WHEN ITS PICTURE COLLAPSES (2026-11-10). Brett's fourth test: asking Safari for a still
// photo (ImageCapture.takePhoto, the "Photo test" tried in g11i-g11k) left the live picture black and 144 x 192, and the
// photo itself read no code - so the photo test is gone, and a page cannot use stills on an iPhone. A phone call or
// another app can take the camera away the same way: once a second, if the track has ended or the picture is under a
// quarter of its best size, the camera is stopped and started again (three times a recording at most).
function camWatch() {
  const tr = SCAN.stream && SCAN.stream.getVideoTracks()[0];
  if (!UI.rec || !tr || SCAN.reviving) return;
  const px = VIDEO.videoWidth * VIDEO.videoHeight;
  if (px > SCAN.bestPx) SCAN.bestPx = px;
  if (!(tr.readyState === 'ended' || (px && px < SCAN.bestPx / 4)) || SCAN.revived >= 3) return;
  SCAN.reviving = true; SCAN.revived++;
  (async () => {
    try { camStop(); await camStart(); } catch (e) { UI.camErr = 'Camera: ' + (e && e.message || e); }
    SCAN.reviving = false; paintScan();
  })();
}
function lensChoices() {                     // [value, label]: the iPhone's 3x telephoto by name; elsewhere a 2x zoom when the camera offers one
  if (SCAN.cams && SCAN.cams.tele) return [['main', '1x'], ['tele', '3x']];
  if (!isIOS() && SCAN.caps && SCAN.caps.zoom && SCAN.caps.zoom.max >= 2) return [['main', '1x'], ['zoom2', '2x']];
  return [];
}
async function setLens(v) {
  if (S.settings.lens === v) return;
  S.settings.lens = v; save();
  if (v === 'tele') toast('3x: hold about 2 feet away - it cannot focus closer.');
  if (UI.rec && SCAN.stream) { camStop(); try { await camStart(); } catch (e) { UI.camErr = 'That lens did not open: ' + (e.message || e); } }
  paintScan();
}
async function wakeOn() {                    // a sweep has no taps: keep the screen (and the camera) from going to sleep
  try { if ('wakeLock' in navigator && !SCAN.wake) { SCAN.wake = await navigator.wakeLock.request('screen'); SCAN.wake.addEventListener('release', () => { SCAN.wake = null; }); } } catch (e) {}
}
function wakeOff() { try { if (SCAN.wake) SCAN.wake.release(); } catch (e) {} SCAN.wake = null; }
function audioOn() {                         // made on the tap that starts recording, so iOS lets it sound
  if (!S.settings.beep) return;
  try { if (!SCAN.audio) SCAN.audio = new (window.AudioContext || window.webkitAudioContext)(); if (SCAN.audio.state === 'suspended') SCAN.audio.resume(); } catch (e) {}
}
function beep() {
  const A = SCAN.audio; if (!S.settings.beep || !A) return;
  try {
    const o = A.createOscillator(), g = A.createGain(), t = A.currentTime;
    o.frequency.value = 1320; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(A.destination); o.start(t); o.stop(t + 0.1);
  } catch (e) {}
}
// One frame: the finder and its readers on every frame (plan.find), and on one frame in four zxing on the whole frame
// too (plan.full; LocalAverage, the binarizer a QR needs) - every eighth frame for any code at all in Test mode.
async function scanFrame() {
  if (!UI.rec || SCAN.busy || !SCAN.stream || !VIDEO.videoWidth) return;
  SCAN.busy = true;
  try {
    const k = SCAN.k++, w = VIDEO.videoWidth, h = VIDEO.videoHeight, full = k % 4 === 3, deep = k % 8 === 7;
    const keep = UI.test && SCAN.blobOk && performance.now() >= TEST.keepNext ? {q: KEEP_Q, crop: TEST.keepN ? 0 : KEEP_CROP, rows: !TEST.rowsPic} : null;
    const out = await readImage(VIDEO, w, h, readerOpts(0, deep ? wideFormats() : SLAB_FORMATS), {find: true, full, keep});
    if (out.t && out.t.glare != null) SCAN.glare = SCAN.glare * 0.6 + out.t.glare * 0.4;
    if (out.t && out.t.len != null) SCAN.lastLen = out.t.len;
    if (out.sharp != null) SCAN.lastSharp = out.sharp;
    if (UI.rec) gotReads(out.res, out.w || w, out.h || h, out.ms, UI.recTable, out.sharp, out.t, out.keep);
    if (UI.camErr && UI.camErr.startsWith('Reader')) UI.camErr = null;
  } catch (e) { UI.camErr = 'Reader: ' + (e.message || e); }
  SCAN.busy = false;
}
// what one frame gave: slabs for the table (or Test mode's list), boxes on the picture, the reading speed
function gotReads(res, w, h, ms, tid, sharp, tm, kept) {
  const now = performance.now();
  SCAN.ms = ms; SCAN.fpsN++;
  if (now - SCAN.fpsT > 2000) { SCAN.fps = SCAN.fpsT ? SCAN.fpsN * 1000 / (now - SCAN.fpsT) : 0; SCAN.fpsN = 0; SCAN.fpsT = now; }
  if (UI.test) {                             // what the report needs: frames, how sharp, how long each step took
    if (!TEST.t0) TEST.t0 = Date.now();
    TEST.last = Date.now(); TEST.frames++; TEST.ms.push(Math.round(ms || 0)); if (sharp != null) TEST.sharps.push(sharp);
    Object.assign(TEST, {mode: VREAD.on ? 'video' : 'live', w, h, lens: VREAD.on ? 'video' : lensLabel()});
    if (!VREAD.on && TEST.frames % 10 === 1) TEST.cam = camInfo();
    if (tm) {
      for (const [k, a] of [['get', TEST.tget], ['find', TEST.tf], ['lines', TEST.tl], ['rows', TEST.tr], ['grey', TEST.ty], ['full', TEST.tw]]) if (tm[k] != null) a.push(Math.round(tm[k]));
      if (tm.glare != null) TEST.tg.push(tm.glare);
      if (tm.len) TEST.lens_.push(tm.len);
      if (tm.st) { TEST.stN++; TEST.boxes += tm.st.boxes; TEST.kept += tm.st.kept; }
      if (tm.ferr) TEST.ferr = tm.ferr;
    }
    if (res.length > TEST.maxPer) TEST.maxPer = res.length;
    if (!res.length) TEST.empty++;
  }
  const idx = [], cnt = {A: 0, B: 0, C: 0, D: 0}; let dup = false;
  for (const r of res) {
    const cls = POINTS[r.cls] ? r.cls : 'C', kc = certOf(r.text, r.format); let ok = false;
    cnt[cls]++;
    if (UI.test) { const e = testRead(r, cls); idx.push(e.i + cls); ok = e.ok; }
    else if (kc && tid) { ok = sighted(kc[0] + '|' + kc[1], cls).ok; if (ok) { addScan(kc[0], kc[1], {table: tid, live: true, quiet: true}); dup = true; } }
    if (ok || cls === 'A' || cls === 'B') SCAN.lastHit = now;
    SCAN.boxes.push({pos: r.pos, w, h, t: now, ok});         // grey until the number counts, then green
  }
  SCAN.boxes = SCAN.boxes.filter(b => now - b.t < 1400);
  if (res.length && !SCAN.raf) SCAN.raf = requestAnimationFrame(drawBoxes);
  if (UI.test) { TEST.sure += cnt.A; TEST.strong += cnt.B; TEST.weak += cnt.C + cnt.D; testFrame(res, idx, w, h, ms, sharp, tm, kept, cnt); }
  else if (dup) paintScan();                 // once a frame, however many slabs it held (a slab already on the table: "Already read")
}
// Test mode's record of a code: every sighting with how sure it was and which reader gave it (g the grey-line reader, z
// zxing on the code's lines, w zxing on the whole frame); it COUNTS (ok, and the map turns green) by the same rule as a
// slab at a show - NEED points.
function testRead(r, cls) {
  const key = r.format + '|' + r.text, dt = detailOf(r), now = Date.now(), secs = Math.round((now - (TEST.t0 || now)) / 100) / 10;
  let e = TEST.reads.get(key);
  if (!e) TEST.reads.set(key, e = {i: TEST.reads.size, format: r.format, text: r.text, n: 0, min: dt, last: dt, at: now, seen: secs, first: null, ok: false, pts: 0, solid: 0, A: 0, B: 0, C: 0, D: 0, g: false, z: false, w: false});
  const was = e.ok; tally(e, cls); const now_ok = e.ok; e.ok = was; e.last = dt; e.at = now; e[cls]++;
  const by = String(r.by || ''); if (by.includes('g')) e.g = true; if (by.includes('z')) e.z = true; if (by.includes('w')) e.w = true;
  if (dt != null && (e.min == null || dt < e.min)) e.min = dt;
  if (!e.ok && now_ok) {
    e.ok = true; e.first = secs;
    const at = SHEET_OF.get(r.text); if (at) TEST.sheetN.set(at[0], (TEST.sheetN.get(at[0]) || 0) + 1);
    beep(); setTimeout(paintScan, 0);
  }
  return e;
}
const testOk = () => { let n = 0; for (const r of TEST.reads.values()) if (r.ok) n++; return n; };
// EVERY FRAME OF A TEST LEAVES A LINE, AND SOME LEAVE THEIR PICTURE (2026-11-10; Brett: "the previous builds have not been
// effective enough because the data that was collected from the test runs was insufficient ... if there's any stuff you
// can add to the build for collecting data, then please do so"). A screenshot or a screen recording has a third of the
// camera's detail - the bars are not in it. So Test mode keeps up to KEEP_MAX frames as the camera gave them (the worker
// makes the JPEG before anything touches the frame; the first one a second into the test, then every KEEP_GAP_MS - and
// when there are too many, every other one goes and the gap doubles, so a test of any length is covered end to end),
// what was read in each and where, the camera's settings at that moment, and for every frame a line (LOG_FIELDS).
// "Save test data" (saveTestData) hands all of it over as one file. THE SEVEN FILES OF 2026-11-09 ARE WHAT g13 WAS BUILT
// ON: real frames with known answers, replayed through every idea before it went into the app.
const LOG_FIELDS = ['ms since start', 'whole-frame pass too', 'sharpness', 'glare per mille', 'boxes found', 'boxes kept', 'median box length', 'reading ms', 'pixels ms', 'find ms', 'lines ms', 'zxing on lines ms', 'grey-line ms', 'whole pass ms', 'sure', 'strong', 'weak or faint', 'picture kept', 'codes: number in codes[] + A sure / B strong / C weak / D faint (the grey-line reader alone: helps, never counts by itself)'];
function camNow() {                           // what the camera says of itself right now (a phone gives few of these; a focus distance would show hunting)
  const tr = SCAN.stream && SCAN.stream.getVideoTracks()[0], o = {};
  try { const st = tr.getSettings(); for (const k of ['width', 'height', 'frameRate', 'zoom', 'torch', 'focusDistance', 'focusMode', 'exposureMode', 'exposureTime', 'exposureCompensation', 'iso', 'whiteBalanceMode', 'colorTemperature']) if (st[k] != null) o[k] = typeof st[k] === 'number' ? Math.round(st[k] * 1000) / 1000 : st[k]; } catch (e) {}
  return o;
}
function testFrame(res, idx, w, h, ms, sharp, tm, kept, cnt) {
  const t = Date.now() - TEST.t0, r0 = v => v == null ? null : Math.round(v), has = !!(kept && kept.orig), st = (tm && tm.st) || {}, T = tm || {};
  TEST.log.push([t, T.full != null ? 1 : 0, sharp == null ? null : sharp, T.glare != null ? Math.round(T.glare * 1000) : null, st.boxes == null ? null : st.boxes, st.kept == null ? null : st.kept, T.len || null,
    r0(ms), r0(T.get), r0(T.find), r0(T.lines), r0(T.rows), r0(T.grey), r0(T.full), cnt.A, cnt.B, cnt.C + cnt.D, has ? 1 : 0, idx]);
  if (TEST.log.length === 1) TEST.keepNext = performance.now() + 1000;
  TEST.live = {sharp, idx, cnt, st};
  if (kept && kept.err) TEST.keepErr = kept.err;
  if (has) {
    const q = P => P && P.topLeft ? [P.topLeft, P.topRight, P.bottomRight, P.bottomLeft].flatMap(c => [Math.round(c.x), Math.round(c.y)]) : null;
    TEST.keep.push({t, frame: TEST.frames, kind: T.full != null ? 'fw' : 'f', w, h, sharp, glare: T.glare != null ? Math.round(T.glare * 1000) / 1000 : null, cam: camNow(), blob: kept.orig, crop: kept.crop || null,
      reads: res.map((r, j) => [idx[j], String(r.by || ''), r.lines || 0, r.fit == null ? null : r.fit, r.gap == null ? null : r.gap, q(r.pos)])});
    TEST.keepN++;
    if (kept.rows && !TEST.rowsPic) TEST.rowsPic = {blob: kept.rows, frame: TEST.frames, t};
    if (TEST.keep.length > KEEP_MAX) { TEST.keep = TEST.keep.filter((x, i) => i % 2 === 0); TEST.keepGap *= 2; }
    TEST.keepNext = performance.now() + TEST.keepGap;
  }
  paintLive();
}
// THE LITTLE MAP AND THE NUMBERS BESIDE THE STOP BUTTON (Test mode, redrawn every frame): there for a SCREEN RECORDING to
// capture - "I hope taking a screen recorded video of the test run is sufficient". The map is the printed sheet in view,
// five by ten: bright = sighted in the frame just read, dim = counted earlier, dark = not yet; so the recording shows
// which codes each frame gets, and when the last ones come in. The numbers: frames a second, the frame's sharpness, the
// glare, the boxes the finder kept of those it found, this frame's sure / strong / weak readings, seconds since a new
// code counted, pictures kept.
const LIVE = {cells: null, sheet: 0};
function paintLive() {
  const st = $('live-stat'), mp = $('live-map'); if (!st || !mp) return;
  if (!(UI.test && UI.rec && TEST.live)) { if (st.textContent) st.textContent = ''; if (mp.firstChild) mp.innerHTML = ''; LIVE.cells = null; return; }
  const L = TEST.live, d = v => v == null ? '-' : v;
  st.textContent = (SCAN.fps ? SCAN.fps.toFixed(1) : '-') + ' f/s\nsharp ' + d(L.sharp) + '\nglare ' + (SCAN.glare * 100).toFixed(1) + '%\nboxes ' + d(L.st.kept) + '/' + d(L.st.boxes) + '\nA ' + L.cnt.A + ' B ' + L.cnt.B + ' C ' + (L.cnt.C + L.cnt.D) +
    '\nnew ' + Math.max(0, (performance.now() - (SCAN.lastNew || 0)) / 1000).toFixed(0) + ' s ago\npics ' + TEST.keep.length;
  let top = 0, best = 2; for (const [sh, n] of TEST.sheetN) if (n > best) { best = n; top = sh; }
  if (!top) { if (mp.firstChild) mp.innerHTML = ''; LIVE.cells = null; return; }
  if (!LIVE.cells || LIVE.sheet !== top || mp.childNodes.length !== 50) { mp.innerHTML = '<b></b>'.repeat(50); LIVE.cells = [...mp.childNodes]; LIVE.sheet = top; }
  const state = new Uint8Array(50), order = [...TEST.reads.values()];
  for (const r of order) { const at = r.ok && SHEET_OF.get(r.text); if (at && at[0] === top) state[at[1]] = 1; }
  for (const x of L.idx) { const r = order[parseInt(x, 10)], at = r && SHEET_OF.get(r.text); if (at && at[0] === top) state[at[1]] = 2; }
  for (let i = 0; i < 50; i++) { const c = state[i] === 2 ? 'n' : state[i] ? 'r' : ''; if (LIVE.cells[i].className !== c) LIVE.cells[i].className = c; }
}
// Brett, 2026-11-09: "something where your feedback is more reliable than some screenshots" - Test mode's numbers as text
// to paste into the chat: the camera, the speed, how sharp the frames were (blur vs too little detail), every code with
// its finest detail, how often and how surely it was read, by which reader, and when it counted.
function testStats() {
  const sh = TEST.sharps.slice().sort((a, b) => a - b), q = p => sh.length ? sh[Math.min(sh.length - 1, Math.floor(p * sh.length))] : null;
  const best = q(0.9), rows = [...TEST.reads.values()];
  return {sh, q, best, sharpPct: best ? Math.round(100 * sh.filter(v => v >= best / 2).length / sh.length) : null, rows, ok: rows.filter(r => r.ok)};
}
const perFrame = (c, n) => n ? Math.round(c / n * 10) / 10 : null;
function testReport() {
  const st = testStats(), ms = TEST.ms.slice().sort((a, b) => a - b), secs = TEST.t0 ? (TEST.last - TEST.t0) / 1000 : 0;
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  return {report: 'Slab Show Scanner test', version: APP_VERSION, test: TEST.step ? {number: TEST.step, of: TEST_PLAN.length, what: TEST.label} : null, at: new Date().toISOString(), phone: (/\(([^)]+)\)/.exec(navigator.userAgent) || [])[1] || '', browser: navigator.userAgent, homeScreenApp: !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)), screen: [window.innerWidth, window.innerHeight, window.devicePixelRatio || 1],
    mode: TEST.mode, camera: TEST.w + 'x' + TEST.h, lens: TEST.lens, cameraDetails: TEST.mode === 'live' ? TEST.cam || camInfo() : null, seconds: Math.round(secs), frames: TEST.frames,
    framesPerSecond: secs ? Math.round(TEST.frames / secs * 10) / 10 : null, msPerRead: ms.length ? ms[Math.floor(ms.length / 2)] : null,
    timing: {pixelsMs: med(TEST.tget), findMs: med(TEST.tf), linesMs: med(TEST.tl), zxingOnLinesMs: med(TEST.tr), greyLineMs: med(TEST.ty), wholePassMs: med(TEST.tw)}, finder: SCAN.finder, finderError: TEST.ferr, glarePct: TEST.tg.length ? Math.round(med(TEST.tg) * 1000) / 10 : null,
    perFrame: {boxesFound: perFrame(TEST.boxes, TEST.stN), boxesKept: perFrame(TEST.kept, TEST.stN), medianBoxLength: med(TEST.lens_), sure: perFrame(TEST.sure, TEST.frames), strong: perFrame(TEST.strong, TEST.frames), weak: perFrame(TEST.weak, TEST.frames)}, mostCodesInOneFrame: TEST.maxPer,
    framesWithNoCode: TEST.empty,
    sharpness: {low: st.q(0.1), median: st.q(0.5), high: st.best}, sharpFramesPct: st.sharpPct, codes: st.ok.length, sightedButNotCounted: st.rows.length - st.ok.length,
    countedBy: {greyLineOnly: st.ok.filter(r => r.g && !r.z && !r.w).length, zxingOnly: st.ok.filter(r => !r.g).length, both: st.ok.filter(r => r.g && (r.z || r.w)).length},
    listFields: ['kind', 'text', 'finest detail (dots a bar)', 'sightings', 'second it counted (null: never)', 'second first sighted', 'sure / strong / weak / faint sightings', 'readers: g grey-line, z zxing on lines, w zxing on the whole frame'],
    list: st.rows.sort((a, b) => (a.first == null ? 1e9 : a.first) - (b.first == null ? 1e9 : b.first)).map(r => [fmtName(r.format), r.text, r.min == null ? null : Math.round(r.min * 100) / 100, r.n, r.first, r.seen, r.A + '/' + r.B + '/' + r.C + '/' + r.D, (r.g ? 'g' : '') + (r.z ? 'z' : '') + (r.w ? 'w' : '')])};
}
// THE TEST-DATA FILE: a ZIP, made here (the pictures are JPEGs already, so they are stored as they are - no compressing).
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function zipStore(files) {              // [{name, blob}] -> a Blob
  const enc = new TextEncoder(), parts = [], cen = [], d = new Date(); let off = 0;
  const date = (d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate(), time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data), n = data.length;
    const lh = new DataView(new ArrayBuffer(30)), ch = new DataView(new ArrayBuffer(46));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true); lh.setUint16(26, name.length, true);
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    parts.push(lh.buffer, name, f.blob); cen.push(ch.buffer, name); off += 30 + name.length + n;
  }
  let size = 0; for (const c of cen) size += c.byteLength;
  const eo = new DataView(new ArrayBuffer(22)); eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true); eo.setUint32(12, size, true); eo.setUint32(16, off, true);
  return new Blob([...parts, ...cen, eo.buffer], {type: 'application/zip'});
}
async function buildTestZip() {               // made at Stop: report.json (the numbers, every frame's line, what each kept picture holds) + the pictures
  const rep = testReport(), p2 = n => ('0' + n).slice(-2), d = new Date(), files = [];
  rep.codes = [...TEST.reads.values()].map(r => [fmtName(r.format), r.text]);
  rep.frameFields = LOG_FIELDS; rep.frameLog = TEST.log;
  rep.pictures = TEST.keep.map((k, i) => {
    const name = 'frame-' + p2(i + 1) + '-' + (k.t / 1000).toFixed(1) + 's-' + k.kind + '.jpg'; files.push({name, blob: k.blob});
    if (k.crop) files.push({name: 'frame-' + p2(i + 1) + '-middle-lossless.png', blob: k.crop});
    return {file: name, msSinceStart: k.t, frame: k.frame, readBy: k.kind === 'fw' ? 'the finder, and zxing on the whole frame' : 'the finder', width: k.w, height: k.h, sharpness: k.sharp, glare: k.glare, camera: k.cam,
      readsFields: ['code (number in codes[]) + A sure / B strong / C weak / D faint', 'readers: g grey-line, z zxing on the lines, w zxing on the whole frame', 'lines zxing read it on', 'grey-line fit', 'grey-line lead over its next best reading', 'corners x,y: top-left, top-right, bottom-right, bottom-left'], reads: k.reads};
  });
  if (TEST.rowsPic) {                          // the first kept frame's codes as zxing was handed them: one row a line, three treatments of each
    const name = 'lines-frame' + TEST.rowsPic.frame + '.png'; files.push({name, blob: TEST.rowsPic.blob});
    rep.linesPicture = {file: name, frame: TEST.rowsPic.frame, msSinceStart: TEST.rowsPic.t};
  }
  rep.keepSettings = {most: KEEP_MAX, jpegQuality: KEEP_Q, lastGapMs: TEST.keepGap, error: TEST.keepErr};
  files.unshift({name: 'report.json', blob: new Blob([JSON.stringify(rep)], {type: 'application/json'})});
  const blob = await zipStore(files), name = 'scanner-test-' + APP_VERSION + (TEST.step ? '-t' + TEST.step : '') + '-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '.zip';
  let file = null, parts = [];                 // parts: the same files one by one, for a phone that will not share a ZIP
  try { file = new File([blob], name, {type: 'application/zip'}); const stem = name.replace(/\.zip$/, '-'); parts = files.map(f => new File([f.blob], stem + f.name, {type: f.blob.type || 'application/octet-stream'})); } catch (e) {}
  return {blob, name, file, parts, pics: TEST.keep.length, mb: Math.max(0.1, Math.round(blob.size / 104857.6) / 10), saved: false, note: ''};
}
// One tap: the phone's share sheet with the file (AirDrop, Save to Files...). It has to open straight from the tap, so
// nothing is awaited before it - the file was made at Stop. Where a browser will not share a file, it is downloaded.
function saveTestData(separate) {             // separate: the pictures and the report as files of their own (the small link under the button)
  const z = TEST.zip; if (!z) return;
  const download = why => {
    const a = document.createElement('a'); a.href = z.url || (z.url = URL.createObjectURL(z.blob)); a.download = z.name; document.body.appendChild(a); a.click(); a.remove();
    z.saved = true; z.note = (why ? why + ' ' : '') + 'Downloaded as ' + z.name + ' (Files app > Downloads on an iPhone). If nothing arrived, try "as separate files" below, or open the scanner in Safari itself and run the test there.'; paintScan();
  };
  const files = separate ? z.parts || [] : z.file ? [z.file] : [];
  let can = false; try { can = !!(files.length && navigator.share && navigator.canShare && navigator.canShare({files})); } catch (e) {}
  if (!can) { if (!separate) return download(''); z.note = 'This browser will not share the separate files.'; return paintScan(); }
  navigator.share({files}).then(() => { z.saved = true; z.note = 'Handed over' + (separate ? ' as ' + files.length + ' separate files.' : ' as ' + z.name + '.') + ' (Tap again to send it once more.)'; paintScan(); },
    e => { if (e && e.name === 'AbortError') return; const why = String(e && e.message || e).slice(0, 60); if (separate) { z.note = 'Sharing the separate files did not work (' + why + ').'; paintScan(); } else download('The share sheet did not open (' + why + ').'); });
}
async function copyReport() {
  if (!TEST.frames) return toast('Record a test first, then copy its report.');
  const txt = JSON.stringify(testReport());
  try { await navigator.clipboard.writeText(txt); UI.reportText = null; toast('Report copied - paste it into the chat.'); }
  catch (e) { UI.reportText = txt; toast('Copy was blocked - select the report below and copy it.'); }
  paintScan();
}
function drawBoxes() {                       // green boxes on each code read, fading over a second and a half
  SCAN.raf = 0;
  const cv = $('vf-boxes'), vf = $('vf'); if (!cv || !vf) return;
  const cw = vf.clientWidth, ch = vf.clientHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d'), now = performance.now();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  let live = 0;
  for (const b of SCAN.boxes) {
    const age = (now - b.t) / 1400, P = b.pos; if (age >= 1 || !P || !P.topLeft) continue;
    live++;
    const s = Math.min(cw / b.w, ch / b.h), dx = (cw - b.w * s) / 2, dy = (ch - b.h * s) / 2;   // the picture is shown whole (object-fit: contain)
    ctx.beginPath();
    [P.topLeft, P.topRight, P.bottomRight, P.bottomLeft].forEach((p, i) => { const x = p.x * s + dx, y = p.y * s + dy; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.globalAlpha = 1 - age; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.fillStyle = b.ok ? 'rgba(61,214,140,.22)' : 'rgba(233,238,244,.12)'; ctx.strokeStyle = b.ok ? '#3DD68C' : '#E9EEF4'; ctx.fill(); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (live) SCAN.raf = requestAnimationFrame(drawBoxes);
}
function addScan(grader, cert, opts) {
  const tid = (opts && opts.table) || UI.recTable, live = !!(opts && opts.live), busy = UI.rec || VREAD.on;
  if (!tid) return null;
  const have = slabsArr().find(sl => sl.t === tid && !sl.demo && sl.cert === cert);
  if (have) { if (busy) { UI.dup = 'Already read: ' + gkLabelShort(have) + ' (counted once)'; if (!(opts && opts.quiet)) paintScan(); } return have; }
  const sid = 's' + (S.seq++) + '-' + Date.now().toString(36);
  const sl = {id: sid, t: tid, grader, cert, at: Date.now(), look: 'queued', mode: 'pct', vd: null, vp: null, st: 'new'};
  S.slabs[sid] = sl; save();
  queueScan(grader, cert);                   // -> scans.csv
  UI.feed = [{sid}].concat(UI.feed).slice(0, 6); UI.feedN++; UI.dup = null;
  if (live) beep();
  if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) {}
  pumpLookups();
  if (busy) paintScan(); else render();
  return sl;
}
const gkLabelShort = sl => { const x = calc(sl); return x.name + (x.known && x.gk ? ' · ' + gkLabel(x.gk) : ''); };
function newTable() {                        // the next table, with the vendor typed on Scan
  const now = Date.now(), n = S.tables.reduce((m, t) => Math.max(m, t.n), 0) + 1, id = 't' + now.toString(36);
  S.tables.push({id, n, vendor: UI.draftVendor || '', at: now}); save();
  return id;
}
async function startRec(tableId) {
  if (VREAD.on) return;
  const now = Date.now();
  if (UI.test) {                               // every recording is its own test (no more "tap Clear first"); the last test's file stays until this one has its own
    if (TEST.zip && !TEST.zip.saved && !TEST.zip.warned) { TEST.zip.warned = true; return toast('The last test\'s file is not saved yet - tap Save test data, or tap record again to go on without it.'); }
    testClear(); TEST.zip = null; TEST.zipSeq++; UI.reportText = null; TEST.step = TEST_STEP + 1; TEST.label = TEST_PLAN[TEST_STEP];
  }
  const id = UI.test ? null : (tableId || newTable());
  SCAN.seen.clear(); SCAN.lastLen = 0;         // the sightings are counted anew for every table
  Object.assign(UI, {rec: true, recTable: id, recStart: now, feed: [], dup: null, tab: 'scan', openTable: null, camErr: null});
  SCAN.lastHit = SCAN.lastNew = performance.now(); SCAN.cntSeen = -1; SCAN.glare = 0; SCAN.bestPx = 0; SCAN.revived = 0; SCAN.reviving = false;
  audioOn(); wakeOn();
  render();
  try { workerReady(); zxReady(); await camStart(); SCAN.timer = setInterval(scanFrame, 50); }
  catch (e) {
    UI.camErr = 'No camera: ' + (e && e.message || e) + (UI.test ? '.' : DSTATE === 'ok' ? '. Type certs on the table instead.' : '. Showing sample reads instead.');
    if (DSTATE !== 'ok' && !UI.test) simStart();
  }
  SCAN.tick = setInterval(() => { camWatch(); paintScan(); }, 1000);
  paintScan();
}
function simStart() {                        // no camera and no card data: sample slabs appear, as on the prototype
  const r = mulberry(Date.now() % 100000);
  SCAN.sim = setInterval(() => {
    if (!UI.rec) return;
    const have = new Set(slabsArr().filter(sl => sl.t === UI.recTable && sl.demo).map(sl => sl.c));
    const free = POOL.filter(c => !have.has(c.i)), roll = r();
    if (roll < 0.14 && UI.feed.length) { UI.dup = 'Already read: ' + calc(S.slabs[UI.feed[0].sid]).name + ' (counted once)'; return paintScan(); }
    if (roll > 0.82 || !free.length || UI.feed.length >= 14) { UI.dup = null; return paintScan(); }
    const c = free[Math.floor(r() * free.length)], sid = 's' + (S.seq++);
    S.slabs[sid] = {id: sid, demo: true, c: c.i, t: UI.recTable, cert: demoCert(c, r), mode: 'pct', vd: null, vp: null, st: 'new', at: Date.now()};
    UI.feed = [{sid}].concat(UI.feed).slice(0, 6); UI.feedN++; UI.dup = null; save(); paintScan();
  }, 1150);
}
function stopRec() {
  clearInterval(SCAN.timer); clearInterval(SCAN.sim); clearInterval(SCAN.tick); SCAN.timer = SCAN.sim = SCAN.tick = null;
  camOff(); wakeOff(); SCAN.boxes = [];
  if (UI.test) {
    Object.assign(UI, {rec: false, recTable: null, feed: [], dup: null}); render();
    setTimeout(() => { const c = $('sheet-card'); if (c) c.scrollIntoView({block: 'start'}); }, 80);
    if (TEST.frames) testStep(1);
    const seq = ++TEST.zipSeq;                 // (a file still being made when the next test starts is dropped)
    if (TEST.frames) buildTestZip().then(z => { if (seq !== TEST.zipSeq) return; TEST.zip = z; if (!UI.rec) paintScan(); }, e => { if (seq !== TEST.zipSeq) return; TEST.zip = null; TEST.keepErr = 'file: ' + String(e && e.message || e).slice(0, 100); if (!UI.rec) paintScan(); });
    return;
  }
  sendScans();
  finishTable(UI.recTable);
}
function finishTable(id, emptyMsg) {         // after a recording or a video: to the table, or drop it if nothing was read
  const count = slabsArr().filter(sl => sl.t === id).length;
  if (!count) { S.tables = S.tables.filter(t => t.id !== id); save(); Object.assign(UI, {rec: false, recTable: null, feed: [], dup: null, scanMsg: emptyMsg || null}); return render(); }
  Object.assign(UI, {rec: false, recTable: null, tab: 'tables', openTable: id, feed: [], dup: null, draftVendor: '', sort: 'best', scanMsg: null});
  render();
}
// a video recorded with the Camera app (its own focus, steadying and 4K), read frame by frame - six frames a second
const VIDEO_STEP_S = 1 / 6;
function seekTo(v, t) {
  return new Promise(res => {
    let tm = 0; const done = () => { v.removeEventListener('seeked', done); clearTimeout(tm); res(); };
    tm = setTimeout(done, 5000); v.addEventListener('seeked', done); v.currentTime = t;
  });
}
async function readVideo(file) {
  if (!file || UI.rec || VREAD.on) return;
  const fv = document.createElement('video');
  fv.muted = true; fv.playsInline = true; fv.setAttribute('playsinline', ''); fv.setAttribute('muted', ''); fv.preload = 'auto';
  const url = URL.createObjectURL(file); fv.src = url;
  const tid = UI.test ? null : newTable();
  SCAN.seen.clear();
  if (UI.test) { testClear(); TEST.zip = null; TEST.zipSeq++; UI.reportText = null; TEST.step = 0; TEST.label = ''; }   // a video read in Test mode is a test of its own too
  Object.assign(VREAD, {on: true, stop: false, el: fv, pct: 0, w: 0, h: 0, frames: 0, tid, name: file.name || 'video'});
  Object.assign(UI, {recTable: tid, feed: [], dup: null, camErr: null, scanMsg: null, tab: 'scan', openTable: null});
  wakeOn(); render();
  let err = null;
  try {
    await new Promise((res, rej) => { if (fv.readyState >= 1) return res(); fv.onloadedmetadata = res; fv.onerror = () => rej(new Error('this video could not be opened')); setTimeout(() => rej(new Error('the video did not load')), 30000); });
    try { await fv.play(); fv.pause(); } catch (e) {}     // some phones show no picture until a video has played once
    const w = fv.videoWidth, h = fv.videoHeight, dur = isFinite(fv.duration) ? fv.duration : 600;
    VREAD.w = w; VREAD.h = h; paintScan();
    if (!w || !h) throw new Error('no picture in this file');
    for (let t = 0, k = 0; t < dur && !VREAD.stop; t += VIDEO_STEP_S, k++) {
      await seekTo(fv, Math.min(t, Math.max(0, dur - 0.01)));
      // no hurry: the finder and the whole-frame pass on every frame, the two binarizers by turns for the whole pass
      const out = await readImage(fv, w, h, readerOpts(k & 1, wideFormats()), {find: true, full: true});
      gotReads(out.res, out.w || w, out.h || h, out.ms, tid, out.sharp, out.t);
      VREAD.frames++; VREAD.pct = Math.min(1, (t + VIDEO_STEP_S) / dur); paintScan();
    }
  } catch (e) { err = e; }
  URL.revokeObjectURL(url); fv.removeAttribute('src'); try { fv.load(); } catch (e) {}
  const name = VREAD.name;
  Object.assign(VREAD, {on: false, el: null}); wakeOff(); SCAN.boxes = [];
  if (UI.test) {
    UI.recTable = null; UI.camErr = err ? 'Video: ' + (err.message || err) : null;
    const seq = ++TEST.zipSeq;
    if (TEST.frames) buildTestZip().then(z => { if (seq === TEST.zipSeq) { TEST.zip = z; if (!UI.rec && !VREAD.on) paintScan(); } }, () => {});
    return render();
  }
  sendScans();
  finishTable(tid, err ? 'Video: ' + (err.message || err) : 'No PSA or CGC barcode was read in ' + name + '. Try Test mode on it to see what the reader picks up.');
}

/* ---------------- looking a slab up (PSA's API from this phone; CGC by name for now) ---------------- */
function psaDay() { const d = new Date().toISOString().slice(0, 10), v = LS.get(PSA_DAY, null); return v && v.day === d ? v : {day: d, n: 0, stop: 0}; }
const psaLeft = () => { const v = psaDay(); return v.stop ? 0 : Math.max(0, PSA_MAX - v.n); };
function psaGk(grade, desc) {
  const g = String(grade || '').trim(), m = /(\d+(?:\.5)?)\s*$/.exec(g) || /\b(\d+(?:\.5)?)\b/.exec(g) || /\b(\d+(?:\.5)?)\b/.exec(String(desc || ''));
  if (!m) return null;
  const k = 'psa|g' + m[1].replace('.', '_');
  return D && D.gk.includes(k) ? k : null;
}
function guessCards(a) {                     // no spec match: the card number, then the name's words, then the set's
  if (!IDX) return [];
  const num = numNorm(a.num), words = norm(a.subject).split(' ').filter(w => w.length > 1 && !['the', 'of', 'and'].includes(w));
  const setw = norm(a.brand).split(' ').filter(w => w.length > 2 && !['pokemon', 'japanese', 'english', 'promo', 'black', 'star'].includes(w));
  const out = [];
  for (const c of IDX.list) {
    if (num && c.num !== num) continue;
    const hit = words.filter(w => c.hay.includes(' ' + w + ' ')).length;
    if (!hit || hit < Math.ceil(words.length * 0.6)) continue;
    const sh = setw.filter(w => c.hay.includes(' ' + w + ' ')).length;
    out.push([c.cid, hit / Math.max(1, words.length) + sh * 0.25]);
  }
  return out.sort((x, y) => y[1] - x[1]).map(x => x[0]);
}
function resolveCard(sl) {
  const a = sl.auth || {};
  const bySpec = a.spec != null && a.spec !== '' ? (IDX.spec.get(String(a.spec)) || []) : [];
  if (bySpec.length === 1) { sl.cid = bySpec[0]; sl.look = 'ok'; sl.how = 'spec'; sl.cands = null; return; }
  const cands = bySpec.length ? bySpec : guessCards(a);
  if (cands.length) { sl.cands = cands.slice(0, 8); sl.cid = cands[0]; sl.look = 'check'; sl.how = bySpec.length ? 'spec' : 'guess'; return; }
  sl.look = 'manual'; sl.lookWhy = 'nf'; sl.cid = null;
}
let LQ = false;
async function pumpLookups() {
  if (LQ) return; LQ = true;
  try {
    for (;;) {
      const sl = slabsArr().find(x => !x.demo && x.look === 'queued');
      if (!sl) break;
      await lookup(sl); save();
      if (UI.rec) paintScan(); else render();
    }
  } finally { LQ = false; }
}
async function lookup(sl) {
  if (!D) { sl.look = 'manual'; sl.lookWhy = 'lock'; return; }
  if (sl.grader !== 'psa') { sl.look = 'manual'; sl.lookWhy = 'cgc'; return; }
  const tok = LS.get(PSA_TOKEN, '');
  if (!tok) { sl.look = 'manual'; sl.lookWhy = 'token'; return; }
  if (psaLeft() <= 0) { sl.look = 'manual'; sl.lookWhy = 'quota'; return; }
  sl.look = 'looking';
  let res, status = 0;
  try {
    const r = await fetch('https://api.psacard.com/publicapi/cert/GetByCertNumber/' + encodeURIComponent(sl.cert), {headers: {Authorization: 'bearer ' + tok}});
    status = r.status;
    const v = psaDay(); v.n++; if (r.status === 429) v.stop = 1; LS.set(PSA_DAY, v);
    if (r.status === 429) { sl.look = 'manual'; sl.lookWhy = 'quota'; return; }
    if (r.status === 401 || r.status === 403 || r.status === 500) { sl.look = 'manual'; sl.lookWhy = 'badtoken'; return; }
    if (!r.ok) throw new Error('PSA answered ' + r.status);
    res = await r.json();
  } catch (e) { sl.look = 'queued'; sl.lookTry = (sl.lookTry || 0) + 1; if (sl.lookTry >= 3) { sl.look = 'manual'; sl.lookWhy = 'net'; } else await new Promise(r => setTimeout(r, 4000)); return; }
  const p = res && res.PSACert;
  if (!p || !p.CertNumber) { sl.look = 'manual'; sl.lookWhy = 'psanf'; return; }
  sl.auth = {src: 'psa', year: p.Year || '', brand: p.Brand || '', subject: p.Subject || '', num: p.CardNumber || '', variety: p.Variety || '',
    grade: p.CardGrade || '', gdesc: p.GradeDescription || '', spec: p.SpecID != null ? String(p.SpecID) : '', pop: p.TotalPopulation, popHi: p.PopulationHigher, label: p.LabelType || ''};
  sl.gk = psaGk(p.CardGrade, p.GradeDescription);
  resolveCard(sl);
  void status;
}
const WHY = {
  lock: 'Unlock the app (Show tab) to look slabs up.',
  cgc: 'CGC slabs are looked up through Card Hedge, which is not connected yet - find the card by name.',
  token: 'Add your PSA API token on the Show tab to look PSA slabs up - or find the card by name.',
  quota: 'PSA’s 100 lookups for today are used up - find the card by name.',
  badtoken: 'PSA did not accept the token on the Show tab - check it, or find the card by name.',
  net: 'No signal reaching PSA - try again later, or find the card by name.',
  psanf: 'PSA has no record of this cert - check the number, or find the card by name.',
  nf: 'Not in your catalog by PSA spec or by name - find the card by name.'
};

/* ---------------- drawing ---------------- */
const ICON = {
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  scan: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 9v6M10 9v6M13 9v6M16 9v6"/></svg>',
  tables: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="12" width="18" height="5" rx="1.5"/><path d="M7 20h10"/></svg>',
  buys: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/></svg>',
  show: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>'
};
const pillCls = x => x.chance == null ? 'pill lo' : x.chance >= 0.6 ? 'pill hi' : x.chance >= S.settings.bar / 100 ? 'pill mid' : 'pill lo';
const badge = x => '<span class="badge ' + (x.grader === 'PSA' ? 'psa' : x.grader === 'CGC' ? 'cgc' : 'unk') + '"><small>' + esc(x.grader || '?') + '</small>' + esc(x.gk ? gkShort(x.gk) : '?') + '</span>';
function rowHtml(o, P, withTable) {
  const sl = o.sl, x = o.x, inPlan = !!P.picks[sl.id], few = !!P.few[sl.id];
  const tagMap = {new: 'Not asked', asked: 'Asked', declined: 'No deal', agreed: 'Agreed', bought: 'Bought'};
  let tag = tagMap[sl.st], tc = 't-' + sl.st;
  if (sl.st === 'new' && inPlan) { tag = 'Buy'; tc = 't-buy'; }
  if (!sl.demo && (sl.look === 'queued' || sl.look === 'looking')) { tag = 'Looking up'; tc = 't-look'; }
  else if (!sl.demo && sl.look === 'check') { tag = 'Check it'; tc = 't-check'; }
  else if (!sl.demo && sl.look === 'manual') { tag = 'Find card'; tc = 't-check'; }
  else if (sl.rec) { tag = 'Recorded'; tc = 't-bought'; }
  const t = withTable ? tableOf(sl.t) || {} : null, s = S.settings;
  const ask = sl.vp != null ? 'Vendor ' + money(sl.vp) : sl.vd != null ? 'Vendor ' + sl.vd.toFixed(1) + '% under' : 'At your ' + s.under.toFixed(1) + '%';
  const line2 = x.std == null ? (identified(sl) ? 'No Card Ladder price' + (x.pc != null ? ' · PC ' + money(x.pc) : '') : x.known || sl.auth ? (sl.grader || '').toUpperCase() + ' ' + sl.cert : '')
    : (withTable ? 'Table ' + (t.n || '?') + ' · ' : '') + ask + ' · pay ' + money(x.pay);
  return '<button class="row' + (inPlan ? ' buy' : '') + (sl.st === 'declined' ? ' gone' : '') + (few && !inPlan ? ' few' : '') + '" data-a="open" data-id="' + esc(sl.id) + '">' +
    badge(x) + '<span class="rmain"><span class="rname">' + esc(x.name) + '</span><span class="rsub">' + esc(x.sub) + '</span><span class="rsub">' + esc(line2) +
    (few && x.std != null ? ' · ' + (x.sold || 0) + ' sold last mo' : '') + '</span></span>' +
    '<span class="rside"><span class="' + pillCls(x) + '">' + (x.chance == null ? '-' : pctS(x.chance)) + '</span>' +
    '<span style="font-weight:600">' + (x.std == null ? '' : money(x.std)) + '</span><span class="tag ' + tc + '">' + esc(tag) + '</span></span></button>';
}
function renderTop() {
  const P = plan(), total = P.chosen.reduce((a, o) => a + o.x.pay, 0);
  $('showname').textContent = S.settings.show || 'Show';
  $('spend').textContent = money(total + P.spent) + ' of ' + money(P.cap);
}
function renderTabs() {
  const P = plan(), n = P.chosen.length, on = k => 'tab' + (UI.tab === k ? ' on' : '');
  $('tabs').innerHTML =
    '<button class="' + on('scan') + '" data-a="tab" data-v="scan">' + ICON.scan + 'Scan</button>' +
    '<button class="' + on('tables') + '" data-a="tab" data-v="tables">' + ICON.tables + 'Tables</button>' +
    '<button class="' + on('plan') + '" data-a="tab" data-v="plan">' + ICON.buys + 'Buys' + (n ? '<span class="count">' + n + '</span>' : '') + '</button>' +
    '<button class="' + on('show') + '" data-a="tab" data-v="show">' + ICON.show + 'Show</button>';
}
function render() {
  renderTop(); renderTabs();
  const m = $('main');
  m.innerHTML = UI.tab === 'scan' ? scanHtml() : UI.tab === 'tables' ? (UI.openTable ? tableHtml() : tablesHtml()) : UI.tab === 'plan' ? planHtml() : showHtml();
  if (UI.tab === 'scan') {
    const vf = $('vf'), el = VREAD.on && VREAD.el ? VREAD.el : VIDEO;
    if (vf && !vf.contains(el)) { vf.prepend(el); if (el === VIDEO && SCAN.stream) VIDEO.play().catch(() => {}); }
    paintScan();
  }
  renderSheet();
  renderOverlay();
}
function scanHtml() {
  const nextN = S.tables.reduce((m, t) => Math.max(m, t.n), 0) + 1;
  return '<div class="stack"><div class="spread"><h1 class="h1" id="scan-title">Table ' + nextN + '</h1><span class="muted small" id="scan-sub">next table</span></div>' +
    '<label class="field" id="vendor-field"><span class="label">Vendor or booth</span><input class="input" type="text" placeholder="Optional - e.g. Booth 214" value="' + esc(UI.draftVendor) + '" data-in="draftVendor"></label>' +
    '<div class="viewfinder" id="vf"><div class="vfslabs" id="vfslabs">' + '<div class="fslab"><div class="flabel"><div class="fbar"></div></div><div class="fart"></div></div>'.repeat(8) + '</div>' +
    '<div class="corner c1"></div><div class="corner c2"></div><div class="corner c3"></div><div class="corner c4"></div><canvas class="vfboxes" id="vf-boxes"></canvas>' +
    '<div id="vf-rec"></div><div id="vf-tools"></div><div class="vfhint" id="vf-hint">Hold about a foot away (with 3x: 2 feet or more) and pause over each group of slabs</div></div>' +
    '<div id="vid-prog"></div>' +
    '<div class="recwrap"><div class="livestat" id="live-stat"></div><div class="livemap" id="live-map"></div><button class="recbtn" id="rec-btn" data-a="rec" aria-label="Start recording"><span class="core"></span></button><span class="small muted" id="rec-hint">Tap to record this table</span></div>' +
    '<div class="toolrow" id="toolrow"><label class="btn" id="vid-btn">Read a video<input class="vh" type="file" accept="video/*" id="vid-in"></label>' +
    '<button class="btn" id="test-btn" data-a="test" aria-pressed="false">Test mode: Off</button></div>' +
    '<div id="cam-err"></div><div id="scan-msg"></div><div class="feed" id="feed"></div><div id="test-panel"></div>' +
    '<p class="note" id="scan-note"></p></div>';
}
const detCls = v => v == null ? 'lo' : v >= 2 ? 'hi' : v >= 1.5 ? 'mid' : 'lo';
// THE MAP OF THE SHEET (2026-11-10; Brett sent screenshots, not the pasted report: "Can i just record my screen next
// time"). With a printed test sheet in view, Test mode shows the sheet as it is laid out - five across, ten down, each
// code green with the second it counted, amber if it was sighted but never surely enough to count, red if it never was -
// and under it the run's numbers in a few lines, so ONE screenshot after a run carries what the pasted report did: which
// codes were missed (and so where on the sheet, and of which kind), the camera, the speed, the timings.
function sheetDone() {                       // every code of a printed sheet has counted: nothing is hiding any more
  for (const v of TEST.sheetN.values()) if (v >= 50) return true;
  return false;
}
function sheetCard() {
  const hit = new Map(), all = [...TEST.reads.values()], okN = m => { let n = 0; for (const r of m.values()) if (r.ok) n++; return n; };
  for (const r of all) { const at = SHEET_OF.get(r.text); if (at) { if (!hit.has(at[0])) hit.set(at[0], new Map()); hit.get(at[0]).set(at[1], r); } }
  const sheets = [...hit.entries()].filter(e => e[1].size >= 3).sort((a, b) => okN(b[1]) - okN(a[1]) || b[1].size - a[1].size).slice(0, 2);
  if (!sheets.length) return '';
  const off = all.filter(r => !SHEET_OF.has(r.text)), st = testStats(), secs = TEST.t0 ? (TEST.last - TEST.t0) / 1000 : 0, cam = TEST.cam || {};
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : '-'; };
  const kind = n => n.length === 10 ? 'C' : n.length === 9 ? 'P' : 'I', d = v => v == null ? '-' : v;
  const maps = sheets.map(([sh, got]) => {
    const nums = TEST_SHEETS[sh - 1].split(','), by = {C: [0, 0], P: [0, 0], I: [0, 0]};
    const cells = nums.map((n, k) => { const r = got.get(k), kd = kind(n), ok = r && r.ok; by[kd][1]++; if (ok) by[kd][0]++;
      return '<span class="tc ' + (ok ? r.z || r.w ? 'ok' : 'ok evo' : r ? 'un' : 'no') + '">' + (k + 1) + '<i>' + kd + '</i>' + (ok ? '<em>' + (r.first < 100 ? r.first.toFixed(1) : Math.round(r.first)) + '</em>' : '') + '</span>'; }).join('');
    return '<div class="tbig"><b>' + okN(got) + '</b>of 50 read on sheet ' + sh + '</div>' +
      '<div class="small muted">CGC ' + by.C[0] + '/' + by.C[1] + ' · PSA Code 128 (thinnest bars) ' + by.P[0] + '/' + by.P[1] + ' · PSA ITF ' + by.I[0] + '/' + by.I[1] + '</div>' +
      '<div class="tmap">' + cells + '</div>';
  }).join('');
  const firsts = st.ok.filter(r => SHEET_OF.has(r.text)).map(r => r.first).sort((a, b) => a - b), mark = n => firsts.length >= n ? firsts[n - 1].toFixed(1) : '-';
  const offOk = off.filter(r => r.ok);
  const lines = [                              // short lines: each fits a phone's width without wrapping
    ...(TEST.step ? ['test ' + TEST.step + ': ' + TEST.label.slice(0, 38)] : []),
    APP_VERSION + ' · ' + TEST.w + '×' + TEST.h + ' · ' + (TEST.mode === 'video' ? 'video file' : TEST.lens + ' · ' + (cam.frameRate || '?') + 'fps'),
    Math.round(secs) + ' s · ' + TEST.frames + ' frames (' + (secs ? (TEST.frames / secs).toFixed(1) : '-') + '/s) · most/frame ' + TEST.maxPer,
    'ms: pixels ' + med(TEST.tget) + ' · find ' + med(TEST.tf) + ' · lines ' + med(TEST.tl),
    'ms: zxing ' + med(TEST.tr) + ' · grey ' + med(TEST.ty) + ' · whole ' + med(TEST.tw),
    'per frame: boxes ' + d(perFrame(TEST.kept, TEST.stN)) + '/' + d(perFrame(TEST.boxes, TEST.stN)) + ' · A ' + d(perFrame(TEST.sure, TEST.frames)) + ' B ' + d(perFrame(TEST.strong, TEST.frames)) + ' C ' + d(perFrame(TEST.weak, TEST.frames)),
    'counted ' + st.ok.length + ' · sighted only ' + (all.length - st.ok.length) + ' · empty frames ' + TEST.empty,
    'by: grey-line only ' + st.ok.filter(r => r.g && !r.z && !r.w).length + ' · zxing only ' + st.ok.filter(r => !r.g).length + ' · both ' + st.ok.filter(r => r.g && (r.z || r.w)).length,
    'sharp ' + st.q(0.1) + '/' + st.q(0.5) + '/' + st.best + ' · glare ' + (TEST.tg.length ? (med(TEST.tg) * 100).toFixed(1) + '%' : '-') + ' · code length ' + med(TEST.lens_),
    'secs to 10/25/40/45/50: ' + [10, 25, 40, 45, 50].map(mark).join('/'),
    'not on a sheet: counted ' + offOk.length + (offOk.length ? ' (' + offOk.slice(0, 3).map(r => r.text.slice(0, 12)).join(', ') + ')' : '') + ' · sighted ' + (off.length - offOk.length),
    ...(SCAN.finder && !TEST.ferr ? [] : ['FINDER ' + (TEST.ferr ? 'ERROR: ' + TEST.ferr.slice(0, 60) : 'NOT LOADED')])];
  return '<div id="sheet-card">' + maps + '<div class="tstat">' + lines.map(esc).join('<br>') + '</div>' +
    '<div class="small muted">Green = read, with the second it counted (outlined: by the grey-line reader alone); amber = sighted, never surely enough to count; red = never. C = CGC, P = PSA Code 128, I = PSA ITF.</div></div>';
}
function testHtml() {
  const rows = [...TEST.reads.values()].sort((a, b) => b.at - a.at);
  const cam = UI.rec && SCAN.stream && VIDEO.videoWidth ? 'Camera ' + resLabel(VIDEO.videoWidth, VIDEO.videoHeight) + ' (' + VIDEO.videoWidth + '×' + VIDEO.videoHeight + '), ' + lensLabel() + ' lens'
    : VREAD.on && VREAD.w ? 'Video ' + VREAD.w + '×' + VREAD.h : '';
  const speed = (UI.rec || VREAD.on) && SCAN.fps ? ', ' + SCAN.fps.toFixed(1) + ' frames read a second' : '';
  const nOk = testOk(), more = rows.length - nOk;
  return '<div class="card stack" style="gap:10px"><div class="spread"><span class="label">Test mode</span>' + (rows.length || TEST.frames ? '<button class="linkbtn" style="min-height:0;padding:0" data-a="testclear">Clear</button>' : '') + '</div>' +
    (UI.rec || VREAD.on ? '' : '<div class="tplan"><button class="minibtn" data-a="teststep" data-v="-1" aria-label="Previous test">‹</button><div class="tplan-t"><b>Next: test ' + (TEST_STEP + 1) + ' of ' + TEST_PLAN.length + '</b>' + esc(TEST_PLAN[TEST_STEP]) + '</div><button class="minibtn" data-a="teststep" data-v="1" aria-label="Next test">›</button></div>') +
    (sheetCard() || '<div class="tbig"><b>' + nOk + '</b>different code' + (nOk === 1 ? '' : 's') + ' read</div>') +
    (cam ? '<div class="small muted">' + esc(cam + speed) + '</div>' : '') +
    (TEST.frames ? '<div class="small muted">' + TEST.frames + ' frames read' + (more ? ', ' + more + ' more code' + (more === 1 ? '' : 's') + ' sighted but not surely enough to count' : '') + '</div>' : '') +
    (TEST.frames && !(UI.rec || VREAD.on) ? (TEST.zip ? '<button class="btn green" data-a="testsave">Save test data (' + (TEST.zip.pics ? TEST.zip.pics + ' picture' + (TEST.zip.pics === 1 ? '' : 's') + ', ' : '') + TEST.zip.mb + ' MB)</button>' +
        '<div class="small muted">' + esc(TEST.zip.note || 'One file: the pictures kept from this test as the camera gave them, and a log of every frame. Nothing is sent anywhere - you choose where it goes (AirDrop, Files).') + '</div>' +
        (TEST.zip.parts && TEST.zip.parts.length > 1 ? '<button class="linkbtn" style="min-height:0;padding:0;text-align:left" data-a="testsaveparts">…or share them as ' + TEST.zip.parts.length + ' separate files</button>' : '')
      : '<div class="small muted">' + (TEST.keepErr && !TEST.keep.length ? 'No pictures were kept (' + esc(TEST.keepErr) + ').' : 'Preparing the test file…') + '</div>') +
      '<button class="btn" data-a="testcopy">Copy report for Claude</button>' : '') +
    (UI.reportText ? '<textarea class="input" style="height:120px;font-size:12px" readonly>' + esc(UI.reportText) + '</textarea>' : '') +
    rows.slice(0, 60).map(r => '<div class="trow' + (r.ok ? '' : ' un') + '"><span class="tfmt">' + esc(fmtName(r.format)) + '</span><span class="ttext">' + esc(r.text) + '</span>' +
      (r.ok ? '' : '<span class="tdet lo">not counted</span>') + (r.min == null ? '' : '<span class="tdet ' + detCls(r.min) + '">' + r.min.toFixed(1) + ' dots/bar</span>') + '</div>').join('') +
    '<p class="note" style="margin:0">Nothing is saved, looked up or sent in Test mode. A code counts once the reader is sure of it - its two readers agreeing on one frame, or one of them on a second frame - the same rule as at a show. Dots/bar = the finest detail each code was still read at: camera dots per thin bar (per square for a QR). With 1x a slab’s barcode reads to about 13 inches; from 2 feet or more, tap 3x on the picture. Movement across the bars smears them: a short pause over each group reads them. With one of the printed test sheets in view, a map of the sheet shows which codes counted. Each recording is a test of its own: after Stop, Save test data hands over the pictures kept from it and a log of every frame, in one file (or screenshot the map; or Copy report for the numbers alone).</p></div>';
}
function paintScan() {
  if (UI.tab !== 'scan' || !$('rec-btn')) return;
  const busy = UI.rec || VREAD.on, tid = UI.rec || VREAD.on ? UI.recTable : null, t = tid ? tableOf(tid) : null, nextN = S.tables.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  const cam = UI.rec && !!SCAN.stream;
  $('scan-title').textContent = UI.test ? 'Test mode' : 'Table ' + (t ? t.n : nextN);
  $('scan-sub').textContent = VREAD.on ? 'reading a video' : UI.rec ? (UI.test ? 'recording' : t && t.vendor ? t.vendor : 'recording') : UI.test ? 'nothing is saved' : 'next table';
  $('vendor-field').hidden = busy || UI.test;
  $('vf').classList.toggle('rec', busy);
  $('vfslabs').hidden = cam || VREAD.on;
  const secs = UI.rec ? Math.floor((Date.now() - UI.recStart) / 1000) : 0, cnt = UI.test ? testOk() : t ? slabsArr().filter(sl => sl.t === t.id).length : 0;
  const what = UI.test ? (cnt === 1 ? ' code' : ' codes') : ' read';
  $('vf-rec').innerHTML = UI.rec ? '<div class="scanline"></div><div class="recbadge"><span class="recdot"></span>' + (UI.test ? 'TEST ' : 'REC ') + Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2) + ' · ' + cnt + what + '</div>'
    : VREAD.on ? '<div class="recbadge"><span class="recdot"></span>VIDEO ' + Math.round(VREAD.pct * 100) + '% · ' + cnt + what + '</div>' : '';
  const ch = lensChoices(), cur = S.settings.lens;
  const fr = SCAN.settings && SCAN.settings.frameRate ? ' · ' + Math.round(SCAN.settings.frameRate) + 'fps' : '';
  // Nothing read for three seconds while the camera runs: say what makes a frame readable (2026-11-09 - on the simulated
  // frames a sideways smear of 4 camera dots, two bars' width, read nothing at all; the same smear along the bars cost
  // nothing). g13: and when the codes the finder sees are too small for this lens (SMALL_LEN), say that instead - with
  // the 3x lens named where the phone has one. (No word of the Light any more: Brett will not use it at a show.)
  const idle = cam && VIDEO.videoWidth && performance.now() - (SCAN.lastHit || 0) > 3000;
  // GLARE (2026-11-10, Brett's fourth test: what the shadow did not hide, glare on the sheet's plastic sleeve did - a
  // blown-out patch holds no code for any reader, but it moves when the phone does): while codes are being read but no
  // NEW one has come for four seconds and over GLARE_MIN of the picture is blown out (the worker counts it), say so.
  if (cnt !== SCAN.cntSeen) { SCAN.cntSeen = cnt; SCAN.lastNew = performance.now(); }
  const stale = performance.now() - (SCAN.lastNew || 0) > 4000 && !(UI.test && sheetDone());
  const glare = cam && VIDEO.videoWidth && !idle && SCAN.glare >= GLARE_MIN && stale;
  // TOO FAR comes first: the codes the finder sees are under SMALL_LEN dots long and nothing new has counted for four seconds
  const tele = lensLabel() === '3x', far = SCAN.lastLen > 0 && SCAN.lastLen < SMALL_LEN && (idle || stale);
  const coach = !(cam && VIDEO.videoWidth) ? '' : far ? (tele ? 'Too far for 3x - move closer' : lensChoices().some(c => c[0] === 'tele') ? 'Too far for 1x - move closer, or tap 3x' : 'Too far - move closer, to about a foot')
    : idle ? (tele ? 'Nothing readable - 3x needs 2 feet or more, held still' : 'Nothing readable - hold still, about a foot away') : glare ? 'Glare - shift or tilt the phone a little' : '';
  $('vf-tools').innerHTML = cam && VIDEO.videoWidth ? '<div class="vfinfo">' + resLabel(VIDEO.videoWidth, VIDEO.videoHeight) + ' · ' + lensLabel() + fr + '</div>' +
      (SCAN.caps && SCAN.caps.torch ? '<button class="lightbtn' + (SCAN.torch ? ' on' : '') + '" data-a="light" aria-pressed="' + (SCAN.torch ? 'true' : 'false') + '">Light ' + (SCAN.torch ? 'on' : 'off') + '</button>' : '') +
      (coach ? '<div class="vfcoach">' + coach + '</div>' : '') +
      (ch.length ? '<div class="lensbar" role="group" aria-label="Lens">' + ch.map(c => '<button class="' + ((cur === c[0] || (c[0] === 'main' && !ch.some(x => x[0] === cur))) ? 'on' : '') + '" data-a="lens" data-v="' + c[0] + '">' + c[1] + '</button>').join('') + '</div>' : '')
    : VREAD.on && VREAD.w ? '<div class="vfinfo">' + resLabel(VREAD.w, VREAD.h) + ' video</div>' : '';
  $('vf-hint').hidden = cam || VREAD.on;
  if (!(UI.test && UI.rec)) paintLive();
  $('rec-btn').classList.toggle('on', busy);
  $('rec-btn').setAttribute('aria-label', VREAD.on ? 'Stop reading the video' : UI.rec ? 'Stop recording' : 'Start recording');
  $('rec-hint').textContent = VREAD.on ? 'Tap to stop reading the video' : UI.rec ? (lensLabel() === '3x' ? '3x focuses from about 2 feet away - tap to stop' : UI.test ? 'Test ' + TEST.step + ' - tap to stop' : 'Tap to stop - the slabs go to this table') : UI.test ? 'Test ' + (TEST_STEP + 1) + ' of ' + TEST_PLAN.length + ': ' + TEST_PLAN[TEST_STEP] + ' - tap to record' : 'Tap to record this table';
  $('toolrow').hidden = busy;
  $('test-btn').textContent = 'Test mode: ' + (UI.test ? 'On' : 'Off'); $('test-btn').classList.toggle('on', UI.test); $('test-btn').setAttribute('aria-pressed', UI.test ? 'true' : 'false');
  $('vid-prog').innerHTML = VREAD.on ? '<div class="progress" style="margin-top:2px"><span style="width:' + Math.round(VREAD.pct * 100) + '%"></span></div>' : '';
  $('cam-err').innerHTML = UI.camErr ? '<div class="warnbox">' + esc(UI.camErr) + '</div>' : '';
  $('scan-msg').innerHTML = UI.scanMsg && !busy ? '<div class="warnbox">' + esc(UI.scanMsg) + '</div>' : '';
  const feed = UI.feed.map((f, k) => { const sl = S.slabs[f.sid]; if (!sl) return ''; const x = calc(sl);
    const right = !sl.demo && (sl.look === 'queued' || sl.look === 'looking') ? '<span class="tag t-look">Looking up</span>' : !sl.demo && sl.look === 'manual' ? '<span class="tag t-check">Find card</span>' : '<span class="' + pillCls(x) + '">' + (x.chance == null ? '-' : pctS(x.chance)) + '</span>';
    return '<div class="chip' + (k === 0 ? ' fresh' : '') + '"><span class="tick">' + ICON.check + '</span><span class="ctext"><b>' + esc(x.name) + '</b>' + (x.known && x.gk ? ' · ' + esc(gkLabel(x.gk)) : '') + '</span>' + right + '</div>'; }).join('');
  $('feed').innerHTML = busy && !UI.test ? (UI.dup ? '<div class="dup">' + esc(UI.dup) + '</div>' : '') + feed : '';
  $('test-panel').innerHTML = UI.test ? testHtml() : '';
  $('scan-note').innerHTML = UI.test ? '' : DSTATE !== 'ok' ? 'Sample mode: unlock on the Show tab to look real slabs up. Without a camera, sample slabs appear as if read.'
    : 'Each slab’s barcode or QR is read once per table; PSA slabs are looked up with PSA right away, and each cert’s link goes to scans.csv. Read a video: a clip you filmed with the Camera app, read frame by frame into a new table.';
}
function tablesHtml() {
  const P = plan(), ts = tablesSorted().reverse();
  const cards = ts.map(t => {
    const os = P.all.filter(o => o.sl.t === t.id), best = os.reduce((m, o) => Math.max(m, o.x.chance || 0), 0);
    return '<button class="tcard" data-a="table" data-id="' + esc(t.id) + '"><div class="spread"><span class="h2">Table ' + t.n + '</span><span class="small muted">' + hhmm(t.at) + '</span></div>' +
      '<span class="muted small">' + esc(t.vendor || 'No vendor name') + '</span><div class="stats"><span class="stat"><b>' + os.length + '</b> slabs</span>' +
      '<span class="stat"><b>' + os.filter(o => P.picks[o.sl.id]).length + '</b> to buy</span><span class="stat">best <b>' + (os.length && best ? pctS(best) : '-') + '</b></span>' +
      '<span class="stat"><b>' + os.filter(o => o.sl.st !== 'new').length + '</b> asked</span></div></button>';
  }).join('');
  return '<div class="stack"><div class="spread"><h1 class="h1">Tables</h1><span class="muted small">' + ts.length + ' table' + (ts.length === 1 ? '' : 's') + ' · ' + P.all.length + ' slabs</span></div>' +
    (cards || '<div class="empty">No tables yet. Record your first table on Scan.</div>') + '<button class="btn primary" data-a="tab" data-v="scan">Scan a new table</button></div>';
}
function tableHtml() {
  const P = plan(), T = tableOf(UI.openTable); if (!T) { UI.openTable = null; return tablesHtml(); }
  const os = P.all.filter(o => o.sl.t === T.id).slice(), k = UI.sort;
  os.sort(k === 'price' ? (a, b) => (b.x.std || 0) - (a.x.std || 0) : k === 'scan' ? (a, b) => a.sl.at - b.sl.at
    : (a, b) => (!!P.picks[b.sl.id] - !!P.picks[a.sl.id]) || ((b.sl.st !== 'declined') - (a.sl.st !== 'declined')) || ((b.x.chance || -1) - (a.x.chance || -1)));
  const here = os.filter(o => P.picks[o.sl.id]);
  return '<div class="stack"><button class="back" data-a="back">' + ICON.back + 'Tables</button>' +
    '<div class="spread"><h1 class="h1">Table ' + T.n + '</h1><span class="muted small">' + hhmm(T.at) + '</span></div>' +
    '<label class="field"><span class="label">Vendor or booth</span><input class="input" type="text" placeholder="Optional" value="' + esc(T.vendor) + '" data-in="tableVendor"></label>' +
    '<div class="stats"><span class="stat"><b>' + os.length + '</b> slabs</span><span class="stat"><b>' + here.length + '</b> in your buys</span><span class="stat"><b>' + money(here.reduce((a, o) => a + o.x.pay, 0)) + '</b> to spend here</span></div>' +
    '<div class="seg" role="group" aria-label="Sort">' + [['best', 'Best first'], ['price', 'Price'], ['scan', 'As scanned']].map(p => '<button class="' + (k === p[0] ? 'on' : '') + '" data-a="sort" data-v="' + p[0] + '">' + p[1] + '</button>').join('') + '</div>' +
    os.map(o => rowHtml(o, P, false)).join('') +
    '<button class="btn" data-a="scanmore">Scan more at this table</button>' +
    '<div class="card stack" style="gap:8px"><span class="label">Add a slab by its cert number</span><div style="display:flex;gap:8px"><input class="input" inputmode="numeric" placeholder="PSA 8-9 digits, CGC 10" value="' + esc(UI.addCert) + '" data-in="addCert"><button class="btn" data-a="addcert">Add</button></div></div></div>';
}
function planHtml() {
  const P = plan(), s = S.settings, total = P.chosen.reduce((a, o) => a + o.x.pay, 0);
  const groups = tablesSorted().map(t => {
    const rows = P.chosen.filter(o => o.sl.t === t.id).sort((a, b) => b.x.chance - a.x.chance);
    if (!rows.length) return '';
    return '<div class="group"><div class="ghead"><span class="h2">Table ' + t.n + (t.vendor ? ' · ' + esc(t.vendor) : '') + '</span><span class="small muted">' + rows.length + ' · ' + money(rows.reduce((a, o) => a + o.x.pay, 0)) + '</span></div>' + rows.map(o => rowHtml(o, P, false)).join('') + '</div>';
  }).join('');
  const bought = P.all.filter(o => o.sl.st === 'bought'), avg = P.chosen.length ? P.chosen.reduce((a, o) => a + o.x.chance, 0) / P.chosen.length : 0;
  const net = P.chosen.reduce((a, o) => a + (o.x.net || 0), 0), toRec = bought.filter(o => !o.sl.demo && !o.sl.rec && identified(o.sl)).length;
  const nfew = Object.keys(P.few).length;
  return '<div class="stack" style="gap:14px"><h1 class="h1">Your buys</h1>' +
    '<div class="card stack" style="gap:10px"><div class="spread"><span class="label">Spend</span><span class="small muted">of ' + money(P.cap) + (P.spent ? ' · ' + money(P.spent) + ' already bought' : '') + '</span></div>' +
    '<div style="font:700 30px \'Space Grotesk\',Inter,sans-serif;font-variant-numeric:tabular-nums">' + money(total) + '</div>' +
    '<div class="progress"><span style="width:' + (P.cap > 0 ? Math.min(100, Math.round((total + P.spent) / P.cap * 100)) : 0) + '%"></span></div>' +
    '<div class="stats"><span class="stat"><b>' + P.chosen.length + '</b> slabs</span><span class="stat"><b>' + new Set(P.chosen.map(o => o.sl.t)).size + '</b> tables</span><span class="stat">expected <b>' + signed(net) + '</b></span><span class="stat">avg chance <b>' + (P.chosen.length ? pctS(avg) : '-') + '</b></span></div>' +
    '<p class="note" style="margin:0">Best chance first, each slab at the vendor’s price or at your ' + s.under.toFixed(1) + '% ask if not asked yet; at most ' + money(P.per) + ' a slab; chance at least ' + s.bar + '%, ' + s.minSales + '+ Card Ladder sales last month, ' + s.hold + '-month hold.</p></div>' +
    (P.gated && P.blocked.length ? '<div class="warnbox"><b>The graded market is falling</b> and “Buy only when the market is rising” is on (Show tab), so ' + P.blocked.length + ' real slab' + (P.blocked.length > 1 ? 's that clear' : ' that clears') + ' your bar ' + (P.blocked.length > 1 ? 'are' : 'is') + ' left out - as on the website.</div>' : '') +
    (groups || '<div class="empty">Nothing clears your bar yet. Scan a table, or lower the chance bar or the min sales on Show.</div>') +
    '<div class="card stack" style="gap:10px"><span class="label">Record purchases</span><p class="note" style="margin:0">Sends the slabs you marked Bought to the website, History › Recorded Purchases - with what you paid, your settings and the odds of the day.</p>' +
    '<button class="btn green" data-a="record"' + (UI.sending ? ' disabled' : '') + '>Record purchases' + (toRec ? ' (' + toRec + ')' : '') + '</button>' +
    (UI.recMsg ? '<div class="' + (UI.recMsg[0] === 'ok' ? 'okbox' : UI.recMsg[0] === 'warn' ? 'warnbox' : 'note') + '">' + esc(UI.recMsg[1]) + '</div>' : '') + '</div>' +
    (bought.length ? '<div class="group"><div class="ghead"><span class="h2">Bought</span><span class="small muted">' + bought.length + ' · ' + money(P.spent) + '</span></div>' + bought.map(o => rowHtml(o, P, true)).join('') + '</div>' : '') +
    (P.missed.length ? '<div class="group"><div class="ghead"><span class="h2">Just missed</span><span class="small muted">over budget or per-slab cap</span></div>' + P.missed.slice(0, 4).map(o => rowHtml(o, P, true)).join('') + '</div>' : '') +
    (nfew ? '<p class="note">' + nfew + ' slab' + (nfew > 1 ? 's have' : ' has') + ' fewer than ' + s.minSales + ' Card Ladder sales last month and stay' + (nfew > 1 ? '' : 's') + ' out of your buys (dimmed on their table).</p>' : '') + '</div>';
}
function showHtml() {
  const s = S.settings, mini = (k, txt, lab) => '<div class="frow"><span>' + lab + '</span><span class="minis"><button class="minibtn" data-a="bump" data-k="' + k + '" data-d="-1" aria-label="Less">−</button><span class="minival">' + txt + '</span><button class="minibtn" data-a="bump" data-k="' + k + '" data-d="1" aria-label="More">+</button></span></div>';
  const tok = !!LS.get(PSA_TOKEN, ''), left = psaLeft();
  const dataLine = DSTATE === 'ok' ? 'Card data from ' + esc(D.built) + ': ' + Object.keys(D.cards).length.toLocaleString() + ' cards' + (D.fc ? ', odds of ' + esc(D.fc.month) + ', market ' + (D.fc.regime && D.fc.regime.up ? 'rising' : 'falling') : ', no odds in this build') + '.'
    : DSTATE === 'loading' ? 'Loading the card data…' : DSTATE === 'err' ? 'Could not load the card data: ' + esc(DERR) : 'Locked: sample show only.';
  return '<div class="stack" style="gap:6px"><h1 class="h1" style="margin-bottom:8px">Show</h1>' +
    '<label class="field"><span class="label">Show name</span><input class="input" type="text" value="' + esc(s.show) + '" data-in="set:show"></label>' +
    '<div class="frow" style="margin-top:8px"><span>Capital</span><input class="input" style="width:140px;text-align:right" type="text" inputmode="decimal" value="' + esc(s.capital) + '" data-in="set:capital" aria-label="Capital"></div>' +
    '<div class="field" style="padding:12px 0;border-bottom:1px solid #222A35"><span>Hold before selling</span><div class="seg" role="group" aria-label="Hold in months">' +
    [1, 2, 3, 4, 5, 6].map(h => '<button class="' + (s.hold === h ? 'on' : '') + '" data-a="hold" data-v="' + h + '">' + h + ' mo</button>').join('') + '</div></div>' +
    mini('under', s.under.toFixed(1) + '%', 'Your ask (% under)') + mini('bar', s.bar + '%', 'Buy only at a chance of at least') + mini('share', s.share + '%', 'At most per slab') +
    mini('minSales', String(s.minSales), 'Min sales last mo (Card Ladder)') +
    '<div class="frow"><span>eBay shipping</span><input class="input" style="width:110px;text-align:right" type="text" inputmode="decimal" value="' + esc(s.ship) + '" data-in="set:ship" aria-label="eBay shipping"></div>' +
    '<div class="frow"><span>Buy only when the market is rising</span><button class="btn" style="min-width:76px" data-a="gate">' + (s.gate ? 'On' : 'Off') + '</button></div>' +
    '<div class="frow"><span>Beep for each new slab read</span><button class="btn" style="min-width:76px" data-a="beep">' + (s.beep ? 'On' : 'Off') + '</button></div>' +
    '<p class="note">Chance = how often slabs like it made money over your hold, bought at that % under, after eBay’s fee (14.11%) and shipping - the website’s Recording math. The plan spends best chance first, up to your capital. Min sales last mo keeps slabs that sold fewer times on Card Ladder last month out of your buys.</p>' +
    '<h2 class="h2" style="margin-top:14px">Card data and lookups</h2>' +
    '<div class="' + (DSTATE === 'ok' ? 'okbox' : DSTATE === 'err' ? 'warnbox' : 'note') + '">' + dataLine + '</div>' +
    (DSTATE === 'ok' ? '<button class="btn" data-a="reload">Refresh the card data</button>' : '<button class="btn primary" data-a="unlock">Unlock with your site password</button>') +
    '<label class="field" style="margin-top:10px"><span class="label">PSA API token ' + (tok ? '· saved on this phone · ' + left + ' of ' + PSA_MAX + ' lookups left today' : '· not set') + '</span>' +
    '<div style="display:flex;gap:8px"><input class="input" type="password" autocomplete="off" placeholder="' + (tok ? 'Saved - paste a new one to replace it' : 'Paste the token from psacard.com/publicapi') + '" data-in="psaTok"><button class="btn" data-a="savetok">Save</button></div></label>' +
    (tok ? '<button class="linkbtn" style="align-self:flex-start" data-a="deltok">Remove the PSA token from this phone</button>' : '') +
    '<p class="note">CGC slabs: found by name for now (Card Hedge comes next, through your collector).</p>' +
    '<div class="note" id="scans-line" style="font-size:13px">' + scansLine() + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px"><button class="btn" data-a="demo">Load the sample show (3 tables)</button>' +
    '<button class="btn danger" data-a="newshow">' + (UI.confirmNew ? 'Tap again to clear every table' : 'Start a new show') + '</button>' +
    (DSTATE === 'ok' ? '<button class="linkbtn" style="align-self:flex-start" data-a="lock">Lock: forget the password on this phone</button>' : '') + '</div>' +
    '<p class="note" style="margin-top:10px">Your tables, asks and prices stay on this phone. What leaves it: each real slab’s cert link (to scans.csv), Record purchases and Review answers. Sample slabs and Test mode are never sent. Sample slabs have invented prices.</p></div>';
}

/* ---- the slab panel, Review and Find the card ---- */
function renderSheet() {
  const sl = UI.sheet ? S.slabs[UI.sheet] : null, box = $('sheet');
  if (!sl) { box.innerHTML = ''; return; }
  const x = calc(sl), t = tableOf(sl.t) || {};
  const head = '<div class="grab"></div><div class="shead">' + badge(x) +
    '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><span style="font:600 18px \'Space Grotesk\',Inter,sans-serif">' + esc(x.name) + '</span>' +
    '<span class="rsub">' + esc(x.sub) + (x.gk ? ' · ' + esc(gkLabel(x.gk)) : '') + '</span><span class="rsub">Table ' + (t.n || '?') + (t.vendor ? ' · ' + esc(t.vendor) : '') + ' · read ' + hhmm(sl.at) + ' · ' + esc((sl.grader || x.grader || '').toUpperCase() + ' ' + sl.cert) + '</span></div>' +
    '<button class="xbtn" data-a="close" aria-label="Close">' + ICON.x + '</button></div>';
  const body = UI.view === 'review' ? reviewHtml(sl, x) : UI.view === 'search' ? searchHtml(sl, x) : slabHtml(sl, x);
  box.innerHTML = '<div class="sheetwrap" data-a="closebg"><div class="sheet" role="dialog" aria-label="Slab">' + head + '<div class="sbody" id="sbody">' + body + '</div></div></div>';
}
function kpisHtml(x) {
  return '<div class="kpi"><div class="label">CL price</div><div class="v">' + money(x.std) + '</div><div class="s">' + (x.std == null ? 'no Card Ladder price' : (x.n || '?') + ' sales, ' + (x.win || '30 days')) + '</div></div>' +
    '<div class="kpi"><div class="label">Chance</div><div class="v" style="color:' + (x.chance == null ? 'var(--mu)' : x.chance >= 0.6 ? 'var(--grt)' : x.chance >= S.settings.bar / 100 ? 'var(--blt)' : 'var(--mu)') + '">' + (x.chance == null ? '-' : pctS(x.chance)) + '</div><div class="s">' + S.settings.hold + '-month hold</div></div>' +
    '<div class="kpi"><div class="label">You pay</div><div class="v">' + money(x.pay) + '</div><div class="s">' + (x.std == null ? '' : (x.d * 100).toFixed(1) + '% under') + '</div></div>';
}
function resultHtml(x) {
  return '<div><div class="k">You pay</div><div class="v">' + money(x.pay) + '</div></div><div><div class="k">Chance of profit</div><div class="v">' + (x.chance == null ? '-' : pctS(x.chance)) + '</div></div>' +
    '<div><div class="k">Expected net</div><div class="v">' + signed(x.net) + '</div></div><div><div class="k">ROI over the hold</div><div class="v">' + (x.roi == null ? '-' : pctS(x.roi, 1)) + '</div></div>';
}
function planLine(sl, x) {
  const P = plan(), s = S.settings;
  if (sl.st === 'bought') return sl.rec ? 'Bought and recorded on the website' : 'Bought - counted against your capital';
  if (sl.st === 'declined') return 'No deal - left out of your buys';
  if (!sl.demo && sl.look === 'check') return 'Check it’s the right card (Review) before it can go in your buys';
  if (x.std == null) return 'No Card Ladder price - not in your buys';
  if (P.picks[sl.id]) return 'In your buys';
  if (P.few[sl.id]) return 'Only ' + (x.sold || 0) + ' Card Ladder sale' + (x.sold === 1 ? '' : 's') + ' last month (your min is ' + s.minSales + ')';
  if (x.chance != null && x.chance < s.bar / 100) return 'Below your ' + s.bar + '% bar';
  if (P.gated && !sl.demo) return 'Left out: the market is falling and the gate is on';
  return 'Not in your buys (budget or per-slab cap)';
}
function chipsHtml(x) {
  const cur = Math.round(x.d * 1000) / 10, s = S.settings;
  return [10, 11, 12, 13, 14, 15, 18, 20].map(p => '<button class="chipbtn' + (Math.abs(cur - p) < 0.05 ? ' on' : '') + (Math.abs(s.under - p) < 0.05 ? ' mine' : '') + '" data-a="pct" data-v="' + p + '">' + p + '%</button>').join('');
}
function slabHtml(sl, x) {
  const mode = sl.mode || 'pct', cur = Math.round(x.d * 1000) / 10, gap = x.clv && x.std ? x.clv / x.std - 1 : 0;
  let idbox = '';
  if (!sl.demo && sl.look !== 'ok') {
    if (sl.look === 'queued' || sl.look === 'looking') idbox = '<div class="note">Looking this slab up with PSA…</div>';
    else if (sl.look === 'check') idbox = '<div class="warnbox">' + (sl.how === 'spec' ? 'PSA’s spec fits ' + (sl.cands || []).length + ' catalog cards; this is the first.' : 'Best guess from PSA’s label (card number and name) - not a spec match.') + ' Open Review to confirm it or pick the right one.</div>';
    else idbox = '<div class="warnbox">' + esc(WHY[sl.lookWhy] || 'Not identified yet.') + '</div><button class="btn primary" data-a="search">Find the card</button>';
  }
  const status = [['asked', 'Asked'], ['declined', 'No deal'], ['agreed', 'Agreed'], ['bought', 'Bought']].map(q => '<button class="' + (sl.st === q[0] ? 's-' + q[0] : '') + '" data-a="st" data-v="' + q[0] + '">' + q[1] + '</button>').join('');
  return idbox + '<div class="kpis" id="sh-kpis">' + kpisHtml(x) + '</div>' +
    (x.std == null ? '' : '<div class="card stack" style="gap:12px"><div class="spread" style="align-items:center"><span class="label">The vendor’s price</span><div class="seg" style="width:150px" role="group" aria-label="Price as">' +
      '<button class="' + (mode === 'pct' ? 'on' : '') + '" data-a="mode" data-v="pct">% under</button><button class="' + (mode === 'usd' ? 'on' : '') + '" data-a="mode" data-v="usd">$ price</button></div></div>' +
      (mode === 'pct' ? '<div class="stepper"><button class="stepbtn" data-a="pctstep" data-d="-0.5" aria-label="Half a percent less">−</button><div class="stepval"><div class="pctwrap"><input class="pctin" type="text" inputmode="decimal" value="' + cur.toFixed(1) + '" data-in="pct" data-ch="pct" aria-label="Percent under the Card Ladder price"><span class="pctsign">%</span></div><div class="small muted">under CL price · tap to type</div></div><button class="stepbtn" data-a="pctstep" data-d="0.5" aria-label="Half a percent more">+</button></div>' +
        '<div class="chips" id="sh-chips">' + chipsHtml(x) + '</div>'
        : '<label class="field"><span class="small muted">What the vendor will take</span><input class="input" style="height:56px;font:700 26px \'Space Grotesk\',Inter,sans-serif" type="text" inputmode="decimal" placeholder="' + esc(money(x.std * (1 - S.settings.under / 100) - numSet('ship'))) + '" value="' + esc(sl.vpTxt != null ? sl.vpTxt : sl.vp != null ? sl.vp : '') + '" data-in="usd"></label>') +
      '<div class="result" id="sh-result">' + resultHtml(x) + '</div><div class="status" role="group" aria-label="Status">' + status + '</div>' +
      '<div class="spread" style="align-items:center"><span class="small muted" id="sh-plan">' + esc(planLine(sl, x)) + '</span>' + (x.hasVendor ? '<button class="linkbtn" data-a="resetask">Back to my ask</button>' : '') + '</div></div>') +
    '<div class="card"><div class="label" style="margin-bottom:4px">Prices</div>' +
    '<div class="kv"><span class="k">Card Ladder price</span><span class="v">' + money(x.std) + (x.std != null ? ' <span class="muted small">(' + (x.n || '?') + ' sales, ' + esc(x.win || '30 days') + ')</span>' : '') + '</span></div>' +
    '<div class="kv"><span class="k">Card Ladder value</span><span class="v">' + money(x.clv) + (x.conf ? ' (confidence ' + x.conf + '/5)' : '') + (Math.abs(gap) >= 0.25 ? '<span class="flag">≠ CLV</span>' : '') + '</span></div>' +
    '<div class="kv"><span class="k">PriceCharting (reference)</span><span class="v">' + money(x.pc) + '</span></div>' +
    '<div class="kv"><span class="k">Sold last month</span><span class="v">CL ' + (x.sold == null ? '-' : x.sold) + ' · PC ' + (x.soldPC == null ? '-' : x.soldPC) + '</span></div>' +
    (x.n12 != null ? '<div class="kv"><span class="k">Card Ladder sales a year</span><span class="v">' + x.n12 + '</span></div>' : '') + '</div>' +
    (identified(sl) || sl.demo ? '<button class="btn" data-a="review">Review: is it the right card?' + (!sl.demo && sl.look === 'check' ? ' <span class="tag t-check">Check it</span>' : '') + '</button>' : '') +
    '<div class="card stack" style="gap:6px"><span class="label">Rank</span><span style="font-weight:600">' + (x.pct == null ? 'Not ranked' : ord(Math.round(x.pct * 100)) + ' percentile · group ' + Math.min(10, Math.floor(x.pct * 10) + 1) + ' of 10') + '</span>' +
    '<span class="small muted">' + (x.pct == null ? 'Card Ladder has too few sales of this grade (or a price under $25) to rank it.' : x.pct >= 0.5 ? 'Its price sits below its own 12-month level - the deeper, the higher the percentile.' : 'Its price sits near or above its own 12-month level.') + '</span></div>' +
    '<button class="linkbtn" style="color:var(--rdt);align-self:flex-start" data-a="remove">Remove this slab from the table</button>';
}
function reviewHtml(sl, x) {
  const back = '<button class="back" data-a="view" data-v="slab">' + ICON.back + 'Slab</button>';
  if (sl.demo) {
    const c = POOL[sl.c];
    return back + '<div class="sides">' + sideHtml('PriceCharting', null, [c.name + ' #' + c.num, c.set, 'Price ' + money(c.pc) + ' · sold ' + c.soldPC + ' last month']) +
      sideHtml('Card Ladder', null, [c.name + ' · ' + c.set + ' #' + c.num, 'Price ' + money(c.std) + ' · sold ' + c.sold + ' last month']) +
      sideHtml('Slab (' + c.grader + ')', null, [c.grader + ' ' + sl.cert, gkLabel(x.gk)]) + '</div>' +
      '<div class="' + (c.match === 'ok' ? 'okbox' : 'warnbox') + '">' + (c.match === 'ok' ? 'Same card (sample)' : 'Check it - the names differ slightly (sample)') + '</div><p class="note">Sample slab: invented data.</p>';
  }
  const c = x.card || [], a = sl.auth || {}, mark = S.marks[sl.cid] !== undefined ? S.marks[sl.cid] : c[9];
  const num = c[2] ? numNorm(c[2]) : '', anum = a.num ? numNorm(a.num) : '';
  let h = back;
  if (sl.look === 'check') {
    h += '<div class="warnbox">' + (sl.how === 'spec' ? 'PSA’s spec fits more than one catalog card.' : 'This card is a best guess from PSA’s label (number and name), not a spec match.') + ' Is the slab this card?</div>' +
      '<div class="ans"><button class="btn green" data-a="confirm">Yes, this card</button><button class="btn" data-a="search">No - find it</button></div>';
    if ((sl.cands || []).length > 1) h += '<div class="results">' + sl.cands.filter(cid => cid !== sl.cid).map(cid => { const k = D.cards[String(cid)] || []; return '<button class="res" data-a="pickcid" data-v="' + cid + '"><b>' + esc(k[0]) + '</b><span class="small muted">' + esc(k[1]) + (k[2] ? ' #' + esc(k[2]) : '') + '</span></button>'; }).join('') + '</div>';
  } else if (sl.how) h += '<div class="okbox">' + (sl.how === 'spec' ? 'Identified by PSA: cert ' + esc(sl.cert) + ' → PSA spec ' + esc(a.spec) + ' → this card.' : sl.how === 'manual' ? 'You picked this card.' : 'You confirmed this card.') + '</div>';
  h += '<div class="sides">' +
    sideHtml('PriceCharting', null, [c[0], c[1] + (c[2] ? ' #' + c[2] : ''), 'Price ' + money(x.pc) + ' · sold ' + (x.soldPC == null ? '-' : x.soldPC) + ' last month'], anum && num && anum !== num ? 1 : -1) +
    sideHtml('Card Ladder', c[7] || null, [c[6] || (c[8] === 'read' ? '(no label)' : c[8] === 'pending' ? 'Not read by the Card Ladder run yet' : 'No Card Ladder card'), 'Price ' + money(x.std) + ' · sold ' + (x.sold == null ? '-' : x.sold) + ' last month', 'Value ' + money(x.clv)]) +
    (a.src ? sideHtml('PSA (the slab)', null, [[a.year, titleCase(a.brand)].filter(Boolean).join(' '), titleCase(a.subject) + (a.num ? ' #' + a.num : '') + (a.variety ? ' · ' + titleCase(a.variety) : ''), (a.grade || '') + (a.pop != null ? ' · pop ' + a.pop + (a.popHi != null ? ', ' + a.popHi + ' higher' : '') : '')], anum && num && anum !== num ? 1 : -1)
      : sideHtml('Slab', null, [(sl.grader || '').toUpperCase() + ' ' + sl.cert, gkLabel(sl.gk)])) + '</div>';
  if (c[5]) h += '<span class="label">Card Ladder’s card = PriceCharting’s card?</span><div class="ans"><button class="btn same' + (mark === 1 ? ' on' : '') + '" data-a="mark" data-v="1">Same card</button><button class="btn notsame' + (mark === 0 ? ' on' : '') + '" data-a="mark" data-v="0">Not the same card</button></div>' +
    '<p class="note">Answers go to the website’s Review, the same as answering it there.</p>';
  h += '<button class="linkbtn" style="align-self:flex-start" data-a="search">Wrong card? Find the right one</button>';
  return h;
}
function sideHtml(title, img, lines, diffLine) {
  return '<div class="side">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '<div class="sb"><span class="st">' + esc(title) + '</span>' +
    lines.filter(v => v != null && v !== '').map((v, i) => '<span' + (i === diffLine ? ' class="diff"' : '') + '>' + esc(v) + '</span>').join('') + '</div></div>';
}
function searchHtml(sl, x) {
  const back = '<button class="back" data-a="view" data-v="slab">' + ICON.back + 'Slab</button>';
  if (!IDX) return back + '<div class="warnbox">Unlock the app on the Show tab to search your catalog.</div>';
  const gk = UI.pickGk || sl.gk, gr = (sl.grader || 'psa').toLowerCase();
  const grades = D.gk.filter(k => k.startsWith(gr + '|'));
  return back + '<label class="field"><span class="label">Card name, set or number</span><input class="input" type="search" autocomplete="off" placeholder="e.g. umbreon vmax 215" value="' + esc(UI.q) + '" data-in="q" id="q"></label>' +
    '<span class="label">Grade · swipe for more</span><div class="gradepick">' + grades.map(k => '<button class="' + (k === gk ? 'on' : '') + '" data-a="pickgk" data-v="' + k + '">' + esc(gkLabel(k)) + '</button>').join('') + '</div>' +
    '<div class="results" id="results">' + resultsHtml(UI.q, gk) + '</div>';
}
function resultsHtml(q, gk) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return '<p class="note">Type part of the name - e.g. “umbreon 215”.</p>';
  const out = [];
  for (const c of IDX.list) {
    if (!words.every(w => c.hay.includes(' ' + w) || c.num === numNorm(w))) continue;
    out.push(c.cid); if (out.length >= 40) break;
  }
  if (!out.length) return '<p class="note">No card in your catalog matches. Only cards worth $50+ are in it.</p>';
  return out.map(cid => { const k = D.cards[String(cid)], r = gk ? IDX.row.get(cid + '|' + gk) : null;
    return '<button class="res" data-a="pickcid" data-v="' + cid + '"><b>' + esc(k[0]) + '</b><span class="small muted">' + esc(k[1]) + (k[2] ? ' #' + esc(k[2]) : '') + (r && r[2] != null ? ' · CL ' + money(r[2]) : r ? ' · no CL price' : gk ? ' · no ' + esc(gkLabel(gk)) + ' prices' : '') + '</span></button>'; }).join('');
}
function renderOverlay() {
  const box = $('overlay');
  if (!UI.unlock) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="unlock"><h1 class="h1">Slab Show Scanner</h1><p class="muted">Unlock with your site password to price real slabs. It is kept on this phone, so you type it once.</p>' +
    '<input class="input" type="password" id="pw" autocomplete="current-password" placeholder="Site password">' +
    (DERR ? '<div class="warnbox">' + esc(DERR) + '</div>' : '') +
    '<button class="btn primary" data-a="dounlock" id="unlock-btn">' + (UI.unlocking ? 'Unlocking…' : 'Unlock') + '</button>' +
    '<button class="linkbtn" data-a="skipunlock">Just look at the sample show</button></div>';
}

/* ---------------- what a tap does ---------------- */
function setSlab(id, fn) { const sl = S.slabs[id]; if (!sl) return; fn(sl); save(); render(); }
function setPct(sl, v) { sl.vd = Math.max(0, Math.min(60, Math.round(v * 10) / 10)); sl.vp = null; sl.vpTxt = null; if (sl.st === 'new') sl.st = 'asked'; }
function paintSheetNumbers() {                // while typing: the numbers only, never the box being typed in
  const sl = S.slabs[UI.sheet]; if (!sl) return;
  const x = calc(sl);
  if ($('sh-kpis')) $('sh-kpis').innerHTML = kpisHtml(x);
  if ($('sh-result')) $('sh-result').innerHTML = resultHtml(x);
  if ($('sh-chips')) $('sh-chips').innerHTML = chipsHtml(x);
  if ($('sh-plan')) $('sh-plan').textContent = planLine(sl, x);
  renderTop(); renderTabs();
}
async function act(a, ds, el) {
  const sl = UI.sheet ? S.slabs[UI.sheet] : null, s = S.settings;
  switch (a) {
    case 'tab': if ((UI.rec || VREAD.on) && ds.v !== 'scan') return toast(VREAD.on ? 'Stop reading the video first.' : 'Stop recording first.'); UI.tab = ds.v; UI.openTable = null; break;
    case 'rec': if (VREAD.on) { VREAD.stop = true; return; } if (UI.rec) return stopRec(); return startRec(null);
    case 'test': if (UI.rec || VREAD.on) return; UI.test = !UI.test; UI.scanMsg = null; UI.camErr = null; break;
    case 'testclear': testClear(); TEST.zip = null; TEST.zipSeq++; UI.reportText = null; return paintScan();
    case 'testsave': return saveTestData();
    case 'testsaveparts': return saveTestData(true);
    case 'teststep': testStep(+ds.v || 0); return paintScan();
    case 'testcopy': return copyReport();
    case 'lens': return setLens(ds.v);
    case 'light': return setTorch(!SCAN.torch);
    case 'beep': s.beep = !s.beep; save(); if (s.beep) { audioOn(); beep(); } break;
    case 'table': UI.openTable = ds.id; break;
    case 'back': UI.openTable = null; break;
    case 'sort': UI.sort = ds.v; break;
    case 'scanmore': UI.test = false; return startRec(UI.openTable);
    case 'addcert': {
      const v = String(UI.addCert || '').replace(/\D/g, ''), k = certOf(v, 'Code128');
      if (!k) return toast('A PSA cert is 8-9 digits, a CGC cert 10 (or 13 starting 1401).');
      UI.addCert = ''; addScan(k[0], k[1], {table: UI.openTable}); return;
    }
    case 'open': UI.sheet = ds.id; UI.view = 'slab'; UI.q = ''; UI.pickGk = null; break;
    case 'close': UI.sheet = null; break;
    case 'closebg': if (el && el.classList && el.classList.contains('sheetwrap')) UI.sheet = null; else return; break;
    case 'view': UI.view = ds.v; break;
    case 'mode': if (sl) { sl.mode = ds.v; save(); } break;
    case 'pctstep': if (sl) { setPct(sl, Math.round(calc(sl).d * 1000) / 10 + parseFloat(ds.d)); save(); } break;
    case 'pct': if (sl) { setPct(sl, parseFloat(ds.v)); save(); } break;
    case 'resetask': if (sl) { sl.vd = null; sl.vp = null; sl.vpTxt = null; save(); } break;
    case 'st': if (sl) { sl.st = sl.st === ds.v ? 'new' : ds.v; save(); } break;
    case 'remove': if (sl) { delete S.slabs[sl.id]; UI.sheet = null; save(); } break;
    case 'review': UI.view = 'review'; break;
    case 'search': UI.view = 'search'; UI.q = UI.q || (sl && sl.auth ? norm(sl.auth.subject + ' ' + sl.auth.num) : ''); UI.pickGk = sl ? sl.gk : null; break;
    case 'pickgk': UI.pickGk = ds.v; break;
    case 'pickcid': if (sl) { sl.cid = +ds.v; sl.gk = UI.pickGk || sl.gk; sl.look = sl.gk ? 'ok' : 'manual'; sl.how = 'manual'; sl.lookWhy = sl.gk ? null : 'nf'; sl.cands = null; UI.view = sl.gk ? 'slab' : 'search'; save(); if (!sl.gk) toast('Pick the grade too.'); } break;
    case 'confirm': if (sl) { sl.look = 'ok'; sl.how = 'confirmed'; save(); UI.view = 'slab'; } break;
    case 'mark': if (sl && sl.cid != null) return sendMark(sl.cid, +ds.v); return;
    case 'record': return recordPurchases();
    case 'hold': s.hold = +ds.v; save(); break;
    case 'gate': s.gate = !s.gate; save(); break;
    case 'bump': {
      const k = ds.k, d = +ds.d, step = {under: 0.5, bar: 5, share: 5, minSales: 1}[k], lim = {under: [0, 60], bar: [5, 95], share: [5, 100], minSales: [0, 50]}[k];
      s[k] = Math.max(lim[0], Math.min(lim[1], Math.round((+s[k] + d * step) * 10) / 10)); save(); break;
    }
    case 'savetok': { const v = (document.querySelector('[data-in="psaTok"]') || {}).value || ''; if (!v.trim()) return toast('Paste the token first.'); LS.set(PSA_TOKEN, v.trim()); const d = psaDay(); d.stop = 0; LS.set(PSA_DAY, d);
      slabsArr().forEach(x => { if (!x.demo && x.look === 'manual' && ['token', 'badtoken'].includes(x.lookWhy)) x.look = 'queued'; }); pumpLookups(); toast('PSA token saved on this phone.'); break; }
    case 'deltok': LS.del(PSA_TOKEN); toast('PSA token removed.'); break;
    case 'reload': if (KEY) { loadData(KEY); return; } break;
    case 'unlock': UI.unlock = true; DERR = ''; break;
    case 'skipunlock': UI.unlock = false; LS.set('ssc-seen', 1); break;
    case 'dounlock': {
      const pw = ($('pw') || {}).value || ''; if (!pw) return;
      UI.unlocking = true; renderOverlay();
      const k = await deriveKey(pw), ok = await loadData(k);
      UI.unlocking = false; if (ok) { UI.unlock = false; LS.set('ssc-seen', 1); toast('Unlocked - real slabs are priced now.'); }
      break;
    }
    case 'lock': KEY = null; D = null; IDX = null; DSTATE = 'locked'; LS.del(KEY_STORE); toast('Locked. Your scans stay on this phone.'); break;
    case 'demo': { if (UI.rec) stopRec(); const d = demoState(); d.settings = S.settings; d.marks = S.marks; Object.values(S.slabs).filter(x => !x.demo).forEach(x => { d.slabs[x.id] = x; });
      S.tables.filter(t => !t.id.startsWith('d')).forEach(t => { t.n += 3; d.tables.push(t); }); S = d; save(); UI.tab = 'tables'; UI.openTable = null; break; }
    case 'newshow':
      if (!UI.confirmNew) { UI.confirmNew = true; setTimeout(() => { UI.confirmNew = false; if (UI.tab === 'show') render(); }, 4000); break; }
      { const b = baseState(); b.settings = S.settings; b.marks = S.marks; S = b; save(); UI.confirmNew = false; UI.recMsg = null; break; }
    default: return;
  }
  render();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a === 'closebg' && e.target !== b) return;    // a tap inside the panel is not a tap on the backdrop
  act(b.dataset.a, b.dataset, e.target);
});
document.addEventListener('input', e => {
  const el = e.target, k = el.dataset && el.dataset.in; if (!k) return;
  const sl = UI.sheet ? S.slabs[UI.sheet] : null, v = el.value;
  if (k === 'draftVendor') UI.draftVendor = v;
  else if (k === 'tableVendor') { const t = tableOf(UI.openTable); if (t) { t.vendor = v; save(); } }
  else if (k === 'addCert') UI.addCert = v;
  else if (k === 'psaTok') { /* read on Save */ }
  else if (k === 'q') { UI.q = v; const r = $('results'); if (r) r.innerHTML = resultsHtml(v, UI.pickGk || (sl && sl.gk)); }
  else if (k.startsWith('set:')) { const f = k.slice(4); S.settings[f] = f === 'show' ? v : v; save(); renderTop(); renderTabs(); }
  else if (k === 'pct' && sl) { const n = parseFloat(v.replace(',', '.')); if (isFinite(n)) { sl.vd = Math.max(0, Math.min(60, n)); sl.vp = null; sl.vpTxt = null; if (sl.st === 'new') sl.st = 'asked'; save(); paintSheetNumbers(); } }
  else if (k === 'usd' && sl) { const n = parseFloat(v.replace(/[$,\s]/g, '')); sl.vpTxt = v; sl.vp = isFinite(n) && n > 0 ? n : null; if (sl.vp != null) { sl.vd = null; if (sl.st === 'new') sl.st = 'asked'; } save(); paintSheetNumbers(); }
});
// leaving a box: tidy what it shows, but never redraw the screen under the finger (a redraw here would swallow the tap
// that moved the focus away - e.g. on Review right after typing a percent)
document.addEventListener('change', e => {
  const el = e.target;
  if (el && el.id === 'vid-in') { const f = el.files && el.files[0]; el.value = ''; if (f) readVideo(f); return; }
  const k = el.dataset && el.dataset.in; if (!k) return;
  const sl = UI.sheet ? S.slabs[UI.sheet] : null;
  if (k === 'pct' && sl) { el.value = (Math.round(calc(sl).d * 1000) / 10).toFixed(1); paintSheetNumbers(); }
  else if (k.startsWith('set:')) { renderTop(); renderTabs(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'pw') act('dounlock', {}); });
Object.defineProperty(window, 'SSC', {value: {get S() { return S; }, get D() { return D; }, calc, plan, certOf, addScan, numSet, detailOf, readImage, TEST, SCAN, VREAD, scanLink}});

/* ---------------- start ---------------- */
if (KEY) loadData(KEY); else { DSTATE = 'locked'; if (!LS.get('ssc-seen', 0)) UI.unlock = true; }
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
scheduleScanSend(4000);                      // cert links left over from last time
window.addEventListener('online', () => scheduleScanSend(1000));
// back from the background while recording: iOS ends the camera there, so it is opened again
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && (UI.rec || VREAD.on)) wakeOn();   // iOS lets the screen lock go while the app is in the background
  if (document.hidden || !UI.rec || !SCAN.stream) return;
  if (SCAN.stream.getVideoTracks().every(t => t.readyState === 'ended')) { try { await camStart(); } catch (e) { UI.camErr = 'The camera did not come back - stop and record again.'; paintScan(); } }
});
