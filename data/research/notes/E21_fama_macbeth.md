# E21 — Fama-MacBeth regressions and a CAPM-style test: is the reversal premium alpha or beta?

**Question.** Brett asked for the mathematics people use in the stock market. The workhorse of empirical asset
pricing is the Fama-MacBeth cross-sectional regression: each month, regress next period's return on the cards'
characteristics; average the slopes across months; test the average with a Newey-West t. It answers two things the
decile tables could not: (a) does `dev12` survive *controls* — momentum (12-1), distance from the 12-month high,
volatility, price ("size"), liquidity, set age and the card's **market beta**; (b) is the reversal portfolio's excess
return a reward for market risk (beta) or genuine alpha? Equity markets show well-known "anomalies" — short-term
reversal, 12-1 momentum, low-volatility and low-beta premia, 52-week-high effects — so this also asks which of those
exist in cards.

**Method.** `scripts/e21_fama_macbeth.py`. Band $50–$500, sales ≥ 2, sets ≥ 24 months; forward h = 1, 3, 6 months
(gross, buy at `buy_real`, sell at the PriceCharting price), winsorised at 1/99 % per month. Characteristics rank-
normalised within the month (0 = lowest, 1 = highest, de-meaned), so a slope is the return spread between the lowest-
and highest-ranked card. Beta = 24-month rolling slope of the card's monthly return on the market median move (≥ 12
observations), which makes the sample start in **2022-12** (46 months at h = 1, 44 at h = 3, 41 at h = 6; 22–24 up /
22 down months). Portfolio test: the bottom-minus-top dev12 decile return and the bottom-decile-minus-band return
regressed on the market's h-month move (alpha, beta, HAC t). Outputs `results/E21_fm_univariate.csv`,
`E21_fm_multivariate.csv`, `E21_fm_by_regime.csv`, `E21_capm_portfolio.csv`, `E21_fm_monthly_coefs.csv`.

**Results** (3-month horizon; slope = spread lowest→highest rank, Newey-West t):

| characteristic | univariate | multivariate | reading |
|---|---|---|---|
| **dev12** (vs own 12-mo mean) | **−14.8 pts, t −11.0** | **−14.7 pts, t −9.0** | the whole effect survives every control |
| hi12 (distance from 12-mo high) | −12.5, t −14.0 | −2.7, t −2.0 | mostly the same thing as dev12 |
| mom12x1 (12-1 momentum) | −8.3, t −5.3 | −1.6, t −1.2 | **no momentum premium in cards; the univariate "anti-momentum" is dev12** |
| mom1 (last month) | −6.2, t −8.6 | **+1.7, t +1.6** | short-term reversal disappears given dev12; conditional continuation (see regimes) |
| beta (24-mo market beta) | −4.3, t −3.2 | −1.1, t −1.3 | a low-beta anomaly univariately, explained away by dev12 |
| vol12 (volatility) | −3.4, t −4.0 | −2.1, t −1.8 | low-volatility premium, mostly subsumed |
| lp (log price, "size") | −1.7, t −1.5 | −1.4, t −1.3 | cheaper cards slightly better in up markets (−3.6, t −2.8), nothing in down |
| lv (log sales, liquidity) | −0.3, t −0.1 | +1.1, t +0.3 | in **down** markets liquid cards hold up better (+5.7, t +2.0) |
| age (set age) | −2.7, t −0.8 | −5.3, t −1.6 | older sets better, not significant inside the ≥ 24-month universe |

By regime (multivariate, 3 months): dev12 −17.6 pts in down markets (t −8.9) and −11.8 in up markets (t −6.8) — the
reversal spread is **wider when the market falls**. mom1 is **+3.8 pts (t +5.5) in down markets** and zero in up
markets: given dev12, a card that fell last month in a falling market keeps falling for a while (the knife is still
falling), whereas in a rising market last month's move carries no information. Volatility hurts only in down markets
(−4.2, t −3.2). At 1 and 6 months the pattern is the same; dev12's spread is −6.8 pts at 1 month and −16.4 at 6.

CAPM-style portfolio test:

| portfolio | h | alpha / quarter | t | beta to market | t | months positive | mean in up / down |
|---|---|---|---|---|---|---|---|
| bottom − top dev12 decile | 3 | **+15.2 %** | 9.9 | −0.31 | −1.8 | 98 % (43/44) | +12.3 % / +16.4 % |
| bottom decile − band | 3 | **+7.0 %** | 12.1 | **−0.21** | −3.9 | 98 % | +5.6 % / +7.4 % |
| bottom − top | 1 | +5.9 % | 7.8 | +0.02 | 0.1 | 96 % | +5.6 % / +6.1 % |
| bottom − top | 6 | +22.1 % | 9.4 | −0.22 | −1.2 | 100 % | +18.4 % / +23.0 % |

**Interpretation.**
* The reversal premium is **alpha, not beta**. The reversal picks have *lower* market exposure than the band (beta −0.2
  relative to it) and the long-short spread is uncorrelated or slightly negatively correlated with the market. It is not
  compensation for riding a boom — it was larger in the down months. Together with E18 (positive in every year) this is
  as robust as a 4-year sample allows.
* Cards have the equity anomalies univariately — short-term reversal, low-beta, low-volatility, 52-week-high — but
  they are all **one factor**: distance below the card's own 12-month level. There is **no 12-1 momentum premium** in
  cards (the opposite of equities); the "anti-momentum" is the reversal again. Nothing else needs to go in the ranking.
* Two conditional facts worth a warning label, not a rule: in a falling market a card that dropped last month tends to
  drop further next month (so, in the down regime, the gate already says wait — and if one buys anyway, wait for the
  month after the drop), and thin cards suffer more in down markets. In up markets neither matters.
* Beta estimated from 24 monthly PriceCharting averages is noisy and was never a useful control; the result does not
  depend on it (the sample excluding it, E18, says the same).

**Verdict.** *Worked*: the stock-market machinery confirms dev12 as the single priced characteristic, with a highly
significant alpha and a defensive beta; it rules out momentum, volatility, beta and liquidity as additional ranking
inputs. Nothing new to build beyond FINDINGS item 2; adds the down-market "wait a month after the drop" caution.
