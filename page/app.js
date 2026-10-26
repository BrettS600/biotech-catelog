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
// the Trends band's blanks say what they wait for (2026-10-23, Brett: "the volume drift, 30%, and slope 30% column should
// show data because we have been collecting data for at least a month" - it was 26 days): each column has a minimum of
// daily history, counted from the card's first day in the collector's rollup, and the cell says so with the card's count
const trDays = cid => { const c = LIVE.dec && LIVE.dec[cid]; return c && c.tr && c.tr.days != null ? c.tr.days : null; };
const trendDash = (days, need, why) => '<span class="dim" title="' + esc(days != null && days < need ? 'needs ' + need + ' days of eBay history; this card has ' + days + ' (the collector has recorded since ' + ((LIVE.data && LIVE.data.since) || 'late September') + ')' : why) + '">\u2014</span>';
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

/* ---------------- Favorites (Brett, 2026-10-23: "each tab to have an additional column called favorites ... clicking
   the star turns it yellow ... I want the entire row to go to a tab called Favorites") ----------------
   A favorite is a pointer, not a copy: {s: where it was starred - pc / ec / er (any listing-shaped row: Raw Data, the
   auction view, a hit, the Scam screen, Mismatches, a phone alert, the Review screen) / fc / um (an unmatched title),
   k: the row's key - the card id on the catalog tabs and the Forecast, the item id for a listing, c: the card id, t:
   when, m: a few words kept for rows that may leave the data (title, link, price; the Forecast's horizon and numbers)}.
   It goes to the collector over the signed channel like a Mismatch mark, shows at once from FAVS, and is confirmed by
   live.favs (list + t) - so the same stars show on every device. The Favorites tab re-renders the pointed-at rows from
   the live data through the source tab's own columns (fvBuild, below TABLES). The collector keeps a starred listing's
   record and photos past the usual prune and follows it to its outcome. */
const FAV_MAX = 400, FAV_SRC_NAME = {pc: 'PriceCharting', ec: 'eBay Catalog', er: 'eBay Raw Data', fc: 'Forecast', fl: 'Forecast', um: 'Unmatched titles'};   // fl: a listing starred on the Forecast tab (a card's popup, the plan) - kept in the Forecast view, not in Raw Data (2026-10-25)
const FAVS = {};                                   // 's:k' -> {v: 1 | 0, t, f} until the collector confirms (live.favs.t >= t)
const FAV_META = new Map();                        // 's:k' -> {c, m} of every star drawn on the page: what a click sends
let FAV_MAP = new Map(), FAV_LAST_T = 0;           // 's:k' -> {s, k, c, t, m}: the favorites as the page knows them now
const favKey = (s, k) => s + ':' + k;
function favIndex() {                              // the collector's list, with the clicks it has not confirmed yet on top
  const out = new Map();
  (((LIVE.data || {}).favs || {}).list || []).forEach(a => out.set(favKey(a[0], a[1]), {s: a[0], k: String(a[1]), c: a[2] == null ? null : a[2], t: a[3], m: a[4] || null}));
  for (const key in FAVS) { if (FAVS[key].v) out.set(key, FAVS[key].f); else out.delete(key); }
  FAV_MAP = out;
  return out;
}
const favCard = f => f.c != null ? +f.c : f.s !== 'er' && f.s !== 'um' && f.s !== 'fl' ? +f.k : null;   // the card a favorite points at, if any
const isFav = (s, k) => FAV_MAP.has(favKey(s, k));
const favOn = key => key.slice(0, 4) === 'all:' ? FV_FROM.has(+key.slice(4)) : FAV_MAP.has(key);   // the All view's star stands for every star on the card
const favTitle = on => on ? 'In your Favorites — click to remove' : 'Add to Favorites';
// the star itself (yellow when on); cls 'sm' = the smaller one used in lists and popups
function favBtn(s, k, c, m, cls) {
  if (k == null || k === '') return '';
  const key = favKey(s, k), on = favOn(key);
  FAV_META.set(key, {c: c == null ? null : c, m: m || null});
  return '<button type="button" class="favb' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '" data-f="' + esc(key) + '" title="' + favTitle(on) + '" aria-pressed="' + on + '">★</button>';
}
// the star cell of a table row: f = the table's fav config {s (a tab, or a function of the row), k, c, m}
const favCell = (f, r) => { const s = typeof f.s === 'function' ? f.s(r) : f.s, k = f.k(r); return '<td class="favc">' + (k == null || k === '' ? '' : favBtn(s, k, f.c ? f.c(r) : null, f.m ? f.m(r) : null)) + '</td>'; };
const favMetaEr = r => ({ti: String(r[6] || '').slice(0, 90), u: r[20] || null, p: r[9] == null ? null : r[9]});   // what a listing's star keeps
function favMetaFl(r) {                            // a listing starred on the Forecast tab: the words, plus the model's figures for it at that moment (the hold, the chance, the net per copy, the sell level)
  const m = favMetaEr(r); m.h = (FC.inputs || {}).h || (+$('fc-h').value || 3); m.c = r[56] == null ? null : r[56];
  try {
    const doc = FC.doc, a = doc && FC.ix && r[0] != null ? doc.cards[String(r[0])] : null, pct = a ? a[FC.ix['pct' + m.h]] : null, tab = pct == null ? null : fcTable(m.h, fcBucket(pct));
    if (tab && r[9] != null && r[9] > 0) { const lv = fcLevels(LIVE.dec && LIVE.dec[String(r[0])], a[FC.ix.buy], r[22]), d = fcDist(r[9], tab, settings(), 0, lv.sell); m.lo = r2(d.lo); m.med = r2(d.med); m.hi = r2(d.hi); m.sell = r2(lv.sell); }
  } catch (e) { /* the words alone, then */ }
  return m;
}
function favSend(s, k, c, m, on) {                 // show it now, tell the collector, take it back if the channel fails
  const key = favKey(s, k), t = FAV_LAST_T = Math.max(Date.now(), FAV_LAST_T + 1);   // strictly increasing: the collector drops a message older than its last
  FAVS[key] = {v: on ? 1 : 0, t, f: {s, k: String(k), c: c == null ? null : c, t, m: m || null}};
  favIndex(); favPaint();
  alSend({type: 'fav', t, s, k: String(k), c: c == null ? null : c, v: on ? 1 : 0, m: m || null})
    .catch(e => { delete FAVS[key]; favIndex(); favPaint(); favSay('The star could not be sent to the collector (' + e.message + '), so it is not saved.'); });
}
function favToggle(key) {
  const i = key.indexOf(':'), s = key.slice(0, i), k = key.slice(i + 1), meta = FAV_META.get(key) || {};
  if (s === 'all') {                               // the All view: take every star off this card
    const cid = +k;
    for (const f of [...FAV_MAP.values()]) if (favCard(f) === cid) favSend(f.s, f.k, f.c, f.m, false);
    return;
  }
  const on = !FAV_MAP.has(key);
  if (on && FAV_MAP.size >= FAV_MAX) { favSay('You have ' + FAV_MAX + ' favorites, the most the collector keeps: take a star off something first.'); return; }
  favSend(s, k, meta.c, meta.m, on);
}
function favSay(msg) {                             // a quiet line at the bottom of the window, gone after a few seconds
  let el = $('fvtoast'); if (!el) { el = document.createElement('div'); el.id = 'fvtoast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('open'); clearTimeout(favSay.timer); favSay.timer = setTimeout(() => el.classList.remove('open'), 6000);
}
function favPaint() {                              // every star on the page follows the map; then the counts and, if it is showing, the Favorites tab
  document.querySelectorAll('button.favb').forEach(b => { const on = favOn(b.dataset.f); b.classList.toggle('on', on); b.title = favTitle(on); b.setAttribute('aria-pressed', on); });
  fvCounts();
  if ($('p-fv') && !$('p-fv').hidden) fvRender();
}
document.addEventListener('click', e => { const b = e.target && e.target.closest ? e.target.closest('button.favb') : null; if (b && b.dataset.f) favToggle(b.dataset.f); });
/* ---------------- Planning (2026-10-24, Brett: "a column with a plus sign button, when i click the plus sign, it goes to the
   planning button ... i want the collector so it follows from laptop to phone") ----------------
   The plan is a list of LISTINGS (item ids), kept on the collector like the favorites: a + on a listing row (the Raw Data
   tab, the Forecast tab's card popup, the Favorites view) sends {type: 'plan', t, i, c, v, m} over the signed channel,
   shows at once from PLANS, and is confirmed by live.plan (list + t). The Forecast tab's Planning view prices every
   planned listing at its own price with the model (plRows) and gives the basket the same summary as the forecast. */
const PLAN_MAX = 200;
const PLANS = {};                                  // iid -> {v: 1 | 0, t, f} until the collector confirms (live.plan.t >= t)
const PLAN_META = new Map();                       // iid -> {c, m} of every + drawn on the page: what a click sends
let PLAN_MAP = new Map(), PLAN_LAST_T = 0;         // iid -> {i, c, t, m}: the plan as the page knows it now
function planIndex() {
  const out = new Map();
  (((LIVE.data || {}).plan || {}).list || []).forEach(a => out.set(String(a[0]), {i: String(a[0]), c: a[1] == null ? null : a[1], t: a[2], m: a[3] || null}));
  for (const k in PLANS) { if (PLANS[k].v) out.set(k, PLANS[k].f); else out.delete(k); }
  PLAN_MAP = out;
  return out;
}
const isPlanned = iid => PLAN_MAP.has(String(iid));
const planTitle = on => on ? 'On your plan — click to take it off' : 'Add this listing to your plan (the Forecast tab’s Planning view)';
function planBtn(iid, cid, m, cls) {               // the + itself (a − when the listing is on the plan)
  if (iid == null || iid === '') return '';
  const on = isPlanned(iid);
  PLAN_META.set(String(iid), {c: cid == null ? null : cid, m: m || null});
  return '<button type="button" class="plb' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '" data-i="' + esc(String(iid)) + '" title="' + planTitle(on) + '" aria-pressed="' + on + '">' + (on ? '\u2212' : '+') + '</button>';
}
const planCell = (p, r) => { const k = p.k(r); return '<td class="plc">' + (k == null || k === '' ? '' : planBtn(k, p.c ? p.c(r) : null, p.m ? p.m(r) : null)) + '</td>'; };
function planSend(iid, cid, m, on) {
  const key = String(iid), t = PLAN_LAST_T = Math.max(Date.now(), PLAN_LAST_T + 1);
  PLANS[key] = {v: on ? 1 : 0, t, f: {i: key, c: cid == null ? null : cid, t, m: m || null}};
  planIndex(); planPaint();
  alSend({type: 'plan', t, i: key, c: cid == null ? null : cid, v: on ? 1 : 0, m: m || null})
    .catch(e => { delete PLANS[key]; planIndex(); planPaint(); favSay('The plan could not be sent to the collector (' + e.message + '), so it is not saved.'); });
}
function planToggle(iid) {
  const meta = PLAN_META.get(String(iid)) || {}, on = !isPlanned(iid);
  if (on && PLAN_MAP.size >= PLAN_MAX) { favSay('Your plan holds ' + PLAN_MAX + ' listings, the most the collector keeps: take one off first.'); return; }
  planSend(iid, meta.c, meta.m, on);
}
function planPaint() {                             // every + on the page follows the map; the count on the Planning button; the view, if it is showing
  document.querySelectorAll('button.plb').forEach(b => { const on = isPlanned(b.dataset.i); b.classList.toggle('on', on); b.textContent = on ? '\u2212' : '+'; b.title = planTitle(on); b.setAttribute('aria-pressed', on); });
  const n = $('npl'); if (n) n.textContent = String(PLAN_MAP.size);
  if (typeof FC !== 'undefined' && FC.mode === 'pl' && $('p-fc') && !$('p-fc').hidden) plRender();
}
document.addEventListener('click', e => { const b = e.target && e.target.closest ? e.target.closest('button.plb') : null; if (b && b.dataset.i != null) planToggle(b.dataset.i); });
/* Sticky row highlight (2026-10-23, Brett: "when I click on a row, I want that row to stay highlighted until I click on a
   different row"). Every table with a data-sel name remembers the key of the row clicked last (data-key on the row: a
   card id, an item id, a record's time); a repaint, a sort or a live refresh paints it again (selApply, and makeTable's
   renderMore). One row per table; clicking the same row again leaves it on. */
const SEL = new Map();
document.addEventListener('click', e => {
  const tr = e.target && e.target.closest ? e.target.closest('tbody > tr') : null; if (!tr) return;
  const table = tr.closest('table'), name = table && table.dataset.sel; if (!name) return;
  for (const x of tr.parentElement.querySelectorAll('tr.sel')) if (x !== tr) x.classList.remove('sel');
  tr.classList.add('sel');
  SEL.set(name, tr.dataset.key != null ? tr.dataset.key : String([...tr.parentElement.children].indexOf(tr)));
});
function selApply(table) {                         // after a table is rebuilt: the remembered row gets its tint back
  if (!table || !table.dataset.sel) return;
  const key = SEL.get(table.dataset.sel); if (key == null) return;
  for (const tb of table.tBodies) [...tb.rows].forEach((tr, i) => tr.classList.toggle('sel', (tr.dataset.key != null ? tr.dataset.key : String(i)) === key));
}

const TABLES = {
  pc: {rows: () => DATA, noun: 'cards', ranges: RANGE_COLS, labels: RANGE_LABEL, defaults: {},
       inserted: [{v: 3, at: 0, n: 1}, {v: 4, at: 4, n: 1}, {v: 5, at: 14, n: 3}, {v: 6, at: 14, n: 1}, {v: 7, at: 16, n: 1}, {v: 8, at: 19, n: 2}, {v: 9, at: 1, n: 1}],   // v4: PC Rarity/Finish after Set / Card; v5: eBay sales, Max buy $, vs PC % before Trend; v6-v8: PC sales, eBay this month, Hits 30d + Hit % (Anchor $ took Max buy's place); v9: the star
       fav: {s: 'pc', k: r => r[0], c: r => r[0]},             // the star column (Favorites): key = card id
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
       inserted: [{v: 3, at: 0, n: 1}, {v: 4, reset: 1}, {v: 5, at: 4, n: 2}, {v: 6, at: 9, n: 1}, {v: 7, at: 32, n: 1}, {v: 8, at: 1, n: 1}],   // v4: the column set was rebuilt; v5: PC / eBay Rarity/Finish after Set / Card; v6: eBay sales this month; v7: Hit %; v8: the star
       fav: {s: 'ec', k: r => r[0], c: r => r[0]},
       compact: [13, 14, 15, 16, 18, 19, 20, 21, 25, 28],   // hidden in the Compact view: the diagnostics behind the decision numbers (header positions, one past the star)
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
      '<td class="num">' + (r[32] == null ? trendDash(trDays(r[0]), 31, 'no 7-day median with 3+ sales 30 days ago') : fmtPct(r[32])) + '</td>' +
      '<td class="num">' + (r[33] == null ? trendDash(trDays(r[0]), 60, 'fewer than 10 priced days (7-day medians of 3+ sales) in 90 days') : fmtPct(r[33], false, 0)) + '</td>' +
      '<td class="num">' + (r[35] == null ? trendDash(trDays(r[0]), 60, 'last 30 days vs the 30 before') : '<span class="' + (r[35] > 0 ? 'up' : r[35] < 0 ? 'down' : '') + '">' + (r[35] > 0 ? '+' : '') + r[35] + (r[34] == null ? '' : ' (' + (r[34] > 0 ? '+' : '') + r[34].toFixed(1) + '%)') + '</span>') + '</td>' +
      '<td class="num">' + (r[36] == null ? trendDash(null, 0, 'fewer than 3 moves of the 7-day median in 90 days') : fmtPct(r[36], false, 2)) + '</td>' +
      '<td class="num">' + (r[37] == null ? trendDash(null, 0, 'needs 10 priced days (7-day medians of 3+ sales) spanning two weeks') : fmtPct(r[37])) + '</td>' +
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
  rv: {rows: () => LIVE.rv || [], noun: 'cards', ranges: [], labels: {}, defaults: {}, key: r => 'rv' + r[r.length - 1],
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
  er: {rows: () => AU_ON() ? (LIVE.au || []) : erRows(), noun: 'listings', ranges: [24, 25, 'ua'], maxes: [5], chips: [24, 5, 25, 'ua'],   // chip order: Profit $, Listed within, ROI %, Under anchor % (2026-10-13 / 2026-10-24, Brett)
       labels: {5: 'Listed within', 24: 'Profit $', 25: 'ROI %', ua: 'Under anchor %'}, units: {5: 'h'},
       get: {ua: r => r[12] == null ? null : -r[12]},   // "% buy under" (2026-10-24, Brett): the vs anchor % column with the sign flipped, so 20 means at least 20% under what the card sells for
       defaults: {},
       inserted: [{v: 2, at: 10, n: 2}, {v: 3, at: 0, n: 1}, {v: 4, at: 13, n: 2}, {v: 5, at: 7, n: 2}, {v: 6, at: 23, n: 2}, {v: 7, at: 1, n: 1}, {v: 8, at: 28, n: -1}, {v: 9, at: 6, n: 1}, {v: 10, at: 4, n: 1}, {v: 11, at: 6, n: 2}, {v: 12, at: 22, n: 3}, {v: 13, at: 1, n: 1}, {v: 14, at: 32, n: 1}, {v: 15, at: 43, n: 2}, {v: 16, at: 2, n: 1}, {v: 17, at: 3, n: 2}],   // columns added (or, n < 0, removed) over time, in order (see makeTable); v10 eBay Set Name, v11 PC / eBay Rarity/Finish, v12 eBay sales this month + Hits 30d + Hit %; v13 the star; v14 Forecast %; v15 Trend + Book at the end; v16 the + (Planning) after the star; v17 Flag + State after the +
       key: r => String(r[22]),                       // the sticky row highlight remembers a row by this (the item id)
       fav: {s: r => r.unm ? 'um' : 'er', k: r => r[22], c: r => r[0], m: r => favMetaEr(r)},   // key = item id; an unmatched title (Favorites view only) is its own kind
       plan: {k: r => r.unm || r[0] == null ? null : r[22], c: r => r[0], m: r => favMetaEr(r)},   // the + column (Planning, 2026-10-24): a listing with a card
       flag: {k: r => r.unm ? null : r[22], c: r => r[0]},                                        // the Flag and State columns (2026-10-25)
       extra: r => statOk(r[19]) && !r.um && (!$('dis-er').checked || rfBad(r)) && (!$('fchits').checked || fcErOk(r)) && (r.hh ? condOk(r[15]) && (r[29] !== 'suspect' || $('showsus-er').checked) : r.au ? (!$('hits').checked || r[14] === 'PASS') && condOk(r[15]) : (!$('hits').checked || r[14] === 'PASS') && condOk(r[15]) && r[32] >= 2 && (r[29] !== 'suspect' || $('showsus-er').checked) && (!$('mm-er').checked || r[37] === 'low') && (!$('lead-er').checked || r[14] === 'LEAD')),
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
      '<td class="num">' + fmtPct(r[25]) + '</td>' + fcErCell(r) +
      '<td class="num auc"></td><td class="num auc"></td>' +
      '<td>' + verdictCell(r) + hhNote(r) + '</td>' +
      '<td>' + riskCell(r) + '</td>' +
      '<td>' + condCell(r) + '</td>' +
      '<td>' + (r[16] ? 'BO' : dash) + '</td>' +
      '<td class="num">' + fmtInt(r[17]) + '</td><td class="num">' + (r[18] == null ? dash : r[18].toFixed(1) + '%') + '</td>' +
      '<td>' + (r[19] === 'open' ? 'open' : r[19] === 'sold' ? '<span class="up">sold</span>' : '<span class="dim">' + esc(r[19]) + '</span>') + '</td>' +
      '<td class="num">' + (r[27] == null ? dash : (r[19] === 'open' ? '<span class="dim">' + fmtNum(r[27], 1) + '</span>' : fmtNum(r[27], 1))) + '</td>' + erTrendBook(r)},
};
// the eBay Catalog's Trend and Book buttons on every listing row (2026-10-24, Brett): the same popups for the row's card;
// the Book popup marks this very listing in the card's book (data-iid)
const erTrendBook = r => r[0] == null ? '<td>' + dash + '</td><td>' + dash + '</td>'
  : '<td><button class="tbtn ebtn" data-id="' + r[0] + '">Trend</button></td><td><button class="tbtn bbtn" data-id="' + r[0] + '" data-iid="' + esc(r[22] == null ? '' : r[22]) + '">Book</button></td>';
/* ---------------- The Favorites tab ----------------
   Five views, chosen by the chips under the tabs and remembered (fav-sel): All, and one per source tab. Each per-tab
   view is a table fvBuild() makes from a copy of the source tab's header row, run by makeTable with the source's own
   cfg (row builder, chips, search), the source's saved column choices (store) and the starred rows as rows() - so the
   view IS that tab, cut down to the stars, newest star first. The Raw Data view also holds what was starred on the
   listing-shaped screens (auctions and hits, the Scam screen's suspects, Mismatches, the phone alerts, Review) and the
   unmatched titles, each drawn from the best data on hand: the live row, the alert's own record, the row the collector
   builds for a starred listing that has left the 24-hour window (live.favs.rows), or the few words saved with the star.
   All shows every starred card once, through the eBay Catalog's columns, with where it was starred under its name; a
   card eBay has nothing on gets a row from the catalog (PriceCharting's price, dashes elsewhere); the unmatched titles
   sit in a strip under the table. */
const FV = {sel: 'all', cur: null};                // sel: the view; cur: the id of the table it shows (the scroll handler loads more rows)
try { const v = localStorage.getItem('fav-sel'); if (['all', 'pc', 'ec', 'er', 'fc'].includes(v)) FV.sel = v; } catch (e) {}
const FV_VIEWS = [['all', 'All'], ['pc', 'PriceCharting'], ['ec', 'eBay Catalog'], ['er', 'eBay Raw Data'], ['fc', 'Forecast']];
const FV_FROM = new Map();                         // the All view: card id -> {srcs: the tabs it was starred on, n: listings starred, titles, t}
const favsOf = s => [...FAV_MAP.values()].filter(f => f.s === s).sort((a, b) => b.t - a.t);
function favRowsPc() { return favsOf('pc').map(f => idRow.get(+f.k)).filter(Boolean); }
function favRowsEc() { const m = LIVE.ecMap || new Map(); return favsOf('ec').map(f => m.get(+f.k) || ecStub(+f.k)).filter(Boolean); }
function favRowsEr() {
  const au = new Map((LIVE.au || []).map(r => [r[22], r])), hh = new Map((LIVE.hh || []).map(r => [r[22], r]));
  return [...FAV_MAP.values()].filter(f => f.s === 'er' || f.s === 'um').sort((a, b) => b.t - a.t)
    .map(f => f.s === 'um' ? unmStub(f) : (LIVE.erMap && LIVE.erMap.get(f.k)) || au.get(f.k) || hh.get(f.k) || (LIVE.favEr && LIVE.favEr.get(f.k)) || erStub(f))
    .filter(r => !r.um);                           // a starred listing he said is not the same card is out of every tab (2026-10-25)
}
// a starred listing he said is not the same card (the Review button, the phone's No): hidden everywhere until restored from the Mismatches list
const favHidden = f => { if (f.s !== 'er' && f.s !== 'fl') return false;
  const r = flRowOf(f.k, f.c) || (LIVE.au || []).find(z => z[22] === f.k) || (LIVE.hh || []).find(z => z[22] === f.k); return r ? !!r.um : reviewOf(f.k) === 0; };
function favRowsAll() {
  FV_FROM.clear();
  for (const f of [...FAV_MAP.values()].sort((a, b) => b.t - a.t)) {
    const cid = favCard(f); if (cid == null || favHidden(f)) continue;
    const e = FV_FROM.get(cid) || {srcs: new Set(), n: 0, titles: [], t: f.t}; FV_FROM.set(cid, e);
    if (f.s === 'er' || f.s === 'fl') { e.n++; const ti = ((LIVE.erMap && LIVE.erMap.get(f.k)) || [])[6] || (f.m && f.m.ti) || ''; if (ti) e.titles.push(ti); if (f.s === 'fl') e.srcs.add('fc'); } else e.srcs.add(f.s);
  }
  const m = LIVE.ecMap || new Map(), out = [];
  for (const cid of FV_FROM.keys()) { const r = m.get(cid) || ecStub(cid); if (r) out.push(r); }
  return out;
}
function fvFromNote(r) {                           // under the card's name in the All view: where it was starred
  const e = FV_FROM.get(r[0]); if (!e) return '';
  const bits = [...e.srcs].map(s => FAV_SRC_NAME[s] || s); if (e.n) bits.push(e.n + ' listing' + (e.n === 1 ? '' : 's'));
  return '<br><span class="dim fvfrom" title="' + esc(e.titles.join('\n')) + '">from: ' + esc(bits.join(' · ')) + '</span>';
}
function ecStub(cid) {                             // an eBay Catalog row for a card eBay has nothing on: the catalog's columns, dashes elsewhere
  const base = idRow.get(cid); if (!base) return null;
  const r = new Array(54).fill(null), f = cardFacts(cid);
  r[0] = base[0]; r[1] = base[1]; r[2] = base[2]; r[3] = base[3]; r[4] = base[4];
  r[29] = []; r[39] = 0; r[40] = 0; r[41] = base[PC_LIVE.pcm]; r[42] = base[6]; r[45] = mtOf(cid); r[46] = rfText(pcRF(base)); r[47] = f; r[48] = rfText(f); r[53] = base[PC_LIVE.pcmm];
  r.stub = true;
  return r;
}
function erStub(f) {                               // a starred listing nothing else knows any more: the words kept with the star
  const m = f.m || {}, base = (f.c != null && idRow.get(+f.c)) || [];
  const r = new Array(57).fill(null);
  r[0] = base[0] == null ? null : base[0]; r[1] = base[1] || ''; r[2] = base[2] || ''; r[3] = base[3] || ''; r[4] = base[4] || '';
  r[6] = m.ti || ''; r[9] = m.p == null ? null : m.p; r[14] = 'no longer on record'; r[15] = 'UNK'; r[19] = 'unknown'; r[20] = m.u || '#'; r[22] = f.k;
  r[29] = 'clean'; r[30] = 0; r[31] = 0; r[32] = 99; r[33] = []; r[34] = ''; r[39] = []; r[47] = rfText(pcRF(base)); r[49] = ''; r[50] = ''; r[55] = '';
  r.stub = true; r.um = false; r.pics = [];
  return r;
}
function unmStub(f) { const r = erStub(f); r[0] = null; r.unm = {why: (f.m && f.m.why) || ''}; return r; }
// the Raw Data view's row for an unmatched title (no card), or a starred listing whose card is unknown: every column, most of them blank
function unmRow(r) {
  const blank = n => ('<td class="num">' + dash + '</td>').repeat(n);
  return (r.unm ? '<td class="mmk"></td>' : umCell(r)) +
    '<td>' + (r.unm ? '<span class="dim">no card</span>' : esc(r[1] || '')) + '</td><td></td><td></td><td class="num"></td><td></td><td></td><td>' + dash + '</td>' +   // Card, PC Set, eBay Set, Set / Card, PC and eBay Rarity/Finish, Released
    blank(2) +                                                             // Match:mismatch, Listed within
    '<td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener" title="' + esc(r[6] || '') + '">' + esc(r[6] || '') + '</a></td>' +
    '<td class="num auc"></td><td class="num auc"></td>' +
    '<td class="num fxc">' + dash + '</td><td class="num">' + dash + '</td><td class="num">' + fmtMoney(r[9]) + '</td>' + blank(1) +   // Item, Ship, Total, All-in
    blank(7) + blank(7) +                                                  // PC $ ... Hit %; Anchor ... ROI, Forecast %
    '<td class="num auc"></td><td class="num auc"></td>' +
    '<td>' + (r.unm ? badge('unmatched') + (r.unm.why ? ' <span class="dim">' + esc(r.unm.why) + '</span>' : '') : badge(r[14] || 'no longer on record')) + '</td>' +
    '<td>' + dash + '</td><td>' + dash + '</td><td>' + dash + '</td>' + blank(2) + '<td><span class="dim">' + esc(r[19] || 'unknown') + '</span></td>' + blank(1) + erTrendBook(r);   // Trend, Book: dashes without a card
}
const FV_TABLES = {                                // the Favorites views: the source tab's cfg, its saved columns, the stars as rows, no implicit filters
  fall: Object.assign({}, TABLES.ec, {rows: favRowsAll, extra: null, defaults: {}, store: 'ec', root: '#fv-fall', name: 'Favorites · All', noun: 'cards',
        fav: {s: 'all', k: r => r[0], c: r => r[0]},
        row: r => { const h = TABLES.ec.row(r), i = h.indexOf('</td>'); return h.slice(0, i) + fvFromNote(r) + h.slice(i); }}),
  fpc: Object.assign({}, TABLES.pc, {rows: favRowsPc, extra: null, defaults: {}, store: 'pc', root: '#fv-fpc', name: 'Favorites · PriceCharting', noun: 'favorites'}),
  fec: Object.assign({}, TABLES.ec, {rows: favRowsEc, extra: null, defaults: {}, store: 'ec', root: '#fv-fec', name: 'Favorites · eBay Catalog', noun: 'favorites'}),
  fer: Object.assign({}, TABLES.er, {rows: favRowsEr, extra: null, defaults: {}, store: 'er', root: '#fv-fer', name: 'Favorites · eBay Raw Data', noun: 'favorites',
        row: r => r.unm || (r.stub && r[0] == null) ? unmRow(r) : TABLES.er.row(r)}),
};
/* The Forecast tab's card popup (2026-10-24, Brett: "when i click on a card in the forcast tab, i would like to see a popup
   with the available listing ... all of the ebay raw data tab column, but ... a column toggle button ... on the forcast
   button page itself"): the Raw Data table once more, as the Favorites views do it - a copy of the Raw Data header row
   run by makeTable with the Raw Data row builder, its OWN column choices (store 'fc': hide-fc, order-fc, width-fc...),
   and as rows the card's open copies: the 24-hour rows, the plan's rows, and live/fc_rows.bin (the collector's rows for
   the book copies past 24 hours). The "Listing columns..." button on the Forecast tab opens this table's column picker,
   so one choice applies to every card's popup. It opens on the copies the Supply cell counted - those at the plan's
   price for the card (fcSupplyAt, FCL.at) - with a switch to every open copy (2026-10-25, Brett: the count, its price
   and the popup's rows agree). A listing he said is not the same card is out of it, as of every tab. */
const FCL = {cid: null, rows: [], file: null, loaded: 0, mode: 'plan', at: null};   // mode: 'plan' = the copies at the plan's price, 'all' = every open copy; at = fcSupplyAt for the open card (+ T, buy, disc)
try { if (localStorage.getItem('fcl-mode') === 'all') FCL.mode = 'all'; } catch (e) {}
const fclOk = r => FCL.mode === 'au' ? false : FCL.mode === 'sales' ? !!r.sale : (r[19] === 'open' && !r.sale && !r.um && (FCL.mode !== 'plan' || !FCL.at || (FCL.at.ids.has(r[22]) && !flaggedBy(r[22]))));
const FCL_TABLE = Object.assign({}, TABLES.er, {rows: () => FCL.rows, extra: fclOk, ranges: [], maxes: [], chips: [], defaults: {}, store: 'fc', root: '#lov', name: 'Listings', noun: 'listings',
                                                 rowClass: r => (r[29] === 'suspect' ? 'sus ' : '') + (flaggedBy(r[22]) || r.um || (FCL.cid != null && fcCredWhy(r, LIVE.dec && LIVE.dec[String(FCL.cid)])) ? 'nocred' : ''),   // greyed: a copy the floor does not count as credible, or one he flagged / said is not the card
                                                 fav: {s: 'fl', k: r => r[22], c: r => r[0], m: r => favMetaFl(r)}});   // its star files the listing under the Favorites tab's Forecast view (2026-10-25, Brett)
function fclBuild() {                              // the popup's header row: a copy of the Raw Data tab's, before makeTable decorates the original
  const lov = $('lov'); if (!lov) return;
  const thead = document.querySelector('#p-er thead').cloneNode(true);
  lov.querySelector('table').insertBefore(thead, lov.querySelector('tbody'));
}
function fvBuild() {                               // the Favorites tab's tables: a copy of each source tab's header row, before makeTable decorates the originals
  const host = $('fv-host'); if (!host) return;
  for (const [fid, src] of [['fall', 'ec'], ['fpc', 'pc'], ['fec', 'ec'], ['fer', 'er']]) {
    const sec = document.createElement('div'); sec.className = 'fvsec'; sec.id = 'fv-' + fid; sec.hidden = true;
    sec.innerHTML = '<div class="controls"><input type="search" id="q-' + fid + '" placeholder="Search your favorites…"><select id="set-' + fid + '"><option value="">All sets (release order)</option></select><span class="count" id="count-' + fid + '"></span></div>' +
      '<div class="ranges" id="ranges-' + fid + '"><button class="reset" id="reset-' + fid + '">Reset filters</button></div>' +
      '<div class="wrap"><table class="wide"><tbody id="rows-' + fid + '"></tbody></table></div><button class="more" id="more-' + fid + '" hidden>Show more</button>' +
      (fid === 'fall' ? '<div class="fvum" id="fv-um"></div>' : '');
    const thead = document.querySelector('#p-' + src + ' thead').cloneNode(true);
    sec.querySelector('table').insertBefore(thead, sec.querySelector('tbody'));
    host.appendChild(sec);
  }
  $('fv-sel').addEventListener('click', e => { const b = e.target.closest('.fvchip'); if (!b) return; FV.sel = b.dataset.v; try { localStorage.setItem('fav-sel', FV.sel); } catch (x) {} fvRender(); });
}
function fvCounts() {                              // the chips' counts and the tab's; All counts cards once (plus the unmatched titles)
  const n = {all: 0, pc: 0, ec: 0, er: 0, fc: 0}, cards = new Set(); let um = 0;
  for (const f of FAV_MAP.values()) { if (f.s === 'um') { n.er++; um++; continue; } if (favHidden(f)) continue; const s = f.s === 'fl' ? 'fc' : f.s; n[s] = (n[s] || 0) + 1; const c = favCard(f); if (c != null) cards.add(c); }
  n.all = cards.size + um;
  const el = $('nfv'); if (el) el.textContent = FAV_MAP.size ? '(' + FAV_MAP.size + ')' : '';
  return n;
}
function fvRender() {
  const sel = $('fv-sel'); if (!sel) return;
  const n = fvCounts();
  sel.innerHTML = FV_VIEWS.map(([k, name]) => '<button type="button" class="fvchip' + (FV.sel === k ? ' on' : '') + '" data-v="' + k + '">' + name + '<span class="n">' + (n[k] || 0) + '</span></button>').join('');
  ['fall', 'fpc', 'fec', 'fer', 'fc'].forEach(x => { const e = $('fv-' + x); if (e) e.hidden = true; });
  const id = FV.sel === 'all' ? 'fall' : FV.sel === 'fc' ? null : 'f' + FV.sel, note = $('fv-note');
  FV.cur = id;
  note.textContent = LIVE.data ? '' : 'Waiting for the live data: the stars are kept by the collector and arrive with it.';
  if (FV.sel === 'fc') { $('fv-fc').hidden = false; if (LIVE.data) fvRenderFc(); else $('fv-fcbody').innerHTML = ''; return; }   // (before the live data the page may still be loading: nothing below this point is referenced)
  const t = tables[id]; if (!t) return;
  $('fv-' + id).hidden = false;
  t.resync(); t.apply();
  if (id === 'fall') fvRenderUm();
  if (!t.view.length && !note.textContent) note.textContent = FV.sel === 'all' ? 'Nothing starred yet. Click the ★ on any row of the PriceCharting, eBay Catalog or eBay Raw Data tabs, on a Forecast pick, or in the Scam screen, Mismatches, Unmatched titles, the phone alerts or the Review screen.'
    : 'Nothing starred on the ' + FAV_SRC_NAME[FV.sel] + ' tab yet' + (FV.sel === 'er' ? ' (its stars include the auction view, the hits, the Scam screen, Mismatches, the phone alerts, Review and Unmatched titles)' : '') + '.';
}
function fvRenderUm() {                            // the strip under the All view: the unmatched titles starred (no card to put them on)
  const box = $('fv-um'); if (!box) return;
  const L = favsOf('um');
  if (!L.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<h3>Unmatched titles you starred (' + L.length + ')</h3><p class="dim">Listings the title parser could not tie to a card: with no catalog row to sit on, they are listed here (and in the eBay Raw Data view).</p><table><tbody>' +
    L.map(f => { const m = f.m || {}; return '<tr><td class="favc">' + favBtn('um', f.k, null, m, 'sm') + '</td><td class="ttl"><a href="' + esc(m.u || '#') + '" target="_blank" rel="noopener">' + esc(m.ti || f.k) + '</a></td><td class="num">' + fmtMoney(m.p) + '</td><td class="dim">' + esc(m.why || '') + '</td><td class="dim">starred ' + rvWhen(new Date(f.t).toISOString()) + '</td></tr>'; }).join('') + '</tbody></table>';
}
function fvRenderFc() {                            // the Forecast view: each pick as it stood when starred, and where it is on the tab now; then the listings starred there
  const box = $('fv-fcbody'), L = favsOf('fc'), LL = favsOf('fl').filter(f => !favHidden(f));
  if (!L.length && !LL.length) { box.innerHTML = '<p class="dim">Nothing starred on the Forecast tab yet. The star beside a card there keeps it here with the hold, the discount and the numbers it had; the star on a listing in a card\u2019s popup or on your plan keeps the listing here.</p>'; return; }
  const now = new Map((FC.rows || []).map(r => [r.cid, r])), I = FC.inputs;
  let h = '';
  if (LL.length) h += fvRenderFl(LL, I);
  if (!L.length) { box.innerHTML = h; box.querySelectorAll('table[data-sel]').forEach(selApply); return; }
  h += (LL.length ? '<h3>Cards starred on the Forecast tab</h3>' : '') + '<p class="dim">Each row keeps the forecast as it stood when you starred it: the hold, the discount, the price, the net per copy (10th percentile – median – 90th) and the chance of a profit. "Now" is the same card on the Forecast tab at its current settings' + (I ? ' (' + I.h + '-month hold' + (I.disc ? ', bought ' + (I.disc * 100).toFixed(0) + '% under' : ', standard price') + ')' : '') + '.</p>';
  h += '<table data-sel="fvfc"><thead><tr><th></th><th>Card</th><th>Hold</th><th>Bought at</th><th class="num">Price then</th><th class="num">Net per copy then</th><th class="num">Chance then</th><th class="num">Copies</th><th>Starred</th><th class="num">Now</th></tr></thead><tbody>';
  L.forEach(f => {
    const m = f.m || {}, base = idRow.get(+f.k) || [], r = now.get(+f.k);
    h += '<tr data-key="' + esc(f.k) + '"><td class="favc">' + favBtn('fc', f.k, +f.k, m, 'sm') + '</td><td><a href="https://www.pricecharting.com/game/' + esc(f.k) + '" target="_blank" rel="noopener">' + esc(base[1] || m.n || ('card ' + f.k)) + '</a><br><span class="dim">' + esc(String(base[2] || m.s || '').replace(/^Pokemon /, '')) + '</span></td>' +
      '<td>' + (m.h ? m.h + ' mo' : dash) + '</td><td>' + (m.d ? (m.d * 100).toFixed(0) + '% under' : 'standard price') + '</td><td class="num">' + (m.buy == null ? dash : fmtMoneyPlain(m.buy)) + '</td>' +
      '<td class="num">' + (m.med == null ? dash : fcMoney2(m.lo) + ' – <b>' + fcMoney2(m.med) + '</b> – ' + fcMoney2(m.hi)) + '</td><td class="num">' + (m.p == null ? dash : (m.p * 100).toFixed(0) + '%') + '</td><td class="num">' + (m.q ? m.q : dash) + '</td>' +
      '<td>' + rvWhen(new Date(f.t).toISOString()) + '</td><td class="num">' + (r ? (r.p * 100).toFixed(0) + '% · ' + fcMoney2(r.med) + (r.qty ? ' · buy ' + r.qty : '') : '<span class="dim">' + (FC.doc ? 'not on the list now' : 'model not loaded') + '</span>') + '</td></tr>';
  });
  box.innerHTML = h + '</tbody></table>'; box.querySelectorAll('table[data-sel]').forEach(selApply);
}
function flRowOf(iid, cid) {                       // the listing's row as the page knows it now: the 24-hour table, the collector's rows for starred / planned listings, the Forecast tab's listings file
  let r = (LIVE.erMap && LIVE.erMap.get(iid)) || (LIVE.favEr && LIVE.favEr.get(iid)) || null;
  if (!r && cid != null && idRow.get(+cid)) {
    const S = settings(), base = idRow.get(+cid), cs = LIVE.dec && LIVE.dec[String(cid)];
    const x = ((LIVE.data && LIVE.data.plan && LIVE.data.plan.rows) || {})[iid] || ((FCL.file && FCL.file.rows && FCL.file.rows[String(cid)]) || []).find(y => y[0] === iid);
    if (x) r = erowOf(x, S, base, cs);
  }
  return r;
}
function fvRenderFl(LL, I) {                        // the listings starred on the Forecast tab (a card's popup, the plan): the figures they had, and where each stands now
  const S = settings();
  let h = '<h3>Listings starred on the Forecast tab</h3><p class="dim">The star in a card\u2019s popup or on your plan keeps the listing here with the model\u2019s figures for it at that moment: its price, the hold, the net per copy (10th percentile – median – 90th) at that price and the chance of a profit. "Now" is the listing\u2019s status today and its chance at the Forecast tab\u2019s current hold' + (I ? ' (' + I.h + ' months)' : '') + '. Click the card for its open copies.</p>';
  h += '<table data-sel="fvfl"><thead><tr><th></th><th>Card</th><th>Listing</th><th class="num">Price then</th><th>Hold</th><th class="num">Net per copy then</th><th class="num">Chance then</th><th>Starred</th><th>Now</th></tr></thead><tbody>';
  LL.forEach(f => {
    const m = f.m || {}, cid = f.c == null ? null : +f.c, base = (cid != null && idRow.get(cid)) || [], r = flRowOf(f.k, cid);
    const st = r ? r[19] : 'unknown', total = r ? r[9] : m.p, pNow = r && FC.doc && cid != null ? fcListing(cid, total, f.k, I ? I.h : (m.h || 3), S) : null;
    h += '<tr data-key="' + esc(f.k) + '"><td class="favc">' + favBtn('fl', f.k, cid, m, 'sm') + '</td>' +
      '<td>' + (cid != null ? '<a href="#" class="fcl-open" data-id="' + cid + '" title="The open copies of this card">' + esc(base[1] || ('card ' + cid)) + '</a>' : '<span class="dim">no card</span>') + (base[2] ? '<br><span class="dim">' + esc(String(base[2]).replace(/^Pokemon /, '')) + '</span>' : '') + '</td>' +
      '<td class="ttl"><a href="' + esc((r && r[20]) || m.u || '#') + '" target="_blank" rel="noopener" title="' + esc((r && r[6]) || m.ti || '') + '">' + esc(String((r && r[6]) || m.ti || f.k).slice(0, 70)) + '</a></td>' +
      '<td class="num">' + (m.p == null ? dash : fmtMoneyPlain(m.p)) + (m.sell != null ? '<br><span class="dim">sells ' + fmtMoneyPlain(m.sell) + '</span>' : '') + '</td><td>' + (m.h ? m.h + ' mo' : dash) + '</td>' +
      '<td class="num">' + (m.med == null ? dash : fcMoney2(m.lo) + ' – <b>' + fcMoney2(m.med) + '</b> – ' + fcMoney2(m.hi)) + '</td><td class="num">' + (m.c == null ? dash : Math.round(m.c * 100) + '%') + '</td>' +
      '<td>' + rvWhen(new Date(f.t).toISOString()) + '</td><td>' + (st === 'open' ? '<span class="up">open</span>' : st === 'unknown' ? '<span class="dim">not on record</span>' : '<span class="down">' + esc(st) + '</span>') + (r && total != null && total !== m.p ? ' · ' + fmtMoneyPlain(total) : '') + (pNow != null ? ' · ' + Math.round(pNow * 100) + '% chance' : '') + '</td></tr>';
  });
  return h + '</tbody></table>';
}

/* ---------------- Raw Data's auction view: "Auctions sent to my phone" ----------------
   With the switch on the table shows no ordinary listing, only the auctions the collector pinged the phone about
   (live.alert.au, kept 60 days). Each row is laid out like a listing row so the same columns, sorts and filters work:
     Max buy, Profit, ROI      = the worst case if he wins: he pays his whole Max buy, so ROI is his margin
     Profit / ROI at final     = the best case: the price it closed at with no bid from him in the auction
     Verdict                   = how it closed against his Max buy
   Margin and buy tax come from the SAVED Notification Settings settings, never from the boxes at the top (Brett: the view is
   about what was sent). What selling the card brings in is the figure frozen when the alert went out. */
function AU_ON() { const e = document.getElementById('au-er'); return !!(e && e.checked); }
// eBay's facts (48: the facts row, 49-50: its set / rarity-finish text) and condition text (55) on an auction or hit row:
// the live row's while the listing is in the 24-hour table, else what the alert's own record kept (2026-10-23: the
// alert had read them and thrown them away, so every auction said "not read")
function histFacts(row, lv, ef, ec) {
  row[48] = lv ? lv[48] : ef === undefined ? null : ef; row[55] = lv ? lv[55] || '' : ec || '';
  row[49] = row[48] && row[48].length ? row[48][0] || '' : ''; row[50] = row[48] && row[48].length ? rfText([row[48][1], row[48][2]]) : '';
}
function auRows(live) {
  const A = (live.alert && live.alert.au) || [], c = Object.assign({}, AL_DEFAULT, (live.alert && live.alert.cfg) || {});
  const margin = Math.min(0.5, Math.max(0, c.margin / 100)), tax = Math.min(0.15, Math.max(0, c.tax / 100)), now = Date.now();
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  return A.slice().sort((x, y) => (x[1] < y[1] ? 1 : -1)).map((a, i) => {
    const [iid, t, cid, ti, u, bid, ship, nb, end, tc, fb, pct, kd, s, netNM, netLP, tier, sc, scr, ph, fin, fb2, fst, dec, old, tot0, umFlag, img, imgs, ef, ec] = a;
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
      sold ? 'sold' : fst === 'nobids' ? 'ended' : fst === 'gone' ? 'gone' : 'open', u, img || null, iid, null,
      maxbuy == null ? null : r2(net - maxbuy), maxbuy == null ? null : r1(margin * 100), s,
      null, lp ? 'LP: judged as a lightly played copy' : kd === 'lead' ? 'Lead: priced from PriceCharting, not from eBay sales' : null,
      tier || 'clean', RISK_RANK[tier] || 0, sc || 0, ph == null ? 99 : ph, scr || [], t,
      pc, sold && pc ? r1((ftot / pc - 1) * 100) : null, '', '', [], base[PC_LIVE.pcm], base[PC_LIVE.km],
      bid, sold ? fin : null, sold && net != null ? r2(net - fall) : null, sold && net != null && fall > 0 ? r1((net - fall) / fall * 100) : null, i];
    row[46] = mtOf(cid);
    const lv = LIVE.erMap && LIVE.erMap.get(iid); row[47] = rfText(pcRF(base)); histFacts(row, lv, ef, ec);   // eBay's facts: the live row's, else the alert's own record
    row[51] = base[PC_LIVE.kt]; row[52] = base[PC_LIVE.hits]; row[53] = base[PC_LIVE.hitpct]; row[54] = base[PC_LIVE.pcmm];
    row.au = {fst, kd, dec, old, nb, fb2, end, tot0, res, res0}; row.um = um; row.pics = (imgs || []).slice(1);
    const bc = condOfBrett(iid); row[58] = row[15]; row[57] = bc || ''; if (bc) row[15] = bc;   // his grade from the photos over the seller's (2026-10-25)
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
               'mismatch: marked by you': 'You marked this auction as not the card it was matched to. It is left out of the hit total. Restore it from the Mismatches list to undo.'}[x.res] || '';
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
    '<td class="num" title="Worst case if you win: you pay your whole Max buy">' + signed(r[24]) + '</td><td class="num" title="Worst case if you win: your margin">' + fmtPct(r[25]) + '</td>' + fcErCell(r) +
    '<td class="num auc" title="Best case: at the price it closed at">' + signed(r[44]) + '</td><td class="num auc" title="Best case: at the price it closed at">' + fmtPct(r[45]) + '</td>' +
    '<td><span title="' + esc(tip + said) + '">' + (x.res === 'PASS' ? badge('PASS', 'pass') : r.um ? badge('mismatch \u2717', 'warn') : '<span class="dim">' + esc(x.res) + '</span>') + (x.dec === 'no' ? ' <span class="dim">· you said No</span>' : '') + '</span></td>' +
    '<td>' + riskCell(r) + '</td>' +
    '<td>' + condCell(r) + '</td><td>' + dash + '</td>' +
    '<td class="num">' + fmtInt(r[17]) + '</td><td class="num">' + (r[18] == null ? dash : r[18].toFixed(1) + '%') + '</td>' +
    '<td>' + (r[19] === 'sold' ? '<span class="up">sold</span>' : r[19] === 'open' ? 'open' : '<span class="dim">' + esc(r[19]) + '</span>') + '</td><td class="num">' + dash + '</td>' + erTrendBook(r);
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

// condition: NM / LP / MP / HP from eBay's own condition field when the collector has read the listing (r[55] holds
// eBay's words), else from the title; n/s = neither names one (hover says which)
const condUnread = r => r[15] === 'UNK' && r[55] == null && !r[57];   // no grade in the title and eBay's condition field never read (2026-10-25: shown as "?", counted nowhere on the Forecast tab)
function condCell(r) {
  const ec = r[55] || '', bc = r[57] || '';
  if (bc) return '<span title="' + esc('Your grade from the photos; every figure uses it. The seller: ' + (r[58] && r[58] !== 'UNK' ? r[58] : 'no grade') + (ec ? ' (eBay\u2019s condition field: ' + ec + ')' : '')) + '">' + esc(bc) + '<sup class="dim" title="your grade from the photos">you</sup></span>';
  if (condUnread(r)) return '<span class="dim cq" title="Condition not read yet: no grade in the title, and eBay\u2019s condition field (one lookup per listing) has not been read. The collector reads it within minutes for the copies you look at (a card\u2019s popup, Review), then your plan\u2019s listings, each card\u2019s cheapest copies and the hits, then the rest newest first. Until then the copy counts in nothing on the Forecast tab.">?</span>';
  if (r[15] === 'UNK') return '<span class="dim" title="' + esc(ec ? 'eBay\u2019s condition field says: ' + ec + ' (no grade in it)' : 'no condition in the title, and none stated on the listing (eBay\u2019s condition field was read)') + '">n/s</span>';
  return '<span title="' + esc(ec ? 'eBay\u2019s condition field: ' + ec : 'from the title') + '">' + esc(r[15]) + (ec ? '<sup class="dim" title="stated on eBay">e</sup>' : '') + '</span>';
}
// scam screen: tier badge with the score and the signals behind it on hover; a click opens the points table
// (Brett, 2026-10-17: "press the watch button and have a popup revealing the points it received")
const RISK_RANK = {clean: 0, watch: 1, suspect: 2};
const SCAM_POINTS_DEFAULT = {p50: 4, p65: 2, p75: 1, fb0: 3, fbq: 1, img: 1, qty: 2, dup: 3, slow: 1, top: -2, est: -1, burst: 0, fb1: 1, pct: 2, ret: 1};   // the collector's table, until the live file carries it
function riskCell(r) {
  const lab = (LIVE.data && LIVE.data.scam && LIVE.data.scam.labels) || {};
  const why = (r[33] || []).map(c => lab[c] || c).join(' · ');
  const title = 'score ' + r[31] + (why ? ': ' + why : '') + ' — click for the points';
  const btn = inner => '<button class="riskb" data-i="' + esc(r[22] || '') + '" title="' + esc(title) + '">' + inner + '</button>';
  if (r[29] === 'suspect') return btn(badge('suspect', 'sus'));
  if (r[29] === 'watch') return btn(badge('watch', 'watch'));
  return (r[33] || []).length ? btn('<span class="dim">—</span>') : '<span class="dim" title="' + esc(title) + '">—</span>';
}
document.addEventListener('click', e => { const b = e.target && e.target.closest ? e.target.closest('button.riskb') : null; if (b && b.dataset.i) openRisk(b.dataset.i); });
const riskBits = () => { const sc = (LIVE.data && LIVE.data.scam) || {}; return {sc, pts: Object.assign({}, SCAM_POINTS_DEFAULT, sc.points || {}), lab: sc.labels || {}, watchAt: sc.watch || 3, susAt: sc.suspect || 5}; };
function riskTableHtml(r) {                              // the points behind one listing's tier: the Risk popup, and the Review popup's Warnings (2026-10-25, Brett: the phone's Warnings button on the site too)
  const {sc, pts, lab, watchAt, susAt} = riskBits(), codes = r[33] || [], tier = r[29] || 'clean';
  const outcomes = c => { const o = (sc.signals || {})[c]; if (!o) return '<span class="dim">no closed listings yet</span>';
    const n = Object.values(o).reduce((s, v) => s + v, 0), sold = o.sold || 0, gone = o.gone || 0;
    return n + ' closed: <b>' + sold + '</b> sold (' + Math.round(sold / n * 100) + '%), ' + (o.ended || 0) + ' ended, ' + gone + ' gone (' + Math.round(gone / n * 100) + '%), ' + (o.stale || 0) + ' outlived 2 days'; };
  let h = '<p>Every open listing is scored on the signals below; <b>' + watchAt + ' points</b> or more makes it <b>watch</b>, <b>' + susAt + '</b> or more <b>suspect</b>. A photo also used by another seller is suspect by itself, and a watch listing from a seller never seen before who put up several $75+ cards the same day is moved to suspect (“burst”). ' +
    'Points come from the calibration of closed listings: what listings with each signal went on to do (sold normally, or vanished without a sale — the scam pattern).</p>';
  if (!codes.length) h += '<p class="dim">No signal fired on this listing: score 0, clean.</p>';
  else {
    h += '<table class="wt"><thead><tr><th>Signal</th><th class="num">Points</th><th>Listings with this signal</th></tr></thead><tbody>' +
      codes.map(c => '<tr><td>' + esc(lab[c] || c) + ' <span class="dim">(' + esc(c) + ')</span></td><td class="num"><b>' + (pts[c] > 0 ? '+' : '') + (pts[c] == null ? '?' : pts[c]) + '</b></td><td>' + outcomes(c) + '</td></tr>').join('') +
      '<tr><td><b>Total</b></td><td class="num"><b>' + r[31] + '</b></td><td>' + (tier === 'suspect' ? 'suspect: at or over ' + susAt + (codes.indexOf('dup') >= 0 ? ', or the shared photo alone' : codes.indexOf('burst') >= 0 ? ', or the seller burst' : '') : tier === 'watch' ? 'watch: ' + watchAt + ' to ' + (susAt - 1) : 'clean: under ' + watchAt) + '</td></tr></tbody></table>';
  }
  h += '<p class="dim">Watch listings are shown and can alert (Notification Settings decides); suspects are hidden unless “Show suspects” is ticked and never alert. The seller’s own bar (ratings, feedback %) is a separate check in the gate.</p>';
  return h;
}
function openRisk(iid) {
  const r = (LIVE.erMap && LIVE.erMap.get(iid)) || (LIVE.au || []).find(z => z[22] === iid) || (LIVE.hh || []).find(z => z[22] === iid) || (LIVE.favEr && LIVE.favEr.get(iid)) || (typeof FCL !== 'undefined' && (FCL.rows || []).find(z => z[22] === iid));
  if (!r) return;
  $('btitle').textContent = 'Risk: ' + (r[29] || 'clean') + ' — score ' + r[31];
  $('bsub').innerHTML = esc(r[1]) + ' · <a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener">' + esc((r[6] || '').slice(0, 90)) + '</a>';
  $('bbody').innerHTML = riskTableHtml(r);
  $('bov').classList.add('open');
}
// the Review popup's scam block, the phone's (hit.html): the tier and the points with a Warnings button that unfolds the table above
function reviewScamHtml(r) {
  const {pts, lab} = riskBits(), codes = r[33] || [], tier = r[29] || 'clean';
  if (!codes.length) return '<div class="rvscam clean"><b>Scam screen:</b> <span class="dim">no signal fired on this listing (score 0).</span></div>';
  return '<div class="rvscam' + (tier === 'suspect' ? ' sus' : tier === 'watch' ? ' watch' : '') + '"><div class="head"><b>' + (tier === 'suspect' ? 'SUSPECT: ' : tier === 'watch' ? 'Scam watch: ' : 'Scam screen, clean: ') + r[31] + ' point' + (r[31] === 1 ? '' : 's') + '</b><button type="button" class="wbtn" id="rv-wbtn">Warnings \u25be</button></div>' +
    '<ul id="rv-wlist">' + codes.map(c => '<li>' + (pts[c] > 0 ? '+' : '') + (pts[c] == null ? '?' : pts[c]) + ' \u2014 ' + esc(lab[c] || c) + '</li>').join('') + '</ul><div id="rv-wtab" hidden>' + riskTableHtml(r) + '</div></div>';
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
  if (v === 'mismatch: marked by you') return tip('You marked this listing as not the card it was matched to. It is out of every tab, the statistics and the hit total, and the matcher learns from it. Restore it from the Mismatches list to undo.', badge('mismatch \u2717', 'warn'));
  if (v === 'reprint?') return tip('An anniversary set has a cheaper card with this name and number' + (r.tw ? ' (' + r.tw[1].map(t => t[0] + ', about ' + fmtMoney(t[1])).join('; ') + ')' : '') + ', and this listing is priced nearer that card than this one. It is most likely the reprint, or a played copy of the original: either way not the near-mint card the numbers assume. Not a hit. Look for the anniversary stamp on the artwork.', badge('reprint?', 'warn'));
  if (v === 'learned') return tip('Held back by what your earlier mismatch marks taught: ' + (r.lrn || '') + '. It cannot be a hit. If it is the right card after all, the mark that taught this was the wrong one to make.', badge('learned', 'watch'));
  if (v === 'mismatch: too cheap') return tip('under ' + pcPct('pcLow', 0.4) + '% of the PriceCharting price: treated as a wrong match (another printing or language, a lot, a fake - far more often than a bargain). Never a hit, left out of the statistics; check it by hand', badge('mismatch ↓', 'watch'));
  if (v === 'mismatch: too high') return tip('over ' + pcPct('pcHigh', 3) + '% of the PriceCharting price: treated as a wrong match and left out of the statistics', badge('mismatch ↑'));
  if (v === 'review') return tip('under 45% of the anchor: more often misidentified, damaged or fake than a bargain - check the photos and the seller', badge('review', 'watch'));
  if (v === 'PC gap') { const g = LIVE.dec && LIVE.dec[String(r[0])] && LIVE.dec[String(r[0])].gap;
    return tip('eBay\u2019s sold median and PriceCharting\u2019s price for this card are ' + (g != null ? Math.abs(g).toFixed(0) + '% apart' : 'far apart') + ' (eBay ' + (g > 0 ? 'above' : 'below') + '): one of the two is wrong. The card is held from buys and hits until you review it in Flags - a card verdict there releases it for 30 days.', badge('PC gap', 'warn')); }
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
  if (A.hh) (LIVE.hh || []).forEach(r => { if (r[24] != null && P.test(r.hh.t)) out.push({t: r.hh.t, src: 'bin', kind: kindOf(r.hh.kd), p: r[24], i: r[22], cid: r[0], c: r[1], u: r[20], tot: r[9], ti: r[6], dec: r.hh.dec, um: r.um}); });
  else (A.all || []).forEach(e => { if (/^hit/.test(e[2] || '') && e[1] != null && P.test(e[0])) out.push({t: e[0], src: 'bin', kind: kindOf(e[2]), p: e[1], i: e[4], cid: null, c: e[5] || '', u: e[6], tot: e[7], ti: e[9] || '', dec: e[3], um: umOf(e[4], e[8])}); });
  (LIVE.au || []).forEach(r => { if (r.au.res0 === 'PASS' && r[44] != null && P.test(r[34])) out.push({t: r[34], src: 'au', kind: 'auction, at the final price', p: r[44], i: r[22], cid: r[0], c: r[1], u: r[20], tot: r[9], ti: r[6], dec: r.au.dec, um: r.um}); });
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
  const ans = {nm: 'Yes, near mint', lp: 'Yes, lightly played', mp: 'graded moderately played', hp: 'graded heavily played', dmg: 'graded damaged', no: 'No (the reason is on its flag)', yes: 'Same card'};
  $('btitle').textContent = 'Hits in ' + PERIOD.er.label();
  $('bsub').textContent = 'Every hit the collector alerted you to in the period, newest first. The table behind this list only holds the last 24 hours and judges each listing as it stands now, so a hit from earlier can be missing there or no longer pass.';
  $('bbody').innerHTML = !L.length ? '<p>None in this period.</p>' :
    '<table><thead><tr><th></th><th>Mismatch</th><th>Alerted</th><th>Card</th><th>Kind</th><th class="num">Total</th><th class="num">Profit</th><th>Your answer</th><th>In the table now</th></tr></thead><tbody>' +
    L.map(h => { const r = now.get(h.i), out = h.um || h.dec === 'no';
      return '<tr class="' + (out ? 'umm' : '') + '"><td class="favc">' + favBtn('er', h.i, h.cid, {ti: String(h.ti || '').slice(0, 90), u: h.u || null, p: h.tot == null ? null : h.tot}, 'sm') + '</td><td class="mmk"><input type="checkbox" class="um" data-i="' + esc(h.i || '') + '"' + (h.um ? ' checked' : '') + '></td><td>' + when(h.t) + '</td><td><a href="' + esc(h.u || '#') + '" target="_blank" rel="noopener" title="' + esc(h.ti) + '">' + esc(h.c || h.ti) + '</a></td><td>' + esc(h.kind) + '</td><td class="num">' + fmtMoney(h.tot) + '</td><td class="num">' + (out ? '<s>' + fmtMoney(h.p) + '</s>' : fmtMoney(h.p)) + '</td><td>' + (h.dec ? ans[h.dec] || esc(h.dec) : '<span class="dim">none</span>') + '</td><td>' +
        (h.src === 'au' ? '<span class="dim">auction view</span>' : r ? esc(r[14]) + (r[19] && r[19] !== 'open' ? ' <span class="dim">(' + esc(r[19]) + ')</span>' : '') : '<span class="dim">older than 24 h</span>') + '</td></tr>'; }).join('') + '</tbody></table>';
  $('bov').classList.add('open');
}

function makeTable(id, cfg) {
  const el = k => $(k + '-' + id);
  // store: the name the column choices, widths, highlights and chip settings are saved under (hide-/order-/... in
  // localStorage) - a table built for the Favorites tab names its source tab here, so it shows that tab's columns as
  // set up there; root: the selector of the markup that holds this table's header row (default: the tab's panel)
  const store = cfg.store || id, root = cfg.root || ('#p-' + id);
  const t = {id, store, sortKey: null, sortDir: 1, view: [], shown: 0};
  const keyOf = cfg.key || (r => r[0]);                  // the sticky row highlight's key for a row (default: the card id)
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
        const v = cfg.get && cfg.get[k] ? cfg.get[k](r) : r[k];   // a chip may read a derived value (cfg.get), e.g. Under anchor % = -(vs anchor %)
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
      // the star header: favorites first (ascending), then favorites last; a row's star may belong to another source (f.s a function)
      const fv = k === 'fav' && cfg.fav ? r => (isFav(typeof cfg.fav.s === 'function' ? cfg.fav.s(r) : cfg.fav.s, cfg.fav.k(r)) ? 0 : 1)
               : k === 'plan' && cfg.plan ? r => (isPlanned(cfg.plan.k(r)) ? 0 : 1)   // the + header: planned listings first, then last
               : k === 'flag' && cfg.flag ? r => { const f = flagOf(cfg.flag.k(r)); return f && f.st !== 'unmarked' ? 0 : f ? 1 : 2; }   // the Flag header: yours first, the collector's next
               : k === 'state' && cfg.flag ? r => { const f = flagOf(cfg.flag.k(r)); return f && f.st !== 'unmarked' ? f.st : f ? '~' + (FG_KIND_NAME[f.k] || f.k) : null; } : null;
      t.view.sort((a, b) => {
        let x = fv ? fv(a) : a[k], y = fv ? fv(b) : b[k];
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
    for (let i = t.shown; i < end; i++) { const tr = document.createElement('tr'); tr.innerHTML = '<td class="rn">' + (i + 1) + '</td>' + (cfg.fav ? favCell(cfg.fav, t.view[i]) : '') + (cfg.plan ? planCell(cfg.plan, t.view[i]) : '') + (cfg.flag ? flagCells(cfg.flag, t.view[i]) : '') + cfg.row(t.view[i]); if (cfg.rowClass) { const c = cfg.rowClass(t.view[i]); if (c) tr.className = c; } tr.dataset.key = String(keyOf(t.view[i])); if (SEL.get(id) === tr.dataset.key) tr.classList.add('sel'); paintRow(tr); if (t.stampRow) t.stampRow(tr); frag.appendChild(tr); }
    el('rows').appendChild(frag); t.shown = end;
    el('more').hidden = t.shown >= t.view.length;
    el('more').textContent = 'Show more (' + (t.view.length - t.shown).toLocaleString('en-US') + ' left)';
  };
  // column eyes: every header cell (last header row) gets one; hidden columns collapse to a strip
  const headRow = document.querySelector(root + ' thead tr:last-child');
  { const tbl = el('rows').closest('table'); if (tbl) tbl.dataset.sel = id; }   // the sticky row highlight remembers this table under its id
  let hiddenCols = new Set();
  try { hiddenCols = new Set(JSON.parse(localStorage.getItem('hide-' + store) || '[]')); } catch (e) {}
  for (const ins of [].concat(cfg.inserted || [])) try {   // columns added (or removed, n < 0) since the choice was saved: keep it on the same columns
    const mark = 'cols-' + store + '-v' + ins.v;
    if (!localStorage.getItem(mark)) {
      if (ins.reset) {                                     // the column set was rebuilt: saved eyes, order, widths and highlights start over
        for (const key of ['hide-' + store, 'order-' + store, 'hl-' + store, 'width-' + store]) localStorage.removeItem(key);
        hiddenCols = new Set(); localStorage.setItem(mark, '1'); continue;
      }
      const shift = ci => ins.n < 0 ? (ci > ins.at ? ci + ins.n : ci) : (ci >= ins.at ? ci + ins.n : ci);
      const keep = ci => ins.n >= 0 || ci !== ins.at;
      hiddenCols = new Set([...hiddenCols].filter(keep).map(shift));
      localStorage.setItem('hide-' + store, JSON.stringify([...hiddenCols]));
      for (const key of ['order-' + store]) { const sv = JSON.parse(localStorage.getItem(key) || 'null'); if (Array.isArray(sv)) { const out = sv.filter(keep).map(shift); if (ins.n > 0) { const fresh = [...Array(ins.n).keys()].map(i => ins.at + i); out.splice(ins.at === 0 ? 0 : out.indexOf(ins.at - 1) + 1, 0, ...fresh); } localStorage.setItem(key, JSON.stringify(out)); } }   // a new column takes its natural place in a saved order
      for (const key of ['hl-' + store, 'width-' + store]) { const sv = JSON.parse(localStorage.getItem(key) || 'null'); if (sv && typeof sv === 'object') { const out = Array.isArray(sv) ? sv.filter(keep).map(shift) : Object.fromEntries(Object.entries(sv).filter(([k]) => keep(+k)).map(([k, v]) => [shift(+k), v])); localStorage.setItem(key, JSON.stringify(out)); } }
      localStorage.setItem(mark, '1');
    }
  } catch (e) {}
  if (cfg.compact && localStorage.getItem('hide-' + store) == null) {   // first visit (or a rebuilt set): the Compact view
    hiddenCols = new Set(cfg.compact); try { localStorage.setItem('hide-' + store, JSON.stringify([...hiddenCols])); } catch (e) {}
  }
  const EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C7 5 3 8.5 1.5 12 3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" fill="currentColor"/></svg>';
  const EYE_SHUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6c1.6 0 3 .3 4.3.9l-1.6 1.6A6 6 0 0 0 12 8c-4.4 0-7.2 3.2-8.1 4 .5.5 1.6 1.7 3.2 2.6l-1.5 1.5C3.4 14.7 2 12 2 12zm20 0s-3.5 6-10 6c-1.6 0-3-.3-4.3-.9l1.6-1.6c.8.3 1.7.5 2.7.5 4.4 0 7.2-3.2 8.1-4-.5-.5-1.6-1.7-3.2-2.6l1.5-1.5C20.6 9.3 22 12 22 12zM4 20 20 4l1.4 1.4L5.4 21.4z" fill="currentColor"/></svg>';
  // a hidden column is gone altogether, eye included (2026-10-13, Brett), so a band title above the headers (tr.grp,
  // eBay Catalog) must span only the columns still showing: its original span is kept in data-span
  const grpRow = document.querySelector(root + ' thead tr.grp');
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
    try { localStorage.setItem('hide-' + store, JSON.stringify([...hiddenCols])); } catch (e) {}
    paintHeads();
    el('rows').querySelectorAll('tr').forEach(tr => { const td = cellOf(tr, ci); if (td) td.classList.toggle('col-hidden', hiddenCols.has(ci)); });
    if (t.sizeRow) { const th = [...headRow.children].find(x => +x.dataset.ci === ci) || headRow.children[ci]; const w = (JSON.parse(localStorage.getItem('width-' + store) || '{}') || {})[ci]; if (th) { const on = w && !hiddenCols.has(ci); th.style.width = th.style.minWidth = th.style.maxWidth = on ? w + 'px' : ''; th.classList.toggle('sized', !!on); } el('rows').querySelectorAll('tr').forEach(tr => { const td = cellOf(tr, ci); if (td) { const on = w && !hiddenCols.has(ci); td.style.width = td.style.minWidth = td.style.maxWidth = on ? w + 'px' : ''; td.classList.toggle('sized', !!on); } }); }
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
  try { hlCols = new Set(JSON.parse(localStorage.getItem('hl-' + store) || '[]')); } catch (e) {}
  const paintHl = () => [...headRow.children].forEach((th, pos) => { const ci = th.dataset.ci != null ? +th.dataset.ci : pos; th.classList.toggle('hl', hlCols.has(ci)); const b = th.querySelector('.hlb'); if (b) b.title = hlCols.has(ci) ? 'Remove the highlight' : 'Highlight this column header'; });
  [...headRow.children].forEach((th, ci) => {
    const b = document.createElement('button'); b.className = 'hlb'; b.type = 'button'; b.setAttribute('aria-label', 'Highlight column');
    b.addEventListener('click', e => { e.stopPropagation(); if (hlCols.has(ci)) hlCols.delete(ci); else hlCols.add(ci); try { localStorage.setItem('hl-' + store, JSON.stringify([...hlCols])); } catch (x) {} paintHl(); });
    th.appendChild(b);
  });
  paintHl();
  /* Width (same day): drag the handle on a header's right edge; double-click it to let the column size itself again.
     The width is pinned on the header and every cell of the column (min and max too, so a column can be made
     narrower than its text, which is then clipped); remembered per tab under width-<tab>, by original index. */
  let widths = {};
  try { widths = JSON.parse(localStorage.getItem('width-' + store) || '{}') || {}; } catch (e) {}
  const sizeCell = (cell, ci) => { const w = widths[ci]; if (w && !hiddenCols.has(ci)) { cell.style.width = cell.style.minWidth = cell.style.maxWidth = w + 'px'; cell.classList.add('sized'); } else { cell.style.width = cell.style.minWidth = cell.style.maxWidth = ''; cell.classList.remove('sized'); } };
  const sizeRow = tr => { for (const ci of Object.keys(widths)) { const td = cellOf(tr, +ci); if (td) sizeCell(td, +ci); } };
  const sizeCol = ci => { const th = [...headRow.children].find(x => +x.dataset.ci === ci) || headRow.children[ci]; if (th) sizeCell(th, ci); el('rows').querySelectorAll('tr').forEach(tr => { const td = cellOf(tr, ci); if (td) sizeCell(td, ci); }); };
  const saveWidths = () => { try { if (Object.keys(widths).length) localStorage.setItem('width-' + store, JSON.stringify(widths)); else localStorage.removeItem('width-' + store); } catch (e) {} };
  t.sizeRow = sizeRow;
  t.resetLayout = () => { widths = {}; saveWidths(); hlCols = new Set(); try { localStorage.removeItem('hl-' + store); } catch (e) {} paintHl(); [...headRow.children].forEach((th, pos) => sizeCell(th, th.dataset.ci != null ? +th.dataset.ci : pos)); el('rows').querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, pos) => sizeCell(td, td.dataset.ci != null ? +td.dataset.ci : pos))); };
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
  const colLabel = th => { if (th.dataset.label) return th.dataset.label; const tn = [...th.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); return (tn ? tn.textContent : th.textContent).replace(/[\u21c5?]/g, '').trim() || ('Column ' + th.dataset.ci); };
  t.setHidden = set => {
    hiddenCols = new Set([...set].map(Number));
    try { localStorage.setItem('hide-' + store, JSON.stringify([...hiddenCols])); } catch (e) {}
    paintHeads();
    el('rows').querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, pos) => { td.classList.toggle('col-hidden', hiddenCols.has(td.dataset.ci != null ? +td.dataset.ci : pos)); }));
    [...headRow.children].forEach((th, pos) => sizeCell(th, th.dataset.ci != null ? +th.dataset.ci : pos));
    el('rows').querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, pos) => sizeCell(td, td.dataset.ci != null ? +td.dataset.ci : pos)));
  };
  const tabName = () => { if (cfg.name) return cfg.name; const b = document.querySelector('.tab[data-t="' + id + '"]'); return b ? b.textContent.trim() : id; };
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
  try { hiddenChips = new Set(JSON.parse(localStorage.getItem('chips-' + store) || '[]')); } catch (e) {}
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
    let sv = null; try { sv = JSON.parse(localStorage.getItem('chiporder-' + store) || 'null'); } catch (e) {}
    if (!Array.isArray(sv)) return;
    const want = sv.filter(k => natural.includes(k));
    natural.forEach((k, i) => { if (!want.includes(k)) want.splice(i ? want.indexOf(natural[i - 1]) + 1 : 0, 0, k); });   // a chip the saved order never saw goes after its natural neighbour
    placeChips(want);
  };
  const saveChipOrder = () => { const cur = chipAll().map(chipId); try { if (cur.every((k, i) => k === natural[i])) localStorage.removeItem('chiporder-' + store); else localStorage.setItem('chiporder-' + store, JSON.stringify(cur)); } catch (e) {} };
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
    const save = () => { try { if (hiddenChips.size) localStorage.setItem('chips-' + store, JSON.stringify([...hiddenChips])); else localStorage.removeItem('chips-' + store); } catch (e) {} paintChipsVis(); };
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
  try { const sv = JSON.parse(localStorage.getItem('order-' + store) || 'null'); if (Array.isArray(sv) && sv.length === nCols && [...sv].sort((a, b) => a - b).every((v, i) => v === i)) order = sv; } catch (e) {}
  [...headRow.children].forEach((th, ci) => { th.dataset.ci = ci; th.draggable = true; });
  const place = tr => { if (!order) return; const cells = [...tr.children]; if (cells.length !== nCols) return; order.forEach(ci => tr.appendChild(cells[ci])); };
  const placeAll = () => { place(headRow); el('rows').querySelectorAll('tr').forEach(place); };
  const saveOrder = () => { try { if (order) localStorage.setItem('order-' + store, JSON.stringify(order)); else localStorage.removeItem('order-' + store); } catch (e) {} };
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
  const ths = document.querySelectorAll(root + ' th[data-k]');
  ths.forEach(th => th.addEventListener('click', () => {
    const k = ['fav', 'plan', 'flag', 'state'].includes(th.dataset.k) ? th.dataset.k : +th.dataset.k;   // 'fav' / 'plan' / 'flag' / 'state': the star, the +, the flag and the State columns sort their rows first
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
    try { const sv = JSON.parse(localStorage.getItem('cond-' + store) || 'null'); if (sv) conds.forEach(c => { c.checked = sv.includes(c.id); }); } catch (e) {}
    conds.forEach(c => c.addEventListener('input', () => {
      try { localStorage.setItem('cond-' + store, JSON.stringify(conds.filter(x => x.checked).map(x => x.id))); } catch (e) {}
      $('condchip').classList.toggle('on', conds.some(x => !x.checked)); t.apply();
    }));
    $('condchip').classList.toggle('on', conds.some(x => !x.checked));
  }
  const stats = [...document.querySelectorAll('#ranges-' + id + ' #statchip input')];
  if (stats.length) {
    try { const sv = JSON.parse(localStorage.getItem('stat-' + store) || 'null'); if (sv) stats.forEach(c => { c.checked = sv.includes(c.id); }); } catch (e) {}
    stats.forEach(c => c.addEventListener('input', () => {
      try { localStorage.setItem('stat-' + store, JSON.stringify(stats.filter(x => x.checked).map(x => x.id))); } catch (e) {}
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
    conds.forEach(c => { c.checked = true; }); if (conds.length) { $('condchip').classList.remove('on'); try { localStorage.removeItem('cond-' + store); } catch (e) {} }
    stats.forEach(c => { c.checked = true; }); if (stats.length) { $('statchip').classList.remove('on'); try { localStorage.removeItem('stat-' + store); } catch (e) {} }
    if (sus) { sus.checked = false; $('suschip').classList.remove('on'); }
    if (t.paintChipsVis) setTimeout(t.paintChipsVis, 0);   // a hidden chip stays switched off
    if (mm) { mm.checked = false; $('mmchip').classList.remove('on'); }
    if (ld) { ld.checked = false; $('leadchip').classList.remove('on'); }
    t.apply();
  });
  sel.addEventListener('change', t.apply);
  el('more').addEventListener('click', t.renderMore);
  /* Two tables can share one store (a tab and its Favorites view): resync() takes up what the other one saved - which
     columns are hidden, their order, widths and highlights, which chips show - before this one is shown again. */
  t.resync = () => {
    try { hiddenCols = new Set(JSON.parse(localStorage.getItem('hide-' + store) || '[]')); } catch (e) {}
    try { hlCols = new Set(JSON.parse(localStorage.getItem('hl-' + store) || '[]')); } catch (e) {}
    try { widths = JSON.parse(localStorage.getItem('width-' + store) || '{}') || {}; } catch (e) { widths = {}; }
    try { const sv = JSON.parse(localStorage.getItem('order-' + store) || 'null'); order = Array.isArray(sv) && sv.length === nCols && [...sv].sort((a, b) => a - b).every((v, i) => v === i) ? sv : null; } catch (e) { order = null; }
    try { hiddenChips = new Set(JSON.parse(localStorage.getItem('chips-' + store) || '[]')); } catch (e) {}
    paintHeads(); paintHl(); paintChipsVis(); loadChipOrder();
    const want = order || [...Array(nCols).keys()], heads = [...headRow.children];
    want.forEach(ci => { const th = heads.find(x => +x.dataset.ci === ci); if (th) headRow.appendChild(th); });
    [...headRow.children].forEach(th => sizeCell(th, +th.dataset.ci));
  };
  t.apply();
  return t;
}
/* ---------------- The Flags archive (2026-10-25, Brett) ----------------
   "the removal of the listings that exceed the difference must be stored in a button ... where i can see the same
   columns as the popup / ebay raw data tab, that way i can review them, to see why their %PC was so off ... a column
   that marks their state ... a description box where i can type in my reasoning ... stored for permanent archive".
   The collector files every price anomaly (collector.flags_update): the listings of a card whose eBay anchor and
   PriceCharting price are 30%+ apart (kind gap - the card is HELD from buys and hits meanwhile), a listing under 40% /
   over 300% of PriceCharting (pclow / pchigh), a listing under 45% of the anchor (review); only listings whose
   condition is known; newest first. live/flags.bin carries them (10-minute buckets, at once after a mark). Here: the
   held cards with a card verdict (releases the hold for 30 days), chips by state and kind with counts, a day filter,
   the Raw Data columns (store 'fg') with State and Note first, Review (its Flag section marks the listing: state +
   note), a CSV of what is shown. A mark echoes (FLAGM / GAPM) until live.alert.flag_n.t confirms it. */
const FG = {file: null, loaded: 0, rows: [], state: 'all', kind: 'all', days: 0, map: new Map(), counts: null};
const FLAGM = {}, GAPM = {};                       // item id / card id -> {state, note, t}: marks echoed until the collector confirms
const FG_KIND_NAME = {gap: 'PC gap', pclow: 'too cheap vs PC', pchigh: 'too high vs PC', review: 'under 45% of the anchor', manual: 'your flag'};
const FLAG_REASONS = ['set mismatch', 'name mismatch', 'condition', 'fraud', 'unknown'];   // a listing's reasons (the Flag column, Review's Flag section, the phone's No)
const FG_STATES = ['unmarked'].concat(FLAG_REASONS);
const FG_CARD_STATES = ['unmarked', 'pc inaccuracy', 'pc fine'];                              // a card's verdict (the held strip): PriceCharting is wrong for the card, or right
const FG_CARD_WORDS = {unmarked: 'no verdict yet', 'pc inaccuracy': 'PC inaccuracy — PriceCharting is wrong for this card: release it', 'pc fine': 'PC is right — the sales behind the anchor are the problem: keep it held, mark them'};
const FG_VERDICTS = new Set(['PC gap', 'mismatch: too cheap', 'mismatch: too high', 'review']);
const fgStateOf = e => (FLAGM[e.i] && FLAGM[e.i].state) || e.state || 'unmarked';
const fgNoteOf = e => FLAGM[e.i] ? FLAGM[e.i].note || '' : (e.note || '');
/* The Flag column (2026-10-25, Brett: "there should be a column next to the (+) column, called 'flag', and each cell
   has a flag icon that i can toggle on or off ... the listing does not disappear, but the flag icon turns red, and
   the listing will appear in the flags button ... i should not receive any hits for flagged listings ... a state
   column ... 'No Flag' ... a number, specifying what number of the same pokemon card has received that same flag
   state"). Every listing table (Raw Data and its auctions view, Favorites, the card popup, the Flags archive, the
   Planning view) carries two cells after +: the flag - grey = none, amber = the collector's own flag (PC gap, too
   cheap / too high vs PC), red = his - and the State. A grey or amber flag opens a small reason menu (flagPop); a red
   one takes the flag off with one click. A flagged listing stays on Raw Data, counts in nothing (no supply, no
   anchor, no hit: the collector's rec["fl"], mirrored here by flaggedBy in verdictOf / fcCopyOk / fclOk / plRows), and
   sits in the Flags archive; a set / name mismatch is also the "not the same card" answer. The live file carries the
   map (live.alert.fl: item id -> [kind, state, card id]); his own marks echo through FLAGM until the collector
   confirms them (flag_n.t). */
function flagOf(iid) {                                   // {k: the collector's kind (null = none, 'manual' = his), st: his state ('unmarked' = none), c: card id}
  const m = FLAGM[iid], e = LIVE.data && LIVE.data.alert && LIVE.data.alert.fl ? LIVE.data.alert.fl[iid] : null;
  if (!m && !e) return null;
  return {k: e ? e[0] : 'manual', st: m ? m.state : (e[1] || 'unmarked'), c: e && e[2] != null ? e[2] : (m && m.c != null ? m.c : null)};
}
const flaggedBy = iid => { const f = iid == null ? null : flagOf(iid); return f && f.st !== 'unmarked' ? f.st : null; };
let FL_COUNTS = null;                                    // card id -> {state: n}: how many listings of the card carry each reason (the State cell's figure)
function flCounts() {
  if (FL_COUNTS) return FL_COUNTS;
  const out = {}, seen = {};
  const add = (c, st) => { if (c == null || !st || st === 'unmarked') return; const k = String(c); (out[k] = out[k] || {})[st] = (out[k][st] || 0) + 1; };
  for (const [iid, e] of Object.entries((LIVE.data && LIVE.data.alert && LIVE.data.alert.fl) || {})) { const m = FLAGM[iid]; add(e[2], m ? m.state : e[1]); seen[iid] = 1; }
  for (const [iid, m] of Object.entries(FLAGM)) if (!seen[iid]) add(m.c, m.state);
  return FL_COUNTS = out;
}
const FLAG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18h2v-7h10l-2-3.5L17 7H7V3z" fill="currentColor"/></svg>';
function flagCells(f, r) {                               // the two cells after +: the flag and the State
  const iid = f.k(r), cid = f.c ? f.c(r) : null;
  if (iid == null || iid === '') return '<td class="flc"></td><td class="fls"></td>';
  const fl = flagOf(iid), st = fl ? fl.st : 'unmarked', kind = fl && fl.k && fl.k !== 'manual' ? (FG_KIND_NAME[fl.k] || fl.k) : null;
  const n = st !== 'unmarked' && cid != null ? ((flCounts()[String(cid)] || {})[st] || 0) : 0;
  const title = st !== 'unmarked' ? 'Flagged by you: ' + st + (n > 1 ? ' (' + n + ' listings of this card carry it)' : '') + '. Click to take the flag off.' : kind ? 'The collector flagged it: ' + kind + '. Click to add your reason.' : 'Not flagged. Click to flag it with a reason: it stays here, leaves the plan, the supply and the hits.';
  return '<td class="flc"><button type="button" class="flb' + (st !== 'unmarked' ? ' on' : kind ? ' auto' : '') + '" data-i="' + esc(iid) + '" data-c="' + (cid == null ? '' : cid) + '" title="' + esc(title) + '">' + FLAG_SVG + '</button></td>' +
    '<td class="fls' + (st !== 'unmarked' ? ' on' : '') + '">' + (st !== 'unmarked' ? esc(st) + (n ? ' <span class="n" title="listings of this card with this reason">' + n + '</span>' : '') : kind ? '<span class="dim" title="the collector\u2019s own flag; no reason of yours yet">' + esc(kind) + '</span>' : '<span class="dim">No Flag</span>') + '</td>';
}
function flagPop(btn) {                                  // the reason menu under a grey / amber flag
  const iid = btn.dataset.i, cid = btn.dataset.c ? +btn.dataset.c : null, fl = flagOf(iid), kind = fl && fl.k && fl.k !== 'manual' ? (FG_KIND_NAME[fl.k] || fl.k) : null;
  let pop = $('flpop'); if (!pop) { pop = document.createElement('div'); pop.id = 'flpop'; document.body.appendChild(pop); }
  pop.innerHTML = '<div class="lab">Flag this listing' + (kind ? ' <span class="dim">(the collector\u2019s flag: ' + esc(kind) + ')</span>' : '') + '</div><div class="fbtns">' + FLAG_REASONS.map(st => '<button type="button" class="fbtn" data-s="' + st + '">' + st + '</button>').join('') + '</div>' +
    '<input type="text" id="flpop-note" placeholder="why (kept with the flag, for the analysis later)"><div class="fsave"><button type="button" class="tbtn" id="flpop-rv">Open Review</button><span class="dim">pick a reason to flag it: it stays on Raw Data, leaves the plan and the hits; a set / name mismatch also answers \u201cnot the same card\u201d, fraud makes the seller suspect</span></div>';
  pop.dataset.i = iid; pop.dataset.c = cid == null ? '' : cid;
  const rect = btn.getBoundingClientRect(), w = Math.min(440, window.innerWidth - 16);
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px'; pop.style.top = (rect.bottom + 4 > window.innerHeight - 180 ? Math.max(8, rect.top - 184) : rect.bottom + 4) + 'px'; pop.style.width = w + 'px';
  pop.classList.add('open');
  const fe = FG.map.get(iid); if (fe) $('flpop-note').value = fgNoteOf(fe);
}
const flagPopClose = () => { const pop = $('flpop'); if (pop) pop.classList.remove('open'); };
document.addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('button.flb') : null;
  if (b) {
    e.preventDefault(); e.stopPropagation();
    const iid = b.dataset.i;
    if (flaggedBy(iid)) { flagPopClose(); flagMark(iid, 'unmarked', '', b.dataset.c ? +b.dataset.c : null).catch(() => {}); } else flagPop(b);
    return;
  }
  const pop = $('flpop'); if (!pop || !pop.classList.contains('open')) return;
  if (pop.contains(e.target)) {
    const rb = e.target.closest('.fbtn'); if (rb) { const iid = pop.dataset.i, cid = pop.dataset.c ? +pop.dataset.c : null, note = $('flpop-note').value.trim(); flagPopClose(); flagMark(iid, rb.dataset.s, note, cid).catch(() => {}); return; }
    if (e.target.closest('#flpop-rv')) { const iid = pop.dataset.i; flagPopClose(); openReview(iid); }
    return;
  }
  flagPopClose();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') flagPopClose(); });
async function fgLoad(force) {                     // live/flags.bin, once per 10 minutes or when the collector filed or confirmed a mark
  const b = Math.floor(Date.now() / 600000), ft = (LIVE.data && LIVE.data.alert && LIVE.data.alert.flag_n && LIVE.data.alert.flag_n.t) || 0;
  const key = b + ':' + ft;
  if (!force && FG.loaded === key && FG.file) return;
  if (!LIVE_URL || !HKEY) return;
  try {
    const res = await fetch(LIVE_URL.replace(/[^/]+$/, 'flags.bin') + '?t=' + b + '_' + ft, {cache: 'no-store'});
    if (res.ok) { FG.file = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY); FG.loaded = key; }
  } catch (e) { /* the popup says so */ }
}
function fgRowOf(e) {                              // the Raw Data row for an archived listing: the live row while there is one, else a row from the snapshot
  let r = (LIVE.erMap && LIVE.erMap.get(e.i)) || (LIVE.favEr && LIVE.favEr.get(e.i)) || (LIVE.au || []).find(z => z[22] === e.i) || (LIVE.hh || []).find(z => z[22] === e.i) || (e.c != null ? flRowOf(e.i, e.c) : null);
  if (!r) {
    r = erStub({k: e.i, c: e.c, m: {ti: e.ti, u: e.u, p: e.tot}});
    const base = (e.c != null && idRow.get(+e.c)) || [];
    if (!base.length) { r[1] = e.n || ''; r[2] = e.s || ''; r[3] = e.num || ''; }
    r[5] = e.first ? Math.round((Date.now() - Date.parse(e.first)) / 36e4) / 10 : null; r[7] = e.it; r[8] = e.sh; r[9] = e.tot; r[10] = e.tot;
    r[11] = e.A == null ? null : e.A; r[12] = e.A && e.tot ? Math.round((e.tot / e.A - 1) * 1000) / 10 : null; r[14] = e.v || ''; r[15] = e.tc || 'UNK'; r[17] = e.fb; r[18] = e.pct;
    r[19] = e.st || 'unknown'; r[21] = (e.im || [])[0] || null; r[29] = e.tier || 'clean'; r[30] = RISK_RANK[e.tier] || 0; r[32] = (e.im || []).length || 99; r[34] = e.first || '';
    r[35] = e.pc == null ? null : e.pc; r[36] = e.vspc == null ? null : e.vspc; r[48] = e.ef === undefined ? null : e.ef; r[49] = r[48] && r[48].length ? r[48][0] || '' : ''; r[50] = r[48] && r[48].length ? rfText([r[48][1], r[48][2]]) : '';
    r[55] = e.ec === undefined ? null : e.ec; r[57] = e.bc || ''; r[58] = e.tc || 'UNK'; r.pics = (e.im || []).slice(1);
    r.um = reviewOf(e.i) === 0;
  }
  r.fg = e;
  return r;
}
function fgBuildRows() {
  const flags = (FG.file && FG.file.flags) || [];
  FG.map = new Map(flags.map(e => [e.i, e]));
  FG.rows = flags.map(fgRowOf);
  const c = {state: {}, kind: {}, reviewed: 0};
  flags.forEach(e => { const st = fgStateOf(e); c.state[st] = (c.state[st] || 0) + 1; c.kind[e.k] = (c.kind[e.k] || 0) + 1; if (st !== 'unmarked') c.reviewed++; });
  FG.counts = c;
}
const fgOk = r => { const e = r.fg; if (!e) return false;
  if (e.k === 'manual' && fgStateOf(e) === 'unmarked') return false;   // his own flag taken off: gone from here (the collector drops the entry)
  if (FG.state !== 'all' && fgStateOf(e) !== FG.state) return false;
  if (FG.kind !== 'all' && e.k !== FG.kind) return false;
  if (FG.days > 0 && Date.parse(e.t) < Date.now() - FG.days * 86400000) return false;
  return true; };
function fgCells(r) {                              // the Note cell (after the Flag and State cells every listing table carries): his reasoning, flagged when
  const e = r.fg, note = fgNoteOf(e);
  return '<td class="fgnote" title="' + esc((FG_KIND_NAME[e.k] || e.k) + ' · flagged ' + rvWhen(e.t) + (e.mt ? ' · marked ' + rvWhen(e.mt) : '')) + '">' + (note ? '<button type="button" class="fgnb" data-i="' + esc(e.i) + '" title="' + esc(note.slice(0, 200)) + '">💬</button>' : '<span class="dim">—</span>') + '</td>';
}
const FG_TABLE = Object.assign({}, TABLES.er, {rows: () => FG.rows, extra: fgOk, ranges: [], maxes: [], chips: [], defaults: {}, store: 'fg', root: '#fov', name: 'Flags', noun: 'listings', key: r => String(r[22]),
                                                row: r => fgCells(r) + (r.stub && r[0] == null ? unmRow(r) : TABLES.er.row(r)), rowClass: r => (r.um ? 'umm ' : '') + (r[29] === 'suspect' ? 'sus' : ''),
                                                fav: {s: 'er', k: r => r[22], c: r => r[0], m: r => favMetaEr(r)}, plan: TABLES.er.plan});
function fgBuild() {                               // the archive's header row: the Raw Data tab's (Flag and State included) with Note after State, before makeTable decorates the original
  const fov = $('fov'); if (!fov) return;
  const thead = document.querySelector('#p-er thead').cloneNode(true), tr = thead.querySelector('tr:last-child');
  const nt = document.createElement('th'); nt.textContent = 'Note'; nt.title = 'Your reasoning, typed with the flag (click to read it)';
  const after = tr.children[4] || tr.lastElementChild; after.insertAdjacentElement('afterend', nt);
  fov.querySelector('table').insertBefore(thead, fov.querySelector('tbody'));
}
function fgChips() {
  const c = FG.counts || {state: {}, kind: {}}, total = FG.rows.length;
  const chip = (group, k, name, n) => '<button type="button" class="fvchip' + ((group === 'state' ? FG.state : FG.kind) === k ? ' on' : '') + '" data-g="' + group + '" data-k="' + k + '">' + name + '<span class="n">' + n + '</span></button>';
  $('fg-chips').innerHTML = '<span class="lbl">State</span>' + chip('state', 'all', 'All', total) + FG_STATES.map(st => chip('state', st, st, c.state[st] || 0)).join('') +
    '<span class="lbl" style="margin-left:10px">Kind</span>' + chip('kind', 'all', 'All', total) + Object.keys(FG_KIND_NAME).map(k => chip('kind', k, FG_KIND_NAME[k], c.kind[k] || 0)).join('');
}
function fgHeld() {                                // the cards held now (and the ones released lately), with the card verdict
  const box = $('fg-held'); if (!box) return;
  const f = FG.file || {}, marks = Object.assign({}, f.gap_marks || {}, (LIVE.data && LIVE.data.alert && LIVE.data.alert.gap_marks) || {});
  for (const k in GAPM) marks[k] = Object.assign({}, marks[k] || {}, GAPM[k], {echo: 1});
  const held = (f.held || []).slice();
  const heldIds = new Set(held.map(h => String(h[0])));
  const released = Object.entries(marks).filter(([cid, m]) => !heldIds.has(cid) && !m.auto && m.t && Date.parse(m.t) > Date.now() - 30 * 86400000 && (m.state === 'pc inaccuracy' || m.state === 'pc stale'));
  const auto = Object.entries(marks).filter(([cid, m]) => m.auto && m.state === 'pc inaccuracy').sort((x, y) => ((y[1].sp || [])[1] || 0) - ((x[1].sp || [])[1] || 0));   // the detector's verdicts (2026-10-25), widest spread first
  const autoHtml = auto.length ? '<div class="fgauto"><div class="dim"><b>PriceCharting unreliable for ' + auto.length + ' card' + (auto.length === 1 ? '' : 's') + '</b> (automatic): the middle half of its last ungraded sales on PriceCharting spans ' + Math.round(FG_SPREAD_BAR * 100) + '%+ of their median (cards from $10), so its PriceCharting price is not trusted - ' + (auto.length === 1 ? 'it is' : 'they are') + ' never held for a PC gap and the per-listing PriceCharting rule stands down. Your own verdict on a card (PC is right) overrides it.</div>' +
    '<div class="fgautol" id="fgautol">' + auto.slice(0, FG.autoAll ? auto.length : 12).map(([cid, m]) => { const base = idRow.get(+cid) || [], sp = m.sp || []; return '<span class="fgauto1"><a href="#" class="fcl-open" data-id="' + cid + '">' + esc(base[1] || ('card ' + cid)) + '</a> <span class="dim">' + esc(String(base[2] || '').replace(/^Pokemon /, '')) + (sp.length ? ' \u00b7 \u00b1' + Math.round(sp[1] * 50) + '% around ' + fmtMoneyPlain(sp[2] / 100) + ' on ' + sp[0] + ' sales' : '') + '</span></span>'; }).join('') +
    (auto.length > 12 && !FG.autoAll ? ' <button type="button" class="tbtn" id="fgauto-more">+ ' + (auto.length - 12) + ' more</button>' : '') + '</div></div>' : '';
  if (!held.length && !released.length) { box.innerHTML = autoHtml + '<div class="fgheld dim">No card is held: every card with a backed eBay anchor sits within ' + FC_GAP_PCT + '% of its PriceCharting price.</div>'; return; }
  const sel = (cid, cur) => '<select class="fg-cstate" data-c="' + cid + '">' + FG_CARD_STATES.map(st => '<option value="' + st + '"' + (st === (cur === 'pc stale' ? 'pc inaccuracy' : cur) ? ' selected' : '') + '>' + FG_CARD_WORDS[st] + '</option>').join('') + '</select>';
  const rowOf = (cid, gap, A, An, pc, L, m, isHeld) => { const base = idRow.get(+cid) || [], mk = m || {};
    return '<div class="fgrow" data-c="' + cid + '"><span><a href="#" class="fcl-open" data-id="' + cid + '">' + esc(base[1] || ('card ' + cid)) + '</a> <span class="dim">' + esc(String(base[2] || '').replace(/^Pokemon /, '')) + '</span></span>' +
      '<span>' + (isHeld ? '<b class="gap">' + (gap > 0 ? '+' : '') + (gap == null ? '?' : gap.toFixed(0)) + '%</b>' : '<span class="dim">released</span>') + (A != null ? ' <span class="dim">eBay ' + fmtMoneyPlain(A) + ' (' + (An || 0) + ' sales) vs PC ' + fmtMoneyPlain(pc) + (L != null ? ' · floor ' + fmtMoneyPlain(L) : '') + '</span>' : '') + '</span>' +
      (mk.state ? '<span class="dim">verdict: <b>' + esc(mk.state === 'pc stale' ? 'pc inaccuracy' : mk.state) + '</b> ' + (mk.t ? rvWhen(mk.t) : '') + (mk.echo ? ' (sent)' : '') + '</span>' : '') +
      '<span class="lab">Card verdict</span>' + sel(cid, mk.state || 'unmarked') + '<input type="text" class="fg-cnote" data-c="' + cid + '" placeholder="why (kept with the verdict)" value="' + esc(mk.note || '') + '"><button type="button" class="tbtn fg-csave" data-c="' + cid + '">Save</button></div>'; };
  box.innerHTML = '<div class="fgheld"><div class="dim" style="margin-bottom:4px"><b>Held cards</b> — eBay’s sold median and PriceCharting’s price ' + FC_GAP_PCT + '%+ apart: no buys, no hits. Two ways out: click the card and flag the odd sales under “Sales behind the anchor” (the anchor recomputes without them and the hold lifts by itself), or the verdict <b>PC inaccuracy</b> (PriceCharting is wrong for this card: released for 30 days, and its PriceCharting rule stands down).</div>' +
    held.map(h => rowOf(h[0], h[1], h[2], h[3], h[4], h[5], marks[String(h[0])], true)).join('') + released.map(([cid, m]) => rowOf(cid, null, null, null, null, null, m, false)).join('') + '</div>' + autoHtml;
}
const FG_SPREAD_BAR = 0.7;                                // collector.PC_SPREAD_BAR: the automatic PC-inaccuracy bar (iqr / median of PriceCharting's last ungraded sales)
document.addEventListener('click', e => { const b = e.target.closest ? e.target.closest('#fgauto-more') : null; if (!b) return; FG.autoAll = true; fgHeld(); });
async function gapMark(cid, state, note) {
  const t = nextT(); GAPM[String(cid)] = {state, note, t: new Date(t).toISOString()};
  fgHeld(); fgBadge();
  try { await alSend({type: 'gapmark', t, c: cid, state, note}); }
  catch (e) { delete GAPM[String(cid)]; fgHeld(); fgBadge(); $('fgsub').insertAdjacentHTML('beforeend', ' <span class="down">The verdict could not be sent (' + esc(e.message) + ').</span>'); }
}
async function flagMark(iid, state, note, cid) {   // a listing's flag: the Flag column's menu, Review's Flag section; state 'unmarked' = the flag off
  const t = nextT(), was = flaggedBy(iid), prev = FLAGM[iid];
  FLAGM[iid] = {state, note: note || '', t, c: cid != null ? cid : (flagOf(iid) || {}).c}; FL_COUNTS = null;
  if (/mismatch/.test(state)) REVIEWS[iid] = {v: 0, t};                                       // the collector answers "not the same card" for it: hidden everywhere, filed in Mismatches
  else if (was && /mismatch/.test(was)) REVIEWS[iid] = {v: null, t};                          // ... and withdraws it when the mismatch flag comes off
  if (LIVE.data) rebuildLive();                                                               // the verdict, the supply, the popup and the plan follow at once
  try { await alSend({type: 'flag', t, i: iid, state, note: note || ''}); }
  catch (e) { if (prev) FLAGM[iid] = prev; else delete FLAGM[iid]; FL_COUNTS = null; if (/mismatch/.test(state)) delete REVIEWS[iid]; if (LIVE.data) rebuildLive(); throw e; }
  fgBadge();
  if ($('fov').classList.contains('open') && FG.file) { fgBuildRows(); fgChips(); fgSub(); tables.fg.resync(); tables.fg.apply(); }
}
function fgBadge() {                               // the Flags buttons' count: the cards HELD (each wants his verdict), less the verdicts echoed here until the collector confirms them; the listing counts on hover
  const fn = (LIVE.data && LIVE.data.alert && LIVE.data.alert.flag_n) || {};
  const held = Math.max(0, (fn.held || 0) - Object.values(GAPM).filter(m => m.state === 'pc inaccuracy').length);
  const unmarked = Math.max(0, (fn.unmarked || 0) - Object.values(FLAGM).filter(m => m.state !== 'unmarked').length);
  document.querySelectorAll('.nfg').forEach(el => { el.textContent = held; const b = el.closest('button'); if (b) b.title = held + ' card' + (held === 1 ? '' : 's') + ' held for a PC gap (no buys, no hits until your verdict) \u00b7 ' + (fn.total || 0) + ' listing' + (fn.total === 1 ? '' : 's') + ' in the archive, ' + unmarked + ' unmarked'; });
}
function fgSub() {
  const c = FG.counts || {state: {}}, held = (FG.file && FG.file.held) || [];
  $('fgsub').textContent = FG.rows.length + ' listing' + (FG.rows.length === 1 ? '' : 's') + ' flagged, ' + (c.state.unmarked || 0) + ' unmarked · ' + held.length + ' card' + (held.length === 1 ? '' : 's') + ' held · newest first · click a State cell to mark a listing (Review opens with its Flag section), the note icon to read your reasoning · as of ' + ageText(FG.file.t);
}
function reviewFlagHtml(e) {                       // the Review screen's Flag section (2026-10-25): why it was flagged, Brett's state and note - on every listing
  const st = fgStateOf(e), note = fgNoteOf(e), auto = e.k && e.k !== 'manual', kind = auto ? (FG_KIND_NAME[e.k] || e.k) : '';
  return '<div class="rvflag' + (st === 'unmarked' && !auto ? ' off' : '') + '"><span class="lab">' + (auto ? (e.virtual ? 'Flagged by the collector · ' : 'Flagged ' + rvWhen(e.t) + ' · ') + esc(kind) : st !== 'unmarked' ? 'Flagged by you' + (e.mt ? ' ' + rvWhen(e.mt) : '') : 'Flag') + '</span>' +
    '<div>' + (!auto ? (st !== 'unmarked' ? 'This listing counts in nothing: no supply, no anchor, no hit. It stays on the Raw Data tab and sits in Flags.' : 'Not flagged. A flag keeps the listing out of the plan, the supply and the hits; it stays on the Raw Data tab and goes to Flags with your reason.') : e.virtual ? 'The collector flagged it (' + esc(kind) + '); the archive\u2019s details load in a moment.' : e.k === 'gap' ? 'eBay’s sold median ' + fmtMoneyPlain(e.A) + ' (' + (e.An || 0) + ' sales) against PriceCharting ' + fmtMoneyPlain(e.pc) + ': <b>' + (e.gap > 0 ? '+' : '') + (e.gap == null ? '?' : e.gap.toFixed(0)) + '%</b>' + (e.st === 'sold' ? ' · this is one of the sales behind the anchor' : ' · the card is held until you give it a verdict in Flags') :
      e.k === 'review' ? 'listed at ' + fmtMoneyPlain(e.tot) + ', under 45% of the anchor ' + fmtMoneyPlain(e.A) : 'listed at ' + fmtMoneyPlain(e.tot) + ' against PriceCharting ' + fmtMoneyPlain(e.pc) + ' (' + (e.vspc > 0 ? '+' : '') + (e.vspc == null ? '?' : e.vspc.toFixed(0)) + '%)') + '</div>' +
    '<span class="lab" style="margin-top:6px">Why? Mark the listing</span><div class="fbtns">' + FG_STATES.filter(s => s !== 'unmarked').map(s => '<button type="button" class="fbtn' + (st === s ? ' on' : '') + '" data-s="' + s + '">' + s + '</button>').join('') + '</div>' +
    '<textarea id="rvf-note" placeholder="your reasoning (kept with the mark, for the analysis later)">' + esc(note) + '</textarea>' +
    '<div class="fsave"><button type="button" class="tbtn" id="rvf-save">' + (st !== 'unmarked' ? 'Save the change' : 'Flag it') + '</button>' + (st !== 'unmarked' ? '<button type="button" class="tbtn" id="rvf-off">Take the flag off</button>' : '') + '<span class="dim" id="rvf-msg">' + (st !== 'unmarked' ? 'flagged: ' + st + (e.mt ? ' ' + rvWhen(e.mt) : '') : 'a set / name mismatch also answers “not the same card”; fraud makes the listing and its seller suspect') + '</span></div></div>';
}
async function openFlags(kind) {
  if (kind) { FG.kind = kind; }
  $('fov').classList.add('open'); $('fgsub').textContent = 'loading…';
  await fgLoad();
  if (!FG.file) { $('fgsub').innerHTML = '<span class="down">The archive could not be loaded (live/flags.bin): the collector publishes it once it has filed something.</span>'; return; }
  fgBuildRows(); fgChips(); fgHeld(); fgSub();
  const t = tables.fg; t.resync(); t.apply();
}
function fgCsv() {                                 // what the table shows, with the marks and notes, as a CSV (Brett downloads it himself)
  const cols = ['flagged', 'kind', 'state', 'note', 'marked', 'card', 'set', 'number', 'rarity', 'finish', 'listing', 'url', 'pricecharting', 'total', 'item', 'ship', 'seller', 'ratings', 'positive_pct', 'condition_stated', 'ebay_condition', 'your_grade', 'anchor', 'anchor_sales', 'pc_price', 'floor', 'anchor_vs_pc_pct', 'listing_vs_pc_pct', 'status', 'verdict', 'tier', 'first_seen'];
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.join(',')].concat((tables.fg.view || []).map(r => { const e = r.fg; return [e.t, e.k, fgStateOf(e), fgNoteOf(e), e.mt, e.n, e.s, e.num, (e.rf || [])[0], (e.rf || [])[1], e.ti, e.u, e.c != null ? 'https://www.pricecharting.com/game/' + e.c : '', e.tot, e.it, e.sh, e.sl, e.fb, e.pct, e.tc, e.ec, e.bc, e.A, e.An, e.pc, e.L, e.gap, e.vspc, e.st, e.v, e.tier, e.first].map(q).join(','); }));
  const blob = new Blob(['﻿' + lines.join('\n')], {type: 'text/csv;charset=utf-8'}), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'flags-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
if ($('fov')) {
  $('fgclose').addEventListener('click', () => $('fov').classList.remove('open'));
  $('fov').addEventListener('click', e => { if (e.target === $('fov')) $('fov').classList.remove('open'); });
  $('fg-chips').addEventListener('click', e => { const b = e.target.closest('.fvchip'); if (!b) return; if (b.dataset.g === 'state') FG.state = b.dataset.k; else FG.kind = b.dataset.k; fgChips(); tables.fg.apply(); });
  $('fg-days').addEventListener('input', () => { const v = parseInt($('fg-days').value, 10); FG.days = isNaN(v) || v < 0 ? 0 : v; tables.fg.apply(); });
  $('fg-csv').addEventListener('click', fgCsv);
  $('fg-held').addEventListener('click', e => { const b = e.target.closest('button.fg-csave'); if (!b) return; const cid = b.dataset.c, st = $('fg-held').querySelector('select.fg-cstate[data-c="' + cid + '"]').value, note = $('fg-held').querySelector('input.fg-cnote[data-c="' + cid + '"]').value.trim(); gapMark(+cid, st, note); });
  ['fg-btn', 'fc-flags'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', () => openFlags()); });
  document.addEventListener('click', e => {
    const o = e.target.closest ? e.target.closest('a.fg-open') : null; if (o) { e.preventDefault(); openFlags(); return; }
    const nb = e.target.closest ? e.target.closest('button.fgnb') : null;
    if (nb && nb.dataset.i) { const en = FG.map.get(nb.dataset.i); if (!en) return; $('htitle').textContent = 'Your note · ' + String(en.ti || en.i).slice(0, 80); $('hbody').innerHTML = '<p class="dim">' + esc(fgStateOf(en)) + (en.mt ? ' · marked ' + rvWhen(en.mt) : '') + ' · ' + esc(FG_KIND_NAME[en.k] || en.k) + ', flagged ' + rvWhen(en.t) + '</p><p style="white-space:pre-wrap">' + esc(fgNoteOf(en) || '(no note)') + '</p>'; $('hov').classList.add('open'); }
  });
}

const tables = {};
fvBuild();                                                // the Favorites tab's copies of the header rows, before the eyes and handles go on the originals
fclBuild();                                               // ... and the Forecast tab's card popup's
fgBuild();                                                // ... and the Flags archive's (State and Note after the + column)
for (const id in TABLES) tables[id] = makeTable(id, TABLES[id]);
for (const id in FV_TABLES) tables[id] = makeTable(id, FV_TABLES[id]);
if ($('lov')) { tables.fcl = makeTable('fcl', FCL_TABLE); const fb = [...$('ranges-fcl').querySelectorAll('button.reset')].find(b => b.textContent === 'Filters\u2026'); if (fb) fb.remove(); }   // the popup has no filter chips, so no Filters... button
if ($('fov')) { tables.fg = makeTable('fg', FG_TABLE); const fb = [...$('ranges-fg').querySelectorAll('button.reset')].find(b => b.textContent === 'Filters\u2026'); if (fb) fb.remove(); }   // the Flags archive (2026-10-25): its chips are its own
periodBar('rv', () => tables.rv.apply());
periodBar('er', () => { hitSummary(); if (tables.er) tables.er.apply(); }, 'd');   // the period chooses the table's rows too; starts on today
tables.rv.apply();

// Only the row of column names stays in view (Brett: the tabs, boxes and filters staying put was too much). The page
// itself is the scroller - the tables sit in no box of their own - and the header row sticks to the top of the
// window. More rows load as the bottom of the page comes near.
window.addEventListener('scroll', () => {
  const p = document.querySelector('.panel:not([hidden])'), id = p && p.id === 'p-fv' ? FV.cur : p && p.id.slice(2), t = id && tables[id];
  if (t && !$('more-' + id).hidden && window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 900) t.renderMore();
}, {passive: true});

/* ---------------- Tabs ---------------- */
const TAB_HASH = {pc: '', ec: 'ebay-catalog', er: 'ebay-raw', fc: 'forecast', fh: 'forecast-history', al: 'alerts', rv: 'revenue', fv: 'favorites'};      // default (no hash) = PriceCharting
function showTab(id) {
  if (!TABLES[id] && id !== 'al' && id !== 'fc' && id !== 'fv' && id !== 'fh') id = 'pc';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === id));
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== 'p-' + id; });
  if (id === 'fv') fvRender();                           // the Favorites tab draws its view from the stars as they stand now
  if (id === 'fh') setTimeout(() => { if (FH.doc) fhRender(); else loadForecastHist(); }, 0);   // the Forecast history tab: the replay file is read on first sight (deferred: at load, with #forecast-history in the address, FH is declared further down)
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
    const [iid, t, cid, ti, u, first, item, ship, tot, tc, bo, fb, pct, ph, tier, sc, scr, idv, A, s, mb, p, roi, tax, kd, dec, um, out, old, img, imgs, ef, ec] = h;
    const base = idRow.get(cid) || [], cs = (live.cards || {})[String(cid)] || {}, pc = base[6] == null ? null : base[6];
    const marked = umOf(iid, um);
    const row = [cid, base[1] || ti || '', base[2] || '', base[3] || '', base[4] || '', first ? r1((now - Date.parse(first)) / 36e5) : null, ti || '', item, ship, tot,
      tot == null ? null : r2(tot + (item || 0) * (tax || 0) / 100), A, A && tot ? r1((tot / A - 1) * 100) : null, mb, marked ? 'mismatch: marked by you' : 'PASS', tc || 'UNK', !!bo, fb, pct,
      out === 'unknown' ? 'gone' : out, u, img || null, iid, null, p, roi, s, null, null, tier || 'clean', RISK_RANK[tier] || 0, sc || 0, ph == null ? 99 : ph, scr || [], first || t,
      pc, pc && tot ? r1((tot / pc - 1) * 100) : null, '', idv || '', [], base[PC_LIVE.pcm], base[PC_LIVE.km],
      null, null, null, null, i - 100000];                 // ahead of the live rows, newest alert first
    row[46] = mtOf(cid);
    const lv = LIVE.erMap && LIVE.erMap.get(iid); row[47] = rfText(pcRF(base)); histFacts(row, lv, ef, ec);   // eBay's facts: the live row's, else the hit's own record
    row[51] = base[PC_LIVE.kt]; row[52] = base[PC_LIVE.hits]; row[53] = base[PC_LIVE.hitpct]; row[54] = base[PC_LIVE.pcmm];
    row.hh = {t, kd, dec, old, out}; row.um = marked; row.lrn = ''; row.tw = null; row.pics = (imgs || []).slice(1);
    const bc = condOfBrett(iid); row[58] = row[15]; row[57] = bc || ''; if (bc) row[15] = bc;   // his grade from the photos over the seller's (2026-10-25)
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
    rows = mine.concat(all.filter(r => r[14] === 'PASS' && !ids.has(r[22]) && inP(r)));   // (a row he marked as not the same card is out of every tab since 2026-10-25: the Mismatches list keeps it)
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
/* The second question (2026-10-25, Brett: "i want to see the ebay sellers reported condition, and then in the next
   question, i can answer the condition based on my thoughts of the images, because my judgement of the condition may
   be different from the sellers"): his own grade from the photos, NM / LP / MP / HP / DMG, given on the Review popup
   (type 'cond' on the channel) or on the phone's check screen (nm / lp / "worse than LP"). It replaces the seller's
   in every figure - here (erowOf puts it in the condition column and the verdict) and in the collector (cond_set:
   the book, the floor, the alerts). CONDS echoes an answer until live.alert.cond_t confirms it; live.alert.conds
   carries them all. */
const CONDS = {};                                  // item id -> {v: 'NM'.. | null withdrawn, t}
const condOfBrett = iid => iid in CONDS ? CONDS[iid].v : ((LIVE.data && LIVE.data.alert && LIVE.data.alert.conds) || {})[iid] || null;
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
// Review on a listing whose eBay record is incomplete: ask the collector for one full look now (the main channel, read
// once a cycle), then watch the reply topic for its answer and put what it read into the rows and the open popup
const READ_ASKED = {}, READ_DONE = {};
function readAsk(iid) {
  if (!iid || !HKEY) return false;
  if (READ_ASKED[iid] > Date.now() - 300000) return true;
  const t = nextT(); READ_ASKED[iid] = t;
  alSend({type: 'read', t, i: iid}).then(() => readWait(iid, t)).catch(() => { delete READ_ASKED[iid]; });
  return true;
}
async function readWait(iid, t0) {
  const ch = await alChannel(), enc = new TextEncoder();
  const hexBytes = h => new Uint8Array((String(h).match(/../g) || []).map(x => parseInt(x, 16)));
  let since = Math.floor(t0 / 1000) - 5;
  for (let i = 0; i < 40; i++) {                   // the collector reads its requests once a minute: up to about three minutes
    await new Promise(r => setTimeout(r, 5000));
    if (!$('bov').classList.contains('open') || LIVE.rvItem !== iid) return;
    let lines = [];
    try { const r = await fetch('https://ntfy.sh/' + ch.topic + '-pcr/json?poll=1&since=' + since, {cache: 'no-store'}); if (r.ok) lines = (await r.text()).split('\n').filter(Boolean); } catch (e) { continue; }
    for (const line of lines) {
      try {
        const ev = JSON.parse(line); if (ev.event !== 'message') continue;
        since = ev.id;
        const env = JSON.parse(ev.message);
        if (!await crypto.subtle.verify('HMAC', ch.key, hexBytes(env.s), enc.encode(env.m))) continue;
        const msg = JSON.parse(env.m);
        if (msg.type !== 'read' || msg.i !== iid) continue;
        READ_DONE[iid] = msg.gone ? 'gone' : true;
        if (!msg.gone) applyRead(iid, msg);
        if ($('bov').classList.contains('open') && LIVE.rvItem === iid) openReview(iid);
        return;
      } catch (e) { continue; }
    }
  }
}
// what the collector read goes into the live data the rows are built from (the next live file carries it anyway)
function applyRead(iid, m) {
  if (!LIVE.data) return;
  const pics = m.imgs || [], tc = m.tc && m.tc !== 'UNK' ? m.tc : null;
  const x = (LIVE.data.live || []).find(z => z[0] === iid) || ((LIVE.data.favs || {}).rows || {})[iid];   // the 24-hour row, or a starred listing's
  if (x) { if (m.img) x[19] = m.img; x[33] = pics.slice(1); x[34] = m.ef === undefined ? null : m.ef; x[35] = m.ec || ''; if (tc) x[13] = tc; }
  const a = ((LIVE.data.alert || {}).au || []).find(z => z[0] === iid);
  if (a) { if (m.img) a[27] = m.img; if (pics.length) a[28] = pics; a[29] = m.ef === undefined ? null : m.ef; a[30] = m.ec || ''; if (tc) a[9] = tc; }
  const h = ((LIVE.data.alert || {}).hh || []).find(z => z[0] === iid);
  if (h) { if (m.img) h[29] = m.img; if (pics.length) h[30] = pics; h[31] = m.ef === undefined ? null : m.ef; h[32] = m.ec || ''; if (tc) h[9] = tc; }
  rebuildLive();
}
function openReview(iid) {
  // the row may be a live listing, an auction sent to the phone or a hit from the history - those two outlive the
  // 24-hour table, so the button failed on them until 2026-10-17 (Brett: "the review button does not work for auctions")
  const r = (LIVE.erMap && LIVE.erMap.get(iid)) || (LIVE.au || []).find(z => z[22] === iid) || (LIVE.hh || []).find(z => z[22] === iid) || (LIVE.favEr && LIVE.favEr.get(iid)) || (typeof FCL !== 'undefined' && (FCL.rows || []).find(z => z[22] === iid)) || (typeof FG !== 'undefined' && (FG.rows || []).find(z => z[22] === iid));   // ... or a row of the Forecast tab's popup, or the Flags archive's snapshot of a listing long gone (2026-10-25)
  if (!r) return;
  const x = (LIVE.data.live || []).find(z => z[0] === iid) || ((LIVE.data.favs || {}).rows || {})[iid] || ((LIVE.data.plan || {}).rows || {})[iid] || (typeof FCL !== 'undefined' && FCL.file && FCL.file.rows && (FCL.file.rows[String(r[0])] || []).find(z => z[0] === iid)) || [];
  const cs = (LIVE.dec || {})[String(r[0])] || {}, base = idRow.get(r[0]) || [];
  const big = u => String(u || '').replace(/s-l\d+\./, 's-l1600.');
  const pics = [r[21]].concat(x[33] && x[33].length ? x[33] : r.pics || []).filter(Boolean);
  const pcu = pcPicture(r[0]), pcPage = 'https://www.pricecharting.com/game/' + r[0];
  LIVE.rvCard = r[0]; LIVE.rvItem = iid;
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
  // an incomplete eBay side - no photo, facts never read, or n/s with eBay's condition field unread - is read now: the
  // collector does one full look at the listing (open, sold or long gone) and answers on the channel (readAsk, 2026-10-23)
  const incomplete = !pics.length || ef == null || condUnread(r);
  const reading = incomplete && !READ_DONE[iid] ? readAsk(iid) : false;
  const pcv = v => v ? '<b class="fit">' + esc(v) + '</b>' : '<b class="fit mute">unknown</b>';
  const ebv = (i, cmp) => ef == null ? '<b class="fit mute">not read</b>' : !ef.length || !ef[i] ? '<b class="fit mute">not stated</b>'
    : '<b class="fit' + (cmp === 'far' ? ' bad' : cmp === 'near' ? ' amber' : '') + '">' + esc(ef[i]) + '</b>';
  const trio = ['Set name', 'Rarity', 'Finish'].map((lab, i) => row('<span class="lab">' + lab + '</span>' + pcv(i ? p[i - 1] : String(r[2] || '').replace(/^Pokemon /, '')),
                                                                     '<span class="lab">' + lab + '</span>' + ebv(i, ef && ef[6 + i]))).join('');
  // the condition under the trio (2026-10-25): the seller's own (eBay's field, else the title), and Brett's grade from the photos if he has given one
  const ec = r[55] || '', bc = r[57] || '', sellerC = r[58] || r[15] || 'UNK';
  const condRow = row(fact('Condition \u00b7 seller', sellerC === 'UNK' ? '<span class="dim">' + (condUnread(r) ? 'not read yet' : 'not stated') + '</span>' : esc(sellerC), ec ? 'eBay\u2019s condition field: ' + esc(ec) : sellerC !== 'UNK' ? 'from the title' : condUnread(r) ? 'none in the title; eBay\u2019s condition field is being read now' : 'none in the title, none on the listing'),
                       fact('Condition \u00b7 you', bc ? esc(bc) : '<span class="dim">\u2014</span>', bc ? 'your grade from the photos; every figure uses it' : 'grade it below, from the photos'));
  const v = reviewOf(iid);
  $('btitle').textContent = r[1] + ' \u2014 ' + String(r[2] || '').replace('Pokemon ', '');
  $('bsub').innerHTML = favBtn('er', iid, r[0], favMetaEr(r), 'rvstar') + 'Is the card in the eBay photos the card PriceCharting shows? ' + (v === 1 ? '<b class="up">You said: same card.</b>' : v === 0 || r.um ? '<b class="down">You said: not the same.</b>' : '');
  const fl0 = (typeof FG !== 'undefined' && flagOf(iid)) || null;
  const fe = (typeof FG !== 'undefined' && FG.map.get(iid)) || {i: iid, k: fl0 ? fl0.k : null, state: fl0 ? fl0.st : 'unmarked', note: '', virtual: 1};   // the Flag section on every listing (2026-10-25): the archive's entry when there is one
  if (fe.virtual && typeof FG !== 'undefined' && (fl0 || FG_VERDICTS.has(r[14])) && !FG.file) fgLoad().then(() => { if (FG.map.has(iid) && $('bov').classList.contains('open') && LIVE.rvItem === iid) openReview(iid); });
  let h = reviewFlagHtml(fe) + '<div class="rvpair">' +
    '<div class="rvside"><h4>PriceCharting <a href="' + pcPage + '" target="_blank" rel="noopener">\u2197</a></h4>' +
      (pcu ? '<a href="' + pcPage + '" target="_blank" rel="noopener"><img class="rvpic" src="' + esc(pcu) + '" alt="PriceCharting picture: click to open their page"></a>'
           : '<div class="rvbox" data-pc="1"><a href="' + pcPage + '" target="_blank" rel="noopener">See the picture on PriceCharting</a><small>being fetched now \u2014 it appears here within a minute or two</small></div>') + '</div>' +
    '<div class="rvside"><h4><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener">eBay listing \u2197</a></h4>' +
      (pics.length ? '<a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener"><img class="rvpic" id="rvpic" src="' + esc(big(pics[0])) + '" alt="eBay photo: click to open the listing"></a>' +
        (pics.length > 1 ? '<div class="rvthumbs">' + pics.map((u, i) => '<img src="' + esc(u) + '" data-k="' + i + '"' + (i === 0 ? ' class="on"' : '') + ' alt="">').join('') + '</div>' : '')
       : '<div class="rvbox"><span class="dim">no photo on file</span></div>') + '</div></div>';
  h += '<div class="rvrows">' +
    row(fact('Set / card number', esc(r[3]) + (SET_TOTALS[r[2]] ? ' / ' + SET_TOTALS[r[2]] : '')), fact('Set / card number', m ? m[1] + ' / ' + m[2] : 'none in the title')) +
    trio + condRow +
    (mm && mm[0] > 0 ? row('', '<span class="lab">Mismatched before</span><b class="amber">' + (mm[2] ? mm[1] + ' of ' + mm[2] + ' alert' + (mm[2] === 1 ? '' : 's') : mm[0] + ' listing' + (mm[0] === 1 ? '' : 's')) + '</b><small>' + (mm[3] ? mm[0] + ' of ' + mm[3].toLocaleString('en-US') + ' listings matched to this card (' + (mm[0] / mm[3] * 100).toFixed(1) + '%)' : 'on this card') + '</small>') : '') +
    (variant || r[38] === 'conflict' ? row(variant ? '<span class="tag warn">' + esc(variant.toUpperCase()) + '</span><small>a special printing: check the photo shows it</small>' : '',
                                            r[38] === 'conflict' ? '<span class="tag bad">item specifics disagree</span><small>' + esc((r[39] || []).join('; ')) + '</small>' : '') : '') +
    row(fact('Ungraded price', fmtMoneyPlain(r[35])), fact('Total price', fmtMoneyPlain(allin), 'card ' + fmtMoneyPlain(r[7]) + ' + shipping ' + fmtMoneyPlain(r[8]) + (taxAmt > 0 ? ' + tax ' + fmtMoneyPlain(taxAmt) : ', no buy tax'))) +
    row(fact('Sales per month', r[40] == null ? '?' : r[40]), fact('Sold this month', r[41] == null ? '?' : r[41], cs.D == null ? '' : cs.D + ' days tracked')) +
    row('', fact('Seller', (r[17] == null ? '?' : Number(r[17]).toLocaleString('en-US')) + ' ratings', (r[18] != null ? r[18] + '% positive \u00b7 ' : '') + (r[32] === 99 ? '?' : r[32]) + ' photos')) +
    '<div class="rrow"><div><span class="lab">Title</span><small>' + esc(r[6]) + '</small></div><div><span class="lab">Verdict</span><b>' + esc(r[14]) + '</b></div></div></div>';
  h += reviewScamHtml(r) +
       '<div class="rvbtns"><button class="rvno" id="rv-no">Not the same card<small>leaves every tab; Mismatches keeps it, with Restore</small></button><button class="rvyes" id="rv-yes">Same card<small>a confirmed match</small></button></div>' +
       (v != null || r.um ? '<div class="rvundo"><button class="linkbtn" id="rv-undo">Withdraw my answer</button></div>' : '') +
       '<div class="rvcond"><span class="lab">What condition is it, from the photos?</span><span class="cbtns">' + ['NM', 'LP', 'MP', 'HP', 'DMG'].map(k => '<button type="button" class="cbtn' + (bc === k ? ' on' : '') + '" data-c="' + k + '" title="' + ({NM: 'near mint', LP: 'lightly played', MP: 'moderately played', HP: 'heavily played', DMG: 'damaged'})[k] + '">' + k + '</button>').join('') + (bc ? '<button type="button" class="linkbtn" id="rv-cclear">back to the seller\u2019s</button>' : '') + '</span>' +
         '<small>' + (bc ? 'Your grade stands in for the seller\u2019s (' + (sellerC === 'UNK' ? 'none stated' : esc(sellerC)) + ') in every figure.' : 'Your grade replaces the seller\u2019s in every figure: the condition column, the verdict, the book and the floor, the alerts.') + ' MP, HP and damaged copies are never a buy.</small></div>' +
       (reading ? '<div id="rvread" class="dim">eBay’s details for this listing are being read now (' + (!pics.length ? 'photos, ' : '') + 'condition, set and rarity) — they appear here within a minute or two.</div>'
                : READ_DONE[iid] === 'gone' ? '<div id="rvread" class="dim">eBay no longer has this listing, so nothing more can be read about it.</div>' : '') +
       '<div id="rvmsg" class="dim"></div>';
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
  const wb = $('rv-wbtn'); if (wb) wb.addEventListener('click', () => { const tab = $('rv-wtab'); tab.hidden = !tab.hidden; $('rv-wlist').hidden = !tab.hidden; wb.textContent = tab.hidden ? 'Warnings \u25be' : 'Warnings \u25b4'; });
  const grade = async val => {                     // the second question: his grade from the photos (null = back to the seller's)
    const t = Date.now(); CONDS[iid] = {v: val, t};
    $('rvmsg').textContent = 'Sending\u2026';
    try { await alSend({type: 'cond', t, i: iid, v: val}); }
    catch (e) { delete CONDS[iid]; $('rvmsg').innerHTML = '<span class="down">The grade could not be sent (' + esc(e.message) + ').</span>'; if (LIVE.data) rebuildLive(); return; }
    if (LIVE.data) rebuildLive();
    if ($('bov').classList.contains('open') && LIVE.rvItem === iid) openReview(iid);   // the popup shows the grade in its rows
  };
  $('bbody').querySelectorAll('.cbtn').forEach(b => b.addEventListener('click', () => grade(b.dataset.c)));
  const cc = $('rv-cclear'); if (cc) cc.addEventListener('click', () => grade(null));
  {                                                // the Flag section: pick a reason, type the reasoning, Flag it / Take the flag off
    let fst = fgStateOf(fe) === 'unmarked' ? null : fgStateOf(fe);
    $('bbody').querySelectorAll('.rvflag .fbtn').forEach(b => b.addEventListener('click', () => { fst = b.dataset.s; $('bbody').querySelectorAll('.rvflag .fbtn').forEach(x => x.classList.toggle('on', x === b)); }));
    $('rvf-save').addEventListener('click', async () => {
      const note = $('rvf-note').value.trim(), msg = $('rvf-msg');
      if (!fst) { msg.innerHTML = '<span class="down">Pick a reason first.</span>'; return; }
      msg.textContent = 'Sending\u2026';
      try { await flagMark(iid, fst, note, r[0]); msg.innerHTML = 'Saved: <b>' + esc(fst) + '</b>' + (/mismatch/.test(fst) ? ' \u2014 the listing leaves every tab (Mismatches has it, with Restore)' : fst === 'fraud' ? ' \u2014 the listing and its seller are suspect from the collector\u2019s next pass' : ' \u2014 out of the plan, the supply and the hits; still on Raw Data') + '.'; }
      catch (e) { msg.innerHTML = '<span class="down">The mark could not be sent (' + esc(e.message) + ').</span>'; }
    });
    const off = $('rvf-off'); if (off) off.addEventListener('click', async () => { const msg = $('rvf-msg'); msg.textContent = 'Sending\u2026'; try { await flagMark(iid, 'unmarked', '', r[0]); msg.textContent = 'The flag is off.'; } catch (e) { msg.innerHTML = '<span class="down">Could not be sent (' + esc(e.message) + ').</span>'; } });
  }
}

function verdictOf(x, cs, S) {
  // x = raw live row from the collector; cs = decided card stats. Same order as verdict() in the collector.
  const total = x[7], item = x[5];
  if (total == null) return ['no price', null, null];
  const allin = Math.round((total + (item || 0) * S.tax) * 100) / 100;
  if (umOf(x[0], x[31])) return ['mismatch: marked by you', allin, null];
  const flb = flaggedBy(x[0]); if (flb) return ['flagged: ' + flb, allin, null];   // his flag (2026-10-25): never a hit, still shown
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
  if (cs.gap_hold) return ['PC gap', allin, null];         // eBay's anchor and PriceCharting 30%+ apart: held until he reviews the card (Flags, 2026-10-25)
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
  const favT = (live.favs && live.favs.t) || 0;         // the collector has taken every star up to this time: its list stands, the local echoes go
  for (const k of Object.keys(FAVS)) if (favT >= FAVS[k].t) delete FAVS[k];
  favIndex();
  const planT = (live.plan && live.plan.t) || 0;         // the same for the plan's + clicks
  for (const k of Object.keys(PLANS)) if (planT >= PLANS[k].t) delete PLANS[k];
  planIndex();
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
  LIVE.ecMap = new Map(LIVE.ec.map(r => [r[0], r]));
  let passes = 0, hiddenImg = 0, hiddenSus = 0, tooCheap = 0, leads = 0, disagree = 0;
  live.live.forEach(x => {
    const base = idRow.get(x[1]); if (!base) return;
    const erow = erowOf(x, S, base, LIVE.dec[String(x[1])]), v = erow[14], tier = erow[29], nimg = erow[32];
    if (v === 'PASS') passes++;
    if (nimg < 2) hiddenImg++; else if (tier === 'suspect') hiddenSus++; else if (x[28] === 'low') tooCheap++; else if (v === 'LEAD') leads++;
    if (rfBad(erow)) disagree++;
    LIVE.er.push(erow);
  });
  $('nsus').textContent = hiddenSus; $('ncheap').textContent = tooCheap; $('nlead').textContent = leads; $('ndis').textContent = disagree;
  alRender();
  applyHelp(live.help);                                 // descriptions and READMEs he rewrote with the pencil
  const markT = (live.alert && live.alert.mark_t) || 0;  // the collector has taken every mark up to this time
  for (const k of Object.keys(MARKS)) if (markT >= MARKS[k].t) delete MARKS[k];
  const reviewT = (live.alert && live.alert.review_t) || 0;
  for (const k of Object.keys(REVIEWS)) if (reviewT >= REVIEWS[k].t) delete REVIEWS[k];
  const condT = (live.alert && live.alert.cond_t) || 0;
  for (const k of Object.keys(CONDS)) if (condT >= CONDS[k].t) delete CONDS[k];
  LIVE.erMap = new Map(LIVE.er.map(r => [r[22], r]));
  // starred listings that have left the 24-hour table: the collector builds their live rows (live.favs.rows), judged here like the rest
  LIVE.favEr = new Map();
  for (const [iid, x] of Object.entries((live.favs && live.favs.rows) || {})) { const base = idRow.get(x[1]); if (base && !LIVE.erMap.has(iid)) LIVE.favEr.set(iid, erowOf(x, S, base, LIVE.dec[String(x[1])])); }
  LIVE.hh = hhRows(live);
  LIVE.au = auRows(live); $('nau').textContent = LIVE.au.length;
  if (FC.doc) fcStampRows();                            // the Raw Data Forecast % column: the chance at each listing's own price
  $('nmm').textContent = ((live.alert && live.alert.wrong) || []).filter(w => !mmRestored(w[1])).length;
  const fn = (live.alert && live.alert.flag_n) || {};       // the Flags archive (2026-10-25): the buttons' count = unmarked listings; marks echoed until confirmed
  for (const k of Object.keys(FLAGM)) if ((fn.t || 0) >= FLAGM[k].t) delete FLAGM[k];
  for (const k of Object.keys(GAPM)) if ((fn.t || 0) >= Date.parse(GAPM[k].t)) delete GAPM[k];
  FL_COUNTS = null; AU_BY_CARD = null;
  fgBadge();
  if ($('fov') && $('fov').classList.contains('open') && FG.file) { fgBuildRows(); fgChips(); fgHeld(); fgSub(); tables.fg.resync(); tables.fg.apply(); }
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
  fvCounts(); if (!$('p-fv').hidden) fvRender();        // the Favorites tab follows the live data too
  planPaint();                                          // ... and the + buttons and the Planning view
  if ($('lov') && $('lov').classList.contains('open') && FCL.cid != null && tables.fcl) { FCL.rows = fclRowsFor(FCL.cid); FCL.at = fclPlanAt(FCL.cid, LIVE.dec && LIVE.dec[String(FCL.cid)]); fclModeRender(); tables.fcl.resync(); tables.fcl.apply(); }   // ... and the card popup, if one is open (a Review answered, a copy sold)
  if (!$('p-fh').hidden) fhRender();                     // ... and the Forecast history tab's live plans
  try { if (FC.doc) fcCompute(); else loadForecast(); } catch (e) { console.error('forecast', e); }   // the Forecast tab: eBay supply changed, or the model file is not in yet; never in the way of the live tabs
}
// one Raw Data row from a collector live row: rebuildLive() for the 24-hour table, and live.favs.rows for a starred
// listing that has left it (the Favorites tab). x = the collector's row (build_live in ebay_sweep.py); the verdict and
// the money columns are judged here, with the boxes at the top of the Raw Data tab.
function erowOf(x, S, base, cs) {
  const bc = condOfBrett(x[0]) || x[36] || null, sellerC = x[37] || x[13];   // Brett's own grade from the photos outranks the seller's (2026-10-25)
  if (bc && x[13] !== bc) { x = x.slice(); x[13] = bc; }
  const [v, allin, dd] = verdictOf(x, cs, S);
  const d = dd || listingDecide(x, cs, S), note = d.note;
  const profit = d.net != null && allin != null ? Math.round((d.net - allin) * 100) / 100 : null;
  const roi = profit != null && allin > 0 ? Math.round(profit / allin * 1000) / 10 : null;
  const status = x[17], tHours = status === 'open' ? x[3] : (x[21] != null ? x[21] : x[3]);
  const tier = x[23] || 'clean', nimg = x[22] == null ? 99 : x[22];
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
  erow[47] = rfText(pcRF(base)); erow[48] = x[34] === undefined ? null : x[34]; erow[55] = x[35] == null ? null : x[35];   // 55: eBay's condition words; null = the field was never read (2026-10-25)
  erow[49] = erow[48] && erow[48].length ? erow[48][0] || '' : ''; erow[50] = erow[48] && erow[48].length ? rfText([erow[48][1], erow[48][2]]) : '';
  erow[57] = bc || ''; erow[58] = sellerC || 'UNK';                          // 57 Brett's grade from the photos ('' = none), 58 the seller's own
  erow.um = x[0] in REVIEWS ? REVIEWS[x[0]].v === 0 : umOf(x[0], x[31]); erow.lrn = x[32] || ''; erow.tw = (cs && cs.tw) || null;
  return erow;
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
try { const sv = JSON.parse(localStorage.getItem('ebay-settings') || '{}'); if (sv.conf) $('conf').value = sv.conf; if (sv.win) $('win').value = sv.win; if (sv.margin != null && sv.v2) $('margin').value = sv.margin; if (sv.buytax != null) $('buytax').value = sv.buytax; if (sv.usecal != null) $('usecal').checked = sv.usecal; if (sv.hits != null) $('hits').checked = sv.hits; if (sv.fchits != null) $('fchits').checked = sv.fchits; } catch (e) {}
['conf', 'win', 'margin', 'buytax', 'usecal', 'hits', 'fchits'].forEach(id => $(id).addEventListener('input', () => {
  try { localStorage.setItem('ebay-settings', JSON.stringify({v2: 1, conf: $('conf').value, win: $('win').value, margin: $('margin').value, buytax: $('buytax').value, usecal: $('usecal').checked, hits: $('hits').checked, fchits: $('fchits').checked})); } catch (e) {}
  if (id === 'fchits') { tables.er.apply(); return; }    // the tick only filters: no need to re-derive the live tables
  rebuildLive();
}));

/* Book popup: the competing listings and recent sales behind a card's numbers */
function openBook(cid, iid) {                      // iid: the listing the popup was opened from (a Raw Data row) - marked in the book
  const c = LIVE.dec && LIVE.dec[String(cid)], base = idRow.get(cid);
  if (!c || !base) return;
  $('btitle').textContent = base[1];
  $('bsub').textContent = base[2] + ' · #' + base[3] + (iid ? ' · the listing you came from is marked' : '');
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
    let found = false;
    c.book.forEach((b, i) => {
      const mine = iid != null && String(b[0]) === String(iid); if (mine) found = true;
      h += '<tr class="' + (credIds.has(b[0]) ? '' : 'sus ') + (mine ? 'mine' : '') + '"' + (credIds.has(b[0]) ? '' : ' title="not a credible price-setter: thin seller, watch tier, far under the anchor, or sat too long"') + '><td>' + (i + 1) + (credIds.has(b[0]) ? '' : ' <span class="dim">·</span>') + (mine ? ' <b class="up">this one</b>' : '') + '</td><td class="num">' + fmtMoney(b[1]) + (b[5] ? ' <span class="dim">(' + fmtMoney(Math.round(b[1] * GATE_LIVE().boHaircut * 100) / 100) + ' ranked)</span>' : '') + '</td><td class="num">' + fmtMoney(b[2]) + '</td><td class="num">' + (b[3] === 0 ? 'free' : fmtMoney(b[3])) + '</td><td>' + (b[4] === 'UNK' ? '<span class="dim">n/s</span>' : b[4]) + '</td><td>' + (b[5] ? 'BO' : '—') + '</td><td class="num">' + fmtInt(b[6]) + (b[7] != null ? ' · ' + b[7].toFixed(1) + '%' : '') + '</td><td class="num">' + hrsTxt(b[8]) + '</td><td class="ttl"><a href="' + esc(b[9]) + '" target="_blank" rel="noopener">' + esc(b[10]) + '</a></td></tr>';
    });
    h += '</tbody></table>';
    if (iid != null && !found) h += '<p class="dim">The listing you came from is not among the copies the book ranks: it has closed, is not a comparable condition, or sits above the ones listed.</p>';
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
  else h += '<table><thead><tr><th></th><th>Title</th><th class="num">Total $</th><th class="num">Card price $</th><th class="num">Seller fb</th><th class="num">Score</th><th>Why</th></tr></thead><tbody>' +
    sus.map(r => '<tr><td class="favc">' + favBtn('er', r[22], r[0], favMetaEr(r), 'sm') + '</td><td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener">' + esc(r[6]) + '</a></td><td class="num">' + fmtMoney(r[9]) + '</td><td class="num">' + fmtMoney(r[11]) + '</td><td class="num">' + fmtInt(r[17]) + (r[18] != null ? ' · ' + r[18].toFixed(1) + '%' : '') + '</td><td class="num">' + r[31] + '</td><td>' + esc((r[33] || []).map(c => (sc.labels || {})[c] || c).join(' · ')) + '</td></tr>').join('') + '</tbody></table>';
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
const mmRestored = iid => iid in REVIEWS && REVIEWS[iid].v === null;   // restored on this page, before the collector's list catches up
async function restoreListing(iid) {               // Restore (2026-10-25, Brett): the answer "not the same card" was a mistake - the listing comes back to every tab
  if (!iid) return;
  const t = Date.now(); REVIEWS[iid] = {v: null, t}; MARKS[iid] = {v: 0, t};
  if (LIVE.data) rebuildLive();
  if ($('bov').classList.contains('open') && $('btitle').textContent === 'Mismatches') openMismatches();
  try { await alSend({type: 'review', t, i: iid, v: null}); }
  catch (e) { delete REVIEWS[iid]; delete MARKS[iid]; if (LIVE.data) rebuildLive(); const m = $('mm-msg'); if (m) m.innerHTML = '<span class="down">Restore could not be sent (' + esc(e.message) + ').</span>'; }
}
document.addEventListener('click', e => { const b = e.target && e.target.closest ? e.target.closest('button.mmrestore') : null; if (b && b.dataset.i) restoreListing(b.dataset.i); });
function openMismatches() {
  const A = (LIVE.data && LIVE.data.alert) || {}, W = (A.wrong || []).filter(w => !mmRestored(w[1])), MM = A.mm || {};
  const by = new Map();
  W.forEach(w => { const k = w[6] == null ? '?' + w[1] : String(w[6]); if (!by.has(k)) by.set(k, []); by.get(k).push(w); });
  const cards = [...by.entries()].map(([k, list]) => { const base = idRow.get(+k) || [], m = MM[k] || [list.length, 0, 0];
    return {k, id: base[0], name: base[1] || list[0][4] || 'Card not on record', set: String(base[2] || list[0][5] || '').replace('Pokemon ', ''), n: list.length, x: m[1], y: m[2], t: m[3] || 0, list}; })
    .sort((p, q) => q.n - p.n || (p.name < q.name ? -1 : 1));
  const when = t => new Date(t).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  $('btitle').textContent = 'Mismatches';
  $('bsub').textContent = W.length + ' listing' + (W.length === 1 ? '' : 's') + ' you marked as not the card ' + (W.length === 1 ? 'it was' : 'they were') + ' matched to, across ' + cards.length + ' card' + (cards.length === 1 ? '' : 's') + '. Most-mismatched first. Click a card to see its listings; each is out of every tab until you press Restore (an answer given by mistake).';
  $('bbody').innerHTML = '<input class="mmq" id="mm-q" type="search" placeholder="Search card or set\u2026"><div id="mm-msg" class="dim"></div><div id="mm-list"></div>';
  const draw = () => {
    const q = $('mm-q').value.trim().toLowerCase(), show = cards.filter(c => !q || (c.name + ' ' + c.set).toLowerCase().includes(q));
    $('mm-list').innerHTML = !cards.length ? '<p>None yet. Tick Mismatch on a Raw Data row, or answer "No, not the same card" on your phone.</p>' : !show.length ? '<p>No card matches that search.</p>' :
      '<table><thead><tr><th>PriceCharting card</th><th class="num">Mismatches</th><th>Of its matches</th><th>Of its alerts</th></tr></thead><tbody>' +
      show.map(c => '<tr class="mmr" data-k="' + esc(c.k) + '"><td>' + (c.id ? '<a href="https://www.pricecharting.com/game/' + c.id + '" target="_blank" rel="noopener">' + esc(c.name) + '</a>' : esc(c.name)) + (c.set ? ' <span class="dim">' + esc(c.set) + '</span>' : '') + '</td><td class="num"><b>' + c.n + '</b></td><td>' + (c.t ? c.n + ' of ' + c.t.toLocaleString('en-US') + ' listing' + (c.t === 1 ? '' : 's') + ' <span class="dim">(' + (c.n / c.t * 100).toFixed(1) + '%)</span>' : '<span class="dim">no matches on record</span>') + '</td><td>' + (c.y ? c.x + ' of ' + c.y + ' alert' + (c.y === 1 ? '' : 's') : '<span class="dim">no alerts counted yet</span>') + '</td></tr>' +
        '<tr class="mmd" data-k="' + esc(c.k) + '" hidden><td colspan="4"><table class="mmt"><thead><tr><th></th><th>Marked</th><th>Listing</th><th class="num">Total</th><th>How</th><th>Restore</th></tr></thead><tbody>' +
          c.list.map(w => '<tr><td class="favc">' + favBtn('er', w[1], w[6], {ti: String(w[2] || '').slice(0, 90), u: w[3] || null, p: w[8] == null ? null : w[8]}, 'sm') + '</td><td>' + when(w[0]) + '</td><td class="ttl"><a href="' + esc(w[3] || '#') + '" target="_blank" rel="noopener">' + esc(w[2] || w[1]) + '</a></td><td class="num">' + (w[8] != null ? fmtMoney(w[8]) : dash) + '</td>' +
            '<td>' + (w[7] ? esc(String(w[7]).replace('-drop', ', price drop').replace('-lead', ', lead').replace('-forecast', ', forecast')) : '<span class="dim">\u2014</span>') + (w[9] ? ' <span class="dim" title="A No on a watch or suspect listing may mean \u201cscam\u201d rather than \u201canother card\u201d, so the matcher does not learn a title from it">\u00b7 watch/suspect: no lesson for the matcher</span>' : '') + '</td>' +
            '<td><button type="button" class="tbtn mmrestore" data-i="' + esc(w[1]) + '" title="The answer was a mistake: the listing comes back to every tab and leaves this list">Restore</button></td></tr>').join('') + '</tbody></table></td></tr>').join('') + '</tbody></table>';
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
document.addEventListener('click', e => {           // the Trend / Book buttons wherever they sit: the eBay Catalog, the Raw Data tab (2026-10-24), the Favorites views
  const b = e.target.closest('.bbtn'); if (b) return openBook(+b.dataset.id, b.dataset.iid || null);
  const t = e.target.closest('.ebtn'); if (t) openTrendEbay(+t.dataset.id);
});
$('bclose').addEventListener('click', () => $('bov').classList.remove('open'));
$('bov').addEventListener('click', e => { if (e.target === $('bov')) $('bov').classList.remove('open'); });
$('unmatched-btn').addEventListener('click', () => {
  const u = (LIVE.data && LIVE.data.unmatched) || [];
  $('htitle').textContent = 'Unmatched titles (last 24 h)';
  $('hbody').innerHTML = '<p class="dim">Listings the title parser could not tie to one catalog card, with the reason. Useful for spotting patterns to teach it.</p>' +
    (u.length ? '<table style="min-width:0;width:100%;font-size:12px"><tbody>' + u.slice().reverse().map(x => '<tr><td class="favc">' + favBtn('um', x[1], null, {ti: String(x[2] || '').slice(0, 90), p: x[3], u: x[4], why: String(x[5] || '').slice(0, 120)}, 'sm') + '</td><td class="ttl"><a href="' + esc(x[4]) + '" target="_blank" rel="noopener">' + esc(x[2]) + '</a></td><td class="num">' + fmtMoney(x[3]) + '</td><td class="dim">' + esc(x[5]) + '</td></tr>').join('') + '</tbody></table>' : '<p>None.</p>');
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
  h += cell('Δ 30d', fmtPct(s.d30), s.days <= 30 ? 'needs 31 days (' + s.days + ' so far)' : 'vs 30 days ago');
  h += cell('Range 90d', pctPlain(s.pos, 0, false), s.lo != null ? 'low ' + fmtMoneyPlain(s.lo) + ' · high ' + fmtMoneyPlain(s.hi) : 'needs 60 days (' + s.days + ' so far)');
  h += cell('Volatility', pctPlain(s.vol, 2, false), 'typical daily move of the 7d median');
  h += cell('Volume drift 30d', s.vd == null ? '—' : (s.vd > 0 ? '+' : '') + s.vd + (s.vdp == null ? '' : ' (' + pctPlain(s.vdp) + ')'), s.days < 60 ? 'needs 60 days (' + s.days + ' so far)' : 'last 30 days vs the 30 before');
  h += cell('Slope 30d', pctPlain(s.ts), s.ts != null ? 'Theil–Sen · middle half ' + pctPlain(s.tsq1) + ' to ' + pctPlain(s.tsq3) + ' /mo' : 'needs 10 priced days spanning two weeks');
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
/* ---------------- Forecast tab (Brett, 2026-10-17: "I input my capital, you tell me what cards to buy, how many of
   each, my estimated range of net profit after I hold for a month, and a confidence %"; version 2 on 2026-10-24 from
   the research in data/research - "improve the predictive power of my forecast model ... can you just do it for me?
   and the build?") ----------------
   The model runs in the site workflow (forecast.py): every card priced $25+ with six sales in its last twelve
   PriceCharting months is RANKED by how far its price sits below its own 12-month mean (the reversal signal: the
   deepest decile beat the band by 6-10 points a quarter in every year 2022-2026, and nothing else survived the
   controls), the market regime is the sign of the trailing 3-month median move (rising markets keep rising 95% of
   the time), and forecast.bin (same key as the live file) carries the ranks, the regime and the chance tables - the
   realized gross returns by hold x regime x rank bucket, 2022 to the last complete month. The set's momentum, the
   gradient-boosted model and the stock-market extras of version 1 are gone (artifacts or no gain, E06/E11/E21/E22).
   This tab turns a rank into money with the same fee arithmetic as the eBay tabs:
   net per copy = buy x (1 + return) x (1 - fee) - fixed - label - supplies - buy x (1 - discount) x (1 + buy tax),
   where buy = max(PriceCharting's price, its 3-month average) (you cannot buy at a print that just dipped) and the
   return is drawn from the bucket's realized distribution. Quantities are capped by what eBay has for sale at a
   reasonable price (the card's book from the live file) and by the share-per-card cap; the portfolio range and
   P(net > 0) come from a Monte Carlo over the picks. "Record this forecast" sends the picks to the collector,
   which scores them with PriceCharting's prices when the hold is up (live.forecasts), so the record below says
   how the forecasts have done. The research behind it is in the README (Forecast tab) and CLAUDE.md. */
const FC = {doc: null, err: null, rows: [], picks: [], mc: null, loaded: 0, mode: 'fc'};   // mode: 'fc' Forecasting / 'pl' Planning (2026-10-24)
try { if (localStorage.getItem('fc-mode') === 'pl') FC.mode = 'pl'; } catch (e) {}
const FC_MIN_VOL12 = 6;                                  // a card needs six sales in its last twelve PriceCharting months
const FC_BO_HAIRCUT = 0.90;                              // a Best Offer copy counts at 90% of its ask (ebay_sweep.BO_HAIRCUT); an LP copy at its NM-equivalent (the card's lpd)
/* Supply (2026-10-25, Brett: "if it says 3, then it shows 3 listings, with the one closest to 20% under ... as 1 of the 3,
   and the remaining 2 listings at a price below"): the open copies in the collector's book whose effective price - a
   Best Offer ask at 90%, an LP copy at its NM-equivalent, the floor's own basis - is at or under the plan's price for
   the card, buy x (1 - discount). The cell says how many and the dearest of them; the card's popup opens on those same
   copies. forecast_math.supply_at is the same rule. */
function fcBookEff(b, c) {
  if (b[1] == null) return null;
  const lpd = ((c && c.lpd) || 0) / 100, e = b[1] * (b.length > 5 && b[5] ? FC_BO_HAIRCUT : 1);
  return b.length > 4 && b[4] === 'LP' && lpd < 1 ? e / (1 - lpd) : e;
}
const FC_SUP_DEFAULT = {conds: ['NM', 'LP', 'UNK'], nowatch: true, minfb: 0, q: false};
const FC_GAP_PCT = 30;                                   // eBay's anchor and PriceCharting this far apart (%) = a held card (ebay_sweep.GAP_HOLD_PCT)
function fcCopyOk(b, sup) {                              // does Supply count this book copy? (forecast_math.copy_ok) a copy whose condition is not read yet does only with the "?" switch (b[11] = 0); a flagged copy never
  sup = sup || FC_SUP_DEFAULT;
  if (flaggedBy(b[0])) return false;
  if (b.length > 11 && !b[11]) return !!sup.q;
  if (!(sup.conds || FC_SUP_DEFAULT.conds).includes(b.length > 4 ? b[4] : 'UNK')) return false;
  if ((sup.nowatch == null ? true : sup.nowatch) && b.length > 12 && (b[12] === 'watch' || b[12] === 'suspect')) return false;
  if ((sup.minfb || 0) > 0 && ((b.length > 6 ? b[6] : null) || 0) < sup.minfb) return false;
  return true;
}
function fcSupplyAt(c, price, sup) {                     // {n, dear: the dearest ask among them, cheapest: the cheapest ask among the copies that could count, ids, unread: copies at the price whose condition is not read yet}; null without a book
  const book = c && c.book; if (!book) return null;
  const under = book.filter(b => { const e = fcBookEff(b, c); return e != null && e <= price + 0.005; });
  const at = under.filter(b => fcCopyOk(b, sup)), unread = under.filter(b => b.length > 11 && !b[11]);
  const asks = book.filter(b => b[1] != null && fcCopyOk(b, sup)).map(b => b[1]);
  return {n: at.length, dear: at.length ? Math.max(...at.map(b => b[1])) : null, cheapest: asks.length ? Math.min(...asks) : null, ids: new Set(at.map(b => b[0])), unread: unread.length, unreadIds: unread.map(b => b[0])};
}
/* The auctions running on a card (2026-10-25, Brett: "there is an at your price, but maybe should another option for at
   your price auction ... 3 (up to $91.61) auction underneath it ... auctions shouldnt affect forecast numbers or
   modeling, its really just there for visibility and alerts"). live.au_open: the ~800 raw-single auctions ending
   soonest, read every 20 minutes, matched to a card by title (MP / HP titles left out); row = [item id, card id, bid,
   ship, bids, end, title, url, tcond, fb, pct, photos, img]. Nothing here enters Supply, the odds or the plan. */
let AU_BY_CARD = null;
function auByCard() {
  if (AU_BY_CARD) return AU_BY_CARD;
  const m = new Map(), now = Date.now();
  for (const a of ((LIVE.data && LIVE.data.au_open && LIVE.data.au_open.rows) || [])) { if (Date.parse(a[5]) <= now || flaggedBy(a[0])) continue; if (!m.has(a[1])) m.set(a[1], []); m.get(a[1]).push(a); }
  return AU_BY_CARD = m;
}
function fcAuctionsAt(cid, price, sup) {                 // {n, dear: the dearest bid + shipping among them, soon: the earliest end, rows} of the card's auctions at or under the price, on the Supply switches' conditions
  const rows = (auByCard().get(cid) || []).filter(a => a[2] + a[3] <= price + 0.005 && (sup.conds || ['NM', 'LP', 'UNK']).includes(a[8]) && (!(sup.minfb > 0) || (a[9] || 0) >= sup.minfb));
  return {n: rows.length, dear: rows.length ? Math.max(...rows.map(a => a[2] + a[3])) : null, soon: rows.length ? rows.map(a => a[5]).sort()[0] : null, rows};
}
const auLeft = end => { const m = Math.round((Date.parse(end) - Date.now()) / 60000); return m < 1 ? 'ending' : m < 60 ? m + ' min' : m < 48 * 60 ? (m / 60).toFixed(m < 600 ? 1 : 0) + ' h' : (m / 1440).toFixed(0) + ' d'; };
function fcCredWhy(r, c) {                               // why the floor would not count this copy (credible() in ebay_sweep); null when it would
  const flb = flaggedBy(r[22]); if (flb) return 'flagged by you: ' + flb;
  if (r.um) return 'not the same card, you said';
  if (r[29] === 'watch' || r[29] === 'suspect') return r[29] + ' listing';
  if (r[17] == null || r[17] < 50) return 'seller under 50 ratings';
  if (sellerBar(r[17], r[18]) != null) return 'seller feedback under the bar';
  if (!['NM', 'LP', 'UNK'].includes(r[15])) return 'condition ' + r[15];
  const lpd = ((c && c.lpd) || 0) / 100, eff = r[9] == null ? null : r[9] * (r[16] ? FC_BO_HAIRCUT : 1) / (r[15] === 'LP' && lpd < 1 ? 1 - lpd : 1);
  if (c && c.A != null && eff != null && eff < 0.75 * c.A) return 'more than 25% under the anchor';
  const lim = c && c.lam ? Math.min(7, Math.max(1, 1.6 / c.lam)) : null;
  if (lim != null && r[5] != null && r[5] / 24 > lim) return 'listed ' + Math.round(r[5] / 24) + ' days: buyers have passed on it';
  return null;
}
const fcBucket = pct => pct >= .9 ? 'top10' : pct >= .75 ? 'b90' : pct >= .5 ? 'b75' : 'b50';   // how far below its own 12-month mean the card sits, as a rank
const FC_QS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];   // the chance tables' quantile grid (forecast.QS)
const fcQs = () => (FC.doc && FC.doc.calib && FC.doc.calib.quantiles) || FC_QS;   // the model file's, else the standard one (the Forecast History tab runs its plans without the model file)
const FC_BUCKET_WORDS = {top10: 'deepest 10%', b90: 'top 25%', b75: 'upper half', b50: 'lower half'};
const fcRegimeWord = () => FC.doc && FC.doc.regime && ('up' in FC.doc.regime ? (FC.doc.regime.up ? 'up' : 'down') : (FC.doc.regime.strong ? 'strong' : 'other'));   // a version-1 file still reads
function fcTable(h, bucket) {                            // the realized-return quantile grid for (horizon, regime, bucket)
  const cal = FC.doc && FC.doc.calib; if (!cal) return null;
  return cal.tables[h + '|' + fcRegimeWord() + '|' + bucket] || cal.tables[h + '|all|all'] || null;
}
/* buy = what the copy costs on eBay (the credible floor, else the sold median, else PriceCharting's level); sell = what
   buyers actually pay for the card on eBay (the collector's sold median A; PriceCharting's level when the card has no
   anchor), so the sale is projected as sell x (1 + r) with the model's return applied to eBay's own level - the same
   arithmetic the collector scores a record with (A at maturity, else PriceCharting's price). PriceCharting alone would
   mislead both ways: a card PriceCharting prices at $161 that clears for $100 on eBay is not a 40% deal at $95, and a
   $77 card asking $170 is a loss, not a buy. A credible floor is never more than 25% under A (the collector's rule),
   so the built-in margin of a standard-price buy is at most that. */
function fcNet(buy, r, S, disc, sell = buy) {            // net profit per copy at a gross return r
  return sell * (1 + r) * (1 - S.fee) - S.fixed - S.shipOut - S.supplies - buy * (1 - disc) * (1 + S.tax);
}
function fcBreakEven(buy, S, disc, sell = buy) {         // the gross return at which the copy nets zero
  return (buy * (1 - disc) * (1 + S.tax) + S.fixed + S.shipOut + S.supplies) / (sell * (1 - S.fee)) - 1;
}
const FC_MIN_SALES = () => (LIVE.data && LIVE.data.gate && LIVE.data.gate.minSales) || 5;
/* The two guards (2026-10-23, Brett: "i like those two guards"). On the first live builds the tab's 80%+ chances came from
   cards whose sold median rested on two or three sales (Magikarp "sold" at $191 on two sales against PriceCharting's $83,
   with two $66-81 asks thrown out as "not credible" because they sat more than 25% under that median - the rule meant
   to filter junk was filtering the evidence that the median was wrong, then placing the "credible floor" a quarter
   under it). So: (1) a sold median counts only with the gate's own minimum of sales behind it (minSales, 5 in the
   window); a thinner card sells no higher than PriceCharting's level, capped by its floor; (2) the sale must undercut
   the cheapest competing credible copy - the one you buy leaves the market and the next ask is what you sell against.
   buy = the credible floor (what the copy costs), else the backed median, else PriceCharting; skip = the listing you
   would buy (its own ask is not competition): the floor copy for the plan, the listing itself for a Raw Data row. */
function fcLevels(c, pcBuy, skip) {
  const cred = (c && c.cred) || [], L = cred.length ? cred[0][1] : null;
  const n = (c && c.A_n) || 0, aOk = !!c && c.A != null && n >= FC_MIN_SALES();
  const buy = L != null ? L : aOk ? c.A : pcBuy, src = L != null ? 'eBay floor' : aOk ? 'eBay sold median' : 'PriceCharting';
  let sell = aOk ? c.A : L != null ? Math.min(pcBuy, L) : pcBuy, why = aOk ? 'A' : c && c.A != null ? 'thin' : 'pc';
  const comp = cred.find(e => e[0] !== (skip != null ? skip : (cred[0] || [])[0]));
  if (comp && comp[1] < sell) { sell = comp[1]; why = 'ask'; }
  const hold = !!(c && c.gap_hold);                       // the PC gap (2026-10-25): unreviewed, the sale is projected from the lower of the two levels
  if (hold && pcBuy != null && pcBuy < sell) { sell = pcBuy; why = 'gap'; }
  return {buy, sell, src, why, A: c && c.A != null ? c.A : null, An: n, comp: comp ? comp[1] : null, gap: c && c.gap != null ? c.gap : null, hold};
}
function fcSellNote(r) {                                 // the "sells" figure under a pick's price: where the sale is projected from, and which guard set it
  if (r.why === 'A') return r.sell !== r.pcBuy ? '<span title="eBay\u2019s sold median (' + r.An + ' sales): what buyers actually pay; the sale is projected from it">sells ' + fmtMoneyPlain(r.sell) + '</span>' : '';
  if (r.why === 'ask') return '<span class="fc-guard" title="Capped at the cheapest competing credible copy: the one you buy leaves the market and this is the ask you sell against' + (r.A != null ? ' (eBay\u2019s sold median is ' + fmtMoneyPlain(r.A) + (r.An < FC_MIN_SALES() ? ', on only ' + r.An + ' sale' + (r.An === 1 ? '' : 's') : ', ' + r.An + ' sales') + ')' : '') + '">sells ' + fmtMoneyPlain(r.sell) + ' <small>ask</small></span>';
  if (r.why === 'thin') return '<span class="fc-guard" title="eBay has only ' + r.An + ' sale' + (r.An === 1 ? '' : 's') + ' of this card in its window, too few to trust its median of ' + fmtMoneyPlain(r.A) + ', so the sale is projected from PriceCharting\u2019s level' + (r.sell < r.pcBuy ? ', capped by the floor' : '') + '">sells ' + fmtMoneyPlain(r.sell) + ' <small>thin</small></span>';
  if (r.why === 'gap') return '<span class="fc-guard" title="eBay\u2019s sold median (' + fmtMoneyPlain(r.A) + ', ' + r.An + ' sales) and PriceCharting (' + fmtMoneyPlain(r.pcBuy) + ') are ' + Math.abs(r.gap || 0).toFixed(0) + '% apart and the card is unreviewed: the sale is projected from the lower of the two">sells ' + fmtMoneyPlain(r.sell) + ' <small>PC gap</small></span>';
  return '';                                             // 'pc': no eBay sales at all - the PC figure beside it is the level
}
/* The chance for one listing bought at its own price (the Raw Data tab's Forecast % column and its "Forecast hits"
   tick; the collector applies the same test to the phone alerts): the card's rank bucket for the Forecast tab's hold,
   the listing's total as the buy (plus the buy tax), the sell level from fcLevels with this listing left out of the
   competition. null when the model has no score for the card. */
function fcListing(cid, total, iid, h, S) {
  const doc = FC.doc; if (!doc || !FC.ix || total == null || !(total > 0)) return null;
  const a = doc.cards[String(cid)]; if (!a) return null;
  const pct = a[FC.ix['pct' + h]]; if (pct == null) return null;
  const tab = fcTable(h, fcBucket(pct)); if (!tab) return null;
  const lv = fcLevels(LIVE.dec && LIVE.dec[String(cid)], a[FC.ix.buy], iid);
  return Math.round(fcDist(total, tab, S, 0, lv.sell).p * 1000) / 1000;
}
function fcStampRows() {                                 // r[56] on every listing-shaped row: the chance at the listing's price for the hold chosen on the Forecast tab
  const h = +$('fc-h').value || 3, S = settings();
  const stamp = r => { r[56] = r[0] == null ? null : fcListing(r[0], r[9], r[22], h, S); };
  (LIVE.er || []).forEach(stamp); (LIVE.au || []).forEach(stamp); (LIVE.hh || []).forEach(stamp); if (LIVE.favEr) LIVE.favEr.forEach(stamp);
}
const fcErOk = r => r[56] != null && r[56] >= (FC.inputs || fcInputs()).minp;
function fcErCell(r) {
  const bar = (FC.inputs || fcInputs()).minp, h = +$('fc-h').value || 3;
  if (r[56] == null) return '<td class="num"><span class="dim" title="' + (FC.doc ? 'no forecast for this card (the model scores cards priced $10 and up with a year of history)' : 'the model file is not loaded') + '">' + dash + '</span></td>';
  return '<td class="num" title="The Forecast tab\u2019s chance of a profit buying this copy at its price and holding ' + h + ' month' + (h > 1 ? 's' : '') + ' (its rank bucket, the sale projected from the card\u2019s sell level with the two guards); the bar is ' + Math.round(bar * 100) + '%">' + '<span class="' + (r[56] >= bar ? 'up' : '') + '">' + Math.round(r[56] * 100) + '%</span></td>';
}
function fcCdf(tab, r) {                                 // P(return <= r) from the quantile grid, tails extended linearly
  const qs = fcQs(), q = tab.q, n = q.length;
  if (r <= q[0]) return Math.max(0, qs[0] - qs[0] * (q[0] - r) / Math.max(1e-6, q[1] - q[0]));
  if (r >= q[n - 1]) return Math.min(1, qs[n - 1] + (1 - qs[n - 1]) * (r - q[n - 1]) / Math.max(1e-6, q[n - 1] - q[n - 2]));
  let i = 0; while (i < n - 1 && q[i + 1] < r) i++;
  return qs[i] + (qs[i + 1] - qs[i]) * (r - q[i]) / Math.max(1e-9, q[i + 1] - q[i]);
}
function fcDraw(tab, u) {                                // a return at probability u (inverse of the grid)
  const qs = fcQs(), q = tab.q, n = q.length;
  if (u <= qs[0]) return q[0] - (q[1] - q[0]) * (qs[0] - u) / qs[0];
  if (u >= qs[n - 1]) return q[n - 1] + (q[n - 1] - q[n - 2]) * (u - qs[n - 1]) / (1 - qs[n - 1]);
  let i = 0; while (i < n - 1 && qs[i + 1] < u) i++;
  return q[i] + (q[i + 1] - q[i]) * (u - qs[i]) / (qs[i + 1] - qs[i]);
}
const FC_P_CAP = 0.95;                                   // no stated chance above this: the measured ranges end at the 5th percentile
function fcDist(buy, tab, S, disc, sell = buy) {         // the copy's net at the 10th / 50th / 90th percentile, its mean, and P(net > 0)
  const qs = fcQs(), at = p => tab.q[qs.indexOf(p)];
  return {lo: fcNet(buy, at(0.1), S, disc, sell), med: fcNet(buy, at(0.5), S, disc, sell), hi: fcNet(buy, at(0.9), S, disc, sell), mean: fcNet(buy, tab.mean, S, disc, sell), p: Math.min(FC_P_CAP, 1 - fcCdf(tab, fcBreakEven(buy, S, disc, sell)))};
}
function fcInputs() {
  const n = (id, d) => { const v = parseFloat($(id).value); return isNaN(v) ? d : v; };
  return {cap: Math.max(0, n('fc-cap', 0)), h: +$('fc-h').value || 3, disc: Math.min(0.6, Math.max(0, n('fc-disc', 0) / 100)), pmin: Math.max(10, n('fc-pmin', 50)), pmax: Math.max(10, n('fc-pmax', 500)),
          share: Math.min(1, Math.max(0.05, n('fc-share', 20) / 100)), minp: Math.min(0.95, Math.max(0, n('fc-minp', 50) / 100)), copies: Math.min(5, Math.max(1, Math.round(n('fc-copies', 1)))),
          young: $('fc-young').checked, untracked: $('fc-untracked').checked, recent: $('fc-recent').checked, gate: $('fc-gate').checked,
          sup: {conds: [['fc-sup-nm', 'NM'], ['fc-sup-lp', 'LP'], ['fc-sup-ns', 'UNK']].filter(([id]) => $(id).checked).map(([, k]) => k), nowatch: $('fc-sup-nowatch').checked, minfb: Math.max(0, Math.round(n('fc-sup-minfb', 0))), q: $('fc-sup-q').checked}};   // which copies Supply counts (2026-10-25); q = the unread "?" copies too
}
/* The Forecasting view's filters (2026-10-25, Brett: "I would prefer to have some more filters in the forecast tab"):
   set, rarity, finish, the rank buckets, a copy / an auction at my price, not held, PriceCharting trusted, PC sales a
   year, eBay sales in 30 days. They narrow the candidates in fcCompute, so the money follows them (unlike the Planning
   view's filters, which only hide). Remembered in localStorage (fc-filt). */
const FC_F = {set: '', rar: '', fin: '', top10: true, b90: true, b75: true, b50: true, sup: false, au: false, noheld: false, nopcbad: false, vol: 0, k: 0};
try { Object.assign(FC_F, JSON.parse(localStorage.getItem('fc-filt') || '{}')); } catch (e) {}
function fcFiltPaint() {
  for (const k of ['top10', 'b90', 'b75', 'b50', 'sup', 'au', 'noheld', 'nopcbad']) { const e = $('fc-f-' + k); if (e) e.checked = !!FC_F[k]; }
  for (const k of ['set', 'rar', 'fin']) { const e = $('fc-f-' + k); if (e) e.value = FC_F[k] || ''; }
  for (const k of ['vol', 'k']) { const e = $('fc-f-' + k); if (e) e.value = FC_F[k] || 0; }
}
function fcFiltOptions() {                               // the selects' choices: what the scored cards have
  if (!FC.doc || !$('fc-f-set')) return;
  const sets = new Set(), rars = new Set(), fins = new Set();
  for (const cid in FC.doc.cards) { const b = idRow.get(+cid); if (!b) continue; if (b[2]) sets.add(b[2]); if (b[14]) rars.add(b[14]); if (b[15]) fins.add(b[15]); }
  const fill = (id, vals, any, strip) => { const e = $(id), cur = FC_F[id.replace('fc-f-', '')] || ''; e.innerHTML = '<option value="">' + any + '</option>' + [...vals].sort().map(v => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(strip ? String(v).replace(/^Pokemon /, '') : v) + '</option>').join(''); if (cur && !vals.has(cur)) e.value = ''; };
  fill('fc-f-set', sets, 'any set', true); fill('fc-f-rar', rars, 'any rarity'); fill('fc-f-fin', fins, 'any finish');
}
const fcFiltOn = () => !!(FC_F.set || FC_F.rar || FC_F.fin || !FC_F.top10 || !FC_F.b90 || !FC_F.b75 || !FC_F.b50 || FC_F.sup || FC_F.au || FC_F.noheld || FC_F.nopcbad || FC_F.vol > 0 || FC_F.k > 0);
if ($('fc-filt')) {
  fcFiltPaint();
  $('fc-filt').addEventListener('change', e => {
    const el = e.target.closest('input, select'); if (!el || !el.id.startsWith('fc-f-')) return;
    const k = el.id.replace('fc-f-', '');
    FC_F[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, Math.round(parseFloat(el.value) || 0)) : el.value;
    try { localStorage.setItem('fc-filt', JSON.stringify(FC_F)); } catch (x) {}
    fcCompute(); fcRenderPicks(); if (typeof plRender === 'function') plRender();
  });
  $('fc-f-reset').addEventListener('click', () => { Object.assign(FC_F, {set: '', rar: '', fin: '', top10: true, b90: true, b75: true, b50: true, sup: false, au: false, noheld: false, nopcbad: false, vol: 0, k: 0}); try { localStorage.removeItem('fc-filt'); } catch (x) {} fcFiltPaint(); fcCompute(); fcRenderPicks(); if (typeof plRender === 'function') plRender(); });
}
function fcCompute() {
  const doc = FC.doc; if (!doc) return;
  const S = settings(), I = fcInputs(), ix = FC.ix = Object.fromEntries(doc.cols.map((k, i) => [k, i]));
  const rows = [];
  let filtered = 0;
  const gmarks = (LIVE.data && LIVE.data.alert && LIVE.data.alert.gap_marks) || {};
  for (const cid in doc.cards) {
    const a = doc.cards[cid], base = idRow.get(+cid); if (!base) continue;
    if ((FC_F.set && base[2] !== FC_F.set) || (FC_F.rar && base[14] !== FC_F.rar) || (FC_F.fin && base[15] !== FC_F.fin)) { filtered++; continue; }
    const pcBuy = a[ix.buy], pct = a[ix['pct' + I.h]], age = a[ix.age], vol12 = a[ix.vol12] || 0;
    const c = LIVE.dec && LIVE.dec[cid], band = (LIVE.data && LIVE.data.band) || [50, 500];
    // the standard price: what a credible copy costs on eBay now (the card's credible floor, else its sold median),
    // else PriceCharting's level; the sale is projected from what buyers actually pay on eBay (the sold median A)
    // moved by the model's return, see fcNet. A card with a credible floor but no anchor (too few recent sales for
    // a median) cannot be assumed to sell above its cheapest credible competing ask, whatever PriceCharting prints
    // (a stale $256 there against $185 asks is not a 38% deal), so its sale is the lower of the two levels.
    const lv = fcLevels(c, pcBuy), buy = lv.buy, sell = lv.sell, src = lv.src;   // the two guards live in fcLevels
    if (!(buy >= I.pmin && buy <= I.pmax) || vol12 < FC_MIN_VOL12) continue;
    if (!I.young && !(age >= 24)) continue;
    let supply = null, ask = null, dear = null;          // the collector only follows listings inside its price band: outside it the supply is unknown
    let unread = 0, au = null;
    if (c && c.book && buy >= band[0] && buy <= band[1]) { const sa = fcSupplyAt(c, buy * (1 - I.disc), I.sup); supply = sa.n; ask = sa.cheapest; dear = sa.dear; unread = I.sup && I.sup.q ? 0 : sa.unread; }
    if (buy >= band[0] && buy <= band[1]) { const aa = fcAuctionsAt(+cid, buy * (1 - I.disc), I.sup || FC_SUP_DEFAULT); if (aa.n) au = {n: aa.n, dear: aa.dear, soon: aa.soon}; }   // visibility only (2026-10-25)
    if (supply == null && !I.untracked) continue;        // a card with no copy at the plan's price stays on the list: supply 0, nothing to buy today, the cell says so
    if (I.recent && c && !((c.k || 0) >= 1)) continue;   // no comparable eBay sale in the collector's 30-day window: nobody is buying it, whatever the supply
    const bucket = fcBucket(pct), tab = fcTable(I.h, bucket); if (!tab) continue;
    if (!FC_F[bucket] || (FC_F.sup && !(supply > 0)) || (FC_F.au && !au) || (FC_F.noheld && lv.hold) || (FC_F.vol > 0 && vol12 < FC_F.vol) || (FC_F.k > 0 && !(c && (c.k || 0) >= FC_F.k)) ||
        (FC_F.nopcbad && gmarks[cid] && gmarks[cid].auto && gmarks[cid].state === 'pc inaccuracy')) { filtered++; continue; }   // the filters (2026-10-25)
    const d = fcDist(buy, tab, S, I.disc, sell);
    rows.push(Object.assign({cid: +cid, name: base[1], set: base[2], price: a[ix.price], pcBuy, buy, sell, src, why: lv.why, A: lv.A, An: lv.An, k: c ? (c.k || 0) : null, ask, supply, dear, pct, pred: a[ix['pred' + I.h]], bucket, tab, age, vol: a[ix.vol], vol12,
                             mom1: a[ix.mom1], mom3: a[ix.mom3], mom12: a[ix.mom12], dd12: a[ix.dd12], setm: a[ix.set_mom1], dev12: ix.dev12 != null ? a[ix.dev12] : null, m12: ix.m12 != null ? a[ix.m12] : null,
                             be: fcBreakEven(buy, S, I.disc, sell), qty: 0, gap: lv.gap, hold: lv.hold ? 1 : 0, pcNow: c && c.pc != null ? c.pc : null, unread, au}, d));
  }
  rows.sort((x, y) => Math.round(y.p * 100) - Math.round(x.p * 100) || y.pct - x.pct);   // buy order: chance to the whole percent, then the rank (otherwise price alone breaks the tie)
  FC.filtered = filtered;
  const elig = rows.filter(r => r.p >= I.minp && !r.hold);   // a held card (the PC gap, unreviewed) gets no money
  const gated = I.gate && 'up' in doc.regime && !doc.regime.up;   // the gate: a falling market buys nothing (the research's one rule that removed every losing cycle)
  let left = I.cap;
  if (!gated) elig.forEach(r => {                        // greedy: best chance first, up to the share cap, the copies-per-card cap and the eBay supply
    const costEach = r.buy * (1 - I.disc) * (1 + S.tax);
    let q = Math.min(Math.floor(I.cap * I.share / costEach), I.copies);
    if (r.supply != null) q = Math.min(q, r.supply);
    q = Math.min(q, Math.floor(left / costEach));
    if (q > 0) { r.qty = q; left -= q * costEach; }
  });
  FC.rows = rows; FC.picks = elig.filter(r => r.qty > 0); FC.inputs = I; FC.S = S; FC.spent = I.cap - left; FC.gated = gated;
  FC.mc = fcMonteCarlo(FC.picks, S, I.disc);
  fcRenderRegime(); fcRenderPicks(); fcRenderRecords();
  if ($('lov') && $('lov').classList.contains('open') && FCL.cid != null && tables.fcl) { FCL.at = fclPlanAt(FCL.cid, LIVE.dec && LIVE.dec[String(FCL.cid)]); fclModeRender(); tables.fcl.apply(); }   // the popup's "at your price" follows the discount
  if (FC.mode === 'pl') plRender();                      // the Planning view prices its listings with the same inputs
  if (FC.fold) fcFoldApply();                            // the folded inputs' summary on the bar follows them
}
const FC_RHO = 0.5;                                      // share of each pick's variance that is the market's: cards fall together when it turns
function fcMonteCarlo(picks, S, disc, n = 3000) {        // the portfolio's net: a market draw shared by every pick plus each pick's own draw (Gaussian copula)
  if (!picks.length) return null;
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const Phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  const wm = Math.sqrt(FC_RHO), wo = Math.sqrt(1 - FC_RHO);
  const tot = new Float64Array(n);
  for (let k = 0; k < n; k++) { const zm = gauss(); let s = 0; picks.forEach(r => { const u = Math.min(0.9995, Math.max(0.0005, Phi(wm * zm + wo * gauss()))); s += r.qty * fcNet(r.buy, fcDraw(r.tab, u), S, disc, r.sell); }); tot[k] = s; }
  const a = Array.from(tot).sort((x, y) => x - y), at = p => a[Math.min(n - 1, Math.floor(p * n))];
  return {lo: at(0.1), q25: at(0.25), med: at(0.5), q75: at(0.75), hi: at(0.9), mean: a.reduce((s, v) => s + v, 0) / n, p: Math.min(FC_P_CAP, a.filter(v => v > 0).length / n)};
}
const fcPct = (v, nd = 0) => v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(nd) + '%';
const fcMoney = v => v == null || isNaN(v) ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0});
const fcMoney2 = v => v == null || isNaN(v) ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2);
const fcOrd = n => { const m = n % 100; return n + (m >= 11 && m <= 13 ? 'th' : m % 10 === 1 ? 'st' : m % 10 === 2 ? 'nd' : m % 10 === 3 ? 'rd' : 'th'); };   // 92nd, 100th, 61st
function fcRenderRegime() {
  const doc = FC.doc, R = doc.regime, I = FC.inputs || fcInputs(), S = FC.S || settings();
  const v2 = 'up' in R, up = v2 ? R.up : R.reg3 > 0, confirm = v2 ? R.confirm : R.reg1 > 0;
  const light = !up ? 'red' : confirm ? 'green' : 'amber';
  const head = !up ? 'Falling market — the gate is red.' : confirm ? 'Rising market — the gate is green.' : 'Rising market, but last month turned down — amber.';
  const line = (h, b) => { const t = fcTable(h, b); if (!t) return ''; const qs = doc.calib.quantiles, med = t.q[qs.indexOf(0.5)];
    const ref = 100, p0 = 1 - fcCdf(t, fcBreakEven(ref, S, 0)), p20 = 1 - fcCdf(t, fcBreakEven(ref, S, 0.2));
    return '<tr><td>' + h + '\u00a0mo</td><td class="num">' + fcPct(med) + '</td><td class="num">' + (t.p_up * 100).toFixed(0) + '%</td><td class="num">' + (p0 * 100).toFixed(0) + '%</td><td class="num">' + (p20 * 100).toFixed(0) + '%</td></tr>'; };
  $('fc-regime').innerHTML = '<p><b class="fc-light fc-light-' + light + '">' + head + '</b> The typical card moved <b>' + fcPct(R.reg3, 1) + ' a month</b> over the last three months (' + fcPct(R.reg1, 1) + ' last month' + (R.breadth3 != null ? '; ' + (R.breadth3 * 100).toFixed(0) + '% of cards up' : '') + '). ' +
    'When this three-month figure is positive the next quarter has been up 95% of the time; when negative, 12% — so ' + (up ? 'the plan may buy' : 'the plan buys nothing while \u201cBuy only when the market is rising\u201d is ticked') + '.</p>' +
    '<p class="dim">What the deepest-dip cards (the top 10% of the rank: furthest below their own 12-month mean) did in ' + (up ? 'rising' : 'falling') + ' markets, 2022 on, cards $25+: the median move, how often the price was up, and how often a $100 copy netted a profit at the standard price and when bought 20% under.</p>' +
    '<div class="pctbox fc-box"><table><thead><tr><th>Hold</th><th class="num">Move</th><th class="num">Up</th><th class="num" title="a $100 copy bought at the standard price">Net&gt;0</th><th class="num" title="the same copy bought 20% under">20% under</th></tr></thead><tbody>' +
    line(1, 'top10') + line(3, 'top10') + line(6, 'top10') + '</tbody></table></div>' +
    '<p class="dim">Model ' + esc(doc.model || 'v1') + ', data month ' + esc(doc.month) + ', built ' + esc((doc.t || '').replace('T', ' ').replace('Z', ' UTC')) + ' from ' + Number(doc.n).toLocaleString('en-US') + ' cards\u2019 PriceCharting history' + (doc.n_ranked ? ' (' + Number(doc.n_ranked).toLocaleString('en-US') + ' ranked)' : '') + '. eBay\u2019s sold median runs even with PriceCharting\u2019s price on $50+ cards (E07), so projecting the sale from it is fair.</p>';
}
function fcWhy(r) {
  const yrs = r.age == null ? '' : r.age >= 24 ? (r.age / 12).toFixed(0) + ' yr old set' : r.age + ' mo old set';
  const bits = [r.dev12 != null && r.m12 != null ? (r.dev12 < 0 ? (Math.abs(r.dev12) * 100).toFixed(0) + '% under' : (r.dev12 * 100).toFixed(0) + '% over') + ' its 12-mo mean of ' + fmtMoneyPlain(r.m12) : '',
                r.be != null ? 'needs ' + fcPct(r.be) + ' to break even' : '', yrs, r.mom1 != null ? 'last month ' + fcPct(r.mom1) : '',
                r.vol12 + ' PC sales / 12 mo', r.k != null ? r.k + ' eBay sale' + (r.k === 1 ? '' : 's') + ' / 30 d' : ''].filter(Boolean);
  return bits.join(' \u00b7 ');
}
function fcRenderPicks() {
  const I = FC.inputs, S = FC.S, picks = FC.picks, mc = FC.mc, unit = I.h + ' month' + (I.h > 1 ? 's' : '');
  let sum = '';
  if (!FC.rows.length) sum = '<p>No card passes your filters (price range, set age, eBay supply, a recent eBay sale). Widen them.</p>';
  else if (FC.gated) {
    const n = FC.rows.filter(r => r.p >= I.minp).length;
    sum = '<p><b>Nothing to buy: the market is falling</b> (the typical card ' + fcPct(FC.doc.regime.reg3, 1) + ' a month over the last three months) and \u201cBuy only when the market is rising\u201d is ticked. In the research the gate was the one rule that removed every losing cycle; a falling market keeps falling 88% of the time. ' +
      (n ? n + ' card' + (n > 1 ? 's' : '') + ' would clear your bar anyway \u2014 the list below is in buy order; untick the box to override.' : 'The list below is in buy order.') + '</p>';
  } else if (!picks.length) {
    const clear = FC.rows.filter(r => r.p >= I.minp && !r.hold), noCopy = clear.filter(r => r.supply === 0);
    if (clear.length && noCopy.length === clear.length) {    // the bar is cleared, but nothing is listed that cheap (2026-10-25)
      sum = '<p><b>Nothing listed at your price.</b> ' + clear.length + ' card' + (clear.length > 1 ? 's clear' : ' clears') + ' your bar over ' + unit + ', but ' + (clear.length > 1 ? 'none has' : 'it has no') + ' open copy at ' +
        (I.disc ? (I.disc * 100).toFixed(0) + '% under the standard price' : 'the standard price') + ' or less (Supply 0; the cheapest copy there is sits in brackets). Lower the discount, or let the alerts catch a copy that cheap. The list below is in buy order anyway.</p>';
    } else {
      const best = FC.rows.slice().sort((x, y) => y.p - x.p)[0];
      let need = null; for (let d = 0; d <= 0.6; d += 0.01) { if (fcDist(best.buy, best.tab, S, d, best.sell).p >= I.minp) { need = d; break; } }
      sum = '<p><b>Nothing to buy at these settings.</b> Over ' + unit + ' the best card on the list has a ' + (best.p * 100).toFixed(0) + '% chance of a profit after eBay’s fees when bought at the standard price' + (I.disc ? ' less ' + (I.disc * 100).toFixed(0) + '%' : '') +
        '; your bar is ' + (I.minp * 100).toFixed(0) + '%. ' + (need != null ? 'It clears the bar when bought <b>' + (need * 100).toFixed(0) + '% under</b> the standard price — that is what the hit alerts are for.' : 'No discount up to 60% clears the bar at this hold.') + ' The list below is in buy order anyway: what to buy if you can get it cheap.</p>';
    }
  } else {
    const idle = I.cap - FC.spent, elig = FC.rows.filter(r => r.p >= I.minp && r.supply !== 0 && !r.hold).length, noCopy = FC.rows.filter(r => r.p >= I.minp && r.supply === 0 && !r.hold).length;
    sum = '<p>Spend <b>' + fcMoney(FC.spent) + '</b> of ' + fcMoney(I.cap) + ' on <b>' + picks.length + ' card' + (picks.length > 1 ? 's' : '') + '</b> (' + (n => n + (n === 1 ? ' copy' : ' copies'))(picks.reduce((s, r) => s + r.qty, 0)) + '), hold ' + unit + ', sell at eBay\u2019s going price then.' +
      (idle > Math.max(50, I.cap * 0.1) ? ' <span class="dim">' + fcMoney(idle) + ' stays idle: only ' + elig + ' card' + (elig === 1 ? '' : 's') + ' clear' + (elig === 1 ? 's' : '') + ' your bar today with a copy listed at your price' + (noCopy ? ' (' + noCopy + ' more clear' + (noCopy === 1 ? 's' : '') + ' it with nothing listed that cheap)' : '') + ', at ' + I.copies + ' cop' + (I.copies === 1 ? 'y' : 'ies') + ' each \u2014 the supply of discounted copies, not the capital, is the limit (keep the rest for next month\u2019s floors or the hit alerts).</span>' : '') + '</p>' +
      '<div class="stats fc-stats">' +
      '<div class="stat"><div class="k">Expected net profit</div><div class="v">' + fcMoney(mc.mean) + (FC.spent > 0 ? ' <span class="fc-roi ' + (mc.mean < 0 ? 'down' : 'up') + '" title="expected ROI: the expected net on the money spent, over the hold">' + fcPct(mc.mean / FC.spent, 1) + '</span>' : '') + '</div><div class="d">average over the model’s history' + (FC.spent > 0 ? '; ROI on the ' + fcMoney(FC.spent) + ' spent, ' + unit : '') + '</div></div>' +
      '<div class="stat"><div class="k">Likely range</div><div class="v">' + fcMoney(mc.lo) + ' to ' + fcMoney(mc.hi) + '</div><div class="d">10th to 90th percentile' + (FC.spent > 0 ? ' (' + fcPct(mc.lo / FC.spent, 0) + ' to ' + fcPct(mc.hi / FC.spent, 0) + ')' : '') + '; median ' + fcMoney(mc.med) + '</div></div>' +
      '<div class="stat"><div class="k">Chance of a profit</div><div class="v">' + (mc.p * 100).toFixed(0) + '%</div><div class="d">P(basket net &gt; 0), ' + (I.disc ? 'bought ' + (I.disc * 100).toFixed(0) + '% under' : 'at the standard price') + '; half of each card’s swing is the market’s</div></div>' +
      '<div class="stat"><div class="k">Fees assumed</div><div class="v">' + (S.fee * 100).toFixed(1) + '% + $' + (S.fixed + S.shipOut + S.supplies).toFixed(2) + '</div><div class="d">eBay fee, label, supplies' + (S.tax ? ', ' + (S.tax * 100).toFixed(2) + '% buy tax' : '') + ' (Raw Data boxes)</div></div></div>';
  }
  if (fcFiltOn()) sum += '<p class="dim fc-filtnote">Filters on: ' + (FC.filtered || 0) + ' scored card' + (FC.filtered === 1 ? '' : 's') + ' left out by the filter row above (the plan buys only within it).</p>';
  const ao = LIVE.data && LIVE.data.au_open, nAu = FC.rows.reduce((n, r) => n + (r.au ? r.au.n : 0), 0);
  if (ao && ao.rows && ao.rows.length) sum += '<p class="dim fc-aunote">' + (nAu ? '<b>' + nAu + ' auction' + (nAu === 1 ? '' : 's') + '</b> on these cards ' + (nAu === 1 ? 'has' : 'have') + ' a current bid at or under your price (the line under Supply)' : 'No auction on these cards has a current bid at or under your price yet') + ' \u2014 among the ' + ao.read + ' raw-single auctions ending soonest' + (ao.until ? ' (before ' + new Date(ao.until).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) + ')' : '') + ', read ' + rvWhen(ao.t) + '. Auctions count in nothing above; the phone gets a forecast auction alert when one ends within minutes with the bid still under the standard price.</p>';
  const held = FC.rows.filter(r => r.hold).length;      // the PC gap (2026-10-25)
  if (held) sum += '<p class="dim fc-heldnote">' + held + ' card' + (held === 1 ? ' is' : 's are') + ' <b>held</b>: eBay\u2019s sold median and PriceCharting\u2019s price are ' + FC_GAP_PCT + '%+ apart, so one of the two is wrong - no buys and no hits on ' + (held === 1 ? 'it' : 'them') + ' until you review ' + (held === 1 ? 'it' : 'them') + ' in <a href="#" class="fg-open">Flags</a> (flag the odd sales behind the anchor and it recomputes, or the verdict PC inaccuracy releases the card for 30 days).</p>';
  $('fc-summary').innerHTML = sum;
  const rows = picks.concat(FC.rows.filter(r => !r.qty).slice(0, Math.max(0, 40 - picks.length)));
  const supplyCell = r => (r.supply == null ? '<span class="dim">untracked</span>' : r.supply === 0 ? '0' + (r.ask != null ? ' <span class="dim">(cheapest ' + fmtMoneyPlain(r.ask) + ')</span>' : '') : r.supply + (r.dear != null ? ' <span class="dim">(up to ' + fmtMoneyPlain(r.dear) + ')</span>' : '')) +
    (r.unread ? ' <span class="dim cq" title="' + r.unread + ' cop' + (r.unread === 1 ? 'y' : 'ies') + ' at your price whose condition is not read yet: counted in nothing until it is (the ? switch under Supply counts them)">· ' + r.unread + ' ?</span>' : '') +
    (r.au ? '<br><span class="dim fc-au" title="' + r.au.n + ' auction' + (r.au.n === 1 ? '' : 's') + ' on this card whose current bid + shipping is at or under your price (the dearest ' + fmtMoneyPlain(r.au.dear) + '; the first ends in ' + auLeft(r.au.soon) + '). For visibility and the phone\u2019s forecast auction alerts only: auctions count in nothing here - the bids pile in at the end. Click the card to see them.">' + r.au.n + ' (up to ' + fmtMoneyPlain(r.au.dear) + ') auction' + (r.au.n === 1 ? '' : 's') + '</span>' : '');
  let html = '<div class="pctbox fc-box"><table data-sel="fcpicks"><thead><tr><th title="Favorites: the star keeps this pick, with the hold, the discount and its numbers, on the Favorites tab">\u2605</th><th>Card</th><th class="num">Price</th><th class="num" title="Open copies listed at or under your price for the card (the standard price less your discount), a Best Offer ask counted at 90% and an LP copy at its NM-equivalent; in brackets the dearest of them, or with none the cheapest copy there is. Click for the copies themselves">Supply</th><th class="num">Rank</th><th class="num" title="10th percentile – median – 90th percentile">Net per copy</th><th class="num">Chance</th><th class="num">Buy</th><th class="num">Cost</th><th class="num">Net</th></tr></thead><tbody>';
  rows.forEach(r => {
    const costEach = r.buy * (1 - I.disc) * (1 + S.tax);
    const note = fcSellNote(r);
    // the gap is measured against PriceCharting's price TODAY (the collector's figure, what the hold and Flags use); the "PC $" beside it is this month's average so far, the series the model learned on - named when the two differ
    const pcDiff = r.pcNow != null && Math.abs(r.pcNow - r.price) > 0.005;
    const gmk = LIVE.data && LIVE.data.alert && LIVE.data.alert.gap_marks && LIVE.data.alert.gap_marks[String(r.cid)];
    const pcBad = gmk && gmk.auto && gmk.state === 'pc inaccuracy' ? '<span class="fc-pcbad" title="PriceCharting unreliable for this card (automatic): the middle half of its last ' + ((gmk.sp || [])[0] || '?') + ' ungraded sales there spans \u00b1' + Math.round(((gmk.sp || [])[1] || 0) * 50) + '% around ' + fmtMoneyPlain(((gmk.sp || [])[2] || 0) / 100) + '. It is never held for a PC gap and its per-listing PriceCharting rule stands down; see Flags.">PC unreliable</span>' : '';
    const gapNote = (r.gap != null ? '<span class="fc-gapv' + (Math.abs(r.gap) >= FC_GAP_PCT ? ' down' : '') + '" title="eBay\u2019s sold median ' + (r.A != null ? fmtMoneyPlain(r.A) + ' ' : '') + '(' + r.An + ' sales) against PriceCharting\u2019s price today' + (r.pcNow != null ? ', ' + fmtMoneyPlain(r.pcNow) : '') + (pcDiff ? ' (the PC figure beside it is this month\u2019s average so far, the series the model learned on)' : '') + (Math.abs(r.gap) >= FC_GAP_PCT ? '. ' + FC_GAP_PCT + '%+ apart: one of the two is wrong' : '') + '">' + (r.gap > 0 ? '+' : '') + r.gap.toFixed(0) + '% vs PC' + (pcDiff ? ' today ' + fmtMoneyPlain(r.pcNow) : '') + '</span>' : '') + (pcBad ? (r.gap != null ? ' \u00b7 ' : '') + pcBad : '');
    html += '<tr class="' + (r.hold ? 'fc-held ' : '') + (r.qty ? 'fc-buy' : 'fc-watch') + '" data-key="' + r.cid + '"><td class="favc">' + favBtn('fc', r.cid, r.cid, {h: I.h, d: I.disc, buy: r2(r.buy), med: r2(r.med), lo: r2(r.lo), hi: r2(r.hi), p: Math.round(r.p * 1000) / 1000, q: r.qty, n: r.name, s: r.set}, 'sm') + '</td><td class="cardc"><a href="#" class="fcl-open" data-id="' + r.cid + '" title="The open copies of this card on eBay, with the Raw Data columns">' + esc(r.name) + '</a> <a class="dim fc-pc" href="https://www.pricecharting.com/search-products?q=' + encodeURIComponent(r.name + ' ' + r.set) + '&type=prices" target="_blank" rel="noopener" title="PriceCharting">\u2197</a><br><span class="dim">' + esc(r.set) + '</span><br><span class="dim fc-why">' + esc(fcWhy(r)) + '</span></td>' +
      '<td class="num" title="' + esc(r.src) + '">' + fmtMoneyPlain(r.buy) + (note || gapNote || Math.abs(r.buy - r.price) > 0.005 ? '<br><span class="dim' + (r.buy < 0.7 * r.sell || r.buy > 1.3 * r.sell ? ' down' : '') + '">' +
        [note, Math.abs(r.buy - r.price) > 0.005 ? '<span title="PriceCharting’s ungraded price; the model’s history is in this series">PC ' + fmtMoneyPlain(r.price) + '</span>' : '', gapNote].filter(Boolean).join(' · ') + '</span>' : '') + '</td><td class="num"><a href="#" class="fcl-open" data-id="' + r.cid + '" title="' + (r.supply ? 'The ' + r.supply + ' open cop' + (r.supply === 1 ? 'y' : 'ies') + ' at your price (every open copy is a click away in the popup)' : 'The open copies of this card on eBay') + '">' + supplyCell(r) + '</a></td>' +
      '<td class="num">' + FC_BUCKET_WORDS[r.bucket] + '<br><span class="dim">' + fcOrd(Math.round(r.pct * 100)) + ' pct</span></td>' +
      '<td class="num">' + fcMoney2(r.lo) + ' – <b>' + fcMoney2(r.med) + '</b> – ' + fcMoney2(r.hi) + '</td><td class="num">' + (r.p * 100).toFixed(0) + '%</td>' +
      '<td class="num">' + (r.hold ? '<span class="fc-holdnote" title="Held: eBay\u2019s anchor and PriceCharting are ' + Math.abs(r.gap || 0).toFixed(0) + '% apart - review the card in Flags">held</span>' : r.qty ? '<b>' + r.qty + '</b>' : '<span class="dim">—</span>') + '</td><td class="num">' + (r.qty ? fmtMoneyPlain(r.qty * costEach) : '<span class="dim">—</span>') + '</td><td class="num">' + (r.qty ? fcMoney2(r.qty * r.mean) : '<span class="dim">' + fcMoney2(r.mean) + ' each</span>') + '</td></tr>';
  });
  html += '</tbody></table></div><p class="dim">Bold rows are the buys; the rest is the list in buy order (up to 40). Rank = how far the card sits below its own 12-month mean, against every card $25+ with six PriceCharting sales in its last twelve months (the deepest 10% beat the band by 6\u201310 points a quarter in every year since 2022). Net per copy = sold at eBay\u2019s going price at the end of the hold (the card\u2019s sold median moved by the realized return of its rank bucket in this kind of market; PriceCharting\u2019s price when the collector has no sales for it), less eBay\u2019s fee, the label and supplies, less what you paid. The range is what cards in the same bucket actually did, 2022 to the last complete month.</p>';
  $('fc-picks').innerHTML = html; selApply($('fc-picks').querySelector('table'));
}
function fcRenderRecords() {
  const F = (LIVE.data && LIVE.data.forecasts) || {}, recs = (F.recs || []).slice().reverse();
  if (!recs.length) { $('fc-records').innerHTML = '<p class="dim">None recorded yet. Record a forecast and the collector scores it once the hold is up, at eBay’s sold median then (PriceCharting’s price for a card without one).</p>'; return; }
  const scored = recs.filter(r => r.done);
  let head = '';
  if (scored.length) {
    const err = scored.map(r => r.actual - r.exp), inside = scored.filter(r => r.actual >= r.lo && r.actual <= r.hi).length, sign = scored.filter(r => (r.actual > 0) === (r.exp > 0)).length;
    head = '<p><b>' + scored.length + ' scored</b> of ' + recs.length + ': the realized net was on average ' + fcMoney(err.reduce((s, v) => s + v, 0) / err.length) + ' from the expected net, inside the 10–90% range ' + inside + ' time' + (inside === 1 ? '' : 's') + ', and on the predicted side of zero ' + sign + ' time' + (sign === 1 ? '' : 's') + '.</p>';
  }
  const when = t => new Date(t).toLocaleDateString([], {year: 'numeric', month: 'short', day: 'numeric'});
  const spentOf = r => r.spent != null ? r.spent : r.picks.reduce((s, p) => s + p[1] * p[2] * (1 - (r.disc || 0)) * (1 + ((r.fees || {}).tax || 0)), 0);   // what the basket cost (records from before 2026-10-23 carry no spent: from the picks)
  const roiCell = (v, spent) => spent > 0 ? '<td class="num">' + fcPct(v / spent, 1) + '</td>' : '<td class="num"><span class="dim">—</span></td>';
  let html = head + '<div class="pctbox fc-box"><table data-sel="fcrecs"><thead><tr><th>Recorded</th><th>Hold</th><th class="num">Capital</th><th class="num" title="what the basket cost: copies x buy price (less the discount, plus the buy tax)">Spent</th><th class="num">Cards</th><th class="num">Expected net</th><th class="num" title="expected net on the money spent, over the hold">ROI</th><th class="num">Range</th><th class="num">Chance</th><th>Status</th><th class="num">Actual net</th><th class="num" title="realized net on the money spent">Actual ROI</th><th class="num">Miss</th></tr></thead><tbody>';
  recs.forEach(r => {
    const due = r.t + r.h * 30 * 86400000, spent = spentOf(r);
    html += '<tr data-key="' + r.t + '"><td>' + when(r.t) + (r.plan ? ' <b title="the Planning view\u2019s basket: the listings you chose, at their own prices">plan</b>' : '') + (r.reg ? '<br><span class="dim">' + esc(r.reg) + ' market' + (r.disc ? ', bought ' + (r.disc * 100).toFixed(0) + '% under' : '') + '</span>' : '') + '</td><td>' + r.h + ' mo</td><td class="num">' + fcMoney(r.cap) + '</td><td class="num">' + fcMoney(spent) + '</td><td class="num">' + r.picks.length + '<br><span class="dim">' + r.picks.reduce((s, p) => s + p[1], 0) + ' copies</span></td>' +
      '<td class="num">' + fcMoney(r.exp) + '</td>' + roiCell(r.exp, spent) + '<td class="num">' + fcMoney(r.lo) + ' to ' + fcMoney(r.hi) + '</td><td class="num">' + (r.p * 100).toFixed(0) + '%</td>' +
      '<td>' + (r.done ? 'scored ' + esc(String(r.done).slice(0, 10)) : 'due ' + when(due)) + '</td><td class="num">' + (r.done ? '<b>' + fcMoney(r.actual) + '</b>' : '<span class="dim">—</span>') + '</td>' + (r.done ? roiCell(r.actual, spent) : '<td class="num"><span class="dim">—</span></td>') + '<td class="num">' + (r.done ? fcMoney(r.actual - r.exp) : '<span class="dim">—</span>') + '</td></tr>';
  });
  $('fc-records').innerHTML = html + '</tbody></table></div>'; selApply($('fc-records').querySelector('table'));
}
async function fcRecord() {
  const I = FC.inputs, mc = FC.mc, S = FC.S, st = $('fc-status');
  if (!FC.picks.length) { st.textContent = 'There is nothing to record: no buys at these settings.'; st.className = 'al-status warn'; return; }
  if (!HKEY) { st.textContent = 'This page has no key for the collector.'; st.className = 'al-status warn'; return; }
  const t = Date.now();
  try {
    await alSend({type: 'forecast', t, h: I.h, cap: I.cap, spent: Math.round(FC.spent * 100) / 100, disc: I.disc, fees: {fee: S.fee, fixed: S.fixed, shipOut: S.shipOut, supplies: S.supplies, tax: S.tax},
                  picks: FC.picks.map(r => [r.cid, r.qty, Math.round(r.buy * 100) / 100, Math.round(r.mean * 100) / 100]), exp: Math.round(mc.mean * 100) / 100, lo: Math.round(mc.lo * 100) / 100, hi: Math.round(mc.hi * 100) / 100, p: Math.round(mc.p * 1000) / 1000,
                  reg: fcRegimeWord(), month: FC.doc.month, model: FC.doc.model || 'v1'});
    st.textContent = 'Recorded. The collector confirms in a minute or two and scores it ' + I.h * 30 + ' days from now.'; st.className = 'al-status ok';
  } catch (e) { st.textContent = 'Could not reach the collector’s channel (' + e.message + '). Nothing was recorded.'; st.className = 'al-status warn'; }
}
/* ---------------- The card popup, Forecasting / Planning (2026-10-24, Brett) ---------------- */
async function fclLoad() {                               // live/fc_rows.bin: the collector's Raw Data rows for the book copies past the 24-hour table (10-minute buckets)
  const b = Math.floor(Date.now() / 600000);
  if (FCL.loaded === b || !LIVE_URL || !HKEY) return;
  FCL.loaded = b;
  try {
    const res = await fetch(LIVE_URL.replace(/[^/]+$/, 'fc_rows.bin') + '?t=' + b, {cache: 'no-store'});
    if (res.ok) FCL.file = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
  } catch (e) { /* the 24-hour rows and the plan's rows still show */ }
}
function fclRowsFor(cid) {                               // every open copy of the card the page can judge: the 24-hour rows, the favorites' and the plan's rows, the collector's file
  const S = settings(), base = idRow.get(cid), cs = LIVE.dec && LIVE.dec[String(cid)], out = new Map();
  if (!base) return [];
  const add = r => { if (r && r[22] != null && !out.has(r[22])) out.set(r[22], r); };
  (LIVE.er || []).forEach(r => { if (r[0] === cid) add(r); });
  if (LIVE.favEr) for (const r of LIVE.favEr.values()) if (r[0] === cid) add(r);
  for (const x of Object.values((LIVE.data && LIVE.data.plan && LIVE.data.plan.rows) || {})) if (x[1] === cid) add(erowOf(x, S, base, cs));
  ((FCL.file && FCL.file.rows && FCL.file.rows[String(cid)]) || []).forEach(x => add(erowOf(x, S, base, cs)));
  const rows = [...out.values()]; if (FC.doc) rows.forEach(r => { r[56] = fcListing(cid, r[9], r[22], (FC.inputs || fcInputs()).h, S); });
  // the sales behind the anchor (the collector's rows for the sold listings of the window, the ones he marked out included): the "Sales behind the anchor" chip
  ((FCL.file && FCL.file.sales && FCL.file.sales[String(cid)]) || []).forEach(x => { if (!out.has(x[0])) { const r = erowOf(x, S, base, cs); r.sale = true; rows.push(r); } });
  return rows;
}
function fclPlanAt(cid, c) {                             // the plan's price for the card at the Forecast tab's inputs, and the copies at it (null without a book)
  if (!c || !c.book) return null;
  const I = FC.inputs || fcInputs(), base = idRow.get(cid), a = FC.doc && FC.ix ? FC.doc.cards[String(cid)] : null;
  const pcBuy = a ? a[FC.ix.buy] : base ? base[6] : null, lv = fcLevels(c, pcBuy);
  if (lv.buy == null) return null;
  return Object.assign({T: lv.buy * (1 - I.disc), buy: lv.buy, disc: I.disc}, fcSupplyAt(c, lv.buy * (1 - I.disc), I.sup));
}
// the popup asks the collector to read the condition of the unread copies it shows (one lookup each, a handful per
// card): the "?" rows turn into NM / LP / n/s within a minute or two and the live file brings them (2026-10-25)
const READ_ONLY_ASKED = {};
function fclAskReads() {
  if (!HKEY) return 0;
  const at = FCL.at, want = FCL.rows.filter(r => r[19] === 'open' && !r.sale && condUnread(r) && (!at || FCL.mode === 'all' || (at.unreadIds || []).includes(r[22])));
  let n = 0;
  for (const r of want.slice(0, 6)) {
    const iid = r[22]; if (READ_ONLY_ASKED[iid] > Date.now() - 300000) continue;
    READ_ONLY_ASKED[iid] = Date.now(); n++;
    alSend({type: 'read', t: nextT(), i: iid}).catch(() => { delete READ_ONLY_ASKED[iid]; });   // strictly increasing t, posted one after another: the collector serves them all
  }
  return n;
}
function fclAuRender() {                                 // the popup's Auctions view (2026-10-25): the auctions running on the card, soonest first; flaggable
  let box = $('fcl-au'); if (!box) { box = document.createElement('div'); box.id = 'fcl-au'; box.className = 'pctbox fc-box'; $('fcl-mode').insertAdjacentElement('afterend', box); }
  const on = FCL.mode === 'au', rows = auByCard().get(FCL.cid) || [], at = FCL.at;
  box.hidden = !on; document.querySelector('#lov .lwrap').hidden = on; document.querySelector('#lov .controls').hidden = on; $('ranges-fcl').hidden = on; if (on) $('more-fcl').hidden = true;
  if (!on) return;
  box.innerHTML = '<table><thead><tr><th>Ends in</th><th>Flag</th><th>State</th><th class="num">Bid now</th><th class="num">+ ship</th><th class="num">Bids</th><th>Cond.</th><th>Seller</th><th class="num">Photos</th><th>Listing</th></tr></thead><tbody>' +
    rows.map(a => '<tr' + (at && a[2] + a[3] <= at.T + 0.005 ? ' class="fc-buy"' : '') + '><td>' + auLeft(a[5]) + '</td>' + flagCells({k: x => x[0], c: x => x[1]}, a) + '<td class="num">' + fmtMoneyPlain(a[2]) + '</td><td class="num">' + fmtMoneyPlain(a[3]) + ' <span class="dim">= ' + fmtMoneyPlain(a[2] + a[3]) + '</span></td><td class="num">' + (a[4] || 0) + '</td><td>' + (a[8] === 'UNK' ? 'n/s' : esc(a[8])) + '</td><td>' + (a[9] == null ? '?' : fmtInt(a[9])) + (a[10] != null ? ' <span class="dim">' + a[10].toFixed(1) + '%</span>' : '') + '</td><td class="num">' + (a[11] == null ? '?' : a[11]) + '</td><td class="ttl"><a href="' + esc(a[7] || '#') + '" target="_blank" rel="noopener">' + esc(a[6]) + '</a></td></tr>').join('') +
    '</tbody></table>' + (rows.length ? '<p class="dim">Green rows: the current bid + shipping is at or under your price. Bids pile in during the last seconds, so most will finish higher; the phone gets a forecast auction alert when one ends within minutes with the bid still under the card\u2019s standard price. A flag here keeps the auction out of this list and out of the alerts.</p>' : '<p class="dim">No auction on this card among the ones ending soonest.</p>');
}
function fclModeRender() {                               // the switch above the rows: the copies at the plan's price | every open copy
  const el = $('fcl-mode'); if (!el) return;
  const at = FCL.at, all = FCL.rows.filter(r => r[19] === 'open' && !r.sale && !r.um).length, sales = FCL.rows.filter(r => r.sale), c = LIVE.dec && LIVE.dec[String(FCL.cid)];
  const salesChip = sales.length ? '<button type="button" class="fvchip' + (FCL.mode === 'sales' ? ' on' : '') + '" data-m="sales" title="The sold listings of the last 30 days behind this card\u2019s eBay anchor (the ones you flagged are greyed and out of it): flag the odd ones and the anchor recomputes without them">Sales behind the anchor<span class="n">' + sales.length + '</span></button>' : '';
  const aus = auByCard().get(FCL.cid) || [], auAt = at ? aus.filter(a => a[2] + a[3] <= at.T + 0.005).length : 0;
  const auChip = aus.length ? '<button type="button" class="fvchip' + (FCL.mode === 'au' ? ' on' : '') + '" data-m="au" title="The auctions running on this card among the ~800 ending soonest (read every 20 minutes); they count in nothing on the Forecast tab' + (at ? '; ' + auAt + ' with the current bid + shipping at or under your price' : '') + '">Auctions<span class="n">' + aus.length + (at && auAt ? ' \u00b7 ' + auAt + ' at your price' : '') + '</span></button>' : '';
  if (FCL.mode === 'au' && !aus.length) FCL.mode = at ? 'plan' : 'all';
  if (!at) { el.innerHTML = salesChip + auChip + (salesChip && FCL.mode === 'sales' && c && c.A != null ? ' <span class="dim">anchor ' + fmtMoneyPlain(c.A) + ' on ' + (c.A_n || 0) + ' sales · ' + sales.filter(r => flaggedBy(r[22]) || r.um).length + ' marked out by you</span>' : ''); if ((FCL.mode !== 'sales' && FCL.mode !== 'au') || (FCL.mode === 'sales' && !salesChip)) FCL.mode = 'all'; fclAuRender(); return; }
  const here = FCL.rows.filter(r => r[19] === 'open' && !r.sale && !r.um && at.ids.has(r[22]) && !flaggedBy(r[22])).length;
  el.innerHTML = '<button type="button" class="fvchip' + (FCL.mode === 'plan' ? ' on' : '') + '" data-m="plan" title="The copies the Supply cell counts: listed at or under the plan\u2019s price for this card (a Best Offer ask at 90%, an LP copy at its NM-equivalent); a copy you flagged is not among them">At your price \u2264 ' + fmtMoneyPlain(at.T) + '<span class="n">' + at.n + '</span></button>' +
    '<button type="button" class="fvchip' + (FCL.mode === 'all' ? ' on' : '') + '" data-m="all" title="Every open copy of the card the collector follows">All open copies<span class="n">' + all + '</span></button>' + salesChip + auChip +
    (FCL.mode === 'sales' ? ' <span class="dim">' + (c && c.A != null ? 'anchor ' + fmtMoneyPlain(c.A) + ' on ' + (c.A_n || 0) + ' sales' : '') + ' · ' + sales.filter(r => flaggedBy(r[22]) || r.um).length + ' marked out by you · flag an odd sale (another card, a damaged copy, a fake sale) and the anchor recomputes without it</span>' : '') +
    '<span class="dim"> ' + (at.disc ? Math.round(at.disc * 100) + '% under the standard price of ' + fmtMoneyPlain(at.buy) : 'the standard price') + (here < at.n ? ' \u00b7 ' + (at.n - here) + ' of the ' + at.n + ' cop' + (at.n - here === 1 ? 'y has' : 'ies have') + ' no row loaded yet' : '') +
    (at.unread ? ' \u00b7 <span title="No grade in the title and eBay\u2019s condition field not read yet: these count in nothing until they are read; the collector is reading them now">' + at.unread + ' cop' + (at.unread === 1 ? 'y' : 'ies') + ' at the price not read yet (reading\u2026)</span>' : '') + '</span>';
  fclAuRender();
  fclAskReads();
}
async function fcOpenListings(cid) {
  const base = idRow.get(cid), t = tables.fcl; if (!base || !t) return;
  FCL.cid = cid; FCL.at = null;
  $('ltitle').textContent = base[1];
  $('lsub').textContent = base[2] + ' · #' + base[3] + ' · loading…';
  $('lov').classList.add('open');
  await fclLoad();
  if (FCL.cid !== cid) return;                           // another card was opened meanwhile
  FCL.rows = fclRowsFor(cid);
  const c = LIVE.dec && LIVE.dec[String(cid)], open = FCL.rows.filter(r => r[19] === 'open' && !r.sale && !r.um).length;
  FCL.at = fclPlanAt(cid, c);
  if (FCL.mode === 'sales' || FCL.mode === 'au') FCL.mode = 'plan';
  $('lsub').textContent = base[2] + ' · #' + base[3] + (c && c.A != null ? ' · anchor ' + fmtMoneyPlain(c.A) + ' (' + (c.A_n || 0) + ' sales)' : '') + (c && c.L != null ? ' · credible floor ' + fmtMoneyPlain(c.L) : '') +
    ' · ' + open + ' open cop' + (open === 1 ? 'y' : 'ies') + ' the collector follows · + puts a copy on your plan, ★ on your favorites · greyed rows are copies the floor does not count as credible (a new or low-rated seller, far under the anchor, a watch listing, an ask that has sat for days)';
  fclModeRender();
  t.resync(); if (t.sortKey == null) { t.sortKey = 9; t.sortDir = 1; }   // cheapest first unless a header was clicked
  t.apply();
}
document.addEventListener('click', e => {
  const a = e.target && e.target.closest ? e.target.closest('a.fcl-open') : null;
  if (a) { e.preventDefault(); fcOpenListings(+a.dataset.id); }
});
$('lclose').addEventListener('click', () => $('lov').classList.remove('open'));
$('lov').addEventListener('click', e => { if (e.target === $('lov')) $('lov').classList.remove('open'); });
$('fc-cols').addEventListener('click', () => { if (tables.fcl) tables.fcl.openColumns(); });
$('fcl-mode').addEventListener('click', e => {
  const b = e.target.closest('.fvchip'); if (!b || !tables.fcl) return;
  FCL.mode = b.dataset.m === 'all' ? 'all' : b.dataset.m === 'sales' ? 'sales' : b.dataset.m === 'au' ? 'au' : 'plan'; try { if (FCL.mode !== 'sales' && FCL.mode !== 'au') localStorage.setItem('fcl-mode', FCL.mode); } catch (x) {}
  fclModeRender(); tables.fcl.apply();
});
function fcModeApply() {                                 // Forecasting shows the model's picks; Planning the listings he added
  document.querySelectorAll('#fc-modes .fvchip').forEach(b => b.classList.toggle('on', b.dataset.m === FC.mode));
  $('fc-main').hidden = FC.mode !== 'fc'; $('fc-plan').hidden = FC.mode !== 'pl';
  if (FC.mode === 'pl') plRender();
}
$('fc-modes').addEventListener('click', e => { const b = e.target.closest('.fvchip'); if (!b) return; FC.mode = b.dataset.m === 'pl' ? 'pl' : 'fc'; try { localStorage.setItem('fc-mode', FC.mode); } catch (x) {} fcModeApply(); });
fcModeApply();
/* The inputs card folds away (2026-10-24, Brett: "have the your plans variable pane, on the left ... collapsible, so that
   the other side ... will enlarge, so that way, i dont have to right scroll to the right to see all of the column. do
   this for both the planning and forecast buttons"): #fc-side hides, the grid becomes one column, and the bar shows
   "Inputs" with the settings in a few words ($1,000 · 3 mo · 20% under) to bring the card back. Remembered. */
try { FC.fold = localStorage.getItem('fc-fold') === '1'; } catch (e) { FC.fold = false; }
function fcFoldApply() {
  const al = $('fc-al'), un = $('fc-unfold'); if (!al || !un) return;
  al.classList.toggle('folded', !!FC.fold); un.hidden = !FC.fold;
  if (FC.fold) { const I = FC.inputs || fcInputs(); un.innerHTML = '\u25B8 Inputs<span class="dim">' + fcMoney(I.cap) + ' \u00b7 ' + I.h + ' mo \u00b7 ' + (I.disc ? Math.round(I.disc * 100) + '% under' : 'standard price') + '</span>'; }
}
function fcFold(on) { FC.fold = !!on; try { localStorage.setItem('fc-fold', on ? '1' : '0'); } catch (e) {} fcFoldApply(); }
$('fc-fold').addEventListener('click', () => fcFold(true));
$('fc-unfold').addEventListener('click', () => fcFold(false));
fcFoldApply();
/* The Planning view: one row per planned listing, priced like a Forecast pick but at the listing's own price (the
   discount is whatever the listing already is), the sale projected from the card's sell level with this listing left
   out of the competition (fcLevels), the chance from the card's rank bucket at the chosen hold; the basket's expected
   net, range and chance from the same Monte Carlo. A listing that has sold or ended since stays on the list, greyed,
   out of the totals, until it is taken off. */
function plRows() {
  const S = settings(), I = FC.inputs || fcInputs(), doc = FC.doc, ix = FC.ix, out = [];
  for (const p of PLAN_MAP.values()) {
    const iid = p.i; let r = (LIVE.erMap && LIVE.erMap.get(iid)) || (LIVE.favEr && LIVE.favEr.get(iid)) || null;
    const cid = r ? r[0] : p.c, base = cid != null ? idRow.get(+cid) : null, cs = cid != null && LIVE.dec ? LIVE.dec[String(cid)] : null;
    if (!r && base) { const x = ((LIVE.data && LIVE.data.plan && LIVE.data.plan.rows) || {})[iid] || ((FCL.file && FCL.file.rows && FCL.file.rows[String(cid)]) || []).find(y => y[0] === iid); if (x) r = erowOf(x, S, base, cs); }
    if (r && r.um) { out.hidden = (out.hidden || 0) + 1; continue; }   // not the same card, he said: out of every tab (2026-10-25)
    const m = p.m || {};
    const row = {iid, cid: cid == null ? null : +cid, name: base ? base[1] : (m.ti || iid), set: base ? base[2] : '', title: r ? r[6] : (m.ti || ''), url: r ? r[20] : (m.u || null), status: r ? r[19] : 'unknown',
                 total: r ? r[9] : (m.p == null ? null : +m.p), fb: r ? r[17] : null, pctFb: r ? r[18] : null, cond: r ? r[15] : null, hours: r ? r[5] : null, t: p.t, qty: 0, tab: null, p: null, m,
                 tier: r ? r[29] : 'clean', unread: r ? condUnread(r) : false, flag: flaggedBy(iid)};
    if (row.flag) row.status = 'flagged: ' + row.flag;                           // out of the money (a flag means it is not a copy to buy), listed greyed until he takes it off the plan
    if (!plFilterOk(row)) { out.filtered = (out.filtered || 0) + 1; continue; }   // the Planning view's own filters (2026-10-25)
    const a = doc && ix && base ? doc.cards[String(cid)] : null;
    if (a && row.total != null && row.total > 0) {
      const pct = a[ix['pct' + I.h]], pcBuy = a[ix.buy], tab = pct == null ? null : fcTable(I.h, fcBucket(pct));
      if (tab) {
        const lv = fcLevels(cs, pcBuy, iid), d = fcDist(row.total, tab, S, 0, lv.sell);
        Object.assign(row, d, {pct, bucket: fcBucket(pct), tab, buy: row.total, sell: lv.sell, why: lv.why, A: lv.A, An: lv.An, pcBuy, price: a[ix.price], src: 'this listing’s price',
                               age: a[ix.age], vol12: a[ix.vol12] || 0, mom1: a[ix.mom1], dev12: ix.dev12 != null ? a[ix.dev12] : null, m12: ix.m12 != null ? a[ix.m12] : null, k: cs ? (cs.k || 0) : null,
                               be: fcBreakEven(row.total, S, 0, lv.sell), qty: row.status === 'open' ? 1 : 0});
      }
    }
    out.push(row);
  }
  const hidden = out.hidden || 0, filtered = out.filtered || 0;
  out.sort((x, y) => (y.qty - x.qty) || ((y.p || 0) - (x.p || 0)) || (x.t - y.t));
  out.hidden = hidden; out.filtered = filtered;
  return out;
}
/* The Planning view's filters (2026-10-25, Brett: "the forecast button and planning button should have their own
   respective filters, where i can filter out the listings that say warning and filter for their stated condition"):
   what the list shows and the figures count. Remembered (pl-filt). */
const PL_F = {open: true, gone: true, nm: true, lp: true, ns: true, oth: true, nowatch: true};
try { Object.assign(PL_F, JSON.parse(localStorage.getItem('pl-filt') || '{}')); } catch (e) {}
function plFilterOk(row) {
  if (row.flag ? !PL_F.open : row.status === 'open' ? !PL_F.open : !PL_F.gone) return false;
  const c = row.cond; const k = row.unread || c == null || !['NM', 'LP', 'UNK'].includes(c) ? 'oth' : c === 'NM' ? 'nm' : c === 'LP' ? 'lp' : 'ns';
  if (!PL_F[k]) return false;
  if (PL_F.nowatch && (row.tier === 'watch' || row.tier === 'suspect')) return false;
  return true;
}
function plFiltPaint() { for (const k of Object.keys(PL_F)) { const e = $('pl-f-' + k); if (e) e.checked = !!PL_F[k]; } }
if ($('pl-filt')) { plFiltPaint(); $('pl-filt').addEventListener('change', e => { const b = e.target.closest('input'); if (!b) return; PL_F[b.id.replace('pl-f-', '')] = b.checked; try { localStorage.setItem('pl-filt', JSON.stringify(PL_F)); } catch (x) {} plRender(); }); }
function plRender() {
  const el = $('pl-summary'); if (!el) return;
  const I = FC.inputs || fcInputs(), S = FC.S || settings(), unit = I.h + ' month' + (I.h > 1 ? 's' : '');
  const rows = plRows(), picks = rows.filter(r => r.qty && r.tab), stale = rows.filter(r => r.status !== 'open').length, unscored = rows.filter(r => r.status === 'open' && !r.tab).length;
  const spent = picks.reduce((s, r) => s + r.total * (1 + S.tax), 0), mc = fcMonteCarlo(picks, S, 0), cards = new Set(picks.map(r => r.cid)).size;
  let sum = '';
  const hid = (rows.hidden ? ' <span class="dim">' + rows.hidden + ' planned listing' + (rows.hidden === 1 ? ' you said is' : 's you said are') + ' not the same card ' + (rows.hidden === 1 ? 'is' : 'are') + ' hidden \u2014 the Mismatches list on the Raw Data tab has ' + (rows.hidden === 1 ? 'it' : 'them') + ', with Restore.</span>' : '') +
              (rows.filtered ? ' <span class="dim">' + rows.filtered + ' planned listing' + (rows.filtered === 1 ? '' : 's') + ' left out by the filters above.</span>' : '');
  if (!rows.length && (rows.filtered || rows.hidden)) sum = '<p>' + (rows.filtered ? 'Every listing on your plan (' + rows.filtered + ') is left out by the filters above \u2014 untick one to see ' + (rows.filtered === 1 ? 'it' : 'them') + '.' : '') + hid + '</p>';
  else if (!rows.length) sum = '<p>Nothing on your plan yet. On the Forecasting view, click a card to see its open copies and press <b>+</b> on the ones you mean to buy; the + is on every Raw Data row too. The plan is kept by the collector, so it is the same on your laptop and your phone.</p>';
  else {
    if (!FC.doc) sum = '<p>The model file is not loaded yet: the listings are listed, their odds come when it is.</p>';
    sum += '<p>Spend <b>' + fcMoney(spent) + '</b> of ' + fcMoney(I.cap) + ' on <b>' + cards + ' card' + (cards === 1 ? '' : 's') + '</b> (' + picks.length + ' listing' + (picks.length === 1 ? '' : 's') + '), hold ' + unit + ', sell at eBay’s going price then.' +
      (spent > I.cap ? ' <span class="down">' + fcMoney(spent - I.cap) + ' over your capital.</span>' : '') +
      (stale ? ' <span class="dim">' + stale + ' listing' + (stale === 1 ? ' is' : 's are') + ' no longer open and ' + (stale === 1 ? 'is' : 'are') + ' left out of the figures — take ' + (stale === 1 ? 'it' : 'them') + ' off.</span>' : '') +
      (unscored ? ' <span class="dim">' + unscored + ' listing' + (unscored === 1 ? ' has' : 's have') + ' no model score (a card the model does not rank) and ' + (unscored === 1 ? 'is' : 'are') + ' left out of the odds.</span>' : '') + hid + '</p>';
    if (mc) sum += '<div class="stats fc-stats">' +
      '<div class="stat"><div class="k">Expected net profit</div><div class="v">' + fcMoney(mc.mean) + (spent > 0 ? ' <span class="fc-roi ' + (mc.mean < 0 ? 'down' : 'up') + '" title="expected ROI: the expected net on the money spent, over the hold">' + fcPct(mc.mean / spent, 1) + '</span>' : '') + '</div><div class="d">average over the model’s history' + (spent > 0 ? '; ROI on the ' + fcMoney(spent) + ' spent, ' + unit : '') + '</div></div>' +
      '<div class="stat"><div class="k">Likely range</div><div class="v">' + fcMoney(mc.lo) + ' to ' + fcMoney(mc.hi) + '</div><div class="d">10th to 90th percentile' + (spent > 0 ? ' (' + fcPct(mc.lo / spent, 0) + ' to ' + fcPct(mc.hi / spent, 0) + ')' : '') + '; median ' + fcMoney(mc.med) + '</div></div>' +
      '<div class="stat"><div class="k">Chance of a profit</div><div class="v">' + (mc.p * 100).toFixed(0) + '%</div><div class="d">P(basket net &gt; 0), at the listings’ own prices; half of each card’s swing is the market’s</div></div>' +
      '<div class="stat"><div class="k">Fees assumed</div><div class="v">' + (S.fee * 100).toFixed(1) + '% + $' + (S.fixed + S.shipOut + S.supplies).toFixed(2) + '</div><div class="d">eBay fee, label, supplies' + (S.tax ? ', ' + (S.tax * 100).toFixed(2) + '% buy tax' : '') + ' (Raw Data boxes)</div></div></div>';
  }
  el.innerHTML = sum;
  let html = '<div class="pctbox fc-box"><table data-sel="plpicks"><thead><tr><th title="★ keeps the listing on the Favorites tab; − takes it off the plan">★ / −</th><th title="Flag: a flagged listing counts in nothing (no supply, no hit, out of the money here) and sits in Flags; click to flag it or to take the flag off">Flag</th><th title="your reason for the flag, and how many listings of this card carry it">State</th><th>Card</th><th class="num">Price</th><th title="the listing itself">Listing</th><th class="num">Rank</th><th class="num" title="10th percentile – median – 90th percentile">Net per copy</th><th class="num">Chance</th><th class="num">Buy</th><th class="num">Cost</th><th class="num">Net</th></tr></thead><tbody>';
  rows.forEach(r => {
    const costEach = r.total == null ? null : r.total * (1 + S.tax), note = r.tab ? fcSellNote(r) : '';
    const listing = (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener" title="' + esc(r.title) + '">' + esc(String(r.title || r.iid).slice(0, 60)) + '</a>' : esc(String(r.title || r.iid).slice(0, 60))) +
      '<br><span class="dim">' + (r.status === 'open' ? 'open' : r.status === 'unknown' ? 'not on record' : '<span class="down">' + esc(r.status) + '</span>') + (r.unread ? ' · <span title="condition not read yet">?</span>' : r.cond ? ' · ' + (r.cond === 'UNK' ? 'n/s' : esc(r.cond)) : '') + (r.tier === 'watch' || r.tier === 'suspect' ? ' · <span class="amber" title="the scam screen\u2019s tier">' + r.tier + '</span>' : '') + (r.fb != null ? ' · seller ' + fmtInt(r.fb) + (r.pctFb != null ? ' · ' + r.pctFb.toFixed(1) + '%' : '') : '') + (r.hours != null ? ' · listed ' + (r.hours < 48 ? r.hours.toFixed(0) + ' h' : (r.hours / 24).toFixed(0) + ' d') + ' ago' : '') + '</span>';
    html += '<tr class="' + (r.qty ? 'fc-buy' : 'fc-watch') + '" data-key="' + esc(r.iid) + '"><td class="favc">' + favBtn('fl', r.iid, r.cid, Object.assign({ti: String(r.title || '').slice(0, 90), u: r.url, p: r.total, h: I.h}, r.tab ? {c: Math.round(r.p * 1000) / 1000, lo: r2(r.lo), med: r2(r.med), hi: r2(r.hi), sell: r2(r.sell)} : {}), 'sm') + ' ' + planBtn(r.iid, r.cid, r.m, 'sm') + '</td>' + flagCells({k: x => x.iid, c: x => x.cid}, r) +
      '<td class="cardc">' + (r.cid != null ? '<a href="#" class="fcl-open" data-id="' + r.cid + '" title="The open copies of this card">' + esc(r.name) + '</a>' : esc(r.name)) + '<br><span class="dim">' + esc(r.set) + '</span>' + (r.tab ? '<br><span class="dim fc-why">' + esc(fcWhy(r)) + '</span>' : '') + '</td>' +
      '<td class="num">' + (r.total == null ? dash : fmtMoneyPlain(r.total)) + (note || (r.price != null && r.total != null && Math.abs(r.total - r.price) > 0.005) ? '<br><span class="dim' + (r.sell && (r.total < 0.7 * r.sell || r.total > 1.3 * r.sell) ? ' down' : '') + '">' + [note, r.price != null && Math.abs(r.total - r.price) > 0.005 ? '<span title="PriceCharting’s ungraded price">PC ' + fmtMoneyPlain(r.price) + '</span>' : ''].filter(Boolean).join(' · ') + '</span>' : '') + '</td>' +
      '<td class="ttl">' + listing + '</td>' +
      '<td class="num">' + (r.tab ? FC_BUCKET_WORDS[r.bucket] + '<br><span class="dim">' + fcOrd(Math.round(r.pct * 100)) + ' pct</span>' : '<span class="dim">no score</span>') + '</td>' +
      '<td class="num">' + (r.tab ? fcMoney2(r.lo) + ' – <b>' + fcMoney2(r.med) + '</b> – ' + fcMoney2(r.hi) : dash) + '</td><td class="num">' + (r.tab ? (r.p * 100).toFixed(0) + '%' : dash) + '</td>' +
      '<td class="num">' + (r.qty ? '<b>1</b>' : '<span class="dim">—</span>') + '</td><td class="num">' + (r.qty && costEach != null ? fmtMoneyPlain(costEach) : '<span class="dim">—</span>') + '</td><td class="num">' + (r.qty && r.tab ? fcMoney2(r.mean) : '<span class="dim">—</span>') + '</td></tr>';
  });
  html += '</tbody></table></div>' + (rows.length ? '<p class="dim">Each row is one listing at its own price: the odds are the card’s rank bucket in this kind of market, the sale projected from the card’s sell level with this copy left out of the competition. Cost includes the buy tax of the Raw Data boxes. Take a listing off with −; the star keeps it on the Favorites tab as well.</p>' : '');
  $('pl-picks').innerHTML = html; selApply($('pl-picks').querySelector('table'));
  FC.plan = {rows, picks, spent, mc};
}
async function plRecord() {
  const st = $('pl-status'), I = FC.inputs || fcInputs(), S = FC.S || settings(), P = FC.plan || {};
  if (!P.picks || !P.picks.length || !P.mc) { st.textContent = 'There is nothing to record: no open, scored listing on the plan.'; st.className = 'al-status warn'; return; }
  if (!HKEY) { st.textContent = 'This page has no key for the collector.'; st.className = 'al-status warn'; return; }
  const t = Date.now(), mc = P.mc;
  try {
    await alSend({type: 'forecast', t, h: I.h, cap: I.cap, spent: Math.round(P.spent * 100) / 100, disc: 0, fees: {fee: S.fee, fixed: S.fixed, shipOut: S.shipOut, supplies: S.supplies, tax: S.tax},
                  picks: P.picks.map(r => [r.cid, 1, Math.round(r.total * 100) / 100, Math.round(r.mean * 100) / 100]), exp: Math.round(mc.mean * 100) / 100, lo: Math.round(mc.lo * 100) / 100, hi: Math.round(mc.hi * 100) / 100, p: Math.round(mc.p * 1000) / 1000,
                  reg: fcRegimeWord(), month: FC.doc.month, model: FC.doc.model || 'v1', plan: 1, iids: P.picks.map(r => r.iid)});
    st.textContent = 'Recorded. The collector confirms in a minute or two and scores it ' + I.h * 30 + ' days from now (Past forecasts, on the Forecasting view).'; st.className = 'al-status ok';
  } catch (e) { st.textContent = 'Could not reach the collector’s channel (' + e.message + '). Nothing was recorded.'; st.className = 'al-status warn'; }
}
$('pl-record').addEventListener('click', plRecord);
async function loadForecast() {
  const b = Math.floor(Date.now() / 3600000);
  if (FC.loaded === b) return;
  try {
    const res = await fetch('forecast.bin?t=' + b, {cache: 'no-store'});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
    if (!doc || !doc.cols || !doc.cards || !doc.calib || !doc.regime) throw new Error('not a forecast file');
    FC.doc = doc; FC.err = null; FC.loaded = b; FC.ix = Object.fromEntries(doc.cols.map((k, i) => [k, i]));
    fcFiltOptions();                                    // the filter row's set / rarity / finish choices (2026-10-25)
    $('meta-fc').textContent = 'Forecast \u00b7 which cards to buy and hold, ranked by how far each sits below its own 12-month PriceCharting level, gated by the market \u00b7 model ' + (FC.doc.model || 'v1') + ' of ' + esc(FC.doc.month) + ' built ' + (FC.doc.t || '').replace('T', ' ').replace('Z', ' UTC') + ' \u00b7 ' + Number(FC.doc.n).toLocaleString('en-US') + ' cards' + (FC.doc.n_ranked ? ', ' + Number(FC.doc.n_ranked).toLocaleString('en-US') + ' ranked' : '');
    fcCompute();
    if (LIVE.data) { fcStampRows(); tables.er.apply(true); alRender(); }   // the Raw Data Forecast % column fills in; the alerts preview can apply its forecast filter
  } catch (e) {
    FC.err = e.message; FC.loaded = b;                   // one try an hour
    $('meta-fc').textContent = 'Forecast · the model file could not be loaded (' + e.message + ') — it is built by the daily site update; try again after the next build.';
  }
}
['fc-cap', 'fc-h', 'fc-disc', 'fc-pmin', 'fc-pmax', 'fc-share', 'fc-minp', 'fc-copies', 'fc-young', 'fc-untracked', 'fc-recent', 'fc-gate', 'fc-sup-nm', 'fc-sup-lp', 'fc-sup-ns', 'fc-sup-q', 'fc-sup-nowatch', 'fc-sup-minfb'].forEach(id => $(id).addEventListener('input', () => {
  if (!FC.doc) return;
  fcCompute();
  if (id === 'fc-h' && LIVE.data) { fcStampRows(); tables.er.apply(true); }          // the Raw Data column follows the hold
  else if (id === 'fc-minp' && LIVE.data && $('fchits').checked) tables.er.apply(true);   // ... and its tick follows the bar
}));
$('fc-record').addEventListener('click', fcRecord);

paintLp();
loadLive();

/* ---------------- Forecast history tab (Brett, 2026-10-23: "a forecast history tab ... the estimate net profit range, and the
   actual profit ... for a 1-month hold, 3-month hold, 6-month hold for $500 ... $25,000 ... if i wanted to see how much I
   would have made in march 2025 with a $5000 dollar investment in the card purchase recommendation for that month") ----------------
   Two halves. (1) The replay: forecast_hist.py (the monthly Forecast history workflow) ranks every month's cards by the
   reversal signal through 2022-2026, builds the chance tables from the outcomes known by then, and runs the tab's plan
   at the standard constants (fees 14.1% + $5.20, no buy tax, $50-500, 20% per card, one copy, the 50% bar, the gate)
   for every capital x hold x discount, scoring each with PriceCharting's price when the hold is up - there is no eBay
   history, so the standard price is PriceCharting's and the supply cap a quarter of the month's PriceCharting sales.
   Since 2026-10-24 (Brett: "would it be possible to have this as a variable ... the investment, as well as the bought
   under") the file also carries each month's INGREDIENTS - the candidate cards (id, buy price, rank, supply, the
   realized return per hold) and the month's chance tables - and the page runs the plan itself for whatever capital
   and discount the two boxes say (fhPlan / fhCompute = forecast_math.plan + monte_carlo + actual_net, the same
   arithmetic as the replay: ut/test_fh2.py checks a standard cell against the file's). The chips are presets.
   (2) The live plans: the collector archives the 30 standard plans on the first cycle of every month with eBay's
   floors and medians of that moment (live.fc_auto) and scores them like Brett's own records; they exist only at the
   standard settings, so that half shows the nearest archived capital and discount. One table of months per half; a
   click on a month opens its picks. */
const FH = {doc: null, err: null, loaded: 0, cap: 5000, disc: 0, open: new Set(), cache: new Map(), busy: null};
const FH_CAPS = [500, 1000, 5000, 10000, 25000], FH_FREE = {cap: [100, 1000000], disc: [0, 0.6]};
try { const c = +localStorage.getItem('fh-cap'); if (c >= FH_FREE.cap[0] && c <= FH_FREE.cap[1]) FH.cap = c; const d = +localStorage.getItem('fh-disc'); if (d >= 0 && d <= FH_FREE.disc[1]) FH.disc = d; } catch (e) {}
const FH_S = {fee: 0.1325 * 1.065, fixed: 0.4, shipOut: 4.5, supplies: 0.3, tax: 0};   // the replay's constants (forecast_math.STD_FEES)
const FH_IN = {share: 0.2, minp: 0.5, copies: 1};                                       // ... and STD_INPUTS' plan knobs the page keeps fixed
const fhDiscKey = d => d ? String(Math.round(d * 1000) / 1000) : '0';                  // '0', '0.2': the file's cell keys (Python's f"{disc:g}")
const fhKey = (h, cap, disc) => h + '|' + fhDiscKey(disc) + '|' + cap;
const fhFree = () => !!(FH.doc && FH.doc.format >= 2 && FH.doc.months.length && FH.doc.months[0].cards);   // the ingredients are there: any capital, any discount
const fhCaps = () => (FH.doc && FH.doc.caps) || FH_CAPS;
const fhLiveCap = () => fhCaps().reduce((b, c) => Math.abs(c - FH.cap) < Math.abs(b - FH.cap) ? c : b);   // the archive has the standard capitals only
const fhLiveDisc = () => FH.disc >= 0.1 ? 0.2 : 0;
const fhName = cid => { const r = idRow.get(+cid); if (r) return [r[1], r[2]]; const c = FH.doc && FH.doc.cards && FH.doc.cards[String(cid)]; return c ? [c[0], c[1]] : ['card ' + cid, '']; };
const fhMLast = () => { const d = FH.doc; if (d.m_last != null) return d.m_last; const m = /^(\d{4})-(\d{2})$/.exec(d.to || ''); return m ? (+m[1] - 2000) * 12 + (+m[2] - 1) : 0; };
const fhRound = v => { const f = Math.floor(v), r = v - f; return r < 0.5 ? f : r > 0.5 ? f + 1 : (f % 2 ? f + 1 : f); };   // Python's round(): half to even, so the buy order is the replay's
async function loadForecastHist() {
  const b = Math.floor(Date.now() / 3600000);
  if (FH.loaded === b) return;
  FH.loaded = b;
  try {
    const res = await fetch('forecast_hist.bin?t=' + b, {cache: 'no-store'});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
    if (!doc || !doc.months || !doc.caps) throw new Error('not a history file');
    FH.doc = doc; FH.err = null; FH.cache.clear();
    if (!fhFree()) { FH.cap = fhLiveCap(); FH.disc = fhLiveDisc(); }   // an older file: the standard cells only
  } catch (e) { FH.err = e.message; }
  if (!$('p-fh').hidden) fhRender();
}
/* The plan of one month at one hold from the month's ingredients: forecast_math.plan (every candidate card's chance at
   the buy price less the discount, buy order = chance to the whole percent then rank, the greedy allocation under the
   20% share, one copy, the month's supply, the money left; a falling month buys nothing while the gate is on). */
function fhTab(mo, h, b) { const T = mo.tables || {}; return T[h + '|' + b] || T[h + '|all'] || null; }
function fhPlan(mo, h, cap, disc, gate, minp) {
  const C = mo.cards, S = FH_S, rows = [], ys = C['y' + h] || [];
  for (let i = 0; i < C.id.length; i++) {
    const buy = C.buy[i], pct = C.pct[i], tab = fhTab(mo, h, fcBucket(pct)); if (!tab) continue;
    rows.push(Object.assign({cid: C.id[i], buy, sell: buy, pct, tab, supply: C.sup[i], y: ys[i] == null ? null : ys[i], qty: 0}, fcDist(buy, tab, S, disc, buy)));
  }
  rows.sort((x, y) => fhRound(y.p * 100) - fhRound(x.p * 100) || y.pct - x.pct);
  const elig = rows.filter(r => r.p >= minp), gated = gate && mo.reg === 'down';
  let left = cap;
  if (!gated) elig.forEach(r => {
    const cost = r.buy * (1 - disc) * (1 + S.tax);
    let q = Math.min(Math.floor(cap * FH_IN.share / cost), FH_IN.copies);
    if (r.supply != null) q = Math.min(q, r.supply);
    q = Math.min(q, Math.floor(left / cost));
    if (q > 0) { r.qty = q; left -= q * cost; }
  });
  return {rows, elig, picks: elig.filter(r => r.qty > 0), spent: cap - left, gated};
}
const fhActual = (picks, disc) => { let s = 0; for (const r of picks) { if (r.y == null) return null; s += r.qty * fcNet(r.buy, r.y, FH_S, disc, r.sell); } return s; };
function fhCompute(mo, h, cap, disc) {                    // one cell, shaped like the replay's: forecast_hist.py's cell for (h, disc, cap)
  const P = fhPlan(mo, h, cap, disc, true, FH_IN.minp), done = mo.m + h <= fhMLast(), picks = P.picks;
  const mc = picks.length ? fcMonteCarlo(picks, FH_S, disc, (FH.doc.consts && FH.doc.consts.mc_n) || 2000) : null;
  const actual = picks.length && done ? fhActual(picks, disc) : null;
  const c = {n_elig: P.elig.length, best: Math.round(P.rows.reduce((b, r) => r.p > b ? r.p : b, 0) * 1000) / 1000, gated: P.gated, picks: picks.map(r => [r.cid, r.qty, r.buy, r.mean, r.y]),
             copies: picks.reduce((s, r) => s + r.qty, 0), spent: P.spent, done, computed: true};
  if (mc) Object.assign(c, {exp: mc.mean, lo: mc.lo, hi: mc.hi, p: mc.p});
  if (actual != null) Object.assign(c, {actual, roi: P.spent ? actual / P.spent : null, inside: mc.lo <= actual && actual <= mc.hi});
  if (!picks.length && done) {                           // what buying anyway would have made: the ungated plan (a gated month), else the top-ranked cards with no bar
    const P0 = fhPlan(mo, h, cap, disc, false, P.gated ? FH_IN.minp : 0), a0 = P0.picks.length ? fhActual(P0.picks, disc) : null;
    c.forced_roi = a0 != null && P0.spent ? a0 / P0.spent : null; c.forced_n = P0.picks.length;
  }
  return c;
}
function fhCell(mo, h, live) {                            // the cell shown: the archive's nearest standard plan (live), else the page's own plan, else the file's standard cell
  if (live) return mo.cells[fhKey(h, fhLiveCap(), fhLiveDisc())];
  if (!mo.cards) return mo.cells[fhKey(h, FH.cap, FH.disc)];
  const key = FH.cap + '|' + FH.disc;
  if (!FH.cache.has(key)) { if (FH.cache.size >= 12) FH.cache.clear(); FH.cache.set(key, new Map()); }
  const m = FH.cache.get(key), k = mo.m + '|' + h;
  if (!m.has(k)) m.set(k, fhCompute(mo, h, FH.cap, FH.disc));
  return m.get(k);
}
function fhChips() {
  const free = fhFree(), pct = Math.round(FH.disc * 100);
  return '<div class="fvchips fh-chips" id="fh-chips">' +
    (free ? '<label class="fh-in" title="Any amount: the plans are run here, in the page, from each month’s ranked cards">Capital $<input type="number" id="fh-cap" min="' + FH_FREE.cap[0] + '" max="' + FH_FREE.cap[1] + '" step="100" value="' + FH.cap + '"></label>' : '') +
    fhCaps().map(c => '<button type="button" class="fvchip' + (FH.cap === c ? ' on' : '') + '" data-cap="' + c + '">' + fcMoney(c) + '</button>').join('') +
    '<span class="fh-sep"></span>' +
    (free ? '<label class="fh-in" title="Every pick bought this far under the standard price (0 = at the standard price)">Bought <input type="number" id="fh-disc" min="0" max="' + Math.round(FH_FREE.disc[1] * 100) + '" step="5" value="' + pct + '"> % under</label>' : '') +
    '<button type="button" class="fvchip' + (FH.disc ? '' : ' on') + '" data-disc="0" title="every pick bought at the standard price">At the standard price</button><button type="button" class="fvchip' + (Math.abs(FH.disc - 0.2) < 1e-9 ? ' on' : '') + '" data-disc="0.2" title="every pick bought 20% under the standard price - the hit-alert price; assumes you got every pick that cheap">Bought 20% under</button></div>';
}
function fhSummary(months, holds, live) {               // one line per hold: months with buys, profitable, expected vs actual, mean ROI, inside the range
  return '<div class="stats fc-stats">' + holds.map(h => {
    const cells = months.map(mo => fhCell(mo, h, live)).filter(Boolean), buys = cells.filter(c => c.picks && c.picks.length), scored = buys.filter(c => c.actual != null);
    const prof = scored.filter(c => c.actual > 0).length, inside = scored.filter(c => c.inside).length;
    const exp = scored.reduce((s, c) => s + (c.exp || 0), 0), act = scored.reduce((s, c) => s + c.actual, 0), roi = scored.length ? scored.reduce((s, c) => s + (c.roi || 0), 0) / scored.length : null;
    return '<div class="stat"><div class="k">' + h + '-month hold</div><div class="v">' + (buys.length ? buys.length + ' of ' + months.length + ' months with buys' : 'no buys in ' + months.length + ' months') + '</div><div class="d">' +
      (scored.length ? prof + ' of ' + scored.length + ' scored months profitable · expected ' + fcMoney(exp) + ' → actual <b>' + fcMoney(act) + '</b> · mean ROI ' + fcPct(roi, 1) + ' per hold · inside the range ' + inside + ' of ' + scored.length : buys.length ? 'none scored yet' : 'the bar was never cleared at these settings') + '</div></div>';
  }).join('') + '</div>';
}
function fhPickRows(picks, disc, h) {                    // the detail rows: one per pick, with the realized net per copy when the hold is up
  return picks.map(p => { const [cid, qty, buy, mean, y] = p, nm = fhName(cid), real = y == null ? null : fcNet(buy, y, FH_S, disc, buy);
    return '<tr><td>' + esc(nm[0]) + '<br><span class="dim">' + esc(String(nm[1] || '').replace(/^Pokemon /, '')) + '</span></td><td class="num">' + qty + '</td><td class="num">' + fmtMoneyPlain(buy) + (disc ? '<br><span class="dim">paid ' + fmtMoneyPlain(buy * (1 - disc)) + '</span>' : '') + '</td><td class="num">' + fcMoney2(mean) + '</td><td class="num">' + (real == null ? '<span class="dim">—</span>' : '<b class="' + (real > 0 ? 'up' : real < 0 ? 'down' : '') + '">' + fcMoney2(real) + '</b> <span class="dim">(' + fcPct(y, 0) + ' in ' + h + ' mo)</span>') + '</td></tr>'; }).join('');
}
function fhDetail(mo, holds, live) {                      // the opened month: each hold's picks at the chosen capital and scenario
  const disc = live ? fhLiveDisc() : FH.disc;
  return holds.map(h => { const c = fhCell(mo, h, live); if (!c || !c.picks || !c.picks.length) return '<h4>' + h + '-month hold</h4><p class="dim">No buys' + (c && c.best != null ? ' (best chance ' + Math.round(c.best * 100) + '%)' : '') + '.</p>';
    return '<h4>' + h + '-month hold · ' + c.picks.length + ' card' + (c.picks.length > 1 ? 's' : '') + ', ' + c.copies + ' cop' + (c.copies === 1 ? 'y' : 'ies') + ', ' + fcMoney(c.spent) + ' spent</h4><table><thead><tr><th>Card</th><th class="num">Copies</th><th class="num">Price</th><th class="num">Expected net / copy</th><th class="num">Realized net / copy</th></tr></thead><tbody>' + fhPickRows(c.picks, disc, h) + '</tbody></table>'; }).join('');
}
function fhCells(c, done) {                               // the six cells of one hold in a month row
  if (!c) return '<td colspan="6" class="dim">—</td>';
  if (!c.picks || !c.picks.length) return '<td colspan="6" class="dim fh-none">' + (c.gated ? 'gate: falling market · ' : 'no buys · ') + 'best chance ' + Math.round((c.best || 0) * 100) + '%' + (c.forced_roi != null ? ' · ' + (c.gated ? 'the plan without the gate' : 'the top-ranked cards bought anyway') + ': <span class="' + (c.forced_roi > 0 ? 'up' : 'down') + '">' + fcPct(c.forced_roi, 1) + '</span>' : '') + '</td>';
  const spent = c.spent || 0, roi = spent ? c.exp / spent : null;
  return '<td class="num">' + c.picks.length + ' · ' + c.copies + '<br><span class="dim">' + fcMoney(spent) + '</span></td>' +
    '<td class="num">' + fcMoney(c.exp) + '<br><span class="dim">' + fcPct(roi, 1) + '</span></td>' +
    '<td class="num">' + fcMoney(c.lo) + '<br><span class="dim">to ' + fcMoney(c.hi) + '</span></td><td class="num">' + Math.round((c.p || 0) * 100) + '%</td>' +
    (c.actual != null ? '<td class="num"><b class="' + (c.actual > 0 ? 'up' : c.actual < 0 ? 'down' : '') + '">' + fcMoney(c.actual) + '</b> <span class="dim" title="' + (c.inside ? 'inside the 10-90% range' : 'outside the 10-90% range') + '">' + (c.inside ? '✓' : '✗') + '</span></td><td class="num ' + (c.roi > 0 ? 'up' : c.roi < 0 ? 'down' : '') + '">' + fcPct(c.roi, 1) + '</td>'
      : '<td class="num dim" colspan="2">' + (done === false ? 'hold not up yet' : c.done === false ? 'hold not up yet' : 'not scored') + '</td>');
}
function fhTable(months, holds, sel, live) {
  let h = '<div class="pctbox fc-box fh-box"><table data-sel="' + sel + '"><thead><tr class="grp"><th></th><th></th>' + holds.map(x => '<th colspan="6" class="band">' + x + '-month hold</th>').join('') + '</tr><tr><th>Month</th><th>Market</th>' +
    holds.map(() => '<th class="num" title="cards · copies, and what they cost">Buys</th><th class="num" title="the expected net and ROI on the money spent">Expected</th><th class="num" title="the likely range: the 10th to the 90th percentile of the basket\'s net">Range</th><th class="num">Chance</th><th class="num" title="the realized net when the hold is up; ✓ inside the range">Actual</th><th class="num">ROI</th>').join('') + '</tr></thead><tbody>';
  months.forEach(mo => {
    const open = FH.open.has(sel + ':' + mo.month);
    h += '<tr class="fh-row' + (open ? ' open' : '') + '" data-key="' + esc(mo.month) + '" data-m="' + esc(mo.month) + '"><td><b>' + esc(mo.month) + '</b>' + (mo.calib === 'static' ? ' <span class="dim" title="too few out-of-sample months for the chance tables yet: the tables of the whole period stand in (the chances here look a little back)">*</span>' : '') + '</td><td>' + esc(mo.reg) + (mo.reg3 != null ? '<br><span class="dim">' + fcPct(mo.reg3, 1) + '/mo</span>' : '') + '</td>' + holds.map(x => fhCells(fhCell(mo, x, live), mo.done)).join('') + '</tr>';
    if (open) h += '<tr class="fh-detail"><td colspan="' + (2 + 6 * holds.length) + '">' + fhDetail(mo, holds, live) + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}
function fhLiveMonths() {                                 // the collector's archive as months with cells, like the replay's
  const recs = ((LIVE.data && LIVE.data.fc_auto) || {}).recs || [], by = new Map();
  for (const r of recs) { const k = r.cal || String(r.month); if (!by.has(k)) by.set(k, {month: k, reg: r.reg, reg3: null, cells: {}, live: true}); const mo = by.get(k);
    const spent = r.spent || r.picks.reduce((s, p) => s + p[1] * p[2] * (1 - (r.disc || 0)), 0), due = r.t + r.h * 30 * 86400000;
    mo.cells[fhKey(r.h, r.cap, r.disc || 0)] = {picks: r.picks.map(p => [p[0], p[1], p[2], p[3], null]), copies: r.picks.reduce((s, p) => s + p[1], 0), spent, exp: r.exp, lo: r.lo, hi: r.hi, p: r.p, best: r.best, done: !!r.done, due,
      actual: r.done ? r.actual : null, roi: r.done ? r.roi : null, inside: r.done ? r.actual >= r.lo && r.actual <= r.hi : null, res: r.res || null}; }
  return [...by.values()].sort((a, b) => b.month.localeCompare(a.month));
}
function fhPending() {                                    // the (month, hold) cells of the current settings not run yet
  if (!fhFree()) return [];
  const m = FH.cache.get(FH.cap + '|' + FH.disc), out = [];
  FH.doc.months.forEach(mo => FH.doc.holds.forEach(h => { if (!m || !m.has(mo.m + '|' + h)) out.push([mo, h]); }));
  return out;
}
function fhRun(todo) {                                    // runs them a few at a time between frames, so a $25,000 basket's 2,000 draws per cell do not freeze the tab, then redraws
  const key = FH.cap + '|' + FH.disc; if (FH.busy && FH.busy.key === key) return;
  const job = FH.busy = {key, i: 0};                      // one job at a time: a settings change starts a new one and the old chain stops at its next step
  const step = () => {
    if (FH.busy !== job || FH.cap + '|' + FH.disc !== key) { if (FH.busy === job) FH.busy = null; return; }
    const t0 = performance.now();
    while (job.i < todo.length && performance.now() - t0 < 50) { fhCell(todo[job.i][0], todo[job.i][1], false); job.i++; }
    const note = $('fh-running'); if (note) note.textContent = 'Running the plans for ' + fcMoney(FH.cap) + (FH.disc ? ', bought ' + Math.round(FH.disc * 100) + '% under' : ', at the standard price') + '\u2026 ' + Math.min(job.i, todo.length) + ' of ' + todo.length;
    if (job.i < todo.length) setTimeout(step, 0); else { FH.busy = null; fhRender(); }
  };
  setTimeout(step, 0);
}
function fhRender() {
  const host = $('fh-body'); if (!host) return;
  const holds = (FH.doc && FH.doc.holds) || [1, 3, 6], free = fhFree(), pct = Math.round(FH.disc * 100);
  let h = fhChips();
  const todo = fhPending();
  if (!FH.doc) h += '<p class="dim">' + (FH.err ? 'The replay file could not be loaded (' + esc(FH.err) + '). It is built by the monthly Forecast History workflow; the live plans below do not need it.' : 'Loading the replay…') + '</p>';
  else if (todo.length) { h += '<p class="dim" id="fh-running">Running the plans for ' + fcMoney(FH.cap) + (FH.disc ? ', bought ' + pct + '% under' : ', at the standard price') + '\u2026</p>'; fhRun(todo); }
  else {
    const months = FH.doc.months.slice().sort((a, b) => b.m - a.m);
    h += '<h3>The replay: ' + esc(FH.doc.from) + ' to ' + esc(FH.doc.to) + ' from PriceCharting’s history<button class="help" data-h="fh_replay">?</button></h3>' +
      '<p class="dim">' + (FH.doc.model ? 'Every month every card $25+ with six sales in its last twelve months is ranked by how far it sits below its own 12-month mean, the market is read (rising or falling), the chance tables are built from the outcomes known by then, and the tab’s plan is run at the standard constants: fees 14.1% + $5.20, no buy tax, cards $50–$500, at most 20% per card and one copy per card, the 50% bar, nothing bought in a falling month (the gate; such a month shows what the plan would have made without it) - then scored with PriceCharting’s price when the hold is up. Model ' + esc(FH.doc.model) + '.' : 'Every month the model is refit on the months before it (every six months), every card scored and ranked out of sample, and the tab’s plan run at the standard constants: fees 14.1% + $5.20, no buy tax, cards $50–$500, at most 20% per card, the 50% bar - then scored with PriceCharting’s price when the hold is up.') + ' The standard price here is PriceCharting’s (the print or its 3-month average, whichever is higher) and the supply a quarter of the month’s PriceCharting sales: there is no eBay history before October 2026. ' +
      (FH.disc ? '<b>Bought ' + pct + '% under</b> assumes you got every pick ' + pct + '% under that price' + (pct === 20 ? ' - the hit-alert price' : '') + '.' : '<b>At the standard price</b>: every pick at PriceCharting’s price, no discount.') +
      (free ? ' <b>' + fcMoney(FH.cap) + '</b> of capital: the capital and the discount are yours to set in the boxes above (the chips are presets); the plans are run here, in the page, from each month’s ranked cards and chance tables with the replay’s own arithmetic.' : '') + ' Built ' + esc(FH.doc.made || '') + '.</p>' +
      fhSummary(months, holds, false) + fhTable(months, holds, 'fh', false) +
      '<p class="dim">Click a month for its picks. * = the first year, before twelve months of out-of-sample outcomes existed: the chance tables of the whole period stand in there. A month whose hold is not up yet shows its expectation only.</p>';
  }
  const lm = fhLiveMonths(), lc = fhLiveCap(), ld = fhLiveDisc(), nearest = lc !== FH.cap || Math.abs(ld - FH.disc) > 1e-9;
  h += '<h3>The live plans: what the tab said on the first day of each month<button class="help" data-h="fh_live">?</button></h3>' +
    '<p class="dim">The collector archives the same 30 plans on the first cycle of every month, with eBay’s floors and sold medians of that moment (the two guards applied) - exactly what the Forecast tab showed - and scores each when its hold is up, at eBay’s sold median then. These are the rows that will tell whether the floor-gap edge is real.' +
    (nearest ? ' <b>The archive holds the standard plans only</b> (' + fhCaps().map(fcMoney).join(', ') + '; at the standard price or 20% under), so this half shows the nearest: <b>' + fcMoney(lc) + '</b>, ' + (ld ? 'bought 20% under' : 'at the standard price') + '.' : '') + '</p>' +
    (lm.length ? fhSummary(lm, holds, true) + fhTable(lm, holds, 'fhlive', true) : '<p class="dim">' + (LIVE.data ? 'None archived yet: the collector files the first set on its next cycle with the model file.' : 'Waiting for the live data.') + '</p>');
  const ae = document.activeElement, keep = !FH.committing && ae && (ae.id === 'fh-cap' || ae.id === 'fh-disc') ? {id: ae.id, v: ae.value, s: ae.selectionStart, e: ae.selectionEnd} : null;   // a box being typed in survives a redraw the plans' run causes (not its own commit, which may have clamped it)
  host.innerHTML = h;
  if (keep) { const el = $(keep.id); if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (x) {} } }
  host.querySelectorAll('table[data-sel]').forEach(selApply);
}
function fhSet(cap, disc) {                               // the two free variables, clamped, remembered, redrawn
  FH.cap = Math.min(FH_FREE.cap[1], Math.max(FH_FREE.cap[0], Math.round(cap))); FH.disc = Math.min(FH_FREE.disc[1], Math.max(0, Math.round(disc * 1000) / 1000));
  try { localStorage.setItem('fh-cap', FH.cap); localStorage.setItem('fh-disc', FH.disc); } catch (x) {}
  FH.committing = true; try { fhRender(); } finally { FH.committing = false; }
}
$('fh-body').addEventListener('change', e => {           // the boxes: on Enter or leaving the box (every keystroke would rerun 170 plans)
  if (e.target.id === 'fh-cap') { const v = parseFloat(e.target.value); if (!isNaN(v)) fhSet(v, FH.disc); else e.target.value = FH.cap; }
  else if (e.target.id === 'fh-disc') { const v = parseFloat(e.target.value); if (!isNaN(v)) fhSet(FH.cap, v / 100); else e.target.value = Math.round(FH.disc * 100); }
});
$('fh-body').addEventListener('click', e => {
  const chip = e.target.closest('.fvchip');
  if (chip) { if (chip.dataset.cap) fhSet(+chip.dataset.cap, FH.disc); else if (chip.dataset.disc != null) fhSet(FH.cap, +chip.dataset.disc); return; }
  const hb = e.target.closest('button.help'); if (hb) { e.stopPropagation(); openHelp(hb.dataset.h); return; }   // the tab's help buttons are drawn here, after the page bound the static ones
  if (e.target.closest('a') || e.target.closest('label')) return;
  const tr = e.target.closest('tr.fh-row'); if (!tr) return;
  const key = tr.closest('table').dataset.sel + ':' + tr.dataset.m;
  if (FH.open.has(key)) FH.open.delete(key); else FH.open.add(key);
  SEL.set(tr.closest('table').dataset.sel, tr.dataset.key);   // the sticky highlight: set before the repaint (the document's handler runs after this one, on the old row)
  fhRender();
});

/* ---------------- Notification Settings tab ----------------
   The numbers here decide what the collector sends to the phone. Save posts them to a private channel the collector
   reads every minute (its name and the key that signs each message both come from the site key, so only this
   unlocked page and the collector can use it); the collector reports what it is using in the live file (live.alert). */
const AL_DEFAULT = {margin: 10, tax: 6.25, conf: 70, window: 48, min_profit: 0, pmin: 25, pmax: 500, hits: true, leads: false, watch: true, suspects: false, auctions: true, quiet: false, q_from: 23, q_to: 7, fc_only: false, fc_h: 1, fc_minp: 50};
const AL_NUM = {margin: 'al-margin', tax: 'al-tax', conf: 'al-conf', window: 'al-win', min_profit: 'al-minprofit', pmin: 'al-pmin', pmax: 'al-pmax', q_from: 'al-q1', q_to: 'al-q2', fc_h: 'al-fch', fc_minp: 'al-fcminp'};
const AL_BOX = {hits: 'al-hits', leads: 'al-leads', watch: 'al-watch', suspects: 'al-suspects', auctions: 'al-auctions', quiet: 'al-quiet', fc_only: 'al-fconly'};   // fc_*: the forecast filter (2026-10-23)
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
    const fcp = FC.doc ? fcListing(x[1], x[7], x[0], c.fc_h, S) : null;   // the Forecast tab's chance at this price (the collector tests the same)
    if (c.fc_only && (fcp == null || fcp * 100 < c.fc_minp)) continue;
    out.push({x, kind, sus, profit, roi: profit / allin * 100, base: idRow.get(x[1]) || [], fcp});
  }
  return out.sort((a, b) => b.profit - a.profit);
}
function alDescribe(c) {
  return 'margin <b>' + c.margin + '%</b> · buy tax <b>' + c.tax + '%</b> · sells within <b>' + c.window + ' h</b> at <b>' + c.conf + '%</b> confidence<br>' +
    'profit at least <b>$' + c.min_profit + '</b> · buy price <b>$' + c.pmin + '</b> to <b>$' + c.pmax + '</b><br>' +
    'hits <b>' + (c.hits ? 'on' : 'off') + '</b> · leads <b>' + (c.leads ? 'on' : 'off') + '</b> · scam-watch listings <b>' + (c.watch ? 'included' : 'left out') + '</b> · suspects <b>' + (c.suspects ? 'alerted' : 'blocked') + '</b> · auctions <b>' + (c.auctions ? 'on' : 'off') + '</b> · quiet hours <b>' + (c.quiet ? c.q_from + ':00 to ' + c.q_to + ':00' : 'off') + '</b>' +
    ' · forecast hits only <b>' + (c.fc_only ? 'on (' + c.fc_minp + '% or better over ' + c.fc_h + ' month' + (c.fc_h > 1 ? 's' : '') + ')' : 'off') + '</b>';
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
    (m.length ? '<table data-sel="alpre"><thead><tr><th></th><th>Card</th><th>Listing</th><th class="num">Total</th><th class="num">Profit</th><th class="num">ROI</th><th class="num" title="the Forecast tab\u2019s chance of a profit at this price, for the hold set on the left">Forecast</th><th>Kind</th><th>Now</th></tr></thead><tbody>' +
      m.slice(0, 40).map(r => '<tr data-key="' + esc(r.x[0]) + '"><td class="favc">' + favBtn('er', r.x[0], r.x[1], {ti: String(r.x[4] || '').slice(0, 90), u: r.x[18] || null, p: r.x[7] == null ? null : r.x[7]}, 'sm') + '</td><td>' + esc(r.base[1] || '') + '<br><span class="dim">' + esc(r.base[2] || '') + '</span></td><td><a href="' + esc(r.x[18] || '#') + '" target="_blank" rel="noopener">' + esc(r.x[4] || '') + '</a></td><td class="num">' + fmtMoney(r.x[7]) + '</td><td class="num">' + fmtMoney(r.profit) + '</td><td class="num">' + r.roi.toFixed(0) + '%</td><td class="num">' + (r.fcp == null ? '<span class="dim">' + dash + '</span>' : '<span class="' + (r.fcp * 100 >= mine.fc_minp ? 'up' : '') + '">' + Math.round(r.fcp * 100) + '%</span>') + '</td><td>' + badge(r.kind === 'hit' ? 'hit' : 'lead', r.kind === 'hit' ? 'pass' : 'hot') + (r.sus ? ' ' + badge('suspect', 'warn') : '') + '</td><td>' + esc(r.x[17] || '') + '</td></tr>').join('') + '</tbody></table>' : '');
  ['al-pre', 'al-hist', 'al-wrong'].forEach(id => selApply($(id).querySelector('table')));
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
    '<table data-sel="alwrong"><thead><tr><th>When</th><th>eBay listing</th><th>Was matched to</th><th>Kind</th></tr></thead><tbody>' +
    w.slice(0, 200).map(r => '<tr data-key="' + esc(r[1]) + '"><td>' + when(r[0]) + '</td><td><a href="' + esc(r[3] || '#') + '" target="_blank" rel="noopener">' + esc(r[2] || r[1]) + '</a></td><td>' +
      (r[6] ? '<a href="https://www.pricecharting.com/game/' + esc(r[6]) + '" target="_blank" rel="noopener">' + esc(r[4] || (idRow.get(r[6]) || [])[1] || 'card ' + r[6]) + '</a>' : esc(r[4] || '')) +
      ((r[5] || (idRow.get(r[6]) || [])[2]) ? '<br><span class="dim">' + esc(String(r[5] || (idRow.get(r[6]) || [])[2]).replace('Pokemon ', '')) + '</span>' : '') + '</td><td>' + esc(String(r[7] || '').replace('-drop', ', price drop').replace('-lead', ', lead').replace('-forecast', ', forecast')) + '</td></tr>').join('') + '</tbody></table>';
}

function alHistory(a) {
  const h = (a && a.hist) || [];
  if (!h.length) return 'No alerts sent yet. Each one will be listed here with your answer and what happened to the listing.';
  const ans = {nm: 'Yes, near mint', lp: 'Yes, lightly played', no: 'No', yes: 'Same card, no condition picked'}, said = h.filter(r => r[7]), no = said.filter(r => r[7] === 'no').length;
  const when = t => new Date(t).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  const fate = r => r[8] === 'open' ? 'still listed' : r[8] === 'sold' ? 'sold' + (r[9] != null ? ' ' + (r[9] < 1 ? Math.round(r[9] * 60) + ' min' : r[9].toFixed(1) + ' h') + ' after the alert' : '') : r[8] === 'unknown' ? 'no longer tracked' : esc(r[8]);
  return 'Last <b>' + h.length + '</b> alert' + (h.length === 1 ? '' : 's') + ' \u00b7 you answered <b>' + said.length + '</b>' + (said.length ? ': ' + (said.length - no) + ' yes, ' + no + ' no' : '') +
    '<table data-sel="alhist"><thead><tr><th></th><th>Sent</th><th>Card</th><th class="num">Total</th><th class="num">Profit</th><th>Kind</th><th>Your answer</th><th>Listing</th></tr></thead><tbody>' +
    h.map(r => '<tr data-key="' + esc(r[10] || r[0]) + '"><td class="favc">' + (r[10] ? favBtn('er', r[10], r[11], {ti: String(r[2] || '').slice(0, 90), u: r[3] || null, p: r[4] == null ? null : r[4]}, 'sm') : '') + '</td><td>' + when(r[0]) + '</td><td><a href="' + esc(r[3] || '#') + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a><br><span class="dim">' + esc(r[2]) + '</span></td><td class="num">' + fmtMoney(r[4]) + '</td><td class="num">' + fmtMoney(r[5]) + (r[12] != null ? ' <span class="dim" title="the Forecast tab\u2019s chance of a profit at this price when the alert went out">· ' + Math.round(r[12] * 100) + '%</span>' : '') + '</td><td>' + esc(String(r[6]).replace('-drop', ', price drop').replace('-lead', ', lead').replace('-forecast', ', forecast').replace('-suspect', ', SUSPECT')) + '</td><td>' + (r[7] ? ans[r[7]] || esc(r[7]) : '<span class="dim">not answered</span>') + '</td><td>' + fate(r) + '</td></tr>').join('') + '</tbody></table>';
}
async function alChannel() {
  const enc = new TextEncoder();
  const hex = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return {topic: 'pc-' + (await hex(HKEY + ':alerts-topic')).slice(0, 40),
          key: await crypto.subtle.importKey('raw', enc.encode(await hex(HKEY + ':alerts-key')), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify'])};
}
// The collector acts on a message only when its t is NEWER than the last one it acted on (its replay guard), so two
// messages in the same millisecond, or one overtaking another on the way, lose the second: nextT() hands out strictly
// increasing stamps and alSend posts one message at a time, in the order they were made (2026-10-25: the popup's
// batch of condition reads arrived together and only the first was served).
let AL_T = 0, AL_CHAIN = Promise.resolve();
const nextT = () => { AL_T = Math.max(Date.now(), AL_T + 1); return AL_T; };
async function alSend(msg, suffix) {                // suffix: a side topic of the same channel ('-pc' = picture requests)
  const ch = await alChannel(), body = JSON.stringify(msg);
  if (msg && typeof msg.t === 'number' && msg.t > AL_T) AL_T = msg.t;
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', ch.key, new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const run = async () => { const r = await fetch('https://ntfy.sh/' + ch.topic + (suffix || ''), {method: 'POST', body: JSON.stringify({m: body, s: sig})}); if (!r.ok) throw new Error('HTTP ' + r.status); };
  const p = AL_CHAIN.then(run, run);
  AL_CHAIN = p.catch(() => {});
  return p;
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
