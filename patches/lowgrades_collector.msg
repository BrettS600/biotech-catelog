Collector: keep PriceCharting's grade 1-6 sales; re-read busy cards before 30 new sales pile up; 2,500 reads a day at most

Brett (2026-11-03): "fix the psa problem for all cards" - the collector kept only PriceCharting's Grade 7-10 tables, so
every PSA / CGC 1-6 row showed 0 PriceCharting sales (Eevee 1st Edition Jungle: 3 PSA 1 sales in October). GS_MIN_GRADE
is now 1. graded_due() judges every table with 3+ sales by its pace (over the table, or over the last 30 days when
faster), full or not, and asks for the next read after 70% of the days 30 new sales would take (1-29 days), so no sale
scrolls off PriceCharting's 30-row table ("when they turn, we can turn them on daily"). The page reader caps planned
reads at 2,500 a UTC day (about 1,300 before; pages asked for from the site are not counted) and takes the busy cards
first after the newest listings'. No GRADED_VERSION bump: grades 1-6 arrive as each card is re-read on its schedule.
Tested: graded_tables keeps Grade 1 / 6 rows; graded_due on full, filling, one-day, slow, turning tables; the cap and
the plan order on a dry-run worker.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
