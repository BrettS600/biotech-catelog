Slab Show Scanner g13b: the most promising patches are cut first, within a time limit

A picture full of texture that runs one way (a wooden table's grain, a woven cloth - made up here, since the threshold
for faint codes also lets such texture in) gave a hundred slanted patches and 290 ms a frame, with nothing in it to
read. Patches are now cut in order of promise (area x contrast squared: a code's black bars on white come before print
and far before grain) and the cutting stops for the frame after 120 ms. A real sheet laid over that grain reads as on
a plain table; every other test reads as with g13a. The app says g13b; sw.js: ssc-v15.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
