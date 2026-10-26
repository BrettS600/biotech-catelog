# E27 / E27b–e / E32 — the PSA 10 / raw ratio: the strongest short-horizon signal found (one month of data)

Written 2026-10-26 (round 2). Data: `pricecharting/daily/` (every column of PriceCharting's daily download,
2026-09-28 … 10-26, loaded with `scripts/daily_panel.py`), the monthly panel, `ebay/daily_rollup.csv.gz`.
Scripts: `e27_daily_graded_raw.py`, `e27b_ratio_vs_dev12.py`, `e27c_ratio_windows.py`, `e27d_ratio_on_ebay.py`,
`e27e_ratio_x_dev12.py`, `e32_daily_weekly_signals.py`.

**The idea.** A raw card is the raw material for a PSA 10. When the PSA 10 price is very high relative to the raw price,
people who grade buy raw copies; raw should drift up. ratio = PSA 10 price (`manual-only-price`) / ungraded price
(`loose-price`) on the same day.

## E27 — what the daily download contains

* **Dealer prices carry no information.** `retail-loose-sell` = 1.10 × the ungraded price for every card;
  `retail-loose-buy` = 22% (< $10), 28% ($10–25), 44% ($25–100), 55% ($100–500), 66% ($500+) of it, and is missing for
  most cards under $10. (Used in E30 as channel arithmetic.)
* **Graded prices moved a lot in October 2026.** Over 28 days, raw $50–500 cards: raw median +0–1% (mean +5–8%); PSA 10
  median +0.6–3% but mean +41–50% (a heavy right tail: PriceCharting re-priced many graded cards up); grade 9 median
  +14–20%. PriceCharting changes a card's graded figures on 2–4 days of 28, its raw figure on 5–6. **CGC 10 had a one-day
  re-basing on 2026-10-22** (36% of cards changed, mean −13%) — treat CGC 10 before/after that day as different series.
* **The ratio predicts the next 28 days of raw price** (one cross-section, cards $10+): Spearman 0.25; quintiles of the
  ratio −0.6% / +4.2% / +6.4% / +8.9% / +13.5% mean (median −0.2 / 0 / +1.9 / +5.0 / +8.5%). In the $50–500 band:
  −1.2% / +7.7% / +9.5% / +11.9% / +13.7%. It does not predict the PSA 10 price itself (IC 0.10–0.14, hump-shaped).

## E27b — not the reversal in disguise

Rank regression of the 28-day raw change ($10+, 8,602 cards): ratio alone +15.4 pts from lowest to highest rank (t 21);
with dev12 +15.8 (t 22); with dev12, mom1, log price and September sales +17.0 (t 24). Band: +18.8 (t 13).
Spearman(ratio, dev12) = 0.11. It is a different source of return.

## E27c — every week, every set age

| week from | IC ($10+) | top quintile | bottom quintile | ratio slope (t) given last week's raw and PSA 10 moves |
|---|---|---|---|---|
| 09-28 | 0.07 | +1.9% | −0.7% | (no prior week) |
| 10-05 | 0.16 | +4.8% | −0.5% | +5.9 pts (14.3) |
| 10-12 | 0.11 | +4.3% | +0.1% | +5.5 pts (12.4) |
| 10-19 | 0.13 | +3.5% | −0.5% | +4.8 pts (12.2) |

Last week's raw move reverses (t −9 … −13, the weekly reversal E13 saw on eBay); last week's PSA 10 move adds nothing to
next week's raw. By set age the ratio works in sets < 4 years (weakest), 4–15 and 15+ years.

## E27d — confirmed on eBay's own sold prices

340 cards the collector follows with ≥ 2 comparable sales in both 09-28…10-08 and 10-13…10-23: Spearman between the ratio
(09-28) and the change in the median sold total = **0.37**. Terciles: low ratio (median 2.8×) −3.6% mean / −4.8%
median; mid (6.2×) 0.0% / −2.0%; **high (43×) +20.1% / +11.2%**. Rank regression slope +0.37 (t 8.8) holding the
early eBay price relative to PriceCharting fixed. So this is not PriceCharting re-pricing its own estimates: real
transaction prices moved.

## E27e — stacking with the reversal (the October window, band $50–500)

| ratio quintile × position vs 12-month mean | cards | mean 28-day change | P(net > 0) at PC price | at 15% under | at 20% under |
|---|---|---|---|---|---|
| Q5 (high) × below mean | 154 | +21.4% | 34% | 66% | 75% |
| Q4 × below mean | 116 | +30.7% | 29% | 56% | 73% |
| Q5 × above mean | 165 | +8.9% | 22% | 47% | 59% |
| Q1 (low) × below mean | 281 | −0.6% | 4% | 15% | 50% |

By quintile at 20% under: 52% / 62% / 67% / 72% / 69%.

## E32 — weekly dynamics in the daily download

PSA 10 prices reverse week to week (−0.06) and follow last week's raw move (+0.07, t 2.5–4.2); raw reverses week to week
(−0.044, t −9 … −13) and follows the ratio (+0.054, t 13–15); the change in PriceCharting's trailing-year sales count
(new sales recorded) predicts nothing (−0.004).

## How much to trust it

Strong in every week, every set age, robust to controls, and visible on eBay transactions — but it is **one month**, and
that month is the steepest graded rally in the sample (Top 250 Graded +33%). The mechanism (grading demand pulling raw up)
should weaken or reverse when graded prices fall. Before it drives money: re-run E27–E27e monthly as the daily archive
grows (backlog B16); test it in the first month the graded index falls. Until then use it as a **tie-break / tilt inside
the reversal ranking**, not as a standalone buy signal, and show it on the card.

## Later work
- (empty)
