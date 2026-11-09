Slab Show Scanner: a test report to paste into the chat, a sharpness score per frame, a hint for the 3x lens

Brett, 2026-11-09, second test: 1x about a foot straight down, 38 of 50 in 65 s; 3x held about a foot over a few codes,
2-6 codes. His screenshots are mostly out of focus: the 3x telephoto cannot focus that close, and many 1x frames were
blurry too - blur, not only detail, is now the limit. He asked for "something where your feedback is more reliable
than some screenshots".

- Test mode: "Copy report for Claude" after a run copies the numbers as text for the chat - camera, lens, seconds,
  frames and frames a second, time per read, sharpness (low / median / high), every code with its detail, how often and
  when it was read, and whether only the enlarged reads found it. Clear resets it all.
- scan-worker.js: a sharpness score per frame (variance of the Laplacian of a 512 x 512 middle patch) and a mark on codes
  found in the enlarged piece.
- 3x: choosing it says to hold about 2 feet away, and the hint under the record button says so while it is on.
- sw.js: a new offline copy (ssc-v4). CLAUDE.md: the second test and the change.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
