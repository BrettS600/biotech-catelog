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
   is found by name until the Card Hedge step. Record Purchases sends a 'gplan' to the collector, as the website's button. */
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
const DEFAULTS = {show: 'Saturday Card Show', capital: 10000, hold: 3, under: 14.1, ship: 5.2, bar: 50, share: 20, minSales: 5, gate: true};

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
  feed: [], feedN: 0, dup: null, draftVendor: '', sort: 'best', q: '', pickGk: null, confirmNew: false, sending: false, recMsg: null, addCert: '', camErr: null};
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

/* ---------------- scanning (camera frames -> zxing -> certs) ---------------- */
const VIDEO = document.createElement('video');
VIDEO.setAttribute('playsinline', ''); VIDEO.setAttribute('muted', ''); VIDEO.muted = true; VIDEO.autoplay = true;
const SCAN = {stream: null, timer: null, busy: false, canvas: document.createElement('canvas'), zx: null, sim: null, tick: null};
function zxReady() {
  if (!SCAN.zx && window.ZXingWASM) SCAN.zx = ZXingWASM.prepareZXingModule({overrides: {locateFile: (p, prefix) => p.endsWith('.wasm') ? 'zxing/' + p : prefix + p}, fireImmediately: true});
  return SCAN.zx;
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
async function camStart() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('this browser gives no camera');
  SCAN.stream = await navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}});
  VIDEO.srcObject = SCAN.stream;
  try { await VIDEO.play(); } catch (e) {}
}
function camStop() { if (SCAN.stream) SCAN.stream.getTracks().forEach(t => t.stop()); SCAN.stream = null; VIDEO.srcObject = null; }
async function scanFrame() {
  if (!UI.rec || SCAN.busy || !SCAN.stream || !VIDEO.videoWidth || !window.ZXingWASM) return;
  SCAN.busy = true;
  try {
    await zxReady();
    const w = VIDEO.videoWidth, h = VIDEO.videoHeight, k = Math.min(1, 1600 / Math.max(w, h)), cw = Math.round(w * k), ch = Math.round(h * k);
    const cv = SCAN.canvas; if (cv.width !== cw) cv.width = cw; if (cv.height !== ch) cv.height = ch;
    const ctx = cv.getContext('2d', {willReadFrequently: true}); ctx.drawImage(VIDEO, 0, 0, cw, ch);
    const res = await ZXingWASM.readBarcodes(ctx.getImageData(0, 0, cw, ch), {formats: ['QRCode', 'Code128', 'ITF', 'DataMatrix'], maxNumberOfSymbols: 16, tryHarder: true});
    for (const r of res) { if (r.isValid === false) continue; const kc = certOf(r.text, r.format); if (kc) addScan(kc[0], kc[1]); }
  } catch (e) { UI.camErr = 'Reader: ' + (e.message || e); }
  SCAN.busy = false;
}
function addScan(grader, cert, opts) {
  const tid = (opts && opts.table) || UI.recTable;
  if (!tid) return null;
  const have = slabsArr().find(sl => sl.t === tid && !sl.demo && sl.cert === cert);
  if (have) { if (UI.rec) { UI.dup = 'Already read: ' + gkLabelShort(have) + ' (counted once)'; paintScan(); } return have; }
  const sid = 's' + (S.seq++) + '-' + Date.now().toString(36);
  const sl = {id: sid, t: tid, grader, cert, at: Date.now(), look: 'queued', mode: 'pct', vd: null, vp: null, st: 'new'};
  S.slabs[sid] = sl; save();
  UI.feed = [{sid}].concat(UI.feed).slice(0, 6); UI.feedN++; UI.dup = null;
  if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) {}
  pumpLookups();
  if (UI.rec) paintScan(); else render();
  return sl;
}
const gkLabelShort = sl => { const x = calc(sl); return x.name + (x.known && x.gk ? ' · ' + gkLabel(x.gk) : ''); };
async function startRec(tableId) {
  const now = Date.now();
  let id = tableId;
  if (!id) {
    const n = S.tables.reduce((m, t) => Math.max(m, t.n), 0) + 1;
    id = 't' + now.toString(36);
    S.tables.push({id, n, vendor: UI.draftVendor || '', at: now}); save();
  }
  Object.assign(UI, {rec: true, recTable: id, recStart: now, feed: [], dup: null, tab: 'scan', openTable: null, camErr: null});
  render();
  try { zxReady(); await camStart(); SCAN.timer = setInterval(scanFrame, 220); }
  catch (e) {
    UI.camErr = 'No camera: ' + (e && e.message || e) + (DSTATE === 'ok' ? '. Type certs on the table instead.' : '. Showing sample reads instead.');
    if (DSTATE !== 'ok') simStart();
  }
  SCAN.tick = setInterval(paintScan, 1000);
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
  camStop();
  const id = UI.recTable, count = slabsArr().filter(sl => sl.t === id).length;
  if (!count) { S.tables = S.tables.filter(t => t.id !== id); save(); Object.assign(UI, {rec: false, feed: [], dup: null}); return render(); }
  Object.assign(UI, {rec: false, tab: 'tables', openTable: id, feed: [], dup: null, draftVendor: '', sort: 'best'});
  render();
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
  if (UI.tab === 'scan') { const vf = $('vf'); if (vf && !vf.contains(VIDEO)) { vf.prepend(VIDEO); if (SCAN.stream) VIDEO.play().catch(() => {}); } paintScan(); }
  renderSheet();
  renderOverlay();
}
function scanHtml() {
  const nextN = S.tables.reduce((m, t) => Math.max(m, t.n), 0) + 1;
  return '<div class="stack"><div class="spread"><h1 class="h1" id="scan-title">Table ' + nextN + '</h1><span class="muted small" id="scan-sub">next table</span></div>' +
    '<label class="field" id="vendor-field"' + (UI.rec ? ' hidden' : '') + '><span class="label">Vendor or booth</span><input class="input" type="text" placeholder="Optional - e.g. Booth 214" value="' + esc(UI.draftVendor) + '" data-in="draftVendor"></label>' +
    '<div class="viewfinder" id="vf"><div class="vfslabs" id="vfslabs">' + '<div class="fslab"><div class="flabel"><div class="fbar"></div></div><div class="fart"></div></div>'.repeat(8) + '</div>' +
    '<div class="corner c1"></div><div class="corner c2"></div><div class="corner c3"></div><div class="corner c4"></div>' +
    '<div id="vf-rec"></div><div class="vfhint" id="vf-hint">Point at the slabs’ barcodes and sweep slowly</div></div>' +
    '<div class="recwrap"><button class="recbtn" id="rec-btn" data-a="rec" aria-label="Start recording"><span class="core"></span></button><span class="small muted" id="rec-hint">Tap to record this table</span></div>' +
    '<div id="cam-err"></div><div class="feed" id="feed"></div>' +
    (DSTATE !== 'ok' ? '<p class="note">Sample mode: unlock on the Show tab to look real slabs up. Without a camera, sample slabs appear as if read.</p>' : '<p class="note">Each slab’s barcode or QR is read once per table; PSA slabs are looked up with PSA right away.</p>') + '</div>';
}
function paintScan() {
  if (UI.tab !== 'scan' || !$('rec-btn')) return;
  const t = UI.rec ? tableOf(UI.recTable) : null, nextN = S.tables.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  $('scan-title').textContent = 'Table ' + (t ? t.n : nextN);
  $('scan-sub').textContent = UI.rec ? (t && t.vendor ? t.vendor : 'recording') : 'next table';
  $('vendor-field').hidden = UI.rec;
  $('vf').classList.toggle('rec', UI.rec);
  $('vfslabs').hidden = !!(UI.rec && SCAN.stream);
  const secs = UI.rec ? Math.floor((Date.now() - UI.recStart) / 1000) : 0, cnt = t ? slabsArr().filter(sl => sl.t === t.id).length : 0;
  $('vf-rec').innerHTML = UI.rec ? '<div class="scanline"></div><div class="recbadge"><span class="recdot"></span>REC ' + Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2) + ' · ' + cnt + ' read</div>' : '';
  $('vf-hint').hidden = UI.rec && !!SCAN.stream;
  $('rec-btn').classList.toggle('on', UI.rec);
  $('rec-btn').setAttribute('aria-label', UI.rec ? 'Stop recording' : 'Start recording');
  $('rec-hint').textContent = UI.rec ? 'Tap to stop - the slabs go to this table' : 'Tap to record this table';
  $('cam-err').innerHTML = UI.camErr ? '<div class="warnbox">' + esc(UI.camErr) + '</div>' : '';
  const feed = UI.feed.map((f, k) => { const sl = S.slabs[f.sid]; if (!sl) return ''; const x = calc(sl);
    const right = !sl.demo && (sl.look === 'queued' || sl.look === 'looking') ? '<span class="tag t-look">Looking up</span>' : !sl.demo && sl.look === 'manual' ? '<span class="tag t-check">Find card</span>' : '<span class="' + pillCls(x) + '">' + (x.chance == null ? '-' : pctS(x.chance)) + '</span>';
    return '<div class="chip' + (k === 0 ? ' fresh' : '') + '"><span class="tick">' + ICON.check + '</span><span class="ctext"><b>' + esc(x.name) + '</b>' + (x.known && x.gk ? ' · ' + esc(gkLabel(x.gk)) : '') + '</span>' + right + '</div>'; }).join('');
  $('feed').innerHTML = UI.rec ? (UI.dup ? '<div class="dup">' + esc(UI.dup) + '</div>' : '') + feed : '';
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
    '<p class="note">Chance = how often slabs like it made money over your hold, bought at that % under, after eBay’s fee (14.11%) and shipping - the website’s Recording math. The plan spends best chance first, up to your capital. Min sales last mo keeps slabs that sold fewer times on Card Ladder last month out of your buys.</p>' +
    '<h2 class="h2" style="margin-top:14px">Card data and lookups</h2>' +
    '<div class="' + (DSTATE === 'ok' ? 'okbox' : DSTATE === 'err' ? 'warnbox' : 'note') + '">' + dataLine + '</div>' +
    (DSTATE === 'ok' ? '<button class="btn" data-a="reload">Refresh the card data</button>' : '<button class="btn primary" data-a="unlock">Unlock with your site password</button>') +
    '<label class="field" style="margin-top:10px"><span class="label">PSA API token ' + (tok ? '· saved on this phone · ' + left + ' of ' + PSA_MAX + ' lookups left today' : '· not set') + '</span>' +
    '<div style="display:flex;gap:8px"><input class="input" type="password" autocomplete="off" placeholder="' + (tok ? 'Saved - paste a new one to replace it' : 'Paste the token from psacard.com/publicapi') + '" data-in="psaTok"><button class="btn" data-a="savetok">Save</button></div></label>' +
    (tok ? '<button class="linkbtn" style="align-self:flex-start" data-a="deltok">Remove the PSA token from this phone</button>' : '') +
    '<p class="note">CGC slabs: found by name for now (Card Hedge comes next, through your collector).</p>' +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px"><button class="btn" data-a="demo">Load the sample show (3 tables)</button>' +
    '<button class="btn danger" data-a="newshow">' + (UI.confirmNew ? 'Tap again to clear every table' : 'Start a new show') + '</button>' +
    (DSTATE === 'ok' ? '<button class="linkbtn" style="align-self:flex-start" data-a="lock">Lock: forget the password on this phone</button>' : '') + '</div>' +
    '<p class="note" style="margin-top:10px">Everything you scan stays on this phone; only Record purchases and Review answers go to the website. Sample slabs have invented prices.</p></div>';
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
    case 'tab': if (UI.rec && ds.v !== 'scan') return toast('Stop recording first.'); UI.tab = ds.v; UI.openTable = null; break;
    case 'rec': if (UI.rec) return stopRec(); return startRec(null);
    case 'table': UI.openTable = ds.id; break;
    case 'back': UI.openTable = null; break;
    case 'sort': UI.sort = ds.v; break;
    case 'scanmore': return startRec(UI.openTable);
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
  const el = e.target, k = el.dataset && el.dataset.in; if (!k) return;
  const sl = UI.sheet ? S.slabs[UI.sheet] : null;
  if (k === 'pct' && sl) { el.value = (Math.round(calc(sl).d * 1000) / 10).toFixed(1); paintSheetNumbers(); }
  else if (k.startsWith('set:')) { renderTop(); renderTabs(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'pw') act('dounlock', {}); });
Object.defineProperty(window, 'SSC', {value: {get S() { return S; }, get D() { return D; }, calc, plan, certOf, addScan, numSet}});

/* ---------------- start ---------------- */
if (KEY) loadData(KEY); else { DSTATE = 'locked'; if (!LS.get('ssc-seen', 0)) UI.unlock = true; }
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
// back from the background while recording: iOS ends the camera there, so it is opened again
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !UI.rec || !SCAN.stream) return;
  if (SCAN.stream.getVideoTracks().every(t => t.readyState === 'ended')) { try { await camStart(); } catch (e) { UI.camErr = 'The camera did not come back - stop and record again.'; paintScan(); } }
});
