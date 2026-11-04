Graded view: only cards worth $50+ on PriceCharting are listed (every grade of them stays); CL Status tip describes the new run order

Brett (2026-11-03): "remove pc psa10 cards below $50. if card is a lower than $50 because it is a lower grade then the one
above $50 then we can keep it." graded_site.py MIN_CARD_VALUE 50: a card is listed when the highest PriceCharting value
of any of its PSA / CGC grades is $50+ (almost always its PSA 10), and then all its grades stay. Applied after the
learning data (match_checks.csv) is written; nothing is deleted from card-data. Tested on the Oct 30 data: 21,211 of
39,883 cards listed, every row's card listed and no card without rows; Mega Gardevoir EX #32 (PSA 10 under $50) out,
Eevee 1st Edition and Mega Charizard X #23 in. The CL Status tip no longer quotes the old line number (the run's order
changed tonight - see CLAUDE.md).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
