Forecast tab: Graded cards > Recording and Planning; Forecast History > Graded cards (replay + recorded plans)

Recording (new, between Forecasting and Planning, graded only): one row per recorded slab - for now 50 sample rows, 5
of them bought, with Remove samples - with Forecasting's columns plus Rank, a % Under box per row and Purchased Yes /
No; green rows = what the capital left buys, best chance first among the open rows on view. Planning: the slabs marked
Yes at what was paid; Record plan sends the plan (in parts) to the collector (collector.gplan_record -> live.gplans).
One plan pane and one set of filters for the three graded pages (% under: Forecasting's own, Recording's start for new
rows). Forecasting: buys tinted light green, Buy -> QTY, the + turns green and fills Recording's Looking for list;
header sorts on computed columns fixed (word data-k keys). Forecast History > Graded cards: graded_forecast.build_hist
-> graded_hist.bin (written by graded_site.py): the month-by-month replay known at the time, run in the page with Graded
Forecasting's settings for holds 1-6 (mean ROI / mean chance cards, a table with the six hold groups, eyes and
Columns), and the recorded plans with each hold's expected / range / chance and the actual at PriceCharting's price.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
