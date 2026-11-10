Slab Show Scanner g14: a test's file holds everything; two reader threads, the pick of the sharp frames

Brett: "i want you have access to literally all data during the barcode test experiments so that we can successfully
optimize its reading abilities" (speed, depth, motion), then "yes do that ... i want to be on par with scandit".

A test's file (Test mode, Save test data) now also holds: the video of the whole test (MediaRecorder on the camera's
own stream), the phone's movement and tilt 60 times a second, every frame the camera showed, every box the finder
found in every frame read - read or not, with what each reader made of it - each frame's light and grain, the distance
by the size of the codes, when each code was first sighted and when it counted, all the camera says of itself, and
what happened when. Test mode has three switches (Polarizer, Video, Fast reading), two boxes (distance measured, a
note) and a plan of 18 tests: the far ones with 1x, one read the old way, six through the polarizer.

The scanner, at a show as in Test mode:
- two reader threads take turns at the camera's frames;
- the frames worth reading are picked: his seven test files showed that the blurrier half of a held-still phone's
  frames gave half the codes of the sharper half. A small square of each frame, where the codes are, is looked at
  before a reader gets it; a blurred one is passed over (never for longer than 0.3 s, and every fourth frame read is
  taken as it comes);
- a linear reading of the whole-frame pass is dropped where the finder's readers are sure of another: a replay
  counted a wrong number that way (four weak sightings of one misread). On 136 real pictures the one wrong reading
  goes and no right one.
The finder and the grey-line reader read every real test picture exactly as g13b did. Test mode's dots/bar for a
9-digit Code 128 was 12% high (101 modules, not 90).

The app says g14; sw.js: ssc-v16. CLAUDE.md: what the seven files said about speed, the new file's contents, what the
next files are for.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
