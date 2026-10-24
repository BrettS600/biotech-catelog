# E07 — eBay microstructure: how much of the fee wall can execution recover?

**Question.** Every PriceCharting backtest buys at the standard price and sells at PriceCharting's level. On eBay a
buyer can take the cheapest credible listing and a seller can list above the median and wait. How big are those two
edges, how often are they available, and how does eBay's sold median sit relative to PriceCharting?

**Method.** `scripts/e07_ebay_micro.py` on the eBay Catalog snapshot `data/ebay/catalog/2026-10-23.csv.gz` (6,453
cards; 2,456 with a sold median A from ≥ 3 sales; 3,790 with a credible floor L) and the daily rollup
`data/ebay/daily_rollup.csv.gz` (2026-09-28 … 10-23: 14,405 individual sale prices on 488 cards ≥ $25 compared with
each card's 7-day median that day).

**Results** (`results/E07_floor_discount.csv`, `E07_sale_dispersion.csv`, `E07_A_vs_pc.csv`).

Floor discount 1 − L/A (cheapest credible ask vs sold median), cards with A_n ≥ 3:
$25–50 median 8.1 % (≥10 % off: 42 % of cards, ≥15 %: 29 %, **≥20 %: 13 %**); $50–100 7.0 % (42 / 24 / 13 %);
$100–250 5.1 % (39 / 25 / 11 %); $250–1000 5.6 % (29 / 17 / 7 %).
Patient-sell premium s80/smed − 1: median **+9 to +11 %** by tier (75th pct +16 to +22 %).
Liquidity: median expected days to sell 3.5–5.5; median 30-day sales 35–57 per card in these tiers.

Individual sales vs the card's 7-day median (all tiers ≥ $25): p10 **−15.5 %**, p25 −8.0 %, p75 +5.8 %, p90 **+16.2 %**.
Share of sales printed ≥10 % below the median 19.6 %, ≥15 % below 10.6 %, ≥20 % below **5.6 %**, ≥30 % below 2.2 %;
≥10 % above 16.8 %, ≥15 % above 10.9 %, ≥25 % above 5.6 %. Dispersion is slightly wider for $250–1000 cards.

eBay sold median vs PriceCharting (A/pc): $50–100 median 1.03, $100–250 1.01, $250–1000 0.98 — **the two levels agree
for $50+ cards** (the backtests' sell price is fair). $25–50: 1.14 and $10–25: 1.97 — PriceCharting runs well below
eBay's medians for cheap cards (its cheap-card prices look like they include damaged / bulk sales).

**Interpretation.**
* Within a single week, ~20 % of sales happen ≥10 % under the going median and ~5–6 % happen ≥20 % under. A buyer who
  waits and watches many cards gets the discount the whole strategy depends on — but only on a minority of cards at any
  moment (≈ 12 % of cards have a credible 20 %-under floor right now; ≈ 25 % a 15 %-under one). This is the
  availability used in E10's realistic simulations.
* The seller's side is symmetric: listing at the 80th percentile is +9–11 % over the median. Combined, patient
  execution on both legs is worth ~20–25 % — larger than any predictive signal found in E02–E06, and it is why the
  "20 % under" Forecast-history scenario is profitable where the standard-price one is not.
* Cheap cards' floors are deeper but the fixed $5.20 eats them; the useful band is $50–$250 where floors of 10–15 % are
  common and the fee wall is 20–28 %.

**Caveats.** One snapshot (2026-10-23) and 26 days of rollup, in a strong market; floor listings can be cheap for a
reason (condition, misdescription, scams) that the collector's credibility checks only partly catch; s80 sales take
longer than median sales (not measured here — the collector's `edays` is per card, not per price level).

**Verdict.** *Worked*: quantified the execution edge — buy-side 10–20 % on 12–40 % of cards, sell-side +9–11 % —
and confirmed PriceCharting ≈ eBay median for $50+ cards. *Open*: time-to-sell at above-median asks; whether deep floors
are adversely selected (needs the rollup to accumulate, then track floor buys to their sale).
