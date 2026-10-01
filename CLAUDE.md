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
   Rates (green, from Observed), Decisions (amber: Anchor / Floor / Sell / P(sale in window) / Exp. days / Max buy /
   Net / Hot — depend on the two anchors and the Confidence, Window and Margin boxes),
   Trends (purple: the PriceCharting trend formulas applied to a 7-day median of raw sale totals, from the
   collector's per-card daily rollup kept 120 days; an eBay Trend popup shares the PriceCharting chart code).
3. **eBay Raw Data** — every matched raw listing first seen in the last 24 h, with the card's Anchor, this
   listing's own Sell $ / Max buy / Profit $ / ROI %, a PASS/reason verdict, Risk (scam-screen tier), Photos, Status and
   Time (h). Filters: Profit, ROI, "Listed within N h" (one number), a Condition chip (NM / LP / n/s),
   "Show suspects". Listings with < 2 photos are left out; a "Scam screen" button shows the calibration table.

Top bar: Confidence (default 70%) and Window (default 48 h) — together the liquidity rule — "Only show hits"
(Raw Data → PASS rows only), Margin (default 10%), Buy tax (default 6.25%; Brett sets it to 0 the day eBay approves
his MA resale certificate — the machine's own figure is the BUY_TAX_PCT line in /etc/pokemon-collector.env, default 6.25,
and only affects the hourly log counts),
LP correction chips (read-only, three price tiers, see below), Calibration checkbox, README button (the
README modal contains the full method walkthrough — keep it in sync when the model changes).
Every table header has a `?` (help) and an eye (collapse the column to a thin strip; remembered per tab).

## Files
- `build_catalog.py` — daily build. Downloads PriceCharting CSV, filters, computes trend stats from
  snapshots, writes `site/index.html`. The page itself lives in `page/`: `style.css`, `body.html`
  (the three tabs' markup), `app.js` (the browser logic) and `help.js` (the README text and the column
  help), stitched into a shell template at build time — edit those, not the Python, for page changes.
  In `help.js`: every column has a `?` help entry in the `HELP` dict; the README text is the `README`
  constant; column dependencies are the `LINKS` dict. Keep each page file under ~90 KB so it can be
  pushed through the connector in one call.
  Decision columns are recomputed in the browser (`decide()`), mirroring `compute_stats()` in the
  collector — keep the two in step.
- `ebay_sweep.py` — the collector's statistics module (and the manual-only Actions fallback). Sweep (newly listed, Ungraded condition id 4000,
  category 183454, $25–200, fixed price, US) → title matching → tracking (hourly presence sweep +
  single `getItem` calls; batch getItems is partner-only) → per-card stats → `live/ebay_live.bin`.
  `api_get()` retries connection errors; a failed lookup in enrich/track skips that listing, never the run.
  Constants at the top: sweep band, tracking cadence, gate (fee, shipping, tax, margin), CONFIDENCE,
  DEPTH_CAP, UNDERCUT, BO_HAIRCUT, hot-card thresholds, calibration thresholds, DAILY_KEEP_D / MED_WINDOW_D
  for the trend rollup. `--dry-run` uses `fixtures/`.
- `.github/workflows/update_catalog.yml` — daily 10:00 UTC + manual. Downloads snapshots from the
  release, builds, staticrypts, deploys Pages, uploads new snapshots. Counts only `pc_catalog_*` assets.
- `.github/workflows/ebay_sweep.yml` — manual only (`workflow_dispatch`; the schedule was removed 2026-10-01 when the
  machine took over), concurrency group `ebay`. Runs the collector, then
  force-pushes `live/ebay_live.bin` to a one-commit `live` branch (the page fetches it via
  raw.githubusercontent.com, which allows CORS; release assets do not).
- `requirements.txt` — pandas, numpy, requests, cryptography.

## Storage (git must stay small)
- Daily PriceCharting snapshots (`pc_catalog_YYYY-MM-DD.csv.gz.enc`, every PriceCharting column) and the
  collector state (`ebay_state.json.gz.enc`) are **release assets** on the release tagged `snapshots`,
  never committed. Encryption: AES-256-GCM, key from SITE_PASSWORD (PBKDF2), layout salt16|nonce12|ct.
- The eBay live file uses a deterministic key (PBKDF2 of SITE_PASSWORD with fixed salt
  `biotech-catalog-live-v1`) embedded in the page as `HKEY`; the history shards use the same key.
- The `live` branch is force-pushed every couple of minutes by the machine on purpose (no history growth).

## Secrets / variables (GitHub → Settings → Secrets and variables → Actions)
`PC_DOWNLOAD_URL` (PriceCharting CSV link or bare token), `SITE_PASSWORD`, `EBAY_CLIENT_ID` (App ID),
`EBAY_CLIENT_SECRET` (Cert ID), variable `BUYER_ZIP`. Production keyset; account-deletion exemption ticked.
eBay app token = client-credentials, scope `https://api.ebay.com/oauth/api_scope`. Budget 5,000 calls/day.
`lookup_budget()` reserves the day's remaining sweeps (8 calls each) and hourly presence walks (40) first and
spreads whatever is left over the remaining runs as getItem lookups (enrich gets 1/7, track the rest, capped at
6 / 35); it recomputes from actual usage every run, so sweeps never get skipped for budget. Hard stop at 4,950.

## Where it runs now (2026-09-30): a rented machine
The eBay side moved off GitHub Actions to a DigitalOcean droplet ("pokemon-collector", $6/mo, Ubuntu 24.04, NYC1)
running `collector.py` as a systemd service (`pokemon-collector`). Reasons: GitHub's terms don't cover an always-on
data collector, scheduled runs can't go under 5 min and get delayed, and 1-minute discovery needs a loop. Layout on
the machine: /opt/pokemon-collector/{repo,venv,data,.ssh}; secrets in /etc/pokemon-collector.env (only there — never
in the repo); state in data/ebay_state.json.gz.enc; results force-pushed to the `live` branch with a deploy key
(ebay_live.bin, collector.log, hourly state backup). `setup.sh` installs all of it (`curl … | bash` as root).
Operating it: the machine pulls `main` every 5 min and restarts itself when collector.py / ebay_sweep.py change, so
pushing to GitHub is still the whole deployment step; its log is `collector.log` on the `live` branch (read it with
the connector, ref=live); on the machine: `journalctl -u pokemon-collector -f`. Budget: eBay's own remaining-calls
figure (Developer Analytics `rate_limit`, read hourly) paces everything; discovery is reserved first, the rest is a
token bucket (`refill()` / `spend()`). Outcomes: hour windows by listing start date re-read with the search endpoint
(`itemStartDate` filter, $35–200 band; hourly for day 1, 6-hourly to day 3, daily to day 10), one getItem per
vanished listing, the 3 cheapest copies of every priced $40–200 card re-verified every 48 h, keyword-only listings
checked at day 1 and 3, open listings closed as stale at 30 d. A self-test on start proves the date-window filter
works before re-reads are enabled (`window_ok`). The Actions workflow `ebay_sweep.yml` is the fallback (manual only
once the machine is confirmed publishing); it must not run on a schedule at the same time, since both force-push
the `live` branch.

## Capacity (measured 2026-09-30 on the Actions design; the machine design above is the answer to it)
Real volume: ~9,500 matched listings/day, ~11,400 open after 2.5 days, 7,327 lookups due vs ~2,700/day possible.
Following every listing to its outcome (checks at day 3/10/30) is ~11x over budget and can never catch up; the
hourly presence walk (8,000 newest aspect-query items) reaches only ~11 h of listing age. Consequences: sales
after ~11 h are found late or never (λ biased low, safe direction), and sold copies linger in the book as
phantom competitors (p1 too low, N too high) until a check reaches them. The queue order is therefore the policy
(`check_value()`): presence-flagged listings first, then calibration listings (rank0 ≤ 3), then listings ≥ $40,
then the rest. Next step (not built): targeted book verification — re-check the 3 cheapest open copies of every
card that has a λ and a price in $40–200 every ~48 h (~1,200 calls/day) so the book and the hot-card confirmations
stay honest, and drop the day-10/30 checks for cheap listings. State growth (open listings never reaching their
day-30 check are never closed as stale) also needs a rule.

## The model (short) — the two-anchor version (2026-10-01; see README sections 3–9 for the worked example)
- λ = raw sales/day = 25th percentile of Gamma(k + ½, D), k = comparable sales in 30 d, D = days observed.
  No PriceCharting prior (decision: eBay-only). λ is NOT calibrated — the PRICE is (below).
- Anchor A (`anchor()`): the card's comparable sales in 30 d (60 d if < ANCHOR_MIN = 5), LP lifted to NM-equivalent,
  trimmed (Tukey fences ∩ median/4..×4), recency-weighted (half-life 10 d), centred with a weighted median under
  8 sales and weighted Hodges–Lehmann from 8 (`robust_center()`). A_fast = median of sales that sold within 48 h of
  listing when there are ≥ 8 of them. The gate is shut while A_n < 5 ("too few sales").
- Floor L (`credible()`): cheapest open comparable copy (BO at 90%, LP lifted) that is not watch/suspect, not from a
  seller under 50 ratings or under the feedback bar, not under 75% of A, and not older than 1.6/λ days (1..7).
  Top 5 credible copies travel in the live file (`cred`) so the page can judge a listing with itself left out.
- Sell S (`sell_price()`): min(L − $0.50, 0.95 × A), capped by A_fast, rounded down to .99; 0.93 × A with no floor.
  The old P₂₄/P₄₈ = pₙ − $1 depth rule is gone (it let the worst listing in the book set the price and assumed
  strictly cheapest-first buying); do not bring it back.
- Liquidity (`is_liquid()`): λ ≥ −ln(1 − Confidence) / (Window/24) and, once measured, sell-through ≥ 50%. The
  Confidence and Window boxes on the page set this; 48 h at 80% needs λ ≥ 0.8 (~24 sales/month), 72 h at 70% needs
  0.4. This is Brett's choice and the biggest lever on how many cards are eligible — it is exposed, not hidden.
- Gate (`verdict()` / `listing_decision()`, mirrored by `verdictOf()` / `listingDecide()` on the page): photos ≥ 2,
  not suspect, A present, A_n ≥ 5, liquid, comparable condition, seller bar, then "review" if the listing is under
  45% of A, else PASS when all-in (item + shipping + 6.25% tax) ≤ Max buy where
  net = S × (1 − 0.1325 × 1.065) − 0.40 − 4.50 − 0.30 and Max buy = net ÷ (1 + margin), margin default 10%.
  Each listing's S is computed with its own floor = the cheapest credible copy OTHER than itself. LP listings are
  judged at the LP-discounted S. Verdict strings: PASS, review, over max buy, not liquid, too few sales (n),
  no sales yet, suspect, fewer than 2 photos, condition X, seller < N%.
- Measurement: every new listing is stamped with ratio0 = price / A; `deal_calib()` tabulates closed listings by
  that ratio with how fast they sold (shown in the Scam screen modal as "How fast cheap listings go"). This is
  the data that decides whether new-listing scanning can produce hits at all; the next sourcing step (a daily
  Best Offer list on aged listings of liquid cards, auctions, resurfacing price drops on Raw Data) waits on it.
- All eBay prices are buyer totals (item + shipping). Brett lists with FREE shipping at S, Best Offer on with
  auto-accept ~3% under; unsold at 36–48 h → 0.90 × A.
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
- The sell price is anchored on sold comps (A) with the credible floor (L) as the undercut target; the fee wedge
  (~24% of a sale) is why hits need ~31% off at a 10% margin — explain that before touching the gate again.
- Housekeeping Brett should do: verify the real label cost; register as a MA vendor and file an ST-4 resale certificate
  with eBay's tax-exemption program (removes the 6.25% buying tax — breakeven 24% → <19%; then Buy tax box → 0 and
  BUY_TAX_PCT=0 on the machine); confirm eBay payout timing.
- Keep it simple; don't over-build. Brett prefers fewer, larger flips; ≥15% margin, ≥$5 per flip.

## Roadmap (in order)
0. Sourcing, once the deal-speed table has two weeks of data: a daily Best Offer list (aged listings of liquid
   cards, offer at this listing's Max buy), an auction watch (liquid cards ending at off-hours), and resurfacing
   price drops / relists on Raw Data (they never appear as "new"). eBay's API cannot send offers or bids: the
   site produces the list, Brett clicks.
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
- `collector.py --dry-run --once` (with COLLECTOR_HOME pointing at a scratch folder) runs one loop cycle on the
  fixtures with no network and no git; the jsdom refresh test (test_refresh.js in the harness) needs
  `pretendToBeVisual: true` and an explicit process.exit because the page now runs timers.
- `python -c "import ast; ast.parse(open('build_catalog.py').read())"` and same for `ebay_sweep.py`.
- `python ebay_sweep.py --dry-run` with a `fixtures/` folder (catalog.csv, search.json, items.json,
  optional state.json) exercises matching, tracking and stats offline.
- The page can be exercised with jsdom (inject WebCrypto, DecompressionStream, fetch stub for the live file).
- After pushing: `gh workflow run "Update Pokemon catalog site"` and/or `gh workflow run "eBay sweep"`,
  then `gh run watch`; hard-refresh the site (Cmd+Shift+R; Pages caches ~10 min).

## Style
Plain language in replies; explain formulas with a worked example; no unrequested features.
