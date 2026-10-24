# E20 — A chance table the Forecast tab can use directly

**Question.** Instead of a model's probability, give the tab an empirical lookup: for a card in rank bucket *b* of the
band's dev12 ranking, bought *d* under the standard price, held *h* months, in regime *r* — what share of copies netted a
profit, and what did the net look like (mean, 10th / 50th / 90th percentile)? Is such a table stable out of sample?

**Method.** `scripts/e20_chance_table.py`. Band $50–$500, sales ≥ 2, sets ≥ 24 months, 2022-01 … 2026-09; buckets
bottom 10 % / 10–25 % / 25–50 % / top 50 % of the dev12 ranking (low = deepest below its 12-month mean); discounts 0 /
10 / 15 / 20 / 25 %; holds 1 / 2 / 3 / 6; regime `reg3 > 0` ("up") vs ≤ 0 ("down"). Copy-weighted across months.
Out-of-sample check: table built on 2022–2024 vs realised 2025–2026. Outputs `results/E20_chance_table.csv` (160
cells), `E20_chance_table_oos.csv`.

**Results** (3-month hold; P(net>0) / mean net / 10th–90th percentile):

| regime | discount | bottom 10 % | 10–25 % | 25–50 % | top 50 % |
|---|---|---|---|---|---|
| up | 0 % | 37 % / −2 % / −30…+30 | 32 % / −5 % | 31 % / −7 % | 27 % / −10 % |
| up | 15 % | 62 % / +16 % / −18…+53 | 62 % / +11 % | 60 % / +10 % | 51 % / +6 % |
| up | **20 %** | **74 % / +23 % / −13…+62** | 75 % / +18 % | 71 % / +17 % | 62 % / +12 % |
| down | 0 % | 20 % / −14 % | 15 % / −17 % | 12 % / −19 % | 8 % / −26 % |
| down | 15 % | 45 % / +1 % | 40 % / −3 % | 34 % / −5 % | 23 % / −12 % |
| down | 20 % | 55 % / +7 % / −22…+39 | 53 % / +4 % | 48 % / +1 % | 33 % / −7 % |

Out of sample (cells fitted on 2022–24, realised 2025–26, up regime, 3 months): bottom 10 % at 20 % under 70 % → 74 %
realised; 10–25 % 76 % → 75 %; 25–50 % 68 % → 71 %; top 50 % 56 % → 63 %. Mean absolute error of the chance across all
up-regime cells **5 points**, with the fitted table slightly *under*-stating 2025–26. (The down regime has no 2025–26
months to test on.)

**Interpretation.**
* The table says in one place what E03/E08/E10/E12 said separately: at 20 % under in an up market the deep-reversal
  buckets clear fees about three times in four with a +18–23 % mean net over 3 months; at the standard price nothing
  clears half the time; in a down market only the deepest bucket at 20 % under is better than a coin flip.
* It is stable enough to show: a 5-point error on a 74 % chance is the kind of honesty the tab's "chance" needs, and it
  needs no model file — only the ranking, the regime and the user's discount.
* The ranking bucket matters less than the discount and the regime (top-50 % vs bottom-10 % is 12 points at 20 % under;
  0 % vs 20 % discount is 37 points; down vs up is 19 points) — the same ordering as FINDINGS.

**Verdict.** *Worked*: an implementable, out-of-sample-checked chance table (`E20_chance_table.csv`) keyed by regime,
hold, discount and rank bucket. Use it in place of the standard-price classifier probabilities.
