Graded view: a "Not the same card" answer belongs to the Card Ladder page it was given for; notes on the Card Ladder run

- graded_site: a card-level answer from marks.csv applies only while the card's Card Ladder page is the one it was
  given for (matched-<spec> and psa-<spec> count as one page) - when the run finds the card another page, the old
  "Not the same card" no longer hides it.
- graded.js: the page's own card answers keep the page too (GMARKS[cid|card].p) and are ignored for a different page.
- CLAUDE.md: (13) the Card Ladder run (2026-10-30): code in card-data tools/clingest/browser, the queue, every sale saved
  in data/cardladder/sales, timing and progress, rejected pages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
