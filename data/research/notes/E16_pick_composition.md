# E16 — What the reversal rule actually buys

**Question.** Composition of the dev12-bottom-decile picks ($50–$500, sets ≥ 24 months, 2022-01 … 2026-10; 4,577
pick-months) by price tier, set age, sales count, rarity and set — concentration risk, and which groups pay (3-month
hold, bought 20 % under).

**Method.** `scripts/e16_pick_composition.py`. Outputs `results/E16_pick_composition.csv`, `E16_current_picks.csv`
(the 197 picks for 2026-10, for eyeballing).

**Results.**
* **Price tier**: 57 % of picks are $50–100, 33 % $100–250, 10 % $250–500. Outcome improves with price: gross +14.8 % /
  +14.9 % / +16.6 %, P(net>0 at 20 % off) **63 % / 71 % / 77 %** (the fixed $5.20 and the slightly deeper reversion of
  pricier cards).
* **Set age**: 65 % of picks are 15-year-plus sets (WotC / e-series: Skyridge 10 %, Base Set 8 %, Neo Destiny 6 %,
  Legendary Collection, Aquapolis, Expedition …), 13 % 8–15 y, 9 % 4–8 y, 3 % 2–4 y. Outcome: 15 y+ **+17 % gross, 69 %**;
  8–15 y +12 % / 62 %; 4–8 y +7 % / 66 %; 2–4 y +4 % / 51 %. The rule is, in practice, a vintage-dip buyer.
* **Sales count**: picks with 2–4 monthly sales (25 % of picks) pay least reliably — P(net20>0) **60 %** vs 64 % (5–9),
  **72 % (10–24)**, 70 % (25+). Thin cards carry the estimator noise and the odd mis-catalogued item (the 2026-10 list
  has a Topps Chrome "Primeape [Tekno]" and a "Dark Persian [No HP]" error card on 4 sales each). A sales ≥ 5 (better ≥ 10)
  filter costs a quarter of the candidates and raises the hit rate ~8 points.
* **Rarity**: Holo Rare 34 %, Ultra Rare 23 %, Secret Rare 12 %; **Promo cards (7 %) are the weak group** — +8 % gross,
  55 % — the "Pokemon Promo" set is a grab-bag of items with poor comparables. Commons / Rare Holos (vintage) do best.
* **Concentration**: a month's picks have on average 17 % in their single most common set; no month is one set's crash.
  Skyridge is the most frequent set overall (10 %) with a middling outcome (+11 %, 63 %).

**Interpretation.** The reversal rule is buying dipped vintage holos and modern ultra rares with real sales history. Two
cheap filters raise its reliability: **sales ≥ 5–10 in the decision month** and **exclude the Promo set** (or require
sales ≥ 10 there). Price tier is a trade-off: $250–500 cards pay more reliably but limit diversification for a $2–5k
bankroll (E12 wants ≥ 20 positions), so the $100–250 tier is the practical core.

**Check in the simulation** (`dev12f` rule in `e10_portfolio_sim.py` = dev12 with sales ≥ 5 and no Promo set, averaged
over 5 availability draws): the filters do **not** improve the portfolio outcome — at 3 months final wealth is 2–18 %
lower in every configuration (20 % under / 12 % availability: $15.5k vs $17.4k ungated, $14.6k vs $15.6k gated; 15 %
under: $10.1k vs $12.6k) and losing-cycle shares are unchanged; at 1 month they are a wash (±10 %). Fewer candidates means
less of the money finds a discounted card, and the thin vintage cards' higher gross offsets their lower hit rate once
20+ of them are held.

**Verdict.** *Worked*: composition is sane and diversified; vintage is where the reversal lives. *Did not help*: the
sales ≥ 5 / no-Promo filters at the portfolio level (keep them as display warnings, not hard exclusions).
