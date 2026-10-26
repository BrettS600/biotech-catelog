# E29 / E30 — grading arbitrage and where to buy

Written 2026-10-26 (round 2). Scripts: `e29_grading_ev.py`, `e30_buy_channels.py`. Data: the newest day of
`pricecharting/daily/`, `cards.csv.gz`; PSA's 2026 price list and gem rates from the web (sources.md).

## E29 — buy raw, grade with PSA, sell the slab

PriceCharting's grade columns for a card: PSA 10 = `manual-only-price`, grade 9 = `graded-price`, grade 8 = `new-price`,
grade 7 = `cib-price`. Costs: the raw price (or 15% under), PSA Regular **$79.99** per card (the $24.99–64.99 Value tiers
have been paused in 2026; Regular turnaround 70–80 business days), $6 per card shipping/insurance both ways, slab resale on
eBay with the fee model and $8 shipping, ~4.5 months from purchase to sale. Grade ≤ 6 sells as raw.

Grade mixes (share landing at 10 / 9 / 8 / 7 / ≤6): modern pack-fresh .55/.33/.08/.03/.01 (PSA 2025: TCG gem rate 50%,
2020s cards 59%); **modern bought raw on eBay** .30/.45/.15/.07/.03 (the best copies were already submitted by their
owners); vintage optimistic .08/.30/.30/.20/.12; **vintage realistic** .02/.12/.25/.25/.36.

Liquid cards (≥ 100 PriceCharting sales a year), no discount:

| scenario | PSA fee | cards | share EV > 0 | median ROI | top-decile ROI | median ROI per month |
|---|---|---|---|---|---|---|
| modern bought raw | $79.99 | 793 | 12% | −48% | +6% | −10.8% |
| modern bought raw | $24.99 | 793 | 44% | −6% | +92% | −1.4% |
| modern pack-fresh | $79.99 | 793 | 32% | −24% | +68% | −5.4% |
| modern pack-fresh | $24.99 | 793 | 75% | +33% | +219% | +7.4% |
| vintage realistic | $79.99 | 1,427 | 54% | +15% | +220% | +3.2% |
| vintage optimistic | $79.99 | 1,427 | 78% | +145% | +694% | +32% |

Break-even PSA 10 rate for modern cards bought raw (Regular fee): median 109% ($10–25: impossible), 78% ($25–50), 71%
($50–100), 55% ($100–250), 35% ($250–500), 18% ($500–1,000) — so grading only pays on expensive modern cards with very
high gem odds. For vintage, PriceCharting prices a PSA 7–8 far above the *average* ungraded copy, so the share of copies
that must come back 9+ to break even is tiny ($100–250: 3%) — but that is the trap: the ungraded price is an average of
mostly played copies, and a copy that will grade 7+ costs well above it. The data cannot measure the condition premium.

**Verdict.** Not a 1–3-month business: capital is locked 4–5 months, the outcome is a gem-rate lottery, the cheap tiers
are paused, and PSA upcharges when the graded value exceeds the tier's cap. Worth revisiting only with (1) Brett's own
measured gem rates on cards he has inspected in hand (backlog B18) and (2) a Value tier back at ≤ $25.

## E30 — the buying channel decides most of the profit

Buying multiple of the market price for each channel; resold on eBay at market (fee model); no price move:

| channel (buy multiple) | $25 | $50 | $100 | $250 | $500 |
|---|---|---|---|---|---|
| card shop / retail (1.10×) | −41% | −31% | −27% | −24% | −23% |
| eBay at market (1.00×) | −35% | −25% | −19% | −16% | −15% |
| eBay floor 15% under | −23% | −11% | −5% | −1% | 0% |
| eBay floor 20% under | −19% | −6% | +1% | +5% | +6% |
| private seller, halfway to the dealer-buy price | −10% | +5% | +4% | +8% | +2% |
| private seller at what a shop would pay (44–66%) | +48% | +72% | +47% | +52% | +29% |

Break-even market move when buying retail: +52% ($25) … +29% ($500), vs +41% … +18% buying on eBay at market.

**Verdict.** Buying from a shop (or anywhere at full retail) to resell on eBay is a guaranteed loss before any price
move. The edge in this business is the purchase price: deep eBay floors (E07: ~12% of band cards have a credible floor
≥ 20% under the median) and private / collection purchases (Facebook Marketplace, local sellers, collection buys at or
near shop-buy levels) clear the fee wall without any forecast at all. The Forecast tab's job is to say which cards to
hunt at those prices and when the market is safe (gate).

Sealed product at MSRP (web, not testable here): trade press cites +35–60% on hyped ETBs/booster products within weeks
and 30–90% over 12–18 months, with reprint risk and 13% fees; nothing in `data/` covers sealed prices yet (PokéViews has
a sealed index that is not archived — backlog B20).

## Later work
- (empty)
