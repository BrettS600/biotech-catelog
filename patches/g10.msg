Slab Show Scanner: the phone app for card shows (home-screen web app at /app/)

Brett, 2026-11-09: the approved prototype plus "make the % field typable like the price field", "replace the recent card
sale with the review button", "add a min sales last mo variable to the show mobile tab" (default 5, variable), "add a
record purchases button so that they are sent to history tab on website"; a home-screen web app, everything now, the
sample show kept.

- page/app/ (new): index.html, app.css, app.js, sw.js (offline copy), manifest + icons, zxing/ (zxing-wasm 3.1.6 reader,
  vendored). Scan a table with the camera (PSA / CGC barcodes and QR codes), tables, the slab panel (typable % under or
  the vendor's $ price, Asked / No deal / Agreed / Bought, Review), Buys (best chance first by table, min sales last mo,
  the market gate, Record purchases -> History > Recorded Purchases as the website's button), Show settings.
- PSA slabs are looked up with PSA's Public API from the phone (Brett's token, kept on the phone); the PSA spec leads to
  the catalog card. CGC slabs: found by name until the Card Hedge step.
- The website: a "Phone app" button beside README opens the app in a phone-sized pop-up (Brett: "have it as like a button
  that's clickable, and then it'll just pop up"); on a phone it opens the app's own page. The home-screen icon is made
  from /app/, so it opens straight into the app ("I'd rather it just go straight to the mobile app").
- graded_site.py app_doc(): public/app/data.bin with the page's key - names, Card Ladder / PriceCharting figures per card
  and grade, the Forecast's odds tables and ranks (the website's Recording math).
- build_catalog.py copies page/app to public/app. CLAUDE.md: the app's notes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
