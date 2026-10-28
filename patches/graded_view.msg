PriceCharting tab: the graded view (Only show raw / Only show graded / both, Grading, Review, PSA Trend)

Brett, 2026-10-27: "an option to toggle to only show graded cards, and one that only shows raw cards ... If I deselect
both, then price chart populates the list to include both", a Grading popup (grade x grader toggles, Turn all on / off),
the graded columns (PSA or CGC ID, CL set / number / card name / rarity-finish / release / graded, CL sales, PC to CL %,
Review, Flag; PC's columns renamed PC Set, PC Graded (latest), $eBay Anchor, eBay to PC Difference, PSA Trend), and a
renamed header renames its filter chip on every tab.

- page/body.html: the mode bar, the raw table wrapped in #pcv-raw, the graded (#pcv-g) and raw + graded (#pcv-a)
  tables, the graded Trend popup (#gov)
- page/app.js: the raw table's header now lives in #pcv-raw (TABLES.pc root), so its sort / columns / widths stay its own
- page/style.css: the mode buttons, the Grading picker, the Trend popup, the Flag cells
- build_catalog.py: stitches page/graded_help.js and page/graded.js after help.js
The data comes from graded_site.py (site workflow, private repo card-data); until it has matched cards the graded view
says so and the raw view is unchanged (it stays the default).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
