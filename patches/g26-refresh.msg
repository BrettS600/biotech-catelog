The nightly Card Ladder refresh: $50+ cards re-read every two weeks on PriceCharting, the watch list

Brett, 2026-11-19: collect the cards whose prices change every night once the first pass is through.
- pchist.REFRESH_WORTH_D = 14: a card worth $50+ (ebay_sweep Catalog "top", the highest of the CSV's
  grade prices) is re-read on PriceCharting every two weeks instead of monthly; pc_plan's rest goes by top.
- data_archive.py writes card-data data/cardladder/watch.csv: the cards of recorded and Spotcheck slabs,
  read again first by card-data's make_refresh.py.
- CLAUDE.md: the refresh's pieces.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
