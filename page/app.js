const DATA = __DATA__;
const SETS = __SETS__;
const SET_TOTALS = __SET_TOTALS__;        // printed set sizes from the Pokemon TCG dataset, matched at build time
const GATE = __GATE__;
const PAGE = 300;
const RANGE_COLS = [5, 6, 7, 8, 9, 10, 12, 13, 16, 18, 19, 20, 21, 22, 23];
const RANGE_LABEL = {5: 'Sales/yr', 6: 'Ungraded $', 7: 'Δ7d %', 8: 'Δ30d %', 9: 'Range 90d %', 10: 'Vol. drift %', 12: 'Volatility %', 13: 'Slope %/mo', 16: 'PC sales', 18: 'eBay last mo', 19: 'eBay this mo', 20: 'Anchor $', 21: 'vs PC %', 22: 'Hits 30d', 23: 'Hit %'};
const setIndex = new Map(SETS.map((s, i) => [s, i]));
// The catalog rows carry 16 columns (build_catalog.py). The page adds eight more (2026-10-13, Brett): 16 PC sales -
// PriceCharting's bar for the last complete month, from pcm.bin, every card - 17 the month that bar is for, and from
// the eBay Catalog's live rows 18 eBay sales last month, 19 eBay sales this month, 20 Anchor $, 21 vs PC %, 22 Hits
// 30d, 23 Hit %; blank until the data loads (fillPcm, rebuildLive); then the release-order key last.
const PC_LIVE = {pcm: 16, pcmm: 17, km: 18, kt: 19, A: 20, vspc: 21, hits: 22, hitpct: 23};
const ORD = DATA.length ? DATA[0].length + 8 : 0;      // index of the release-order key
DATA.forEach((r, i) => r.push(null, null, null, null, null, null, null, null, i));
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
const numCell = (num, set, rar) => { const t = SET_TOTALS[set] || (LIVE.sets && LIVE.sets[set]); if (/classic collection/i.test(rar || '')) return esc(num) + '<span class="dim" title="Classic Collection: an old card reprinted with the anniversary stamp, numbered as it originally was (not /' + (t || '?') + ')"> cc</span>'; return esc(num) + (t && /^\d+[a-z]?$/.test(String(num)) ? '<span class="dim">/' + t + '</span>' : ''); };
const cells4 = (r, mid = '', afterSet = '', rar = '') =>       // Card, Set, [afterSet], Set / Card, [mid], Released (rar = the card's rarity, for the number cell)
  '<td><a href="https://www.pricecharting.com/game/' + r[0] + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a></td>' +
  '<td>' + esc(r[2]) + '</td>' + afterSet + '<td class="num">' + numCell(r[3], r[2], rar) + '</td>' + mid + '<td>' + (r[4] || dash) + '</td>';
const fmtNum = (v, nd = 1) => v == null ? dash : v.toLocaleString('en-US', {minimumFractionDigits: nd, maximumFractionDigits: nd});
/* ---------------- the month columns (2026-10-13, Brett: "pc sales for last month, ebay sales for last month, and a
   column that records the number of ebay sales that have accrued since the start of this month") ----------------
   PC sales = PriceCharting's volume bar (every grade) for the last complete month on the card's page, from pcm.bin
   (the collector, hourly); when the page was last read before last month ended, the bar is an older month's and the
   cell says which. eBay sales last month = the collector's own sales (raw NM/LP copies caught selling inside their
   2-day follow) in the previous calendar month - shown only when the collector was running for that whole month
   (live.since) - and this month = the same count since the 1st. The trailing-30-day count the model runs on (k)
   is no longer a column. Months are UTC, like the collector's. */
const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prevMonth = () => { const d = new Date(); return (d.getUTCFullYear() - 2000) * 12 + d.getUTCMonth() - 1; };   // months since 2000-01
const monthName = m => MONTHS_S[((m % 12) + 12) % 12] + ' ' + (2000 + Math.floor(m / 12));
const prevMonthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10); };
const sinceNote = () => 'The collector has only been recording since ' + ((LIVE.data && LIVE.data.since) || 'late September') + ': ' + monthName(prevMonth() + 1) + ' is its first whole month, so last month\'s count appears on the 1st of ' + monthName(prevMonth() + 2).split(' ')[0];
function pcSalesCell(v, m) {
  if (v == null) return '<td class="num"><span class="dim" title="PriceCharting\'s monthly bars for this card have not been read yet (the collector reads every card\'s page in turn)">\u2014</span></td>';
  const late = m != null && m !== prevMonth();
  const tip = 'Sold in ' + monthName(m) + ' by PriceCharting\'s count, every grade: the last complete month on the card\'s page' + (late ? '. The page was last read before ' + monthName(prevMonth()) + ' ended, so this is an older month; cards with eBay data are re-read within days of the 1st' : '');
  return '<td class="num" title="' + esc(tip) + '">' + fmtInt(v) + (late ? ' <span class="dim">' + MONTHS_S[((m % 12) + 12) % 12] + '</span>' : '') + '</td>';
}
const kmCell = v => v == null ? '<td class="num"><span class="dim" title="' + esc(sinceNote()) + '">\u2014</span></td>' : '<td class="num">' + fmtInt(v) + '</td>';
const hitsCell = v => '<td class="num">' + (v ? '<b>' + fmtInt(v) + '</b>' : v === 0 ? '0' : dash) + '</td>';
const hitPctCell = (v, n) => '<td class="num"' + (n ? ' title="' + esc(n + ' listing' + (n === 1 ? '' : 's') + ' of this card seen in 30 days') + '"' : '') + '>' + (v == null ? '<span class="dim" title="no listings of this card seen in 30 days">\u2014</span>' : fmtPct(v, false, 0)) + '</td>';
const mtOf = cid => { const t = LIVE.data && LIVE.data.mt; const m = t && t[String(cid)]; return m ? m[0] + ':' + m[1] + (m[2] ? '|' + m[2] : '') : null; };   // "confirmed:mismatch|filed by the matcher" for a card
const mmRatio = v => {                                        // the cell shows only what Brett marked; the matcher's own count is the tooltip
  if (v == null) return dash;
  const [s, n] = String(v).split('|'), m = /^(\d+):(\d+)$/.exec(s);
  const tip = (n ? n + ' listing' + (n === '1' ? '' : 's') + ' filed under this card by the matcher' : 'no listings on record for this card') + ' \u00b7 ' +
    (!m ? '' : m[1] === '0' && m[2] === '0' ? 'none marked by you yet' : m[1] + ' you confirmed as the same card, ' + m[2] + ' you marked as not this card');
  return '<span' + (/:0$/.test(s) ? '' : ' class="down"') + ' title="' + esc(tip) + '">' + esc(s) + '</span>';
};
const badge = (txt, cls) => '<span class="badge' + (cls ? ' ' + cls : '') + '">' + esc(txt) + '</span>';
/* ---------------- rarity and finish (2026-10-12, Brett: "most mismatches are finish and rarity mismatches") ----------------
   The PriceCharting side rides with the catalog rows (DATA 14 rarity, 15 finish: cardfacts.py in the daily build, from
   TCGplayer's catalog through the tcg-id column and the open Pokemon TCG dataset). The eBay side is what eBay's catalog
   product ("About this product") or the seller's item specifics say, read by the collector the first time it looks a
   listing up (when it sells, or when it clears the price gate): live row 34 = [set, rarity, finish, card name, card
   number, source, set cmp, rarity cmp, finish cmp] (null = not looked up, [] = nothing on the listing), and live.ef =
   {card: [rarity most listings carry, finish likewise, listings with facts, listings that disagree]} for the eBay
   Catalog. The comparison vocabulary mirrors cardfacts.py: coarse tiers for rarity, three classes for finish. */
const RF_SEP = ' \u00b7 ';
const pcRF = base => base && (base[14] || base[15]) ? [base[14] || '', base[15] || ''] : null;
const rfText = p => p ? [p[0], p[1]].filter(Boolean).join(RF_SEP) : '';
const normRF = s => String(s || '').toLowerCase().replace(/\u00e9/g, 'e').replace(/1st/g, 'first').replace(/-/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').trim();
const ULTRA_W = new Set('ex gx v vmax vstar lvx lv ultra double secret hyper rainbow illustration full art shiny amazing radiant ace spec break prime legend gold star prism crystal gallery character pikachu classic special mega tag team alternate alt textured shining delta futuristic'.split(' '));
const HOLO_W = new Set('holo holofoil foil cosmos cracked rainbow textured sparkle galaxy confetti spectra tekno shiny shining gold silver prism crystal etched'.split(' '));
const PLAIN_W = new Set('regular nonholo non normal standard none matte plain'.split(' '));
const PATTERN_W = new Set('ball pokeball masterball pattern'.split(' '));
function rarityTier(s) { const t = normRF(s); if (!t) return null; const k = t.split(/\s+/); if (k.includes('promo') || k.includes('promotional')) return 'P'; if (k.includes('classic') && k.includes('collection')) return 'K'; if (k.some(w => ULTRA_W.has(w)) || t.includes('black white rare')) return 'X'; if (k.includes('common') && !k.includes('uncommon')) return 'C'; if (k.includes('uncommon')) return 'U'; if (k.includes('holo') || k.includes('holofoil') || k.includes('foil')) return 'H'; if (k.includes('rare')) return 'R'; return null; }
const RF_RANK = {C: 0, U: 1, R: 2, H: 3, X: 4};
function rarityAgree(a, b) { const x = rarityTier(a), y = rarityTier(b); if (!x || !y) return null; if (x === y) return 'same'; if (x === 'P' || y === 'P') return 'far'; if (x === 'K' || y === 'K') return ['K', 'X', 'H', 'R'].includes(x) && ['K', 'X', 'H', 'R'].includes(y) ? 'near' : 'far'; if (x === 'R' || y === 'R') return 'near'; return Math.abs(RF_RANK[x] - RF_RANK[y]) === 1 ? 'near' : 'far'; }   // a bare "Rare" is the generic word: never "far" on its own
function finishClass(s) { const t = normRF(s); if (!t) return null; const k = t.split(/\s+/); if (k.includes('reverse') || k.some(w => PATTERN_W.has(w))) return 'reverse'; if ((k.includes('non') && k.includes('holo')) || k.some(w => PLAIN_W.has(w)) || t === 'no' || t === 'n a') return 'plain'; if (k.some(w => HOLO_W.has(w))) return 'holo'; return null; }
function finishAgree(a, b) { const x = finishClass(a), y = finishClass(b); if (!x || !y) return null; return x === y ? 'same' : 'far'; }
const rfCls = v => v === 'far' ? ' class="rfbad"' : v === 'near' ? ' class="rfnear"' : '';
const pcRFCell = p => '<td' + (p ? ' title="' + esc('What the card is: ' + (p[0] || 'rarity unknown') + ', ' + (p[1] || 'finish unknown') + '. From TCGplayer\'s catalog (the tcg-id PriceCharting carries) or the open Pokemon TCG dataset; the bracket tag names the printing') + '"' : '') + '>' + (p ? esc(rfText(p)) : dash) + '</td>';
const EF_SRC = {product: "eBay's catalog product", seller: "the seller's item specifics", both: "eBay's product and the seller's specifics"};
// the card's eBay record over all its looked-up listings (live.ef): [rarity most carry, finish likewise, listings looked up, listings that disagree]
const cardFacts = cid => (LIVE.data && LIVE.data.ef && LIVE.data.ef[String(cid)]) || null;
// Raw Data (2026-10-13, Brett: "include that number in the eBay Raw Data tab"): the dim count after a listing's eBay
// Rarity/Finish is the same count the eBay Catalog shows - how many of the card's listings have been looked up; the
// tooltip says what most of them carry and whether this listing agrees
function efCount(ef, f) {
  if (!f || !f[2]) return '';
  const most = rfText([f[0], f[1]]), mine = ef && ef.length ? rfText([ef[1], ef[2]]) : '';
  const same = mine && most && normRF(mine) === normRF(most);
  const tip = f[2] + ' of this card\'s listings ' + (f[2] === 1 ? 'has' : 'have') + ' been looked up' + (most ? '; most carry ' + most : '') + (f[3] ? '; ' + f[3] + ' of them disagree with the card on set, rarity or finish' : '') +
    (mine ? '. This listing ' + (same ? 'agrees with that majority' : 'reads ' + mine + ', not the majority\'s words') : '. This listing is not among them yet');
  return ' <span class="dim efn" title="' + esc(tip) + '">' + f[2] + '</span>';
}
function efCells(ef, p, f) {                             // Raw Data: [eBay Set Name cell, eBay Rarity/Finish cell] for one listing (p = the card's own rarity / finish, f = the card's record, cardFacts)
  if (ef == null || !ef.length) {
    const c = '<span class="dim" title="' + (ef == null ? 'Not looked up yet: eBay\'s record is read the first time the collector looks a listing up - when it sells, or when it clears the price gate' : 'Looked up: the listing carries no catalog product and the seller left these blank') + '">' + (ef == null ? 'not read' : 'none') + '</span>';
    return ['<td>' + c + '</td>', '<td>' + c + efCount(ef, f) + '</td>'];
  }
  const src = 'From ' + (EF_SRC[ef[5]] || 'eBay'), names = [ef[3], ef[4]].filter(Boolean).join(' #');
  const setCell = '<td' + rfCls(ef[6]) + ' title="' + esc(src + (names ? '. eBay names it ' + names : '') + (ef[6] === 'far' ? '. Its words belong to a different set from the card this listing is filed under' : ef[6] === 'same' ? '. Agrees with the card\'s set' : '')) + '">' + (ef[0] ? esc(ef[0]) : dash) + '</td>';
  const worst = ef[7] === 'far' || ef[8] === 'far' ? 'far' : ef[7] === 'near' ? 'near' : null;
  const classic = /classic collection/i.test(ef[1] || '') !== /classic collection/i.test((p && p[0]) || '');
  const why = [ef[7] === 'far' ? 'the rarity is two tiers or more from the card\'s - usually another card number' : ef[7] === 'near' ? (classic ? 'Classic Collection against the original card\'s rarity word: a reprint keeps its original number and sellers reuse its original rarity; the printed total tells them apart (the set\'s own cards carry the set total)' : 'the rarity is one tier from the card\'s (the usual seller imprecision)') : '',
               ef[8] === 'far' ? 'the finish differs from the catalog row\'s' : ''].filter(Boolean).join('; ');
  const rf = rfText([ef[1], ef[2]]);
  const rfCell = '<td' + rfCls(worst) + ' title="' + esc(src + (why ? '. ' + why.charAt(0).toUpperCase() + why.slice(1) : ef[7] === 'same' || ef[8] === 'same' ? '. Agrees with the card' : '')) + '">' + (rf ? esc(rf) : dash) + efCount(ef, f) + '</td>';
  return [setCell, rfCell];
}
function efCardCell(f, p) {                              // eBay Catalog: the card's eBay record over its looked-up listings
  if (!f || !f[2]) return '<td><span class="dim" title="None of this card\'s listings has been looked up yet">not read</span></td>';
  const r = rarityAgree(f[0], p && p[0]), fi = finishAgree(f[1], p && p[1]);
  const worst = r === 'far' || fi === 'far' ? 'far' : r === 'near' || f[3] ? 'near' : null;
  const tip = 'The rarity and finish most of this card\'s ' + f[2] + ' looked-up listing' + (f[2] === 1 ? '' : 's') + ' carry in eBay\'s records' + (f[3] ? '; ' + f[3] + ' of them disagree with the card on set, rarity or finish' : '') + (r === 'far' || fi === 'far' ? '. Disagrees with the PriceCharting side: check the matches' : '');
  return '<td' + rfCls(worst) + ' title="' + esc(tip) + '">' + (rfText([f[0], f[1]]) ? esc(rfText([f[0], f[1]])) : dash) + ' <span class="dim">' + f[2] + '</span></td>';
}
const rfBad = r => !!(r[48] && r[48].length && (r[48][6] === 'far' || r[48][7] === 'far' || r[48][8] === 'far'));
// Raw Data: the Mismatch tick and the identity cells (Card, PC Set Name, eBay Set Name, Set / Card, PC and eBay Rarity/Finish, Released)
const erHead = r => { const p = r[47] ? r[47].split(RF_SEP) : null, ec = efCells(r[48], p, cardFacts(r[0])); return umCell(r) + cells4(r, pcRFCell(p) + ec[1], ec[0], p ? p[0] : ''); };
function fitRows(root) {                                 // one-line cells (b.fit): shrink the font to 9px; then drop eBay's era prefix
  for (const b of (root || document).querySelectorAll('b.fit')) {   // ("Scarlet & Violet: 151" -> "151"); a name that still overflows
    if (!b.dataset.full) b.dataset.full = b.textContent;            // (a Topps set) wraps rather than clips
    b.textContent = b.dataset.full; b.style.whiteSpace = 'nowrap';
    const shrink = min => { let px = 16; b.style.fontSize = px + 'px'; while (px > min && b.scrollWidth > b.clientWidth) { px -= 0.5; b.style.fontSize = px + 'px'; } return b.scrollWidth <= b.clientWidth; };
    if (shrink(12)) continue;
    const i = b.dataset.full.indexOf(': ');
    if (i > 0 && i < 20) b.textContent = b.dataset.full.slice(i + 2);
    if (shrink(9)) continue;
    b.style.whiteSpace = 'normal'; b.style.fontSize = '11px';
  }
}
const LIVE = {data: null, ec: [], er: [], prevT: null, sets: null};      // filled by loadLive(); prevT = the previous data's stamp; sets = printed set sizes

const TABLES = {
  pc: {rows: () => DATA, noun: 'cards', ranges: RANGE_COLS, labels: RANGE_LABEL, defaults: {},
       inserted: [{v: 3, at: 0, n: 1}, {v: 4, at: 4, n: 1}, {v: 5, at: 14, n: 3}, {v: 6, at: 14, n: 1}, {v: 7, at: 16, n: 1}, {v: 8, at: 19, n: 2}],   // v4: PC Rarity/Finish after Set / Card; v5: eBay sales, Max buy $, vs PC % before Trend; v6-v8: PC sales, eBay this month, Hits 30d + Hit % (Anchor $ took Max buy's place)
       hay: r => r[1] + ' ' + r[2] + ' ' + (r[14] || '') + ' ' + (r[15] || ''),
       row: r => cells4(r, pcRFCell(pcRF(r)), '', (pcRF(r) || [])[0]) +
      '<td class="num">' + fmtInt(r[5]) + '</td>' +
      '<td class="num">' + fmtMoney(r[6]) + '</td>' +
      '<td class="num">' + fmtPct(r[7]) + '</td>' +
      '<td class="num">' + fmtPct(r[8]) + '</td>' +
      '<td class="num">' + fmtPct(r[9], false, 0) + '</td>' +
      '<td class="num">' + (r[10] == null ? dash : '<span class="' + (r[11] > 0 ? 'up' : r[11] < 0 ? 'down' : '') + '">' + (r[11] > 0 ? '+' : '') + r[11] + ' (' + (r[10] > 0 ? '+' : '') + r[10].toFixed(1) + '%)</span>') + '</td>' +
      '<td class="num">' + fmtPct(r[12], false, 2) + '</td>' +
      '<td class="num">' + fmtPct(r[13]) + '</td>' +
      // the month columns and the eBay Catalog's figures for the card (blank until the data loads, or when eBay has nothing on it)
      pcSalesCell(r[16], r[17]) + kmCell(r[18]) +
      '<td class="num">' + fmtInt(r[19]) + '</td>' +
      '<td class="num">' + fmtMoney(r[20]) + '</td>' +
      '<td class="num">' + (r[21] == null ? dash : '<span class="' + (r[21] < -40 || r[21] > 200 ? 'down' : '') + '">' + fmtPct(r[21], true, 0) + '</span>') + '</td>' +
      hitsCell(r[22]) + hitPctCell(r[23], r.n30) +
      '<td><button class="tbtn" data-i="' + ordOf(r) + '">Trend</button></td>'},
  // eBay Catalog row (four bands): 0 id 1 card 2 set 3 # 4 released |
  //   Observed: 5 k 6 D 7 N 8 p1 9 p2 10 p3 11 mu 12 smed 13 s80 14 hrs 15 st |
  //   Rates: 16 lam 17 price 18 dos 19 io |
  //   Decisions: 20 A 21 L 22 sell 23 probT 24 edays 25 maxbuy 26 hot 27 liquid 28 confirm 29 checks |
  //   Trends: 30 spm 31 d7 32 d30 33 pos 34 vdp 35 vd 36 vol 37 ts | 38 net 39 A_n | 40 ord |
  //   41 PC sales/month 42 PC ungraded $ 43 vs PC % 44 hits 30d 45 "match:mismatch"
  //   46 PC rarity/finish text 47 eBay card facts [rarity, finish, n, disagree] 48 eBay rarity/finish text (sort key)
  //   (6 D, 8-10 p1-p3 and 30 spm stay in the row for the Book and the chart; the table no longer shows them - 2026-10-08)
  //   49 eBay sales last month 50 eBay sales this month 51 listings seen in 30 d 52 Hit % 53 the month of 41 (2026-10-13; 41 = PriceCharting's bar for the last complete month)
  ec: {rows: () => LIVE.ec, noun: 'cards', ranges: [17, 49, 50, 41, 16, 7, 18, 12, 14, 15, 20, 43, 22, 25, 38, 44, 52, 32, 37],
       inserted: [{v: 3, at: 0, n: 1}, {v: 4, reset: 1}, {v: 5, at: 4, n: 2}, {v: 6, at: 9, n: 1}, {v: 7, at: 32, n: 1}],   // v4: the column set was rebuilt; v5: PC / eBay Rarity/Finish after Set / Card; v6: eBay sales this month; v7: Hit %
       compact: [12, 13, 14, 15, 17, 18, 19, 20, 24, 27],   // hidden in the Compact view: the diagnostics behind the decision numbers
       labels: {17: 'Price $', 49: 'eBay last mo', 50: 'eBay this mo', 41: 'PC sales', 16: 'λ /day', 7: 'Active', 18: 'Days supply', 12: 'Sold med $', 14: 'Hrs to sale', 15: 'Sell-thru %', 20: 'Anchor $', 43: 'vs PC %', 22: 'Sell $', 25: 'Max buy $', 38: 'Net $', 44: 'Hits 30d', 52: 'Hit %', 32: 'Δ30d %', 37: 'Slope %/mo'},
       defaults: {17: [50, 500]},
       hay: r => r[1] + ' ' + r[2] + ' ' + (r[46] || ''),
       row: r => cells4(r, pcRFCell(r[46] ? r[46].split(RF_SEP) : null) + efCardCell(r[47], r[46] ? r[46].split(RF_SEP) : null), '', r[46] ? r[46].split(RF_SEP)[0] : '') +
      '<td class="num">' + mmRatio(r[45]) + '</td>' +
      kmCell(r[49]) + '<td class="num">' + fmtInt(r[50]) + '</td>' +
      pcSalesCell(r[41], r[53]) +
      '<td class="num">' + fmtInt(r[7]) + '</td>' +
      '<td class="num">' + fmtNum(r[11], 2) + '</td>' +
      '<td class="num">' + fmtMoney(r[12]) + '</td><td class="num">' + fmtMoney(r[13]) + '</td>' +
      '<td class="num">' + fmtNum(r[14], 0) + '</td>' +
      '<td class="num">' + fmtPct(r[15], false, 0) + '</td>' +
      '<td class="num">' + fmtNum(r[16], 2) + '</td>' +
      '<td class="num">' + fmtMoney(r[17]) + '</td>' +
      '<td class="num">' + fmtNum(r[18], 1) + '</td>' +
      '<td class="num">' + fmtNum(r[19], 2) + '</td>' +
      '<td class="num"' + (r[39] ? ' title="' + r[39] + ' sales behind the anchor"' : '') + '>' + fmtMoney(r[20]) + (r[20] != null && r[39] < (LIVE.data && LIVE.data.gate && LIVE.data.gate.minSales || 5) ? ' <span class="dim">thin</span>' : '') + '</td>' +
      '<td class="num">' + fmtMoney(r[42]) + '</td>' +
      '<td class="num">' + (r[43] == null ? dash : '<span class="' + (r[43] < -40 || r[43] > 200 ? 'down' : '') + '">' + fmtPct(r[43], true, 0) + '</span>') + '</td>' +
      '<td class="num">' + fmtMoney(r[21]) + '</td>' +
      '<td class="num">' + (r[22] == null ? dash : '<b>' + fmtMoney(r[22]) + '</b>') + '</td>' +
      '<td class="num">' + fmtPct(r[23], false, 0) + '</td>' +
      '<td class="num">' + fmtNum(r[24], 1) + '</td>' +
      '<td class="num">' + (r[25] == null ? dash : '<b>' + fmtMoney(r[25]) + '</b>' + (r[27] ? '' : ' <span class="dim" title="too slow for the window at this confidence">illiquid</span>')) + '</td>' +
      '<td class="num">' + fmtMoney(r[38]) + '</td>' +
      '<td>' + (r[26] === 'confirmed' ? badge('Hot ✓', 'hot2') : r[26] === 'candidate' ? badge('Hot ' + r[28] + '/3', 'hot') : r[29] && r[29].length && r[5] >= 5 ? '<span class="dim" title="' + esc(r[29].join(', ')) + '">fails ' + r[29].length + '</span>' : dash) + '</td>' +
      hitsCell(r[44]) + hitPctCell(r[52], r[51]) +
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
  // 47 PC rarity/finish text 48 eBay facts (live row 34) 49 eBay set name 50 eBay rarity/finish text (49-50: sort keys)
  // 40 PC sales (PriceCharting's bar for the last complete month; 54 = which month) 41 eBay sales last month (null until the
  // collector has watched a whole month) 51 eBay sales this month 52 Hits 30d 53 Hit % - the card's figures, on each of its listings
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
  er: {rows: () => AU_ON() ? (LIVE.au || []) : erRows(), noun: 'listings', ranges: [24, 25], maxes: [5], chips: [24, 5, 25],   // chip order: Profit $, Listed within, ROI % (2026-10-13, Brett)
       labels: {5: 'Listed within', 24: 'Profit $', 25: 'ROI %'}, units: {5: 'h'},
       defaults: {},
       inserted: [{v: 2, at: 10, n: 2}, {v: 3, at: 0, n: 1}, {v: 4, at: 13, n: 2}, {v: 5, at: 7, n: 2}, {v: 6, at: 23, n: 2}, {v: 7, at: 1, n: 1}, {v: 8, at: 28, n: -1}, {v: 9, at: 6, n: 1}, {v: 10, at: 4, n: 1}, {v: 11, at: 6, n: 2}, {v: 12, at: 22, n: 3}],   // columns added (or, n < 0, removed) over time, in order (see makeTable); v10 eBay Set Name, v11 PC / eBay Rarity/Finish, v12 eBay sales this month + Hits 30d + Hit %
       extra: r => statOk(r[19]) && (!$('dis-er').checked || rfBad(r)) && (r.um ? true : r.hh ? condOk(r[15]) && (r[29] !== 'suspect' || $('showsus-er').checked) : r.au ? (!$('hits').checked || r[14] === 'PASS') && condOk(r[15]) : (!$('hits').checked || r[14] === 'PASS') && condOk(r[15]) && r[32] >= 2 && (r[29] !== 'suspect' || $('showsus-er').checked) && (!$('mm-er').checked || r[37] === 'low') && (!$('lead-er').checked || r[14] === 'LEAD')),
       rowClass: r => r.um ? 'umm' : r.au ? '' : (r[29] === 'suspect' ? 'sus ' : '') + (LIVE.prevT && r[34] > LIVE.prevT ? 'fresh' : ''),
       hay: r => r[1] + ' ' + r[2] + ' ' + r[6] + ' ' + (r[47] || '') + ' ' + (r[49] || '') + ' ' + (r[50] || ''),
       row: r => r.au ? auRow(r) : erHead(r) +
      '<td class="num">' + mmRatio(r[46]) + '</td>' +
      '<td class="num">' + fmtNum(r[5], 1) + '</td>' +
      '<td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener" title="' + esc(r[6]) + '">' + esc(r[6]) + '</a></td>' +
      '<td class="num auc"></td><td class="num auc"></td>' +
      '<td class="num fxc">' + fmtMoney(r[7]) + '</td><td class="num">' + (r[8] == null ? dash : r[8] === 0 ? 'free' : fmtMoney(r[8])) + '</td>' +
      '<td class="num">' + fmtMoney(r[9]) + '</td><td class="num">' + fmtMoney(r[10]) + '</td>' +
      '<td class="num">' + fmtMoney(r[35]) + '</td><td class="num">' + fmtPct(r[36]) + '</td>' +
      pcSalesCell(r[40], r[54]) + kmCell(r[41]) + '<td class="num">' + fmtInt(r[51]) + '</td>' + hitsCell(r[52]) + hitPctCell(r[53]) +
      '<td class="num">' + fmtMoney(r[11]) + '</td>' +
      '<td class="num">' + fmtPct(r[12]) + '</td>' +
      '<td class="num">' + fmtMoney(r[26]) + '</td>' +
      '<td class="num"' + (r[28] ? ' title="' + esc(r[28]) + '"' : '') + '>' + fmtMoney(r[13]) + (r[28] ? ' <span class="dim">' + (/^Lead/.test(r[28]) ? 'PC' : 'LP') + '</span>' : '') + '</td>' +
      '<td class="num">' + (r[24] == null ? dash : '<span class="' + (r[24] > 0 ? 'up' : r[24] < 0 ? 'down' : '') + '">' + (r[24] < 0 ? '−' : '') + fmtMoney(Math.abs(r[24])).replace('$', '$') + '</span>') + '</td>' +
      '<td class="num">' + fmtPct(r[25]) + '</td>' +
      '<td class="num auc"></td><td class="num auc"></td>' +
      '<td>' + verdictCell(r) + hhNote(r) + '</td>' +
      '<td>' + riskCell(r) + '</td>' +
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
      pc, sold && pc ? r1((ftot / pc - 1) * 100) : null, '', '', [], base[PC_LIVE.pcm], base[PC_LIVE.km],
      bid, sold ? fin : null, sold && net != null ? r2(net - fall) : null, sold && net != null && fall > 0 ? r1((net - fall) / fall * 100) : null, i];
    row[46] = mtOf(cid);
    const lv = LIVE.erMap && LIVE.erMap.get(iid); row[47] = rfText(pcRF(base)); row[48] = lv ? lv[48] : null; row[49] = lv ? lv[49] : ''; row[50] = lv ? lv[50] : '';
    row[51] = base[PC_LIVE.kt]; row[52] = base[PC_LIVE.hits]; row[53] = base[PC_LIVE.hitpct]; row[54] = base[PC_LIVE.pcmm];
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
  const p = r[47] ? r[47].split(RF_SEP) : null, ec = efCells(r[48], p, r[0] ? cardFacts(r[0]) : null), mid = pcRFCell(p) + ec[1];
  return umCell(r) + (r[0] ? cells4(r, mid, ec[0]) : '<td>' + esc(r[1]) + '</td><td></td>' + ec[0] + '<td class="num"></td>' + mid + '<td>' + dash + '</td>') + '<td class="num">' + mmRatio(r[46]) + '</td>' +
    '<td class="num">' + fmtNum(r[5], 1) + '</td>' +
    '<td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener" title="' + esc(r[6]) + '">' + esc(r[6]) + '</a></td>' +
    '<td class="num auc"' + (x.old ? ' title="An alert from before October 6: worked back from the total the alert recorded"' : '') + '>' + (r[42] != null ? fmtMoney(r[42]) + (x.nb != null ? ' <span class="dim">' + x.nb + ' bid' + (x.nb === 1 ? '' : 's') + '</span>' : '') : x.tot0 != null ? fmtMoney(x.tot0) + ' <span class="dim">with shipping</span>' : dash) + '</td>' +
    '<td class="num auc">' + (r[43] != null ? '<b>' + fmtMoney(r[43]) + '</b>' + (x.fb2 != null ? ' <span class="dim">' + x.fb2 + ' bid' + (x.fb2 === 1 ? '' : 's') + '</span>' : '') : x.fst === 'nobids' ? '<span class="dim">no bids</span>' : dash) + '</td>' +
    '<td class="num fxc"></td><td class="num">' + (r[8] == null ? dash : r[8] === 0 ? 'free' : fmtMoney(r[8])) + '</td>' +
    '<td class="num">' + money(r[9]) + '</td><td class="num">' + money(r[10]) + '</td>' +
    '<td class="num">' + money(r[35]) + '</td><td class="num">' + fmtPct(r[36]) + '</td>' +
    pcSalesCell(r[40], r[54]) + kmCell(r[41]) + '<td class="num">' + fmtInt(r[51]) + '</td>' + hitsCell(r[52]) + hitPctCell(r[53]) +
    '<td class="num">' + money(r[11]) + '</td><td class="num">' + fmtPct(r[12]) + '</td>' +
    '<td class="num">' + money(r[26]) + '</td>' +
    '<td class="num"' + (r[28] ? ' title="' + esc(r[28]) + '"' : '') + '>' + money(r[13]) + (r[28] ? ' <span class="dim">' + (/^Lead/.test(r[28]) ? 'PC' : 'LP') + '</span>' : '') + '</td>' +
    '<td class="num" title="Worst case if you win: you pay your whole Max buy">' + signed(r[24]) + '</td><td class="num" title="Worst case if you win: your margin">' + fmtPct(r[25]) + '</td>' +
    '<td class="num auc" title="Best case: at the price it closed at">' + signed(r[44]) + '</td><td class="num auc" title="Best case: at the price it closed at">' + fmtPct(r[45]) + '</td>' +
    '<td><span title="' + esc(tip + said) + '">' + (x.res === 'PASS' ? badge('PASS', 'pass') : r.um ? badge('mismatch \u2717', 'warn') : '<span class="dim">' + esc(x.res) + '</span>') + (x.dec === 'no' ? ' <span class="dim">· you said No</span>' : '') + '</span></td>' +
    '<td>' + riskCell(r) + '</td>' +
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
  if (v === 'reprint?') return tip('An anniversary set has a cheaper card with this name and number' + (r.tw ? ' (' + r.tw[1].map(t => t[0] + ', about ' + fmtMoney(t[1])).join('; ') + ')' : '') + ', and this listing is priced nearer that card than this one. It is most likely the reprint, or a played copy of the original: either way not the near-mint card the numbers assume. Not a hit. Look for the anniversary stamp on the artwork.', badge('reprint?', 'warn'));
  if (v === 'learned') return tip('Held back by what your earlier mismatch marks taught: ' + (r.lrn || '') + '. It cannot be a hit. If it is the right card after all, the mark that taught this was the wrong one to make.', badge('learned', 'watch'));
  if (v === 'mismatch: too cheap') return tip('under ' + pcPct('pcLow', 0.4) + '% of the PriceCharting price: treated as a wrong match (another printing or language, a lot, a fake - far more often than a bargain). Never a hit, left out of the statistics; check it by hand', badge('mismatch ↓', 'watch'));
  if (v === 'mismatch: too high') return tip('over ' + pcPct('pcHigh', 3) + '% of the PriceCharting price: treated as a wrong match and left out of the statistics', badge('mismatch ↑'));
  if (v === 'review') return tip('under 45% of the anchor: more often misidentified, damaged or fake than a bargain - check the photos and the seller', badge('review', 'watch'));
  return /scam|suspect/.test(v) ? badge(v, 'warn') : badge(v);
}
// Raw Data condition filter (NM / LP / n/s chips); MP and HP rows show only when all three are ticked
const COND_IDS = ['NM', 'LP', 'UNK'];
const STAT_IDS = ['open', 'sold', 'ended', 'gone', 'stale'];         // the Status chip on Raw Data: untick a status to hide those rows
function statOk(st) { const c = $('stat-' + st + '-er'); return !c || c.checked; }

function condOk(c) {
  const on = COND_IDS.filter(k => $('cond-' + k + '-er').checked);
  if (on.length === COND_IDS.length) return true;
  return on.includes(c);
}

/* ---------------- Period picker (Revenue, and "every hit" on Raw Data) ----------------
   Brett's design: a year, then either a range of months (1-12) or, for one month, a range of days. */
const PERIOD = {};
// unit: the starting choice - 'm' = months 1 to 12 of this year (the Transaction Report), 'd' = today alone (Raw Data,
// 2026-10-13, Brett: "rather have it default to the current day"). A bar nobody has touched follows the calendar: when
// the date changes under an open page, roll() moves "today" along.
function periodBar(key, onChange, unit0) {
  const host = $('per-' + key), now = new Date(), byDay = unit0 === 'd', opt = (a, b, sel) => { let h = ''; for (let i = a; i <= b; i++) h += '<option' + (i === sel ? ' selected' : '') + '>' + i + '</option>'; return h; };
  host.innerHTML = '<label>Year <select class="py">' + opt(2026, Math.max(2026, now.getFullYear()), now.getFullYear()) + '</select></label>' +
    '<label><input type="radio" name="pu-' + key + '" value="m"' + (byDay ? '' : ' checked') + '> by month</label><label><input type="radio" name="pu-' + key + '" value="d"' + (byDay ? ' checked' : '') + '> by day</label>' +
    '<label class="pmon"' + (byDay ? '' : ' hidden') + '>in month <select class="pm">' + opt(1, 12, now.getMonth() + 1) + '</select></label>' +
    '<label>from <input type="number" class="pa" min="1" max="' + (byDay ? 31 : 12) + '" value="' + (byDay ? now.getDate() : 1) + '"></label><label>to <input type="number" class="pb" min="1" max="' + (byDay ? 31 : 12) + '" value="' + (byDay ? now.getDate() : 12) + '"></label>' +
    '<button class="help" data-h="period">?</button>';
  const q = c => host.querySelector(c), unit = () => host.querySelector('input[type=radio]:checked').value;
  let touched = false, day0 = now.toDateString();
  host.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => {
    const d = unit() === 'd'; q('.pmon').hidden = !d; q('.pa').max = q('.pb').max = d ? 31 : 12; q('.pa').value = 1; q('.pb').value = d ? 31 : 12; touched = true; onChange();
  }));
  ['.py', '.pm', '.pa', '.pb'].forEach(c => q(c).addEventListener('input', () => { touched = true; onChange(); }));
  return PERIOD[key] = {
    test(iso) {
      if (!iso) return false;
      const t = new Date(iso), a = +q('.pa').value || 1, b = +q('.pb').value || (unit() === 'd' ? 31 : 12);
      if (t.getFullYear() !== +q('.py').value) return false;
      if (unit() === 'm') return t.getMonth() + 1 >= a && t.getMonth() + 1 <= b;
      return t.getMonth() + 1 === +q('.pm').value && t.getDate() >= a && t.getDate() <= b;
    },
    now() { return this.test(new Date().toISOString()); },   // does the period reach into the present?
    label() { const a = q('.pa').value, b = q('.pb').value; return unit() === 'm' ? (a === b ? 'month ' + a : 'months ' + a + ' to ' + b) + ' of ' + q('.py').value : (a === b ? 'day ' + a : 'days ' + a + ' to ' + b) + ' of month ' + q('.pm').value + ', ' + q('.py').value; },
    roll() {                                               // a new calendar day under an untouched "today" bar: move along (true when it did)
      const d = new Date(); if (touched || !byDay || d.toDateString() === day0) return false;
      day0 = d.toDateString(); if (![...q('.py').options].some(o => +o.value === d.getFullYear())) q('.py').insertAdjacentHTML('beforeend', '<option>' + d.getFullYear() + '</option>');
      q('.py').value = d.getFullYear(); q('.pm').value = d.getMonth() + 1; q('.pa').value = q('.pb').value = d.getDate(); onChange(); return true;
    }
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
  const kindOf = k => /drop/.test(k) ? 'Buy It Now, price drop' : /suspect/.test(k) ? 'Buy It Now, suspect' : 'Buy It Now';
  if (A.hh) (LIVE.hh || []).forEach(r => { if (r[24] != null && P.test(r.hh.t)) out.push({t: r.hh.t, src: 'bin', kind: kindOf(r.hh.kd), p: r[24], i: r[22], c: r[1], u: r[20], tot: r[9], ti: r[6], dec: r.hh.dec, um: r.um}); });
  else (A.all || []).forEach(e => { if (/^hit/.test(e[2] || '') && e[1] != null && P.test(e[0])) out.push({t: e[0], src: 'bin', kind: kindOf(e[2]), p: e[1], i: e[4], c: e[5] || '', u: e[6], tot: e[7], ti: e[9] || '', dec: e[3], um: umOf(e[4], e[8])}); });
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
    ' · <button class="linkbtn" id="hits-btn">Show them</button>';
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
  (cfg.chips || cfg.ranges.concat(maxes)).forEach(k => {   // the filter chips, in cfg.chips order (else the ranges, then the maxes)
    const div = document.createElement('div'); div.className = 'range';
    if (maxes.includes(k))                              // a single "at most" chip (e.g. Listed within N h)
      div.innerHTML = '<span class="lbl">' + cfg.labels[k] + '</span><input type="number" id="max' + k + '-' + id + '" placeholder="any">' + (cfg.units && cfg.units[k] ? '<span class="unit">' + cfg.units[k] + '</span>' : '');
    else {                                              // a min–max chip
      const d = cfg.defaults[k] || ['', ''];
      div.innerHTML = '<span class="lbl">' + cfg.labels[k] + '</span><input type="number" id="min' + k + '-' + id + '" placeholder="min" value="' + d[0] + '"><span class="to">–</span><input type="number" id="max' + k + '-' + id + '" placeholder="max" value="' + d[1] + '">';
    }
    el('ranges').insertBefore(div, el('reset'));
  });
  const paintChips = () => el('ranges').querySelectorAll('.range:not(.condchip)').forEach(div => div.classList.toggle('on', [...div.querySelectorAll('input')].some(i => i.value !== '')));
  t.apply = keep => {                                   // keep === true (a live refresh): the rows already on view through Show more stay on view
    const rows = cfg.rows(), want = keep === true ? Math.max(PAGE, t.shown) : PAGE;
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
    el('rows').innerHTML = ''; t.shown = 0; t.renderMore(want);
    el('count').textContent = t.view.length.toLocaleString('en-US') + ' of ' + rows.length.toLocaleString('en-US') + ' ' + cfg.noun;
    if (cfg.after) cfg.after(t);
  };
  t.renderMore = n => {                                 // n rows more (a number; the Show more button's click event means PAGE)
    const frag = document.createDocumentFragment();
    const end = Math.min(t.shown + (typeof n === 'number' ? n : PAGE), t.view.length);
    for (let i = t.shown; i < end; i++) { const tr = document.createElement('tr'); tr.innerHTML = '<td class="rn">' + (i + 1) + '</td>' + cfg.row(t.view[i]); if (cfg.rowClass) { const c = cfg.rowClass(t.view[i]); if (c) tr.className = c; } paintRow(tr); if (t.stampRow) t.stampRow(tr); frag.appendChild(tr); }
    el('rows').appendChild(frag); t.shown = end;
    el('more').hidden = t.shown >= t.view.length;
    el('more').textContent = 'Show more (' + (t.view.length - t.shown).toLocaleString('en-US') + ' left)';
  };
  // column eyes: every header cell (last header row) gets one; hidden columns collapse to a strip
  const headRow = document.querySelector('#p-' + id + ' thead tr:last-child');
  let hiddenCols = new Set();
  try { hiddenCols = new Set(JSON.parse(localStorage.getItem('hide-' + id) || '[]')); } catch (e) {}
  for (const ins of [].concat(cfg.inserted || [])) try {   // columns added (or removed, n < 0) since the choice was saved: keep it on the same columns
    const mark = 'cols-' + id + '-v' + ins.v;
    if (!localStorage.getItem(mark)) {
      if (ins.reset) {                                     // the column set was rebuilt: saved eyes, order, widths and highlights start over
        for (const key of ['hide-' + id, 'order-' + id, 'hl-' + id, 'width-' + id]) localStorage.removeItem(key);
        hiddenCols = new Set(); localStorage.setItem(mark, '1'); continue;
      }
      const shift = ci => ins.n < 0 ? (ci > ins.at ? ci + ins.n : ci) : (ci >= ins.at ? ci + ins.n : ci);
      const keep = ci => ins.n >= 0 || ci !== ins.at;
      hiddenCols = new Set([...hiddenCols].filter(keep).map(shift));
      localStorage.setItem('hide-' + id, JSON.stringify([...hiddenCols]));
      for (const key of ['order-' + id]) { const sv = JSON.parse(localStorage.getItem(key) || 'null'); if (Array.isArray(sv)) { const out = sv.filter(keep).map(shift); if (ins.n > 0) { const fresh = [...Array(ins.n).keys()].map(i => ins.at + i); out.splice(ins.at === 0 ? 0 : out.indexOf(ins.at - 1) + 1, 0, ...fresh); } localStorage.setItem(key, JSON.stringify(out)); } }   // a new column takes its natural place in a saved order
      for (const key of ['hl-' + id, 'width-' + id]) { const sv = JSON.parse(localStorage.getItem(key) || 'null'); if (sv && typeof sv === 'object') { const out = Array.isArray(sv) ? sv.filter(keep).map(shift) : Object.fromEntries(Object.entries(sv).filter(([k]) => keep(+k)).map(([k, v]) => [shift(+k), v])); localStorage.setItem(key, JSON.stringify(out)); } }
      localStorage.setItem(mark, '1');
    }
  } catch (e) {}
  if (cfg.compact && localStorage.getItem('hide-' + id) == null) {   // first visit (or a rebuilt set): the Compact view
    hiddenCols = new Set(cfg.compact); try { localStorage.setItem('hide-' + id, JSON.stringify([...hiddenCols])); } catch (e) {}
  }
  const EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C7 5 3 8.5 1.5 12 3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" fill="currentColor"/></svg>';
  const EYE_SHUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6c1.6 0 3 .3 4.3.9l-1.6 1.6A6 6 0 0 0 12 8c-4.4 0-7.2 3.2-8.1 4 .5.5 1.6 1.7 3.2 2.6l-1.5 1.5C3.4 14.7 2 12 2 12zm20 0s-3.5 6-10 6c-1.6 0-3-.3-4.3-.9l1.6-1.6c.8.3 1.7.5 2.7.5 4.4 0 7.2-3.2 8.1-4-.5-.5-1.6-1.7-3.2-2.6l1.5-1.5C20.6 9.3 22 12 22 12zM4 20 20 4l1.4 1.4L5.4 21.4z" fill="currentColor"/></svg>';
  // a hidden column is gone altogether, eye included (2026-10-13, Brett), so a band title above the headers (tr.grp,
  // eBay Catalog) must span only the columns still showing: its original span is kept in data-span
  const grpRow = document.querySelector('#p-' + id + ' thead tr.grp');
  if (grpRow) [...grpRow.children].forEach(th => { th.dataset.span = th.getAttribute('colspan') || '1'; });
  const paintBands = () => { if (!grpRow) return; let at = 0; for (const th of grpRow.children) { const n = +th.dataset.span; let vis = 0; for (let ci = at; ci < at + n; ci++) if (!hiddenCols.has(ci)) vis++; at += n; th.colSpan = Math.max(1, vis); th.style.display = vis ? '' : 'none'; } };
  const paintHeads = () => { [...headRow.children].forEach((th, pos) => {
    const ci = th.dataset.ci != null ? +th.dataset.ci : pos;
    const on = hiddenCols.has(ci);
    th.classList.toggle('col-hidden', on);
    const b = th.querySelector('.eye'); if (b) { b.innerHTML = on ? EYE_SHUT : EYE_OPEN; b.title = on ? 'Show column' : 'Hide column'; }
  }); paintBands(); };
  const cellOf = (tr, ci) => tr.querySelector('[data-ci="' + ci + '"]') || tr.children[ci];
  const paintRow = tr => { if (hiddenCols.size) hiddenCols.forEach(ci => { const td = cellOf(tr, ci); if (td) td.classList.add('col-hidden'); }); };
  const toggleCol = ci => {
    if (hiddenCols.has(ci)) hiddenCols.delete(ci); else hiddenCols.add(ci);
    try { localStorage.setItem('hide-' + id, JSON.stringify([...hiddenCols])); } catch (e) {}
    paintHeads();
    el('rows').querySelectorAll('tr').forEach(tr => { const td = cellOf(tr, ci); if (td) td.classList.toggle('col-hidden', hiddenCols.has(ci)); });
    if (t.sizeRow) { const th = [...headRow.children].find(x => +x.dataset.ci === ci) || headRow.children[ci]; const w = (JSON.parse(localStorage.getItem('width-' + id) || '{}') || {})[ci]; if (th) { const on = w && !hiddenCols.has(ci); th.style.width = th.style.minWidth = th.style.maxWidth = on ? w + 'px' : ''; th.classList.toggle('sized', !!on); } el('rows').querySelectorAll('tr').forEach(tr => { const td = cellOf(tr, ci); if (td) { const on = w && !hiddenCols.has(ci); td.style.width = td.style.minWidth = td.style.maxWidth = on ? w + 'px' : ''; td.classList.toggle('sized', !!on); } }); }
  };
  [...headRow.children].forEach((th, ci) => {
    const b = document.createElement('button'); b.className = 'eye'; b.type = 'button';
    b.addEventListener('click', e => { e.stopPropagation(); toggleCol(ci); });
    th.appendChild(b);
  });
  paintHeads();
  /* Highlight (2026-10-08, Brett): the small ring beside the eye paints the header neon green, to find the columns
     that matter at a glance; remembered per tab under hl-<tab>, by original index. */
  let hlCols = new Set();
  try { hlCols = new Set(JSON.parse(localStorage.getItem('hl-' + id) || '[]')); } catch (e) {}
  const paintHl = () => [...headRow.children].forEach((th, pos) => { const ci = th.dataset.ci != null ? +th.dataset.ci : pos; th.classList.toggle('hl', hlCols.has(ci)); const b = th.querySelector('.hlb'); if (b) b.title = hlCols.has(ci) ? 'Remove the highlight' : 'Highlight this column header'; });
  [...headRow.children].forEach((th, ci) => {
    const b = document.createElement('button'); b.className = 'hlb'; b.type = 'button'; b.setAttribute('aria-label', 'Highlight column');
    b.addEventListener('click', e => { e.stopPropagation(); if (hlCols.has(ci)) hlCols.delete(ci); else hlCols.add(ci); try { localStorage.setItem('hl-' + id, JSON.stringify([...hlCols])); } catch (x) {} paintHl(); });
    th.appendChild(b);
  });
  paintHl();
  /* Width (same day): drag the handle on a header's right edge; double-click it to let the column size itself again.
     The width is pinned on the header and every cell of the column (min and max too, so a column can be made
     narrower than its text, which is then clipped); remembered per tab under width-<tab>, by original index. */
  let widths = {};
  try { widths = JSON.parse(localStorage.getItem('width-' + id) || '{}') || {}; } catch (e) {}
  const sizeCell = (cell, ci) => { const w = widths[ci]; if (w && !hiddenCols.has(ci)) { cell.style.width = cell.style.minWidth = cell.style.maxWidth = w + 'px'; cell.classList.add('sized'); } else { cell.style.width = cell.style.minWidth = cell.style.maxWidth = ''; cell.classList.remove('sized'); } };
  const sizeRow = tr => { for (const ci of Object.keys(widths)) { const td = cellOf(tr, +ci); if (td) sizeCell(td, +ci); } };
  const sizeCol = ci => { const th = [...headRow.children].find(x => +x.dataset.ci === ci) || headRow.children[ci]; if (th) sizeCell(th, ci); el('rows').querySelectorAll('tr').forEach(tr => { const td = cellOf(tr, ci); if (td) sizeCell(td, ci); }); };
  const saveWidths = () => { try { if (Object.keys(widths).length) localStorage.setItem('width-' + id, JSON.stringify(widths)); else localStorage.removeItem('width-' + id); } catch (e) {} };
  t.sizeRow = sizeRow;
  t.resetLayout = () => { widths = {}; saveWidths(); hlCols = new Set(); try { localStorage.removeItem('hl-' + id); } catch (e) {} paintHl(); [...headRow.children].forEach((th, pos) => sizeCell(th, th.dataset.ci != null ? +th.dataset.ci : pos)); el('rows').querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, pos) => sizeCell(td, td.dataset.ci != null ? +td.dataset.ci : pos))); };
  let rs = null;                                           // the resize in progress: {ci, x0, w0}
  [...headRow.children].forEach((th, ci) => {
    const h = document.createElement('span'); h.className = 'rsz'; h.title = 'Drag to change the width; double-click to let the column size itself';
    h.draggable = false;
    h.addEventListener('mousedown', e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); rs = {ci, x0: e.clientX, w0: th.getBoundingClientRect().width}; th.classList.add('resizing'); document.body.classList.add('col-resizing'); });
    h.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); delete widths[ci]; saveWidths(); sizeCol(ci); });
    h.addEventListener('click', e => e.stopPropagation());
    th.appendChild(h);
  });
  document.addEventListener('mousemove', e => { if (!rs) return; widths[rs.ci] = Math.max(28, Math.round(rs.w0 + e.clientX - rs.x0)); sizeCol(rs.ci); });
  document.addEventListener('mouseup', () => { if (!rs) return; const th = [...headRow.children].find(x => +x.dataset.ci === rs.ci) || headRow.children[rs.ci]; if (th) th.classList.remove('resizing'); document.body.classList.remove('col-resizing'); saveWidths(); t.justResized = Date.now(); rs = null; });
  headRow.addEventListener('click', e => { if (t.justResized && Date.now() - t.justResized < 300 && !e.target.closest('.eye, .hlb, .help')) { e.stopPropagation(); e.preventDefault(); } }, true);   // the mouseup of a resize is not a sort
  [...headRow.children].forEach((th, ci) => sizeCell(th, ci));
  /* The Columns picker (2026-10-08, Brett: "a button where I can select which columns I would like to switch on
     and off"): every column with a tick, plus Compact (the tab's lean set, where one is defined) and All. Same
     memory as the eyes (hide-<tab>). */
  const colLabel = th => { const tn = [...th.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); return (tn ? tn.textContent : th.textContent).replace(/[\u21c5?]/g, '').trim() || ('Column ' + th.dataset.ci); };
  t.setHidden = set => {
    hiddenCols = new Set([...set].map(Number));
    try { localStorage.setItem('hide-' + id, JSON.stringify([...hiddenCols])); } catch (e) {}
    paintHeads();
    el('rows').querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, pos) => { td.classList.toggle('col-hidden', hiddenCols.has(td.dataset.ci != null ? +td.dataset.ci : pos)); }));
    [...headRow.children].forEach((th, pos) => sizeCell(th, th.dataset.ci != null ? +th.dataset.ci : pos));
    el('rows').querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, pos) => sizeCell(td, td.dataset.ci != null ? +td.dataset.ci : pos)));
  };
  const tabName = () => { const b = document.querySelector('.tab[data-t="' + id + '"]'); return b ? b.textContent.trim() : id; };
  t.openColumns = () => {
    const ths = [...headRow.children].sort((a, b) => +a.dataset.ci - +b.dataset.ci);
    $('btitle').textContent = 'Columns \u00b7 ' + tabName();
    $('bsub').textContent = 'Tick the columns to show on this tab. The eye on a header does the same one at a time; both are remembered in this browser.';
    $('bbody').innerHTML = '<div class="colpick">' + ths.map(th => '<label><input type="checkbox" data-ci="' + th.dataset.ci + '"' + (hiddenCols.has(+th.dataset.ci) ? '' : ' checked') + '> ' + esc(colLabel(th)) + '</label>').join('') + '</div>' +
      '<div class="pickbtns">' + (cfg.compact ? '<button class="reset" id="cp-compact" title="The lean set: the decision numbers, the trends, nothing else">Compact</button>' : '') + '<button class="reset" id="cp-all">All columns</button><button class="reset" id="cp-done">Done</button></div>';
    const sync = () => $('bbody').querySelectorAll('.colpick input').forEach(i => { i.checked = !hiddenCols.has(+i.dataset.ci); });
    $('bbody').querySelector('.colpick').addEventListener('input', e => { const i = e.target; if (!i || i.dataset.ci == null) return; const set = new Set(hiddenCols); if (i.checked) set.delete(+i.dataset.ci); else set.add(+i.dataset.ci); t.setHidden(set); });
    if (cfg.compact) $('cp-compact').addEventListener('click', () => { t.setHidden(cfg.compact); sync(); });
    $('cp-all').addEventListener('click', () => { t.setHidden([]); sync(); });
    $('cp-done').addEventListener('click', () => $('bov').classList.remove('open'));
    $('bov').classList.add('open');
  };
  /* The Filters picker (same request): which filter chips are shown above the table. A hidden chip is switched off
     (its boxes cleared, its ticks back to neutral), so nothing filters unseen. Remembered as chips-<tab>. */
  const chipAll = () => [...el('ranges').querySelectorAll('.range')];
  const chipId = div => div.id || ('r' + ((div.querySelector('input') || {}).id || '').replace(/^(min|max)/, '').replace('-' + id, ''));
  const chipLabel = div => { const l = div.querySelector('.lbl'); return (l ? l.textContent : div.textContent).replace(/\(\s*\d+\s*\)/g, '').replace(/\s+/g, ' ').trim() || chipId(div); };
  let hiddenChips = new Set();
  try { hiddenChips = new Set(JSON.parse(localStorage.getItem('chips-' + id) || '[]')); } catch (e) {}
  const neutralize = div => {
    div.querySelectorAll('input[type=number]').forEach(i => { if (i.value !== '') { i.value = ''; i.dispatchEvent(new Event('input', {bubbles: true})); } });
    const all = div.id === 'condchip' || div.id === 'statchip';
    div.querySelectorAll('input[type=checkbox]').forEach(i => { if (i.checked !== all) { i.checked = all; i.dispatchEvent(new Event('input', {bubbles: true})); } });
  };
  const paintChipsVis = () => chipAll().forEach(div => { const off = hiddenChips.has(chipId(div)); if (off) neutralize(div); div.hidden = off; });   // a hidden chip leaves the row (style: .range[hidden]) and the others close up
  t.paintChipsVis = paintChipsVis;
  /* Chip order (2026-10-13, Brett: "swap the positions of filter bubbles with a hold click and drag"): press a chip
     and hold it still for a moment - it lifts - then drag it along the row and let go where it should sit. Any part of
     the chip but its boxes is a handle. Remembered per tab as chiporder-<tab> (the chip ids in order); "Default order"
     in the Filters picker forgets it. A chip that arrives later (a new filter) takes its natural place. */
  const natural = chipAll().map(chipId);
  const placeChips = ids => { const by = new Map(chipAll().map(d => [chipId(d), d])); ids.forEach(k => { const d = by.get(k); if (d) el('ranges').insertBefore(d, el('reset')); }); };
  const loadChipOrder = () => {
    let sv = null; try { sv = JSON.parse(localStorage.getItem('chiporder-' + id) || 'null'); } catch (e) {}
    if (!Array.isArray(sv)) return;
    const want = sv.filter(k => natural.includes(k));
    natural.forEach((k, i) => { if (!want.includes(k)) want.splice(i ? want.indexOf(natural[i - 1]) + 1 : 0, 0, k); });   // a chip the saved order never saw goes after its natural neighbour
    placeChips(want);
  };
  const saveChipOrder = () => { const cur = chipAll().map(chipId); try { if (cur.every((k, i) => k === natural[i])) localStorage.removeItem('chiporder-' + id); else localStorage.setItem('chiporder-' + id, JSON.stringify(cur)); } catch (e) {} };
  t.resetChipOrder = () => { placeChips(natural); saveChipOrder(); };
  loadChipOrder();
  let lift = null;                                         // the press in progress: {div, x, y, timer, on (lifted), ghost, dx, dy, to: [div, before]}
  const CHIP_HOLD = 300, chipsVisible = () => chipAll().filter(d => !d.hidden);
  const endLift = () => { if (!lift) return; clearTimeout(lift.timer); if (lift.ghost) lift.ghost.remove(); lift.div.classList.remove('lifted'); chipAll().forEach(d => d.classList.remove('drop-l', 'drop-r')); document.body.classList.remove('chip-drag'); lift = null; };
  const dropAt = (x, y) => {                               // where the lifted chip would land: [chip, before?] by the pointer's row and position, or null
    const others = chipsVisible().filter(d => d !== lift.div); if (!others.length) return null;
    const rows = []; others.forEach(d => { const r = d.getBoundingClientRect(); const row = rows.find(w => Math.abs(w.y - (r.top + r.bottom) / 2) < r.height / 2); if (row) row.chips.push([d, r]); else rows.push({y: (r.top + r.bottom) / 2, chips: [[d, r]]}); });
    const row = rows.reduce((best, w) => Math.abs(w.y - y) < Math.abs(best.y - y) ? w : best);
    const first = row.chips.find(([, r]) => x < (r.left + r.right) / 2);
    return first ? [first[0], true] : [row.chips[row.chips.length - 1][0], false];
  };
  el('ranges').addEventListener('pointerdown', e => {
    const div = e.target.closest('.range'); if (!div || e.button !== 0 || e.target.closest('input, select, button, a')) return;
    endLift(); lift = {div, x: e.clientX, y: e.clientY, on: false, id: e.pointerId};
    lift.timer = setTimeout(() => {                        // held still long enough: lift it
      if (!lift) return; lift.on = true; div.classList.add('lifted'); document.body.classList.add('chip-drag');
      const r = div.getBoundingClientRect(); lift.dx = lift.x - r.left; lift.dy = lift.y - r.top;
      const g = div.cloneNode(true); g.classList.add('ghost'); g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); g.style.width = r.width + 'px'; g.style.left = r.left + 'px'; g.style.top = r.top + 'px'; document.body.appendChild(g); lift.ghost = g;
      if (window.getSelection) try { window.getSelection().removeAllRanges(); } catch (x) {}
    }, CHIP_HOLD);
  });
  document.addEventListener('pointermove', e => {
    if (!lift || e.pointerId !== lift.id) return;
    if (!lift.on) { if (Math.hypot(e.clientX - lift.x, e.clientY - lift.y) > 8) endLift(); return; }   // moved before it lifted: a scroll or a text selection, not a drag
    e.preventDefault();
    lift.ghost.style.left = (e.clientX - lift.dx) + 'px'; lift.ghost.style.top = (e.clientY - lift.dy) + 'px';
    chipAll().forEach(d => d.classList.remove('drop-l', 'drop-r'));
    lift.to = dropAt(e.clientX, e.clientY); if (lift.to) lift.to[0].classList.add(lift.to[1] ? 'drop-l' : 'drop-r');
  }, {passive: false});
  const chipDrop = e => {
    if (!lift || (e && e.pointerId !== lift.id)) return;
    if (lift.on) {
      t.justLifted = Date.now();
      if (lift.to) { const [at, before] = lift.to; if (before) el('ranges').insertBefore(lift.div, at); else at.insertAdjacentElement('afterend', lift.div); saveChipOrder(); }
    }
    endLift();
  };
  document.addEventListener('pointerup', chipDrop); document.addEventListener('pointercancel', chipDrop);
  el('ranges').addEventListener('contextmenu', e => { if (lift && lift.on) e.preventDefault(); });   // a long press on a touch screen is the lift, not the menu
  el('ranges').addEventListener('click', e => { if (t.justLifted && Date.now() - t.justLifted < 400) { e.stopPropagation(); e.preventDefault(); } }, true);   // letting a lifted chip go is not a click on it
  t.openFilters = () => {
    const chips = chipAll();
    $('btitle').textContent = 'Filters \u00b7 ' + tabName();
    $('bsub').textContent = 'Tick the filters to keep above the table. A hidden filter is switched off, so nothing filters out of sight. To move a filter, press it, hold still until it lifts, then drag it along the row. Both are remembered in this browser.';
    $('bbody').innerHTML = '<div class="colpick">' + chips.map(div => '<label><input type="checkbox" data-id="' + esc(chipId(div)) + '"' + (hiddenChips.has(chipId(div)) ? '' : ' checked') + '> ' + esc(chipLabel(div)) + '</label>').join('') + '</div>' +
      '<div class="pickbtns"><button class="reset" id="fp-all">All filters</button><button class="reset" id="fp-order" title="Put the filters back in their original order">Default order</button><button class="reset" id="fp-done">Done</button></div>';
    const save = () => { try { if (hiddenChips.size) localStorage.setItem('chips-' + id, JSON.stringify([...hiddenChips])); else localStorage.removeItem('chips-' + id); } catch (e) {} paintChipsVis(); };
    $('bbody').querySelector('.colpick').addEventListener('input', e => { const i = e.target; if (!i || !i.dataset.id) return; if (i.checked) hiddenChips.delete(i.dataset.id); else hiddenChips.add(i.dataset.id); save(); });
    $('fp-all').addEventListener('click', () => { hiddenChips = new Set(); save(); $('bbody').querySelectorAll('.colpick input').forEach(i => { i.checked = true; }); });
    $('fp-order').addEventListener('click', () => { t.resetChipOrder(); t.openFilters(); });
    $('fp-done').addEventListener('click', () => $('bov').classList.remove('open'));
    $('bov').classList.add('open');
  };
  /* Column order (2026-10-08, Brett): click, hold and drag a header to move its column; the order is remembered per
     tab. Cells keep their ORIGINAL index underneath (data-ci), so the eyes, sorts and row builders are untouched: a row
     is built in the original order and its cells are then placed by the saved order. A band row above the headers
     (tr.grp, colspans over runs of columns) would confine a column to its own band; the eBay Catalog's band row went
     on 2026-10-13 (Brett), so today every column moves freely and the colours on the headers alone name the bands. */
  const nCols = headRow.children.length;
  const bands = (() => {                                   // [from, to) column runs under each band header, if any (data-span: the span before hidden columns shrank it)
    if (!grpRow) return null;
    const out = []; let at = 0;
    for (const th of grpRow.children) { const n = +(th.dataset.span || th.getAttribute('colspan') || 1); out.push([at, at + n]); at += n; }
    return out;
  });
  const bandOf = ci => { const b = bands(); if (!b) return [0, nCols]; return b.find(([a, z]) => ci >= a && ci < z) || [0, nCols]; };
  let order = null;                                        // array of original indexes in display order, or null = original
  try { const sv = JSON.parse(localStorage.getItem('order-' + id) || 'null'); if (Array.isArray(sv) && sv.length === nCols && [...sv].sort((a, b) => a - b).every((v, i) => v === i)) order = sv; } catch (e) {}
  [...headRow.children].forEach((th, ci) => { th.dataset.ci = ci; th.draggable = true; });
  const place = tr => { if (!order) return; const cells = [...tr.children]; if (cells.length !== nCols) return; order.forEach(ci => tr.appendChild(cells[ci])); };
  const placeAll = () => { place(headRow); el('rows').querySelectorAll('tr').forEach(place); };
  const saveOrder = () => { try { if (order) localStorage.setItem('order-' + id, JSON.stringify(order)); else localStorage.removeItem('order-' + id); } catch (e) {} };
  t.resetOrder = () => { order = null; saveOrder(); t.apply(); [...headRow.children].sort((a, b) => +a.dataset.ci - +b.dataset.ci).forEach(th => headRow.appendChild(th)); };
  let dragCi = null;
  headRow.addEventListener('dragstart', e => {
    const th = e.target.closest('th'); if (!th || e.target.closest('.eye, .help, .hlb, .rsz')) { e.preventDefault(); return; }
    dragCi = +th.dataset.ci; th.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragCi)); } catch (x) {}
  });
  headRow.addEventListener('dragover', e => {
    const th = e.target.closest('th'); if (!th || dragCi == null) return;
    const [a, z] = bandOf(dragCi), ci = +th.dataset.ci;
    if (ci < a || ci >= z) return;                         // another band: not a drop target
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    [...headRow.children].forEach(x => x.classList.remove('drop-l', 'drop-r'));
    const r = th.getBoundingClientRect(); th.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-l' : 'drop-r');
  });
  headRow.addEventListener('dragleave', e => { const th = e.target.closest('th'); if (th) th.classList.remove('drop-l', 'drop-r'); });
  headRow.addEventListener('drop', e => {
    const th = e.target.closest('th'); if (!th || dragCi == null) return;
    const [a, z] = bandOf(dragCi); if (+th.dataset.ci < a || +th.dataset.ci >= z) return;   // another band: nothing happens
    e.preventDefault();
    const cur = [...headRow.children].map(x => +x.dataset.ci);
    const r = th.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
    const from = cur.indexOf(dragCi); cur.splice(from, 1);
    let to = cur.indexOf(+th.dataset.ci) + (before ? 0 : 1);
    cur.splice(to, 0, dragCi);
    order = cur.every((v, i) => v === i) ? null : cur;
    saveOrder();
    [...headRow.children].forEach(x => x.classList.remove('drop-l', 'drop-r', 'dragging'));
    const want = order || [...Array(nCols).keys()];
    const heads = [...headRow.children]; want.forEach(ci => headRow.appendChild(heads.find(x => +x.dataset.ci === ci)));
    el('rows').querySelectorAll('tr').forEach(tr => { const cells = [...tr.children]; if (cells.length === nCols) { const byCi = {}; cells.forEach(td => { byCi[td.dataset.ci] = td; }); want.forEach(ci => tr.appendChild(byCi[ci])); } });
    dragCi = null;
  });
  headRow.addEventListener('dragend', () => { [...headRow.children].forEach(x => x.classList.remove('drop-l', 'drop-r', 'dragging')); dragCi = null; });
  t.stampRow = tr => { [...tr.children].forEach((td, ci) => { td.dataset.ci = ci; }); place(tr); if (t.sizeRow) t.sizeRow(tr); };
  el('rows').querySelectorAll('tr').forEach(t.stampRow);   // rows rendered before this block existed
  place(headRow);
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
  const ds = document.querySelector('#ranges-' + id + ' #dis-' + id);
  if (ds) ds.addEventListener('input', () => { $('dischip').classList.toggle('on', ds.checked); t.apply(); });
  if (conds.length) {
    try { const sv = JSON.parse(localStorage.getItem('cond-' + id) || 'null'); if (sv) conds.forEach(c => { c.checked = sv.includes(c.id); }); } catch (e) {}
    conds.forEach(c => c.addEventListener('input', () => {
      try { localStorage.setItem('cond-' + id, JSON.stringify(conds.filter(x => x.checked).map(x => x.id))); } catch (e) {}
      $('condchip').classList.toggle('on', conds.some(x => !x.checked)); t.apply();
    }));
    $('condchip').classList.toggle('on', conds.some(x => !x.checked));
  }
  const stats = [...document.querySelectorAll('#ranges-' + id + ' #statchip input')];
  if (stats.length) {
    try { const sv = JSON.parse(localStorage.getItem('stat-' + id) || 'null'); if (sv) stats.forEach(c => { c.checked = sv.includes(c.id); }); } catch (e) {}
    stats.forEach(c => c.addEventListener('input', () => {
      try { localStorage.setItem('stat-' + id, JSON.stringify(stats.filter(x => x.checked).map(x => x.id))); } catch (e) {}
      $('statchip').classList.toggle('on', stats.some(x => !x.checked)); t.apply();
    }));
    $('statchip').classList.toggle('on', stats.some(x => !x.checked));
  }
  if (el('reset')) { const rc = document.createElement('button'); rc.className = 'reset'; rc.type = 'button'; rc.textContent = 'Reset columns'; rc.title = 'Original order and widths, no highlights';
    rc.addEventListener('click', () => { t.resetOrder(); if (t.resetLayout) t.resetLayout(); }); el('reset').insertAdjacentElement('afterend', rc);
    const cb = document.createElement('button'); cb.className = 'reset'; cb.type = 'button'; cb.textContent = 'Columns\u2026'; cb.title = 'Choose which columns to show'; cb.addEventListener('click', () => t.openColumns()); rc.insertAdjacentElement('afterend', cb);
    const fb = document.createElement('button'); fb.className = 'reset'; fb.type = 'button'; fb.textContent = 'Filters\u2026'; fb.title = 'Choose which filters to show'; fb.addEventListener('click', () => t.openFilters()); cb.insertAdjacentElement('afterend', fb);
    t.paintChipsVis(); }
  if (el('reset')) el('reset').addEventListener('click', () => {
    el('q').value = ''; sel.value = '';
    cfg.ranges.forEach(k => { const d = cfg.defaults[k] || ['', '']; el('min' + k).value = d[0]; el('max' + k).value = d[1]; });
    maxes.forEach(k => { el('max' + k).value = ''; });
    conds.forEach(c => { c.checked = true; }); if (conds.length) { $('condchip').classList.remove('on'); try { localStorage.removeItem('cond-' + id); } catch (e) {} }
    stats.forEach(c => { c.checked = true; }); if (stats.length) { $('statchip').classList.remove('on'); try { localStorage.removeItem('stat-' + id); } catch (e) {} }
    if (sus) { sus.checked = false; $('suschip').classList.remove('on'); }
    if (t.paintChipsVis) setTimeout(t.paintChipsVis, 0);   // a hidden chip stays switched off
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
periodBar('er', () => { hitSummary(); if (tables.er) tables.er.apply(); }, 'd');   // the period chooses the table's rows too; starts on today
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
/* ---------------- The table follows the period (Brett, 2026-10-06) ----------------
   "I selected day 6 to day 6, yet I only see 2 listings instead of all 7." The collector's live rows are a rolling 24
   hours judged as they stand NOW, so a hit alerted in the morning has, by the evening, aged out or lost its verdict.
   So the Year / month / day picker now chooses the table's rows as well as the total above it:
     Only show hits ON  -> every Buy It Now hit ALERTED in the period, drawn from the snapshot taken when it alerted
                           (live.alert.hh, kept 60 days) with the numbers it had then, plus any listing first seen in
                           the period that passes right now without having been alerted;
     Only show hits OFF -> the live rows first seen in the period (only the last 24 hours of listings exist). */
function hhRows(live) {
  const H = (live.alert && live.alert.hh) || [], now = Date.now();
  return H.slice().sort((x, y) => (x[1] < y[1] ? 1 : -1)).map((h, i) => {
    const [iid, t, cid, ti, u, first, item, ship, tot, tc, bo, fb, pct, ph, tier, sc, scr, idv, A, s, mb, p, roi, tax, kd, dec, um, out, old] = h;
    const base = idRow.get(cid) || [], cs = (live.cards || {})[String(cid)] || {}, pc = base[6] == null ? null : base[6];
    const marked = umOf(iid, um);
    const row = [cid, base[1] || ti || '', base[2] || '', base[3] || '', base[4] || '', first ? r1((now - Date.parse(first)) / 36e5) : null, ti || '', item, ship, tot,
      tot == null ? null : r2(tot + (item || 0) * (tax || 0) / 100), A, A && tot ? r1((tot / A - 1) * 100) : null, mb, marked ? 'mismatch: marked by you' : 'PASS', tc || 'UNK', !!bo, fb, pct,
      out === 'unknown' ? 'gone' : out, u, null, iid, null, p, roi, s, null, null, tier || 'clean', RISK_RANK[tier] || 0, sc || 0, ph == null ? 99 : ph, scr || [], first || t,
      pc, pc && tot ? r1((tot / pc - 1) * 100) : null, '', idv || '', [], base[PC_LIVE.pcm], base[PC_LIVE.km],
      null, null, null, null, i - 100000];                 // ahead of the live rows, newest alert first
    row[46] = mtOf(cid);
    const lv = LIVE.erMap && LIVE.erMap.get(iid); row[47] = rfText(pcRF(base)); row[48] = lv ? lv[48] : null; row[49] = lv ? lv[49] : ''; row[50] = lv ? lv[50] : '';
    row[51] = base[PC_LIVE.kt]; row[52] = base[PC_LIVE.hits]; row[53] = base[PC_LIVE.hitpct]; row[54] = base[PC_LIVE.pcmm];
    row.hh = {t, kd, dec, old, out}; row.um = marked; row.lrn = ''; row.tw = null;
    return row;
  });
}
function erRows() {
  const P = PERIOD.er, all = LIVE.er || [], note = $('per-note');
  if (!P) return all;
  // The table's own window is the last 24 hours. A period that reaches into the present (today, this month, the year)
  // shows that whole window - with "today" the default since 2026-10-13, last evening's listings must not vanish at
  // midnight; a period in the past keeps only the listings first seen inside it.
  const live = P.now(), inP = r => live || P.test(r[34]);
  let rows;
  if ($('hits').checked) {
    const mine = (LIVE.hh || []).filter(r => P.test(r.hh.t)), ids = new Set(mine.map(r => r[22]));
    rows = mine.concat(all.filter(r => (r[14] === 'PASS' || r.um) && !ids.has(r[22]) && inP(r)));   // a row he marked stays in view
    if (note) { note.hidden = false; note.textContent = 'Showing every Buy It Now hit alerted in ' + P.label() + ', with the numbers each had when it alerted; the Verdict column says where it stands now. Hits are kept for 60 days.'; }
  } else {
    rows = all.filter(inP);
    if (note) { note.hidden = rows.length === all.length; note.textContent = 'Showing listings first seen in ' + P.label() + ': ' + rows.length.toLocaleString() + ' of the ' + all.length.toLocaleString() + ' from the last 24 hours. Listings that were not hits are only kept for 24 hours; tick "Only show hits" to see the hits of an earlier day.'; }
  }
  return rows;
}
// under a hit's verdict: when it alerted, and where the listing stands now
function hhNote(r) {
  if (!$('hits').checked || AU_ON()) return '';
  if (!r.hh) return '<br><span class="dim">passes now \u00b7 no alert sent</span>';
  const live = LIVE.erMap && LIVE.erMap.get(r[22]);
  const now = live ? (live[14] === 'PASS' ? 'still passes' : 'now: ' + live[14]) + (live[19] && live[19] !== 'open' ? ' (' + live[19] + ')' : '') : 'older than 24 h' + (r.hh.out && r.hh.out !== 'unknown' ? ', ' + r.hh.out : '');
  return '<br><span class="dim">' + (/drop/.test(r.hh.kd) ? 'price drop, ' : '') + 'alerted ' + rvWhen(r.hh.t) + ' \u00b7 ' + esc(now) + (r.hh.old ? ' \u00b7 rebuilt from the alert log' : '') + '</span>';
}

/* ---------------- "Mismatch": Brett's own verdict on a listing ----------------
   A tick on a Raw Data row (or in the list behind the hit total) says the listing is not the card it was matched to.
   The row stays, tinted; the listing leaves the statistics and the hit total; the collector's matcher learns from it
   (ebay_sweep.py: learn_tables). The tick shows at once from MARKS and is confirmed by live.alert.mark_t. */
const MARKS = {};                                  // item id -> {v: 1 | 0, t}
const umOf = (iid, flag) => iid in MARKS ? !!MARKS[iid].v : !!flag;
/* The Review column (2026-10-08, Brett's request): the phone's first question - PriceCharting's picture beside the
   eBay photos, the facts row by row, Same card / Not the same - as a popup on the site, so he can check a match on
   the laptop the way he does on the phone. "Not the same" IS the Mismatch tick (same flag, same learning); "Same
   card" clears it and records a confirmed match. The answer shows in the cell; clicking it opens the popup again. */
const REVIEWS = {};                                // item id -> {v: 1 same | 0 not the same | null withdrawn, t}, until the collector confirms
const reviewOf = iid => iid in REVIEWS ? REVIEWS[iid].v : (LIVE.data && LIVE.data.alert && LIVE.data.alert.reviews && iid in LIVE.data.alert.reviews ? LIVE.data.alert.reviews[iid] : (umOf(iid, false) ? 0 : null));
const umCell = r => { const v = r[22] ? reviewOf(r[22]) : null; const marked = r.um && v !== 1;
  return '<td class="mmk"><button class="rvb' + (v === 1 ? ' same' : marked || v === 0 ? ' diff' : '') + '" data-i="' + esc(r[22] || '') + '" title="' + (v === 1 ? 'You said: same card. Click to review again' : marked || v === 0 ? 'You said: not the same card. Click to review again' : 'Compare the PriceCharting picture with the eBay photos') + '">' +
    (v === 1 ? '\u2713 same' : marked || v === 0 ? '\u2717 mismatch' : 'Review') + '</button></td>'; };
async function sendMark(iid, on) {
  if (!iid) return;
  const t = Date.now();
  MARKS[iid] = {v: on ? 1 : 0, t};
  if (LIVE.data) rebuildLive();
  try { await alSend({type: 'mark', t, i: iid, v: on ? 1 : 0}); }
  catch (e) { delete MARKS[iid]; if (LIVE.data) rebuildLive(); $('sum-er').insertAdjacentHTML('beforeend', ' <span class="down">The mark could not be sent (' + esc(e.message) + ').</span>'); }
}
document.addEventListener('click', e => { const b = e.target && e.target.closest ? e.target.closest('button.rvb') : null; if (b && b.dataset.i) openReview(b.dataset.i); });
const PC_IMG_URL = code => 'https://storage.googleapis.com/images.pricecharting.com/' + code + '/1600.jpg';
const PCIMG_KNOWN = {};                            // card id -> picture code learned over the channel before the live file carries it
function pcPicture(cid) { const t = LIVE.data && LIVE.data.pcimg; const code = PCIMG_KNOWN[String(cid)] || (t && t[String(cid)]); return code ? PC_IMG_URL(code) : null; }
const PCIMG_ASKED = {};                            // card id -> when the collector was asked for its picture (once per 5 minutes)
function pcAsk(cid) {
  if (cid == null || PCIMG_ASKED[cid] > Date.now() - 300000) return;
  const t = Date.now(); PCIMG_ASKED[cid] = t;
  alSend({type: 'pcimg', t, c: cid}, '-pc').then(() => pcWait(cid, t)).catch(() => { delete PCIMG_ASKED[cid]; });
}
// the chart popup: a card whose PriceCharting history is missing or older than a day is read again now (the collector
// publishes the shard at once); the popup looks for the new record every 45 s while it stays open on that card
const PCHIST_ASKED = {};
function pcHistAsk(cid, i) {
  if (cid == null || !LIVE.data || PCHIST_ASKED[cid] > Date.now() - 600000) return;
  const t = Date.now(); PCHIST_ASKED[cid] = t;
  alSend({type: 'pchist', t, c: cid}, '-pc').then(async () => {
    for (let k = 0; k < 8; k++) {
      await new Promise(r => setTimeout(r, 45000));
      if (!$('ov').classList.contains('open') || !pcGateCard || pcGateCard[0] !== cid) return;
      const h = await loadPcHist(cid, true).catch(() => null);
      if (h && (!pcCur || pcCur.h.t !== h.t || pcCur.h.p.length !== h.p.length || !!pcCur.h.s !== !!h.s)) { pcCur = {h, card: DATA[i]}; drawPcChart(); renderPcTable(); return; }
    }
  }).catch(() => { delete PCHIST_ASKED[cid]; });
}
// the collector answers on the channel's reply topic the moment it has read the card's page (the live file takes
// minutes to reach the browser): look every 4 seconds for two and a half minutes, while the popup is still on that card
async function pcWait(cid, t0) {
  const ch = await alChannel(), enc = new TextEncoder();
  const hexBytes = h => new Uint8Array((String(h).match(/../g) || []).map(x => parseInt(x, 16)));
  let since = Math.floor(t0 / 1000) - 5;
  for (let i = 0; i < 38; i++) {
    await new Promise(r => setTimeout(r, 4000));
    if (!$('bov').classList.contains('open') || LIVE.rvCard !== cid) return;
    let lines = [];
    try { const r = await fetch('https://ntfy.sh/' + ch.topic + '-pcr/json?poll=1&since=' + since, {cache: 'no-store'}); if (r.ok) lines = (await r.text()).split('\n').filter(Boolean); } catch (e) { continue; }
    for (const line of lines) {
      try {
        const ev = JSON.parse(line); if (ev.event !== 'message') continue;
        since = ev.id;
        const env = JSON.parse(ev.message);
        if (!await crypto.subtle.verify('HMAC', ch.key, hexBytes(env.s), enc.encode(env.m))) continue;
        const msg = JSON.parse(env.m);
        if (msg.type !== 'pcimg' || String(msg.c) !== String(cid)) continue;
        if (msg.code) { PCIMG_KNOWN[String(cid)] = msg.code; reviewPicRefresh(); }
        else { const box = $('bbody').querySelector('.rvbox[data-pc]'); if (box) { box.removeAttribute('data-pc'); box.querySelector('small').textContent = 'PriceCharting has no picture of this card'; } }
        return;
      } catch (e) { continue; }
    }
  }
}
// the popup is open on a card whose picture had not arrived: when the live data brings it, show it in place
function reviewPicRefresh() {
  if (!$('bov').classList.contains('open') || LIVE.rvCard == null) return;
  const box = $('bbody').querySelector('.rvbox[data-pc]'); if (!box) return;
  const pcu = pcPicture(LIVE.rvCard); if (!pcu) return;
  const pcPage = 'https://www.pricecharting.com/game/' + LIVE.rvCard;
  box.outerHTML = '<a href="' + pcPage + '" target="_blank" rel="noopener"><img class="rvpic" src="' + esc(pcu) + '" alt="PriceCharting picture: click to open their page"></a>';
}
function openReview(iid) {
  const r = LIVE.erMap && LIVE.erMap.get(iid); if (!r) return;
  const x = (LIVE.data.live || []).find(z => z[0] === iid) || [];
  const cs = (LIVE.dec || {})[String(r[0])] || {}, base = idRow.get(r[0]) || [];
  const big = u => String(u || '').replace(/s-l\d+\./, 's-l1600.');
  const pics = [r[21]].concat(x[33] || []).filter(Boolean);
  const pcu = pcPicture(r[0]), pcPage = 'https://www.pricecharting.com/game/' + r[0];
  LIVE.rvCard = r[0];
  if (!pcu) pcAsk(r[0]);                           // the collector reads that one page now; the picture lands here within a minute or two
  const m = /(\d+)\s*\/\s*(\d+)/.exec(r[6] || '');
  const tot = r[9], allin = r[10], taxAmt = allin != null && tot != null ? Math.round((allin - tot) * 100) / 100 : 0;
  const fact = (lab, val, sub) => '<span class="lab">' + lab + '</span><b>' + val + '</b>' + (sub ? '<small>' + sub + '</small>' : '');
  const row = (l, rr) => '<div class="rrow"><div>' + (l || '') + '</div><div>' + (rr || '') + '</div></div>';
  const variant = (/\[([^\]]+)\]/.exec(r[1] || '') || [])[1];
  const mm = LIVE.data.alert && LIVE.data.alert.mm && LIVE.data.alert.mm[String(r[0])];
  // Set name, rarity and finish, PriceCharting against eBay (the phone's rows, 2026-10-12): the card's own words (daily
  // build) and eBay's record of this listing (row 48) - red when they name another card, amber when one tier apart
  const p = pcRF(base) || ['', ''], ef = r[48];
  const pcv = v => v ? '<b class="fit">' + esc(v) + '</b>' : '<b class="fit mute">unknown</b>';
  const ebv = (i, cmp) => ef == null ? '<b class="fit mute">not read</b>' : !ef.length || !ef[i] ? '<b class="fit mute">not stated</b>'
    : '<b class="fit' + (cmp === 'far' ? ' bad' : cmp === 'near' ? ' amber' : '') + '">' + esc(ef[i]) + '</b>';
  const trio = ['Set name', 'Rarity', 'Finish'].map((lab, i) => row('<span class="lab">' + lab + '</span>' + pcv(i ? p[i - 1] : String(r[2] || '').replace(/^Pokemon /, '')),
                                                                     '<span class="lab">' + lab + '</span>' + ebv(i, ef && ef[6 + i]))).join('');
  const v = reviewOf(iid);
  $('btitle').textContent = r[1] + ' \u2014 ' + String(r[2] || '').replace('Pokemon ', '');
  $('bsub').innerHTML = 'Is the card in the eBay photos the card PriceCharting shows? ' + (v === 1 ? '<b class="up">You said: same card.</b>' : v === 0 || r.um ? '<b class="down">You said: not the same.</b>' : '');
  let h = '<div class="rvpair">' +
    '<div class="rvside"><h4>PriceCharting <a href="' + pcPage + '" target="_blank" rel="noopener">\u2197</a></h4>' +
      (pcu ? '<a href="' + pcPage + '" target="_blank" rel="noopener"><img class="rvpic" src="' + esc(pcu) + '" alt="PriceCharting picture: click to open their page"></a>'
           : '<div class="rvbox" data-pc="1"><a href="' + pcPage + '" target="_blank" rel="noopener">See the picture on PriceCharting</a><small>being fetched now \u2014 it appears here within a minute or two</small></div>') + '</div>' +
    '<div class="rvside"><h4><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener">eBay listing \u2197</a></h4>' +
      (pics.length ? '<a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener"><img class="rvpic" id="rvpic" src="' + esc(big(pics[0])) + '" alt="eBay photo: click to open the listing"></a>' +
        (pics.length > 1 ? '<div class="rvthumbs">' + pics.map((u, i) => '<img src="' + esc(u) + '" data-k="' + i + '"' + (i === 0 ? ' class="on"' : '') + ' alt="">').join('') + '</div>' : '')
       : '<div class="rvbox"><span class="dim">no photo on file</span></div>') + '</div></div>';
  h += '<div class="rvrows">' +
    row(fact('Set / card number', esc(r[3]) + (SET_TOTALS[r[2]] ? ' / ' + SET_TOTALS[r[2]] : '')), fact('Set / card number', m ? m[1] + ' / ' + m[2] : 'none in the title')) +
    trio +
    (mm && mm[0] > 0 ? row('', '<span class="lab">Mismatched before</span><b class="amber">' + (mm[2] ? mm[1] + ' of ' + mm[2] + ' alert' + (mm[2] === 1 ? '' : 's') : mm[0] + ' listing' + (mm[0] === 1 ? '' : 's')) + '</b><small>' + (mm[3] ? mm[0] + ' of ' + mm[3].toLocaleString('en-US') + ' listings matched to this card (' + (mm[0] / mm[3] * 100).toFixed(1) + '%)' : 'on this card') + '</small>') : '') +
    (variant || r[38] === 'conflict' ? row(variant ? '<span class="tag warn">' + esc(variant.toUpperCase()) + '</span><small>a special printing: check the photo shows it</small>' : '',
                                            r[38] === 'conflict' ? '<span class="tag bad">item specifics disagree</span><small>' + esc((r[39] || []).join('; ')) + '</small>' : '') : '') +
    row(fact('Ungraded price', fmtMoneyPlain(r[35])), fact('Total price', fmtMoneyPlain(allin), 'card ' + fmtMoneyPlain(r[7]) + ' + shipping ' + fmtMoneyPlain(r[8]) + (taxAmt > 0 ? ' + tax ' + fmtMoneyPlain(taxAmt) : ', no buy tax'))) +
    row(fact('Sales per month', r[40] == null ? '?' : r[40]), fact('Sold this month', r[41] == null ? '?' : r[41], cs.D == null ? '' : cs.D + ' days tracked')) +
    row('', fact('Seller', (r[17] == null ? '?' : Number(r[17]).toLocaleString('en-US')) + ' ratings', (r[18] != null ? r[18] + '% positive \u00b7 ' : '') + (r[32] === 99 ? '?' : r[32]) + ' photos')) +
    '<div class="rrow"><div><span class="lab">Title</span><small>' + esc(r[6]) + '</small></div><div><span class="lab">Verdict</span><b>' + esc(r[14]) + '</b></div></div></div>';
  h += '<div class="rvbtns"><button class="rvno" id="rv-no">Not the same card<small>leaves the statistics; the matcher learns from it</small></button><button class="rvyes" id="rv-yes">Same card<small>a confirmed match</small></button></div>' +
       (v != null || r.um ? '<div class="rvundo"><button class="linkbtn" id="rv-undo">Withdraw my answer</button></div>' : '') + '<div id="rvmsg" class="dim"></div>';
  $('bbody').innerHTML = h;
  $('bov').classList.add('open');
  fitRows($('bbody'));
  const thumbs = $('bbody').querySelectorAll('.rvthumbs img');
  thumbs.forEach(t => t.addEventListener('click', e => { e.preventDefault(); $('rvpic').src = big(pics[+t.dataset.k]); thumbs.forEach(z => z.classList.toggle('on', z === t)); }));
  const answer = async val => {
    const t = Date.now(); REVIEWS[iid] = {v: val, t};
    $('rvmsg').textContent = 'Sending\u2026';
    try { await alSend({type: 'review', t, i: iid, v: val}); $('bov').classList.remove('open'); }
    catch (e) { delete REVIEWS[iid]; $('rvmsg').innerHTML = '<span class="down">The answer could not be sent (' + esc(e.message) + ').</span>'; }
    if (LIVE.data) rebuildLive();
  };
  $('rv-no').addEventListener('click', () => answer(0));
  $('rv-yes').addEventListener('click', () => answer(1));
  const undo = $('rv-undo'); if (undo) undo.addEventListener('click', () => answer(null));
}

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
  if (cs && cs.tw && total < cs.tw[0]) return ['reprint?', allin, null];    // priced nearer its anniversary reprint than the card itself
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
  LIVE.sets = live.sets || {};
  LIVE.ec = []; LIVE.er = []; LIVE.dec = {};
  fillPcm();                                              // PC sales for every card (pcm.bin), the eBay figures cleared, refilled below
  const covered = (live.since || '9999-99-99') <= prevMonthStart();   // was the collector running for the whole of last month?
  for (const [cid, c] of Object.entries(live.cards)) {
    const base = idRow.get(+cid); if (!base) continue;
    const d = decide(c, S); LIVE.dec[cid] = Object.assign({}, c, d);
    const hot = c.hot === 2 ? 'confirmed' : c.hot === 1 ? 'candidate' : '';
    const t = c.tr || {};
    const vspc = (c.pc || base[6]) && d.A ? Math.round((d.A / (c.pc || base[6]) - 1) * 1000) / 10 : null;   // anchor vs PriceCharting
    const km = covered && c.km != null ? c.km : null, kt = c.kt == null ? null : c.kt, n30 = c.n30 || 0;
    const hits = (live.hits30 || {})[cid] || 0, hl = (live.hl30 || {})[cid] || 0, hitpct = n30 ? Math.round(Math.min(hl, n30) / n30 * 1000) / 10 : null;
    base[PC_LIVE.km] = km; base[PC_LIVE.kt] = kt; base[PC_LIVE.A] = d.A == null ? null : d.A; base[PC_LIVE.vspc] = vspc; base[PC_LIVE.hits] = hits; base[PC_LIVE.hitpct] = hitpct; base.n30 = n30;
    LIVE.ec.push([base[0], base[1], base[2], base[3], base[4],
                  c.k, c.D, c.N, c.p1, c.p2, c.p3, c.mu, c.smed, c.s80, c.hrs, c.st,
                  c.lam, c.price, c.dos, c.io,
                  d.A, d.L, d.sell, d.probT, d.edays, d.maxbuy, hot, d.liquid, c.confirm, c.checks,
                  t.spm == null ? null : t.spm, t.d7 == null ? null : t.d7, t.d30 == null ? null : t.d30, t.pos == null ? null : t.pos,
                  t.vdp == null ? null : t.vdp, t.vd == null ? null : t.vd, t.vol == null ? null : t.vol, t.ts == null ? null : t.ts,
                  d.net, c.A_n || 0, LIVE.ec.length,
                  base[PC_LIVE.pcm],                                                              // 41 PriceCharting's sales in the last complete month (53 = which month)
                  c.pc == null ? base[6] : c.pc,                                                  // 42 PriceCharting ungraded $
                  vspc,                                                                           // 43 anchor vs PriceCharting
                  (live.hits30 || {})[String(cid)] || 0,                                          // 44 alerts on the card, 30 days
                  mtOf(cid),                                                                      // 45 "match:mismatch"
                  rfText(pcRF(base)), (live.ef || {})[String(cid)] || null,                       // 46-47 PC rarity/finish, eBay's record of the card
                  rfText((live.ef || {})[String(cid)] || null),                                   // 48 eBay rarity/finish, for sorting
                  km, kt, n30, hitpct, base[PC_LIVE.pcmm]]);                                      // 49-53 (2026-10-13): the month columns and Hit %
  }
  let passes = 0, hiddenImg = 0, hiddenSus = 0, tooCheap = 0, leads = 0, disagree = 0;
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
                  base[PC_LIVE.pcm], base[PC_LIVE.km],                                           // 40-41 PC sales last month, eBay sales last month
                  null, null, null, null, LIVE.er.length];                     // 42-45 belong to the auction view (auRows)
    erow[46] = mtOf(x[1]);
    erow[51] = base[PC_LIVE.kt]; erow[52] = base[PC_LIVE.hits]; erow[53] = base[PC_LIVE.hitpct]; erow[54] = base[PC_LIVE.pcmm];
    erow[47] = rfText(pcRF(base)); erow[48] = x[34] === undefined ? null : x[34];
    erow[49] = erow[48] && erow[48].length ? erow[48][0] || '' : ''; erow[50] = erow[48] && erow[48].length ? rfText([erow[48][1], erow[48][2]]) : '';
    if (rfBad(erow)) disagree++;
    erow.um = x[0] in REVIEWS ? REVIEWS[x[0]].v === 0 : umOf(x[0], x[31]); erow.lrn = x[32] || ''; erow.tw = (cs && cs.tw) || null;
    LIVE.er.push(erow);
  });
  $('nsus').textContent = hiddenSus; $('ncheap').textContent = tooCheap; $('nlead').textContent = leads; $('ndis').textContent = disagree;
  alRender();
  applyHelp(live.help);                                 // descriptions and READMEs he rewrote with the pencil
  const markT = (live.alert && live.alert.mark_t) || 0;  // the collector has taken every mark up to this time
  for (const k of Object.keys(MARKS)) if (markT >= MARKS[k].t) delete MARKS[k];
  const reviewT = (live.alert && live.alert.review_t) || 0;
  for (const k of Object.keys(REVIEWS)) if (reviewT >= REVIEWS[k].t) delete REVIEWS[k];
  LIVE.erMap = new Map(LIVE.er.map(r => [r[22], r]));
  LIVE.hh = hhRows(live);
  LIVE.au = auRows(live); $('nau').textContent = LIVE.au.length;
  $('nmm').textContent = ((live.alert && live.alert.wrong) || []).length;
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
  paintPcPill();
  tables.pc.apply(true); tables.ec.apply(true); tables.er.apply(true);   // true: a refresh keeps the rows already shown (Show more) on view
}
// the small pill in the header: is the collector reading PriceCharting signed in (the charts' volume bars depend on it)?
function paintPcPill() {
  const el = $('pcpill'); if (!el) return;
  const p = (LIVE.data && LIVE.data.pch) || {}, si = p.signin || 'none';
  el.hidden = false;
  if (si === 'ok') {
    el.className = 'pcpill ok'; el.textContent = 'PriceCharting connected';
    el.title = 'The collector reads PriceCharting signed in, so the Trend charts get the monthly volume bars' + (p.signed != null ? ' \u00b7 ' + Number(p.signed).toLocaleString('en-US') + ' of ' + Number(p.total || 0).toLocaleString('en-US') + ' cards have them so far' : '');
  } else if (si === 'unknown') {
    el.className = 'pcpill'; el.textContent = 'PriceCharting checking\u2026';
    el.title = 'The collector just started with a new sign-in; the first page it reads tells whether it works';
  } else {
    el.className = 'pcpill bad'; el.textContent = 'PriceCharting not connected';
    el.title = si === 'expired' ? 'The collector\u2019s PriceCharting sign-in has expired: new months get no volume bars until a fresh cookie is pasted (PC_COOKIE in /etc/pokemon-collector.env, then systemctl restart pokemon-collector). The bars already on file stay.'
      : 'The collector has no PriceCharting sign-in (no PC_COOKIE on the droplet): the Trend charts show prices without the volume bars';
  }
}
// PC sales: every card's last complete month of PriceCharting sales (pcm.bin, the collector publishes it hourly) onto
// the catalog rows; the eBay figures on those rows are cleared here and refilled by rebuildLive
function fillPcm() {
  const pcm = LIVE.pcm || {};
  DATA.forEach(r => { const e = pcm[String(r[0])]; r[PC_LIVE.pcm] = e ? e[1] : null; r[PC_LIVE.pcmm] = e ? e[0] : null; r[PC_LIVE.km] = r[PC_LIVE.kt] = r[PC_LIVE.A] = r[PC_LIVE.vspc] = r[PC_LIVE.hits] = r[PC_LIVE.hitpct] = null; r.n30 = 0; });
}
async function loadPcm() {
  if (!LIVE_URL || !HKEY) return;
  try {
    const res = await fetch(LIVE_URL.replace(/[^/]+$/, 'pcm.bin') + '?t=' + Math.floor(Date.now() / 3600000), {cache: 'no-store'});
    if (!res.ok) return;
    LIVE.pcm = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
    if (LIVE.data) rebuildLive(); else { fillPcm(); tables.pc.apply(true); }
  } catch (e) { /* the next hour retries */ }
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
  loadPcm(); setInterval(loadPcm, 3600000);              // PC sales (last complete month), hourly
  setInterval(refreshLive, 60000);
  setInterval(tickAge, 30000);
}
// the collector publishes every couple of minutes; pick up new data without a reload, and tint what arrived since
async function refreshLive() {
  if (document.hidden || !LIVE.data) return;
  try {
    const d = await fetchLive();
    if (d.t !== LIVE.data.t) { LIVE.prevT = LIVE.data.t; LIVE.data = d; rebuildLive(); reviewPicRefresh(); }
  } catch (e) { /* keep showing what we have; the next minute retries */ }
}
function tickAge() {
  if (PERIOD.er) PERIOD.er.roll();                       // past midnight, an untouched Raw Data period follows the calendar
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
/* ---------------- Mismatches: which cards go wrong most often ----------------
   One row per PriceCharting card Brett has marked at least one listing against (a Mismatch tick here, or a "No, not
   the same card" on the phone), with the count and, where the listings were alerts, "3 of 12 alerts". Clicking a
   row lists the listings behind the number. live.alert.mm = {card id: [marked, of those alerts, alerts sent]}. */
function openMismatches() {
  const A = (LIVE.data && LIVE.data.alert) || {}, W = A.wrong || [], MM = A.mm || {};
  const by = new Map();
  W.forEach(w => { const k = w[6] == null ? '?' + w[1] : String(w[6]); if (!by.has(k)) by.set(k, []); by.get(k).push(w); });
  const cards = [...by.entries()].map(([k, list]) => { const base = idRow.get(+k) || [], m = MM[k] || [list.length, 0, 0];
    return {k, id: base[0], name: base[1] || list[0][4] || 'Card not on record', set: String(base[2] || list[0][5] || '').replace('Pokemon ', ''), n: list.length, x: m[1], y: m[2], t: m[3] || 0, list}; })
    .sort((p, q) => q.n - p.n || (p.name < q.name ? -1 : 1));
  const when = t => new Date(t).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  $('btitle').textContent = 'Mismatches';
  $('bsub').textContent = W.length + ' listing' + (W.length === 1 ? '' : 's') + ' you marked as not the card ' + (W.length === 1 ? 'it was' : 'they were') + ' matched to, across ' + cards.length + ' card' + (cards.length === 1 ? '' : 's') + '. Most-mismatched first. Click a card to see its listings.';
  $('bbody').innerHTML = '<input class="mmq" id="mm-q" type="search" placeholder="Search card or set\u2026"><div id="mm-list"></div>';
  const draw = () => {
    const q = $('mm-q').value.trim().toLowerCase(), show = cards.filter(c => !q || (c.name + ' ' + c.set).toLowerCase().includes(q));
    $('mm-list').innerHTML = !cards.length ? '<p>None yet. Tick Mismatch on a Raw Data row, or answer "No, not the same card" on your phone.</p>' : !show.length ? '<p>No card matches that search.</p>' :
      '<table><thead><tr><th>PriceCharting card</th><th class="num">Mismatches</th><th>Of its matches</th><th>Of its alerts</th></tr></thead><tbody>' +
      show.map(c => '<tr class="mmr" data-k="' + esc(c.k) + '"><td>' + (c.id ? '<a href="https://www.pricecharting.com/game/' + c.id + '" target="_blank" rel="noopener">' + esc(c.name) + '</a>' : esc(c.name)) + (c.set ? ' <span class="dim">' + esc(c.set) + '</span>' : '') + '</td><td class="num"><b>' + c.n + '</b></td><td>' + (c.t ? c.n + ' of ' + c.t.toLocaleString('en-US') + ' listing' + (c.t === 1 ? '' : 's') + ' <span class="dim">(' + (c.n / c.t * 100).toFixed(1) + '%)</span>' : '<span class="dim">no matches on record</span>') + '</td><td>' + (c.y ? c.x + ' of ' + c.y + ' alert' + (c.y === 1 ? '' : 's') : '<span class="dim">no alerts counted yet</span>') + '</td></tr>' +
        '<tr class="mmd" data-k="' + esc(c.k) + '" hidden><td colspan="4"><ul>' + c.list.map(w => '<li>' + when(w[0]) + ' \u00b7 <a href="' + esc(w[3] || '#') + '" target="_blank" rel="noopener">' + esc(w[2] || w[1]) + '</a>' + (w[8] != null ? ' \u00b7 ' + fmtMoney(w[8]) : '') + (w[7] ? ' <span class="dim">\u00b7 ' + esc(String(w[7]).replace('-drop', ', price drop').replace('-lead', ', lead')) + '</span>' : '') + '</li>').join('') + '</ul></td></tr>').join('') + '</tbody></table>';
  };
  $('mm-q').addEventListener('input', draw);
  $('bbody').onclick = e => { const tr = e.target.closest ? e.target.closest('tr.mmr') : null; if (!tr || e.target.closest('a')) return; const d = [...$('mm-list').querySelectorAll('tr.mmd')].find(x => x.dataset.k === tr.dataset.k); if (d) d.hidden = !d.hidden; };
  draw();
  $('bov').classList.add('open');
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

const COLORS = {loose: '#3b82f6', sell: '#22c55e', buy: '#f59e0b', vol: '#9ca3af', ref: '#a78bfa', fresh: '#fbbf24'};
const LABEL_EB = {loose: 'Sold median (7d)', sell: 'Cheapest ask', buy: '', vol: 'Sales/day', ref: '90d high/low + Sell'};
let LABEL = LABEL_EB;                                    // the shared chart draws the eBay history; PriceCharting's chart is drawPcChart()
let cur = null;               // {dates, vol, loose, sell, sold, fresh, st, anchor, refs, ebay, card, full}
let pts = [];
function setChartLabels(lab) {
  LABEL = lab;
  $('l-loose').textContent = lab.loose + ' $'; $('l-sell').textContent = lab.sell + ' $'; $('l-buy').textContent = lab.buy ? lab.buy + ' $' : '';
  $('l-buy').parentElement.style.display = lab.buy ? '' : 'none';
  $('l-vol').textContent = lab.vol + ' (left axis)'; $('l-ref').textContent = lab.ref;
}

/* eBay history (Brett, 2026-10-13: "have the eBay Catalog trend chart resemble the PriceCharting trend chart ... built on
   eBay data ... daily, weekly or monthly time points"). The same popup as PriceCharting's chart, drawn only from the
   collector's daily rollup (live.cards[cid].hist: one point per day since the collector started, kept 120 days -
   sales, the trailing 7-day median sale total, the cheapest ask, every sale total (sp) and the listings that appeared
   (new)). Points: Day / Week / Month decides what one bar is; the page folds the days itself. Bars = sales in the
   period, a paler amber bar beside it = new listings (off by default), the price line = the 7-day median with Day
   points or the period's own median with Week / Month points (3 sales or blank), a dot per sale with Day points, the
   cheapest ask = the period's last reading. A period still running (today, this week, this month) or one the history
   only partly covers is drawn faded with a dashed edge and says "to date" / "from <day>". Under the chart: the same
   periods as a table, newest first, with a CSV. The choice of points is remembered (eb-pts). */
const EB_MED_MIN = 3;                                    // sales a period needs before its median is drawn (the collector's MED_MIN_SALES)
const EB_UNIT = {d: 'day', w: 'week', m: 'month'};
const DAY_MS = 86400000;
const dayIso = t => new Date(t).toISOString().slice(0, 10);
const ebPts = () => { try { const v = localStorage.getItem('eb-pts'); return v === 'w' || v === 'm' ? v : 'd'; } catch (e) { return 'd'; } };
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
function openTrendEbay(cid) {
  const c = LIVE.dec && LIVE.dec[String(cid)], base = idRow.get(cid);
  if (!c || !base) return;
  pcMode(false); pcCur = null;
  setChartLabels(LABEL_EB);
  $('mtitle').textContent = base[1];
  $('msub').textContent = base[2] + ' · #' + base[3] + ' · eBay raw sales';
  $('note').textContent = ''; $('stats').innerHTML = ''; $('gate').innerHTML = ''; $('chart').innerHTML = ''; $('ebtable').innerHTML = '';
  $('ov').classList.add('open');
  const h = c.hist, t = c.tr;
  if (!h || !t) { cur = null; $('note').textContent = 'No eBay sales recorded for this card yet. The rollup adds one point per day.'; return; }
  const t0 = Date.parse(h.start + 'T00:00:00Z');
  const dates = h.sales.map((_, k) => dayIso(t0 + k * DAY_MS));
  let at = 0;
  const sold = h.sales.map(n => { const s = (h.sp || []).slice(at, at + n); at += n; return s; });   // each day's sale totals, split from the flat list
  cur = {dates, vol: h.sales, loose: h.price, sell: h.ask, sold, fresh: h.new || null, st: t, anchor: c.price,
         refs: [['90d high', t.hi], ['90d low', t.lo], ['Sell', c.sell]], ebay: c, card: base, full: !!h.sp};
  drawChart(); renderEbTable(); renderStatsEbay();
}
function ebBuckets(mode) {                               // the daily series folded into Day / Week (Mon-Sun) / Month periods
  const today = dayIso(Date.now()), out = [], by = new Map();
  cur.dates.forEach((d, k) => {
    const t = Date.parse(d + 'T00:00:00Z'), dt = new Date(t);
    let start = d, end = d;
    if (mode === 'w') { const wd = (dt.getUTCDay() + 6) % 7; start = dayIso(t - wd * DAY_MS); end = dayIso(t + (6 - wd) * DAY_MS); }
    else if (mode === 'm') { start = d.slice(0, 7) + '-01'; end = dayIso(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)); }
    let b = by.get(start);
    if (!b) { b = {d: start, end, first: d, last: d, t: Date.parse(start + 'T00:00:00Z'), vol: 0, fresh: 0, sold: [], loose: null, sell: null}; by.set(start, b); out.push(b); }
    b.last = d;
    b.vol += cur.vol[k] || 0; b.fresh += (cur.fresh && cur.fresh[k]) || 0;
    if (cur.sold[k] && cur.sold[k].length) b.sold = b.sold.concat(cur.sold[k]);
    if (cur.sell[k] != null) b.sell = cur.sell[k];      // the last ask reading in the period
    if (mode === 'd') b.loose = cur.loose[k];
  });
  out.forEach(b => {
    if (mode !== 'd') b.loose = b.sold.length >= EB_MED_MIN ? Math.round(median(b.sold) * 100) / 100 : null;
    b.lo = b.sold.length ? Math.min.apply(null, b.sold) : null; b.hi = b.sold.length ? Math.max.apply(null, b.sold) : null;
    b.open = b.end >= today;                             // still running: today, this week, this month
    b.from = b.first > b.d;                              // the history starts inside the period
  });
  return out;
}
function ebLabel(b, mode, long) {
  const d = new Date(b.t);
  if (mode === 'm') return (long ? MONTHS_LONG : MONTHS)[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  if (mode === 'w') {
    if (!long) return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
    const e = new Date(Date.parse(b.end + 'T00:00:00Z'));
    return 'Week of ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ' – ' + MONTHS[e.getUTCMonth()] + ' ' + e.getUTCDate() + ', ' + e.getUTCFullYear();
  }
  return long ? MONTHS_LONG[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() : b.d;
}
function renderEbTable() {                               // the periods as a table under the chart, newest first, with a CSV
  const box = $('ebtable');
  if (!cur) { box.innerHTML = ''; return; }
  const mode = ebPts(), unit = EB_UNIT[mode], rows = ebBuckets(mode), r = cur.card, hasNew = !!cur.fresh, Unit = unit[0].toUpperCase() + unit.slice(1);
  const money = v => v == null ? '<span class="dim">—</span>' : fmtMoneyPlain(v), num = v => v == null ? '' : v.toFixed(2);
  let html = '<div class="pcth"><b>' + Unit + ' by ' + unit + '</b><span class="dim"> · eBay raw sales the collector recorded, newest first</span><button class="reset" id="ebcsv">Download CSV</button></div>';
  html += '<div class="pctbox"><table><thead><tr><th>' + Unit + '</th><th class="num">Sales</th><th class="num">Median' + (mode === 'd' ? ' (7d)' : '') + '</th><th class="num">Low</th><th class="num">High</th><th class="num">Cheapest ask</th>' + (hasNew ? '<th class="num">New listings</th>' : '') + '</tr></thead><tbody>';
  for (let k = rows.length - 1; k >= 0; k--) {
    const b = rows[k];
    html += '<tr' + (b.open || b.from ? ' class="part"' : '') + '><td>' + ebLabel(b, mode, true) + (b.open ? ' <span class="dim">to date</span>' : '') + (b.from ? ' <span class="dim">from ' + b.first + '</span>' : '') + '</td><td class="num">' + b.vol + '</td><td class="num">' + money(b.loose) + '</td><td class="num">' + money(b.lo) + '</td><td class="num">' + money(b.hi) + '</td><td class="num">' + money(b.sell) + '</td>' + (hasNew ? '<td class="num">' + b.fresh + '</td>' : '') + '</tr>';
  }
  box.innerHTML = html + '</tbody></table></div>';
  $('ebcsv').addEventListener('click', () => {
    const lines = ['period_start,period_end,sales,median_usd,low_usd,high_usd,cheapest_ask_usd' + (hasNew ? ',new_listings' : '')]
      .concat(rows.map(b => [b.d, b.last, b.vol, num(b.loose), num(b.lo), num(b.hi), num(b.sell)].concat(hasNew ? [b.fresh] : []).join(',')));
    downloadText((r[1] + ' ' + String(r[2] || '').replace(/^Pokemon /, '') + ' ebay ' + unit + ' history.csv').replace(/[\\/:*?"<>|]+/g, ' '), lines.join('\n'));
  });
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
  $('gate').innerHTML = '<p class="why">Points: Day, Week or Month sets what one bar is. Bars = raw sales in the period; the paler amber bars (New listings) = the listings that appeared in it, so supply sits next to demand. Price line = median of raw sale totals: over a trailing 7-day window with Day points, over the period\u2019s own sales with Week or Month points (blank under 3 sales). Each sale = a dot per sale (Day points). A period still running, or one the history only partly covers, is drawn faded with a dashed edge. Days split at midnight UTC. History starts the day the collector was switched on and the rollup keeps 120 days; the trend columns fill in at 7 / 30 / 60 days like the PriceCharting tab.</p>';
}

/* ---------------- PriceCharting's own chart (Brett, 2026-10-12: "the exact graph that shows the ungraded price and total
   volume per month on PriceCharting since the card was released") ----------------
   The collector reads the data behind the chart on each card's PriceCharting page (pchist.py) and publishes it in
   200 shards on the live branch (pc/<card id % 200>.bin, the live key): {card id: {m0: first month as months since
   2000-01, p: [cents or null per month], v: [sales per month], t: date read}}. The popup draws the same picture:
   monthly volume bars on the left axis, the ungraded line on the right axis, Zoom 6m / 1y / 5y / All, a hover
   readout per month; under it the month-by-month table with a CSV download, the stats from this site's own daily
   points, and the buy gate. */
const pchCache = new Map();                              // shard -> {b: time bucket, data}
let pcCur = null;                                        // {h, card} while the PriceCharting popup is open
async function loadPcHist(pid, fresh) {
  const shards = (LIVE.data && LIVE.data.pch && LIVE.data.pch.shards) || 200, sh = pid % shards;
  const b = fresh ? Date.now() : Math.floor(Date.now() / 600000);   // the raw CDN holds a file for up to five minutes
  const hit = pchCache.get(sh);
  if (hit && hit.b === b) return hit.data[String(pid)] || null;
  if (!LIVE_URL || !HKEY) return null;
  const res = await fetch(LIVE_URL.replace(/[^/]+$/, 'pc/' + sh + '.bin') + '?t=' + b, {cache: 'no-store'});
  if (res.status === 404) { pchCache.set(sh, {b, data: {}}); return null; }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
  pchCache.set(sh, {b, data});
  return data[String(pid)] || null;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = m => ({y: 2000 + Math.floor(m / 12), m: m % 12});                 // months since 2000-01
const monthShort = m => { const d = monthOf(m); return MONTHS[d.m] + ' ' + d.y; };
const monthLong = m => { const d = monthOf(m); return MONTHS_LONG[d.m] + ' ' + d.y; };
const monthIso = m => { const d = monthOf(m); return d.y + '-' + String(d.m + 1).padStart(2, '0'); };
function pcMode(on) {                                    // the popup's controls: PriceCharting's zoom bar and table, or the eBay chart's bars and table
  ['ebpts', 'ebbar1', 'ebbar2', 'ebtable'].forEach(id => { $(id).style.display = on ? 'none' : ''; });
  $('pczoom').style.display = on ? '' : 'none'; $('pctable').style.display = on ? '' : 'none';
  if (on) $('ebtable').innerHTML = ''; else $('pctable').innerHTML = '';
}
function pcZoom() { try { return localStorage.getItem('pc-zoom') || 'all'; } catch (e) { return 'all'; } }
async function openTrend(i) {
  const r = DATA[i];
  cur = null; pcCur = null;
  pcMode(true);
  $('mtitle').textContent = r[1];
  $('msub').textContent = r[2] + ' · #' + r[3] + (r[4] ? ' · released ' + r[4] : '');
  $('note').textContent = 'Loading PriceCharting\u2019s history\u2026'; $('stats').innerHTML = ''; $('gate').innerHTML = ''; $('pctable').innerHTML = '';
  $('chart').innerHTML = '';
  $('ov').classList.add('open');
  renderGate(r);                                         // the gate needs no history: it shows at once
  const [hist, sh] = await Promise.all([loadPcHist(r[0]).catch(e => ({err: e.message})),
                                        window.loadShard(Math.floor(i / SHARD_SIZE)).catch(() => null)]);
  if ($('mtitle').textContent !== r[1]) return;          // another card was opened meanwhile
  const pch = (LIVE.data && LIVE.data.pch) || null;
  const sofar = pch ? ' (' + fmtInt(pch.n) + ' of ' + fmtInt(pch.total) + ' cards read so far)' : '';
  if (hist && !hist.err && hist.p && hist.p.length) {
    pcCur = {h: hist, card: r};
    drawPcChart(); renderPcTable();
    const si = pch && pch.signin;
    if (!hist.t || Date.now() - Date.parse(hist.t + 'T00:00:00Z') > 86400000 || (si === 'ok' && !hist.s)) pcHistAsk(r[0], i);   // a day old, or read before the sign-in: refresh it now
  } else if (hist && hist.err) {
    $('note').textContent = 'PriceCharting\u2019s history could not be loaded (' + hist.err + ') \u2014 try again in a minute.';
  } else {
    $('note').textContent = 'PriceCharting\u2019s history for this card has not been read yet' + sofar + ' \u2014 asked the collector to read it now; it appears here within a few minutes. Every card\u2019s page is read once (about a day for the whole catalog), then refreshed weekly (cards with eBay activity) or monthly.';
    pcHistAsk(r[0], i);
  }
  const c = sh && sh.c && sh.c[String(r[0])];
  renderStats(c ? c[1] : null);
}
function closeTrend() { $('ov').classList.remove('open'); $('tip').style.display = 'none'; }

function drawPcChart() {
  const svg = $('chart');
  svg.innerHTML = '';
  if (!pcCur) return;
  const h = pcCur.h, zoom = pcZoom();
  document.querySelectorAll('#pczoom .zb').forEach(b => b.classList.toggle('on', b.dataset.z === zoom));
  const all = h.p.map((p, k) => ({m: h.m0 + k, p: p == null ? null : p / 100, v: (h.v && h.v[k]) || 0}));
  const hasVol = all.some(q => q.v > 0);
  const span = {'6': 6, '12': 12, '60': 60}[zoom];
  const pts = span ? all.slice(Math.max(0, all.length - span)) : all;
  const n = pts.length;
  const W = svg.clientWidth || 900, H = 380, L = 56, R = 64, T = 34, B = 42;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const iw = W - L - R, ih = H - T - B;
  const x = k => L + iw * (k + 0.5) / n;
  let pmax = 0, vmax = 0;
  pts.forEach(q => { if (q.p != null) pmax = Math.max(pmax, q.p); vmax = Math.max(vmax, q.v); });
  pmax = pmax > 0 ? pmax * 1.1 : 1; vmax = vmax > 0 ? vmax * 1.25 : 1;
  const yP = v => T + ih - ih * v / pmax, yV = v => T + ih - ih * v / vmax;
  const el = (tag, at, txt) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
  const nice = m => { const raw = m / 4, s = Math.pow(10, Math.floor(Math.log10(raw))); return ([1, 2, 2.5, 5, 10].find(c => c * s >= raw) || 10) * s; };   // about four divisions, as their axes
  const pstep = nice(pmax), vstep = nice(vmax);
  for (let v = 0; v <= pmax; v += pstep) {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: 'currentColor', 'stroke-opacity': .12});
    el('text', {x: W - R + 8, y: yP(v) + 4, 'font-size': 12, fill: 'currentColor', opacity: .75}, '$' + (pstep < 1 ? v.toFixed(2) : v.toLocaleString('en-US')));
  }
  if (hasVol) for (let v = 0; v <= vmax; v += vstep) el('text', {x: L - 8, y: yV(v) + 4, 'font-size': 12, fill: 'currentColor', opacity: .75, 'text-anchor': 'end'}, Math.round(v).toLocaleString('en-US'));
  el('line', {x1: L, x2: W - R, y1: T + ih, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .35});
  const step = n <= 8 ? 1 : n <= 26 ? 3 : n <= 80 ? 6 : 12;   // month labels: every month, quarter, half year or year
  pts.forEach((q, k) => { if (step === 1 || monthOf(q.m).m % step === 0) {
    el('line', {x1: x(k), x2: x(k), y1: T + ih, y2: T + ih + 5, stroke: 'currentColor', 'stroke-opacity': .35});
    el('text', {x: x(k), y: H - 14, 'font-size': 12, fill: 'currentColor', opacity: .8, 'text-anchor': 'middle'}, monthShort(q.m)); } });
  // legend, as on PriceCharting: a blue line for Ungraded, a grey dot for Volume
  el('line', {x1: W - R - 230, x2: W - R - 206, y1: 12, y2: 12, stroke: COLORS.loose, 'stroke-width': 3});
  el('text', {x: W - R - 200, y: 16, 'font-size': 13, fill: 'currentColor'}, 'Ungraded');
  if (hasVol) { el('circle', {cx: W - R - 110, cy: 12, r: 6, fill: COLORS.vol}); el('text', {x: W - R - 98, y: 16, 'font-size': 13, fill: 'currentColor'}, 'Volume'); }
  const bw = Math.max(2, Math.min(26, iw / n * 0.62));
  pts.forEach((q, k) => { if (q.v > 0) el('rect', {x: x(k) - bw / 2, y: yV(q.v), width: bw, height: T + ih - yV(q.v), fill: COLORS.vol, opacity: .55}); });
  // the ungraded line: a smooth curve through the monthly points (Catmull-Rom as cubic Beziers), broken where a month has no price
  const runs = [];
  let run = [];
  pts.forEach((q, k) => { if (q.p == null) { if (run.length) runs.push(run); run = []; } else run.push([x(k), yP(q.p)]); });
  if (run.length) runs.push(run);
  runs.forEach(ps => {
    if (ps.length === 1) { el('circle', {cx: ps[0][0], cy: ps[0][1], r: 3, fill: COLORS.loose}); return; }
    let d = 'M' + ps[0][0] + ' ' + ps[0][1];
    for (let k = 0; k < ps.length - 1; k++) {
      const p0 = ps[Math.max(0, k - 1)], p1 = ps[k], p2 = ps[k + 1], p3 = ps[Math.min(ps.length - 1, k + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ' C' + c1[0].toFixed(1) + ' ' + c1[1].toFixed(1) + ' ' + c2[0].toFixed(1) + ' ' + c2[1].toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    el('path', {d, fill: 'none', stroke: COLORS.loose, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'});
  });
  const cross = el('line', {x1: 0, x2: 0, y1: T, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .45, 'stroke-dasharray': '4 3', visibility: 'hidden'});
  const dot = el('circle', {cx: 0, cy: 0, r: 5, fill: COLORS.loose, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden'});
  const hit = el('rect', {x: L, y: T, width: iw, height: ih, fill: 'transparent'});
  const tip = $('tip');
  const move = ev => {
    const box = svg.getBoundingClientRect();
    const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - box.left;
    const px = cx * W / box.width;
    const k = Math.max(0, Math.min(n - 1, Math.floor((px - L) / iw * n)));
    const q = pts[k];
    cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.setAttribute('visibility', 'visible');
    if (q.p != null) { dot.setAttribute('cx', x(k)); dot.setAttribute('cy', yP(q.p)); dot.setAttribute('visibility', 'visible'); } else dot.setAttribute('visibility', 'hidden');
    tip.innerHTML = '<b>' + monthLong(q.m) + '</b>' + (hasVol ? '<br><span class="sw" style="background:' + COLORS.vol + ';border-radius:50%"></span>Volume: <b>' + q.v.toLocaleString('en-US') + '</b> (total volume)' : '') +
      '<br><span class="sw" style="background:' + COLORS.loose + ';border-radius:50%"></span>Ungraded: <b>' + (q.p == null ? 'no price that month' : fmtMoneyPlain(q.p)) + '</b>';
    const left = x(k) * box.width / W;
    tip.style.display = 'block';
    tip.style.left = (left + 14 + tip.offsetWidth > box.width ? left - tip.offsetWidth - 14 : left + 14) + 'px';
    tip.style.top = Math.max(0, ((ev.touches ? ev.touches[0].clientY : ev.clientY) - box.top - 30)) + 'px';
  };
  hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', ev => { move(ev); ev.preventDefault(); }, {passive: false}); hit.addEventListener('touchstart', move, {passive: true});
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  const first = all[0].m, last = all[all.length - 1].m;
  const si = (LIVE.data && LIVE.data.pch && LIVE.data.pch.signin) || 'none';
  const why = hasVol && h.sv && !h.s ? ' \u00b7 the ungraded price per month; the volume bars are as of ' + h.sv + ', the last page read with the collector\u2019s PriceCharting sign-in (it has lapsed since: replace PC_COOKIE in /etc/pokemon-collector.env and restart the service)'
    : hasVol ? ' \u00b7 the ungraded price and the total sales volume per month, as the chart on their page shows them'
    : si === 'ok' ? ' \u00b7 the ungraded price per month; the volume bars come once this card\u2019s page is read again with the collector\u2019s PriceCharting sign-in (asked for it now)'
    : si === 'expired' ? ' \u00b7 the ungraded price per month; the collector\u2019s PriceCharting sign-in has expired (replace PC_COOKIE in /etc/pokemon-collector.env and restart the service), so the volume bars are missing'
    : ' \u00b7 the ungraded price per month as the chart on their page shows it; PriceCharting shows the volume bars to signed-in subscribers only, and the collector reads the pages without signing in';
  $('note').textContent = 'PriceCharting\u2019s own history: ' + all.length + ' months, ' + monthShort(first) + ' \u2013 ' + monthShort(last) + (h.t ? ' \u00b7 read ' + h.t : '') + why +
    (span && n < all.length ? ' \u00b7 showing the last ' + n + ' months' : '');
}
function renderPcTable() {
  if (!pcCur) return;
  const h = pcCur.h, r = pcCur.card;
  const rows = h.p.map((p, k) => ({m: h.m0 + k, p: p == null ? null : p / 100, v: h.v[k] || 0}));
  const hasVol = rows.some(q => q.v > 0);
  let html = '<div class="pcth"><b>Month by month</b><span class="dim"> \u00b7 PriceCharting\u2019s record, newest first</span><button class="reset" id="pccsv">Download CSV</button></div>';
  html += '<div class="pctbox"><table><thead><tr><th>Month</th><th class="num">Ungraded</th><th class="num">Change</th>' + (hasVol ? '<th class="num">Volume</th>' : '') + '</tr></thead><tbody>';
  for (let k = rows.length - 1; k >= 0; k--) {
    const q = rows[k], prev = k > 0 ? rows[k - 1].p : null;
    const ch = q.p != null && prev != null && prev > 0 ? (q.p - prev) / prev * 100 : null;
    html += '<tr><td>' + monthLong(q.m) + '</td><td class="num">' + (q.p == null ? '<span class="dim">\u2014</span>' : fmtMoneyPlain(q.p)) + '</td><td class="num">' + (ch == null ? '<span class="dim">\u2014</span>' : fmtPct(ch)) + '</td>' + (hasVol ? '<td class="num">' + q.v.toLocaleString('en-US') + '</td>' : '') + '</tr>';
  }
  html += '</tbody></table></div>';
  $('pctable').innerHTML = html;
  $('pccsv').addEventListener('click', () => {
    const lines = ['month,ungraded_usd' + (hasVol ? ',volume' : '')].concat(rows.map(q => monthIso(q.m) + ',' + (q.p == null ? '' : q.p.toFixed(2)) + (hasVol ? ',' + q.v : '')));
    downloadText((r[1] + ' ' + String(r[2] || '').replace(/^Pokemon /, '') + ' pricecharting history.csv').replace(/[\\/:*?"<>|]+/g, ' '), lines.join('\n'));
  });
}
/* ---- Download history CSV (Brett, 2026-10-13: "a csv that combines all of the csvs from the pricechart trend chart ...
   every card, the year the card was released, the pricechart volume per month ... the ungraded price per month ...
   a small download button" on the PriceCharting tab). The page reads all the history shards (pc/<shard>.bin, the
   files the Trend popup fetches one at a time), decrypts them here and writes one row per catalog card, months as
   columns: the card, its release date and year, the first month on PriceCharting's record, how many months are on
   file and when the page was read, then volume <month> for every month from the earliest month any card has to the
   newest, then ungraded <month> for the same months. A card not read yet is a row with 0 months and blank cells;
   volume cells stay blank unless the record was read signed in (s or sv), as the chart draws them. */
async function downloadPcHistory(btn) {
  if (btn.disabled) return;
  const shards = (LIVE.data && LIVE.data.pch && LIVE.data.pch.shards) || 200, label = btn.textContent;
  btn.disabled = true;
  try {
    const recs = new Map(), b = Math.floor(Date.now() / 600000);
    const one = async sh => {
      const res = await fetch(LIVE_URL.replace(/[^/]+$/, 'pc/' + sh + '.bin') + '?t=' + b, {cache: 'no-store'});
      if (res.status === 404) return;
      if (!res.ok) throw new Error('HTTP ' + res.status + ' on shard ' + sh);
      const data = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
      for (const k in data) recs.set(+k, data[k]);
    };
    for (let sh = 0; sh < shards; sh += 10) {                       // ten shards at a time
      btn.textContent = 'Reading ' + Math.min(sh + 10, shards) + ' of ' + shards + '…';
      await Promise.all(Array.from({length: Math.min(10, shards - sh)}, (_, i) => one(sh + i)));
    }
    btn.textContent = 'Writing…';
    let m0 = Infinity, m1 = -Infinity;
    recs.forEach(h => { if (h.p && h.p.length) { m0 = Math.min(m0, h.m0); m1 = Math.max(m1, h.m0 + h.p.length - 1); } });
    if (!(m0 <= m1)) throw new Error('no history on file yet');
    const months = []; for (let m = m0; m <= m1; m++) months.push(monthIso(m));
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['card_id', 'card', 'set', 'number', 'released', 'release_year', 'first_month_on_record', 'months_on_file', 'read'].concat(months.map(m => 'volume ' + m), months.map(m => 'ungraded ' + m));
    const parts = [head.join(',') + '\n'];
    let buf = [], onFile = 0;
    DATA.forEach(r => {                                               // the catalog's order: set release date, then card number
      const h = recs.get(r[0]), n = h && h.p ? h.p.length : 0, hasVol = !!(h && h.v && (h.s || h.sv));
      const vol = new Array(months.length).fill(''), price = new Array(months.length).fill('');
      if (n) { onFile++; for (let k = 0; k < n; k++) { const i = h.m0 + k - m0; if (i < 0 || i >= months.length) continue; if (hasVol && h.v[k] != null) vol[i] = h.v[k]; if (h.p[k] != null) price[i] = (h.p[k] / 100).toFixed(2); } }
      buf.push([r[0], q(r[1]), q(r[2]), q(r[3]), r[4] || '', r[4] ? String(r[4]).slice(0, 4) : '', n ? monthIso(h.m0) : '', n, (h && h.t) || ''].concat(vol, price).join(',') + '\n');
      if (buf.length >= 2000) { parts.push(buf.join('')); buf = []; }
    });
    if (buf.length) parts.push(buf.join(''));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(parts, {type: 'text/csv'})); a.download = 'pricecharting history ' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    btn.textContent = 'Downloaded ✓ ' + onFile.toLocaleString('en-US') + ' of ' + DATA.length.toLocaleString('en-US') + ' cards on file';
  } catch (e) { btn.textContent = 'Could not build it: ' + e.message; }
  setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 8000);
}
(() => {
  const fb = [...$('ranges-pc').querySelectorAll('button.reset')].find(x => x.textContent === 'Filters…') || $('reset-pc');
  const db = document.createElement('button'); db.className = 'reset'; db.type = 'button'; db.id = 'pchist-btn'; db.textContent = 'Download history CSV';
  db.title = 'Every card’s PriceCharting chart as one CSV: a row per card, the volume and the ungraded price for every month on file (reads the history files, a few seconds)';
  db.addEventListener('click', () => downloadPcHistory(db));
  fb.insertAdjacentElement('afterend', db);
})();
function downloadText(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type: 'text/csv'})); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function rangePoints(all) {                              // Show: all periods, or the last N days / weeks / months of them
  if (document.querySelector('input[name=rng]:checked').value === 'all') return all;
  const n = Math.max(1, +$('rn').value || 1), unit = +$('ru').value;
  const cutoff = Date.parse(all[all.length - 1].last + 'T00:00:00Z') - (n * unit - 1) * DAY_MS;   // "last 30 days" = 30 days back from the newest point
  return all.filter(b => Date.parse(b.last + 'T00:00:00Z') >= cutoff);
}

function drawChart() {
  const svg = $('chart');
  svg.innerHTML = '';
  if (!cur) return;
  const mode = ebPts(), unit = EB_UNIT[mode];
  document.querySelectorAll('#ebpts .zb').forEach(b => b.classList.toggle('on', b.dataset.p === mode));
  $('l-loose').textContent = (mode === 'd' ? 'Sold median (7d)' : 'Sold median (' + unit + ')') + ' $';
  $('l-vol').textContent = 'Sales/' + unit + ' (left axis)';
  $('c-dots').disabled = mode !== 'd'; $('l-dots').parentElement.style.opacity = mode === 'd' ? '' : '.45';
  const all = ebBuckets(mode);
  pts = rangePoints(all);
  const on = {loose: $('c-loose').checked, sell: $('c-sell').checked, vol: $('c-vol').checked, ref: $('c-ref').checked, fresh: $('c-new').checked, dots: mode === 'd' && $('c-dots').checked};
  const W = svg.clientWidth || 900, H = 380, L = 56, R = 64, T = 18, B = 42;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const iw = W - L - R, ih = H - T - B, n = pts.length;
  const x = k => L + iw * (k + 0.5) / n;                 // one slot per period, as PriceCharting's chart
  const money = ['loose', 'sell'].filter(s => on[s]);
  const refs = on.ref ? (cur.refs || []).filter(([, v]) => v != null) : [];
  const bars = on.vol || on.fresh;
  let pmax = 0, vmax = 0;
  pts.forEach(p => {
    money.forEach(s => { if (p[s] != null) pmax = Math.max(pmax, p[s]); });
    if (on.dots) p.sold.forEach(v => { pmax = Math.max(pmax, v); });
    if (on.vol) vmax = Math.max(vmax, p.vol);
    if (on.fresh) vmax = Math.max(vmax, p.fresh);
  });
  refs.forEach(([, v]) => pmax = Math.max(pmax, v));
  pmax = pmax > 0 ? pmax * 1.08 : 1; vmax = vmax > 0 ? vmax * 1.15 : 1;
  const yP = v => T + ih - ih * v / pmax, yV = v => T + ih - ih * v / vmax;
  const el = (tag, at, txt) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
  const nice = m => { const s = Math.pow(10, Math.floor(Math.log10(m / 4))); const c = [1, 2, 2.5, 5, 10].find(c => c * s * 4 >= m); return c * s; };
  const mstep = nice(pmax), vstep = nice(vmax);
  for (let v = 0; v <= pmax; v += mstep) {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: 'currentColor', 'stroke-opacity': .12});
    if (money.length || refs.length || on.dots) el('text', {x: W - R + 6, y: yP(v) + 4, 'font-size': 11, fill: 'currentColor', opacity: .7}, '$' + (mstep < 1 ? v.toFixed(2) : v.toLocaleString('en-US')));
  }
  if (bars) for (let v = 0; v <= vmax; v += vstep) el('text', {x: L - 6, y: yV(v) + 4, 'font-size': 11, fill: 'currentColor', opacity: .7, 'text-anchor': 'end'}, Math.round(v).toLocaleString('en-US'));
  el('line', {x1: L, x2: W - R, y1: T + ih, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .35});
  const ticks = n <= Math.floor(iw / 64) ? n : Math.min(n, Math.max(2, Math.floor(iw / 110)));   // every period while they fit, else a spread
  for (let k = 0; k < ticks; k++) {
    const i = Math.round(k * (n - 1) / Math.max(1, ticks - 1));
    el('text', {x: x(i), y: H - 14, 'font-size': 11, fill: 'currentColor', opacity: .75, 'text-anchor': 'middle'}, ebLabel(pts[i], mode, false));
  }
  el('text', {x: 2, y: 12, 'font-size': 10, fill: 'currentColor', opacity: .6}, bars ? (on.vol && on.fresh ? 'sales · listed' : on.vol ? 'sales/' + unit : 'listed/' + unit) : '');
  el('text', {x: W - R + 6, y: 12, 'font-size': 10, fill: 'currentColor', opacity: .6}, (money.length || refs.length || on.dots) ? 'USD' : '');
  // the bars: sales, and beside them the listings that appeared; a period still running or only partly covered is faded with a dashed edge
  const bw = Math.max(2, Math.min(26, iw / n * 0.62));
  const bar = (p, k, v, cls, color, dx, w) => {
    if (!(v > 0)) return;
    const at = {class: cls, x: (x(k) + dx).toFixed(1), y: yV(v), width: w.toFixed(1), height: T + ih - yV(v), fill: color, opacity: .55};
    if (p.open || p.from) Object.assign(at, {opacity: .25, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '3 2', 'data-part': p.open ? 'open' : 'from'});
    el('rect', at);
  };
  pts.forEach((p, k) => {
    if (on.vol && on.fresh) { bar(p, k, p.vol, 'bar-s', COLORS.vol, -bw / 2, bw / 2); bar(p, k, p.fresh, 'bar-n', COLORS.fresh, 0, bw / 2); }
    else if (on.vol) bar(p, k, p.vol, 'bar-s', COLORS.vol, -bw / 2, bw);
    else if (on.fresh) bar(p, k, p.fresh, 'bar-n', COLORS.fresh, -bw / 2, bw);
  });
  refs.forEach(([name, v]) => {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: COLORS.ref, 'stroke-width': 1.3, 'stroke-dasharray': '6 4', opacity: .9});
    el('text', {x: L + 4, y: yP(v) - 3, 'font-size': 10, fill: COLORS.ref}, name + ' ' + fmtMoneyPlain(v));
  });
  if (on.dots) pts.forEach((p, k) => {                   // a dot per sale, spread a little inside the slot so same-day sales stay visible
    const m = p.sold.length, step = Math.min(4, bw / Math.max(1, m));
    p.sold.forEach((v, j) => el('circle', {class: 'dot-s', cx: (x(k) + (j - (m - 1) / 2) * step).toFixed(1), cy: yP(v).toFixed(1), r: 2.6, fill: COLORS.loose, opacity: .4}));
  });
  money.forEach(s => {
    let d = '', pen = false;
    pts.forEach((p, k) => { if (p[s] == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(k).toFixed(1) + ' ' + yP(p[s]).toFixed(1) + ' '; pen = true; });
    el('path', {class: 'line-' + s, d, fill: 'none', stroke: COLORS[s], 'stroke-width': 2.2, 'stroke-linejoin': 'round'});
    if (n <= 60) pts.forEach((p, k) => { if (p[s] != null) el('circle', {cx: x(k), cy: yP(p[s]), r: 3, fill: COLORS[s]}); });
  });
  const cross = el('line', {x1: 0, x2: 0, y1: T, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .5, 'stroke-dasharray': '4 3', visibility: 'hidden'});
  const hit = el('rect', {x: L, y: T, width: iw, height: ih, fill: 'transparent'});
  const tip = $('tip');
  const move = ev => {
    const box = svg.getBoundingClientRect();
    const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - box.left;
    const px = cx * W / box.width;
    const k = Math.max(0, Math.min(n - 1, Math.floor((px - L) / iw * n)));
    const p = pts[k];
    cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.setAttribute('visibility', 'visible');
    let h = '<b>' + ebLabel(p, mode, true) + (p.open ? ' · to date' : '') + (p.from ? ' · from ' + p.first : '') + '</b>';
    if (on.vol) h += '<br><span class="sw" style="background:' + COLORS.vol + '"></span>Sales: <b>' + p.vol + '</b>';
    if (on.fresh) h += '<br><span class="sw" style="background:' + COLORS.fresh + '"></span>New listings: <b>' + p.fresh + '</b>';
    if (on.loose) h += '<br><span class="sw" style="background:' + COLORS.loose + '"></span>' + (mode === 'd' ? 'Sold median (7d)' : 'Sold median') + ': ' + fmtMoney(p.loose);
    if (p.sold.length) h += '<br>' + (p.sold.length === 1 ? 'The one sale: ' + fmtMoneyPlain(p.lo) : 'Low – high: ' + fmtMoneyPlain(p.lo) + ' – ' + fmtMoneyPlain(p.hi));
    if (on.sell) h += '<br><span class="sw" style="background:' + COLORS.sell + '"></span>Cheapest ask: ' + fmtMoney(p.sell);
    tip.innerHTML = h;
    const left = x(k) * box.width / W;
    tip.style.display = 'block';
    tip.style.left = (left + 12 + tip.offsetWidth > box.width ? left - tip.offsetWidth - 12 : left + 12) + 'px';
    tip.style.top = Math.max(0, ((ev.touches ? ev.touches[0].clientY : ev.clientY) - box.top - 28)) + 'px';
  };
  hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', ev => { move(ev); ev.preventDefault(); }, {passive: false}); hit.addEventListener('touchstart', move, {passive: true});
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  const last = pts[n - 1];
  $('note').textContent = n + ' ' + unit + (n === 1 ? '' : 's') + (n < all.length ? ' of ' + all.length : '') + ' shown · eBay raw sales the collector saw, one point per day from ' + cur.dates[0] +
    (last.open ? ' · the last ' + unit + ' is still running' : '') + (cur.full ? '' : ' · the per-sale prices and new listings arrive with the collector’s next publish');
}
const fmtMoneyPlain = v => v == null ? '—' : '$' + v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pctPlain = (v, nd = 1, signed = true) => v == null ? '—' : (signed && v > 0 ? '+' : '') + v.toFixed(nd) + '%';

function renderStats(s) {                               // this site's own daily points (one per morning): the short-range stats
  if (!s) { $('stats').innerHTML = ''; return; }
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
}
/* The buy gate (2026-10-12, Brett: the old one was the Actions-era rule - 15% margin, 6.25% tax, hold x drift x cushion):
   the same arithmetic the collector applies to a listing today (ebay_sweep.gate / sell_price, mirrored in decide()),
   with the margin, the buy tax and the seller's shipping as inputs Brett can click and change. The margin and tax
   are the Raw Data tab's own boxes (one set of numbers for every tab); the shipping assumption is remembered here. */
function pcShipIn() { try { const v = parseFloat(localStorage.getItem('pc-shipin')); return isNaN(v) ? GATE.shipIn : v; } catch (e) { return GATE.shipIn; } }
let pcGateCard = null;
function renderGate(r) {
  pcGateCard = r;
  const S = settings(), G = GATE_LIVE(), cid = r[0], pc = r[6];
  const c = LIVE.dec && LIVE.dec[String(cid)];
  const shipIn = pcShipIn();
  const live = LIVE.data && LIVE.data.gate;
  const row = (label, val, why, big) => '<tr' + (big ? ' class="big"' : '') + '><td>' + label + '</td><td class="n">' + val + '</td><td class="why">' + (why || '') + '</td></tr>';
  if (!$('g-margin')) {                                  // the inputs are built once and keep the focus while Brett types; the table below re-renders
    $('gate').innerHTML = '<h3>Buy gate for this card</h3>' +
      '<div class="bar gin"><label>Margin <input type="number" id="g-margin" min="0" max="50" step="1" value="' + (S.margin * 100).toFixed(0) + '">%</label>' +
      '<label>Buy tax <input type="number" id="g-tax" min="0" max="15" step="0.25" value="' + (S.tax * 100).toFixed(2).replace(/\.?0+$/, '') + '">%</label>' +
      '<label>Seller shipping $<input type="number" id="g-ship" min="0" max="50" step="0.25" value="' + shipIn.toFixed(2) + '"></label>' +
      '<span class="dim" id="g-live"></span></div><div id="g-body"></div>';
    wireGate();
  }
  $('g-live').textContent = live ? 'the collector is set to ' + (live.margin * 100).toFixed(0) + '% margin and ' + (live.tax * 100).toFixed(2).replace(/\.?0+$/, '') + '% buy tax' : '';
  let g = '';
  let sell = null, how = '', anchorRow = '';
  if (c && c.A != null) {
    const d = decide(c, S);
    sell = d.sell;
    anchorRow = row('Anchor', fmtMoneyPlain(c.A), 'eBay sold median' + (c.k != null ? ' from ' + c.k + ' sales in ' + c.D + ' days' : '') + ' \u00b7 PriceCharting ungraded ' + fmtMoneyPlain(pc));
    how = d.L != null ? '$' + S.undercut.toFixed(2) + ' under the cheapest believable eBay copy (' + fmtMoneyPlain(d.L) + '), never above ' + Math.round(S.sellUnderA * 100) + '% of the anchor' : Math.round(S.sellNoFloor * 100) + '% of the anchor \u2014 no other believable copy is listed';
    if (c.A_fast != null && sell <= c.A_fast + 0.011 && sell >= c.A_fast - 1) how += ' \u00b7 capped by the fast-sale median ' + fmtMoneyPlain(c.A_fast);
  } else if (pc) {
    const f = (c && c.cred || [])[0];
    sell = round99(f ? Math.min(f[1] - S.undercut, (G.leadSellPc || 0.95) * pc) : (G.leadSellNoFloor || 0.93) * pc);
    anchorRow = row('Anchor', fmtMoneyPlain(pc), 'PriceCharting ungraded price today \u00b7 eBay has no sales record for this card yet');
    how = f ? '$' + S.undercut.toFixed(2) + ' under the cheapest believable eBay copy (' + fmtMoneyPlain(f[1]) + '), never above ' + Math.round((G.leadSellPc || 0.95) * 100) + '% of PriceCharting' : Math.round((G.leadSellNoFloor || 0.93) * 100) + '% of the PriceCharting price (the lead rule: no eBay copy to go under)';
  }
  if (sell == null) {
    $('g-body').innerHTML = '<p class="why">No price to anchor to: PriceCharting has no ungraded price for this card and eBay has no sales record.</p>';
    return;
  }
  const fee = sell * S.fee + S.fixed, net = sell * (1 - S.fee) - S.fixed - S.shipOut - S.supplies;
  const maxbuy = net / (1 + S.margin), maxitem = (maxbuy - shipIn) / (1 + S.tax);
  g += '<table>' + anchorRow +
    row('Sell price', fmtMoneyPlain(sell), how, true) +
    row('eBay fee', '\u2212 ' + fmtMoneyPlain(fee), (S.fee * 100).toFixed(2) + '% of the sale (' + (G.fee ? (G.fee * 100).toFixed(2) : '13.25') + '% on the buyer\u2019s total incl. their ' + (G.buyerTax ? (G.buyerTax * 100).toFixed(1) : '6.5') + '% sales tax) + $' + S.fixed.toFixed(2)) +
    row('Shipping out', '\u2212 ' + fmtMoneyPlain(S.shipOut), 'tracked label') +
    row('Supplies', '\u2212 ' + fmtMoneyPlain(S.supplies), 'sleeve, top loader, mailer') +
    row('Net proceeds', fmtMoneyPlain(net), '', true) +
    row('Max buy, all-in', fmtMoneyPlain(maxbuy), 'net \u00f7 (1 + ' + (S.margin * 100).toFixed(0) + '% margin) \u2014 item + shipping + tax must be at or below this', true) +
    row('\u2248 max item price', maxitem > 0 ? fmtMoneyPlain(maxitem) : '\u2014', 'if the seller charges $' + shipIn.toFixed(2) + ' shipping and your buy tax is ' + (S.tax * 100).toFixed(2).replace(/\.?0+$/, '') + '%') + '</table>';
  if (maxitem <= 0) g += '<p class="why">Fees, shipping and tax eat everything this card can net at your margin \u2014 there is no listing price that makes it a trade. This is why cheap cards rarely pass.</p>';
  if (c && c.lam != null) {
    const probT = (1 - Math.exp(-c.lam * S.window / 24)) * 100;
    g += '<p class="why">eBay: ' + c.lam.toFixed(2) + ' raw sales a day on average \u2014 a buyer inside your ' + S.window + ' h window with ' + probT.toFixed(0) + '% probability, ' + (isLiquid(c.lam, c.st, S) ? 'liquid' : 'not liquid') + ' at your ' + Math.round(S.conf * 100) + '% confidence. The eBay Catalog row has the full decision.</p>';
  } else g += '<p class="why">The collector has no eBay sales record for this card yet, so liquidity is unknown: on the eBay Catalog this card can only be a lead.</p>';
  $('g-body').innerHTML = g;
}
function wireGate() {                                    // the popup's margin and tax ARE the Raw Data tab's boxes; the shipping is remembered here
  const sync = (id, target) => $(id).addEventListener('input', () => { if ($(id).value === '') return; $(target).value = $(id).value; $(target).dispatchEvent(new Event('input', {bubbles: true})); if (pcGateCard) renderGate(pcGateCard); });
  sync('g-margin', 'margin'); sync('g-tax', 'buytax');
  $('g-ship').addEventListener('input', () => { const v = parseFloat($('g-ship').value); if (isNaN(v)) return; try { localStorage.setItem('pc-shipin', String(v)); } catch (e) {} if (pcGateCard) renderGate(pcGateCard); });
}
$('rows-pc').addEventListener('click', e => { const b = e.target.closest('.tbtn'); if (b) openTrend(+b.dataset.i); });
$('close').addEventListener('click', closeTrend);
$('ov').addEventListener('click', e => { if (e.target === $('ov')) closeTrend(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeTrend(); $('hov').classList.remove('open'); $('bov').classList.remove('open'); $('rov').classList.remove('open'); } });
['c-loose', 'c-sell', 'c-buy', 'c-vol', 'c-ref', 'c-new', 'c-dots', 'rn', 'ru'].forEach(id => $(id).addEventListener('input', drawChart));
document.querySelectorAll('input[name=rng]').forEach(r => r.addEventListener('change', drawChart));
window.addEventListener('resize', () => { if ($('ov').classList.contains('open')) { if (pcCur) drawPcChart(); else drawChart(); } });
document.querySelectorAll('#pczoom .zb').forEach(b => b.addEventListener('click', () => { try { localStorage.setItem('pc-zoom', b.dataset.z); } catch (e) {} if (pcCur) drawPcChart(); }));
document.querySelectorAll('#ebpts .zb').forEach(b => b.addEventListener('click', () => { try { localStorage.setItem('eb-pts', b.dataset.p); } catch (e) {} if (cur) { drawChart(); renderEbTable(); } }));
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
          key: await crypto.subtle.importKey('raw', enc.encode(await hex(HKEY + ':alerts-key')), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify'])};
}
async function alSend(msg, suffix) {                // suffix: a side topic of the same channel ('-pc' = picture requests)
  const ch = await alChannel(), body = JSON.stringify(msg);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', ch.key, new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const r = await fetch('https://ntfy.sh/' + ch.topic + (suffix || ''), {method: 'POST', body: JSON.stringify({m: body, s: sig})});
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
$('mm-btn').addEventListener('click', openMismatches);
$('use-al').addEventListener('click', () => {
  const c = Object.assign({}, AL_DEFAULT, (LIVE.data && LIVE.data.alert && LIVE.data.alert.cfg) || {});
  $('conf').value = c.conf; $('win').value = c.window; $('margin').value = c.margin; $('buytax').value = c.tax;
  $('margin').dispatchEvent(new Event('input'));
});
