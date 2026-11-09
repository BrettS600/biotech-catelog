Slab Show Scanner: enlarged reads for the smallest slab barcodes (after Brett's first test on the Staples sheets)

Brett, 2026-11-09: "results weren't that great" - about a foot straight down, 40 of a sheet's 50 codes in 33 s; at 45
degrees, 23 in 37 s, all in the nearer rows. The slab barcodes are ~17.5 mm wide with bars ~0.2 mm, so at a foot the
iPhone's 4K camera gives only ~1.7-1.9 dots per bar - the reader's edge - and at 45 degrees the far rows get less.

- scan-worker.js: a piece of the frame drawn 1.5x bigger with smooth scaling before it is read; positions mapped back,
  so Test mode's dots/bar still means the camera's detail.
- app.js: live, every other frame is read whole and the others as an enlarged piece (the middle every second time - a
  sweep carries every slab through it - and the four corners in turn); a video gets the whole frame and a piece every
  frame. Without OffscreenCanvas in the worker, whole frames as before.
- Measured on a simulated sheet at a foot (Brett's layout, true sizes, blur, noise, glare), live in Chromium: straight
  36 -> 50 of 50 in 12 s, 45 degrees 30 -> 39; a 4K frame of 40 slabs 27 -> 38 of 40; no misreads.
- sw.js: a new offline copy (ssc-v3). CLAUDE.md: the test and the change.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
