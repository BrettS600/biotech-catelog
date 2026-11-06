Graded: Card Ladder is the price source - stats columns, Forecast, Recording, Purchases and History on Card Ladder's own sales

Brett, 2026-11-05: "Moving forward card ladder will be used as the primary reference point, and PC will be there to
confirm matching"; "we need to change statistics to be based on card ladder"; PriceCharting out of the Forecast's
calculations, its price and sales kept in the rows for reference.

- cl_sales.py (new) reads card-data data/cardladder/lines (Card Ladder's sales in compact form): the standard price
  (Hodges-Lehmann of the grade's sales in the 30 days to the card's read, 3 sales, else 60 / 90 days), last month,
  sales a year, the analysis figures.
- graded_site.py: rows carry Card Ladder's standard, sales a year and value confidence; the stats columns
  (Δ7d, Δ30d, Range 90d, Volume drift, Volatility, Slope, Sales/yr) and CL Graded (last month) come from Card Ladder's
  sales; trend shards carry the model's month-by-month figures (cf) and the CL line as Hodges-Lehmann.
- graded_forecast.py v2: the model on Card Ladder's sales, every PSA and CGC grade a line, read cards only, odds
  measured at 3+ / 6+ / 12+ / 24+ sales a year for the min-sales filter to come.
- Page: Forecasting lists only slabs Card Ladder prices; Standard / Sold show CL on top and PC as reference; Buy, Net and
  ROI are Card Ladder's; ≠CLV flags a Card Ladder value 25%+ off the standard. Recording / Purchases: % Under (CL),
  PriceCharting's % under read-only. History: replay, Recorded Purchases' actuals and Pre-Sales Spotcheck on Card
  Ladder. Help popups and the README default rewritten.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
