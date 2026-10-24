# E15 — Which regime gate?

**Question.** E10 showed the gate (trade only when the market's trailing move is positive) is the strategy's main risk
control. Which definition works best: last month's move, the trailing 3-month move, "strong only", an AR + Google-Trends
forecast, or PokéViews' daily Top-250 index 30-day return?

**Method.** `scripts/e15_gate_variants.py`. (a) For each gate, over 2022-01 … 2026-06 (55 months): share of months "on",
the next-3-month market move when on vs off, and the sign accuracy of the call. The AR+Trends gate is an expanding-window
OLS of the next-3-month move on `reg1` and the 1-month web-search change, fit only on months whose outcome was known
(≥ 24 rows; available from 2023-03). (b) The E10 simulation (dev12, 3-month hold, 20 % under, 12 % availability, 1 copy,
sets ≥ 24 months, $5,000) with each gate, from 2022-01 and from 2024-06.

**Results** (`results/E15_gate_calls.csv`, `E15_gate_sim.csv`).

| gate | months on | next 3 mo when on / off | P(up) when on / off | sign accuracy | sim 2022→ final / CAGR / losing cycles |
|---|---|---|---|---|---|
| reg1 > 0 (last month) | 44 % | +6.6 % / −2.9 % | 92 % / 10 % | 91 % | $15,618 / 28 % / 0 % |
| **reg3 > 0** (trailing 3 mo) | 40 % | +6.9 % / −2.5 % | 95 % / 12 % | **91 %** | **$17,222 / 30 % / 0 %** |
| reg3 > 2 % (strong only) | 20 % | +7.4 % / −0.3 % | 100 % / 32 % | 75 % | $9,956 / 16 % / 0 % |
| AR + Trends (40 months) | 50 % | +7.6 % / −1.5 % | 100 % / 25 % | 88 % | $15,449 / 27 % / 0 % |
| PV250 30-day > 0 (27 months) | 85 % | +6.0 % / +4.2 % | 91 % / 75 % | 81 % | $14,643 / 26 % / 9 % |
| always | 100 % | +1.2 % | 46 % | 46 % | $16,676 / 29 % / 33 % |

**Interpretation.**
* **`reg3 > 0` is the gate.** It calls the sign of the next quarter right 91 % of the time, is on 40 % of months, and in
  the simulation it matches the ungated final wealth while removing every losing cycle in-sample. `reg1 > 0` is nearly
  as good and reacts a month faster (useful at turning points; a sensible rule is "on when both are positive, off when
  either turns negative").
* "Strong only" (> 2 %/mo) throws away half the good months (sign accuracy 75 %) and halves wealth.
* The Google-Trends augmentation improves the *level* forecast (E04) but not the *sign* call the gate needs; the AR term
  already gets 91 % of signs. Keep Trends as a confirming display, not as the gate.
* PokéViews' daily index is timelier but has only 27 months, all in the up-cycle, where it is on 85 % of the time; it
  cannot yet be judged. It is the natural replacement for `reg1` once it has seen a down-cycle, because it has no
  monthly-averaging lag (E11).

**Verdict.** *Worked*: `reg3 > 0` (with `reg1 > 0` as the fast confirm). *Not better*: Trends-augmented gate, strong-only
gate. *Untested yet*: PV250 gate through a down-cycle.
