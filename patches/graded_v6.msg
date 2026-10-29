Graded view: whole-card answers, a price-history match check, Pristine filing, setting popups, trend hover

- Review's Same card / Not the same card now answers for the whole card. Not the same card hides all its rows
  (nothing is deleted; a "Not the same" button shows them again), and the collector accepts the new "card" answers.
- "unsure match" stays until answered and now also shows at the top of Review with the reason; a new red "likely
  wrong match" label comes from a price-history check (Card Ladder vs PriceCharting, month by month, grade by grade,
  Pristine left out). Its thresholds learn from Brett's answers once there are 20; every card's check and answer go
  to card-data ids/match_checks.csv. An "Unsure" button lists the doubtful rows; their PC to CL % is greyed.
- CGC 10 sales whose title says Pristine / Gold Label count as CGC 10 Pristine, "Perfect 10" / Black Label as
  CGC 10 Perfect (never "Perfect Order"), as Card Ladder keeps them apart.
- ? popups for the word buttons' "Inside this button", "Side" and "Across buttons", and for the answers and labels.
- Trend chart: PriceCharting lines are PSA 10's own line and each grade's recorded sales; a vertical line follows
  the cursor with every line's value that month.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
