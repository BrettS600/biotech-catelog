/* ---------------- The PriceCharting tab's graded view (2026-10-28, Brett) ----------------
   "On the price charting tab ... an option to toggle to only show graded cards, and one that only shows raw cards ...
   I must select one or the other ... If I deselect both, then price chart populates the list to include both";
   "a grading button ... the toggles allow me to select the grade and grader, e.g. psa 10 or cgc 9 ... turn on all
   toggles and turn off all toggles"; the graded columns (PSA / CGC ID, CL set name / number / card name / rarity /
   release / graded, CL sales, PC to CL %, Review, Flag ...), PC's columns renamed (PC Set, PC Graded, $eBay Anchor,
   eBay to PC Difference, PSA Trend); every view keeps its own columns, filters and order (store pcg / pca), and
   everything chosen survives a refresh. Data: graded.bin (graded_site.py, built each morning from the private
   card-data repo), the trend lines gtrend/s<n>.bin. Only Card Ladder's PSA and CGC grades. Lives in its own file
   (stitched after help.js) so app.js stays as it was. */
const GR = {doc: null, rows: [], allRows: null, err: null, loading: null, trend: new Map(), cur: null};
const GR_GK_DEFAULT = ['psa|g10', 'psa|g9', 'psa|g8_5', 'psa|g8', 'psa|g7', 'psa|g6', 'psa|g5', 'psa|g4', 'psa|g3', 'psa|g2', 'psa|g1_5', 'psa|g1',
  'cgc|g10perfect', 'cgc|g10pristine', 'cgc|g10', 'cgc|g9_5', 'cgc|g9', 'cgc|g8_5', 'cgc|g8', 'cgc|g7_5', 'cgc|g7', 'cgc|g6_5', 'cgc|g6', 'cgc|g5_5', 'cgc|g5',
  'cgc|g4_5', 'cgc|g4', 'cgc|g3_5', 'cgc|g3', 'cgc|g2_5', 'cgc|g2', 'cgc|g1_5', 'cgc|g1'];
const grGK = () => (GR.doc && GR.doc.gk) || GR_GK_DEFAULT;
const grLabel = gk => { const [g, x] = String(gk).split('|'); const v = x.replace(/^g/, '').replace('_', '.').replace('perfect', ' Perfect').replace('pristine', ' Pristine'); return g.toUpperCase() + ' ' + v; };
const GR_SEL_DEFAULT = ['psa|g10', 'psa|g9', 'cgc|g10', 'cgc|g10pristine'];
const grLS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const grSave = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
let GSEL = new Set(grLS('pcg-grades', GR_SEL_DEFAULT));
let PCMODE = grLS('pc-mode', 'raw');                       // 'raw' | 'graded' | 'all' (neither button on)
const GMARKS = grLS('gmarks', {});                         // 'cid|gk' -> {v: 1 same | 0 not | null, reason, note, t}: answers echoed here until the data carries them
const gdash = '<td class="ctr"><span class="dim">-</span></td>';
const GR_CL_IMG = s => !s ? '' : s.startsWith('fb:') ? 'https://firebasestorage.googleapis.com/v0/b/cardladder-71d53.appspot.com/o/' + s.slice(3) + '?alt=media'
  : s.startsWith('eb:') ? 'https://i.ebayimg.com/images/g/' + s.slice(3) + '/s-l1600.jpg' : s.startsWith('u:') ? s.slice(2) : '';
const grClUrl = pid => pid ? 'https://app.cardladder.com/profiles/' + encodeURIComponent(pid) : '';

/* ---- the rows ----
   graded row: 0 card id, 1-4 PC card / set / number / release, 5 Sales/yr, 6 PC Graded $, 7 Δ7d, 8 Δ30d, 9 range 90d,
   10 / 11 volume drift (none for a grade), 12 volatility, 13 slope, 14 / 15 PC rarity / finish, 16 PC sales last month
   (this grade), 17 that month, 18-23 the eBay columns (none for graded copies yet), 24 grade order, 25 grade label,
   26 grader, 27 ID text, 28 ID link, 29 CL card name, 30 CL set, 31 CL link, 32 CL number, 33 CL rarity/finish,
   34 CL release, 35 CL Graded $, 36 PC to CL %, 37 CL sales last month, 38 graded this past month, 39 number graded
   last month, 40 graded : PC sales ratio, 41 your answer, 42 flag reason, 43 PC price source, 44 PC pop, 45 CL pop,
   46 CL last sold, 47 CL average last month, 48 raw row?, 49 profile id, 50 grade key, last: the order key. */
function grBuildRows() {
  const d = GR.doc; if (!d) return [];
  const out = [];
  for (const x of d.rows) {
    const cid = x[0], base = idRow.get(cid), c = d.cards[String(cid)] || {}, cl = c.cl || [];
    if (!base) continue;
    const gk = d.gk[x[1]], grader = gk.split('|')[0].toUpperCase();
    const m = GMARKS[cid + '|' + gk];
    const idText = grader === 'PSA' ? (c.spec ? 'PSA ' + c.spec : c.pcert ? 'PSA cert ' + c.pcert : '') : (c.cgc ? 'CGC ' + c.cgc : c.ccert ? 'CGC cert ' + c.ccert : '');
    const idUrl = grader === 'PSA' ? (c.pcert ? 'https://www.psacard.com/cert/' + c.pcert + '/psa' : grClUrl(c.pid))
                                   : (c.ccert ? 'https://www.cgccards.com/certlookup/' + c.ccert + '/' : grClUrl(c.pid));
    const pcp = x[2], clv = x[6];
    const r = [cid, base[1], base[2], base[3], base[4], base[5], pcp, x[11], x[12], x[13], null, null, x[14], x[15], base[14], base[15],
      x[4], d.lastm, null, null, null, null, null, null, x[1], grLabel(gk), grader, idText, idUrl,
      cl[4] || null, cl[2] || null, grClUrl(c.pid), cl[3] || null, cl[5] || null, cl[1] || null, clv,
      pcp && clv ? Math.round((clv - pcp) / pcp * 1000) / 10 : null, x[8], null, null, null,
      m && m.v !== undefined ? m.v : x[16], m && m.reason !== undefined ? m.reason : x[17], x[3], x[5], x[10], x[7], x[9], false, c.pid || '', gk,
      ordOf(base) * 64 + 1 + x[1]];
    out.push(r);
  }
  return out;
}
function grRawRow(base) {                                   // a raw card in the both-view: the graded layout, Grade "Raw"
  return [base[0], base[1], base[2], base[3], base[4], base[5], base[6], base[7], base[8], base[9], base[10], base[11], base[12], base[13], base[14], base[15],
    base[16], base[17], base[18], base[19], base[20], base[21], base[22], base[23], -1, 'Raw', '', '', '', null, null, '', null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null, true, '', 'raw', ordOf(base) * 64];
}
async function grLoad() {
  if (GR.doc) return GR.doc;
  if (GR.loading) return GR.loading;
  GR.loading = (async () => {
    try {
      if (!HKEY) throw new Error('This page has no key for the graded data yet.');
      const res = await fetch('graded.bin', {cache: 'no-store'});
      if (!res.ok) throw new Error(res.status === 404 ? 'No graded data has been built yet.' : 'HTTP ' + res.status);
      GR.doc = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
      GR.rows = grBuildRows(); GR.allRows = null; GR.err = null;
    } catch (e) { GR.err = e.message; GR.rows = []; }
    GR.loading = null; grNote(); return GR.doc;
  })();
  return GR.loading;
}
function grAll() {                                          // the both-view: every raw card plus the graded rows
  if (!GR.allRows) GR.allRows = DATA.map(grRawRow).concat(GR.rows).sort((a, b) => ordOf(a) - ordOf(b));   // each card's graded rows under its raw row
  return GR.allRows;
}

/* ---- cells ---- */
const grMoney = v => v == null ? gdash : '<td class="num">' + fmtMoney(v) + '</td>';
const grInt = v => v == null ? gdash : '<td class="num">' + fmtInt(v) + '</td>';
const grPct = (v, signed = true, nd = 1) => v == null ? gdash : '<td class="num">' + fmtPct(v, signed, nd) + '</td>';
const grText = v => v == null || v === '' ? gdash : '<td>' + esc(v) + '</td>';
function grSrcTitle(r) {
  const s = String(r[43] || '');
  if (s === 'pc') return 'PriceCharting’s ' + r[25] + ' price';
  if (s === 'mixed') return 'PriceCharting’s grade ' + r[25].split(' ')[1] + ' price: it blends every grader (PSA, CGC, BGS ...)';
  if (s === 'formula') return 'PriceCharting’s CGC 10 price is its formula (0.40 x PSA 10), not a market price';
  const m = /^sales:(\d+):(\d+)/.exec(s);
  if (m) return 'Median of the ' + m[1] + ' ' + r[25] + ' sales PriceCharting recorded in the last ' + m[2] + ' days (its listed price blends graders)';
  return '';
}
function grRow(r) {
  if (r[48]) return grRawCells(r);
  const pcSrc = grSrcTitle(r), mixed = r[43] === 'mixed' || r[43] === 'formula';
  return '<td><b>' + esc(r[25]) + '</b></td>' +
    cells4(r, pcRFCell(pcRF(r)), '', (pcRF(r) || [])[0]) +
    (r[27] ? '<td><a href="' + esc(r[28]) + '" target="_blank" rel="noopener" title="' + (r[26] === 'PSA' ? 'PSA’s spec number for the card; opens the PSA cert of a slab that proved the match' : 'CGC’s number for the card; opens the CGC cert of a slab that proved the match') + '">' + esc(r[27]) + '</a></td>' : gdash) +
    grText(r[29]) +
    (r[30] ? '<td><a href="' + esc(r[31]) + '" target="_blank" rel="noopener" title="Open the card on Card Ladder">' + esc(r[30]) + '</a></td>' : gdash) +
    grText(r[32]) + grText(r[33]) + grText(r[34]) +
    grInt(r[5]) +
    (r[6] == null ? gdash : '<td class="num' + (mixed ? ' gmix' : '') + '" title="' + esc(pcSrc) + '">' + fmtMoney(r[6]) + (mixed ? '<sup>*</sup>' : '') + '</td>') +
    grMoney(r[35]) +
    (r[36] == null ? gdash : '<td class="num">' + fmtPct(r[36], true, 1) + '</td>') +
    grPct(r[7]) + grPct(r[8]) + grPct(r[9], false, 0) + gdash + grPct(r[12], false, 2) + grPct(r[13]) +
    grInt(r[16]) + grInt(r[37]) + gdash + gdash + gdash +
    gdash + gdash + gdash + gdash + gdash + gdash +
    '<td><button class="tbtn gtbtn" data-k="' + r[0] + '|' + esc(r[50]) + '">Trend</button></td>' +
    '<td><button class="rvb grvb' + (r[41] === 1 ? ' same' : r[41] === 0 ? ' diff' : '') + '" data-k="' + r[0] + '|' + esc(r[50]) + '" title="' + (r[41] === 1 ? 'You said: same card' : r[41] === 0 ? 'You said: not the same card' : 'Compare PriceCharting’s card with Card Ladder’s') + '">Review</button></td>' +
    '<td class="gflc">' + (r[42] ? '<button class="gflag on" data-k="' + r[0] + '|' + esc(r[50]) + '" title="' + esc('Flagged: ' + r[42]) + '">⚑ ' + esc(r[42]) + '</button>' : '<button class="gflag" data-k="' + r[0] + '|' + esc(r[50]) + '" title="Record a wrong PriceCharting-to-Card Ladder match">⚐</button>') + '</td>';
}
function grRawCells(r) {                                    // a raw card in the both-view (the raw tab's figures, the CL columns empty)
  return '<td><span class="dim">Raw</span></td>' + cells4(r, pcRFCell(pcRF(r)), '', (pcRF(r) || [])[0]) +
    gdash + gdash + gdash + gdash + gdash + gdash + grInt(r[5]) + grMoney(r[6]) + gdash + gdash +
    grPct(r[7]) + grPct(r[8]) + grPct(r[9], false, 0) +
    '<td class="num">' + (r[10] == null ? dash : '<span class="' + (r[11] > 0 ? 'up' : r[11] < 0 ? 'down' : '') + '">' + (r[11] > 0 ? '+' : '') + r[11] + ' (' + (r[10] > 0 ? '+' : '') + r[10].toFixed(1) + '%)</span>') + '</td>' +
    grPct(r[12], false, 2) + grPct(r[13]) +
    pcSalesCell(r[16], r[17]) + gdash + gdash + gdash + gdash +
    kmCell(r[18]) + '<td class="num">' + fmtInt(r[19]) + '</td>' + '<td class="num">' + fmtMoney(r[20]) + '</td>' +
    '<td class="num">' + (r[21] == null ? dash : '<span class="' + (r[21] < -40 || r[21] > 200 ? 'down' : '') + '">' + fmtPct(r[21], true, 0) + '</span>') + '</td>' +
    hitsCell(r[22]) + hitPctCell(r[23], null) +
    '<td><button class="tbtn" data-i="' + ordOf(idRow.get(r[0]) || r) + '">Trend</button></td>' + gdash + gdash;
}

/* ---- the two tables (graded / both) ---- */
const GR_RANGES = [5, 6, 35, 36, 7, 8, 9, 12, 13, 16, 37, 38, 39, 18, 19, 20, 21, 22, 23];
const GR_LABELS = {5: 'Sales/yr', 6: 'PC Graded (latest)', 35: 'CL Graded (latest)', 36: 'PC to CL %', 7: 'Δ7d %', 8: 'Δ30d %', 9: 'Range 90d %', 12: 'Volatility %', 13: 'Slope %/mo',
  16: 'PC sales', 37: 'CL sales', 38: 'Graded this mo', 39: 'Graded last mo', 18: 'eBay last mo', 19: 'eBay this mo', 20: '$eBay Anchor', 21: 'eBay to PC %', 22: 'Hits 30d', 23: 'Hit %'};
const grCfg = (rows, noun) => ({rows, noun, ranges: GR_RANGES, labels: GR_LABELS, defaults: {},
  fav: {s: 'pc', k: r => r[0], c: r => r[0]},
  extra: r => r[48] || GSEL.has(r[50]),
  hay: r => [r[1], r[2], r[14], r[15], r[25], r[29], r[30], r[27]].filter(Boolean).join(' '),
  row: grRow, root: null});
const GR_TABLES = {pcg: Object.assign(grCfg(() => GR.rows, 'graded rows'), {root: '#pcv-g', name: 'PriceCharting · graded'}),
                   pca: Object.assign(grCfg(grAll, 'rows'), {root: '#pcv-a', name: 'PriceCharting · raw + graded'})};
for (const id in GR_TABLES) if ($('rows-' + id)) tables[id] = makeTable(id, GR_TABLES[id]);

/* ---- Only show raw / Only show graded (one or the other, or neither = both) ---- */
function grNote() {
  const n = $('gm-note'); if (!n) return;
  if (PCMODE === 'raw') { n.textContent = ''; return; }
  n.innerHTML = GR.err ? '<span class="warn">' + esc(GR.err) + '</span>'
    : !GR.doc ? 'Loading the graded data…'
    : GR.rows.length.toLocaleString('en-US') + ' graded rows over ' + Object.keys(GR.doc.cards).length.toLocaleString('en-US') + ' cards matched to Card Ladder (built ' + esc(GR.doc.built) + ')';
}
function grPaintGrades() { const b = $('gm-gn'); if (b) b.textContent = '(' + GSEL.size + ')'; }
function grShowMode() {
  const raw = PCMODE === 'raw', g = PCMODE === 'graded', all = PCMODE === 'all';
  $('gm-raw').classList.toggle('on', raw); $('gm-raw').setAttribute('aria-pressed', raw);
  $('gm-g').classList.toggle('on', g); $('gm-g').setAttribute('aria-pressed', g);
  $('pcv-raw').hidden = !raw; $('pcv-g').hidden = !g; $('pcv-a').hidden = !all;
  grNote(); grPaintGrades();
  if (!raw) grLoad().then(() => { if (tables.pcg && !$('pcv-g').hidden) { tables.pcg.resync(); tables.pcg.apply(); } if (tables.pca && !$('pcv-a').hidden) { GR.allRows = null; tables.pca.resync(); tables.pca.apply(); } });
}
function grSetMode(m) { PCMODE = m; grSave('pc-mode', m); grShowMode(); }
$('gm-raw').addEventListener('click', () => grSetMode(PCMODE === 'raw' ? 'all' : 'raw'));
$('gm-g').addEventListener('click', () => grSetMode(PCMODE === 'graded' ? 'all' : 'graded'));

/* ---- the Grading button: which grades and graders the graded rows show ---- */
function grOpenGrades() {
  const gk = grGK(), col = g => gk.filter(k => k.startsWith(g + '|'));
  const box = k => '<label><input type="checkbox" data-gk="' + k + '"' + (GSEL.has(k) ? ' checked' : '') + '> ' + esc(grLabel(k)) + '</label>';
  $('btitle').textContent = 'Grading · PriceCharting';
  $('bsub').textContent = 'Tick the grades to show as graded rows (one row per card per grade). Remembered in this browser; the graded and both views use the same ticks.';
  $('bbody').innerHTML = '<div class="gpick"><div><h4>PSA</h4>' + col('psa').map(box).join('') + '</div><div><h4>CGC</h4>' + col('cgc').map(box).join('') + '</div></div>' +
    '<div class="pickbtns"><button class="reset" id="gp-all">Turn all on</button><button class="reset" id="gp-none">Turn all off</button><button class="reset" id="gp-done">Done</button></div>';
  const sync = () => $('bbody').querySelectorAll('.gpick input').forEach(i => { i.checked = GSEL.has(i.dataset.gk); });
  const changed = () => { grSave('pcg-grades', [...GSEL]); grPaintGrades(); if (tables.pcg) tables.pcg.apply(); if (tables.pca && PCMODE === 'all') tables.pca.apply(); };
  $('bbody').querySelector('.gpick').addEventListener('input', e => { const i = e.target; if (!i.dataset.gk) return; if (i.checked) GSEL.add(i.dataset.gk); else GSEL.delete(i.dataset.gk); changed(); });
  $('gp-all').addEventListener('click', () => { GSEL = new Set(gk); sync(); changed(); });
  $('gp-none').addEventListener('click', () => { GSEL = new Set(); sync(); changed(); });
  $('gp-done').addEventListener('click', () => $('bov').classList.remove('open'));
  $('bov').classList.add('open');
}
$('gm-grades').addEventListener('click', grOpenGrades);

/* ---- a renamed header renames its filter chip too, on every tab (2026-10-28, Brett: "if I change the name of a
   column header, then the toggles within the column button and filter button should change as well"). The Columns
   picker already reads the header's own text; the chips kept the label they were built with. ---- */
function grSyncChips() {
  for (const id in tables) {
    const box = $('ranges-' + id); if (!box) continue;
    box.querySelectorAll('.range').forEach(div => {
      const inp = div.querySelector('input[id^="min"], input[id^="max"]'); if (!inp) return;
      const k = inp.id.replace(/^(min|max)/, '').replace('-' + id, ''), lbl = div.querySelector('.lbl'); if (!lbl || !/^\d+$/.test(k)) return;
      const t = tables[id], root = (GR_TABLES[id] && GR_TABLES[id].root) || (typeof FV_TABLES !== 'undefined' && FV_TABLES[id] && FV_TABLES[id].root) || '#p-' + id;
      const th = document.querySelector(root + ' thead tr:last-child th[data-k="' + k + '"]'); if (!th) return;
      if (lbl.dataset.orig == null) lbl.dataset.orig = lbl.textContent;
      const tn = [...th.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()), now = tn ? tn.textContent.trim() : '';
      const renamed = th.dataset.on != null && now && now !== th.dataset.on;
      const want = renamed ? now : lbl.dataset.orig;
      if (lbl.textContent !== want) lbl.textContent = want;
      if (t) {}
    });
  }
}
{ const an = applyNames; applyNames = function () { an.apply(this, arguments); grSyncChips(); }; }
grSyncChips();

/* ---- more rows as the page nears the bottom (the tab's own scroll loader knows only the raw table) ---- */
window.addEventListener('scroll', () => {
  if ($('p-pc').hidden || PCMODE === 'raw') return;
  const id = PCMODE === 'graded' ? 'pcg' : 'pca', t = tables[id];
  if (t && !$('more-' + id).hidden && window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 900) t.renderMore();
}, {passive: true});
{ const rb = rebuildLive; rebuildLive = function () { const out = rb.apply(this, arguments); if (PCMODE === 'all' && tables.pca && GR.doc) { GR.allRows = null; tables.pca.apply(true); } return out; }; }

/* ---- the Review button: is Card Ladder's card the same card as PriceCharting's? ---- */
const GR_REASONS = ['set mismatch', 'name mismatch', 'number mismatch', 'variant mismatch', 'language', 'other'];
function grRowOfKey(key) { const [c, gk] = key.split('|').length > 2 ? [key.split('|')[0], key.split('|').slice(1).join('|')] : key.split('|'); return GR.rows.find(r => String(r[0]) === c && r[50] === gk); }
async function grMark(r, patch) {
  const key = r[0] + '|' + r[50], t = Date.now(), cur = Object.assign({}, GMARKS[key] || {}, patch, {t});
  GMARKS[key] = cur; grSave('gmarks', GMARKS);
  if ('v' in patch) r[41] = patch.v; if ('reason' in patch) r[42] = patch.reason || null;
  let sent = true;
  try { await alSend({type: 'gmark', t, c: r[0], g: r[50], p: r[49], v: cur.v === undefined ? null : cur.v, reason: cur.reason || null, note: cur.note || null}); } catch (e) { sent = false; }
  if (tables.pcg) tables.pcg.apply(true); if (tables.pca && PCMODE === 'all') tables.pca.apply(true);
  return sent;
}
function grOpenReview(key) {
  const r = grRowOfKey(key); if (!r) return;
  const c = (GR.doc.cards || {})[String(r[0])] || {}, cl = c.cl || [], base = idRow.get(r[0]) || [];
  const pcu = pcPicture(r[0]), pcPage = 'https://www.pricecharting.com/game/' + r[0];
  if (!pcu) pcAsk(r[0]);
  const clu = GR_CL_IMG(cl[6]), clPage = grClUrl(c.pid);
  const fact = (lab, val, sub) => '<span class="lab">' + lab + '</span><b>' + val + '</b>' + (sub ? '<small>' + sub + '</small>' : '');
  const row = (l, rr) => '<div class="rrow"><div>' + (l || '') + '</div><div>' + (rr || '') + '</div></div>';
  const v = r[41], mk = GMARKS[key] || {};
  const year = s => s ? String(s).slice(0, 4) : '<span class="dim">unknown</span>';
  const tcg = c.tcg ? '<a href="https://www.tcgplayer.com/product/' + esc(c.tcg) + '" target="_blank" rel="noopener">' + esc(c.tcg) + '</a>' : '<span class="dim">none</span>';
  const idl = r[27] ? '<a href="' + esc(r[28]) + '" target="_blank" rel="noopener">' + esc(r[27]) + '</a>' : '<span class="dim">none</span>';
  $('btitle').textContent = r[1] + ' — ' + String(r[2] || '').replace('Pokemon ', '') + ' · ' + r[25];
  $('bsub').innerHTML = 'Is Card Ladder’s card the same card PriceCharting shows? ' + (v === 1 ? '<b class="up">You said: same card.</b>' : v === 0 ? '<b class="down">You said: not the same.</b>' : '') +
    (c.st ? ' <span class="dim">Matched: ' + esc(c.st) + (c.by ? ' (' + esc(c.by) + ')' : '') + '</span>' : '');
  let h = '<div class="rvflag gflagbox"><span class="lab">Flag a wrong match</span><span class="fbtns">' + GR_REASONS.map(s => '<button type="button" class="fbtn' + (mk.reason === s || r[42] === s ? ' on' : '') + '" data-s="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</span>' +
    '<input type="text" id="grf-note" placeholder="why (kept with the flag)" value="' + esc(mk.note || '') + '"><div class="fsave"><button type="button" class="tbtn" id="grf-save">Flag it</button>' + (r[42] ? '<button type="button" class="linkbtn" id="grf-off">Take the flag off</button>' : '') + '<span id="grf-msg" class="dim"></span></div></div>';
  h += '<div class="rvpair">' +
    '<div class="rvside"><h4>PriceCharting <a href="' + pcPage + '" target="_blank" rel="noopener">↗</a></h4>' +
      (pcu ? '<a href="' + pcPage + '" target="_blank" rel="noopener"><img class="rvpic" src="' + esc(pcu) + '" alt="PriceCharting picture: click to open their page"></a>'
           : '<div class="rvbox"><a href="' + pcPage + '" target="_blank" rel="noopener">See the picture on PriceCharting</a><small>being fetched now — it appears here within a minute or two</small></div>') + '</div>' +
    '<div class="rvside"><h4>Card Ladder ' + (clPage ? '<a href="' + esc(clPage) + '" target="_blank" rel="noopener">↗</a>' : '') + '</h4>' +
      (clu ? '<a href="' + esc(clPage || '#') + '" target="_blank" rel="noopener"><img class="rvpic" src="' + esc(clu) + '" alt="Card Ladder picture: click to open the card on Card Ladder"></a>' : '<div class="rvbox"><span class="dim">no picture on file</span></div>') + '</div></div>';
  const pcFin = (pcRF(base) || ['', ''])[1];
  h += '<div class="rvrows">' +
    row(fact('Release year', year(base[4])), fact('Release year', year(cl[1]))) +
    row(fact('Set name', esc(String(base[2] || '').replace(/^Pokemon /, ''))), fact('Set name', cl[2] ? esc(cl[2]) : '<span class="dim">unknown</span>')) +
    row(fact('Card name', esc(base[1] || '')), fact('Card name', cl[4] ? esc(cl[4]) : '<span class="dim">unknown</span>')) +
    row(fact('Card / set number', esc(base[3] || '') + (SET_TOTALS[base[2]] ? ' / ' + SET_TOTALS[base[2]] : '')), fact('Card / set number', cl[3] ? esc(cl[3]) : '<span class="dim">unknown</span>')) +
    row(fact('Finish', pcFin ? esc(pcFin) : '<span class="dim">unknown</span>'), fact('Finish', cl[5] ? esc(cl[5]) : '<span class="dim">not stated</span>', 'Card Ladder’s variation (from the graders’ records)')) +
    row(fact('PC sold last month', r[16] == null ? '-' : r[16], r[25] + ', the sales PriceCharting recorded'), fact('CL sold last month', r[37] == null ? '-' : r[37], r[25] + ', every sale Card Ladder recorded')) +
    row(fact('Grade and grader', esc(r[25])), fact('Grade and grader', esc(r[25]))) +
    row(fact('Grade price', fmtMoneyPlain(r[6]), esc(grSrcTitle(r))), fact('Grade price', fmtMoneyPlain(r[35]), 'Card Ladder’s value' + (r[46] != null ? ' · last sold ' + fmtMoneyPlain(r[46]) : ''))) +
    row(fact('TCGplayer ID', tcg, 'the TCGplayer product PriceCharting references'), fact(r[26] === 'CGC' ? 'CGC ID' : 'PSA ID', idl, r[26] === 'PSA' ? 'PSA’s spec number; the link opens a cert that proved the match' : 'CGC’s number for the card')) +
    '</div>' +
    '<div class="rvbtns"><button class="rvno" id="grv-no">Not the same card<small>recorded as a wrong match</small></button><button class="rvyes" id="grv-yes">Same card<small>a confirmed match</small></button></div>' +
    (v != null ? '<div class="rvundo"><button class="linkbtn" id="grv-undo">Withdraw my answer</button></div>' : '') + '<div id="grv-msg" class="dim"></div>';
  $('bbody').innerHTML = h;
  $('bov').classList.add('open');
  fitRows($('bbody'));
  const answer = async val => { $('grv-msg').textContent = 'Saving…'; const ok = await grMark(r, {v: val}); if (ok) $('bov').classList.remove('open'); else $('grv-msg').innerHTML = '<span class="down">Kept in this browser; the collector could not be told yet.</span>'; };
  $('grv-no').addEventListener('click', () => answer(0));
  $('grv-yes').addEventListener('click', () => answer(1));
  const u = $('grv-undo'); if (u) u.addEventListener('click', () => answer(null));
  let fst = r[42] || mk.reason || null;
  $('bbody').querySelectorAll('.gflagbox .fbtn').forEach(b => b.addEventListener('click', () => { fst = b.dataset.s; $('bbody').querySelectorAll('.gflagbox .fbtn').forEach(x => x.classList.toggle('on', x === b)); }));
  $('grf-save').addEventListener('click', async () => {
    const msg = $('grf-msg'); if (!fst) { msg.innerHTML = '<span class="down">Pick a reason first.</span>'; return; }
    msg.textContent = 'Saving…'; const ok = await grMark(r, {reason: fst, note: $('grf-note').value.trim(), v: 0});
    msg.innerHTML = 'Flagged: <b>' + esc(fst) + '</b>' + (ok ? '' : ' (kept in this browser; the collector could not be told yet)');
  });
  const off = $('grf-off'); if (off) off.addEventListener('click', async () => { await grMark(r, {reason: null, note: ''}); $('grf-msg').textContent = 'The flag is off.'; });
}
for (const id of ['pcg', 'pca']) {
  const tb = $('rows-' + id); if (!tb) continue;
  tb.addEventListener('click', e => {
    const rv = e.target.closest('.grvb, .gflag'); if (rv) { grOpenReview(rv.dataset.k); return; }
    const gt = e.target.closest('.gtbtn'); if (gt) { grOpenTrend(gt.dataset.k); return; }
    const tb2 = e.target.closest('.tbtn'); if (tb2 && tb2.dataset.i != null) openTrend(+tb2.dataset.i);
  });
}

/* ---- the PSA Trend popup: PriceCharting's and Card Ladder's lines for the grades you pick, at most 3 at once ----
   (Brett: "toggle PC PSA 10 and CL PSA 10, select a time frame, then both graph will overlay each other ... a maximum
   of 3 because any more may make the volume bars messy"). Lines: price per month (right axis); bars: sales per month
   (left axis), side by side. PC lines: its chart's monthly PSA 10 and grade 9 / 8 / 7 (every grader blended) with its
   recorded sales of that exact grade as the bars; CL lines: Card Ladder's monthly average of every sale and the count. */
const GT_COLORS = ['#3b82f6', '#f59e0b', '#22c55e'];
let GT_SEL = grLS('gtr-sel', ['pc|psa|g10', 'cl|psa|g10']);
let GT_SRC = grLS('gtr-src', 'cl');
let GT_ZOOM = grLS('gtr-zoom', '24');
async function grTrendData(cid) {
  if (GR.trend.has(cid)) return GR.trend.get(cid);
  const c = (GR.doc && GR.doc.cards[String(cid)]) || {}, n = c.sh != null ? c.sh : Math.floor(cid / ((GR.doc && GR.doc.shard) || 300));
  const res = await fetch('gtrend/s' + n + '.bin', {cache: 'no-store'});
  if (!res.ok) throw new Error('No trend file for this card yet.');
  const all = await decryptGz(new Uint8Array(await res.arrayBuffer()), HKEY);
  for (const [k, v] of Object.entries(all)) GR.trend.set(+k, v);
  return GR.trend.get(cid) || {cl: {}, pc: {}, ps: {}};
}
function gtSeries(tr, key) {                                 // key 'pc|psa|g10' / 'cl|cgc|g9' -> {label, pts: [[ym, price, n]]}
  const [src, ...rest] = key.split('|'), gk = rest.join('|');
  if (src === 'cl') return {label: 'CL ' + grLabel(gk), pts: ((tr.cl || {})[gk] || []).map(x => [x[0], x[2], x[1]])};
  const line = (tr.pc || {})[gk] || [], counts = new Map(((tr.ps || {})[gk] || []).map(x => [x[0], x])), by = new Map(line.map(x => [x[0], x[1]]));
  for (const [ym, x] of counts) if (!by.has(ym)) by.set(ym, x[2]);   // months the chart line does not cover: the median of its recorded sales
  if (gk === 'psa|g10' && tr.pd && tr.pd.length) { const last = tr.pd[tr.pd.length - 1]; if (!by.has(last[0].slice(0, 7))) by.set(last[0].slice(0, 7), last[1]); }
  const pts = [...by.keys()].sort().map(ym => [ym, by.get(ym), counts.has(ym) ? counts.get(ym)[1] : null]);
  return {label: 'PC ' + (gk === 'psa|g10' ? 'PSA 10' : 'grade ' + gk.split('|g')[1].replace('_', '.') + ' (all graders)'), pts};
}
async function grOpenTrend(key) {
  const r = grRowOfKey(key); if (!r) return;
  GR.cur = r;
  $('gtitle').textContent = r[1] + ' — ' + String(r[2] || '').replace('Pokemon ', '');
  $('gsub').innerHTML = '<span class="dim">Loading…</span>';
  $('gov').classList.add('open');
  try { GR.curTr = await grTrendData(r[0]); } catch (e) { GR.curTr = null; $('gsub').innerHTML = '<span class="warn">' + esc(e.message) + '</span>'; }
  gtPaint();
}
function gtPaint() {
  const r = GR.cur, tr = GR.curTr; if (!r) return;
  const gk = grGK(), pcGrades = ['psa|g10', 'psa|g9', 'psa|g8', 'psa|g7'];
  const list = GT_SRC === 'pc' ? pcGrades : gk;
  $('gsrc').innerHTML = ['pc', 'cl'].map(s => '<button type="button" class="zb' + (GT_SRC === s ? ' on' : '') + '" data-s="' + s + '">' + (s === 'pc' ? 'PriceCharting' : 'Card Ladder') + '</button>').join('');
  const has = k => { if (!tr) return false; const s = gtSeries(tr, k); return s.pts.some(p => p[1] != null); };
  const cb = k => { const full = GT_SRC + '|' + k, on = GT_SEL.includes(full), ok = has(full);
    return '<label class="' + (ok ? '' : 'dim') + '"><input type="checkbox" data-k="' + full + '"' + (on ? ' checked' : '') + (!on && GT_SEL.length >= 3 ? ' disabled' : '') + '> ' + esc(GT_SRC === 'pc' && k !== 'psa|g10' ? 'grade ' + k.split('|g')[1] + '*' : grLabel(k)) + '</label>'; };
  $('ggrades').innerHTML = GT_SRC === 'pc' ? '<div><h4>PC PSA</h4>' + list.map(cb).join('') + '<small class="dim">* PriceCharting’s grade 9 / 8 / 7 blend every grader</small></div>'
    : '<div><h4>CL PSA</h4>' + list.filter(k => k.startsWith('psa|')).map(cb).join('') + '</div><div><h4>CL CGC</h4>' + list.filter(k => k.startsWith('cgc|')).map(cb).join('') + '</div>';
  $('gchips').innerHTML = GT_SEL.map((k, i) => '<span class="gchip" style="border-color:' + GT_COLORS[i] + '"><span class="sw" style="background:' + GT_COLORS[i] + '"></span>' + esc(tr ? gtSeries(tr, k).label : k) + ' <button type="button" data-k="' + esc(k) + '" title="Remove this line">✕</button></span>').join('') +
    '<span class="dim">' + (GT_SEL.length >= 3 ? 'Three lines at most — remove one to add another.' : (3 - GT_SEL.length) + ' more line(s) can be added.') + '</span>';
  $('gzoom').querySelectorAll('.zb').forEach(b => b.classList.toggle('on', b.dataset.z === GT_ZOOM));
  $('gsub').innerHTML = r[27] ? 'Card Ladder: <a href="' + esc(r[31]) + '" target="_blank" rel="noopener">' + esc(r[30] || 'profile') + '</a> · ' + esc(r[27]) : '';
  gtDraw();
}
function gtDraw() {
  const tr = GR.curTr, svg = $('gsvg'), tab = $('gtable');
  if (!tr) { svg.innerHTML = ''; tab.innerHTML = ''; return; }
  const ser = GT_SEL.map(k => gtSeries(tr, k));
  let months = [...new Set(ser.flatMap(s => s.pts.map(p => p[0])))].sort();
  if (GT_ZOOM !== 'all' && months.length) {
    const [y, m] = months[months.length - 1].split('-').map(Number), n = +GT_ZOOM, d = new Date(Date.UTC(y, m - n, 1));
    const from = d.toISOString().slice(0, 7); months = months.filter(x => x >= from);
  }
  const W = 860, H = 340, L = 56, R = 64, T = 20, B = 46;
  const pv = ser.flatMap(s => s.pts.filter(p => months.includes(p[0]) && p[1] != null).map(p => p[1]));
  const nv = ser.flatMap(s => s.pts.filter(p => months.includes(p[0]) && p[2] != null).map(p => p[2]));
  if (!months.length || !pv.length) { svg.innerHTML = '<text x="20" y="40" fill="currentColor">No points for these lines in this window.</text>'; tab.innerHTML = ''; return; }
  const pmax = Math.max(...pv) * 1.08, pmin = Math.max(0, Math.min(...pv) * 0.9), nmax = Math.max(1, ...nv) * 1.15;
  const x = i => L + (months.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (months.length - 1));
  const yp = v => T + (H - T - B) * (1 - (v - pmin) / (pmax - pmin || 1)), yn = v => H - B - (H - T - B) * v / nmax;
  const bw = Math.max(2, Math.min(18, (W - L - R) / Math.max(1, months.length) / (ser.length + 1)));
  let s = '';
  for (let k = 0; k <= 4; k++) { const v = pmin + (pmax - pmin) * k / 4, y = yp(v); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="currentColor" stroke-opacity=".08"/><text x="' + (W - R + 6) + '" y="' + (y + 4) + '" font-size="11" fill="currentColor" fill-opacity=".7">$' + Math.round(v).toLocaleString('en-US') + '</text>'; }
  for (let k = 0; k <= 4; k++) { const v = nmax * k / 4, y = yn(v); s += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" font-size="11" text-anchor="end" fill="currentColor" fill-opacity=".5">' + Math.round(v) + '</text>'; }
  const step = Math.ceil(months.length / 12);
  months.forEach((m, i) => { if (i % step === 0 || i === months.length - 1) s += '<text x="' + x(i) + '" y="' + (H - B + 16) + '" font-size="11" text-anchor="middle" fill="currentColor" fill-opacity=".7">' + MONTHS_S[+m.slice(5) - 1] + ' ' + m.slice(2, 4) + '</text>'; });
  ser.forEach((sr, j) => {
    const by = new Map(sr.pts.map(p => [p[0], p]));
    months.forEach((m, i) => { const p = by.get(m); if (p && p[2]) s += '<rect x="' + (x(i) - bw * ser.length / 2 + j * bw) + '" y="' + yn(p[2]) + '" width="' + (bw - 1) + '" height="' + (H - B - yn(p[2])) + '" fill="' + GT_COLORS[j] + '" fill-opacity=".28"><title>' + esc(sr.label) + ' · ' + m + ': ' + p[2] + ' sales</title></rect>'; });
  });
  ser.forEach((sr, j) => {
    const pts = months.map((m, i) => { const p = sr.pts.find(q => q[0] === m); return p && p[1] != null ? [x(i), yp(p[1]), p, m] : null; }).filter(Boolean);
    if (pts.length > 1) s += '<polyline fill="none" stroke="' + GT_COLORS[j] + '" stroke-width="2" points="' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>';
    pts.forEach(p => { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="' + GT_COLORS[j] + '"><title>' + esc(sr.label) + ' · ' + p[3] + ': $' + p[2][1].toLocaleString('en-US') + (p[2][2] != null ? ' (' + p[2][2] + ' sales)' : '') + '</title></circle>'; });
  });
  s += '<text x="' + L + '" y="12" font-size="11" fill="currentColor" fill-opacity=".6">sales per month</text><text x="' + (W - R) + '" y="12" font-size="11" text-anchor="end" fill="currentColor" fill-opacity=".6">price per month</text>';
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.innerHTML = s;
  tab.innerHTML = '<table><thead><tr><th>Month</th>' + ser.map((sr, j) => '<th class="num" style="color:' + GT_COLORS[j] + '">' + esc(sr.label) + '</th>').join('') + '</tr></thead><tbody>' +
    months.slice().reverse().map(m => '<tr><td>' + MONTHS_S[+m.slice(5) - 1] + ' ' + m.slice(0, 4) + '</td>' + ser.map(sr => { const p = sr.pts.find(q => q[0] === m); return '<td class="num">' + (p && p[1] != null ? fmtMoneyPlain(p[1]) : '-') + (p && p[2] != null ? ' <span class="dim">(' + p[2] + ')</span>' : '') + '</td>'; }).join('') + '</tr>').join('') + '</tbody></table>';
}
if ($('gov')) {
  $('gclose').addEventListener('click', () => $('gov').classList.remove('open'));
  $('gov').addEventListener('click', e => { if (e.target.id === 'gov') $('gov').classList.remove('open'); });
  $('gsrc').addEventListener('click', e => { const b = e.target.closest('.zb'); if (!b) return; GT_SRC = b.dataset.s; grSave('gtr-src', GT_SRC); gtPaint(); });
  $('ggrades').addEventListener('input', e => { const i = e.target; if (!i.dataset.k) return; if (i.checked) { if (GT_SEL.length < 3 && !GT_SEL.includes(i.dataset.k)) GT_SEL.push(i.dataset.k); } else GT_SEL = GT_SEL.filter(k => k !== i.dataset.k); grSave('gtr-sel', GT_SEL); gtPaint(); });
  $('gchips').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; GT_SEL = GT_SEL.filter(k => k !== b.dataset.k); grSave('gtr-sel', GT_SEL); gtPaint(); });
  $('gzoom').addEventListener('click', e => { const b = e.target.closest('.zb'); if (!b) return; GT_ZOOM = b.dataset.z; grSave('gtr-zoom', GT_ZOOM); gtPaint(); });
}

grShowMode();
