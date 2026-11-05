/* ---------------- The Forecast tab: Graded cards > Forecasting (2026-11-04, Brett) ----------------
   "i plan to go to card vendor, scan graded card links, then sell them on ebay ... lets first build graded>forcasting.
   since we are buying from vendor, we do not know which cards will be available for purchase. so we assume all cards
   are available"; "lets just use the same predictive model but on the graded cards ... its okay if its flawed because
   we will fix it later. i just want to see the listings populate".
   Every graded row of the PriceCharting tab (one per card per PSA / CGC grade) is a listing, assumed for sale. The odds
   are the raw model's method on PriceCharting's graded lines (graded_forecast.py -> graded.bin doc.fc): a row's rank is
   how far its grade's PriceCharting price sits below its own 12-month mean (ten groups), and its chance is how often
   rows of that group made money over the hold in this kind of market, 2022 on.
   THE MONEY (Brett: "shipping is factored into buy price"; "when i go to vendor shows, i will only buy cards that are at
   least 14.1% under"): Buy price = standard price x (1 - % under) - shipping - the most to pay the vendor; the slab then
   sells at the standard price moved by the group's return, less eBay's fee (14.1%) and the shipping. So
   net = standard x ((1 + return) x (1 - fee) - (1 - % under)): the shipping comes off what you pay and goes out as the
   label, and at 14.1% under a slab whose price does not move nets $0. Standard price: PriceCharting's price of the grade
   today (else last month's), and Card Ladder's value today (else last month's average) beside it; the chance is the
   same for both, the money is each side's. Lives in its own file, stitched after graded.js. */
const FCG = {rows: [], src: null, key: '', plan: new Set(grLS('fcg-plan', [])), picks: [], spent: 0, mc: null, gated: false};
const FCG_SEL_DEFAULT = ['psa|g10', 'psa|g9', 'psa|g8', 'psa|g7', 'cgc|g9_5', 'cgc|g9', 'cgc|g8', 'cgc|g7'];
const FCG_IN_DEFAULT = {cap: 1000, h: 3, disc: 14.1, rdisc: 14.1, ship: 5.2, pmin: 50, pmax: 5000, share: 20, minp: 50, copies: 1, gate: true, fold: false};   // rdisc: Recording's % under for new rows
// what a refresh keeps (2026-11-04, Brett: "Capital to spend" and "Hold" "should hold the modification ... even at the expense
// of a page refresh"; every other box of the pane returns to its default on a refresh). Within a visit every box stays
// shared by Forecasting, Recording, Planning and History. The fold (Hide) is not a box: it is kept too.
const FCG_KEEP = ['cap', 'h', 'fold'];
const fcgKept = () => { const sv = grLS('fcg-in', {}) || {}, o = {}; FCG_KEEP.forEach(k => { if (sv[k] !== undefined) o[k] = sv[k]; }); return o; };
const FCG_IN = Object.assign({}, FCG_IN_DEFAULT, fcgKept());
const fcgInSave = () => { const o = {}; FCG_KEEP.forEach(k => { o[k] = FCG_IN[k]; }); grSave('fcg-in', o); };
GF.fc = grFilters('fcg-', {host: 'fcg-gmode', terms: 'fcg-gm-terms', grades: 'fcg-gm-grades', gn: 'fcg-gm-gn', title: 'Graded forecast'},
  () => { if (tables.fcg) tables.fcg.apply(); if (typeof fcrApplyAll === 'function') fcrApplyAll(); }, FCG_SEL_DEFAULT);
grDragInit(GF.fc);
$('fcg-gm-terms').addEventListener('click', grTermsClick(GF.fc));
$('fcg-gm-grades').addEventListener('click', () => grOpenGrades(GF.fc));

// a row's PriceCharting line (graded_forecast.LINES): PSA 10 has its own; 9.5 / 9 / 8 / 7 are PriceCharting's lines for
// the grade number, which blend every grader; anything else (CGC 10, the half grades, 1-6) has none - no score
const FCG_LINE = gk => { const [g, x] = String(gk).split('|'); if (x === 'g10') return g === 'psa' ? 'psa_10' : null; return {g9_5: 'grade_9_5', g9: 'grade_9', g8: 'grade_8', g7: 'grade_7'}[x] || null; };
const fcgDoc = () => (GR.doc && GR.doc.fc && !GR.doc.fc.err && GR.doc.fc.tables) ? GR.doc.fc : null;
const fcgFee = () => settings().fee;                       // eBay's final value fee with the tax on it (14.1%), the raw tab's
const fcgReg = D => D.regime && D.regime.up ? 'up' : 'down';
const fcgTab = (D, h, g) => g == null ? null : D.tables[h + '|' + fcgReg(D) + '|' + g] || D.tables[h + '|all|all'] || null;
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
          minp: Math.min(0.95, Math.max(0, n('fcg-minp', 50) / 100)), copies: Math.min(5, Math.max(1, Math.round(n('fcg-copies', 1)))), gate: $('fcg-gate').checked};
}
// a row's standard prices today: PriceCharting's price of the grade (else last month's), Card Ladder's value (else last
// month's average) when Card Ladder has read the card
const fcgStd = r => [r[67] != null ? r[67] : r[6], r[75] === 'read' ? (r[68] != null ? r[68] : r[35]) : null];
// a row's rank and odds, and its money at standard prices pc / cl bought d under less the shipping (Forecasting: the pane's
// % under; Recording and Planning: the row's own)
function fcgCalc(r, pc, cl, d, ship, D, I, fee) {
  const line = FCG_LINE(r[50]), pv = D && line ? ((D.pct[String(r[0])] || [])[D.lines.indexOf(line)]) : null;
  const pct = pv == null ? null : pv / 1000, g = pct == null ? null : Math.min(9, Math.floor(pct * 10));
  const t = D && pc != null ? fcgTab(D, I.h, g) : null;
  r.fcS = pc; r.fcSc = cl; r.fcD = d; r.fcB = fcgBuy(pc, d, ship); r.fcBc = fcgBuy(cl, d, ship);
  r.fcPct = pct; r.fcG = g; r.fcT = t; r.fcQ = 0; r.fcPl = FCG.plan.has(r[0] + '|' + r[50]) ? 1 : 0;
  r.fcP = t ? Math.round(Math.min(0.95, 1 - fcgCdf(D, t, fcgBreak(d, fee))) * 1000) / 10 : null;
  r.fcN = t ? fcgNet(pc, t.mean, d, fee) : null; r.fcNc = t && cl != null ? fcgNet(cl, t.mean, d, fee) : null;
  r.fcR = r.fcN != null && r.fcB > 0 ? Math.round(r.fcN / r.fcB * 1000) / 10 : null;
  r.fcRc = r.fcNc != null && r.fcBc > 0 ? Math.round(r.fcNc / r.fcBc * 1000) / 10 : null;
  return r;
}
const fcgOrder = (a, b) => (b.fcP == null ? -1 : Math.round(b.fcP)) - (a.fcP == null ? -1 : Math.round(a.fcP)) || (b.fcPct || 0) - (a.fcPct || 0) || (b.fcS || 0) - (a.fcS || 0);   // buy order: chance to the whole percent, then rank, then price
// every row's figures, worked out again when the data, the rows or the plan's boxes change
function fcgRows() {
  const D = fcgDoc(), I = fcgInputs(), fee = fcgFee();
  const key = JSON.stringify(I) + '|' + fee + '|' + (D ? D.t : '');
  if (FCG.src === GR.rows && FCG.key === key) return FCG.rows;
  const be = fcgBreak(I.disc, fee), out = [];
  for (const r of GR.rows) {
    if (r[48]) continue;
    const [pc, cl] = fcgStd(r), band = pc != null ? pc : cl;
    if (band == null || band < I.pmin || band > I.pmax) continue;
    out.push(fcgCalc(r, pc, cl, I.disc, I.ship, D, I, fee));
  }
  out.sort(fcgOrder);
  FCG.rows = out; FCG.src = GR.rows; FCG.key = key; FCG.I = I; FCG.fee = fee; FCG.be = be;
  return out;
}
// the plan: best chance first among the rows on view, up to the per-card share, the copies and the capital
function fcgAllocate(view) {
  const I = FCG.I, D = fcgDoc();
  FCG.rows.forEach(r => { r.fcQ = 0; });
  FCG.gated = !!(D && I.gate && !(D.regime && D.regime.up));
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
  return {lo: at(0.1), med: at(0.5), hi: at(0.9), mean: a.reduce((s, v) => s + v, 0) / n, p: Math.min(FC_P_CAP, a.filter(v => v > 0).length / n)};
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
  if (FCG.gated) s = '<p><b>Nothing to buy: the graded market is falling</b> (the average graded line ' + fcgPct(D.regime.reg3) + ' a month over the last three months) and “Buy only when the market is rising” is on. ' + (FCG.elig ? FCG.elig + ' slab' + (FCG.elig > 1 ? 's' : '') + ' would clear your bar anyway - the list is in buy order; switch it off to see the plan.' : '') + '</p>';
  else if (!n) s = '<p><b>No slab clears your bar</b> (' + Math.round(I.minp * 100) + '% chance of a profit, ' + fcgDiscWord(I.disc) + ' under, a ' + unit + ' hold) among the rows on view. Lower the bar, buy deeper under, or hold longer.</p>';
  else s = '<p>Spend <b>' + fmtMoneyPlain(FCG.spent) + '</b> of ' + fmtMoneyPlain(I.cap) + ' on <b>' + n + ' slab' + (n > 1 ? 's' : '') + '</b> (' + copies + (copies === 1 ? ' copy' : ' copies') + '), each bought ' + fcgDiscWord(I.disc) + ' under its standard price less the shipping, hold ' + unit + ', sell on eBay at PriceCharting’s price then. Every listed slab is assumed for sale; the green rows are the buys.</p>';
  s += '<div class="stats fc-stats">' +
    '<div class="stat"><div class="k">Expected net profit</div><div class="v">' + (mc ? fcMoney(mc.mean) + (FCG.spent > 0 ? ' <span class="fc-roi ' + (mc.mean < 0 ? 'down' : 'up') + '">' + fcgPct(mc.mean / FCG.spent) + '</span>' : '') : '-') + '</div><div class="d">average of the basket, after fees and shipping</div></div>' +
    '<div class="stat"><div class="k">Likely range</div><div class="v">' + (mc ? fcMoney(mc.lo) + ' to ' + fcMoney(mc.hi) : '-') + '</div><div class="d">10th to 90th percentile' + (mc ? '; median ' + fcMoney(mc.med) : '') + '</div></div>' +
    '<div class="stat"><div class="k">Chance of a profit</div><div class="v">' + (mc ? (mc.p * 100).toFixed(0) + '%' : '-') + '</div><div class="d">P(basket net &gt; 0), bought ' + fcgDiscWord(I.disc) + ' under</div></div>' +
    '<div class="stat"><div class="k">Fees assumed</div><div class="v">' + (FCG.fee * 100).toFixed(1) + '% + ' + fmtMoneyPlain(I.ship) + '</div><div class="d">eBay’s fee and your eBay Shipping Fee (in the buy price)</div></div></div>';
  box.innerHTML = s;
}
function fcgRegime() {
  const box = $('fcg-regime'); if (!box) return;
  const D = fcgDoc(), I = fcgInputs(), fee = fcgFee();
  if (!D) { box.textContent = GR.doc ? 'The graded model is not in this build yet.' : 'Waiting for the graded data…'; return; }
  const R = D.regime || {}, up = !!R.up, confirm = !!R.confirm, light = !up ? 'red' : confirm ? 'green' : 'amber';
  const head = !up ? 'Falling graded market — the gate is red.' : confirm ? 'Rising graded market — the gate is green.' : 'Rising graded market, but last month turned down — amber.';
  const dsc = NAV.gm === 'rc' ? (+FCG_IN.rdisc || 0) / 100 : I.disc;   // the % under the pane shows: Recording's own there
  const pn = R.p_next || [], be = fcgBreak(dsc, fee), dw = fcgDiscWord(dsc);
  const line = h => { const t = D.tables[h + '|' + fcgReg(D) + '|9']; if (!t) return '<tr><td>' + h + '&nbsp;mo</td><td class="num" colspan="3"><span class="dim">too few cases</span></td></tr>';
    return '<tr><td>' + h + '&nbsp;mo</td><td class="num">' + fcgPct(t.q[D.qs.indexOf(0.5)]) + '</td><td class="num">' + (t.p_up * 100).toFixed(0) + '%</td><td class="num">' + (Math.min(0.95, 1 - fcgCdf(D, t, be)) * 100).toFixed(0) + '%</td></tr>'; };
  box.innerHTML = '<p><b class="fc-light fc-light-' + light + '">' + head + '</b> The average graded line moved <b>' + fcgPct(R.reg3) + ' a month</b> over the last three months (' + fcgPct(R.reg1) + ' last month' + (R.breadth3 != null ? '; ' + (R.breadth3 * 100).toFixed(0) + '% of lines up' : '') + '). ' +
    (pn[0] != null ? 'Since 2022, when this three-month figure was positive the next quarter was up ' + Math.round(pn[0] * 100) + '% of the time (' + pn[2] + ' months); when negative, ' + Math.round(pn[1] * 100) + '% (' + pn[3] + ' months)' : '') +
    ' — so ' + (up ? 'the plan may buy' : 'the plan buys nothing while “Buy only when the market is rising” is on') + '.</p>' +
    '<p class="dim">What the deepest-dip slabs (the top 10% of the rank: furthest below their own 12-month PriceCharting mean) did in ' + (up ? 'rising' : 'falling') + ' markets, 2022 on, lines $' + (D.rank_min || 25) + '+: the median move, how often the price was up, and how often one bought ' + dw + ' under (the shipping in the buy price) netted a profit.</p>' +
    '<div class="pctbox fc-box"><table><thead><tr><th>Hold</th><th class="num">Move</th><th class="num">Up</th><th class="num" title="a slab bought ' + dw + ' under its standard price, less the shipping">' + dw + ' under</th></tr></thead><tbody>' +
    [1, 2, 3, 4, 5, 6].map(line).join('') + '</tbody></table></div>' +
    '<p class="dim">Model ' + esc(D.model || '') + ', data month ' + esc(D.month || '') + ', built ' + esc((D.t || '').replace('T', ' ').replace('Z', ' UTC')) + ', ' + Number(D.n_ranked || 0).toLocaleString('en-US') + ' of ' + Number(D.n_lines || 0).toLocaleString('en-US') + ' PriceCharting graded lines ranked. PriceCharting’s Grade 7 – 9.5 lines blend every grader; CGC 10 and the grades without a line of their own have no score.</p>';
}
function fcgMeta() {
  const m = $('meta-fcg'); if (!m) return;
  const D = fcgDoc();
  const md = typeof fcgMode === 'function' ? fcgMode() : 'fc';
  m.textContent = md === 'rc' ? 'Forecast · graded cards (PSA and CGC) · Recording: the slabs you recorded at a card show, best chance first - green: buy it with the capital left; Yes: you bought it at its buy price; No: the vendor wanted more'
    : md === 'pl' ? 'Forecast · graded cards (PSA and CGC) · Planning: the slabs you bought (marked Yes on Recording), what you paid and what they are expected to make; Record plan keeps them on History'
    : md === 'hi' ? 'Forecast · graded cards (PSA and CGC) · History: Graded Forecasting’s plan run on every month since 2022 with only what was known then, and the plans you recorded on Planning'
    : 'Forecast · graded cards (PSA and CGC) · which slabs to buy at a vendor and sell on eBay, every listed slab assumed for sale, ranked like the raw tab: how far each grade’s PriceCharting price sits below its own 12-month mean' + (D ? ' · ' + D.model : '');
}
// the cells
const fcgM = v => v == null ? '<span class="dim">-</span>' : fmtMoney(v);
function fcg2(cl, pc, clTip, pcTip, r) {                  // a two-line cell: Card Ladder on top, PriceCharting under it
  const clw = r[75] === 'pending' ? '<span class="dim">pending</span>' : r[75] === 'no match' ? '<span class="dim">no match</span>' : cl;
  return '<td class="num fcg2"><span title="' + esc(clTip) + '"><i>CL</i> ' + clw + '</span><span title="' + esc(pcTip) + '"><i>PC</i> ' + pc + '</span></td>';
}
// a row's cells by name (Recording and Planning use the same ones in their own order, with their own columns between)
function fcgCells(r, I) {
  const k = r[0] + '|' + esc(r[50]), c = (GR.doc.cards || {})[String(r[0])] || {}, on = r.fcPl === 1, d = r.fcD != null ? r.fcD : I.disc;
  const pcFrom = r[67] != null ? 'PriceCharting’s price of this grade today' : 'PriceCharting’s price of this grade last month (none today)';
  const clFrom = r[68] != null ? 'Card Ladder’s value of this grade today' : 'Card Ladder’s average of this grade’s sales last month (no value today)';
  const buyTip = side => side + ' standard price x (1 - ' + fcgDiscWord(d) + ') - ' + fmtMoneyPlain(I.ship) + ' shipping: the most to pay the vendor';
  const pcSold = r[76] && r[16] != null ? '~' + fmtInt(r[16]) : r[16] == null && (r[69] || [])[2] === 'not_read' ? '<span class="dim">not read</span>' : r[16] == null ? '<span class="dim">-</span>' : fmtInt(r[16]);
  return {plus: '<td>' + fcgPlusBtn(k, on) + '</td>',
    flag: '<td class="gflc">' + (r[42] ? '<button class="gflag on" data-k="' + k + '" title="' + esc('Your flag: ' + r[42] + '. Click to change it or take it off.') + '">⚑ ' + esc(r[42]) + '</button>' : '<button class="gflag" data-k="' + k + '" title="Flag this row with a reason - the same flags as the PriceCharting tab’s graded rows">⚐</button>') + '</td>',
    review: (!c.pid ? '<td><span class="dim" title="Review puts PriceCharting’s card beside Card Ladder’s - this card has no Card Ladder card yet">-</span></td>'
      : '<td><button class="rvb grvb' + (r[41] === 1 ? ' same' : r[41] === 0 ? ' diff' : '') + '" data-k="' + k + '" title="Compare PriceCharting’s card with Card Ladder’s">Review</button></td>'),
    name: '<td class="fcr-nm">' + esc(r[1]) + '<br><span class="dim">' + esc(String(r[2] || '').replace(/^Pokemon /, '')) + (r[3] ? ' · #' + esc(r[3]) : '') + '</span></td>',
    grade: '<td><b>' + esc(r[25]) + '</b></td>',
    std: fcg2(fcgM(r.fcSc), fcgM(r.fcS), clFrom, pcFrom, r),
    buy: fcg2(fcgM(r.fcBc), fcgM(r.fcB), buyTip('Card Ladder’s'), buyTip('PriceCharting’s'), r),
    sold: fcg2(r[37] == null ? '<span class="dim">-</span>' : fmtInt(r[37]), pcSold, 'Card Ladder’s recorded sales of this grade last month', 'PriceCharting’s recorded sales of this grade and grader last month' + (r[76] ? ' (an estimate: its list of sales does not reach back to the start of the month)' : ''), r),
    chance: fcgChanceCell(r, I),
    qty: '<td class="num">' + (r.fcQ ? '<b>' + r.fcQ + '</b>' : '<span class="dim">—</span>') + '</td>',
    net: fcg2(r.fcNc == null ? '<span class="dim">-</span>' : fcgMoneyS(r.fcNc), r.fcN == null ? '<span class="dim">-</span>' : fcgMoneyS(r.fcN), 'Expected net per copy at Card Ladder’s value, after eBay’s fee and the shipping', 'Expected net per copy at PriceCharting’s price: standard x ((1 + the group’s average return) x (1 - eBay’s fee) - (1 - ' + fcgDiscWord(d) + '))', r),
    roi: fcg2(r.fcRc == null ? '<span class="dim">-</span>' : fcgPct(r.fcRc / 100), r.fcR == null ? '<span class="dim">-</span>' : fcgPct(r.fcR / 100), 'Net / buy price, over the hold (Card Ladder)', 'Net / buy price, over the hold (PriceCharting)', r)};
}
function fcgRow(r) {
  const x = fcgCells(r, FCG.I);
  return x.plus + x.flag + x.review + x.name + x.grade + x.std + x.buy + x.sold + x.chance + x.qty + x.net + x.roi + fcgPcx(r).join('');
}
function fcgChanceCell(r, I) {
  const grp = r.fcG == null ? '' : r.fcG === 9 ? 'deepest 10%' : 'group ' + (10 - r.fcG) + ' of 10 (1 = deepest)', d = r.fcD != null ? r.fcD : I.disc;
  return r.fcP == null ? '<td class="num"><span class="dim" title="' + esc(FCG_LINE(r[50]) ? 'No rank for this line today: PriceCharting needs a full year of prices of this grade, $' + ((fcgDoc() || {}).rank_min || 25) + '+' : 'PriceCharting has no price line of its own for ' + r[25] + ' (the model reads its PSA 10 line and its Grade 9.5 / 9 / 8 / 7 lines)') + '">no score</span></td>'
    : '<td class="num" title="' + esc('Rank: ' + grp + ' (' + fcOrd(Math.round(r.fcPct * 100)) + ' percentile, furthest below its own 12-month mean = 100th). How often slabs of that group made money over ' + I.h + ' month' + (I.h > 1 ? 's' : '') + ' in this kind of market, 2022 on (' + Number(r.fcT.n).toLocaleString('en-US') + ' cases), bought ' + fcgDiscWord(d) + ' under') + '">' + r.fcP.toFixed(0) + '%</td>';
}
const fcgPlusBtn = (k, on) => '<button type="button" class="gplb' + (on ? ' on' : '') + '" data-k="' + k + '" title="' + (on ? 'On your Looking for list (Graded > Recording) - click to take it off' : 'Put this card and grade on your Looking for list (Graded > Recording): the slabs you want at the show') + '">+</button>';
const fcgMoneyS = v => '<span class="' + (v < 0 ? 'down' : v > 0 ? 'up' : '') + '">' + (v < 0 ? '−' : v > 0 ? '+' : '') + fmtMoneyPlain(Math.abs(v)) + '</span>';
// Only Hits (2026-11-04, Brett: "under forcasting graded and record graded maybe have a "Only Hits" button to only show
// the listings with the green tinted pastel color"): one switch for Forecasting and Recording, in the filter-button bar
// (so it moves with it; not on Planning). The plan is worked out on every row on view first - the filters steer the money
// as before - and then only its green rows are drawn.
const FCG_HITS = {on: !!grLS('fcg-hits', false)};
$('fcg-gmode').insertAdjacentHTML('afterbegin', '<button type="button" class="gm2 gtb fcg-hits" id="fcg-hits" title="On = show only the green rows: the slabs the plan buys with the capital (Recording: the open slabs it would buy with what is left). The plan is worked out on every row the other filters leave, then only its buys are listed.">Only Hits <span class="dim" id="fcg-hits-n"></span></button>');
{ const pt = grPaintTerms; grPaintTerms = function (F) {   // the switch sits first in the row of filter buttons (kept out of their redraw, like Grading)
  const b = $('fcg-hits'), box = $('fcg-gm-terms');
  if (b && box && box.contains(b)) box.parentNode.insertBefore(b, box);
  const out = pt.apply(this, arguments);
  if ((F || GF.pc) === GF.fc && b && box && !box.hidden) box.insertBefore(b, box.firstChild);
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
$('fcg').addEventListener('click', e => { const hb = e.target.closest('th.pcx button.help'); if (hb) { e.stopPropagation(); e.preventDefault(); openHelp(hb.dataset.h); } }, true);
// the table: the PriceCharting tab's machinery (eyes, highlight, names, drag, Columns…, Filters…)
const FCG_RANGES = ['fcS', 'fcSc', 'fcB', 'fcBc', 16, 37, 'fcP', 'fcN', 'fcNc', 'fcR', 'fcRc'];
const FCG_LABELS = {fcS: 'Standard PC $', fcSc: 'Standard CL $', fcB: 'Buy price PC $', fcBc: 'Buy price CL $', 16: 'Sold PC (last mo)', 37: 'Sold CL (last mo)', fcP: 'Chance %', fcN: 'Net PC $', fcNc: 'Net CL $', fcR: 'ROI PC %', fcRc: 'ROI CL %'};
fcgAddPcHeads('#fcg-main', 'fcg');
tables.fcg = makeTable('fcg', {rows: () => fcgRows(), noun: 'graded rows', ranges: FCG_RANGES, labels: FCG_LABELS, defaults: {}, root: '#fcg-main', name: 'Forecast · graded', onCols: h => fcgColsTake('fcg', h),
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
// the + (2026-11-04, Brett: "when its toggled on, the + will turn green, so i know which have been added from forcast"):
// the card x grade goes on the Looking for list of Graded > Recording - the slabs to look for at the show. Kept in this
// browser; the same + on Recording's rows
function fcgPlusToggle(k) {
  const on = !FCG.plan.has(k);
  if (on) FCG.plan.add(k); else FCG.plan.delete(k);
  grSave('fcg-plan', [...FCG.plan]);
  for (const r of FCG.rows) if (r[0] + '|' + r[50] === k) r.fcPl = on ? 1 : 0;
  document.querySelectorAll('#fcg button.gplb').forEach(b => { if (b.dataset.k === k) { b.outerHTML = fcgPlusBtn(k, on); } });
  fcgPlanCount();
  if (typeof fcrLookPaint === 'function') fcrLookPaint();
}
$('rows-fcg').addEventListener('click', e => { const b = e.target.closest('.gplb'); if (b) fcgPlusToggle(b.dataset.k); });
function fcgPlanCount() { if (typeof fcrCounts === 'function') fcrCounts(); }
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
  fcgInSave();
  fcgRegime(); if (GR.doc) { tables.fcg.apply(); if (typeof fcrApplyAll === 'function') fcrApplyAll(); }
  if (m === 'hi' && typeof fhgRender === 'function') fhgRender();   // History: the replay follows the pane
}
$('fcg-side').addEventListener('change', e => { if (e.target.closest('input, select')) fcgChanged(); });
$('fcg-side').addEventListener('input', e => { if (e.target.type === 'number') { clearTimeout(FCG.tm); FCG.tm = setTimeout(fcgChanged, 400); } });
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
  fcg_cap: {t: 'Capital to spend', f: 'the dollars the plan may spend at the vendor: the sum of the Buy prices of the slabs it buys', m: 'The plan buys the best-chance slabs first, at most the per-card share of this each and at most the copies per card, until the money runs out. Every listed slab is assumed for sale (a vendor\'s stock is not known in advance).', e: '$1,000 and 20% per card: at most $200 on any one slab.'},
  fcg_hold: {t: 'Hold for', f: '1 to 6 months: how long you keep a slab before selling it on eBay', m: 'The odds are specific to the hold: how slabs of the same rank group did over exactly that many months, in this kind of market, 2022 on. The market box shows all six side by side.', e: 'Hold 6 months: the chances use what each group did over six months.'},
  fcg_disc: {t: '% Under The Standard Grade Price', f: 'Buy price = standard price x (1 - this) - the eBay Shipping Fee', m: 'How far under the standard price (PriceCharting\'s price of the grade, and Card Ladder\'s value beside it) you pay the vendor. 14.1% by default: eBay\'s fee, so a slab bought 14.1% under whose price does not move nets $0 - the profit is the move over the hold, and anything you buy deeper under. The market box\'s last column follows this box.', e: 'Standard $200, 14.1% under, $5.20 shipping: pay at most $166.60.'},
  fcg_ship: {t: 'eBay Shipping Fee', f: 'what one sale costs to ship (label and supplies); $5.20 by default', m: 'Taken off the Buy price (what to pay the vendor) and paid again as the label when the slab sells, so it cancels out in Net: Net and Chance depend on the % under, the Buy price and ROI on the shipping too. The "Fees assumed" figure shows it.', e: 'Shipping $6 instead of $5.20: every Buy price drops 80 cents.'},
  fcg_price: {t: 'Card price between', f: 'only slabs whose standard price (PriceCharting\'s, else Card Ladder\'s) is inside this range are listed', m: 'The band narrows the listing and the plan, on Forecasting, Recording and Planning alike (a bought slab by the price it was bought at; its money stays spent). $50 to $5,000 by default.', e: '$100 to $1,000: the cheaper and the dearer slabs leave the list.'},
  fcg_share: {t: 'At most per card', f: 'copies of one slab x buy price stays under this share of the capital', m: 'Spreads the money over many slabs, as the raw tab does: picks are nearly independent, so twenty slabs are far safer than two.', e: '20% of $1,000: no single slab gets more than $200.'},
  fcg_conf: {t: 'Buy only at ... or better chance of a profit', f: 'a slab is bought only when its Chance is at least this', m: 'The rows under the bar stay listed, in buy order, but get no money.', e: '50%: a slab at 48% is listed, not bought.'},
  fcg_copies: {t: 'Copies per card', f: 'the most copies of one slab the plan buys (1-5)', m: 'One by default, as the raw tab.', e: '2: the plan may buy two PSA 10s of the same card.'},
  fcg_gate: {t: 'Buy only when the market is rising', f: 'on (the default): nothing is bought while the graded market is falling', m: 'The graded market (the box below): the average monthly move of PriceCharting\'s graded lines over the last three months. Since 2022, when it was positive the next quarter was up about 8 times in 10; when negative, about 1 in 4. Off: the plan buys in a falling market too, with the falling-market odds.', e: 'Falling market, switch on: every Buy is 0 and the summary says why.'},
  fcg_regime: {t: 'The market now (graded)', f: 'the average monthly move of PriceCharting\'s graded lines over the last three months; up or down sets which odds are used and the gate', m: 'The raw tab reads the median move; most graded lines do not move at all in a month, which made the median 0 every month, so the graded market is the average move (each line clipped to plus or minus 50%). The table: what the deepest-dip slabs (the top 10% of the rank) did over 1 to 6 months in this kind of market - the median move, how often the price was up, and how often one bought at your % under (the shipping in the buy price) netted a profit.', e: 'Rising, +4% a month: the plan may buy, with the rising-market odds.'},
  fcg_picks: {t: 'What to buy (graded)', f: 'every graded row of the PriceCharting tab in your price band, assumed for sale, best chance first; the light green rows are the buys', m: 'The buttons above the table are the PriceCharting tab\'s (Grading, the word buttons, Flags, Unsure, Auth read, CL read, CL To PC Match), with settings of their own shared by Forecasting, Recording and Planning (graded) - the search and the filter chips too; Filters… and Columns… and the headers work as on the other tabs; Columns… also lists every PriceCharting graded column but the eBay ones (off until you tick them), and which columns show is one choice for Forecasting, Recording, Planning and the slab lists on History. The plan follows the rows on view: filter the list and the money goes to what is left. The summary\'s range and chance are for the whole basket (a simulation that draws each slab\'s outcome from its group).', e: 'Grading: PSA 10 only - the plan buys only PSA 10s.'},
  fcg_plan: {t: '+ (Looking for)', f: 'a click puts the card and grade on the Looking for list of Graded > Recording; the + turns green', m: 'The slabs to look for at the show, with the most to pay for each. Click the green + again to take it off. Kept in this browser.', e: '+ on a PSA 10 Umbreon: Recording\'s Looking for list shows it.'},
  fcg_name: {t: 'PC Card Name', f: 'PriceCharting\'s name of the card, with its set and number under it', m: 'Not a link (Brett). Review compares it with Card Ladder\'s card.', e: 'Umbreon VMAX #215 · Evolving Skies.'},
  fcg_grade: {t: 'Grade', f: 'the grader and grade of the row: one row per card per grade', m: 'The model reads PriceCharting\'s PSA 10 line for PSA 10, and its Grade 9.5 / 9 / 8 / 7 lines (every grader blended) for those grades; other grades show no score.', e: 'PSA 9 and CGC 9 read the same Grade 9 line.'},
  fcg_std: {t: 'Standard Price', f: 'CL: Card Ladder\'s value of the grade today (else last month\'s average); PC: PriceCharting\'s price of the grade today (else last month\'s)', m: 'The price a slab is bought under and sold at. The model\'s history is PriceCharting\'s, so the chance is worked out on the PC side; Net and ROI are shown for both. Sorting and the filter chip use the PC figure.', e: 'CL $185.00 / PC $200.00.'},
  fcg_buy: {t: 'Buy Price', f: 'standard price x (1 - % under) - eBay Shipping Fee, for each side', m: 'The most to pay the vendor for the slab. Brett\'s rule: "the pc buy price would be 10% under minus $6".', e: 'PC $200, 14.1% under, $5.20: $166.60.'},
  fcg_sold: {t: 'Sold (last month)', f: 'CL: Card Ladder\'s recorded sales of the grade last month; PC: PriceCharting\'s recorded sales of the grade and grader last month', m: 'How liquid the slab is - what you would sell against. A ~ marks PriceCharting\'s estimate (its list of sales does not reach back to the start of the month); pending = Card Ladder has not read the card yet.', e: 'CL 12 / PC 9.'},
  fcg_chance: {t: 'Chance', f: 'how often slabs of the same rank group made money over your hold, in this kind of market, 2022 on, bought at your % under', m: 'The rank: how far the grade\'s PriceCharting price sits below its own 12-month mean, against every graded line $25+ (ten groups). The break-even is a price that does not move at 14.1% under (the shipping cancels out), so every slab of a group has the same chance; hover for the group. "no score": no line of its own, or not a full year of prices. At most 95%.', e: '62%: 62 of every 100 such slabs ended up.'},
  fcg_hits: {t: 'Only Hits', f: 'on = only the green rows: the slabs the plan buys', m: 'One switch for Graded Forecasting and Recording (not on Planning, where every row is bought). The plan is still worked out on every row the other filters and the boxes leave, best chance first; Only Hits then lists just its buys, and the count beside the search box says how many. The number on the button is the green rows at these settings.', e: '$1,000 at 14.1% under: Only Hits lists the 15 slabs the plan buys.'},
  fcg_qty: {t: 'QTY', f: 'how many copies the plan buys', m: 'Best chance first among the rows on view, only at or above your bar, never more than the copies per card or the per-card share, until the capital runs out; nothing while the gate is red.', e: '1 on the first ten rows of a $1,000 plan.'},
  fcg_net: {t: 'Net', f: 'expected net per copy: standard x ((1 + the group\'s average return) x (1 - eBay\'s fee) - (1 - % under))', m: 'The average outcome of the group over the hold, after eBay\'s fee, the shipping and what you paid; for both sides\' standard prices. An average: the typical slab moves less, a few move a lot - the summary\'s range shows the spread.', e: 'PC $200, average return +12% over 3 months, 14.1% under: +$20.61.'},
  fcg_roi: {t: 'ROI %', f: 'Net / Buy price, over the hold, for each side', m: 'What the money spent on the slab earns over the hold.', e: '+$20.61 on $166.60: +12.4%.'}
});
