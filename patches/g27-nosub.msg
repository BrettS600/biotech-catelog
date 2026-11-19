PriceCharting without the subscription: set-page walk, counted volume, side by side in the build

Brett, 2026-11-19: cancelling the PriceCharting subscription (runs to ~Dec 18) - make the build work without it,
re-read busy cards before their sold-listing tables fill so the counted volume stays accurate, run side by side.
- pchist: the ungraded sold listings are merged across reads with the graded ones and counted per month (vc);
  without the volume bars v = max(the bars last read, the count); tables (ungraded per source) are re-read before
  30 new sales pile up; a daily check of the counted listings against the bars while they last; release date / ePID.
- collector: the daily walk of PriceCharting's public set pages -> pc_free.bin (the download's columns); a signed-in
  read without the bars is "free", not an expired sign-in.
- data_archive: ungraded sales to data/pricecharting/ungraded_sales/.
- build_catalog: compares the walk with the download every day; builds from the walk when the download stops.
- page: the pill and the chart note for the no-subscription state. CLAUDE.md.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
