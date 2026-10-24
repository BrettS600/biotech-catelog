# E13 — eBay daily dynamics from the collector's rollup (first look, 26 days of data)

**Question.** The PriceCharting work is monthly. What does the eBay level itself show at the weekly scale that a
1-month hold lives in: (a) weekly reversal or momentum in the 7-day sold median; (b) are deep floors (cheapest ask far
below the median) bargains, or early information that the median is coming down (adverse selection)?

**Method.** `scripts/e13_ebay_daily.py` on `data/ebay/daily_rollup.csv.gz` (2026-09-28 … 10-23; cards with a 7-day
median ≥ $25). (a) Cross-sectional Spearman per day between the median's past-7-day change and its next-7-day change,
quintile means (10 days with a forward week, 69–186 cards each). (b) cheapest_ask / 7-day median on day t vs the median's
change over the next 7 and 14 days, by ratio bin (13 days, ~2,800 card-days).

**Results** (`results/E13_ebay_weekly_reversal.csv`, `E13_floor_adverse_selection.csv`).
* Weekly reversal: mean Spearman **−0.15, negative on 9 of 10 days**. The week's biggest risers (top quintile, +11 to
  +36 %) gave back −5.5 % the following week; the biggest fallers (−15 to −21 %) were flat (−0.6 %) against an all-card
  average of −2.5 % (the market cooled over these weeks). Reversal at the eBay weekly scale is mostly *winners giving back*.
* Floors: ask < 0.80 × median → median −1.4 % over 7 days, **−4.0 % over 14 days**; ask 0.80–0.90 → −0.9 % / −2.5 %;
  ask 0.90–1.00 → +2.1 % / +1.3 %. A deep floor carries mild bad news: the median drifts down ~4 points in two weeks.
  Against a 20 %+ discount that leaves ~15 points of edge; against a 10 % discount it eats half.

**Interpretation.** Both findings line up with the monthly work: price moves on eBay partly revert within weeks (so
chasing a card that just spiked is the wrong trade), and the discount strategy survives adverse selection with room to
spare at 20 % under but not at 10 %. The sample is tiny (one cooling fortnight); the real value of this experiment is the
script — rerun it monthly as the rollup grows (90+ days gives weekly tests with real power, and lets the floor test be
done on *realised* sales of floor-bought cards rather than the median).

**Verdict.** *Suggestive, not conclusive*: weekly reversal present; deep floors mildly adversely selected (−4 % in 14 d).
Rerun when the rollup has ≥ 90 days.
