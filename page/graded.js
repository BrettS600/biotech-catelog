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
let PCMODE = grLS('pc-mode', 'raw');                       // 'raw' | 'graded' | 'all' (neither button on)
const GMARKS = grLS('gmarks', {});                         // 'cid|gk' -> {v: 1 same | 0 not | null, reason, note, t}: answers echoed here until the data carries them
// the word buttons' state (see grOpenTerms below): which words are off, any/all inside a button, the side, across buttons
const GT_CATS = ['Rarity', 'Finish', 'Special', 'Series', 'Era', 'Unidentified'];
/* The filter buttons' state, one set per view (2026-11-04, Brett: the Forecast tab's Graded Forecasting gets "its own
   filters buttons, and it should not effect pc tab"): GF.pc is the PriceCharting tab's (under the keys it always had),
   GF.fc the forecast's (the same keys behind "fcg-", made in graded_fc.js). Each set: gsel the Grading ticks, gts the
   word buttons (which words are off, any/all inside a button, the side, across buttons), flag the Flags button (only
   the flagged rows), unsure the Unsure button, authread the Auth read button (2026-11-02), clread / clmatch the CL read
   and CL To PC Match buttons (2026-11-03: both / one side / the other), order the buttons' order; ids the markup it
   paints into; apply redraws the tables it filters. */
function grFilters(p, ids, apply, gsel) {
  return {p, ids, apply, gsel: new Set(grLS(p + 'pcg-grades', gsel || GR_SEL_DEFAULT)),
    gts: Object.assign({off: {}, within: {}, side: {}, across: 'all'}, grLS(p + 'gterms', {})),
    flag: grLS(p + 'gflagonly', false), unsure: grLS(p + 'gunsureonly', false), authread: grLS(p + 'gauthread', false),
    clread: grLS(p + 'gclread', 'both'), clmatch: grLS(p + 'gclmatch', 'both'), order: grLS(p + 'gm-order', null)};
}
const GF = {pc: grFilters('', {host: 'gmode', terms: 'gm-terms', grades: 'gm-grades', gn: 'gm-gn', title: 'PriceCharting tab'},
  () => { if (tables.pcg) tables.pcg.apply(); if (tables.pca && PCMODE === 'all') tables.pca.apply(); })};
// words Brett sorted here (the Sort control), echoed until the data carries them (doc.dect: the newest decision filed)
const GTDEC = grLS('gtdec', {});
const gtdSave = () => grSave('gtdec', GTDEC);
const GT_SORT_CATS = ['Rarity', 'Finish', 'Special', 'Series', 'Era', 'Meaningless', 'Unidentified'];
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
   46 CL last sold, 47 CL average last month, 48 raw row?, 49 profile id, 50 grade key, 51 PC Illustrator, 52 CL
   Illustrator, 53 Series, 54 Era, 55 PC number (TCGplayer's), 56-66 Auth Name / Set / Set/Card No. / Rarity/Finish /
   Release / Language / Grade / Label / Pop / Pop Higher / Illustrator, 67 PC price today, 68 CL value today, 69 last
   month's PC price [average, sales, source], 70 the slab's Auth record, 71-74 PC / CL Grade and where each came from,
   75 CL Status (read / pending / no match), 76 PC sales (last mo) is an estimate (~), 77 Auth Estimate (PSA's estimate on
   its cert page), 78 the order key, 79-82 Card Ladder's standard price / its window / sales a year / confidence, 83 CL
   Cert (the cert read off Card Ladder's picture of this grade, or a word), 84 its cert page, 85-95 CL Cert Name / Set /
   Set/Card No. / Rarity/Finish / Release / Language / Grade / Label / Pop / Pop Higher / Estimate (not looked up yet).
   2026-11-10 (Brett: "all of the auth columns are derived from auth cert ... label all of those columns, to say PC Cert ...
   because all of these columns are derived from PC certs. then we add a copy of each column, but have it start with CL
   Cert ... the cl cert number can be found in the images"; "just prepare the columns for now and and only fill out the
   column for cl cert. we can remove the illustrator column"): the Auth columns are the PC Cert columns (the slab read
   off PriceCharting's photo - the same cert, the same lookups), Auth Illustrator (66, always none) is gone, and the CL
   Cert columns are new: CL Cert = the cert number on the picture Review shows on the Card Ladder side (cl_certs.js reads
   each picture once, every two hours - graded_site.py cards[id].clc[gk] = [status, cert]); the eleven beside it wait for
   the lookups.
   2026-11-02 (Brett: "whenever I manually open a CGC page or a PSA page ... the columns are automatically filled out"):
   a cert page Brett opened himself (his Cert Reader extension -> card-data certs/results.csv) is the first source of the
   Auth cells (slab source "pg"), before PSA's API and Card Hedge; with it Auth Pop (64) / Auth Pop Higher (65) are shown
   again and Auth Estimate (77) is new.
   2026-10-30 (Brett: "fill out the rest of the website to get all of the PC graded data ... the CL rows will be blank
   until we get the data"): every PriceCharting card with a PSA / CGC price or sale has rows, in the Card Ladder run's
   order; a card Card Ladder has not been read for yet says "pending" in the CL columns (not "none", which means Card
   Ladder has been read and has nothing), and has no Review (nothing to compare it with yet).
   2026-10-29 (Brett: "the cgc and psa should be one column but of course, the rows will be specific to either psa or
   cgc ... "Auth Set" or "Auth Name""): the Auth columns are what the grader says - PSA's own cert record (PSA's Public
   API) on a PSA row, else the description Card Hedge relays from GemRate; a CGC row from Card Hedge. 6 and 35 are LAST
   MONTH's price (Brett: "i thought those were suppose to be grade for last month"), both averages.
   2026-10-28 (Brett: "pc data has to come from pc or tcg link that embeds pc. cl has to come from cl. if something is
   not there, then it should none"): 3/14/15 and 32/33 are the PC / CL sides as graded_site.py read them (graded_terms.py),
   nothing filled in from the other side or the open dataset. */
const grRF = (rar, fin, sp) => (rar || 'none') + RF_SEP + (fin || 'none') + (sp ? RF_SEP + sp : '');   // "Holo Rare · Holo · 1st Edition"
const grBoth = p => { if (!p) return ''; const v = [...new Set(p.filter(Boolean))]; return v.join(' ≠ '); };   // PC, CL, Auth: "Original ≠ Neo"
function grBuildRows() {
  const d = GR.doc; if (!d) return [];
  const out = [];
  for (const x of d.rows) { const r = grBuildRow(d, x); if (r) out.push(r); }
  return out;
}
/* A card answered Not the same card (2026-11-03, Brett: "we still list it, but one side ... will have the rows say no
   match"): its rows stay in the table with the PriceCharting side as it is and the Card Ladder side empty - CL Status
   "no match", the CL cells "no match" - instead of being hidden; Same card (or withdrawing the answer) brings Card
   Ladder's page back. The card's Review still shows that page, so the answer can be changed. */
function grBuildRow(d, x) {
    const cid = x[0], base = idRow.get(cid), c = d.cards[String(cid)] || {}, ns = grMatchV(cid) === 0, cl = ns ? [] : c.cl || [];
    if (!base) return null;
    const gk = d.gk[x[1]], grader = gk.split('|')[0].toUpperCase();
    const m = GMARKS[cid + '|' + gk];
    // the cert number of a real slab of THIS grade (read off a PriceCharting sold-listing photo), linked to its cert page;
    // none read for the grade -> no ID (2026-10-28, Brett: "cgc id doesnt match the card")
    const cert = (c.certs || {})[gk] || '';
    // no slab of this grade read yet: a PSA row links PSA's page for the card itself (its spec - needs Brett's PSA
    // sign-in), a CGC row says none (2026-10-28, Brett: "the hyperlinks to take me to the PSA or CGC page")
    const spec = !cert && grader === 'PSA' && c.spec ? String(c.spec) : '';
    const idText = cert ? grader + ' ' + cert : spec ? 'PSA spec ' + spec : '';
    const idUrl = cert ? (grader === 'PSA' ? 'https://www.psacard.com/cert/' + cert + '/psa' : 'https://www.cgccards.com/certlookup/' + cert + '/')
      : spec ? 'https://www.psacard.com/spec/psa/' + spec : '';
    const pcp = (x[18] || [])[0] != null ? x[18][0] : null, clv = ns ? null : x[9];   // last month: PriceCharting's average / chart value, Card Ladder's average
    const g = grader.toLowerCase(), A = (c.a || {})[g], S = x[19] || null;
    // each side's own grade (graded_site.pc_grade / cl_grade): prices are compared only where the two are the same grade
    const GD = ns ? [(x[20] || [])[0], (x[20] || [])[1]] : x[20] || [], same = grSameGrade(GD[0], GD[2]);
    const cls = ns ? 'nomatch' : c.cls || (c.read ? 'read' : 'pending'), pend = cls === 'pending';   // an older graded.bin: matched cards only
    const n1 = x[4] != null ? x[4] : x[21] != null ? x[21] : null, n1e = x[4] == null && x[21] != null;
    const aSt = A ? 'ok' : (c.aw || []).includes(g) ? 'not read' : 'none';       // card level: read / cert known, not looked up yet / no slab
    const sOk = S && S[0] === 'ok', sSt = sOk ? 'ok' : S ? (S[0] === 'nf' ? 'not found' : 'not read') : 'none';
    const r = [cid, base[1], base[2], base[3], base[4], base[5], pcp, x[11], x[12], x[13], null, null, x[14], x[15], grRF(c.pr, c.pf, c.ps), c.pf || null,
      n1, d.lastm, null, null, null, null, null, null, x[1], grLabel(gk), grader, idText, idUrl,
      cl[4] || null, cl[2] || null, ns ? '' : grClUrl(c.pid), ns ? null : c.cn || null, pend || ns ? null : grRF(c.cr, c.cf, c.cs), cl[1] || null, clv,
      pcp && clv && same ? Math.round((clv - pcp) / pcp * 1000) / 10 : null, ns ? null : x[8], null, null, null,
      grMatchV(cid) !== undefined ? grMatchV(cid) : m && m.v !== undefined ? m.v : x[16], m && m.reason !== undefined ? m.reason : x[17], x[3], x[5], ns ? null : x[10], ns ? null : x[7], ns ? null : x[9], false, c.pid || '', gk,
      c.pi ? c.pi : c.pi === '' ? 'none' : 'not read', 'none', grBoth(c.ser) || null, grBoth(c.era) || null, c.pn || null,
      A ? A.name || 'none' : aSt, A ? A.set || 'none' : aSt, A ? A.num || 'none' : aSt, A ? grRF(A.rar, A.fin, A.sp) : aSt, A ? A.year || 'none' : aSt, A ? A.lang || 'none' : aSt,
      sOk ? S[1] || 'none' : sSt, sOk ? (S[5] === 'psa' || (S[5] === 'pg' && g === 'psa') ? S[2] || 'none' : 'not given') : sSt, sOk && S[3] != null ? S[3] : null, sOk && S[4] != null ? S[4] : null,
      A ? 'none' : aSt === 'not read' ? 'not read' : 'none',
      x[2], ns ? null : x[6], x[18] || null, S,
      GD[0] || null, GD[2] || null, GD[1] || null, GD[3] || null,           // 71 PC Grade, 72 CL Grade, 73 / 74 where each came from
      GR_CLS_WORD[cls] || cls, n1e,                                         // 75 CL Status, 76 PC sales is an estimate
      sOk && S[9] != null ? S[9] : null,                                    // 77 Auth Estimate (PSA's cert page)
      ordOf(base) * 64 + 1 + x[1]];
    // the analysis columns from PriceCharting's own sales (2026-11-05): volume drift [last 30 days, the 30 before, as of]
    // for every grade; r.sx = [as of, n7, n7 before, n30, n30 before, n90] behind a grade's Δ7d / Δ30d / slope when it has
    // no daily price of its own (all but PSA 10 and a real CGC 10)
    const vd = ns ? null : x[22] || null;
    r.vd = vd; r.sx = ns ? null : x[23] === undefined ? null : x[23];   // 0: no sale in 90 days
    if (vd) { r[11] = vd[0] - vd[1]; r[10] = vd[1] ? Math.round((vd[0] / vd[1] - 1) * 1000) / 10 : null; }
    if (ns) { r[7] = r[8] = r[9] = r[12] = r[13] = null; }
    // Card Ladder's figures (2026-11-05): 79 the standard price (the Hodges-Lehmann middle of the grade's sales in the 30 /
    // 60 / 90 days to the read, 3 sales), 80 [window days, sales in it, the read], 81 sales in the 12 months to the read
    // (CL Sales/yr - Sales/yr is Card Ladder's now), 82 Card Ladder's value confidence (1-5)
    const cs = ns || cls !== 'read' ? null : x[24] || null;
    r[79] = cs ? cs[0] : null; r[80] = cs ? cs.slice(1) : null; r[81] = ns || cls !== 'read' ? null : (x[25] != null ? x[25] : null); r[82] = ns ? null : x[26] != null ? x[26] : null;
    r[5] = r[81];
    // the CL Cert column (2026-11-10): the cert on Card Ladder's picture of this grade's slab, as cl_certs.js read it
    const cc = ns || cls !== 'read' ? null : (c.clc || {})[gk];
    const ccw = ns || cls === 'nomatch' ? 'no match' : pend ? 'pending' : !(c.imgs || {})[gk] ? 'none' : !cc || cc[0] === 'wait' ? 'not read'
      : cc[0] === 'ok' && cc[1] ? '' : cc[0] === 'many' ? 'two slabs' : cc[0] === 'err' ? 'picture gone' : 'unreadable';
    r[83] = ccw || grader + ' ' + cc[1];
    r[84] = ccw ? '' : grader === 'PSA' ? 'https://www.psacard.com/cert/' + encodeURIComponent(cc[1]) + '/psa' : 'https://www.cgccards.com/certlookup/' + encodeURIComponent(cc[1]) + '/';
    for (let i = 85; i <= 95; i++) r[i] = ccw || 'not looked up';   // what the grader says of that slab: the lookups come later
    return r;
}
function grRebuildCard(cid) {                               // after a Review answer: the card's rows as they now read
  const d = GR.doc; if (!d) return;
  const by = new Map(d.rows.filter(x => x[0] === cid).map(x => [x[1], x]));
  GR.rows = GR.rows.map(r => r[0] === cid && by.has(r[24]) ? grBuildRow(d, by.get(r[24])) || r : r);
  GR.allRows = null;
}
const GR_CLS_WORD = {read: 'read', pending: 'pending', nomatch: 'no match'};
// where the Card Ladder run is with the card (graded_site.py cards[id].cls / .qr): the CL Status cell and the CL cells' word
function grClsTip(c, w, cid) {
  if (w === 'no match' && cid != null && grMatchV(cid) === 0) return 'You answered Not the same card: Card Ladder’s page (' + ((c && c.pid) || 'its page') + ') is not this card, so the Card Ladder side says no match. Review still shows that page - answer Same card there to bring it back.';
  if (w === 'pending') return 'Card Ladder not read for this card yet: it is in the Card Ladder run’s list (up to 900 cards a night, 8 pm–7 am Eastern): first cards with more than 10 PSA / CGC sales last month, highest PriceCharting value first; then the rest that sold last month, most sales first; then those with no sales last month, highest PSA 10 value first. Its CL columns fill in after the night it is read.';
  if (w === 'no match') return 'The Card Ladder run looked and found no Card Ladder page for this card: no PSA / CGC cert in PriceCharting’s sold-listing photos, or no cert led to a page (other than one you answered Not the same card). Its CL columns say none.';
  return 'Card Ladder’s page for this card has been read' + (c && c.read ? ' (' + c.read + ')' : '') + '.';
}
// the two sides' grades are the same grade ('CGC 10 PRISTINE' = 'CGC 10 Pristine'); 'Grade 9 (any grader)' is not 'PSA 9'
function grSameGrade(a, b) { const n = v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); return !!a && !!b && n(a) === n(b); }
const GR_PCG_FROM = {sales: 'the sales of this grade and grader PriceCharting recorded', chart: 'PriceCharting’s PSA 10 chart line',
  chart_mixed: 'PriceCharting’s chart line for this grade number, which blends every grader (PSA, CGC, BGS, SGC …): it has no price of this grader’s own',
  mixed: 'PriceCharting’s price for this grade number, which blends every grader: it has no price of this grader’s own',
  price: 'PriceCharting’s own price column for this grade and grader', formula: 'PriceCharting’s CGC 10 price here is a formula (0.40 x PSA 10), not sales',
  population: 'PriceCharting’s population report lists this grade (no price of it)'};
const GR_CLG_FROM = {page: 'the grade as Card Ladder lists it on the card’s page', sales: 'Card Ladder recorded sales of this grade'};
// the matcher's own doubt (ids/card_ids.csv status "review"), until Brett answers Review (2026-10-29: highlighted)
function grUnsure(r) { const c = ((GR.doc && GR.doc.cards) || {})[String(r[0])]; const a = grAns(r); return !!c && c.st === 'review' && a !== 1 && a !== 0; }
/* The answer for the whole card (2026-10-29, Brett: Charizard #4 Celebrations "ultra premium is not same card ... dont
   delete them ... they should not be shown"): Review's Same card / Not the same card is about the CARD, not one grade -
   sent as gmark g 'card', filed as gk "card" in ids/marks.csv. Not the same card: since 2026-11-03 the card's rows stay
   listed with no Card Ladder side ("no match", grBuildRow) instead of being hidden. The newer of this browser's answer
   and the filed one wins. */
function grMatchV(cid) {
  const c = ((GR.doc && GR.doc.cards) || {})[String(cid)] || {}, doc = c.ma;
  let loc = GMARKS[cid + '|card'];
  const page = x => String(x || '').replace(/^(matched|psa)-/, 'psa-');   // matched-<spec> and psa-<spec> are one page
  if (loc && loc.p && c.pid && page(loc.p) !== page(c.pid)) loc = null;    // given for another page (the card has a new match)
  const a = loc && (!doc || (loc.t || 0) >= (doc.t || 0)) ? loc : doc;
  return a ? (a.v === undefined ? undefined : a.v) : undefined;
}
/* The match check (graded_site.match_level): "wrong" = Card Ladder's price has sat far from PriceCharting's for most of
   the months both sides priced the card; Pristine / Perfect rows never carry it. A card answered Same card drops it. */
function grWrong(r) { const c = ((GR.doc && GR.doc.cards) || {})[String(r[0])]; return !!c && !!c.mc && c.mc.lv === 'wrong' && grAns(r) !== 1 && grAns(r) !== 0 && !/pristine|perfect/.test(r[50] || ''); }
// the row's own slab (Auth Cert) has been read - a cert page Brett opened (Cert Reader), PSA's record or Card Hedge (2026-11-02,
// Brett: "an auth read toggle ... to only see listings that have had their pages read")
function grAuthRead(r) { const S = r[70]; return !r[48] && !!S && S[0] === 'ok'; }
/* The CL read and CL To PC Match buttons (2026-11-03, Brett: "on to only show match, off to only show unmatches, and
   then neutral to show both"; "if the read button says 3k of 130k, then I will know 127k are still pending"): each
   click goes both -> one side -> the other side -> both. CL read: whether the Card Ladder run has looked at the card
   (read or no match) or not yet (pending). CL To PC Match, among the rows looked at: Card Ladder's page paired with the
   PriceCharting card (unsure and likely-wrong matches count until answered Not the same card) or no match (no page
   found, or answered Not the same card). Only the CL / PC pairing - the Auth columns play no part. */
const GCL_NEXT = {gclread: {both: 'read', read: 'pending', pending: 'both'}, gclmatch: {both: 'matched', matched: 'nomatch', nomatch: 'both'}};
const GCL_WORD = {both: 'both', read: 'read only', pending: 'pending only', matched: 'matched only', nomatch: 'no match only'};
function grClPass(r, F = GF.pc) {
  const w = r[75];
  if (F.clread === 'read' && w === 'pending') return false;
  if (F.clread === 'pending' && w !== 'pending') return false;
  if (F.clmatch === 'matched' && w !== 'read') return false;
  if (F.clmatch === 'nomatch' && w !== 'no match') return false;
  return true;
}
// a graded row passes a view's filter buttons (F: GF.pc or GF.fc)
function grPass(r, F = GF.pc) {
  return F.gsel.has(r[50]) && grTermPass(r[0], false, F) && (!F.flag || !!r[42]) && (!F.unsure || grUnsure(r) || grWrong(r)) && (!F.authread || grAuthRead(r)) && grClPass(r, F);
}
const grK = n => n < 1000 ? String(n) : (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';   // 3,450 -> 3.5k
function grAns(r) { const a = grMatchV(r[0]); return a !== undefined ? a : r[41]; }   // the card's answer, else an older per-grade one
function grMcText(c) {
  const mc = (c && c.mc) || {}, fit = (GR.doc && GR.doc.mcfit) || {};
  if (!mc.n) return 'Price history: no month where both sides recorded sales of the same grade, so prices cannot check this match yet.';
  const x = mc.r >= 1 ? '×' + mc.r : '×' + mc.r + ' (Card Ladder lower)';
  return 'Price history: Card Ladder’s price ÷ PriceCharting’s, typical ' + x + ' over ' + mc.n + ' month' + (mc.n === 1 ? '' : 's') + ' (grade by grade, Pristine left out); ' + Math.round((mc.far || 0) * 100) + '% of them more than 1.5× apart. ' +
    ({wrong: 'That points to a different card.', agree: 'The prices agree.', mixed: 'Not clear either way.', thin: 'Too few months to judge from prices.'})[mc.lv || 'thin'] +
    ' (Flagged at ' + (fit.ratio || 2) + '× in ' + Math.round((fit.far || 0.8) * 100) + '% of 6+ months - ' + (fit.fitted ? 'fitted to your ' + fit.n + ' answers' : 'fixed until 20 of your answers can tune it') + '.)';
}
function grMatchTag(r) {                                    // the label in the PC Grade cell: red for the price check, amber for the matcher
  const c = ((GR.doc && GR.doc.cards) || {})[String(r[0])] || {}, w = grWrong(r), u = grUnsure(r);
  if (!w && !u) return '';
  const why = (u ? 'Unsure match: the automatic matcher was not sure Card Ladder’s card is the same card as PriceCharting’s (its status is “review”, which only means a person should check it - nothing was sent anywhere). ' : '') + grMcText(c) + ' Open Review and answer Same card / Not the same card.';
  return (w ? ' <span class="gwrong" title="' + esc('Likely wrong match. ' + why) + '">likely wrong match</span>' : '') + (u ? ' <span class="gunsure" title="' + esc(why) + '">unsure match</span>' : '');
}
function grRawRow(base) {                                   // a raw card in the both-view: the graded layout, Grade "Raw"
  return [base[0], base[1], base[2], base[3], base[4], base[5], base[6], base[7], base[8], base[9], base[10], base[11], base[12], base[13], base[14], base[15],
    base[16], base[17], base[18], base[19], base[20], base[21], base[22], base[23], -1, 'Raw', '', '', '', null, null, '', null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null, true, '', 'raw', null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, false, ordOf(base) * 64];
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
/* The analysis columns of a graded row (2026-11-05, Brett: "for the stats, i am thinking we just use pc for all of them";
   blanks "with the reason in the hover text"): PSA 10 and a real CGC 10 from PriceCharting's daily price of that grade
   (the site's daily snapshots); every other grade - and a CGC 10 that is PriceCharting's 0.40 x PSA 10 - from the sales
   PriceCharting recorded of that exact grade and grader, as of the card's last page read: Δ7d / Δ30d = the median of the
   last 7 / 30 days against the 7 / 30 before (5+ / 3+ sales in each), Slope = Theil-Sen through the last 90 days' sales.
   Range 90d and Volatility need a daily price, so those rows leave them blank. Volume drift: every grade, from its sales. */
const grDay = s => s ? MONTHS_S[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) : '';
const grStatDash = t => '<td class="ctr"><span class="dim" title="' + esc(t) + '">-</span></td>';
const grStatVal = (v, t, signed = true, nd = 1) => '<td class="num" title="' + esc(t) + '">' + fmtPct(v, signed, nd) + '</td>';
/* The analysis columns are Card Ladder's (2026-11-05, Brett: "we need to change statistics to be based on card ladder, the
   stats columns"): every figure from Card Ladder's own sales of this grade (no qualifier / autograph slabs), as of the day
   the card's Card Ladder page was last read (graded_site.py / cl_sales.stats). A card Card Ladder has not read has none. */
function grStatCells(r) {
  const g = r[25], sx = r.sx || null, vd = r.vd, cls = r[75];
  if (cls !== 'read') { const w = cls === 'no match' ? 'No Card Ladder page for this card' : 'Card Ladder has not read this card yet'; const d = grStatDash(w + ' - these figures come from Card Ladder’s own sales (since Nov 6).'); return d + d + d + d + d + d; }
  const asof = sx ? grDay(sx[0]) : vd ? grDay(vd[2]) : '', read = asof ? ' (as of the card’s Card Ladder read, ' + asof + ')' : '';
  const noSales = 'No ' + g + ' sale on Card Ladder in the 90 days to the card’s read' + (asof ? ' (' + asof + ')' : '') + '.';
  const win = (v, i, n, mn) => {                            // Δ7d / Δ30d: i = the counts' place in sx
    if (!sx) return grStatDash(noSales);
    const a = sx[i], b = sx[i + 1], span = n === 7 ? 'week' : '30 days';
    if (v == null) return grStatDash('Fewer than ' + mn + ' ' + g + ' sales on Card Ladder in one of the two ' + (n === 7 ? 'weeks' : '30-day spans') + ' to ' + asof + ' (' + a + ' in the last ' + span + ', ' + b + ' in the ' + span + ' before) - too few for a steady median.');
    return grStatVal(v, 'The median of the ' + a + ' ' + g + ' sales of the ' + n + ' days to ' + asof + ' against the median of the ' + b + ' of the ' + n + ' days before (Card Ladder’s sales of this grade)' + read + '.');
  };
  const d7 = win(r[7], 1, 7, 5), d30 = win(r[8], 3, 30, 3);
  const pos = !sx ? grStatDash(noSales) : r[9] == null ? grStatDash('Needs a 30-day price (3+ sales) at 4 or more of the weekly points over the 90 days to ' + asof + ', with a gap between the lowest and the highest.')
    : grStatVal(r[9], 'Where the standard price (the 30-day price of Card Ladder’s sales) sits between the lowest and the highest 30-day price of the 90 days to ' + asof + ', taken a week apart: 0% = the low, 100% = the high.', false, 0);
  const vdc = !vd ? grStatDash('Card Ladder has not read this card yet.')
    : !vd[0] && !vd[1] ? grStatDash('No ' + g + ' sale on Card Ladder in the 60 days to ' + grDay(vd[2]) + '.')
    : '<td class="num" title="' + esc(vd[0] + ' ' + g + ' sale' + (vd[0] === 1 ? '' : 's') + ' in the 30 days to ' + grDay(vd[2]) + ' against ' + vd[1] + ' in the 30 days before (Card Ladder’s sales of this grade; its record is complete, every platform).') + '"><span class="' + (r[11] > 0 ? 'up' : r[11] < 0 ? 'down' : '') + '">' + (r[11] > 0 ? '+' : '') + r[11] + (r[10] != null ? ' (' + (r[10] > 0 ? '+' : '') + r[10].toFixed(1) + '%)' : vd[0] ? ' (new)' : '') + '</span></td>';
  const vol = !sx ? grStatDash(noSales) : r[12] == null ? grStatDash('Fewer than 5 ' + g + ' sales on Card Ladder in the 90 days to ' + asof + ' (' + sx[5] + ').')
    : grStatVal(r[12], 'How far a typical ' + g + ' sale of the 90 days to ' + asof + ' sits from their middle (the median distance, ' + sx[5] + ' sales on Card Ladder): small = the copies sell close together, large = prices are all over the place.', false, 2);
  const ts = !sx ? grStatDash(noSales)
    : r[13] == null ? grStatDash('Fewer than 5 ' + g + ' sales on Card Ladder over the 90 days to ' + asof + ' (' + sx[5] + '), or spread over less than 30 days - too few for a trend line.')
    : grStatVal(r[13], 'Theil-Sen slope through the ' + sx[5] + ' ' + g + ' sales on Card Ladder of the 90 days to ' + asof + ' (the median of the slopes between every two sales, so one odd copy barely moves it), % a month' + read + '.');
  return d7 + d30 + pos + vdc + vol + ts;
}
const grText = v => v == null || v === '' ? gdash : '<td>' + esc(v) + '</td>';
const grMonthName = ym => { if (!ym) return 'last month'; const [y, m] = String(ym).split('-'); return MONTHS_S[+m - 1] + ' ' + y; };
function grPc1Title(r) {                                    // last month's PriceCharting price: where it came from
  const p = r[69] || [], mo = grMonthName(r[17]);
  if (p[2] === 'hl') return 'Hodges–Lehmann estimate (the median of every pairwise average: steady against an odd sale) of the ' + p[1] + ' ' + r[25] + ' sale' + (p[1] === 1 ? '' : 's') + ' PriceCharting recorded in ' + mo;
  if (p[2] === 'sales') return 'Average of the ' + p[1] + ' ' + r[25] + ' sale' + (p[1] === 1 ? '' : 's') + ' PriceCharting recorded in ' + mo;
  if (p[2] === 'chart') return 'PriceCharting’s monthly PSA 10 chart value for ' + mo + ' (no PSA 10 sale of it recorded that month)';
  if (p[2] === 'chart_mixed') return 'PriceCharting’s monthly grade ' + r[25].split(' ')[1] + ' chart value for ' + mo + ': it blends every grader (no ' + r[25] + ' sale recorded that month)';
  // only this grade and grader's own figures are used (2026-10-29): PriceCharting's 9 / 9.5 / 8 / 7 lines blend graders
  if (p[2] === 'none') return 'none: our record of PriceCharting’s ' + r[25] + ' sales covers all of ' + mo + ' and holds no ' + r[25] + ' sale';
  if (p[2] === 'not_read') return 'not read: our record of PriceCharting’s ' + r[25] + ' sales does not reach back to the start of ' + mo + ' yet (it fills in as the card pages are re-read; PriceCharting’s own grade ' + r[25].split(' ')[1] + ' price blends every grader, so it is not used)';
  return '';
}
function grSrcTitle(r) {
  const s = String(r[43] || '');
  if (s === 'pc') return 'PriceCharting’s ' + r[25] + ' price';
  if (s === 'mixed') return 'PriceCharting’s grade ' + r[25].split(' ')[1] + ' price: it blends every grader (PSA, CGC, BGS ...)';
  if (s === 'formula') return 'PriceCharting’s CGC 10 price is its formula (0.40 x PSA 10), not a market price';
  const m = /^sales:(\d+):(\d+)/.exec(s);
  if (m) return 'Median of the ' + m[1] + ' ' + r[25] + ' sales PriceCharting recorded in the last ' + m[2] + ' days (its listed price blends graders)';
  return '';
}
const GR_FC_TIP = {match: 'PC and CL agree', mismatch: 'PC and CL disagree', pc_none: 'PriceCharting / TCGplayer do not say', cl_none: 'Card Ladder does not say', both_none: 'neither says', not_read: 'not read'};
const grFC = (c, f) => ((c || {}).fc || {})[f] || '';
const grCls = (c, f) => { const v = grFC(c, f); return v === 'mismatch' ? ' class="rfbad"' : ''; };
function grPcCells(r, c) {                                  // PC Card Name, PC Set, PC Set/Card No., PC Rarity/Finish, PC Release
  const tipN = c.pnf === 'TCGplayer' ? 'TCGplayer’s number for the product PriceCharting links to' : c.pnf ? 'PriceCharting’s number; no total from TCGplayer' : '';
  const tipR = 'Rarity: ' + (c.prf || 'none') + ' · finish: ' + (c.pff || 'none') + (c.ps ? ' · special: PriceCharting’s [brackets]' : '') + '. Nothing filled in from other sources; a ? marks a word the dictionary only thinks it knows.';
  return '<td><a href="https://www.pricecharting.com/game/' + r[0] + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a></td>' +
    '<td>' + esc(r[2]) + '</td>' +
    '<td class="num"' + (tipN ? ' title="' + esc(tipN) + '"' : '') + '>' + esc(r[55] || (r[3] ? r[3] + '/none' : 'none')) + '</td>' +
    '<td title="' + esc(tipR) + '">' + esc(r[14] || 'none') + '</td>' +
    '<td>' + (r[4] || dash) + '</td>';
}
/* the Auth cells (2026-10-29): what the grader says. A word in place of a value: not read = the cert is known but not
   looked up yet; none = no slab of this card read for this grader; not found = the grader has no such cert; not given =
   the source does not carry it (Card Hedge: no label type, no population). */
const GR_AST_TIP = {'not read': 'The cert is known but not looked up yet: the site build looks certs up with PSA’s Public API (PSA rows) and Card Hedge (PSA and CGC rows) once their keys are in, a batch a day.',
  'none': 'No slab of this card read for this grader yet, so nothing to look up.', 'not found': 'Looked up: the grader has no record of this cert.',
  'not given': 'This source does not carry it: Card Hedge gives no label type or population, CGC’s cert page shows no label type and no estimate. Open the cert page yourself (PC Cert link, with the Cert Reader extension on) and what the grader’s page shows fills in after the next build.'};
function grAuthSrc(r, c) {
  const g = String(r[26]).toLowerCase(), A = (c.a || {})[g]; if (!A) return '';
  if (A.src === 'pg') return r[26] + '’s own cert page of ' + A.cert + ', opened by you' + (A.read ? ' (read ' + A.read + ')' : '');
  return A.src === 'psa' ? 'PSA’s cert record of ' + r[26] + ' ' + A.cert + ' (PSA’s Public API' + (A.read ? ', read ' + A.read : '') + ')'
    : 'The description of ' + r[26] + ' ' + A.cert + ' as Card Hedge relays it from GemRate: “' + (A.desc || '') + '”';
}
function grAuthCells(r, c) {
  const g = String(r[26]).toLowerCase(), A = (c.a || {})[g], fc = (A && A.fc) || {}, S = r[70], src = grAuthSrc(r, c);
  const word = v => GR_AST_TIP[v] !== undefined;
  const cell = (v, tip, cls, num) => word(v) || v == null ? '<td' + (num ? ' class="num"' : '') + '><span class="dim" title="' + esc(GR_AST_TIP[v] || GR_AST_TIP[r[62]] || '') + '">' + esc(v == null ? (word(r[62]) ? r[62] : 'none') : v) + '</span></td>'
    : '<td class="' + (num ? 'num ' : '') + (cls || '') + '" title="' + esc(tip) + '">' + (typeof v === 'number' ? fmtInt(v) : esc(v)) + '</td>';
  const bad = (...f) => f.some(x => fc[x] === 'mismatch') ? 'rfbad' : '';
  const slab = S && S[0] === 'ok' ? (S[5] === 'pg' ? r[26] + '’s own cert page (opened by you) of ' : S[5] === 'psa' ? 'PSA’s record of ' : 'Card Hedge’s record (from GemRate) of ') + r[26] + ' ' + S[6] + (S[8] ? ', read ' + S[8] : '') : '';
  const ok = S && S[0] === 'ok', notGiven = v => v == null && ok ? 'not given' : v;   // read, but this source does not carry it
  return cell(r[56], src + (A && A.ch ? ' · Card Hedge’s matched card: ' + [A.ch.player, A.ch.set, A.ch.number && '#' + A.ch.number, A.ch.variant].filter(Boolean).join(' · ') : '')) +
    cell(r[57], src) +
    cell(r[58], src + ' · graders print no set size, so the total is none' + (fc.number === 'mismatch' ? ' · RED: a different number from PC’s or CL’s' : ''), bad('number'), true) +
    cell(r[59], 'Rarity · finish (· special) from the grader’s own words, read with the dictionary' + (A && A.src === 'pg' ? ' (the cert page’s variety' + (String(r[26]) === 'PSA' ? ', label type, card name after the hyphen, brand)' : ' and set)') : A && A.src === 'psa' ? ' (PSA’s card name after the hyphen, variety, label type, brand)' : ' (the description)') + '; none = the grader does not say. ' + src, bad('rarity', 'finish', 'special')) +
    cell(r[60], src + (fc.release === 'mismatch' ? ' · AMBER: a different year from PC’s or CL’s (PriceCharting dates promos and some old sets by the set)' : ''), fc.release === 'mismatch' ? 'rfnear' : '') +
    cell(r[61], A && A.ls ? 'Written by the grader. ' + src : 'The grader names no language - PSA and CGC write it only for a non-English card, so this is English. ' + src) +
    cell(r[62], 'The grade on the slab: ' + slab) +
    cell(r[63], 'PSA’s label type: ' + slab) +
    // Auth Pop / Pop Higher: back on 2026-11-02 (removed 2026-10-29 - Card Hedge cannot give them; the cert pages Brett
    // opens and PSA's API do); Auth Estimate: PSA's estimate on its cert page
    cell(notGiven(r[64]), 'The grader’s population of this grade: ' + slab, '', true) +
    cell(notGiven(r[65]), 'Graded higher than this slab, by the same grader: ' + slab, '', true) +
    (r[77] != null ? '<td class="num" title="' + esc('PSA’s estimate on its cert page: ' + slab) + '">' + fmtMoney(r[77]) + '</td>' : cell(notGiven(null), '', '', true));
}
/* the CL Cert cells (2026-11-10): the cert number on Card Ladder's picture of this grade's slab, or why there is none;
   the eleven CL Cert columns beside it say "not looked up" until its lookups exist. */
const GR_CLC_TIP = {'not read': 'Card Ladder’s picture of this grade’s slab has not been read yet: the CL Cert reader goes through every PSA / CGC picture once (the four grades the page shows at first come first), every two hours - this fills in after the next site build.',
  'none': 'Card Ladder has no picture of a slab of this grade for this card, so there is no cert to read.',
  'unreadable': 'No cert number could be read off Card Ladder’s picture of this grade - the label too small or blurred, a cropped or back-side photo. Review shows the picture.',
  'two slabs': 'Card Ladder’s picture of this grade shows two slabs’ certs (a lot), so neither was taken. Review shows the picture.',
  'picture gone': 'Card Ladder’s picture of this grade did not load three times (eBay drops old pictures).',
  'not looked up': 'The CL cert is known (the CL Cert column) but not looked up yet: these columns will hold what the grader says of that slab.'};
function grClCertCell(r, clNone) {
  if (r[75] === 'pending' || r[75] === 'no match') return '<td>' + clNone + '</td>';
  if (r[84]) return '<td><a href="' + esc(r[84]) + '" target="_blank" rel="noopener" title="' + esc('The cert number on Card Ladder’s picture of a ' + r[25] + ' slab of this card (the picture Review shows), read off its barcode; opens its ' + r[26] + ' cert page. Another copy of the card than PC Cert’s - each slab has its own cert.') + '">' + esc(r[83]) + '</a></td>';
  return '<td><span class="dim" title="' + esc(GR_CLC_TIP[r[83]] || '') + '">' + esc(r[83] || 'none') + '</span></td>';
}
function grClCertCells(r, clNone) {
  const off = r[75] === 'pending' || r[75] === 'no match'; let h = '';
  for (let i = 85; i <= 95; i++) h += '<td' + (i === 87 || i >= 93 ? ' class="num"' : '') + '>' + (off ? clNone : '<span class="dim" title="' + esc(GR_CLC_TIP[r[i]] || '') + '">' + esc(r[i] || 'none') + '</span>') + '</td>';
  return h;
}
function grRow(r) {
  if (r[48]) return grRawCells(r);
  const pcSrc = grSrcTitle(r), mixed = (r[69] || [])[2] === 'chart_mixed';
  const c = (GR.doc.cards || {})[String(r[0])] || {};
  const aFC = (((c.a || {})[String(r[26]).toLowerCase()] || {}).fc) || {};
  const relMis = grFC(c, 'release') === 'mismatch', serMis = grFC(c, 'series') === 'mismatch' || aFC.series === 'mismatch', eraMis = grFC(c, 'era') === 'mismatch' || aFC.era === 'mismatch';
  const rfMis = grFC(c, 'rarity') === 'mismatch' || grFC(c, 'finish') === 'mismatch' || grFC(c, 'special') === 'mismatch';   // a Special word only one side names counts (2026-10-29)
  const setTip = /^pokemon game( promo)?$/i.test(String(r[30] || '')) ? ' title="PSA’s own name: Pokemon Game = 1999 Base Set, Pokemon Game Promo = the Wizards promos (Card Ladder uses PSA’s names)"' : '';
  const gSame = grSameGrade(r[71], r[72]), gDiff = !!r[71] && !!r[72] && !gSame;
  const gTip = (side, v, from) => esc(v ? side + ' grade: ' + v + ' - from ' + from + (gDiff ? '. RED: PriceCharting’s grade and Card Ladder’s are not the same, so their prices are not compared' : '') : side + ' has no ' + r[25] + ' (none)');
  // a card Card Ladder has not been read for yet: its CL cells say pending (none = read, and Card Ladder has nothing);
  // no match (no page found, or answered Not the same card): every CL cell says no match (2026-11-03)
  const pend = r[75] === 'pending', nom = r[75] === 'no match', clsTip = grClsTip(c, r[75], r[0]);
  const clNone = pend || nom ? '<span class="dim" title="' + esc(clsTip) + '">' + (pend ? 'pending' : 'no match') + '</span>' : '<span class="dim">none</span>';
  return '<td' + (gDiff ? ' class="rfbad"' : '') + ' title="' + gTip('PriceCharting', r[71], GR_PCG_FROM[r[73]] || 'PriceCharting') + '"><b>' + (r[71] ? esc(r[71]) : '<span class="dim">none</span>') + '</b>' + grMatchTag(r) + '</td>' +
    (pend || nom ? '<td>' + clNone + '</td>' : '<td' + (gDiff ? ' class="rfbad"' : '') + ' title="' + gTip('Card Ladder', r[72], GR_CLG_FROM[r[74]] || 'Card Ladder') + '"><b>' + (r[72] ? esc(r[72]) : '<span class="dim">none</span>') + '</b></td>') +
    '<td class="gcls ' + (r[75] === 'read' ? 'read' : r[75] === 'no match' ? 'nom' : 'pend') + '" title="' + esc(clsTip) + '">' + esc(r[75] || '') + '</td>' +
    grPcCells(r, c) +
    (r[27] ? '<td><a href="' + esc(r[28]) + '" target="_blank" rel="noopener" title="' + (/spec/.test(r[27]) ? 'No ' + esc(r[25]) + ' slab read yet: PSA’s page for the card itself (spec ' + esc(c.spec) + '; PSA asks you to sign in)' : 'The cert number of a ' + esc(r[25]) + ' slab of this card, read off a PriceCharting sold-listing photo (the PC Cert columns are what the grader says of it); opens its ' + esc(r[26]) + ' cert page') + '">' + esc(r[27]) + '</a></td>' : '<td><span class="dim" title="No ' + esc(r[25]) + ' slab read yet, and no PSA spec for a CGC row">none</span></td>') +
    (r[29] ? '<td><a href="' + esc(r[31]) + '" target="_blank" rel="noopener" title="Open the card on Card Ladder">' + esc(r[29]) + '</a></td>' : '<td>' + clNone + '</td>') +
    (r[30] ? '<td' + setTip + '>' + esc(r[30]) + '</td>' : '<td>' + clNone + '</td>') +
    (pend || nom ? '<td class="num">' + clNone + '</td>' : '<td class="num' + (grFC(c, 'number') === 'mismatch' ? ' rfbad' : '') + '" title="' + esc(c.cnf ? 'From ' + c.cnf : 'Card Ladder gives no number') + '">' + esc(r[32] || 'none') + '</td>') +
    (pend || nom ? '<td>' + clNone + '</td>' : '<td' + (rfMis ? ' class="rfbad"' : '') + ' title="' + esc('From Card Ladder’s own words (variation, card name, set name, its cert lookups), read with the dictionary; none = Card Ladder does not say. A ? marks a word the dictionary only thinks it knows.' + (rfMis ? ' RED: PC and CL disagree' + (grFC(c, 'special') === 'mismatch' ? ' - a Special word (1st Edition, a stamp, Ultra Premium Collection …) that only one side names: the other side is the regular printing, so they may be different cards. Check with Review.' : '.') : '')) + '">' + esc(r[33] || 'none') + '</td>') +
    '<td' + (relMis ? ' class="rfnear" title="Card Ladder’s year (the grader’s label) differs from PriceCharting’s release date - PriceCharting dates promos and some older sets by the set, not the card"' : '') + '>' + (r[34] ? esc(r[34]) : clNone) + '</td>' +
    grClCertCell(r, clNone) +
    grAuthCells(r, c) + grClCertCells(r, clNone) +
    (c.pi ? '<td title="' + esc('The Artist on TCGplayer’s product page for the product PriceCharting links to') + '">' + esc(c.pi) + '</td>'
      : '<td><span class="dim" title="' + esc(c.pi === '' ? 'TCGplayer’s product page shows no artist for this card' : c.pif || 'TCGplayer’s product page has not been read for this card yet - each site build reads the new cards') + '">' + (c.pi === '' ? 'none' : 'not read') + '</span></td>') +
    '<td><span class="dim" title="Card Ladder does not record the illustrator">none</span></td>' +
    (r[53] ? '<td' + (serMis ? ' class="rfbad"' : '') + ' title="' + esc('PC: ' + ((c.ser || [])[0] || 'none') + ' · CL: ' + ((c.ser || [])[1] || 'none') + ' · PC Cert: ' + ((c.ser || [])[2] || 'none') + ' - only where a series name is written in the text') + '">' + esc(r[53]) + '</td>' : '<td></td>') +
    (r[54] ? '<td' + (eraMis ? ' class="rfbad"' : '') + ' title="' + esc('PC: ' + ((c.era || [])[0] || 'none') + ' · CL: ' + ((c.era || [])[1] || 'none') + ' · PC Cert: ' + ((c.era || [])[2] || 'none')) + '">' + esc(r[54]) + '</td>' : '<td></td>') +
    grInt(r[5]) +
    (r[6] == null ? '<td class="num"><span class="dim" title="' + esc((grPc1Title(r) || 'No ' + r[25] + ' sale recorded by PriceCharting last month') + '. Today: ' + (r[67] != null ? fmtMoneyPlain(r[67]) + ' (' + pcSrc + ')' : 'none')) + '">' + ((r[69] || [])[2] === 'not_read' ? 'not read' : (r[69] || [])[2] === 'none' ? 'none' : '-') + '</span></td>'
      : '<td class="num' + (mixed ? ' gmix' : '') + '" title="' + esc(grPc1Title(r) + ' · Today: ' + (r[67] != null ? fmtMoneyPlain(r[67]) + ' (' + pcSrc + ')' : 'none')) + '">' + fmtMoney(r[6]) + (mixed ? '<sup>*</sup>' : '') + '</td>') +
    (r[35] == null ? (pend || nom ? '<td class="num">' + clNone + '</td>' : '<td class="num"><span class="dim" title="' + esc('Card Ladder recorded no ' + r[25] + ' sale last month. Its value today: ' + (r[68] != null ? fmtMoneyPlain(r[68]) : 'none')) + '">-</span></td>')
      : '<td class="num" title="' + esc('Card Ladder’s average of the ' + (r[37] != null ? r[37] + ' ' : '') + r[25] + ' sales it recorded in ' + grMonthName(r[17]) + ' (an average: Card Ladder gives only its monthly average, so Hodges–Lehmann waits until its single sales are saved) · its value today: ' + (r[68] != null ? fmtMoneyPlain(r[68]) : 'none')) + '">' + fmtMoney(r[35]) + '</td>') +
    (r[36] != null ? '<td class="num' + (grUnsure(r) || grWrong(r) ? ' gdoubt' : '') + '" title="' + esc('PC’s ' + ((r[69] || [])[2] === 'hl' ? 'Hodges–Lehmann estimate' : 'chart value') + ' vs CL’s average, last month (both ' + r[71] + ')' + (grUnsure(r) || grWrong(r) ? '. Greyed: the match is in doubt - answer Review first' : '')) + '">' + fmtPct(r[36], true, 1) + '</td>'
      : r[6] != null && r[35] != null ? '<td class="num rfbad" title="' + esc('Not compared: PriceCharting’s price is for ' + (r[71] || 'another grade') + ', Card Ladder’s for ' + (r[72] || 'another grade') + ' - not the same grade') + '">≠ grade</td>' : gdash) +
    grStatCells(r) +
    (r[76] && r[16] != null ? '<td class="num" title="' + esc('Estimate: PriceCharting lists only its latest 30 sales of a grade, and the ' + r[25] + ' sales we recorded do not reach back to the start of ' + grMonthName(r[17]) + ' - this is how many that month at the pace they came (the Card Ladder queue ranks cards the same way)') + '">~' + fmtInt(r[16]) + '</td>'
      : r[16] == null && (r[69] || [])[2] === 'not_read' ? '<td class="num"><span class="dim" title="' + esc(grPc1Title(r)) + '">not read</span></td>' : grInt(r[16])) +   // 2026-11-03: grades 1-6 until the card's page is read again
    (r[37] == null && (pend || nom) ? '<td class="num">' + clNone + '</td>' : grInt(r[37])) + gdash + gdash +
    gdash + gdash + gdash + gdash + gdash + gdash +
    '<td><button class="tbtn gtbtn" data-k="' + r[0] + '|' + esc(r[50]) + '">Trend</button></td>' +
    (!c.pid ? '<td><span class="dim" title="' + esc('Review puts PriceCharting’s card beside Card Ladder’s - this card has no Card Ladder card yet. ' + clsTip) + '">-</span></td>'
      : '<td><button class="rvb grvb' + (r[41] === 1 ? ' same' : r[41] === 0 ? ' diff' : '') + '" data-k="' + r[0] + '|' + esc(r[50]) + '" title="' + (r[41] === 1 ? 'You said: same card' : r[41] === 0 ? 'You said: not the same card' : 'Compare PriceCharting’s card with Card Ladder’s') + '">Review</button></td>') +
    '<td class="gflc">' + (r[42] ? '<button class="gflag on" data-k="' + r[0] + '|' + esc(r[50]) + '" title="' + esc('Your flag: ' + r[42] + ((GMARKS[r[0] + '|' + r[50]] || {}).note ? ' - ' + GMARKS[r[0] + '|' + r[50]].note : '') + '. Click to change it or take it off.') + '">⚑ ' + esc(r[42]) + '</button>' : '<button class="gflag" data-k="' + r[0] + '|' + esc(r[50]) + '" title="Flag this row with a reason - this view’s own flags, kept apart from the eBay tabs’ Flags">⚐</button>') + '</td>';
}
function grRawCells(r) {                                    // a raw card in the both-view (the raw tab's figures, the CL columns empty)
  return '<td><span class="dim">Raw</span></td>' + gdash + gdash + cells4(r, pcRFCell(pcRF(r)), '', (pcRF(r) || [])[0]) +
    gdash.repeat(7) + gdash.repeat(22) + gdash.repeat(2) + gdash.repeat(2) + grInt(r[5]) + grMoney(r[6]) + gdash + gdash +
    grPct(r[7]) + grPct(r[8]) + grPct(r[9], false, 0) +
    '<td class="num">' + (r[10] == null ? dash : '<span class="' + (r[11] > 0 ? 'up' : r[11] < 0 ? 'down' : '') + '">' + (r[11] > 0 ? '+' : '') + r[11] + ' (' + (r[10] > 0 ? '+' : '') + r[10].toFixed(1) + '%)</span>') + '</td>' +
    grPct(r[12], false, 2) + grPct(r[13]) +
    pcSalesCell(r[16], r[17]) + gdash + gdash + gdash +
    kmCell(r[18]) + '<td class="num">' + fmtInt(r[19]) + '</td>' + '<td class="num">' + fmtMoney(r[20]) + '</td>' +
    '<td class="num">' + (r[21] == null ? dash : '<span class="' + (r[21] < -40 || r[21] > 200 ? 'down' : '') + '">' + fmtPct(r[21], true, 0) + '</span>') + '</td>' +
    hitsCell(r[22]) + hitPctCell(r[23], null) +
    '<td><button class="tbtn" data-i="' + ordOf(idRow.get(r[0]) || r) + '">Trend</button></td>' + gdash + gdash;
}

/* ---- the two tables (graded / both) ---- */
const GR_RANGES = [5, 6, 35, 36, 7, 8, 9, 12, 13, 16, 37, 38, 39, 18, 19, 20, 21, 22, 23];
const GR_LABELS = {5: 'Sales/yr', 6: 'PC Graded (last month)', 35: 'CL Graded (last month)', 36: 'PC to CL %', 7: 'Δ7d %', 8: 'Δ30d %', 9: 'Range 90d %', 12: 'Volatility %', 13: 'Slope %/mo',
  16: 'PC sales', 37: 'CL sales', 38: 'Graded this mo', 39: 'Graded last mo', 18: 'eBay last mo', 19: 'eBay this mo', 20: '$eBay Anchor', 21: 'eBay to PC %', 22: 'Hits 30d', 23: 'Hit %'};
const grCfg = (rows, noun) => ({rows, noun, ranges: GR_RANGES, labels: GR_LABELS, defaults: {},
  fav: {s: 'pc', k: r => r[0], c: r => r[0]},
  extra: r => r[48] ? !GF.pc.flag && !GF.pc.unsure && !GF.pc.authread && GF.pc.clread === 'both' && GF.pc.clmatch === 'both' && grTermPass(r[0], true)
    : grPass(r),
  rowClass: r => r[48] ? '' : grWrong(r) ? 'grwrong' : grUnsure(r) ? 'grunsure' : '',
  hay: r => [r[1], r[2], r[14], r[25], r[71], r[72], r[29], r[30], r[27], r[33], r[53], r[54], r[51], r[56], r[57], r[59], r[62], r[63], r[75], r[84] ? r[83] : ''].filter(x => x && !GR_AST_TIP.hasOwnProperty(x)).join(' '),
  // columns added (or removed, n < 0) since a layout was saved, so Brett's own order and eyes stay on the same columns:
  // v1 Graded To PC Sales Ratio removed; v2 PC Illustrator, CL Illustrator, Series, Era after CL Release (2026-10-28);
  // v3 the ten Auth columns after CL Release, v4 Auth Illustrator after CL Illustrator; v5 / v6 Auth Pop and Auth Pop
  // Higher removed again (2026-10-29); v7 CL Grade after the grade column, which became PC Grade (2026-10-29); v8 CL Status
  // after CL Grade (2026-10-30: every PriceCharting graded card, read / pending / no match); v9 Auth Pop, Auth Pop Higher
  // and Auth Estimate after Auth Label (2026-11-02: the cert pages Brett opens carry them); 2026-11-10 (the Auth columns
  // became the PC Cert columns): v10 Auth Illustrator removed, v11 CL Cert after CL Release, v12 the eleven CL Cert
  // columns after PC Cert Estimate
  inserted: [{v: 1, at: 28, n: -1}, {v: 2, at: 14, n: 4}, {v: 3, at: 14, n: 10}, {v: 4, at: 26, n: 1}, {v: 5, at: 22, n: -1}, {v: 6, at: 22, n: -1}, {v: 7, at: 3, n: 1}, {v: 8, at: 4, n: 1}, {v: 9, at: 24, n: 3},
    {v: 10, at: 29, n: -1}, {v: 11, at: 16, n: 1}, {v: 12, at: 28, n: 11}],
  row: grRow, root: null});
const GR_TABLES = {pcg: Object.assign(grCfg(() => GR.rows, 'graded rows'), {root: '#pcv-g', name: 'PriceCharting · graded'}),
                   pca: Object.assign(grCfg(grAll, 'rows'), {root: '#pcv-a', name: 'PriceCharting · raw + graded'})};
for (const id in GR_TABLES) if ($('rows-' + id)) tables[id] = makeTable(id, GR_TABLES[id]);

/* ---- Rarity / Finish / Special / Series / Era / Unidentified: the words each side uses, as filter buttons ----
   (2026-10-28, Brett: "three buttons ... if I click on the button, then it'll show me all of the labels that are
   categorized under rarity ... an unidentified button listing showing all terms and labels that we don't know where it
   goes"; "all of those should be toggleable"; "an option for within one button versus across buttons"; "a special
   button for cases like first edition"). The lists come from graded_site.py (doc.terms: [term, confidence, graded
   cards on the PC side, on the CL side, PriceCharting catalog brackets, where seen]); each card's own words are
   cards[id].t. A term switched off hides the cards that carry only switched-off terms; "(none)" is the cards whose
   side says nothing. Inside a button: any (a card with at least one ticked term) or all (every ticked term); side:
   PC, CL, either or both agree. Across buttons: all (every active button passes) or any. Remembered in this browser. */
function grTermList(cat) { return ((GR.doc && GR.doc.terms) || {})[cat] || []; }
function grCardTerms(c, cat, side) {                       // side: pc | cl | auth | either | both (= all agree)
  const t = (c && c.t) || {}, get = s => cat === 'Unidentified' ? ((t.u || {})[s] || []) : (((t[s] || {})[cat]) || []);
  if (side === 'pc' || side === 'cl' || side === 'auth') return get(side);
  const a = get('pc'), b = get('cl'), au = get('auth'), hasAuth = c && c.a && Object.keys(c.a).length > 0;
  return side === 'both' ? a.filter(x => b.includes(x) && (!hasAuth || au.includes(x))) : [...new Set(a.concat(b, au))];
}
function grTermActive(cat, F = GF.pc) { return (F.gts.off[cat] || []).length > 0 || F.gts.within[cat] === 'all'; }
function grCatPass(c, cat, F = GF.pc) {
  const off = new Set(F.gts.off[cat] || []), terms = grCardTerms(c, cat, F.gts.side[cat] || 'either');
  if (!terms.length) return !off.has('(none)');
  if (F.gts.within[cat] === 'all') { const on = grTermList(cat).map(x => x[0]).filter(x => !off.has(x)); return on.length > 0 && on.every(x => terms.includes(x)); }
  return terms.some(x => !off.has(x));
}
function grTermPass(cid, raw, F = GF.pc) {
  const act = GT_CATS.filter(cat => grTermActive(cat, F)); if (!act.length) return true;
  const c = GR.doc && GR.doc.cards[String(cid)]; if (!c) return !raw ? true : false;   // a raw card with no graded rows: hidden while a word filter is on
  const res = act.map(cat => grCatPass(c, cat, F));
  return F.gts.across === 'any' ? res.some(Boolean) : res.every(Boolean);
}
function grTermsChanged(F = GF.pc) { grSave(F.p + 'gterms', F.gts); grPaintTerms(F); F.apply(); }
function grPaintAllTerms() { for (const k in GF) grPaintTerms(GF[k]); }
function grPruneDec() {
  const d = (GR.doc && GR.doc.dect) || 0; let ch = false;
  for (const k in GTDEC) if (GTDEC[k].t <= d) { delete GTDEC[k]; ch = true; }
  if (ch) gtdSave();
}
function grDecTag(name, left) {                             // a word sorted here and not in the data yet
  const d = GTDEC[String(name).toLowerCase()] || (left ? GTDEC[String(left).toLowerCase()] : null); if (!d) return '';
  return '<span class="gtdec" title="Saved and sent to the collector; the site shows it after the next site build files it into card-data/data/dictionary/terms.csv">' +
    (d.term.toLowerCase() !== String(name).toLowerCase() ? '“' + esc(d.term) + '” ' : '') + '→ ' + esc(d.cat === 'Unidentified' ? 'Unsorted' : d.cat) + (d.same ? ' (same as ' + esc(d.same) + ')' : '') + (d.sent === false ? ' · not sent yet' : ' · saved') + '</span>';
}
/* The filter buttons' order (2026-10-29, Brett: "i want the filter button in the only graded page to be draggable and
   rearrangable like the other tabs"): Grading, the word buttons and Flags move with the same hold-and-drag as the
   filter chips - press one, hold it still a moment (it lifts), drag it along the row, let go. Remembered in this
   browser (gm-order); a button that arrives later takes its natural place. */
const GM_KEYS = ['grading'].concat(GT_CATS, ['flags', 'unsure', 'authread', 'clread', 'clmatch']);
function gmOrder(F = GF.pc) {
  const sv = Array.isArray(F.order) ? F.order.filter(k => GM_KEYS.includes(k)) : [];
  GM_KEYS.forEach((k, i) => { if (!sv.includes(k)) sv.splice(i ? sv.indexOf(GM_KEYS[i - 1]) + 1 : 0, 0, k); });
  return sv;
}
function grPaintTerms(F = GF.pc) {
  const box = $(F.ids.terms); if (!box) return;
  const gb = $(F.ids.grades);
  if (gb && box.contains(gb)) box.parentNode.insertBefore(gb, box);   // the live Grading button stays out of the redraw
  if ((F === GF.pc && PCMODE === 'raw') || !GR.doc) { box.hidden = true; return; }
  box.hidden = false;
  grPruneDec();
  const part = {grading: '<span id="' + F.ids.grades + '-slot"></span>',
    flags: '<button type="button" class="gm2 gtb gflb' + (F.flag ? ' on' : '') + '" data-mv="flags" title="This view’s own flags (the Flag column), kept apart from the eBay tabs’ Flags: on = show only the flagged rows. Hold and drag to move it.">⚑ Flags <span class="dim">(' + GR.rows.filter(r => r[42]).length + ')</span></button>',
    unsure: '<button type="button" class="gm2 gtb gunb' + (F.unsure ? ' on' : '') + '" data-mv="unsure" title="On = show only the rows whose match is in doubt (unsure match / likely wrong match), to answer them in Review. Hold and drag to move it.">Unsure <span class="dim">(' + new Set(GR.rows.filter(r => grUnsure(r) || grWrong(r)).map(r => r[0])).size + ' cards)</span></button>',
    authread: '<button type="button" class="gm2 gtb garb' + (F.authread ? ' on' : '') + '" data-mv="authread" title="On = show only the rows whose own slab (PC Cert) has been read - a PSA / CGC cert page you opened with the Cert Reader extension (or PSA’s record): their PC Cert Grade, Pop, Pop Higher and Estimate are filled. Hold and drag to move it.">PC Cert read <span class="dim">(' + GR.rows.filter(grAuthRead).length + ' rows)</span></button>',
    clread: (() => { const all = GR.rows.length, rd = GR.rows.filter(r => r[75] !== 'pending').length;
      return '<button type="button" class="gm2 gtb gclb' + (F.clread !== 'both' ? ' on' : '') + '" data-mv="clread" title="Has the Card Ladder run looked at the card yet? Click: both → read only (looked at: matched or no match) → pending only (not reached yet) → both. Hold and drag to move it.">CL read: <b>' + GCL_WORD[F.clread] + '</b> <span class="dim">| ' + grK(rd) + ' of ' + grK(all) + '</span></button>'; })(),
    clmatch: (() => { const rd = GR.rows.filter(r => r[75] !== 'pending').length, m = GR.rows.filter(r => r[75] === 'read').length;
      return '<button type="button" class="gm2 gtb gclb' + (F.clmatch !== 'both' ? ' on' : '') + '" data-mv="clmatch" title="Of the rows the Card Ladder run has looked at: is a Card Ladder page paired with the PriceCharting card? Click: both → matched only → no match only (no page found, or you answered Not the same card) → both. Unsure and likely-wrong matches count as matched. Only the CL / PC pairing - the cert columns play no part. Hold and drag to move it.">CL To PC Match: <b>' + GCL_WORD[F.clmatch] + '</b> <span class="dim">| ' + grK(m) + ' of ' + grK(rd) + ' read</span></button>'; })()};
  GT_CATS.forEach(cat => { const L = grTermList(cat), off = new Set(F.gts.off[cat] || []), on = L.filter(x => !off.has(x[0])).length;
    part[cat] = '<button type="button" class="gm2 gtb' + (grTermActive(cat, F) ? ' on' : '') + '" data-cat="' + cat + '" data-mv="' + cat + '" title="' + esc(cat + ': the words PriceCharting / TCGplayer, Card Ladder and the grader use - tick which to show. Hold and drag to move it.') + '">' + cat + ' <span class="dim">(' + (grTermActive(cat, F) ? on + ' of ' : '') + L.length + ')</span> ▾</button>'; });
  box.innerHTML = gmOrder(F).map(k => part[k]).join('') +
    '<span class="gtacross" title="How the active buttons combine">Across buttons: <button type="button" class="zb' + (F.gts.across !== 'any' ? ' on' : '') + '" data-a="all">all</button><button type="button" class="zb' + (F.gts.across === 'any' ? ' on' : '') + '" data-a="any">any</button><button type="button" class="help" data-h="g_across">?</button></span>';
  const slot = $(F.ids.grades + '-slot'); if (slot && gb) { gb.dataset.mv = 'grading'; slot.replaceWith(gb); }
}
function grDragInit(F) { // hold-and-drag for the buttons above (the filter chips' gesture, app.js)
  let lift = null, justDragged = 0;
  const host = $(F.ids.host);
  const items = () => [...host.querySelectorAll('[data-mv]')];
  const end = () => { if (!lift) return; clearTimeout(lift.timer); if (lift.ghost) lift.ghost.remove(); lift.el.classList.remove('lifted'); items().forEach(d => d.classList.remove('drop-l', 'drop-r')); document.body.classList.remove('chip-drag'); lift = null; };
  if (host) {
    host.addEventListener('pointerdown', e => {
      const el = e.target.closest('[data-mv]'); if (!el || e.button !== 0 || (F === GF.pc && PCMODE === 'raw')) return;
      end(); lift = {el, x: e.clientX, y: e.clientY, id: e.pointerId, on: false};
      lift.timer = setTimeout(() => {
        if (!lift) return; lift.on = true; el.classList.add('lifted'); document.body.classList.add('chip-drag');
        const r = el.getBoundingClientRect(); lift.dx = lift.x - r.left; lift.dy = lift.y - r.top;
        const g = el.cloneNode(true); g.removeAttribute('id'); g.classList.add('ghost'); g.style.left = r.left + 'px'; g.style.top = r.top + 'px'; g.style.width = r.width + 'px'; document.body.appendChild(g); lift.ghost = g;
      }, 300);
    });
    document.addEventListener('pointermove', e => {
      if (!lift || e.pointerId !== lift.id) return;
      if (!lift.on) { if (Math.hypot(e.clientX - lift.x, e.clientY - lift.y) > 8) end(); return; }   // moved before it lifted: a click or a scroll
      e.preventDefault();
      lift.ghost.style.left = (e.clientX - lift.dx) + 'px'; lift.ghost.style.top = (e.clientY - lift.dy) + 'px';
      items().forEach(d => d.classList.remove('drop-l', 'drop-r'));
      let best = null;
      items().filter(d => d !== lift.el).forEach(d => { const r = d.getBoundingClientRect(), cx = (r.left + r.right) / 2, dist = Math.hypot(e.clientX - cx, e.clientY - (r.top + r.bottom) / 2); if (!best || dist < best.dist) best = {d, dist, before: e.clientX < cx}; });
      lift.to = best; if (best) best.d.classList.add(best.before ? 'drop-l' : 'drop-r');
    }, {passive: false});
    const drop = e => {
      if (!lift || (e && e.pointerId !== lift.id)) return;
      let moved = false;
      if (lift.on) {
        justDragged = Date.now();
        if (lift.to) { const k = lift.el.dataset.mv, ord = gmOrder(F).filter(x => x !== k), at = ord.indexOf(lift.to.d.dataset.mv); ord.splice(lift.to.before ? at : at + 1, 0, k); F.order = ord; grSave(F.p + 'gm-order', ord); moved = true; }
      }
      end();
      if (moved) grPaintTerms(F);
    };
    document.addEventListener('pointerup', drop); document.addEventListener('pointercancel', drop);
    host.addEventListener('click', e => { if (Date.now() - justDragged < 400 && e.target.closest('[data-mv]')) { e.stopPropagation(); e.preventDefault(); } }, true);   // the click that ends a drag opens nothing
  }
}
grDragInit(GF.pc);
const GT_Q = {};                                           // the search typed in each word button's list (kept while it is redrawn)
function grOpenTerms(cat, F = GF.pc) {
  const L = grTermList(cat), G = F.gts, off = new Set(G.off[cat] || []), side = G.side[cat] || 'either', within = G.within[cat] || 'any';
  const cards = Object.entries((GR.doc && GR.doc.cards) || {});
  const noneN = cards.filter(([, c]) => !grCardTerms(c, cat, side).length).length;
  const confTag = v => v === 'likely' ? ' <span class="gtconf" title="likely: one reference, or Claude’s judgment - not confirmed yet">?</span>' : v === 'uncertain' ? ' <span class="gtconf bad" title="uncertain: the references disagree">??</span>' : '';
  const row = (name, conf, pcN, clN, catN, where, left, authN) => '<div class="gtrow"><label><input type="checkbox" data-t="' + esc(name) + '"' + (off.has(name) ? '' : ' checked') + '> <span class="gtname" data-t="' + esc(name) + '">' + esc(name) + '</span>' + confTag(conf) + '</label>' +
    '<span class="gtn">' + (name === '(none)' ? '×' + pcN + ' cards' : 'PC ×' + pcN + ' · CL ×' + clN + ' · PC Cert ×' + (authN || 0) + (catN ? ' · catalog ×' + catN.toLocaleString('en-US') : '')) + '</span>' +
    (name === '(none)' ? '' : '<button type="button" class="linkbtn gtsortb" data-t="' + esc(name) + '" data-l="' + esc(left || '') + '" title="Put this word under a category, say it means the same as another word, or mark it meaningless">Sort</button>' + grDecTag(name, left)) +
    (left && left.toLowerCase() !== String(name).toLowerCase() ? '<small class="dim">unknown words: <b>' + esc(left) + '</b></small>' : '') +
    (where ? '<small class="dim">' + esc(where) + '</small>' : '') + '<div class="gtsort" hidden></div><div class="gtcards" hidden></div></div>';
  $('btitle').textContent = cat + ' · ' + F.ids.title;
  $('bsub').innerHTML = (cat === 'Unidentified' ? 'Words seen on a card that the dictionary (card-data/data/dictionary/terms.csv) does not place yet, with where they were seen. ' : 'The words sorted as ' + cat + ' by the dictionary (card-data/data/dictionary/terms.csv). ') +
    'PC × / CL × / PC Cert × = graded cards whose PriceCharting / Card Ladder / grader side (what PSA / CGC say of the PC Cert slab) carries it; catalog × = PriceCharting [brackets] across every card. Tap a word to see its cards; untick to hide them; Sort to file it in the dictionary (it takes effect at the next site build).';
  // Select all / Deselect all / search (2026-10-29, Brett: "after clicking on any button ... there should be a select
  // all option, a deselect all option, and a search feature"): with a search typed, the two act on the words shown
  $('bbody').innerHTML = '<div class="gtsearch"><input type="search" id="gt-q" placeholder="Search these ' + L.length.toLocaleString('en-US') + ' words…" value="' + esc(GT_Q[cat] || '') + '"><button type="button" class="reset" id="gt-all">Select all</button><button type="button" class="reset" id="gt-none">Deselect all</button><span class="dim" id="gt-qn"></span></div>' +
    '<div class="gtctl"><span>Inside this button: <button type="button" class="zb' + (within === 'any' ? ' on' : '') + '" data-w="any">any</button><button type="button" class="zb' + (within === 'all' ? ' on' : '') + '" data-w="all">all</button><button type="button" class="help" data-h="g_within">?</button></span>' +
    '<span>Side: ' + ['either', 'pc', 'cl', 'auth', 'both'].map(x => '<button type="button" class="zb' + (side === x ? ' on' : '') + '" data-s="' + x + '" title="' + ({either: 'a card any side carries it on', pc: 'PriceCharting / TCGplayer', cl: 'Card Ladder', auth: 'the grader on the PC Cert slab (PSA’s cert record, or the description Card Hedge relays)', both: 'every side that has read the card carries it'})[x] + '">' + (x === 'pc' ? 'PC' : x === 'cl' ? 'CL' : x === 'auth' ? 'PC Cert' : x === 'both' ? 'all agree' : 'either') + '</button>').join('') + '<button type="button" class="help" data-h="g_side">?</button></span></div>' +
    (within === 'all' ? '<p class="dim">“all”: only cards that carry every ticked word - tick just the words a card must have.</p>' : '') +
    '<div class="gtlist">' + row('(none)', '', noneN, 0, 0, 'cards whose ' + (side === 'either' ? 'sides say' : side === 'both' ? 'sides agree on' : (side === 'auth' ? 'PC Cert' : side.toUpperCase()) + ' side says') + ' nothing here') +
    L.map(x => row(x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7])).join('') + '</div>' + '<datalist id="gt-dl"></datalist>' +
    '<div class="pickbtns"><button class="reset" id="gt-done">Done</button></div>';
  const body = $('bbody');
  body.querySelector('.gtlist').addEventListener('input', e => { const i = e.target; if (i.dataset.t == null) return; const o = new Set(G.off[cat] || []); if (i.checked) o.delete(i.dataset.t); else o.add(i.dataset.t); G.off[cat] = [...o]; grTermsChanged(F); });
  body.querySelector('.gtlist').addEventListener('click', e => {
    const sb = e.target.closest('.gtsortb'); if (sb) { grSortEditor(sb.closest('.gtrow'), sb.dataset.t, sb.dataset.l, cat); return; }
    const n = e.target.closest('.gtname'); if (!n) return; e.preventDefault();
    const box = n.closest('.gtrow').querySelector('.gtcards'); if (!box.hidden) { box.hidden = true; return; }
    const t = n.dataset.t, hits = cards.filter(([, c]) => t === '(none)' ? !grCardTerms(c, cat, side).length : grCardTerms(c, cat, 'either').includes(t));
    box.innerHTML = hits.length ? hits.slice(0, 80).map(([id, c]) => { const b = idRow.get(+id) || []; const sides = t === '(none)' ? '' : [grCardTerms(c, cat, 'pc').includes(t) ? 'PC' : '', grCardTerms(c, cat, 'cl').includes(t) ? 'CL' : '', grCardTerms(c, cat, 'auth').includes(t) ? 'PC Cert' : ''].filter(Boolean).join(' + ');
      return '<div><a href="https://www.pricecharting.com/game/' + id + '" target="_blank" rel="noopener">' + esc(b[1] || id) + '</a> <span class="dim">' + esc(String(b[2] || '').replace(/^Pokemon /, '')) + (sides ? ' · ' + sides : '') + '</span></div>'; }).join('') + (hits.length > 80 ? '<div class="dim">… ' + (hits.length - 80) + ' more</div>' : '')
      : '<div class="dim">No graded card carries it yet' + (t === '(none)' ? '' : ' - only PriceCharting’s catalog brackets') + '.</div>';
    box.hidden = false;
  });
  body.querySelector('.gtctl').addEventListener('click', e => { const b = e.target.closest('.zb'); if (!b) return; if (b.dataset.w) G.within[cat] = b.dataset.w; if (b.dataset.s) G.side[cat] = b.dataset.s; grTermsChanged(F); grOpenTerms(cat, F); });
  const shown = () => [...body.querySelectorAll('.gtrow')].filter(el => !el.hidden).map(el => el.querySelector('input[data-t]').dataset.t);
  const filter = () => {
    const q = (GT_Q[cat] = $('gt-q').value.trim()).toLowerCase(); let n = 0;
    body.querySelectorAll('.gtrow').forEach(el => { const t = el.querySelector('input[data-t]').dataset.t, left = (el.querySelector('.gtsortb') || {dataset: {}}).dataset.l || '';
      el.hidden = !!q && !(t.toLowerCase().includes(q) || left.toLowerCase().includes(q)); if (!el.hidden) n++; });
    $('gt-qn').textContent = q ? n.toLocaleString('en-US') + ' shown' : '';
  };
  $('gt-q').addEventListener('input', filter);
  filter();
  $('gt-all').addEventListener('click', () => { const s2 = new Set(shown()), o = (G.off[cat] || []).filter(x => !s2.has(x)); G.off[cat] = o; grTermsChanged(F); grOpenTerms(cat, F); });
  $('gt-none').addEventListener('click', () => { const o = new Set(G.off[cat] || []); shown().forEach(x => o.add(x)); G.off[cat] = [...o]; grTermsChanged(F); grOpenTerms(cat, F); });
  $('gt-done').addEventListener('click', () => $('bov').classList.remove('open'));
  $('bov').classList.add('open');
}
/* Sort (2026-10-28, Brett: "store them in a button for review ... figure out where they go, and which ones mean the same
   things"; "as we figure out the unidentified terms, we can update it accordingly"): the word (for an unidentified
   phrase, its unknown words - editable, so a single word can be filed), the category, optionally the word it means the
   same as, where it may match, and a note. Sent to the collector (type 'gterm'), which keeps it; the site workflow's
   graded_answers.py files it into card-data/data/dictionary/terms.csv (confirmed, basis Brett) and decisions.csv, and
   the next graded.bin is read with it. Echoed here (GTDEC) until then. */
function grSortEditor(rowEl, name, left, cat) {
  const box = rowEl.querySelector('.gtsort'); if (!box.hidden) { box.hidden = true; return; }
  const d = GTDEC[String(left || name).toLowerCase()] || GTDEC[String(name).toLowerCase()] || {};
  let pick = d.cat || (cat === 'Unidentified' ? '' : cat);
  const canon = (GR.doc && GR.doc.canon) || {};
  const fillDl = c => { const dl = $('gt-dl'); if (!dl) return; const names = new Set((canon[c] || []).concat(grTermList(c).map(x => x[0]))); dl.innerHTML = [...names].sort((a, b) => a.localeCompare(b)).map(x => '<option value="' + esc(x) + '">').join(''); };
  box.innerHTML = '<div class="gtsrow"><span class="lab">Word</span><input class="gts-term" value="' + esc(d.term || (cat === 'Unidentified' && left ? left : name)) + '" title="The word to file - for a phrase, its unknown words; edit it to file just one"></div>' +
    '<div class="gtsrow"><span class="lab">Put it under</span>' + GT_SORT_CATS.map(c => '<button type="button" class="zb' + (c === pick ? ' on' : '') + '" data-c="' + c + '">' + (c === 'Unidentified' ? 'Unsorted' : c) + '</button>').join('') + '</div>' +
    '<div class="gtsrow"><span class="lab">Same as</span><input class="gts-same" list="gt-dl" value="' + esc(d.same || '') + '" placeholder="(empty: it is its own name)" title="Another word it means the same thing as - the dictionary then files it under that name"></div>' +
    '<div class="gtsrow"><span class="lab">Matches</span><select class="gts-where"><option value="">as now (anywhere, for a new word)</option><option value="any">anywhere in the text</option><option value="set">only inside a set name</option><option value="exact">only as the whole bracket / variation</option></select></div>' +
    '<div class="gtsrow"><span class="lab">Note</span><input class="gts-note" value="' + esc(d.note || '') + '" placeholder="why (optional, kept with it)"></div>' +
    '<div class="gtsrow"><button type="button" class="tbtn gts-save">Save</button><button type="button" class="linkbtn gts-cancel">Cancel</button><span class="dim gts-msg"></span></div>';
  if (d.where) box.querySelector('.gts-where').value = d.where;
  fillDl(pick || cat);
  box.hidden = false;
  box.querySelectorAll('.zb[data-c]').forEach(b => b.addEventListener('click', () => { pick = b.dataset.c; box.querySelectorAll('.zb[data-c]').forEach(x => x.classList.toggle('on', x === b)); fillDl(pick); }));
  box.querySelector('.gts-cancel').addEventListener('click', () => { box.hidden = true; });
  box.querySelector('.gts-save').addEventListener('click', async () => {
    const msgEl = box.querySelector('.gts-msg'), term = box.querySelector('.gts-term').value.replace(/\s+/g, ' ').trim();
    if (!term) { msgEl.textContent = 'Type the word to file.'; return; }
    if (!pick) { msgEl.textContent = 'Pick where it goes.'; return; }
    const rec = {term: term.slice(0, 120), cat: pick, same: box.querySelector('.gts-same').value.replace(/\s+/g, ' ').trim().slice(0, 120),
      where: box.querySelector('.gts-where').value, note: box.querySelector('.gts-note').value.trim().slice(0, 500), ph: String(name).slice(0, 200), t: Date.now()};
    GTDEC[term.toLowerCase()] = Object.assign({}, rec, {sent: false}); gtdSave();
    msgEl.textContent = 'Saving…';
    let ok = true;
    try { await alSend(Object.assign({type: 'gterm'}, rec)); } catch (e) { ok = false; }
    GTDEC[term.toLowerCase()].sent = ok; gtdSave();
    const old = rowEl.querySelector('.gtdec'); if (old) old.remove();
    rowEl.querySelector('.gtsortb').insertAdjacentHTML('afterend', grDecTag(name, term));
    msgEl.textContent = ok ? 'Saved. It is filed in the dictionary at the next site build.' : 'Kept in this browser; the collector could not be told yet - Save again later.';
    if (ok) setTimeout(() => { box.hidden = true; }, 1200);
  });
}
const grTermsClick = F => e => {
  const hb = e.target.closest('button.help'); if (hb) { e.stopPropagation(); openHelp(hb.dataset.h); return; }   // drawn here, after help.js bound the static ones
  const k = (e.target.closest('[data-mv]') || {dataset: {}}).dataset.mv;
  if (k === 'flags') { F.flag = !F.flag; grSave(F.p + 'gflagonly', F.flag); grTermsChanged(F); return; }
  if (k === 'unsure') { F.unsure = !F.unsure; grSave(F.p + 'gunsureonly', F.unsure); grTermsChanged(F); return; }
  if (k === 'authread') { F.authread = !F.authread; grSave(F.p + 'gauthread', F.authread); grTermsChanged(F); return; }
  if (k === 'clread') { F.clread = GCL_NEXT.gclread[F.clread] || 'both'; grSave(F.p + 'gclread', F.clread); grTermsChanged(F); return; }
  if (k === 'clmatch') { F.clmatch = GCL_NEXT.gclmatch[F.clmatch] || 'both'; grSave(F.p + 'gclmatch', F.clmatch); grTermsChanged(F); return; }
  const b = e.target.closest('.gtb'); if (b && b.dataset.cat) { grOpenTerms(b.dataset.cat, F); return; }
  const a = e.target.closest('.zb[data-a]'); if (a) { F.gts.across = a.dataset.a; grTermsChanged(F); }
};
if ($('gm-terms')) $('gm-terms').addEventListener('click', grTermsClick(GF.pc));

/* ---- Only show raw / Only show graded (one or the other, or neither = both) ---- */
function grNote() {
  const n = $('gm-note'); if (!n) return;
  grMeta();
  if (PCMODE === 'raw') { n.textContent = ''; return; }
  n.innerHTML = GR.err ? '<span class="warn">' + esc(GR.err) + '</span>' : !GR.doc ? 'Loading the graded data…' : '';
}
/* The line under the tabs (2026-10-29, Brett: "this part should change in the price chart only graded page ... it says 43
   thousand cards but only see 1000 graded so far"): in the graded and the both views it describes the graded data.
   Since 2026-10-30 every PriceCharting card with graded data has rows; the line says how far Card Ladder has got. */
function grMeta() {
  const m = $('meta-pc'); if (!m) return;
  if (m.dataset.orig == null) m.dataset.orig = m.textContent;
  if (PCMODE === 'raw' || !GR.doc) { m.textContent = m.dataset.orig; return; }
  const nc = Object.keys(GR.doc.cards).length, nr = GR.rows.length, raw = (typeof DATA !== 'undefined' ? DATA.length : 0), k = GR.doc.cls, f = n => (n || 0).toLocaleString('en-US');
  m.textContent = 'Graded data built ' + GR.doc.built + ' · ' + f(nr) + ' graded rows (one per card per PSA / CGC grade) on ' + f(nc) + ' cards' +
    (k ? ' · Card Ladder read for ' + f(k.read) + ', pending ' + f(k.pending) + (k.nomatch ? ', no match ' + f(k.nomatch) : '') : ' matched to Card Ladder') +
    (PCMODE === 'all' ? ', with all ' + f(raw) + ' raw cards' : '') + ' · prices from PriceCharting and Card Ladder (USD)';
}
function grPaintGrades(F = GF.pc) { const b = $(F.ids.gn); if (b) b.textContent = '(' + F.gsel.size + ')'; }
function grShowMode() {
  const raw = PCMODE === 'raw', g = PCMODE === 'graded', all = PCMODE === 'all';
  $('gm-raw').classList.toggle('on', raw); $('gm-raw').setAttribute('aria-pressed', raw);
  $('gm-g').classList.toggle('on', g); $('gm-g').setAttribute('aria-pressed', g);
  $('pcv-raw').hidden = !raw; $('pcv-g').hidden = !g; $('pcv-a').hidden = !all;
  grNote(); grPaintGrades(); grPaintTerms();
  if (!raw) grLoad().then(() => { grPaintAllTerms(); if (tables.pcg && !$('pcv-g').hidden) { tables.pcg.resync(); tables.pcg.apply(); } if (tables.pca && !$('pcv-a').hidden) { GR.allRows = null; tables.pca.resync(); tables.pca.apply(); } });
}
function grSetMode(m) { PCMODE = m; grSave('pc-mode', m); grShowMode(); }
$('gm-raw').addEventListener('click', () => grSetMode(PCMODE === 'raw' ? 'all' : 'raw'));
$('gm-g').addEventListener('click', () => grSetMode(PCMODE === 'graded' ? 'all' : 'graded'));

/* ---- the Grading button: which grades and graders the graded rows show ---- */
function grOpenGrades(F = GF.pc) {
  const gk = grGK(), col = g => gk.filter(k => k.startsWith(g + '|')), S = F.gsel;
  const box = k => '<label><input type="checkbox" data-gk="' + k + '"' + (S.has(k) ? ' checked' : '') + '> ' + esc(grLabel(k)) + '</label>';
  $('btitle').textContent = 'Grading · ' + (F === GF.pc ? 'PriceCharting' : F.ids.title);
  $('bsub').textContent = F === GF.pc ? 'Tick the grades to show as graded rows (one row per card per grade). Remembered in this browser; the graded and both views use the same ticks.'
    : 'Tick the grades to list (one row per card per grade). This page’s own ticks, apart from the PriceCharting tab’s; remembered in this browser.';
  $('bbody').innerHTML = '<div class="gtsearch"><input type="search" id="gp-q" placeholder="Search grades… (e.g. psa 10, 9.5, pristine)"><button type="button" class="reset" id="gp-all">Select all</button><button type="button" class="reset" id="gp-none">Deselect all</button><span class="dim" id="gp-qn"></span></div>' +
    '<div class="gpick"><div><h4>PSA</h4>' + col('psa').map(box).join('') + '<button type="button" class="reset gp-grp" data-g="psa"></button></div><div><h4>CGC</h4>' + col('cgc').map(box).join('') + '<button type="button" class="reset gp-grp" data-g="cgc"></button></div></div>' +
    '<div class="pickbtns"><button class="reset" id="gp-done">Done</button></div>';
  // one button under each grader's list (2026-11-05, Brett): Select all, or Deselect all once every grade shown there is ticked
  const grpKeys = g => [...$('bbody').querySelectorAll('.gpick label')].filter(l => !l.hidden).map(l => l.querySelector('input').dataset.gk).filter(k => k.startsWith(g + '|'));
  const grpPaint = () => $('bbody').querySelectorAll('.gp-grp').forEach(b => { const ks = grpKeys(b.dataset.g), all = ks.length && ks.every(k => S.has(k)); b.textContent = (all ? 'Deselect all ' : 'Select all ') + b.dataset.g.toUpperCase(); b.dataset.all = all ? '1' : ''; });
  const sync = () => { $('bbody').querySelectorAll('.gpick input').forEach(i => { i.checked = S.has(i.dataset.gk); }); grpPaint(); };
  const changed = () => { grSave(F.p + 'pcg-grades', [...S]); grPaintGrades(F); F.apply(); grpPaint(); };
  $('bbody').querySelector('.gpick').addEventListener('input', e => { const i = e.target; if (!i.dataset.gk) return; if (i.checked) S.add(i.dataset.gk); else S.delete(i.dataset.gk); changed(); });
  const shownG = () => [...$('bbody').querySelectorAll('.gpick label')].filter(l => !l.hidden).map(l => l.querySelector('input').dataset.gk);
  $('gp-q').addEventListener('input', () => { const q = $('gp-q').value.trim().toLowerCase(); let n = 0;
    $('bbody').querySelectorAll('.gpick label').forEach(l => { l.hidden = !!q && !l.textContent.toLowerCase().includes(q); if (!l.hidden) n++; });
    $('gp-qn').textContent = q ? n + ' shown' : ''; grpPaint(); });
  $('bbody').querySelectorAll('.gp-grp').forEach(b => b.addEventListener('click', () => { const ks = grpKeys(b.dataset.g); ks.forEach(k => { if (b.dataset.all) S.delete(k); else S.add(k); }); sync(); changed(); }));
  grpPaint();
  $('gp-all').addEventListener('click', () => { shownG().forEach(k => S.add(k)); sync(); changed(); });
  $('gp-none').addEventListener('click', () => { shownG().forEach(k => S.delete(k)); sync(); changed(); });
  $('gp-done').addEventListener('click', () => $('bov').classList.remove('open'));
  $('bov').classList.add('open');
}
$('gm-grades').addEventListener('click', () => grOpenGrades(GF.pc));

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
  grPaintAllTerms();                                       // the ⚑ Flags and Unsure counts on every graded button bar (2026-11-05, Brett: "it stays as Flag (0)")
  let sent = true;
  try { await alSend({type: 'gmark', t, c: r[0], g: r[50], p: r[49], v: cur.v === undefined ? null : cur.v, reason: cur.reason || null, note: cur.note || null}); } catch (e) { sent = false; }
  if (tables.pcg) tables.pcg.apply(true); if (tables.pca && PCMODE === 'all') tables.pca.apply(true);
  if (tables.fcg) tables.fcg.apply(true);
  return sent;
}
async function grMarkCard(cid, val) {                       // Review: Same card / Not the same card / withdraw, for the whole card
  const t = Date.now(), c = ((GR.doc && GR.doc.cards) || {})[String(cid)] || {};
  GMARKS[cid + '|card'] = {v: val, t, p: c.pid || ''}; grSave('gmarks', GMARKS);
  for (const r of GR.rows) if (r[0] === cid) r[41] = val;
  grRebuildCard(cid);
  let sent = true;
  try { await alSend({type: 'gmark', t, c: cid, g: 'card', p: c.pid || '', v: val, reason: null, note: null}); } catch (e) { sent = false; }
  grPaintAllTerms();
  if (tables.pcg) tables.pcg.apply(true); if (tables.pca && PCMODE === 'all') tables.pca.apply(true);
  if (tables.fcg) tables.fcg.apply(true);
  return sent;
}
function grOpenReview(key) {
  const r = grRowOfKey(key); if (!r) return;
  const c = (GR.doc.cards || {})[String(r[0])] || {}, cl = c.cl || [], base = idRow.get(r[0]) || [];
  const pcu = pcPicture(r[0]), pcPage = 'https://www.pricecharting.com/game/' + r[0];
  if (!pcu) pcAsk(r[0]);
  // Card Ladder's picture of a slab of THIS grade only (2026-10-29, Brett: the picture, its cert and its link must not
  // be another grade's): none of this grade -> no picture, never the page's main picture of some other slab
  const clu = GR_CL_IMG((c.imgs || {})[r[50]]), clPage = grClUrl(c.pid);
  const fact = (lab, val, sub) => '<span class="lab">' + lab + '</span><b>' + val + '</b>' + (sub ? '<small>' + sub + '</small>' : '');
  const row = (l, rr, a) => '<div class="rrow r3"><div>' + (l || '') + '</div><div>' + (rr || '') + '</div><div>' + (a || '') + '</div></div>';
  const v = r[41], mk = GMARKS[key] || {};
  const year = s => s ? String(s).slice(0, 4) : '<span class="dim">unknown</span>';
  const tcg = c.tcg ? '<a href="https://www.tcgplayer.com/product/' + esc(c.tcg) + '" target="_blank" rel="noopener">' + esc(c.tcg) + '</a>' : '<span class="dim">none</span>';
  const idl = r[27] ? '<a href="' + esc(r[28]) + '" target="_blank" rel="noopener">' + esc(r[27]) + '</a>' : '<span class="dim">none</span>';
  // the Auth side: what the grader says (PSA's cert record, or GemRate's description via Card Hedge)
  const A = (c.a || {})[String(r[26]).toLowerCase()], S = r[70], afc = (A && A.fc) || {};
  const certUrl = r[27] && !/spec/.test(r[27]) ? r[28] : '';
  const amk = f => afc[f] === 'mismatch' ? 'bad' : '';
  const aw = v => '<span class="dim">' + esc(v) + '</span>';
  const av = v => A ? (v ? esc(v) : '<span class="dim">none</span>') : aw(r[56]);
  const aSub = A ? (A.src === 'psa' ? 'PSA’s cert record (' + esc(r[26] + ' ' + A.cert) + ')' : 'GemRate’s description via Card Hedge (' + esc(r[26] + ' ' + A.cert) + ')') : esc(GR_AST_TIP[r[56]] || '');
  const sOk = S && S[0] === 'ok', sWord = sOk ? '' : (S ? (S[0] === 'nf' ? 'not found' : 'not read') : 'no ' + r[25] + ' slab read');
  $('btitle').textContent = r[1] + ' — ' + String(r[2] || '').replace('Pokemon ', '') + ' · ' + r[25];
  $('bsub').innerHTML = 'Is Card Ladder’s card the same card PriceCharting shows? ' + (v === 1 ? '<b class="up">You said: same card.</b>' : v === 0 ? '<b class="down">You said: not the same card.</b>' : '') +
    (c.st && c.st !== 'review' ? ' <span class="dim">Matched: ' + esc(c.st) + (c.by ? ' (' + esc(c.by) + ')' : '') + '</span>' : '');
  // the Flag is its own thing now (2026-10-29, Brett: "should have its own flag button that is separate"): set in the
  // Flag column; Review only says whether the row carries one
  let h = r[42] ? '<div class="gflagnote">⚑ Your flag on this row: <b>' + esc(r[42]) + '</b>' + (mk.note ? ' - ' + esc(mk.note) : '') + ' <span class="dim">(change it in the Flag column)</span></div>' : '';
  // the match in doubt, at the top (2026-10-29, Brett: "this unsure match warning label should appear in the top of the review")
  const uR = grUnsure(r), wR = grWrong(r);
  if (uR || wR || v === 0) h = '<div class="rvmatch' + (v === 0 ? ' not' : wR ? ' wrong' : '') + '">' +
    (v === 0 ? '<b class="down">You said: not the same card.</b> Its rows stay listed with “no match” on the Card Ladder side (the page below is not used for them); answer Same card to bring it back. '
      : (wR ? '<span class="gwrong">likely wrong match</span> ' : '') + (uR ? '<span class="gunsure">unsure match</span> ' : '')) +
    '<button type="button" class="help" data-h="g_match">?</button><small>' + esc((uR ? 'The automatic matcher was not sure Card Ladder’s card is PriceCharting’s card (“review” only means a person should check it; nothing is sent anywhere). ' : '') + grMcText(c)) + '</small></div>' + h;
  h += '<div class="rvpair">' +
    '<div class="rvside"><h4>PriceCharting <a href="' + pcPage + '" target="_blank" rel="noopener">↗</a></h4>' +
      (pcu ? '<a href="' + pcPage + '" target="_blank" rel="noopener"><img class="rvpic" src="' + esc(pcu) + '" alt="PriceCharting picture: click to open their page"></a>'
           : '<div class="rvbox"><a href="' + pcPage + '" target="_blank" rel="noopener">See the picture on PriceCharting</a><small>being fetched now — it appears here within a minute or two</small></div>') + '</div>' +
    '<div class="rvside"><h4>Card Ladder ' + (clPage ? '<a href="' + esc(clPage) + '" target="_blank" rel="noopener">↗</a>' : '') + '</h4>' +
      (clu ? '<a href="' + esc(clu) + '" target="_blank" rel="noopener"><img class="rvpic" src="' + esc(clu) + '" alt="Card Ladder’s picture of a ' + esc(r[25]) + ' slab: click to open it full size"></a><small class="dim">a ' + esc(r[25]) + ' slab from a sale Card Ladder recorded - another copy of the same grade, so its cert is its own</small>'
        : '<div class="rvbox"><span class="dim">none</span><small>Card Ladder has no picture of a ' + esc(r[25]) + ' slab of this card</small></div>') + '</div>' +
    '<div class="rvside"><h4>' + esc(r[26]) + ' (PC Cert) ' + (certUrl ? '<a href="' + esc(certUrl) + '" target="_blank" rel="noopener">↗</a>' : '') + '</h4>' +
      (A && A.ch && A.ch.image ? '<a href="' + esc(certUrl || A.ch.image) + '" target="_blank" rel="noopener"><img class="rvpic" src="' + esc(A.ch.image) + '" alt="Card Hedge’s picture of the card it matched to the cert"></a><small class="dim">Card Hedge’s picture of the card it matched to ' + esc(r[26] + ' ' + A.cert) + '</small>'
        : '<div class="rvbox">' + (certUrl ? '<a href="' + esc(certUrl) + '" target="_blank" rel="noopener">Open the cert on ' + esc(r[26]) + '’s site</a>' : '') + '<small>' + esc(A ? 'no picture from the cert lookups' : GR_AST_TIP[r[56]] || 'no slab read') + '</small></div>') + '</div></div>';
  // the field checks (graded_site.py): red = PC and CL disagree, amber = one side says nothing
  const mk2 = f => { const x = grFC(c, f); return x === 'mismatch' ? 'bad' : x === 'pc_none' || x === 'cl_none' ? 'amber' : ''; };
  const factc = (lab, val, sub, cls) => '<span class="lab">' + lab + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</b>' + (sub ? '<small>' + sub + '</small>' : '');
  const none = '<span class="dim">none</span>';
  const pg = (c.pg || {})[r[50]], gl = r[25];
  const gDiffR = !!r[71] && !!r[72] && !grSameGrade(r[71], r[72]);
  let ngB = 'not read', ngS = /\./.test(gl) || /Pristine|Perfect/.test(gl) ? 'PriceCharting’s population has no ' + esc(gl) + ' line' : 'no population read for this card yet';
  if (pg) {
    if (pg[4] != null) { ngB = (pg[4] >= 0 ? '' : '−') + Math.abs(pg[4]).toLocaleString('en-US'); ngS = 'last month: ' + esc(gl) + ' population at month end vs the month before (PriceCharting’s page)'; }
    else if (pg[0] != null) { ngB = '+' + pg[0].toLocaleString('en-US'); ngS = 'since ' + esc(pg[1]) + ': ' + esc(gl) + ' population ' + (pg[3] - pg[0]).toLocaleString('en-US') + ' → ' + pg[3].toLocaleString('en-US') + ' (PriceCharting’s page; last month’s figure from Dec 1)'; }
    else { ngB = 'not yet'; ngS = 'first population read ' + esc(pg[1]) + ' (' + pg[3].toLocaleString('en-US') + ' ' + esc(gl) + ' slabs); the count starts with the next read'; }
  }
  const top = '<div class="rvtop"><button type="button" class="tbtn" id="grv-trend">Trend</button>' +
    '<div>' + factc('Number graded', ngB, ngS) + '</div>' +
    '<div>' + factc('PC to CL % difference (last month)', r[36] == null ? (gDiffR && r[6] != null && r[35] != null ? '<span class="down">not compared: PC is ' + esc(r[71]) + ', CL is ' + esc(r[72]) + '</span>' : '-') : fmtPct(r[36], true, 1), 'PC ' + fmtMoneyPlain(r[6]) + ' · CL ' + fmtMoneyPlain(r[35]) + ' (' + esc(grMonthName(r[17])) + '’s sales: PC Hodges–Lehmann, CL average)') + '</div></div>';
  h = h.replace('<div class="rvpair">', top + '<div class="rvpair">');
  const idSub = r[27] ? (/spec/.test(r[27]) ? 'no ' + esc(gl) + ' slab read yet: PSA’s page for the card (PSA asks you to sign in)' : 'a ' + esc(gl) + ' slab of this card, read off a PriceCharting sold-listing photo') : 'no ' + esc(gl) + ' slab read yet';
  const isGame = /^pokemon game( promo)?$/i.test(String(cl[2] || ''));
  // CL side: the slab Card Ladder's own cert lookup tied to this card (build_ids). Card Ladder needed ONE slab to find the
  // card's page, so that slab is one grade's; its prices are still per grade (Card Ladder's own sales of this row's grade).
  // Shown as this row's cert only when it IS this grade's slab (2026-10-29, Brett: "the cl cert id often times doesnt
  // match the pc cert id with respect to the grade ... its confusing")
  const clc = r[26] === 'CGC' ? c.ccert : c.pcert;
  const clCertUrl = n => (r[26] === 'CGC' ? 'https://www.cgccards.com/certlookup/' + encodeURIComponent(n) + '/' : 'https://www.psacard.com/cert/' + encodeURIComponent(n) + '/psa');
  const clcGk = clc ? Object.keys(c.certs || {}).find(k => k.startsWith(r[26].toLowerCase() + '|') && c.certs[k] === clc) : null;
  const clSame = !!clc && clcGk === r[50];
  const clCert = clSame ? '<a href="' + clCertUrl(clc) + '" target="_blank" rel="noopener">' + esc(r[26] + ' ' + clc) + '</a>'
    : clc ? '<span class="dim">no ' + esc(gl) + ' slab looked up</span>' : none;
  const clCertSub = (clSame ? 'the same ' + esc(gl) + ' slab as PriceCharting’s - Card Ladder’s cert lookup tied it to this card'
    : clc ? 'Card Ladder’s page for the card was found with ' + (clcGk ? 'a ' + esc(grLabel(clcGk)) : 'another') + ' slab (<a href="' + clCertUrl(clc) + '" target="_blank" rel="noopener">' + esc(clc) + '</a>); the price above is still Card Ladder’s own ' + esc(gl) + ' sales'
    : 'Card Ladder has no ' + esc(r[26]) + ' cert on file for this card') +
    (r[26] === 'PSA' ? (c.spec ? ' · PSA spec ' + esc(c.spec) : '') : (c.cgc ? ' · CGC number ' + esc(c.cgc) : ''));
  h += '<div class="rvrows">' +
    row(factc('Release year', year(base[4]), '', mk2('release')), factc('Release year', year(cl[1]), '', mk2('release')), factc('Release year', A ? year(A.year) : aw(r[56]), aSub, amk('release'))) +
    row(factc('Set name', base[2] ? esc(base[2]) : none), factc('Set name', cl[2] ? esc(cl[2]) : none, isGame ? 'PSA’s own name: Pokemon Game = 1999 Base Set' : ''), factc('Set name', av(A && A.set))) +
    row(factc('Card name', esc(base[1] || '')), factc('Card name', cl[4] ? esc(cl[4]) : none), factc('Card name', av(A && A.name), A ? 'language: ' + esc(A.lang || 'none') + (A.ls ? '' : ' (the grader names none)') : '')) +
    row(factc('Card / set number', esc(c.pn || 'none'), c.pnf ? 'from ' + esc(c.pnf) : '', mk2('number') || mk2('total')), factc('Card / set number', esc(c.cn || 'none'), c.cnf ? 'from ' + esc(c.cnf) : 'Card Ladder gives no number', mk2('number') || mk2('total')),
        factc('Card / set number', av(A && A.num), A ? 'graders print no set size' : '', amk('number'))) +
    row(factc('Rarity / finish', esc(grRF(c.pr, c.pf, c.ps)), 'rarity: ' + esc(c.prf || 'none') + ' · finish: ' + esc(c.pff || 'none'), mk2('rarity') || mk2('finish') || mk2('special')),
        factc('Rarity / finish', esc(grRF(c.cr, c.cf, c.cs)), 'Card Ladder’s own words (variation, name, set, its cert lookups); a ? = a word the dictionary only thinks it knows', mk2('rarity') || mk2('finish') || mk2('special')),
        factc('Rarity / finish', A ? esc(grRF(A.rar, A.fin, A.sp)) : aw(r[56]), A ? 'the grader’s own words, read with the dictionary' : '', amk('rarity') || amk('finish') || amk('special'))) +
    row(factc('Illustrator', c.pi ? esc(c.pi) : '<span class="dim">' + (c.pi === '' ? 'none' : 'not read') + '</span>',
          c.pi ? 'the Artist on TCGplayer’s product page' : c.pi === '' ? 'TCGplayer’s product page shows none' : esc(c.pif || 'TCGplayer’s product page; not read yet (each site build reads the new cards)')),
        factc('Illustrator', none, 'Card Ladder does not record it'), factc('Illustrator', none, 'PSA and CGC do not record it')) +
    row(factc('Series', (c.ser || [])[0] ? esc(c.ser[0]) : none, 'only where the text names it', mk2('series')), factc('Series', (c.ser || [])[1] ? esc(c.ser[1]) : none, 'only where the text names it', mk2('series')),
        factc('Series', (c.ser || [])[2] ? esc(c.ser[2]) : A ? none : aw(r[56]), A ? 'only where the text names it' : '', amk('series'))) +
    row(factc('Era', (c.era || [])[0] ? esc(c.era[0]) : none, '', mk2('era')), factc('Era', (c.era || [])[1] ? esc(c.era[1]) : none, '', mk2('era')), factc('Era', (c.era || [])[2] ? esc(c.era[2]) : A ? none : aw(r[56]), '', amk('era'))) +
    row(fact('PC sold last month', r[16] == null ? '-' : r[16], r[25] + ', the sales PriceCharting recorded'), fact('CL sold last month', r[37] == null ? '-' : r[37], r[25] + ', every sale Card Ladder recorded'), '') +
    row(factc('Grade and grader', r[71] ? esc(r[71]) : none, r[71] ? 'from ' + esc(GR_PCG_FROM[r[73]] || 'PriceCharting') : 'PriceCharting has no ' + esc(r[25]), gDiffR ? 'bad' : ''),
        factc('Grade and grader', r[72] ? esc(r[72]) : none, r[72] ? 'from ' + esc(GR_CLG_FROM[r[74]] || 'Card Ladder') : 'Card Ladder has no ' + esc(r[25]), gDiffR ? 'bad' : ''), fact('Grade on the slab', sOk ? esc(S[1] || 'none') : aw(sWord), sOk && S[5] === 'psa' ? 'label type: ' + esc(S[2] || 'none') : sOk ? 'from Card Hedge (GemRate); no label type' : '')) +
    row(fact('Grade price', r[6] != null ? fmtMoneyPlain(r[6]) : (r[69] || [])[2] === 'not_read' ? '<span class="dim">not read</span>' : '<span class="dim">none</span>', esc(grPc1Title(r)) + (r[67] != null ? ' · today ' + fmtMoneyPlain(r[67]) : '')), fact('Grade price', fmtMoneyPlain(r[35]), 'Card Ladder’s average of its ' + esc(gl) + ' sales in ' + esc(grMonthName(r[17])) + (r[68] != null ? ' · its value today ' + fmtMoneyPlain(r[68]) : '') + (r[46] != null ? ' · last sold ' + fmtMoneyPlain(r[46]) : '')),
        fact('Card Hedge’s card', A && A.ch ? esc([A.ch.player, A.ch.set, A.ch.number ? '#' + A.ch.number : '', A.ch.variant].filter(Boolean).join(' · ')) : aw(A ? 'none' : r[56]),
          A && A.ch ? (A.ch.source === 'gemrate_id' ? 'found by a direct ID link from the cert' : A.ch.source === 'card_match' ? 'an AI guess from the description' + (A.ch.conf ? ' (confidence ' + esc(A.ch.conf) + ')' : '') + ' - check it' : esc(A.ch.source || '')) : 'the card Card Hedge matched to the cert')) +
    row(fact(r[26] === 'CGC' ? 'CGC cert' : 'PSA cert', idl, idSub), fact(r[26] === 'CGC' ? 'CGC cert' : 'PSA cert', clCert, clCertSub),
        fact('PC cert', sOk || S ? '<a href="' + esc(r[26] === 'CGC' ? 'https://www.cgccards.com/certlookup/' + S[6] + '/' : 'https://www.psacard.com/cert/' + S[6] + '/psa') + '" target="_blank" rel="noopener">' + esc(r[26] + ' ' + S[6]) + '</a>' : aw('none'), S ? (sOk ? (S[5] === 'psa' ? 'PSA’s record' : 'Card Hedge’s record') + (S[8] ? ', read ' + esc(S[8]) : '') : sWord) : 'no ' + esc(r[25]) + ' slab read yet')) +
    row(fact('TCGplayer ID', tcg, 'the TCGplayer product PriceCharting references'), fact('Card Ladder card', c.pid ? '<a href="' + esc(clPage) + '" target="_blank" rel="noopener">' + esc(c.pid) + '</a>' : none, 'its Card Ladder profile'),
        fact(r[26] === 'PSA' ? 'PSA spec' : 'Grader’s card', A && A.spec ? '<a href="https://www.psacard.com/spec/psa/' + esc(A.spec) + '" target="_blank" rel="noopener">' + esc(A.spec) + '</a>' : aw('none'), A && A.spec ? 'PSA’s ID for the card - every slab of it shares this number' : '')) +
    '</div>' +
    '<div class="rvbtns"><button class="rvno" id="grv-no">Not the same card<small>for every grade: hides its rows, keeps the data</small></button><button class="rvyes" id="grv-yes">Same card<small>confirms the match for every grade</small></button><button type="button" class="help" data-h="g_match">?</button></div>' +
    (v != null ? '<div class="rvundo"><button class="linkbtn" id="grv-undo">Withdraw my answer</button></div>' : '') + '<div id="grv-msg" class="dim"></div>';
  $('bbody').innerHTML = h;
  $('bov').classList.add('open');
  fitRows($('bbody'));
  $('grv-trend').addEventListener('click', () => grOpenTrend(key));   // Trend opens over Review; closing it returns to Review (2026-11-05, Brett)
  const answer = async val => { $('grv-msg').textContent = 'Saving…'; const ok = await grMarkCard(r[0], val); if (ok) $('bov').classList.remove('open'); else $('grv-msg').innerHTML = '<span class="down">Kept in this browser; the collector could not be told yet.</span>'; };
  $('grv-no').addEventListener('click', () => answer(0));
  $('grv-yes').addEventListener('click', () => answer(1));
  const u = $('grv-undo'); if (u) u.addEventListener('click', () => answer(null));
}
/* The Flag column's menu (2026-10-29, Brett: "price charting only show graded page should have its own flag button that
   is separate from the other tabs. i dont want it to combine its flags with the other flags"): a reason and a note
   for this card x grade, saved on its own - it does not answer Review (Same / Not the same card stays your separate
   answer) and never joins the eBay tabs' Flags archive. Saved in this browser at once and sent over the signed channel;
   the next site build files it into card-data/data/ids/marks.csv (reason, note). The Flags button above the table
   shows only the flagged rows. */
function grFlagPop(btn) {
  const r = grRowOfKey(btn.dataset.k); if (!r) return;
  const key = r[0] + '|' + r[50], mk = GMARKS[key] || {};
  let pop = $('gflpop'); if (!pop) { pop = document.createElement('div'); pop.id = 'gflpop'; document.body.appendChild(pop); }
  pop.innerHTML = '<div class="lab">Flag ' + esc(r[1] + ' · ' + r[25]) + '</div><div class="fbtns">' + GR_REASONS.map(s => '<button type="button" class="fbtn' + (r[42] === s ? ' on' : '') + '" data-s="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>' +
    '<input type="text" id="gflpop-note" placeholder="why (optional - kept with the flag)" value="' + esc(mk.note || '') + '">' +
    '<div class="fsave">' + (r[42] ? '<button type="button" class="linkbtn" id="gflpop-off">Take the flag off</button>' : '') + '<button type="button" class="linkbtn" id="gflpop-x">Cancel</button><span class="dim" id="gflpop-msg">pick a reason to flag the row</span></div>';
  pop.dataset.k = key;
  const rect = btn.getBoundingClientRect(), w = Math.min(440, window.innerWidth - 16);
  pop.style.width = w + 'px'; pop.style.left = Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8)) + 'px';
  pop.style.top = (rect.bottom + 6 + 230 > window.innerHeight ? Math.max(8, rect.top - 236) : rect.bottom + 6) + 'px';
  pop.classList.add('open');
  const done = async patch => { $('gflpop-msg').textContent = 'Saving…'; const ok = await grMark(r, patch); if (ok) pop.classList.remove('open'); else $('gflpop-msg').innerHTML = '<span class="down">Kept in this browser; the collector could not be told yet - it is sent again with your next answer.</span>'; grPaintTerms(); };
  pop.querySelectorAll('.fbtn').forEach(b => b.addEventListener('click', () => done({reason: b.dataset.s, note: $('gflpop-note').value.trim()})));
  const off = $('gflpop-off'); if (off) off.addEventListener('click', () => done({reason: null, note: ''}));
  $('gflpop-x').addEventListener('click', () => pop.classList.remove('open'));
}
if ($('bbody')) $('bbody').addEventListener('click', e => { const hb = e.target.closest('button.help'); if (hb && /^g_/.test(hb.dataset.h || '')) { e.stopPropagation(); openHelp(hb.dataset.h); } });
document.addEventListener('mousedown', e => { const pop = $('gflpop'); if (pop && pop.classList.contains('open') && !pop.contains(e.target) && !e.target.closest('.gflag')) pop.classList.remove('open'); });
for (const id of ['pcg', 'pca', 'fcg']) {
  const tb = $('rows-' + id); if (!tb) continue;
  tb.addEventListener('click', e => {
    const fl = e.target.closest('.gflag'); if (fl) { grFlagPop(fl); return; }
    const rv = e.target.closest('.grvb'); if (rv) { grOpenReview(rv.dataset.k); return; }
    const gt = e.target.closest('.gtbtn'); if (gt) { grOpenTrend(gt.dataset.k); return; }
    const tb2 = e.target.closest('.tbtn'); if (tb2 && tb2.dataset.i != null) openTrend(+tb2.dataset.i);
  });
}

/* ---- the PSA Trend popup: PriceCharting's and Card Ladder's lines for the grades you pick, at most 3 at once ----
   (Brett: "toggle PC PSA 10 and CL PSA 10, select a time frame, then both graph will overlay each other ... a maximum
   of 3 because any more may make the volume bars messy"). Lines: price per month (right axis); bars: sales per month
   (left axis), side by side. PC lines: its chart's monthly PSA 10 and grade 9 / 8 / 7 (every grader blended) with its
   recorded sales of that exact grade as the bars; CL lines: Card Ladder's monthly average of every sale and the count. */
/* 2026-11-03 (Brett): up to 4 lines; the grades in a PSA and a CGC dropdown (tick several); it opens on the row's own
   grade; the price axis fits the lines shown in the window (it always did - opening on the row's grade keeps a PSA 10
   line from stretching a PSA 1 chart); a Log switch puts equal percentage moves at equal heights, for overlays of grades
   far apart in price. */
const GT_COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#a855f7'];
const GT_MAX = 4;
let GT_SEL = grLS('gtr-sel', ['cl|psa|g10', 'pc|psa|g10']);
let GT_LOG = grLS('gtr-log', false);
/* % change (2026-11-03, Brett: "a delta % increase in value toggle ... may even be more insightful than the log toggle. We
   can still keep log toggle"): every line divided by its own first price in the window, so all lines start at 0% and
   each line's end is its return over the window (6m / 1y / 2y / 5y / All set the starting month); the chips say it.
   With Log on too the axis is log of that ratio (+100% and -50% the same height). */
let GT_PCT = grLS('gtr-pct', false);
let GT_OPEN = '';                                            // the open grade dropdown ('psa' / 'cgc'), kept across redraws
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
  return {label: 'PC ' + grLabel(gk), pts};                // only this grade and grader's own sales (and PSA 10's own line) since 2026-10-29
}
async function grOpenTrend(key) {
  const r = grRowOfKey(key); if (!r) return;
  GR.cur = r;
  $('gtitle').textContent = r[1] + ' — ' + String(r[2] || '').replace('Pokemon ', '');
  $('gsub').innerHTML = '<span class="dim">Loading…</span>';
  $('gov').classList.add('open');
  try { GR.curTr = await grTrendData(r[0]); } catch (e) { GR.curTr = null; $('gsub').innerHTML = '<span class="warn">' + esc(e.message) + '</span>'; }
  // answered Not the same card: Card Ladder's page is another card, so no CL lines (the cache keeps them for Same card)
  if (GR.curTr && grMatchV(r[0]) === 0) GR.curTr = Object.assign({}, GR.curTr, {cl: {}});
  // the row's own grade, both sides (the ones with points; both when neither has any)
  const own = ['pc|' + r[50], 'cl|' + r[50]], withPts = GR.curTr ? own.filter(k => gtSeries(GR.curTr, k).pts.some(p => p[1] != null)) : [];
  GT_SEL = withPts.length ? withPts : own; grSave('gtr-sel', GT_SEL);
  gtPaint();
}
function gtPaint() {
  const r = GR.cur, tr = GR.curTr; if (!r) return;
  const gk = grGK(), pcGrades = gk.filter(k => k === 'psa|g10' || (tr && ((tr.ps || {})[k] || []).length));   // PriceCharting: PSA 10's line and the grades it recorded sales of
  const list = GT_SRC === 'pc' ? pcGrades : gk;
  $('gsrc').innerHTML = ['pc', 'cl'].map(s => '<button type="button" class="zb' + (GT_SRC === s ? ' on' : '') + '" data-s="' + s + '">' + (s === 'pc' ? 'PriceCharting' : 'Card Ladder') + '</button>').join('');
  const has = k => { if (!tr) return false; const s = gtSeries(tr, k); return s.pts.some(p => p[1] != null); };
  const cb = k => { const full = GT_SRC + '|' + k, on = GT_SEL.includes(full), ok = has(full);
    return '<label class="' + (ok ? '' : 'dim') + '"><input type="checkbox" data-k="' + full + '"' + (on ? ' checked' : '') + (!on && GT_SEL.length >= GT_MAX ? ' disabled' : '') + '> ' + esc(grLabel(k)) + '</label>'; };
  const dd = (g, keys, none) => { const n = keys.filter(k => GT_SEL.includes(GT_SRC + '|' + k)).length;
    return '<details class="gdd" data-g="' + g + '"' + (GT_OPEN === g ? ' open' : '') + '><summary>' + (GT_SRC === 'pc' ? 'PC ' : 'CL ') + g.toUpperCase() + ' grades <span class="dim">(' + n + ' on)</span> ▾</summary><div class="gddp">' +
      (keys.map(cb).join('') || '<span class="dim">' + none + '</span>') + '</div></details>'; };
  $('ggrades').innerHTML = dd('psa', list.filter(k => k.startsWith('psa|')), 'no PSA ' + (GT_SRC === 'pc' ? 'sales recorded' : 'grades')) + dd('cgc', list.filter(k => k.startsWith('cgc|')), 'no CGC ' + (GT_SRC === 'pc' ? 'sales recorded' : 'grades')) +
    (GT_SRC === 'pc' ? '<small class="dim">PriceCharting: PSA 10’s monthly line, and each grade’s own recorded sales (its Grade 9 / 8 / 7 lines blend every grader, so they are not drawn)</small>' : '');
  $('gchips').innerHTML = GT_SEL.map((k, i) => '<span class="gchip" style="border-color:' + GT_COLORS[i] + '"><span class="sw" style="background:' + GT_COLORS[i] + '"></span>' + esc(tr ? gtSeries(tr, k).label : k) + '<span class="groi" data-j="' + i + '"></span> <button type="button" data-k="' + esc(k) + '" title="Remove this line">✕</button></span>').join('') +
    '<span class="dim">' + (GT_SEL.length >= GT_MAX ? 'Four lines at most — remove one to add another.' : (GT_MAX - GT_SEL.length) + ' more line(s) can be added.') + '</span>';
  $('gzoom').querySelectorAll('.zb').forEach(b => b.classList.toggle('on', b.dataset.z === GT_ZOOM));
  if ($('glog')) $('glog').classList.toggle('on', !!GT_LOG);
  if ($('gpct')) $('gpct').classList.toggle('on', !!GT_PCT);
  $('gsub').innerHTML = r[75] === 'no match' ? 'Card Ladder: <span class="dim" title="' + esc(grClsTip((GR.doc && GR.doc.cards[String(r[0])]) || {}, 'no match', r[0])) + '">no match</span>' + (r[27] ? ' · ' + esc(r[27]) : '')
    : r[27] ? 'Card Ladder: <a href="' + esc(r[31]) + '" target="_blank" rel="noopener">' + esc(r[30] || 'profile') + '</a> · ' + esc(r[27]) : '';
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
  // % change: each line against its own first price in the window (base); val() is what the line plots
  const base = ser.map(sr => { for (const m of months) { const p = sr.pts.find(q => q[0] === m); if (p && p[1] != null) return [m, p[1]]; } return null; });
  const pc = !!GT_PCT, val = (j, v) => pc ? (base[j] ? v / base[j][1] : null) : v;
  const pv = ser.flatMap((s, j) => s.pts.filter(p => months.includes(p[0]) && p[1] != null).map(p => val(j, p[1]))).filter(v => v != null);
  const nv = ser.flatMap(s => s.pts.filter(p => months.includes(p[0]) && p[2] != null).map(p => p[2]));
  if (!months.length || !pv.length) { svg.innerHTML = '<text x="20" y="40" fill="currentColor">No points for these lines in this window.</text>'; tab.innerHTML = ''; return; }
  const lg = !!GT_LOG && pv.every(v => v > 0);                // Log: equal percentage moves at equal heights
  const pv1 = pc ? pv.concat([1]) : pv;                        // % change: 0% always on the axis
  const pad = pc && !lg ? (Math.max(...pv1) - Math.min(...pv1)) * 0.08 || 0.05 : 0;
  const pmax = lg ? Math.max(...pv1) * 1.15 : pc ? Math.max(...pv1) + pad : Math.max(...pv) * 1.08;
  const pmin = lg ? Math.min(...pv1) / 1.15 : pc ? Math.max(0, Math.min(...pv1) - pad) : Math.max(0, Math.min(...pv) * 0.9), nmax = Math.max(1, ...nv) * 1.15;
  const x = i => L + (months.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (months.length - 1));
  const yp = lg ? v => T + (H - T - B) * (1 - (Math.log(v) - Math.log(pmin)) / (Math.log(pmax) - Math.log(pmin) || 1))
    : v => T + (H - T - B) * (1 - (v - pmin) / (pmax - pmin || 1)), yn = v => H - B - (H - T - B) * v / nmax;
  const bw = Math.max(2, Math.min(18, (W - L - R) / Math.max(1, months.length) / (ser.length + 1)));
  let s = '';
  const pTicks = pc ? (lg && pmax / pmin >= 3 ? gtLogTicks(pmin, pmax) : gtNiceTicks((pmin - 1) * 100, (pmax - 1) * 100).map(t => 1 + t / 100))
    : lg ? gtLogTicks(pmin, pmax) : [0, 1, 2, 3, 4].map(k => pmin + (pmax - pmin) * k / 4);
  for (const v of pTicks) { const y = yp(v), zero = pc && Math.abs(v - 1) < 1e-9;
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="currentColor" stroke-opacity="' + (zero ? '.4' : '.08') + '"' + (zero ? ' stroke-dasharray="4 3"' : '') + '/><text x="' + (W - R + 6) + '" y="' + (y + 4) + '" font-size="11" fill="currentColor" fill-opacity=".7">' +
      (pc ? gtPctTxt(v) : '$' + (v < 10 && lg ? +v.toPrecision(2) : Math.round(v)).toLocaleString('en-US')) + '</text>'; }
  for (let k = 0; k <= 4; k++) { const v = nmax * k / 4, y = yn(v); s += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" font-size="11" text-anchor="end" fill="currentColor" fill-opacity=".5">' + Math.round(v) + '</text>'; }
  const step = Math.ceil(months.length / 12);
  months.forEach((m, i) => { if (i % step === 0 || i === months.length - 1) s += '<text x="' + x(i) + '" y="' + (H - B + 16) + '" font-size="11" text-anchor="middle" fill="currentColor" fill-opacity=".7">' + MONTHS_S[+m.slice(5) - 1] + ' ' + m.slice(2, 4) + '</text>'; });
  ser.forEach((sr, j) => {
    const by = new Map(sr.pts.map(p => [p[0], p]));
    months.forEach((m, i) => { const p = by.get(m); if (p && p[2]) s += '<rect x="' + (x(i) - bw * ser.length / 2 + j * bw) + '" y="' + yn(p[2]) + '" width="' + (bw - 1) + '" height="' + (H - B - yn(p[2])) + '" fill="' + GT_COLORS[j] + '" fill-opacity=".28"><title>' + esc(sr.label) + ' · ' + m + ': ' + p[2] + ' sales</title></rect>'; });
  });
  ser.forEach((sr, j) => {
    const pts = months.map((m, i) => { const p = sr.pts.find(q => q[0] === m), v = p && p[1] != null ? val(j, p[1]) : null; return v != null ? [x(i), yp(v), p, m, v] : null; }).filter(Boolean);
    if (pts.length > 1) s += '<polyline fill="none" stroke="' + GT_COLORS[j] + '" stroke-width="2" points="' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>';
    pts.forEach(p => { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="' + GT_COLORS[j] + '"><title>' + esc(sr.label) + ' · ' + p[3] + ': $' + p[2][1].toLocaleString('en-US') + (pc ? ' (' + gtPctTxt(p[4]) + ')' : '') + (p[2][2] != null ? ' (' + p[2][2] + ' sales)' : '') + '</title></circle>'; });
  });
  s += '<text x="' + L + '" y="12" font-size="11" fill="currentColor" fill-opacity=".6">sales per month</text><text x="' + (W - R) + '" y="12" font-size="11" text-anchor="end" fill="currentColor" fill-opacity=".6">' + (pc ? '% change since each line’s first month shown' : 'price per month') + (lg ? ' (log scale)' : '') + '</text>';
  s += '<g id="gt-hover" style="display:none;pointer-events:none"></g><rect id="gt-hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent"/>';
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.innerHTML = s;
  svg._gt = {months, ser, x, yp, W, H, L, R, T, B, pc, val};
  // the chips: each line's change over the window (first month shown -> last), in % change mode
  document.querySelectorAll('#gchips .groi').forEach(el => { const j = +el.dataset.j, sr = ser[j], b = base[j];
    let last = null; if (pc && sr && b) for (const m of months) { const p = sr.pts.find(q => q[0] === m); if (p && p[1] != null) last = [m, p[1]]; }
    const r = last ? last[1] / b[1] : null;
    el.className = 'groi' + (r == null ? '' : r > 1 ? ' up' : r < 1 ? ' down' : '');
    el.textContent = r == null ? '' : ' ' + gtPctTxt(r);
    el.title = r == null ? '' : MONTHS_S[+b[0].slice(5) - 1] + ' ' + b[0].slice(0, 4) + ' ' + fmtMoneyPlain(b[1]) + ' → ' + MONTHS_S[+last[0].slice(5) - 1] + ' ' + last[0].slice(0, 4) + ' ' + fmtMoneyPlain(last[1]); });
  if (!svg._gtBound) { svg._gtBound = true; svg.addEventListener('mousemove', gtHover); svg.addEventListener('mouseleave', () => { const g = $('gt-hover'); if (g) g.style.display = 'none'; }); }
  tab.innerHTML = '<table><thead><tr><th>Month</th>' + ser.map((sr, j) => '<th class="num" style="color:' + GT_COLORS[j] + '">' + esc(sr.label) + '</th>').join('') + '</tr></thead><tbody>' +
    months.slice().reverse().map(m => '<tr><td>' + MONTHS_S[+m.slice(5) - 1] + ' ' + m.slice(0, 4) + '</td>' + ser.map((sr, j) => { const p = sr.pts.find(q => q[0] === m), v = pc && p && p[1] != null ? val(j, p[1]) : null; return '<td class="num">' + (p && p[1] != null ? fmtMoneyPlain(p[1]) : '-') + (v != null ? ' <span class="' + (v > 1 ? 'up' : v < 1 ? 'down' : 'dim') + '">' + gtPctTxt(v) + '</span>' : '') + (p && p[2] != null ? ' <span class="dim">(' + p[2] + ')</span>' : '') + '</td>'; }).join('') + '</tr>').join('') + '</tbody></table>';
}
function gtPctTxt(ratio) {                                    // 1.234 -> +23%, 0.95 -> -5%, 1.004 -> +0.4%
  const p = (ratio - 1) * 100, a = Math.abs(p), t = a >= 10 || a === 0 ? String(Math.round(a)) : String(+a.toFixed(1));
  return (t === '0' ? '' : p > 0 ? '+' : '-') + t + '%';
}
function gtNiceTicks(lo, hi, n) {                            // round steps (1 / 2 / 2.5 / 5 x 10^k) inside [lo, hi]
  const raw = (hi - lo) / (n || 5); if (!(raw > 0)) return [lo];
  const mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw);
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function gtLogTicks(lo, hi) {                                // 1 / 2 / 5 x 10^n inside [lo, hi] (1 / 1.5 / 2 / 3 / 5 / 7 when that gives too few)
  const out = [];
  for (const mult of [[1, 2, 5], [1, 1.5, 2, 3, 5, 7]]) {
    out.length = 0;
    for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)); e++) for (const m of mult) { const v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(v); }
    if (out.length >= 3) break;
  }
  return out.length >= 3 ? out : gtNiceTicks(lo, hi, 4);   // a narrow range: plain round steps (log is near straight there)
}
/* A vertical line that follows the cursor with every line's value that month (2026-10-29, Brett: "a hover vertical line
   and move with cursor feature to see values on trend charts similar to how pc charts do it") */
function gtHover(e) {
  const svg = $('gsvg'), st = svg._gt, g = $('gt-hover'); if (!st || !g || !st.months.length) return;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const m = svg.getScreenCTM(); if (!m) return;
  const p = pt.matrixTransform(m.inverse());
  if (p.x < st.L - 6 || p.x > st.W - st.R + 6) { g.style.display = 'none'; return; }
  let i = 0, best = Infinity;
  st.months.forEach((mo, j) => { const d = Math.abs(st.x(j) - p.x); if (d < best) { best = d; i = j; } });
  const mo = st.months[i], X = st.x(i);
  const lines = st.ser.map((sr, j) => { const q = sr.pts.find(z => z[0] === mo), v = q && q[1] != null ? st.val(j, q[1]) : null;
    // the change from the month before (2026-11-05, Brett: in the hover, red when down, green when up; nothing when the
    // line has no price that month)
    const [yy, mm] = mo.split('-').map(Number), pm = mm === 1 ? (yy - 1) + '-12' : yy + '-' + String(mm - 1).padStart(2, '0');
    const q0 = sr.pts.find(z => z[0] === pm), ch = q && q[1] != null && q0 && q0[1] ? (q[1] / q0[1] - 1) * 100 : null;
    const flat = ch != null && Math.abs(ch) < 0.05, chT = ch == null ? '' : ' · ' + (flat ? '' : ch > 0 ? '+' : '−') + Math.abs(ch).toFixed(1) + '% vs ' + MONTHS_S[+pm.slice(5) - 1];
    return {c: GT_COLORS[j], t: sr.label + ': ' + (q && q[1] != null ? fmtMoneyPlain(q[1]) : '-') + (st.pc && v != null ? ' (' + gtPctTxt(v) + ')' : '') + (q && q[2] != null ? ' · ' + q[2] + ' sale' + (q[2] === 1 ? '' : 's') : ''), ch: chT, cc: ch == null || flat ? '#e6edf3' : ch > 0 ? '#4ade80' : '#f87171', y: v != null ? st.yp(v) : null}; });
  const head = MONTHS_S[+mo.slice(5) - 1] + ' ' + mo.slice(0, 4), wBox = Math.max(head.length, ...lines.map(l => (l.t + l.ch).length)) * 6.6 + 22, hBox = 22 + lines.length * 17;
  const bx = X + 12 + wBox > st.W - st.R ? X - 12 - wBox : X + 12, by = st.T + 4;
  let h = '<line x1="' + X + '" x2="' + X + '" y1="' + st.T + '" y2="' + (st.H - st.B) + '" stroke="currentColor" stroke-opacity=".45" stroke-dasharray="3 3"/>';
  lines.forEach(l => { if (l.y != null) h += '<circle cx="' + X + '" cy="' + l.y + '" r="5" fill="none" stroke="' + l.c + '" stroke-width="2"/>'; });
  h += '<rect x="' + bx + '" y="' + by + '" width="' + wBox + '" height="' + hBox + '" rx="6" fill="#2b2f36" fill-opacity=".94" stroke="currentColor" stroke-opacity=".25"/>' +
    '<text x="' + (bx + 10) + '" y="' + (by + 16) + '" font-size="12" font-weight="600" fill="#e6edf3">' + esc(head) + '</text>';
  lines.forEach((l, j) => { h += '<circle cx="' + (bx + 14) + '" cy="' + (by + 31 + j * 17) + '" r="4" fill="' + l.c + '"/><text x="' + (bx + 24) + '" y="' + (by + 35 + j * 17) + '" font-size="12" fill="#e6edf3">' + esc(l.t) + (l.ch ? '<tspan fill="' + l.cc + '">' + esc(l.ch) + '</tspan>' : '') + '</text>'; });
  g.innerHTML = h; g.style.display = '';
}
if ($('gov')) {
  // Esc closes the Trend popup alone when it is open (it sits over Review): the page's own Esc closes the rest
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && $('gov').classList.contains('open')) { $('gov').classList.remove('open'); e.stopPropagation(); } }, true);
  $('gclose').addEventListener('click', () => $('gov').classList.remove('open'));
  $('gov').addEventListener('click', e => { if (e.target.id === 'gov') $('gov').classList.remove('open'); });
  $('gsrc').addEventListener('click', e => { const b = e.target.closest('.zb'); if (!b) return; GT_SRC = b.dataset.s; grSave('gtr-src', GT_SRC); gtPaint(); });
  $('ggrades').addEventListener('input', e => { const i = e.target; if (!i.dataset.k) return; if (i.checked) { if (GT_SEL.length < GT_MAX && !GT_SEL.includes(i.dataset.k)) GT_SEL.push(i.dataset.k); } else GT_SEL = GT_SEL.filter(k => k !== i.dataset.k); grSave('gtr-sel', GT_SEL); gtPaint(); });
  $('ggrades').addEventListener('toggle', e => { const d = e.target; if (!d.classList || !d.classList.contains('gdd')) return;   // one dropdown open at a time
    if (d.open) { GT_OPEN = d.dataset.g; $('ggrades').querySelectorAll('details.gdd[open]').forEach(o => { if (o !== d) o.open = false; }); } else if (GT_OPEN === d.dataset.g) GT_OPEN = ''; }, true);
  if ($('glog')) $('glog').addEventListener('click', () => { GT_LOG = !GT_LOG; grSave('gtr-log', GT_LOG); gtPaint(); });
  if ($('gpct')) $('gpct').addEventListener('click', () => { GT_PCT = !GT_PCT; grSave('gtr-pct', GT_PCT); gtPaint(); });
  $('gchips').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; GT_SEL = GT_SEL.filter(k => k !== b.dataset.k); grSave('gtr-sel', GT_SEL); gtPaint(); });
  $('gzoom').addEventListener('click', e => { const b = e.target.closest('.zb'); if (!b) return; GT_ZOOM = b.dataset.z; grSave('gtr-zoom', GT_ZOOM); gtPaint(); });
}

grShowMode();
