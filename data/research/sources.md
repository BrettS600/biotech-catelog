# Outside reading — what others say, and which claims were testable here

Collected 2026-10-24. Trade-press claims are unsourced unless noted; the point is to list what people *believe* works
and mark what the data in `data/` could check.

## eBay fees (the friction the whole model turns on)

* eBay seller update, Jan 2025 — final value fees for Trading Cards (Sports, Non-Sport, CCG): **13.25 %** for non-store /
  Starter Store sellers (+2.35 % on the portion above $7,500); **12.35 % for Basic-or-above Store subscribers** (+2.35 %
  above $2,500). Per-order fee $0.40 (orders over $10). https://www.ebay.com/sellercenter/resources/seller-updates/2025-january/final-value-fee
  → used in E08 ("store" scenario). A Basic Store is ~$22/month, so the 0.9-point saving pays at ≈ $2,400 of monthly sales.
* eBay promotion Mar 3 – May 4 2025: 50 % off FVF on single trading cards selling for ≥ $1,000 (opt-in).
  https://pages.ebay.com/promo/2025/tc-singles → such promotions recur; worth watching for the high-value tail.
* Fee-calculator sites (litcommerce, frooition, closo) restate the same numbers.

## Pokémon flipping strategy (trade press / community)

* pokemonpricetracker.com, "How to flip Pokemon cards for profit: 2026 strategy"
  https://www.pokemonpricetracker.com/blog/posts/how-to-flip-pokemon-cards-for-profit-2026-strategy — claims (unsourced):
  sell new-release chase cards within 1–3 days (they fall after); "June–August lull" is a buy window, Q2 a sell window;
  buy within 24 h of a tournament-winning deck, sell 7–14 days later (+20–40 % claimed); buy Japanese 3–4 months before
  the English release; post-reprint panic selling is a buy; eBay best above $100, TCGplayer for $5–100 (10.25 % + $0.30),
  Facebook/local zero-fee for quick flips under $200; price quick flips at lowest listing × 0.95; NM vs LP gap 30–50 %;
  portfolio 8–12 cards, ≤ 10 % per card; hold periods: release flips 1–3 days, market timing 30–180 days.
  **Testable here and tested:** young-set decay (E05: sets < 12 months lose 10–25 % in 3 months — consistent with
  "sell new releases immediately, never hold them"); seasonality (E05: Mar–Apr strongest, Jun–Sep weakest — consistent
  with the lull); position limits (E10 uses 20 % per card; the sim's variance at $2,000 argues for ≥ 10 cards).
  **Not testable with monthly data:** tournament spikes, 1–3-day release flips, Japanese→English lead.
* closo.co / ripster.gg / zikanalytics / rarityfinder 2026 selling guides — general listing hygiene (sold comps, photos,
  $99.99 pricing, lots for bulk). Nothing quantitative beyond fee restatements.

## Academic / quantitative

* **"Stock market anomalies and baseball cards"**, Financial Review 55(3) 2020 (DOI 10.1111/fire.12223)
  https://ideas.repec.org/a/bla/finrev/v55y2020i3p461-479.html — finds *momentum* in card prices (stronger for active
  players and newer sets), price drift after fundamental news, and IPO-style underperformance of newly issued cards /
  sets; interprets via slow information diffusion and short-sale constraints. **Here:** the new-issue underperformance
  replicates strongly (E05); card-level momentum does *not* — PriceCharting monthly averages show reversal at 1–12
  months (E02/E03); set-level momentum is weakly positive (E02). The difference is plausibly the data: monthly averages
  of thin eBay sales (bid-ask bounce → reversal) vs. the paper's smoother price guides.
* **"Trading card games as an alternative asset: portfolio diversification and risk-return analysis"**, J. Asset
  Management 2026 (MTG, 117 blue-chip cards, 2010–2025) https://link.springer.com/article/10.1057/s41260-026-00467-x —
  CAGR ~21 %, vol 13 %, beta to S&P ≈ 0, card-level drawdowns often > 60 %, **transaction costs 10–20 % for mid-range
  cards**, reprint (issuer governance) risk material. No momentum / reversal tests. **Here:** confirms the fee wall is
  the defining feature of the asset class; supports the E10 finding that diversification across ≥ 20 cards is needed.
* **"Sales characteristics of Pokémon trading cards: a prospective one-year field study"**, PLOS ONE 2025
  https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0334289 — 300 cheap vintage cards listed on eBay
  Germany at fixed prices: 73 % sold within a year; holofoils sold in a median 17 days vs 78 for matte; rares/holos are
  ~20 % of cards but ~60 % of revenue. **Here:** time-to-sell scales with desirability; the collector's `edays` (E07:
  median 3.5–5.5 days in the $25–1000 band) is far shorter because the band excludes bulk.
* Stock-market methods borrowed: cross-sectional decile tests and monthly IC (Jegadeesh–Titman style) → E02/E03;
  short-term reversal (Jegadeesh 1990, Lehmann 1990) → the dominant effect found; 52-week-high anchoring (George–Hwang
  2004) → `hi12` behaves as reversal here, not momentum; time-series momentum / trend filters (Moskowitz–Ooi–Pedersen
  2012) → the regime gate (E04/E10) is exactly a 3-month time-series-momentum filter on the market index and is the
  most valuable single rule; walk-forward gradient boosting with calibration → E06; Kelly-style sizing is **not**
  applied (per-cycle edge is too uncertain; E10 uses a flat 20 % cap and ≥ 20 names instead).
* Stock-market methods borrowed, second round (E21/E22): Fama–MacBeth (1973) monthly cross-sectional regressions with
  Newey–West standard errors → E21 (dev12 is the single priced characteristic; the controls — Jegadeesh–Titman 12-1
  momentum, Ang et al. (2006) idiosyncratic volatility, Frazzini–Pedersen (2014) betting-against-beta, George–Hwang
  52-week high, Amihud-style liquidity, "size" via log price — are all subsumed); the CAPM alpha/beta regression of a
  long–short decile portfolio on the market factor → E21 (alpha +15 %/quarter, beta ≈ −0.3: the premium is not market
  risk); Granger-style lead/lag with an autoregressive control → E22 (no lead from the S&P 500, gold or BTC).

## Market commentary, October 2026

* slabfol.io "Pokémon card market crash or correction? 2026 price data", cardcenteringtool.com October 2026 posts,
  samuraiswordtokyo.com Japanese market trends, TCGplayer seller blog price-drop lists — the trade press is debating a
  cooling after the 2025–26 run. **Here:** the market's own trailing move (E01 `median_mom1`: +0.6 % Sep 2026, +2.2 % Oct
  to date, down from +5–7 % in Mar–May 2026) and PokéViews' indicators (HCI 43, % above 30-day 0.57, distance from
  SMA200 shrinking) say the regime is still positive but decelerating — the gate is on, with less margin than in spring.
