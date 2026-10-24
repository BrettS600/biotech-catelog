# E23 — Exit rules: fixed hold vs "sell when the card is back at its 12-month mean" vs stop-loss

**Question.** Every back-test so far sells at a fixed month. Traders use take-profit targets and stop-losses. For a
mean-reversion trade the natural target is the anchor itself — the card's own 12-month mean price at the time of the
buy. Does "list at the anchor and sell when it prints" beat a fixed 3-month hold on net, chance and, above all, on
*net per month of capital*? Does a stop-loss help or hurt? (Brett prefers 1–3-month holds.)

**Method.** `scripts/e23_exit_rules.py`. dev12 bottom decile of the band ($50–$500, sales ≥ 2, sets ≥ 24 months),
decision months 2022-01 … 2026-03 (so every rule has 6 months of forward prices), 3,217 picks (1,750 in up months,
1,467 in down), bought 15 % or 20 % under `buy_real`, sold at the PriceCharting price of the exit month, net of fees.
Rules: fixed 1 / 2 / 3 / 6; `target_k` = sell in the first month the price is ≥ k × the 12-month mean (k = 0.90, 1.00,
1.10), else at month 6 (`_max3`: else at month 3); `stop_s` = sell at month 1 if the price fell a further s (10 %,
15 %), else hold to 3; target + stop combined. Monthly data, so the check happens once a month and the sale happens at
that month's average price — the same convention as every other experiment. Output `results/E23_exit_rules.csv`.

**Results** (20 % under; mean net / P(net>0) / 10th pct / mean months held / **net per month of capital**):

| rule | all picks | up regime | down regime |
|---|---|---|---|
| fixed 1 | +2.9 % / 52 % / −21 % / 1.0 / 2.9 %/mo | +6.2 % / 57 % / 1.0 / 6.2 %/mo | −1.0 % / 45 % / −1.0 %/mo |
| fixed 2 | +9.6 % / 60 % / −19 % / 2.0 / 4.8 %/mo | +14.5 % / 68 % / 2.0 / 7.2 %/mo | +3.8 % / 52 % / 1.9 %/mo |
| **fixed 3** (the default so far) | +15.2 % / 66 % / −18 % / 3.0 / 5.1 %/mo | +22.2 % / 75 % / −12.9 % / 3.0 / 7.4 %/mo | +7.0 % / 55 % / 2.3 %/mo |
| fixed 6 | +29.8 % / 75 % / −14 % / 6.0 / 5.0 %/mo | +43.1 % / 85 % / 6.0 / 7.2 %/mo | +14.0 % / 63 % / 2.3 %/mo |
| target 0.90 × mean | +12.9 % / 72 % / −13 % / 2.3 / 5.5 %/mo | +13.6 % / 72 % / **1.6** / 8.5 %/mo | +12.2 % / 71 % / 3.8 %/mo |
| **target 1.00 × mean** | **+18.1 % / 78 % / −11 % / 3.2 / 5.7 %/mo** | **+20.2 % / 84.5 % / −3.7 % / 2.3 / 8.7 %/mo** | +15.6 % / 70 % / 4.2 / 3.7 %/mo |
| target 1.10 × mean | +23.0 % / 78 % / −12 % / 4.0 / 5.8 %/mo | +28.1 % / 88 % / −2.3 % / 3.2 / 8.9 %/mo | +17.0 % / 67 % / 5.0 / 3.4 %/mo |
| target 1.00, max 3 months | +12.4 % / 69 % / 2.2 / 5.7 %/mo | +15.6 % / 77 % / 1.8 / 8.6 %/mo | +8.6 % / 60 % / 3.3 %/mo |
| stop 10 % at month 1, else 3 | +13.0 % / 62 % / 2.8 / 4.6 %/mo | +20.2 % / 72 % / 7.0 %/mo | +4.5 % / 52 % / 1.6 %/mo |
| stop 15 % at month 1, else 3 | +13.9 % / 64 % / 2.9 / 4.8 %/mo | +21.0 % / 73 % / 7.2 %/mo | +5.4 % / 53 % / 1.9 %/mo |
| target 1.00 + stop 15 % | +16.2 % / 75 % / 3.0 / 5.4 %/mo | +18.5 % / 82 % / 2.2 / 8.4 %/mo | +13.5 % / 67 % / 3.5 %/mo |

In up months the anchor is reached within 6 months by **87.5 %** of the picks (95 % reach 0.9 × mean; 77 % reach
1.1 ×), on average in 2.3 months; in down months only 52 % reach it (34 % reach 1.1 ×). At 15 % under the ordering is
identical (fixed 3: +8.5 % / 55 % / 2.8 %/mo; target 1.00: +11.2 % / 66 % / 3.5 %/mo; up regime 5.0 → 5.7 %/mo).

**Interpretation.**
* **Selling at the anchor beats every fixed hold on every metric that matters**: chance 66 → 78 %, the bad tail
  (10th percentile) −18 → −11 %, and the compounding rate 5.1 → 5.7 % per month of capital — in up markets 7.4 → 8.7 %/mo
  with the money back in **2.3 months instead of 3**. The rule is simply: list each copy at its 12-month mean price the
  day it arrives; keep it listed until it sells; if it has not sold by month 6, sell at market. It needs no model.
* A higher target (1.10 ×) earns a little more per month (8.9 %) but ties the money up longer (3.2 months in up markets)
  and is reached less often; 1.00 × is the sweet spot between rate and turnover; a max hold of 3 months leaves money on
  the table (winners are already out by then — the cap only truncates the slow recoverers).
* **Stop-losses hurt.** Selling the month-1 losers locks in the dip that the strategy is betting will reverse: both
  stops lower the mean net, the chance and the rate versus the plain 3-month hold. Combined with the target they shave
  ~0.3 %/mo. A reversal trade should not carry a stop; the regime gate is the risk control.
* The caveat is the data's resolution: "reached the mean in month m" is read off the monthly average price, so a sale at
  the anchor is assumed to clear within that month. With eBay's sold-price dispersion (E07: the 80th percentile of sales
  prints +9–11 % above the median) that is plausible, but the real time-to-sell at a fixed ask is the open question
  B03/B12 — this experiment makes those backlog items high priority.

**Verdict.** *Worked*: a take-profit at the card's 12-month mean (max hold 6 months) is the exit rule — +12 points of
chance and +0.6 %/month of capital over the fixed 3-month hold, with shorter holds in up markets. *Failed*: stop-losses.
Changes FINDINGS item 5 and build item 4.
