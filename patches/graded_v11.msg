Trend: a % change button - every line as its change since its first month in the window; each chip shows the window's change

Brett (2026-11-03): "maybe we should add a delta % increase in value toggle to the trend chart. That may even be more
insightful than the log toggle. We can still keep log toggle." The % change button (remembered, gtr-pct) divides each
line by its own first price in the window, so all lines start at 0% and grades far apart in price (or PC against CL)
compare by how much they grew; the window buttons set the starting month. The axis is in % (round steps, 0% dashed), the
hover, point tips and month table add the %, and each line's chip shows its change over the window (first -> last month
in its tip). Log still works (on the ratio). Help: the Trend entry now says 4 lines, the dropdowns, Log and % change; the
Review entry no longer says Not the same card hides the rows (it keeps them, with no match - graded_v10). Tested in
Chromium on the Oct 30 snapshot: 4 lines, % on / off, % with Log, 5y and 6m windows, hover, table, no page errors.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
