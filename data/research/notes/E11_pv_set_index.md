# E11 — PokéViews' daily set index as a set-momentum signal (and the monthly-averaging trap)

**Question.** PokéViews publishes a daily index per set (`data/pokeviews/set_performance.csv.gz`, top-10 cards per set,
133 sets). Is its trailing 30 / 90-day return at month-end a timelier version of PriceCharting's monthly set move
(`set_mom1`, which E02 found to be the only positive momentum signal), and does it predict the next month's returns of
the set's cards?

**Method.** `scripts/e11_pv_set_index.py`. (1) Month-end PV set-index trailing returns (30 d, 90 d, distance from the
90-day mean) mapped to PriceCharting's sets (strip "Pokemon "), tested against the next 1- and 3-month PriceCharting
returns of all the set's $50–$500 cards: set-level and card-level Spearman IC, top vs bottom quintile of sets;
PriceCharting's own set_mom1 / set_mom3 on the same months for comparison (2024-06 … 2026-08, 26–28 months).
(2) **The clean test**: the set index's trailing return vs *its own* forward 30 / 90-day return from the same daily
series, sampled on the 1st of each month (30 months, 100+ sets) — no monthly averaging anywhere.

**Results** (`results/E11_pv_set_signal.csv`, `results/E11_pv_set_own_momentum.csv`).

Test (1) looks spectacular: set-level IC of pv_r30 vs next-month PC card returns **0.49** (positive in 28/28 months)
vs 0.23 for PC's set_mom1; card-level IC 0.20 vs 0.10; top-quintile sets +6.0 % next month vs bottom −3.6 %
(universe +1.5 %); at 3 months +15.9 % vs +3.1 %.

Test (2) kills it: set index trailing 30-day return → own forward 30-day return, Spearman **−0.04** (positive in 40 % of
months); 90-day → 90-day −0.03; top quintile +3.3 % vs bottom +5.0 % (slight reversal, if anything). **There is no
set-level momentum in the daily data.**

**Interpretation — the monthly-averaging trap.** PriceCharting's monthly price is the *average* of the month's sales.
A set that rose through June has end-of-June prices above June's average; July's average then starts from that higher
level, so "June average → July average" shows a gain that anyone buying at the end of June (at the end-of-June price)
does not get. A daily index that knows the end-of-June level therefore "predicts" the next PC monthly return
mechanically. The same mechanism (Working 1960: averages of a random walk have spuriously positive autocorrelation)
inflates PriceCharting's own set-level and market-level momentum:
* **E02's set_mom1 "positive momentum" is this artifact** — not a tradeable signal. It must not be built into the
  card ranking. (E10's `combo` rule, which added set momentum to the reversal rank, did no better than `dev12` alone —
  consistent with this.)
* The **market regime persistence (E04) survives** because the daily PokéViews Top-250 index shows the same
  time-series momentum without averaging (E04: index 30-day return → next 30 days, Spearman 0.59, monotone quintiles).
  Market-level trend is real; set-level relative momentum is not.
* The **card-level reversal (E02/E03) is not an averaging artifact** — averaging creates positive, not negative,
  autocorrelation, so if anything the measured reversal is understated; and E03 showed it is as strong for liquid
  cards as for thin ones. A card that fell through the month has an end-of-month price *below* its monthly average, so
  buying at `buy_real` (≥ the average) is conservative for the reversal picks.

**Design implication.** Any feature built from a PriceCharting monthly *level* compared with the previous month's level
(set_mom, market breadth, card mom1) carries ~+0.25 spurious autocorrelation; features built from the card's own
longer history (dev6 / dev12, mom12) are much less affected, and signals from PokéViews' daily indexes should be
validated against their own daily forward returns before being trusted. For the Forecast tab: use the PokéViews
daily Top-250 index for the regime (it is timelier than the PC monthly median and not averaged), drop set momentum.

**Verdict.** *Failed as a signal* (set-level momentum does not exist in the daily data). *Worked as a lesson*: it
exposed the averaging artifact behind E02's set_mom1 and bounded what "momentum" in this data can mean.
