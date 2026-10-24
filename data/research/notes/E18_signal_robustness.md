# E18 — Is the reversal edge there every year, and which variant of it is the most consistent?

**Question.** The whole case rests on the bottom reversal decile. Does its excess over the band hold in each calendar
year — including the losing years 2022–23 — and which formulation (dev12, dev6, mom12, 12-1 momentum, distance from
the 12-month high, a dev6/dev12 blend, dev12 with a sales ≥ 5 filter) is the steadiest?

**Method.** `scripts/e18_signal_robustness.py`. Band $50–$500, sales ≥ 2, sets ≥ 24 months, 3-month hold; per month the
bottom decile of each signal vs the band; averaged by calendar year; share of months the decile beat the band; the
decile's net at 20 % under. Output `results/E18_signal_by_year.csv`.

**Results** (3-month gross excess of the bottom decile over the band, by year; months beating the band):

| signal | 2022 | 2023 | 2024 | 2025 | 2026 (7 mo) | ALL | months beating band |
|---|---|---|---|---|---|---|---|
| **dev12** | **+8.0** | +9.7 | +6.9 | +7.0 | **+6.4** | **+7.7** | **96 %** (53/55) |
| dev12, sales ≥ 5 | +9.2 | +7.7 | +7.6 | +7.5 | +4.1 | +7.5 | 91 % |
| mom12 | +4.0 | +9.8 | +6.4 | +6.9 | +5.0 | +6.6 | 93 % |
| dev6 + dev12 blend | +6.4 | +7.8 | +6.3 | +5.2 | +5.8 | +6.3 | 95 % |
| hi12 (below the 12-mo high) | +4.7 | +7.7 | +6.9 | +5.6 | +4.9 | +6.1 | 89 % |
| mom12x1 | +3.4 | +9.4 | +6.5 | +4.9 | +4.3 | +5.8 | 95 % |
| dev6 | +4.9 | +4.3 | +5.3 | +4.2 | +5.6 | +4.8 | 86 % |

The band itself did −6.0 % (2022), −2.6 % (2023), +3.3 % (2024), +10.9 % (2025), +17.4 % (2026) per quarter.
dev12's bottom decile, bought 20 % under, netted +3.4 % per quarter even in 2022 (P(net>0) 49 %), +8.7 % in 2023, +11.6 %
in 2024, +19.8 % in 2025, +26.4 % in 2026.

**Interpretation.**
* The reversal edge is **stable at +6 to +10 points per quarter in every year**, falling or rising — it is not a
  2025–26 artifact. What changes with the regime is the band's own return underneath it.
* `dev12` (price vs its own 12-month mean) is the best single formulation: highest excess, most consistent (96 % of
  months), and it needs no extra filter (the sales ≥ 5 version is no better). mom12 and the 12-month-high distance are
  near-equivalents; dev6 is clearly weaker (too short a memory).
* The **decile** at 20 % under was profitable in 2022 while the E10 simulation lost 12 %/yr that year — because with
  12 % availability the simulated buyer reached into the bottom half of the ranking (E17's dilution). In a falling
  market the edge is concentrated in the deepest decile, so the gate (or accepting idle capital and buying only the
  decile) is what protects the bankroll; in a rising market dilution costs little.

**Verdict.** *Worked*: dev12 confirmed as the ranking signal, robust in every year; the dilution/gate interaction
explained. Nothing failed, but dev6 and the sales filter are not worth carrying.
