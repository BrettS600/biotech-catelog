Slab Show Scanner: Test mode collects data - a list of tests, a live map for screen recordings, real frames to save

Brett: "I'm going to try it two more times ... the previous builds have not been effective enough because the data
that was collected from the test runs was insufficient ... if there's any stuff you can add to the build for
collecting data, then please do so on the video side." And: "this is just one lighting condition ... I want this test
to translate across other conditions." A screen recording has a third of the camera's detail, so until now the reader
was tuned on simulated pictures. The reader itself is g11l's, unchanged.

- Test mode names the next of eight tests (sleeve at 9 inches, Light on, bare paper, far, tilted, a sweep, another
  light, his choice) under the record button; every recording is a test of its own and Stop moves on to the next.
- Beside the Stop button, every frame: frames a second, the kind of frame just read, sharpness, glare, each kind's
  last whole-pass count, seconds since a new code, and a 5 x 10 map of the sheet (bright = read in this frame) - so a
  screen recording of a test carries its data.
- "Save test data" after Stop: one ZIP with up to 10 frames as the camera gave them (JPEG 0.92, made in the worker
  before the light is evened; thinned out as a test gets longer, so about 25 MB at 4K whatever its length), the
  lossless middle of the first, quarter-size copies of the evened picture, and report.json - the old report plus a
  line for every frame and, for every kept picture, each code read in it with its corners. Shared through the phone's
  share sheet (AirDrop), or downloaded where a browser will not share a file. Nothing is sent anywhere by the app.
- sw.js: a new offline copy (ssc-v11). CLAUDE.md: his plan, what the file holds, what to do with it.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
