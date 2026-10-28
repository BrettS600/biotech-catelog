Graded view, data side: the dictionary, PC / CL field checks, number graded history

graded_terms.py (new): the dictionary matcher (card-data/data/dictionary/terms.csv) and each side's reading - PC from
PriceCharting's name brackets and the TCGplayer product it links to, CL from Card Ladder's own words only; "none"
where a side says nothing. graded_site.py: card / set number, rarity · finish · special, series, era per side, the
field checks (match / mismatch / pc_none / cl_none / both_none / not_read), the word lists for the page's buttons,
term_counts.csv and field_checks.csv written into the card-data checkout, and the population history for "Number
graded (last month)". data_archive.py: a pop month file keeps each card's first and latest read. CLAUDE.md notes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
