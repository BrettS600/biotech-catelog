# E02 — The signal zoo: 27 simple card-level signals, decile tables at 1 / 3 / 6 months

**Question.** Which single-number signals computed from a card's own PriceCharting history (and its set's) separate
next-period winners from losers? Does any top decile clear the fee wall at 1–3 months?

**Method.** `scripts/e02_signals.py`, engine in `scripts/xs.py`. Months 2022-01 … (last − h), universe price ≥ $10,
sales ≥ 2; signal ranked into deciles each month; forward gross/net at the standard price. Signals: momentum
(mom1/2/3/6/12, 12-1 and 6-1 skipping the last month), acceleration, volatility (vol6/12), distance from the 12-
and 6-month high (hi12/hi6) and low (lo12), price level (lp), sales level (lv), sales growth (vgrow), dollar volume
(dvol), sales z-score (vz), price vs its own 3/6/12-month mean (dev3/6/12), price-up-with-volume (pv_up), months
since the last sale (stale), set age, set momentum (set_mom1/3 = median move of the set's cards), card move minus
set move (rel_mom1).

**Result** (`results/E02_signal_summary.csv`, `results/E02_deciles.csv`, `results/E02_ic_monthly.csv`).

1. **Reversal dominates, at every horizon, with huge t-stats.** Cards that rose the most lose; cards furthest below
   their own 6–12-month mean win. h = 3 months, top vs bottom decile vs universe (gross):
   dev12 −6.3 % / **+9.0 %** / +3.5 %; dev6 −6.5 % / +5.4 %; mom12 −3.5 % / +8.4 %; mom3 −5.0 % / +5.1 %.
   Hit rate of the top (past-winner) decile beating the universe: 0–13 % of months. The spread's t-stat is −10 to −21.
   At 6 months the bottom-decile edge grows (dev12 bottom +18 % vs +11 % universe; mom12 bottom +16.6 %).
2. **At 1 month both extremes lose** (mom1 top −5.5 %, bottom −5.3 %, universe −1.4 %). The bottom's loss at
   1 month is the `buy_real` rule: a card that just dipped is "bought" at its 3-month mean, above the print — the
   2026-10-17 finding that the dip cannot be bought. By 3 months the reversal overcomes that handicap.
3. **Positive momentum exists only at the set level**: set_mom1's top decile beat the universe in 74 % of months
   at 1 month (t +4.2) and 60 % at 3 months — small (+1 % spread) but the only consistently *positive* momentum
   signal. `pv_up` (price up with volume up) is similar at 1 month (hit 72 %, t +3.8) and fades by 3 months.
4. **Volatility, volume, sales growth, dollar volume**: weak or negative spreads (high-vol / volume-spike cards
   underperform slightly). Volume signals do not predict returns here.
5. **Price level** (lp) has no gross spread but the top decile's net is far better (−18 % vs −43 % at 1 month):
   fees, not returns.
6. **Nothing clears the fee wall.** Best top-decile P(net>0) at 1 month: 9 % (lp). At 3 months: 20 % (lp), 16 %
   (dvol). Every return-based signal's top decile has P(net>0) ≤ 9 % at 3 months because they are past winners.
   The *bottom* deciles of the reversal signals are where the money is (see E03 for the band-restricted view).

**Monthly IC** (`E02_ic_monthly.csv`): mom1 vs next-month gross return is negative in essentially every month
(mean −0.2); dev12 negative at every horizon; set_mom1 slightly positive at 1 month.

**Caveats.** PriceCharting's price is a monthly average of a few eBay sales, so part of any reversal is noise in the
estimator reverting (a low print made of two cheap sales). E03 tests that by splitting on how many sales made the
move. The universe here includes $10 cards; E03 repeats everything inside $50–$500.

**Verdict.** *Worked* as a map: the exploitable structure is **mean reversion toward the card's own 6–12-month
level** (buy what fell, not what is rising) plus a thin **set-level momentum**. *Failed*: card-level momentum,
volume, volatility as buy signals. Nothing at the standard price clears fees at 1–3 months.

**Later work.** E11 showed that the positive set-level momentum here (set_mom1, pv_up) is an artifact of PriceCharting's
monthly averaging (a set that rose late in the month carries its end-of-month level into the next month's average); the
same signal built from PokéViews' daily set indexes has no forward power. Treat set_mom1 as **not tradeable**. The
reversal findings are unaffected (averaging biases toward momentum, not reversal; E03's liquidity split holds).
