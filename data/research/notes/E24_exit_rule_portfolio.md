# E24 — The exit rule inside the reinvesting portfolio

> **CORRECTION (E25, same day):** the 47 %/yr headline is an artifact of selling at the month's average price in the month that average crossed the target. With the sale paid at the listing price the same engine gives $6.7k (6 %/yr), below the fixed 3-month hold. The whole note is **withdrawn** except as a record of the mistake; see E25.

**Question.** E23 measured the take-profit-at-the-anchor rule per pick. What does it do to a bankroll that reinvests
every sale — the number Brett cares about — once positions exit on their own schedule, cash sits idle between exits,
and the buyer reaches down the ranking as in E10/E17?

**Method.** `scripts/e24_exit_rule_portfolio.py`: a month-by-month engine (E10's assumptions, asynchronous exits).
Each month: positions due this month are cashed; then, if the gate allows, cash is deployed down the dev12 ranking of
the band ($50–$500, sales ≥ 2, sets ≥ 24 months) among the cards with a credible floor that month (12 % availability,
seeded draw), one copy per card at 20 % under `buy_real`, each position ≤ 20 % of cash + book, cards already held
skipped, only cards with a full 6-month forward path (the same candidate set for every rule). The exit month is set at
purchase by the rule. Purchases stop 6 months before the end so every position is closed by 2026-09. Equity = cash +
open positions at their current net sale value. 5 draws, 2022-01 … 2026-09, $5,000 (plus $2,000 / $10,000 for the two
headline rules). Outputs `results/E24_exit_rule_portfolio.csv`, `E24_exit_rule_by_year.csv`.

**Results** ($5,000, mean of 5 draws; final / CAGR / max drawdown of monthly equity / negative months / positions /
average months held / per-position net and P(net>0)):

| rule | ungated | gated reg3 > 0 |
|---|---|---|
| fixed 2 | $21.7k / 37 % / −18 % / 25 % / 1,963 / 2.0 / +6.2 % / 57 % | $13.7k / 24 % / −3 % / 6 % |
| **fixed 3** (E10's default) | $16.8k / 29 % / −22 % / 28 % / 1,070 / 3.0 / +9.6 % / 61 % | $14.4k / 25 % / −3 % / 7 % |
| fixed 6 | $19.8k / 34 % / −19 % / 25 % / 625 / 6.0 / +22 % / 70 % | $13.6k / 24 % / −5 % / 9 % |
| target 0.90 × mean | $22.4k / 38 % / −7 % / 19 % / 3,421 / 1.3 / +3.3 % / 54 % | $15.3k / 27 % / −3 % / 7 % |
| **target 1.00 × mean, max 6** | **$29.9k / 47 % / −7 % / 16 % / 3,038 / 1.7 / +5.9 % / 60 %** | $18.0k / 32 % / −2.6 % / 6 % |
| target 1.00, max 3 | $24.6k / 41 % / −10 % / 21 % / 3,256 / 1.4 / +4.1 % / 56 % | $17.3k / 31 % / −3 % / 5 % |
| target 1.10 × mean, max 6 | $31.9k / 49 % / −10 % / 17 % / 2,442 / 2.2 / +8.9 % / 66 % | $22.0k / 37 % / −1.6 % / 6 % |

Calendar years, ungated: fixed 3 → **2022 −15 %**, 2023 +14 %, 2024 +33 %, 2025 +75 %, 2026 (9 mo) +49 %;
target 1.00 → **2022 +18 %**, 2023 +50 %, 2024 +54 %, 2025 +70 %, 2026 +30 %. Draw-to-draw range of the final capital
for target 1.00 ungated: $28.9k–$32.2k (tight, because ~3,000 positions average the noise out).

Capital: $2,000 → target 1.00 $21.1k (65 %/yr, drawdown −9 %) vs fixed 3 $8.3k (36 %, −25 %); $10,000 → $33.9k (30 %)
vs $30.1k (27 %); gated at $10,000 the two are equal (22 %), because idle cash, not the exit, is the constraint there.

**Interpretation.**
* The anchor exit **turns the ungated strategy profitable in every calendar year, including 2022**, and roughly halves
  the drawdown (−22 % → −7 %) while raising the compounding rate from 29 % to 47 %/yr at $5,000. Winners are cashed in
  ~1.7 months on average and the money goes straight back to work; the 6-month market sale keeps the losers from
  rotting. Per position it earns *less* (+5.9 % vs +9.6 %) but turns over almost three times as often.
* With this exit the **regime gate costs more than it saves** ($29.9k → $18.0k) and buys only a drawdown reduction from
  −7 % to −2.6 %. The gate was the insurance against 2022-style years *for fixed holds*; the exit discipline is a
  cheaper insurance. Keep the gate as a display and as the rule for anyone holding to a fixed month; make it optional
  for the anchor-exit plan.
* 1.10 × the mean earns a little more and holds a little longer; 0.90 × turns faster but earns less per position
  (+3.3 %) — the fee wall eats quick small flips. 1.00 × is the balance; the max hold of 6 beats 3 (the slow
  recoverers are worth waiting for).
* Smaller bankrolls gain the most (the availability of discounted floors never binds them); at $10,000 the engine still
  cannot deploy enough copies, so the exit rule adds only 3 points — the second copy per card or a second channel is
  the fix there (E19).

**Caveats** (the same ones as E23, now carrying more weight): the sale at the anchor is assumed to clear in the month the
monthly average reaches it; a 1.7-month average turnover assumes shipping, listing and payout inside that time; the
20 %-under buys are assumed available in the same share (12 %) every month of the cycle; per-position net is small
(+5.9 %), so a condition surprise or a forced lower sale on a fraction of positions erodes it quickly. The 2022 result
is one down-cycle. Treat 47 %/yr as the shape of the opportunity; the robust claims are the ordering (anchor exit >
fixed hold at every capital level, every year) and the drawdown halving.

**Verdict.** *Worked*: the take-profit-at-the-anchor rule is the single biggest improvement found in the whole study —
+18 CAGR points over the fixed 3-month hold at $5,000, positive in every year, drawdown halved, average hold 1.7
months. Build it as the default plan (build item 4) and make the gate optional for it.
