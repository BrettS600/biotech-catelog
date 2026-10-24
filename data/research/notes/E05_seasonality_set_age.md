# E05 — Calendar seasonality and set age (inside $50–$500)

**Question.** (a) Is there a month-of-year pattern worth timing? (b) The full set-age curve: which ages pay at 1 / 3 / 6
months and does any age bucket clear fees?

**Method.** `scripts/e05_calendar_age.py`. (a) Market-wide median 1-month move by calendar month, 2021–2026, raw and
de-trended (each month minus its year's mean, to strip the 2021 slump / 2025–26 boom). (b) Forward returns by set age
(months since release) in buckets 0–2, 3–5, 6–11, 12–23, 24–47, 48–95, 96–179, 180+, by regime.

**Results** (`results/E05_seasonality.csv`, `results/E05_set_age.csv`).

Seasonality (band, de-trended mean of the median monthly move; years positive out of 6):
Jan +0.6 % (4/5) · Feb −1.2 % (3) · **Mar +1.3 % (6/6)** · **Apr +0.8 % (5/6)** · May 0.0 % (3) · **Jun −0.7 % (1/6)** ·
Jul −0.5 % (2) · Aug −0.1 % (3) · Sep −0.5 % (3) · Oct +0.1 % (4) · Nov −0.6 % (3) · Dec +0.8 % (3/5).
Raw yearly table: 2021 every month negative (−2 to −8 %); 2022 negative; 2023 flat-negative; 2024 flat; 2025 and 2026
positive every month. **The year (regime) explains ~10× more variance than the calendar month.** Within a year,
March–April is the most reliable positive stretch and June–September the weakest — consistent with the trade-press
"summer lull / Q2 strength" claims (see `sources.md`), but ±1 %/month is small next to the 18–28 % fee wall.

Set age, 3-month hold, ALL regimes (gross / net / P(net>0)): 0–2 mo **−14.6 %** / −32 % / 8 %; 3–5 mo **−24.9 %** /
−40 % / 1 %; 6–11 mo −1.4 % / −21 % / 14 %; 12–23 mo +1.5 % / −19 % / 15 %; 24–47 mo +7.4 % / −13.5 % / 22 %;
48–95 mo +7.7 % / −13 % / 20 %; 96–179 mo +3.6 %; 180+ mo +3.5 %.
Strong regime, 3 months: 24–47 mo +1.5 % (the 2022–24 sets did little in the 2025–26 boom); 48–95 mo **+14.6 %**;
96–179 mo +16.3 %; 180+ **+16.2 %** (P(net>0) 33 %). Flat regime, 3 months: 24–47 mo +18.5 %, 48–95 +10 %, 180+ +6 %.
Strong regime, 6 months (8 months of data): 48+ months +30 to +40 % gross.
1-month hold: young sets −10 to −13 % per month; 24+ months ≈ 0 to +3 %.

**Interpretation.**
* Young sets (< 12 months) are poison at every horizon in every regime: −10 to −25 % in 3 months. The Forecast tab's
  "allow young sets" default-off is right; the age floor could be raised to 24 months without losing anything — the
  12–23-month bucket is only break-even gross.
* Among mature sets the curve is flat-to-humped and regime-dependent: in the 2025–26 boom the 4-year-plus sets led
  (+15–16 % in 3 months) while 2–4-year-old sets lagged; in flat years the 2–4-year-olds led. Age is a filter, not a
  ranking signal, past 24 months.
* Seasonality is real but second-order; it can tilt the regime estimate (lean in Mar–Apr, lean out Jun–Sep) but should
  not drive buys.

**Verdict.** *Worked* as filters: age ≥ 24 months (strong), avoid Jun–Sep as a mild tilt. *Not a selection signal*:
calendar month; age beyond 24 months.
