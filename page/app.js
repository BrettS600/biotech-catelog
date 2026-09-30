const DATA = __DATA__;
const SETS = __SETS__;
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
const cells4 = r =>
  '<td><a href="https://www.pricecharting.com/game/' + r[0] + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a></td>' +
  '<td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td>' + (r[4] || dash) + '</td>';
const fmtNum = (v, nd = 1) => v == null ? dash : v.toLocaleString('en-US', {minimumFractionDigits: nd, maximumFractionDigits: nd});
const badge = (txt, cls) => '<span class="badge' + (cls ? ' ' + cls : '') + '">' + esc(txt) + '</span>';
const LIVE = {data: null, ec: [], er: []};      // filled by loadLive()

const TABLES = {
  pc: {rows: () => DATA, noun: 'cards', ranges: RANGE_COLS, labels: RANGE_LABEL, defaults: {},
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
  // eBay Catalog row (three bands): 0 id 1 card 2 set 3 # 4 released |
  //   Observed: 5 k 6 D 7 N 8 p1 9 p2 10 p3 11 mu 12 smed 13 s80 14 hrs 15 st |
  //   Rates: 16 lam 17 price 18 dos 19 io |
  //   Decisions: 20 n24 21 n48 22 p24 23 p48 24 pw 25 prob24 26 edays 27 maxbuy 28 hot 29 basis 30 confirm 31 checks |
  //   Trends: 32 spm 33 d7 34 d30 35 pos 36 vdp 37 vd 38 vol 39 ts | 40 net | 41 ord
  ec: {rows: () => LIVE.ec, noun: 'cards', ranges: [17, 5, 16, 7, 18, 12, 14, 15, 22, 23, 27, 40, 32, 34, 39],
       labels: {17: 'Price $', 5: 'Sold 30d', 16: 'λ /day', 7: 'Active', 18: 'Days supply', 12: 'Sold med $', 14: 'Hrs to sale', 15: 'Sell-thru %', 22: 'P₂₄ $', 23: 'P₄₈ $', 27: 'Max buy $', 40: 'Net $', 32: 'Sales/month', 34: 'Δ30d %', 39: 'Slope %/mo'},
       defaults: {17: [50, 150]},
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
      '<td class="num">' + fmtInt(r[20]) + '</td><td class="num">' + fmtInt(r[21]) + '</td>' +
      '<td class="num">' + fmtMoney(r[22]) + '</td><td class="num">' + fmtMoney(r[23]) + '</td><td class="num">' + fmtMoney(r[24]) + '</td>' +
      '<td class="num">' + fmtPct(r[25], false, 0) + '</td>' +
      '<td class="num">' + fmtNum(r[26], 1) + '</td>' +
      '<td class="num">' + (r[27] == null ? dash : '<b>' + fmtMoney(r[27]) + '</b>' + (r[29] && r[29] !== '24h' ? ' <span class="dim">(' + r[29] + ')</span>' : '')) + '</td>' +
      '<td class="num">' + fmtMoney(r[40]) + '</td>' +
      '<td>' + (r[28] === 'confirmed' ? badge('Hot ✓', 'hot2') : r[28] === 'candidate' ? badge('Hot ' + r[30] + '/3', 'hot') : r[31] && r[31].length && r[5] >= 5 ? '<span class="dim" title="' + esc(r[31].join(', ')) + '">fails ' + r[31].length + '</span>' : dash) + '</td>' +
      '<td class="num">' + fmtInt(r[32]) + '</td>' +
      '<td class="num">' + fmtPct(r[33]) + '</td>' +
      '<td class="num">' + fmtPct(r[34]) + '</td>' +
      '<td class="num">' + fmtPct(r[35], false, 0) + '</td>' +
      '<td class="num">' + (r[37] == null ? dash : '<span class="' + (r[37] > 0 ? 'up' : r[37] < 0 ? 'down' : '') + '">' + (r[37] > 0 ? '+' : '') + r[37] + (r[36] == null ? '' : ' (' + (r[36] > 0 ? '+' : '') + r[36].toFixed(1) + '%)') + '</span>') + '</td>' +
      '<td class="num">' + fmtPct(r[38], false, 2) + '</td>' +
      '<td class="num">' + fmtPct(r[39]) + '</td>' +
      '<td><button class="tbtn ebtn" data-id="' + r[0] + '">Trend</button></td>' +
      '<td><button class="tbtn bbtn" data-id="' + r[0] + '">Book</button></td>'},
  // eBay Raw Data row: 0 cardId 1 card 2 set 3 # 4 released 5 hours 6 title 7 item 8 ship 9 total 10 allin 11 cardPrice 12 vs% 13 maxbuy
  // 14 verdict 15 cond 16 bo 17 fb 18 pct 19 status 20 url 21 img 22 itemId 23 how 24 profit 25 roi 26 p48
  // 27 time (h: to outcome, or open so far) 28 note (LP discount applied) 29 tier 30 risk rank 31 score 32 photos 33 signals 34 ord
  er: {rows: () => LIVE.er, noun: 'listings', ranges: [24, 25], maxes: [5],
       labels: {5: 'Listed within', 24: 'Profit $', 25: 'ROI %'}, units: {5: 'h'},
       defaults: {},
       extra: r => (!$('hits').checked || r[14] === 'PASS') && condOk(r[15]) && r[32] >= 2 && (r[29] !== 'suspect' || $('showsus-er').checked),
       rowClass: r => r[29] === 'suspect' ? 'sus' : '',
       hay: r => r[1] + ' ' + r[2] + ' ' + r[6],
       row: r => cells4(r) +
      '<td class="num">' + fmtNum(r[5], 1) + '</td>' +
      '<td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener" title="' + esc(r[6]) + '">' + esc(r[6]) + '</a></td>' +
      '<td class="num">' + fmtMoney(r[7]) + '</td><td class="num">' + (r[8] == null ? dash : r[8] === 0 ? 'free' : fmtMoney(r[8])) + '</td>' +
      '<td class="num">' + fmtMoney(r[9]) + '</td><td class="num">' + fmtMoney(r[10]) + '</td>' +
      '<td class="num">' + fmtMoney(r[11]) + '</td>' +
      '<td class="num">' + fmtPct(r[12]) + '</td>' +
      '<td class="num">' + fmtMoney(r[26]) + '</td>' +
      '<td class="num"' + (r[28] ? ' title="' + esc(r[28]) + '"' : '') + '>' + fmtMoney(r[13]) + (r[28] ? ' <span class="dim">LP</span>' : '') + '</td>' +
      '<td class="num">' + (r[24] == null ? dash : '<span class="' + (r[24] > 0 ? 'up' : r[24] < 0 ? 'down' : '') + '">' + (r[24] < 0 ? '−' : '') + fmtMoney(Math.abs(r[24])).replace('$', '$') + '</span>') + '</td>' +
      '<td class="num">' + fmtPct(r[25]) + '</td>' +
      '<td>' + (r[14] === 'PASS' ? badge('PASS', 'pass') : /scam|suspect/.test(r[14]) ? badge(r[14], 'warn') : badge(r[14])) + '</td>' +
      '<td>' + riskCell(r) + '</td>' +
      '<td class="num">' + (r[32] == null ? dash : r[32]) + '</td>' +
      '<td>' + (r[15] === 'UNK' ? '<span class="dim">n/s</span>' : esc(r[15])) + '</td>' +
      '<td>' + (r[16] ? 'BO' : dash) + '</td>' +
      '<td class="num">' + fmtInt(r[17]) + '</td><td class="num">' + (r[18] == null ? dash : r[18].toFixed(1) + '%') + '</td>' +
      '<td>' + (r[19] === 'open' ? 'open' : r[19] === 'sold' ? '<span class="up">sold</span>' : '<span class="dim">' + esc(r[19]) + '</span>') + '</td>' +
      '<td class="num">' + (r[27] == null ? dash : (r[19] === 'open' ? '<span class="dim">' + fmtNum(r[27], 1) + '</span>' : fmtNum(r[27], 1))) + '</td>'},
};
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
// Raw Data condition filter (NM / LP / n/s chips); MP and HP rows show only when all three are ticked
const COND_IDS = ['NM', 'LP', 'UNK'];
function condOk(c) {
  const on = COND_IDS.filter(k => $('cond-' + k + '-er').checked);
  if (on.length === COND_IDS.length) return true;
  return on.includes(c);
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
  };
  t.renderMore = () => {
    const frag = document.createDocumentFragment();
    const end = Math.min(t.shown + PAGE, t.view.length);
    for (let i = t.shown; i < end; i++) { const tr = document.createElement('tr'); tr.innerHTML = cfg.row(t.view[i]); if (cfg.rowClass) { const c = cfg.rowClass(t.view[i]); if (c) tr.className = c; } paintRow(tr); frag.appendChild(tr); }
    el('rows').appendChild(frag); t.shown = end;
    el('more').hidden = t.shown >= t.view.length;
    el('more').textContent = 'Show more (' + (t.view.length - t.shown).toLocaleString('en-US') + ' left)';
  };
  // column eyes: every header cell (last header row) gets one; hidden columns collapse to a strip
  const headRow = document.querySelector('#p-' + id + ' thead tr:last-child');
  let hiddenCols = new Set();
  try { hiddenCols = new Set(JSON.parse(localStorage.getItem('hide-' + id) || '[]')); } catch (e) {}
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
    t.apply();
  });
  sel.addEventListener('change', t.apply);
  el('more').addEventListener('click', t.renderMore);
  t.apply();
  return t;
}
const tables = {};
for (const id in TABLES) tables[id] = makeTable(id, TABLES[id]);

/* ---------------- Tabs ---------------- */
const TAB_HASH = {pc: '', ec: 'ebay-catalog', er: 'ebay-raw'};      // default (no hash) = PriceCharting
function showTab(id) {
  if (!TABLES[id]) id = 'pc';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === id));
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== 'p-' + id; });
  history.replaceState(null, '', location.pathname + location.search + (TAB_HASH[id] ? '#' + TAB_HASH[id] : ''));
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
/* ---- Decisions recomputed in the browser, so Confidence and Margin can be changed live ----
   Mirrors compute_stats() in ebay_sweep.py. Observed and Rates never change here; only the amber band. */
const CAP = 3, UNDERCUT = 1.0;
const poissonGe = (m, n) => { if (n <= 0) return 1; let p = Math.exp(-m), cum = p; for (let k = 1; k < n; k++) { p *= m / k; cum += p; } return Math.max(0, 1 - cum); };
const depth = (lam, T, conf) => { if (lam == null) return null; let best = 0; for (let n = 1; n <= CAP; n++) if (poissonGe(lam * T, n) >= conf) best = n; return best; };
const r2 = v => v == null ? null : Math.round(v * 100) / 100;
function settings() {
  const conf = Math.min(0.95, Math.max(0.5, (+$('conf').value || 70) / 100));
  const margin = Math.min(0.5, Math.max(0, (+$('margin').value || 0) / 100));
  const g = (LIVE.data && LIVE.data.gate) || GATE_EBAY;
  const cal = (LIVE.data && LIVE.data.calib) || {};
  const use = $('usecal').checked;
  return {conf, margin, fee: g.fee * (1 + g.buyerTax), fixed: g.fixed, shipOut: g.shipOut, tax: g.tax, minSales: g.minSales || 3,
          d48: use && cal.h48 && cal.h48.delta != null ? cal.h48.delta / 100 : 0,
          d24: use && cal.h24 && cal.h24.delta != null ? cal.h24.delta / 100 : 0};
}
function decide(c, S) {
  const lam = c.lam, N = c.N, p = [c.p1, c.p2, c.p3], smed = c.smed, s80 = c.s80;
  let n24 = depth(lam, 1, S.conf), n48 = depth(lam, 2, S.conf);
  if (lam != null && (c.k || 0) < S.minSales) n24 = n48 = 0;    // sale floor: no 24/48 h price on 1-2 sales
  let p24 = null, p48 = null, pw = null;
  if (lam != null) {
    if (n24 && N >= n24) p24 = p[n24 - 1] - UNDERCUT;
    else if (n24 && smed != null) p24 = p[0] == null ? smed : Math.min(smed, p[0] - UNDERCUT);
    if (n48 && N >= n48) p48 = p[n48 - 1] - UNDERCUT;
    else if (n48 && s80 != null) p48 = p[0] == null ? s80 : Math.min(s80, p[0] - UNDERCUT);
    const cap = s80 != null ? s80 : (smed != null ? smed * 1.15 : null);
    if (p48 != null && cap != null) p48 = Math.min(p48, cap);
    if (p24 != null && p48 != null) p48 = Math.max(p48, p24);
    pw = p[0] != null ? p[0] - UNDERCUT : smed;
    if (pw != null && cap != null) pw = Math.min(pw, cap);
    if (p48 != null) p48 = p48 * (1 + S.d48);          // measured price calibration, if any
    if (p24 != null) p24 = p24 * (1 + S.d24);
  }
  const prob24 = lam ? (1 - Math.exp(-lam)) * 100 : null;
  const edays = lam ? -Math.log(1 - S.conf) / lam : null;
  const [csell, basis] = p24 != null ? [p24, '24h'] : p48 != null ? [p48, '48h'] : [pw, 'window'];
  let net = null, maxbuy = null;
  if (csell != null) { net = csell * (1 - S.fee) - S.fixed - S.shipOut; maxbuy = net / (1 + S.margin); }
  return {n24, n48, p24: r2(p24), p48: r2(p48), pw: r2(pw), prob24: prob24 == null ? null : Math.round(prob24 * 10) / 10,
          edays: edays == null ? null : Math.round(edays * 10) / 10, csell: r2(csell), net: r2(net), maxbuy: r2(maxbuy), basis: csell == null ? null : basis};
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
function lpAdjust(cs, S) {
  // an LP listing sells at the card's gate price minus the LP discount; net and max buy follow
  const d = lpFrac(cs.price);
  if (cs.csell == null) return {net: cs.net, maxbuy: cs.maxbuy, note: null};
  const sell = cs.csell * (1 - d), net = sell * (1 - S.fee) - S.fixed - S.shipOut, maxbuy = net / (1 + S.margin);
  return {net: r2(net), maxbuy: r2(maxbuy),
          note: 'LP: sells about ' + fmtMoneyPlain(r2(sell)) + ' (' + (d * 100).toFixed(1) + '% under the NM price of ' + fmtMoneyPlain(cs.csell) + ') - if it were NM, max buy ' + fmtMoneyPlain(cs.maxbuy)};
}
function paintLp() {
  const lp = lpInfo();
  $('lpt').innerHTML = lp.tiers.map(t => '<span class="' + (t.src === 'tier' ? 'meas' : '') + '" title="' + (t.src === 'tier' ? 'measured in this tier from ' + t.n + ' LP sales' : t.src === 'global' ? 'this tier has ' + t.n + ' LP sales (needs ' + lp.minSales + '); using the ratio measured across all tiers' : 'no measurement yet (' + t.n + ' LP sales in this tier, needs ' + lp.minSales + '); using the 12% default') + '"><i>' + (t.lo === 0 ? '<$' + t.hi : t.hi >= 1e9 ? '$' + t.lo + '+' : '$' + t.lo + '–' + t.hi) + '</i>' + t.pct + '%</span>').join('');
}
const COMPARABLE = new Set(['NM', 'LP', 'UNK']);
function verdictOf(x, cs, S) {
  // x = raw live row from the collector; cs = decided card stats
  const total = x[7], item = x[5];
  if (total == null) return ['no price', null];
  const allin = Math.round((total + (item || 0) * S.tax) * 100) / 100;
  if (x[22] != null && x[22] < 2) return ['fewer than 2 photos', allin];
  if (x[23] === 'suspect') return ['suspect', allin];
  if (!cs || cs.maxbuy == null) return [cs ? 'no sales yet' : 'no data yet', allin];
  if (cs.price && total < 0.5 * cs.price) return ['too cheap - scam check', allin];
  if (!COMPARABLE.has(x[13])) return ['condition ' + x[13], allin];
  const bar = sellerBar(x[15], x[16]);
  if (bar != null) return ['seller < ' + bar + '%', allin];
  return [allin <= cs.maxbuy ? 'PASS' : 'over max buy', allin];
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
  LIVE.ec = []; LIVE.er = []; LIVE.dec = {};
  for (const [cid, c] of Object.entries(live.cards)) {
    const base = idRow.get(+cid); if (!base) continue;
    const d = decide(c, S); LIVE.dec[cid] = Object.assign({}, c, d);
    const hot = c.hot === 2 ? 'confirmed' : c.hot === 1 ? 'candidate' : '';
    const t = c.tr || {};
    LIVE.ec.push([base[0], base[1], base[2], base[3], base[4],
                  c.k, c.D, c.N, c.p1, c.p2, c.p3, c.mu, c.smed, c.s80, c.hrs, c.st,
                  c.lam, c.price, c.dos, c.io,
                  d.n24, d.n48, d.p24, d.p48, d.pw, d.prob24, d.edays, d.maxbuy, hot, d.basis, c.confirm, c.checks,
                  t.spm == null ? null : t.spm, t.d7 == null ? null : t.d7, t.d30 == null ? null : t.d30, t.pos == null ? null : t.pos,
                  t.vdp == null ? null : t.vdp, t.vd == null ? null : t.vd, t.vol == null ? null : t.vol, t.ts == null ? null : t.ts,
                  d.net, LIVE.ec.length]);
  }
  let passes = 0, hiddenImg = 0, hiddenSus = 0;
  live.live.forEach(x => {
    const base = idRow.get(x[1]); if (!base) return;
    const cs = LIVE.dec[String(x[1])];
    // LP listings sell below the NM gate price: discount the sell side, then net, max buy, profit and verdict follow
    let csl = cs, note = null;
    if (cs && x[13] === 'LP') { const a = lpAdjust(cs, S); csl = Object.assign({}, cs, {net: a.net, maxbuy: a.maxbuy}); note = a.note; }
    const [v, allin] = verdictOf(x, csl, S);
    if (v === 'PASS') passes++;
    const profit = csl && csl.net != null && allin != null ? Math.round((csl.net - allin) * 100) / 100 : null;
    const roi = profit != null && allin > 0 ? Math.round(profit / allin * 1000) / 10 : null;
    const status = x[17], tHours = status === 'open' ? x[3] : (x[21] != null ? x[21] : x[3]);
    const tier = x[23] || 'clean', nimg = x[22] == null ? 99 : x[22];
    if (nimg < 2) hiddenImg++; else if (tier === 'suspect') hiddenSus++;
    LIVE.er.push([base[0], base[1], base[2], base[3], base[4], x[3], x[4], x[5], x[6], x[7], allin,
                  cs ? cs.price : null, cs && cs.price && x[7] != null ? Math.round((x[7] / cs.price - 1) * 1000) / 10 : null,
                  csl ? csl.maxbuy : null, v, x[13], x[14], x[15], x[16], x[17], x[18], x[19], x[0], x[20], profit, roi, cs ? cs.p48 : null,
                  tHours, note, tier, RISK_RANK[tier] || 0, x[24] || 0, nimg, x[25] || [], LIVE.er.length]);
  });
  $('nsus').textContent = hiddenSus;
  paintLp();
  const cal = live.calib || {}, c48 = cal.h48 || {}, c24 = cal.h24 || {};
  const calTxt = c48.delta != null ? 'price calibration ' + (c48.delta > 0 ? '+' : '') + c48.delta + '% from ' + c48.n + ' outcomes' + (S.d48 ? ' (applied)' : ' (off)')
                                   : 'price calibration: ' + (c48.n || 0) + ' of 150 outcomes collected — not applied yet';
  $('callab').title = calTxt;
  $('meta-ec').textContent = 'eBay Catalog · data as of ' + live.t.replace('T', ' ').replace('Z', ' UTC') + ' (' + ageText(live.t) + ') · ' +
    live.n_cards.toLocaleString('en-US') + ' cards with data · ' + live.n_open.toLocaleString('en-US') + ' listings being followed · ' + live.n_closed.toLocaleString('en-US') + ' outcomes recorded · ' + live.calls_today + ' API calls today · ' + calTxt + ' · confidence ' + Math.round(S.conf * 100) + '% · margin ' + Math.round(S.margin * 100) + '%';
  $('meta-er').textContent = 'eBay Raw Data · ' + live.n_live.toLocaleString('en-US') + ' matched listings in the last 24 h · ' + passes + ' pass the gate at these settings · ' + hiddenImg + ' left out (fewer than 2 photos) · ' + hiddenSus + ' suspect hidden · as of ' + ageText(live.t);
  $('unmatched-btn').textContent = 'Unmatched titles (' + live.unmatched.length + ')';
  tables.ec.apply(); tables.er.apply();
}
async function loadLive() {
  if (!LIVE_URL || !HKEY) { $('meta-ec').textContent = 'eBay Catalog · the eBay collector has not published data yet.'; $('meta-er').textContent = 'eBay Raw Data · no live data yet.'; return; }
  try {
    const res = await fetch(LIVE_URL + '?t=' + Math.floor(Date.now() / 60000), {cache: 'no-store'});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    LIVE.data = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
    rebuildLive();
  } catch (e) {
    $('meta-ec').textContent = 'eBay Catalog · live data unavailable (' + e.message + ') — retry with a refresh.';
    $('meta-er').textContent = 'eBay Raw Data · live data unavailable (' + e.message + ').';
  }
}
// settings: remembered in this browser; any change re-derives the amber band and the verdicts
try { const sv = JSON.parse(localStorage.getItem('ebay-settings') || '{}'); if (sv.conf) $('conf').value = sv.conf; if (sv.margin != null) $('margin').value = sv.margin; if (sv.usecal != null) $('usecal').checked = sv.usecal; if (sv.hits != null) $('hits').checked = sv.hits; } catch (e) {}
['conf', 'margin', 'usecal', 'hits'].forEach(id => $(id).addEventListener('input', () => {
  try { localStorage.setItem('ebay-settings', JSON.stringify({conf: $('conf').value, margin: $('margin').value, usecal: $('usecal').checked, hits: $('hits').checked})); } catch (e) {}
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
  h += '<span>Price <b>' + fmtMoney(c.price) + '</b></span><span>λ <b>' + (c.lam == null ? '—' : c.lam.toFixed(2)) + '/day</b> (' + c.k + ' sales in ' + c.D + ' d)</span>';
  h += '<span>n₂₄ <b>' + (c.n24 == null ? '—' : c.n24) + '</b> · n₄₈ <b>' + (c.n48 == null ? '—' : c.n48) + '</b></span>';
  h += '<span>P₂₄ <b>' + fmtMoney(c.p24) + '</b> · P₄₈ <b>' + fmtMoney(c.p48) + '</b> · window <b>' + fmtMoney(c.pw) + '</b></span>';
  h += '<span>Max buy <b>' + fmtMoney(c.maxbuy) + '</b>' + (c.basis ? ' <span class="dim">from the ' + c.basis + ' price</span>' : '') + '</span>';
  if (c.checks && c.checks.length) h += '<span class="dim">Hot checks failing: ' + esc(c.checks.join(', ')) + '</span>';
  else if (c.hot) h += '<span>' + (c.hot === 2 ? badge('Hot ✓ confirmed', 'hot2') : badge('Hot candidate · ' + c.confirm + '/3 confirmed', 'hot')) + '</span>';
  h += '</div>';
  h += '<h3>Competing raw listings (' + c.N + ' comparable)</h3>';
  if (!c.book.length) h += '<p class="dim">None open right now.</p>';
  else {
    h += '<table><thead><tr><th>Rank</th><th class="num">Total $</th><th class="num">Item $</th><th class="num">Ship $</th><th>Cond</th><th>Offer</th><th class="num">Seller</th><th class="num">Listed</th><th>Title</th></tr></thead><tbody>';
    c.book.forEach((b, i) => {
      h += '<tr><td>' + (i + 1) + '</td><td class="num">' + fmtMoney(b[1]) + (b[5] ? ' <span class="dim">(' + fmtMoney(Math.round(b[1] * GATE_LIVE().boHaircut * 100) / 100) + ' ranked)</span>' : '') + '</td><td class="num">' + fmtMoney(b[2]) + '</td><td class="num">' + (b[3] === 0 ? 'free' : fmtMoney(b[3])) + '</td><td>' + (b[4] === 'UNK' ? '<span class="dim">n/s</span>' : b[4]) + '</td><td>' + (b[5] ? 'BO' : '—') + '</td><td class="num">' + fmtInt(b[6]) + (b[7] != null ? ' · ' + b[7].toFixed(1) + '%' : '') + '</td><td class="num">' + hrsTxt(b[8]) + '</td><td class="ttl"><a href="' + esc(b[9]) + '" target="_blank" rel="noopener">' + esc(b[10]) + '</a></td></tr>';
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
  const sus = LIVE.er.filter(r => r[29] === 'suspect');
  h += '<h3>Suspect listings right now (' + sus.length + ')</h3>';
  if (!sus.length) h += '<p class="dim">None.</p>';
  else h += '<table><thead><tr><th>Title</th><th class="num">Total $</th><th class="num">Card price $</th><th class="num">Seller fb</th><th class="num">Score</th><th>Why</th></tr></thead><tbody>' +
    sus.map(r => '<tr><td class="ttl"><a href="' + esc(r[20] || '#') + '" target="_blank" rel="noopener">' + esc(r[6]) + '</a></td><td class="num">' + fmtMoney(r[9]) + '</td><td class="num">' + fmtMoney(r[11]) + '</td><td class="num">' + fmtInt(r[17]) + (r[18] != null ? ' · ' + r[18].toFixed(1) + '%' : '') + '</td><td class="num">' + r[31] + '</td><td>' + esc((r[33] || []).map(c => (sc.labels || {})[c] || c).join(' · ')) + '</td></tr>').join('') + '</tbody></table>';
  $('bbody').innerHTML = h;
  $('bov').classList.add('open');
}
$('scam-btn').addEventListener('click', openScam);
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
const LABEL_EB = {loose: 'Sold median (7d)', sell: 'Cheapest ask', buy: '', vol: 'Sales/day', ref: '90d high/low + P₄₈'};
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
         refs: [['90d high', t.hi], ['90d low', t.lo], ['P₄₈', c.p48]], ebay: c};
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
  h += cell('P₄₈ · P₂₄', fmtMoneyPlain(c.p48) + ' · ' + fmtMoneyPlain(c.p24), 'n₄₈ ' + (c.n48 == null ? '—' : c.n48) + ' · n₂₄ ' + (c.n24 == null ? '—' : c.n24));
  h += cell('Max buy', fmtMoneyPlain(c.maxbuy), c.basis ? 'from the ' + c.basis + ' price' : '');
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
