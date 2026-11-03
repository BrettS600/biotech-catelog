Graded view: grades 1-6 "not read" until re-read; Not the same card stays listed (no match); CL read and CL To PC Match buttons; Trend: 4 lines, grade dropdowns, the row's grade, Log

Brett (2026-11-03). (1) The collector now keeps PriceCharting's grade 1-6 sales (5dacf52); a card whose page was last read
before LOW_FROM (2026-11-04) has none on record, so its grade 1-6 PC cells say not read instead of 0. (2) "if there is no
match, then we still list it, but one side ... will have the rows say no match": a card answered Not the same card keeps
its rows, with no Card Ladder side (CL Status no match); the Not the same button is gone. (3) "CL To PC Match | 7k of 10k
... on to only show match, off to only show unmatches, and then neutral to show both" and "a read toggle as well": two
three-way buttons, CL read (read only / pending only) and CL To PC Match (matched only / no match only, counted among the
read rows; unsure matches count as matched; the Auth columns play no part). (4) Trend: up to 4 lines, the PSA and CGC
grades in dropdowns, opens on the row's own grade (the axis fits the lines shown), a Log switch. Tested on the Oct 30
snapshot in Chromium: button cycles and counts, Not the same -> no match and back, the Trend's lines, dropdown, cap,
log axis; the build's grade 1-6 rule on test rows; no page errors.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
