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
const FHG = {doc: null, err: null, loaded: null, key: '', cells: null, todo: 0, busy: null, open: new Set(), trendBusy: false, trendMiss: new Set()};
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
const fhgKey = S => JSON.stringify(Object.assign({}, S, {lines: [...S.lines].sort()})) + '|' + (FHG.doc ? FHG.doc.t : '');
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
  for (let h = 1; h <= 6; h++) s += fhgHoldCells(FHG.cells[mi][h - 1], mi + h <= doc.months.length - 1, 'hold not up yet');
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
tables.fhg = makeTable('fhg', {rows: fhgRowsData, noun: 'months', ranges: [], labels: {}, defaults: {}, root: '#fhg-rp', name: 'Forecast · graded history replay',
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
    for (const c of [...FHG.trendMiss]) { if (!GR.trend.has(c)) { try { await grTrendData(c); } catch (e) { /* no trend file: no price */ } } }
    FHG.trendBusy = false; if (tables.fhr) tables.fhr.apply(true);
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
    const td = (inner, cls) => '<td class="num' + on + (cls ? ' ' + cls : '') + '">' + inner + '</td>';
    s += x ? td(fcMoney(x[0]) + '<br><span class="dim">' + fcPct(rec.spent ? x[0] / rec.spent : null, 1) + '</span>') + td(fcMoney(x[1]) + '<br><span class="dim">to ' + fcMoney(x[2]) + '</span>') + td(Math.round(x[3] * 100) + '%')
      : td('<span class="dim">-</span>') + td('<span class="dim">-</span>') + td('<span class="dim">-</span>');
    s += a.pending ? td('<span class="dim" title="' + esc('the hold is up on ' + fhrDate(a.due.getTime())) + '">hold not up yet</span>') + td('<span class="dim">-</span>')
      : a.loading ? td('<span class="dim">…</span>') + td('<span class="dim">-</span>')
      : a.none ? td('<span class="dim">no price</span>') + td('<span class="dim">-</span>')
      : td('<b class="' + (a.actual > 0 ? 'up' : a.actual < 0 ? 'down' : '') + '"' + (a.priced < a.n ? ' title="' + a.priced + ' of ' + a.n + ' slabs had a price"' : '') + '>' + fcMoney(a.actual) + '</b>' + (x ? ' <span class="dim">' + (a.actual >= x[1] && a.actual <= x[2] ? '✓' : '✗') + '</span>' : '')) + td(fcPct(a.roi, 1), a.roi > 0 ? 'up' : a.roi < 0 ? 'down' : '');
  }
  return s;
}
// a plan opened: its slabs with Planning's columns, a star and Review, and what each made when the recorded hold was up
function fhrDetail(r) {
  const rec = r.rec, h = rec.h, due = fhrDue(rec.t, h), up = Date.now() >= due.getTime(), ym = fhrYm(due);
  const rows = rec.slabs.map(s => {
    const [cid, gk, dk, std, stdc, paid, pk, net, rk] = s, base = GR.doc ? fcrMap().get(cid + '|' + gk) : null, c = GR.doc ? (GR.doc.cards || {})[String(cid)] || {} : {};
    const nm = base ? [base[1], String(base[2] || '').replace(/^Pokemon /, '') + (base[3] ? ' · #' + base[3] : '')] : fhgName(cid), d = dk / 1000;
    const p1 = up ? fhrPrice(cid, gk, ym) : null, real = p1 == null ? null : p1 * (1 - rec.fee) - rec.ship - paid;
    const cl = stdc == null ? null : stdc * (1 - d) - rec.ship, two = (a, b) => '<td class="num fcg2"><span><i>CL</i> ' + a + '</span><span><i>PC</i> ' + b + '</span></td>';
    const pct = rk == null ? null : rk / 1000, g = pct == null ? null : Math.min(9, Math.floor(pct * 10));
    return '<tr><td class="favc">' + favBtn('pc', cid, cid) + '</td>' +
      '<td>' + (c.pid ? '<button class="rvb grvb' + (base && base[41] === 1 ? ' same' : base && base[41] === 0 ? ' diff' : '') + '" data-k="' + esc(cid + '|' + gk) + '">Review</button>' : '<span class="dim">-</span>') + '</td>' +
      '<td>' + esc(nm[0]) + '<br><span class="dim">' + esc(nm[1]) + '</span></td><td><b>' + esc(base ? base[25] : grLabel(gk)) + '</b></td>' +
      '<td class="num">' + (pct == null ? '<span class="dim">-</span>' : fcOrd(Math.round(pct * 100)) + '<br><span class="dim">' + (g === 9 ? 'deepest 10%' : 'group ' + (10 - g) + ' of 10') + '</span>') + '</td>' +
      two(stdc == null ? '<span class="dim">-</span>' : fmtMoney(stdc), std == null ? '<span class="dim">-</span>' : fmtMoney(std)) +
      '<td class="num">' + (Math.round(d * 1000) / 10) + '%</td>' +
      two(cl == null ? '<span class="dim">-</span>' : fmtMoney(cl), fmtMoney(paid)) +
      two(base && base[37] != null ? fmtInt(base[37]) : '<span class="dim">-</span>', base && base[16] != null ? fmtInt(base[16]) : '<span class="dim">-</span>') +
      '<td class="num">' + (pk == null ? '<span class="dim">no score</span>' : (pk / 10).toFixed(0) + '%') + '</td><td class="num">1</td>' +
      '<td class="num">' + (net == null ? '<span class="dim">-</span>' : fcgMoneyS(net)) + '</td><td class="num">' + (net == null || !paid ? '<span class="dim">-</span>' : fcgPct(net / paid)) + '</td>' +
      '<td class="num">' + (!up ? '<span class="dim">hold not up yet</span>' : real == null ? '<span class="dim">' + (p1 === undefined ? '…' : 'no price') + '</span>' : '<b class="' + (real > 0 ? 'up' : real < 0 ? 'down' : '') + '">' + fcMoney2(real) + '</b> <span class="dim">at ' + fmtMoneyPlain(p1) + '</span>') + '</td>' +
      '<td><span class="fcr-pu"><button type="button" class="yes on" disabled>Yes</button></span></td></tr>';
  }).join('');
  return '<h4>' + rec.slabs.length + ' slab' + (rec.slabs.length > 1 ? 's' : '') + ' bought ' + fhrDate(rec.t) + ' for ' + fmtMoneyPlain(rec.spent) + ' · held ' + h + ' month' + (h > 1 ? 's' : '') + ' (up ' + fhrDate(due.getTime()) + ') · ' + (Math.round(rec.disc * 1000) / 10) + '% under by default, ' + fmtMoneyPlain(rec.ship) + ' shipping, eBay’s fee ' + (Math.round(rec.fee * 1000) / 10) + '% · capital ' + fmtMoneyPlain(rec.cap) + (rec.reg ? ' · market ' + esc(rec.reg) : '') + '</h4>' +
    '<table class="fhr-slabs"><thead><tr><th>★</th><th>Review</th><th>PC Card Name</th><th>Grade</th><th class="num">Rank</th><th class="num">Standard Price</th><th class="num">% Under Paid</th><th class="num">Price Paid</th><th class="num">Sold (last month)</th><th class="num" title="the chance for the ' + h + '-month hold, the day it was recorded">Chance</th><th class="num">QTY</th><th class="num" title="expected net for the ' + h + '-month hold, the day it was recorded">Net</th><th class="num">ROI %</th><th class="num" title="sold at PriceCharting’s price in the month the ' + h + '-month hold is up, after eBay’s fee and the shipping">Actual (' + h + ' mo)</th><th>Purchased</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<button type="button" class="fhr-del" data-id="' + esc(rec.id) + '" title="Take this plan off History (for one recorded by mistake)">Remove this recorded plan</button>';
}
tables.fhr = makeTable('fhr', {rows: fhrRowsData, noun: 'recorded plans', ranges: [], labels: {}, defaults: {}, root: '#fhg-rec', name: 'Forecast · recorded graded plans',
  key: r => r.key, row: fhrRow, rowClass: () => 'fhr-row',
  hay: r => r.rec.slabs.map(s => { const b = GR.doc ? fcrMap().get(s[0] + '|' + s[1]) : null; return b ? b[1] + ' ' + b[2] + ' ' + b[25] : fhgName(s[0]).join(' ') + ' ' + grLabel(s[1]); }).join(' ') + ' ' + fhrDate(r.rec.t),
  after: t => {
    fhxInsert('fhr', t, r => FHG.open.has('p:' + r.key), fhrDetail);
    const none = $('fhr-none'); if (none) none.textContent = t.view.length ? '' : (LIVE.data ? 'No plans recorded yet: Graded › Planning’s Record plan puts them here.' : 'Waiting for the live data.');
  }});
// the tables' own scroll boxes and buttons: no filter chips here, so no Filters… button
for (const id of ['fhg', 'fhr']) {
  [...$('ranges-' + id).querySelectorAll('button.reset')].forEach(b => { if (b.textContent.trim() === 'Filters…') b.remove(); });
  $('rows-' + id).closest('table').id = id + '-t';
}
$('rows-fhg').addEventListener('click', e => {
  if (e.target.closest('button, a, input')) return;
  const tr = e.target.closest('tr'); if (!tr || tr.classList.contains('fhx') || tr.closest('tr.fhx')) return;
  const k = 'm:' + tr.dataset.key; if (FHG.open.has(k)) FHG.open.delete(k); else FHG.open.add(k);
  tables.fhg.apply(true);
});
$('rows-fhr').addEventListener('click', e => {
  const rv = e.target.closest('.grvb'); if (rv) { grLoad().then(() => grOpenReview(rv.dataset.k)); return; }
  const del = e.target.closest('.fhr-del');
  if (del) {
    if (!del.classList.contains('arm')) { del.classList.add('arm'); del.textContent = 'Click again to remove it'; setTimeout(() => { if (del.isConnected) { del.classList.remove('arm'); del.textContent = 'Remove this recorded plan'; } }, 4000); return; }
    const id = +del.dataset.id; FCR.gone.add(id); grSave('fcg-gplan-gone', [...FCR.gone]);
    FCR.echo = FCR.echo.filter(x => x.id !== id); grSave('fcg-gplan-echo', FCR.echo);
    alSend({type: 'gplan_del', t: nextT(), id}).catch(() => { FCR.gone.delete(id); grSave('fcg-gplan-gone', [...FCR.gone]); favSay('The collector could not be told; the plan stays.'); tables.fhr.apply(true); });
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
  fhgCards();
  const run = $('fhg-run'); if (run && !FHG.todo) run.textContent = FHG.doc ? '' : FHG.err ? FHG.err : 'Loading the replay…';
  tables.fhg.apply(true);
}
function fhgRender() {
  if ($('p-fc').hidden || NAV.fc !== 'graded' || NAV.gm !== 'hi') return;
  fhgNote();
  if (!GR.doc && !GR.loading) grLoad().then(() => { tables.fhr.apply(true); });
  if (!FHG.doc) { if (!FHG.err) fhgLoad(); $('fhg-run').textContent = FHG.err || 'Loading the replay…'; fhgCards(); tables.fhg.apply(true); }
  else { fhgRun(); if (!FHG.todo) fhgPaint(); else { fhgCards(); tables.fhg.apply(true); } }
  tables.fhr.apply(true);
}
{ const na = navApply; navApply = function () { na.apply(this, arguments); fhgRender(); }; }
{ const st = showTab; showTab = function () { st.apply(this, arguments); fhgRender(); }; }
{ const rb = rebuildLive; rebuildLive = function () { const out = rb.apply(this, arguments); if (!$('p-fc').hidden && NAV.fc === 'graded' && NAV.gm === 'hi') tables.fhr.apply(true); return out; }; }
fhgRender();

Object.assign(HELP, {
  fhg_replay: {t: 'The replay (graded)', f: 'Graded Forecasting’s plan run on every month since 2022, knowing only what was known that month, then scored at PriceCharting’s price when each hold was up', m: 'Each month: the PriceCharting graded lines (PSA 10, and the Grade 9.5 / 9 / 8 / 7 lines that blend every grader) ranked by how far each sits below its own 12-month mean; the odds of each rank group from the outcomes known by then (2022, marked *, had too few, so the whole period’s odds stand in); the market rising or falling; then your plan with Graded Forecasting’s boxes and Grading ticks - capital, % under, shipping, the price band, the share, the bar, the copies, the gate. Six holds side by side; the eyes and Columns… hide what you do not need. Click a month for its slabs. The file keeps each month’s best-ranked lines of each group and line in $50 - $5,000, so a band outside that, or a very large capital, sees fewer candidates.', e: '2025-03, 3-month hold: 12 slabs for $980, expected +$140; actual +$210 ✓.'},
  fhg_recorded: {t: 'Recorded plans', f: 'one row per Record plan on Graded › Planning: the date, the hold set then, what was spent, the slabs', m: 'Each hold has its expected net, range and chance with the odds of the day it was recorded, and its actual once the hold is up: the slabs sold at PriceCharting’s price of that month (today’s price while the month is still running), after eBay’s fee and the shipping, less what was paid. The hold you had set is highlighted. Click a plan for its slabs; click again to close. Kept by the collector, so every device shows them.', e: ''}
});
