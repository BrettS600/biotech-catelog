Slab Show Scanner: every frame read whole and as enlarged quarters, a Photo test, a hold-still hint

Brett, 2026-11-09: "are you sure thats only patch that is required ... is there anything else we can do to improve it?
if so then please adjust the build/code". A review of the reading code before his fourth test, with measurements on the
simulated pictures:

- Smear is the limit, and its direction decides: across the bars 2 camera dots lose a fifth of the reads and 4 dots (two
  bars' width) lose all of them; along the bars 12 dots lose nothing. So: hold still over each group or move the way the
  bars point, and use the Light. The hints say so; after 3 s with nothing read the picture says "Nothing readable - hold
  still, 8-10 inches away".
- The read plan: every frame is read whole AND as enlarged quarters (before, a corner got an enlarged look once in 16
  frames). One frame of the simulated sheet now gives all 50 codes; time to every code: straight sheet 1.0 s (was 4.5),
  45 degrees 2-2.5 s (was 5.0); 40 slabs in 4K: 37 in 1.5 s (was 35 after 4 s). The quarters look for the linear slab
  codes only (zxing reads those the same with either binarizer, in a third of the time); the whole pass looks for every
  slab format, with LocalAverage every third frame for the QR codes; every sixth frame the middle piece gets that search
  enlarged. As many quarters a frame (4, 2 or 1) as fit 220 ms on the phone in hand. A video file gets all four
  quarters every frame.
- Test mode: a "Photo test" button reads a video frame, a still photo (ImageCapture.takePhoto) and the largest still the
  camera offers, the same thorough way, and notes the counts - whether a real still reads more than a video frame.
- The test report (g11i) gains timing (whole pass, a quarter, quarters a frame), mostCodesInOneFrame, photoTests, and
  cameraDetails maxSize / closestFocusMeters / photoButton / photoSizes.
- sw.js: a new offline copy (ssc-v7). CLAUDE.md: the measurements and what is left for after his report.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
