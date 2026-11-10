Slab Show Scanner: the light is evened before a frame is read; Test mode shows a map of the printed sheet

Brett's fourth test came as 12 screenshots ("Can i just record my screen next time"): 4K at 30 fps, and three runs
that stopped at 37, 37 and 36 of sheet 2's 50 codes. The codes never read lay in the shadow of his phone and hand
(shaded paper 78-98 against 200-210 lit) - fat-barred ITF codes among them - and with the Light on, under its glare
and in its fall-off. zxing reads a linear code with one brightness threshold for a whole row of the picture; shaded
paper falls under it.

- scan-worker.js evenLight(): each part of the frame is divided by the white level around it before it is read (a
  1/16 map by halving, a closing so bars and print are filled while a shadow's edge stays put, the canvas's
  color-dodge blend). What is not paper - under 17% of the picture's own white - is left alone. Simulated at his depth
  of shadow, four frames of 50 codes: 186 read as it is (the whole pass alone 120), 200 (199) evened; a hard-edged
  shadow 183 -> 200; with a table sharing the rows 158 -> 191, on felt 87 -> 183; the plain sheet 190 -> 193. Both
  steps are tried once at the start on tiny canvases; where a browser does either differently the frames are read
  as before.
- Boosted frames: where there is print the divisor leans towards the print's own mean, lifting a small or tilted
  code's greys to where the reader's high threshold wants them: 45 degrees 133 -> 171 codes of 200.
- Three kinds of frame by turns - evened, evened + boosted, as it is. In the app on the simulated cameras, g11k ->
  g11l: a 30% shadow 28 of 40 -> 40, 45 degrees 39 -> 46, a foot away in his shadow 46 -> 50; the rest unchanged.
  Test mode counts the whole-frame pass's codes on each kind and which kinds ever read each code, so his next run says
  what each is worth on his phone.
- Glare cannot be evened: while codes are read but no new one has come for 4 s and over 1.2% of the picture is blown
  out, the picture says "Glare - shift or tilt the phone a little".
- Test mode knows the 400 numbers of the printed sheets: after Stop it shows "N of 50 read on sheet S", a 5 x 10 map
  (green with the second a code was first read, outlined if only the evened light got it, red if never) and nine
  lines of numbers - one screenshot instead of the pasted report.
- The Photo test is gone: on his phone it left the live picture black and 144 x 192 and its photo read no code. The
  camera is started again by itself when its picture ends or collapses (three times a recording at most).
- sw.js: a new offline copy (ssc-v10). CLAUDE.md: the fourth test, the evening and its pitfalls, the test pictures.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
