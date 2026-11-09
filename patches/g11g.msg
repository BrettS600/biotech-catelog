Slab Show Scanner: 60 frames a second where the camera offers it, a Light button, camera details in the test report

Brett, 2026-11-09, third test: 1x about a foot, 38 of 50 in 54 s; 3x at ~2.5 ft, 0 (blurry). He felt the Camera app's
video was "far better ... in terms of how clear it was" and sent one: 1080p (his Camera app's setting), about 1 camera
dot per thin bar - no reader finds a single code in it; it looks clear, but the bars aren't resolved. The two levers
the web app has are distance (slab barcodes need the phone ~8-10 inches away with 1x) and motion blur.

- The camera is asked for 60 frames a second (a frame can't be exposed longer than it lasts); when 4K60 isn't offered
  the browser keeps 4K30 rather than dropping to 1080p60. The label on the picture shows the frame rate.
- A "Light" button on the picture when the camera offers its torch (iOS 17/18+); it stays on across lens changes and
  goes off at Stop.
- The hint and the Test note say 8-10 inches.
- The test report gains cameraDetails: the camera's name, size, frame rate, light, zoom and its range, the highest frame
  rate offered, focus modes and every camera's name - what Safari actually gives on his phone.
- The camera label moved to the bottom-left of the picture (it covered the counter). sw.js: a new offline copy
  (ssc-v5). CLAUDE.md: the third test, the Camera clip, the readers Brett found (tapirscan, react-native-qr-camera-pro).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
