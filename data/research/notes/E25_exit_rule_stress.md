# E25 — Stress test of the anchor exit: the E23/E24 headline was an artifact

**Question.** E24 said "list at the 12-month mean, sell when it prints" compounds $5k at 47 %/yr vs 29 % for the fixed
3-month hold. Before that goes anywhere near the site: what survives when the optimistic assumptions are removed one at
a time — the sale pays the *listing price*, not the month's average; no exit before month 2; half the discounted floors;
5 % of positions sell 30 % low; all four at once?

**Method.** `scripts/e25_exit_rule_stress.py` — the E24 engine with switches. `sell_at_anchor`: the copy is listed at
max(12-month mean, price at purchase) (nobody lists below market) and, in the first month the PriceCharting price reaches
that level, the sale pays the **listing price**; the month's average only decides *whether* it sold. Output
`results/E25_exit_rule_stress.csv`.

**Results** ($5,000, 20 % under, ungated unless stated; final / CAGR / per-position net / P(net>0)):

| scenario | fixed 3 (market sale at month 3) | target 1.00 (anchor exit) |
|---|---|---|
| base (E24 as run: the anchor exit pays the month's average) | $16.8k / 29 % / +9.6 % / 61 % | $29.9k / 47 % / +5.9 % / 60 % |
| **sell at the listing price** | unchanged | **$6.7k / 6 % / −0.5 % / 46 %** (gated $5.1k / 0 %) |
| no exit before month 2 | unchanged | $36.6k / 53 % (bigger overshoots are selected) |
| availability 6 % instead of 12 % | $15.6k / 27 % | $17.1k / 30 % |
| 5 % of positions sell 30 % low | $14.4k / 25 % | $23.0k / 39 % |
| all four | $12.4k / 21 % | **$4.1k / −4 %** |

**Interpretation.**
* The E23/E24 gain came from **selling at the exit month's average price in the first month that average crossed the
  target** — a selection on the same number that is then used as the sale price. Months in which a dipped card's monthly
  average crosses its 12-month mean are months of a large jump, and the average in such a month sits far above the
  target; a fixed-price listing at the target captures only the target, and a market sale cannot know in advance which
  month is the crossing month. Paid at the listing price, the anchor exit is **break-even per position** (−0.5 %, 46 %
  of positions positive) and its portfolio compounds at 6 %/yr, below the fixed hold's 29 %. The "no exit before
  month 2" result improving the artifact (bigger overshoots) is the tell-tale.
* The mechanism is the monthly-averaging trap already met in E11 (set momentum): any rule that *conditions* on a
  PriceCharting monthly average and then *transacts* at that same average overstates what a trader can get. The fixed
  hold is immune because its exit month is chosen in advance.
* What survives: the fixed 3-month hold sold at market is robust to the other stresses (21 %/yr with all of them
  applied); the regime gate's value stands as in E10/E15/E17. E23's per-pick numbers for the target rules and E24's
  portfolio numbers are **withdrawn**; E23's fixed-hold and stop-loss rows (which transact at a pre-chosen month) stand
  — stop-losses still hurt.
* A true test of "list at the anchor" needs transaction-level data: the eBay rollup can show whether a copy listed at a
  given ask sells within N days (backlog B03/B12). Until then the exit stays "sell at market after 2–4 months".

**Verdict.** *Failed — and corrects E23/E24*: the take-profit-at-the-anchor rule is not a usable improvement; its
back-tested gain was an averaging artifact. FINDINGS item 5, build items 1 and 4 and CLAUDE.md are reverted to the
fixed-hold plan with the gate. The general lesson is recorded: never let a rule both condition on and transact at a
PriceCharting monthly average.
