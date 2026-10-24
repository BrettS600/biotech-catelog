# E17 — Horizon profile of the reversal, gate thresholds, fractional sizing, the 2-month hold — and a dilution fact

**Question.** (a) Month by month after the signal, how does the reversal pick's return build — where does holding stop
paying per month? (b) Is `reg3 > 0` the right threshold, or should the gate be looser / tighter / two-signal?
(c) Does Kelly-flavoured fractional deployment by regime strength beat all-or-nothing? (d) Is the 2-month hold E12
flagged really as good as 3 months in the full simulation?

**Method.** `scripts/e17_horizon_gate_sizing.py`. (a) dev12 bottom decile ($50–$500, sets ≥ 24 months), cumulative
gross and 20 %-under net at h = 1 … 12, by regime, against the band's own path. (b)–(d) the E10 simulation mechanics
(20 % under, 12 % availability, 1 copy, $5,000, 5 draws) with gates reg3 > −1 % … +2 %, `reg1 & reg3 > 0`,
`reg1 | reg3 > 0`, fractional deployment (0 / 50 / 100 % of the bankroll by reg3 ≤ 0 / ≤ 1 % / > 1 %, and a 25 / 60 /
100 % variant), holds 2 and 3 months. Outputs `results/E17_horizon_profile.csv`, `E17_gate_thresholds.csv`.

**Results.**

(a) Horizon profile, ALL regimes (bottom decile; gross / excess over the band / net at 20 % under per month of hold):
1 mo +1.3 % / +2.5 pts / 2.5 %·mo⁻¹ · 2 mo +6.8 % / +6.0 / **4.0 %** · 3 mo +11.2 % / +8.2 / **4.1 %** · 4 mo +14.8 % / +9.6 /
4.0 % · 5 mo +17.9 % / +10.4 / 3.7 % · 6 mo +21.3 % / +11.5 / 3.6 % · 9 mo +28.8 % / +11.5 / 3.1 % · 12 mo +39.2 % / +13.8 /
3.0 %. The excess over the band is built in months 1–6 and flat after; the per-month rate peaks at 2–4 months.
Strong regime: +22.7 % at 3 mo, +43.5 % at 6 mo (P(net20>0) 85 %), +86 % at 12 mo (5 months of data). Falling regime:
+3.9 % at 3 mo (still +7 pts over the band), +11 % at 6 mo.

(b) Gate thresholds (3-month hold; final / CAGR / losing cycles / worst cycle / idle share):
always $17.6k / 31 % / 29 % / −14 % / 0 % · reg3 > −1 % $17.9k / 31 % / 12 % / −7 % / 35 % · reg3 > −0.5 % $17.2k / 30 % / 9 % /
−8 % / 48 % · **reg3 > 0 $15.6k / 28 % / 1 % / −4 % / 61 %** · reg3 > +0.5 % $14.3k / 25 % / 0 % / +6 % / 65 % · > +1 %
$12.1k / 21 % · > +2 % $9.5k / 15 % / 0 % / +9 % / 82 % · **reg1 & reg3 > 0 $16.3k / 29 % / 0 % / +5 % / 61 %** · reg1 | reg3 > 0
$16.8k / 30 % / 0 % / +2 % / 57 %.
(c) Fractional deployment: 0/50/100 % by reg3 → $15.6k / 28 % (no better than all-or-nothing); 25/60/100 % → $15.9k but
with 23 % losing cycles (the 25 % in falling markets loses).
(d) 2-month hold: always $17.2k / 30 % / 30 % losing; reg3 > 0 $18.7k / **33 %** / 2.7 % losing / worst −5 %; reg1 & reg3
$17.7k / 31 % / 2.7 %.

**The dilution fact.** With $5,000, 12 % availability and one copy per card, the pure bottom decile (~90–100 cards in the
band after the age filter) yields only ~11 available cards and deploys ~15 % of the money ($5k → $8.1k over the
period); E10's buyer goes down the whole dev12 ranking and fills ~60 positions, which reach into roughly the **bottom
half** of the ranking. The simulated 31 %/yr is therefore the return of "the best discounted half", not of the decile;
the decile's own economics (E12, E17a) are the ceiling that more capital dilutes further ($10,000 deploys only
69–87 % even using the whole list). Selection quality and capital size trade off through availability.

**Interpretation.**
* The reversal's edge is earned in the first 3–6 months; per month of capital the 2–4-month holds are best and the
  3-month hold is the robust choice (2 months is marginally better in the sim but each cycle leans more on the
  discount than on the reversal).
* The gate's threshold matters little between −0.5 % and +0.5 %; **0 is right**, and the two-signal rule (`reg1 > 0`
  and `reg3 > 0`) is the safest variant found (0 losing cycles, worst cycle +5 %, −1 CAGR point). Looser gates
  (−1 %) buy back a few losing cycles for +3 CAGR points; tighter gates throw away wealth fast.
* Fractional sizing adds nothing: the information is in the sign, not the size, of the regime.
* For the tab: rank the whole band by dev12 and let the discount availability decide how far down the list the
  money goes; show the user how deep into the ranking the plan reaches (the dilution) rather than pretending every
  pick is a top-decile card.

**Verdict.** *Worked*: horizon profile (hold 2–4 months; 3 by default), gate = reg3 > 0 with reg1 as confirm, and the
dilution fact. *Did not help*: fractional deployment, tighter gates.
