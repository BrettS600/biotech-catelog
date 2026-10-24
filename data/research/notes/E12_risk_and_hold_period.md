# E12 — Risk structure and hold-period economics of the reversal picks

**Question.** For the strategy's picks (dev12 bottom decile, $50–$500, sets ≥ 24 months): (a) how much of a pick's
return is the market month vs the card — i.e. how correlated are picks, and how much does diversification buy?
(b) Which hold compounds capital fastest at each discount: 1, 2, 3 or 6 months?

**Method.** `scripts/e12_risk_hold.py`. Net returns bought 20 % under. (a) Variance of pick returns split into the
month mean (market) and the residual; random equal-weight baskets of n = 1 … 40 picks per month (50 draws each).
(b) Mean net by hold × discount × regime / gate, converted to a per-month rate (1 + net)^(1/h) − 1; share of months
with a negative pick-average ("losing month"); worst month.
Outputs `results/E12_variance_decomp.csv`, `E12_diversification.csv`, `E12_hold_economics.csv`.

**Results.**

(a) **Picks are almost uncorrelated with each other.** The market month explains only **3 % (1-mo) / 6 % (3-mo)** of the
variance of pick returns; the implied pairwise correlation between two picks in the same month is 0.03–0.06. Residual
std of a single pick: 33 % (1-mo), 44 % (3-mo). Diversification therefore works unusually well:

| 3-month hold, 20 % under | 1 card | 2 | 5 | 10 | 20 | 40 |
|---|---|---|---|---|---|---|
| basket std | 49 % | 30 % | 20 % | 16 % | 13 % | 12 % |
| P(basket loses) | 40 % | 30 % | 24 % | 19 % | **15 %** | 10 % |
| 5th percentile | −30 % | −20 % | −11 % | −8 % | −5 % | −5 % |

At 1 month the basket's loss probability floors at ~42 % even with 40 cards, because the mean edge per card (+2.2 %) is
small next to the market component (44 % of months had a negative pick-average at 1 month vs **9 % at 3 months**).
The pick-average's correlation with the regime (`reg3`) is 0.69–0.72 — the residual risk after diversification is the
market, which the gate controls.

(b) **Per-month return on capital by hold** (dev12 bottom decile; "gated" = trailing 3-month market move > 0):

| discount | gate | 1 mo | 2 mo | 3 mo | 6 mo | losing months at 3 mo |
|---|---|---|---|---|---|---|
| 0 % | gated | −14.7 % | −4.2 % | −0.8 % | +2.2 % | 59 % |
| 10 % | gated | −5.2 % | +1.0 % | +2.7 % | +4.0 % | 14 % |
| 15 % | gated | +0.3 % | +4.0 % | **+4.7 %** | +5.0 % | **0 %** (worst +2 %) |
| 20 % | gated | +6.6 % | **+7.2 %** | **+6.9 %** | +6.1 % | **0 %** (worst +9 %) |
| 20 % | ungated (all months) | +2.3 % | +4.0 % | +4.1 % | +3.6 % | 9 % |
| 20 % | falling markets only | −1.8 % | +1.0 % | +1.7 % | +2.0 % | 19 % |
| 20 % | strong markets only | +8.5 % | +8.3 % | +7.8 % | +6.7 % | 0 % |

**Interpretation.**
* **Hold 3 months, 20+ cards.** Three months is where the reversal has paid enough to clear fees reliably: the share of
  losing months drops from 44 % (1-mo) to 9 % (3-mo) ungated and to 0 % gated at ≥ 15 % under; the per-month rate at 20 %
  under is as good as the 1-month hold's (6.9 % vs 6.6 %) with a fraction of the loss risk. Two months is the sweet spot
  on paper (7.2 %/mo, 0 losing months) — a 2-month hold is worth offering in the tab.
* Six months compounds slower per month at ≥ 15 % under (the reversal flattens after month 3) but is the best hold when
  the buy is near the standard price (0–10 % under); it is the hold for "I could not find a discount".
* Because picks are nearly independent, **the number of cards matters more than which cards**: going from 5 to 20
  picks halves the basket's loss probability and the 5th percentile. With $5,000 and a 20 %-per-card cap that means
  ≥ 20 positions of ~$250 or less — the $50–$250 part of the band, not $500 cards.
* The residual risk is the market; the gate is what removes it. 1-month holds at 15 % under are break-even even gated —
  there is no 1-month business below a 20 % discount (consistent with E10).

**Verdict.** *Worked*: the hold-period table (2–3 months optimal at ≥ 15 % under; 6 months only for near-standard buys)
and the diversification curve (≥ 20 cards) are directly usable in the Forecast tab's plan construction.
