/* ---------------- Forecast > Graded cards > History (2026-11-04, Brett; first the Forecast History tab's Graded cards) ----------------
   "The capital and % under will simply draw from the variables in the graded forcasted page. For the circled green, we
   should show 1-month, 2, 3, 4, 5, and 6-month. In each month, I think all we need to show is mean roi for each and mean
   chance. For the column headers, lets show all 6. give the option to hide them and have a column toggle feature ...
   change that to reflect the record this plan button derived from the graded>planning section. We should add a purchased
   column indicating how much capital was spent, a date of purchase column. Then when I click on it, it should show the
   plan I recorded ... If I click it again then it closes ... the same columns as planning, but for each individual
   listing. Also include a favorites button column, and review button column"; "if forcasting page was set to 2-month
   hold, then the recorded plan should assume 2-month. the month hold should also be specified in a column"; "it is 6
   hold groups per plan"; "lets just assume PC price".
   THE REPLAY RUNS THE MODEL OF 2026-11-23 (graded_fc.js: the market's level, the kind of line, the hold): graded_hist.bin
   v3 carries each month's level (lv, up = not red, vs12), the odds of each cell known then (tab[month][hold - 1][cell] =
   [mean, 5% .. 95% grid]; first = the whole period's stood in), and the month's candidates by cell and grade in
   tie-breaker order: [card id, line index, the price bought at - the NEXT month's -, code (fcgSigOf), the return 1..6
   months after the buy x 1000, sales that month]. What follows describes the file before that day.
   The replay: graded_hist.bin (graded_forecast.build_hist) - every month since 2022 its best-ranked PriceCharting graded
   lines, the odds each group would have shown that month (only outcomes known by then; 2022 has too few, so it borrows
   the whole period's, marked *) and what each line did over the next 1..6 months. Graded Forecasting's plan is run on
   each month here, in the page, with that page's boxes (capital, % under, shipping, the price band, the share, the bar,
   the copies, the gate) and its Grading ticks, then scored at PriceCharting's price when the hold was up.
   The recorded plans: Graded > Planning's Record plan, kept by the collector (live.gplans); Actual = the slabs sold at
   PriceCharting's price of the month each hold ends (today's price while that month is still running).
   ON CARD LADDER SINCE 2026-11-06 (Brett, 2026-11-05): the replay is Card Ladder's (graded_forecast.py v2: every PSA and
   CGC grade a line of its own, lines = grade keys); Recorded Purchases' Actual and Pre-Sales Spotcheck use each line's
   own month-by-month figures from the model (the trend file's cf: the price then, the buy price, the month's median, the
   sales), so a slab is looked back exactly as the replay does. A plan recorded before the switch (its model is
   PriceCharting's) froze PriceCharting's price as std and Card Ladder's value as stdc; one after, Card Ladder's
   standard as std and PriceCharting's price as stdc - fhrBasis() tells them apart. */
const FHG = {doc: null, err: null, loaded: null, key: '', cells: null, todo: 0, busy: null, open: new Set(), trendBusy: false, trendMiss: new Set(),
  win: ['rp', 'rec', 'sc'].includes(grLS('fhg-win', 'rp')) ? grLS('fhg-win', 'rp') : 'rp'};   // History's window: Forecasting Replay / Recorded Purchases / Pre-Sales Spotcheck
const FHG_LINE = {psa_10: 'PSA 10', grade_9_5: 'Grade 9.5', grade_9: 'Grade 9', grade_8: 'Grade 8', grade_7: 'Grade 7'};
const fhgLineName = l => FHG_LINE[l] || (/\|/.test(String(l)) ? grLabel(l) : String(l));
// a line's month-by-month figures from the model (trend file cf[gk] = [first YYYY-MM, price then, buy, month's median,
// sales, the line's reading that month - graded_forecast.month_codes: cell + 16 x (1 extended, 2 still falling, 4 its
// segment ran, 8 beyond the history then), -1 none]): {ym: {p, buy, w, n, c}}; undefined while the trend file loads, null
// when none, 'old' before the Card Ladder build (and before the model of 2026-11-23: no readings in it)
function fhCf(cid, gk) {
  const tr = GR.trend.get(+cid);
  if (!tr) { if (!FHG.trendMiss.has(+cid)) { fhrWantTrend(+cid); return undefined; } return FHG.trendBusy ? undefined : null; }
  if (!tr.cf) return 'old';
  const x = tr.cf[gk]; if (!x) return null;
  const m = new Map(); let i = fhsYi(x[0]);
  for (let k = 0; k < x[1].length; k++, i++) m.set(fhsYm(i), {p: x[1][k], buy: x[2][k], w: x[3][k], n: x[4][k], c: x[5] ? x[5][k] : null});
  m.codes = !!x[5];
  return m;
}
async function fhgLoad() {
  const b = Math.floor(Date.now() / 3600000);
  if (FHG.loaded === b) return;
  FHG.loaded = b;
  try {
    if (!HKEY) throw new Error('This page has no key for the graded data yet.');
    const res = await fetch('graded_hist.bin?t=' + b, {cache: 'no-store'});
    if (!res.ok) throw new Error(res.status === 404 ? 'The graded replay is not in this build yet - it is made with the graded data each morning.' : 'HTTP ' + res.status);
    const doc = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
    if (!doc || !doc.months || !doc.cands) throw new Error('not a graded replay file');
    if (doc.v !== 3 || !doc.lv) throw new Error('The replay in this build still runs the model before 2026-11-23: the new one arrives with the next site build.');
    FHG.doc = doc; FHG.err = null; FHG.key = ''; FHG.cells = null;
  } catch (e) { FHG.err = e.message; }
  fhgRender();
}
/* ---- THE THREE WINDOWS ON ONE PATTERN (2026-11-23, Brett: "all I really care about ... is the predicted ROI as a column, the
   predicted net as a column, and then the actual ROI, and then the actual net"; "I want them to be kind of similar in terms of
   format, similar columns ... and simplify things"; "maybe when I click on a card and I see it by month, I see a pop up of it,
   because otherwise it just gets very cluttered"; "for the predicted ... we'll have the predicted value and then the predictive
   range"): each window shows ONE hold at a time - History's Hold buttons are Your plan's Hold for -, a row per month (Forecasting
   Replay), per record (Recorded Purchases) or per set (Pre-Sales Spotcheck) with the same five figures: Predicted Net, ROI and
   Range, Actual Net and ROI. A row opened lists its cards with the same five; a card opens a pop-up with its months. The replay
   picks each month's own cards with the model as it stood then (today's list is never used for a past month); the other two
   keep the same cards throughout. ---- */
// Graded Forecasting's boxes and Grading ticks, as the replay uses them
function fhgSettings() {
  const I = fcgInputs(), lines = new Set();
  for (const gk of GF.fc.gsel) { const l = FCG_LINE(gk); if (l && FHG.doc) { const i = FHG.doc.lines.indexOf(l); if (i >= 0) lines.add(i); } }
  return Object.assign({}, I, {fee: fcgFee(), lines});
}
const fhgKey = S => JSON.stringify(Object.assign({}, S, {lines: [...S.lines].sort()})) + '|' + (FHG.doc ? FHG.doc.t : '');   // the shown hold only
const fhgQ = (t, p) => t.q[Math.round(p * 20) - 1];       // the replay's grids run 5% .. 95%: the p-quantile (0.1 -> t.q[1], 0.9 -> t.q[17])
// one month's plan at one hold: the candidates through the boxes (the minimum ROI / net per slab too), chance at the
// break-even, buy order, the greedy allocation; each pick also carries its own range (the 10% to 90% of its kind's grid)
function fhgPlan(mi, h, S) {
  const doc = FHG.doc, QD = {qs: doc.qs}, tabs = doc.tab[mi][h - 1], be = fcgBreak(S.disc, S.fee), rows = [], ts = {}, cap = doc.cap || 0.85;
  for (const c of doc.cands[mi]) {
    const li = c[1], std = c[2];
    if (!S.lines.has(li) || std < S.pmin || std > S.pmax) continue;
    const buy = std * (1 - S.disc) - S.ship; if (!(buy > 0)) continue;
    if (!fcgSalesOk(c[10], S)) continue;                              // fewer Card Ladder sales THAT month than your minimum
    const sg = fcgSigOf(c[3]); if (sg.f & FCG_F.beyond) continue;      // beyond the history as it read that month: no Chance, no money
    const g = sg.g, grid = tabs[g]; if (!grid) continue;
    const t = ts[g] || (ts[g] = {mean: grid[0], q: grid.slice(1)});
    const en = fcgNet(std, t.mean, S.disc, S.fee);
    if (!fcgMinOk(en, en / buy, S)) continue;                          // under your minimum ROI / net per slab that month
    const y = c[4 + h - 1];
    rows.push({cid: c[0], li, std, pct: sg.tb == null ? -1 : sg.tb, g, t, buy, en, lo: fcgNet(std, fhgQ(t, 0.1), S.disc, S.fee), hi: fcgNet(std, fhgQ(t, 0.9), S.disc, S.fee),
               p: Math.min(cap, 1 - fcgCdf(QD, t, be)), y: y == null ? null : y / (doc.yscale || 1000), q: 0});
  }
  rows.sort((a, b) => Math.round(b.p * 100) - Math.round(a.p * 100) || b.pct - a.pct || b.std - a.std);   // Best to Buy's order: Chance, the tie-breaker, the price
  const gated = !!(S.gate && !doc.up[mi]), elig = rows.filter(r => r.p >= S.minp);
  let left = S.cap;
  if (!gated) for (const r of elig) { const q = Math.min(Math.floor(S.cap * S.share / r.buy), S.copies, Math.floor(left / r.buy)); if (q > 0) { r.q = q; left -= q * r.buy; } }
  return {picks: elig.filter(r => r.q > 0), spent: S.cap - left, gated, best: rows.reduce((b, r) => Math.max(b, r.p), 0), n: rows.length};
}
// a hold decided in month mi is over when the month it is sold in is complete: bought the month after, sold h months on
const fhgDone = (mi, h) => mi + 1 + h <= FHG.doc.months.length - 1;
function fhgCell(mi, h, S) {
  const doc = FHG.doc, P = fhgPlan(mi, h, S), picks = P.picks, done = fhgDone(mi, h);
  const c = {n: picks.length, copies: picks.reduce((s, r) => s + r.q, 0), spent: P.spent, gated: P.gated, best: P.best, done,
             picks: picks.map(r => [r.cid, r.li, r.std, r.buy, r.q, r.p, r.en, r.y, r.lo, r.hi])};
  if (!picks.length) return c;
  const mc = fcgMonteCarlo({qs: doc.qs, cap: doc.cap || 0.85}, picks.map(r => ({fcQ: r.q, fcS: r.std, fcT: r.t, fcD: S.disc})), S, S.fee, 1000);
  Object.assign(c, {exp: mc.mean, lo: mc.lo, hi: mc.hi, p: mc.p});
  const priced = picks.filter(r => r.y != null);
  if (done && priced.length) {
    const spent = priced.reduce((s, r) => s + r.q * r.buy, 0);
    c.actual = priced.reduce((s, r) => s + r.q * fcgNet(r.std, r.y, S.disc, S.fee), 0); c.roi = spent ? c.actual / spent : null;
    c.inside = c.actual >= mc.lo && c.actual <= mc.hi; c.priced = priced.length;
  }
  return c;
}
// the months' cells at the shown hold, a slice at a time between frames (each runs a 1,000-draw basket)
function fhgRun() {
  if (!FHG.doc) return;
  const S = fhgSettings(), key = fhgKey(S);
  if (FHG.key === key && FHG.cells && !FHG.todo) return;
  if (FHG.busy && FHG.busy.key === key) return;
  const doc = FHG.doc, M = doc.months.length, h = S.h, cells = new Array(M).fill(null), job = FHG.busy = {key, i: 0};
  FHG.key = key; FHG.cells = cells; FHG.h = h; FHG.todo = M;
  const step = () => {
    if (FHG.busy !== job) return;
    const t0 = performance.now();
    while (job.i < M && performance.now() - t0 < 40) { cells[job.i] = fhgCell(job.i, h, S); job.i++; }
    FHG.todo = M - job.i;
    const note = $('fhg-run'); if (note) note.textContent = FHG.todo ? 'Running the plans… ' + job.i + ' of ' + M : '';
    if (FHG.todo) setTimeout(step, 0); else { FHG.busy = null; fhgPaint(); }
  };
  setTimeout(step, 0);
}
/* ---- the five figures, the same in the three windows, their opened rows and the pop-up ---- */
const fhDash = '<span class="dim">-</span>';
const fhCls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const fhLevel = lv => '<b class="fc-light fc-light-' + esc(lv) + '">' + esc(lv) + '</b>';
const fhMonthWord = ym => MONTHS_S[+String(ym).slice(5, 7) - 1] + ' ' + String(ym).slice(0, 4);
// P = {net, roi, lo, hi} (lo / hi may be null) or null; A = {net, roi, tip, mark} or {msg}; money = fcMoney (plans) or fcMoney2 (a slab)
function fhCells(P, A, money) {
  const td = (s, tip) => '<td class="num"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + s + '</td>';
  let s = P ? td(money(P.net)) + td(fcPct(P.roi, 1)) + td(P.lo == null ? fhDash : '<span class="dim">' + money(P.lo) + ' to ' + money(P.hi) + '</span>') : td(fhDash) + td(fhDash) + td(fhDash);
  if (A && A.net != null) {
    const inside = P && P.lo != null ? A.net >= P.lo && A.net <= P.hi : null;
    const mark = A.mark != null ? ' <span class="dim fh-mark">' + esc(A.mark) + '</span>' : inside == null ? '' : inside ? ' <span class="dim fh-mark">in range</span>' : ' <span class="down fh-mark">outside</span>';
    s += td('<b class="' + fhCls(A.net) + '">' + money(A.net) + '</b>' + mark, A.tip) + td('<b class="' + fhCls(A.roi) + '">' + fcPct(A.roi, 1) + '</b>');
  } else s += td('<span class="dim">' + esc((A && A.msg) || '-') + '</span>') + td(fhDash);
  return s;
}
// the four boxes over a window's results: how many, the predicted and the actual on average, how often inside the range
function fhStats(L, o) {
  const n = L.length, avg = k => n ? L.reduce((s, x) => s + x[k], 0) / n : null, money = o.money || fcMoney;
  const ins = L.filter(x => x.lo != null && x.hi != null && x.an >= x.lo && x.an <= x.hi).length, ar = avg('ar');
  const box = (k, v, d, cls) => '<div class="stat"><div class="k">' + k + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div><div class="d">' + d + '</div></div>';
  return '<div class="stats fc-stats fh-stats">' + box(esc(o.what), String(n), esc(o.of || '')) +
    box('Predicted, average ' + o.one, n ? fcPct(avg('pr'), 1) : '-', n ? money(avg('pn')) + ' net' : '') +
    box('Actual, average ' + o.one, n ? fcPct(ar, 1) : '-', n ? money(avg('an')) + ' net' : '', n ? fhCls(ar) : '') +
    box('Actual inside the predicted range', n ? ins + ' of ' + n : '-', esc(o.unit)) + '</div>';
}
const fhgName = cid => { const r = idRow.get(+cid); return r ? [r[1], String(r[2] || '').replace(/^Pokemon /, '')] : ['card ' + cid, '']; };   // the catalog's name and set
function fhCardName(cid, gk) {                            // a slab's card name, set (and number) and grade, as the graded pages show them
  const base = GR.doc ? fcrMap().get(cid + '|' + gk) : null;
  const no = base && base[3] && !String(base[1] || '').includes('#' + base[3]) ? ' · #' + base[3] : '';   // the number once: most names carry it already
  const nm = base ? [base[1], String(base[2] || '').replace(/^Pokemon /, '') + no] : fhgName(cid);
  return {name: nm[0], set: nm[1], grade: base ? base[25] : grLabel(gk)};
}
// a card row of an opened row: the name opens its pop-up (the % under, shipping and fee it is looked back with ride on the button)
function fhCardRow(k, P, A) {
  const N = fhCardName(k.cid, k.gk);
  return '<tr><td class="fh-cardc"><button type="button" class="fhc-open" data-cid="' + esc(k.cid) + '" data-gk="' + esc(k.gk) + '" data-d="' + k.d + '" data-ship="' + k.ship + '" data-fee="' + k.fee + '" title="This card month by month">' + esc(N.name) + '</button>' +
    '<br><span class="dim">' + esc(N.set) + ' · </span><b>' + esc(N.grade) + '</b>' + (k.down ? '<span class="dim" title="' + esc('No Card Ladder line of its own for this half grade: looked back on as ' + grLabel(k.down) + ' (rounded down)') + '"> as ' + esc(grLabel(k.down)) + ' ↓</span>' : '') +
    (k.sub ? '<span class="dim"> · ' + esc(k.sub) + '</span>' : '') + (k.html || '') + '</td>' + fhCells(P, A, fcMoney2) + '</tr>';
}
const fhCardTable = (rows, first) => '<table class="fhd"><thead><tr class="grp"><th></th><th colspan="3" class="band">Predicted</th><th colspan="2" class="band">Actual</th></tr>' +
  '<tr><th>' + (first || 'Card') + '</th><th class="num">Net</th><th class="num">ROI</th><th class="num">Range</th><th class="num">Net</th><th class="num">ROI</th></tr></thead><tbody>' + rows + '</tbody></table>';
// the Hold buttons (History's and the pop-up's): Your plan's Hold for
const fhHoldBar = () => { const h = fcgInputs().h; return '<span class="fh-hold"><b>Hold</b><span class="fh-seg" role="group" aria-label="Hold in months">' + [1, 2, 3, 4, 5, 6].map(k => '<button type="button" data-fhh="' + k + '"' + (k === h ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + k + ' mo</button>').join('') + '</span></span>'; };
function fhSetHold(h) { const sel = $('fcg-h'); if (!sel || +sel.value === h) return; sel.value = String(h); fcgChanged(); if (FHC.k) fhcPaint(); }
/* ---- the replay's rows: one per month, newest first, at the shown hold ---- */
function fhgCards() {
  const box = $('fhg-cards'); if (!box) return;
  if (!FHG.doc || !FHG.cells || FHG.todo) { box.innerHTML = ''; return; }
  const cs = FHG.cells.filter(c => c && c.n), done = cs.filter(c => c.roi != null), red = FHG.cells.filter(c => c && c.gated).length;
  box.innerHTML = fhStats(done.map(c => ({pn: c.exp, pr: c.spent ? c.exp / c.spent : 0, an: c.actual, ar: c.roi, lo: c.lo, hi: c.hi})),
    {what: 'Months with a result', of: 'of ' + cs.length + ' with buys' + (red ? ' · ' + red + ' red months sat out (the gate)' : ''), one: 'month', unit: 'months'});
}
function fhgRowsData() {
  if (!FHG.doc || !FHG.cells || FHG.todo) return [];
  const doc = FHG.doc, out = [];
  for (let mi = doc.months.length - 1, o = 0; mi >= 0; mi--, o++) {
    const c = FHG.cells[mi] || {}, r = [o];
    r.mi = mi; r.m = doc.months[mi]; r.g = doc.lv[mi]; r.c = c;
    r.pn = c.n ? c.exp : null; r.pr = c.n && c.spent ? c.exp / c.spent : null; r.lo = c.n ? c.lo : null; r.an = c.actual == null ? null : c.actual; r.ar = c.roi == null ? null : c.roi;
    out.push(r);
  }
  return out;
}
function fhgRow(r) {
  const doc = FHG.doc, c = r.c, first = doc.first && doc.first[r.mi];
  const sub = !c.n ? (c.gated ? 'market red: the gate keeps the plan out' : 'no slab cleared your boxes' + (c.best ? ' · best chance ' + Math.round(c.best * 100) + '%' : ''))
    : c.n + ' slab' + (c.n > 1 ? 's' : '') + (c.copies !== c.n ? ' (' + c.copies + ' copies)' : '') + ' · ' + fcMoney(c.spent) + ' spent';
  const A = !c.n ? {msg: ''} : c.actual != null ? {net: c.actual, roi: c.roi, tip: c.priced < c.n ? c.priced + ' of the ' + c.n + ' slabs had a Card Ladder price when the hold was up' : ''} : {msg: c.done ? 'no price' : 'hold not up yet'};
  return '<td><span class="fh-tw"></span><b>' + esc(r.m) + '</b> ' + fhLevel(r.g) + (first ? ' <span class="dim" title="Too few outcomes at this market level were known yet that month: the odds of the whole period stand in (hindsight - the predictions here look ahead)">*</span>' : '') +
    '<br><span class="dim fh-sub">' + esc(sub) + '</span></td>' + fhCells(c.n ? {net: c.exp, roi: c.spent ? c.exp / c.spent : null, lo: c.lo, hi: c.hi} : null, A, fcMoney);
}
function fhgDetail(r) {                                  // a month opened: the slabs its plan bought, at the shown hold
  const doc = FHG.doc, c = r.c, S = fhgSettings(), h = FHG.h || S.h;
  if (!c || !c.n) return '<p class="dim">' + (c && c.gated ? 'No buys: the market was red and “Buy only when the market is green or amber” is on.' : 'No buys: no slab cleared your boxes that month' + (c && c.best ? ' (best chance ' + Math.round(c.best * 100) + '%)' : '') + '.') + '</p>';
  const j = fhsYi(r.m), rows = c.picks.map(p => {
    const [cid, li, std, buy, q, ch, en, y, lo, hi] = p, real = y == null ? null : fcgNet(std, y, S.disc, S.fee);
    return fhCardRow({cid, gk: doc.lines[li], d: S.disc, ship: S.ship, fee: S.fee, sub: 'paid ' + (q > 1 ? q + ' × ' : '') + fcMoney2(buy) + ' · chance ' + Math.round(ch * 100) + '%'},
      {net: q * en, roi: en / buy, lo: lo == null ? null : q * lo, hi: hi == null ? null : q * hi}, real == null ? {msg: c.done ? 'no price when the hold was up' : 'hold not up yet'} : {net: q * real, roi: real / buy});
  }).join('');
  return '<p class="dim fh-dnote">The ' + c.n + ' slab' + (c.n > 1 ? 's' : '') + ' the model picked at the end of ' + fhMonthWord(r.m) + ' - bought in ' + fhMonthWord(fhsYm(j + 1)) + ' at that month’s price, ' + fcgDiscWord(S.disc) + ' under less the shipping, sold in ' + fhMonthWord(fhsYm(j + 1 + h)) + '. <b>Click a card to see it month by month.</b></p>' + fhCardTable(rows);
}
const fhxColspan = id => [...document.querySelectorAll('#' + id + '-t thead tr:last-child th')].filter(th => !th.classList.contains('col-hidden')).length || 40;
function fhxInsert(id, t, isOpen, detail) {               // the opened rows' details, under each
  const tb = $('rows-' + id), n = fhxColspan(id);
  [...tb.children].forEach(tr => { if (!tr.classList.contains('fhx')) { const r = t.view.find(x => String(x.key) === tr.dataset.key); tr.classList.toggle('open', !!(r && isOpen(r))); if (r && isOpen(r)) { const x = document.createElement('tr'); x.className = 'fhx'; x.innerHTML = '<td data-ci="x" colspan="' + n + '"><div class="fhx-in">' + detail(r) + '</div></td>'; tr.after(x); } } });
}
const FHT_NEW = [{v: 'one-hold-2026-11-23', reset: true}];   // the columns were rebuilt: saved eyes, order and widths start over
tables.fhg = makeTable('fhg', {rows: fhgRowsData, noun: 'months', ranges: [], labels: {}, defaults: {}, root: '#fhg-rp', name: 'Forecast · graded history replay', inserted: FHT_NEW,
  key: r => { r.key = r.m; return r.m; }, hay: r => r.m, row: fhgRow, rowClass: () => 'fhg-row',
  after: t => fhxInsert('fhg', t, r => FHG.open.has('m:' + r.m), fhgDetail)});
/* ---- the card pop-up: one slab month by month at the shown hold ---- */
// one slab looked back, month by month since 2022: its own Card Ladder line's price and reading that month (the trend file's
// cf: its cell, beyond the history then or not), the market's level then and the odds of its kind known then (the replay's lv
// and tab); bought the month AFTER at that month's price, d under less the shipping, sold the hold later after eBay's fee.
// The prediction's net is its kind's mean, its range the 10% to 90% of its kind's grid. A month counts when the line had a
// price in it (the middle of its sales, 3 or more) and in the month after (the newest month: its own price, nothing bought yet).
function fhLook(cid, gk, d, ship, fee) {
  const doc = FHG.doc;
  if (!doc) return {loading: true};
  if (!FCG_LINE(gk)) return {why: 'not a PSA or CGC grade'};
  const M = fhCf(cid, gk);
  if (M === undefined) return {loading: true};
  if (M === 'old' || (M && !M.codes)) return {why: 'its month-by-month readings arrive with the next site build'};
  if (!M) return {why: 'no Card Ladder sales of it on file (Card Ladder has not read the card, or no ' + grLabel(gk) + ' sale)'};
  const lastI = fhsYi(doc.last || doc.months[doc.months.length - 1]), price = v => v && v.w != null && (v.n || 0) >= 3 ? v.w : null, months = [];
  doc.months.forEach((ym, mi) => {
    const j = fhsYi(ym), x = M.get(ym), p = price(x);
    if (p == null || x.c == null || x.c < 0) return;
    const std = j >= lastI ? p : price(M.get(fhsYm(j + 1)));
    if (std == null) return;
    const cell = x.c & 15, fl = x.c >> 4, buy = std * (1 - d) - ship, row = {ym, mi, lv: doc.lv[mi], p, std, buy, cell, fl, h: []};
    for (let h = 1; h <= 6; h++) {
      const grid = fl & 8 ? null : ((doc.tab[mi] || [])[h - 1] || [])[cell];   // beyond the history then: no prediction
      if (!grid || !(buy > 0)) { row.h.push(null); continue; }
      const en = fcgNet(std, grid[0], d, fee), pend = j + 1 + h > lastI;
      let an = null;
      if (!pend) { const p2 = price(M.get(fhsYm(j + 1 + h))); if (p2 != null) an = fcgNet(std, Math.min(5, Math.max(-0.95, p2 / std - 1)), d, fee); }
      row.h.push({en, e: en / buy, lo: fcgNet(std, grid[2], d, fee), hi: fcgNet(std, grid[18], d, fee), an, a: an == null ? null : an / buy, pend, t: {mean: grid[0], q: grid.slice(1)}});
    }
    months.push(row);
  });
  return {months: months.reverse()};
}
const FHC = {k: null};
function fhcOpen(k) { FHC.k = k; fhcPaint(); }
function fhcClose() { FHC.k = null; const p = $('fhc-pop'); if (p) p.remove(); }
function fhcPaint() {
  const k = FHC.k; if (!k) return;
  const h = fcgInputs().h, N = fhCardName(k.cid, k.gk), L = fhLook(k.cid, k.gk, k.d, k.ship, k.fee);
  let body;
  if (L.loading) body = '<p class="dim">Loading the card’s months…</p>';
  else if (!L.months) body = '<p class="dim">' + esc('Not looked back: ' + L.why + '.') + '</p>';
  else if (!L.months.length) body = '<p class="dim">No month to look back on: the model reads a line in a month with 3 or more sales of it, and it has to have a price the month after to be bought at.</p>';
  else {
    const rows = L.months.map(m => {
      const x = m.h[h - 1], P = x ? {net: x.en, roi: x.e, lo: x.lo, hi: x.hi} : null;
      const A = !x ? {msg: m.fl & 8 ? 'beyond history that month: no prediction' : 'no prediction'} : x.an != null ? {net: x.an, roi: x.a} : {msg: x.pend ? 'hold not up yet' : 'no price at the end'};
      return '<tr><td><b>' + esc(m.ym) + '</b> ' + fhLevel(m.lv) + '</td><td class="num dim" title="bought the month after, at that month’s price">' + fmtMoneyPlain(m.std) + '</td>' + fhCells(P, A, fcMoney2) + '</tr>';
    }).join('');
    const done = L.months.map(m => m.h[h - 1]).filter(x => x && x.an != null);
    body = fhStats(done.map(x => ({pn: x.en, pr: x.e, an: x.an, ar: x.a, lo: x.lo, hi: x.hi})), {what: 'Months with a result', of: 'of ' + L.months.length + ' it had a price', one: 'month', unit: 'months', money: fcMoney2}) +
      '<div class="fhc-wrap"><table class="fhd"><thead><tr class="grp"><th colspan="2"></th><th colspan="3" class="band">Predicted</th><th colspan="2" class="band">Actual</th></tr>' +
      '<tr><th>Month</th><th class="num">Price</th><th class="num">Net</th><th class="num">ROI</th><th class="num">Range</th><th class="num">Net</th><th class="num">ROI</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  const html = '<div class="fhs-popbox fhc-box" role="dialog" aria-label="' + esc(N.name + ', ' + N.grade + ', month by month') + '"><button type="button" class="fhs-popx" title="Close" aria-label="Close">✕</button>' +
    '<h3>' + esc(N.name) + ' <span class="fhc-grade">' + esc(N.grade) + '</span></h3><p class="dim">' + esc(N.set) + ' · one copy, bought each month it had a price: the month after, ' + fcgDiscWord(k.d) + ' under that month’s price less ' + fmtMoneyPlain(k.ship) + ' shipping; sold the hold later on eBay (fee ' + (Math.round(k.fee * 1000) / 10) + '%).</p>' +
    '<div class="fhc-bar">' + fhHoldBar() + '</div>' + body + '<p class="dim fhc-foot">Predicted = what the model would have said that month (the odds of its kind known then); Range = 10th to 90th percentile; Actual = Card Ladder’s price when the hold was up.</p></div>';
  let p = $('fhc-pop');
  if (!p) { document.body.insertAdjacentHTML('beforeend', '<div id="fhc-pop" class="fc"></div>'); p = $('fhc-pop'); }
  p.innerHTML = html;
}
document.addEventListener('click', e => {
  const b = e.target.closest('.fhc-open');
  if (b) { fhcOpen({cid: +b.dataset.cid, gk: b.dataset.gk, d: +b.dataset.d, ship: +b.dataset.ship, fee: +b.dataset.fee}); return; }
  const hb = e.target.closest('[data-fhh]');
  if (hb && (hb.closest('#fhg') || hb.closest('#fhc-pop'))) { fhSetHold(+hb.dataset.fhh); return; }
  if (e.target.closest('#fhc-pop .fhs-popx') || e.target.id === 'fhc-pop') fhcClose();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && FHC.k) fhcClose(); });

/* ---- History's Archive and show names (2026-11-23, Brett: "if I remove it, maybe it can go into a folder, like an archive
   button ... and have the option to restore it"; "on the website next to the date, I also want the it to show the show
   name"). Archive (on a record's row, or in it opened) sets a record aside - the collector keeps it, with rec.arch - and the
   Archive button above each table lists them, each with Restore and Delete forever (the old Remove: for good). The show name
   stands next to the date; one made without a name (the website's) can be given one here (+ show name, or ✎ to change it).
   What this page asked waits in FHA.o until the collector's copy agrees: asked again every 5 minutes while it does not, and
   dropped after 3 days. ---- */
const FHA = {o: grLS('fh-over', {}), arch: {rec: false, sc: false}, edit: null};
function fhaMsg(kind, id, x, f) { return f === 'a' ? {type: kind + '_arch', t: nextT(), id, on: x.a ? 1 : 0} : {type: kind + '_name', t: nextT(), id, name: x.n}; }
function fhaApply(kind, recs, live) {                     // the collector's records with this page's own changes it has not confirmed yet
  const o = FHA.o; let dirty = false;
  const out = recs.map(r => {
    const k = kind + ':' + r.id, x = o[k]; if (!x) return r;
    if (Date.now() - x.t > 3 * 86400000) { delete o[k]; dirty = true; return r; }
    const y = Object.assign({}, r), off = [];
    if ('a' in x && !!r.arch !== !!x.a) { off.push('a'); y.arch = x.a ? x.t : 0; }
    if ('n' in x && (r.name || '') !== x.n) { off.push('n'); y.name = x.n; }
    if (live && !r.local && !off.length) { delete o[k]; dirty = true; }
    else if (live && !r.local && Date.now() - (x.s || 0) > 5 * 60000) {   // not taken yet (a lost message, or a collector on older code): ask again
      x.s = Date.now(); dirty = true;
      off.reduce((p, f) => p.then(() => alSend(fhaMsg(kind, r.id, x, f))), Promise.resolve()).catch(() => {});
    }
    return y;
  });
  if (dirty) grSave('fh-over', o);
  return out;
}
function fhaSet(kind, id, f, val) {                      // f 'a': archived (1) or not (0); f 'n': the show name
  const k = kind + ':' + id, x = FHA.o[k] || {};
  x[f] = val; x.t = Date.now(); x.s = Date.now(); FHA.o[k] = x; grSave('fh-over', FHA.o);
  alSend(fhaMsg(kind, id, x, f)).catch(e => favSay('Could not reach the collector’s channel (' + e.message + '). This page keeps the change and asks again in a few minutes.'));
  fhaPaint();
}
function fhaPaint() { fhsCount(); if (FHG.win === 'rec') tables.fhr.apply(true); else if (FHG.win === 'sc') tables.fhs.apply(true); }
function fhaDelete(kind, id) {                            // Delete forever (in the Archive): the collector removes it for good
  delete FHA.o[kind + ':' + id]; grSave('fh-over', FHA.o);
  if (kind === 'gplan') {
    FCR.gone.add(id); grSave('fcg-gplan-gone', [...FCR.gone]);
    FCR.echo = FCR.echo.filter(x => x.id !== id); grSave('fcg-gplan-echo', FCR.echo);
    alSend({type: 'gplan_del', t: nextT(), id}).catch(() => { FCR.gone.delete(id); grSave('fcg-gplan-gone', [...FCR.gone]); favSay('The collector could not be told; the record stays.'); fhaPaint(); });
  } else {
    FHS.gone.add(id); grSave('fcg-gspot-gone', [...FHS.gone]); SCAN.phone.delete(id);
    FHS.echo = FHS.echo.filter(x => x.id !== id); grSave('fcg-gspot-echo', FHS.echo);
    alSend({type: 'gspot_del', t: nextT(), id}).catch(() => { FHS.gone.delete(id); grSave('fcg-gspot-gone', [...FHS.gone]); favSay('The collector could not be told; the set stays.'); fhaPaint(); });
  }
  fhaPaint();
}
// a row's first line: the date, then the show name next to it
function fhaHead(kind, rec) {
  const d = ' data-kind="' + kind + '" data-id="' + esc(rec.id) + '"', E = FHA.edit;
  const nm = E && E.kind === kind && E.id === rec.id
    ? '<span class="fh-nameed"><input type="text" class="fh-namein" maxlength="80" placeholder="Show name" value="' + esc(E.v) + '"' + d + '><button type="button" class="fh-namesave"' + d + '>Save</button><button type="button" class="fh-namex">Cancel</button></span>'
    : rec.name ? '<b class="fh-show">' + esc(rec.name) + '</b><button type="button" class="fh-name"' + d + ' title="Change the show name">✎</button>'
    : '<button type="button" class="fh-name fh-name0"' + d + ' title="Give it its show name">+ show name</button>';
  return '<b>' + fhrDate(rec.t) + '</b> · ' + nm;
}
function fhaBtns(kind, rec, big) {                        // Archive on the list; Restore and Delete forever in the Archive
  const d = ' data-kind="' + kind + '" data-id="' + esc(rec.id) + '"', what = kind === 'gplan' ? 'record' : 'set';
  return rec.arch
    ? '<button type="button" class="fh-act fh-restore"' + d + ' title="Put it back on the list">Restore</button><button type="button" class="fh-act fh-del"' + d + ' title="Take it off for good: it cannot be restored">Delete forever</button>'
    : '<button type="button" class="fh-act fh-arch"' + d + ' title="Set it aside in the Archive (the Archive button above the table); Restore there puts it back">' + (big ? 'Archive this ' + what : 'Archive') + '</button>';
}
const fhaArchWord = rec => rec.arch ? ' · archived ' + fhrDate(rec.arch) : '';
function fhaFocus() {                                     // the name box keeps its place when the table is drawn again
  const i = document.querySelector('#fhg .fh-namein');
  if (i && document.activeElement !== i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function fhaSave(kind, id) {
  const E = FHA.edit; if (!E || E.kind !== kind || E.id !== id) return;
  const v = E.v.replace(/\s+/g, ' ').trim().slice(0, 80); FHA.edit = null;
  const rec = (kind === 'gplan' ? fhrRecs() : fhsRecs()).find(r => r.id === id);
  if (rec && (rec.name || '') === v) { fhaPaint(); return; }
  fhaSet(kind, id, 'n', v);
}
document.addEventListener('click', e => {
  if (!e.target.closest('#fhg')) return;
  const b = e.target.closest('button'); if (!b) return;
  const kind = b.dataset.kind, id = +b.dataset.id;
  if (b.classList.contains('fh-archb') || b.classList.contains('fh-archback')) { const w = b.dataset.w; FHA.arch[w] = b.classList.contains('fh-archb') ? !FHA.arch[w] : false; FHA.edit = null; fhaPaint(); return; }
  if (b.classList.contains('fh-arch')) { fhaSet(kind, id, 'a', 1); favSay('Archived: the Archive button above the table has it, with Restore.'); return; }
  if (b.classList.contains('fh-restore')) { fhaSet(kind, id, 'a', 0); favSay('Restored: it is back on the list.'); return; }
  if (b.classList.contains('fh-del')) {
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Click again: delete for good'; setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = 'Delete forever'; } }, 4000); return; }
    fhaDelete(kind, id); return;
  }
  if (b.classList.contains('fh-name')) { const rec = (kind === 'gplan' ? fhrRecs() : fhsRecs()).find(r => r.id === id); FHA.edit = {kind, id, v: rec && rec.name || ''}; fhaPaint(); return; }
  if (b.classList.contains('fh-namesave')) { fhaSave(kind, id); return; }
  if (b.classList.contains('fh-namex')) { FHA.edit = null; fhaPaint(); }
});
document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('fh-namein') && FHA.edit) FHA.edit.v = e.target.value; });
document.addEventListener('keydown', e => {
  if (!e.target.classList || !e.target.classList.contains('fh-namein')) return;
  if (e.key === 'Enter') { e.preventDefault(); fhaSave(e.target.dataset.kind, +e.target.dataset.id); }
  else if (e.key === 'Escape') { e.stopPropagation(); FHA.edit = null; fhaPaint(); }
});

/* ---- the recorded plans ---- */
function fhrRecs() {                                      // every record, the archived ones too (rec.arch)
  const live = ((LIVE.data && LIVE.data.gplans) || {}), recs = (live.recs || []).slice(), have = new Set(recs.map(r => r.id));
  FCR.echo = FCR.echo.filter(e => !have.has(e.id) && Date.now() - e.t < 2 * 86400000); grSave('fcg-gplan-echo', FCR.echo);
  for (const e of FCR.echo) recs.push(e);
  if (FCR.gone.size && live.t) { for (const id of [...FCR.gone]) if (!have.has(id)) FCR.gone.delete(id); grSave('fcg-gplan-gone', [...FCR.gone]); }
  return fhaApply('gplan', recs.filter(r => !FCR.gone.has(r.id)), !!live.t).sort((a, b) => b.t - a.t);
}
const fhrShown = () => fhrRecs().filter(r => !!r.arch === FHA.arch.rec);   // the list, or the Archive
const fhrDue = (t, h) => { const d = new Date(t); d.setMonth(d.getMonth() + h); return d; };
const fhrYm = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
// a slab's Card Ladder price in the month its hold ends (2026-11-06; it was PriceCharting's): the model's price of that
// month (the line's own figures, as the replay prices a hold), else the latest month before it; the standard price
// today while that month is past the card's Card Ladder read; undefined = not loaded yet (a load is started)
function fhrPrice(cid, gk, ym) {
  const m = fhCf(cid, gk), base = fcrMap().get(cid + '|' + gk);
  if (m === undefined) return undefined;
  if (!m || m === 'old') return base ? fcgStd(base)[0] : null;
  const at = m.get(ym); if (at && at.p != null) return at.p;
  const yms = [...m.keys()].filter(k => m.get(k).p != null), last = yms.length ? yms[yms.length - 1] : '';
  if (ym > last) return base ? fcgStd(base)[0] : null;
  const before = yms.filter(k => k < ym); return before.length ? m.get(before[before.length - 1]).p : null;
}
// a recorded plan's basis: Card Ladder (the model says so) or PriceCharting (recorded before 2026-11-06)
const fhrBasis = rec => /Card Ladder|\bv3\b/i.test(String(rec.model || '')) ? 'cl' : 'pc';   // v3 (2026-11-23) is Card Ladder's too: its name no longer says so
function fhrWantTrend(cid) {
  FHG.trendMiss.add(cid);
  if (FHG.trendBusy) return;
  FHG.trendBusy = true;
  setTimeout(async () => {
    const tried = new Set();                             // until every card asked for meanwhile has been tried too
    for (;;) {
      const todo = [...FHG.trendMiss].filter(c => !GR.trend.has(c) && !tried.has(c)); if (!todo.length) break;
      for (const c of todo) { tried.add(c); if (!GR.trend.has(c)) { try { await grTrendData(c); } catch (e) { /* no trend file: no price */ } } }
    }
    FHG.trendBusy = false; if (tables.fhr) tables.fhr.apply(true); if (tables.fhs && FHG.win === 'sc') tables.fhs.apply(true); if (FHC.k) fhcPaint();
  }, 0);
}
function fhrActual(rec, h) {                              // {pending, due} | {actual, roi, priced, n} | {loading}
  const due = fhrDue(rec.t, h);
  if (Date.now() < due.getTime()) return {pending: true, due};
  if (!GR.doc) return {loading: true};
  const ym = fhrYm(due); let act = 0, paid = 0, priced = 0, loading = false;
  for (const s of rec.slabs) {
    const p = fhrPrice(s[0], s[1], ym);
    if (p === undefined && !FHG.trendMiss.has(+s[0]) || p === undefined && FHG.trendBusy) { loading = true; continue; }
    if (p == null) continue;
    act += p * (1 - rec.fee) - rec.ship - s[5]; paid += s[5]; priced++;
  }
  if (loading) return {loading: true};
  return priced ? {actual: act, roi: paid ? act / paid : null, priced, n: rec.slabs.length} : {none: true};
}
// a record's row at the shown hold: Predicted = the plan's expected net, range and ROI for that hold with the odds of the day it
// was recorded (rec.holds); Actual = its slabs at Card Ladder's price in the month that hold is up, less what was paid
function fhrRowsData() {
  const h = fcgInputs().h;
  return fhrShown().map((rec, o) => {
    const r = [o], x = (rec.holds || [])[h - 1], a = fhrActual(rec, h);
    r.rec = rec; r.key = String(rec.id); r.t = rec.t; r.h = h; r.x = x; r.a = a;
    r.pn = x ? x[0] : null; r.pr = x && rec.spent ? x[0] / rec.spent : null; r.lo = x ? x[1] : null; r.an = a.actual == null ? null : a.actual; r.ar = a.roi == null ? null : a.roi;
    return r;
  });
}
const fhrDate = t => { const d = new Date(t); return MONTHS_S[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); };
function fhrCards() {
  const box = $('fhr-cards'); if (!box) return;
  const recs = fhrShown(); if (!recs.length || FHA.arch.rec) { box.innerHTML = ''; return; }
  const h = fcgInputs().h, L = [];
  for (const rec of recs) { const x = (rec.holds || [])[h - 1], a = fhrActual(rec, h); if (x && a.actual != null && rec.spent) L.push({pn: x[0], pr: x[0] / rec.spent, an: a.actual, ar: a.roi, lo: x[1], hi: x[2]}); }
  box.innerHTML = fhStats(L, {what: 'Records with a result', of: 'of ' + recs.length + ' recorded · the ' + h + '-month hold', one: 'record', unit: 'records'});
}
function fhrRow(r) {
  const rec = r.rec, x = r.x, a = r.a;
  const A = a.pending ? {msg: 'hold up ' + fhrDate(a.due.getTime())} : a.loading ? {msg: '…'} : a.none ? {msg: 'no price'} : {net: a.actual, roi: a.roi, tip: a.priced < a.n ? a.priced + ' of the ' + a.n + ' slabs had a price' : ''};
  return '<td class="fh-who"><span class="fh-tw"></span>' + fhaHead('gplan', rec) +
    (rec.smp ? '<span class="fhr-smp" title="Recorded with sample slabs among the purchases">sample</span>' : '') + (rec.local ? ' <span class="dim" title="Sent; the collector confirms it in a minute or two">sending…</span>' : '') +
    '<br><span class="dim fh-sub">' + rec.slabs.length + ' slab' + (rec.slabs.length > 1 ? 's' : '') + ' · ' + fmtMoneyPlain(rec.spent) + ' paid · your hold then ' + rec.h + ' mo' + fhaArchWord(rec) + '</span>' + fhaBtns('gplan', rec) + '</td>' +
    fhCells(x ? {net: x[0], roi: rec.spent ? x[0] / rec.spent : null, lo: x[1], hi: x[2]} : null, A, fcMoney);
}
// a record opened: its slabs at the shown hold. Predicted: for the hold you recorded with, the slab's own expected net that day;
// for another hold, its kind's odds of the record's month (the replay file: the same odds the page had then); the range from
// those odds. Actual: Card Ladder's price in the month the hold is up, after eBay's fee and the shipping, less what was paid.
function fhrDetail(r) {
  const rec = r.rec, h = r.h, due = fhrDue(rec.t, h), up = Date.now() >= due.getTime(), ym = fhrYm(due), doc = FHG.doc;
  const mi = doc && rec.month ? doc.months.indexOf(rec.month) : -1, v3 = /\bv3\b/.test(rec.model || ''), clb = fhrBasis(rec) === 'cl';
  const rows = rec.slabs.map(s => {
    const [cid, gk, dk, s3, s4, paid, , net, rk] = s, d = dk / 1000, stdc = clb ? s3 : s4;   // stdc: Card Ladder's standard price that day
    const sg = v3 && rk != null ? fcgSigOf(rk) : null, grid = sg && !(sg.f & FCG_F.beyond) && mi >= 0 ? ((doc.tab[mi] || [])[h - 1] || [])[sg.g] : null;
    const pn = h === rec.h && net != null ? net : grid && stdc != null ? fcgNet(stdc, grid[0], d, rec.fee) : null;
    const P = pn == null ? null : {net: pn, roi: paid ? pn / paid : null, lo: grid && stdc != null ? fcgNet(stdc, grid[2], d, rec.fee) : null, hi: grid && stdc != null ? fcgNet(stdc, grid[18], d, rec.fee) : null};
    const p1 = up ? fhrPrice(cid, gk, ym) : null, real = p1 == null ? null : p1 * (1 - rec.fee) - rec.ship - paid;
    const A = !up ? {msg: 'hold up ' + fhrDate(due.getTime())} : real == null ? {msg: p1 === undefined ? '…' : 'no price'} : {net: real, roi: paid ? real / paid : null, tip: 'sold at ' + fmtMoneyPlain(p1)};
    return fhCardRow({cid, gk, d, ship: rec.ship, fee: rec.fee, sub: 'paid ' + fcMoney2(paid) + (Math.abs(d - rec.disc) > 0.0005 ? ' (' + fcgDiscWord(d) + ' under)' : '')}, P, A);
  }).join('');
  return '<p class="dim fh-dnote">' + (rec.name ? esc(rec.name) + ' · ' : '') + rec.slabs.length + ' slab' + (rec.slabs.length > 1 ? 's' : '') + ' bought ' + fhrDate(rec.t) + ' for ' + fmtMoneyPlain(rec.spent) + ' · the ' + h + '-month hold is up ' + fhrDate(due.getTime()) +
    ' · ' + fmtMoneyPlain(rec.ship) + ' shipping, eBay’s fee ' + (Math.round(rec.fee * 1000) / 10) + '%' + (h !== rec.h ? ' · you recorded it with a ' + rec.h + '-month hold: the predictions here come from that month’s odds' : '') + '. <b>Click a card to see it month by month.</b></p>' + fhCardTable(rows) +
    '<div class="fh-dacts">' + fhaBtns('gplan', rec, true) + '</div>';
}
tables.fhr = makeTable('fhr', {rows: fhrRowsData, noun: 'recorded purchases', ranges: [], labels: {}, defaults: {}, root: '#fhg-rec', name: 'Forecast · recorded graded purchases', inserted: FHT_NEW,
  key: r => r.key, row: fhrRow, rowClass: () => 'fhr-row',
  hay: r => r.rec.slabs.map(s => { const R = fhsRes(s), x = R.s || [], rd = R.rd || {}, b = GR.doc && x[0] != null ? fcrMap().get(x[0] + '|' + x[1]) : null;
    return (b ? b[1] + ' ' + b[2] + ' ' + b[25] : x[0] != null ? fhgName(x[0]).join(' ') + ' ' + grLabel(x[1]) : '') + ' ' + (s[10] || '') + ' ' + (rd.nm || '') + ' ' + (rd.st || ''); }).join(' ') + ' ' + fhrDate(r.rec.t) + ' ' + (r.rec.name || ''),
  after: t => {
    fhxInsert('fhr', t, r => FHG.open.has('p:' + r.key), fhrDetail);
    fhrCards(); fhaFocus();
    const none = $('fhr-none'); if (none) none.textContent = t.view.length ? '' : !LIVE.data ? 'Waiting for the live data.' : FHA.arch.rec ? 'Nothing archived: Archive on a record’s row sets it aside here.' : 'No purchases recorded yet: Record Purchases (on Purchases, in the plan pane, or the phone’s Buys tab) puts them here.';
  }});
/* ---- Pre-Sales Spotcheck (2026-11-05, Brett: "if i am going to buy them, i would be interested in seeing the history for
   those listings with the same model applied to those cards in history"; the window's name is his). "Add to Pre-Sales
   Spotcheck" on Forecasting or Recording sends the green rows as a set (the collector keeps it: live.gspots, so every
   device has it), each slab at its % under then, with the bar and the gate of the moment. Here each slab is looked back
   on, month by month since 2022, with the model as it stood that month: its own PriceCharting line (the trend file: PSA
   10's line, and from the 2026-11-06 build the blended Grade 9.5 / 9 / 8 / 7 lines) gives its price, 12-month mean and
   3-month average; the replay file's cut points (rq) rank it among every line that month; the odds known that month
   (tab) give its chance and expected ROI for each hold; "bought" = the chance at or above the set's bar, and the market
   rising if the gate was on; the actual = PriceCharting's price when the hold was up, after eBay's fee and the shipping
   (the replay's rules: bought at the higher of the price and its 3-month average).
   ON THE MODEL OF 2026-11-23 (graded_fc.js): no rank and no cut points any more - a slab's month is read from its
   line's own reading that month (the trend file's cf codes: its cell, beyond the history or not), the market's level
   then and the odds of that cell known then (the replay's lv and tab); bought the month after at that month's price
   (fhLook; since the same day every month counts and the set is bought whole: fhsSet). ---- */
const FHS = {echo: grLS('fcg-gspot-echo', []), gone: new Set(grLS('fcg-gspot-gone', [])), open: new Set(), cache: new Map()};
const fhsYi = ym => +String(ym).slice(0, 4) * 12 + +String(ym).slice(5, 7) - 1;
const fhsYm = i => Math.floor(i / 12) + '-' + String(i % 12 + 1).padStart(2, '0');
/* ---- THE PHONE'S SHOWS AND THE READS OF THE SCANS (2026-11-14, Brett: "when I press this button [Record scans], I want
   all of the scans to go to the website forecast tab > graded cards > history > Pre-sales spotcheck"; "as soon as read
   results are made available from the scans results file, then I want those results to be immediately updated to the
   website"; "there should also maybe be a column with a button that I can click with a pop-up that shows ... all of the
   certs that are already hyperlinked that didn't match our database"). The sets live in spots.bin and the reads in
   scan.bin on the live branch (the collector's fast tick); GitHub's cache holds those up to five minutes, so while this
   window shows, the channel is read every 15 s as well: the reads (<channel>-scr) and the phone's Record scans and Your
   Plan (the main topic) arrive in seconds. A phone slab is looked back on as its cert's read names it - the card, and
   always the grader's grade; a half grade with no Card Ladder line of its own is looked back on one grade down
   (Brett: "rounding down would be safer"). A slab that matches nothing of ours is left out of the set's numbers and
   listed under the Not in our data button, with its cert's link. ---- */
const SCAN = {reads: new Map(), rev: 0, file: null, fileB: -1, spots: null, spotsT: -1, ch: null, since: '12h', phone: new Map(), sync: {}, busy: false, at: 0};
function scanPut(r) {
  if (!r || !r.g || !r.c) return;
  const k = r.g + ':' + r.c, o = SCAN.reads.get(k);
  if (!o || String(r.at || '') > String(o.at || '') || (String(r.at || '') === String(o.at || '') && JSON.stringify(r) !== JSON.stringify(o))) { SCAN.reads.set(k, r); SCAN.rev++; }
}
async function scanLive(name, b) {
  const res = await fetch(LIVE_URL.replace(/[^/]+$/, name) + '?t=' + b, {cache: 'no-store'});
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
}
async function scanFileLoad(force) {                      // scan.bin once a minute, and spots.bin when its time moved
  if (!LIVE_URL || !HKEY) return;
  const b = Math.floor(Date.now() / 60000);
  if (!force && SCAN.fileB === b) return;
  SCAN.fileB = b;
  try {
    const f = await scanLive('scan.bin', b);
    SCAN.file = f; (f.reads || []).forEach(scanPut);
    for (const [k, x] of Object.entries(f.sync || {})) if (x && (!SCAN.sync[k] || x.t > SCAN.sync[k].t)) SCAN.sync[k] = x;
    const st = Math.max(f.spots_t || 0, (LIVE.data && LIVE.data.gspots && LIVE.data.gspots.t) || 0);
    if (st !== SCAN.spotsT) { const sp = await scanLive('spots.bin', b + '_' + st); SCAN.spots = sp.recs || []; SCAN.spotsT = st; SCAN.rev++; }
  } catch (e) { /* not published yet, or offline: the next minute tries again */ }
}
async function scanPoll() {                               // the channel: the reads at once, the phone's Record scans and Your Plan
  if (!HKEY) return;
  const ch = SCAN.ch || (SCAN.ch = await alChannel()), enc = new TextEncoder();
  const hexBytes = h => new Uint8Array((String(h).match(/../g) || []).map(x => parseInt(x, 16)));
  let lines = [];
  try { const r = await fetch('https://ntfy.sh/' + ch.topic + '-scr,' + ch.topic + '/json?poll=1&since=' + SCAN.since, {cache: 'no-store'}); if (r.ok) lines = (await r.text()).split('\n').filter(Boolean); } catch (e) { return; }
  for (const line of lines) {
    try {
      const ev = JSON.parse(line); if (ev.event !== 'message') continue;
      SCAN.since = ev.id;
      const env = JSON.parse(ev.message); if (!env || !env.m || !env.s) continue;
      if (!await crypto.subtle.verify('HMAC', ch.key, hexBytes(env.s), enc.encode(env.m))) continue;
      const m = JSON.parse(env.m);
      if (m.type === 'reads') (m.r || []).forEach(scanPut);
      else if (m.type === 'gset' && (m.src === 'ph' || m.src === 'web')) { if (!SCAN.sync[m.src] || m.t > SCAN.sync[m.src].t) SCAN.sync[m.src] = {t: m.t, v: m.v || {}}; }
      else if (m.type === 'gspot') {                      // a set's parts as they were sent; a phone set shows once all are in
        const id = +m.id, P = SCAN.phone.get(id) || {n: Math.max(1, +m.n || 1), parts: {}, rec: null};
        P.parts[+m.k || 0] = m; SCAN.phone.set(id, P);
        const h = P.parts[0];
        if (!P.rec && h && h.src === 'ph' && Object.keys(P.parts).length >= P.n) {
          const rec = {id, t: id, local: 1};
          ['h', 'cap', 'disc', 'ship', 'fee', 'month', 'reg', 'spent', 'model', 'src', 'minp', 'gate', 'name', 'day', 'minsales', 'share', 'nall'].forEach(k => { if (h[k] !== undefined) rec[k] = h[k]; });
          rec.slabs = []; for (let k = 0; k < P.n; k++) rec.slabs.push(...(((P.parts[k] || {}).s) || []));
          P.rec = rec; SCAN.rev++;
        }
      } else if (m.type === 'gspot_del') { SCAN.phone.delete(+m.id); SCAN.rev++; }
    } catch (e) { continue; }
  }
}
const scanActive = () => document.visibilityState === 'visible' && !$('p-fc').hidden && NAV.fc === 'graded' && NAV.gm === 'hi' && FHG.win === 'sc';
async function scanTick(force) {
  if (SCAN.busy || (!force && !scanActive())) return;
  SCAN.busy = true; const rev = SCAN.rev;
  try { await scanFileLoad(force); await scanPoll(); } catch (e) { /* next tick */ }
  SCAN.busy = false; SCAN.at = Date.now();
  fhsKeyPaint();
  if (SCAN.rev !== rev && scanActive()) { tables.fhs.apply(true); fhsCount(); }
}
setInterval(() => scanTick(false), 15000);
const SCAN_WHY = {'no card': 'No card in our data - under $50, or a card we don’t follow', several: 'Several possible cards - the grader’s name for it fits more than one of ours',
  'no grade data': 'Our card, but no figures for this grade or the one below', 'no grade': 'The cert page shows no grade (Authentic, Unavailable)', 'not pokemon': 'Not a Pokémon card',
  waiting: 'Waiting for its read - open its link (scans.csv) and it fills in', wait: 'Read - waiting for the site’s match index'};
const scanLink = (g, c) => g === 'cgc' ? 'https://www.cgccards.com/certlookup/' + c + '/' : 'https://www.psacard.com/cert/' + c + '/psa';
const scanLower = gk => { if (!gk) return null; const [g, k] = String(gk).split('|'); if (k === 'g10pristine' || k === 'g10perfect') return g + '|g10'; return /_5$/.test(k) ? g + '|' + k.slice(0, -2) : null; };
// a slab of a set as the look-back takes it: a phone slab ([..., grader, cert]) by its cert's read - its card and always the
// grader's grade - else the card the phone's PSA lookup named; null with the reason when nothing of ours matches it
function fhsRes(s) {
  const g = s[9], c = s[10];
  if (!g || !c) return {s};
  const rd = SCAN.reads.get(g + ':' + c) || null;
  if (rd && rd.cid != null && rd.gk && !rd.why) return {s: [rd.cid, rd.gk].concat(s.slice(2)), rd};
  if (rd && rd.why === 'no grade data') return {s: null, rd, why: rd.why};
  if (s[0] != null && s[1]) return {s: rd && rd.gk && rd.cid === s[0] ? [s[0], rd.gk].concat(s.slice(2)) : s, rd};
  return {s: null, rd, why: rd ? (rd.why || 'no card') : 'waiting'};
}
function fhsKeyPaint() {                                  // the collector's key for scan-results, shown until it is let in
  const box = $('fhs-key'); if (!box) return;
  const k = (SCAN.file || {}).key || {};
  if (!SCAN.file || k.ok || !k.pub) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<b>The collector can’t read scan-results yet</b>' + (k.err ? ' <span class="dim">(' + esc(k.err) + ')</span>' : '') + '. On GitHub open <b>BrettS600/scan-results › Settings › Deploy keys › Add deploy key</b>, give it any title, paste this key, leave “Allow write access” unticked and add it. The reads start within a minute.' +
    '<div class="fhs-keyrow"><code id="fhs-keytext">' + esc(k.pub) + '</code><button type="button" class="fhr-del" id="fhs-keycopy">Copy</button></div>';
}
document.addEventListener('click', e => {
  if (e.target.id === 'fhs-keycopy') { const t = ($('fhs-keytext') || {}).textContent || ''; navigator.clipboard.writeText(t).then(() => favSay('Key copied.'), () => favSay('Select the key and copy it.')); }
  if (e.target.closest('#fhs-pop .fhs-popx') || e.target.id === 'fhs-pop') { const p = $('fhs-pop'); if (p) p.remove(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const p = $('fhs-pop'); if (p) p.remove(); } });
function fhsNxOpen(id) {                                  // the pop-up: a set's certs that match nothing of ours, as links
  const rec = fhsRecs().find(r => r.id === id); if (!rec) return;
  const S = fhsSet(rec), by = {};
  rec.slabs.forEach((s, i) => { const X = S.slabs[i]; if (X && X.nx) (by[X.nx] = by[X.nx] || []).push([s, X.rd]); });
  const order = ['no card', 'several', 'no grade data', 'no grade', 'not pokemon', 'wait', 'waiting'];
  let h = '';
  for (const w of order.filter(w => by[w]).concat(Object.keys(by).filter(w => !order.includes(w)))) {
    h += '<h4>' + esc(SCAN_WHY[w] || w) + ' · ' + by[w].length + '</h4><ul>' + by[w].map(([s, rd]) => '<li><a href="' + esc(scanLink(s[9], s[10])) + '" target="_blank" rel="noopener">' + esc(String(s[9]).toUpperCase() + ' ' + s[10]) + '</a>' +
      (rd ? ' <span class="dim">· ' + esc([rd.nm, rd.st, rd.no ? '#' + rd.no : '', rd.vr, rd.gt].filter(Boolean).join(' · ')) + '</span>' : '') + '</li>').join('') + '</ul>';
  }
  const n = Object.values(by).reduce((a, x) => a + x.length, 0);
  document.body.insertAdjacentHTML('beforeend', '<div id="fhs-pop"><div class="fhs-popbox"><button type="button" class="fhs-popx" title="Close">✕</button><h3>Not in our data · ' + esc(rec.name || fhrDate(rec.t)) + '</h3>' +
    '<p class="dim">' + n + ' of the set’s ' + rec.slabs.length + ' slab' + (rec.slabs.length > 1 ? 's' : '') + ' match nothing of ours, so they are left out of its numbers. Each link opens the cert’s page.</p>' + (h || '<p>None.</p>') + '</div></div>');
}
function fhsRecs() {
  const live = (LIVE.data && LIVE.data.gspots) || {}, recs = (SCAN.spots || (Array.isArray(live.recs) ? live.recs : [])).slice(), have = new Set(recs.map(r => r.id));
  for (const P of SCAN.phone.values()) if (P.rec && !have.has(P.rec.id)) { recs.push(P.rec); have.add(P.rec.id); }
  FHS.echo = FHS.echo.filter(e => !have.has(e.id) && Date.now() - e.t < 2 * 86400000); grSave('fcg-gspot-echo', FHS.echo);
  for (const e of FHS.echo) recs.push(e);
  if (FHS.gone.size && SCAN.spots) { for (const id of [...FHS.gone]) if (!SCAN.spots.some(r => r.id === id) && !SCAN.phone.has(id)) FHS.gone.delete(id); grSave('fcg-gspot-gone', [...FHS.gone]); }
  return fhaApply('gspot', recs.filter(r => !FHS.gone.has(r.id)), !!SCAN.spots).sort((a, b) => b.t - a.t);   // the archived ones too (rec.arch)
}
const fhsShown = () => fhsRecs().filter(r => !!r.arch === FHA.arch.sc);   // the list, or the Archive
// a set at the shown hold: every slab looked back (fhLook, at the % under it was sent with); the set bought in each month -
// one copy of every slab with a prediction that month - gives that month's Predicted (the basket's expected net and its 10% to
// 90% range) and Actual; the row is the average month among those with a result. Every month counts, as in a look-back of
// how well the model reads these cards - no bar and no gate. Kept until a trend file, the replay, the reads or the hold change.
function fhsSet(rec, h) {
  const tok = (FHG.doc ? FHG.doc.t : '') + '|' + GR.trend.size + '|' + FHG.trendBusy + '|' + SCAN.rev + '|' + h, c = FHS.cache.get(rec.id);
  if (c && c.tok === tok) return c;
  const doc = FHG.doc, fee = rec.fee || fcgFee(), ship = rec.ship || 0;
  const slabs = rec.slabs.map(s => {
    const R = fhsRes(s);
    if (!R.s) return {why: SCAN_WHY[R.why] || R.why, nx: R.why, rd: R.rd, sl: s};
    const d = (R.s[2] || 0) / 1000;
    let gk = R.s[1], L = fhLook(R.s[0], gk, d, ship, fee), down = null;
    const lo = !L.loading && !L.months ? scanLower(gk) : null;   // a half grade without its own Card Ladder line: one grade down
    if (lo) { const L2 = fhLook(R.s[0], lo, d, ship, fee); if (L2.months || L2.loading) { L = L2; down = lo; gk = lo; } }
    const res = L.months ? L.months.map(m => m.h[h - 1]).filter(x => x && x.an != null) : [];
    const n = res.length, avg = k => n ? res.reduce((a, x) => a + x[k], 0) / n : null;
    return {cid: R.s[0], gk, d, L, down, rd: R.rd, sl: s, n, ins: res.filter(x => x.an >= x.lo && x.an <= x.hi).length,
            avg: n ? {pn: avg('en'), pr: avg('e'), lo: avg('lo'), hi: avg('hi'), an: avg('an'), ar: avg('a')} : null};
  });
  const by = new Map();
  slabs.forEach(x => { if (x.L && x.L.months) x.L.months.forEach(m => { const v = m.h[h - 1]; if (!v) return; if (!by.has(m.ym)) by.set(m.ym, []); by.get(m.ym).push({m, v, d: x.d}); }); });
  const months = doc ? [...by.keys()].sort().reverse().map(ym => {
    const L = by.get(ym), spent = L.reduce((a, o) => a + o.m.buy, 0);
    const mc = fcgMonteCarlo({qs: doc.qs, cap: doc.cap || 0.85}, L.map(o => ({fcQ: 1, fcS: o.m.std, fcT: o.v.t, fcD: o.d})), {disc: 0}, fee, 1000);
    const done = L.every(o => !o.v.pend), priced = L.filter(o => o.v.an != null), paid = priced.reduce((a, o) => a + o.m.buy, 0);
    const actual = done && priced.length ? priced.reduce((a, o) => a + o.v.an, 0) : null;
    return {ym, n: L.length, spent, pn: mc.mean, pr: spent ? mc.mean / spent : null, lo: mc.lo, hi: mc.hi, an: actual, ar: actual == null || !paid ? null : actual / paid, done};
  }) : [];
  const res = months.filter(m => m.an != null), n = res.length, avg = k => n ? res.reduce((a, m) => a + m[k], 0) / n : null;
  const out = {tok, h, slabs, months, res, n, ins: res.filter(m => m.an >= m.lo && m.an <= m.hi).length, avg: n ? {pn: avg('pn'), pr: avg('pr'), lo: avg('lo'), hi: avg('hi'), an: avg('an'), ar: avg('ar')} : null,
               loading: !doc || slabs.some(x => x.L && x.L.loading), nx: slabs.filter(x => x.nx).length};
  FHS.cache.set(rec.id, out);
  return out;
}
function fhsCards(rows) {
  const box = $('fhs-cards'); if (!box) return;
  if (!rows.length || FHA.arch.sc) { box.innerHTML = ''; return; }
  const L = [];
  rows.forEach(r => r.S.res.forEach(m => L.push(m)));
  box.innerHTML = fhStats(L, {what: 'Set-months with a result', of: rows.length + ' set' + (rows.length > 1 ? 's' : '') + ', each bought whole in every month it had a price · the ' + fcgInputs().h + '-month hold', one: 'set-month', unit: 'set-months'});
}
function fhsRowsData() {
  if (!FHG.doc) return [];
  const h = fcgInputs().h;
  return fhsShown().map((rec, o) => {
    const r = [o], S = fhsSet(rec, h), A = S.avg;
    r.rec = rec; r.S = S; r.key = String(rec.id); r.t = rec.t; r.h = h; r.src = rec.src === 'rc' ? 'Recording' : rec.src === 'ph' ? 'the phone' : 'Forecasting'; r.nm = rec.name || '';
    r.pn = A ? A.pn : null; r.pr = A ? A.pr : null; r.lo = A ? A.lo : null; r.an = A ? A.an : null; r.ar = A ? A.ar : null;
    return r;
  });
}
function fhsRow(r) {
  const rec = r.rec, S = r.S, A = S.avg, ph = rec.src === 'ph';
  const sub = rec.slabs.length + ' slab' + (rec.slabs.length > 1 ? 's' : '') + (ph ? ' (' + (rec.slabs.length - S.nx) + ' in our data)' : '') + ' · ' + (S.loading ? 'loading the months…' : S.n + ' month' + (S.n === 1 ? '' : 's') + ' with a result') + ' · sent from ' + r.src + fhaArchWord(rec);
  return '<td class="fh-who"><span class="fh-tw"></span>' + fhaHead('gspot', rec) +
    (rec.smp ? '<span class="fhr-smp" title="Sent with sample slabs among them">sample</span>' : '') + (rec.local ? ' <span class="dim" title="Sent; the collector confirms it in a minute or two">sending…</span>' : '') +
    (ph && S.nx ? ' <button type="button" class="fhs-nx" data-id="' + esc(rec.id) + '" title="The slabs of this show that match nothing of ours - left out of its numbers; click for their links">' + S.nx + ' not in our data</button>' : '') +
    '<br><span class="dim fh-sub">' + esc(sub) + '</span>' + fhaBtns('gspot', rec) + '</td>' +
    fhCells(A ? {net: A.pn, roi: A.pr, lo: A.lo, hi: A.hi} : null, A ? {net: A.an, roi: A.ar, mark: S.ins + ' of ' + S.n + ' in range'} : {msg: S.loading ? '…' : 'no month with a result yet'}, fcMoney);
}
function fhsDetail(r) {                                   // a set opened: its slabs, each as its average month
  const rec = r.rec, S = r.S, ph = rec.src === 'ph';
  const rows = S.slabs.map(x => {
    const sl = x.sl, certHtml = ph && sl[9] ? ' · <a href="' + esc(scanLink(sl[9], sl[10])) + '" target="_blank" rel="noopener">' + esc(String(sl[9]).toUpperCase() + ' ' + sl[10]) + '</a>' : '';
    if (x.nx) return '';
    if (!x.L || x.L.loading) return '<tr><td class="fh-cardc">' + esc(fhCardName(x.cid, x.gk).name) + certHtml + '</td><td class="num" colspan="5"><span class="dim">loading its months…</span></td></tr>';
    if (!x.L.months) return '<tr><td class="fh-cardc">' + esc(fhCardName(x.cid, x.gk).name) + ' <b>' + esc(fhCardName(x.cid, x.gk).grade) + '</b>' + certHtml + '</td><td colspan="5"><span class="dim">' + esc('Not looked back: ' + x.L.why + '.') + '</span></td></tr>';
    const A = x.avg;
    return fhCardRow({cid: x.cid, gk: x.gk, d: x.d, ship: rec.ship || 0, fee: rec.fee || fcgFee(), down: x.down, sub: x.n + ' month' + (x.n === 1 ? '' : 's') + ' with a result' + (Math.abs(x.d - (rec.disc || 0)) > 0.0005 ? ' · ' + fcgDiscWord(x.d) + ' under' : ''), html: certHtml},
      A ? {net: A.pn, roi: A.pr, lo: A.lo, hi: A.hi} : null, A ? {net: A.an, roi: A.ar, mark: x.ins + ' of ' + x.n + ' in range'} : {msg: 'no month with a result yet'});
  }).join('');
  const nx = S.slabs.filter(x => x.nx);
  return '<p class="dim fh-dnote">' + (rec.name ? esc(rec.name) + ' · ' : '') + rec.slabs.length + ' slab' + (rec.slabs.length > 1 ? 's' : '') + ' sent ' + fhrDate(rec.t) + ' from ' + r.src + ' · ' + fmtMoneyPlain(rec.ship || 0) + ' shipping, eBay’s fee ' + (Math.round((rec.fee || 0) * 1000) / 10) + '%' +
    ' · each slab bought in every month it had a price, at the % under it was sent with; each row is its average month. <b>Click a card to see it month by month.</b></p>' + fhCardTable(rows) +
    (nx.length ? '<p class="dim">' + nx.length + ' slab' + (nx.length > 1 ? 's' : '') + ' match nothing of ours and are left out of the numbers - the <b>not in our data</b> button on the row lists them with their links.</p>' : '') +
    '<div class="fh-dacts">' + fhaBtns('gspot', rec, true) + '</div>';
}
tables.fhs = makeTable('fhs', {rows: fhsRowsData, noun: 'spotcheck sets', ranges: [], labels: {}, defaults: {}, root: '#fhg-sc', name: 'Forecast · graded pre-sales spotcheck', inserted: FHT_NEW,
  key: r => r.key, row: fhsRow, rowClass: () => 'fhr-row fhs-row',
  hay: r => r.rec.slabs.map(s => { const R = fhsRes(s), x = R.s || [], rd = R.rd || {}, b = GR.doc && x[0] != null ? fcrMap().get(x[0] + '|' + x[1]) : null;
    return (b ? b[1] + ' ' + b[2] + ' ' + b[25] : x[0] != null ? fhgName(x[0]).join(' ') + ' ' + grLabel(x[1]) : '') + ' ' + (s[10] || '') + ' ' + (rd.nm || '') + ' ' + (rd.st || ''); }).join(' ') + ' ' + fhrDate(r.rec.t) + ' ' + (r.rec.name || ''),
  after: t => {
    fhxInsert('fhs', t, r => FHG.open.has('s:' + r.key), fhsDetail);
    fhsCards(t.view); fhaFocus();
    const none = $('fhs-none'); if (!none) return;
    none.textContent = !FHG.doc ? (FHG.err || 'Loading the replay…') : t.view.length ? '' : !LIVE.data ? 'Waiting for the live data.' : FHA.arch.sc ? 'Nothing archived: Archive on a set’s row sets it aside here.' : 'No sets yet: Record scans on the phone (Buys tab), or Add to Pre-Sales Spotcheck above the table on Forecasting or Recording, sends them here.';
  }});
fhxTidy('fhs');
$('rows-fhs').addEventListener('click', e => {
  const nx = e.target.closest('.fhs-nx');
  if (nx) { fhsNxOpen(+nx.dataset.id); return; }
  if (e.target.closest('button, a, input') || e.target.closest('tr.fhx')) return;
  const tr = e.target.closest('tr'); if (!tr) return;
  const k = 's:' + tr.dataset.key; if (FHG.open.has(k)) FHG.open.delete(k); else FHG.open.add(k);
  tables.fhs.apply(true);
});
function fhsCount() {                                     // the windows' counts (not archived) and the Archive buttons' (archived)
  const S = fhsRecs(), R = fhrRecs(), put = (id, n) => { const el = $(id); if (el) el.textContent = String(n); };
  put('nfhs', S.filter(r => !r.arch).length); put('nfhr', R.filter(r => !r.arch).length);
  put('nfhs-a', S.filter(r => r.arch).length); put('nfhr-a', R.filter(r => r.arch).length);
  for (const [w, id] of [['rec', 'fhr'], ['sc', 'fhs']]) { const b = $(id + '-archb'), n = $(id + '-archnote'); if (b) b.classList.toggle('on', FHA.arch[w]); if (n) n.hidden = !FHA.arch[w]; }
}
// Add to Pre-Sales Spotcheck: the green rows of the page showing, in parts of 20 slabs (the channel carries about 4 KB)
$('fcg-gmode').insertAdjacentHTML('beforeend', '<span class="fcg-spotw"><button type="button" class="gm2 fcg-spot" id="fcg-spot" title="Send the green rows to History › Pre-Sales Spotcheck: each slab looked back on with the model, month by month since 2022">Add to Pre-Sales Spotcheck</button><button class="help" data-h="fcg_spot">?</button></span>');
async function fhsSend() {
  const m = fcgMode(), btn = $('fcg-spot');
  if (m !== 'fc' && m !== 'rc') return;
  if (!GR.doc) return favSay('The graded data is still loading.');
  const D = fcgDoc(), I = fcgInputs(), fee = fcgFee(), rc = m === 'rc';
  const rows = (rc ? ((FCR.res.rc || {}).green || []) : (FCG.picks || [])).slice();
  if (!rows.length) return favSay('No green rows to send: the plan buys nothing at these settings.');
  if (!HKEY) return favSay('This page has no key for the collector.');
  const price = r => rc ? r.fcPx : r.fcB;
  const slabs = rows.map(r => [r[0], r[50], Math.round((r.fcD != null ? r.fcD : I.disc) * 1000), r2(r.fcS), r2(r.fcSc), r2(price(r)), r.fcP == null ? null : Math.round(r.fcP * 10), r2(r.fcN), r.fcV == null ? null : r.fcV]);   // the 9th: the line's code (graded_fc.js fcgSigOf); the dip rank x 1000 before the model of 2026-11-23
  const spent = r2(rows.reduce((s, r) => s + (r.fcQ || 1) * (price(r) || 0), 0)), id = nextT(), n = Math.max(1, Math.ceil(slabs.length / 20));
  const head = {h: I.h, cap: I.cap, disc: rc ? (+FCG_IN.rdisc || 14.1) / 100 : I.disc, ship: I.ship, fee, month: D ? D.month : '', reg: D ? fcgLevel(D) : '', spent, model: D ? D.model : '',
                smp: rows.some(r => r.rec && r.rec.smp) ? 1 : 0, src: m, minp: I.minp, gate: I.gate ? 1 : 0, holds: []};
  btn.disabled = true;
  try {
    for (let k = 0; k < n; k++) await alSend(Object.assign({type: 'gspot', t: k ? nextT() : id, id, k, n, s: slabs.slice(k * 20, (k + 1) * 20)}, k ? {} : head));
  } catch (e) { btn.disabled = false; return favSay('Could not reach the collector’s channel (' + e.message + '). Nothing was sent.'); }
  btn.disabled = false;
  FHS.echo = FHS.echo.filter(x => Date.now() - x.t < 2 * 86400000).concat([Object.assign({id, t: id, slabs, local: 1}, head)]); grSave('fcg-gspot-echo', FHS.echo);
  fhsCount();
  favSay('Added ' + rows.length + ' slab' + (rows.length > 1 ? 's' : '') + ' to Pre-Sales Spotcheck (History). The collector confirms it in a minute or two.');
}
$('fcg-spot').addEventListener('click', fhsSend);
{ const hb = $('fcg-hits'), sw = document.querySelector('.fcg-spotw'); if (hb && sw) hb.after(sw); }   // beside Only Hits
// the tables' own scroll boxes and buttons: no filter chips here, so no Filters… button
function fhxTidy(id) {
  [...$('ranges-' + id).querySelectorAll('button.reset')].forEach(b => { if (b.textContent.trim() === 'Filters…') b.remove(); });
  $('rows-' + id).closest('table').id = id + '-t';
}
['fhg', 'fhr'].forEach(fhxTidy);
$('rows-fhg').addEventListener('click', e => {
  if (e.target.closest('button, a, input')) return;
  const tr = e.target.closest('tr'); if (!tr || tr.classList.contains('fhx') || tr.closest('tr.fhx')) return;
  const k = 'm:' + tr.dataset.key; if (FHG.open.has(k)) FHG.open.delete(k); else FHG.open.add(k);
  tables.fhg.apply(true);
});
$('rows-fhr').addEventListener('click', e => {
  if (e.target.closest('button, a, input')) return;
  const tr = e.target.closest('tr'); if (!tr || tr.classList.contains('fhx') || tr.closest('tr.fhx')) return;
  const k = 'p:' + tr.dataset.key; if (FHG.open.has(k)) FHG.open.delete(k); else FHG.open.add(k);
  tables.fhr.apply(true);
});
// the settings line: whose numbers the replay runs on
function fhgNote() {
  const el = $('fhg-note'); if (!el) return;
  const I = fcgInputs(), grades = [...GF.fc.gsel].filter(gk => FCG_LINE(gk)).map(grLabel);
  el.innerHTML = 'Your plan: <b>' + fmtMoneyPlain(I.cap) + '</b>, <b>' + fcgDiscWord(I.disc) + ' under</b>, ' + fmtMoneyPlain(I.ship) + ' shipping, $' + I.pmin.toLocaleString('en-US') + '–$' + I.pmax.toLocaleString('en-US') + ', ' + Math.round(I.share * 100) + '% per card, chance of at least ' + Math.round(I.minp * 100) + '%' +
    (fcgMinOn(I) ? ', ' + esc(fcgMinWord(I)) : '') + ', ' + I.copies + ' cop' + (I.copies === 1 ? 'y' : 'ies') + ' per card, gate ' + (I.gate ? 'on' : 'off') + ' · ' + (grades.length ? esc(grades.length > 8 ? grades.length + ' grades ticked' : grades.join(', ')) : 'no PSA or CGC grade ticked') + ' - the plan pane on the left and Graded Forecasting’s Grading button.';
}
function fhgPaint() {                                     // the cards and the replay table, once its cells are in
  if (FHG.win !== 'rp') return;
  fhgCards();
  const run = $('fhg-run'); if (run && !FHG.todo) run.textContent = FHG.doc ? '' : FHG.err ? FHG.err : 'Loading the replay…';
  tables.fhg.apply(true);
}
function fhgWinPaint() {
  $('fhg').dataset.win = FHG.win;
  document.querySelectorAll('#fhg-wins .fvchip').forEach(b => b.classList.toggle('on', b.dataset.w === FHG.win));
}
const FHG_HOLD_WORD = {rp: 'each month’s own cards, picked by the model as it stood then', rec: 'the slabs you bought, at what you paid', sc: 'the same slabs in every month since 2022'};
function fhgHoldPaint() {
  const box = $('fhg-hold'); if (!box) return;
  box.innerHTML = fhHoldBar() + '<span class="dim">one hold at a time - Hold for in Your plan · ' + FHG_HOLD_WORD[FHG.win] + '</span>';
}
function fhgRender() {
  fhgWinPaint(); fhgHoldPaint();
  if ($('p-fc').hidden || NAV.fc !== 'graded' || NAV.gm !== 'hi') return;
  fhsCount();
  const w = FHG.win;
  if (!GR.doc && !GR.loading) grLoad().then(() => { if (FHG.win === 'rec') tables.fhr.apply(true); if (FHG.win === 'sc') tables.fhs.apply(true); if (FHC.k) fhcPaint(); });
  if (!FHG.doc && !FHG.err) fhgLoad();                    // the replay file: the replay, the Spotcheck, and the cards' months everywhere
  if (FHC.k) fhcPaint();
  if (w === 'rec') { tables.fhr.apply(true); return; }
  if (!FHG.doc) $('fhg-run').textContent = FHG.err || 'Loading the replay…';
  if (w === 'sc') { tables.fhs.apply(true); if (Date.now() - SCAN.at > 5000) scanTick(true); return; }
  fhgNote();
  if (!FHG.doc) { fhgCards(); tables.fhg.apply(true); }
  else { fhgRun(); if (!FHG.todo) fhgPaint(); else { fhgCards(); tables.fhg.apply(true); } }
}
$('fhg-wins').addEventListener('click', e => {
  const b = e.target.closest('.fvchip'); if (!b || b.dataset.w === FHG.win) return;
  FHG.win = b.dataset.w; grSave('fhg-win', FHG.win); fhgRender();
});
{ const na = navApply; navApply = function () { na.apply(this, arguments); fhgRender(); }; }
{ const st = showTab; showTab = function () { st.apply(this, arguments); fhgRender(); }; }
{ const rb = rebuildLive; rebuildLive = function () { const out = rb.apply(this, arguments); if (!$('p-fc').hidden && NAV.fc === 'graded' && NAV.gm === 'hi') { fhsCount(); if (FHG.win === 'rec') tables.fhr.apply(true); else if (FHG.win === 'sc') tables.fhs.apply(true); } return out; }; }
fhgRender();

Object.assign(HELP, {
  fhg_replay: {t: 'Forecasting Replay', md: 1, m: [
    '> How the model would have done if you had used it every month since 2022: each month it picks its own cards, knowing only what was known that month, and you see what it predicted against what they made.',
    '## Each month',
    '1. **The market’s level then** (green / amber / red) and every Card Ladder line’s kind that month (the kinds behind Chance: the three rules, the era, busy or thin, new card, CGC).',
    '2. **The odds of each kind** at that level, from the outcomes already over by then. A month marked * had too few yet, so the whole period’s odds stand in - that is hindsight.',
    '3. **Your plan** with Your plan’s boxes and Graded Forecasting’s Grading ticks: capital, % under, shipping, the price band, the share, the chance bar, the minimum ROI / net per slab, the minimum Card Ladder sales (in THAT month: a slab with 10 sales in January but 9 in November can be bought in January and not in November), the copies, the gate (red = nothing bought).',
    '4. **Bought the month after** the decision, at that month’s price, and sold at the price your hold later, after eBay’s fee and the shipping.',
    'Today’s Best to Buy list is never used for a past month: every month has its own cards.',
    '## The columns',
    '| Column | What it is |',
    '|---|---|',
    '| Predicted Net | the plan’s expected net that month: the average of its basket |',
    '| Predicted ROI | that net on the money spent |',
    '| Range | the 10th to the 90th percentile of the basket’s net |',
    '| Actual Net | what the slabs made when the hold was up; “in range” or “outside” the predicted range |',
    '| Actual ROI | that on the money spent |',
    'The boxes above the table average the months whose hold is over. Click a month for its slabs, and a slab for its months (a pop-up).',
    '## Keep in mind',
    '- One hold at a time: History’s Hold buttons are Your plan’s Hold for.',
    '- A line whose era had run further than any era had until then gets no prediction that month, as on Forecasting.',
    '- The file keeps each month’s 16 best lines by tie-breaker of each kind and grade in $50 - $5,000, so a band outside that, or a very large capital, sees fewer candidates.',
    '- Read the results as upper bounds: the levels and the rules were chosen on these same months.'].join('\n'),
    e: '2026-03 (green), 3-month hold, $1,000: 10 slabs, predicted +$390 (+39%), range $54 to $816; actual +$274 (+33%), in range.'},
  fhg_recorded: {t: 'Recorded Purchases', md: 1, m: [
    '> What you really bought, at what you really paid: what the model said that day against what the slabs made. The truest check of the model on your own money.',
    '## Each record',
    '- One row per Record Purchases (Graded › Purchases, or the phone’s Buys tab), with the name given on the phone, the date, what was paid and the hold you had set.',
    '- **Predicted:** the expected net, its range and ROI for the hold shown, with the odds of the day it was recorded.',
    '- **Actual:** the slabs sold at Card Ladder’s price in the month that hold is up (the standard price while that month is past the card’s Card Ladder read), after eBay’s fee and the shipping, less what was paid.',
    '## A record opened',
    '- Its slabs with the same columns. For the hold you recorded with, a slab’s prediction is its own of that day; for another hold, its kind’s odds of the record’s month.',
    '- Click a slab for its months (a pop-up): how the model read that card in every month since 2022.',
    '## Keep in mind',
    '- One hold at a time: History’s Hold buttons are Your plan’s Hold for.',
    '- A record made before Nov 6 was planned on PriceCharting’s prices; its actuals are Card Ladder’s too.',
    '- Kept by the collector, so every device shows them, with the show name next to the date (the phone’s; **+ show name** gives one to a record made without, ✎ changes it).',
    '- **Archive** on a record’s row sets it aside; the **Archive** button above the table lists those, each with **Restore** (back on the list) and **Delete forever**.'].join('\n')}
});
Object.assign(HELP, {
  fhs_spot: {t: 'Pre-Sales Spotcheck', md: 1, m: [
    '> Before you buy: how well does the model read these exact slabs? Each set is the same slabs bought in every month since 2022, with what the model predicted then against what they made.',
    '## Where the sets come from',
    '- **Add to Pre-Sales Spotcheck** on Forecasting or Recording sends the green rows, each at its % under then.',
    '- **Record scans** on the phone (Buys tab) sends every slab of the show so far as one set, with the name you gave it. Each tap is a new set.',
    '- A phone slab is named by its cert’s read: its card, and always the grader’s grade. A half grade with no Card Ladder line of its own is looked back on one grade down (↓).',
    '- **Not in our data:** the slabs that match nothing of ours (under $50, a card we don’t follow, more than one possible card, no grade) are left out of the set’s numbers; the button lists their links. The reads arrive within a minute while this window is open.',
    '## How a set is looked back on',
    '1. **Each slab, month by month:** its own Card Ladder line’s price and its kind that month, the market’s level then, and the odds of that kind known then.',
    '2. **The set bought whole** in every month: one copy of each slab with a prediction that month, bought the month after at that month’s price, at the % under it was sent with, less the shipping.',
    '3. **Predicted:** the basket’s expected net, ROI and range (10th to 90th percentile). **Actual:** what the basket made when the hold was up, after eBay’s fee and the shipping.',
    '4. **The row** is the average month among those with a result, and how many months landed inside the predicted range. No chance bar and no gate here: every month counts.',
    'Click a set for its slabs (each as its average month), and a slab for its months (a pop-up).',
    '## How to read it',
    'If the actual came in near the predicted, and inside the range most months, the model’s numbers on these cards deserve trust today. Far below: be careful with them.',
    '## Keep in mind',
    '- One hold at a time: History’s Hold buttons are Your plan’s Hold for.',
    '- A month counts when the slab’s grade had 3+ sales in it and in the month after. A month in which its era had run further than any era had until then has no prediction (beyond history).',
    '- The months overlap (a 6-month hold bought in March and in April share four months), so they are not separate tests.',
    '- The sets are kept by the collector: every device shows them, with the show name next to the date (the phone’s; **+ show name** gives one to a set made without, ✎ changes it).',
    '- **Archive** on a set’s row sets it aside; the **Archive** button above the table lists those, each with **Restore** (back on the list) and **Delete forever**.'].join('\n'),
    now: () => { const n = fhsRecs().filter(r => !r.arch).length, d = FHG.doc; return n + ' set' + (n === 1 ? '' : 's') + (d && d.months ? ' · months ' + esc(d.months[0]) + ' to ' + esc(d.last || d.months[d.months.length - 1]) : '') + ''; }}
});

/* ---- the graded Forecast README (2026-11-05, Brett: "For the four buttons in the forecast tab, can we have a README button
   that's shared between all of them? ... I would want the pop-up to be resizable ... similar to like Word or like Google
   Docs ... Command B for bold, Command U for underline, maybe adjust the size of the text. I don't care about the font
   options"). One README for Forecasting, Recording, Purchases and History (graded), always editable: a toolbar (bold,
   italic, underline, smaller / bigger, paragraph style, lists, clear) and the Docs shortcuts; Save (or ⌘S) sends it
   through the collector like the other READMEs (key r:fcg, live.help), so every device shows it. Unsaved typing is kept
   in this browser as a draft. Text sizes are stored as <span class="fs-1..7"> (the cleaner keeps only classes) and
   edited as <font size> (what the browser's own size command makes); 3 is normal. The box's size is remembered. ---- */
const GD = {dirty: false, tm: null, base: ''};
const GD_KEY = 'r:fcg';
const README_FCG = '<h3>Graded Forecast · how the four pages fit together</h3>' +
  '<p>Every page here works on PSA and CGC slabs with the same plan pane on the left (capital, hold, % under, shipping, the price band, the per-card share, the bar, the copies, the gate) and the same filter buttons.</p>' +
  '<h4>Forecasting</h4><p>Every slab Card Ladder prices (each card at each PSA and CGC grade), assumed for sale, best to buy first. The green rows are what your capital buys. Prices, chances and the money are Card Ladder’s; PriceCharting’s price and sales are shown under them for reference. Use it before a show to see what is worth looking for.</p>' +
  '<h4>Recording</h4><p>The slabs you record at a show, one row each. Type the vendor’s price (or their % under Card Ladder’s price) into the row: its chance and its place follow, and the green rows re-plan. Mark <b>Yes</b> when you buy (the money comes off the capital), <b>No</b> when the vendor wants more (the row drops to the bottom).</p>' +
  '<h4>Purchases</h4><p>The slabs you marked Yes, at what you paid. <b>Record Purchases</b> keeps them on History.</p>' +
  '<h4>History</h4><ul><li><b>Forecasting Replay</b>: the plan run on every month since 2022 with only what was known then.</li><li><b>Recorded Purchases</b>: your records, scored when each hold is up.</li><li><b>Pre-Sales Spotcheck</b>: the green rows you sent with Add to Pre-Sales Spotcheck, each slab looked back on month by month.</li></ul>' +
  '<h4>At a show</h4><ol><li>Record the slabs you see.</li><li>Ask each vendor; type their price into the row.</li><li>Check the green rows (and Add to Pre-Sales Spotcheck if you want the look back first).</li><li>Mark Yes or No as you go; Record Purchases at the end.</li></ol>' +
  '<p><i>Edit this page like a document: select text and use the toolbar or ⌘B / ⌘I / ⌘U, ⌘⇧. / ⌘⇧, for size, then Save.</i></p>';
const gdSaved = () => { const o = ovr(GD_KEY); return o ? cleanHtml(o) : README_FCG; };
const gdDraft = () => { const d = grLS('fcg-readme-draft', null); return d && typeof d.html === 'string' ? d : null; };
// sizes: stored as span.fs-N, edited as font[size=N]
function gdToEdit(html) {
  const t = document.createElement('template'); t.innerHTML = html;
  t.content.querySelectorAll('span[class*="fs-"]').forEach(sp => { const m = /(?:^|\s)fs-([1-7])(?:\s|$)/.exec(sp.className); if (!m) return; const f = document.createElement('font'); f.setAttribute('size', m[1]); f.append(...sp.childNodes); sp.replaceWith(f); });
  return t.innerHTML;
}
function gdFromEdit(html) {
  const t = document.createElement('template'); t.innerHTML = html;
  t.content.querySelectorAll('font').forEach(f => { const n = +f.getAttribute('size'); if (n >= 1 && n <= 7 && n !== 3) { const sp = document.createElement('span'); sp.className = 'fs-' + n; sp.append(...f.childNodes); f.replaceWith(sp); } else f.replaceWith(...f.childNodes); });
  t.content.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));
  t.content.querySelectorAll('span').forEach(sp => { if (!sp.className) sp.replaceWith(...sp.childNodes); });   // a plain span says nothing
  return cleanHtml(t.innerHTML);
}
function gdSay(txt, cls) { const s = $('gdstat'); s.textContent = txt; s.className = 'gdstat ' + (cls || ''); }
function gdPaintTools() {
  const box = $('gdbody'), sel = document.getSelection(); if (!sel || !sel.rangeCount || !box.contains(sel.anchorNode)) return;
  ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].forEach(c => { const b = $('gdtools').querySelector('[data-c="' + c + '"]'); if (b) b.classList.toggle('on', document.queryCommandState(c)); });
  const blk = String(document.queryCommandValue('formatBlock') || '').toLowerCase(); $('gdblock').value = blk === 'h3' || blk === 'h4' ? blk : 'p';
}
function gdOpen() {
  const saved = gdSaved(), d = gdDraft();
  GD.base = saved;
  const useDraft = d && d.html !== saved;
  $('gdbody').innerHTML = gdToEdit(useDraft ? d.html : saved);
  GD.dirty = !!useDraft;
  gdSay(useDraft ? 'Unsaved changes from ' + fhrDate(d.t) + ' (kept in this browser) - Save to keep them' : ovr(GD_KEY) ? 'Saved' : 'The original README', useDraft ? 'warn' : '');
  $('gdrestore').hidden = !ovr(GD_KEY); $('gdrestore').classList.remove('arm'); $('gdrestore').textContent = 'Restore the original';
  const sz = grLS('fcg-readme-size', null), box = $('gdbox');
  if (sz && sz.w && sz.h) { box.style.width = Math.min(sz.w, innerWidth - 24) + 'px'; box.style.height = Math.min(sz.h, innerHeight - 24) + 'px'; }
  $('gdov').classList.add('open');
  try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
  setTimeout(() => $('gdbody').focus(), 0);
}
function gdClose() { gdKeepDraft(); $('gdov').classList.remove('open'); }
function gdKeepDraft() {
  clearTimeout(GD.tm);
  if (!GD.dirty) return;
  grSave('fcg-readme-draft', {html: gdFromEdit($('gdbody').innerHTML), t: Date.now()});
}
async function gdSave() {
  const html = gdFromEdit($('gdbody').innerHTML);
  if (await sendEdit(GD_KEY, html, gdSay)) {
    GD.dirty = false; GD.base = html; try { localStorage.removeItem('fcg-readme-draft'); } catch (e) {}
    gdSay('Saved - it shows on every device in a minute or two', 'ok'); $('gdrestore').hidden = false;
  }
}
function gdCmd(c) {
  const box = $('gdbody'); box.focus();
  if (c === 'bigger' || c === 'smaller') {
    const n = Math.min(7, Math.max(1, gdSizeNow() + (c === 'bigger' ? 1 : -1)));
    document.execCommand('fontSize', false, String(n));
  } else document.execCommand(c, false, null);
  gdChanged(); gdPaintTools();
}
function gdSizeNow() {                                    // the selection's text size, 1-7 (3 = normal): from the <font size> it sits in or holds
  const sel = document.getSelection(); if (!sel || !sel.rangeCount) return 3;
  const r = sel.getRangeAt(0), el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const up = el && el.closest('#gdbody font[size]'); if (up) return +up.getAttribute('size') || 3;
  const inside = r.cloneContents().querySelector('font[size]'); return inside ? +inside.getAttribute('size') || 3 : 3;
}
function gdChanged() {
  GD.dirty = true; gdSay('Unsaved changes', 'warn');
  clearTimeout(GD.tm); GD.tm = setTimeout(gdKeepDraft, 800);
}
$('fcg-readme').addEventListener('click', gdOpen);
$('gdclose').addEventListener('click', gdClose);
$('gdsave').addEventListener('click', gdSave);
$('gdrestore').addEventListener('click', async () => {
  const b = $('gdrestore');
  if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Click again: your edits go'; setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = 'Restore the original'; } }, 4000); return; }
  if (await sendEdit(GD_KEY, null, gdSay)) { try { localStorage.removeItem('fcg-readme-draft'); } catch (e) {} GD.dirty = false; $('gdbody').innerHTML = gdToEdit(README_FCG); b.hidden = true; gdSay('Restored the original', 'ok'); }
});
$('gdtools').addEventListener('mousedown', e => { if (e.target.closest('button[data-c]')) e.preventDefault(); });   // the selection stays in the text
$('gdtools').addEventListener('click', e => { const b = e.target.closest('button[data-c]'); if (b) gdCmd(b.dataset.c); });
$('gdblock').addEventListener('change', () => { $('gdbody').focus(); document.execCommand('formatBlock', false, $('gdblock').value); gdChanged(); gdPaintTools(); });
$('gdbody').addEventListener('input', gdChanged);
$('gdbody').addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey; if (!mod) return;
  const k = e.key.toLowerCase(), code = e.code;
  let c = null;
  if (!e.shiftKey && !e.altKey && k === 'b') c = 'bold'; else if (!e.shiftKey && !e.altKey && k === 'i') c = 'italic'; else if (!e.shiftKey && !e.altKey && k === 'u') c = 'underline';
  else if (e.shiftKey && code === 'Period') c = 'bigger'; else if (e.shiftKey && code === 'Comma') c = 'smaller';
  else if (e.shiftKey && code === 'Digit8') c = 'insertUnorderedList'; else if (e.shiftKey && code === 'Digit7') c = 'insertOrderedList';
  else if (code === 'Backslash') c = 'removeFormat';
  else if (!e.shiftKey && k === 's') { e.preventDefault(); gdSave(); return; }
  if (c) { e.preventDefault(); gdCmd(c); }
});
document.addEventListener('selectionchange', () => { if ($('gdov').classList.contains('open')) gdPaintTools(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('gdov').classList.contains('open')) { e.stopPropagation(); gdClose(); } }, true);
$('gdbody').addEventListener('click', e => { const a = e.target.closest('a[href]'); if (a && (e.metaKey || e.ctrlKey)) window.open(a.href, '_blank', 'noopener'); });   // ⌘-click opens a link (a plain click edits it)
if (typeof ResizeObserver === 'function') new ResizeObserver(() => {   // the box's size, remembered
  const b = $('gdbox'); if (!$('gdov').classList.contains('open') || !b.style.width && !b.style.height && b.offsetWidth < 10) return;
  clearTimeout(GD.rz); GD.rz = setTimeout(() => grSave('fcg-readme-size', {w: b.offsetWidth, h: b.offsetHeight}), 300);
}).observe($('gdbox'));
