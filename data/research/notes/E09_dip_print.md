# E09 — Buying the dip at the dipped print

**Question.** The standard price refuses to buy below the 3-month mean, which is why 1-month reversal looked worthless
in E02 (both extremes lose). If a card's PriceCharting price fell this month on many sales, copies really changed hands
at the lower level and the collector sees asks there. What does the reversal pay when the buy is this month's print
(`price_t`), and the honest middle (half-way between print and standard)?

**Method.** `scripts/e09_dip_print.py`. Band $50–$500; quintiles of dev3 / dev12 / mom1 each month; sales 2–9 vs 10+;
buy at standard / print / half; sell at PriceCharting h months on; by regime.

**Results** (`results/E09_dip_print.csv`). Bottom quintile, ALL regimes, gross / net / P(net>0):

| signal, sales | buy at | 1 month | 3 months |
|---|---|---|---|
| dev12, 10+ | standard | +1.1 % / −18.5 % / 10 % | +9.0 % / −11.7 % / 24 % |
| dev12, 10+ | **print** (8 % under standard) | **+10.3 % / −11.1 % / 21 %** | **+19.0 % / −3.6 % / 37 %** |
| dev3, 10+ | standard | −3.8 % / −22.6 % / 7 % | +1.9 % / −17.6 % / 17 % |
| dev3, 10+ | print (12 % under) | +9.3 % / −12.0 % / 20 % | +15.9 % / −6.3 % / 34 % |
| mom1, 10+ | print (10 % under) | +8.5 % / −12.6 % / 19 % | +14.5 % / −7.5 % / 32 % |

Strong regime, 3 months, dev12 bottom at the print: sales 10+ **+23.4 % gross, net +0.4 %, P(net>0) 43 %**; sales 2–9
+32.4 %, net +7.9 %, 47 %. 1 month strong, print: +11.3 % gross, net −10.0 %, 22 %.

**Interpretation.**
* Bought at the print, the 1-month reversal is real and large: **+9–10 % gross in one month** for the quintile that just
  fell furthest — and it is as strong for cards with 10+ monthly sales as for thin ones, so it is not estimator noise.
  It still loses net (−11 %) because the fee wall at 1 month is 22–28 %.
* The print is on average only 8–12 % below the standard price; the backtest "20 % under" scenario is a deeper buy than
  the dip itself. The dip is where the discount comes from, though: a card that just fell is where cheap asks exist.
* At 3 months in a strong regime the print-bought reversal breaks even at the standard fee structure and is positive
  with any further discount or fee saving (E08).

**Verdict.** *Worked*: the dip is tradeable and the 1-month reversal exists once the buy is realistic; fee wall still
wins at 1 month. **Design implication**: the Forecast tab should treat the current print (when it rests on ≥ 10 sales)
as a legitimate buy level rather than always lifting to the 3-month mean, and show the chance at that level.
