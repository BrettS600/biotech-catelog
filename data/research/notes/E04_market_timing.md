# E04 — Market timing: the regime, PokéViews' indicators, Google Trends

**Question.** The market regime (trailing median move of $10+ cards) is the biggest single predictor of returns
(2026-10-17 research). Can anything forecast the next 1–3 months of the market better than its own trailing move —
PokéViews' Hot & Cold gauge, Market Momentum (% of cards above their 30-day), New Highs/Lows, Trend Extension (distance
from EMA90 / SMA200), RSI, breadth, dollar volume, or Google Trends interest for "pokemon cards"?

**Method.** `scripts/e04_market_timing.py`, `scripts/e04b_incremental.py`. Monthly table (`results/E04_monthly_merged.csv`):
market median move (E01), PokéViews feeds at month-end, Google Trends monthly (level, 1- and 3-month change, 12-month
z-score). Lead/lag Spearman correlations (`E04_leadlag.csv`); regressions of the next-1- and next-3-month market move on
the AR term (last month's move) plus one candidate at a time, Newey-West t, leave-one-year-out R² and sign accuracy
(`E04_incremental.csv`); daily PokéViews indicator quintiles vs the Top 250 index's forward 30/60/90-day return
(`E04_daily_pv250.csv`).

**Results.**
1. **Persistence is extreme.** AR(1) of the monthly median move = 0.79; of the trailing 3-month move = 0.96.
   P(next month's market median > 0 | this month > 0) = **0.89**; P(> 0 | this month ≤ 0) = **0.07**. corr(trail-3,
   forward-3) = 0.79. The sign of last month's market move is the single most useful fact for a 1–3-month hold.
2. **Google Trends adds to the AR term; PokéViews' indicators do not (on their short sample).** Next-3-month market move:
   AR-only in-sample R² 0.64, leave-one-year-out 0.60; adding the **1-month change in web-search interest** → 0.705 /
   **0.664**, HAC t = 8.7 (next-1-month: 0.60 → 0.64 OOS, t 3.9, sign accuracy 0.90 → 0.93). The 3-month change (t 3.3)
   and the raw level (t 1.8–3.0) also help; news-search z-score weakly; image / youtube / shopping add nothing.
   Attention leads price by 1–3 months (PriceCharting's monthly averaging adds lag), which is the mechanism one would expect.
3. **PokéViews indicators** (29–31 monthly observations only): pct_above_30d, hi−lo and MMS have HAC t ≈ 3–3.7 for the
   next month, but their leave-one-year-out R² (0.41–0.44) is *below* the AR-only fit on the same short sample and they
   are contemporaneous breadth measures of the same market, not leading indicators. HCI gauge, RSI, EMA90 distance: no
   incremental value. Treat as "consistent with the regime, not additive" until 2+ more years of feed exist.
4. **Daily Top 250 index** (`E04_daily_pv250.csv`, ~810 overlapping days ≈ 9 independent quarters): the index's own
   30-day return and the HCI gauge rank the next 30 days monotonically (bottom quintile ≈ 0 %, top ≈ +5–6 %);
   **distance above the 200-day SMA is mean-reverting at 90 days** (Spearman −0.75: ≥36 % above the SMA200 → next 90
   days +4 %; ≤7 % above → +19 %). Too few independent windows to trust, but it matches the "trend exhaustion" idea
   and is worth re-testing yearly.
5. Dollar volume / total sales changes: no predictive value (and the OOS fits blow up on early small-sample months).

**Interpretation.** For the Forecast tab the regime gate should be (a) last month's market median move > 0 (or reg3 >
0) — already the strongest filter — and (b) the 1-month change in Google web-search interest as a confirming / leading
input to the regime estimate, which is cheap to fetch monthly. The PokéViews breadth measures describe the same state
and can be displayed, but should not be weighted as separate evidence yet.

**Caveats.** 68 months of market history, one bull run (2025–26), one slump (2021–22). Google Trends data is
normalised 0–100 within the download window; use changes / z-scores, not levels, if the series is re-downloaded.

**Verdict.** *Worked*: regime persistence (sign of last month's move) and Google Trends web-search change as a leading
input. *Did not add*: PokéViews HCI / MMS / highs-lows / trend-extension / RSI as incremental monthly predictors
(short sample); dollar-volume change.
