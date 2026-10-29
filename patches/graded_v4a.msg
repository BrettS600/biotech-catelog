Graded view, data side: Auth columns from the slab certs (PSA's API, Card Hedge), last month's PC / CL prices

- cert_lookups.py (new): every PSA / CGC cert the graded view knows, looked up with PSA's Public API
  (PSA_API_TOKEN) and Card Hedge's details-by-certs (CARDHEDGE_API_KEY); each source kept in its own
  card-data folder (data/psa: raw responses, certs.csv, pop_history.csv; data/cardhedge: raw, certs.csv,
  check.csv = Card Hedge's card vs our PC <-> CL match). Paced to the published limits; skipped without a key.
- graded_terms.py: auth_side (the grader's words through the dictionary), parse_description, language_of,
  compare_auth; the term tally counts an Auth side.
- graded_site.py: cards[id].a (card-level Auth per grader), the row's slab facts (grade, label, pop, pop
  higher, cert), Series / Era with Auth as a third source; PC Graded / CL Graded = last month's averages.
- CLAUDE.md: the Auth columns, the cert sources and their limits, last month's prices.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
