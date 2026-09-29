# CLAUDE.md — Pokémon card catalog (repo: BrettS600/biotech-catelog)

Read this first. It is the whole context; the owner (Brett) would rather not re-explain.

## What this is
A private, password-protected website for buying and reselling **raw (ungraded) Pokémon singles on eBay**.
Live at https://bretts600.github.io/biotech-catelog/ (GitHub Pages, encrypted with staticrypt).
Everything runs on GitHub Actions; nothing runs on Brett's laptop. Never commit secrets or data.

Three tabs:
1. **PriceCharting Catalog** (default) — 43,891 English singles from PriceCharting's daily CSV, plus trend
   columns computed from this site's own daily snapshots (Δ7d/30d, 90-day range, volatility, Theil–Sen slope,
   volume drift) and a per-card Trend popup with a chart and a buy-gate table.
2. **eBay Catalog** — one row per card, numbers computed ONLY from eBay (PriceCharting is used just as the
   list of card identities). Four colored header bands: Observed (blue, independent inputs),
   Rates (green, from Observed), Decisions (amber, depend on λ, the book, and the Confidence/Margin boxes),
   Trends (purple: the PriceCharting trend formulas applied to a 7-day median of raw sale totals, from the
   collector's per-card daily rollup kept 120 days; an eBay Trend popup shares the PriceCharting chart code).
3. **eBay Raw Data** — every matched raw listing first seen in the last 24 h, with the card's P₄₈, the
   listing's Max buy / Profit $ / ROI %, a PASS/reason verdict, Risk (scam-screen tier), Photos, Status and
   Time (h). Filters: Profit, ROI, "Listed within N h" (one number), a Condition chip (NM / LP / n/s),
   "Show suspects". Listings with < 2 photos are left out; a "Scam screen" button shows the calibration table.

Top bar: Confidence (default 70%), "Only show hits" (Raw Data → PASS rows only), Margin (default 15%),
LP correction chips (read-only, three price tiers, see below), Calibration checkbox, README button (the
README modal contains the full method walkthrough — keep it in sync when the model changes).
Every table header has a `?` (help) and an eye (collapse the column to a thin strip; remembered per tab).

## Files
- `build_catalog.py` — daily build. Downloads PriceCharting CSV, filters, computes trend stats from
  snapshots, writes `site/index.html`. The page itself lives in `page/`: `style.css`, `body.html`
  (the three tabs' markup) and `app.js` (all the browser logic), stitched into a shell template at build
  time — edit those, not the Python, for page changes. In `app.js`: every column has a `?` help entry in
  the `HELP` dict; the README text is the `README` constant; column dependencies are the `LINKS` dict.
  Decision columns are recomputed in the browser (`decide()`), mirroring `compute_stats()` in the
  collector — keep the two in step.
- `ebay_sweep.py` — the eBay collector, every 15 min. Sweep (newly listed, Ungraded condition id 4000,
  category 183454, $25–200, fixed price, US) → title matching → tracking (hourly presence sweep +
  single `getItem` calls; batch getItems is partner-only) → per-card stats → `live/ebay_live.bin`.
  Constants at the top: sweep band, tracking cadence, gate (fee, shipping, tax, margin), CONFIDENCE,
  DEPTH_CAP, UNDERCUT, BO_HAIRCUT, hot-card thresholds, calibration thresholds, DAILY_KEEP_D / MED_WINDOW_D
  for the trend rollup. `--dry-run` uses `fixtures/`.
- `.github/workflows/update_catalog.yml` — daily 10:00 UTC + manual. Downloads snapshots from the
  release, builds, staticrypts, deploys Pages, uploads new snapshots. Counts only `pc_catalog_*` assets.
- `.github/workflows/ebay_sweep.yml` — `*/15 * * * *`, concurrency group `ebay`. Runs the collector, then
  force-pushes `live/ebay_live.bin` to a one-commit `live` branch (the page fetches it via
  raw.githubusercontent.com, which allows CORS; release assets do not).
- `requirements.txt` — pandas, numpy, requests, cryptography.

## Storage (git must stay small)
- Daily PriceCharting snapshots (`pc_catalog_YYYY-MM-DD.csv.gz.enc`, every PriceCharting column) and the
  collector state (`ebay_state.json.gz.enc`) are **release assets** on the release tagged `snapshots`,
  never committed. Encryption: AES-256-GCM, key from SITE_PASSWORD (PBKDF2), layout salt16|nonce12|ct.
- The eBay live file uses a deterministic key (PBKDF2 of SITE_PASSWORD with fixed salt
  `biotech-catalog-live-v1`) embedded in the page as `HKEY`; the history shards use the same key.
- The `live` branch is force-pushed every 15 min on purpose (no history growth).

## Secrets / variables (GitHub → Settings → Secrets and variables → Actions)
`PC_DOWNLOAD_URL` (PriceCharting CSV link or bare token), `SITE_PASSWORD`, `EBAY_CLIENT_ID` (App ID),
`EBAY_CLIENT_SECRET` (Cert ID), variable `BUYER_ZIP`. Production keyset; account-deletion exemption ticked.
eBay app token = client-credentials, scope `https://api.ebay.com/oauth/api_scope`. Budget 5,000 calls/day;
the collector stops itself at 4,800.

## The model (short)
- λ = raw sales/day = 25th percentile of Gamma(k + ½, D), k = comparable sales in 30 d, D = days observed.
  No PriceCharting prior (decision: eBay-only). λ is NOT calibrated — the PRICE is (below).
- Buyers in T days ~ Poisson(λT). Depth n = largest n ≤ 3 with P(≥ n) ≥ Confidence. P₂₄/P₄₈ = pₙ − $1
  (book of comparable open copies by buyer total; Best Offer copies ranked at 90%), falling back to the
  sold median / 80th percentile; P₄₈ capped at the sold 80th percentile; Window $ = p₁ − $1 when n = 0.
- All eBay prices are buyer totals (item + shipping). Brett lists with FREE shipping at P₄₈, Best Offer
  auto-accept at P₂₄.
- Gate: net = P × (1 − 0.1325 × 1.065) − 0.30 − 4.50; max buy = net ÷ (1 + margin); a listing PASSes when
  item + shipping + 6.25% tax ≤ max buy. Comparable = NM/LP/not stated, seller ≥ 98%.
- Hot card = 5 checks, then confirmed by the next 3 listings selling within 48 h.
- Condition: NM, LP and not-stated count in every COUNT (demand and supply are condition-blind); every LP
  PRICE is lifted to NM-equivalent (total ÷ (1 − LP discount)) before the book, sold median/80th, P₄₈ and
  the daily rollup, so Catalog prices are NM prices. On Raw Data a listing that says LP has its sell price
  cut by the discount → lower Max buy / Profit / ROI (hover Max buy shows the NM figure); not-stated = NM
  (Brett's decision); MP/HP excluded from everything but still listed with a "condition" verdict.
  The LP discount is measured in `lp_correction()`: per LP sale, total ÷ median of the same card's
  NM/unstated sales within ±7 d; 1 − median(ratio), pooled across cards, per NM-price tier (<100, 100–150,
  150+). Ladder: tier (≥ 30 LP sales) → global (≥ 30) → 12% default. Published in the live file as `lp`;
  the page shows the three tiers read-only next to Margin.
- Price calibration: each new listing is stamped with the model's P₄₈/P₂₄ for its card and its offset from
  it; realized 48 h / 24 h sell-through by offset bucket gives the shift where the curve crosses 70%;
  applied once ≥ 150 outcomes with ≥ 25 in the two buckets around the crossing.
- Scam screen (`score_listings()` in the collector, constants SCAM_*): every open listing gets a points
  score — price vs the card's price (from last run's `price_cache`, else the 2nd-cheapest open ask;
  <50% +4, 50–65% +2, 65–75% +1, bands +5 on $100+ cards), seller feedback count (<10 +3, 10–49 +1,
  unknown +1), count-aware feedback % (`seller_bar()`: 100+ need 98%, 20–99 need 95%, <20 ignored; fail +2),
  one photo +1, 3+ copies of a $75+ card +2, photo id reused by another seller +3, no returns and <65% +1,
  delivery window >10 d +1, Top Rated Plus −2, 500+ feedback at 99%+ −1. ≥5 = suspect, 3–4 = watch;
  a watch listing in a same-day burst of 5+ $75+ listings from an unseen seller becomes suspect.
  Suspect → out of every statistic (`comparable()`, sold, daily rollup) and hidden on Raw Data behind
  "Show suspects"; watch → in the statistics but never alone at p₁. Quantity/returns come from `enrich()`
  (≤ 6 full getItem lookups per run for cheap or thin-seller listings). Closed listings keep their stamp;
  `scam_calib()` tabulates outcomes by tier and signal (gone = pulled early ≈ scam) for hand-tuning.
- Raw Data leaves out listings with fewer than 2 photos (Brett needs front + back); the Catalog keeps them.

## Decisions already made (don't relitigate)
- eBay only for the eBay tabs; PriceCharting is the identity list. Default filter = card's eBay price
  $50–150 (adjustable); collector sweeps $25–200 on purpose (deals sit below the band, books above it).
- Retail buy/sell columns removed. Free shipping when selling. 48 h is the planned sell window, not 24.
- Rate stays as measured; calibrate the price. Don't change the model before data can check it.
- Keep it simple; don't over-build. Brett prefers fewer, larger flips; ≥15% margin, ≥$5 per flip.

## Roadmap (in order)
1. After 2–3 weeks: compare Hot cards' λ with ln 2 ÷ (median hours to sale ÷ 24); if consistently higher,
   use the waiting-time λ when Sell-thru ≥ 80% and Days supply < 3 (supply-capped demand).
2. Tune the title matcher from the Unmatched list (aliases in `SET_ALIASES`, `VARIANT_WORDS`, `REJECT`).
3. Deal alerts (e.g. open a GitHub issue when a listing PASSes) — optional, off by default.
4. Make history shards incremental once a year of snapshots makes the daily rebuild slow.
5. A flip ledger (card, buy, list, sold, hours) as the real calibration set.

## How changes get pushed
Brett works from claude.ai chat. The GitHub connector (custom MCP, api.githubcopilot.com) can push files
directly (`push_files`); the workflow is then triggered by clicking "Run workflow" through the Claude in
Chrome extension (the connector has no Actions tools). Verify a push by comparing the blob SHA
(`sha1("blob <size>\0" + bytes)`) with the directory listing. Claude Code (desktop) is the faster route
for larger changes; Brett has not adopted it yet.

## Testing before pushing
- `python -c "import ast; ast.parse(open('build_catalog.py').read())"` and same for `ebay_sweep.py`.
- `python ebay_sweep.py --dry-run` with a `fixtures/` folder (catalog.csv, search.json, items.json,
  optional state.json) exercises matching, tracking and stats offline.
- The page can be exercised with jsdom (inject WebCrypto, DecompressionStream, fetch stub for the live file).
- After pushing: `gh workflow run "Update Pokemon catalog site"` and/or `gh workflow run "eBay sweep"`,
  then `gh run watch`; hard-refresh the site (Cmd+Shift+R; Pages caches ~10 min).

## Style
Plain language in replies; explain formulas with a worked example; no unrequested features.
