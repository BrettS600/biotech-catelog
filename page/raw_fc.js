/* ---------------- The Forecast tab: Raw cards, graded-style (2026-11-17, Brett) ----------------
   "under the forecast tab, when you select raw cards, it show forecasting, planning, recording, and purchases, and behaves in
   the same way. As the graded cards portion"; "I'm not going to be buying from eBay anymore. I'm going to just be selling on
   eBay"; raw Recording: "we'll hold off for that for now until the scanner gets built for the raw cards". His answers:
   Forecasting graded-style - every raw card assumed buyable at X% under PriceCharting's raw price and sold on eBay (fee +
   shipping), the same Your plan box, table and columns as Graded, the eBay-supply filters gone; Planning replaced with
   Purchases - empty until the raw scanner and Recording exist, the old eBay Planning basket kept in the browser.
   THE MODEL is the raw tab's own (forecast.bin = FC.doc, loaded by app.js's loadForecast): a card's rank is how far its
   PriceCharting price sits below its own 12-month mean (pct1 / pct3 / pct6, four groups: deepest 10%, top 25%, upper half,
   lower half), its chance how often cards of that group made money over the hold in this kind of market, 2022 on. Holds 1, 3
   and 6 months: what the model measures.
   THE MONEY is graded_fc.js's with PriceCharting's raw price as the standard: Buy = standard x (1 - % under) - shipping (the
   most to pay); net = standard x ((1 + return) x (1 - fee) - (1 - % under)) - the shipping comes off what you pay and goes
   out as the label, so at 14.1% under a card whose price does not move nets $0. The rows are the page's own catalog rows
   (DATA) with graded_fc.js's field names (fcS fcB fcP fcN fcR fcQ fcD fcT fcPct), so its helpers (fcgCdf, fcgOrder,
   fcgPlaces, fcgMonteCarlo) run on them unchanged. Every card with a raw price in the band is listed; one the model does
   not rank shows "no score" and gets no money. The old raw Forecasting / Planning (#fc-al) stays in the page, hidden: the
   Raw Data tab's Forecast % column and the alerts' forecast filter still read its boxes. Stitched after graded_fh.js. */
const RFC = {rows: [], key: '', I: null, fee: 0, picks: [], spent: 0, mc: null, gated: false, elig: 0, D: null, Dsrc: null, drawn: null, lp: null};
const RFC_IN_DEFAULT = {cap: 1000, h: 3, disc: 14.1, ship: 5.2, pmin: 50, pmax: 500, share: 20, minp: 50, copies: 1, gate: true, young: false, fold: false};
// what a refresh keeps: the capital, the hold and the fold, as on the graded side (Brett, 2026-11-04); the other boxes start
// at their defaults each visit
const RFC_KEEP = ['cap', 'h', 'fold'];
const RFC_IN = Object.assign({}, RFC_IN_DEFAULT, (() => { const sv = grLS('rfc-in', {}) || {}, o = {}; RFC_KEEP.forEach(k => { if (sv[k] !== undefined) o[k] = sv[k]; }); return o; })());
if (![1, 3, 6].includes(+RFC_IN.h)) RFC_IN.h = 3;
const rfcInSave = () => { const o = {}; RFC_KEEP.forEach(k => { o[k] = RFC_IN[k]; }); grSave('rfc-in', o); };
const rfcMode = () => ['rc', 'pl', 'hi'].includes(NAV.rm) ? NAV.rm : 'fc';
function rfcD() {                                          // the raw model as graded_fc.js's helpers read it: the grid, the tables, the market
  const doc = FC.doc; if (!doc || !doc.calib || !doc.calib.tables) return null;
  if (RFC.Dsrc !== doc) { RFC.Dsrc = doc; RFC.D = {qs: doc.calib.quantiles || FC_QS, tables: doc.calib.tables, regime: doc.regime || {}}; }
  return RFC.D;
}
const rfcUp = D => !!(D && D.regime && ('up' in D.regime ? D.regime.up : D.regime.reg3 > 0));
function rfcInputs() {
  const n = (id, d) => { const v = parseFloat($(id).value); return isNaN(v) ? d : v; }, h = +$('rfc-h').value;
  return {cap: Math.max(0, n('rfc-cap', 1000)), h: [1, 3, 6].includes(h) ? h : 3, disc: Math.min(0.6, Math.max(0, n('rfc-disc', 14.1) / 100)),
          ship: Math.max(0, n('rfc-ship', 5.2)), pmin: Math.max(0, n('rfc-pmin', 50)), pmax: Math.max(0, n('rfc-pmax', 500)), share: Math.min(1, Math.max(0.05, n('rfc-share', 20) / 100)),
          minp: Math.min(0.95, Math.max(0, n('rfc-minp', 50) / 100)), copies: Math.min(5, Math.max(1, Math.round(n('rfc-copies', 1)))), gate: $('rfc-gate').checked, young: $('rfc-young').checked};
}
// a card's age in months: the model's (months since its set's release), else the catalog's release date
const RFC_NOW_M = (() => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); })();
function rfcAge(r, a) {
  const ix = FC.ix || {};
  if (a && ix.age != null && a[ix.age] != null) return a[ix.age];
  const m = /^(\d{4})-(\d{2})/.exec(r[4] || ''); return m ? RFC_NOW_M - (+m[1] * 12 + (+m[2] - 1)) : null;
}
// a row's rank, odds and money (graded_fc.js's fcgCalc with the raw model: the group is the rank bucket)
function rfcCalc(r, std, a, I, D, fee) {
  const ix = FC.ix || {}, pv = a && ix['pct' + I.h] != null ? a[ix['pct' + I.h]] : null;
  const g = pv == null ? null : fcBucket(pv), t = D && g ? fcgTab(D, I.h, g) : null;
  r.fcS = std; r.fcD = I.disc; r.fcB = fcgBuy(std, I.disc, I.ship); r.fcPct = pv; r.fcG = g; r.fcT = t; r.fcQ = 0; r.fcA = a || null;
  r.fcP = t ? Math.round(Math.min(FC_P_CAP, 1 - fcgCdf(D, t, fcgBreak(I.disc, fee))) * 1000) / 10 : null;
  r.fcN = t ? fcgNet(std, t.mean, I.disc, fee) : null;
  r.fcR = r.fcN != null && r.fcB > 0 ? Math.round(r.fcN / r.fcB * 1000) / 10 : null;
  return r;
}
// every raw card in the band, worked out again when the model or the plan's boxes change; buy order, then the places
function rfcRows() {
  const D = rfcD(), I = rfcInputs(), fee = fcgFee();
  const key = JSON.stringify(I) + '|' + fee + '|' + (FC.doc ? FC.doc.t : '');
  if (RFC.key === key) return RFC.rows;
  const cards = D ? FC.doc.cards : null, out = [];
  for (const r of DATA) {
    const std = r[6]; if (std == null || !(std >= I.pmin && std <= I.pmax)) continue;
    const a = cards ? cards[String(r[0])] : null;
    if (!I.young) { const age = rfcAge(r, a); if (age != null && age < 24) continue; }   // sets under 2 years old: out unless the box is ticked (the old raw rule)
    out.push(rfcCalc(r, std, a, I, D, fee));
  }
  out.sort(fcgOrder);
  fcgPlaces(out);
  Object.assign(RFC, {rows: out, key, I, fee});
  return out;
}
// the plan: best chance first among the rows on view, up to the per-card share, the copies and the capital; nothing while
// the gate is red
function rfcAllocate(view) {
  const I = RFC.I, D = rfcD();
  RFC.rows.forEach(r => { r.fcQ = 0; });
  RFC.gated = !!(D && I.gate && !rfcUp(D));
  let left = I.cap;
  const elig = view.filter(r => r.fcP != null && r.fcP / 100 >= I.minp && r.fcB > 0).sort(fcgOrder);
  if (!RFC.gated) elig.forEach(r => {
    const q = Math.min(Math.floor(I.cap * I.share / r.fcB), I.copies, Math.floor(left / r.fcB));
    if (q > 0) { r.fcQ = q; left -= q * r.fcB; }
  });
  RFC.picks = elig.filter(r => r.fcQ > 0); RFC.spent = I.cap - left; RFC.elig = elig.length;
  RFC.mc = D && RFC.picks.length ? fcgMonteCarlo(D, RFC.picks, I, RFC.fee) : null;
}
function rfcSummary() {
  const box = $('rfc-summary'); if (!box) return;
  const I = RFC.I || rfcInputs(), mc = RFC.mc, unit = I.h + ' month' + (I.h > 1 ? 's' : ''), fee = RFC.fee || fcgFee();
  if (!FC.doc) { box.innerHTML = FC.err ? '<p class="warn">The model file could not be loaded (' + esc(FC.err) + ') - it is built by the daily site update. The rows below have their prices; Chance, Net and ROI fill in with it.</p>' : '<p class="dim">Loading the model… the rows below have their prices; Chance, Net and ROI fill in with it.</p>'; return; }
  const n = RFC.picks.length, copies = RFC.picks.reduce((s, r) => s + r.fcQ, 0);
  let s = '';
  if (RFC.gated) s = '<p><b>Nothing to buy: the market is falling</b> (the typical card ' + fcgPct(FC.doc.regime.reg3) + ' a month over the last three months) and “Buy only when the market is rising” is on. ' + (RFC.elig ? RFC.elig + ' card' + (RFC.elig > 1 ? 's' : '') + ' would clear your bar anyway - the list is in buy order; switch it off to see the plan.' : '') + '</p>';
  else if (!n) s = '<p><b>No card clears your bar</b> (' + Math.round(I.minp * 100) + '% chance of a profit, ' + fcgDiscWord(I.disc) + ' under, a ' + unit + ' hold) among the rows on view. Lower the bar, buy deeper under, or hold longer.</p>';
  else s = '<p>Spend <b>' + fmtMoneyPlain(RFC.spent) + '</b> of ' + fmtMoneyPlain(I.cap) + ' on <b>' + n + ' card' + (n > 1 ? 's' : '') + '</b> (' + copies + (copies === 1 ? ' copy' : ' copies') + '), each bought ' + fcgDiscWord(I.disc) + ' under PriceCharting’s raw price less the shipping, hold ' + unit + ', sell on eBay at PriceCharting’s price then. Every listed card is assumed for sale; the green rows are the buys.</p>';
  s += '<div class="stats fc-stats">' +
    '<div class="stat"><div class="k">Expected net profit</div><div class="v">' + (mc ? fcMoney(mc.mean) + (RFC.spent > 0 ? ' <span class="fc-roi ' + (mc.mean < 0 ? 'down' : 'up') + '">' + fcgPct(mc.mean / RFC.spent) + '</span>' : '') : '-') + '</div><div class="d">average of the basket, after fees and shipping</div></div>' +
    '<div class="stat"><div class="k">Likely range</div><div class="v">' + (mc ? fcMoney(mc.lo) + ' to ' + fcMoney(mc.hi) : '-') + '</div><div class="d">10th to 90th percentile' + (mc ? '; median ' + fcMoney(mc.med) : '') + '</div></div>' +
    '<div class="stat"><div class="k">Chance the plan profits<button class="help" data-h="rfc_mc">?</button></div><div class="v">' + (mc ? (mc.p * 100).toFixed(0) + '%' : '-') + '</div><div class="d">the green cards together, bought ' + fcgDiscWord(I.disc) + ' under</div></div>' +
    '<div class="stat"><div class="k">Fees assumed</div><div class="v">' + (fee * 100).toFixed(1) + '% + ' + fmtMoneyPlain(I.ship) + '</div><div class="d">eBay’s fee and your eBay Shipping Fee (in the buy price)</div></div></div>';
  box.innerHTML = s;
}
function rfcRegime() {
  const box = $('rfc-regime'); if (!box) return;
  const D = rfcD(), I = rfcInputs(), fee = fcgFee(), doc = FC.doc;
  if (!D) { box.textContent = FC.err ? 'The model file could not be loaded (' + FC.err + ').' : 'Waiting for the model…'; return; }
  const R = D.regime || {}, up = rfcUp(D), confirm = 'confirm' in R ? !!R.confirm : R.reg1 > 0, light = !up ? 'red' : confirm ? 'green' : 'amber';
  const head = !up ? 'Falling market — the gate is red.' : confirm ? 'Rising market — the gate is green.' : 'Rising market, but last month turned down — amber.';
  const be = fcgBreak(I.disc, fee), dw = fcgDiscWord(I.disc), mid = D.qs.indexOf(0.5);
  const line = h => { const t = fcgTab(D, h, 'top10'); if (!t) return '<tr><td>' + h + '&nbsp;mo</td><td class="num" colspan="3"><span class="dim">too few cases</span></td></tr>';
    return '<tr><td>' + h + '&nbsp;mo</td><td class="num">' + fcgPct(mid >= 0 ? t.q[mid] : null) + '</td><td class="num">' + (t.p_up != null ? (t.p_up * 100).toFixed(0) + '%' : '-') + '</td><td class="num">' + (Math.min(FC_P_CAP, 1 - fcgCdf(D, t, be)) * 100).toFixed(0) + '%</td></tr>'; };
  box.innerHTML = '<p><b class="fc-light fc-light-' + light + '">' + head + '</b> The typical card moved <b>' + fcgPct(R.reg3) + ' a month</b> over the last three months (' + fcgPct(R.reg1) + ' last month' + (R.breadth3 != null ? '; ' + (R.breadth3 * 100).toFixed(0) + '% of cards up' : '') + '). ' +
    'When this three-month figure is positive the next quarter has been up 95% of the time; when negative, 12% — so ' + (up ? 'the plan may buy' : 'the plan buys nothing while “Buy only when the market is rising” is on') + '.</p>' +
    '<p class="dim">What the deepest-dip cards (the top 10% of the rank: furthest below their own 12-month PriceCharting mean) did in ' + (up ? 'rising' : 'falling') + ' markets, 2022 on, cards $25+: the median move, how often the price was up, and how often one bought ' + dw + ' under (the shipping in the buy price) netted a profit.</p>' +
    '<div class="pctbox fc-box"><table><thead><tr><th>Hold</th><th class="num">Move</th><th class="num">Up</th><th class="num" title="a card bought ' + dw + ' under PriceCharting’s raw price, less the shipping">' + dw + ' under</th></tr></thead><tbody>' +
    [1, 3, 6].map(line).join('') + '</tbody></table></div>' +
    '<p class="dim">Model ' + esc(doc.model || 'v1') + ', data month ' + esc(doc.month || '') + ', built ' + esc((doc.t || '').replace('T', ' ').replace('Z', ' UTC')) + ' from ' + Number(doc.n || 0).toLocaleString('en-US') + ' cards’ PriceCharting history' + (doc.n_ranked ? ' (' + Number(doc.n_ranked).toLocaleString('en-US') + ' ranked)' : '') + '.</p>';
}
function rfcMeta() {
  const m = $('meta-rfc'); if (!m) return;
  const md = rfcMode(), D = FC.doc;
  m.textContent = md === 'rc' ? 'Forecast · raw cards · Recording: comes with the raw card scanner'
    : md === 'pl' ? 'Forecast · raw cards · Purchases: the raw cards you buy - empty until the raw card scanner and Recording exist'
    : 'Forecast · raw cards · which raw cards to buy and sell on eBay, every card PriceCharting prices assumed for sale, ranked by how far each sits below its own 12-month PriceCharting level' +
      (D ? ' · model ' + (D.model || 'v1') + ' of ' + (D.month || '') : FC.err ? ' · the model file could not be loaded (' + FC.err + ')' : ' · loading the model…');
}
// the cells
function rfcChanceCell(r, I) {
  return r.fcP == null ? '<td class="num"><span class="dim" title="' + esc(rfcNoScore(r)) + '">no score</span></td>'
    : '<td class="num" title="' + esc('Rank: ' + FC_BUCKET_WORDS[r.fcG] + ' (' + fcOrd(Math.round(r.fcPct * 100)) + ' percentile, furthest below its own 12-month PriceCharting mean = 100th). How often cards of that group made money over ' + I.h + ' month' + (I.h > 1 ? 's' : '') + ' in this kind of market, 2022 on' + (r.fcT && r.fcT.n ? ' (' + Number(r.fcT.n).toLocaleString('en-US') + ' cases)' : '') + ', bought ' + fcgDiscWord(r.fcD) + ' under') + '">' + r.fcP.toFixed(0) + '%</td>';
}
const rfcNoScore = r => !FC.doc ? 'The model file is not loaded yet' : !r.fcA ? 'The model does not follow this card: it scores cards priced $10 and up with a year of PriceCharting history' : 'No rank for this card today: the model ranks cards $' + (FC.doc.rank_min_price || 25) + '+ with ' + (FC.doc.rank_min_vol12 || 6) + '+ PriceCharting sales in their last 12 months';
function rfcRow(r) {
  const I = RFC.I, a = r.fcA, ix = FC.ix || {}, d = r.fcD;
  const m12 = a && ix.m12 != null ? a[ix.m12] : null, dev = a && ix.dev12 != null ? a[ix.dev12] : null, v12 = a && ix.vol12 != null ? a[ix.vol12] : null;
  const stdTip = 'PriceCharting’s raw (ungraded) price today: what the card is bought under and sold at' + (m12 != null ? '. Its 12-month mean: ' + fmtMoneyPlain(m12) + (dev != null ? ' (today ' + Math.round(Math.abs(dev) * 100) + '% ' + (dev < 0 ? 'under' : 'over') + ' it)' : '') : '') + (v12 != null ? '. ' + v12 + ' PriceCharting sales in its last 12 months' : '') + '.';
  return '<td class="rfc-nm">' + esc(r[1]) + '<br><span class="dim">' + esc(String(r[2] || '').replace(/^Pokemon /, '')) + (r[3] ? ' · #' + esc(r[3]) : '') + '</span></td>' +
    pcRFCell(pcRF(r)) +
    '<td>' + (r[4] ? esc(r[4]) : dash) + '</td>' +
    '<td class="num" title="' + esc(stdTip) + '">' + fcgM(r.fcS) + '</td>' +
    '<td class="num" title="' + esc('PriceCharting’s raw price x (1 - ' + fcgDiscWord(d) + ') - ' + fmtMoneyPlain(I.ship) + ' shipping: the most to pay for the card') + '">' + fcgM(r.fcB) + '</td>' +
    pcSalesCell(r[16], r[17]) +
    (r.fcPct == null ? '<td class="num"><span class="dim" title="' + esc(rfcNoScore(r)) + '">-</span></td>'
      : '<td class="num" title="' + esc(FC_BUCKET_WORDS[r.fcG] + ': how far the card sits below its own 12-month PriceCharting mean, against every ranked card (100th = the furthest below)') + '">' + fcOrd(Math.round(r.fcPct * 100)) + '<br><span class="dim">' + FC_BUCKET_WORDS[r.fcG] + '</span></td>') +
    rfcChanceCell(r, I) +
    (r.fcBB == null ? '<td class="num"><span class="dim" title="No chance, so no place in the buy order">-</span></td>'
      : '<td class="num" title="' + esc('Best to Buy: number ' + r.fcBB + ' in the buy order - Chance first (to the whole percent), then the deeper dip, then the higher price. The order the plan spends in; the green rows are the ones the money reaches.') + '"><b>' + r.fcBB + '</b></td>') +
    (r.fcBC == null ? '<td class="num"><span class="dim" title="No chance, so no place">-</span></td>'
      : '<td class="num" title="' + esc('Best Chance: place ' + r.fcBC + ' by Chance alone' + (r.fcBCn > 1 ? ', shared by ' + r.fcBCn + ' cards at ' + Math.round(r.fcP) + '% (the model sees them as equally good)' : '')) + '">' + r.fcBC + (r.fcBCn > 1 ? '<span class="dim">=</span>' : '') + '</td>') +
    '<td class="num">' + (r.fcQ ? '<b>' + r.fcQ + '</b>' : '<span class="dim">—</span>') + '</td>' +
    '<td class="num" title="' + esc('Expected net per copy: PriceCharting’s raw price x ((1 + the group’s average return) x (1 - eBay’s fee) - (1 - ' + fcgDiscWord(d) + ')), after eBay’s fee and the shipping') + '">' + (r.fcN == null ? '<span class="dim">-</span>' : fcgMoneyS(r.fcN)) + '</td>' +
    '<td class="num" title="Net / buy price, over the hold">' + (r.fcR == null ? '<span class="dim">-</span>' : fcgPct(r.fcR / 100)) + '</td>' +
    '<td><button class="tbtn" data-i="' + ordOf(r) + '" title="PriceCharting’s price history of the card">Trend</button></td>';
}
// Only Hits (the graded side's switch, its own setting here): the plan is worked out on every row on view, then only its
// green rows are drawn
const RFC_HITS = {on: !!grLS('rfc-hits', false)};
const RFC_RANGES = ['fcS', 'fcB', 16, 5, 'fcP', 'fcN', 'fcR'];
const RFC_LABELS = {fcS: 'Standard $', fcB: 'Buy price $', 16: 'Sold (last mo)', 5: 'PC sales / yr', fcP: 'Chance %', fcN: 'Net $', fcR: 'ROI %'};
rfcInputsPaint();                                          // the kept boxes first: makeTable draws the table at once
tables.rfc = makeTable('rfc', {rows: () => rfcRows(), noun: 'raw cards', ranges: RFC_RANGES, labels: RFC_LABELS, defaults: {}, root: '#rfc-main', name: 'Forecast · raw',
  fav: {s: 'pc', k: r => r[0], c: r => r[0]}, key: r => r[0],
  rowClass: r => r.fcQ ? 'fcg-buy' : '',
  hay: r => [r[1], r[2], r[3], r[14], r[15]].filter(Boolean).join(' '),
  row: rfcRow,
  after: t => {                                         // the plan follows the rows on view; QTY and the green rows are drawn again with it
    if (!RFC.I) return;
    rfcAllocate(t.view);
    $('rfc-hits').classList.toggle('on', RFC_HITS.on); $('rfc-hits-n').textContent = '(' + RFC.picks.length + ')';
    if (RFC_HITS.on) { t.view = t.view.filter(r => r.fcQ > 0); $('count-rfc').textContent = t.view.length.toLocaleString('en-US') + ' hits of ' + RFC.rows.length.toLocaleString('en-US') + ' raw cards'; }
    if (t.sortKey === 'fcQ') t.view.sort((a, b) => (a.fcQ - b.fcQ) * t.sortDir);
    const n = t.shown; $('rows-rfc').innerHTML = ''; t.shown = 0; t.renderMore(Math.max(PAGE, n));
    RFC.drawn = FC.doc; RFC.pcm = LIVE.pcm;
    rfcSummary();
  }});
$('rfc-hits').addEventListener('click', () => { RFC_HITS.on = !RFC_HITS.on; grSave('rfc-hits', RFC_HITS.on); $('rfc-hits').classList.toggle('on', RFC_HITS.on); tables.rfc.apply(); });
$('rows-rfc').addEventListener('click', e => { const b = e.target.closest('.tbtn'); if (b) openTrend(+b.dataset.i); });
// the boxes: remembered as on the graded side, every change worked out again
function rfcInputsPaint() {
  const I = RFC_IN;
  $('rfc-cap').value = I.cap; $('rfc-h').value = String(I.h); $('rfc-disc').value = I.disc; $('rfc-ship').value = I.ship;
  $('rfc-pmin').value = I.pmin; $('rfc-pmax').value = I.pmax; $('rfc-share').value = I.share; $('rfc-minp').value = I.minp;
  $('rfc-copies').value = I.copies; $('rfc-gate').checked = !!I.gate; $('rfc-young').checked = !!I.young;
  rfcFoldPaint();
}
function rfcChanged() {
  const I = rfcInputs();
  Object.assign(RFC_IN, {cap: I.cap, h: I.h, disc: Math.round(I.disc * 1000) / 10, ship: I.ship, pmin: I.pmin, pmax: I.pmax, share: Math.round(I.share * 100), minp: Math.round(I.minp * 100), copies: I.copies, gate: I.gate, young: I.young});
  rfcInSave();
  rfcRegime(); if (rfcMode() === 'fc') tables.rfc.apply(true);
}
$('rfc-side').addEventListener('change', e => { if (e.target.closest('input, select')) { clearTimeout(RFC.tm); rfcChanged(); } });
$('rfc-side').addEventListener('input', e => { if (e.target.type === 'number') { clearTimeout(RFC.tm); RFC.tm = setTimeout(rfcChanged, 400); } });
function rfcFoldPaint() { $('rfc').classList.toggle('folded', !!RFC_IN.fold); document.querySelectorAll('#rfc .rfc-unfold').forEach(b => { b.hidden = !RFC_IN.fold; }); }
$('rfc-fold').addEventListener('click', () => { RFC_IN.fold = true; rfcInSave(); rfcFoldPaint(); });
document.querySelectorAll('#rfc .rfc-unfold').forEach(b => b.addEventListener('click', () => { RFC_IN.fold = false; rfcInSave(); rfcFoldPaint(); }));
// the ? buttons drawn after the page bound the static ones (the summary's)
$('rfc').addEventListener('click', e => { const hb = e.target.closest('.al-now button.help'); if (hb) { e.stopPropagation(); e.preventDefault(); openHelp(hb.dataset.h); } }, true);
document.querySelector('#rfc .wrap').addEventListener('scroll', e => {   // more rows as the table's box nears its bottom
  const w = e.currentTarget, t = tables.rfc;
  if (t && !$('more-rfc').hidden && w.scrollTop + w.clientHeight > w.scrollHeight - 600) t.renderMore();
}, {passive: true});
// raw History's three windows (the graded side's): Forecasting Replay is app.js's FH (the replay and the live plans)
const FHR = {win: grLS('fhr-win', 'rp')};
function fhrWinApply() {
  const w = ['rp', 'rec', 'sc'].includes(FHR.win) ? FHR.win : 'rp';
  $('fh-raw').dataset.win = w;
  document.querySelectorAll('#fhr-wins .fvchip').forEach(b => b.classList.toggle('on', b.dataset.w === w));
}
$('fhr-wins').addEventListener('click', e => { const b = e.target.closest('.fvchip'); if (!b) return; FHR.win = b.dataset.w; grSave('fhr-win', FHR.win); fhrWinApply(); });
fhrWinApply();
// shown when the Forecast tab is on Raw cards: the model file is read on first sight (app.js's loadForecast, once an hour)
function rfcLoad() { if (!RFC.lp) RFC.lp = Promise.resolve(loadForecast()).catch(() => {}).finally(() => { RFC.lp = null; }); return RFC.lp; }
function rfcOldNote() {
  const e = $('rfp-old'); if (!e) return;
  const n = typeof PLAN_MAP !== 'undefined' ? PLAN_MAP.size : 0;
  e.textContent = n ? 'Your old eBay Planning basket (' + n + ' listing' + (n === 1 ? '' : 's') + ') is kept in this browser, not deleted.' : '';
}
function rfcShow() {
  rfcMeta();
  if ($('p-fc').hidden || NAV.fc !== 'raw') return;
  const m = rfcMode();
  if (m === 'hi') { fhrWinApply(); return; }
  rfcRegime(); rfcOldNote();
  if (m === 'fc' && !RFC.I) tables.rfc.apply();             // the prices at once; the chances with the model
  rfcLoad().then(() => {
    rfcMeta(); rfcRegime();
    if (rfcMode() === 'fc' && NAV.fc === 'raw' && !$('p-fc').hidden && (RFC.drawn !== FC.doc || RFC.pcm !== LIVE.pcm)) tables.rfc.apply(true); else rfcSummary();
  });
}
{ const na = navApply; navApply = function () { na.apply(this, arguments); rfcShow(); }; }
{ const st = showTab; showTab = function () { st.apply(this, arguments); rfcShow(); }; }
// a new model file, or PriceCharting's monthly sales (pcm.bin) arriving after the table was drawn (the Sold column): the raw
// page follows - app.js's rebuildLive runs fcCompute on every live refresh and after pcm.bin loads
{ const fc0 = fcCompute; fcCompute = function () { const out = fc0.apply(this, arguments); if (RFC.I && ((FC.doc && RFC.drawn !== FC.doc) || RFC.pcm !== LIVE.pcm)) rfcShow(); return out; }; }
rfcShow();

/* ---- the help behind the page's ? buttons ---- */
Object.assign(HELP, {
  rfc_cap: {t: 'Capital to spend', f: 'the dollars the plan may spend: the sum of the Buy prices of the cards it buys', m: 'The plan buys the best-chance cards first, at most the per-card share of this each and at most the copies per card, until the money runs out. Every listed card is assumed for sale (where you buy is not known in advance).', e: '$1,000 and 20% per card: at most $200 on any one card.'},
  rfc_hold: {t: 'Hold for', f: '1, 3 or 6 months: how long you keep a card before selling it on eBay', m: 'The odds are specific to the hold: how cards of the same rank group did over exactly that many months, in this kind of market, 2022 on. The raw model measures these three holds; the market box shows them side by side.', e: 'Hold 6 months: the chances use what each group did over six months.'},
  rfc_disc: {t: '% Under PriceCharting’s Raw Price', f: 'Buy price = PriceCharting’s raw price x (1 - this) - the eBay Shipping Fee', m: 'How far under PriceCharting’s raw (ungraded) price you pay. 14.1% by default: eBay’s fee, so a card bought 14.1% under whose price does not move nets $0 - the profit is the move over the hold, and anything you buy deeper under. The market box’s last column follows this box.', e: 'PriceCharting $100, 14.1% under, $5.20 shipping: pay at most $80.70.'},
  rfc_ship: {t: 'eBay Shipping Fee', f: 'what one sale costs to ship (label and supplies); $5.20 by default', m: 'Taken off the Buy price (what to pay) and paid again as the label when the card sells, so it cancels out in Net: Net and Chance depend on the % under, the Buy price and ROI on the shipping too. The "Fees assumed" figure shows it.', e: 'Shipping $4 instead of $5.20: every Buy price rises $1.20.'},
  rfc_price: {t: 'Card price between', f: 'only cards whose PriceCharting raw price is inside this range are listed', m: 'The band narrows the listing and the plan. $50 to $500 by default: the raw tab’s band, and the one the History replay’s standard plans use.', e: '$100 to $300: the cheaper and the dearer cards leave the list.'},
  rfc_share: {t: 'At most per card', f: 'copies of one card x buy price stays under this share of the capital', m: 'Spreads the money over many cards: picks are nearly independent, so twenty cards are far safer than two.', e: '20% of $1,000: no single card gets more than $200.'},
  rfc_copies: {t: 'Copies per card', f: 'the most copies of one card the plan buys (1-5)', m: 'One by default.', e: '2: the plan may buy two copies of the same card.'},
  rfc_gate: {t: 'Buy only when the market is rising', f: 'on (the default): nothing is bought while the raw market is falling', m: 'The raw market (the box below): the typical card’s monthly move on PriceCharting over the last three months. When it was positive the next quarter was up 95% of the time; when negative, 12% - in the research this gate was the one rule that removed every losing cycle. Off: the plan buys in a falling market too, with the falling-market odds.', e: 'Falling market, switch on: every QTY is 0 and the summary says why.'},
  rfc_young: {t: 'Allow cards from sets under 2 years old', f: 'off (the default): cards whose set came out less than two years ago are not listed', m: 'The raw tab’s old rule, kept: a young set’s prices are still settling, and the history the odds come from is mostly older cards. Tick it to list them (they are ranked and scored like the rest).', e: 'Ticked: this year’s sets appear in the list.'},
  rfc_picks: {t: 'What to buy (raw)', f: 'every raw card PriceCharting prices in your band, assumed buyable at your % under, best chance first; the light green rows are the buys', m: 'The search, the set list, the filter chips, Filters…, Columns… and the headers work as on the other tabs. The plan follows the rows on view: filter the list and the money goes to what is left. A card the model does not rank shows "no score" and gets no money. The summary’s range and chance are for the whole basket (a simulation that draws each card’s outcome from its group).', e: 'Search "charizard": the plan spends only on the Charizards on view.'},
  rfc_name: {t: 'PC Card Name', f: 'PriceCharting’s name of the card, with its set and number under it', m: 'Trend, at the end of the row, opens PriceCharting’s price history of the card.', e: 'Umbreon VMAX #215 · Evolving Skies.'},
  rfc_rf: {t: 'Rarity / Finish', f: 'what the card is: its rarity and its finish', m: 'From TCGplayer’s catalog (the tcg-id PriceCharting carries) or the open Pokemon TCG dataset, as on the PriceCharting tab.', e: 'Special Illustration Rare · Holofoil.'},
  rfc_rel: {t: 'Release', f: 'the date the card’s set came out', m: 'Sets under two years old are left out unless "Allow cards from sets under 2 years old" is ticked.', e: '2021-08-27.'},
  rfc_std: {t: 'Standard Price', f: 'PriceCharting’s raw (ungraded) price of the card today', m: 'The price a card is bought under and sold at, and the one the chance, Net and ROI use. Hover for its 12-month mean and how far today’s price sits from it (the rank).', e: '$120.00.'},
  rfc_buy: {t: 'Buy Price', f: 'PriceCharting’s raw price x (1 - % under) - eBay Shipping Fee', m: 'The most to pay for the card.', e: '$120, 14.1% under, $5.20: $97.88.'},
  rfc_sold: {t: 'Sold (last month)', f: 'PriceCharting’s recorded sales of the card last month (every grade)', m: 'How liquid the card is - what you would sell against. The filter chip "PC sales / yr" narrows by its last 12 months.', e: '14.'},
  rfc_rank: {t: 'Rank', f: 'how far the card’s PriceCharting price sits below its own 12-month mean, as a percentile of every ranked card (100th = the furthest below), for the hold you chose', m: 'Four groups: deepest 10%, top 25%, upper half, lower half. The model ranks cards $25+ with six PriceCharting sales in their last 12 months; the deeper the dip, the more often the price came back up.', e: '94th · deepest 10%.'},
  rfc_bb: {t: 'Best to Buy', f: 'the card’s place in the buy order: Chance (to the whole percent), then the deeper dip, then the higher price', m: 'Exactly the order the money goes in, so the green rows are the top places the capital reaches. It ignores the filters, the capital, the share, the copies, the bar and the gate; it follows the hold and the % under.', e: '1: the card the plan spends on first.'},
  rfc_bc: {t: 'Best Chance', f: 'the card’s place by Chance alone; cards with the same chance share it ("=")', m: 'Shows how many cards the model sees as equally good: every card in a rank group gets the same chance at a given hold and % under, so ties are common.', e: '1=: shared by every card at the top chance.'},
  rfc_qty: {t: 'QTY', f: 'how many copies the plan buys', m: 'Best chance first among the rows on view, only at or above your bar, never more than the copies per card or the per-card share, until the capital runs out; nothing while the gate is red.', e: '1 on the first ten rows of a $1,000 plan.'},
  rfc_net: {t: 'Net', f: 'expected net per copy: PriceCharting’s raw price x ((1 + the group’s average return) x (1 - eBay’s fee) - (1 - % under))', m: 'The average outcome of the group over the hold, after eBay’s fee, the shipping and what you paid. An average: the typical card moves less, a few move a lot - the summary’s range shows the spread.', e: '$120, average return +9% over 3 months, 14.1% under: +$9.48.'},
  rfc_roi: {t: 'ROI %', f: 'Net / Buy price, over the hold', m: 'What the money spent on the card earns over the hold.', e: '+$9.48 on $97.88: +9.7%.'},
  rfc_trend: {t: 'Trend', f: 'opens PriceCharting’s price history of the card', m: 'The same chart as the PriceCharting tab’s Trend button.', e: ''},
  rfc_hits: {t: 'Only Hits', f: 'on = only the green rows: the cards the plan buys', m: 'The plan is still worked out on every row the other filters and the boxes leave, best chance first; Only Hits then lists just its buys. The number on the button is the green rows at these settings. Its own setting, apart from the graded side’s.', e: '$1,000 at 14.1% under: Only Hits lists the cards the plan buys.'},
  rfc_rec: {t: 'Recording (raw cards)', f: 'comes with the raw card scanner', m: 'Brett, 2026-11-17: "we\'ll hold off for that for now until the scanner gets built for the raw cards". When it exists, the raw cards you scan at a show will be listed here in buy order with your Yes / No, like graded Recording.', e: ''},
  rfc_pur: {t: 'Purchases (raw cards)', f: 'the raw cards you buy, at what you paid - empty until the raw card scanner and Recording exist', m: 'Purchases replaced the old raw Planning (the eBay listings you added with +) on 2026-11-17. That basket is kept in this browser, not deleted.', e: ''},
  rfh_wins: {t: 'History’s three windows (raw)', f: 'Forecasting Replay · Recorded Purchases · Pre-Sales Spotcheck', m: 'Forecasting Replay is the raw History as it was: the plan run on every month since 2022 with only what was known then, and the live plans the collector archives on the first day of each month. Recorded Purchases and Pre-Sales Spotcheck come with the raw card scanner, like the graded side’s.', e: ''},
  rfc_regime: {t: 'The market now (raw)', md: 1, m: [
    '> Is the raw market rising or falling right now? The answer decides whether the plan may buy at all, and which history every Chance is read from.',
    '## How it’s worked out',
    '1. **Each card’s move last month** on PriceCharting, for the cards the model follows.',
    '2. **The typical move** of the month, and the share of cards that rose (“% of cards up”).',
    '3. **Smooth over three months:** `3-month figure = (month 1 + month 2 + month 3) ÷ 3`',
    '4. **Make the call.** Above 0 = rising; 0 or below = falling.',
    '- **Green:** rising, and last month was up.',
    '- **Amber:** rising, but last month was down. The plan still buys.',
    '- **Red:** falling. With “Buy only when the market is rising” on, nothing is bought.',
    '## The table',
    'What the deepest-dip cards (the top 10% of the Rank) did in today’s kind of market, for holds of 1, 3 and 6 months, 2022 on: the median move, how often the price rose, and how often one bought at your % under made a profit after eBay’s fee (the shipping cancels out).'].join('\n'),
    now: () => { const D = rfcD(); if (!D) return ''; const R = D.regime || {}, up = rfcUp(D), light = !up ? '<b class="down">red: falling</b>' : R.confirm ? '<b class="up">green: rising</b>' : '<b style="color:#d97706">amber: rising, last month down</b>';
      return fcgNowPct(R.reg3) + ' a month over the last three months · last month ' + fcgNowPct(R.reg1) + (R.breadth3 != null ? ' · ' + Math.round(R.breadth3 * 100) + '% of cards up' : '') + ' → ' + light; }},
  rfc_chance: {t: 'Chance (this card)', md: 1, m: [
    '> How often cards like this one made money in the past: the same rank group, the same kind of market, held as long as your Hold, bought at your % under.',
    '## How it’s worked out',
    '1. **Its rank group today:** how far its PriceCharting price sits below its own 12-month mean, among every ranked card, in four groups (see Rank).',
    '2. **Pick the history:** every case since 2022 of that group, in today’s kind of market (rising or falling), held exactly your Hold.',
    '3. **The break-even return** at your % under:',
    '   `break-even = (1 − % under) ÷ (1 − 14.1% fee) − 1`',
    '4. **Chance = the share of those cases that beat the break-even,** read off the history’s percentiles with a straight line between the two nearest. At most 95%.',
    '## What the break-even means',
    '| You buy at | The price must move at least |',
    '|---|---|',
    '| 0% under | +16.4% |',
    '| 14.1% under | 0%: it just can’t fall |',
    '| 20% under | −6.9%: it can fall a little |',
    '## Keep in mind',
    '- Every card in the same group, at the same % under, gets the same chance: the model knows nothing about the card beyond its group. Best Chance shows the ties.',
    '- The money is PriceCharting’s raw price: bought under it, sold at it moved by the group’s return.'].join('\n'),
    now: () => { const D = rfcD(), I = rfcInputs(), fee = fcgFee(); if (!D) return '';
      const be = fcgBreak(I.disc, fee), out = [];
      for (const g of ['top10', 'b90', 'b75', 'b50']) { const t = fcgTab(D, I.h, g); if (t) out.push(FC_BUCKET_WORDS[g] + ' <b>' + Math.round(Math.min(FC_P_CAP, 1 - fcgCdf(D, t, be)) * 100) + '%</b>'); }
      return 'at a ' + I.h + '-month hold, ' + fcgDiscWord(I.disc) + ' under, ' + (rfcUp(D) ? 'rising' : 'falling') + ' market: ' + out.join(' · '); }},
  rfc_conf: {t: 'Buy only cards with a chance of at least …', md: 1, m: [
    '> The bar: a card gets money only when its Chance (this card) is at least this. Cards under it stay listed, in order, but aren’t green.',
    '## How the plan spends',
    '1. **Order the cards on view** best to buy first: Chance (to the whole percent), then the deeper dip, then the higher price. That order is the Best to Buy column.',
    '2. **Skip what doesn’t qualify:** a Chance under the bar, or no buy price.',
    '3. **Decide the copies** of each one that does: the smallest of',
    '   `(capital × per-card share) ÷ buy price`',
    '   `copies per card`',
    '   `money left ÷ buy price`',
    '4. **The gate comes first:** in a falling market with “Buy only when the market is rising” on, nothing is bought, whatever the bar.'].join('\n'),
    now: () => { const I = rfcInputs(); return 'bar <b>' + Math.round(I.minp * 100) + '%</b> · ' + Number(RFC.elig || 0).toLocaleString('en-US') + ' card' + (RFC.elig === 1 ? '' : 's') + ' on view clear it' + (RFC.gated ? ', but the gate is red: nothing is bought' : '; the plan buys ' + (RFC.picks || []).length); }},
  rfc_mc: {t: 'Chance the plan profits', md: 1, m: [
    '> The chance that the green cards together end your Hold with more money than they cost, after eBay’s fee and the shipping.',
    '## How it’s worked out',
    '1. **Simulate 2,000 possible futures.** In each: one “market luck” number shared by every card, plus one “own luck” number per card, mixed half and half:',
    '   `luck = √0.5 × market + √0.5 × own`',
    '   The luck becomes a percentile, and the card’s return is read at that percentile from its own history (its group, the market, your Hold).',
    '2. **Add up the net in that future:**',
    '   `net = Σ copies × price × [(1 + return) × (1 − fee) − (1 − % under)]`',
    '3. **Read the 2,000 results:** the share above $0 (at most 95%) is this chance; their average is the expected net; the 10th to the 90th percentile the likely range.',
    '## What it means',
    'The mix makes cards rise and fall together, like a real market: when it sours most picks lose at once. So more cards raise this chance only up to a point.'].join('\n'),
    now: () => { const mc = RFC.mc, n = (RFC.picks || []).length; if (!mc) return 'no cards bought at these settings'; return n + ' card' + (n === 1 ? '' : 's') + ': chance <b>' + Math.round(mc.p * 100) + '%</b> · expected ' + fcMoney(mc.mean) + ' · likely ' + fcMoney(mc.lo) + ' to ' + fcMoney(mc.hi); }}
});
