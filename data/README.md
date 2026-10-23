# The data folder

Everything an analysis of this market may need, kept in the repository so it can start at once instead of being
collected again (Brett, 2026-10-23). Four sources, four sub-folders:

| folder | what | grain | refreshed by |
|---|---|---|---|
| `pokeviews/` | PokéViews' market indexes and indicators (the numbers behind their charts) | one row per day (or per day × series / set) | the Data archive workflow, daily |
| `pricecharting/` | the collector's PriceCharting history: ungraded price and sales volume per card per month since Dec 2020 (~2.3M card-months) | card × month | the Data archive workflow, the 2nd of each month (or a manual run with full = true) |
| `ebay/` | the eBay Catalog tab's figures for every card with eBay data, as the collector published them, one file per day; and the collector's per-card daily rollup | card × day | the Data archive workflow, daily (the rollup: monthly) |
| `google_trends/` | Google Trends interest for the search term "pokemon cards", five Google properties, monthly since 2004 / 2008 | month | Brett downloads the files from Google Trends |

The workflow is `.github/workflows/data_archive.yml`, the script `data_archive.py` (repo root). `last_run.json` here says what
the last run did; `pokeviews/manifest.json` records every feed's URL, row count and date span. Nothing in this folder is
encrypted - the repository is private. The PokéViews numbers are PokéViews' (their feeds are read as their own charts read
them); the Google Trends numbers are Google's; the PriceCharting prices are PriceCharting's data read off each card's
page by the collector. None of it is for redistribution.

Loading (pandas):

```python
import pandas as pd, glob
pv = pd.read_csv("data/pokeviews/top100_index.csv", parse_dates=["date"])
pc = pd.concat(pd.read_csv(f) for f in sorted(glob.glob("data/pricecharting/pc_monthly_*.csv.gz")))   # 2.3M rows
cards = pd.read_csv("data/pricecharting/cards.csv.gz")
ebay = pd.read_csv("data/ebay/catalog/2026-10-23.csv.gz")
trends = pd.read_csv("data/google_trends/pokemon_cards_interest.csv")
```

---

## pokeviews/

Source: the JSON feeds at `https://storage.googleapis.com/pokeviews-prod/...` that pokeviews.com's charts load (the
exact URL of each is in `manifest.json`). Every column of every feed is kept, in the feed's own names; floats are
rounded to 6 decimals; `null` is an empty cell. The index and indicator feeds carry, besides the plotted series, the
site's headline figures for each day (`value_1d_ago`, `value_7d_ago`, `change_7d_pct`, `ath_price`, `ath_date`, ... -
the value 1 / 7 / 30 days earlier, the percentage changes, the all-time high / low and their dates as of that row).
The site's own explanations of every index and indicator, copied from pokeviews.com, are at the end of this file.

| file | rows | one row per | key columns |
|---|---|---|---|
| `top100_index.csv` | daily from 2024-04-01 | day | `index_value` (PV100, base 100 on 2024-04-01), `ema_30d`, `ema_90d`, `sma_200d` (the chart's EMA-30 / EMA-90 / MA-200), `bb_upper_20d` / `bb_lower_20d` (Bands), `rsi_14d` (the chart's RSI), `rsi_percentile`, `n_constituents` (eligible universe), `n_contributing` (cards in the index) |
| `top250_index.csv` | daily from 2024-04-01 | day | the same columns for the PV250 |
| `top100_constituents.csv`, `top250_constituents.csv` | 100 / 250 | card | the current month's members: `card_name`, `card_number`, `set_name`, `series_name`, `rank_in_month`, `market_price` (TCGplayer), `change_30d_pct`, `cohort_month` (the rebalancing month) |
| `top100_series_composition.csv`, `top250_series_composition.csv` | ~15 | series | how many members come from each series (`card_count`, `percentage`) |
| `hot_cold_index.csv` | daily from 2024-05-01 | day | `gauge` = the Hot & Cold Index as the page shows it (the dial, the chart's HCI line, the Historical Values and the 52-week high / low are the `gauge*` columns: checked 2026-10-23, 43.32 / 42.53 / 44.47 / 53.51 / 86.20 / 23.29); `display_score` is a second scoring of the same inputs that the feed carries but the page does not show. The five components as fractions 0-1: `pv250_trend` (PV250 vs its 30-day EMA), `mms_all`, `mms_100plus` (Market Momentum, all cards / $100+ cards), `new_highs`, `new_highs_50plus` (share at a 30-day high, all / $50+), each with its normalized `_signal` (0-1); `pv250_value`, `pv250_ema_30d` |
| `market_momentum.csv` | daily from 2024-03 | day | `pct_above_30d` = Market Momentum Score (% of eligible cards above their 30-day moving average), `count_above`, `count_total`, and the same per price tier: `*_tier_1_10` ($1-10), `*_tier_10_50`, `*_tier_50_100`, `*_tier_100_200`, `*_tier_200_plus` |
| `new_highs_lows.csv` | daily from 2024-03 | day | `pct_at_30d_high`, `pct_at_30d_low` (% of eligible cards at a 30-day high / low), `count_at_30d_high`, `count_at_30d_low`, `count_total`; the same for cards $50+: `pct_at_30d_high_50plus`, `pct_at_30d_low_50plus`, ... |
| `pokemon_vs_assets.csv` | daily from 2024-04-01 | day | `pv250_index`, `spx_index`, `gold_index`, `btc_index` - the PV250, the S&P 500, gold (GLD) and bitcoin, each rebased to 100 on 2024-04-01; returns and ranks over 30 days / 52 weeks / all time (`*_return_30d`, `*_rank_30d`, ...) |
| `asset_correlation.csv` | 8 × 8 per aggregation × window | asset pair | Pearson correlation of returns between Top 100, Top 250, Charizard ex (#199 SV151), Fusion Strike booster box, S&P 500, Gold, Bitcoin, Ethereum: `aggregation` (daily / weekly / monthly returns), `window` (30d / 90d / 1y / all), `correlation`; `last_updated` |
| `trend_extension.csv` | daily from 2024-04-01 | day | PV250 `index_value`, `ema_90d`, `sma_200d`, `distance_from_ema90`, `distance_from_sma200` (% above / below each average - the chart's two lines), `pct_above_ema90`, `pct_above_sma200`, 52-week extremes of each distance |
| `era_performance.csv` | daily from 2022-01-01 | day | for each of the five eras (`vintage_`, `classic_`, `mid_era_`, `modern_`, `contemporary_`): `*_index_value` = the equal-weighted average price in dollars of the era's top 50 ungraded cards (PriceCharting prices), `*_return_30d`, `*_return_52w`, `*_rank_52w`, `*_return_all_time`, `*_rank_all_time`, `*_n_contributing` |
| `series_performance.csv.gz` | ~23,000 (15 series × daily from 2022-01-01) | day × series | `series_name`, `index_value` = the average price in dollars of the series' top 25 ungraded cards, `data_source` (`monthly` = a rebalancing point on the 1st, `interpolated` = PCHIP between points, `daily_current` = today), `n_contributing`, `index_rank` (among series), `return_52w`, `rank_52w`, `return_all_time`, `rank_all_time` |
| `series_constituents.csv` | 375 | card | the 25 cards per series this month, with `pricecharting_id` (matches `card_id` in `pricecharting/`), `ungraded_price`, `price_rank`, `change_30d_pct`, `cohort_month` |
| `set_performance.csv.gz` | ~230,000 (132 sets × daily from 2022-01-01) | day × set | `series_name`, `set_name`, `index_value` = the average price in dollars of the set's top 10 ungraded cards, `data_source`, `n_contributing`, `index_rank` (among sets), `return_52w`, `rank_52w`, `return_all_time`, `rank_all_time`. The site serves one feed per series; they are combined here. |
| `set_constituents.csv` | ~1,300 | card | the 10 cards per set this month (`pricecharting_id`, `set_name`, `series_name`, `ungraded_price`, `price_rank`, `change_30d_pct`, `cohort_month`) |

Checks made on 2026-10-23 against the charts: every right-axis label on the Top 100 chart (PV100 266.84, Bands
269.25 / 266.23, EMA-30 267.88, MA-200 254.90, RSI 32.77) equals the feed's last row, and recomputing a 30-day EMA from
`index_value` reproduces `ema_30d` to 6e-7. The chart's RSI is `rsi_14d`, not `rsi_percentile`. The Top 100 feed misses
five days (2026-04-21, 07-26, 08-27, 09-16, 09-17); the charts draw across them.

---

## pricecharting/

Source: the collector's PriceCharting history - the monthly series it reads off every card's PriceCharting page
(`pc/<shard>.bin` on the `live` branch, encrypted there; `history_read` in `cards.csv.gz` is the day a card's page was
last read). The catalog comes from the newest daily snapshot (`pc_catalog_<date>.csv.gz.enc` on the snapshots release).

`pc_monthly_<year>.csv.gz` - one file per calendar year, together ~2.3M rows:

| column | meaning |
|---|---|
| `card_id` | PriceCharting's product id (the catalog's `id`; the site links to pricecharting.com/game/<id>) |
| `month` | `YYYY-MM` |
| `price` | the ungraded ("loose") price PriceCharting printed for that month, in dollars; empty when the page had no price for the month |
| `sales` | PriceCharting's count of sales in that month (its volume bar, every grade); empty for cards whose page carries no volume series |

The first month is 2020-12; a card's series starts when PriceCharting's chart does. The model (forecast.py) uses exactly
this panel; what it found about it is in CLAUDE.md (THE FORECAST TAB).

`cards.csv.gz` - one row per catalog card (~44,000): `card_id`, `name`, `set`, `number`, `rarity`, `finish`,
`release_date`, `price_now` (ungraded price in the snapshot), `sales_year` (PriceCharting's trailing-year sales),
`history_months` (months of history on file), `history_from` (first month), `history_read` (the page's last read).

---

## ebay/

Source: the collector's live file (`ebay_live.bin` on the `live` branch) - the figures behind the site's eBay Catalog
tab, computed by `compute_stats()` in `ebay_sweep.py` from the listings the collector follows on eBay (US, English,
ungraded, fixed price, $25-500, the card matched to a PriceCharting id). The collector has recorded since 2026-09-28.

`catalog/<date>.csv.gz` - one file per day, one row per card with eBay data (~6,400). Prices are "totals" (item +
shipping), NM-equivalent (LP copies lifted by the LP discount `lpd`); the 30-day window is the collector's `window`.

| column | meaning |
|---|---|
| `card_id`, `name`, `set`, `number` | the PriceCharting card (names from the newest snapshot) |
| `as_of` | when the collector published the live file |
| `price` | the card's eBay price level: the sold anchor `A`, else the cheapest ask, else the sold median |
| `k` | comparable sales caught in the 30-day window (NM/LP, not suspect, right card) |
| `D` | days the card has been observed inside the window (≤ 30) |
| `lam` | demand: sales per day (the 25th percentile of a gamma posterior on `k` / `D`; empty with no sales) |
| `N` | copies listed now (the book: comparable open listings) |
| `p1`, `p2`, `p3` | the three cheapest effective asks (Best Offer listings at 90%) |
| `n30` | listings of the card first seen in the last 30 days (the Hit % denominator) |
| `km`, `kt` | sales in the previous calendar month / in the current month so far (from the daily rollup) |
| `mu` | new listings per day; `dos` = days of supply (`N` / `lam`); `io` = inflow / outflow (`mu` / `lam`) |
| `smed`, `s80` | median and 80th percentile of the last 10 sold totals |
| `hrs` | median hours from listing to sale, last 10 sales |
| `st` | 48-hour sell-through, % of listings first seen 3-33 days ago that sold within 48 h (empty under 3 listings) |
| `A`, `A_n`, `A_win`, `A_fast` | the sold anchor: a trimmed, recency-weighted center of the comparable sales in the last 30 days (widened to 60 when fewer than 5), the number of sales behind it, the window used, and the median of the fast (≤ 48 h) sales |
| `L` | the credible floor: the cheapest ask from a credible seller (feedback, not suspect, not stale, not under 75% of `A`) |
| `S` | the collector's sell price: min(`L` − undercut, 95% of `A`), capped by `A_fast`; 93% of `A` with no floor |
| `liquid` | 1 when `lam` and `st` clear the collector's liquidity bar for a 48-hour window at 70% confidence |
| `basis`, `csell` | `sell` when `S` exists; the sell price the gate used |
| `probT` | % chance of at least one sale inside the 48-hour window at `lam` |
| `edays` | days at the front of the book needed to reach the 70% confidence |
| `net`, `maxbuy` | expected net at `csell` after eBay's fee, label, supplies and buying tax; the most to pay for a 10% margin |
| `hot`, `confirm` | 0 / 1 candidate / 2 confirmed hot card; confirmations so far |
| `pc`, `pcv` | PriceCharting's ungraded price and trailing-year sales for the card |
| `lpd` | the LP discount (%) applied to lightly-played copies at this price tier |
| `tr_spm` | eBay sales in the last 30 days (from the rollup) |
| `tr_d7`, `tr_d30` | % change of the 7-day median sold total vs 7 / 30 days ago (`tr_d30` needs 31 days of history) |
| `tr_pos`, `tr_hi`, `tr_lo` | where today's 7-day median sits in its 90-day range (0-100 %), and that range (needs 60 days) |
| `tr_vol` | typical daily move of the 7-day median, % (needs 3 moves) |
| `tr_ts`, `tr_tsq1`, `tr_tsq3` | Theil-Sen slope of the 7-day median over the last 30 days, %/month, with its quartiles (needs 10 priced days spanning two weeks) |
| `tr_vd`, `tr_vdp` | volume drift: sales in the last 30 days minus the 30 before, and in % (needs 60 days) |
| `tr_days` | days of eBay history for the card (from its first day in the rollup) |
| `cred_n`, `cred_min` | credible asks on the book (≤ 5) and the cheapest of them |
| `book_n`, `sold_n` | listings in the published book (≤ 8) and sales in the published sold list (≤ 10) |
| `checks_failed` | hot-card checks the card fails (`sales`, `sellthru`, `fast`, `realized`, `trend`) |
| `reprint_cut` | for a card with a cheaper anniversary reprint of the same number: the price under which a listing is taken for the reprint |
| `rollup_start`, `rollup_days` | the card's first day in the daily rollup and the days since |
| `sales_today`, `price7_today`, `ask_today`, `new_today` | today's rollup cell: sales caught today, the 7-day median sold total (needs 3 sales in the window), the cheapest comparable ask, new listings seen today |

`daily_rollup.csv.gz` - the collector's per-card daily rollup for the 120 days it keeps (rewritten monthly; the daily
catalog files carry each day's cell as it happens):

| column | meaning |
|---|---|
| `card_id`, `date` | |
| `sales` | comparable sales caught that day; `sold_totals` = their totals, `|`-separated, NM-equivalent |
| `price_7d_median` | the median of the sold totals in the trailing 7 days, when there were 3+ |
| `cheapest_ask` | the cheapest comparable ask seen that day |
| `new_listings` | listings of the card first seen that day |

---

## google_trends/

Source: Google Trends, search term "pokemon cards", worldwide, monthly, downloaded by Brett on 2026-10-23. Each file is
Google's "interest over time" for one property: `web_search.csv` (Google web search, from 2004-01), `image_search.csv`,
`news_search.csv`, `google_shopping.csv`, `youtube_search.csv` (from 2008-01). The number is Google's index: 100 = the
month of peak interest within that file, 50 = half as much, 0 = too little data. The files are not comparable in level
with each other (each is scaled to its own peak), only in shape. `pokemon_cards_interest.csv` is the five side by side,
one row per month.

---

## PokéViews' own descriptions

Copied from pokeviews.com by Brett on 2026-10-23, so the numbers above can be read the way the site means them.

### Top 100 Index

**What is the PokéViews Top 100 Index?** The PokéViews Top 100 Index (PV100) is an equal-weighted benchmark designed to measure the performance of the top 100 English Pokémon trading cards ranked by market price. The index rebalances monthly and excludes cards that do not meet minimum liquidity thresholds, as well as sealed products, graded cards, and non-English releases. The PV100 represents the premium tier of the Pokémon TCG market, tracking the most valuable and actively traded ungraded cards. It is a reference index, not currently an investable product. PokeViews does not offer investment advice.

**Methodology.** Constituent Selection: Includes the top 100 English Pokémon trading cards ranked by market price, meeting minimum liquidity thresholds and price history requirements (≥ 30 days). Excludes sealed products, graded cards, and non-English releases. Weighting Method: Equal-weighted. Rebalancing: Conducted monthly on the first trading day of each month. Currency: Calculations are performed in USD. Calculation Frequency: Index levels are updated daily based on TCGplayer market price data.

**Why it matters.** The PokéViews Top 100 Index serves as a premium benchmark for tracking the performance of the most valuable Pokémon TCG cards. By focusing on the top 100 cards, the PV100 gives investors and collectors a dedicated view of the high-end market, separate from the broader trends captured by the PV250. It is particularly useful for understanding how the most sought-after cards are performing as a segment of the overall market.

**Chart indicators (Top 100 and Top 250).**
- *Bands* - Bollinger Bands are volatility bands placed above and below a moving average. They widen when volatility increases and narrow when volatility decreases. In traditional finance, price touching the upper band may suggest overbought conditions while the lower band may suggest oversold conditions. Bands squeezing together often precede increased volatility or a breakout.
- *EMA-30* - An Exponential Moving Average (EMA) is a type of moving average that gives more weight to recent prices, making it more responsive to new information than a simple moving average. Price above EMA-30 suggests short-term upward momentum; below suggests downward momentum. Can act as dynamic support or resistance.
- *EMA-90* - The 90-day EMA smooths medium-term price movements while remaining more responsive to recent changes than a simple moving average of the same period. Shows medium-term trend direction. Useful for identifying support and resistance levels. Price crossing above or below can signal trend changes.
- *MA-200* - A Simple Moving Average (MA) calculates the average price over a specified period. The 200-day MA is one of the most widely-watched long-term trend indicators. Price above MA-200 is generally considered bullish; below is bearish. Often acts as strong support in uptrends or resistance in downtrends.
- *RSI* - The Relative Strength Index (RSI) is a momentum oscillator that measures the speed and magnitude of recent price changes on a scale of 0-100. Rising RSI values indicate strengthening momentum, while falling values suggest momentum is slowing. Changes in RSI direction can signal when a trend may be changing. The 50 level serves as a neutral reference point.

### Top 250 Index

**What is the PokéViews Top 250 Index?** The PokéViews Top 250 Index (PV250) is an equal-weighted benchmark designed to measure the performance of the top 250 English Pokémon trading cards ranked by market price. The index rebalances monthly and excludes cards that do not meet minimum liquidity thresholds, as well as sealed products, graded cards, and non-English releases. The PV250 represents the broader Pokémon TCG market while providing insight into the performance of mid-to-high value actively traded ungraded cards. It is a reference index, not currently an investable product. PokeViews does not offer investment advice.

**Methodology.** Constituent Selection: Includes the top 250 English Pokémon trading cards ranked by market price, meeting minimum liquidity thresholds and price history requirements (≥ 30 days). Excludes sealed products, graded cards, and non-English releases. Weighting Method: Equal-weighted. Rebalancing: Conducted monthly on the first trading day of each month. Currency: Calculations are performed in USD. Calculation Frequency: Index levels are updated daily based on TCGplayer market price data.

**Why it matters.** The PokeViews Top 250 Index serves as a broader market benchmark for tracking the performance of mid-to-high value Pokémon TCG cards. By expanding beyond the top 100 cards, the PV250 provides investors and collectors with a more comprehensive measure of market trends across a wider range of valuable cards.

### Hot & Cold Index

**What is the Hot & Cold Index (HCI)?** The Hot & Cold Index (HCI) is a daily composite score that measures the overall strength of the Pokémon card market on a 0–100 scale. It combines five normalized signals across three concepts — index trend, broad market momentum, and premium card price breakout activity — into a single reading. Temperature labels from Ice Cold to Extremely Hot provide an intuitive at-a-glance interpretation of current conditions.

**Methodology.** The HCI is a weighted composite of five normalized signals. Eligible Universe: English ungraded Pokémon trading cards meeting minimum liquidity thresholds, price requirements, and price history requirements. Excludes sealed products, graded cards, and non-English releases. Components: PV250 Index Trend - measures how far the PokéViews Top 250 Index is trading above or below its 30-day moving average; Market Momentum — All Cards: percentage of all eligible cards trading above their 30-day moving average; Market Momentum — $100+ Cards: the same metric applied to premium cards ($100+), which can be more signal-rich than the broad universe; New Highs — All Cards: percentage of all eligible cards trading at a 30-day price high; New Highs — $50+ Cards: the same metric applied to higher-value cards ($50+). The HCI methodology is reviewed periodically and may be subject to adjustments as market conditions evolve and additional data becomes available. Calculation Frequency: Updated daily based on TCGplayer market price data.

**Why it matters.** The HCI provides a single daily number that summarizes the condition of the Pokémon card market across multiple dimensions. Unlike a price index alone, it incorporates how many cards are participating in a move and whether premium cards are leading or lagging. High readings suggest broad, well-supported market strength. Low readings may indicate widespread weakness or a cooling market. Historically notable extremes — both high and low — have aligned with meaningful turning points in the market over the last two years.

**Temperature labels.** Ice Cold (0–20): Rare, severe market weakness across nearly all signals. Cold (20–35): Broad weakness, most cards declining or below trend. Cool (35–45): Below-average conditions, market losing momentum. Warm (45–55): Neutral to slightly positive, market near equilibrium. Hot (55–70): Above-average strength, most signals trending positive. Very Hot (70–82): Strong market conditions, premium cards participating. Extremely Hot (82–100): Rare, historically elevated readings — market may be approaching short-term extremes. Temperature thresholds are calibrated to the historical distribution of HCI readings since May 2024 and may be subject to change as market conditions evolve or more data becomes available.

### Market Momentum Score

**What is Market Momentum Score (MMS)?** Market Momentum Score (MMS) is a daily breadth indicator that measures the percentage of liquid Pokémon trading cards trading above their 30-day moving average. The metric focuses on cards meeting minimum liquidity thresholds, price requirements, and price history. MMS is calculated both as an overall market metric and broken down into 4 price tiers ($10-50, $50-100, $100-200, $200+), revealing where momentum is concentrated across different market segments.

**Methodology.** Eligible Universe: Includes English Pokémon trading cards meeting minimum liquidity thresholds, price requirements (≥ $1), and price history requirements (≥ 30 days). Excludes sealed products, graded cards, and non-English releases. Calculation: For each trading day, the MMS is calculated as the percentage of eligible cards with current market price above their 30-day simple moving average. Formula: (Cards Above 30d MA / Total Eligible Cards) × 100. Price Tiers: MMS is segmented into 4 mutually exclusive price tiers: Tier 2 ($10-50): Mid-tier collectibles; Tier 3 ($50-100): High-end cards; Tier 4 ($100-200): Premium cards; Tier 5 ($200+): Ultra-premium. Calculation Frequency: Updated daily based on TCGplayer market price data.

**Why it matters.** Market Momentum Score serves as a real-time breadth indicator for the Pokémon TCG market. By measuring the percentage of liquid cards in uptrends, MMS helps investors and collectors identify bullish or bearish market conditions, spot potential trend reversals, and gauge overall market health. High MMS readings suggest broad-based strength across the market, while low readings may indicate widespread weakness or correction phases.

### New Highs & Lows

**What is New Highs & Lows?** New Highs & Lows is a daily breadth indicator that measures the percentage of liquid Pokémon trading cards reaching 30-day price extremes. The metric tracks two components: cards trading at their 30-day high and cards trading at their 30-day low. Cards are only included if they meet minimum liquidity thresholds and price requirements. The metric is calculated for both the overall market (all cards ≥ $1) and a premium segment (cards ≥ $50), revealing whether aggressive price movements are concentrated in higher-value collectibles or driven by the broader market.

**Methodology.** Eligible Universe: Includes English Pokémon trading cards meeting minimum liquidity thresholds, price requirements (≥ $1), and price history requirements (≥ 30 days). Excludes sealed products, graded cards, and non-English releases. Calculation: For each trading day, two percentages are calculated: New Highs: % of eligible cards trading at their highest price in the last 30 days; New Lows: % of eligible cards trading at their lowest price in the last 30 days. Price Tiers: Metrics are calculated for two segments: All Cards: cards priced at $1 or higher; $50+: cards priced at $50 or higher. Calculation Frequency: Updated daily based on TCGplayer market price data.

**Why it matters.** New Highs & Lows captures the aggressiveness of market movements in the Pokémon TCG market. Unlike broader momentum indicators, this metric specifically tracks cards hitting 30-day price extremes, revealing the intensity of buying and selling pressure. High new highs percentages indicate aggressive buying with cards breaking out to new peaks, while high new lows percentages signal capitulation or aggressive selling. When both readings are low, it may suggest market consolidation without strong directional conviction. Extreme readings could indicate potential trend exhaustion or upcoming reversals. The $50+ tier isolates premium and collectible cards, showing whether price extremes are concentrated in higher-value items or driven primarily by the broader market of common cards.

### Pokémon vs Traditional Assets

**What is Pokémon vs Assets (Time Series)?** Pokémon vs Assets is a performance comparison tool that tracks the PokéViews Top 250 Index (PV250) against traditional investment assets including the S&P 500 (SPX), Gold (GLD), and Bitcoin (BTC). All assets are normalized to a base value of 100 on the same start date (April 1, 2024), enabling direct comparison of relative performance regardless of absolute price differences. The metric provides performance rankings over multiple time periods to help investors contextualize Pokémon card returns within the broader investment landscape.

**Methodology (Time Series).** Assets Tracked: PV250: PokéViews Top 250 Index (Pokémon cards); SPX: S&P 500 Index (U.S. large-cap stocks); GOLD: SPDR Gold Shares ETF (Gold commodity); BTC: Bitcoin USD (Cryptocurrency). Normalization: All assets are rebased to 100 on April 1, 2024, the start date of the PV250 Index. Data Sources: Asset prices sourced from Yahoo Finance via yfinance API. Forward-filling is applied to SPX and Gold prices to account for weekend non-trading days. Performance Periods: Returns calculated and ranked over 30 days, 52 weeks, and all-time. Calculation Frequency: Updated daily.

**What is Pokémon vs Assets (Correlation)?** Pokémon vs Assets (Correlation) measures how closely Pokémon card markets move in relation to traditional financial assets over time. The correlation matrix compares PokéViews indexes (PV100 and PV250), a representative single card (Charizard ex), and a sealed product (Fusion Strike Booster Box) against major benchmarks such as the S&P 500, Gold, Bitcoin, and Ethereum. Rather than comparing absolute performance, this view focuses on return correlations to help users understand whether Pokémon prices tend to move independently, together, or in opposition to broader financial markets.

**Methodology (Correlation).** Assets Included: PV100: PokéViews Top 100 Index (premium Pokémon cards); PV250: PokéViews Top 250 Index (broad Pokémon card market); Charizard ex (#199 SV151): Representative high-demand individual Pokémon card; Fusion Strike Booster Box: Representative sealed Pokémon product; SPX: S&P 500 Index (U.S. large-cap equities); GOLD: Gold (precious metal benchmark); BTC: Bitcoin (cryptocurrency); ETH: Ethereum (cryptocurrency). Return-Based Analysis: Correlations are calculated using percentage returns rather than absolute prices, ensuring comparability across assets with different price levels. Aggregation Options: Returns can be aggregated by day, week, or month to capture relationships at different time horizons, from short-term movements to broader trend alignment. Time Ranges: Users can select different historical windows to observe how correlations change over time. Correlation Metric: Pearson correlation coefficients are used, with values ranging from -1 to +1, indicating negative, neutral, or positive relationships between assets. Data Sources: TCGPlayer and Yahoo Finance. Update Frequency: Correlation values are recalculated and updated daily.

**Why it matters.** Pokémon vs Assets provides critical context for evaluating Pokémon cards as an alternative asset class by examining both performance and market relationships. The time-series comparison shows how Pokémon card indexes have performed relative to traditional assets such as stocks, gold, and cryptocurrencies, while the correlation analysis helps determine whether Pokémon prices tend to move independently or in tandem with broader financial markets. Together, these views allow investors and collectors to better understand diversification potential, relative risk, and how Pokémon cards fit within the broader investment landscape.

### Trend Extension

**What is Trend Extension?** Trend Extension is a technical indicator that measures how far the PokéViews Top 250 Index is trading above or below its key moving averages (90-day EMA and 200-day SMA). The metric helps identify potential overbought conditions when the index is significantly above its moving averages, or oversold conditions when trading significantly below. Crossovers of these moving averages signal shifts in medium to long-term market trends, while extreme readings may indicate potential reversals.

**Methodology.** Base Index: Uses the PokéViews Top 250 Index as the foundation for calculations. Moving Averages Tracked: 90-day Exponential Moving Average (EMA 90d) - medium-term trend; 200-day Simple Moving Average (SMA 200d) - long-term trend. Metrics Calculated: Distance from EMA 90d: Percentage the index is trading above (+) or below (-) the 90-day EMA; Distance from SMA 200d: Percentage the index is trading above (+) or below (-) the 200-day SMA. Calculation Frequency: Updated daily based on Top 250 Index values.

**Why it matters.** Trend Extension helps investors and collectors identify both trend direction and potential extremes in the Pokémon TCG market. When the index crosses above a moving average, it signals a shift to an uptrend; crossing below signals a shift to a downtrend. The 90-day EMA tracks medium-term trends while the 200-day SMA identifies long-term market direction. Large positive readings suggest the market has rallied significantly above its trend and may be overextended, while large negative readings indicate oversold conditions. This dual utility makes Trend Extension valuable for both trend-following strategies and identifying potential reversal points.

### Era Performance

**What is the Era Performance?** The PokéViews Era Performance tracks the average price of the top 50 most valuable ungraded cards from each era of the Pokémon TCG. It groups individual series (like Base Set, Jungle, Neo Genesis, etc.) into 5 broader eras to show how different generations of cards perform over time. Each era is measured by calculating the equal-weighted average price of its 50 most valuable cards, with monthly rebalancing. The performance reports actual dollar amounts, not normalized returns, enabling direct comparison of value levels across different generational periods.

**Methodology.** Card Selection: Top 50 ungraded cards per era ranked by market price. Only includes mainline sets (excludes promotional and special releases). Requires a minimum number of annual sales to ensure liquidity. Era Classification: 5 eras tracked: Vintage: Original, Legendary Collection, Neo series; Classic: E-Card, EX series; Mid Era: Diamond & Pearl, Platinum, HeartGold & SoulSilver, Black & White; Modern: XY, Sun & Moon series; Contemporary: Sword & Shield, Scarlet & Violet, Mega Evolution. Price Calculation: Equal-weighted average price of top 50 cards per era. The metric represents actual dollar amounts, not normalized values. Rebalancing: Conducted monthly on the first day of each month to update the top 50 cards per era. Smoothing: PCHIP (Piecewise Cubic Hermite) interpolation applied to generate smooth daily values between monthly rebalancing points and the current day. Data Source: PriceCharting ungraded card prices. Start Date: January 1, 2022.

**Why it matters.** The Era Performance enables investors and collectors to compare performance and value levels across different generations of Pokémon cards. By aggregating individual series into broader historical periods, it simplifies portfolio construction and diversification strategies. This metric helps identify which generational periods command the highest premiums, track long-term appreciation trends across eras, and allocate capital across different time periods in the hobby's history. The era-level view provides a higher-level perspective than individual series tracking while remaining more specific than single market-wide indexes.

### Series Performance

**What is Series Performance?** Series Performance tracks the average market value of the top 25 ungraded cards from each mainline Pokémon TCG series over time. Each series (Base Set, Jungle, Fossil, etc.) is measured by calculating the equal-weighted average price of its 25 most valuable cards, with monthly rebalancing. This enables investors and collectors to compare absolute price trends and value levels across different eras and releases.

**Methodology.** Series Coverage: Each mainline Pokémon TCG series (Base Set, Jungle, Fossil, Team Rocket, etc.) is tracked individually. Constituent Selection: Top 25 ungraded cards per series ranked by market price, meeting minimum sales volume thresholds. Excludes promotional cards, special releases, and non-mainline sets. Value Calculation: Equal-weighted average price of the top 25 cards per series. The value represents actual dollar amounts, not a normalized index. Rebalancing: Conducted monthly on the first day of each month to update the top 25 cards. Smoothing: PCHIP (Piecewise Cubic Hermite) interpolation applied to generate smooth daily values between monthly rebalancing points and the current day. Data Source: PriceCharting ungraded card prices. Start Date: January 1, 2022.

**Why it matters.** Series Performance reveals the absolute value levels and price trends of different Pokémon card series, enabling direct comparison of how much the top cards from each series are worth. Investors and collectors can identify which series command the highest premiums, track which eras are appreciating or depreciating in value, and make informed decisions about portfolio allocation across vintage sets (Base Set, Jungle) versus modern releases (Scarlet & Violet). Unlike percentage-based indexes, this metric shows actual dollar values, making it easier to understand the investment scale required for each series.

### Set Performance

**What is the PokéViews Set Performance?** The PokéViews Set Index tracks the average price of the top 10 most valuable ungraded cards from each individual Pokémon TCG set. Each set (Surging Sparks, Shrouded Fable, Destined Rivals, etc.) is measured by calculating the equal-weighted average price of its 10 most valuable cards, with monthly rebalancing. The metric reports actual dollar amounts, not normalized returns, enabling direct comparison of value levels across different sets within and across series.

**Methodology.** Card Selection: Top 10 ungraded cards per set ranked by market price. Only includes mainline sets (excludes promotional sets). Requires a minimum number of annual sales to ensure liquidity. Excludes special cards (trophies, championships, errors, etc.). Set Coverage: Individual sets tracked separately (e.g., "Surging Sparks", "Shrouded Fable", "Destined Rivals"). Price Calculation: Equal-weighted average price of top 10 cards per set. The index represents actual dollar amounts, not normalized values. Rebalancing: Conducted monthly on the first day of each month to update the top 10 cards per set. Smoothing: PCHIP (Piecewise Cubic Hermite) interpolation applied to generate smooth daily values between monthly rebalancing points and the current day. Data Source: PriceCharting ungraded card prices. Start Date: January 1, 2022.

**Why it matters.** The Set Index enables investors and collectors to compare performance and value levels across specific Pokémon TCG sets. This granular view allows for precise portfolio construction at the set level, revealing which individual sets command the highest premiums and identifying performance differences between editions (Twilight Masquerade vs Prismatic Evolutions) and printing variations. The metric helps allocate capital to specific sets based on their absolute value levels, track appreciation trends for target sets, and compare sets within the same series or across different eras. This set-level specificity provides the most detailed performance tracking available in the Pokémon card market.
