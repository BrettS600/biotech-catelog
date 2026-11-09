Collector: scans.csv - the phone app's slab reads as cert links in card-data (data/scans/scans.csv)

Brett, 2026-11-09: "When I scan a barcode, the link will appear in the CSV file"; "when the barcodes are read, they'll
just go into the scan CSV file as a link to the PSA or CGC website for that certification."

- read_requests: {type 'scan', t, c: [[grader, cert], ...]} from Slab Show Scanner -> scan_record() queues each cert's
  link (https://www.psacard.com/cert/<n>, https://www.cgccards.com/certlookup/<n>/) in v["scan_q"].
- scans_flush() every cycle starts scans_push() in a thread: a sparse (data/scans), shallow, blob-less checkout of
  BrettS600/card-data at data/card-data-scans; the links not yet in scans.csv are added (one a line, each slab once),
  committed and pushed to main (3 tries, fetching again in between). card-data is reached with its own deploy key,
  /opt/pokemon-collector/.ssh/card_data_ed25519 (Brett makes it in the DO console and adds it with write access); no key
  = the links wait (logged hourly); a failed try waits 10 minutes.
- setup.sh makes and prints that key too. CLAUDE.md: the scanner upgrade and scans.csv.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
