Slab Show Scanner: the scanner upgrade - depth, glare, lenses, video, Test mode - and every slab read sent for scans.csv

Brett, 2026-11-09: "I want to maximize my depth for actually reading the barcode scanners. It's going to be done at
different angles. The lighting conditions could be different ... a little bit of glare ... a glass paneled showcase
box"; our own reader first, tested on his printed sheets against Scandit's free trial before paying. "When the barcodes
are read, they'll just go into the scan CSV file as a link to the PSA or CGC website for that certification."

- Depth is detail (zxing needs ~2 camera dots per thin bar): the camera at up to 3840x2160 and every frame read whole at
  full size in a worker (page/app/scan-worker.js) instead of shrunk to 1600 px; the LocalAverage and GlobalHistogram
  binarizers by turns. On a 4K test frame of 40 slabs: 28 read (every row down to 1.7 dots/bar) vs 5 before.
- The iPhone's lenses by name: the main lens (no automatic switching) or the 3x telephoto (a button on the picture);
  the whole frame shown, green boxes on what was read, a beep per new slab (Show), the screen kept awake while scanning.
- Read a video: a clip from the Camera app, read six frames a second into a new table.
- Test mode: nothing saved, looked up or sent; every code with the finest detail it was read at, the camera size and
  speed.
- scans.csv: every real slab put on a table is queued on the phone and sent ({type 'scan'}); the collector adds its
  cert link to card-data's data/scans/scans.csv (the collector commit before this one). Show tab: what was sent.
- The website's app pop-up may keep the screen awake too (screen-wake-lock).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
