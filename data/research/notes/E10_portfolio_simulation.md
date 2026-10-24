# E10 — The reinvesting flipper: what $2,000 / $5,000 / $10,000 would have become, 2022-01 … 2026-09

**Question.** Put the pieces together the way Brett would run them: cycle the whole bankroll every h months through the
top-ranked cards, pay eBay's fees, cap each card at 20 % of capital and at 25 % of its monthly sales, optionally gate on
the regime, optionally buy under the standard price — and compound. Which hold, rule, gate and discount make money, with
what drawdowns and how many losing cycles?

**Method.** `scripts/e10_portfolio_sim.py`. Non-overlapping cycles (buy at t, sell at t+h at PriceCharting's level,
reinvest); every starting offset 0..h−1 run and averaged; sets ≥ 24 months old; band $50–$500, sales ≥ 2. Rules:
**dev12** (deepest below 12-month mean first), **dev12f** (dev12 with E16's sales ≥ 5 / no-Promo filters), **mom12**,
**combo** (dev12 rank + set-momentum rank — set momentum later shown to be an artifact, E11), **setmom**, **random**,
**top_mom3** (chase 3-month winners — the anti-test). Gates: none / reg3 > 0 / reg3 > 2 % (reg3 = trailing 3-month market
move, known at decision time; > 0 in 25 of 67 months, > 2 % in 12). Discounts 0 / 10 / 15 / 20 %.
**Realistic-availability runs**: a discounted buy exists for only a share of candidates (E07: 12 % at ≥20 % under,
25 % at ≥15 %, 40 % at ≥10 %), one or two copies each; undeployed capital stays in cash. Every random element is seeded
per configuration and the realistic / random runs are **averaged over 5 independent draws** (`n_rep`; `final_min` /
`final_max` give the spread across draws and start offsets). Outputs `results/E10_sim_summary.csv` (one row per
configuration), `E10_sim_cycles.csv` (every cycle), `E10_sim_by_year.csv`.

**Results** ($5,000 start, 4.67 years; CAGR / P(losing cycle) / worst cycle / max drawdown).

*Standard price, no gate:* **everything loses** — dev12 h=3 $5,000 → $724 (−34 %/yr); h=1 → ~$200; random h=3 → $231;
top_mom3 (chasing winners) → $206. Fees compound away at every hold; even h=6 only holds flat ($5,352).
*Standard price, gated on reg3 > 0 (trades in 39 % of cycles):* dev12 h=3 → $6,663 (+6 %/yr, 52 % losing cycles, max DD
−22 %); h=6 → $8,655 (+12.5 %/yr, 11 % losing cycles); random h=3 → $2,414. Survival, not a business.

*Discount 20 %, unlimited availability (upper bound):* dev12 h=3 → $51,586 (+65 %/yr, 15 % losing cycles, worst −19 %,
DD −24 %); random h=3 → $13,001 (+23 %/yr). The discount alone is worth ~20 %/yr; selection roughly triples it.

**Realistic availability** (the numbers to plan on; $5,000 start; mean of 5 draws, range in brackets):

| hold | discount / availability / copies | gate | rule | final | CAGR | P(loss cycle) | worst cycle | max DD |
|---|---|---|---|---|---|---|---|---|
| 3 mo | 20 % / 12 % / 1 | none | dev12 | **$17,424** [13.5–25.5k] | **+31 %** | 30 % | −12 % | −18 % |
| 3 mo | 20 % / 12 % / 1 | reg3>0 | dev12 | $15,575 [13.1–18.8k] | +28 % | **0 %** | **+1 %** | 0 % |
| 3 mo | 20 % / 12 % / 2 | none | dev12 | $23,495 [18.5–29.3k] | +39 % | 23 % | −13 % | −13 % |
| 3 mo | 20 % / 12 % / 1 | none | random | $11,709 [8.6–14.3k] | +20 % | 36 % | −18 % | −26 % |
| 3 mo | 20 % / 12 % / 1 | reg3>0 | random | $14,220 | +25 % | 0 % | +1 % | 0 % |
| 3 mo | 15 % / 25 % / 1 | none | dev12 | $12,565 [9.6–18.7k] | +22 % | 36 % | −19 % | −29 % |
| 3 mo | 15 % / 25 % / 1 | reg3>0 | dev12 | **$11,912** [10.3–13.0k] | **+20 %** | 2 % | −1 % | 0 % |
| 3 mo | 15 % / 25 % / 1 | none | random | $4,334 | −3 % | 56 % | −23 % | −55 % |
| 3 mo | 15 % / 25 % / 1 | reg3>0 | random | $9,041 | +14 % | 11 % | −5 % | −1 % |
| 3 mo | 10 % / 40 % / 2 | none | dev12 | $6,787 | +7 % | 50 % | −21 % | −45 % |
| 3 mo | 10 % / 40 % / 2 | reg3>0 | dev12 | $10,020 | +16 % | 10 % | −5 % | −1 % |
| 3 mo | 10 % / 40 % / 2 | any | random | $1,101 / $5,787 gated | −28 % / +3 % | 77 % / 42 % | | |
| 1 mo | 20 % / 12 % / 1 | none | dev12 | $15,778 [13.0–19.4k] | +28 % | 35 % | −11 % | **−42 %** |
| 1 mo | 20 % / 12 % / 1 | reg3>0 | dev12 | **$20,621** [17.5–24.6k] | **+36 %** | 6 % | −4 % | −2 % |
| 1 mo | 20 % / 12 % / 1 | none | random | $7,806 | +10 % | 43 % | −15 % | −52 % |
| 1 mo | 20 % / 12 % / 1 | reg3>0 | random | $13,793 | +24 % | 10 % | −5 % | −3 % |
| 1 mo | 15 % / 25 % / 1 | reg3>0 | dev12 | $6,074 | +4 % | 50 % | −10 % | −20 % |
| 1 mo | 15 % / 25 % / 1 | none | any rule | ~$200–290 | −46 to −50 % | 58–79 % | | −95 % |
| 1 mo | 10 % / 40 % / 2 | reg3>0 | dev12 | $1,491 | −23 % | 80 % | | −75 % |

Other capitals, 3 mo / 20 % / 12 % / 1 copy / dev12: $2,000 → $12,204 ungated (+47 %/yr) / $7,143 gated (+31 %);
$10,000 → $24,470 (+21 %) / $25,468 gated (+22 %) — only 69–87 % of $10,000 finds a discounted card each cycle (2 copies
per card restores ~+28 %). Patient selling (+5 % on the sell price, half of E07's s80 premium) roughly doubles the final
value of the 20 %-off 3-month strategy. Dropping the age filter (age_min 0) costs ~20 % of the final value. The E16
filters (dev12f) do not improve any configuration. Chasing winners (top_mom3) is the worst rule everywhere.

**By year** (`E10_sim_by_year.csv`, dev12, 20 % under, 12 % availability, 1 copy, no gate — annualised from the year's
cycles, 5 draws):

| year | regime | 3-month hold | 1-month hold |
|---|---|---|---|
| 2022 | falling | **−12 %** (75 % losing cycles) | **−32 %** (73 % losing) |
| 2023 | falling / flat | +5 % | −8 % |
| 2024 | flat → strong | +45 % | +36 % |
| 2025 | strong | +75 % | +103 % |
| 2026 (to Sep) | strong | +133 % | +155 % |

**Interpretation.**
1. **At the standard price there is no 1–3-month business.** A regime gate keeps the bankroll alive at 3–6 months (+6 to
   +12 %/yr) with ~half the cycles losing.
2. **The discount is the business; the reversal rule is the edge on top; the regime gate is the insurance.** At 20 %
   under, random cards return ~20 %/yr and deep-reversal cards 31–39 %/yr. At 15 % under, random loses and the reversal
   rule still makes +22 %/yr (+20 % gated with 2 % losing cycles). At 10 % under only the gated 3-month version is
   clearly positive (+16 %/yr).
3. **The whole back-test's profit comes from 2024–2026.** In 2022 even 20 %-under buys lost 12 %/yr at 3 months and
   32 %/yr at 1 month; 2023 was ~flat. The gate (trade only when the trailing 3-month market move is positive) sits those
   years out: 0–2 % losing cycles in-sample, worst cycle about −1 to +1 %, at the cost of being in cash 60 % of the time
   and ~10 % less final wealth over the boom. **This is the single most important risk control for "don't lose money".**
4. **1-month holds need the full 20 % discount**; at 15 % they lose or break even at every rule, gated or not. 3-month
   holds work from 15 % (gated from 10 %). Gated at 20 % under, the 1-month hold compounds faster (+36 %/yr vs +28 %) but
   ungated its drawdown is −42 % vs −18 %: each cycle's edge is thinner and the dice roll 12× a year.
5. Loss risk per cycle stays 23–36 % ungated even in the best configurations; the worst realistic ungated cycle is −11 to
   −19 %. With ≥ 20 cards per cycle the drawdowns are bounded; $2,000 (fewer cards) is more variable (range $8.5–19.7k).

**Dilution (E17).** The buyer goes down the whole dev12 ranking until the money is spent; with 12 % availability and
$5,000 that is ~60 positions reaching roughly the bottom half of the ranking, not the bottom decile (which alone
would deploy ~15 % of the money). The CAGRs above are the return of "the best discounted half".

**Caveats.** Sell price = PriceCharting's monthly level (fair for $50+, E07) with no time-to-sell, no unsold inventory,
no condition risk, no buyer returns; floor availability (12 / 25 / 40 %) is from one snapshot and assumed independent of
the card's rank and of the regime (in a falling market more deep floors exist, in a boom fewer — not modelled); the
anti-selection of deep floors (E13: the median drifts −4 % in two weeks after a deep floor appears) is not modelled;
2025–26 is a historic boom and dominates the totals; the spread across the 5 random draws is ±20–30 % of final wealth,
so read CAGR differences under ~4 points as noise.

**Verdict.** *Worked*: **"3-month hold · deep-reversal rank (dev12) · sets ≥ 24 months · buy ≥ 15–20 % under the
standard price · trade only when the trailing 3-month market move is positive"** compounds $5,000 at +20–28 %/yr in the
back-test with 0–2 % losing cycles in-sample (ungated: +22–39 %/yr, max drawdown −13 to −29 %, one losing year).
*Failed*: standard-price buying at any hold; 10 % discounts ungated; 1-month holds at ≤ 15 % under; momentum chasing.
