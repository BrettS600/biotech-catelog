Slab Show Scanner g13: the barcodes are found in the frame first and read by two readers; a number counts when the reading is sure

Brett ran seven tests with g12a and sent their files (real camera frames of the printed sheet): "depth is one of my
biggest concerns ... at least 2 feet instead of 1 foot away"; no testing with the Light ("I'm not going to be able to
put my light on at a vendor show"); "if you do go through with the next build, it will be the last build to the scanner
app ... do the best you possibly can." The files showed that one frame of g12a read 49% of the codes in view at 9
inches, 22% at 13 inches, 15% tilted and 7% in a dim room, at 2.5 frames a second, with 5 wrong numbers in 7 tests -
and that at two feet the 1x lens gives under one camera dot a bar.

- finder.js (new): the linear codes are FOUND in every frame (patches of fine stripes; straight, on their side or
  aslant - any way round), cut out along their own direction, their rows folded into lines, and read twice: by zxing on
  the lines, and by a Code 128 reader that never decides black or white (it compares the grey line with every pattern
  as the camera blurs it and takes the best reading whose check symbol agrees, both ways round). Lines beside a code
  (a label's border, a case's edge) are told from its bars.
- The same real frames, sure and strong readings per frame: 83%, 64%, 44%, 74% - and the same turned any way round or
  with border lines drawn beside the codes; no wrong number among them.
- A number counts at 2 points: sure (the two readers agree, or a QR) 2, strong 1, weak a half - at a show and in
  Test mode alike. The whole-frame zxing pass stays on one frame in four (QR codes, and a net); the evened, boosted and
  enlarged passes are gone.
- Depth: "Too far for 1x - move closer, or tap 3x" on the picture when the codes seen are too small for the lens;
  no more advice about the Light.
- Test mode: 8 tests (two with the 3x lens, one with the sheet turned); the map shows sighted-but-not-counted codes
  in amber; the report and the frame log carry each reader's time and each reading's class; the file holds a picture
  of the lines zxing was handed.
- sw.js: ssc-v13 (finder.js in the offline copy). CLAUDE.md: what the seven files showed, how g13 reads, the numbers,
  what could not be tried on an iPhone.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
