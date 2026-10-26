# E33 / E33b / E34 / E36 / E37 / E38 / E39 / E40 — the relative reversal: a better ranking than dev12

Written 2026-10-26 (round 2). Scripts: `e33_new_reversal_variants.py`, `e33b_relative_reversal.py`,
`e34_sim_relative_reversal.py`, `e37_paired_sim.py`, `e38_dev12_decomposition.py`, `e39_lookback_variants.py`,
`e40_chance_table_rel.py` (E36 is in E26_E28_graded_market.md). Universe everywhere: $50–500, ≥ 2 sales, sets ≥ 24
months old, decision months 2022-12 … 2026-06 (24 months of history needed), 3-month hold unless stated, bought at the
standard price (`buy_real`) and at 20% under it ("net20").

## E33 — seven reversal formulations from equity and pairs trading

| signal | what | decile 3-mo gross | excess over band | P(net20 > 0) | beats dev12's decile | Fama-MacBeth t (dev12 controlled) |
|---|---|---|---|---|---|---|
| dev12 | price / 12-mo mean − 1 (incumbent) | +13.7% | +7.5 | 66.4% | — | — |
| **peerdev** | dev12 minus the mean dev12 of the same Pokémon's other printings | **+16.6%** | **+10.5** | 67.9% | **84%** of months | −5.0 (dev12 → −0.4) |
| **setdev** | dev12 minus the set's median dev12 | +15.7% | +9.5 | 69.3% | 77% | −4.5 (dev12 → +0.9) |
| dev24 | price / 24-mo mean − 1 | +15.2% | +9.1 | 69.7% | 60% | −3.1 (both survive) |
| ou3 | Ornstein–Uhlenbeck: per-card AR(1) on log(price / 12-mo mean), predicted 3-mo move | +14.2% | +8.1 | 68.3% | 60% | +2.1 (dev12 → −0.1) |
| zdev | dev12 / 12-mo volatility (Bollinger z) | +12.9% | +6.8 | 65.8% | 37% | worse |
| max12 | largest monthly gain in 12 months (MAX) | +8.9% | +2.8 | 59.7% | 19% | — |

## E38 — why: the reversal is entirely idiosyncratic

Splitting dev12 into a group component and the card's own deviation and pricing both (Fama-MacBeth, NW t):

| group | slope of the group part (t) | slope of the card's own part (t) |
|---|---|---|
| set | +0.042 (1.9) | −0.180 (−38) |
| Pokémon name | +0.019 (0.8) | −0.194 (−29) |
| set × rarity | +0.024 (1.0) | −0.179 (−32) |
| price tier | −0.013 (−2.3) | −0.150 (−12) |

When a whole set or every printing of a Pokémon falls, it does **not** snap back (if anything it keeps drifting); when
one card falls *relative to its peers*, it does. dev12 mixes both, so removing the group part sharpens the signal. This
also fits E11 (set-level moves carry no reversal or momentum once the averaging artifact is removed).

## E33b — robust by year, regime and horizon

Excess over the band (bottom decile), by year 2022 / 2023 / 2024 / 2025 / 2026:

| h | dev12 | setdev | peerdev | rel_combo |
|---|---|---|---|---|
| 1 mo | −5.4 / +2.1 / +1.1 / +2.3 / +4.7 | −2.1 / +3.0 / +1.6 / +3.7 / +4.6 | −4.6 / +2.5 / +2.5 / +3.4 / +6.6 | −2.9 / +2.5 / +2.5 / +3.6 / +5.4 |
| 3 mo | +5.5 / +9.4 / +6.3 / +7.2 / +7.3 | +8.7 / +11.3 / +7.0 / +9.8 / +10.8 | +6.5 / +8.3 / +8.1 / +12.8 / +15.5 | +7.9 / +9.5 / +8.2 / +9.8 / +12.4 |
| 6 mo | +9.3 / +13.1 / +8.6 / +10.5 / +3.7 | +9.6 / +14.8 / +9.8 / +13.1 / +16.7 | +8.0 / +12.6 / +12.6 / +20.0 / +22.6 | +8.3 / +13.6 / +11.6 / +13.5 / +18.4 |

rel_combo = mean of rank(setdev) and rank(peerdev); setdev alone for the 28% of band cards with fewer than 2 other same-name printings.
3 months: P(net20 > 0) 69.0% vs dev12 66.4% (up regime 78.1% vs 75.5%; net20 +25.8% vs +22.3%); excess positive in
100% of months for every variant. 6 months: net20 +31.6% vs +28.5%.

## E33d — liquid cards (`e33d_liquid_cards.py`)

Same bottom-decile test at 3 months, restricted by this month's sales count (more sales = PriceCharting's monthly price
is built from more real sales, less estimation noise and less room for the E33c lag):

| sales in the month | band cards / month | dev12 excess | rel_combo excess | setdev excess | P(net20 > 0) dev12 / rel_combo | rel_combo beats dev12's decile |
|---|---|---|---|---|---|---|
| ≥ 2 | 733 | +7.5 | +9.6 | +9.5 | 66.4% / 69.0% | 79% of months |
| ≥ 5 | 618 | +7.2 | +8.8 | +9.2 | 68.5% / 69.9% | 72% |
| ≥ 10 | 428 | +6.8 | +9.7 | +9.2 | 69.7% / 72.3% | 72% |

Among the most liquid cards dev12's decile beats the band in 88% of months and rel_combo's in 100%. The relative
reversal's edge is not a thin-card artifact.

## E34 / E37 — inside the reinvesting portfolio

E34 (E10 engine, each rule with its own random availability draws) pointed the same way but within ±10–15% draw noise.
E37 removes the noise with **common random numbers** (every rule sees the same 20 availability draws):

| hold | buy | gate | dev12 final ($5k start) | rel_combo final | paired gain | draws better | t |
|---|---|---|---|---|---|---|---|
| 2 mo | 20% under, 12% avail. | none | $17,412 | $18,331 | +$919 | 100% | 8.2 |
| 2 mo | 20% under | reg3>0 | $16,972 | $17,908 | +$936 | 100% | 10.6 |
| 2 mo | 15% under, 25% avail. | none | $7,880 | $9,377 | +$1,497 | 100% | 8.0 |
| 2 mo | 15% under | reg3>0 | $11,222 | $12,788 | +$1,566 | 100% | 14.5 |
| 3 mo | 20% under | none | $16,540 | $17,321 | +$780 | 100% | 10.8 |
| 3 mo | 20% under | reg3>0 | $15,580 | $16,406 | +$826 | 100% | 12.8 |
| 3 mo | 15% under | none | $10,509 | $11,854 | +$1,346 | 100% | 13.9 |
| 3 mo | 15% under | reg3>0 | $12,112 | $13,296 | +$1,184 | 100% | 15.0 |

+0.7 to +4.2 CAGR points, largest where the discount is thinner (15% under), i.e. where ranking matters most. setdev
alone beats dev12 in 85–100% of draws. The gain is smaller than at the decile level because the simulated buyer goes deep
down the ranking (E17's dilution).

## E39 — lookback

setdev24 (+16.3%, P(net20 > 0) 70.8%) ≥ setdev18 (+15.9%) ≥ setdev12 (+15.7%, 69.3%) ≫ setdev6 (+12.0%); setdev12 and
setdev24 each survive the other (FM t −5.7 / −2.5). A 12 + 24-month blend is the natural refinement; 6 months is too short.

## E40 — the chance table on rel_combo (drop-in for E20)

Up regime, 3 months: 20% under — bottom10 76.2% / mean net +26.7% (E20: 74% / +23%), 10–25% 75.7%, 25–50% 72.7%,
top50 60.8%; 15% under — bottom10 66.0% (E20 62%); standard price — bottom10 41.9% (E20 37%). Down regime, 20% under —
bottom10 56.2%. Out of sample (fit 2022–24 → 2025–26, up regime) mean absolute chance error 5.6 points (E20: 5).
`results/E40_chance_table_rel.csv` has every cell (1/2/3/6 months, 0–25% discounts).

## Caveat

Everything here is measured on PriceCharting prices; read E33c (PriceCharting can lag eBay for hot cards). The relative
reversal held on PriceCharting's *daily* prices in October (setdev IC −0.15 vs dev12 −0.06) but not on the 290 cards
with eBay sales in that window.

## Later work
- (empty)
