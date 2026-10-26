# E26 / E26b / E28 / E36 / E42 — the PSA 10 market: graded vs raw, graded leads raw, and timing

Written 2026-10-26 (round 2). Data: `pokeviews/graded_index.csv` (Top 250 Graded, PSA 10), `graded_index_by_era.csv`
(PSA 10, top 50 per era), `era_performance.csv` (ungraded, top 50 per era), `results/E01_market_monthly.csv`, the five
Google Trends files. Scripts: `e26_graded_vs_raw.py`, `e26b_graded_leads_raw.py`, `e28_gate_with_graded.py`,
`e36_sim_gates_graded.py`, `e42_graded_hot_months.py`.

**Index caveat that applies to everything here.** PokéViews' indexes re-select the top N cards every month and draw a
PCHIP curve between month starts. Only month-start values are observations (all scripts use only those). A re-selected
top-N basket is an upper bound for buying and holding the same cards, and month-start values built from PriceCharting
prices inherit the monthly-averaging persistence found in E11. Both the graded and the raw era indexes are built the same
way, so comparing them is fair; their levels are not a buyable return.

## E26 — graded vs raw by era (2022-01 … 2026-10)

| era | total, raw | total, PSA 10 | 3-mo mean gross raw / PSA 10 | P(3-mo gross > 0) raw / PSA 10 | 3-mo net raw / PSA 10 | P(net > 0) raw / PSA 10 | monthly vol raw / PSA 10 |
|---|---|---|---|---|---|---|---|
| Vintage | +192% | +305% | +5.7% / +8.5% | 75% / 55% | −10.5% / −7.2% | 13% / 33% | 5.2% / 5.2% |
| Classic | +348% | +541% | +9.2% / +11.4% | 78% / 53% | −7.4% / −4.8% | 24% / 33% | 5.9% / 6.4% |
| Mid Era | +304% | +1,271% | +7.8% / +15.7% | 80% / 71% | −12.4% / −1.8% | 13% / 31% | 3.8% / 8.2% |
| Modern | +402% | +629% | +10.1% / +13.7% | 73% / 62% | −9.5% / −4.4% | 24% / 31% | 5.9% / 7.9% |

Net = eBay fee model at the era's average constituent price; graded adds $20 insured slab shipping. The top-50 PSA 10
slab averages $1,500–6,300, so the fixed costs vanish in percentage terms, which is why graded nets better.

**Reading.** In this boom, PSA 10 outran raw in every era, with more skew (fewer up quarters, bigger up quarters) and
more volatility. For a $2,000–10,000 bankroll this does not translate into a strategy: one top-50 slab is a fifth to all
of the money, so there is no diversification (E12: one position has ~40% chance of a losing quarter), and the index
gains come from a basket that keeps rotating into whatever just rose. What it does say: the graded market is where the
momentum has been, and it pulls raw along (E26b).

## E26b — graded leads raw (pooled 4-era panel, month starts, cluster-robust by month)

| model | coef (t) |
|---|---|
| raw next month ~ raw last month | 0.34 (3.9), R² 0.12 |
| raw next month ~ raw last + PSA 10 last | raw 0.13 (1.7), **PSA 10 0.31 (6.7)**, R² 0.24 |
| raw next 3 ~ raw last 3 + (PSA 10 − raw) gap last 3 | gap 0.19 (2.8) |
| PSA 10 next month ~ PSA 10 last + raw last | PSA 10 0.62 (8.3), raw 0.26 (4.7) |

Last month's PSA 10 move carries more information about next month's raw move than raw's own last month. The link runs
both ways (raw also leads PSA 10), consistent with one market where raw copies are the input to grading. Card-level
confirmation is in E27 (the PSA 10 / raw ratio predicts raw moves, on eBay's own prices too).

## E28 — market timing with the new data (target: E01 market median move)

| target | model | in-sample R² | leave-one-year-out R² | t of the addition |
|---|---|---|---|---|
| next month | reg1 | 0.49 | 0.42 | |
| next month | reg1 + graded1 | 0.58 | **0.55** | 4.5 |
| next month | reg1 + graded1 + web search | 0.65 | **0.60** | 5.2 / 3.9 |
| next month | reg1 + image / news / shopping / YouTube | | 0.50 / 0.29 / 0.45 / 0.40 | 2.1 / 0.8 / 0.5 / 0.2 |
| next 3 months | reg3 | 0.48 | 0.44 | |
| next 3 months | reg3 + web search | 0.59 | **0.55** | 6.9 |
| next 3 months | reg3 + graded1 | 0.53 | 0.39 | 3.2 (does not hold out of sample) |
| next 3 months | reg3 + YouTube | 0.54 | 0.48 | 2.7 |

graded1 = Top 250 Graded index, 1st of next month / 1st of this month − 1 (known at month end).

Gate sign accuracy on the next quarter (55 months): reg3>0 90.9% (on 40% of months, next quarter positive 95%);
**reg3>0 & graded1>0 92.7%** (on 38%, positive 21/21 = 100%); graded1>0 alone 83.6%.

## E36 — does the graded-confirmed gate improve the reinvesting simulation?

E10's engine, $5,000, 5 draws: no. Differences are within draw noise (2-month dev12 at 20% under: $18.2k with the graded
confirm vs $17.1k without; 3-month rel_combo $17.6k vs $16.6k; elsewhere slightly lower), the confirm skips ~2% more
months, and graded1>0 *alone* as a gate leaves 10–20% losing cycles (vs 0–5% for reg3>0). **Keep reg3>0 as the gate**;
show graded1 beside it and use it as a 1-month confirm (E28's biggest gain is at the 1-month horizon).

## E42 — what followed the PSA 10 market's hottest months

Months with a graded 1-month gain in the top fifth and ≥ +10% (8 months: 2025-07, 2025-08, 2026-03, 2026-05, 2026-06,
2026-07, 2026-09, 2026-10): next 3 months graded +35% (others +7%), raw era indexes +18.5% (others +7%), next 6 months
graded +59%, raw +29%; **none** of the 8 was followed by a negative quarter. All eight sit in one boom, and the
construction caveat above inflates persistence. Read it as "the trend is intact and graded strength has been good for
raw", not as protection against a bust (the sample contains no graded bust).

## Current reading (end of October 2026)

reg1 +2.2% (October, partial), reg3 ≈ +1.4%, Top 250 Graded +33% in a month (all-time high on 10-25, +258% in a year),
raw PV250 +1.3% in 30 days, Google web-search interest 89 (September 94). Gate green; the graded leg says next month's
raw market should be positive; the graded market itself is at an extreme that has no precedent in the sample.

## Later work
- Re-run E28 and E42 after the first graded month below −5% (a down month is missing from the sample).
