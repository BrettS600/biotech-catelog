# FINDINGS — what three hours of research say to build into the Forecast tab

Written 2026-10-24 from experiments E01–E25 (`experiments.csv`; detail in `notes/`). Goal as Brett set it: $2,000–10,000
of capital, holds of 1–3 months preferred, profit reinvested, maximise return without taking on much risk. Nothing here
has been applied to the site yet.

## The seven facts

1. **Fees, not forecasting, are the first-order problem.** eBay's round trip (13.25 % × 1.065 + $5.20) needs a +22 % move
   on a $100 card to break even (+28 % at $50). No selection found in 2.3 million card-months clears that at the
   standard price within 1–3 months: base-rate P(net>0) is 6–18 %, and the best 3-month pick averages +24 % gross only in
   a strong market. (E01, E02, E03)

2. **The only large, robust card-level signal is mean reversion toward the card's own 6–12-month level.** The decile
   furthest below its 12-month mean (`dev12`) returns +10.5 % in 3 months vs +3.7 % for the band, +20 % at 6 months vs
   +11 %, and +24 % in strong markets. It is as strong for cards with 10–24 monthly sales as for thin ones, so it is a
   real price move. Past winners lose at every horizon; volume, volatility and acceleration are not buy signals.
   Set-level "momentum" turned out to be an artifact of PriceCharting's monthly averaging (E11) — do not use it. A
   30-feature gradient-boosted model ranks well (IC 0.26–0.27) but does **not** beat the single reversal decile at
   3 months. The decile's excess over the band is +6 to +10 points per quarter in *every* year 2022–2026, beating the
   band in 53 of 55 months (E18). Fama-MacBeth regressions (the stock-market standard) show the effect survives every
   control — 12-1 momentum, 12-month-high distance, volatility, price, liquidity, set age, market beta — and that the
   reversal portfolio's excess is **alpha, not beta** (+7 % per quarter over the band, t 12, with a *negative* beta of
   −0.2 to the market and a wider spread in down months). Cards show the equity "anomalies" (low-beta, low-volatility,
   short-term reversal, 52-week-high) only as faces of this one factor, and have no 12-1 momentum premium (E21).
   (E02, E03, E06, E11, E18, E21)

3. **The market regime is known and persistent.** When the trailing 3-month market median move is positive, the next
   quarter is up 95 % of the time (+6.9 %); when it is negative, 12 % (−2.5 %). Sign accuracy 91 % over 55 months. In a
   falling market a card that dropped last month tends to keep falling for another month even after its reversal rank is
   accounted for (E21) — one more reason the gate, not the ranking, decides whether to buy at all. Google
   web-search interest (1-month change) improves the level forecast (OOS R² 0.60 → 0.66) but not the sign; PokéViews'
   breadth gauges describe the same state and add nothing yet. (E04, E15)

4. **The discount under the standard price is the business; the reversal rule is the edge on top; the regime gate is
   the insurance.** Each point of buy discount is worth ~1.3 points of net. At 20 % under, random cards return ~20 %/yr
   and reversal picks 31–39 %/yr in the back-test (3-month hold, realistic availability, $5,000); at 15 % under random
   loses and reversal still makes +22 %/yr (+20 % gated); at 10 % under only the gated 3-month version is clearly
   positive (+16 %). Gating removed essentially every losing cycle in-sample (the whole 2022 loss) while keeping ~90 % of
   final wealth. (E08, E10, E15)

5. **Hold 2–4 months with ≥ 20 cards; 3 by default.** The reversal's excess over the band is built in months 1–6 and
   the per-month rate peaks at 2–4 months (E17). Picks are almost uncorrelated (market explains 3–6 % of pick variance), so 20
   positions cut the basket's loss probability from 40 % to 15 % at 3 months. Per month of capital, gated: 20 % under →
   6.6 % (1 mo), 7.2 % (2 mo), 6.9 % (3 mo), 6.1 % (6 mo) with zero losing months at 2–3 months; 15 % under → 0.3 / 4.0 /
   4.7 / 5.0 %. A 1-month hold needs the full 20 % and still has a 42 % chance of a losing month whatever the
   diversification. Six months is the hold when the buy is near the standard price. (E12) Stop-losses hurt a reversal
   trade (E23). A take-profit listing at the card's 12-month mean looked like a large improvement (E23/E24: 47 %/yr vs
   29 %) and was **withdrawn the same day**: the back-test sold at the exit month's average price, the very number that
   had triggered the exit; paid at the listing price the rule is break-even and compounds at 6 %/yr (E25). The exit
   stays "sell at market after 2–4 months, 3 by default". Lesson for every future rule: never condition on and transact
   at the same PriceCharting monthly average. (E23, E24, E25)

6. **Execution is worth more than any model refinement.** Right now ~12 % of band cards have a credible floor ≥ 20 %
   under the sold median (25 % at ≥ 15 %, 40 % at ≥ 10 %); 5.6 % of all sales print ≥ 20 % below the week's median and
   20 % print ≥ 10 % below; a patient seller at the 80th percentile gets +9–11 %. Deep floors carry mild bad news (the
   median drifts −4 % in two weeks) — tolerable at 20 % under, not at 10 %. eBay's sold median equals PriceCharting's
   price for $50+ cards, so the back-tests' sell level is fair. Passing shipping to the buyer is worth ~5 points of net;
   a Store subscription ~1 point. (E07, E08, E13)

7. **Capital dilutes selection.** With $5,000 and today's discount availability the pure bottom decile deploys only
   ~15 % of the money; the simulated 31 %/yr comes from going down the whole dev12 ranking (~60 positions reaching the
   bottom half). More capital reaches further down. Rank the whole band, take what the discounts allow, and show how
   deep the plan goes. (E17)

## What to build (priority order)

1. **Gate.** Show the regime plainly (trailing 1- and 3-month market median move, both > 0 = green; the two-signal
   rule had no losing cycle in-sample, E17) and default the tab to *no buys* when it is red. Add Google web-search 1-month change and PokéViews' HCI / % above 30-day as
   confirming displays, not as the decision. (E04, E15)
2. **Rank by reversal, not by the GBM's mean prediction.** Primary score = rank of `dev12` (price vs its own 12-month
   mean; `mom12` as a tie-break); drop set momentum from the features; keep the GBM only as a secondary filter or
   replace it with the calibrated "chance at the entered discount" classifier (G_cls20, E06b), which is the one model
   output whose probabilities can be shown. (E02, E03, E06, E11)
3. **Make the discount the centre of the plan.** Default the discount input to the collector's observed floor for each
   card (L vs A) rather than 0; show the breakeven discount per card ((buy + 5.20)/0.8589 ÷ expected sell); only
   recommend a copy when the floor clears the chance bar at the chosen hold. Treat the current month's print as a valid
   buy level when it rests on ≥ 10 sales (E09). (E07, E08, E09)
4. **Plan construction.** Default hold 3 months, sold at market (offer 2 and 4); no stop-loss and no fixed-price
   take-profit listing (E23–E25); show the card's 12-month mean only as the level the reversal is expected to return to. One copy per card and the whole $50–$500 band (the
   simulation says narrowing to $50–250 or $100–250 costs 6–10 CAGR points through under-deployment, and the per-card
   cap barely matters once it is one copy per card — keep 20 %, never below 10 %); sets ≥ 24 months; 6-month hold
   offered as the fallback when few discounted floors exist. (E05, E12, E16, E19)
5. **Chance and range.** Replace standard-price probabilities with the empirical chance table keyed by regime × hold ×
   discount × dev12 rank bucket (`results/E20_chance_table.csv`; out-of-sample error ~5 points) — or the calibrated
   per-discount classifier (E06b) — and show the table's 10th–90th percentile net as the range; show per-cycle loss
   risk for the basket size chosen (E12 curve).
6. **Fees.** Add the Store rate and buyer-pays-shipping as plan options so the user sees their value (E08).
7. **Keep learning.** The rollup and daily catalog snapshots are the data that will settle the open questions
   (`ideas_backlog.csv` B01–B04, B13): rerun `e13` and `e07` monthly; re-test the PV250 gate after a down-cycle.

## What was tried and did not work (so nobody tries it again without new data)

* Card-level momentum at any horizon (1, 3, 6, 12 months) as a buy signal — it is a sell signal. (E02, E03)
* Set-level momentum from PriceCharting monthly data — averaging artifact; from PokéViews daily data — zero. (E11)
* Volume growth, volume z-score, dollar volume, volatility, acceleration, 52-week-high proximity as buy signals. (E02)
* Exogenous market features (Trends, breadth, calendar) inside the card ranking. (E06)
* A classifier for "net > 0 at the standard price" — too few positives, badly over-confident. (E06b)
* "Strong market only" (> 2 %/mo) gate — throws away half the good months. (E15)
* Google-Trends-augmented gate — no better than the market's own sign. (E15)
* Sales ≥ 5 / no-Promo filters on the reversal picks — fine as warnings, no portfolio gain. (E16, E18)
* Calendar seasonality as a driver — real but ±1 %/month. (E05)
* Any 1-month strategy at less than 20 % under the standard price. (E10, E12)
* Fractional deployment by regime strength, and gates tighter than 0. (E17)
* dev6 (6-month reversal) as the ranking signal — weaker than dev12 in every year. (E18)
* Adding momentum, 12-month-high distance, volatility, beta or liquidity to the ranking — all subsumed by dev12 in the
  multivariate Fama-MacBeth regression. (E21)
* S&P 500, gold or Bitcoin as leading indicators of the card market — no lead on 30 months; adding them lowers the
  out-of-sample fit. (E22)
* Narrow price bands ($50–250, $100–250) and per-card caps under 10 % — under-deployment costs more than they save. (E19)
* Stop-losses (sell the month-1 losers) — they lock in the dip the trade is betting against; lower net, chance and rate.
  (E23)
* A take-profit listing at the card's 12-month mean — the apparent +18 CAGR points were an averaging artifact (the
  back-test sold at the month-average that triggered the exit); paid at the listing price it is break-even. (E23–E25)

## The honest caveats

The profitable back-tests get their profit from 2024–2026, a historic boom; in 2022 even 20 %-under reversal buys lost
11 %/yr at 3 months. The gate is what sits out such years, and it has been tested on one down-cycle. Discount
availability is measured from one snapshot and assumed independent of the regime (floors may dry up in booms). Sell
prices are PriceCharting monthly levels with no time-to-sell, condition, returns, or unsold inventory; any rule that
conditions on a monthly average and transacts at it overstates what a trader gets (E11, E25). Overlapping
3-month windows inflate every t-statistic. The simulations' realistic-availability runs are averaged over five random
draws and still vary ±20–30 % in final wealth. Treat the CAGR figures as the shape of the opportunity, not a promise: the
robust claims are the ordering (discount > gate > reversal rank > everything else) and the risk structure (3 months,
20 cards, gate).
