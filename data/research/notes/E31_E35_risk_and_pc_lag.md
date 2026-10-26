# E31 / E33c / E35 — risk gauges that failed, and a red flag about PriceCharting's lag

Written 2026-10-26 (round 2). Scripts: `e31_era_rotation_vol.py`, `e33c_setdev_october.py`, `e35_pc_lag_vs_tcgplayer.py`.

## E31 — era rotation, volatility management, dispersion

* **Era rotation by PSA 10 momentum** (stock "industry momentum"): each month buy the era whose PSA 10 index rose most
  last month. Next-month raw return of that era beats the four-era average by +1.3 points (62.5% of 56 months, t 2.5).
  The PSA 10 − raw 3-month gap does nothing (0.0); raw's own last month +0.8 points (t 1.4). Real but small — not worth
  a rule; at most a display.
* **Volatility-managed exposure** (Moreira & Muir 2017: cut exposure when recent volatility is high): the market's 3- or
  6-month volatility of its median monthly move has the wrong sign here (high volatility → slightly better next
  quarter, Spearman +0.19/+0.25). Nothing to build.
* **Cross-sectional dispersion** (the interquartile range of card log returns in the month): its high tercile was
  followed by a negative quarter in 20/20 months (Spearman −0.56) — but dispersion trends with the data era (high in
  2021–22, low in 2023–24), so it mostly re-describes the regime. Added to reg3 the leave-one-year-out R² moves 0.518 →
  0.530; relative to its own 24-month median it adds nothing (0.405); a "reg3 > 0 and low dispersion" gate is worse
  (63% sign accuracy vs 91%). Failed.

## E33c — the red flag: PriceCharting can lag eBay for hot cards

October 2026 is the only stretch with daily PriceCharting prices *and* eBay sold prices. For the relative-reversal
signal (E33) measured at the end of September:

| price source | cards | setdev IC | dev12 IC | bottom-quintile vs top-quintile change (setdev) |
|---|---|---|---|---|
| PriceCharting raw price, 09-28 → 10-26 (band) | 2,068 | −0.15 (reversal, as expected) | −0.06 | +16.0% vs +6.8% |
| eBay median sold total, early vs late October | 290 | **+0.11** | **+0.29** | +6.7% vs +15.8% |

On eBay the sign flips. For the same 290 cards, by dev12 quintile: cards furthest **above** their 12-month mean rose
+25.4% on eBay in about two weeks while PriceCharting's price for them moved +2.7%; cards furthest below moved +0.9% on
eBay and +1.5% on PriceCharting. PriceCharting's figure lagged eBay badly for the hot cards.

Why it matters: every back-test in E02–E40 measures returns with PriceCharting's prices. If PriceCharting lags eBay
for fast movers, part of a "reversal" in PriceCharting data can be PriceCharting catching up to an eBay move that has
already happened — a buyer on eBay pays the new price and collects nothing. E07 found eBay's median ≈ PriceCharting for
$50+ cards *on average*, and E13 found a weekly reversal on eBay itself, so the reversal is not simply an artifact —
but this window says the lag can be large exactly when it matters (hot cards in a boom).

Limits: one window, 290 liquid cards, the strongest graded rally in the sample, two weeks.

## E35 — no lag at the market level

Month-end (and month-average) returns of PokéViews' TCGplayer-based PV100 / PV250 vs the PriceCharting market median,
2024-05 … 2026-10: the contemporaneous correlation is the highest (0.36–0.48); PriceCharting leading PokéViews by a month
(0.30–0.47) is about as common as the reverse (0.26–0.35). No systematic market-level lag — the E33c lag is a card-level,
hot-card phenomenon.

## What to do

* Treat the reversal's edge as *probable but not proven on transaction prices*. The validation needs the collector's
  eBay data over ≥ 90 days (backlog B04, B15): buy-side = the floor/ask seen at decision time, sell-side = eBay sales
  2–3 months later.
* In the tab: when a reversal pick's eBay sold median (A) is already well above PriceCharting's price, the "dip" may be
  PriceCharting lag — demote or warn (the gap is on the Forecast row already: "+X% vs PC").

## Later work
- (empty)
