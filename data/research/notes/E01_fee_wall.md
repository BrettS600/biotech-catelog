# E01 — The fee wall: base rates of a buy-and-hold at the standard price

**Question.** With no selection at all, what does holding a card 1 / 2 / 3 / 6 months return, gross and net of eBay
fees, by price tier and year? This is the bar every strategy has to beat.

**Method.** `scripts/e01_fee_wall.py`. Every card-month 2021-06 … 2026-09 with price ≥ $10 and ≥ 2 sales; buy at
`buy_real`, sell at PriceCharting's price h months on; tiers by price at t. Equal-weight months.

**Result** (`results/E01_base_rates.csv`, ALL years):

| hold | tier | gross mean | net mean | P(gross>0) | P(net>0) |
|---|---|---|---|---|---|
| 1 mo | $10–25 | −2.4 % | −51 % | 40 % | **0.9 %** |
| 1 mo | $50–100 | −2.0 % | −23 % | 40 % | 5.9 % |
| 1 mo | $100–250 | −2.0 % | −19 % | 40 % | 8.7 % |
| 1 mo | $250–1000 | −2.6 % | −18 % | 37 % | 9.6 % |
| 3 mo | $50–100 | +1.6 % | −20 % | 46 % | 14.6 % |
| 3 mo | $100–250 | +1.3 % | −17 % | 47 % | 18.0 % |
| 3 mo | $250–1000 | 0.0 % | −16 % | 44 % | 18.7 % |
| 6 mo | $100–250 | +6.4 % | −12 % | 52 % | 27.4 % |
| 6 mo | $1000+ | +41 % | +21 % | 83 % | 70 % (153 obs, 2025–26 only) |

The 1-month gross mean is *negative* even though the market rose over 2021–2026, because `buy_real` sits above the
current print whenever the card dipped (the standard price is a conservative buy, by design).

**Interpretation.**
* Fees, not forecasting, are the first-order problem for 1–3-month holds. At $100 a card must rise 22 % in a month to
  break even; the universe's median 1-month move is −2 to +6 % depending on the regime. No base rate comes close.
* The fixed $5.20 makes anything under ~$40 structurally unsellable at a 1–3-month hold (P(net>0) ≈ 1–3 %).
* The one tier that pays by itself is $1000+ at 6 months — tiny sample, all 2025–26 boom; not a strategy for $2–10k.
* `results/E01_market_monthly.csv` is the market-wide monthly series (median move, breadth, total sales, dollar
  volume) used by the regime work (E04). Total PriceCharting-tracked dollar volume ran $7–12M/month in late 2025 and
  $17–23M/month in 2026 — the market roughly doubled in a year.

**Verdict.** Baseline established. **Any 1–3-month strategy at the standard price starts from P(net>0) ≈ 6–18 %.**
To matter, a strategy must either (a) find ≥ +20 % gross moves with real reliability, (b) buy well under the
standard price, or (c) change the fee structure. E02–E07 test (a) and measure (b); E08 quantifies (c).
