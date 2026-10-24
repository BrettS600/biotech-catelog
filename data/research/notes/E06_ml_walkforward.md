# E06 / E06b — Walk-forward gradient boosting at 1 and 3 months, and what it adds over the simple reversal rule

**Question.** Does a gradient-boosted ranking (the live `forecast.py` approach) beat the single reversal signal at 1–3
months? Do market-level exogenous features (Google Trends, breadth, calendar) improve the card ranking? Is a classifier
trained on "clears the fee wall" better than regressing the return? Are its probabilities calibrated?

**Method.** `scripts/e06_ml.py`, `scripts/e06b_ml_variants.py`. sklearn HistGradientBoostingRegressor / Classifier
(300 iters, lr 0.05, 31 leaves, l2 1), refit every 6 months on all months whose outcome is known (≤ t − h), scored
2022-12 … 2026-09, ranked within month. Sets: **A** card features only (27: momentum, reversal, volatility, volume,
age, set momentum, regime, rarity/finish codes); **B** A + Google Trends change / z-score, breadth, calendar month;
**C** B without 1–3-month momentum features. Variants (E06b, trained and ranked inside $50–$500 only): **D_band**
regression; **E_cls** classifier on net > 0 at the standard price; **G_cls20** classifier on net > 0 when bought 20 %
under. Metrics inside the band: Spearman IC, top-5 % / top-10 % mean gross and net, P(net>0), P(net>0 at 20 % off),
calibration bins. Files: `results/E06_ml_summary.csv`, `E06_ml_monthly.csv`, `E06_ml_importance.csv`,
`E06b_variants_summary.csv`, `E06b_variants_monthly.csv`, `E06b_calibration.csv`.

**Results.**

| set | h | IC | IC>0 months | band gross | top-10 % gross / net / P(net>0) | top-10 % P(net>0) at 20 % off |
|---|---|---|---|---|---|---|
| A card | 1 | 0.27 | 100 % | −0.3 % | +5.3 % / −15.2 % / 13 % | 60 % |
| B +exo | 1 | 0.27 | 100 % | −0.3 % | +5.9 % / −14.7 % / 14 % | 62 % |
| A card | 3 | 0.26 | 100 % | +5.2 % | +11.8 % / −9.5 % / 27 % | 62 % |
| B +exo | 3 | 0.26 | 95 % | +5.2 % | +10.5 % / −10.7 % / 26 % | 60 % |
| C no short mom | 3 | 0.24 | 95 % | +5.2 % | +10.4 % / −10.7 % / 25 % | 60 % |
| A card | 6 | 0.24 | 98 % | +14.3 % | +18.6 % / −3.9 % / 36 % | 65 % |
| D_band | 3 | 0.22 | — | +5.2 % | +10.8 % / −10.5 % / 25 % | 60 % |
| G_cls20 | 3 | 0.19 | — | +5.2 % | +10.7 % / −9.0 % / 28 % | **66 %** (strong regime 77 %, falling 50 %) |

By regime (A, h = 3; regime = trailing 3-month market move): falling months top-10 % +5.6 % vs band −1.2 %; flat
+13.9 % vs +5.9 %; strong +16.9 % vs +13.1 %. At h = 6 in strong months (8 months) the top decile is +32.5 % vs the band's
+28.4 % — the ranking's edge shrinks to ~4 points in a bull run (the 2026-10-17 regime-fragility finding, softened).
Permutation importance (`E06_ml_importance.csv`): the reversal features (dev12, dev6, mom12, hi12), set momentum and
price level dominate; the exogenous features have ~zero importance for ranking (they are constant within a month, so
they can only act through interactions).

Calibration (`E06b_calibration.csv`): E_cls (net>0 at the standard price) is badly over-confident at the top — bins
predicted 0.45–0.65 realised ~0.33 at h = 3 (the model finds few true positives and over-extrapolates). **G_cls20 is
well calibrated at h = 1** (pred 0.45 → realised 0.49, 0.65 → 0.64, 0.74 → 0.73) and mildly over-confident at the top
at h = 3 (0.84 → 0.75, 0.92 → 0.76) while under-confident at the bottom (0.07 → 0.23).

**Interpretation.**
* The GBM's 3-month top decile (+11–12 % gross, all regimes) is **about equal to the plain dev12 bottom decile** (+10.5 %
  in E03) and below it in strong regimes (+16.9 % vs +23.9 %). The model is learning the reversal and diluting it with
  weaker signals. The simple rule is at least as good and far more robust.
* Exogenous market features do not help the *ranking*; they belong in the *regime / level* (E04), i.e. the chance
  tables and the gate, not the card score.
* A classifier aimed at the scenario that actually pays (20 % under) is calibrated enough to be shown as a "chance"
  and lifts the top decile's realised P(net>0 at 20 % off) from 61 % to 66 % (77 % in strong regimes) — a modest,
  real gain for the discounted-buy use case.

**Caveats.** 44–46 scored months, two regimes; refits every 6 months; targets clipped at [−0.9, +2]; the standard-price
GBM probabilities (E_cls) should never be shown raw.

**Verdict.** *Worked*: GBM ranks (IC 0.22–0.28, positive in ~every month), and G_cls20 is a usable calibrated chance
for discounted buys. *Did not beat the simple rule*: at 3 months the dev12 reversal decile is as good or better. *Failed*:
exogenous features inside the ranking; raw classifier probabilities at the standard price; most of the ranking's
value at 6 months in a strong regime.
