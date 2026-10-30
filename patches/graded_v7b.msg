Graded view data: every PriceCharting card with PSA / CGC data, in the Card Ladder run's order

Brett (2026-10-30): "fill out the rest of the website to get all of the PC graded data ... the CL rows will be blank
until we get the data". graded_site.py starts from card-data cardladder/queue.csv (every PriceCharting card, rank
order) instead of the matched cards only: rows wherever PriceCharting has a PSA / CGC price or sale, a slim card entry
for the cards not matched yet, cards[id].cls read / pending / nomatch (from cardladder/timing) and .qr (queue rank),
row column pcn1e (last month's sales of a busy grade, estimated from the pace of the recorded ones). Matched cards are
built exactly as before (rows, card meta and trends identical on 2026-10-30 data). Daily snapshots: only the PSA 10 /
CGC 10 columns, read column-wise; series_stats' slope in numpy (same numbers). CLAUDE.md: the card-inbox hand-off and
this change.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
