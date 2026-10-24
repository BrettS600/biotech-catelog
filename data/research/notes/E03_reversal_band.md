# E03 — Is the reversal real, and what does it pay inside the $50–$500 band?

**Question.** (a) Repeat the E02 tables inside the band Brett actually buys in ($50–$500). (b) Is the reversal just
PriceCharting's price estimator bouncing (a dip made of two cheap sales), or a real price move? (c) How does it
behave by market regime?

**Method.** `scripts/e03_reversal.py`. Decile tables with pmin 50, pmax 500. Realness test: the bottom decile of
dev12 (price furthest below its 12-month mean) split by this month's sales count (2–4, 5–9, 10–24, 25+): if the
reversal were estimator noise it would be strongest in the 2–4-sales group and vanish for liquid cards. Regime split
on `reg3`.

**Results** (`results/E03_band_signals.csv`, `E03_reversal_by_sales.csv`, `E03_reversal_by_regime.csv`).

Band, 3-month hold, bottom decile (gross / net / P(net>0)) vs universe gross +3.3 %:
dev12 **+10.5 % / −10.4 % / 26 %**; mom12 +9.4 % / −11.5 % / 24 %; mom12x1 +8.9 %; hi12 (closest to the 12-month
high is the *top*; the bottom = deepest below the high) +7.0 % / −13.3 % / 24 %; dev6 +6.9 %. Top deciles −1.7 to −5.4 %.
Set momentum top decile: +4.6 % (hit 55 %, t +2.2).
Band, 6-month hold, bottom decile dev12: +20.4 % / −1.9 % / 39 %; mom12 +18.7 % / −3.5 % / 36 %.

Realness (dev12 bottom decile, band, 3-month gross): sales 2–4 **+14.2 %**, 5–9 +13.3 %, 10–24 **+14.1 %**,
25+ +9.5 % (fewer months — the 25+ group only exists in 2025–26 where the universe itself did +10 %). The reversal is
as strong for cards with 10–24 monthly sales as for thin ones → **it is a real price move, not (only) estimator noise.**
The 25+ group's weaker edge says very liquid cards revert less (their prices are better discovered).

Regime (dev12, band; regime = trailing 3-month market move, see README): 3-month bottom decile gross **+23.9 % in
strong regimes** (net +1.1 %, P(net>0) 40 %), +15.0 % in flat (net −6.6 %, 29 %), +4.4 % in falling (net −15.7 %, 18 %);
6-month strong +44 % (**net +18 %, P(net>0) 62 %**), flat +28 % (net +4.5 %), falling +14.7 % (net −6.8 %). The top
decile in a strong regime makes only +9 % at 3 months; in a falling regime it loses 12 %.

**Interpretation.**
* The best *standard-price* 3-month selection found (deep-reversal cards in a strong regime) averages +24 % gross —
  about the fee wall at $100 (22 %). So the strategy "buy fallen cards in a rising market, hold 3 months" is
  break-even at the standard price, strongly positive at 6 months, and strongly positive at 3 months **if the buy
  is 10–20 % under the standard price** (at 20 % under, a +24 % gross move nets ≈ +27 % at $100).
* Discount is the lever: with buy = (1−d)·standard, net = ((1+g)·0.8589 − 5.20/P)/(1−d) − 1. Breakeven d at g = 0,
  P = $100 is 19.7 %; at g = +10 % it is 8.7 %; at g = +21 % it is −0.9 % (none needed).
* Regime dependence is strong: the same signal makes 5× more in a strong regime than a falling one. The regime is
  known at decision time (E04 shows it persists), so the rule "only buy when the market's trailing move is positive"
  is implementable. (Regime months: 22 falling, 18–19 flat, 11–12 strong in 2022-01 … 2026-09.)

**Caveats.** Overlapping 3- and 6-month windows inflate t-stats; the strong-regime sample is 11–12 months, all in
2025–26. **Correction (same day):** the first run of this experiment computed the regime from cards priced $10+ in the
*current* month, which drops the cards that fell below $10 and biased the regime up (2022 showed as flat-positive);
the regime now uses last month's price, and every regime-split table in E03/E05/E08/E09/E10 was rerun. The
un-split results were unaffected. The sell price is PriceCharting's level h months later; E07 measures how eBay's actual prices
sit relative to it.

**Verdict.** *Worked*: deep reversal (dev12 / mom12 bottom decile) is real and large at 3–6 months, especially in a
strong regime. *Not enough alone*: at the standard price it only breaks even at 3 months. **Build it as: reversal
rank × regime gate × discount under the standard price.**
