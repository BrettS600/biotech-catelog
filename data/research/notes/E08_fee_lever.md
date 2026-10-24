# E08 — The fee lever: friction is worth more than any signal

**Question.** How much do P(net>0) and mean net change under alternative fee structures and buy discounts, holding the
realised return distribution fixed? Which lever is biggest: a better signal, a cheaper channel, or a lower buy?

**Method.** `scripts/e08_fee_lever.py`. Realised 1- and 3-month gross returns inside $50–$500 (sales ≥ 2, 2022-01 …),
two selections (the whole band; the E03 best pick = dev12 bottom decile in strong regimes), seven sell-side cost
structures × five buy discounts (0 / 10 / 15 / 20 / 25 % under the standard price).
Fee facts (`sources.md`): eBay trading-card final value fee 13.25 % (non-store) vs **12.35 % with a Basic-or-above
Store subscription** (eBay seller update Jan 2025); per-order fee $0.40 (orders > $10); the site adds 6.5 % tax on the
fee, $4.50 outbound shipping, $0.30 supplies. eBay has also run 50 %-off-FVF promotions for singles ≥ $1,000.

**Results** (`results/E08_fee_lever.csv`) — 3-month hold, dev12-bottom in strong regimes (1,469 card-months, gross
mean +24 %):

| sell-side structure | buy at standard: mean net / P(net>0) | bought 20 % under: mean net / P(net>0) |
|---|---|---|
| base (13.25 % ×1.065 + $5.20) | −0.9 % / 38 % | **+23.8 % / 72 %** |
| store rate 12.35 % | +0.2 % / 40 % | +25.3 % / 74 % |
| buyer pays shipping (−$4.50) | +3.7 % / 44 % | +29.6 % / 80 % |
| store + buyer ships | +4.8 % / 45 % | +31.0 % / 82 % |
| TCGplayer-like (10.25 % + 2.5 % + $0.30 + $4.50) | +1.1 % / 41 % | +26.4 % / 75 % |
| zero (cash / local) | +21.5 % / 70 % | +51.9 % / 95 % |

Whole band, 3 months: standard price −12.7 % / 23 %; 20 % under +9.1 % / 58 %; 20 % under + store + buyer ships
+16.5 % / 71 %. 1-month hold, dev12-bottom-strong: standard −13.4 % / 15 %; 20 % under +8.3 % / 58 %; 20 % under +
store + buyer ships +15.3 % / 77 %.

**Interpretation.**
* Each point of discount at the buy is worth about 1.3 points of net return at the sale (because the proceeds are
  compared with a smaller base). **A 20 % discount moves a break-even selection to +24 % net — no signal in E02–E06
  comes close to that.**
* The $4.50 shipping line is worth ~5 points of net on a $100 card at a 1–3-month hold; the Store rate ~1 point (a Basic
  Store costs ~$22/month, so it pays at ≈ $2,400/month of sales). Both are decisions, not forecasts.
* Selling off-eBay (cash, local, trade) is the only structure where a standard-price 3-month hold has positive
  expectation — relevant for a fraction of inventory, not a scalable channel.

**Verdict.** *Worked*: ranked the levers — (1) buy discount, (2) shipping passed to the buyer, (3) store rate — all
larger than selection beyond the reversal rule. The Forecast tab already takes a discount input; its default should
reflect what the collector actually sees (E07: 12 % of cards at ≥20 % under), not 0.
