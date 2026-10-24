# E22 — Do the S&P 500, gold or Bitcoin lead the card market? (backlog B14)

**Question.** Collectors' forums tie card prices to "risk appetite" — crypto booms, stock rallies, gold as the flight
to safety. PokéViews publishes daily index levels for its Top-250 alongside the S&P 500, gold and BTC
(`pokeviews/pokemon_vs_assets.csv`, since 2024-04-01). Does any of them *lead* the card market by 1–3 months, and
would it add to the regime forecast?

**Method.** `scripts/e22_asset_leadlag.py`. (1) Monthly: month-end asset returns vs the PV250's month-end return and
vs the PriceCharting market median move (E01), Spearman at leads/lags −3…+3 (30 months, 2024-05…2026-10). (2) The E04
recipe: next-month card move on its own lag plus the asset's current return, Newey-West t and leave-one-year-out
out-of-sample R². (3) Daily: an asset's trailing 30-day return vs the PV250's forward 30/60/90-day return, with the
number of non-overlapping windows stated. Outputs `results/E22_asset_monthly.csv`, `E22_asset_leadlag.csv`,
`E22_asset_incremental.csv`, `E22_asset_daily.csv`.

**Results.**
* Contemporaneous monthly correlations are nil: S&P +0.08, gold −0.21, BTC +0.18 against the PV250; −0.17 / +0.07 /
  −0.03 against the PriceCharting median. The strongest "lead" anywhere is the S&P's prior-month return against the
  card median at **−0.35** (p 0.07, 29 months) — the wrong sign for the risk-appetite story and one of 42 correlations
  tested, so noise-sized.
* Adding any asset to the AR forecast **lowers** the out-of-sample R² (PV250: 0.29 AR-only → 0.20 with S&P, 0.02 with
  gold, 0.27 with BTC; card median: 0.10 → −0.04 / 0.02 / 0.17); no HAC t exceeds 1.7.
* Daily: BTC's trailing 30-day return vs the PV250's forward 60/90-day return reads +0.33/+0.41, but on 9–14 independent
  windows, over one BTC cycle, while the PV250's **own** 30-day return predicts its next 30 days at +0.60 (the regime
  persistence of E04 at daily resolution). Gold is negative (−0.23 to −0.25), the S&P ≈ +0.08.

**Interpretation.** On the data that exist (30 months, one macro cycle) there is no usable lead from stocks, gold or
crypto to Pokémon prices. The card market's own momentum is far stronger than anything the macro assets contribute, and
the BTC co-movement is one shared boom, not a lead that survived a test. This is the expected answer — the Top-250
correlation table PokéViews itself publishes (`asset_correlation.csv`: S&P −0.12 against the Top-100 over a year) says
the same.

**Verdict.** *Failed / nothing to build*: do not add asset prices to the gate or the ranking. Revisit only after the
asset file spans a full crypto or equity down-cycle (B14 stays low priority).
