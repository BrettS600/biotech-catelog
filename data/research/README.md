# data/research — the research log for the Forecast model

**Purpose.** Brett flips raw Pokémon singles on eBay with $2,000–$10,000 of capital, wants to hold 1–3 months,
reinvest the profit, and not lose money. This folder records every attempt to improve the Forecast tab's
predictive power: what was tried, how, the numbers, and the verdict — so a later session (Claude, ChatGPT, Opus,
or a person) can pick up where this left off instead of repeating it. **Read `experiments.csv` first, then
`FINDINGS.md`.**

Nothing in here changes the website or the Forecast tab. Findings are applied in a separate step.

## Layout

| path | what |
|---|---|
| `experiments.csv` | the registry: one row per experiment (id, question, method, data, horizon, key result, verdict, files). The index of everything. |
| `FINDINGS.md` | the synthesis: what the evidence says to build, in priority order, what failed, and the caveats. |
| `notes/E##_*.md` | the detail behind each registry row: hypothesis, exact method, the result tables that matter, interpretation, caveats, what to try next. |
| `results/E##_*.csv` | the numbers each experiment produced (every table referenced in the notes). See "Where results/ comes from". |
| `scripts/*.py` | the code. `common.py` loads the panel, `xs.py` is the cross-sectional engine; `e##_*.py` reproduce each experiment; `run_all.sh` runs them in order. Python 3 with numpy, pandas, scipy, scikit-learn, statsmodels. |
| `ideas_backlog.csv` | things not tried yet, with why they might matter — start here when extending the work. |
| `sources.md` | outside reading (Pokémon investing, eBay fees, stock-market quant methods) and what in it was testable here. |

## Where results/ comes from

The GitHub Actions workflow `.github/workflows/research.yml` (manual dispatch) runs every `scripts/e*.py` against the
committed `data/` folder and commits `results/` to main (`results/generated_at.txt` says when; `results/*.log` hold each
script's console output, including any failure). The notes quote the run of 2026-10-24; a later regeneration differs
slightly because `data/` is refreshed daily (the current month's PriceCharting figures are partial until the month
ends, and E07 / E13 read the newest eBay snapshot and rollup). `E10_sim_cycles.csv` (every simulated cycle, ~5 MB) is
not committed — run `e10_portfolio_sim.py` locally to get it.

## Conventions every experiment follows (so numbers are comparable)

* **Data**: only the files in `data/` (see `../README.md` for the dictionary). The PriceCharting panel is 43,955 cards ×
  71 months (2020-12 … 2026-10; October 2026 is a partial month).
* **Decision month t**: everything used at t is known by the end of month t.
* **Standard buy price** `buy_real = max(price_t, mean(price_{t-2..t}))` — the site's rule: you cannot buy at a print
  that only dipped this month. Variants that buy at `price_t` or at a discount are labelled.
* **Sell price**: PriceCharting's price h months later (h = 1, 2, 3, 6).
* **Net return**: eBay round trip as the site computes it: `net = (sell × 0.8589 − 5.20 − buy) / buy`
  (13.25 % final value fee × 1.065 for tax on the fee; $0.40 order fee + $4.50 outbound shipping + $0.30 supplies).
  Breakeven gross move: +77 % on a $10 card, +41 % at $25, +28 % at $50, +22 % at $100, +18 % at $300.
* **Universe**: price ≥ $10 and ≥ 2 sales in month t; the **band** is $50–$500 (the collector's listing band).
* **Regime**: `reg1` = the market-wide median 1-month move of cards that were $10+ last month with 2+ sales this month;
  `reg3` = its trailing 3-month mean; strong > +2 %/mo, flat −0.5…+2 %, falling < −0.5 %. (Conditioning on *this*
  month's price instead biases the regime up — a bug caught and fixed on 2026-10-24, see E03's note.)
* Decile tables equal-weight months; "hit rate" = share of months the top decile beat the universe; t-stats are on
  the monthly spread series (months overlap for h > 1, so treat h = 3 / 6 t-stats as optimistic by ~√h).
* **PriceCharting's monthly price is an average of the month's sales.** Any "this month vs last month" level comparison
  carries spurious positive autocorrelation (E11); signals built that way must be validated against daily data.

## How to extend

1. Add a row to `experiments.csv` *before* you run (id, question, method) and fill in the result after.
2. Put the script in `scripts/`, the tables in `results/`, the write-up in `notes/`. Use the shared loader so the
   price/fee conventions stay identical.
3. If you refute or refine an earlier finding, say so in the new note **and** add a line to the old note's
   "Later work" section — do not silently overwrite.
4. Dispatch the `Research results` workflow to refresh `results/` after changing a script.
