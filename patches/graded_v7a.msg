Graded view page: every PriceCharting graded card - CL Status column, pending CL cells, ~ estimates, faster text sort

Brett (2026-10-30): "fill out the rest of the website to get all of the PC graded data ... the CL rows will be blank
until we get the data". The page side: a CL Status column after CL Grade (read / pending / no match; cfg.inserted v8
keeps saved layouts on the same columns), a pending card's CL cells say pending (hover: its place in the Card Ladder
run's line) and it has no Review yet, PC sales (last mo) shows ~N where graded_site.py estimated a busy grade, the
meta line counts Card Ladder read / pending / no match, and app.js's text sort uses one Intl.Collator (the same order
as localeCompare numeric; 6.5 s -> 1 s on 88,000 rows). Works with the current graded.bin (matched cards = read).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
