/* ---------------- The Forecast tab: Graded cards > Forecasting (2026-11-04, Brett) ----------------
   "i plan to go to card vendor, scan graded card links, then sell them on ebay ... lets first build graded>forcasting.
   since we are buying from vendor, we do not know which cards will be available for purchase. so we assume all cards
   are available"; "lets just use the same predictive model but on the graded cards ... its okay if its flawed because
   we will fix it later. i just want to see the listings populate".
   Every graded row of the PriceCharting tab (one per card per PSA / CGC grade) is a listing, assumed for sale. The odds
   are the raw model's method on PriceCharting's graded lines (graded_forecast.py -> graded.bin doc.fc): a row's rank is
   how far its grade's PriceCharting price sits below its own 12-month mean (ten groups), and its chance is how often
   rows of that group made money over the hold in this kind of market, 2022 on.
   ON CARD LADDER SINCE 2026-11-06 (Brett, 2026-11-05: "Moving forward card ladder will be used as the primary reference
   point"; "id rather keep PC out completely of forcast, but only as it applies to the calculations. i still want to see
   the pc price and sales in the rows"): the standard price is Card Ladder's (the Hodges-Lehmann middle of the grade's
   sales in the 30 / 60 / 90 days to the card's Card Ladder read, 3 sales - row r[79]), the model runs on Card Ladder's
   own sales of every PSA and CGC grade, and a card Card Ladder has not read (or a grade with no standard price) is not on
   Forecasting at all. PriceCharting's price and sales stay in the rows as reference (the PC lines of the two-line
   cells), never in the chance, the money, the order or the band. The row fields keep their names: fcS / fcB / fcN / fcR
   are Card Ladder's (they were PriceCharting's), fcSc is PriceCharting's price (reference), fcBc / fcNc / fcRc are gone.
   THE MONEY (Brett: "shipping is factored into buy price"; "when i go to vendor shows, i will only buy cards that are at
   least 14.1% under"): Buy price = standard price x (1 - % under) - shipping - the most to pay the vendor; the slab then
   sells at the standard price moved by the group's return, less eBay's fee (14.1%) and the shipping. So
   net = standard x ((1 + return) x (1 - fee) - (1 - % under)): the shipping comes off what you pay and goes out as the
   label, and at 14.1% under a slab whose price does not move nets $0. Standard price: PriceCharting's price of the grade
   today (else last month's), and Card Ladder's value today (else last month's average) beside it; the chance is the
   same for both, the money is each side's. Lives in its own file, stitched after graded.js.
   THE MODEL SINCE 2026-11-23 (Brett, after the graded research round of 2026-11-22: "first we make those changes"). The
   dip rank is no longer what a slab is scored or ordered by. A row's Chance is read from the market's level
   (doc.fc.level.now: green / amber / red), the line's cell (doc.fc.sig: a card under 12 months old, CGC, a Modern /
   Contemporary PSA line that passes or fails the three rules, a Vintage PSA line, a Classic / Mid Era PSA line - the
   PSA cells apart for busy and thin lines) and the hold: doc.fc.tables["hold|level|cell"], else the level's pooled
   "hold|level|all". It is shown with its range (the table's lo / hi grids: resamples of the cell's decision months) and
   never above doc.fc.cap (85%; it was 95%). Rows with the same Chance are ordered by the tie-breaker (r.fcPct, 0..1: the
   card's other grades rose more than this one + a clean month of sales), then the price. An extended line carries a
   warning. r.fcG is the cell, r.fcF the flags (graded_forecast.F_*: 1 extended, 2 still falling, 4 its segment ran,
   8 card under 12 months, 16 thin, 32 no price last month, 64 age taken from the first sale on file, 128 read from the
   month before, 256 beyond the history: its era has run further in 3 months than any era of its side did in the months
   behind the odds - such a row gets NO Chance, and says why). The gate ("Buy only when the market is green or amber")
   closes on red. raw_fc.js runs fcgTab, fcgCdf,
   fcgOrder, fcgPlaces and fcgMonteCarlo on the raw model (no level, no cap, no sig): they read it as before. */
const FCG = {rows: [], src: null, key: '', picks: [], spent: 0, mc: null, gated: false};
// every PSA and CGC grade (2026-11-05: Card Ladder scores each grade on its own; Brett will add a Card Ladder min-sales
// filter later). A browser still holding the old default (the grades PriceCharting had lines for) gets the new one.
const FCG_SEL_DEFAULT = ['psa|g10', 'psa|g9', 'psa|g8_5', 'psa|g8', 'psa|g7', 'psa|g6', 'psa|g5', 'psa|g4', 'psa|g3', 'psa|g2', 'psa|g1_5', 'psa|g1',
  'cgc|g10perfect', 'cgc|g10pristine', 'cgc|g10', 'cgc|g9_5', 'cgc|g9', 'cgc|g8_5', 'cgc|g8', 'cgc|g7_5', 'cgc|g7', 'cgc|g6_5', 'cgc|g6', 'cgc|g5_5', 'cgc|g5',
  'cgc|g4_5', 'cgc|g4', 'cgc|g3_5', 'cgc|g3', 'cgc|g2_5', 'cgc|g2', 'cgc|g1_5', 'cgc|g1'];
{ const old = ['psa|g10', 'psa|g9', 'psa|g8', 'psa|g7', 'cgc|g9_5', 'cgc|g9', 'cgc|g8', 'cgc|g7'], sv = grLS('fcg-pcg-grades', null);
  if (Array.isArray(sv) && sv.length === old.length && old.every(k => sv.includes(k))) { try { localStorage.removeItem('fcg-pcg-grades'); } catch (e) {} } }
const FCG_IN_DEFAULT = {cap: 1000, h: 3, disc: 14.1, rdisc: 14.1, ship: 5.2, pmin: 50, pmax: 5000, share: 20, minp: 50, copies: 1, gate: true, fold: false};   // rdisc: Recording's % under for new rows
// what a refresh keeps (2026-11-04, Brett: "Capital to spend" and "Hold" "should hold the modification ... even at the expense
// of a page refresh"; every other box of the pane returns to its default on a refresh). Within a visit every box stays
// shared by Forecasting, Recording, Planning and History. The fold (Hide) is not a box: it is kept too.
const FCG_KEEP = ['cap', 'h', 'fold'];
const fcgKept = () => { const sv = grLS('fcg-in', {}) || {}, o = {}; FCG_KEEP.forEach(k => { if (sv[k] !== undefined) o[k] = sv[k]; }); return o; };
const FCG_IN = Object.assign({}, FCG_IN_DEFAULT, fcgKept());
// SYNC FROM PHONE (2026-11-14, Brett: "would it be possible to change the website to have a sync from phone button and then to
// have the mobile app have a sync from website button?"; "only sync values reset, and do so by midnight"): the button copies
// the phone's Your Plan into these boxes (capital, hold, % under - Forecasting's and Recording's -, shipping, the share,
// the bar, the gate); those boxes keep the phone's values through a refresh until midnight, then go back to what they
// were. A synced box you change by hand is yours again at once. The phone's plan comes off the channel (scanPoll, at once)
// or the collector's copy (scan.bin); every change here goes the other way ({type: 'gset', src: 'web'}).
const FCG_SYNC_MAP = {capital: 'cap', hold: 'h', under: 'disc', ship: 'ship', bar: 'minp', share: 'share', gate: 'gate'};
const fcgToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
let FCG_SYNC = (() => { const x = grLS('fcg-sync', null); return x && x.day === fcgToday() && x.vals ? x : null; })();
if (FCG_SYNC) Object.assign(FCG_IN, FCG_SYNC.vals); else { try { localStorage.removeItem('fcg-sync'); } catch (e) {} }
const fcgInSave = () => { const o = {}; FCG_KEEP.forEach(k => { o[k] = FCG_SYNC && k in FCG_SYNC.vals ? (FCG_SYNC.prev || {})[k] : FCG_IN[k]; if (o[k] === undefined) delete o[k]; }); grSave('fcg-in', o); };
GF.fc = grFilters('fcg-', {host: 'fcg-gmode', terms: 'fcg-gm-terms', grades: 'fcg-gm-grades', gn: 'fcg-gm-gn', title: 'Graded forecast'},
  () => { if (tables.fcg) tables.fcg.apply(); if (typeof fcrApplyAll === 'function') fcrApplyAll(); }, FCG_SEL_DEFAULT);
grDragInit(GF.fc);
$('fcg-gm-terms').addEventListener('click', grTermsClick(GF.fc));
$('fcg-gm-grades').addEventListener('click', () => grOpenGrades(GF.fc));

// a row's line in the model (graded_forecast.LINES): on Card Ladder every PSA and CGC grade is its own line, named by its
// grade key
const FCG_LINE = gk => /^(psa|cgc)\|/.test(String(gk || '')) ? String(gk) : null;
const fcgDoc = () => (GR.doc && GR.doc.fc && !GR.doc.fc.err && GR.doc.fc.tables && GR.doc.fc.level && GR.doc.fc.sig) ? GR.doc.fc : null;   // the model of 2026-11-23 (an older file: not in this build yet)
const fcgFee = () => settings().fee;                       // eBay's final value fee with the tax on it (14.1%), the raw tab's
const fcgLevel = D => (D && D.level && D.level.now) || 'red';   // the graded market's level: green / amber / red
const fcgCap = D => (D && D.cap) || 0.85;                  // no graded Chance above this
const fcgReg = D => D.level ? D.level.now : D.regime && D.regime.up ? 'up' : 'down';   // the odds tables' market key (the raw model: up / down)
const fcgTab = (D, h, g) => g == null ? null : D.tables[h + '|' + fcgReg(D) + '|' + g] || (D.level && D.tables[h + '|' + fcgReg(D) + '|all']) || D.tables[h + '|all|all'] || null;
const FCG_F = {ext: 1, fall: 2, seg: 4, young: 8, thin: 16, noprice: 32, proxy: 64, prev: 128, beyond: 256};   // doc.fc.sig's flags
// beyond the history: the line's era has risen more in 3 months than any era of its side did in the months behind the odds - no Chance is given
const fcgBeyondWord = D => { const b = (D && D.level && D.level.beyond) || []; return b.length ? b.map(x => x[0] + ' ' + fcgPct(x[1], 0)).join(', ') + ' in 3 months, against ' + fcgPct(Math.max(...b.map(x => x[2])), 0) + ' for the largest run in the months behind the odds' : ''; };
// the cells, by graded_forecast.CELLS' order: 0-3 Modern / Contemporary PSA (passes busy / thin, fails busy / thin), 4-5 Vintage PSA, 6-7 Classic / Mid Era PSA, 8 new card, 9 CGC, 10 era not known
const FCG_CELL_WORD = ['passes the rules', 'passes the rules', 'fails a rule', 'fails a rule', 'Vintage', 'Vintage', 'Classic / Mid Era', 'Classic / Mid Era', 'new card', 'CGC', 'era not known'];
const fcgBusy = g => g != null && g <= 7 ? (g % 2 ? 'thin' : 'busy') : '';   // the PSA cells come in pairs: busy (10+ sales in the month), thin
const FCG_CELL_LONG = ['a Modern / Contemporary PSA line that passes the three rules, busy (10+ sales in the month)', 'a Modern / Contemporary PSA line that passes the three rules, thin (under 10 sales in the month)',
  'a Modern / Contemporary PSA line that fails a rule, busy (10+ sales in the month)', 'a Modern / Contemporary PSA line that fails a rule (or has too few sales to read them), thin (under 10 sales in the month)',
  'a Vintage PSA line, busy (10+ sales in the month)', 'a Vintage PSA line, thin (under 10 sales in the month)',
  'a Classic / Mid Era PSA line, busy (10+ sales in the month)', 'a Classic / Mid Era PSA line, thin (under 10 sales in the month)',
  'a card under 12 months since its release', 'a CGC line', 'a PSA line of a card whose era is not known (the level’s pooled history)'];
function fcgSig(D, r) {                                     // a row's cell, tie-breaker and flags today (doc.fc.sig), or null
  const line = FCG_LINE(r[50]), li = D && D.sig && line ? D.lines.indexOf(line) : -1, v = li >= 0 ? ((D.sig[String(r[0])] || {})[li]) : null;
  return v == null ? null : fcgSigOf(v);
}
const fcgSigOf = v => ({v, tb: (v & 1023) === 1023 ? null : (v & 1023) / 1000, g: (v >> 10) & 15, f: v >> 14});   // a filed code: tie-breaker x 1000 (1023: none) + 1024 x cell + 16384 x flags
function fcgChance3(D, t, be) {                             // [Chance, the range's low end, its high end] as fractions: the share of the cell's cases over the break-even, at most the cap
  const cap = fcgCap(D), one = q => Math.min(cap, Math.max(0, 1 - fcgCdf(D, {q}, be)));
  const p = one(t.q);
  return [p, t.lo ? Math.min(p, one(t.lo)) : p, t.hi ? Math.max(p, one(t.hi)) : p];
}
function fcgCdf(D, t, x) {                                 // P(return <= x) off the 1..99% grid; a run of equal values (a flat price) counts whole
  const qs = D.qs, q = t.q, n = q.length;
  if (x < q[0]) return Math.max(0, qs[0] * (1 - (q[0] - x) / Math.max(1e-6, q[1] - q[0])));
  if (x >= q[n - 1]) return Math.min(1, qs[n - 1] + (1 - qs[n - 1]) * (x - q[n - 1]) / Math.max(1e-6, q[n - 1] - q[n - 2]));
  let i = n - 1; while (i > 0 && q[i] > x) i--;
  return qs[i] + (qs[i + 1] - qs[i]) * (x - q[i]) / Math.max(1e-9, q[i + 1] - q[i]);
}
function fcgDraw(D, t, u) {                                // a return at probability u
  const qs = D.qs, q = t.q, n = q.length;
  if (u <= qs[0]) return Math.max(-0.95, q[0] - (q[1] - q[0]) * (qs[0] - u) / qs[0]);
  if (u >= qs[n - 1]) return q[n - 1] + (q[n - 1] - q[n - 2]) * (u - qs[n - 1]) / (1 - qs[n - 1]);
  let i = 0; while (i < n - 1 && qs[i + 1] < u) i++;
  return q[i] + (q[i + 1] - q[i]) * (u - qs[i]) / (qs[i + 1] - qs[i]);
}
const fcgBreak = (d, fee) => (1 - d) / (1 - fee) - 1;      // the return at which a slab nets $0 (the shipping cancels out)
const fcgNet = (std, r, d, fee) => std == null ? null : std * ((1 + r) * (1 - fee) - (1 - d));
const fcgBuy = (std, d, ship) => std == null ? null : std * (1 - d) - ship;
// the plan pane's boxes: one pane for Forecasting, Recording and Planning (2026-11-04, Brett: shared "EXCEPT % under" - the
// box shows Forecasting's own % under there, Recording's starting % for new rows there, and is not on Planning, whose
// rows keep the % they were bought at). disc here is always Forecasting's.
function fcgInputs() {
  const n = (id, dflt) => { const v = parseFloat($(id).value); return isNaN(v) ? dflt : v; };
  return {cap: Math.max(0, n('fcg-cap', 1000)), h: Math.min(6, Math.max(1, +$('fcg-h').value || 3)), disc: Math.min(0.6, Math.max(0, (+FCG_IN.disc || 0) / 100)),
          ship: Math.max(0, n('fcg-ship', 5.2)), pmin: Math.max(0, n('fcg-pmin', 50)), pmax: Math.max(0, n('fcg-pmax', 5000)), share: Math.min(1, Math.max(0.05, n('fcg-share', 20) / 100)),
          minp: Math.min(0.85, Math.max(0, n('fcg-minp', 50) / 100)), copies: Math.min(5, Math.max(1, Math.round(n('fcg-copies', 1)))), gate: $('fcg-gate').checked};
}
// a row's prices: [the standard price - Card Ladder's (r[79]), only when Card Ladder has read the card and the grade has
// 3+ sales in its last 90 days; PriceCharting's price of the grade today (else last month's) - reference only]
const fcgStd = r => [r[75] === 'read' && r[79] != null ? r[79] : null, r[67] != null ? r[67] : r[6]];
// a row's rank and odds, and its money at standard prices pc / cl bought d under less the shipping (Forecasting: the pane's
// % under; Recording and Planning: the row's own)
function fcgCalc(r, std, pcRef, d, ship, D, I, fee) {
  const sg = D ? fcgSig(D, r) : null, g = sg ? sg.g : null;
  const t = D && std != null && !(sg && sg.f & FCG_F.beyond) ? fcgTab(D, I.h, g) : null, ch = t ? fcgChance3(D, t, fcgBreak(d, fee)) : null;   // beyond the history: no odds
  r.fcS = std; r.fcSc = pcRef; r.fcD = d; r.fcB = fcgBuy(std, d, ship);
  r.fcPct = sg ? sg.tb : null; r.fcG = g; r.fcF = sg ? sg.f : 0; r.fcV = sg ? sg.v : null; r.fcT = t; r.fcQ = 0;   // fcPct: the tie-breaker (it was the dip rank); fcV: the line's code as filed
  r.fcP = ch ? Math.round(ch[0] * 1000) / 10 : null; r.fcPl = ch ? Math.round(ch[1] * 100) : null; r.fcPh = ch ? Math.round(ch[2] * 100) : null;
  r.fcN = t ? fcgNet(std, t.mean, d, fee) : null;
  r.fcR = r.fcN != null && r.fcB > 0 ? Math.round(r.fcN / r.fcB * 1000) / 10 : null;
  return r;
}
const fcgOrder = (a, b) => (b.fcP == null ? -1 : Math.round(b.fcP)) - (a.fcP == null ? -1 : Math.round(a.fcP)) || (b.fcPct || 0) - (a.fcPct || 0) || (b.fcS || 0) - (a.fcS || 0);   // buy order: chance to the whole percent, then fcPct (graded: the tie-breaker; raw: its rank), then price
// every row's figures, worked out again when the data, the rows or the plan's boxes change
function fcgRows() {
  const D = fcgDoc(), I = fcgInputs(), fee = fcgFee();
  const key = JSON.stringify(I) + '|' + fee + '|' + (D ? D.t : '');
  if (FCG.src === GR.rows && FCG.key === key) return FCG.rows;
  const be = fcgBreak(I.disc, fee), out = [];
  for (const r of GR.rows) {
    if (r[48]) continue;
    const [std, pcRef] = fcgStd(r);                           // no Card Ladder price: not on Forecasting (no PriceCharting fallback)
    if (std == null || std < I.pmin || std > I.pmax) continue;
    out.push(fcgCalc(r, std, pcRef, I.disc, I.ship, D, I, fee));
  }
  out.sort(fcgOrder);
  fcgPlaces(out);
  FCG.rows = out; FCG.src = GR.rows; FCG.key = key; FCG.I = I; FCG.fee = fee; FCG.be = be;
  return out;
}
/* Best to Buy and Best Chance (2026-11-05, Brett: "a best chance, and best to buy togglable and sortable column in recording
   and forcasting"): rows in buy order -> fcBB, the place in that order (Chance to the whole percent, then the tie-breaker
   - it was the deeper dip until 2026-11-23 -, then the higher price: the order the money goes in); fcBC, the place by Chance alone, ties sharing it (fcBCn = how many
   share that chance). Over every row of the page (not the filters), so a slab keeps its number while you filter; only
   slabs with a chance get one. Neither depends on the capital, the share, the copies, the bar or the gate. */
function fcgPlaces(rows) {
  const sc = rows.filter(r => r.fcP != null), cnt = new Map();
  sc.forEach(r => { const k = Math.round(r.fcP); cnt.set(k, (cnt.get(k) || 0) + 1); });
  let place = 0, prev = null;
  sc.forEach((r, i) => { const k = Math.round(r.fcP); r.fcBB = i + 1; if (k !== prev) { place = i + 1; prev = k; } r.fcBC = place; r.fcBCn = cnt.get(k); });
  rows.forEach(r => { if (r.fcP == null) { r.fcBB = null; r.fcBC = null; r.fcBCn = 0; } });
  return sc.length;
}
// the plan: best chance first among the rows on view, up to the per-card share, the copies and the capital
function fcgAllocate(view) {
  const I = FCG.I, D = fcgDoc();
  FCG.rows.forEach(r => { r.fcQ = 0; });
  FCG.gated = !!(D && I.gate && fcgLevel(D) === 'red');
  let left = I.cap;
  const elig = view.filter(r => r.fcP != null && r.fcP / 100 >= I.minp && r.fcB > 0).sort(fcgOrder);
  if (!FCG.gated) elig.forEach(r => {
    let q = Math.min(Math.floor(I.cap * I.share / r.fcB), I.copies, Math.floor(left / r.fcB));
    if (q > 0) { r.fcQ = q; left -= q * r.fcB; }
  });
  FCG.picks = elig.filter(r => r.fcQ > 0); FCG.spent = I.cap - left; FCG.elig = elig.length;
  FCG.mc = D && FCG.picks.length ? fcgMonteCarlo(D, FCG.picks, I, FCG.fee) : null;
}
// the basket: a market draw shared by every pick plus each pick's own (the raw tab's copula); each pick at its own % under
// (r.fcD) and its odds table (tab(r): the pick's table at the pane's hold, or another hold's)
function fcgMonteCarlo(D, picks, I, fee, n = 2000, tab) {
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const Phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  const wm = Math.sqrt(FC_RHO), wo = Math.sqrt(1 - FC_RHO), tot = new Float64Array(n);
  const T = tab || (r => r.fcT), P = picks.map(r => [r.fcQ, r.fcS, T(r), r.fcD != null ? r.fcD : I.disc]).filter(x => x[2] && x[1] != null);
  for (let k = 0; k < n; k++) { const zm = gauss(); let s = 0; for (const [q, std, t, d] of P) { const u = Math.min(0.9995, Math.max(0.0005, Phi(wm * zm + wo * gauss()))); s += q * fcgNet(std, fcgDraw(D, t, u), d, fee); } tot[k] = s; }
  const a = Array.from(tot).sort((x, y) => x - y), at = p => a[Math.min(n - 1, Math.floor(p * n))];
  return {lo: at(0.1), med: at(0.5), hi: at(0.9), mean: a.reduce((s, v) => s + v, 0) / n, p: Math.min(D.cap || FC_P_CAP, a.filter(v => v > 0).length / n)};
}
const fcgPct = (v, nd = 1) => v == null ? '' : (v > 0 ? '+' : '') + (v * 100).toFixed(nd) + '%';
const fcgDiscWord = d => (Math.round(d * 1000) / 10).toString() + '%';
function fcgSummary() {
  const box = $('fcg-summary'); if (!box) return;
  const D = fcgDoc(), I = FCG.I || fcgInputs(), mc = FCG.mc, unit = I.h + ' month' + (I.h > 1 ? 's' : '');
  if (!GR.doc) { box.innerHTML = GR.err ? '<span class="warn">' + esc(GR.err) + '</span>' : 'Loading the graded data…'; return; }
  if (!D) { box.innerHTML = '<p>The graded model is not in this build of the graded data yet' + (GR.doc.fc && GR.doc.fc.err ? ' (' + esc(GR.doc.fc.err) + ')' : '') + ' - it is made with the site build each morning. The rows below have their prices; Chance, Net and ROI fill in with it.</p>'; return; }
  const n = FCG.picks.length, copies = FCG.picks.reduce((s, r) => s + r.fcQ, 0);
  let s = '';
  if (FCG.gated) s = '<p><b>Nothing to buy: the graded market is red</b> (its index is ' + fcgPct(D.level.vs12) + ' against the average of its 12 months before) and “Buy only when the market is green or amber” is on. ' + (FCG.elig ? FCG.elig + ' slab' + (FCG.elig > 1 ? 's' : '') + ' would clear your bar anyway - the list is in buy order; switch it off to see the plan.' : '') + '</p>';
  else if (!n) s = '<p><b>No slab clears your bar</b> (' + Math.round(I.minp * 100) + '% chance of a profit, ' + fcgDiscWord(I.disc) + ' under, a ' + unit + ' hold) among the rows on view. Lower the bar, buy deeper under, or hold longer.</p>';
  else s = '<p>Spend <b>' + fmtMoneyPlain(FCG.spent) + '</b> of ' + fmtMoneyPlain(I.cap) + ' on <b>' + n + ' slab' + (n > 1 ? 's' : '') + '</b> (' + copies + (copies === 1 ? ' copy' : ' copies') + '), each bought ' + fcgDiscWord(I.disc) + ' under its standard price (Card Ladder’s) less the shipping, hold ' + unit + ', sell on eBay at Card Ladder’s price then. Every listed slab is assumed for sale; the green rows are the buys.</p>';
  s += '<div class="stats fc-stats">' +
    '<div class="stat"><div class="k">Expected net profit</div><div class="v">' + (mc ? fcMoney(mc.mean) + (FCG.spent > 0 ? ' <span class="fc-roi ' + (mc.mean < 0 ? 'down' : 'up') + '">' + fcgPct(mc.mean / FCG.spent) + '</span>' : '') : '-') + '</div><div class="d">average of the basket, after fees and shipping</div></div>' +
    '<div class="stat"><div class="k">Likely range</div><div class="v">' + (mc ? fcMoney(mc.lo) + ' to ' + fcMoney(mc.hi) : '-') + '</div><div class="d">10th to 90th percentile' + (mc ? '; median ' + fcMoney(mc.med) : '') + '</div></div>' +
    '<div class="stat"><div class="k">Chance the plan profits<button class="help" data-h="fcg_mc">?</button></div><div class="v">' + (mc ? (mc.p * 100).toFixed(0) + '%' : '-') + '</div><div class="d">the green slabs together, bought ' + fcgDiscWord(I.disc) + ' under</div></div>' +
    '<div class="stat"><div class="k">Fees assumed</div><div class="v">' + (FCG.fee * 100).toFixed(1) + '% + ' + fmtMoneyPlain(I.ship) + '</div><div class="d">eBay’s fee and your eBay Shipping Fee (in the buy price)</div></div></div>';
  box.innerHTML = s;
}
const fcgLevelWhy = L => L.now === 'red' ? 'the graded index is at or below the average of its 12 months before' : L.now === 'green' ? 'above its 12-month average, not overheated, enough clean lines'
  : 'above its 12-month average, but ' + (L.hot && L.few ? 'overheated and few clean lines' : L.hot ? 'overheated' : 'few clean lines');
const FCG_KINDS = [[0, 'Newer, passes · 10+'], [1, 'Newer, passes · 3–9'], [2, 'Newer, fails · 10+'], [3, 'Newer, fails · 3–9'], [4, 'Vintage · 10+'], [5, 'Vintage · 3–9'], [6, 'Classic / Mid · 10+'], [7, 'Classic / Mid · 3–9'], [8, 'New card'], [9, 'CGC']];
function fcgRegime() {
  const box = $('fcg-regime'); if (!box) return;
  const D = fcgDoc(), I = fcgInputs(), fee = fcgFee();
  if (!D) { box.textContent = GR.doc ? 'The graded model is not in this build yet.' : 'Waiting for the graded data…'; return; }
  const L = D.level, lv = L.now, th = L.th || {}, mo = L.months || {}, num = v => Number(v || 0).toLocaleString('en-US');
  const dsc = NAV.gm === 'rc' ? (+FCG_IN.rdisc || 0) / 100 : I.disc;   // the % under the pane shows: Recording's own there
  const be = fcgBreak(dsc, fee), dw = fcgDiscWord(dsc), unit = I.h + ' month' + (I.h > 1 ? 's' : ''), mid = D.qs.indexOf(0.5);
  const line = ([g, name]) => { const t = D.tables[I.h + '|' + lv + '|' + g];
    if (!t) return '<tr><td>' + name + '</td><td class="num" colspan="2"><span class="dim">too few cases</span></td></tr>';
    const c = fcgChance3(D, t, be);
    return '<tr title="' + esc(num(t.n) + ' cases in ' + t.nm + ' ' + lv + ' months') + '"><td>' + name + '</td><td class="num">' + fcgPct(t.q[mid], 0) + '</td><td class="num">' + (c[0] * 100).toFixed(0) + '% <span class="dim">' + Math.round(c[1] * 100) + '–' + Math.round(c[2] * 100) + '</span></td></tr>'; };
  const segs = (L.segs || []).filter(x => /^(Modern|Contemporary)/.test(x[0]) && x[1] != null).map(x => esc(x[0].replace('PSA below 10', 'below 10')) + ' ' + fcgPct(x[1], 0)).join(' · ');
  const why = fcgLevelWhy(L);
  box.innerHTML = '<p><b class="fc-light fc-light-' + lv + '">' + lv.charAt(0).toUpperCase() + lv.slice(1) + '</b> <b>' + why.charAt(0).toUpperCase() + why.slice(1) + '.</b> The graded index stands <b>' + fcgPct(L.vs12) + '</b> against the average of its 12 months before (' + fcgPct(L.mom1) + ' last month). ' +
    'Heat score <b>' + (L.heat == null ? '-' : L.heat.toFixed(2)) + '</b> (' + (th.heat || 0.7).toFixed(2) + ' or more is hot). <b>' + num(L.n_pass) + ' of ' + num(L.n_gated) + '</b> busy seasoned PSA lines pass the line rules (' + (L.share == null ? '-' : Math.round(L.share * 100) + '%') + '; under ' + Math.round((th.share || 0.4) * 100) + '% is few). ' +
    'Since 2022: green in ' + (mo.green || 0) + ' months, amber in ' + (mo.amber || 0) + ', red in ' + (mo.red || 0) + ' — so ' + (lv !== 'red' ? 'the plan may buy, with ' + lv + ' months’ odds' : 'the plan buys nothing while “Buy only when the market is green or amber” is on') + '.</p>' +
    ((L.beyond || []).length ? '<p><b>No Chance for ' + esc(L.beyond.map(x => x[0]).join(' and ')) + ' lines:</b> ' + esc(fcgBeyondWord(D)) + '. The past has no case like that, so those slabs show “beyond history” and get no money.</p>' : '') +
    (segs ? '<p class="dim">The newer segments over 3 months (a line fails while its segment is up ' + Math.round((th.seg || 0.221) * 100) + '%+): ' + segs + '.</p>' : '') +
    '<p class="dim">What each kind of line did after ' + (lv === 'amber' ? 'an' : 'a') + ' ' + lv + ' month, 2022 on, bought the month after and held ' + unit + ': the middle move, and how often one bought ' + dw + ' under (the shipping in the buy price) netted a profit, with its range.</p>' +
    '<div class="pctbox fc-box"><table><thead><tr><th>Line</th><th class="num">Move</th><th class="num" title="a slab bought ' + dw + ' under its standard price, less the shipping: how often it netted a profit, and the range of that share over resamples of the months">' + dw + ' under</th></tr></thead><tbody>' +
    FCG_KINDS.map(line).join('') + '</tbody></table></div>' +
    '<p class="dim">Newer = Modern / Contemporary PSA; Vintage and Classic / Mid = those eras’ PSA lines; 10+ and 3–9 = sales in the month. One fall (2022-23) and one rise (2024-26) are behind every figure: read them as upper bounds.</p>' +
    '<p class="dim">Model ' + esc(D.model || '') + ', data month ' + esc(D.month || '') + ', built ' + esc((D.t || '').replace('T', ' ').replace('Z', ' UTC')) + ', ' + num(D.n_ranked) + ' Card Ladder lines (card × grade) with a standard price read' + (D.n_beyond ? ' (' + num(D.n_beyond) + ' of them beyond history: no Chance)' : '') + ', from the ' + num(D.n_cards) + ' cards Card Ladder has read. Every PSA and CGC grade is its own line.</p>';
}
function fcgMeta() {
  const m = $('meta-fcg'); if (!m) return;
  const D = fcgDoc();
  const md = typeof fcgMode === 'function' ? fcgMode() : 'fc';
  m.textContent = md === 'rc' ? 'Forecast · graded cards (PSA and CGC) · Recording: the slabs you recorded at a card show, best to buy first - green: buy it with the capital left; Yes: you bought it at your price; No: the vendor wanted more (it goes to the bottom)'
    : md === 'pl' ? 'Forecast · graded cards (PSA and CGC) · Purchases: the slabs you bought (marked Yes on Recording), what you paid and what they are expected to make; Record Purchases keeps them on History'
    : md === 'hi' ? 'Forecast · graded cards (PSA and CGC) · History: Forecasting Replay (the plan run on every month since 2022 with only what was known then), Recorded Purchases, and Pre-Sales Spotcheck (the green rows you sent, looked back)'
    : 'Forecast · graded cards (PSA and CGC) · which slabs to buy at a vendor and sell on eBay, every slab Card Ladder prices assumed for sale; the Chance follows the market’s level (green / amber / red), the kind of line and the hold' + (D ? ' · ' + D.model : '');
}
// the cells
const fcgM = v => v == null ? '<span class="dim">-</span>' : fmtMoney(v);
function fcg2(cl, pc, clTip, pcTip, r) {                  // a two-line cell: Card Ladder on top, PriceCharting (reference) under it
  const clw = r[75] === 'pending' ? '<span class="dim">pending</span>' : r[75] === 'no match' ? '<span class="dim">no match</span>' : cl;
  return '<td class="num fcg2"><span title="' + esc(clTip) + '"><i>CL</i> ' + clw + '</span><span title="' + esc(pcTip) + '"><i>PC</i> ' + pc + '</span></td>';
}
function fcg1(v, tip, r) {                                  // a Card Ladder-only cell
  const w = r[75] === 'pending' ? '<span class="dim">pending</span>' : r[75] === 'no match' ? '<span class="dim">no match</span>' : v;
  return '<td class="num" title="' + esc(tip) + '">' + w + '</td>';
}
// Card Ladder's value beside the standard price (decision 1, 2026-11-05: "show Card Ladder’s value beside it, flagged when
// they disagree" by 25% or more). At its top confidence the value is the last sale.
function fcgClv(r) {
  const v = r[68], s = r.fcS; if (v == null || s == null) return '';
  const off = v / s - 1, far = Math.abs(off) >= 0.25;
  return far ? ' <span class="fcg-clv" title="' + esc('Card Ladder’s value ' + fmtMoneyPlain(v) + (r[82] ? ' (confidence ' + r[82] + ' of 5)' : '') + ' is ' + Math.round(Math.abs(off) * 100) + '% ' + (off > 0 ? 'above' : 'below') + ' the standard price - at its top confidence the value is just the last sale, so one odd copy can move it. Check the recent sales before you pay.') + '">≠CLV</span>' : '';
}
// a row's cells by name (Recording and Planning use the same ones in their own order, with their own columns between)
function fcgCells(r, I) {
  const k = r[0] + '|' + esc(r[50]), c = (GR.doc.cards || {})[String(r[0])] || {}, d = r.fcD != null ? r.fcD : I.disc;
  const pcDown = r[67] != null ? String(r[43] || '').startsWith('down:') : (r[69] || [])[2] === 'down';   // a half grade priced one grade down on the PriceCharting side (2026-11-14)
  const pcFrom = (r[67] != null ? 'PriceCharting’s price of this grade today' : 'PriceCharting’s price of this grade last month (none today)') + (pcDown ? ' - rounded down (↓): PriceCharting has no price of its own for this half grade, so the whole grade below’s' : '') + ' - shown for reference; the chance and the money use Card Ladder’s';
  const sw = r[80] || [], clFrom = 'The standard price: the middle (Hodges-Lehmann) of Card Ladder’s ' + (sw[1] || '') + ' sales of this grade in the ' + (sw[0] || 30) + ' days to the card’s Card Ladder read' + (sw[2] ? ' (' + grDay(sw[2]) + ')' : '') + '. ' + (r[68] != null ? 'Card Ladder’s value: ' + fmtMoneyPlain(r[68]) + (r[82] ? ' (confidence ' + r[82] + ' of 5)' : '') + '.' : 'No Card Ladder value for it.');
  const buyTip = 'Card Ladder’s standard price x (1 - ' + fcgDiscWord(d) + ') - ' + fmtMoneyPlain(I.ship) + ' shipping: the most to pay the vendor';
  const pcSold = r[76] && r[16] != null ? '~' + fmtInt(r[16]) : r[16] == null && (r[69] || [])[2] === 'not_read' ? '<span class="dim">not read</span>' : r[16] == null ? '<span class="dim">-</span>' : fmtInt(r[16]);
  return {flag: '<td class="gflc">' + (r[42] ? '<button class="gflag on" data-k="' + k + '" title="' + esc('Your flag: ' + r[42] + '. Click to change it or take it off.') + '">⚑ ' + esc(r[42]) + '</button>' : '<button class="gflag" data-k="' + k + '" title="Flag this row with a reason - the same flags as the PriceCharting tab’s graded rows">⚐</button>') + '</td>',
    review: (!c.pid ? '<td><span class="dim" title="Review puts PriceCharting’s card beside Card Ladder’s - this card has no Card Ladder card yet">-</span></td>'
      : '<td><button class="rvb grvb' + (r[41] === 1 ? ' same' : r[41] === 0 ? ' diff' : '') + '" data-k="' + k + '" title="Compare PriceCharting’s card with Card Ladder’s">Review</button></td>'),
    name: '<td class="fcr-nm">' + esc(r[1]) + '<br><span class="dim">' + esc(String(r[2] || '').replace(/^Pokemon /, '')) + (r[3] ? ' · #' + esc(r[3]) : '') + '</span></td>',
    grade: '<td><b>' + esc(r[25]) + '</b></td>',
    std: fcg2(fcgM(r.fcS) + fcgClv(r), fcgM(r.fcSc) + (pcDown && r.fcSc != null ? '<sup class="gdown">↓</sup>' : ''), clFrom, pcFrom, r),
    buy: fcg1(fcgM(r.fcB), buyTip, r),
    sold: fcg2(r[37] == null ? '<span class="dim">-</span>' : fmtInt(r[37]), pcSold, 'Card Ladder’s sales of this grade last month' + (r[81] != null ? ' (' + fmtInt(r[81]) + ' in the 12 months to its read)' : ''), 'PriceCharting’s recorded sales of this grade and grader last month' + (r[76] ? ' (an estimate: its list of sales does not reach back to the start of the month)' : '') + ' - reference', r),
    chance: fcgChanceCell(r, I),
    bb: r.fcBB == null ? '<td class="num"><span class="dim" title="No chance, so no place in the buy order">-</span></td>'
      : '<td class="num" title="' + esc('Best to Buy: number ' + r.fcBB + ' in the buy order - Chance first (to the whole percent), then the tie-breaker (the card’s other grades rose more than this one, a clean month of sales), then the higher price. The order the plan spends in; the green rows are the ones the money reaches.') + '"><b>' + r.fcBB + '</b></td>',
    bc: r.fcBC == null ? '<td class="num"><span class="dim" title="No chance, so no place">-</span></td>'
      : '<td class="num" title="' + esc('Best Chance: place ' + r.fcBC + ' by Chance alone' + (r.fcBCn > 1 ? ', shared by ' + r.fcBCn + ' slabs at ' + Math.round(r.fcP) + '% (the model sees them as equally good)' : '')) + '">' + r.fcBC + (r.fcBCn > 1 ? '<span class="dim">=</span>' : '') + '</td>',
    qty: '<td class="num">' + (r.fcQ ? '<b>' + r.fcQ + '</b>' : '<span class="dim">—</span>') + '</td>',
    net: fcg1(r.fcN == null ? '<span class="dim">-</span>' : fcgMoneyS(r.fcN), 'Expected net per copy: Card Ladder’s standard x ((1 + the average return of lines like it at this market level) x (1 - eBay’s fee) - (1 - ' + fcgDiscWord(d) + ')), after eBay’s fee and the shipping. An average: one slab’s result is mostly the market’s next months and its own luck.', r),
    roi: fcg1(r.fcR == null ? '<span class="dim">-</span>' : fcgPct(r.fcR / 100), 'Net / buy price, over the hold', r)};
}
function fcgRow(r) {
  const x = fcgCells(r, FCG.I);
  return x.flag + x.review + x.name + x.grade + x.std + x.buy + x.sold + x.chance + x.bb + x.bc + x.qty + x.net + x.roi + fcgPcx(r).join('');
}
function fcgFlagWords(f) {                                 // a row's flags in words (doc.fc.sig)
  const F = FCG_F, o = [];
  if (f & F.ext) o.push('extended (up 16%+ last month, or 28%+ above its own 6-month average)');
  if (f & F.fall) o.push('still falling (down 7%+ last month, or the month’s second half 7% under its first)');
  if (f & F.seg) o.push('its segment (era × PSA 10 / below 10) is up 22%+ in 3 months');
  if (f & F.noprice) o.push('under 3 sales in each of the last two months, so its rules cannot be read');
  else if (f & F.prev) o.push('read from the month before last (under 3 sales last month)');
  if (f & F.proxy) o.push('no release date on file: its age is taken from its era or its first sale');
  if (f & F.beyond) o.push('beyond the history: its era has risen more in 3 months than any era did in the months behind the odds');
  return o;
}
const fcgExtTip = g => 'Extended: its price is up 16%+ on last month, or 28%+ above its own 6-month average. ' +
  (g != null && g <= 3 ? 'In Modern and Contemporary such lines made clearly less over the next 3 months; it is one of the three rules, so it is already in the Chance.' : g >= 4 && g <= 7 ? 'In the older eras this has not separated good buys from bad, so it does not change the Chance; shown as a warning.' : 'Shown as a warning; it does not change this line’s Chance.') +
  ' “Extended” means not now, not never: the effect was gone three months after the flag.';
function fcgChanceCell(r, I) {
  const D = fcgDoc(), d = r.fcD != null ? r.fcD : I.disc;
  if (D && r.fcS != null && (r.fcF || 0) & FCG_F.beyond) return '<td class="num"><span class="fcg-warn" title="' + esc('No Chance: this line’s era has risen more in 3 months than any era did in the months the odds were measured on (' + fcgBeyondWord(D) + '). The past has no case like it, so the model gives no figure. It comes back by itself once the run cools.') + '">beyond history</span></td>';
  if (r.fcP == null || !D) return '<td class="num"><span class="dim" title="' + esc(r.fcS == null ? 'No Card Ladder standard price for this grade: fewer than 3 sales in the 90 days to the card’s read' : 'No score for this line in this build of the graded data') + '">no score</span></td>';
  const lv = fcgLevel(D), t = r.fcT, own = D.tables[I.h + '|' + lv + '|' + r.fcG] === t, fw = fcgFlagWords(r.fcF || 0), cap = Math.round(fcgCap(D) * 100);
  const tip = 'This line: ' + (FCG_CELL_LONG[r.fcG] || 'not placed') + (fw.length ? ' - ' + fw.join('; ') : '') + '. How often such lines made money over ' + I.h + ' month' + (I.h > 1 ? 's' : '') + ' after ' + (lv === 'amber' ? 'an' : 'a') + ' ' + lv + ' month, 2022 on (' +
    Number(t.n).toLocaleString('en-US') + ' cases in ' + t.nm + ' months' + (own ? '' : ': too few of its own kind, so this level’s seasoned PSA lines together') + '), bought the month after ' + fcgDiscWord(d) + ' under: ' + r.fcP.toFixed(0) + '%' + (Math.round(r.fcP) >= cap ? ' (the most shown)' : '') +
    '; with those months drawn again it ran from ' + r.fcPl + '% to ' + r.fcPh + '%.';
  return '<td class="num fcg-ch" title="' + esc(tip) + '">' + r.fcP.toFixed(0) + '%<span class="fcg-rng">' + (r.fcPl >= cap ? 'the most shown' : r.fcPl + '–' + r.fcPh) + '</span>' + ((r.fcF || 0) & FCG_F.ext ? '<span class="fcg-warn" title="' + esc(fcgExtTip(r.fcG)) + '">extended</span>' : '') + '</td>';
}
// a row's line in a few words (Recording and Purchases: the Line column; it was Rank until 2026-11-23)
function fcgLineCell(g, f, tb) {
  if (g == null) return '<td class="num"><span class="dim" title="No reading for this line in this build of the graded data">-</span></td>';
  const fw = fcgFlagWords(f || 0), F = FCG_F;
  const tip = 'This line is ' + (FCG_CELL_LONG[g] || 'not placed') + (fw.length ? ' - ' + fw.join('; ') : '') + '.' + (tb != null ? ' Tie-breaker ' + Math.round(tb * 100) + ' of 100 inside its month and segment (the card’s other grades rose more than this one, a clean month of sales): the order among slabs with the same Chance.' : ' No tie-breaker: no price last month.');
  return '<td class="num fcg-ln" title="' + esc(tip) + '">' + esc(FCG_CELL_WORD[g] || '-') + ((f || 0) & F.beyond ? '<span class="fcg-warn">beyond history</span>' : '') + '<span class="fcg-rng">' + fcgBusy(g) + (tb != null ? (fcgBusy(g) ? ' · ' : '') + 'tie ' + Math.round(tb * 100) : '') + '</span>' + ((f || 0) & F.ext ? '<span class="fcg-warn" title="' + esc(fcgExtTip(g)) + '">extended</span>' : '') + '</td>';
}
const fcgMoneyS = v => '<span class="' + (v < 0 ? 'down' : v > 0 ? 'up' : '') + '">' + (v < 0 ? '−' : v > 0 ? '+' : '') + fmtMoneyPlain(Math.abs(v)) + '</span>';
// Only Hits (2026-11-04, Brett: "under forcasting graded and record graded maybe have a "Only Hits" button to only show
// the listings with the green tinted pastel color"): one switch for Forecasting and Recording, in the filter-button bar
// (so it moves with it; not on Planning). The plan is worked out on every row on view first - the filters steer the money
// as before - and then only its green rows are drawn.
const FCG_HITS = {on: !!grLS('fcg-hits', false)};
$('fcg-gmode').insertAdjacentHTML('afterbegin', '<button type="button" class="gm2 gtb fcg-hits" id="fcg-hits" title="On = show only the green rows: the slabs the plan buys with the capital (Recording: the open slabs it would buy with what is left). The plan is worked out on every row the other filters leave, then only its buys are listed.">Only Hits <span class="dim" id="fcg-hits-n"></span></button>');
{ const pt = grPaintTerms; grPaintTerms = function (F) {   // the switch sits first in the row of filter buttons (kept out of their redraw, like Grading); Add to Pre-Sales Spotcheck right after it
  const b = $('fcg-hits'), box = $('fcg-gm-terms'), sw = document.querySelector('.fcg-spotw');
  if (b && box && box.contains(b)) box.parentNode.insertBefore(b, box);
  if (sw && box && box.contains(sw)) box.parentNode.insertBefore(sw, box);
  const out = pt.apply(this, arguments);
  if ((F || GF.pc) === GF.fc && b && box && !box.hidden) { box.insertBefore(b, box.firstChild); if (sw) b.after(sw); }
  return out;
}; }
function fcgHitsView(t, id, total, noun, isHit, n) {        // after a table's plan: the green count on the button, and the rows cut to them when on
  $('fcg-hits').classList.toggle('on', FCG_HITS.on); $('fcg-hits-n').textContent = '(' + n + ')';
  if (!FCG_HITS.on) return;
  t.view = t.view.filter(isHit);
  $('count-' + id).textContent = t.view.length.toLocaleString('en-US') + ' hits of ' + total.toLocaleString('en-US') + ' ' + noun;
}
$('fcg-hits').addEventListener('click', () => {
  FCG_HITS.on = !FCG_HITS.on; grSave('fcg-hits', FCG_HITS.on); $('fcg-hits').classList.toggle('on', FCG_HITS.on);
  if (!GR.doc) return;
  if (fcgMode() === 'rc' && tables.fcr) tables.fcr.apply(); else if (fcgMode() === 'fc') tables.fcg.apply();
});
/* ---- Columns (2026-11-04, Brett: "for the forcasting page, reocrindg page, planning page, history page, i want the same
   columns toggle buttomn as the pc tab ... when add you add the rest make sure you have them off"; the eBay columns "leave
   em out"; "have them shared on those 3 in addition to history"). The PriceCharting tab's graded columns the page lacks are
   added at the end of Forecasting's, Recording's and Planning's tables (and of History's recorded-plan slab lists), off at
   first; their headers are copies of the PriceCharting tab's (same ? help, same data-k, so they sort and filter alike) and
   their cells are its own (grRow's). Which columns show is ONE choice for the four pages, kept by column (FCG_COLS:
   'pc:<n>' the PriceCharting column n of grRow, 'k:<data-k>', 'l:<label>'), so a column a page does not have is left alone. ---- */
const FCG_PCX = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  31, 32, 33, 34, 35, 36, 37, 38, 39, 42, 43, 50];        // grRow's cells: all but PC Card Name (3), PC / CL sales (40, 41: in Sold), the eBay six (44-49), Review (51), Flag (52)
const FCG_PCN = 53;                                        // grRow's cells (the PriceCharting graded header has two more: Row and the star)
const FCG_PCH = (() => {                                   // the copied headers, by grRow index (none if the PriceCharting header is not the one expected)
  const ths = [...document.querySelectorAll('#pcv-g thead tr:last-child th')], out = {};
  if (ths.length !== FCG_PCN + 2) { console.warn('graded forecast: the PriceCharting graded header has ' + ths.length + ' columns, not ' + (FCG_PCN + 2) + ' - its columns are not added'); return null; }
  for (const i of FCG_PCX) {
    const src = ths.find(th => +th.dataset.ci === i + 2) || ths[i + 2]; if (!src) return null;
    const th = src.cloneNode(true);
    th.querySelectorAll('.eye, .hlb, .rsz').forEach(x => x.remove());
    ['data-ci', 'draggable', 'style'].forEach(a => th.removeAttribute(a)); th.classList.remove('col-hidden', 'hl', 'sized', 'on', 'resizing', 'dragging');
    const st = th.querySelector('.s'); if (st) st.textContent = '⇅';
    th.classList.add('pcx'); th.dataset.col = 'pc:' + i; out[i] = th;
  }
  return out;
})();
const FCG_TPL = document.createElement('template');
function fcgPcx(r) {                                       // a row's PriceCharting cells, in FCG_PCX order
  if (!FCG_PCH) return [];
  if (!r || r[48] || !GR.doc) return FCG_PCX.map(() => gdash);
  FCG_TPL.innerHTML = '<table><tbody><tr>' + grRow(r) + '</tr></tbody></table>';
  const tds = FCG_TPL.content.querySelector('tr').children;
  return FCG_PCX.map(i => tds[i] ? tds[i].outerHTML : gdash);
}
function fcgAddPcHeads(rootSel, store) {                   // the copies onto a table's header (before makeTable); a saved column order keeps its place
  if (!FCG_PCH) return;
  const row = document.querySelector(rootSel + ' thead tr:last-child'), n0 = row.children.length;
  FCG_PCX.forEach(i => row.appendChild(FCG_PCH[i].cloneNode(true)));
  const sv = grLS('order-' + store, null);
  if (Array.isArray(sv) && sv.length === n0) grSave('order-' + store, sv.concat([...Array(row.children.length - n0).keys()].map(k => n0 + k)));
}
const fcgColText = th => { const tn = [...th.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); return (tn ? tn.textContent : th.textContent).replace(/[⇅?]/g, '').trim(); };
const fcgColKey = th => th.dataset.col || (th.classList.contains('rn') ? 'row' : th.dataset.k ? 'k:' + th.dataset.k : 'l:' + fcgColText(th));
const FCG_COLS = grLS('fcg-cols', null) || {};             // the shared choice: key -> 1 hidden / 0 shown (a key never set: shown, except the PriceCharting ones)
const FCG_TABLE_ROOT = {fcg: '#fcg-main', fcr: '#fcr-main', fcp: '#fcp-main'};
let FCG_COLS_LOCK = false;
const fcgColHidden = key => FCG_COLS[key] === 1 || (FCG_COLS[key] == null && /^pc:/.test(key));
function fcgColsTake(id, hidden) {                         // a table's eyes / Columns… into the shared choice
  if (FCG_COLS_LOCK) return;
  document.querySelectorAll(FCG_TABLE_ROOT[id] + ' thead tr:last-child th').forEach(th => { FCG_COLS[fcgColKey(th)] = hidden.has(+th.dataset.ci) ? 1 : 0; });
  grSave('fcg-cols', FCG_COLS);
}
function fcgColsApply(id) {                                // the shared choice onto a table (when it is shown)
  const t = tables[id]; if (!t) return;
  const hide = [...document.querySelectorAll(FCG_TABLE_ROOT[id] + ' thead tr:last-child th')].filter(th => fcgColHidden(fcgColKey(th))).map(th => +th.dataset.ci);
  FCG_COLS_LOCK = true; try { t.setHidden(hide); } finally { FCG_COLS_LOCK = false; }
}
function fcgColsSeed(id) {                                 // the first time: this table's own choices so far become the shared ones (the copies off)
  if (localStorage.getItem('fcg-cols') != null) return;
  let hid = []; try { hid = JSON.parse(localStorage.getItem('hide-' + id) || '[]'); } catch (e) {}
  document.querySelectorAll(FCG_TABLE_ROOT[id] + ' thead tr:last-child th').forEach(th => { const k = fcgColKey(th); if (FCG_COLS[k] == null && !/^pc:/.test(k)) FCG_COLS[k] = hid.includes(+th.dataset.ci) ? 1 : 0; });
  grSave('fcg-cols', FCG_COLS);
}
// the copied headers' ? buttons (help.js bound the page's own before these existed)
$('fcg').addEventListener('click', e => { const hb = e.target.closest('th.pcx button.help, .al-now button.help, .fcg-spotw button.help'); if (hb) { e.stopPropagation(); e.preventDefault(); openHelp(hb.dataset.h); } }, true);
// the table: the PriceCharting tab's machinery (eyes, highlight, names, drag, Columns…, Filters…)
const FCG_RANGES = ['fcS', 'fcSc', 'fcB', 16, 37, 'fcP', 'fcN', 'fcR'];
const FCG_LABELS = {fcS: 'Standard CL $', fcSc: 'PC price $ (reference)', fcB: 'Buy price $', 16: 'Sold PC (last mo)', 37: 'Sold CL (last mo)', fcP: 'Chance %', fcN: 'Net $', fcR: 'ROI %'};
fcgAddPcHeads('#fcg-main', 'fcg');
tables.fcg = makeTable('fcg', {rows: () => fcgRows(), noun: 'graded rows', ranges: FCG_RANGES, labels: FCG_LABELS, defaults: {}, root: '#fcg-main', name: 'Forecast · graded', onCols: h => fcgColsTake('fcg', h), inserted: [{v: 'noplus', at: 2, n: -1}, {v: 'best', at: 10, n: 2}],   // the + column went, Best to Buy / Best Chance came after Chance (2026-11-05): saved order / widths / highlights move with them
  fav: {s: 'pc', k: r => r[0], c: r => r[0]}, key: r => r[0] + '|' + r[50],
  extra: r => grPass(r, GF.fc),
  rowClass: r => r.fcQ ? 'fcg-buy' : grWrong(r) ? 'grwrong' : grUnsure(r) ? 'grunsure' : '',
  hay: r => [r[1], r[2], r[3], r[25], r[29], r[30], r[53], r[54]].filter(Boolean).join(' '),
  row: fcgRow,
  after: t => {                                         // the plan follows the rows on view; the Buy column is drawn again with it
    if (!FCG.I) return;
    fcgAllocate(t.view);
    fcgHitsView(t, 'fcg', FCG.rows.length, 'graded rows', r => r.fcQ > 0, FCG.picks.length);
    if (t.sortKey === 'fcQ') t.view.sort((a, b) => (a.fcQ - b.fcQ) * t.sortDir);
    const n = t.shown; $('rows-fcg').innerHTML = ''; t.shown = 0; t.renderMore(Math.max(PAGE, n));
    fcgSummary();
  }});
fcgColsSeed('fcg'); fcgColsApply('fcg');
// (the + column and Recording's Looking for list went on 2026-11-05, Brett: "okay we can remove the + column that makes
// sense" - Yes on Recording is how a slab reaches Planning, the star marks the cards to look for; the raw cards keep theirs)
// the plan's boxes: remembered in this browser, every change worked out again
const fcgMode = () => ['rc', 'pl', 'hi'].includes(NAV.gm) ? NAV.gm : 'fc';
function fcgDiscPaint() {                                  // the % under box: Forecasting's own, Recording's starting %, none on Planning
  const m = fcgMode(); $('fcg-disc').value = m === 'rc' ? FCG_IN.rdisc : FCG_IN.disc;
  $('fcg-disc-note').textContent = m === 'rc' ? 'Recording: the % a newly recorded slab starts at - each row has its own % Under box (what the vendor will take). Forecasting keeps its own % under.' : m === 'hi' ? 'History: the replay runs these boxes, with Forecasting’s % under (the same box as on Forecasting).' : '';
}
function fcgInputsPaint() {
  const I = FCG_IN;
  $('fcg-cap').value = I.cap; $('fcg-h').value = String(I.h); fcgDiscPaint(); $('fcg-ship').value = I.ship;
  $('fcg-pmin').value = I.pmin; $('fcg-pmax').value = I.pmax; $('fcg-share').value = I.share; $('fcg-minp').value = I.minp;
  $('fcg-copies').value = I.copies; $('fcg-gate').checked = !!I.gate;
  $('fcg').classList.toggle('folded', !!I.fold); document.querySelectorAll('#fcg .fcg-unfold').forEach(b => { b.hidden = !I.fold; });
}
function fcgChanged() {
  const I = fcgInputs(), dv = parseFloat($('fcg-disc').value), m = fcgMode();
  Object.assign(FCG_IN, {cap: I.cap, h: I.h, ship: I.ship, pmin: I.pmin, pmax: I.pmax, share: Math.round(I.share * 100), minp: Math.round(I.minp * 100), copies: I.copies, gate: I.gate});
  if (!isNaN(dv) && m !== 'pl') FCG_IN[m === 'rc' ? 'rdisc' : 'disc'] = Math.round(Math.min(60, Math.max(0, dv)) * 10) / 10;
  if (FCG_SYNC) {                                          // a synced box changed by hand is yours again
    for (const k of Object.keys(FCG_SYNC.vals)) if (FCG_IN[k] !== FCG_SYNC.vals[k]) delete FCG_SYNC.vals[k];
    if (Object.keys(FCG_SYNC.vals).length) grSave('fcg-sync', FCG_SYNC); else { FCG_SYNC = null; try { localStorage.removeItem('fcg-sync'); } catch (e) {} }
    fcgSyncNote();
  }
  fcgInSave();
  fcgGsetSoon();
  fcgRegime(); if (GR.doc) { tables.fcg.apply(); if (typeof fcrApplyAll === 'function') fcrApplyAll(); }
  if (m === 'hi' && typeof fhgRender === 'function') fhgRender();   // History: the replay follows the pane
}
$('fcg-side').addEventListener('change', e => { if (e.target.closest('input, select')) fcgChanged(); });
$('fcg-side').addEventListener('input', e => { if (e.target.type === 'number') { clearTimeout(FCG.tm); FCG.tm = setTimeout(fcgChanged, 400); } });
function fcgPlanOut() {                                  // this pane's plan as the phone's Sync from website takes it
  return {capital: FCG_IN.cap, hold: FCG_IN.h, under: FCG_IN.disc, ship: FCG_IN.ship, bar: FCG_IN.minp, share: FCG_IN.share, gate: !!FCG_IN.gate};
}
function fcgGsetSoon(now) {                               // the website's plan to the collector, a moment after the last change
  clearTimeout(FCG.gsT);
  FCG.gsT = setTimeout(() => { if (!HKEY) return; alSend({type: 'gset', t: nextT(), src: 'web', v: fcgPlanOut()}).then(() => grSave('fcg-gset-day', fcgToday())).catch(() => {}); }, now ? 50 : 2000);
}
function fcgSyncNote() {
  const n = $('fcg-sync-note'); if (!n) return;
  n.textContent = FCG_SYNC ? 'Synced from the phone' + (FCG_SYNC.t ? ' (its plan of ' + new Date(FCG_SYNC.t).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) + ')' : '') + ' - ' + Object.keys(FCG_SYNC.vals).filter(k => k !== 'rdisc').length + ' box(es); back to the website’s own at midnight.' : '';
}
async function fcgSyncFromPhone() {
  const btn = $('fcg-sync'), note = $('fcg-sync-note');
  if (!HKEY) return favSay('This page has no key for the collector.');
  btn.disabled = true; note.textContent = 'Looking for the phone’s plan…';
  try { await scanFileLoad(true); await scanPoll(); } catch (e) { /* what is known so far */ }
  btn.disabled = false;
  const ph = SCAN.sync.ph;
  if (!ph || !ph.v) { note.textContent = 'No plan from the phone yet: open the app, unlocked, and it sends its Your Plan (or change any box there).'; return; }
  const vals = {};
  for (const [a, b] of Object.entries(FCG_SYNC_MAP)) if (ph.v[a] !== undefined && ph.v[a] !== null) vals[b] = b === 'gate' ? !!ph.v[a] : (b === 'h' ? Math.min(6, Math.max(1, Math.round(+ph.v[a]))) : +ph.v[a]);
  if (vals.disc !== undefined) vals.rdisc = vals.disc;
  const prev = FCG_SYNC ? FCG_SYNC.prev : fcgKept();
  FCG_SYNC = {day: fcgToday(), vals, prev, t: ph.t}; grSave('fcg-sync', FCG_SYNC);
  Object.assign(FCG_IN, vals); fcgInputsPaint(); fcgChanged();
  favSay('Your plan now has the phone’s values - until midnight.');
}
function fcgSyncExpire() {                                 // midnight: the synced boxes go back to what they were
  if (!FCG_SYNC || FCG_SYNC.day === fcgToday()) return;
  const prev = FCG_SYNC.prev || {};
  for (const k of Object.keys(FCG_SYNC.vals)) FCG_IN[k] = prev[k] !== undefined ? prev[k] : FCG_IN_DEFAULT[k];
  FCG_SYNC = null; try { localStorage.removeItem('fcg-sync'); } catch (e) {}
  fcgInputsPaint(); fcgChanged(); fcgSyncNote();
}
setInterval(fcgSyncExpire, 60000);
$('fcg-sync').addEventListener('click', fcgSyncFromPhone);
fcgSyncNote();
if (grLS('fcg-gset-day', '') !== fcgToday()) setTimeout(() => fcgGsetSoon(true), 8000);   // once a day, so the phone always finds the website's plan
const fcgFold = on => { FCG_IN.fold = !!on; fcgInSave(); $('fcg').classList.toggle('folded', !!on); document.querySelectorAll('#fcg .fcg-unfold').forEach(b => { b.hidden = !on; }); };
$('fcg-fold').addEventListener('click', () => fcgFold(true));
document.querySelectorAll('#fcg .fcg-unfold').forEach(b => b.addEventListener('click', () => fcgFold(false)));
// shown when the Forecast tab is on Graded cards > Forecasting: the graded data loads on first sight
// the filter buttons (Grading, the word buttons ...) are one set for the three pages: the bar moves to the page showing
function fcgMoveChips(m) {
  const card = $(m === 'rc' ? 'fcr-main' : m === 'pl' ? 'fcp-main' : 'fcg-main'), bar = $('fcg-gmode');
  if (card && bar && bar.parentNode !== card) card.insertBefore(bar, card.querySelector('.controls'));
}
function fcgShow() {
  fcgMeta();
  if ($('p-fc').hidden || NAV.fc !== 'graded') return;
  const m = fcgMode();
  if (m === 'hi') { fcgRegime(); grLoad().then(() => { fcgRegime(); fcgMeta(); }); return; }   // History: graded_fh.js draws it (its own wrapper of navApply / showTab); the market box wants the graded data
  fcgMoveChips(m);
  fcgRegime(); if (m === 'fc') fcgSummary(); grPaintGrades(GF.fc);
  grLoad().then(() => {
    grPaintTerms(GF.fc); grPaintGrades(GF.fc); fcgRegime(); fcgMeta();
    if (fcgMode() === 'fc') { tables.fcg.resync(); fcgColsApply('fcg'); tables.fcg.apply(); } else if (typeof fcrShowData === 'function') fcrShowData();
  });
}
function fcgModeClass() { const m = fcgMode(); ['fc', 'rc', 'pl', 'hi'].forEach(x => $('p-fc').classList.toggle('gm-' + x, x === m)); }
{ const na = navApply; navApply = function () { na.apply(this, arguments); fcgModeClass(); fcgDiscPaint(); fcgShow(); }; }
{ const st = showTab; showTab = function () { st.apply(this, arguments); fcgShow(); }; }
// the table scrolls in its own box (it is wider than the card; the header row sticks to the box's top): more rows as the
// box nears its bottom
document.querySelector('#fcg .wrap').addEventListener('scroll', e => {
  const w = e.currentTarget, t = tables.fcg;
  if (t && !$('more-fcg').hidden && w.scrollTop + w.clientHeight > w.scrollHeight - 600) t.renderMore();
}, {passive: true});
fcgInputsPaint();
fcgModeClass();
fcgShow();

/* ---- the help behind the page's ? buttons ---- */
Object.assign(HELP, {
  fcg_cap: {t: 'Capital to spend', f: 'the dollars the plan may spend at the vendor: the sum of the Buy prices of the slabs it buys', m: 'The plan buys in Best to Buy order (highest Chance first), at most the per-card share of this each and at most the copies per card, until the money runs out. Every listed slab is assumed for sale (a vendor\'s stock is not known in advance).', e: '$1,000 and 20% per card: at most $200 on any one slab.'},
  fcg_hold: {t: 'Hold for', f: '1 to 6 months: how long you keep a slab before selling it on eBay', m: 'The odds are specific to the hold: how lines of the same kind did over exactly that many months after a month at today\'s market level, 2022 on. In the research a 3-month hold was the one that held up under harder prices; a 1-month flip did not. The market box shows every kind of line at this hold.', e: 'Hold 6 months: the chances use what each kind of line did over six months.'},
  fcg_disc: {t: '% Under The Standard Grade Price', f: 'Buy price = standard price x (1 - this) - the eBay Shipping Fee', m: 'How far under the standard price (Card Ladder\'s: the middle of the grade\'s sales in the 30 days to the card\'s read, else 60 or 90) you pay the vendor. 14.1% by default: eBay\'s fee, so a slab bought 14.1% under whose price does not move nets $0 - the profit is the move over the hold, and anything you buy deeper under. The market box\'s last column follows this box.', e: 'Standard $200, 14.1% under, $5.20 shipping: pay at most $166.60.'},
  fcg_ship: {t: 'eBay Shipping Fee', f: 'what one sale costs to ship (label and supplies); $5.20 by default', m: 'Taken off the Buy price (what to pay the vendor) and paid again as the label when the slab sells, so it cancels out in Net: Net and Chance depend on the % under, the Buy price and ROI on the shipping too. The "Fees assumed" figure shows it.', e: 'Shipping $6 instead of $5.20: every Buy price drops 80 cents.'},
  fcg_price: {t: 'Card price between', f: 'only slabs whose standard price (Card Ladder\'s) is inside this range are listed', m: 'The band narrows the listing and the plan, on Forecasting, Recording and Purchases alike (a bought slab by the price it was bought at; its money stays spent). $50 to $5,000 by default.', e: '$100 to $1,000: the cheaper and the dearer slabs leave the list.'},
  fcg_share: {t: 'At most per card', f: 'copies of one slab x buy price stays under this share of the capital', m: 'Spreads the money over many slabs, as the raw tab does: picks are nearly independent, so twenty slabs are far safer than two.', e: '20% of $1,000: no single slab gets more than $200.'},
  fcg_copies: {t: 'Copies per card', f: 'the most copies of one slab the plan buys (1-5)', m: 'One by default, as the raw tab.', e: '2: the plan may buy two PSA 10s of the same card.'},
  fcg_gate: {t: 'Buy only when the market is green or amber', f: 'on (the default): nothing is bought while the graded market is red', m: 'Red = the graded index (the box below) is at or below the average of its 12 months before. Since 2022 slabs bought in red months lost money on average at every hold, whatever the line; in amber months the lines that pass the rules and the older eras were the dependable ones; green months were the best. Off: the plan buys in a red market too, with the red months\' odds.', e: 'Red market, switch on: every Buy is 0 and the summary says why.'},
  fcg_picks: {t: 'What to buy (graded)', f: 'every slab Card Ladder prices in your price band (each card at each PSA and CGC grade), assumed for sale, best chance first; the light green rows are the buys', m: 'The buttons above the table are the PriceCharting tab\'s (Grading, the word buttons, Flags, Unsure, PC Cert read, CL read, CL To PC Match), with settings of their own shared by Forecasting, Recording and Purchases (graded) - the search and the filter chips too; Filters… and Columns… and the headers work as on the other tabs; Columns… also lists every PriceCharting graded column but the eBay ones (off until you tick them), and which columns show is one choice for Forecasting, Recording, Purchases and the slab lists on History. The plan follows the rows on view: filter the list and the money goes to what is left. The summary\'s range and chance are for the whole basket (a simulation that draws each slab\'s outcome from the history of its kind of line).', e: 'Grading: PSA 10 only - the plan buys only PSA 10s.'},
  fcg_name: {t: 'PC Card Name', f: 'PriceCharting\'s name of the card, with its set and number under it', m: 'Not a link (Brett). Review compares it with Card Ladder\'s card; the prices are Card Ladder\'s page for it.', e: 'Umbreon VMAX #215 · Evolving Skies.'},
  fcg_grade: {t: 'Grade', f: 'the grader and grade of the row: one row per card per grade', m: 'Every PSA and CGC grade is its own line in the model, priced from Card Ladder\'s sales of that grade (CGC 10 Pristine and CGC 10 apart). A grade with fewer than 3 sales in the 90 days to the card\'s read has no standard price and is not listed.', e: 'PSA 9 and CGC 9 are two lines with their own prices and readings.'},
  fcg_std: {t: 'Standard Price', f: 'CL: the middle (Hodges-Lehmann) of Card Ladder\'s sales of the grade in the 30 days to the card\'s read (60 or 90 days when there are fewer than 3); PC: PriceCharting\'s price of the grade - reference only', m: 'The price a slab is bought under and sold at, and the one the chance, Net and ROI use (decision 1, 2026-11-05: the same comps a vendor sees on Card Ladder). ≠CLV marks a slab whose Card Ladder value is 25% or more away from it (hover for the value): at its top confidence the value is just the last sale, so check the recent sales. Sorting and the filter chip use the CL figure.', e: 'CL $185.00 / PC $200.00.'},
  fcg_buy: {t: 'Buy Price', f: 'Card Ladder\'s standard price x (1 - % under) - eBay Shipping Fee', m: 'The most to pay the vendor for the slab.', e: 'CL $200, 14.1% under, $5.20: $166.60.'},
  fcg_sold: {t: 'Sold (last month)', f: 'CL: Card Ladder\'s sales of the grade last month (hover: the 12 months to its read); PC: PriceCharting\'s recorded sales of the grade and grader last month - reference', m: 'How liquid the slab is - what you would sell against. A ~ marks PriceCharting\'s estimate (its list of sales does not reach back to the start of the month).', e: 'CL 12 / PC 9.'},
  fcg_hits: {t: 'Only Hits', f: 'on = only the green rows: the slabs the plan buys', m: 'One switch for Graded Forecasting and Recording (not on Purchases, where every row is bought). The plan is still worked out on every row the other filters and the boxes leave, best chance first; Only Hits then lists just its buys, and the count beside the search box says how many. The number on the button is the green rows at these settings.', e: '$1,000 at 14.1% under: Only Hits lists the 15 slabs the plan buys.'},
  fcg_qty: {t: 'QTY', f: 'how many copies the plan buys', m: 'Best to Buy order among the rows on view, only at or above your bar, never more than the copies per card or the per-card share, until the capital runs out; nothing while the market is red and the gate is on.', e: '1 on the first ten rows of a $1,000 plan.'},
  fcg_net: {t: 'Net', f: 'expected net per copy: Card Ladder\'s standard x ((1 + the average return of lines like it) x (1 - eBay\'s fee) - (1 - % under))', m: 'The average outcome of lines of the same kind over the hold after a month at today\'s market level (each return counted between -80% and +170%), after eBay\'s fee, the shipping and what you paid. An average: one slab\'s result is mostly the market\'s next months and the card\'s own luck - in the research an expected figure per slab was off by about 22 points on a single trade. Trust the Chance and its range more than this number; the summary\'s range shows the spread of the basket.', e: 'CL $200, average return +12% over 3 months, 14.1% under: +$20.61.'},
  fcg_roi: {t: 'ROI %', f: 'Net / Buy price, over the hold', m: 'What the money spent on the slab earns over the hold.', e: '+$20.61 on $166.60: +12.4%.'}
});
/* ---- the laid-out ? popups (2026-11-05, Brett: "the question mark explanations for these should be more descriptive and
   better and the formatting should look good"; renamed: Chance (this slab), Chance the plan profits, Buy only slabs with
   a chance of at least): md: 1 = help.js's markup (helpMd); now() = the Right now line, worked out when the popup opens ---- */
const fcgNowPct = v => v == null ? '-' : '<b class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + fcgPct(v) + '</b>';
const fcgHoldWord = h => h + '-month hold';
Object.assign(HELP, {
  fcg_regime: {t: 'The market now (graded)', md: 1, m: [
    '> The graded market’s level - green, amber or red - read at the end of the last complete month. It decides two things: whether the plan may buy at all, and which history every Chance is read from.',
    '## How it’s worked out',
    '1. **The index.** Every Card Ladder line (one card at one PSA or CGC grade) at least 12 months past its release, with 5+ sales this month and last, priced $50 or more: its move in the month. The middle (median) of those moves is the market’s move for the month; chained month to month it is the index.',
    '2. **Against its own year.** The index divided by the average of its 12 months before. At or below that average: **red**.',
    '3. **Is it overheated?** The heat score: four gauges, each ranked against every month up to then (0 = the calmest so far, 1 = the hottest) and averaged - how scattered the month’s moves were, the share of lines at a 12-month high, sales against their 12-month average, the index’s own move in the month. 0.70 or more = hot.',
    '4. **Are there clean lines?** Of the busy seasoned PSA lines ($100+, 10+ sales in the month), the share that pass the three line rules (see Chance). Under 40% = few.',
    '- **Green:** above its 12-month average, not hot, 40%+ of lines pass.',
    '- **Amber:** above, but hot or few pass. The plan still buys, with amber months’ odds.',
    '- **Red:** at or below the average. With “Buy only when the market is green or amber” on, nothing is bought.',
    '## What each level was followed by',
    'Busy seasoned PSA lines $100+, bought the month after at 14% under and sold 3 months later, 2022 to mid 2026 (the research round of 2026-11-22):',
    '| Level | Months | Average net | Trades that made money |',
    '|---|---|---|---|',
    '| Green | 8 | +34% | 91% (a profit in 8 of 8 months) |',
    '| Amber | 17 | +5.5%; lines that pass the rules +12% | 51%; lines that pass 71% |',
    '| Red | 30 | −4% | 35% (a profit in 8 of 30 months) |',
    '## The table',
    'What each kind of line did at your Hold after a month at today’s level: the middle move, and how often one bought at your % under made a profit, with its range. Newer = Modern / Contemporary PSA; Vintage and Classic / Mid = those eras’ PSA lines; 10+ and 3–9 are the line’s sales in the month.',
    '## Keep in mind',
    '- All of it comes from one fall (2022-23) and one rise (2024-26), and the levels and rules were chosen on that same history: read the past results as upper bounds.',
    '- Amber does not mean stay out. Green months came as short windows - one to three months, about eight months apart.',
    '- The level is late at turns: it said red through the first two strong months of 2024.',
    '- Card Ladder’s own sales (every platform), as of each card’s read. PriceCharting plays no part.'].join('\n'),
    now: () => { const D = fcgDoc(); if (!D) return ''; const L = D.level, col = L.now === 'green' ? ' class="up"' : L.now === 'red' ? ' class="down"' : ' style="color:#d97706"';
      return '<b' + col + '>' + L.now + '</b>: ' + fcgLevelWhy(L) + ' · index ' + fcgNowPct(L.vs12) + ' against its 12-month average · heat ' + (L.heat == null ? '-' : L.heat.toFixed(2)) + ' · ' + Number(L.n_pass || 0).toLocaleString('en-US') + ' of ' + Number(L.n_gated || 0).toLocaleString('en-US') + ' lines pass <span class="dim">(data month ' + esc(D.month || '') + ')</span>'; }},
  fcg_chance: {t: 'Chance (this slab)', md: 1, m: [
    '> How often lines like this one made money in the past: after a month at today’s market level, the same kind of line, held as long as your Hold, bought at your % under. The small figures under it are its range.',
    '## How it’s worked out',
    '1. **The market’s level** today: green, amber or red (see The market now).',
    '2. **The kind of line** the slab’s line is (the table below), and whether it is busy (10+ sales last month) or thin (3 to 9).',
    '3. **Pick the history:** every case since 2022 of that kind of line after a month at that level - decided at the month’s end, bought at the NEXT month’s price (never the month’s own), sold at the price your Hold later. Lines $50+, one per Card Ladder page and grade. A kind with under 30 cases, or seen in fewer than half of that level’s months: the level’s seasoned PSA lines together.',
    '4. **The break-even return** at your % under:',
    '   `break-even = (1 − % under) ÷ (1 − 14.1% fee) − 1`',
    '5. **Chance = the share of those cases that beat the break-even.** At most 85% (“the most shown” under it when even the low end of the range is there).',
    '6. **The range:** the same share with the months behind it drawn again 200 times (the 5th to the 95th percentile). Few months behind a kind of line = a wide range.',
    '## The kinds of line',
    '| Kind | What it is |',
    '|---|---|',
    '| new card | a card under 12 months since its release, any grader |',
    '| CGC | a CGC line |',
    '| passes the rules | Modern / Contemporary PSA: not extended (up 16%+ on last month, or 28%+ above its own 6-month average), not still falling (down 7%+ on last month, or the second half of the month 7% under the first), its segment (era × PSA 10 / below 10) not up 22%+ in 3 months |',
    '| fails a rule | Modern / Contemporary PSA with one of those three |',
    '| Vintage | Vintage PSA: in the older eras the three rules did not separate good buys from bad; the market’s level does |',
    '| Classic / Mid Era | Classic or Mid Era PSA: as Vintage, but measured apart - these two eras moved about twice as far as Vintage in the rise |',
    'The PSA kinds are measured apart for busy and thin lines: a rule read off a thin month’s price says less.',
    '## What the break-even means',
    '| You buy at | The price must move at least |',
    '|---|---|',
    '| 0% under | +16.4% |',
    '| 10% under | +4.8% |',
    '| 14.1% under | 0%: it just can’t fall |',
    '| 20% under | −6.9%: it can fall a little |',
    '## What changed on 2026-11-23',
    'The Chance used to follow the dip rank: how far a price sat below its own 12-month level. Measured from a price one could really have paid - the month after the dip - the deepest dips did worse than the rest, and a quarter to a third of them were new releases still falling. The rank no longer scores or orders anything. Its opposite end is kept as a warning: a line far above its own level is marked **extended**.',
    '## Keep in mind',
    '- Every slab of the same kind at the same % under gets the same chance. Best to Buy orders them by the tie-breaker; Best Chance shows the ties.',
    '- Why 85% at most: the best past figures (green months) rest on eight or nine months of one boom, and in earlier tests groups that claimed 70–80% delivered under 60% on years they had not seen.',
    '- A line with under 3 sales in each of the last two months cannot be read; in the newer eras it is counted with the lines that fail a rule.',
    '- **Beyond history:** when a line’s era has risen more in 3 months than any era of its side (older / newer) did in the months the odds were measured on, there is no past like it, and no Chance is shown - the slab gets no place and no money. The market box names the eras; the Chance comes back by itself when the run cools.',
    '- On Recording and Purchases each row uses its own % under, so the chance follows the price you type.',
    '- The history is Card Ladder’s own sales; PriceCharting plays no part in it.'].join('\n'),
    now: () => { const D = fcgDoc(), I = fcgInputs(), fee = fcgFee(); if (!D) return '';
      const be = fcgBreak(I.disc, fee), lv = fcgLevel(D), out = [];
      for (const [g, name] of FCG_KINDS) { const t = D.tables[I.h + '|' + lv + '|' + g]; if (t) { const c = fcgChance3(D, t, be); out.push(name.toLowerCase() + ' <b>' + Math.round(c[0] * 100) + '%</b> <span class="dim">' + Math.round(c[1] * 100) + '–' + Math.round(c[2] * 100) + '</span>'); } }
      return 'at a ' + fcgHoldWord(I.h) + ', ' + fcgDiscWord(I.disc) + ' under, ' + lv + ' market: ' + out.join(' · '); }},
  fcg_mc: {t: 'Chance the plan profits', md: 1, m: [
    '> The chance that the slabs together - the green rows (on Recording and Purchases, the bought ones too) - end your Hold with more money than they cost, after eBay’s fee and the shipping.',
    '## How it’s worked out',
    '1. **Take the slabs** and their copies.',
    '2. **Simulate 2,000 possible futures.** In each: one “market luck” number shared by every slab, plus one “own luck” number per slab, mixed half and half:',
    '   `luck = √0.5 × market + √0.5 × own`',
    '   The luck becomes a percentile, and the slab’s return is read at that percentile from the history of its kind of line (the market’s level, your Hold).',
    '3. **Add up the net in that future:**',
    '   `net = Σ copies × standard × [(1 + return) × (1 − fee) − (1 − % under)]`',
    '4. **Read the 2,000 results:**',
    '- **Chance the plan profits:** the share above $0 (at most 85%).',
    '- **Expected net profit:** their average.',
    '- **Likely range:** the 10th to the 90th percentile, with the median.',
    '## What it means',
    'The half-and-half mix makes slabs rise and fall together, like a real market: when it sours most picks lose at once. So more slabs raise this chance only up to a point, and it is not simply higher than each slab’s own chance.',
    '## Keep in mind',
    '- The 50% market share is borrowed from the raw tab; it wasn’t measured on graded cards.',
    '- The draws start from the same seed every time, so the same settings always give the same number.',
    '- Chance (this slab) is the column; this is the whole plan.'].join('\n'),
    now: () => { const m = fcgMode(), A = m === 'rc' ? FCR.res.rc : m === 'pl' ? FCR.res.pl : null, mc = A ? A.mc : FCG.mc, n = m === 'fc' ? (FCG.picks || []).length : A ? (m === 'rc' ? A.boughtV.length + A.green.length : A.view.length) : 0;
      if (!mc) return 'no slabs to count on this page at these settings';
      return n + ' slab' + (n === 1 ? '' : 's') + ': chance <b>' + Math.round(mc.p * 100) + '%</b> · expected ' + fcMoney(mc.mean) + ' · likely ' + fcMoney(mc.lo) + ' to ' + fcMoney(mc.hi); }},
  fcg_conf: {t: 'Buy only slabs with a chance of at least …', md: 1, m: [
    '> The bar: a slab gets money only when its Chance (this slab) is at least this. Slabs under it stay listed, in order, but aren’t green.',
    '## How the plan spends',
    '1. **Order the slabs on view** best to buy first: Chance (to the whole percent), then the tie-breaker, then the higher price. That order is the Best to Buy column.',
    '2. **Skip what doesn’t qualify:** a Chance under the bar, or no buy price.',
    '3. **Decide the copies** of each one that does: the smallest of',
    '   `(capital × per-card share) ÷ buy price`',
    '   `copies per card`',
    '   `money left ÷ buy price`',
    '   … and go on down the list until the money runs out.',
    '4. **The gate comes first:** in a red market with “Buy only when the market is green or amber” on, nothing is bought, whatever the bar.',
    '## What it means in practice',
    'Every slab of the same kind of line shares one chance at a given hold and % under, so the bar really decides which kinds qualify. Example in an amber month, bar 50%: a Vintage line at 80% and a newer line that passes the rules at 68% get money; a busy newer line that fails a rule at 43% and a new card at 23% don’t. Buying deeper under raises every chance.',
    '## Keep in mind',
    '- A higher bar buys fewer, surer slabs; a lower one spreads the money wider. No Chance is shown above 85%, so the bar stops there.',
    '- On Recording each row has its own % under, so a vendor’s price can lift a slab over the bar.'].join('\n'),
    now: () => { const I = fcgInputs(); return 'bar <b>' + Math.round(I.minp * 100) + '%</b> · on Forecasting ' + Number(FCG.elig || 0).toLocaleString('en-US') + ' slab' + (FCG.elig === 1 ? '' : 's') + ' on view clear it' + (FCG.gated ? ', but the gate is red: nothing is bought' : '; the plan buys ' + (FCG.picks || []).length); }},
  fcg_bb: {t: 'Best to Buy', md: 1, m: [
    '> The slab’s place in the buy order: 1 is the slab the plan would spend on first.',
    '## How it’s worked out',
    '1. **Every slab with a chance** on the page (Forecasting: inside your price band; Recording: every open and Yes row) is put in order:',
    '- highest Chance (this slab), to the whole percent, first',
    '- then the higher tie-breaker',
    '- then the higher price',
    '2. **Number them** 1, 2, 3 …',
    '## What it means',
    'It is exactly the order the money goes in, so the green rows are the top places the capital reaches. Sort by it to see the best to buy first: Recording opens that way.',
    '## Keep in mind',
    '- It doesn’t depend on the capital, the per-card share, the copies, the bar or the gate; those only decide which places turn green.',
    '- It does depend on the Hold and the % under, because the Chance does. On Recording a vendor’s price can move a row up or down.',
    '- The number ignores the filters, so a slab keeps its place while you search.',
    '## The tie-breaker',
    'Two readings of the line, each ranked inside its month and its segment (era × grader × 10 / below 10) and added: the card’s other grades rose more than this one over the last 3 months (it tends to catch up), and a clean month (its sales close together). On busy lines the top fifth beat the bottom fifth by about 4 points over 3 months (ahead in 43 of 54 months); on thin lines by about 2. Small next to the market’s level: it orders slabs with the same Chance, it does not move the Chance.',
    '- The research’s third term (the slab cheap against the raw card) needs PriceCharting’s raw price and is left out: the forecast runs on Card Ladder alone.',
    '- Until 2026-11-23 the order inside a Chance was the deeper dip first; that did not hold up from a price one could really pay.'].join('\n'),
    now: () => { const r = (FCG.rows || []).find(x => x.fcBB === 1); return r ? 'number 1 on Forecasting: <b>' + esc(r[1]) + '</b> ' + esc(r[25]) + ' at ' + Math.round(r.fcP) + '%' : ''; }},
  fcg_bc: {t: 'Best Chance', md: 1, m: [
    '> The slab’s place by Chance (this slab) alone. Slabs with the same chance share the place, shown with “=”.',
    '## How it’s worked out',
    '1. **Order by Chance**, to the whole percent, highest first.',
    '2. **Ties share a place:** if five slabs are at 62% and they come first, all five are 1=, and the next slab is 6.',
    '## What it means',
    'It shows honestly how many slabs the model sees as equally good: every slab of the same kind of line at the same % under. Many ties at the top mean the choice among them comes from something else: the tie-breaker, the price, or what you know about the card.',
    '## Keep in mind',
    '- Best to Buy breaks the ties (the tie-breaker, then the higher price); this column doesn’t.',
    '- Like Best to Buy, it ignores the filters and the capital, and follows the Hold and the % under.'].join('\n'),
    now: () => { const r = (FCG.rows || []).find(x => x.fcBC === 1); return r ? 'the top chance on Forecasting is <b>' + Math.round(r.fcP) + '%</b>, shared by ' + r.fcBCn + ' slab' + (r.fcBCn === 1 ? '' : 's') : ''; }},
  fcg_sync: {t: 'Sync from phone', md: 1, m: [
    '> Copies the phone app’s Your Plan into these boxes, so this page plans with the same numbers the phone used at the show.',
    '## What is copied',
    '- Capital, Hold, % under (Forecasting’s and Recording’s), the shipping, the share a slab may take, the chance bar and the market gate.',
    '- The price band and the copies are the website’s own; the phone’s minimum sales last month has no box here yet.',
    '## How long',
    '- The copied boxes keep the phone’s values through a refresh until midnight, then go back to what they were.',
    '- A copied box you change by hand is yours again at once.',
    '## The other way',
    'Every change here is sent to the collector too, so the app’s **Sync from website** button can copy this plan onto the phone.'].join('\n')},
  fcg_spot: {t: 'Add to Pre-Sales Spotcheck', md: 1, m: [
    '> Sends the green rows of this page to History › Pre-Sales Spotcheck, where each slab is looked back on with the model, month by month since 2022.',
    '## What is sent',
    '- Every green row: the slab, its % under and price, its chance and its line’s reading today.',
    '- The settings of the moment: your Hold, the bar, the gate, the shipping, eBay’s fee.',
    '- Each click makes a new set, dated, from Forecasting or Recording.',
    '## What you get',
    'For each slab and each hold: how many times the model would have bought it since 2022, how many of those made money, and the ROI it expected against the ROI it made. Before you buy, it shows how the model has done on these exact cards.',
    '## Keep in mind',
    '- The sets are kept by the collector, so they show on every device a minute or two after sending.',
    '- A slab on a card Card Ladder has not read can’t be looked back on yet.'].join('\n'),
    now: () => { const m = fcgMode(), n = m === 'rc' ? ((FCR.res.rc || {}).green || []).length : m === 'fc' ? (FCG.picks || []).length : 0; return n ? '<b>' + n + '</b> green row' + (n === 1 ? '' : 's') + ' on this page would be sent' : 'no green rows on this page at these settings'; }}
});
