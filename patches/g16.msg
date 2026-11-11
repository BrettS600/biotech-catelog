Slab Scanner, the native trial app for the iPhone (n1): camera control, Apple's reader, every kind of test data

Brett's 16 web tests of 2026-11-10 said the page read 5-9 of the camera's 25 frames a second, a quarter to two thirds
of the frames were blurred, and Safari offers no shutter, exposure or focus control. He chose a native app, the free
route first (7 days at a time), and asked: "include any means of collecting data into the build, so that we can
optimize".

ios/SlabScanner (SwiftUI, iOS 17+, built and installed with Xcode on his Mac):
- the shutter capped (Smart: 1/250 with 1x, 1/500 with 3x, slower only when the light runs out; Auto; fixed), 12 MP at
  30 a second or 4K at 60, focus continuous or locked;
- Apple's Vision barcode reader on the whole picture, four tiles and nine tiles in turn, two frames at a time; a code
  counts when it looks like a PSA / CGC cert and was read in 2 frames (ITF: 3);
- a test's file: what the camera did for every frame (shutter, ISO, focus), the depth sensor's distances, the phone's
  movement 100 times a second, heat and battery, a video of every frame, six lossless frames (to read again with the
  web app's reader) and the photographs of the Snap button;
- 15 tests that set the switches and stop by themselves: distances with 1x and 3x, two shutter sweeps, focus locked,
  moving at 12 MP and at 4K 60, dim, snap.
The Xcode project is written by hand (a synchronized folder; DerivedData inside the project so the build log can be
read). CLAUDE.md: what the 16 web files said (the polarizer: off), how the app is built, installed and what comes next.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
