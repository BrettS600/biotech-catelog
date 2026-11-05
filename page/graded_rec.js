/* ---------------- The Forecast tab: Graded cards > Recording and Planning (2026-11-04, Brett) ----------------
   Recording: "when I go into a card show, I collect all of the bar codes from graded cards, and all of those listings go
   here. All of them" - one row per slab, the Forecasting page's columns plus Rank, a % Under box of its own (Brett: "even
   though i set it to 14.1%, a vendor may sell for some as low 20%") and Purchased: Yes (bought at the row's buy price:
   the money comes off the capital, the slab goes to Planning), No ("i will reject is the vendor sells above the buy
   price": greyed, it gets no money, so the next-best rows turn green), neither (still open). Green: "what i should buy
   depending capital" - the capital less what the Yes rows cost, best chance first among the open rows on view, under the
   per-card share and the copies per card, nothing while the gate is red. The scanning and the cert lookup come later
   ("we will get to that later"); until then 50 sample rows, 5 of them bought (Brett: "randomly choose some like 50
   listings to go in recorded and 5 of the 50 to go into planened"), with Remove samples. (The + and the Looking for list went on
   2026-11-05.)
   Planning: "it basically just show the same things as the graded recorded. But in this case, it will only show the
   listing that I marked as purchased" - each at what was paid and the % under it was paid at; Record plan (Planning
   only) keeps the plan, with the settings of the moment, on History, Graded cards (through the collector, so
   it follows from laptop to phone).
   One plan pane and one set of filter buttons for Forecasting, Recording and Planning ("When I change a filter or
   button setting in graded forcasting then those same changes automatically show in graded planning, and vice versa"),
   apart from the PriceCharting tab's and the raw side's; the pane's % under is Forecasting's own, Recording's starting
   % for new rows, and not on Planning. The records are kept in this browser for now (the scanning will bring them in). */
const FCR = {recs: grLS('fcg-rec', null), map: null, mapSrc: null, rows: {rc: [], pl: []}, res: {}, echo: grLS('fcg-gplan-echo', []), gone: new Set(grLS('fcg-gplan-gone', []))};
// a record: {id, c (card id), gk (grade key), d (% under, a fraction), pur (null open / 1 Yes / 0 No), smp (1: a sample),
// t (when recorded) and, once Yes, what it was bought at: std / stdc (the PC / CL standard price then), ship, paid, pt}
function fcrSave() { grSave('fcg-rec', FCR.recs || []); fcrCounts(); }
function fcrCounts() {
  const recs = FCR.recs || [];
  $('nrc').textContent = String(recs.length);
  $('npl-g').textContent = String(recs.filter(x => x.pur === 1).length);
}
function fcrMap() {
  if (FCR.mapSrc !== GR.rows) { FCR.map = new Map(GR.rows.map(r => [r[0] + '|' + r[50], r])); FCR.mapSrc = GR.rows; }
  return FCR.map;
}
const fcrRec = id => (FCR.recs || []).find(x => x.id === id);
// a record's row: the graded row of its card and grade, worked out at the record's own % under (a bought slab at what it
// was bought at: its standard prices and shipping of that moment)
function fcrBuild(rec, D, I, fee) {
  const base = fcrMap().get(rec.c + '|' + rec.gk); if (!base) return null;
  const r = base.slice(); r.rec = rec;
  let pc, cl, ship;
  if (rec.pur === 1 && rec.std !== undefined) { pc = rec.std; cl = rec.stdc; ship = rec.ship; } else { [pc, cl] = fcgStd(base); ship = I.ship; }
  fcgCalc(r, pc, cl, rec.d, ship, D, I, fee);
  r.fcShip = ship; r.fcU = rec.pur == null ? null : rec.pur; r.fcQ = rec.pur === 1 ? 1 : 0;
  return r;
}
function fcrRows(kind) {
  if (!GR.doc) return [];
  const D = fcgDoc(), I = fcgInputs(), fee = fcgFee(), out = [];
  for (const rec of FCR.recs || []) { if (kind === 'pl' && rec.pur !== 1) continue; const r = fcrBuild(rec, D, I, fee); if (r) out.push(r); }
  out.sort(fcgOrder);
  FCR.rows[kind] = out; FCR.band = [I.pmin, I.pmax];
  return out;
}
// the pane's "Card price between" on Recording and Planning (2026-11-05 control test: it listed every slab whatever the
// band): like Forecasting, a slab whose standard price (PriceCharting's, else Card Ladder's; a bought one's at the moment
// it was bought) is outside the band is not listed. Its money stays spent: the capital left counts every Yes.
const fcrInBand = r => { const b = r.fcS != null ? r.fcS : r.fcSc, B = FCR.band || [0, Infinity]; return b != null && b >= B[0] && b <= B[1]; };
// green: the capital less what the Yes rows cost, best chance first among the open rows on view. The expected figures are
// the slabs on view: the bought ones the filters leave, and the green (2026-11-05: they followed only the green before)
function fcrAllocate(view) {
  const I = fcgInputs(), D = fcgDoc(), all = FCR.rows.rc, onView = new Set(view);
  const gated = !!(D && I.gate && !(D.regime && D.regime.up));
  const bought = all.filter(r => r.rec.pur === 1), used = new Map();
  const spent = bought.reduce((s, r) => s + (r.fcB || 0), 0);
  let left = I.cap - spent;
  all.forEach(r => { r.fcQ = r.rec.pur === 1 ? 1 : 0; });
  bought.forEach(r => { const k = r[0] + '|' + r[50]; used.set(k, (used.get(k) || 0) + 1); });
  const elig = view.filter(r => r.rec.pur == null && r.fcP != null && r.fcP / 100 >= I.minp && r.fcB > 0).sort(fcgOrder);
  if (!gated) for (const r of elig) {
    const k = r[0] + '|' + r[50];
    if ((used.get(k) || 0) >= I.copies || r.fcB > I.cap * I.share || r.fcB > left) continue;
    r.fcQ = 1; left -= r.fcB; used.set(k, (used.get(k) || 0) + 1);
  }
  const green = elig.filter(r => r.fcQ > 0), boughtV = bought.filter(r => onView.has(r)), spentV = boughtV.reduce((s, r) => s + (r.fcB || 0), 0);
  return {I, gated, spent, left, bought, boughtV, spentV, green, elig: elig.length, open: all.filter(r => r.rec.pur == null).length, no: all.filter(r => r.rec.pur === 0).length,
          mc: D && (boughtV.length || green.length) ? fcgMonteCarlo(D, boughtV.concat(green), I, fcgFee()) : null};
}
// Planning: the money is every bought slab's (the capital left); the expected figures are the slabs on view (2026-11-05:
// the filters changed the list but not the figures)
function fcpFigures(view) {
  const I = fcgInputs(), D = fcgDoc(), rows = FCR.rows.pl;
  rows.forEach(r => { r.fcQ = 1; });
  const spent = rows.reduce((s, r) => s + (r.fcB || 0), 0), spentV = view.reduce((s, r) => s + (r.fcB || 0), 0), scored = view.filter(r => r.fcT);
  return {I, spent, spentV, left: I.cap - spent, rows, view, scored: scored.length, mc: D && scored.length ? fcgMonteCarlo(D, view, I, fcgFee()) : null};
}
const fcrStat = (k, v, d) => '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>';
function fcrStats(mc, spent, I, what, left) {
  return '<div class="stats fc-stats">' +
    fcrStat('Expected net profit', mc ? fcMoney(mc.mean) + (spent > 0 ? ' <span class="fc-roi ' + (mc.mean < 0 ? 'down' : 'up') + '">' + fcgPct(mc.mean / spent) + '</span>' : '') : '-', 'average of ' + what + ', after fees and shipping') +
    fcrStat('Likely range', mc ? fcMoney(mc.lo) + ' to ' + fcMoney(mc.hi) : '-', '10th to 90th percentile' + (mc ? '; median ' + fcMoney(mc.med) : '')) +
    fcrStat('Chance of a profit', mc ? (mc.p * 100).toFixed(0) + '%' : '-', 'P(net &gt; 0), held ' + I.h + ' month' + (I.h > 1 ? 's' : '')) +
    fcrStat('Capital left', fmtMoneyPlain(Math.max(0, left[0])), left[1]) + '</div>';
}
function fcrSummary(A) {
  const box = $('fcr-summary'); if (!box) return;
  if (!GR.doc) { box.innerHTML = GR.err ? '<span class="warn">' + esc(GR.err) + '</span>' : 'Loading the graded data…'; return; }
  const recs = FCR.recs || [], nsmp = recs.filter(x => x.smp).length, I = A.I, D = fcgDoc(), cost = A.green.reduce((s, r) => s + r.fcB, 0);
  let s = '';
  if (!recs.length) s = '<p><b>No slabs recorded yet.</b> At a show, the slabs you scan come here (the scanning comes next); the star on Forecasting marks the cards you are after.</p>';
  else if (A.gated) s = '<p><b>Nothing to buy: the graded market is falling</b> and “Buy only when the market is rising” is on (the plan pane). ' + A.elig + ' open slab' + (A.elig === 1 ? '' : 's') + ' would clear your bar anyway.</p>';
  else s = '<p>' + (A.bought.length ? 'Bought <b>' + A.bought.length + ' slab' + (A.bought.length > 1 ? 's' : '') + '</b> for <b>' + fmtMoneyPlain(A.spent) + '</b> (Yes); ' : '') + '<b>' + fmtMoneyPlain(Math.max(0, I.cap - A.spent)) + '</b> of ' + fmtMoneyPlain(I.cap) + ' left. ' +
    (A.green.length ? 'Buy next: the <b>' + A.green.length + ' green slab' + (A.green.length > 1 ? 's' : '') + '</b> for ' + fmtMoneyPlain(cost) + ' - best chance first among the open rows on view, each at its own % under. ' : A.elig ? 'No open slab fits the money left. ' : 'No open slab clears your bar (' + Math.round(I.minp * 100) + '% chance, ' + I.h + '-month hold). ') +
    'A No (the vendor wants more than the buy price) frees its money for the next row.' +
    (A.boughtV.length < A.bought.length ? ' <span class="dim">The figures below count the ' + A.boughtV.length + ' bought slab' + (A.boughtV.length === 1 ? '' : 's') + ' the filters leave on view, and the green ones.</span>' : '') + '</p>';
  s += fcrStats(A.mc, A.spentV + cost, I, 'the bought and the green slabs on view', [I.cap - A.spent, fmtMoneyPlain(A.spent) + ' spent on the slabs marked Yes' + (A.green.length ? '; the green ones take ' + fmtMoneyPlain(cost) + ' of it' : '')]);
  if (!nsmp) s += '<div class="fcr-tools"><button type="button" class="actbtn" id="fcr-smpback" title="50 sample slabs again, 5 of them bought (the slabs you recorded stay)">Bring the samples back</button></div>';
  if (nsmp) s += '<div class="fcr-tools"><button type="button" class="actbtn" id="fcr-nosmp" title="Take the sample rows away (Planning loses its sample purchases too)">Remove samples (' + nsmp + ')</button><span class="dim">' + nsmp + ' of the rows are samples - real slabs, picked at random, ' + recs.filter(x => x.smp && x.pur === 1).length + ' marked bought - until scanning brings in the slabs you record.</span></div>';
  if (!D) s += '<p class="dim">The graded model is not in this build of the graded data yet: the rows have their prices, not their chances.</p>';
  box.innerHTML = s;
}
function fcpSummary(F) {
  const box = $('fcp-summary'); if (!box) return;
  if (!GR.doc) { box.innerHTML = GR.err ? '<span class="warn">' + esc(GR.err) + '</span>' : 'Loading the graded data…'; return; }
  const n = F.rows.length, I = F.I, nsmp = F.rows.filter(r => r.rec.smp).length;
  let s = !n ? '<p><b>Nothing bought yet.</b> Mark a slab <b>Yes</b> on Recording and it comes here, at what you paid.</p>'
    : '<p>You bought <b>' + n + ' slab' + (n > 1 ? 's' : '') + '</b> for <b>' + fmtMoneyPlain(F.spent) + '</b>' + (I.cap ? ' (' + fmtMoneyPlain(Math.max(0, F.left)) + ' of ' + fmtMoneyPlain(I.cap) + ' left)' : '') + '. Held ' + I.h + ' month' + (I.h > 1 ? 's' : '') + ' and sold on eBay at PriceCharting’s price then' + (F.scored < n ? '; ' + (n - F.scored) + ' of them have no score, so they are in the money spent but not in the expected figures' : '') + '. <b>Record plan</b> (the plan pane) keeps it on History.' + (nsmp ? ' <span class="dim">' + nsmp + ' are sample purchases (Recording’s Remove samples takes them away).</span>' : '') +
    (F.view.length < n ? ' <span class="dim">The figures below are the ' + F.view.length + ' the filters leave on view (' + fmtMoneyPlain(F.spentV) + ' of it); the capital left counts all ' + n + '.</span>' : '') + '</p>';
  s += fcrStats(F.mc, F.spentV, I, F.view.length < n ? 'the bought slabs on view' : 'the slabs you bought', [F.left, fmtMoneyPlain(F.spent) + ' of ' + fmtMoneyPlain(I.cap) + ' spent']);
  box.innerHTML = s;
}
// the cells: Forecasting's, plus Rank, % Under, Purchased (Planning: % Under Paid and Price Paid in the same places)
function fcrRankCell(r) {
  if (r.fcPct == null) return '<td class="num"><span class="dim" title="No rank for this line today">-</span></td>';
  const p = Math.round(r.fcPct * 100), grp = r.fcG === 9 ? 'deepest 10%' : 'group ' + (10 - r.fcG) + ' of 10';
  return '<td class="num" title="' + esc('How far this grade’s PriceCharting price sits below its own 12-month mean, against every graded line $25+: the ' + fcOrd(p) + ' percentile (100th = furthest below); ' + grp + ' (1 = deepest)') + '">' + fcOrd(p) + '<br><span class="dim">' + grp + '</span></td>';
}
function fcrRow(r, pl) {
  const x = fcgCells(r, Object.assign({}, fcgInputs(), {ship: r.fcShip})), rec = r.rec, id = esc(rec.id), pur = rec.pur;
  const dv = Math.round((rec.d || 0) * 1000) / 10;
  const dCell = '<td class="num"><input type="number" class="fcr-d" data-id="' + id + '" min="0" max="60" step="0.1" value="' + dv + '" title="' + esc(pl ? 'The % under the standard price you paid. Change it and the price paid follows.' : 'What the vendor will take: % under the standard price. The buy price, chance, net and the green rows follow.') + '"></td>';
  const puCell = '<td><span class="fcr-pu"><button type="button" class="yes' + (pur === 1 ? ' on' : '') + '" data-id="' + id + '" data-v="1" title="' + (pur === 1 ? 'Bought - click to undo' : 'You bought it at its buy price: the money comes off the capital and it goes to Planning') + '">Yes</button><button type="button" class="no' + (pur === 0 ? ' on' : '') + '" data-id="' + id + '" data-v="0" title="' + (pur === 0 ? 'Not bought - click to undo' : 'The vendor wants more than the buy price: not bought, so its money goes to the next row') + '">No</button></span></td>';
  return x.flag + x.review + x.name + x.grade + fcrRankCell(r) + x.std + dCell + x.buy + x.sold + x.chance + x.qty + x.net + x.roi + puCell + fcgPcx(r).join('');
}
const fcrClass = r => (r.rec.pur === 1 ? 'fcr-yes' : r.rec.pur === 0 ? 'fcr-no' : r.fcQ ? 'fcg-buy' : grWrong(r) ? 'grwrong' : grUnsure(r) ? 'grunsure' : '') + (r.rec.smp ? ' fcr-smp' : '');
function fcrRedraw(t, id) {                               // the QTY column and the green follow the plan: draw the rows again
  if (t.sortKey === 'fcQ') t.view.sort((a, b) => (a.fcQ - b.fcQ) * t.sortDir);
  const n = t.shown; $('rows-' + id).innerHTML = ''; t.shown = 0; t.renderMore(Math.max(PAGE, n));
}
const FCR_CFG = (id, kind) => ({rows: () => fcrRows(kind), noun: kind === 'pl' ? 'bought slabs' : 'recorded slabs', ranges: FCG_RANGES, labels: FCG_LABELS, defaults: {}, root: '#' + id + '-main', onCols: h => fcgColsTake(id, h), inserted: {v: 'noplus', at: 2, n: -1},
  name: kind === 'pl' ? 'Forecast · graded planning' : 'Forecast · graded recording',
  fav: {s: 'pc', k: r => r[0], c: r => r[0]}, key: r => r.rec.id,
  extra: r => fcrInBand(r) && grPass(r, GF.fc), rowClass: fcrClass,
  hay: r => [r[1], r[2], r[3], r[25], r[29], r[30], r[53], r[54]].filter(Boolean).join(' '),
  row: r => fcrRow(r, kind === 'pl'),
  after: t => {
    if (kind === 'pl') { FCR.res.pl = fcpFigures(t.view); fcpSummary(FCR.res.pl); }
    else { FCR.res.rc = fcrAllocate(t.view); fcgHitsView(t, 'fcr', FCR.rows.rc.length, 'recorded slabs', r => r.fcQ > 0 && r.rec.pur == null, FCR.res.rc.green.length); fcrRedraw(t, id); fcrSummary(FCR.res.rc); }
  }});
fcgAddPcHeads('#fcr-main', 'fcr'); fcgAddPcHeads('#fcp-main', 'fcp');   // the PriceCharting tab's graded columns, off at first (graded_fc.js)
tables.fcr = makeTable('fcr', FCR_CFG('fcr', 'rc'));
tables.fcp = makeTable('fcp', FCR_CFG('fcp', 'pl'));
fcgColsApply('fcr'); fcgColsApply('fcp');
function fcrApplyAll() {                                  // whatever changed (a box, a Yes, a filter): the page showing is drawn again
  if (!GR.doc || NAV.fc !== 'graded') return;
  const m = fcgMode();
  if (m === 'rc') tables.fcr.apply(true); else if (m === 'pl') tables.fcp.apply(true);
  fcrCounts();
}
// the samples (until scanning): 50 real rows of the Forecasting list at random, 5 of them bought at 14.1% - 20% under
function fcrEnsureSamples() {
  if (FCR.recs !== null || !GR.doc || !fcgDoc()) return;
  const I = fcgInputs(), pool = fcgRows().filter(r => r.fcP != null && r.fcB > 0 && r.fcS != null && r.fcB <= Math.max(50, I.cap * I.share));   // slabs the plan could buy
  if (pool.length < 60) return;
  const pick = new Set(); while (pick.size < 50) pick.add(Math.floor(Math.random() * pool.length));
  const now = Date.now(), d0 = (+FCG_IN.rdisc || 14.1) / 100;
  const recs = [...pick].map((i, j) => ({id: 's' + now.toString(36) + j, c: pool[i][0], gk: pool[i][50], d: d0, pur: null, smp: 1, t: now, b: pool[i].fcB}));
  const ten = new Set(); while (ten.size < 10) ten.add(Math.floor(Math.random() * recs.length));
  const yes = [...ten].sort((a, b) => recs[a].b - recs[b].b).slice(0, 5);   // five of ten at random, the cheaper half: the capital keeps room for green rows
  recs.forEach(x => { delete x.b; });
  const ds = [0.141, 0.15, 0.17, 0.2, 0.2];
  yes.forEach((i, j) => { const rec = recs[i], base = fcrMap().get(rec.c + '|' + rec.gk), [pc, cl] = fcgStd(base); rec.d = ds[j];
    Object.assign(rec, {pur: 1, std: pc, stdc: cl, ship: I.ship, paid: r2(fcgBuy(pc, rec.d, I.ship)), pt: now}); });
  FCR.recs = recs; fcrSave();
}
// Yes / No, and the row's % under
function fcrSetPur(id, v) {
  const rec = fcrRec(id); if (!rec) return;
  const nv = rec.pur === v ? null : v;                  // the lit button again: open once more
  rec.pur = nv;
  if (nv === 1) {
    const base = fcrMap().get(rec.c + '|' + rec.gk), I = fcgInputs(), [pc, cl] = base ? fcgStd(base) : [null, null];
    Object.assign(rec, {std: pc, stdc: cl, ship: I.ship, paid: r2(fcgBuy(pc != null ? pc : cl, rec.d, I.ship)), pt: Date.now()});
  } else { delete rec.std; delete rec.stdc; delete rec.ship; delete rec.paid; delete rec.pt; }
  fcrSave(); fcrApplyAll();
}
function fcrSetD(id, pct) {
  const rec = fcrRec(id); if (!rec || isNaN(pct)) return;
  rec.d = Math.round(Math.min(60, Math.max(0, pct)) * 10) / 1000;
  if (rec.pur === 1 && rec.std !== undefined) rec.paid = r2(fcgBuy(rec.std != null ? rec.std : rec.stdc, rec.d, rec.ship));
  fcrSave(); fcrApplyAll();
}
for (const id of ['fcr', 'fcp']) {
  const tb = $('rows-' + id);
  tb.addEventListener('click', e => {
    const fl = e.target.closest('.gflag'); if (fl) { grFlagPop(fl); return; }
    const rv = e.target.closest('.grvb'); if (rv) { grOpenReview(rv.dataset.k); return; }
    const gt = e.target.closest('.gtbtn'); if (gt) { grOpenTrend(gt.dataset.k); return; }   // PSA Trend (the PriceCharting columns)
    const pu = e.target.closest('.fcr-pu button'); if (pu) { fcrSetPur(pu.dataset.id, +pu.dataset.v); return; }
  });
  tb.addEventListener('change', e => { const i = e.target.closest('input.fcr-d'); if (i) fcrSetD(i.dataset.id, parseFloat(i.value)); });
  tb.addEventListener('keydown', e => { const i = e.target.closest('input.fcr-d'); if (i && e.key === 'Enter') i.blur(); });
  document.querySelector('#' + id + '-main .wrap').addEventListener('scroll', e => {
    const w = e.currentTarget, t = tables[id];
    if (t && !$('more-' + id).hidden && w.scrollTop + w.clientHeight > w.scrollHeight - 600) t.renderMore();
  }, {passive: true});
}
$('fcr-main').addEventListener('click', e => {
  if (e.target.closest('#fcr-nosmp')) { FCR.recs = (FCR.recs || []).filter(x => !x.smp); fcrSave(); fcrApplyAll(); return; }
  if (e.target.closest('#fcr-smpback')) {                // 2026-11-04, Brett: "i accisdently remove the samples. please put them back"
    const kept = (FCR.recs || []).filter(x => !x.smp); FCR.recs = null; fcrEnsureSamples();
    if (FCR.recs) { FCR.recs.forEach(x => { if (x.smp && x.pur !== 1) x.d = 0.141; }); FCR.recs = kept.concat(FCR.recs); } else FCR.recs = kept;
    fcrSave(); fcrApplyAll(); return;
  }
});
// the shared filters: the search, the set and the filter chips of the three tables follow each other
const FCG_TABS = ['fcg', 'fcr', 'fcp'];
function fcgSyncFrom(src) {
  const ids = ['q', 'set'].concat(FCG_RANGES.flatMap(k => ['min' + k, 'max' + k]));
  for (const dst of FCG_TABS) if (dst !== src) for (const b of ids) { const a = $(b + '-' + src), z = $(b + '-' + dst); if (a && z && z.value !== a.value) z.value = a.value; }
}
for (const id of FCG_TABS) {
  ['q-' + id, 'set-' + id, 'ranges-' + id].forEach(x => { const el = $(x); if (!el) return; el.addEventListener('input', () => fcgSyncFrom(id)); el.addEventListener('change', () => fcgSyncFrom(id)); });
  $('reset-' + id).addEventListener('click', () => setTimeout(() => fcgSyncFrom(id), 0));
}
// a flag or a Review answer redraws these pages too
{ const gm = grMark; grMark = async function () { const out = await gm.apply(this, arguments); fcrApplyAll(); return out; }; }
{ const gc = grMarkCard; grMarkCard = async function () { const out = await gc.apply(this, arguments); fcrApplyAll(); return out; }; }
// shown on Graded > Recording or Planning: the samples, the table, the list
function fcrShowData() {
  if (!GR.doc) return;
  fcrEnsureSamples();
  const m = fcgMode(), id = m === 'pl' ? 'fcp' : 'fcr';
  if (m !== 'rc' && m !== 'pl') return;
  tables[id].resync(); fcgColsApply(id); tables[id].apply(true);
  fcrCounts();
}
function fcrShowNow() {                                  // before the data: the summaries say what they wait for
  const m = fcgMode();
  if (m === 'rc' && !GR.doc) fcrSummary({I: fcgInputs(), green: [], bought: []}); else if (m === 'pl' && !GR.doc) fcpSummary({rows: [], I: fcgInputs()});
}
{ const fs = fcgShow; fcgShow = function () { fs.apply(this, arguments); if (!$('p-fc').hidden && NAV.fc === 'graded') fcrShowNow(); }; }

/* ---- Record plan (Planning only): the bought slabs and the settings, to the collector in parts of 20 slabs (the channel
   carries about 4 KB a message); shown here at once, confirmed by the live file ---- */
const FCP_PART = 20;
async function fcpRecord() {
  const st = $('fcp-status'), D = fcgDoc(), I = fcgInputs(), fee = fcgFee();
  const rows = GR.doc ? fcrRows('pl').slice() : [];
  const say = (txt, cls) => { st.textContent = txt; st.className = 'al-status ' + (cls || ''); };
  if (!rows.length) return say('Nothing to record: no slab is marked Yes on Recording.', 'warn');
  if (!HKEY) return say('This page has no key for the collector.', 'warn');
  rows.forEach(r => { r.fcQ = 1; });
  const holds = [1, 2, 3, 4, 5, 6].map(h => { const mc = D ? fcgMonteCarlo(D, rows, I, fee, 2000, r => fcgTab(D, h, r.fcG)) : null; return mc ? [r2(mc.mean), r2(mc.lo), r2(mc.hi), Math.round(mc.p * 1000) / 1000] : null; });
  const slabs = rows.map(r => [r[0], r[50], Math.round(r.fcD * 1000), r2(r.fcS), r2(r.fcSc), r2(r.fcB), r.fcP == null ? null : Math.round(r.fcP * 10), r2(r.fcN), r.fcPct == null ? null : Math.round(r.fcPct * 1000)]);
  const spent = r2(rows.reduce((s, r) => s + (r.fcB || 0), 0)), id = nextT(), n = Math.max(1, Math.ceil(slabs.length / FCP_PART));
  const head = {h: I.h, cap: I.cap, disc: Math.round(((+FCG_IN.rdisc || 14.1) / 100) * 10000) / 10000, ship: I.ship, fee, month: D ? D.month : '', reg: D && D.regime ? (D.regime.up ? 'up' : 'down') : '', spent, model: D ? D.model : '', smp: rows.some(r => r.rec.smp) ? 1 : 0, holds};
  say('Sending…');
  try {
    for (let k = 0; k < n; k++) await alSend(Object.assign({type: 'gplan', t: k ? nextT() : id, id, k, n, s: slabs.slice(k * FCP_PART, (k + 1) * FCP_PART)}, k ? {} : head));
  } catch (e) { return say('Could not reach the collector’s channel (' + e.message + '). Nothing was recorded.', 'warn'); }
  FCR.echo = FCR.echo.filter(x => Date.now() - x.t < 2 * 86400000).concat([Object.assign({id, t: id, slabs, local: 1}, head)]); grSave('fcg-gplan-echo', FCR.echo);
  say('Recorded: ' + rows.length + ' slab' + (rows.length > 1 ? 's' : '') + ', ' + fmtMoneyPlain(spent) + ', held ' + I.h + ' month' + (I.h > 1 ? 's' : '') + '. It is on the History button (Graded cards); the collector confirms it in a minute or two.', 'ok');
  if (typeof fhgRender === 'function') fhgRender();
}
$('fcp-record').addEventListener('click', fcpRecord);
fcrCounts();

/* ---- the help behind the new ? buttons ---- */
Object.assign(HELP, {
  fcr_picks: {t: 'What to buy (Recording)', f: 'every slab you recorded at the show, one row each, best chance first; green = buy it', m: 'The green rows are what the capital still buys: the capital less what the Yes rows cost, best chance first among the open rows on view, at most the per-card share each and the copies per card, nothing while the gate is red - each at its own % under. A Yes takes its buy price off the capital; a No (the vendor wants more) gives its money to the next row. The filter buttons, Filters… and the boxes of the plan pane are shared with Forecasting and Planning. Until scanning brings the slabs in, 50 sample rows show how it works (Remove samples takes them away).', e: '$1,000, three slabs marked Yes for $420: the green rows share the $580 left.'},
  fcr_rank: {t: 'Rank', f: 'how far the grade’s PriceCharting price sits below its own 12-month mean, as a percentile among every graded line $25+', m: 'The model’s signal: the deeper below its own mean, the higher the rank (100th = furthest below). Ten groups; the chance is the group’s. The raw tab’s Rank, for slabs.', e: '97th, deepest 10%.'},
  fcr_disc: {t: '% Under', f: 'what the vendor will take, as % under the standard price', m: 'Starts at the plan pane’s % under (14.1% by default). A vendor may go lower: type it here and the row’s Buy price, Chance, Net, ROI and the green follow. Saved with the row.', e: '20: the buy price is 20% under the standard price, less the shipping.'},
  fcr_buy: {t: 'Buy Price', f: 'standard price x (1 - the row’s % under) - eBay Shipping Fee, for each side', m: 'The most to pay the vendor at the row’s % under. A Yes buys the slab at this price (the PriceCharting side).', e: 'PC $200 at 20% under, $5.20: $154.80.'},
  fcr_qty: {t: 'QTY', f: '1: buy this slab (the green rows); a bought slab shows 1 too', m: 'Each row is one slab, so 1 or nothing: the capital left, best chance first, the share and copies limits.', e: ''},
  fcr_net: {t: 'Net', f: 'expected net of the slab at its own % under: standard x ((1 + the group’s average return) x (1 - eBay’s fee) - (1 - % under))', m: 'After eBay’s fee, the shipping and what you pay; for both sides’ standard prices.', e: ''},
  fcr_purchased: {t: 'Purchased', f: 'Yes: you bought it; No: you did not (the vendor wanted more than the buy price); neither: still open', m: 'Yes takes the buy price off the capital and puts the slab on Planning, at what you paid. No greys the row and gives its money to the next row, so new rows may turn green. Click the lit button again to undo.', e: ''},
  fcp_picks: {t: 'What you bought (Planning)', f: 'the slabs marked Yes on Recording, at what you paid', m: 'Each at the standard prices and shipping of the moment you marked it, and the % under it was paid at (change the box and the price paid follows). The summary is the basket: what it cost and what it is expected to make over the hold in the pane (a simulation drawing each slab from its group). Record plan keeps it on History.', e: ''},
  fcp_disc: {t: '% Under Paid', f: 'the % under the standard price you paid', m: 'Kept with the slab; change it and the price paid follows.', e: ''},
  fcp_paid: {t: 'Price Paid', f: 'what you paid: standard price x (1 - % under paid) - eBay Shipping Fee', m: 'The PriceCharting side is the one counted; Card Ladder’s beside it.', e: ''},
  fcp_record: {t: 'Record plan', f: 'saves the slabs you bought, with the date, the hold and the other settings, to History (Graded cards)', m: 'Through the collector, so it is there on every device. It keeps each slab’s price paid and standard prices, and the odds of the day for all six holds; History scores each hold at PriceCharting’s price when it is up.', e: ''}
});
