Slab Show Scanner: a smeared frame is dropped early, so more of a moving hand's sharp moments are caught

A simulated hand that only pauses (1 camera frame in 5 sharp, the rest smeared sideways), three runs of each version:
before today's changes 45 of 50 codes at 1.25-1.75 s and never all 50; with every frame read whole and as quarters 45 at
0.75 s but all 50 only at 5.25-8.25 s (fewer frames a second = fewer sharp moments caught); now 45 at 0.75-1.5 s and
all 50 at 2-3 s.

The rule: while a whole-frame pass has read a code in the last 2.5 s, a whole pass that reads nothing means a smeared
frame (a smear that empties the whole pass empties the enlarged quarters too), so the quarters are skipped and the next
frame is grabbed at once - never more than 3 frames in a row, so a place with only the smallest codes still gets them.
The test report (g11j) gains framesWithNoCode and framesDroppedEarly. sw.js: a new offline copy (ssc-v8). CLAUDE.md: the
measurement, and where the printed sheets' answer key is.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
