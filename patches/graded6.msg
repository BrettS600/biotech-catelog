Graded: the stats from PriceCharting only, the Trend hover's change from last month, Select all under each grader

Brett, 2026-11-05 ("for the stats, i am thinking we just use pc for all of them"; "Leave them blank, with the reason in
the hover text"):
- PSA 10 and CGC 10 keep PriceCharting's daily price. Every other grade (and a CGC 10 that is PriceCharting's 0.40 x
  PSA 10 formula) takes Δ7d, Δ30d and Slope from the sales PriceCharting recorded of that grade and grader, as of the
  card's last page read; Range 90d and Volatility stay blank there (no daily price), with the reason in the hover.
- Volume drift for every grade from those sales: the last 30 days against the 30 before, once our record of the grade
  reaches back 60 days.
- The Trend chart's "% change" is "% Change From First Month"; its hover adds each line's change from the month before,
  green when up, red when down.
- The Grading popup has one Select all / Deselect all button under the PSA list and one under the CGC list.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
