Record scans, the reads of the scans, Sync, half grades (g16)

Brett, 2026-11-13/14: a Record scans button under Record purchases sends the show to History > Pre-Sales
Spotcheck ("Show N" by default, editable, no slab limit); Start a new show asks first and erases scans.csv at
once, after the last show's waiting slabs; the cert pages he opens from scans.csv (BrettS600/scan-results,
scans/) show on the website and in the app within a minute; Sync from phone / Sync from website, synced boxes
reset at midnight; slabs that match nothing of ours are left out and listed behind a button; a thin half grade
is priced one grade down, PriceCharting's half-grade columns round down with a ↓, and a PC-photo cert moves to
the grade its grader's page shows.

- scans.py: clear() for {type: 'scan_clear'}; reads_tick() fetches scan-results/scans every 15 s with this
  machine's own read-only key (made on first run, its public half shown on the website), matches each read to a
  card and grade with the site's scanidx.bin (the cert, PSA's sales list on the page, the grader's name for the
  card); grade always the page's.
- collector.py: a fast tick every 15 s between cycles; reads and erases on the <channel>-scr topic at once;
  scan.bin and spots.bin on the live branch; phone Spotcheck sets of any size with name, day and the phone's plan;
  each side's Your Plan kept for the other's Sync button.
- graded_site.py: scanidx.bin; certs moved to their grader's grade; half-grade PriceCharting prices one grade down.
- Website: Pre-Sales Spotcheck shows the phone's shows (Name, Not in our data with a pop-up of links, the
  collector's key box); Sync from phone; the ↓ on rounded-down PriceCharting figures.
- App (g16): reads identify slabs (also CGC, no PSA lookup used); Record scans; Start a new show pop-up and the
  ordered erase; Sync from website; a thin half grade priced one grade down.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
