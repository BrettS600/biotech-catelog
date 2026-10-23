Review reads the listing on demand; alert histories keep their facts (Brett, 2026-10-23)

Why "not read": a full look is one of the 5,000 eBay calls a day and discovery, the re-reads and the sales confirmations come first, so most listings never get one; the auction and hit alerts had read the listing but kept neither its facts nor its condition text, so every auction row said "not read". Now the auction / hit histories keep them (au rows 29-30, hh rows 31-32) and the page shows them; and Review on a listing with an incomplete eBay side (no photo, facts never read, n/s with eBay's condition unread) asks the collector for one full look right then - open, closed or long gone - which fills the photos, condition and set / rarity on whatever holds the listing, answers the page on the reply topic and publishes at once (SITE_READS_PER_HOUR 60). help.js follows in its own commit. Tests: ut/test_siteread.py, t/test_read.js.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
