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
   The replay: graded_hist.bin (graded_forecast.build_hist) - every month since 2022 its best-ranked PriceCharting graded
   lines, the odds each group would have shown that month (only outcomes known by then; 2022 has too few, so it borrows
   the whole period's, marked *) and what each line did over the next 1..6 months. Graded Forecasting's plan is run on
   each month here, in the page, with that page's boxes (capital, % under, shipping, the price band, the share, the bar,
   the copies, the gate) and its Grading ticks, then scored at PriceCharting's price when the hold was up.
   The recorded plans: Graded > Planning's Record plan, kept by the collector (live.gplans); Actual = the slabs sold at
   PriceCharting's price of the month each hold ends (today's price while that month is still running). */
const FHG = {doc: null, err: null, loaded: null, key: '', cells: null, todo: 0, busy: null, open: new Set(), trendBusy: false, trendMiss: new Set(),
  win: ['rp', 'rec', 'sc'].includes(grLS('fhg-win', 'rp')) ? grLS('fhg-win', 'rp') : 'rp'};   // History's window: Forecasting Replay / Recorded Purchases / Pre-Sales Spotcheck
const FHG_LINE = {psa_10: 'PSA 10', grade_9_5: 'Grade 9.5', grade_9: 'Grade 9', grade_8: 'Grade 8', grade_7: 'Grade 7'};
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
    FHG.doc = doc; FHG.err = null; FHG.key = ''; FHG.cells = null;
  } catch (e) { FHG.err = e.message; }
  fhgRender();
}
// Graded Forecasting's boxes and Grading ticks, as the replay uses them
function fhgSettings() {
  const I = fcgInputs(), lines = new Set();
  for (const gk of GF.fc.gsel) { const l = FCG_LINE(gk); if (l && FHG.doc) { const i = FHG.doc.lines.indexOf(l); if (i >= 0) lines.add(i); } }
  return Object.assign({}, I, {fee: fcgFee(), lines});
}
const fhgKey = S => JSON.stringify(Object.assign({}, S, {lines: [...S.lines].sort(), h: 0})) + '|' + (FHG.doc ? FHG.doc.t : '');   // h: every hold is run, the pane's Hold only tints one
// one month's plan at one hold: the candidates through the boxes, chance at the break-even, buy order, the greedy allocation
function fhgPlan(mi, h, S) {
  const doc = FHG.doc, QD = {qs: doc.qs}, tabs = doc.tab[mi][h - 1], be = fcgBreak(S.disc, S.fee), rows = [], ts = {};
  for (const c of doc.cands[mi]) {
    const li = c[1], std = c[2];
    if (!S.lines.has(li) || std < S.pmin || std > S.pmax) continue;
    const buy = std * (1 - S.disc) - S.ship; if (!(buy > 0)) continue;
    const pct = c[3] / 1000, g = Math.min(9, Math.floor(pct * 10)), grid = tabs[g]; if (!grid) continue;
    const t = ts[g] || (ts[g] = {mean: grid[0], q: grid.slice(1)});
    const y = c[4 + h - 1];
    rows.push({cid: c[0], li, std, pct, g, t, buy, p: Math.min(0.95, 1 - fcgCdf(QD, t, be)), y: y == null ? null : y / (doc.yscale || 1000), q: 0});
  }
  rows.sort((a, b) => Math.round(b.p * 100) - Math.round(a.p * 100) || b.pct - a.pct || b.std - a.std);
  const gated = !!(S.gate && !doc.up[mi]), elig = rows.filter(r => r.p >= S.minp);
  let left = S.cap;
  if (!gated) for (const r of elig) { const q = Math.min(Math.floor(S.cap * S.share / r.buy), S.copies, Math.floor(left / r.buy)); if (q > 0) { r.q = q; left -= q * r.buy; } }
  return {picks: elig.filter(r => r.q > 0), spent: S.cap - left, gated, best: rows.reduce((b, r) => Math.max(b, r.p), 0), n: rows.length};
}
function fhgCell(mi, h, S) {
  const doc = FHG.doc, P = fhgPlan(mi, h, S), picks = P.picks, done = mi + h <= doc.months.length - 1;
  const c = {n: picks.length, copies: picks.reduce((s, r) => s + r.q, 0), spent: P.spent, gated: P.gated, best: P.best, done,
             picks: picks.map(r => [r.cid, r.li, r.std, r.buy, r.q, r.p, fcgNet(r.std, r.t.mean, S.disc, S.fee), r.y])};
  if (!picks.length) return c;
  const mc = fcgMonteCarlo({qs: doc.qs}, picks.map(r => ({fcQ: r.q, fcS: r.std, fcT: r.t, fcD: S.disc})), S, S.fee, 1000);
  Object.assign(c, {exp: mc.mean, lo: mc.lo, hi: mc.hi, p: mc.p});
  const priced = picks.filter(r => r.y != null);
  if (done && priced.length) {
    const spent = priced.reduce((s, r) => s + r.q * r.buy, 0);
    c.actual = priced.reduce((s, r) => s + r.q * fcgNet(r.std, r.y, S.disc, S.fee), 0); c.roi = spent ? c.actual / spent : null;
    c.inside = c.actual >= mc.lo && c.actual <= mc.hi; c.priced = priced.length;
  }
  return c;
}
// the 6 x months cells for the current settings, a slice at a time between frames (each runs a 1,000-draw basket)
function fhgRun() {
  if (!FHG.doc) return;
  const S = fhgSettings(), key = fhgKey(S);
  if (FHG.key === key && FHG.cells && !FHG.todo) return;
  if (FHG.busy && FHG.busy.key === key) return;
  const doc = FHG.doc, M = doc.months.length, cells = Array.from({length: M}, () => new Array(6).fill(null)), job = FHG.busy = {key, i: 0};
  FHG.key = key; FHG.cells = cells; FHG.todo = M * 6;
  const step = () => {
    if (FHG.busy !== job) return;
    const t0 = performance.now();
    while (job.i < M * 6 && performance.now() - t0 < 40) { const mi = Math.floor(job.i / 6), h = job.i % 6 + 1; cells[mi][h - 1] = fhgCell(mi, h, S); job.i++; }
    FHG.todo = M * 6 - job.i;
    const note = $('fhg-run'); if (note) note.textContent = FHG.todo ? 'Running the plans… ' + job.i + ' of ' + M * 6 : '';
    if (FHG.todo) setTimeout(step, 0); else { FHG.busy = null; fhgPaint(); }
  };
  setTimeout(step, 0);
}
// the hold cards: the mean ROI and the mean chance of each hold over the months
function fhgCards() {
  const box = $('fhg-cards'); if (!box) return;
  if (!FHG.doc || !FHG.cells || FHG.todo) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="stats fc-stats">' + [1, 2, 3, 4, 5, 6].map(h => {
    const cs = FHG.cells.map(m => m[h - 1]).filter(c => c && c.n), sc = cs.filter(c => c.roi != null);
    const roi = sc.length ? sc.reduce((s, c) => s + c.roi, 0) / sc.length : null, p = cs.length ? cs.reduce((s, c) => s + c.p, 0) / cs.length : null;
    return '<div class="stat" title="' + esc(cs.length + ' of ' + FHG.cells.length + ' months with buys; ROI over the ' + sc.length + ' whose hold is up') + '"><div class="k">' + h + '-month hold</div><div class="v"><span class="' + (roi > 0 ? 'up' : roi < 0 ? 'down' : '') + '">' + (roi == null ? '-' : fcPct(roi, 1)) + '</span> <span class="dim" style="font-size:11px">mean ROI</span></div><div class="v">' + (p == null ? '-' : Math.round(p * 100) + '%') + ' <span class="dim" style="font-size:11px">mean chance</span></div></div>';
  }).join('') + '</div>';
}
// the replay's rows: one per month, newest first; sort keys per hold b/e/lo/p/a/r + hold number
function fhgRowsData() {
  if (!FHG.doc || !FHG.cells || FHG.todo) return [];
  const doc = FHG.doc, out = [];
  for (let mi = doc.months.length - 1, o = 0; mi >= 0; mi--, o++) {
    const r = [o]; r.mi = mi; r.m = doc.months[mi]; r.g = doc.up[mi] ? 'up' : 'down';
    for (let h = 1; h <= 6; h++) { const c = FHG.cells[mi][h - 1] || {}; r['b' + h] = c.n || 0; r['e' + h] = c.exp; r['lo' + h] = c.lo; r['p' + h] = c.p; r['a' + h] = c.actual; r['r' + h] = c.roi; }
    out.push(r);
  }
  return out;
}
const fhgD = '<td class="num"><span class="dim">-</span></td>';
function fhgHoldCells(c, done, pendWord) {
  if (!c || !c.n) return '<td class="num fhg-none"><span class="dim">' + (c && c.gated ? 'gate: falling' : 'no buys') + (c && c.best ? ' · best ' + Math.round(c.best * 100) + '%' : '') + '</span></td>' + fhgD + fhgD + fhgD + fhgD + fhgD;
  const roiE = c.spent ? c.exp / c.spent : null;
  return '<td class="num">' + c.n + (c.copies !== c.n ? ' · ' + c.copies : '') + '<br><span class="dim">' + fcMoney(c.spent) + '</span></td>' +
    '<td class="num">' + fcMoney(c.exp) + '<br><span class="dim">' + fcPct(roiE, 1) + '</span></td>' +
    '<td class="num">' + fcMoney(c.lo) + '<br><span class="dim">to ' + fcMoney(c.hi) + '</span></td>' +
    '<td class="num">' + Math.round((c.p || 0) * 100) + '%</td>' +
    (c.actual != null ? '<td class="num" title="' + esc((c.inside ? 'inside' : 'outside') + ' the 10-90% range' + (c.priced < c.n ? '; ' + c.priced + ' of ' + c.n + ' slabs had a PriceCharting price when the hold was up' : '')) + '"><b class="' + (c.actual > 0 ? 'up' : c.actual < 0 ? 'down' : '') + '">' + fcMoney(c.actual) + '</b> <span class="dim">' + (c.inside ? '✓' : '✗') + '</span></td><td class="num ' + (c.roi > 0 ? 'up' : c.roi < 0 ? 'down' : '') + '">' + fcPct(c.roi, 1) + '</td>'
      : '<td class="num"><span class="dim">' + (done ? 'no price' : pendWord) + '</span></td>' + fhgD);
}
function fhgRow(r) {
  const doc = FHG.doc, mi = r.mi, first = doc.first && doc.first[mi];
  let s = '<td><b>' + esc(r.m) + '</b>' + (first ? ' <span class="dim" title="Too few outcomes were known yet: the odds of the whole period stand in (the chances here look a little back)">*</span>' : '') + '</td>' +
    '<td>' + r.g + (doc.reg3 && doc.reg3[mi] != null ? '<br><span class="dim">' + fcPct(doc.reg3[mi], 1) + '/mo</span>' : '') + '</td>';
  for (let h = 1; h <= 6; h++) s += fhgHoldCells(FHG.cells[mi][h - 1], mi + h <= doc.months.length - 1, 'hold not up yet').replace(/<td class="/g, '<td class="fhh-h' + h + ' ');
  return s;
}
const fhgName = cid => { const r = idRow.get(+cid); return r ? [r[1], String(r[2] || '').replace(/^Pokemon /, '')] : ['card ' + cid, '']; };   // the catalog's name and set
function fhgDetail(r) {                                  // a month opened: each hold's slabs
  const doc = FHG.doc, mi = r.mi, S = fhgSettings();
  return [1, 2, 3, 4, 5, 6].map(h => {
    const c = FHG.cells[mi][h - 1];
    if (!c || !c.n) return '<h4>' + h + '-month hold</h4><p class="dim">No buys' + (c && c.gated ? ' (the market was falling and the gate is on)' : '') + (c && c.best ? '; best chance ' + Math.round(c.best * 100) + '%' : '') + '.</p>';
    return '<h4>' + h + '-month hold · ' + c.n + ' slab' + (c.n > 1 ? 's' : '') + ', ' + fcMoney(c.spent) + ' spent</h4><table><thead><tr><th>Card</th><th>Grade</th><th class="num">Copies</th><th class="num">Standard</th><th class="num">Paid</th><th class="num">Chance</th><th class="num">Expected net</th><th class="num">Actual net</th></tr></thead><tbody>' +
      c.picks.map(p => { const [cid, li, std, buy, q, ch, en, y] = p, nm = fhgName(cid), real = y == null ? null : fcgNet(std, y, S.disc, S.fee);
        return '<tr><td>' + esc(nm[0]) + '<br><span class="dim">' + esc(nm[1]) + '</span></td><td>' + esc(FHG_LINE[doc.lines[li]] || doc.lines[li]) + '</td><td class="num">' + q + '</td><td class="num">' + fmtMoneyPlain(std) + '</td><td class="num">' + fmtMoneyPlain(buy) + '</td><td class="num">' + Math.round(ch * 100) + '%</td><td class="num">' + fcMoney2(en) + '</td><td class="num">' + (real == null ? '<span class="dim">' + (mi + h <= doc.months.length - 1 ? 'no price' : 'hold not up yet') + '</span>' : '<b class="' + (real > 0 ? 'up' : real < 0 ? 'down' : '') + '">' + fcMoney2(real) + '</b> <span class="dim">(' + fcPct(y, 0) + ')</span>') + '</td></tr>'; }).join('') + '</tbody></table>';
  }).join('') + '<p class="dim">Graded lines: PriceCharting’s PSA 10 line, and its Grade 9.5 / 9 / 8 / 7 lines (every grader blended). Standard = the line’s price that month or its 3-month average, whichever is higher.</p>';
}
const fhxColspan = id => [...document.querySelectorAll('#' + id + '-t thead tr:last-child th')].filter(th => !th.classList.contains('col-hidden')).length || 40;
function fhxInsert(id, t, isOpen, detail) {               // the opened rows' details, under each
  const tb = $('rows-' + id), n = fhxColspan(id);
  [...tb.children].forEach(tr => { if (!tr.classList.contains('fhx')) { const r = t.view.find(x => String(x.key) === tr.dataset.key); tr.classList.toggle('open', !!(r && isOpen(r))); if (r && isOpen(r)) { const x = document.createElement('tr'); x.className = 'fhx'; x.innerHTML = '<td data-ci="x" colspan="' + n + '"><div class="fhx-in">' + detail(r) + '</div></td>'; tr.after(x); } } });
}
/* ---- the holds (2026-11-05, Brett: "There should be an eye symbol for each to hide them. There should be a headers of a
   headers button to toggle which ones we want to see"; "it should be applied to both tables, the recorded table and month
   by month history table. if i hide something in one, then it hides in the other. if i want to show it again, then i go
   to the holds buttons and toggle it back on"; and the pane's Hold tints its own hold). One choice for both tables, by
   column key - b3 / e3 / lo3 / p3 / a3 / r3: the 3-month hold's Buys, Expected, Range, Chance, Actual, ROI - kept in
   'fhg-hcols'; the eye on a hold's header hides all of its columns (the header goes with them), a column's own eye
   hides that column in both tables, Holds… brings them back. The columns outside the holds keep each table's own eyes. ---- */
const FHH_RE = /^(b|e|lo|p|a|r)([1-6])$/;
const FHH_PARTS = [['b', 'Buys', 'Forecasting Replay and Pre-Sales Spotcheck: how many slabs were bought'], ['e', 'Expected'], ['lo', 'Range', 'Forecasting Replay and Recorded Purchases'], ['p', 'Chance'], ['a', 'Actual'], ['r', 'ROI']];
const FHH_ROOT = {fhg: '#fhg-rp', fhr: '#fhg-rec', fhs: '#fhg-sc'};   // fhs: Pre-Sales Spotcheck (2026-11-05)
const FHH_IDS = Object.keys(FHH_ROOT);
const FHH_NEW = grLS('fhg-hcols', null) == null;
const FHH = new Set(grLS('fhg-hcols', []) || []);
const FHH_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C7 5 3 8.5 1.5 12 3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" fill="currentColor"/></svg>';
let FHH_LOCK = false;
const fhhThs = id => [...document.querySelectorAll(FHH_ROOT[id] + ' thead tr:last-child th')];
const fhhSave = () => grSave('fhg-hcols', [...FHH]);
function fhhApply(id) {                                   // the shared choice onto one table (its other columns as they are)
  const t = tables[id]; if (!t) return;
  const hide = fhhThs(id).filter(th => { const k = th.dataset.k || ''; return FHH_RE.test(k) ? FHH.has(k) : th.classList.contains('col-hidden'); }).map(th => +th.dataset.ci);
  FHH_LOCK = true; try { t.setHidden(hide); } finally { FHH_LOCK = false; }
}
const fhhBoth = () => { fhhSave(); FHH_IDS.forEach(fhhApply); };
function fhhTake(id, hidden) {                            // a column's eye in one table: the same column in the others
  if (FHH_LOCK) return;
  fhhThs(id).forEach(th => { const k = th.dataset.k || ''; if (FHH_RE.test(k)) { if (hidden.has(+th.dataset.ci)) FHH.add(k); else FHH.delete(k); } });
  fhhSave(); FHH_IDS.filter(x => x !== id).forEach(fhhApply);
}
function fhhSetHold(h, on) { FHH_PARTS.forEach(([p]) => { if (on) FHH.delete(p + h); else FHH.add(p + h); }); fhhBoth(); }
function fhhInit(id) {                                    // the hold classes on the headers, an eye on each hold's header
  fhhThs(id).forEach(th => { const m = FHH_RE.exec(th.dataset.k || ''); if (m) th.classList.add('fhh-h' + m[2]); });
  document.querySelectorAll(FHH_ROOT[id] + ' thead tr.grp th.band').forEach((th, i) => {
    const h = i + 1, b = document.createElement('button');
    th.classList.add('fhh-band', 'fhh-h' + h);
    b.type = 'button'; b.className = 'eye fhh-eye'; b.innerHTML = FHH_EYE; b.title = 'Hide the ' + h + '-month hold, in all three History windows (the Holds… button brings it back)';
    b.addEventListener('click', e => { e.stopPropagation(); fhhSetHold(h, false); });
    th.appendChild(b);
  });
}
function fhhOpen() {                                      // Holds…: the holds and their columns, one choice for both tables
  const cur = fcgInputs().h, shownN = h => FHH_PARTS.filter(([p]) => !FHH.has(p + h)).length;
  $('btitle').textContent = 'Holds · History (graded)';
  $('bsub').textContent = 'Tick the holds, and the columns under them, that Forecasting Replay, Recorded Purchases and Pre-Sales Spotcheck show - one choice for all three. The eye on a hold’s header hides the whole hold; tick it here to bring it back. Your Hold (the plan pane) is tinted. Remembered in this browser.';
  $('bbody').innerHTML = '<div class="fhh-pick">' + [1, 2, 3, 4, 5, 6].map(h => '<div class="fhh-row' + (h === cur ? ' fhh-cur' : '') + '"><label class="fhh-all"><input type="checkbox" data-h="' + h + '"' + (shownN(h) ? ' checked' : '') + '> <b>' + h + '-month hold</b>' + (h === cur ? ' <span class="dim">(your Hold)</span>' : '') + '</label>' +
    '<span class="fhh-parts">' + FHH_PARTS.map(([p, l, tip]) => '<label' + (tip ? ' title="' + esc(tip) + '"' : '') + '><input type="checkbox" data-k="' + p + h + '"' + (FHH.has(p + h) ? '' : ' checked') + '> ' + l + '</label>').join('') + '</span></div>').join('') + '</div>' +
    '<div class="pickbtns"><button class="reset" id="fhh-all">Show every hold</button><button class="reset" id="fhh-done">Done</button></div>';
  $('bbody').querySelectorAll('input[data-h]').forEach(i => { const n = shownN(+i.dataset.h); i.indeterminate = n > 0 && n < FHH_PARTS.length; });
  $('bbody').querySelector('.fhh-pick').addEventListener('input', e => {
    const i = e.target;
    if (i.dataset.h) fhhSetHold(+i.dataset.h, i.checked);
    else if (i.dataset.k) { if (i.checked) FHH.delete(i.dataset.k); else FHH.add(i.dataset.k); fhhBoth(); }
    fhhOpen();
  });
  $('fhh-all').addEventListener('click', () => { FHH.clear(); fhhBoth(); fhhOpen(); });
  $('fhh-done').addEventListener('click', () => $('bov').classList.remove('open'));
  $('bov').classList.add('open');
}
tables.fhg = makeTable('fhg', {rows: fhgRowsData, noun: 'months', ranges: [], labels: {}, defaults: {}, root: '#fhg-rp', name: 'Forecast · graded history replay', onCols: h => fhhTake('fhg', h),
  key: r => { r.key = r.m; return r.m; }, hay: r => r.m, row: fhgRow, rowClass: () => 'fhg-row',
  after: t => fhxInsert('fhg', t, r => FHG.open.has('m:' + r.m), fhgDetail)});

/* ---- the recorded plans ---- */
function fhrRecs() {
  const live = ((LIVE.data && LIVE.data.gplans) || {}), recs = (live.recs || []).slice(), have = new Set(recs.map(r => r.id));
  FCR.echo = FCR.echo.filter(e => !have.has(e.id) && Date.now() - e.t < 2 * 86400000); grSave('fcg-gplan-echo', FCR.echo);
  for (const e of FCR.echo) recs.push(e);
  if (FCR.gone.size && live.t) { for (const id of [...FCR.gone]) if (!have.has(id)) FCR.gone.delete(id); grSave('fcg-gplan-gone', [...FCR.gone]); }
  return recs.filter(r => !FCR.gone.has(r.id)).sort((a, b) => b.t - a.t);
}
const fhrDue = (t, h) => { const d = new Date(t); d.setMonth(d.getMonth() + h); return d; };
const fhrYm = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
// a slab's PriceCharting price in the month its hold ends: the month's point in its trend line, today's price while that
// month is the newest; null = not loaded yet (a load is started) or no price
function fhrPrice(cid, gk, ym) {
  const tr = GR.trend.get(+cid);
  if (!tr) { if (!FHG.trendMiss.has(+cid)) fhrWantTrend(+cid); return undefined; }
  const pts = gtSeries(tr, 'pc|' + gk).pts.filter(p => p[1] != null), base = fcrMap().get(cid + '|' + gk);
  const at = pts.find(p => p[0] === ym); if (at) return at[1];
  const last = pts.length ? pts[pts.length - 1][0] : '';
  if (ym > last) return base ? fcgStd(base)[0] : null;
  const before = pts.filter(p => p[0] < ym); return before.length ? before[before.length - 1][1] : null;
}
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
    FHG.trendBusy = false; if (tables.fhr) tables.fhr.apply(true); if (tables.fhs && FHG.win === 'sc') tables.fhs.apply(true);
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
function fhrRowsData() {
  return fhrRecs().map((rec, o) => {
    const r = [o]; r.rec = rec; r.key = String(rec.id); r.t = rec.t; r.h = rec.h; r.sp = rec.spent; r.n = rec.slabs.length;
    r.acts = [];
    for (let h = 1; h <= 6; h++) { const x = (rec.holds || [])[h - 1], a = fhrActual(rec, h); r.acts.push(a); r['e' + h] = x ? x[0] : null; r['lo' + h] = x ? x[1] : null; r['p' + h] = x ? x[3] : null; r['a' + h] = a.actual; r['r' + h] = a.roi; }
    return r;
  });
}
const fhrDate = t => { const d = new Date(t); return MONTHS_S[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); };
function fhrRow(r) {
  const rec = r.rec;
  let s = '<td><b>' + fhrDate(rec.t) + '</b>' + (rec.smp ? '<span class="fhr-smp" title="Recorded with sample slabs among the purchases">sample</span>' : '') + (rec.local ? ' <span class="dim" title="Sent; the collector confirms it in a minute or two">sending…</span>' : '') + '<br><span class="dim">' + esc(new Date(rec.t).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})) + '</span></td>' +
    '<td>' + rec.h + ' mo</td><td class="num">' + fmtMoneyPlain(rec.spent) + '</td><td class="num">' + rec.slabs.length + '</td>';
  for (let h = 1; h <= 6; h++) {
    const x = (rec.holds || [])[h - 1], a = r.acts[h - 1], on = h === rec.h ? ' fhr-on' : '';
    const td = (inner, cls) => '<td class="num fhh-h' + h + on + (cls ? ' ' + cls : '') + '">' + inner + '</td>';
    s += x ? td(fcMoney(x[0]) + '<br><span class="dim">' + fcPct(rec.spent ? x[0] / rec.spent : null, 1) + '</span>') + td(fcMoney(x[1]) + '<br><span class="dim">to ' + fcMoney(x[2]) + '</span>') + td(Math.round(x[3] * 100) + '%')
      : td('<span class="dim">-</span>') + td('<span class="dim">-</span>') + td('<span class="dim">-</span>');
    s += a.pending ? td('<span class="dim" title="' + esc('the hold is up on ' + fhrDate(a.due.getTime())) + '">hold not up yet</span>') + td('<span class="dim">-</span>')
      : a.loading ? td('<span class="dim">…</span>') + td('<span class="dim">-</span>')
      : a.none ? td('<span class="dim">no price</span>') + td('<span class="dim">-</span>')
      : td('<b class="' + (a.actual > 0 ? 'up' : a.actual < 0 ? 'down' : '') + '"' + (a.priced < a.n ? ' title="' + a.priced + ' of ' + a.n + ' slabs had a price"' : '') + '>' + fcMoney(a.actual) + '</b>' + (x ? ' <span class="dim">' + (a.actual >= x[1] && a.actual <= x[2] ? '✓' : '✗') + '</span>' : '')) + td(fcPct(a.roi, 1), a.roi > 0 ? 'up' : a.roi < 0 ? 'down' : '');
  }
  return s;
}
// a plan opened: its slabs with Planning's columns, a star and Review, what each made when the recorded hold was up, and
// the PriceCharting tab's columns (2026-11-04, Brett: "for the listings within each recorded planning record under the
// history button ... those columns toggles can work on. but may those column should be tinted a light pastel blue so i
// know which columns related to history and which from pc reg listing attributes"): the plan's own figures are tinted
// blue; which columns show is the graded pages' shared choice (FCG_COLS), set with this list's Columns… button too.
const FHR_COLS = [{key: 'k:fav', label: '★'}, {key: 'k:42', label: 'Flag'}, {key: 'l:Review', label: 'Review'}, {key: 'k:1', label: 'PC Card Name'}, {key: 'k:24', label: 'Grade'},
  {key: 'k:fcPct', label: 'Rank', h: 1, num: 1}, {key: 'k:fcS', label: 'Standard Price', h: 1, num: 1}, {key: 'k:fcD', label: '% Under Paid', h: 1, num: 1}, {key: 'k:fcB', label: 'Price Paid', h: 1, num: 1},
  {key: 'k:16', label: 'Sold (last month)', num: 1}, {key: 'k:fcP', label: 'Chance', h: 1, num: 1}, {key: 'k:fcQ', label: 'QTY', h: 1, num: 1}, {key: 'k:fcN', label: 'Net', h: 1, num: 1},
  {key: 'k:fcR', label: 'ROI %', h: 1, num: 1}, {key: 'h:actual', label: 'Actual', h: 1, num: 1}, {key: 'k:fcU', label: 'Purchased', h: 1}]
  .concat(FCG_PCH ? FCG_PCX.map((i, j) => ({key: 'pc:' + i, label: fcgColText(FCG_PCH[i]), pc: j, th: FCG_PCH[i]})) : []);
function fhrDetail(r) {
  const rec = r.rec, h = rec.h, due = fhrDue(rec.t, h), up = Date.now() >= due.getTime(), ym = fhrYm(due);
  const cols = FHR_COLS.filter(c => !fcgColHidden(c.key)), hc = c => c.h ? ' fhr-h' : '';
  const rows = rec.slabs.map(s => {
    const [cid, gk, dk, std, stdc, paid, pk, net, rk] = s, base = GR.doc ? fcrMap().get(cid + '|' + gk) : null, c = GR.doc ? (GR.doc.cards || {})[String(cid)] || {} : {};
    const nm = base ? [base[1], String(base[2] || '').replace(/^Pokemon /, '') + (base[3] ? ' · #' + base[3] : '')] : fhgName(cid), d = dk / 1000;
    const p1 = up ? fhrPrice(cid, gk, ym) : null, real = p1 == null ? null : p1 * (1 - rec.fee) - rec.ship - paid;
    const cl = stdc == null ? null : stdc * (1 - d) - rec.ship, two = (a, b, k) => '<td class="num fcg2' + k + '"><span><i>CL</i> ' + a + '</span><span><i>PC</i> ' + b + '</span></td>';
    const pct = rk == null ? null : rk / 1000, g = pct == null ? null : Math.min(9, Math.floor(pct * 10)), dash = k => '<td class="num' + k + '"><span class="dim">-</span></td>';
    const pcx = cols.some(x => x.pc != null) ? fcgPcx(base) : [];
    const cell = {
      'k:fav': k => '<td class="favc' + k + '">' + favBtn('pc', cid, cid) + '</td>',
      'k:42': k => { const fl = base && base[42], key = esc(cid + '|' + gk);   // the row's flag, the same as everywhere else (2026-11-05)
        return '<td class="gflc' + k + '">' + (!base ? '<span class="dim">-</span>' : fl ? '<button class="gflag on" data-k="' + key + '" title="' + esc('Your flag: ' + fl + '. Click to change it or take it off.') + '">⚑ ' + esc(fl) + '</button>' : '<button class="gflag" data-k="' + key + '" title="Flag this slab with a reason - the same flag as on the PriceCharting tab and the other Forecast pages">⚐</button>') + '</td>'; },
      'l:Review': k => '<td class="' + k + '">' + (c.pid ? '<button class="rvb grvb' + (base && base[41] === 1 ? ' same' : base && base[41] === 0 ? ' diff' : '') + '" data-k="' + esc(cid + '|' + gk) + '">Review</button>' : '<span class="dim">-</span>') + '</td>',
      'k:1': k => '<td class="' + k + '">' + esc(nm[0]) + '<br><span class="dim">' + esc(nm[1]) + '</span></td>',
      'k:24': k => '<td class="' + k + '"><b>' + esc(base ? base[25] : grLabel(gk)) + '</b></td>',
      'k:fcPct': k => pct == null ? dash(k) : '<td class="num' + k + '">' + fcOrd(Math.round(pct * 100)) + '<br><span class="dim">' + (g === 9 ? 'deepest 10%' : 'group ' + (10 - g) + ' of 10') + '</span></td>',
      'k:fcS': k => two(stdc == null ? '<span class="dim">-</span>' : fmtMoney(stdc), std == null ? '<span class="dim">-</span>' : fmtMoney(std), k),
      'k:fcD': k => '<td class="num' + k + '">' + (Math.round(d * 1000) / 10) + '%</td>',
      'k:fcB': k => two(cl == null ? '<span class="dim">-</span>' : fmtMoney(cl), fmtMoney(paid), k),
      'k:16': k => two(base && base[37] != null ? fmtInt(base[37]) : '<span class="dim">-</span>', base && base[16] != null ? fmtInt(base[16]) : '<span class="dim">-</span>', k),
      'k:fcP': k => '<td class="num' + k + '">' + (pk == null ? '<span class="dim">no score</span>' : (pk / 10).toFixed(0) + '%') + '</td>',
      'k:fcQ': k => '<td class="num' + k + '">1</td>',
      'k:fcN': k => '<td class="num' + k + '">' + (net == null ? '<span class="dim">-</span>' : fcgMoneyS(net)) + '</td>',
      'k:fcR': k => '<td class="num' + k + '">' + (net == null || !paid ? '<span class="dim">-</span>' : fcgPct(net / paid)) + '</td>',
      'h:actual': k => '<td class="num' + k + '">' + (!up ? '<span class="dim">hold not up yet</span>' : real == null ? '<span class="dim">' + (p1 === undefined ? '…' : 'no price') + '</span>' : '<b class="' + (real > 0 ? 'up' : real < 0 ? 'down' : '') + '">' + fcMoney2(real) + '</b> <span class="dim">at ' + fmtMoneyPlain(p1) + '</span>') + '</td>',
      'k:fcU': k => '<td class="' + k + '"><span class="fcr-pu"><button type="button" class="yes on" disabled>Yes</button></span></td>'};
    return '<tr>' + cols.map(x => x.pc != null ? (pcx[x.pc] || gdash) : cell[x.key](hc(x))).join('') + '</tr>';
  }).join('');
  const head = cols.map(x => {
    if (x.pc != null) { const th = x.th.cloneNode(true); th.querySelectorAll('.s').forEach(n => n.remove()); th.removeAttribute('data-k'); return th.outerHTML; }
    const tip = x.key === 'k:fcP' ? ' title="the chance for the ' + h + '-month hold, the day it was recorded"' : x.key === 'k:fcN' ? ' title="expected net for the ' + h + '-month hold, the day it was recorded"' : x.key === 'h:actual' ? ' title="sold at PriceCharting’s price in the month the ' + h + '-month hold is up, after eBay’s fee and the shipping"' : '';
    return '<th class="' + (x.num ? 'num' : '') + hc(x) + '"' + tip + '>' + (x.key === 'h:actual' ? 'Actual (' + h + ' mo)' : x.label) + '</th>';
  }).join('');
  return '<h4>' + rec.slabs.length + ' slab' + (rec.slabs.length > 1 ? 's' : '') + ' bought ' + fhrDate(rec.t) + ' for ' + fmtMoneyPlain(rec.spent) + ' · held ' + h + ' month' + (h > 1 ? 's' : '') + ' (up ' + fhrDate(due.getTime()) + ') · ' + (Math.round(rec.disc * 1000) / 10) + '% under by default, ' + fmtMoneyPlain(rec.ship) + ' shipping, eBay’s fee ' + (Math.round(rec.fee * 1000) / 10) + '% · capital ' + fmtMoneyPlain(rec.cap) + (rec.reg ? ' · market ' + esc(rec.reg) : '') + '</h4>' +
    '<div class="fhr-bar"><button type="button" class="reset fhr-cols" title="Which columns the slab lists show - the same choice as Forecasting, Recording and Purchases">Columns…</button><span class="dim"><span class="fhr-sw"></span> the record’s own figures (History); the rest are the slab’s listing details</span></div>' +
    '<table class="fhr-slabs"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<button type="button" class="fhr-del" data-id="' + esc(rec.id) + '" title="Take these purchases off History (for a record made by mistake)">Remove this record</button>';
}
function fhrOpenColumns() {                               // the slab lists' Columns… (the shared choice)
  $('btitle').textContent = 'Columns · History slabs';
  $('bsub').textContent = 'Tick the columns the recorded purchases’ slab lists show. The same choice as Forecasting, Recording and Purchases (graded); blue = the record’s own figures. Remembered in this browser.';
  $('bbody').innerHTML = '<div class="colpick">' + FHR_COLS.map(c => '<label' + (c.h ? ' class="fhr-h"' : '') + '><input type="checkbox" data-key="' + esc(c.key) + '"' + (fcgColHidden(c.key) ? '' : ' checked') + '> ' + esc(c.label) + '</label>').join('') + '</div>' +
    '<div class="pickbtns"><button class="reset" id="fhrc-plan">The plan’s columns only</button><button class="reset" id="fhrc-all">All columns</button><button class="reset" id="fhrc-done">Done</button></div>';
  const set = (key, on) => { FCG_COLS[key] = on ? 0 : 1; };
  const done = () => { grSave('fcg-cols', FCG_COLS); tables.fhr.apply(true); };
  $('bbody').querySelector('.colpick').addEventListener('input', e => { const i = e.target; if (!i || !i.dataset.key) return; set(i.dataset.key, i.checked); done(); });
  $('fhrc-all').addEventListener('click', () => { FHR_COLS.forEach(c => set(c.key, true)); done(); fhrOpenColumns(); });
  $('fhrc-plan').addEventListener('click', () => { FHR_COLS.forEach(c => set(c.key, c.pc == null)); done(); fhrOpenColumns(); });
  $('fhrc-done').addEventListener('click', () => $('bov').classList.remove('open'));
  $('bov').classList.add('open');
}
tables.fhr = makeTable('fhr', {rows: fhrRowsData, noun: 'recorded purchases', ranges: [], labels: {}, defaults: {}, root: '#fhg-rec', name: 'Forecast · recorded graded purchases', onCols: h => fhhTake('fhr', h),
  key: r => r.key, row: fhrRow, rowClass: () => 'fhr-row',
  hay: r => r.rec.slabs.map(s => { const b = GR.doc ? fcrMap().get(s[0] + '|' + s[1]) : null; return b ? b[1] + ' ' + b[2] + ' ' + b[25] : fhgName(s[0]).join(' ') + ' ' + grLabel(s[1]); }).join(' ') + ' ' + fhrDate(r.rec.t),
  after: t => {
    fhxInsert('fhr', t, r => FHG.open.has('p:' + r.key), fhrDetail);
    const none = $('fhr-none'); if (none) none.textContent = t.view.length ? '' : (LIVE.data ? 'No purchases recorded yet: Record Purchases (on Purchases, in the plan pane) puts them here.' : 'Waiting for the live data.');
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
   (the replay's rules: bought at the higher of the price and its 3-month average). ---- */
const FHS = {echo: grLS('fcg-gspot-echo', []), gone: new Set(grLS('fcg-gspot-gone', [])), open: new Set(), cache: new Map()};
const fhsYi = ym => +String(ym).slice(0, 4) * 12 + +String(ym).slice(5, 7) - 1;
const fhsYm = i => Math.floor(i / 12) + '-' + String(i % 12 + 1).padStart(2, '0');
function fhsRecs() {
  const live = (LIVE.data && LIVE.data.gspots) || {}, recs = (live.recs || []).slice(), have = new Set(recs.map(r => r.id));
  FHS.echo = FHS.echo.filter(e => !have.has(e.id) && Date.now() - e.t < 2 * 86400000); grSave('fcg-gspot-echo', FHS.echo);
  for (const e of FHS.echo) recs.push(e);
  if (FHS.gone.size && live.t) { for (const id of [...FHS.gone]) if (!have.has(id)) FHS.gone.delete(id); grSave('fcg-gspot-gone', [...FHS.gone]); }
  return recs.filter(r => !FHS.gone.has(r.id)).sort((a, b) => b.t - a.t);
}
// a slab's PriceCharting line, {YYYY-MM: price}: undefined while its trend file loads, null when there is none to read,
// 'old' when the trend file predates the blended lines
function fhsLine(cid, gk) {
  const line = FCG_LINE(gk); if (!line) return null;
  const tr = GR.trend.get(+cid);
  if (!tr) { if (!FHG.trendMiss.has(+cid)) { fhrWantTrend(+cid); return undefined; } return FHG.trendBusy ? undefined : null; }
  const m = new Map();
  if (line === 'psa_10') { for (const [ym, p] of ((tr.pc || {})['psa|g10'] || [])) if (p != null) m.set(String(ym).slice(0, 7), +p); }
  else { const x = (tr.pm || {})[line]; if (!x) return tr.pm ? null : 'old'; let i = fhsYi(x[0]); for (const p of x[1]) { if (p != null) m.set(fhsYm(i), p); i++; } }
  return m.size ? m : null;
}
const FHS_T0 = () => Array.from({length: 6}, () => ({n: 0, nb: 0, nd: 0, win: 0, sp: 0, se: 0, sa: 0}));
// one slab looked back: the months it was ranked, each hold's chance / expected / actual, and the totals per hold
function fhsSlab(s, rec) {
  const doc = FHG.doc, [cid, gk] = s, d = s[2] / 1000, ship = rec.ship || 0, fee = rec.fee || fcgFee();
  const minp = rec.minp != null ? rec.minp : 0.5, gate = rec.gate == null ? 1 : rec.gate;
  if (!FCG_LINE(gk)) return {why: 'PriceCharting has no price line of its own for ' + grLabel(gk) + ', so the model cannot score it (as on Forecasting)'};
  const W = fhsLine(cid, gk);
  if (W === undefined) return {loading: true};
  if (W === 'old') return {why: 'its Grade line arrives with the next site build'};
  if (!W) return {why: 'no PriceCharting line for it'};
  const be = fcgBreak(d, fee), QD = {qs: doc.qs}, RQ = {qs: doc.rqs}, lastI = fhsYi(doc.last || doc.months[doc.months.length - 1]);
  const months = [], tot = FHS_T0();
  doc.months.forEach((ym, mi) => {
    const j = fhsYi(ym), p = W.get(ym), cuts = doc.rq[mi];
    if (p == null || !cuts || p < (doc.rank_min || 25)) return;
    let s12 = 0, n12 = 0, s3 = 0, n3 = 0;
    for (let k = 0; k < 12; k++) { const v = W.get(fhsYm(j - k)); if (v != null) { s12 += v; n12++; if (k < 3) { s3 += v; n3++; } } }
    if (n12 < 12) return;                                  // the model ranks a line once it has a full year of prices
    const std = n3 >= 2 ? Math.max(p, s3 / n3) : p, buy = std * (1 - d) - ship;
    const pct = Math.min(1, Math.max(0, fcgCdf(RQ, {q: cuts.map(v => v / 10000)}, -(p / (s12 / 12) - 1)))), g = Math.min(9, Math.floor(pct * 10));
    const row = {ym, up: !!doc.up[mi], p, std, pct, g, h: []};
    for (let h = 1; h <= 6; h++) {
      const grid = ((doc.tab[mi] || [])[h - 1] || [])[g];
      if (!grid || !(buy > 0)) { row.h.push(null); continue; }
      const t = {mean: grid[0], q: grid.slice(1)}, ch = Math.min(0.95, 1 - fcgCdf(QD, t, be)), bought = ch >= minp && (!gate || !!doc.up[mi]);
      let act = null;
      if (j + h <= lastI) { const p2 = W.get(fhsYm(j + h)); if (p2 != null) act = fcgNet(std, Math.min(5, Math.max(-0.95, p2 / std - 1)), d, fee); }
      const x = {p: ch, e: fcgNet(std, t.mean, d, fee) / buy, a: act == null ? null : act / buy, bought};
      row.h.push(x);
      const T = tot[h - 1]; T.n++;
      if (bought) { T.nb++; T.sp += x.p; T.se += x.e; if (act != null) { T.nd++; T.sa += x.a; if (act > 0) T.win++; } }
    }
    months.push(row);
  });
  return {months: months.reverse(), tot};
}
function fhsSet(rec) {                                    // every slab of a set and the set's totals (kept until a trend file or the replay changes)
  const tok = (FHG.doc ? FHG.doc.t : '') + '|' + GR.trend.size + '|' + FHG.trendBusy, c = FHS.cache.get(rec.id);
  if (c && c.tok === tok) return c;
  const slabs = rec.slabs.map(s => fhsSlab(s, rec)), tot = FHS_T0();
  slabs.forEach(x => { if (x.tot) x.tot.forEach((T, i) => { for (const k in T) tot[i][k] += T[k]; }); });
  const out = {tok, slabs, tot, loading: slabs.some(x => x.loading)};
  FHS.cache.set(rec.id, out);
  return out;
}
function fhsRowsData() {
  if (!FHG.doc || !FHG.doc.rq) return [];
  return fhsRecs().map((rec, o) => {
    const r = [o], S = fhsSet(rec); r.rec = rec; r.S = S; r.key = String(rec.id); r.t = rec.t; r.h = rec.h; r.n = rec.slabs.length; r.src = rec.src === 'rc' ? 'Recording' : 'Forecasting';
    for (let h = 1; h <= 6; h++) { const T = S.tot[h - 1]; r['b' + h] = T.nb; r['p' + h] = T.nb ? T.sp / T.nb : null; r['e' + h] = T.nb ? T.se / T.nb : null; r['a' + h] = T.nd ? T.win / T.nd : null; r['r' + h] = T.nd ? T.sa / T.nd : null; }
    return r;
  });
}
const fhsPctS = v => v == null ? '<span class="dim">-</span>' : '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + fcPct(v, 1) + '</span>';
function fhsHoldCells(T, h, on, loading) {
  const td = (inner, tip) => '<td class="num fhh-h' + h + on + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + inner + '</td>', dash = '<span class="dim">-</span>';
  if (loading) return td('<span class="dim">…</span>') + td('') + td('') + td('') + td('');
  if (!T.nb) return td('<span class="dim">no buys</span>', T.n ? T.n + ' slab-months scored; none cleared the bar' : 'no month scored') + td(dash) + td(dash) + td(dash) + td(dash);
  return td('<b>' + T.nb + '</b>', T.nb + ' buys (one slab in one month) of the ' + T.n + ' slab-months scored') + td(Math.round(T.sp / T.nb * 100) + '%') + td(fhsPctS(T.se / T.nb)) +
    (T.nd ? td('<b class="' + (T.win / T.nd >= 0.5 ? 'up' : 'down') + '">' + Math.round(T.win / T.nd * 100) + '% won</b><br><span class="dim">' + T.win + ' of ' + T.nd + '</span>', (T.nb - T.nd ? (T.nb - T.nd) + ' buys too recent to score; ' : '') + T.win + ' of the ' + T.nd + ' scored made money') + td(fhsPctS(T.sa / T.nd))
      : td('<span class="dim">hold not up yet</span>') + td(dash));
}
function fhsRow(r) {
  const rec = r.rec, S = r.S;
  let s = '<td><b>' + fhrDate(rec.t) + '</b>' + (rec.smp ? '<span class="fhr-smp" title="Sent with sample slabs among them">sample</span>' : '') + (rec.local ? ' <span class="dim" title="Sent; the collector confirms it in a minute or two">sending…</span>' : '') + '<br><span class="dim">' + esc(new Date(rec.t).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})) + '</span></td>' +
    '<td>' + r.src + '</td><td>' + rec.h + ' mo</td><td class="num">' + rec.slabs.length + '<br><span class="dim">' + fmtMoneyPlain(rec.spent || 0) + '</span></td>';
  for (let h = 1; h <= 6; h++) s += fhsHoldCells(S.tot[h - 1], h, h === rec.h ? ' fhr-on' : '', S.loading);
  return s;
}
const fhsShownHolds = () => [1, 2, 3, 4, 5, 6].filter(h => FHH_PARTS.some(([p]) => !FHH.has(p + h)));
function fhsDetail(r) {
  const rec = r.rec, S = r.S, H0 = fhsShownHolds(), H = H0.length ? H0 : [rec.h], bar = rec.minp != null ? rec.minp : 0.5;
  const head = '<tr><th>Card</th><th>Grade</th><th class="num">% under</th><th class="num">Standard then</th><th class="num">Chance then</th>' + H.map(h => '<th class="num' + (h === rec.h ? ' fhr-on' : '') + '">' + h + '-month hold</th>').join('') + '</tr>';
  const rows = rec.slabs.map((sl, i) => {
    const [cid, gk, dk, std, , , pk] = sl, X = S.slabs[i], base = GR.doc ? fcrMap().get(cid + '|' + gk) : null;
    const nm = base ? [base[1], String(base[2] || '').replace(/^Pokemon /, '') + (base[3] ? ' · #' + base[3] : '')] : fhgName(cid), k = rec.id + ':' + i, open = FHS.open.has(k);
    let s = '<tr class="fhs-slab' + (open ? ' open' : '') + '" data-sk="' + esc(k) + '"><td>' + esc(nm[0]) + '<br><span class="dim">' + esc(nm[1]) + '</span></td><td><b>' + esc(base ? base[25] : grLabel(gk)) + '</b></td><td class="num">' + (Math.round(dk) / 10) + '%</td><td class="num">' + (std == null ? '<span class="dim">-</span>' : fmtMoneyPlain(std)) + '</td><td class="num">' + (pk == null ? '<span class="dim">no score</span>' : Math.round(pk / 10) + '%') + '</td>';
    if (X.loading) s += H.map(() => '<td class="num"><span class="dim">…</span></td>').join('');
    else if (!X.tot) s += '<td colspan="' + H.length + '"><span class="dim">' + esc('Not looked back: ' + X.why + '.') + '</span></td>';
    else s += H.map(h => { const T = X.tot[h - 1]; return '<td class="num' + (h === rec.h ? ' fhr-on' : '') + '">' + (!T.nb ? '<span class="dim">' + (T.n ? 'no buys' : '-') + '</span>'
      : '<b>' + T.nb + '</b> buy' + (T.nb > 1 ? 's' : '') + (T.nd ? ' · <b class="' + (T.win / T.nd >= 0.5 ? 'up' : 'down') + '">' + T.win + ' won</b>' : '') + '<br><span class="dim">' + fcPct(T.se / T.nb, 1) + ' → </span>' + (T.nd ? fhsPctS(T.sa / T.nd) : '<span class="dim">not up yet</span>')) + '</td>'; }).join('');
    s += '</tr>';
    if (open && X.months) s += '<tr class="fhs-mo"><td colspan="' + (5 + H.length) + '">' + fhsMonths(X, H, bar) + '</td></tr>';
    return s;
  }).join('');
  return '<h4>' + rec.slabs.length + ' slab' + (rec.slabs.length > 1 ? 's' : '') + ' sent ' + fhrDate(rec.t) + ' from ' + r.src + ' · bar ' + Math.round(bar * 100) + '% · gate ' + (rec.gate === 0 ? 'off' : 'on') + ' · ' + fmtMoneyPlain(rec.ship || 0) + ' shipping, eBay’s fee ' + (Math.round((rec.fee || 0) * 1000) / 10) + '% · your Hold then ' + rec.h + ' month' + (rec.h > 1 ? 's' : '') + '</h4>' +
    '<p class="dim">Each hold: how many times since 2022 the model would have bought the slab (a month at or above the bar' + (rec.gate === 0 ? '' : ', the market rising') + '), how many of those buys made money, and the average ROI it expected → the average it made. Click a slab for its months.</p>' +
    '<table class="fhs-slabs"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>' +
    '<button type="button" class="fhr-del fhs-del" data-id="' + esc(rec.id) + '" title="Take this set off Pre-Sales Spotcheck">Remove this set</button>';
}
function fhsMonths(X, H, bar) {                           // a slab opened: its months, newest first
  if (!X.months.length) return '<p class="dim">No month ranked: the model ranks a line once it has a full year of prices, $' + ((FHG.doc && FHG.doc.rank_min) || 25) + '+.</p>';
  return '<table class="fhs-months"><thead><tr><th>Month</th><th>Market</th><th class="num">Price</th><th class="num">Rank</th>' + H.map(h => '<th class="num">' + h + ' mo: chance · expected → actual</th>').join('') + '</tr></thead><tbody>' +
    X.months.map(m => '<tr><td>' + m.ym + '</td><td>' + (m.up ? 'rising' : 'falling') + '</td><td class="num">' + fmtMoneyPlain(m.p) + (m.std > m.p + 0.005 ? '<br><span class="dim" title="bought at its 3-month average, the higher of the two">at ' + fmtMoneyPlain(m.std) + '</span>' : '') + '</td><td class="num">' + fcOrd(Math.round(m.pct * 100)) + '<br><span class="dim">' + (m.g === 9 ? 'deepest 10%' : 'group ' + (10 - m.g) + ' of 10') + '</span></td>' +
      H.map(h => { const x = m.h[h - 1]; if (!x) return '<td class="num"><span class="dim">-</span></td>';
        return '<td class="num' + (x.bought ? ' fhs-buy' : '') + '" title="' + esc(x.bought ? 'The model would have bought it this month' : 'Not bought: ' + (x.p < bar ? 'the chance was under the bar' : 'the market was falling and the gate was on')) + '">' + (x.bought ? '<b>✓</b> ' : '') + Math.round(x.p * 100) + '% · ' + fcPct(x.e, 1) + ' → ' + (x.a == null ? '<span class="dim">not up yet</span>' : fhsPctS(x.a)) + '</td>'; }).join('') + '</tr>').join('') + '</tbody></table>';
}
tables.fhs = makeTable('fhs', {rows: fhsRowsData, noun: 'spotcheck sets', ranges: [], labels: {}, defaults: {}, root: '#fhg-sc', name: 'Forecast · graded pre-sales spotcheck', onCols: h => fhhTake('fhs', h),
  key: r => r.key, row: fhsRow, rowClass: () => 'fhr-row fhs-row',
  hay: r => r.rec.slabs.map(s => { const b = GR.doc ? fcrMap().get(s[0] + '|' + s[1]) : null; return b ? b[1] + ' ' + b[2] + ' ' + b[25] : fhgName(s[0]).join(' ') + ' ' + grLabel(s[1]); }).join(' ') + ' ' + fhrDate(r.rec.t),
  after: t => {
    fhxInsert('fhs', t, r => FHG.open.has('s:' + r.key), fhsDetail);
    const none = $('fhs-none'); if (!none) return;
    none.textContent = !FHG.doc ? (FHG.err || 'Loading the replay…') : !FHG.doc.rq ? 'Pre-Sales Spotcheck needs the rank cut points in the replay file: they arrive with the next site build.' : t.view.length ? '' : (LIVE.data ? 'No sets yet: Add to Pre-Sales Spotcheck (above the table on Forecasting or Recording) sends the green rows here.' : 'Waiting for the live data.');
  }});
fhxTidy('fhs');
$('rows-fhs').addEventListener('click', e => {
  const del = e.target.closest('.fhs-del');
  if (del) {
    if (!del.classList.contains('arm')) { del.classList.add('arm'); del.textContent = 'Click again to remove it'; setTimeout(() => { if (del.isConnected) { del.classList.remove('arm'); del.textContent = 'Remove this set'; } }, 4000); return; }
    const id = +del.dataset.id; FHS.gone.add(id); grSave('fcg-gspot-gone', [...FHS.gone]);
    FHS.echo = FHS.echo.filter(x => x.id !== id); grSave('fcg-gspot-echo', FHS.echo);
    alSend({type: 'gspot_del', t: nextT(), id}).catch(() => { FHS.gone.delete(id); grSave('fcg-gspot-gone', [...FHS.gone]); favSay('The collector could not be told; the set stays.'); tables.fhs.apply(true); });
    tables.fhs.apply(true); fhsCount(); return;
  }
  const sl = e.target.closest('tr.fhs-slab');
  if (sl) { const k = sl.dataset.sk; if (FHS.open.has(k)) FHS.open.delete(k); else FHS.open.add(k); tables.fhs.apply(true); return; }
  if (e.target.closest('button, a, input') || e.target.closest('tr.fhx')) return;
  const tr = e.target.closest('tr'); if (!tr) return;
  const k = 's:' + tr.dataset.key; if (FHG.open.has(k)) FHG.open.delete(k); else FHG.open.add(k);
  tables.fhs.apply(true);
});
function fhsCount() { const a = $('nfhs'), b = $('nfhr'); if (a) a.textContent = String(fhsRecs().length); if (b) b.textContent = String(fhrRecs().length); }
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
  const slabs = rows.map(r => [r[0], r[50], Math.round((r.fcD != null ? r.fcD : I.disc) * 1000), r2(r.fcS), r2(r.fcSc), r2(price(r)), r.fcP == null ? null : Math.round(r.fcP * 10), r2(r.fcN), r.fcPct == null ? null : Math.round(r.fcPct * 1000)]);
  const spent = r2(rows.reduce((s, r) => s + (r.fcQ || 1) * (price(r) || 0), 0)), id = nextT(), n = Math.max(1, Math.ceil(slabs.length / 20));
  const head = {h: I.h, cap: I.cap, disc: rc ? (+FCG_IN.rdisc || 14.1) / 100 : I.disc, ship: I.ship, fee, month: D ? D.month : '', reg: D && D.regime ? (D.regime.up ? 'up' : 'down') : '', spent, model: D ? D.model : '',
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
// the holds: a first visit takes the hold columns either table had hidden, then both tables get the one choice
if (FHH_NEW) { for (const id of ['fhg', 'fhr']) fhhThs(id).forEach(th => { const k = th.dataset.k || ''; if (FHH_RE.test(k) && th.classList.contains('col-hidden')) FHH.add(k); }); fhhSave(); }
FHH_IDS.forEach(id => { fhhInit(id); fhhApply(id); });
document.querySelectorAll('#fhg .fhh-btn').forEach(b => b.addEventListener('click', fhhOpen));
// a flag set anywhere: the slab lists of the recorded plans show it
{ const gm = grMark; grMark = async function () { const out = await gm.apply(this, arguments); if (!$('p-fc').hidden && NAV.fc === 'graded' && NAV.gm === 'hi') tables.fhr.apply(true); return out; }; }
$('rows-fhg').addEventListener('click', e => {
  if (e.target.closest('button, a, input')) return;
  const tr = e.target.closest('tr'); if (!tr || tr.classList.contains('fhx') || tr.closest('tr.fhx')) return;
  const k = 'm:' + tr.dataset.key; if (FHG.open.has(k)) FHG.open.delete(k); else FHG.open.add(k);
  tables.fhg.apply(true);
});
$('rows-fhr').addEventListener('click', e => {
  if (e.target.closest('.fhr-cols')) { fhrOpenColumns(); return; }
  const hb = e.target.closest('th.pcx button.help'); if (hb) { e.stopPropagation(); openHelp(hb.dataset.h); return; }
  const gt = e.target.closest('.gtbtn'); if (gt) { grLoad().then(() => grOpenTrend(gt.dataset.k)); return; }
  const rv = e.target.closest('.grvb'); if (rv) { grLoad().then(() => grOpenReview(rv.dataset.k)); return; }
  const fl = e.target.closest('.gflag'); if (fl) { grLoad().then(() => grFlagPop(fl)); return; }
  const del = e.target.closest('.fhr-del');
  if (del) {
    if (!del.classList.contains('arm')) { del.classList.add('arm'); del.textContent = 'Click again to remove it'; setTimeout(() => { if (del.isConnected) { del.classList.remove('arm'); del.textContent = 'Remove this record'; } }, 4000); return; }
    const id = +del.dataset.id; FCR.gone.add(id); grSave('fcg-gplan-gone', [...FCR.gone]);
    FCR.echo = FCR.echo.filter(x => x.id !== id); grSave('fcg-gplan-echo', FCR.echo);
    alSend({type: 'gplan_del', t: nextT(), id}).catch(() => { FCR.gone.delete(id); grSave('fcg-gplan-gone', [...FCR.gone]); favSay('The collector could not be told; the record stays.'); tables.fhr.apply(true); });
    tables.fhr.apply(true); return;
  }
  if (e.target.closest('button, a, input')) return;
  const tr = e.target.closest('tr'); if (!tr || tr.classList.contains('fhx') || tr.closest('tr.fhx')) return;
  const k = 'p:' + tr.dataset.key; if (FHG.open.has(k)) FHG.open.delete(k); else FHG.open.add(k);
  tables.fhr.apply(true);
});
// the settings line: whose numbers the replay runs on
function fhgNote() {
  const el = $('fhg-note'); if (!el) return;
  const I = fcgInputs(), grades = [...GF.fc.gsel].filter(gk => FCG_LINE(gk)).map(grLabel);
  el.innerHTML = 'Graded Forecasting’s plan: <b>' + fmtMoneyPlain(I.cap) + '</b>, <b>' + fcgDiscWord(I.disc) + ' under</b>, ' + fmtMoneyPlain(I.ship) + ' shipping, $' + I.pmin.toLocaleString('en-US') + '–$' + I.pmax.toLocaleString('en-US') + ', ' + Math.round(I.share * 100) + '% per card, ' + Math.round(I.minp * 100) + '% bar, ' + I.copies + ' cop' + (I.copies === 1 ? 'y' : 'ies') + ' per card, gate ' + (I.gate ? 'on' : 'off') + ' · ' + (grades.length ? esc(grades.join(', ')) : 'no grade with a PriceCharting line ticked') + ' - the plan pane on the left (Forecasting’s % under) and Graded Forecasting’s Grading button.';
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
function fhgRender() {
  $('fhg').dataset.hold = String(fcgInputs().h);          // the pane's Hold: its hold's headers and columns are tinted (CSS)
  fhgWinPaint();
  if ($('p-fc').hidden || NAV.fc !== 'graded' || NAV.gm !== 'hi') return;
  fhsCount();
  const w = FHG.win;
  if (!GR.doc && !GR.loading) grLoad().then(() => { if (FHG.win === 'rec') tables.fhr.apply(true); if (FHG.win === 'sc') tables.fhs.apply(true); });
  if (w === 'rec') { tables.fhr.apply(true); return; }   // the replay file is read for the replay and the Spotcheck only
  if (!FHG.doc) { if (!FHG.err) fhgLoad(); $('fhg-run').textContent = FHG.err || 'Loading the replay…'; }
  if (w === 'sc') { tables.fhs.apply(true); return; }
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
  fhg_replay: {t: 'Forecasting Replay', f: 'Graded Forecasting’s plan run on every month since 2022, knowing only what was known that month, then scored at PriceCharting’s price when each hold was up', m: 'Each month: the PriceCharting graded lines (PSA 10, and the Grade 9.5 / 9 / 8 / 7 lines that blend every grader) ranked by how far each sits below its own 12-month mean; the odds of each rank group from the outcomes known by then (2022, marked *, had too few, so the whole period’s odds stand in); the market rising or falling; then your plan with Graded Forecasting’s boxes and Grading ticks - capital, % under, shipping, the price band, the share, the bar, the copies, the gate. Six holds side by side; the eyes and Holds… hide what you do not need (one choice for the three History windows). Click a month for its slabs. The file keeps each month’s best-ranked lines of each group and line in $50 - $5,000, so a band outside that, or a very large capital, sees fewer candidates.', e: '2025-03, 3-month hold: 12 slabs for $980, expected +$140; actual +$210 ✓.'},
  fhg_recorded: {t: 'Recorded Purchases', f: 'one row per Record Purchases on Graded › Purchases: the date, the hold set then, what was spent, the slabs', m: 'Each hold has its expected net, range and chance with the odds of the day it was recorded, and its actual once the hold is up: the slabs sold at PriceCharting’s price of that month (today’s price while the month is still running), after eBay’s fee and the shipping, less what was paid. The hold you had set is highlighted. Click a record for its slabs; click again to close. Kept by the collector, so every device shows them. The eye on a hold’s header hides that hold in all three History windows; Holds… brings it back, column by column if you like. Your Hold (the plan pane) is tinted. Each slab list has a Flag column: the same flag as on the PriceCharting tab and the other Forecast pages.', e: ''}
});
Object.assign(HELP, {
  fhs_spot: {t: 'Pre-Sales Spotcheck', md: 1, m: [
    '> Before you buy: how would the model have done on these exact slabs? Each set is the green rows you sent with Add to Pre-Sales Spotcheck, each slab looked back on month by month since 2022.',
    '## How each slab is looked back on',
    '1. **Its own PriceCharting line, month by month:** the price, its 12-month average and its 3-month average.',
    '2. **Its rank that month:** its dip below the 12-month average, placed among every graded line that month (the same cut points the model used then).',
    '3. **The odds known that month:** its group, that month’s market (rising or falling), only outcomes already over by then - for each hold, 1 to 6 months.',
    '4. **Its chance and expected ROI** at the % under it was sent with:',
    '   `chance = share of those cases above the break-even`',
    '5. **“Bought”** when the chance was at least the set’s bar - and the market was rising, if the gate was on.',
    '6. **The actual:** bought at the higher of the price and its 3-month average, sold at PriceCharting’s price when the hold was up, after eBay’s fee and the shipping (the replay’s rules).',
    '## The columns, per hold',
    '| Column | What it is |',
    '|---|---|',
    '| Buys | how many times the model would have bought (one slab in one month = one buy) |',
    '| Chance | the average chance it gave those buys |',
    '| Expected | the average ROI it expected |',
    '| Actual | how many of the buys made money (“62% won, 13 of 21”) |',
    '| ROI | the average ROI they made |',
    'Click a set for its slabs, and a slab for its months (✓ = a month it would have bought).',
    '## How to read it',
    'If the model’s buys on these cards won about as often as it said, and made about the ROI it expected, its chances on them today deserve trust. Far less: be careful with these cards.',
    '## Keep in mind',
    '- A slab needs a PriceCharting line of its own (no CGC 10 or half grades) and a full year of prices before its first month.',
    '- The Grade 9.5 / 9 / 8 / 7 lines blend every grader, as in the model.',
    '- The months overlap (a 6-month hold bought in March and in April share four months), so the buys are not 100 separate tests.',
    '- The sets are kept by the collector: every device shows them. Remove this set takes one away.'].join('\n'),
    now: () => { const n = fhsRecs().length, d = FHG.doc; return n + ' set' + (n === 1 ? '' : 's') + (d && d.months ? ' · months ' + esc(d.months[0]) + ' to ' + esc(d.last || d.months[d.months.length - 1]) : '') + (d && !d.rq ? ' · <b>waiting for the next site build</b> (the rank cut points)' : ''); }}
});
