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
  // 27 time (h: to outcome, or open so far) 28 note (LP discount applied) 29 ord
  er: {rows: () => LIVE.er, noun: 'listings', ranges: [24, 25], maxes: [5],
       labels: {5: 'Listed within', 24: 'Profit $', 25: 'ROI %'}, units: {5: 'h'},
       defaults: {},
       extra: r => (!$('hits').checked || r[14] === 'PASS') && condOk(r[15]),
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
      '<td>' + (r[14] === 'PASS' ? badge('PASS', 'pass') : /scam/.test(r[14]) ? badge(r[14], 'warn') : badge(r[14])) + '</td>' +
      '<td>' + (r[15] === 'UNK' ? '<span class="dim">n/s</span>' : esc(r[15])) + '</td>' +
      '<td>' + (r[16] ? 'BO' : dash) + '</td>' +
      '<td class="num">' + fmtInt(r[17]) + '</td><td class="num">' + (r[18] == null ? dash : r[18].toFixed(1) + '%') + '</td>' +
      '<td>' + (r[19] === 'open' ? 'open' : r[19] === 'sold' ? '<span class="up">sold</span>' : '<span class="dim">' + esc(r[19]) + '</span>') + '</td>' +
      '<td class="num">' + (r[27] == null ? dash : (r[19] === 'open' ? '<span class="dim">' + fmtNum(r[27], 1) + '</span>' : fmtNum(r[27], 1))) + '</td>'},
};
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
    for (let i = t.shown; i < end; i++) { const tr = document.createElement('tr'); tr.innerHTML = cfg.row(t.view[i]); paintRow(tr); frag.appendChild(tr); }
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
  const conds = [...document.querySelectorAll('#ranges-' + id + ' .condchip input')];
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
  return {conf, margin, fee: g.fee * (1 + g.buyerTax), fixed: g.fixed, shipOut: g.shipOut, tax: g.tax,
          d48: use && cal.h48 && cal.h48.delta != null ? cal.h48.delta / 100 : 0,
          d24: use && cal.h24 && cal.h24.delta != null ? cal.h24.delta / 100 : 0};
}
function decide(c, S) {
  const lam = c.lam, N = c.N, p = [c.p1, c.p2, c.p3], smed = c.smed, s80 = c.s80;
  const n24 = depth(lam, 1, S.conf), n48 = depth(lam, 2, S.conf);
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
  if (!cs || cs.maxbuy == null) return [cs ? 'no sales yet' : 'no data yet', allin];
  if (cs.price && total < 0.5 * cs.price) return ['too cheap - scam check', allin];
  if (!COMPARABLE.has(x[13])) return ['condition ' + x[13], allin];
  if (x[16] != null && x[16] < 98) return ['seller < 98%', allin];
  return [allin <= cs.maxbuy ? 'PASS' : 'over max buy', allin];
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
  let passes = 0;
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
    LIVE.er.push([base[0], base[1], base[2], base[3], base[4], x[3], x[4], x[5], x[6], x[7], allin,
                  cs ? cs.price : null, cs && cs.price && x[7] != null ? Math.round((x[7] / cs.price - 1) * 1000) / 10 : null,
                  csl ? csl.maxbuy : null, v, x[13], x[14], x[15], x[16], x[17], x[18], x[19], x[0], x[20], profit, roi, cs ? cs.p48 : null,
                  tHours, note, LIVE.er.length]);
  });
  paintLp();
  const cal = live.calib || {}, c48 = cal.h48 || {}, c24 = cal.h24 || {};
  const calTxt = c48.delta != null ? 'price calibration ' + (c48.delta > 0 ? '+' : '') + c48.delta + '% from ' + c48.n + ' outcomes' + (S.d48 ? ' (applied)' : ' (off)')
                                   : 'price calibration: ' + (c48.n || 0) + ' of 150 outcomes collected — not applied yet';
  $('callab').title = calTxt;
  $('meta-ec').textContent = 'eBay Catalog · data as of ' + live.t.replace('T', ' ').replace('Z', ' UTC') + ' (' + ageText(live.t) + ') · ' +
    live.n_cards.toLocaleString('en-US') + ' cards with data · ' + live.n_open.toLocaleString('en-US') + ' listings being followed · ' + live.n_closed.toLocaleString('en-US') + ' outcomes recorded · ' + live.calls_today + ' API calls today · ' + calTxt + ' · confidence ' + Math.round(S.conf * 100) + '% · margin ' + Math.round(S.margin * 100) + '%';
  $('meta-er').textContent = 'eBay Raw Data · ' + live.n_live.toLocaleString('en-US') + ' matched listings in the last 24 h · ' + passes + ' pass the gate at these settings · as of ' + ageText(live.t);
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

const README = `
<h3>1. What the three tabs are</h3>
<p><b>PriceCharting Catalog</b> is the card list with PriceCharting's prices and the trend columns built from this site's own daily snapshots. <b>eBay Catalog</b> is the same card list with numbers computed <i>only</i> from eBay: every raw (ungraded) single listed in the last 30 days, matched to a card by its title, followed until it sells or ends. <b>eBay Raw Data</b> is the listings themselves — every matched raw single first seen in the last 24 hours, with the buy verdict. The eBay side refreshes every 15 minutes.</p>
<p><b>All eBay prices are buyer totals: item + shipping.</b> That is what the buyer paid and what you compare against, and because you list with free shipping, P₄₈ is literally the number you type into the listing.</p>

<h3>2. Reading the eBay Catalog: three bands</h3>
<p><span class="legend"><span class="l-obs">Observed</span></span> columns are independent inputs measured on eBay — counts, the book of competing copies, sold prices. <span class="legend"><span class="l-rate">Rates</span></span> are computed from Observed only (λ, Price, Days supply, In/out). <span class="legend"><span class="l-dec">Decisions</span></span> depend on λ, the book, and your <b>Confidence</b> and <b>Margin</b> settings at the top — change those and only the amber band moves. Every header's <b>?</b> shows the formula, an example, what the column is built from and what it feeds.</p>

<p>A fourth band, <span class="legend"><span class="l-tr">Trends</span></span>, applies the PriceCharting tab's trend formulas to eBay's own realized prices: the price line is the median of raw sale totals over a trailing 7-day window (blank with fewer than 3 sales in the window), and the Trend button charts it with sales per day and the cheapest ask. These fill in on the same schedule as the PriceCharting versions — 7, 30 and 60 days after the collector started — and are noisier on thin cards, where the median moves because different copies sold rather than because the market did.</p>

<h3>3. The Poisson walkthrough — will it sell within 48 hours at this price?</h3>
<p>Take a card with <b>k = 30</b> observed raw sales in <b>D = 30</b> days, a book of comparable open copies at <b>$96, $99, $104, $110</b>, and a sold 80th percentile of <b>$101</b>.</p>
<p><b>Step 1 — demand rate λ.</b> The naive rate is k ÷ D = 1.00/day. A rate estimated from a count is uncertain, so the site uses the 25th percentile of the posterior Gamma(k + ½, D): the value the true rate beats three times in four.</p>
<div class="formula">λ = (30.5 ÷ 30) × [1 − 1/(9·30.5) + z/(3√30.5)]³   with z = −0.6745
  = 1.0167 × [1 − 0.0036 − 0.0407]³ = 1.0167 × 0.8728 = 0.887 sales/day</div>
<p>With only 8 sales in 12 days the same formula gives 0.53 against a naive 0.67 — the haircut is bigger when the evidence is thinner. That is the point.</p>
<p><b>Step 2 — buyers in the window are Poisson.</b> If buyers arrive independently at a steady average rate, the number arriving in T days has mean m = λT and P(exactly j) = e<sup>−m</sup> m<sup>j</sup> / j!. For 48 hours, m = 0.887 × 2 = 1.774 and e<sup>−1.774</sup> = 0.1695:</p>
<table><thead><tr><th>j buyers</th><th class="num">P(exactly j)</th><th class="num">P(at least j)</th></tr></thead><tbody>
<tr><td>0</td><td class="num">0.1695</td><td class="num">1.000</td></tr>
<tr><td>1</td><td class="num">1.774 × 0.1695 = 0.3009</td><td class="num">0.831</td></tr>
<tr><td>2</td><td class="num">1.774² ÷ 2 × 0.1695 = 0.2669</td><td class="num">0.530</td></tr>
<tr><td>3</td><td class="num">1.774³ ÷ 6 × 0.1695 = 0.1579</td><td class="num">0.263</td></tr></tbody></table>
<p><b>Step 3 — depth n.</b> n₄₈ is the largest n with P(at least n buyers) ≥ Confidence (70%). P(≥1) = 83% clears it, P(≥2) = 53% does not, so <b>n₄₈ = 1</b>: over two days you can count on one buyer, so you must be the cheapest copy. For 24 hours m = 0.887 and P(≥1) = 59% &lt; 70%, so <b>n₂₄ = 0</b>: no 24-hour price exists for this card. Its P(≤24h) column reads 59%, and Exp. days = −ln(1 − 0.70) ÷ λ = 1.204 ÷ 0.887 = 1.4 days to reach 70%. n is capped at 3 because buyers are not perfectly price-ordered deeper than that.</p>
<p><b>Step 4 — the price.</b> P₄₈ = p<sub>n</sub> − $1 with n = 1, so p₁ = $96 gives <b>P₄₈ = $95</b>, capped at the sold 80th percentile ($101) — fine. Had that $96 copy been a Best Offer listing it would rank at 96 × 0.9 = $86.40 and P₄₈ would be $85.40: you undercut what it will actually take, not what it asks. At $95 you sit at rank 1 and the chance of a sale within 48 hours is P(≥1) = <b>83%</b>, above the 70% bar because n = 1 cleared it with room to spare.</p>
<p><b>Step 5 — back to max buy.</b> No P₂₄ here, so the gate uses P₄₈:</p>
<div class="formula">net = 95 × (1 − 0.1325 × 1.065) − 0.30 − 4.50 = 95 × 0.8589 − 4.80 = $76.79
max buy = 76.79 ÷ (1 + 0.15) = $66.78 all-in   (≈ $59 item price with $4 shipping and 6.25% tax)</div>
<p><b>What it means.</b> If the last 30 days are a fair guide, listing this card at $95 free shipping gets it sold within two days about four times in five, and paying up to $66.78 all-in leaves a 15% margin after eBay's fee (charged on the buyer's total including their sales tax), the fixed fee and tracked shipping out. It is a model estimate, not a promise: buyers bunch on evenings and weekends, someone can undercut you mid-window, and a listing with bad photos is not "credible" at any rank. The conservative λ absorbs some of that; calibration (section 6) measures the rest.</p>

<h3>4. What to do with the numbers</h3>
<ul>
<li><b>Buy</b> when a listing's all-in (item + shipping + your tax) is at or below Max buy — the Raw Data tab says PASS. Then read the title, the photos and the seller before you click; open the card's <b>Book</b> to see the copies you would compete with and how the recent sales went.</li>
<li><b>List</b> at P₄₈, free shipping, Best Offer on with auto-accept at P₂₄ (or ~3% under P₄₈ when there is no P₂₄). Bargain hunters take it on day one at P₂₄; patient buyers pay P₄₈.</li>
<li>If it has not moved after 48 hours, cut to P₂₄. After another window, it was mispriced or the card slowed — take the small loss and note why.</li>
<li>Past 48 hours each extra day adds about 1% to the price and about 11% to your capital cycle. Two days is the planned window; anything longer only makes sense when there is nothing to buy anyway.</li>
</ul>

<h3>5. The Confidence and Margin boxes</h3>
<p><b>Only show hits</b> filters the Raw Data tab to listings whose verdict is PASS — the ones where buying at the asking price and selling at the gate's price clears your Margin. <b>Confidence</b> is the probability the P₂₄ / P₄₈ prices are set for. Raise it and n falls, prices fall, Net and Max buy fall: you are demanding a surer sale. 70% is the default because a missed window costs a day, not a loss. <b>Margin</b> is the profit required on all-in cost; it moves Max buy and the PASS threshold and nothing else. <b>Net $</b> on the Catalog is what you clear at the gate's sell price; <b>Profit $</b> and <b>ROI %</b> on the Raw Data tab apply that to each listing's all-in cost, so sorting Raw Data by ROI shows the best buys first. Both boxes are remembered in this browser and change nothing in the collector.</p>

<h3>6. Calibration — of the price, not the rate</h3>
<p>λ is left exactly as the data says. What gets checked is the price claim: "a listing at P₄₈ sells within 48 hours 70% of the time." When a listing first appears, the collector records the P₄₈ the model would have set for its card that moment, and how far above or below it the listing was actually priced. Two days later the tracker knows whether it sold. Pooling every listing that entered the buyable part of the book (rank 1–3) gives a table: realized 48-hour sell-through by price offset from P₄₈.</p>
<table><thead><tr><th>Offset from model P₄₈</th><th class="num">Listings</th><th class="num">Sold ≤ 48 h</th><th class="num">Realized</th></tr></thead><tbody>
<tr><td>−10% to −5%</td><td class="num">73</td><td class="num">52</td><td class="num">71%</td></tr>
<tr><td>−5% to −2%</td><td class="num">35</td><td class="num">14</td><td class="num">40%</td></tr>
<tr><td>−2% to +2%</td><td class="num">43</td><td class="num">9</td><td class="num">21%</td></tr></tbody></table>
<p>In that (invented) table the realized curve crosses 70% at about −7%: listings at the model's P₄₈ sold far less than 70% of the time, and you had to be ~7% cheaper to get it. The site then shifts P₄₈ by that offset — the <b>Calibration</b> box at the top shows the measured offset and how many outcomes it rests on, and applies it once there are at least 150 outcomes with 25 in each bucket around the crossing. The same is done for P₂₄ with 24-hour outcomes. Until then the Poisson price stands as is. The best calibration data of all is your own listings: keep a ledger of card, buy price, list price, sold price and hours to sale from your first flip.</p>

<h3>7. When demand exceeds supply — the fix to apply later</h3>
<p><b>The signature:</b> Sell-thru ≥ 80%, Days supply under 3, Hrs to sale short, few Active copies. Copies vanish within hours of appearing.</p>
<p><b>The problem:</b> on such a card the count of sales is capped by the count of copies listed. Five copies in a month means at most five sales, so λ from counts comes out low — the model says 60% when reality is closer to 95%, prices too cautiously, and you pass on deals or list too cheap on exactly the cards where you could hold out. The error is in the safe direction, which is why it is tolerated for now.</p>
<p><b>The fix:</b> use time-to-sale, which supply cannot cap. If copies typically sell 20 hours after listing, buyers are arriving at least every 20 hours whether or not a copy exists. For an exponential wait the median is ln 2 ÷ λ, so</p>
<div class="formula">λ_wait = ln 2 ÷ (median hours to sale ÷ 24)     e.g. 20 h → 0.693 ÷ 0.833 = 0.83 sales/day</div>
<p>even if only five copies were ever listed. Because not every sold copy sat at rank 1, this still understates demand a little, which keeps it conservative.</p>
<p><b>What to do:</b> after two or three weeks, look at the Hot cards (candidate or confirmed) and compare their λ column with ln 2 ÷ (Hrs to sale ÷ 24). If the waiting-time number is consistently and clearly higher on the confirmed ones, switch the collector to use λ_wait whenever the signature above is present (Sell-thru ≥ 80% and Days supply &lt; 3, with at least 5 sales) — it is a few lines in compute_stats() in ebay_sweep.py. Do not switch before the data shows the gap; changing a model before you can check it is how you end up trusting the wrong number.</p>

<h3>8. Hot cards</h3>
<p>Five checks from history: k ≥ 5, Sell-thru ≥ 80%, median Hrs to sale ≤ 48, sales realized at ≥ 95% of the median ask, and the last five sales not more than 3% below the five before. Passing all five makes a <b>candidate</b>. The next three copies listed after the flag are then watched: all three selling within 48 hours makes it <b>confirmed</b> (a test on data the checks never saw); one sitting longer resets the count. Confirmed cards are the ones where you can pay close to full Max buy, because the exit is nearly certain — and where deals will be scarcest.</p>

<h3>9. Condition and the LP correction</h3>
<p>Demand and supply are condition-blind: a buyer who takes a Lightly Played copy is a real buyer, and an LP copy in the book is a real competitor. Price is not. So the Catalog counts NM, LP and unstated listings alike, but lifts every LP price to NM-equivalent (an LP sale at $83 is treated as $94.32 at a 12% correction) before computing the sold median, the book and P₄₈ — the Catalog's prices are NM prices. On Raw Data the correction runs the other way: a listing that says LP has its sell price cut by it, so its Max buy, Profit, ROI and verdict are for a played copy (hover Max buy to see the NM figure). Not-stated listings are treated as NM. MP and HP are a different market and stay out entirely.</p>
<p>The correction is read-only and shown next to Margin for three price tiers (under $100, $100–150, $150+), because condition costs more on an expensive card. It starts at 12% and is replaced by the measured LP-to-NM ratio — pooled across every card, since no single card has enough LP sales — once a tier has 30 LP sales behind it; a tier without enough sales uses the ratio measured across all tiers, and until that exists, the default. Hover a tier to see where it stands.</p>

<h3>10. What the model does not see</h3>
<p>Promoted listings outrank you at equal price. Auctions ending in the window soak up buyers. Best Offer sales are recorded at the ask, so sold prices can run ~10% high. Titles the parser cannot resolve to one card are skipped, not guessed — the Unmatched button on the Raw Data tab lists them. And the Browse API only reports sales for listings that were seen while live, so history starts the day the collector was switched on and grows forward.</p>
`;

/* ---------------- Column help ---------------- */
const pct = v => (v * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
const HELP = {
  card: {t: 'Card', f: 'PriceCharting product name = card name + [variant] + #number', m: 'Each printing is its own row with its own prices: a plain card, its [Reverse Holo], [Holo], [1st Edition] or [Shadowless] version are different products. The name links to the PriceCharting page.', e: '"Spinarak #6" and "Spinarak [Ditto] #6" are the same card number in the same set, at $0.83 and $15.24 — a seller who lists only "Spinarak 6/78" may not know which one they have.'},
  set: {t: 'Set', f: 'PriceCharting console-name', m: 'The set the card was printed in, in PriceCharting\'s naming. The table and the set dropdown are ordered by each set\'s release date.', e: '"Pokemon Base Set" (1999) sorts before "Pokemon Jungle" (1999-06) before "Pokemon Evolving Skies" (2021).'},
  num: {t: '#', f: 'the number after "#" at the end of the product name', m: 'The card\'s collector number within its set — printed on the card as 4/102 or 010/078. Set + number + variant uniquely identify a card. Kept as text because modern sets use prefixes (TG01, SV001, GG05).', e: 'Base Set #4 is Charizard; Jungle #4 is Kangaskhan. Same number, different cards.'},
  released: {t: 'Released', f: 'PriceCharting release-date', m: 'The card\'s original release date. Cards without one show "—" and their set is ordered by the earliest dated card in it.', e: '1999-01-09 for Base Set; 2022-07-01 for Pokémon Go.'},
  sales: {t: 'Sales/yr', f: 'PriceCharting sales-volume = units sold in the trailing 12 months, ALL grades combined', m: 'A liquidity measure — but it counts raw and graded sales together. For cheap modern cards almost nothing is graded, so it ≈ raw sales. For vintage cards graded sales can be most of it, so it overstates how often a raw copy sells. Use the Trend popup\'s "raw sale every N days" for the raw-only view.', e: 'Ivysaur #2 (1998 KFC): 45/yr in this column, but PriceCharting\'s page shows ungraded ≈ 12/yr, Grade 8 ≈ 12, PSA 10 ≈ 12, Grade 7 = 6, Grade 9 = 3. 12+6+12+3+12 ≈ 45.'},
  ungraded: {t: 'Ungraded $', f: 'PriceCharting loose-price', m: 'The market price of an ungraded copy — a trailing average of recent raw sales (mostly eBay). This is the anchor: every other number is measured against it. It only moves when new raw sales land, so a slow card\'s price can sit unchanged for weeks. It blends all conditions; a near-mint copy sells closer to the Grade 7–8 price.', e: 'If the anchor is $42.00 and a listing is $27.99 + $4 shipping, the listing is 76% of anchor before tax — then fees, shipping out and drift decide whether that is a deal (see Trend popup).'},
  d7: {t: 'Δ7d %', f: '(P_today − P_7_days_ago) / P_7_days_ago × 100', m: '"Did something just happen." On a slow card this is usually one sale landing, so pair it with a Sales/yr floor before trusting it. Sort descending for cards that just jumped (sell candidates), ascending for cards that just dropped.', e: '$42.00 today, $42.50 a week ago → (42.00 − 42.50) / 42.50 = −1.2%.'},
  d30: {t: 'Δ30d %', f: '(P_today − P_30_days_ago) / P_30_days_ago × 100', m: 'The core trend number and the one to sort by. Read it with Δ7d and the slope: 30d down but 7d flat and the slope flattening is a card that may be settling; all of them down is a card still falling. A drop is either mispricing (opportunity) or news (a reprint, a rotation) — the number cannot tell which.', e: '$42.00 today, $48.00 thirty days ago → (42.00 − 48.00) / 48.00 = −12.5%.'},
  pos: {t: 'Range 90d %', f: '(P_today − Low_90d) / (High_90d − Low_90d) × 100', m: 'Where today\'s price sits between its 90-day low (0%) and high (100%). Two cards can both be −12% over 30 days: one falling back from a spike (still at 85% of its range) and one making new lows (5%). Different bets. Ignore it when the range is tiny, and remember a low position during a steady decline is a falling knife — it is only a signal once the 30-day trend has flattened. Needs 60 days of history.', e: 'Low $38.00, high $52.00, today $42.00 → (42 − 38) / (52 − 38) = 4 / 14 = 29%.'},
  vd: {t: 'Volume drift 30d', f: 'Sales/yr_today − Sales/yr_30_days_ago   (and as % of the earlier value)', m: 'Because Sales/yr is a trailing 365-day count, the 30-day difference equals (sales in the last 30 days) minus (sales in the 30-day window that just fell out of the year — roughly the same month a year ago). So a positive number means this month beat the same month last year: a year-over-year demand signal that is automatically seasonally matched. It counts all grades, so on vintage cards it is mostly a graded-market signal, and small counts are noise — +2 on a base of 40 means nothing. Sorting and the range filter use the percent. Rising volume with a rising price is real heat; rising volume with a falling price is a supply flood (a reprint hitting the market), the pattern where a "bargain" keeps getting cheaper.', e: '210 today, 196 thirty days ago → +14 sales, +14 / 196 = +7.1%.'},
  vol: {t: 'Volatility %', f: 'median of |ln(P_t / P_t−1)| over the days the price moved in the last 90 days', m: 'The typical size of a move when the price moves. The median ignores a single wild day, which a standard deviation would not. It sizes the safety cushion in the buy gate: a card that moves 2% at a time can be bought at a thinner discount than one that moves 12%. Needs at least 3 moves.', e: 'Moves of 3.82%, 3.75%, 1.78%, 4.98%, 1.40%, 1.18% → sorted 1.18, 1.40, 1.78, 3.75, 3.82, 4.98 → median = (1.78 + 3.75) / 2 = 2.77%.'},
  ts: {t: 'Slope 30d %/mo (Theil–Sen)', f: 'median over every pair of days (i, j) in the last 30 days of (ln P_j − ln P_i) / (j − i), then converted to % per month: (e^(slope × 30) − 1) × 100', m: 'The robust trend: the median of all pairwise slopes, so one spike day barely moves it, unlike a fitted line. It is the drift used in the buy gate (only negative drift counts against the sell price). Δ30d uses two endpoints; this uses all 465 pairs, so it is the steadier version of the same idea. Needs 10 points in the window.', e: '31 daily prices sliding from $48 to $42 → median pairwise slope −0.00413 per day → e^(−0.00413 × 30) − 1 = −11.7% per month. A plain regression gave −0.44%/day here; add one spike day and the two diverge.'},
  ec_price: {t: 'Price $ (eBay)', f: 'median of the card\'s last 10 raw sale totals (item + shipping); until it has 3 sales, the cheapest comparable listing', m: 'The card\'s market price from eBay alone — what buyers actually paid, not what sellers ask. It is the number the $50–$150 default filter works on, and the yardstick for a listing\'s "vs price %".', e: 'Last 10 sale totals 92, 95, 96, 98, 99, 100, 101, 103, 105, 110 → median = (99 + 100) / 2 = $99.50.'},
  ec_k: {t: 'Sold 30d (k)', f: 'count of comparable raw listings that sold in the last 30 days', m: 'The raw evidence behind λ. "Comparable" = ungraded, condition NM/LP or not stated, seller ≥ 98%. Sales only exist for listings the collector saw while they were live, so this starts at zero and grows.', e: '13 sales counted → k = 13.'},
  ec_d: {t: 'Days observed (D)', f: 'days since the first listing of this card was seen, capped at 30', m: 'The denominator for rates. A card first seen 5 days ago with 2 sales is 0.4/day, not 2/30.', e: 'First seen 19 days ago → D = 19.'},
  ec_lam: {t: 'λ — raw sales per day', f: '25th percentile of Gamma(k + ½, D)   (posterior for a Poisson rate with a flat prior)', m: 'Expected raw buyers per day, stated conservatively: the value the true rate exceeds three times out of four. With few sales it reads well below k/D on purpose; after ~20 sales it converges. Everything in the pricing columns runs off this number.', e: 'k = 13, D = 19: k/D = 0.68/day, but λ = 0.57/day (25th percentile). k = 2, D = 10: k/D = 0.20 but λ = 0.11.'},
  ec_n: {t: 'Active (N)', f: 'number of comparable raw listings currently open for this card', m: 'The size of the book you would be competing in. Only comparable copies count (see Sold 30d).', e: '4 open NM/LP copies from ≥98% sellers → N = 4.'},
  ec_p: {t: 'p₁ p₂ p₃ — the book', f: 'the three cheapest comparable listings by total price (item + shipping); Best Offer copies ranked at 90% of ask', m: 'The prices you would have to beat. A Best Offer listing at $122 is shown as $109.80 because that is roughly what it will actually take. Depth pricing sits one dollar under pₙ.', e: 'Open copies $122 (BO), $123, $129 → p₁ = 109.80, p₂ = 123, p₃ = 129.'},
  ec_mu: {t: 'New/day (μ)', f: 'comparable listings first seen in the last 30 days ÷ D', m: 'The supply arrival rate — the counterpart of λ. Read it against λ in the In/out column.', e: '20 new comparable listings over 19 days → μ = 1.05/day.'},
  ec_dos: {t: 'Days of supply', f: 'N ÷ λ', m: 'How long the current book would take to clear at the observed demand. Under 7 = tight market, undercuts rare, price at pₙ − $1. Over 30 = glutted; sellers get impatient and the floor erodes — undercut by ~3% and do not count on rank 2.', e: 'N = 4, λ = 0.57 → 7.0 days.'},
  ec_io: {t: 'In/out (μ ÷ λ)', f: 'new listings per day ÷ sales per day', m: 'Above ~1.2 supply is piling up and the floor will be lower next week — your buy needs a bigger discount or a pass. Below ~0.8 supply is draining and prices firm. It is the eBay, raw-only version of PriceCharting\'s volume drift.', e: 'μ = 1.05, λ = 0.57 → 1.84: listings are arriving almost twice as fast as they sell.'},
  ec_smed: {t: 'Sold median $', f: 'median total (item + shipping) of the last 10 comparable raw sales', m: 'What buyers have actually been paying. It is the 24-hour price for a hot card whose book is empty, and the ceiling sanity check for everything else. Best Offer sales are recorded at the listed price, so they may overstate by ~10%.', e: 'Same ten sales as above → $99.50.'},
  ec_s80: {t: 'Sold 80th percentile $', f: '80th percentile of the last 10 comparable sale totals', m: 'The top of the realistic range: only one sale in five went higher. P₄₈ is capped here, and it is the list price for a ten-day sale on a hot card.', e: 'Ten sales 92 … 110 → 80th percentile ≈ $104.'},
  ec_hrs: {t: 'Hours to sale', f: 'median hours from listing to sale over the last 10 comparable sales', m: 'How fast copies actually move. Under 48 h is one of the five hot-card checks. Resolution is the tracker\'s cadence (about an hour for fast sales).', e: 'Sale times 4, 9, 15, 22, 30, 41, 55 h → median 22 h.'},
  ec_st: {t: 'Sell-through %', f: 'of comparable listings first seen 7–37 days ago, the share that sold within 7 days', m: 'Uses listings old enough to have had a fair chance. ≥ 80% is a hot-card check. Needs at least 3 such listings.', e: '9 of 11 eligible listings sold within a week → 82%.'},
  ec_n24: {t: 'n₂₄ / n₄₈ — depth', f: 'largest n (≤ 3) such that P(Poisson(λ·T) ≥ n) ≥ 70%, with T = 1 day for n₂₄ and 2 days for n₄₈', m: 'How many buyers you can count on in the window, at 70% confidence. The buyer who shows up takes the cheapest credible copy, so n is how deep in the book you can sit and still be reached: n = 2 means "even if one copy sells ahead of me, the second buyer is mine." n = 0 means fewer than one buyer is likely in that window — no 24/48-hour price exists; see Exp. days. Capped at 3 because buyers are not perfectly price-ordered that deep.', e: 'λ = 2.5: P(≥2 buyers in a day) = 71% → n₂₄ = 2; P(≥3) = 46% → not 3. λ = 0.57: P(≥1 in a day) = 43% → n₂₄ = 0; P(≥1 in two days) = 68% → n₄₈ = 0 (just short of 70%).'},
  ec_p24: {t: 'P₂₄ — 24-hour price', f: 'pₙ₂₄ − $1 when the book has at least n₂₄ comparable copies; otherwise the sold median (capped at p₁ − $1)', m: 'The buyer total (free shipping) at which the card sells within 24 hours with 70% probability. It is the auto-accept floor for Best Offer, and the price the Max buy column is derived from. Blank when n₂₄ = 0.', e: 'λ = 2.5 → n₂₄ = 2; book [96, 99, 104, 110] → P₂₄ = 99 − 1 = $98.'},
  ec_p48: {t: 'P₄₈ — 48-hour price', f: 'pₙ₄₈ − $1 when the book has at least n₄₈ copies; otherwise the sold 80th percentile (capped at p₁ − $1); never below P₂₄, never above the sold 80th percentile', m: 'The list price. Two days contain two full evening peaks, so this is the planned window; you list here with Best Offer on and auto-accept at P₂₄. Past 48 h each extra day adds ~1% to the price and ~11% to the capital cycle, which is a losing trade.', e: 'λ = 2.5 → n₄₈ = 3 (P(≥3 buyers in 2 days) = 88%); book [96, 99, 104, 110] → P₄₈ = 104 − 1 = $103; capped at the 80th percentile of sales if that is lower.'},
  ec_pw: {t: 'Window $ — honest-window price', f: 'p₁ − $1 (or the sold median with an empty book), capped at the sold 80th percentile', m: 'For cards where no 24/48-hour price exists (n = 0): the price at which you are the cheapest copy, to be sold within Exp. days. Max buy falls back to this so slow cards still get a gate.', e: 'Book [110 (BO → 99), 123, 129] → window price = 99 − 1 = $98, expected sale in 2.1 days.'},
  ec_prob: {t: 'P(sale ≤ 24 h) %', f: '1 − e^(−λ)   (rank 1, one day)', m: 'The chance at least one buyer arrives within a day while you are the cheapest copy. Above 85% is what a confirmed hot card looks like without pricing for it.', e: 'λ = 2.0 → 1 − e⁻² = 86%. λ = 0.57 → 43%.'},
  ec_edays: {t: 'Expected days (70%)', f: '−ln(1 − 0.70) ÷ λ = 1.2 ÷ λ', m: 'Days at rank 1 until a sale is 70% likely. The honest window when 24/48-hour selling is not on offer. Judge flips by profit per day, and this is the denominator.', e: 'λ = 0.57 → 1.2 ÷ 0.57 = 2.1 days. λ = 0.1 → 12 days: not a flip card.'},
  ec_maxbuy: {t: 'Max buy $ (all-in)', f: 'net = P × (1 − 0.1325 × 1.065) − $0.30 − $4.50;   max buy = net ÷ 1.15   where P = P₂₄, else P₄₈, else Window $', m: 'The most you can pay in total — item + shipping + your sales tax — and still clear a 15% margin after eBay\'s fee (charged on the buyer\'s total including their tax), the fixed fee and tracked shipping out. The column notes which price it came from. A listing PASSes when its all-in is at or below this.', e: 'P₂₄ = $98 → net = 98 × 0.859 − 4.80 = $79.37 → max buy = 79.37 ÷ 1.15 = $69.02, i.e. about a $61 item price with $4 shipping and 6.25% tax.'},
  ec_net: {t: 'Net $ — proceeds at the sell price', f: 'P × (1 − 0.1325 × 1.065) − $0.30 − $4.50   where P = P₂₄, else P₄₈, else Window $ (the basis noted on Max buy)', m: 'What lands in your account if the card sells at the gate\'s price: the buyer total minus eBay\'s fee (charged on the total including the buyer\'s tax), the fixed fee and tracked shipping out. Depends on Confidence (through P) but not on Margin — Margin only decides how much of this you may spend on the buy.', e: 'P₄₈ = $95 → 95 × 0.8589 − 4.80 = $76.79.'},
  ec_hot: {t: 'Hot', f: 'all five checks pass: k ≥ 5 · sell-through ≥ 80% · median hours to sale ≤ 48 · sold median ≥ 95% of the median ask · last 5 sales ≥ 97% of the 5 before', m: '"Candidate" means the history says demand outruns supply. "Confirmed" (✓) means the next three copies listed after the flag all sold within 48 hours — a test on data the checks never saw. A copy that sits more than 48 h resets the count. "fails n" tells you how many checks a card with enough sales is missing; hover for which.', e: 'A card with 13 sales, 82% sell-through, 22 h median, prices realized at ask and a flat trend is a candidate; three quick sales later it is confirmed.'},
  ec_book: {t: 'Book', f: 'the live data behind this card\'s row', m: 'Opens the competing listings (ranked, with links) and the recent sales with their time to sale. This is what to look at before every buy: whether the floor is a credible copy, whether the sales were Best Offer (recorded at ask, so possibly lower), and what condition sold.', e: ''},
  et_spm: {t: 'Sales/month (eBay)', f: 'raw sales recorded in the last 30 days, from the daily rollup', m: 'The eBay counterpart of PriceCharting\'s sales/yr, but raw-only and monthly. Today it equals Sold 30d; it lives in the Trends band because it is the series the Volume drift and the Trend chart are built on.', e: '13 sales in the last 30 days → 13.'},
  et_d7: {t: 'Δ7d % (eBay)', f: '(P_now ÷ P_7 days ago − 1) × 100, where P = trailing 7-day median of raw sale totals', m: 'The eBay price line is the median of what raw copies actually sold for in the last 7 days (needs 3 sales in the window, else blank). This is its one-week change. On thin cards it moves because different copies sold, not because the market moved — trust it on cards with dozens of sales.', e: 'P today $87.62, P a week ago $88.30 → −0.8%.'},
  et_d30: {t: 'Δ30d % (eBay)', f: '(P_now ÷ P_30 days ago − 1) × 100', m: 'One-month change of the 7-day median sale price. Needs 30 days of eBay history.', e: '$87.62 vs $91.00 → −3.7%.'},
  et_pos: {t: 'Range 90d % (eBay)', f: '(P_now − Low90) ÷ (High90 − Low90) × 100 over the 7-day median series', m: '0% = at the 90-day low of realized raw prices, 100% = at the high. Needs 60 days of history and 10 valid points.', e: 'Low $85.72, high $100.17, now $87.62 → 13%.'},
  et_vd: {t: 'Volume drift 30d (eBay)', f: 'sales in the last 30 days − sales in the 30 days before, and the % change', m: 'Month-over-month demand. PriceCharting\'s version compares against the same month a year earlier (seasonal); eBay history starts now, so this is month-over-month until a year has passed. Rising sales with a falling price = supply flood; rising sales with a rising price = real demand. Needs 60 days.', e: '55 sales vs 48 the month before → +7 (+14.6%).'},
  et_vol: {t: 'Volatility % (eBay)', f: 'median |ln(P_t ÷ P_t−1)| over days in the last 90 where the 7-day median changed; needs 3 changes', m: 'The typical day-to-day move of the realized price. Includes sampling noise on thin cards (which three copies sold), so it reads higher than PriceCharting\'s.', e: 'Daily moves of 0.3%, 0.4%, 0.5%, 1.1% → median 0.45%.'},
  et_ts: {t: 'Slope 30d %/mo (eBay)', f: 'Theil–Sen median of pairwise slopes of ln P over the last 30 days, shown as (e^(slope × 30) − 1) × 100', m: 'The robust trend of realized raw prices: the middle of all pairwise slopes, so one odd sale does not move it. Needs 30 days and 10 valid points. Negative = drifting down.', e: 'Median pairwise slope −0.00178/day → (e^(−0.0534) − 1) × 100 = −5.2%/mo.'},
  et_trend: {t: 'Trend (eBay)', f: 'the daily rollup behind the Trends band', m: 'Opens the chart: bars are raw sales per day, the blue line the 7-day median sale price, the green line the cheapest comparable ask that day, dashed lines the 90-day high/low and P₄₈. Same controls as the PriceCharting chart. The stats strip below it shows the trend columns and the pricing numbers side by side.', e: ''},
  er_listed: {t: 'Listed within (h)', f: 'hours since the listing was created on eBay', m: 'Deals on liquid cards are gone in minutes to hours, so the freshest rows matter most. The filter takes one number: type 2 to see only listings posted in the last 2 hours. The tab holds listings first seen in the last 24 hours; sold or ended ones stay visible with their status.', e: '0.3 = listed about 20 minutes ago.'},
  er_title: {t: 'eBay title', f: 'the seller\'s title, linked to the listing', m: 'What the parser matched to the catalog card in the first columns. Always read it before buying: variant words (reverse, 1st edition, shadowless), condition claims and anything odd. If the match looks wrong, that is a parser pattern to fix — the Unmatched button shows the ones it refused.', e: '"Charizard ex 199/165 Obsidian Flames SIR NM" → Charizard ex #199, Pokemon Obsidian Flames.'},
  er_item: {t: 'Item $ / Ship $', f: 'the listed price and the seller\'s shipping charge to your ZIP', m: 'Calculated shipping is estimated for the ZIP the collector was given. "free" means the seller folded shipping into the item.', e: '$118 + $4 shipping.'},
  er_total: {t: 'Total $', f: 'item + shipping', m: 'The buyer total, which is how everything else on the eBay tabs is measured (sold prices, the book, P₂₄).', e: '118 + 4 = $122.'},
  er_allin: {t: 'All-in $', f: 'item + shipping + item × 6.25% (MA sales tax)', m: 'What actually leaves your account. This is the number compared to Max buy.', e: '118 + 4 + 7.38 = $129.38.'},
  er_vs: {t: 'vs price %', f: '(total ÷ card price − 1) × 100', m: 'How far the listing sits below (negative) or above the card\'s eBay price. It is the mispricing at a glance; the verdict is the same idea after fees and margin.', e: 'Total $98, card price $122 → −19.7%.'},
  er_profit: {t: 'Profit $ — for this listing', f: 'Net $ of the card − All-in $ of the listing', m: 'What you would clear buying this copy at its price and selling at the card\'s gate price. Negative means the listing is above break-even. Depends on Confidence through Net, and on nothing else — it is the same number whatever Margin you set; Margin only decides where PASS starts.', e: 'Net $76.79, all-in $61.20 → $15.59.'},
  er_roi: {t: 'ROI % — for this listing', f: 'Profit $ ÷ All-in $ × 100', m: 'Return on the cash tied up in this copy. PASS is exactly ROI ≥ your Margin setting. Sort the tab by this column descending to see the best buys first; judge against the card\'s Exp. days for profit per day.', e: '$15.59 ÷ $61.20 = 25.5% — above a 15% margin, so it passes.'},
  er_time: {t: 'Time (h)', f: 'hours from listing to sale / end / gone; for an open listing, hours open so far (greyed)', m: 'How long this copy took to move, or how long it has been sitting. Read it against the card\'s Hrs to sale: a copy that sold in 3 hours on a card whose median is 40 says the price was low; an open copy past the median says it is priced above the buyers.', e: 'sold, 6.5 = it sold six and a half hours after listing. open, 30.2 = listed 30 hours ago and still for sale.'},
  lp: {t: 'LP correction (%)', f: 'per price tier: 1 − median over LP sales of (LP sale total ÷ median NM/unstated sale total of the same card within ±7 days)', m: 'How much less a Lightly Played copy sells for than a Near Mint one. It is used twice: inside the eBay Catalog every LP price is lifted to NM-equivalent (an LP sale at $83 counts as $94.32 at 12%), so Price, the book and P₄₈ are NM prices; and on Raw Data a listing that says LP has its sell price cut by it, so its Max buy, Profit, ROI and verdict are for a played copy. Not-stated listings are treated as NM. The number is read-only: it starts at 12% and is replaced by the measured ratio for a tier once that tier has 30 LP sales behind it (green outline); until then a tier uses the ratio measured across all tiers, and until that has 30 sales, the default. Hover a tier for where it stands. Pooled across all cards because one card never has enough LP sales to measure on its own; split by price tier because condition costs more on an expensive card.', e: 'A card sells NM at $95 and its LP copies at $83 → ratio 0.874 → 12.6% discount. If the <$100 tier has 41 such sales with a median of 0.90, that tier shows 10.0%.'},
  er_verdict: {t: 'Verdict', f: 'PASS if all-in ≤ Max buy; otherwise the first reason it fails', m: 'PASS = it clears the gate on price alone — still read the title, photos and seller before buying. "too cheap – scam check" fires under 50% of the card price: stock photos, a new seller or a vague title there means walk away. "no sales yet" = the card has listings but no observed sales, so there is no λ and no Max buy yet.', e: 'All-in $129.38 vs Max buy $77.08 → "over max buy".'},
  er_cond: {t: 'Cond', f: 'condition words found in the title: NM, LP, MP, HP (n/s = not stated)', m: 'Only NM, LP and not-stated copies count as comparable. An LP listing gets the LP correction applied to its Max buy; not stated is treated as NM. MP/HP copies are shown but fail the gate, and they are excluded from the book and the sales history. The Condition chip in the filters shows or hides each of NM, LP and n/s (MP/HP rows appear only when all three are ticked).', e: '"Near Mint" or "NM" → NM; "lightly played" → LP.'},
  er_bo: {t: 'Offer', f: 'BO = the listing accepts Best Offers', m: 'You can usually get ~10% under the ask; the book ranks these copies at 90% for that reason. When one of these sells, the recorded price is the ask, so it may overstate the true sale.', e: ''},
  er_seller: {t: 'Seller fb / %', f: 'the seller\'s feedback count and positive percentage', m: 'The gate wants ≥ 98% (blank is tolerated). For raw cards, also prefer ≥ 50 feedback — a brand-new seller with a too-cheap card is the classic scam profile.', e: '512 feedback at 99.5%.'},
  er_status: {t: 'Status', f: 'open · sold · ended · gone · stale', m: 'open = still for sale at last check. sold = eBay reports a sale (the collector confirms every vanished listing with a lookup). ended = withdrawn or expired unsold. gone = no longer retrievable. stale = followed for 30 days without a sale. Sold and ended rows are the raw material for λ and the sold prices.', e: ''},
  trend: {t: 'Trend', f: 'one point per day from the site\'s own snapshots', m: 'Opens the card\'s daily history: sales/yr bars on the left axis, ungraded / retail buy / retail sell on the right, dashed lines for the 90-day high and low and the conservative sell estimate, a hover crosshair, all the statistics, and the buy-gate arithmetic for this card. The history starts the day the site went live and grows by one point each morning.', e: ''}
};
// what each eBay column is built from, and what is built from it (shown in the help popup)
const LINKS = {
  ec_k: ['eBay tracker outcomes', 'λ, Sell-thru, Hot'], ec_d: ['first sighting of the card', 'λ, New/day'],
  ec_n: ['open comparable listings', 'Days supply, n → P₂₄/P₄₈ (the book must be at least n deep)'],
  ec_p: ['open comparable listings, Best Offer haircut', 'P₂₄, P₄₈, Window, Price (when no sales yet)'],
  ec_mu: ['listings first seen in 30 d, Days obs.', 'In/out'], ec_smed: ['last 10 sales', 'Price, P₂₄ fallback, Hot (realized check)'],
  ec_s80: ['last 10 sales', 'P₄₈ fallback and cap, Window cap'], ec_hrs: ['last 10 sales', 'Hot; the future waiting-time λ (see README)'],
  ec_st: ['listings seen 7–37 d ago', 'Hot'],
  ec_lam: ['Sold 30d, Days obs.', 'n₂₄, n₄₈, Days supply, In/out, P(≤24h), Exp. days'],
  ec_price: ['Sold med (or p₁)', 'the $50–150 filter, vs price %, the scam check'], ec_dos: ['Active, λ', 'reading only'], ec_io: ['New/day, λ', 'reading only'],
  ec_n24: ['λ, Confidence', 'P₂₄, P₄₈'], ec_p24: ['n₂₄, the book, Sold med, calibration', 'Max buy (first choice), Best Offer auto-accept'],
  ec_p48: ['n₄₈, the book, Sold 80%, calibration', 'Max buy (second choice), your list price'], ec_pw: ['p₁ or Sold med, Sold 80%', 'Max buy (last resort)'],
  ec_prob: ['λ', 'reading only'], ec_edays: ['λ, Confidence', 'reading only'],
  ec_maxbuy: ['P₂₄ / P₄₈ / Window, Margin, fee, shipping', 'Verdict on the Raw Data tab'],
  ec_hot: ['Sold 30d, Sell-thru, Hrs to sale, Sold med vs asks, price trend', 'reading only'],
  et_spm: ['daily rollup of sales', 'Volume drift, the Trend chart'], et_d7: ['7-day median sale price series', 'reading only'], et_d30: ['7-day median sale price series', 'reading only'],
  et_pos: ['7-day median sale price series (90 d)', 'reading only'], et_vd: ['Sales/month now vs the month before', 'reading only'],
  et_vol: ['7-day median sale price series (90 d)', 'reading only'], et_ts: ['7-day median sale price series (30 d)', 'reading only'],
  er_allin: ['Item, Ship, your sales tax', 'Verdict, Profit'], er_verdict: ['All-in, Max buy, Cond, Seller %, Card price', '—'], er_vs: ['Total, Card price', 'reading only'],
  ec_net: ['P₂₄ / P₄₈ / Window, fee, shipping out', 'Max buy, Profit $ on the Raw Data tab'],
  er_profit: ['Net $ of the card (LP-adjusted for LP listings), All-in $ of the listing', 'ROI %'], er_roi: ['Profit $, All-in $', 'reading only (PASS = ROI ≥ Margin)'],
  lp: ['LP sales vs NM/unstated sales of the same card, pooled by price tier', 'Catalog prices (NM-equivalent), Max buy / Profit / ROI / Verdict of LP listings'],
  er_time: ['listing time and outcome time', 'reading only; compare with Hrs to sale'],
};
function openHelp(key) {
  const h = HELP[key]; if (!h) return;
  $('htitle').textContent = h.t;
  const L = LINKS[key];
  $('hbody').innerHTML = '<h4>Formula</h4><div class="formula">' + esc(h.f) + '</div><h4>What it means</h4><p>' + esc(h.m) + '</p>' + (h.e ? '<h4>Example</h4><p>' + esc(h.e) + '</p>' : '') +
    (L ? '<h4>Built from</h4><p>' + esc(L[0]) + '</p><h4>Feeds into</h4><p>' + esc(L[1]) + '</p>' : '');
  $('hov').classList.add('open');
}
$('readme-btn').addEventListener('click', () => { $('rbody').innerHTML = README; $('rov').classList.add('open'); });
$('rclose').addEventListener('click', () => $('rov').classList.remove('open'));
$('rov').addEventListener('click', e => { if (e.target === $('rov')) $('rov').classList.remove('open'); });
document.querySelectorAll('.help').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openHelp(b.dataset.h); }));
$('hclose').addEventListener('click', () => $('hov').classList.remove('open'));
$('hov').addEventListener('click', e => { if (e.target === $('hov')) $('hov').classList.remove('open'); });

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
