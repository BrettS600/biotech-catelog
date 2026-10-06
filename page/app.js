const DATA = __DATA__;
const SETS = __SETS__;
const SET_TOTALS = __SET_TOTALS__;        // printed set sizes from the Pokemon TCG dataset, matched at build time
const GATE = __GATE__;
const PAGE = 300;
const RANGE_COLS = [5, 6, 7, 8, 9, 10, 12, 13];
const RANGE_LABEL = {5: 'Sales/yr', 6: 'Ungraded $', 7: 'Δ7d %', 8: 'Δ30d %', 9: 'Range 90d %', 10: 'Vol. drift %', 12: 'Volatility %', 13: 'Slope %/mo'};
const setIndex = new Map(SETS.map((s, i) => [s, i]));
const ORD = DATA.length ? DATA[0].length : 0;          // index of the release-order key
DATA.forEach((r, i) => r.push(i));
const $ = id => document.getElementById(id);

const dash = '<span class="dim">—</span>';
const fmtMoney = v => v == null ? dash : '$' + v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtInt = v => v == null ? dash : v.toLocaleString('en-US');
const fmtPct = (v, signed = true, nd = 1) => v == null ? dash : '<span class="' + (signed ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '') + '">' + (signed && v > 0 ? '+' : '') + v.toFixed(nd) + '%</span>';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ---------------- Tables ----------------
   Three tables share one controller. The first four cells (Card, Set, #, Released) are the same
   everywhere; each table supplies its own rows, extra cells and numeric range filters.
   Every row's last element is its default-order index. */
const ordOf = r => r[r.length - 1];
// card numbers print as number/size ("36/123"): the size comes from the Pokemon TCG dataset (SET_TOTALS, matched at
// build time); a set that did not match uses the size the collector learned from eBay titles, which arrives with the
// live data; prefixed numbers (TG05, SV001) are shown as printed
const numCell = (num, set) => { const t = SET_TOTALS[set] || (LIVE.sets && LIVE.sets[set]); return esc(num) + (t && /^\d+[a-z]?$/.test(String(num)) ? '<span class="dim">/' + t + '</span>' : ''); };
const cells4 = r =>
  '<td><a href="https://www.pricecharting.com/game/' + r[0] + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a></td>' +
  '<td>' + esc(r[2]) + '</td><td class="num">' + numCell(r[3], r[2]) + '</td><td>' + (r[4] || dash) + '</td>';
const fmtNum = (v, nd = 1) => v == null ? dash : v.toLocaleString('en-US', {minimumFractionDigits: nd, maximumFractionDigits: nd});
const badge = (txt, cls) => '<span class="badge' + (cls ? ' ' + cls : '') + '">' + esc(txt) + '</span>';
const LIVE = {data: null, ec: [], er: [], prevT: null, sets: null};      // filled by loadLive(); prevT = the previous data's stamp; sets = printed set sizes

const TABLES = {
  pc: {rows: () => DATA, noun: 'cards', ranges: RANGE_COLS, labels: RANGE_LABEL, defaults: {},
       inserted: [{v: 3, at: 0, n: 1}],
       hay: r => r[1] + ' ' + r[2],
       row: r => cells4(r) +
      '<td class="num">' + fmtInt(r[5]) + '</td>' +
      '<td class="num">' + fmtMoney(r[6]) + '</td>' +
      '<td class="num">' + fmtPct(r[7]) + '</td>' +
      '<td class="num">' + fmtPct(r[8]) + '</td>' +
      '<td class="num">' + fmtPct(r[9], false, 0) + '</td>' +
      '<td class="num">' + (r[10] == null ? dash : '<span class="' + (r[11] > 0 ? 'up' : r[11] < 0 ? 'down' : '') + '">' + (r[11] > 0 ? '+' : '') + r[11] + ' (' + (r[10] > 0 ? '+' : '') + r[10].toFixed(1) + '%)</span>') + '</td>' +
      '<td class="num">' + fmtPct(r[12], false, 2) + '</td>' +
      '<td class="num">' + fmtPct(r[13]) + '</td>' +
      '<td><button class="tbtn" data-i="' + ordOf(r) + '">Trend</button></td>'},
  // eBay Catalog row (four bands): 0 id 1 card 2 set 3 # 4 released |
  //   Observed: 5 k 6 D 7 N 8 p1 9 p2 10 p3 11 mu 12 smed 13 s80 14 hrs 15 st |
  //   Rates: 16 lam 17 price 18 dos 19 io |
  //   Decisions: 20 A 21 L 22 sell 23 probT 24 edays 25 maxbuy 26 hot 27 liquid 28 confirm 29 checks |
  //   Trends: 30 spm 31 d7 32 d30 33 pos 34 vdp 35 vd 36 vol 37 ts | 38 net 39 A_n | 40 ord
  ec: {rows: () => LIVE.ec, noun: 'cards', ranges: [17, 5, 16, 7, 18, 12, 14, 15, 20, 22, 25, 38, 30, 32, 37],
       inserted: [{v: 3, at: 0, n: 1}],
       labels: {17: 'Price $', 5: 'Sold 30d', 16: 'λ /day', 7: 'Active', 18: 'Days supply', 12: 'Sold med $', 14: 'Hrs to sale', 15: 'Sell-thru %', 20: 'Anchor $', 22: 'Sell $', 25: 'Max buy $', 38: 'Net $', 30: 'Sales/month', 32: 'Δ30d %', 37: 'Slope %/mo'},
       defaults: {17: [50, 500]},
       hay: r => r[1] + ' ' + r[2],
       row: r => cells4(r) +
      '<td class="num">' + fmtInt(r[5]) + '</td>' +
      '<td class="num">' + fmtNum(r[6], 0) + '</td>' +
      '<td class="num">' + fmtInt(r[7]) + '</td>' +
      '<td class="num">' + fmtMoney(r[8]) + '</td><td class="num">' + fmtMoney(r[9]) + '</td><td class="num">' + fmtMoney(r[10]) + '</td>' +
      '<td class="num">' + fmtNum(r[11], 2) + '</td>' +
      '<td class="num">' + fmtMoney(r[12]) + '</td><td class="num">' + fmtMoney(r[13]) + '</td>' +
      '<td class="num">' + fmtNum(r[14], 0) + '</td>' +
      '<td class="num">' + fmtPct(r[15], false, 0) + '</td>' +
      '<td class="num">' + fmtNum(r[16], 2) + '</td>' +
      '<td class="num">' + fmtMoney(r[17]) + '</td>' +
      '<td class="num">' + fmtNum(r[18], 1) + '</td>' +
      '<td class="num">' + fmtNum(r[19], 2) + '</td>' +
      '<td class="num"' + (r[39] ? ' title="' + r[39] + ' sales behind the anchor"' : '') + '>' + fmtMoney(r[20]) + (r[20] != null && r[39] < (LIVE.data && LIVE.data.gate && LIVE.data.gate.minSales || 5) ? ' <span class="dim">thin</span>' : '') + '</td>' +
      '<td class="num">' + fmtMoney(r[21]) + '</td>' +
      '<td class="num">' + (r[22] == null ? dash : '<b>' + fmtMoney(r[22]) + '</b>') + '</td>' +
      '<td class="num">' + fmtPct(r[23], false, 0) + '</td>' +
      '<td class="num">' + fmtNum(r[24], 1) + '</td>' +
      '<td class="num">' + (r[25] == null ? dash : '<b>' + fmtMoney(r[25]) + '</b>' + (r[27] ? '' : ' <span class="dim" title="too slow for the window at this confidence">illiquid</span>')) + '</td>' +
      '<td class="num">' + fmtMoney(r[38]) + '</td>' +
      '<td>' + (r[26] === 'confirmed' ? badge('Hot ✓', 'hot2') : r[26] === 'candidate' ? badge('Hot ' + r[28] + '/3', 'hot') : r[29] && r[29].length && r[5] >= 5 ? '<span class="dim" title="' + esc(r[29].join(', ')) + '">fails ' + r[29].length + '</span>' : dash) + '</td>' +
      '<td class="num">' + fmtInt(r[30]) + '</td>' +
      '<td class="num">' + fmtPct(r[31]) + '</td>' +
      '<td class="num">' + fmtPct(r[32]) + '</td>' +
      '<td class="num">' + fmtPct(r[33], false, 0) + '</td>' +
      '<td class="num">' + (r[35] == null ? dash : '<span class="' + (r[35] > 0 ? 'up' : r[35] < 0 ? 'down' : '') + '">' + (r[35] > 0 ? '+' : '') + r[35] + (r[34] == null ? '' : ' (' + (r[34] > 0 ? '+' : '') + r[34].toFixed(1) + '%)') + '</span>') + '</td>' +
      '<td class="num">' + fmtPct(r[36], false, 2) + '</td>' +
      '<td class="num">' + fmtPct(r[37]) + '</td>' +
      '<td><button class="tbtn ebtn" data-id="' + r[0] + '">Trend</button></td>' +
      '<td><button class="tbtn bbtn" data-id="' + r[0] + '">Book</button></td>'},
  // eBay Raw Data row: 0 cardId 1 card 2 set 3 # 4 released 5 hours 6 title 7 item 8 ship 9 total 10 allin 11 cardPrice 12 vs% 13 maxbuy
  // 14 verdict 15 cond 16 bo 17 fb 18 pct 19 status 20 url 21 img 22 itemId 23 how 24 profit 25 roi 26 sell (this listing's own)
  // 27 time (h: to outcome, or open so far) 28 note (LP discount applied) 29 tier 30 risk rank 31 score 32 photos 33 signals
  // 34 first seen (ISO) 35 PriceCharting ungraded $ 36 vs PC % 37 mismatch flag ('low' / 'high')
  // 38 item-specifics check ('ok' / 'conflict' / 'none') 39 what that check found 40 ord
  rv: {rows: () => LIVE.rv || [], noun: 'cards', ranges: [], labels: {}, defaults: {},
       extra: r => PERIOD.rv ? PERIOD.rv.test(r[7] || r[4]) : true,
       hay: r => r[1] + ' ' + r[2] + ' ' + (r[18] || '') + ' ' + (r[20] || ''),
       after: () => rvSummary(),
       row: r => '<td>' + (r[19] ? '<a href="https://www.ebay.com/itm/' + esc(r[19]) + '" target="_blank" rel="noopener" title="' + esc(r[18] || '') + '">' + esc(r[1]) + '</a>' : esc(r[1])) + '</td>' +
      '<td>' + esc(String(r[2] || '').replace('Pokemon ', '')) + '</td><td class="num">' + esc(r[3] || '') + '</td>' +
      '<td>' + badge(r[17], r[17] === 'sold' ? 'pass' : r[17] === 'holding' ? 'hot' : '') + '</td>' +
      '<td>' + rvWhen(r[4]) + '</td><td class="num">' + fmtMoney(r[5]) + '</td><td class="num">' + (r[6] == null ? dash : r[6]) + '</td>' +
      '<td>' + (r[21] ? '<a href="https://www.ebay.com/itm/' + esc(r[21]) + '" target="_blank" rel="noopener" title="' + esc(r[20] || '') + '">' + rvWhen(r[7]) + '</a>' : rvWhen(r[7])) + '</td>' +
      '<td class="num">' + fmtMoney(r[8]) + '</td><td class="num">' + (r[9] == null ? dash : r[9]) + '</td><td class="num">' + (r[10] == null ? dash : r[10]) + '</td>' +
      '<td class="num">' + fmtMoney(r[11]) + '</td><td class="num">' + fmtMoney(r[12]) + '</td>' +
      '<td class="num">' + (r[13] == null ? dash : '<b class="' + (r[13] > 0 ? 'up' : r[13] < 0 ? 'down' : '') + '">' + (r[13] < 0 ? '−' : '') + fmtMoney(Math.abs(r[13])) + '</b>') + '</td>' +
      '<td class="num">' + fmtPct(r[14]) + '</td><td>' + esc(r[15] || '') + '</td><td class="num">' + fmtMoney(r[16]) + '</td>'},
  er: {rows: () => AU_ON() ? (LIVE.au || []) : LIVE.er, noun: 'listings', ranges: [24, 25], maxes: [5],
       labels: {5: 'Listed within', 24: 'Profit $', 25: 'ROI %'}, units: {5: 'h'},
       defaults: {},
       inserted: [{v: 2, at: 10, n: 2}, {v: 3, at: 0, n: 1}, {v: 4, at: 13, n: 2}, {v: 5, at: 7, n: 2}, {v: 6, at: 23, n: 2}, {v: 7, at: 1, n: 1}],   // columns added over time, in order (see makeTable)
       extra: r => r.um ? true : r.au ? (!$('hits').checked || r[14] === 'PASS') && condOk(r[15]) : (!$('hits').checked || r[14] === 'PASS') && condOk(r[15]) && r[32] >= 2 && (r[29] !== 'suspect' || $('showsus-er').checked) && (!$('mm-er').checked || r[37] === 'low') && (!$('lead-er').checked || r[14] === 'LEAD'),
       rowClass: r => r.um ? 'umm' : r.au ? '' : (r[29] === 'suspect' ? 'sus ' : '') + (LIVE.prevT && r[34] > LIVE.prevT ? 'fresh' : ''),
       hay: r => r[1] + ' ' + r[2] + ' ' + r[6],
       row: r => r.au ? auRow(r) : umCell(r) + cells4(r) +
      '<td class="num">' + fmtNum(r[5], 1) + '</td>' +
      '<td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener" title="' + esc(r[6]) + '">' + esc(r[6]) + '</a></td>' +
      '<td class="num auc"></td><td class="num auc"></td>' +
      '<td class="num fxc">' + fmtMoney(r[7]) + '</td><td class="num">' + (r[8] == null ? dash : r[8] === 0 ? 'free' : fmtMoney(r[8])) + '</td>' +
      '<td class="num">' + fmtMoney(r[9]) + '</td><td class="num">' + fmtMoney(r[10]) + '</td>' +
      '<td class="num">' + fmtMoney(r[35]) + '</td><td class="num">' + fmtPct(r[36]) + '</td>' +
      '<td class="num">' + (r[40] == null ? dash : r[40]) + '</td><td class="num">' + (r[41] == null ? dash : r[41]) + '</td>' +
      '<td class="num">' + fmtMoney(r[11]) + '</td>' +
      '<td class="num">' + fmtPct(r[12]) + '</td>' +
      '<td class="num">' + fmtMoney(r[26]) + '</td>' +
      '<td class="num"' + (r[28] ? ' title="' + esc(r[28]) + '"' : '') + '>' + fmtMoney(r[13]) + (r[28] ? ' <span class="dim">' + (/^Lead/.test(r[28]) ? 'PC' : 'LP') + '</span>' : '') + '</td>' +
      '<td class="num">' + (r[24] == null ? dash : '<span class="' + (r[24] > 0 ? 'up' : r[24] < 0 ? 'down' : '') + '">' + (r[24] < 0 ? '−' : '') + fmtMoney(Math.abs(r[24])).replace('$', '$') + '</span>') + '</td>' +
      '<td class="num">' + fmtPct(r[25]) + '</td>' +
      '<td class="num auc"></td><td class="num auc"></td>' +
      '<td>' + verdictCell(r) + '</td>' +
      '<td>' + riskCell(r) + '</td>' +
      '<td class="num">' + (r[32] == null ? dash : r[32]) + '</td>' +
      '<td>' + (r[15] === 'UNK' ? '<span class="dim">n/s</span>' : esc(r[15])) + '</td>' +
      '<td>' + (r[16] ? 'BO' : dash) + '</td>' +
      '<td class="num">' + fmtInt(r[17]) + '</td><td class="num">' + (r[18] == null ? dash : r[18].toFixed(1) + '%') + '</td>' +
      '<td>' + (r[19] === 'open' ? 'open' : r[19] === 'sold' ? '<span class="up">sold</span>' : '<span class="dim">' + esc(r[19]) + '</span>') + '</td>' +
      '<td class="num">' + (r[27] == null ? dash : (r[19] === 'open' ? '<span class="dim">' + fmtNum(r[27], 1) + '</span>' : fmtNum(r[27], 1))) + '</td>'},
};
/* ---------------- Raw Data's auction view: "Auctions sent to my phone" ----------------
   With the switch on the table shows no ordinary listing, only the auctions the collector pinged the phone about
   (live.alert.au, kept 60 days). Each row is laid out like a listing row so the same columns, sorts and filters work:
     Max buy, Profit, ROI      = the worst case if he wins: he pays his whole Max buy, so ROI is his margin
     Profit / ROI at final     = the best case: the price it closed at with no bid from him in the auction
     Verdict                   = how it closed against his Max buy
   Margin and buy tax come from the SAVED Notification Settings settings, never from the boxes at the top (Brett: the view is
   about what was sent). What selling the card brings in is the figure frozen when the alert went out. */
function AU_ON() { const e = document.getElementById('au-er'); return !!(e && e.checked); }
function auRows(live) {
  const A = (live.alert && live.alert.au) || [], c = Object.assign({}, AL_DEFAULT, (live.alert && live.alert.cfg) || {});
  const margin = Math.min(0.5, Math.max(0, c.margin / 100)), tax = Math.min(0.15, Math.max(0, c.tax / 100)), now = Date.now();
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  return A.slice().sort((x, y) => (x[1] < y[1] ? 1 : -1)).map((a, i) => {
    const [iid, t, cid, ti, u, bid, ship, nb, end, tc, fb, pct, kd, s, netNM, netLP, tier, sc, scr, ph, fin, fb2, fst, dec, old, tot0, umFlag] = a;
    const base = idRow.get(cid) || [], cs = (live.cards || {})[String(cid)] || {};
    const lp = dec === 'lp' || (dec !== 'nm' && tc === 'LP'), net = lp ? netLP : netNM;
    const maxbuy = net == null ? null : r2(net / (1 + margin)), sh = ship == null ? 0 : ship;
    const sold = fst === 'sold' && fin != null, ftot = sold ? r2(fin + sh) : null, fall = sold ? r2(fin + sh + fin * tax) : null;
    const pc0 = base[6] == null ? null : base[6], G = live.gate || {};
    const cheap = sold && pc0 && (base[5] || 0) >= (G.pcMinSales || 20) && ftot < (G.pcLow || 0.4) * pc0;   // bidders let it go for a fraction: not the real card
    const res0 = fst === 'nobids' ? 'no bids' : fst === 'gone' ? 'no result' : !sold ? (end && now < Date.parse(end) + 9e5 ? 'not finished' : 'no result')
      : maxbuy == null ? 'no result' : cheap ? 'closed too cheap' : fall <= maxbuy ? 'PASS' : 'over max buy';
    const um = umOf(iid, umFlag), res = um ? 'mismatch: marked by you' : res0;
    const pc = base[6] == null ? null : base[6];
    const row = [cid, base[1] || ti || '', base[2] || '', base[3] || '', base[4] || '', r1((now - Date.parse(t)) / 36e5), ti || '', sold ? fin : null, ship, ftot, fall,
      cs.A != null ? cs.A : null, sold && cs.A ? r1((ftot / cs.A - 1) * 100) : null, maxbuy, res, tc || 'UNK', false, fb, pct,
      sold ? 'sold' : fst === 'nobids' ? 'ended' : fst === 'gone' ? 'gone' : 'open', u, null, iid, null,
      maxbuy == null ? null : r2(net - maxbuy), maxbuy == null ? null : r1(margin * 100), s,
      null, lp ? 'LP: judged as a lightly played copy' : kd === 'lead' ? 'Lead: priced from PriceCharting, not from eBay sales' : null,
      tier || 'clean', RISK_RANK[tier] || 0, sc || 0, ph == null ? 99 : ph, scr || [], t,
      pc, sold && pc ? r1((ftot / pc - 1) * 100) : null, '', '', [], base[5] == null ? null : r1(base[5] / 12), cs.k != null ? cs.k : null,
      bid, sold ? fin : null, sold && net != null ? r2(net - fall) : null, sold && net != null && fall > 0 ? r1((net - fall) / fall * 100) : null, i];
    row.au = {fst, kd, dec, old, nb, fb2, end, tot0, res, res0}; row.um = um;
    return row;
  });
}
function auRow(r) {
  const x = r.au, money = v => v == null ? dash : fmtMoney(v), signed = v => v == null ? dash : '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + (v < 0 ? '−' : '') + fmtMoney(Math.abs(v)) + '</span>';
  const said = x.dec ? ' Your answer on the phone: ' + ({nm: 'Yes, near mint', lp: 'Yes, lightly played', no: 'No'}[x.dec] || x.dec) + '.' : '';
  const tip = {'PASS': 'It closed at or under your Max buy: a bid of your max might have won it, unless the winner\'s hidden maximum was above yours.',
               'over max buy': 'It closed above your Max buy: your max would not have won it.', 'no bids': 'The auction ended without a bid.',
               'not finished': 'The result is read a few minutes after the auction ends.', 'no result': 'eBay gave no final price for this auction.',
               'closed too cheap': 'It closed under ' + pcPct('pcLow', 0.4) + '% of the card\'s PriceCharting price. Other bidders do not let the real card go for that: treated as a wrong match (another card, a damaged copy, a fake), not a hit.',
               'mismatch: marked by you': 'You marked this auction as not the card it was matched to. It is left out of the hit total. Untick Mismatch to undo.'}[x.res] || '';
  return umCell(r) + (r[0] ? cells4(r) : '<td>' + esc(r[1]) + '</td><td></td><td class="num"></td><td>' + dash + '</td>') +
    '<td class="num">' + fmtNum(r[5], 1) + '</td>' +
    '<td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener" title="' + esc(r[6]) + '">' + esc(r[6]) + '</a></td>' +
    '<td class="num auc"' + (x.old ? ' title="An alert from before October 6: worked back from the total the alert recorded"' : '') + '>' + (r[42] != null ? fmtMoney(r[42]) + (x.nb != null ? ' <span class="dim">' + x.nb + ' bid' + (x.nb === 1 ? '' : 's') + '</span>' : '') : x.tot0 != null ? fmtMoney(x.tot0) + ' <span class="dim">with shipping</span>' : dash) + '</td>' +
    '<td class="num auc">' + (r[43] != null ? '<b>' + fmtMoney(r[43]) + '</b>' + (x.fb2 != null ? ' <span class="dim">' + x.fb2 + ' bid' + (x.fb2 === 1 ? '' : 's') + '</span>' : '') : x.fst === 'nobids' ? '<span class="dim">no bids</span>' : dash) + '</td>' +
    '<td class="num fxc"></td><td class="num">' + (r[8] == null ? dash : r[8] === 0 ? 'free' : fmtMoney(r[8])) + '</td>' +
    '<td class="num">' + money(r[9]) + '</td><td class="num">' + money(r[10]) + '</td>' +
    '<td class="num">' + money(r[35]) + '</td><td class="num">' + fmtPct(r[36]) + '</td>' +
    '<td class="num">' + (r[40] == null ? dash : r[40]) + '</td><td class="num">' + (r[41] == null ? dash : r[41]) + '</td>' +
    '<td class="num">' + money(r[11]) + '</td><td class="num">' + fmtPct(r[12]) + '</td>' +
    '<td class="num">' + money(r[26]) + '</td>' +
    '<td class="num"' + (r[28] ? ' title="' + esc(r[28]) + '"' : '') + '>' + money(r[13]) + (r[28] ? ' <span class="dim">' + (/^Lead/.test(r[28]) ? 'PC' : 'LP') + '</span>' : '') + '</td>' +
    '<td class="num" title="Worst case if you win: you pay your whole Max buy">' + signed(r[24]) + '</td><td class="num" title="Worst case if you win: your margin">' + fmtPct(r[25]) + '</td>' +
    '<td class="num auc" title="Best case: at the price it closed at">' + signed(r[44]) + '</td><td class="num auc" title="Best case: at the price it closed at">' + fmtPct(r[45]) + '</td>' +
    '<td><span title="' + esc(tip + said) + '">' + (x.res === 'PASS' ? badge('PASS', 'pass') : r.um ? badge('mismatch \u2717', 'warn') : '<span class="dim">' + esc(x.res) + '</span>') + (x.dec === 'no' ? ' <span class="dim">· you said No</span>' : '') + '</span></td>' +
    '<td>' + riskCell(r) + '</td>' +
    '<td class="num">' + (r[32] === 99 ? dash : r[32]) + '</td>' +
    '<td>' + (r[15] === 'UNK' ? '<span class="dim">n/s</span>' : esc(r[15])) + '</td><td>' + dash + '</td>' +
    '<td class="num">' + fmtInt(r[17]) + '</td><td class="num">' + (r[18] == null ? dash : r[18].toFixed(1) + '%') + '</td>' +
    '<td>' + (r[19] === 'sold' ? '<span class="up">sold</span>' : r[19] === 'open' ? 'open' : '<span class="dim">' + esc(r[19]) + '</span>') + '</td><td class="num">' + dash + '</td>';
}
// the switch: swap the table over, rename the two "listed" labels, and take the top boxes out of play on this tab
function auMode() {
  const on = AU_ON(), here = !$('p-er').hidden;
  $('p-er').classList.toggle('au-on', on); $('auchip').classList.toggle('on', on);
  const th = document.querySelector('#p-er th[data-k="5"]'); if (th && th.childNodes[0]) th.childNodes[0].nodeValue = on ? 'Alerted (h ago)' : 'Listed within (h)';
  const box = document.getElementById('max5-er'), lbl = box && box.parentNode.querySelector('.lbl'); if (lbl) lbl.textContent = on ? 'Alerted within' : 'Listed within';
  ['conf', 'win', 'margin', 'buytax'].forEach(id => { $(id).disabled = on && here; });
  $('au-note').hidden = !on;
  if (!on) return;
  const c = Object.assign({}, AL_DEFAULT, (LIVE.data && LIVE.data.alert && LIVE.data.alert.cfg) || {});
  $('au-note').innerHTML = '<b>Auctions sent to your phone</b>, newest first, kept for 60 days. Max buy, Profit and ROI use your saved alert settings (margin <b>' + c.margin + '%</b>, buy tax <b>' + c.tax + '%</b>), not the boxes above: they are the <b>worst case</b> if you win, paying your whole Max buy. The two "at final" columns are the <b>best case</b>: the price it closed at with no bid from you. Your own bid would have pushed that price up, or lost to a higher hidden maximum. What the card sells for is the figure the alert used.';
}

// scam screen: tier badge with the score and the signals behind it on hover
const RISK_RANK = {clean: 0, watch: 1, suspect: 2};
function riskCell(r) {
  const lab = (LIVE.data && LIVE.data.scam && LIVE.data.scam.labels) || {};
  const why = (r[33] || []).map(c => lab[c] || c).join(' · ');
  const title = 'score ' + r[31] + (why ? ': ' + why : '');
  if (r[29] === 'suspect') return '<span title="' + esc(title) + '">' + badge('suspect', 'sus') + '</span>';
  if (r[29] === 'watch') return '<span title="' + esc(title) + '">' + badge('watch', 'watch') + '</span>';
  return '<span class="dim" title="' + esc(title) + '">—</span>';
}
// verdict badge; the identity checks explain themselves on hover
const pcPct = (k, d) => Math.round(((LIVE.data && LIVE.data.gate && LIVE.data.gate[k]) || d) * 100);
function verdictCell(r) {
  const v = r[14], why = (r[39] || []).join(' · ');
  const tip = (t, b) => '<span title="' + esc(t) + '">' + b + '</span>';
  if (v === 'PASS') {
    if (r[38] === 'ok') return tip('the item specifics agree with the matched card' + (why ? ' (note: ' + why + ')' : '') + ' - still look at the photos', badge('PASS ✓', 'pass'));
    return tip(r[38] === 'none' ? 'the seller filled in no usable item specifics, so the match rests on the title alone: confirm the card from the photos'
                                : 'item specifics not read yet (the collector reads them within a couple of minutes of a hit): confirm the card from the photos',
               badge('PASS', 'pass') + ' <span class="dim">ID?</span>');
  }
  if (v === 'LEAD') return tip((r[28] || 'Lead: priced from PriceCharting, not from eBay sales') + '. ' + (r[38] === 'ok' ? 'Item specifics agree with the matched card.' : 'Item specifics not confirmed.') + ' A lead is not a hit: check the photos and the condition first', badge('LEAD' + (r[38] === 'ok' ? ' ✓' : ''), 'hot'));
  if (v === 'ID conflict') return tip('passes on price, but the item specifics describe another card: ' + why, badge('ID conflict', 'warn'));
  if (v === 'mismatch: marked by you') return tip('You marked this listing as not the card it was matched to. It is out of the statistics and out of the hit total, and the matcher learns from it. Untick Mismatch to undo.', badge('mismatch \u2717', 'warn'));
  if (v === 'learned') return tip('Held back by what your earlier mismatch marks taught: ' + (r.lrn || '') + '. It cannot be a hit. If it is the right card after all, the mark that taught this was the wrong one to make.', badge('learned', 'watch'));
  if (v === 'mismatch: too cheap') return tip('under ' + pcPct('pcLow', 0.4) + '% of the PriceCharting price: treated as a wrong match (another printing or language, a lot, a fake - far more often than a bargain). Never a hit, left out of the statistics; check it by hand', badge('mismatch ↓', 'watch'));
  if (v === 'mismatch: too high') return tip('over ' + pcPct('pcHigh', 3) + '% of the PriceCharting price: treated as a wrong match and left out of the statistics', badge('mismatch ↑'));
  if (v === 'review') return tip('under 45% of the anchor: more often misidentified, damaged or fake than a bargain - check the photos and the seller', badge('review', 'watch'));
  return /scam|suspect/.test(v) ? badge(v, 'warn') : badge(v);
}
// Raw Data condition filter (NM / LP / n/s chips); MP and HP rows show only when all three are ticked
const COND_IDS = ['NM', 'LP', 'UNK'];
function condOk(c) {
  const on = COND_IDS.filter(k => $('cond-' + k + '-er').checked);
  if (on.length === COND_IDS.length) return true;
  return on.includes(c);
}

/* ---------------- Period picker (Revenue, and "every hit" on Raw Data) ----------------
   Brett's design: a year, then either a range of months (1-12) or, for one month, a range of days. */
const PERIOD = {};
function periodBar(key, onChange) {
  const host = $('per-' + key), now = new Date(), opt = (a, b, sel) => { let h = ''; for (let i = a; i <= b; i++) h += '<option' + (i === sel ? ' selected' : '') + '>' + i + '</option>'; return h; };
  host.innerHTML = '<label>Year <select class="py">' + opt(2026, Math.max(2026, now.getFullYear()), now.getFullYear()) + '</select></label>' +
    '<label><input type="radio" name="pu-' + key + '" value="m" checked> by month</label><label><input type="radio" name="pu-' + key + '" value="d"> by day</label>' +
    '<label class="pmon" hidden>in month <select class="pm">' + opt(1, 12, now.getMonth() + 1) + '</select></label>' +
    '<label>from <input type="number" class="pa" min="1" max="12" value="1"></label><label>to <input type="number" class="pb" min="1" max="12" value="12"></label>' +
    '<button class="help" data-h="period">?</button>';
  const q = c => host.querySelector(c), unit = () => host.querySelector('input[type=radio]:checked').value;
  host.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => {
    const d = unit() === 'd'; q('.pmon').hidden = !d; q('.pa').max = q('.pb').max = d ? 31 : 12; q('.pa').value = 1; q('.pb').value = d ? 31 : 12; onChange();
  }));
  ['.py', '.pm', '.pa', '.pb'].forEach(c => q(c).addEventListener('input', onChange));
  return PERIOD[key] = {
    test(iso) {
      if (!iso) return false;
      const t = new Date(iso), a = +q('.pa').value || 1, b = +q('.pb').value || (unit() === 'd' ? 31 : 12);
      if (t.getFullYear() !== +q('.py').value) return false;
      if (unit() === 'm') return t.getMonth() + 1 >= a && t.getMonth() + 1 <= b;
      return t.getMonth() + 1 === +q('.pm').value && t.getDate() >= a && t.getDate() <= b;
    },
    label() { const a = q('.pa').value, b = q('.pb').value; return unit() === 'm' ? (a === b ? 'month ' + a : 'months ' + a + ' to ' + b) + ' of ' + q('.py').value : 'days ' + a + ' to ' + b + ' of month ' + q('.pm').value + ', ' + q('.py').value; }
  };
}
const rvWhen = iso => iso ? new Date(iso).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : dash;
// the totals over the Revenue rows in view (the period and any search / set filter)
function rvSummary() {
  const t = tables.rv, a = (LIVE.data && LIVE.data.acct) || null;
  if (!t || !$('sum-rv')) return;
  const sold = t.view.filter(r => r[13] != null), net = sold.reduce((x, r) => x + r[13], 0), paid = sold.reduce((x, r) => x + (r[5] || 0), 0);
  $('sum-rv').innerHTML = !a ? 'Waiting for the collector.' : !a.linked ? 'Your eBay account is not linked yet, so there is nothing to show.'
    : 'Net profit for ' + PERIOD.rv.label() + ': <b class="big ' + (net > 0 ? 'up' : net < 0 ? 'down' : '') + '">' + (net < 0 ? '−' : '') + fmtMoneyPlain(Math.abs(net)) + '</b> from <b>' + sold.length + '</b> card' + (sold.length === 1 ? '' : 's') + ' bought and sold' +
      (sold.length ? ' · ' + fmtMoneyPlain(paid) + ' spent on them · ' + (paid ? (net / paid * 100).toFixed(1) : '0') + '% return' : '') +
      ' · cash tied up in unsold cards now: <b>' + fmtMoneyPlain(a.tied || 0) + '</b>';
}
// Raw Data: what the hits of a period promised, had every one been bought
function hitLedger() {
  // every hit in the period, newest first: the fixed-price alerts, and the auctions that closed at or under the max
  const A = (LIVE.data && LIVE.data.alert) || {}, P = PERIOD.er, out = [];
  (A.all || []).forEach(e => { if (/^hit/.test(e[2] || '') && e[1] != null && P.test(e[0])) out.push({t: e[0], src: 'bin', kind: /drop/.test(e[2]) ? 'Buy It Now, price drop' : /suspect/.test(e[2]) ? 'Buy It Now, suspect' : 'Buy It Now', p: e[1], i: e[4], c: e[5] || '', u: e[6], tot: e[7], ti: e[9] || '', dec: e[3], um: umOf(e[4], e[8])}); });
  (LIVE.au || []).forEach(r => { if (r.au.res0 === 'PASS' && r[44] != null && P.test(r[34])) out.push({t: r[34], src: 'au', kind: 'auction, at the final price', p: r[44], i: r[22], c: r[1], u: r[20], tot: r[9], ti: r[6], dec: r.au.dec, um: r.um}); });
  return out.sort((x, y) => (x.t < y.t ? 1 : -1));
}
function hitSummary() {
  if (!$('sum-er') || !PERIOD.er) return;
  const L = hitLedger(), ok = L.filter(h => !h.um && h.dec !== 'no'), bin = ok.filter(h => h.src === 'bin'), au = ok.filter(h => h.src === 'au');
  const sum = x => x.reduce((s, h) => s + h.p, 0), n = (k, w) => '<b>' + k + '</b> ' + w + (k === 1 ? '' : 's');
  $('sum-er').innerHTML = 'If you had bought every hit in ' + PERIOD.er.label() + ': <b class="big up">' + fmtMoneyPlain(sum(ok)) + '</b> = ' +
    n(bin.length, 'hit') + ' from Buy It Now (<b>' + fmtMoneyPlain(sum(bin)) + '</b>) + ' + n(au.length, 'hit') + ' from auctions (<b>' + fmtMoneyPlain(sum(au)) + '</b>, at the final price)' +
    (L.length !== ok.length ? ' · <b>' + (L.length - ok.length) + '</b> left out as mismatches' : '') +
    ' · <button class="linkbtn" id="hits-btn">Show them</button>' +
    ' <span class="dim">· a ceiling: it assumes each was near mint and sold at the expected price, and an auction would have closed higher with your bid in it. Counted since October 5, when alerts began.</span>';
  $('hits-btn').addEventListener('click', openHits);
  if ($('bov').classList.contains('open') && $('btitle').textContent.indexOf('Hits in') === 0) openHits();
}
function openHits() {
  const L = hitLedger(), now = new Map((LIVE.er || []).map(r => [r[22], r]));
  const when = t => new Date(t).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  const ans = {nm: 'Yes, near mint', lp: 'Yes, lightly played', no: 'No', yes: 'Same card'};
  $('btitle').textContent = 'Hits in ' + PERIOD.er.label();
  $('bsub').textContent = 'Every hit the collector alerted you to in the period, newest first. The table behind this list only holds the last 24 hours and judges each listing as it stands now, so a hit from earlier can be missing there or no longer pass.';
  $('bbody').innerHTML = !L.length ? '<p>None in this period.</p>' :
    '<table><thead><tr><th>Mismatch</th><th>Alerted</th><th>Card</th><th>Kind</th><th class="num">Total</th><th class="num">Profit</th><th>Your answer</th><th>In the table now</th></tr></thead><tbody>' +
    L.map(h => { const r = now.get(h.i), out = h.um || h.dec === 'no';
      return '<tr class="' + (out ? 'umm' : '') + '"><td class="mmk"><input type="checkbox" class="um" data-i="' + esc(h.i || '') + '"' + (h.um ? ' checked' : '') + '></td><td>' + when(h.t) + '</td><td><a href="' + esc(h.u || '#') + '" target="_blank" rel="noopener" title="' + esc(h.ti) + '">' + esc(h.c || h.ti) + '</a></td><td>' + esc(h.kind) + '</td><td class="num">' + fmtMoney(h.tot) + '</td><td class="num">' + (out ? '<s>' + fmtMoney(h.p) + '</s>' : fmtMoney(h.p)) + '</td><td>' + (h.dec ? ans[h.dec] || esc(h.dec) : '<span class="dim">none</span>') + '</td><td>' +
        (h.src === 'au' ? '<span class="dim">auction view</span>' : r ? esc(r[14]) + (r[19] && r[19] !== 'open' ? ' <span class="dim">(' + esc(r[19]) + ')</span>' : '') : '<span class="dim">older than 24 h</span>') + '</td></tr>'; }).join('') + '</tbody></table>';
  $('bov').classList.add('open');
}

function makeTable(id, cfg) {
  const el = k => $(k + '-' + id);
  const t = {id, sortKey: null, sortDir: 1, view: [], shown: 0};
  const sel = el('set');
  SETS.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
  const maxes = cfg.maxes || [];
  cfg.ranges.forEach(k => {                             // min–max chips
    const div = document.createElement('div'); div.className = 'range';
    const d = cfg.defaults[k] || ['', ''];
    div.innerHTML = '<span class="lbl">' + cfg.labels[k] + '</span><input type="number" id="min' + k + '-' + id + '" placeholder="min" value="' + d[0] + '"><span class="to">–</span><input type="number" id="max' + k + '-' + id + '" placeholder="max" value="' + d[1] + '">';
    el('ranges').insertBefore(div, el('reset'));
  });
  maxes.forEach(k => {                                  // single "at most" chips (e.g. Listed within N h)
    const div = document.createElement('div'); div.className = 'range';
    div.innerHTML = '<span class="lbl">' + cfg.labels[k] + '</span><input type="number" id="max' + k + '-' + id + '" placeholder="any">' + (cfg.units && cfg.units[k] ? '<span class="unit">' + cfg.units[k] + '</span>' : '');
    el('ranges').insertBefore(div, el('reset'));
  });
  const paintChips = () => el('ranges').querySelectorAll('.range:not(.condchip)').forEach(div => div.classList.toggle('on', [...div.querySelectorAll('input')].some(i => i.value !== '')));
  t.apply = () => {
    const rows = cfg.rows();
    const q = el('q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const set = sel.value;
    const ranges = cfg.ranges.map(k => {
      const lo = el('min' + k).value, hi = el('max' + k).value;
      return [k, lo === '' ? null : +lo, hi === '' ? null : +hi];
    }).filter(([, lo, hi]) => lo != null || hi != null);
    maxes.forEach(k => { const hi = el('max' + k).value; if (hi !== '') ranges.push([k, null, +hi]); });
    paintChips();
    t.view = rows.filter(r => {
      if (set && r[2] !== set) return false;
      for (const [k, lo, hi] of ranges) {
        const v = r[k];
        if (v == null) return false;                     // no value -> can't be in the range
        if (lo != null && v < lo) return false;
        if (hi != null && v > hi) return false;
      }
      if (cfg.extra && !cfg.extra(r)) return false;
      if (q.length) { const hay = cfg.hay(r).toLowerCase(); if (!q.every(w => hay.includes(w))) return false; }
      return true;
    });
    if (t.sortKey != null) {
      const k = t.sortKey, d = t.sortDir;
      t.view.sort((a, b) => {
        let x = a[k], y = b[k];
        if (k === 2) { x = setIndex.get(x); y = setIndex.get(y); }
        if (x === '') x = null; if (y === '') y = null;         // blanks always sort last
        if (x == null && y == null) return ordOf(a) - ordOf(b);
        if (x == null) return 1; if (y == null) return -1;
        if (typeof x === 'number') return (x - y) * d || ordOf(a) - ordOf(b);
        return String(x).localeCompare(String(y), undefined, {numeric: true}) * d || ordOf(a) - ordOf(b);
      });
    }
    el('rows').innerHTML = ''; t.shown = 0; t.renderMore();
    el('count').textContent = t.view.length.toLocaleString('en-US') + ' of ' + rows.length.toLocaleString('en-US') + ' ' + cfg.noun;
    if (cfg.after) cfg.after(t);
  };
  t.renderMore = () => {
    const frag = document.createDocumentFragment();
    const end = Math.min(t.shown + PAGE, t.view.length);
    for (let i = t.shown; i < end; i++) { const tr = document.createElement('tr'); tr.innerHTML = '<td class="rn">' + (i + 1) + '</td>' + cfg.row(t.view[i]); if (cfg.rowClass) { const c = cfg.rowClass(t.view[i]); if (c) tr.className = c; } paintRow(tr); frag.appendChild(tr); }
    el('rows').appendChild(frag); t.shown = end;
    el('more').hidden = t.shown >= t.view.length;
    el('more').textContent = 'Show more (' + (t.view.length - t.shown).toLocaleString('en-US') + ' left)';
  };
  // column eyes: every header cell (last header row) gets one; hidden columns collapse to a strip
  const headRow = document.querySelector('#p-' + id + ' thead tr:last-child');
  let hiddenCols = new Set();
  try { hiddenCols = new Set(JSON.parse(localStorage.getItem('hide-' + id) || '[]')); } catch (e) {}
  for (const ins of [].concat(cfg.inserted || [])) try {   // columns added since the choice was saved: keep it on the same columns
    const mark = 'cols-' + id + '-v' + ins.v;
    if (!localStorage.getItem(mark)) {
      hiddenCols = new Set([...hiddenCols].map(ci => ci >= ins.at ? ci + ins.n : ci));
      localStorage.setItem('hide-' + id, JSON.stringify([...hiddenCols])); localStorage.setItem(mark, '1');
    }
  } catch (e) {}
  const EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C7 5 3 8.5 1.5 12 3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" fill="currentColor"/></svg>';
  const EYE_SHUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6c1.6 0 3 .3 4.3.9l-1.6 1.6A6 6 0 0 0 12 8c-4.4 0-7.2 3.2-8.1 4 .5.5 1.6 1.7 3.2 2.6l-1.5 1.5C3.4 14.7 2 12 2 12zm20 0s-3.5 6-10 6c-1.6 0-3-.3-4.3-.9l1.6-1.6c.8.3 1.7.5 2.7.5 4.4 0 7.2-3.2 8.1-4-.5-.5-1.6-1.7-3.2-2.6l1.5-1.5C20.6 9.3 22 12 22 12zM4 20 20 4l1.4 1.4L5.4 21.4z" fill="currentColor"/></svg>';
  const paintHeads = () => [...headRow.children].forEach((th, ci) => {
    const on = hiddenCols.has(ci);
    th.classList.toggle('col-hidden', on);
    const b = th.querySelector('.eye'); if (b) { b.innerHTML = on ? EYE_SHUT : EYE_OPEN; b.title = on ? 'Show column' : 'Hide column'; }
  });
  const paintRow = tr => { if (hiddenCols.size) hiddenCols.forEach(ci => { const td = tr.children[ci]; if (td) td.classList.add('col-hidden'); }); };
  const toggleCol = ci => {
    if (hiddenCols.has(ci)) hiddenCols.delete(ci); else hiddenCols.add(ci);
    try { localStorage.setItem('hide-' + id, JSON.stringify([...hiddenCols])); } catch (e) {}
    paintHeads();
    el('rows').querySelectorAll('tr').forEach(tr => { const td = tr.children[ci]; if (td) td.classList.toggle('col-hidden', hiddenCols.has(ci)); });
  };
  [...headRow.children].forEach((th, ci) => {
    const b = document.createElement('button'); b.className = 'eye'; b.type = 'button';
    b.addEventListener('click', e => { e.stopPropagation(); toggleCol(ci); });
    th.appendChild(b);
  });
  paintHeads();
  const ths = document.querySelectorAll('#p-' + id + ' th[data-k]');
  ths.forEach(th => th.addEventListener('click', () => {
    const k = +th.dataset.k;
    if (t.sortKey === k) { if (t.sortDir === 1) t.sortDir = -1; else { t.sortKey = null; t.sortDir = 1; } } else { t.sortKey = k; t.sortDir = 1; }
    ths.forEach(x => { x.classList.remove('on'); x.querySelector('.s').textContent = '⇅'; });
    if (t.sortKey != null) { th.classList.add('on'); th.querySelector('.s').textContent = t.sortDir === 1 ? ' ▲' : ' ▼'; }
    t.apply();
  }));
  ['q', ...cfg.ranges.flatMap(k => ['min' + k, 'max' + k]), ...maxes.map(k => 'max' + k)].forEach(k => el(k).addEventListener('input', t.apply));
  const conds = [...document.querySelectorAll('#ranges-' + id + ' #condchip input')];
  const sus = document.querySelector('#ranges-' + id + ' #showsus-' + id);
  if (sus) sus.addEventListener('input', () => { $('suschip').classList.toggle('on', sus.checked); t.apply(); });
  const mm = document.querySelector('#ranges-' + id + ' #mm-' + id);
  if (mm) mm.addEventListener('input', () => { $('mmchip').classList.toggle('on', mm.checked); t.apply(); });
  const ld = document.querySelector('#ranges-' + id + ' #lead-' + id);
  if (ld) ld.addEventListener('input', () => { $('leadchip').classList.toggle('on', ld.checked); t.apply(); });
  if (conds.length) {
    try { const sv = JSON.parse(localStorage.getItem('cond-' + id) || 'null'); if (sv) conds.forEach(c => { c.checked = sv.includes(c.id); }); } catch (e) {}
    conds.forEach(c => c.addEventListener('input', () => {
      try { localStorage.setItem('cond-' + id, JSON.stringify(conds.filter(x => x.checked).map(x => x.id))); } catch (e) {}
      $('condchip').classList.toggle('on', conds.some(x => !x.checked)); t.apply();
    }));
    $('condchip').classList.toggle('on', conds.some(x => !x.checked));
  }
  if (el('reset')) el('reset').addEventListener('click', () => {
    el('q').value = ''; sel.value = '';
    cfg.ranges.forEach(k => { const d = cfg.defaults[k] || ['', '']; el('min' + k).value = d[0]; el('max' + k).value = d[1]; });
    maxes.forEach(k => { el('max' + k).value = ''; });
    conds.forEach(c => { c.checked = true; }); if (conds.length) { $('condchip').classList.remove('on'); try { localStorage.removeItem('cond-' + id); } catch (e) {} }
    if (sus) { sus.checked = false; $('suschip').classList.remove('on'); }
    if (mm) { mm.checked = false; $('mmchip').classList.remove('on'); }
    if (ld) { ld.checked = false; $('leadchip').classList.remove('on'); }
    t.apply();
  });
  sel.addEventListener('change', t.apply);
  el('more').addEventListener('click', t.renderMore);
  t.apply();
  return t;
}
const tables = {};
for (const id in TABLES) tables[id] = makeTable(id, TABLES[id]);
periodBar('rv', () => tables.rv.apply());
periodBar('er', hitSummary);
tables.rv.apply();

// Only the row of column names stays in view (Brett: the tabs, boxes and filters staying put was too much). The page
// itself is the scroller - the tables sit in no box of their own - and the header row sticks to the top of the
// window. More rows load as the bottom of the page comes near.
window.addEventListener('scroll', () => {
  const p = document.querySelector('.panel:not([hidden])'), id = p && p.id.slice(2), t = tables[id];
  if (t && !$('more-' + id).hidden && window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 900) t.renderMore();
}, {passive: true});

/* ---------------- Tabs ---------------- */
const TAB_HASH = {pc: '', ec: 'ebay-catalog', er: 'ebay-raw', al: 'alerts', rv: 'revenue'};      // default (no hash) = PriceCharting
function showTab(id) {
  if (!TABLES[id] && id !== 'al') id = 'pc';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === id));
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== 'p-' + id; });
  history.replaceState(null, '', location.pathname + location.search + (TAB_HASH[id] ? '#' + TAB_HASH[id] : ''));
  auMode();                                             // the top boxes are out of play only while Raw Data shows auctions
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.t)));
showTab(Object.keys(TAB_HASH).find(k => TAB_HASH[k] === location.hash.slice(1)) || 'pc');

/* ---------------- eBay live data ----------------
   ebay_sweep.py publishes live/ebay_live.bin (AES-GCM, same key as the history shards) to the
   repo's "live" branch every 15 minutes; raw.githubusercontent.com serves it with CORS. */
const LIVE_URL = '__LIVE_URL__';
const GATE_EBAY = __GATE_EBAY__;
const idRow = new Map(DATA.map(r => [r[0], r]));
async function decryptGz(buf, keyHex) {
  const key = await crypto.subtle.importKey('raw', hex2bytes(keyHex), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: buf.slice(0, 12)}, key, buf.slice(12));
  return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
function ageText(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? m + ' min ago' : (m / 60).toFixed(1) + ' h ago';
}
/* ---- Decisions recomputed in the browser, so Confidence, Window and Margin can be changed live ----
   Mirrors compute_stats() / listing_decision() / verdict() in ebay_sweep.py. Observed and Rates never change here. */
const r2 = v => v == null ? null : Math.round(v * 100) / 100;
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
function settings() {
  const conf = Math.min(0.95, Math.max(0.5, (+$('conf').value || 70) / 100));
  const window = Math.min(168, Math.max(24, +$('win').value || 48));
  const margin = Math.min(0.5, Math.max(0, (+$('margin').value || 0) / 100));
  const buytax = Math.min(0.15, Math.max(0, (+$('buytax').value || 0) / 100));     // 0 once the resale certificate is approved
  const g = (LIVE.data && LIVE.data.gate) || GATE_EBAY;
  const cal = (LIVE.data && LIVE.data.calib) || {};
  const use = $('usecal').checked;
  return {conf, window, margin, fee: g.fee * (1 + g.buyerTax), fixed: g.fixed, shipOut: g.shipOut, supplies: g.supplies || 0, tax: buytax,
          minSales: g.minSales || 5, undercut: g.undercut == null ? 0.5 : g.undercut, sellUnderA: g.sellUnderA || 0.95, sellNoFloor: g.sellNoFloor || 0.93,
          review: g.reviewRatio || 0.45, d48: use && cal.h48 && cal.h48.delta != null ? cal.h48.delta / 100 : 0};
}
const round99 = x => x == null ? null : Math.max(0.99, Math.floor(x) - 0.01);
// the sell price: just under the credible floor, never above 95% of the anchor (or the fast-sale median), rounded to .99
function sellPrice(floor, A, Afast, S) {
  if (A == null) return null;
  let cap = S.sellUnderA * A;
  if (Afast != null) cap = Math.min(cap, Afast);
  let s = floor != null ? Math.min(floor - S.undercut, cap) : S.sellNoFloor * A;
  return round99(s * (1 + S.d48));                     // measured price calibration, if any
}
// liquidity: at least one buyer inside the window at this confidence, i.e. lambda >= -ln(1 - conf) / T days
const lamMin = S => -Math.log(1 - S.conf) / (S.window / 24);
const isLiquid = (lam, st, S) => !!lam && lam >= lamMin(S) && (st == null || st >= 25);   // st = % sold within 48 h (es.ST_MIN)
function decide(c, S) {
  const lam = c.lam, A = c.A, cred = c.cred || [];
  const L = cred.length ? cred[0][1] : null;
  const sell = sellPrice(L, A, c.A_fast, S);
  const probT = lam ? (1 - Math.exp(-lam * S.window / 24)) * 100 : null;
  const edays = lam ? -Math.log(1 - S.conf) / lam : null;
  let net = null, maxbuy = null;
  if (sell != null) { net = sell * (1 - S.fee) - S.fixed - S.shipOut - S.supplies; maxbuy = net / (1 + S.margin); }
  return {A, L, sell, liquid: isLiquid(lam, c.st, S), probT: r1(probT), edays: r1(edays), net: r2(net), maxbuy: r2(maxbuy)};
}
// one listing: its floor is the cheapest credible copy OTHER than itself (you buy it, it leaves the market);
// an LP listing sells at the LP discount
function listingDecide(x, cs, S) {
  if (!cs || cs.A == null) return {sell: null, net: null, maxbuy: null, note: null};
  const f = (cs.cred || []).find(e => e[0] !== x[0]);
  const s = sellPrice(f ? f[1] : null, cs.A, cs.A_fast, S);
  if (s == null) return {sell: null, net: null, maxbuy: null, note: null};
  const d = x[13] === 'LP' ? lpFrac(cs.A) : 0, sellv = s * (1 - d);
  const net = sellv * (1 - S.fee) - S.fixed - S.shipOut - S.supplies, maxbuy = net / (1 + S.margin);
  return {sell: s, net: r2(net), maxbuy: r2(maxbuy),
          note: d ? 'LP: sells about ' + fmtMoneyPlain(r2(sellv)) + ' (' + (d * 100).toFixed(1) + '% under the NM sell price of ' + fmtMoneyPlain(s) + ')' : null};
}
// a lead: eBay has too few sales to judge the card, so PriceCharting's price stands in for the anchor - always capped
// by the cheapest believable copy listed now (mirrors lead_decision() in the collector). null = not a lead card.
function leadDecide(x, cs, S) {
  const G = GATE_LIVE(), base = idRow.get(x[1]) || [];
  const pc = x[27] != null ? x[27] : base[6], vol = base[5] || 0;
  if (!cs || !pc || pc < (G.leadMinPc || 40) || vol < (G.leadMinSales || 100)) return null;
  const f = (cs.cred || []).find(e => e[0] !== x[0]);
  const s = round99(f ? Math.min(f[1] - S.undercut, (G.leadSellPc || 0.95) * pc) : (G.leadSellNoFloor || 0.93) * pc);
  const d = x[13] === 'LP' ? lpFrac(pc) : 0, sellv = s * (1 - d);
  const net = sellv * (1 - S.fee) - S.fixed - S.shipOut - S.supplies, maxbuy = net / (1 + S.margin);
  return {sell: s, net: r2(net), maxbuy: r2(maxbuy), lead: true,
          note: 'Lead: eBay has too few sales to judge this card, so the sell price comes from PriceCharting (' + fmtMoneyPlain(pc) + ', ' + fmtInt(vol) + ' sales/yr)' + (f ? ', capped by the cheapest other copy at ' + fmtMoneyPlain(f[1]) : ' - no other believable copy is listed, so nothing checks that price')};
}
// LP correction: the discount (fraction) for a card at this NM price, from the collector's measured tiers
const LP_FALLBACK = {default: 12, tiers: [{lo: 0, hi: 100, pct: 12, n: 0, src: 'default'}, {lo: 100, hi: 150, pct: 12, n: 0, src: 'default'}, {lo: 150, hi: 1e9, pct: 12, n: 0, src: 'default'}]};
function lpInfo() { return (LIVE.data && LIVE.data.lp) || LP_FALLBACK; }
function lpFrac(price) {
  const t = lpInfo().tiers;
  if (price == null) return t[0].pct / 100;
  const hit = t.find(x => price >= x.lo && price < x.hi);
  return (hit || t[t.length - 1]).pct / 100;
}
function paintLp() {
  const lp = lpInfo();
  $('lpt').innerHTML = lp.tiers.map(t => '<span class="' + (t.src === 'tier' ? 'meas' : '') + '" title="' + (t.src === 'tier' ? 'measured in this tier from ' + t.n + ' LP sales' : t.src === 'global' ? 'this tier has ' + t.n + ' LP sales (needs ' + lp.minSales + '); using the ratio measured across all tiers' : 'no measurement yet (' + t.n + ' LP sales in this tier, needs ' + lp.minSales + '); using the 12% default') + '"><i>' + (t.lo === 0 ? '<$' + t.hi : t.hi >= 1e9 ? '$' + t.lo + '+' : '$' + t.lo + '–' + t.hi) + '</i>' + t.pct + '%</span>').join('') + (lp.tiers.every(t => t.src !== 'tier') ? ' <span class="dim" title="No price tier has ' + lp.minSales + ' LP sales of its own yet, so all three show the one figure measured across every LP sale. They separate as sales accumulate">(pooled)</span>' : '');
}
const COMPARABLE = new Set(['NM', 'LP', 'UNK']);
/* ---------------- "Mismatch": Brett's own verdict on a listing ----------------
   A tick on a Raw Data row (or in the list behind the hit total) says the listing is not the card it was matched to.
   The row stays, tinted; the listing leaves the statistics and the hit total; the collector's matcher learns from it
   (ebay_sweep.py: learn_tables). The tick shows at once from MARKS and is confirmed by live.alert.mark_t. */
const MARKS = {};                                  // item id -> {v: 1 | 0, t}
const umOf = (iid, flag) => iid in MARKS ? !!MARKS[iid].v : !!flag;
const umCell = r => '<td class="mmk"><input type="checkbox" class="um" data-i="' + esc(r[22] || '') + '"' + (r.um ? ' checked' : '') + ' title="Tick if this listing is not the card it was matched to"></td>';
async function sendMark(iid, on) {
  if (!iid) return;
  const t = Date.now();
  MARKS[iid] = {v: on ? 1 : 0, t};
  if (LIVE.data) rebuildLive();
  try { await alSend({type: 'mark', t, i: iid, v: on ? 1 : 0}); }
  catch (e) { delete MARKS[iid]; if (LIVE.data) rebuildLive(); $('sum-er').insertAdjacentHTML('beforeend', ' <span class="down">The mark could not be sent (' + esc(e.message) + ').</span>'); }
}
document.addEventListener('change', e => { const b = e.target && e.target.closest ? e.target.closest('input.um') : null; if (b) sendMark(b.dataset.i, b.checked); });

function verdictOf(x, cs, S) {
  // x = raw live row from the collector; cs = decided card stats. Same order as verdict() in the collector.
  const total = x[7], item = x[5];
  if (total == null) return ['no price', null, null];
  const allin = Math.round((total + (item || 0) * S.tax) * 100) / 100;
  if (umOf(x[0], x[31])) return ['mismatch: marked by you', allin, null];
  if (x[22] != null && x[22] < 2) return ['fewer than 2 photos', allin, null];
  if (x[23] === 'suspect') return ['suspect', allin, null];
  if (x[32]) return ['learned', allin, null];              // held back by what his earlier marks taught
  if (x[28]) return [x[28] === 'low' ? 'mismatch: too cheap' : 'mismatch: too high', allin, null];   // far from PriceCharting: a wrong match
  if (!cs || cs.A == null || (cs.A_n || 0) < S.minSales) {
    // eBay cannot judge this card yet: is the listing a lead on PriceCharting's price?
    if (cs && COMPARABLE.has(x[13]) && sellerBar(x[15], x[16]) == null) {
      const ld = leadDecide(x, cs, S);
      if (ld && allin <= ld.maxbuy) return [x[29] === 'conflict' ? 'ID conflict' : 'LEAD', allin, ld];
    }
    if (!cs || cs.A == null) return [cs ? 'no sales yet' : 'no data yet', allin, null];
    return ['too few sales (' + (cs.A_n || 0) + ')', allin, null];
  }
  if (!cs.liquid) return ['not liquid', allin, null];
  if (!COMPARABLE.has(x[13])) return ['condition ' + x[13], allin, null];
  const bar = sellerBar(x[15], x[16]);
  if (bar != null) return ['seller < ' + bar + '%', allin, null];
  const d = listingDecide(x, cs, S);
  if (total < S.review * cs.A) return ['review', allin, d];
  if (d.maxbuy == null) return ['no sales yet', allin, d];
  return [allin <= d.maxbuy ? (x[29] === 'conflict' ? 'ID conflict' : 'PASS') : 'over max buy', allin, d];
}
// count-aware feedback bar (mirrors seller_bar() in the collector): 100+ ratings need 98%, 20-99 need 95%
function sellerBar(fb, pct) {
  if (pct == null || fb == null) return null;
  if (fb >= 100) return pct < 98 ? 98 : null;
  if (fb >= 20) return pct < 95 ? 95 : null;
  return null;
}
function rebuildLive() {
  const live = LIVE.data; if (!live) return;
  const S = settings();
  const hadSets = !!LIVE.sets; LIVE.sets = live.sets || {};
  if (!hadSets) tables.pc.apply();                      // the PriceCharting tab can now show number/size too
  LIVE.ec = []; LIVE.er = []; LIVE.dec = {};
  for (const [cid, c] of Object.entries(live.cards)) {
    const base = idRow.get(+cid); if (!base) continue;
    const d = decide(c, S); LIVE.dec[cid] = Object.assign({}, c, d);
    const hot = c.hot === 2 ? 'confirmed' : c.hot === 1 ? 'candidate' : '';
    const t = c.tr || {};
    LIVE.ec.push([base[0], base[1], base[2], base[3], base[4],
                  c.k, c.D, c.N, c.p1, c.p2, c.p3, c.mu, c.smed, c.s80, c.hrs, c.st,
                  c.lam, c.price, c.dos, c.io,
                  d.A, d.L, d.sell, d.probT, d.edays, d.maxbuy, hot, d.liquid, c.confirm, c.checks,
                  t.spm == null ? null : t.spm, t.d7 == null ? null : t.d7, t.d30 == null ? null : t.d30, t.pos == null ? null : t.pos,
                  t.vdp == null ? null : t.vdp, t.vd == null ? null : t.vd, t.vol == null ? null : t.vol, t.ts == null ? null : t.ts,
                  d.net, c.A_n || 0, LIVE.ec.length]);
  }
  let passes = 0, hiddenImg = 0, hiddenSus = 0, tooCheap = 0, leads = 0;
  live.live.forEach(x => {
    const base = idRow.get(x[1]); if (!base) return;
    const cs = LIVE.dec[String(x[1])];
    const [v, allin, dd] = verdictOf(x, cs, S);
    const d = dd || listingDecide(x, cs, S), note = d.note;
    if (v === 'PASS') passes++;
    const profit = d.net != null && allin != null ? Math.round((d.net - allin) * 100) / 100 : null;
    const roi = profit != null && allin > 0 ? Math.round(profit / allin * 1000) / 10 : null;
    const status = x[17], tHours = status === 'open' ? x[3] : (x[21] != null ? x[21] : x[3]);
    const tier = x[23] || 'clean', nimg = x[22] == null ? 99 : x[22];
    if (nimg < 2) hiddenImg++; else if (tier === 'suspect') hiddenSus++; else if (x[28] === 'low') tooCheap++; else if (v === 'LEAD') leads++;
    // PriceCharting's ungraded price: the one the collector judged the listing against, else today's from the catalog tab
    const pc = x[27] != null ? x[27] : base[6];
    const vspc = pc && x[7] != null ? Math.round((x[7] / pc - 1) * 1000) / 10 : null;
    const erow = [base[0], base[1], base[2], base[3], base[4], x[3], x[4], x[5], x[6], x[7], allin,
                  cs ? cs.A : null, cs && cs.A && x[7] != null ? Math.round((x[7] / cs.A - 1) * 1000) / 10 : null,
                  d.maxbuy, v, x[13], x[14], x[15], x[16], x[17], x[18], x[19], x[0], x[20], profit, roi, d.sell,
                  tHours, note, tier, RISK_RANK[tier] || 0, x[24] || 0, nimg, x[25] || [], x[2],
                  pc == null ? null : pc, vspc, x[28] || '', x[29] || '', x[30] || [],
                  base[5] == null ? null : Math.round(base[5] / 12 * 10) / 10, cs && cs.k != null ? cs.k : null,
                  null, null, null, null, LIVE.er.length];                     // 42-45 belong to the auction view (auRows)
    erow.um = umOf(x[0], x[31]); erow.lrn = x[32] || '';
    LIVE.er.push(erow);
  });
  $('nsus').textContent = hiddenSus; $('nmm').textContent = tooCheap; $('nlead').textContent = leads;
  alRender();
  applyHelp(live.help);                                 // descriptions and READMEs he rewrote with the pencil
  const markT = (live.alert && live.alert.mark_t) || 0;  // the collector has taken every mark up to this time
  for (const k of Object.keys(MARKS)) if (markT >= MARKS[k].t) delete MARKS[k];
  LIVE.au = auRows(live); $('nau').textContent = LIVE.au.length;
  if (AU_ON()) { auMode(); tables.er.apply(); }
  LIVE.rv = ((live.acct && live.acct.rows) || []).map((r, i) => r.concat([i]));
  tables.rv.apply();
  hitSummary();
  const ac = live.acct || {};
  $('meta-rv').textContent = 'Transaction Report · your own purchases and sales, read from your eBay account' + (ac.linked ? ' · ' + (ac.buys || 0) + ' purchases and ' + (ac.sales || 0) + ' sales on record' + (ac.pulled ? ' · last read ' + ageText(ac.pulled) : '') + (ac.ok === false ? ' · the last read had a problem' : '') : ' · not linked yet');
  LIVE.offers = offerRows(S);
  $('offers-btn').textContent = 'Offer list (' + LIVE.offers.length + ')';
  paintLp();
  const cal = live.calib || {}, c48 = cal.h48 || {}, c24 = cal.h24 || {};
  const calTxt = c48.delta != null ? 'price calibration ' + (c48.delta > 0 ? '+' : '') + c48.delta + '% from ' + c48.n + ' outcomes' + (S.d48 ? ' (applied)' : ' (off)')
                                   : 'price calibration: ' + (c48.n || 0) + ' of 150 outcomes collected — not applied yet';
  $('callab').title = calTxt;
  $('meta-ec').textContent = 'eBay Catalog · data as of ' + live.t.replace('T', ' ').replace('Z', ' UTC') + ' (' + ageText(live.t) + ') · ' +
    live.n_cards.toLocaleString('en-US') + ' cards with data · ' + live.n_open.toLocaleString('en-US') + ' listings being followed · ' + live.n_closed.toLocaleString('en-US') + ' outcomes recorded · ' + live.calls_today + ' API calls today · ' + calTxt + ' · ' + Math.round(S.conf * 100) + '% within ' + S.window + ' h needs λ ≥ ' + lamMin(S).toFixed(2) + '/day · margin ' + Math.round(S.margin * 100) + '% · buy tax ' + (S.tax * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
  $('meta-er').textContent = 'eBay Raw Data · ' + live.n_live.toLocaleString('en-US') + ' matched listings in the last 24 h · ' + passes + ' pass the gate at these settings · ' + hiddenImg + ' left out (fewer than 2 photos) · ' + hiddenSus + ' suspect hidden · ' + tooCheap + ' too cheap vs PriceCharting · ' + leads + ' leads · as of ' + ageText(live.t);
  $('unmatched-btn').textContent = 'Unmatched titles (' + live.unmatched.length + ')';
  tables.ec.apply(); tables.er.apply();
}
async function fetchLive() {
  const res = await fetch(LIVE_URL + '?t=' + Math.floor(Date.now() / 60000), {cache: 'no-store'});
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
}
async function loadLive() {
  if (!LIVE_URL || !HKEY) { $('meta-ec').textContent = 'eBay Catalog · the eBay collector has not published data yet.'; $('meta-er').textContent = 'eBay Raw Data · no live data yet.'; return; }
  try {
    LIVE.data = await fetchLive();
    rebuildLive();
  } catch (e) {
    $('meta-ec').textContent = 'eBay Catalog · live data unavailable (' + e.message + ') — retry with a refresh.';
    $('meta-er').textContent = 'eBay Raw Data · live data unavailable (' + e.message + ').';
  }
  setInterval(refreshLive, 60000);
  setInterval(tickAge, 30000);
}
// the collector publishes every couple of minutes; pick up new data without a reload, and tint what arrived since
async function refreshLive() {
  if (document.hidden || !LIVE.data) return;
  try {
    const d = await fetchLive();
    if (d.t !== LIVE.data.t) { LIVE.prevT = LIVE.data.t; LIVE.data = d; rebuildLive(); }
  } catch (e) { /* keep showing what we have; the next minute retries */ }
}
function tickAge() {
  if (!LIVE.data) return;
  const a = ageText(LIVE.data.t);
  $('meta-ec').textContent = $('meta-ec').textContent.replace(/\(\d+(\.\d+)? (min|h) ago\)/, '(' + a + ')');
  $('meta-er').textContent = $('meta-er').textContent.replace(/as of .*$/, 'as of ' + a);
}
// settings: remembered in this browser; any change re-derives the amber band and the verdicts
try { const sv = JSON.parse(localStorage.getItem('ebay-settings') || '{}'); if (sv.conf) $('conf').value = sv.conf; if (sv.win) $('win').value = sv.win; if (sv.margin != null && sv.v2) $('margin').value = sv.margin; if (sv.buytax != null) $('buytax').value = sv.buytax; if (sv.usecal != null) $('usecal').checked = sv.usecal; if (sv.hits != null) $('hits').checked = sv.hits; } catch (e) {}
['conf', 'win', 'margin', 'buytax', 'usecal', 'hits'].forEach(id => $(id).addEventListener('input', () => {
  try { localStorage.setItem('ebay-settings', JSON.stringify({v2: 1, conf: $('conf').value, win: $('win').value, margin: $('margin').value, buytax: $('buytax').value, usecal: $('usecal').checked, hits: $('hits').checked})); } catch (e) {}
  rebuildLive();
}));

/* Book popup: the competing listings and recent sales behind a card's numbers */
function openBook(cid) {
  const c = LIVE.dec && LIVE.dec[String(cid)], base = idRow.get(cid);
  if (!c || !base) return;
  $('btitle').textContent = base[1];
  $('bsub').textContent = base[2] + ' · #' + base[3];
  const hrsTxt = h => h == null ? '—' : h < 48 ? h.toFixed(0) + ' h' : (h / 24).toFixed(1) + ' d';
  let h = '<div class="sum">';
  const S = settings();
  h += '<span>Anchor <b>' + fmtMoney(c.A) + '</b> <span class="dim">(' + (c.A_n || 0) + ' sales' + (c.A_win ? ', ' + c.A_win + ' d' : '') + (c.A_fast != null ? ', fast-sale median ' + fmtMoneyPlain(c.A_fast) : '') + ')</span></span>';
  h += '<span>λ <b>' + (c.lam == null ? '—' : c.lam.toFixed(2)) + '/day</b> (' + c.k + ' sales in ' + c.D + ' d) · ' + (c.liquid ? '<b class="up">liquid</b>' : '<b class="down">not liquid</b>') + ' <span class="dim">(needs λ ≥ ' + lamMin(S).toFixed(2) + ' for ' + Math.round(S.conf * 100) + '% within ' + S.window + ' h)</span></span>';
  h += '<span>Credible floor <b>' + fmtMoney(c.L) + '</b> <span class="dim">(' + (c.cred ? c.cred.length : 0) + ' credible of ' + c.N + ' open)</span> · Sell <b>' + fmtMoney(c.sell) + '</b></span>';
  h += '<span>Max buy <b>' + fmtMoney(c.maxbuy) + '</b> <span class="dim">net ' + fmtMoneyPlain(c.net) + ' at ' + Math.round(S.margin * 100) + '% margin</span></span>';
  if (c.checks && c.checks.length) h += '<span class="dim">Hot checks failing: ' + esc(c.checks.join(', ')) + '</span>';
  else if (c.hot) h += '<span>' + (c.hot === 2 ? badge('Hot ✓ confirmed', 'hot2') : badge('Hot candidate · ' + c.confirm + '/3 confirmed', 'hot')) + '</span>';
  h += '</div>';
  h += '<h3>Competing raw listings (' + c.N + ' comparable)</h3>';
  if (!c.book.length) h += '<p class="dim">None open right now.</p>';
  else {
    h += '<table><thead><tr><th>Rank</th><th class="num">Total $</th><th class="num">Item $</th><th class="num">Ship $</th><th>Cond</th><th>Offer</th><th class="num">Seller</th><th class="num">Listed</th><th>Title</th></tr></thead><tbody>';
    const credIds = new Set((c.cred || []).map(e => e[0]));
    c.book.forEach((b, i) => {
      h += '<tr' + (credIds.has(b[0]) ? '' : ' class="sus" title="not a credible price-setter: thin seller, watch tier, far under the anchor, or sat too long"') + '><td>' + (i + 1) + (credIds.has(b[0]) ? '' : ' <span class="dim">·</span>') + '</td><td class="num">' + fmtMoney(b[1]) + (b[5] ? ' <span class="dim">(' + fmtMoney(Math.round(b[1] * GATE_LIVE().boHaircut * 100) / 100) + ' ranked)</span>' : '') + '</td><td class="num">' + fmtMoney(b[2]) + '</td><td class="num">' + (b[3] === 0 ? 'free' : fmtMoney(b[3])) + '</td><td>' + (b[4] === 'UNK' ? '<span class="dim">n/s</span>' : b[4]) + '</td><td>' + (b[5] ? 'BO' : '—') + '</td><td class="num">' + fmtInt(b[6]) + (b[7] != null ? ' · ' + b[7].toFixed(1) + '%' : '') + '</td><td class="num">' + hrsTxt(b[8]) + '</td><td class="ttl"><a href="' + esc(b[9]) + '" target="_blank" rel="noopener">' + esc(b[10]) + '</a></td></tr>';
    });
    h += '</tbody></table>';
  }
  h += '<h3>Recent raw sales (newest first)</h3>';
  if (!c.sold.length) h += '<p class="dim">No sales observed yet.</p>';
  else {
    h += '<table><thead><tr><th>Sold</th><th class="num">Total $</th><th class="num">Time to sale</th><th>Cond</th><th>Offer</th><th>Title</th></tr></thead><tbody>';
    c.sold.forEach(s => { h += '<tr><td>' + s[0] + '</td><td class="num">' + fmtMoney(s[1]) + (s[4] ? ' <span class="dim">or less</span>' : '') + '</td><td class="num">' + hrsTxt(s[2]) + '</td><td>' + (s[3] === 'UNK' ? '<span class="dim">n/s</span>' : s[3]) + '</td><td>' + (s[4] ? 'BO' : '—') + '</td><td class="ttl"><a href="' + esc(s[5]) + '" target="_blank" rel="noopener">' + esc(s[6]) + '</a></td></tr>'; });
    h += '</tbody></table>';
  }
  $('bbody').innerHTML = h;
  $('bov').classList.add('open');
}
const GATE_LIVE = () => (LIVE.data && LIVE.data.gate) || {boHaircut: 0.9};
function openScam() {
  const sc = (LIVE.data && LIVE.data.scam) || {tiers: {}, signals: {}, labels: {}, watch: 3, suspect: 5};
  $('btitle').textContent = 'Scam screen';
  $('bsub').textContent = 'score ≥ ' + sc.suspect + ' = suspect (kept out of every statistic, hidden here) · ' + sc.watch + '–' + (sc.suspect - 1) + ' = watch (in the statistics, never alone as a card\'s cheapest copy)';
  const outs = ['sold', 'ended', 'gone', 'stale'];
  const row = (name, c) => { const n = outs.reduce((a, o) => a + (c[o] || 0), 0); return '<tr><td>' + esc(name) + '</td><td class="num">' + n + '</td>' + outs.map(o => '<td class="num">' + (c[o] || 0) + (n ? ' <span class="dim">(' + Math.round(100 * (c[o] || 0) / n) + '%)</span>' : '') + '</td>').join('') + '</tr>'; };
  const head = '<thead><tr><th></th><th class="num">closed</th>' + outs.map(o => '<th class="num">' + o + '</th>').join('') + '</tr></thead>';
  let h = '<p class="dim">How closed listings turned out, by tier and by signal. A signal that fires mostly on listings that later went "gone" (pulled before their end date, usually by eBay) is earning its points; one that fires on listings that sold normally is catching honest sellers. Thresholds are tuned by hand from this table once the counts are large enough to mean something.</p>';
  h += '<h3>By tier</h3><table>' + head + '<tbody>' + ['clean', 'watch', 'suspect'].map(t => row(t, sc.tiers[t] || {})).join('') + '</tbody></table>';
  const keys = Object.keys(sc.labels || {});
  h += '<h3>By signal</h3><table>' + head + '<tbody>' + keys.map(k => row(sc.labels[k], sc.signals[k] || {})).join('') + '</tbody></table>';
  const deals = (LIVE.data && LIVE.data.deals) || [];
  if (deals.length) {
    h += '<h3>How fast cheap listings go</h3><p class="dim">Closed listings by their price relative to the card\'s anchor when first seen. This is the measurement behind the hit-rate question: if listings at 60\u201370% of the anchor vanish within an hour, the scanner has to be faster; if they sit, they were cheap for a reason.</p>';
    h += '<table><thead><tr><th>Price vs anchor</th><th class="num">closed</th><th class="num">sold</th><th class="num">\u2264 1 h</th><th class="num">\u2264 6 h</th><th class="num">\u2264 24 h</th><th class="num">\u2264 48 h</th><th class="num">median h to sale</th></tr></thead><tbody>' +
      deals.map(b => '<tr><td>' + Math.round(b.lo * 100) + '\u2013' + Math.round(b.hi * 100) + '%</td><td class="num">' + b.n + '</td><td class="num">' + b.sold + '</td><td class="num">' + b.sold_1h + '</td><td class="num">' + b.sold_6h + '</td><td class="num">' + b.sold_24h + '</td><td class="num">' + b.sold_48h + '</td><td class="num">' + (b.med_hrs == null ? '\u2014' : b.med_hrs) + '</td></tr>').join('') + '</tbody></table>';
  }
  const sus = LIVE.er.filter(r => r[29] === 'suspect');
  h += '<h3>Suspect listings right now (' + sus.length + ')</h3>';
  if (!sus.length) h += '<p class="dim">None.</p>';
  else h += '<table><thead><tr><th>Title</th><th class="num">Total $</th><th class="num">Card price $</th><th class="num">Seller fb</th><th class="num">Score</th><th>Why</th></tr></thead><tbody>' +
    sus.map(r => '<tr><td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener">' + esc(r[6]) + '</a></td><td class="num">' + fmtMoney(r[9]) + '</td><td class="num">' + fmtMoney(r[11]) + '</td><td class="num">' + fmtInt(r[17]) + (r[18] != null ? ' · ' + r[18].toFixed(1) + '%' : '') + '</td><td class="num">' + r[31] + '</td><td>' + esc((r[33] || []).map(c => (sc.labels || {})[c] || c).join(' · ')) + '</td></tr>').join('') + '</tbody></table>';
  $('bbody').innerHTML = h;
  $('bov').classList.add('open');
}
$('scam-btn').addEventListener('click', openScam);
// Offer list: open copies that accept Best Offer where an accepted offer at this listing's Max buy is within reach.
// Built from each card's cheapest copies (book), so it covers listings of any age, not only the last 24 hours.
const OFFER_MAX_OFF = 0.30;                             // do not list offers more than 30% under the asking price
function offerRows(S) {
  const out = [];
  for (const [cid, c] of Object.entries(LIVE.dec || {})) {
    const base = idRow.get(+cid); if (!base) continue;
    const judged = c.A != null && (c.A_n || 0) >= S.minSales && c.liquid;
    for (const b of (c.book || [])) {                   // [id, total, item, ship, cond, best offer, fb, pct, hours listed, url, title]
      if (!b[5] || !COMPARABLE.has(b[4]) || b[2] == null || sellerBar(b[6], b[7]) != null) continue;
      const x = []; x[0] = b[0]; x[1] = +cid; x[5] = b[2]; x[7] = b[1]; x[13] = b[4];
      const d = judged ? listingDecide(x, c, S) : (c.A == null || (c.A_n || 0) < S.minSales) ? leadDecide(x, c, S) : null;
      if (!d || d.maxbuy == null) continue;
      if (judged && b[1] < S.review * c.A) continue;    // far under the anchor: a review case, not an offer
      const ship = b[3] || 0, offer = Math.floor((d.maxbuy - ship) / (1 + S.tax));     // the item price to offer, whole dollars
      const off = 1 - offer / b[2];
      if (offer <= 0 || off <= 0 || off > OFFER_MAX_OFF) continue;
      const allin = offer * (1 + S.tax) + ship;
      out.push({base, b, offer, off, judged, sell: d.sell, profit: Math.round((d.net - allin) * 100) / 100, ref: judged ? c.A : base[6]});
    }
  }
  return out.sort((p, q) => p.off - q.off);
}
function openOffers() {
  const rows = (LIVE.offers || []).slice(0, 300), S = settings();
  const age = h => h == null ? '\u2014' : h < 48 ? h.toFixed(0) + ' h' : (h / 24).toFixed(0) + ' d';
  $('btitle').textContent = 'Offer list';
  $('bsub').textContent = (LIVE.offers || []).length + ' open listings that take offers, where an accepted offer at Max buy is at most ' + Math.round(OFFER_MAX_OFF * 100) + '% under the asking price \u00b7 smallest ask first';
  let h = '<p class="dim">Offer = the item price that lands you exactly at this listing\'s Max buy (your ' + Math.round(S.margin * 100) + '% margin after fees' + (S.tax ? ' and ' + (S.tax * 100).toFixed(2) + '% tax' : '') + '). You send the offers yourself on eBay, and an accepted offer is binding: open the listing and check the photos first. Sellers usually take a few percent off; the further down the list, the longer the shot. Listings that have sat for days are the likeliest to bend. "PC lead" rows are priced from PriceCharting because eBay has too few sales for that card - treat them with more care.</p>';
  if (!rows.length) h += '<p>None right now.</p>';
  else h += '<table><thead><tr><th>Card</th><th>Listing</th><th class="num">Ask $</th><th class="num">Offer $</th><th class="num">Off</th><th class="num">Ship $</th><th class="num">Listed</th><th class="num">Seller</th><th>Basis</th><th class="num">Sell $</th><th class="num">Profit $</th></tr></thead><tbody>' +
    rows.map(o => '<tr><td>' + esc(o.base[1]) + '<br><span class="dim">' + esc(o.base[2]) + '</span></td><td class="ttl"><a href="' + esc(o.b[9] || '#') + '" target="_blank" rel="noopener">' + esc(o.b[10] || '') + '</a></td><td class="num">' + fmtMoney(o.b[2]) + '</td><td class="num"><b>' + fmtMoney(o.offer) + '</b></td><td class="num">' + (o.off * 100).toFixed(0) + '%</td><td class="num">' + fmtMoney(o.b[3] || 0) + '</td><td class="num">' + age(o.b[8]) + '</td><td class="num">' + fmtInt(o.b[6]) + (o.b[7] != null ? ' \u00b7 ' + o.b[7].toFixed(1) + '%' : '') + '</td><td>' + (o.judged ? 'eBay sales <span class="dim">(anchor ' + fmtMoneyPlain(o.ref) + ')</span>' : badge('PC lead', 'hot') + ' <span class="dim">(' + fmtMoneyPlain(o.ref) + ')</span>') + '</td><td class="num">' + fmtMoney(o.sell) + '</td><td class="num">' + fmtMoney(o.profit) + '</td></tr>').join('') + '</tbody></table>';
  $('bbody').innerHTML = h;
  $('bov').classList.add('open');
}
$('offers-btn').addEventListener('click', openOffers);
$('rows-ec').addEventListener('click', e => {
  const b = e.target.closest('.bbtn'); if (b) return openBook(+b.dataset.id);
  const t = e.target.closest('.ebtn'); if (t) openTrendEbay(+t.dataset.id);
});
$('bclose').addEventListener('click', () => $('bov').classList.remove('open'));
$('bov').addEventListener('click', e => { if (e.target === $('bov')) $('bov').classList.remove('open'); });
$('unmatched-btn').addEventListener('click', () => {
  const u = (LIVE.data && LIVE.data.unmatched) || [];
  $('htitle').textContent = 'Unmatched titles (last 24 h)';
  $('hbody').innerHTML = '<p class="dim">Listings the title parser could not tie to one catalog card, with the reason. Useful for spotting patterns to teach it.</p>' +
    (u.length ? '<table style="min-width:0;width:100%;font-size:12px"><tbody>' + u.slice().reverse().map(x => '<tr><td class="ttl"><a href="' + esc(x[4]) + '" target="_blank" rel="noopener">' + esc(x[2]) + '</a></td><td class="num">' + fmtMoney(x[3]) + '</td><td class="dim">' + esc(x[5]) + '</td></tr>').join('') + '</tbody></table>' : '<p>None.</p>');
  $('hov').classList.add('open');
});

/* ---------------- Trend popup ---------------- */
const HKEY = '__HKEY__', SHARD_SIZE = __SHARD__;
const shardCache = new Map();
const hex2bytes = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
window.loadShard = async function (n) {
  if (shardCache.has(n)) return shardCache.get(n);
  if (!HKEY) throw new Error('No history has been built yet.');
  const res = await fetch('history/s' + n + '.bin', {cache: 'no-store'});
  if (!res.ok) throw new Error('No history file for this card yet.');
  const buf = new Uint8Array(await res.arrayBuffer());
  const key = await crypto.subtle.importKey('raw', hex2bytes(HKEY), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: buf.slice(0, 12)}, key, buf.slice(12));
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const data = JSON.parse(text);
  shardCache.set(n, data);
  return data;
};

const COLORS = {loose: '#3b82f6', sell: '#22c55e', buy: '#f59e0b', vol: '#9ca3af', ref: '#a78bfa'};
const LABEL_PC = {loose: 'Ungraded', sell: 'Retail sell', buy: 'Retail buy', vol: 'Sales/yr', ref: '90d high/low + conservative sell'};
const LABEL_EB = {loose: 'Sold median (7d)', sell: 'Cheapest ask', buy: '', vol: 'Sales/day', ref: '90d high/low + Sell'};
let LABEL = LABEL_PC;
let cur = null;               // {dates, vol, loose, sell, buy, st, anchor, refs, labels}
let pts = [];
function setChartLabels(lab) {
  LABEL = lab;
  $('l-loose').textContent = lab.loose + ' $'; $('l-sell').textContent = lab.sell + ' $'; $('l-buy').textContent = lab.buy ? lab.buy + ' $' : '';
  $('l-buy').parentElement.style.display = lab.buy ? '' : 'none';
  $('l-vol').textContent = lab.vol + ' (left axis)'; $('l-ref').textContent = lab.ref;
}

// eBay history: same chart, series from the collector's daily rollup
function openTrendEbay(cid) {
  const c = LIVE.dec && LIVE.dec[String(cid)], base = idRow.get(cid);
  if (!c || !base) return;
  setChartLabels(LABEL_EB);
  $('mtitle').textContent = base[1];
  $('msub').textContent = base[2] + ' · #' + base[3] + ' · eBay raw sales';
  $('note').textContent = ''; $('stats').innerHTML = ''; $('gate').innerHTML = ''; $('chart').innerHTML = '';
  $('ov').classList.add('open');
  const h = c.hist, t = c.tr;
  if (!h || !t) { cur = null; $('note').textContent = 'No eBay sales recorded for this card yet. The rollup adds one point per day.'; return; }
  const dates = h.sales.map((_, k) => { const d = new Date(Date.parse(h.start + 'T00:00:00Z') + k * 86400000); return d.toISOString().slice(0, 10); });
  cur = {dates, vol: h.sales, loose: h.price, sell: h.ask, buy: h.sales.map(() => null), st: t, anchor: c.price,
         refs: [['90d high', t.hi], ['90d low', t.lo], ['Sell', c.sell]], ebay: c};
  drawChart(); renderStatsEbay();
}
function renderStatsEbay() {
  const s = cur.st, c = cur.ebay;
  const cell = (k, v, d) => '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  let h = '';
  h += cell('Sales/month', s.spm == null ? '—' : s.spm, 'raw sales in the last 30 days');
  h += cell('Δ 7d', fmtPct(s.d7), 'vs 7 days ago');
  h += cell('Δ 30d', fmtPct(s.d30), s.days < 30 ? 'needs 30 days (' + s.days + ' so far)' : 'vs 30 days ago');
  h += cell('Range 90d', pctPlain(s.pos, 0, false), s.lo != null ? 'low ' + fmtMoneyPlain(s.lo) + ' · high ' + fmtMoneyPlain(s.hi) : 'needs 60 days (' + s.days + ' so far)');
  h += cell('Volatility', pctPlain(s.vol, 2, false), 'typical daily move of the 7d median');
  h += cell('Volume drift 30d', s.vd == null ? '—' : (s.vd > 0 ? '+' : '') + s.vd + (s.vdp == null ? '' : ' (' + pctPlain(s.vdp) + ')'), s.days < 60 ? 'needs 60 days (' + s.days + ' so far)' : 'last 30 days vs the 30 before');
  h += cell('Slope 30d', pctPlain(s.ts), s.ts != null ? 'Theil–Sen · middle half ' + pctPlain(s.tsq1) + ' to ' + pctPlain(s.tsq3) + ' /mo' : 'needs 30 days and 10 points');
  h += cell('λ', c.lam == null ? '—' : c.lam.toFixed(2) + '/day', c.k + ' sales in ' + c.D + ' d');
  h += cell('Sell · Anchor', fmtMoneyPlain(c.sell) + ' · ' + fmtMoneyPlain(c.A), 'floor ' + fmtMoneyPlain(c.L) + ' · ' + (c.liquid ? 'liquid' : 'not liquid'));
  h += cell('Max buy', fmtMoneyPlain(c.maxbuy), 'net ' + fmtMoneyPlain(c.net));
  $('stats').innerHTML = h;
  $('gate').innerHTML = '<p class="why">Price line = median of raw sale totals over a trailing 7-day window (blank when fewer than 3 sales in the window). Bars = sales that day. History starts the day the collector was switched on; the trend columns fill in at 7 / 30 / 60 days like the PriceCharting tab.</p>';
}

async function openTrend(i) {
  const r = DATA[i];
  setChartLabels(LABEL_PC);
  $('mtitle').textContent = r[1];
  $('msub').textContent = r[2] + ' · #' + r[3] + (r[4] ? ' · released ' + r[4] : '');
  $('note').textContent = ''; $('stats').innerHTML = ''; $('gate').innerHTML = '';
  $('chart').innerHTML = '';
  $('ov').classList.add('open');
  try {
    const sh = await window.loadShard(Math.floor(i / SHARD_SIZE));
    const c = sh.c[String(r[0])];
    if (!c) throw new Error('No history for this card yet.');
    const nul = v => v < 0 ? null : v, cents = v => v < 0 ? null : v / 100;
    cur = {dates: sh.d, vol: c[0][0].map(nul), loose: c[0][1].map(cents), buy: c[0][2].map(cents), sell: c[0][3].map(cents), st: c[1], anchor: r[6],
           refs: [['90d high', c[1].hi], ['90d low', c[1].lo], ['conservative sell', c[1].csell]]};
    drawChart(); renderStats();
  } catch (e) {
    cur = null;
    $('note').textContent = e.message + ' The site adds one point per card every morning.';
  }
}
function closeTrend() { $('ov').classList.remove('open'); $('tip').style.display = 'none'; }

function rangePoints() {
  const all = cur.dates.map((d, k) => ({d, t: Date.parse(d + 'T00:00:00Z'), vol: cur.vol[k], loose: cur.loose[k], sell: cur.sell[k], buy: cur.buy[k]}));
  if (document.querySelector('input[name=rng]:checked').value === 'all') return all;
  const n = Math.max(1, +$('rn').value || 1), unit = +$('ru').value;
  const cutoff = all[all.length - 1].t - (n * unit - 1) * 86400000;     // "last 30 days" = 30 points
  return all.filter(p => p.t >= cutoff);
}

function drawChart() {
  const svg = $('chart');
  svg.innerHTML = '';
  if (!cur) return;
  pts = rangePoints();
  const on = {loose: $('c-loose').checked, sell: $('c-sell').checked, buy: $('c-buy').checked, vol: $('c-vol').checked, ref: $('c-ref').checked};
  const W = svg.clientWidth || 900, H = 380, L = 56, R = 64, T = 18, B = 42;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const iw = W - L - R, ih = H - T - B, n = pts.length;
  const x = k => n === 1 ? L + iw / 2 : L + iw * k / (n - 1);
  const money = ['loose', 'sell', 'buy'].filter(s => on[s]);
  const refs = on.ref ? (cur.refs || []).filter(([, v]) => v != null) : [];
  let pmax = 0, vmax = 0;
  pts.forEach(p => { money.forEach(s => { if (p[s] != null) pmax = Math.max(pmax, p[s]); }); if (p.vol != null) vmax = Math.max(vmax, p.vol); });
  refs.forEach(([, v]) => pmax = Math.max(pmax, v));
  pmax = pmax > 0 ? pmax * 1.08 : 1; vmax = vmax > 0 ? vmax * 1.15 : 1;
  const yP = v => T + ih - ih * v / pmax, yV = v => T + ih - ih * v / vmax;
  const el = (tag, at, txt) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
  const nice = m => { const s = Math.pow(10, Math.floor(Math.log10(m / 4))); const c = [1, 2, 2.5, 5, 10].find(c => c * s * 4 >= m); return c * s; };
  const mstep = nice(pmax), vstep = nice(vmax);
  for (let v = 0; v <= pmax; v += mstep) {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: 'currentColor', 'stroke-opacity': .12});
    if (money.length || refs.length) el('text', {x: W - R + 6, y: yP(v) + 4, 'font-size': 11, fill: 'currentColor', opacity: .7}, '$' + (mstep < 1 ? v.toFixed(2) : v.toLocaleString('en-US')));
  }
  if (on.vol) for (let v = 0; v <= vmax; v += vstep) el('text', {x: L - 6, y: yV(v) + 4, 'font-size': 11, fill: 'currentColor', opacity: .7, 'text-anchor': 'end'}, Math.round(v).toLocaleString('en-US'));
  el('line', {x1: L, x2: W - R, y1: T + ih, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .35});
  const ticks = Math.min(n, Math.max(2, Math.floor(iw / 110)));
  for (let k = 0; k < ticks; k++) {
    const i = Math.round(k * (n - 1) / Math.max(1, ticks - 1));
    el('text', {x: x(i), y: H - 14, 'font-size': 11, fill: 'currentColor', opacity: .75, 'text-anchor': 'middle'}, pts[i].d);
  }
  el('text', {x: L - 6, y: 12, 'font-size': 10, fill: 'currentColor', opacity: .6, 'text-anchor': 'end'}, on.vol ? LABEL.vol.toLowerCase() : '');
  el('text', {x: W - R + 6, y: 12, 'font-size': 10, fill: 'currentColor', opacity: .6}, (money.length || refs.length) ? 'USD' : '');
  if (on.vol) {
    const bw = Math.max(2, Math.min(18, iw / Math.max(1, n) * 0.6));
    pts.forEach((p, k) => { if (p.vol != null) el('rect', {x: x(k) - bw / 2, y: yV(p.vol), width: bw, height: T + ih - yV(p.vol), fill: COLORS.vol, opacity: .55}); });
  }
  refs.forEach(([name, v]) => {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: COLORS.ref, 'stroke-width': 1.3, 'stroke-dasharray': '6 4', opacity: .9});
    el('text', {x: L + 4, y: yP(v) - 3, 'font-size': 10, fill: COLORS.ref}, name + ' ' + fmtMoneyPlain(v));
  });
  money.forEach(s => {
    let d = '', pen = false;
    pts.forEach((p, k) => { if (p[s] == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(k) + ' ' + yP(p[s]) + ' '; pen = true; });
    el('path', {d, fill: 'none', stroke: COLORS[s], 'stroke-width': 2.2, 'stroke-linejoin': 'round'});
    if (n <= 60) pts.forEach((p, k) => { if (p[s] != null) el('circle', {cx: x(k), cy: yP(p[s]), r: 3, fill: COLORS[s]}); });
  });
  const cross = el('line', {x1: 0, x2: 0, y1: T, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .5, 'stroke-dasharray': '4 3', visibility: 'hidden'});
  const hit = el('rect', {x: L, y: T, width: iw, height: ih, fill: 'transparent'});
  const tip = $('tip');
  const move = ev => {
    const box = svg.getBoundingClientRect();
    const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - box.left;
    const px = cx * W / box.width;
    const k = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - L) / iw * (n - 1))));
    const p = pts[k];
    cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.setAttribute('visibility', 'visible');
    let h = '<b>' + p.d + '</b>';
    if (on.vol) h += '<br><span class="sw" style="background:' + COLORS.vol + '"></span>' + LABEL.vol + ': ' + (p.vol == null ? '—' : p.vol.toLocaleString('en-US'));
    money.forEach(s => { h += '<br><span class="sw" style="background:' + COLORS[s] + '"></span>' + LABEL[s] + ': ' + fmtMoney(p[s]); });
    tip.innerHTML = h;
    const left = x(k) * box.width / W;
    tip.style.display = 'block';
    tip.style.left = (left + 12 + tip.offsetWidth > box.width ? left - tip.offsetWidth - 12 : left + 12) + 'px';
    tip.style.top = Math.max(0, ((ev.touches ? ev.touches[0].clientY : ev.clientY) - box.top - 28)) + 'px';
  };
  hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', ev => { move(ev); ev.preventDefault(); }, {passive: false}); hit.addEventListener('touchstart', move, {passive: true});
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  $('note').textContent = n === 1 ? '1 day of history so far — a new point is added every day.' : n + ' days shown' + (on.vol && LABEL === LABEL_PC ? ' · sales/yr is PriceCharting\u2019s trailing twelve-month count on that day' : '');
}
const fmtMoneyPlain = v => v == null ? '—' : '$' + v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pctPlain = (v, nd = 1, signed = true) => v == null ? '—' : (signed && v > 0 ? '+' : '') + v.toFixed(nd) + '%';

function renderStats() {
  const s = cur.st, A = cur.anchor;
  const cell = (k, v, d) => '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  let h = '';
  h += cell('Δ 7d', fmtPct(s.d7), 'vs 7 days ago');
  h += cell('Δ 30d', fmtPct(s.d30), 'vs 30 days ago');
  h += cell('Δ 90d', fmtPct(s.d90), 'vs 90 days ago');
  h += cell('Range 90d', pctPlain(s.pos, 0, false), s.lo != null ? 'low ' + fmtMoneyPlain(s.lo) + ' · high ' + fmtMoneyPlain(s.hi) : 'needs 60 days');
  h += cell('Stale', s.stale == null ? '—' : (s.staleMin ? '≥ ' : '') + s.stale + ' d', s.staleMin ? 'no raw price move seen yet' : 'days since the raw price moved');
  h += cell('Raw sale every', s.gap == null ? '—' : s.gap + ' d', 'median gap between price moves (90d)');
  h += cell('Volatility', pctPlain(s.vol, 2, false), 'typical move when it moves');
  h += cell('Volume drift 30d', s.vd == null ? '—' : (s.vd > 0 ? '+' : '') + s.vd + ' (' + pctPlain(s.vdp) + ')', 'last 30 days vs same 30 days a year ago');
  h += cell('Slope 30d', pctPlain(s.ts), s.ts != null ? 'Theil–Sen · middle half ' + pctPlain(s.tsq1) + ' to ' + pctPlain(s.tsq3) + ' /mo' : 'needs 10 points');
  $('stats').innerHTML = h;

  // gate math
  if (A == null || s.csell == null) { $('gate').innerHTML = '<h3>Buy gate</h3><p class="why">No ungraded price for this card, so there is nothing to anchor to.</p>'; return; }
  const assumed = [];
  if (s.gap == null) assumed.push('days between raw sales = ' + GATE.gapFallback + ' (no history yet)');
  if (s.vol == null) assumed.push('volatility = ' + GATE.volFallback + '% (no history yet)');
  if (s.ts == null) assumed.push('slope = 0 (no history yet)');
  const row = (label, val, why, big) => '<tr' + (big ? ' class="big"' : '') + '><td>' + label + '</td><td class="n">' + val + '</td><td class="why">' + (why || '') + '</td></tr>';
  let g = '<h3>Buy gate for this card</h3><table>';
  g += row('Anchor (ungraded)', fmtMoneyPlain(A), 'PriceCharting ungraded price today');
  g += row('Expected hold', s.hold.toFixed(0) + ' days', GATE.holdMult + ' × ' + s.gap_used + ' days between raw sales');
  g += row('Drift over the hold', '× ' + s.drift.toFixed(4), 'e^(slope × days), slope ' + (s.slope_used * 100).toFixed(3) + '%/day — only a falling trend counts');
  g += row('Volatility cushion', '× ' + s.cushion.toFixed(4), '1 − 2 × ' + s.vol_used.toFixed(2) + '% (two typical moves against you)');
  g += row('Conservative sell', fmtMoneyPlain(s.csell), fmtMoneyPlain(A) + ' × ' + s.drift.toFixed(4) + ' × ' + s.cushion.toFixed(4), true);
  g += row('eBay fee', '− ' + fmtMoneyPlain(s.csell * GATE.fee + GATE.fixed), pct(GATE.fee) + ' + $' + GATE.fixed.toFixed(2));
  g += row('Shipping out', '− ' + fmtMoneyPlain(GATE.shipOut), 'tracked');
  g += row('Net proceeds', fmtMoneyPlain(s.net), '', true);
  g += row('Max buy, all-in', fmtMoneyPlain(s.maxbuy), 'net ÷ (1 + ' + pct(GATE.margin) + ' margin) — item + shipping + tax must be at or below this', true);
  g += row('≈ max item price', s.maxitem > 0 ? fmtMoneyPlain(s.maxitem) : '—', 'if the seller charges $' + GATE.shipIn.toFixed(2) + ' shipping and tax is ' + pct(GATE.tax));
  g += '</table>';
  if (s.maxitem != null && s.maxitem <= 0) g += '<p class="why">Fees, shipping and tax eat everything this card can net at your margin — there is no listing price that makes it a trade. This is why cheap cards rarely pass.</p>';
  if (assumed.length) g += '<p class="why">Assumed until the history fills in: ' + assumed.join('; ') + '.</p>';
  $('gate').innerHTML = g;
}
$('rows-pc').addEventListener('click', e => { const b = e.target.closest('.tbtn'); if (b) openTrend(+b.dataset.i); });
$('close').addEventListener('click', closeTrend);
$('ov').addEventListener('click', e => { if (e.target === $('ov')) closeTrend(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeTrend(); $('hov').classList.remove('open'); $('bov').classList.remove('open'); $('rov').classList.remove('open'); } });
['c-loose', 'c-sell', 'c-buy', 'c-vol', 'c-ref', 'rn', 'ru'].forEach(id => $(id).addEventListener('input', drawChart));
document.querySelectorAll('input[name=rng]').forEach(r => r.addEventListener('change', drawChart));
window.addEventListener('resize', () => { if ($('ov').classList.contains('open')) drawChart(); });
paintLp();
loadLive();

/* ---------------- Notification Settings tab ----------------
   The numbers here decide what the collector sends to the phone. Save posts them to a private channel the collector
   reads every minute (its name and the key that signs each message both come from the site key, so only this
   unlocked page and the collector can use it); the collector reports what it is using in the live file (live.alert). */
const AL_DEFAULT = {margin: 10, tax: 6.25, conf: 70, window: 48, min_profit: 0, pmin: 25, pmax: 500, hits: true, leads: false, watch: true, suspects: false, auctions: true, quiet: false, q_from: 23, q_to: 7};
const AL_NUM = {margin: 'al-margin', tax: 'al-tax', conf: 'al-conf', window: 'al-win', min_profit: 'al-minprofit', pmin: 'al-pmin', pmax: 'al-pmax', q_from: 'al-q1', q_to: 'al-q2'};
const AL_BOX = {hits: 'al-hits', leads: 'al-leads', watch: 'al-watch', suspects: 'al-suspects', auctions: 'al-auctions', quiet: 'al-quiet'};
const AL = {filled: false, pending: 0, test: 0, note: '', cls: ''};
function alRead() {
  const c = {};
  for (const k in AL_NUM) { const v = parseFloat($(AL_NUM[k]).value); c[k] = isNaN(v) ? AL_DEFAULT[k] : v; }
  for (const k in AL_BOX) c[k] = $(AL_BOX[k]).checked;
  return c;
}
function alFill(c) {
  c = Object.assign({}, AL_DEFAULT, c || {});
  for (const k in AL_NUM) $(AL_NUM[k]).value = c[k];
  for (const k in AL_BOX) $(AL_BOX[k]).checked = !!c[k];
}
const alSame = (a, b) => Object.keys(AL_DEFAULT).every(k => String(a[k]) === String(b[k]));
// the gate with the Notification Settings numbers in place of the boxes at the top of the page
function alS(c) {
  return Object.assign({}, settings(), {conf: Math.min(0.95, Math.max(0.5, c.conf / 100)), window: Math.min(168, Math.max(24, c.window)),
                                         margin: Math.min(0.5, Math.max(0, c.margin / 100)), tax: Math.min(0.15, Math.max(0, c.tax / 100))});
}
// the last 24 hours of listings that these numbers would have sent to the phone
function alMatches(c) {
  const live = LIVE.data, out = [];
  if (!live) return out;
  const S = alS(c), dec = {};
  for (const x of live.live || []) {
    const cid = String(x[1]);
    if (!(cid in dec)) dec[cid] = live.cards[cid] ? Object.assign({}, live.cards[cid], decide(live.cards[cid], S)) : null;
    const sus = (x[23] || 'clean') === 'suspect';             // hidden from the gate; counted only with the Suspects switch on
    if (sus && (!c.suspects || (x[25] || []).includes('dup'))) continue;
    let xx = x; if (sus) { xx = x.slice(); xx[23] = 'clean'; }
    const [v, allin, d] = verdictOf(xx, dec[cid], S);
    const kind = v === 'PASS' && c.hits ? 'hit' : v === 'LEAD' && c.leads ? 'lead' : null;
    if (!kind || ((x[23] || 'clean') === 'watch' && !c.watch) || x[7] < c.pmin || x[7] > c.pmax) continue;
    const dd = d || listingDecide(x, dec[cid], S);
    if (!dd || dd.net == null) continue;
    const profit = Math.round((dd.net - allin) * 100) / 100;
    if (profit < c.min_profit) continue;
    out.push({x, kind, sus, profit, roi: profit / allin * 100, base: idRow.get(x[1]) || []});
  }
  return out.sort((a, b) => b.profit - a.profit);
}
function alDescribe(c) {
  return 'margin <b>' + c.margin + '%</b> · buy tax <b>' + c.tax + '%</b> · sells within <b>' + c.window + ' h</b> at <b>' + c.conf + '%</b> confidence<br>' +
    'profit at least <b>$' + c.min_profit + '</b> · buy price <b>$' + c.pmin + '</b> to <b>$' + c.pmax + '</b><br>' +
    'hits <b>' + (c.hits ? 'on' : 'off') + '</b> · leads <b>' + (c.leads ? 'on' : 'off') + '</b> · scam-watch listings <b>' + (c.watch ? 'included' : 'left out') + '</b> · suspects <b>' + (c.suspects ? 'alerted' : 'blocked') + '</b> · auctions <b>' + (c.auctions ? 'on' : 'off') + '</b> · quiet hours <b>' + (c.quiet ? c.q_from + ':00 to ' + c.q_to + ':00' : 'off') + '</b>';
}
function alRender() {
  const live = LIVE.data, a = live && live.alert;
  if (!live) return;
  if (!AL.filled) { alFill(a && a.cfg); AL.filled = true; }
  const mine = alRead(), saved = a && a.cfg ? Object.assign({}, AL_DEFAULT, a.cfg) : null;
  const clock = t => new Date(t).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  if (!a) $('al-now').innerHTML = 'The collector has not reported its alert settings yet. It does so a few minutes after it updates.';
  else $('al-now').innerHTML = 'Phone alerts are <b>' + (a.on ? 'on' : 'off: no phone channel is set on the collector') + '</b>' + (a.quiet_now ? ' (quiet hours right now)' : '') + '.<br>' +
    alDescribe(saved) + '<br>' + (a.t ? 'Last change from this tab: <b>' + new Date(a.t).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) + '</b>' : 'Never changed from this tab: these are the starting values') +
    '<br>Alerts sent in the last 24 hours: <b>' + (a.sent24 || 0) + '</b>' + (a.last ? ' · last one ' + ageText(a.last) : '');
  if (AL.pending && a && a.t >= AL.pending) { AL.pending = 0; AL.note = 'Saved. The collector confirmed at ' + clock(Date.now()) + '.'; AL.cls = 'ok'; }
  if (AL.test && a && a.test_t >= AL.test) { AL.test = 0; AL.note = 'Test alert sent to your phone at ' + clock(Date.now()) + '.'; AL.cls = 'ok'; }
  const dirty = saved ? !alSame(mine, saved) : false;
  $('al-save').classList.toggle('dirty', dirty && !AL.pending);
  $('al-status').className = 'al-status ' + (AL.note ? AL.cls : dirty ? 'warn' : '');
  $('al-status').textContent = AL.note || (dirty ? 'Not saved yet: the collector is still using the numbers on the right.' : '');
  $('al-hist').innerHTML = alHistory(a);
  $('al-wrong').innerHTML = alWrong(a);
  const m = alMatches(mine), hits = m.filter(r => r.kind === 'hit').length;
  $('al-pre').innerHTML = 'With the numbers on the left, <b>' + m.length + '</b> listing' + (m.length === 1 ? '' : 's') + ' from the last 24 hours would have been sent' +
    (m.length ? ' (' + hits + ' hit' + (hits === 1 ? '' : 's') + ', ' + (m.length - hits) + ' lead' + (m.length - hits === 1 ? '' : 's') + ').' : '.') +
    (m.length ? '<table><thead><tr><th>Card</th><th>Listing</th><th class="num">Total</th><th class="num">Profit</th><th class="num">ROI</th><th>Kind</th><th>Now</th></tr></thead><tbody>' +
      m.slice(0, 40).map(r => '<tr><td>' + esc(r.base[1] || '') + '<br><span class="dim">' + esc(r.base[2] || '') + '</span></td><td><a href="' + esc(r.x[18] || '#') + '" target="_blank" rel="noopener">' + esc(r.x[4] || '') + '</a></td><td class="num">' + fmtMoney(r.x[7]) + '</td><td class="num">' + fmtMoney(r.profit) + '</td><td class="num">' + r.roi.toFixed(0) + '%</td><td>' + badge(r.kind === 'hit' ? 'hit' : 'lead', r.kind === 'hit' ? 'pass' : 'hot') + (r.sus ? ' ' + badge('suspect', 'warn') : '') + '</td><td>' + esc(r.x[17] || '') + '</td></tr>').join('') + '</tbody></table>' : '');
}
// what was sent, what you answered on the phone, and what became of the listing
// clean listings he answered "No, not the same card" to: the matcher's test cases (kept a year by the collector)
function alWrong(a) {
  const w = (a && a.wrong) || [];
  const lr = (a && a.learned) || {words: [], titles: 0, sellers: 0};
  const learned = '<br><span class="dim">Learned so far: ' + lr.titles + ' seller\'s title' + (lr.titles === 1 ? '' : 's') + ' never filed under that card again, ' + lr.sellers + ' seller-and-card pair' + (lr.sellers === 1 ? '' : 's') + ' held back, warning words: ' + (lr.words.length ? lr.words.map(x => '<b>' + esc(x[0]) + '</b> (' + x[1] + ')').join(', ') : 'none yet (a word needs to be in 3 of your mismatches and rare everywhere else)') + '.</span>';
  if (!w.length) return 'None yet. A "No" on the phone for a listing the scam screen had not flagged, or a Mismatch tick on the Raw Data tab, lands here.';
  const when = t => new Date(t).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  return '<b>' + w.length + '</b> listing' + (w.length === 1 ? '' : 's') + ' you said did not show the matched card.' + learned +
    '<table><thead><tr><th>When</th><th>eBay listing</th><th>Was matched to</th><th>Kind</th></tr></thead><tbody>' +
    w.slice(0, 200).map(r => '<tr><td>' + when(r[0]) + '</td><td><a href="' + esc(r[3] || '#') + '" target="_blank" rel="noopener">' + esc(r[2] || r[1]) + '</a></td><td>' +
      (r[6] ? '<a href="https://www.pricecharting.com/game/' + esc(r[6]) + '" target="_blank" rel="noopener">' + esc(r[4] || (idRow.get(r[6]) || [])[1] || 'card ' + r[6]) + '</a>' : esc(r[4] || '')) +
      ((r[5] || (idRow.get(r[6]) || [])[2]) ? '<br><span class="dim">' + esc(String(r[5] || (idRow.get(r[6]) || [])[2]).replace('Pokemon ', '')) + '</span>' : '') + '</td><td>' + esc(String(r[7] || '').replace('-drop', ', price drop').replace('-lead', ', lead')) + '</td></tr>').join('') + '</tbody></table>';
}

function alHistory(a) {
  const h = (a && a.hist) || [];
  if (!h.length) return 'No alerts sent yet. Each one will be listed here with your answer and what happened to the listing.';
  const ans = {nm: 'Yes, near mint', lp: 'Yes, lightly played', no: 'No', yes: 'Same card, no condition picked'}, said = h.filter(r => r[7]), no = said.filter(r => r[7] === 'no').length;
  const when = t => new Date(t).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  const fate = r => r[8] === 'open' ? 'still listed' : r[8] === 'sold' ? 'sold' + (r[9] != null ? ' ' + (r[9] < 1 ? Math.round(r[9] * 60) + ' min' : r[9].toFixed(1) + ' h') + ' after the alert' : '') : r[8] === 'unknown' ? 'no longer tracked' : esc(r[8]);
  return 'Last <b>' + h.length + '</b> alert' + (h.length === 1 ? '' : 's') + ' \u00b7 you answered <b>' + said.length + '</b>' + (said.length ? ': ' + (said.length - no) + ' yes, ' + no + ' no' : '') +
    '<table><thead><tr><th>Sent</th><th>Card</th><th class="num">Total</th><th class="num">Profit</th><th>Kind</th><th>Your answer</th><th>Listing</th></tr></thead><tbody>' +
    h.map(r => '<tr><td>' + when(r[0]) + '</td><td><a href="' + esc(r[3] || '#') + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a><br><span class="dim">' + esc(r[2]) + '</span></td><td class="num">' + fmtMoney(r[4]) + '</td><td class="num">' + fmtMoney(r[5]) + '</td><td>' + esc(String(r[6]).replace('-drop', ', price drop').replace('-lead', ', lead').replace('-suspect', ', SUSPECT')) + '</td><td>' + (r[7] ? ans[r[7]] || esc(r[7]) : '<span class="dim">not answered</span>') + '</td><td>' + fate(r) + '</td></tr>').join('') + '</tbody></table>';
}
async function alChannel() {
  const enc = new TextEncoder();
  const hex = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return {topic: 'pc-' + (await hex(HKEY + ':alerts-topic')).slice(0, 40),
          key: await crypto.subtle.importKey('raw', enc.encode(await hex(HKEY + ':alerts-key')), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])};
}
async function alSend(msg) {
  const ch = await alChannel(), body = JSON.stringify(msg);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', ch.key, new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const r = await fetch('https://ntfy.sh/' + ch.topic, {method: 'POST', body: JSON.stringify({m: body, s: sig})});
  if (!r.ok) throw new Error('HTTP ' + r.status);
}
async function alAct(kind) {
  if (!HKEY) { AL.note = 'This page has no key for the collector yet.'; AL.cls = 'warn'; return alRender(); }
  const t = Date.now();
  try {
    await alSend(kind === 'test' ? {type: 'test', t} : {type: 'settings', t, cfg: alRead()});
    if (kind === 'test') AL.test = t; else AL.pending = t;
    AL.note = kind === 'test' ? 'Test requested. It should reach your phone in about a minute.' : 'Sent. Waiting for the collector to confirm, about a minute or two.';
    AL.cls = '';
  } catch (e) { AL.note = 'Could not reach the collector\'s channel (' + e.message + '). Nothing was changed.'; AL.cls = 'warn'; }
  alRender();
}
$('al-save').addEventListener('click', () => alAct('settings'));
$('al-test').addEventListener('click', () => alAct('test'));
Object.values(AL_NUM).concat(Object.values(AL_BOX)).forEach(id => $(id).addEventListener('input', () => { AL.note = ''; alRender(); }));
// Raw Data: one click puts the alert numbers into the boxes at the top, so the table shows what would alert
$('au-er').addEventListener('input', () => { auMode(); tables.er.apply(); });
$('use-al').addEventListener('click', () => {
  const c = Object.assign({}, AL_DEFAULT, (LIVE.data && LIVE.data.alert && LIVE.data.alert.cfg) || {});
  $('conf').value = c.conf; $('win').value = c.window; $('margin').value = c.margin; $('buytax').value = c.tax;
  $('margin').dispatchEvent(new Event('input'));
});
