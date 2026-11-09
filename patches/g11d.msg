scans.py: the scans.csv code in its own file, out of collector.py (same behaviour)

Brett, 2026-11-09: "right now the collector.py is super long to read. would it be possible to take the scans part of the
code out of collector.py, and put it into a new py. a new py called scans py. and have the code perform the same
functions, as if it were a part of the collector.py still."

- scans.py (new, next to collector.py): the settings, the format (link / row / slabs_in), record() for a message from the
  phone, flush() every minute, push() and git() for the write to card-data's data/scans/scans.csv - the code that was in
  collector.py, unchanged in what it does.
- collector.py keeps 11 lines of it: import scans, scans.log = log and scans.DRY_RUN, scans.record() in read_requests,
  scans.flush() in cycle.
- CLAUDE.md: the SCANS.CSV notes name scans.py.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
