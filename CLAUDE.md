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
   list of card identities). Three colored header bands: Observed (blue, independent inputs),
   Rates (green, from Observed), Decisions (amber, depend on λ, the book, and the Confidence/Margin boxes).
3. **eBay Raw Data** — every matched raw listing first seen in the last 24 h, with a PASS/reason verdict.

Top bar: Confidence (default 70%), Margin (default 15%), Calibration checkbox, README button (the README
modal contains the full method walkthrough — keep it in sync when the model changes).

## Files
- `build_catalog.py` — daily build. Downloads PriceCharting CSV, filters, computes trend stats from
  snapshots, writes `site/index.html` (all HTML/CSS/JS is inside this file as one big Python string).
  Every column has a `?` help entry in the `HELP` dict; the README text is the `README` JS constant;
  column dependencies are the `LINKS` dict. Decision columns are recomputed in the browser (`decide()`),
  mirroring `compute_stats()` in the collector — keep the two in step.
- `ebay_sweep.py` — the eBay collector, every 15 min. Sweep (newly listed, Ungraded condition id 4000,
  category 183454, $25–200, fixed price, US) → title matching → tracking (hourly presence sweep +
  single `getItem` calls; batch getItems is partner-only) → per-card stats → `live/ebay_live.bin`.
  Constants at the top: sweep band, tracking cadence, gate (fee, shipping, tax, margin), CONFIDENCE,
  DEPTH_CAP, UNDERCUT, BO_HAIRCUT, hot-card thresholds, calibration thresholds. `--dry-run` uses `fixtures/`.
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
- Price calibration: each new listing is stamped with the model's P₄₈/P₂₄ for its card and its offset from
  it; realized 48 h / 24 h sell-through by offset bucket gives the shift where the curve crosses 70%;
  applied once ≥ 150 outcomes with ≥ 25 in the two buckets around the crossing.

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

## Testing before pushing
- `python -c "import ast; ast.parse(open('build_catalog.py').read())"` and same for `ebay_sweep.py`.
- `python ebay_sweep.py --dry-run` with a `fixtures/` folder (catalog.csv, search.json, items.json,
  optional state.json) exercises matching, tracking and stats offline.
- The page can be exercised with jsdom (inject WebCrypto, DecompressionStream, fetch stub for the live file).
- After pushing: `gh workflow run "Update Pokemon catalog site"` and/or `gh workflow run "eBay sweep"`,
  then `gh run watch`; hard-refresh the site (Cmd+Shift+R; Pages caches ~10 min).

## Style
Plain language in replies; explain formulas with a worked example; no unrequested features.
