# CLAUDE.md — Pokémon card catalog (repo: BrettS600/biotech-catelog)

Read this first. It is the whole context; the owner (Brett) would rather not re-explain.

## What this is
A private, password-protected website for buying and reselling **raw (ungraded) Pokémon singles on eBay**.
Live at https://bretts600.github.io/biotech-catelog/ (GitHub Pages, encrypted with staticrypt).
Everything runs on GitHub Actions; nothing runs on Brett's laptop. Never commit secrets or data.

Three tabs:
1. **PriceCharting Catalog** (default) — 43,891 English singles from PriceCharting's daily CSV, plus trend
   columns computed from this site's own daily snapshots (Δ7d/30d, 90-day range, volatility, Theil–Sen slope,
   volume drift) and a per-card Trend popup with a chart and a buy-gate table.
2. **eBay Catalog** — one row per card, numbers computed ONLY from eBay (PriceCharting is used just as the
   list of card identities). Four colored header bands: Observed (blue, independent inputs),
   Rates (green, from Observed), Decisions (amber: Anchor / Floor / Sell / P(sale in window) / Exp. days / Max buy /
   Net / Hot — depend on the two anchors and the Confidence, Window and Margin boxes),
   Trends (purple: the PriceCharting trend formulas applied to a 7-day median of raw sale totals, from the
   collector's per-card daily rollup kept 120 days; an eBay Trend popup shares the PriceCharting chart code).
3. **eBay Raw Data** — every matched raw listing first seen in the last 24 h, with the card's Anchor, this
   listing's own Sell $ / Max buy / Profit $ / ROI %, a PASS/reason verdict, Risk (scam-screen tier), Photos, Status and
   Time (h), plus PC ungraded $ and vs PC % (the PriceCharting price of the matched card and the listing's distance
   from it - the wrong-match rule, see "Is it the right card?"). Filters: Profit, ROI, "Listed within N h" (one
   number), a Condition chip (NM / LP / n/s), "Show suspects", "Too cheap only" (the mismatch-low list to check by
   hand). Listings with < 2 photos are left out; a "Scam screen" button shows the calibration table.

Top bar: Confidence (default 70%) and Window (default 48 h) — together the liquidity rule — "Only show hits"
(Raw Data → PASS rows only), Margin (default 10%), Buy tax (default 6.25%; Brett sets it to 0 the day eBay approves
his MA resale certificate — the machine's own figure is the BUY_TAX_PCT line in /etc/pokemon-collector.env, default 6.25,
and only affects the hourly log counts),
LP correction chips (read-only, three price tiers, see below), Calibration checkbox, README button (the
README modal contains the full method walkthrough — keep it in sync when the model changes).
Every table header has a `?` (help) and an eye (collapse the column to a thin strip; remembered per tab).

## Files
- `build_catalog.py` — daily build. Downloads PriceCharting CSV, filters, computes trend stats from
  snapshots, writes `site/index.html`. The page itself lives in `page/`: `style.css`, `body.html`
  (the three tabs' markup), `app.js` (the browser logic) and `help.js` (the README text and the column
  help), stitched into a shell template at build time — edit those, not the Python, for page changes.
  In `help.js`: every column has a `?` help entry in the `HELP` dict; the README text is the `README`
  constant; column dependencies are the `LINKS` dict. Keep each page file under ~90 KB so it can be
  pushed through the connector in one call.
  Decision columns are recomputed in the browser (`decide()`), mirroring `compute_stats()` in the
  collector — keep the two in step.
- `ebay_sweep.py` — the collector's statistics module (and the manual-only Actions fallback). Sweep (newly listed, Ungraded condition id 4000,
  category 183454, $25–500, fixed price, US) → title matching → tracking (hourly presence sweep +
  single `getItem` calls; batch getItems is partner-only) → per-card stats → `live/ebay_live.bin`.
  `api_get()` retries connection errors; a failed lookup in enrich/track skips that listing, never the run.
  Constants at the top: sweep band, tracking cadence, gate (fee, shipping, tax, margin), CONFIDENCE,
  DEPTH_CAP, UNDERCUT, BO_HAIRCUT, hot-card thresholds, calibration thresholds, DAILY_KEEP_D / MED_WINDOW_D
  for the trend rollup. `--dry-run` uses `fixtures/`.
- `.github/workflows/update_catalog.yml` — daily 10:00 UTC + manual. Downloads snapshots from the
  release, builds, staticrypts, deploys Pages, uploads new snapshots. Counts only `pc_catalog_*` assets.
- `.github/workflows/ebay_sweep.yml` — manual only (`workflow_dispatch`; the schedule was removed 2026-10-01 when the
  machine took over), concurrency group `ebay`. Runs the collector, then
  force-pushes `live/ebay_live.bin` to a one-commit `live` branch (the page fetches it via
  raw.githubusercontent.com, which allows CORS; release assets do not).
- `requirements.txt` — pandas, numpy, requests, cryptography.

## Storage (git must stay small)
- Daily PriceCharting snapshots (`pc_catalog_YYYY-MM-DD.csv.gz.enc`, every PriceCharting column) and the
  collector state (`ebay_state.json.gz.enc`) are **release assets** on the release tagged `snapshots`,
  never committed. Encryption: AES-256-GCM, key from SITE_PASSWORD (PBKDF2), layout salt16|nonce12|ct.
- The eBay live file uses a deterministic key (PBKDF2 of SITE_PASSWORD with fixed salt
  `biotech-catalog-live-v1`) embedded in the page as `HKEY`; the history shards use the same key.
- The `live` branch is force-pushed every couple of minutes by the machine on purpose (no history growth).

## Secrets / variables (GitHub → Settings → Secrets and variables → Actions)
`PC_DOWNLOAD_URL` (PriceCharting CSV link or bare token), `SITE_PASSWORD`, `EBAY_CLIENT_ID` (App ID),
`EBAY_CLIENT_SECRET` (Cert ID), variable `BUYER_ZIP`. Production keyset; account-deletion exemption ticked.
eBay app token = client-credentials, scope `https://api.ebay.com/oauth/api_scope`. Budget 5,000 calls/day.
`lookup_budget()` reserves the day's remaining sweeps (8 calls each) and hourly presence walks (40) first and
spreads whatever is left over the remaining runs as getItem lookups (enrich gets 1/7, track the rest, capped at
6 / 35); it recomputes from actual usage every run, so sweeps never get skipped for budget. Hard stop at 4,950.

## Where it runs now (2026-09-30): a rented machine
The eBay side moved off GitHub Actions to a DigitalOcean droplet ("pokemon-collector", $6/mo, Ubuntu 24.04, NYC1)
running `collector.py` as a systemd service (`pokemon-collector`). Reasons: GitHub's terms don't cover an always-on
data collector, scheduled runs can't go under 5 min and get delayed, and 1-minute discovery needs a loop. Layout on
the machine: /opt/pokemon-collector/{repo,venv,data,.ssh}; secrets in /etc/pokemon-collector.env (only there — never
in the repo); state in data/ebay_state.json.gz.enc; results force-pushed to the `live` branch with a deploy key
(ebay_live.bin, collector.log, hourly state backup). `setup.sh` installs all of it (`curl … | bash` as root).
Operating it: the machine pulls `main` every 5 min and restarts itself when collector.py / ebay_sweep.py change, so
pushing to GitHub is still the whole deployment step; its log is `collector.log` on the `live` branch (read it with
the connector, ref=live); on the machine: `journalctl -u pokemon-collector -f`. Budget: eBay's own remaining-calls
figure (Developer Analytics `rate_limit`, read hourly) paces everything; discovery is reserved first, the rest is a
token bucket (`refill()` / `spend()`). Outcomes: hour windows by listing start date re-read with the search endpoint
(`itemStartDate` filter, $35–500 band; hourly for day 1, 6-hourly to day 3, daily to day 10), one getItem per
vanished listing, the 3 cheapest copies of every priced $40–500 card re-verified every 48 h, keyword-only listings
checked at day 1 and 3, open listings closed as stale at 30 d. A self-test on start proves the date-window filter
works before re-reads are enabled (`window_ok`). The Actions workflow `ebay_sweep.yml` is the fallback (manual only
once the machine is confirmed publishing); it must not run on a schedule at the same time, since both force-push
the `live` branch.

## Is it the right card? (identity checks, added 2026-10-04 at Brett's request)
Brett's two fears: buying a card that was matched to the wrong (dearer) catalog row, and missing deals the matcher
refused. Nobody has measured the matcher's accuracy yet (see Roadmap 2). What guards identity now, all in `ebay_sweep.py`:
- `match_title()`: REJECT words -> ePID (only when the title agrees: `epid_match()` checks the card number, the printed
  total and the name; the old code trusted the ePID blindly) -> card number -> set, by its words in the title or its
  printed total -> the card's name must be in the title -> the printing (`resolve_variant()`: the most specific claimed
  variant wins, so "Master Ball reverse holo" is the Master Ball row). `unknown_printing()` / CLAIM_WORDS: a title that
  names a printing the catalog lacks for that card (reverse, 1st edition, shadowless, jumbo, Master/Poke Ball, staff,
  prerelease, cosmos) is unmatched ("printing not in catalog"), never filed under the plain card.
- Printed set totals come from the open Pokemon TCG dataset (`official_totals()`, cached on the Catalog as
  `cat.totals`; the same alias rules as `set_totals()` in build_catalog.py - keep the two in step). Sizes learned from
  titles (`state["denoms"]`) remain the fallback. Between two sets that both fit a title, the one whose total matches
  wins unless the other is named with more distinctive words ("4/130 Base" -> Base Set 2; "4/102 Celebrations" stays
  Celebrations). A match whose total contradicts the set reads "number+set (total differs)" in `how`.
- Price against PriceCharting (`pc_flag()`, stamped every cycle by `stamp_pc()` as `rec["pc"]`, `rec["pcm"]`): total
  under PC_LOW (40%) or over PC_HIGH (300%) of the card's PriceCharting ungraded price = a wrong match. Skipped when
  PriceCharting has under PC_MIN_SALES (20) sales/yr, when the set is under PC_NEW_SET_D (30) days old, and on the
  low side for MP/HP copies. Verdicts "mismatch: too cheap" / "mismatch: too high". Brett asked for this as a HARD
  rule (not a warning); the too-cheap ones stay visible on Raw Data behind the "Too cheap only" chip.
- Item specifics (`verify_hits()` -> `check_identity()`): a listing from the last 24 h that clears the price gate at
  any margin (liquidity ignored, review band included) gets ONE full getItem; card number, card name, set
  (`Catalog.set_fit()`), language, graded, card size and finish/features are compared with the matched card ->
  `rec["idv"]` = ok / conflict / none, `rec["idr"]` = what disagreed. A conflict turns PASS into "ID conflict". On the
  machine these lookups run first among the optional work (<= VERIFY_MAX_CALLS a minute, VERIFY_DAILY_MAX a day).
- The same lookup settles the PRINTING (2026-10-04, Brett's idea): Finish / Features / Card Size are read as title
  words (`printing_words()`) and matched to the bracketed printings the card has. If they name another row of the
  same card, the listing is re-filed there (`refile()`, `how` gets "+specifics") - but only when the title names no
  printing of its own and the listing's price fits the printing named (PRINT_FIT); a title that says otherwise, or a
  price that does not fit, makes it a conflict. A printing the catalog lacks is a conflict; a bare "Holo" or silence
  moves nothing. Lookups beyond the gate
  (ranks 3-6 in `verify_hits()`, one per PRINTING_EVERY_S, PRINTING_DAILY_MAX a day): unmatched "ambiguous variant"
  titles kept in `state["pending"]` (>= PENDING_MIN_TOTAL, PENDING_KEEP_H hours; `settle_pending()` files them with
  `how` = "specifics"), and mismatch-flagged listings that another printing's PriceCharting price fits (PRINT_FIT).
  Hourly log lines "Printing: ..." and "Unmatched this hour: ..." (by reason) show whether it earns its calls.
- Trial result (2026-10-04; `aspect_trial()` in collector.py, now off with TRIAL_RUNS = 0): eBay's filtered search
  works for values it knows - `aspect_filter` Finish:{Reverse Holo}, Features:{1st Edition}, Language:{Japanese} each
  returned listings whose own specifics said so (3 of 3 read back). A value it does not know is silently ignored and
  returns everything (Card Size:{Jumbo}; the real value is Oversized). The $25-500 band held 504,500 raw singles:
  Finish Holo 391k / Regular 65k / blank 30k / Reverse Holo 27k; Features blank 227k / Full Art 112k / Promo 78k /
  Unlimited 55k / 1st Edition 28k / Stamped 12k; Language English 421k / Japanese 58k / blank 23k / Chinese 5.6k /
  Korean 2.1k; Card Size Standard 305k / blank 198k / Oversized 1.9k. Of 174 tracked listings whose Finish says
  Reverse Holo, 14 sat under a non-reverse row; of 140 with Features 1st Edition, 60 sat under another row, but
  Features is keyword-stuffed (a title saying Unlimited carried it), so that claim is not trusted on its own. 4 of
  200 Japanese-language listings were tracked as English cards. NOT built yet (ask Brett): tagging sweeps for
  Reverse Holo / Oversized / non-English languages, roughly 4 filtered searches every 15-30 minutes.
- Unmatched reasons, first hour measured: no card number 68, rejected 55, no set/name agreement 30, ambiguous set 8,
  ambiguous variant 6, printing not in catalog 4 - titles with no card number are the biggest recall loss.
- First look at the real flagged listings (2026-10-04, read off the unlocked site through Chrome): of 224 too-cheap
  flags in 24 h about 80% were 30th Celebration Classic Collection reprints filed under the ORIGINAL card (Lugia
  149/147 -> Aquapolis: the reprints carry the original number and total), most of the rest scam-screen suspects, no
  real steals in the 75 read. Of 957 too-high flags most were plain overpricing (43% on cards PriceCharting values
  under $8.34, seen only because the sweep starts at $25), then NM vintage reverse holos, stamped / error printings
  and a few wrong cards. Fixed the same day (MATCH_VERSION 2, then 3): an anniversary word in the title ("30th", "25th",
  "Celebrations", "Classic Collection") sends the listing to the anniversary set's own row when it has one, and
  otherwise bars every card printed before that year (an undated row takes its set's date - PriceCharting leaves
  rows like Charizard [Black Dot Error] undated, and they slipped through at first); the name check goes by the first
  word that is not generic (`nkey`, GENERIC_NAME), so "Mega Mewtwo EX" is no longer Mega Lucario ex; "Non-Holo" no
  longer claims the [Holo] row; a lone [Jumbo] / [Staff] / [Prerelease] row is never the default; "Stage 2" is stripped so its 2 is not Base Set 2's; and `title_condition()` no longer
  reads hit points ("120 HP") as Heavily Played - that one had kept about 860 listings a day (9%) out of the
  statistics and the gate.
- `rematch()` and MATCH_VERSION: when the matcher changes, bump MATCH_VERSION. On its next start the collector runs
  the current matcher over every stored open and closed listing (moves it, drops it, re-reads the condition) and
  rebuilds the daily rollup, so an old mistake does not sit in the numbers for weeks.
- `wrong_card(rec)` (a mismatch flag or an ID conflict) keeps a listing out of `comparable()` and of every sold
  statistic: lambda, the anchor, the book, the daily rollup, the LP correction, the calibration tables.
- Live rows carry 27 pc, 28 pcm, 29 idv, 30 idr (appended, so an older page keeps working); the page mirrors the
  verdict in `verdictOf()` / `verdictCell()`. The hourly log line "Identity: ..." counts the flags.
- Tests used for this change (rebuild them the same way): a `fixtures/` folder with catalog.csv (id, console-name,
  product-name, epid, release-date, loose-price, sales-volume), sets.json (a copy of the dataset's sets/en.json),
  search.json, items.json (with localizedAspects), state.json; `match_title` cases for shared totals, reprints,
  variants, ePIDs and rejects; the page in jsdom.

Spare-call order since 2026-10-04 (`cycle()` step 3): identity lookups -> window re-reads -> one book check ->
confirmations -> keyword checks / enrich. Two starvation bugs led here: confirmations once took every token, so no
window was re-read for three days; then a 5-token reserve on confirmations plus unreserved book checks (34cf4e3) let
the book checks take everything - 0 windows and 0 confirmations an hour while about 650 listings an hour were
flagged as gone. The rules now: when a re-read is due and the bucket cannot pay for it yet, nothing after it spends
that minute (so the bucket reaches the price of a big window); book checks cover only copies the re-reads cannot see
(`rereadable()`), on cards with an anchor, one per cycle; confirmations get all the rest, in `confirm_queue()` order -
price band first, then the card's PriceCharting sales count (a where-to-look prior, never a model input: only a
fast-selling card can pass the gate, and its rate is only right if nearly all its sales are seen), newest flag first;
a listing flagged as gone leaves the book at once (`compute_stats`) and is dropped after VANISH_KEEP_D days if no
lookup reached it. The hourly "Waiting:" log line shows the three queues - read it before changing this again.

## Why there are almost no hits, and the three things added for it (2026-10-04)
Brett saw one PASS in a day and asked whether to drop the eBay model for PriceCharting prices. Measured on that
day's listings: 2,010 of ~9,000 could be judged (51 liquid anchored cards at his settings); 45 were 30%+ under the
anchor, nearly all "over max buy" because cheaper copies were already listed (prices of the new 30th Celebration set
were falling). A PriceCharting-only gate would have flagged ~140, mostly traps: stale prices on new sets (Mew ex SIR
$147.66 on PriceCharting, unsold copies at $83-101), vintage cards cheap for their condition, reprints, zero-feedback
sellers. The sales tracker had also been missing most sales since Oct 1 (see the spare-call order above). Decided:
- NOT PriceCharting-only. PriceCharting as a fallback anchor for cards with < ANCHOR_MIN eBay sales, capped by the
  cheapest believable live copy: verdict "LEAD" (`lead_decision()` / `leadDecide()`, LEAD_* constants; 49 that day).
  Leads get the item-specifics lookup (rank 2 in `verify_hits()`), a "Leads only" chip, and never count as a hit.
- Offer list (page only, `offerRows()` / `openOffers()`): open Best Offer listings from every card's book where an
  offer at that listing's Max buy is <= 30% under the ask. Brett sends offers by hand; no API can.
- Auction trial (`auction_read()` / `auction_finish()` in collector.py, log only, AUCTION_TRIAL_DAYS = 4, about 240
  calls a day outside the token bucket): the collector reads fixed-price listings only; this counts how many auctions
  on priceable cards close at or under max buy. Read the hourly "Auction trial:" line and the "closed UNDER max buy"
  lines, then decide whether to build an ending-soon list. Bidding stays with Brett (or a sniping service).
- A neural network was considered and rejected: no completed flips to learn from, and it cannot create mispricings.
- Phone alerts (2026-10-05): `alert_hits()` in collector.py pushes each new PASS once through ntfy (`push()`), in the
  same minute it is found (its item specifics are read first). The channel name is NTFY_TOPIC in
  /etc/pokemon-collector.env - Brett types it on the machine, never in chat; without it nothing is sent, and a one-time
  "Alerts are on" message confirms the wiring. The alert's link opens `page/hit.html` (published unencrypted next to
  the site by the workflow; it holds no data - the hit travels base64 in the link's # part, built by `hit_payload()`).
  The screen follows Brett's spec: the matched PriceCharting card (name with brackets, number / set total, printing,
  ungraded price, a button to PriceCharting's own page for its picture - their feed has no images and scraping them
  is not allowed) beside the eBay photos; Yes / No; then NM or LP with each one's Max buy, profit and ROI, LP locked
  under his margin; scam points with reasons on "watch" listings. NM / LP opens the listing in the eBay app: the
  purchase itself is always Brett's tap (eBay's 2026 user agreement bans automated buying). Not built yet: alerts for
  LEADs, the 10-minutes-before-the-end auction alerts (waiting on the auction trial), decision logging.
- `settings.json` (repo root) holds Brett's gate numbers - margin_pct, buy_tax_pct, confidence_pct, window_h.
  `apply_settings()` in collector.py re-reads it whenever it changes (no restart), and the collector's verdicts and the
  phone alerts follow it. The boxes on the site only change what the page shows in his browser; they never reach the
  machine. When he asks for different numbers for his alerts, edit this file.
- Alerts tab (2026-10-05, the fourth tab; `al*` functions at the end of app.js, `#p-al` in body.html): the numbers
  that decide what reaches the phone - margin, buy tax, confidence, sell window, minimum profit in dollars, buy price
  range, hits / leads / scam-watch switches, quiet hours - each with a `?` popup (HELP keys `al_*`). The boxes at the
  top of the page stay what they were: filters for the tables in Brett's browser. "Save alert settings" cannot write to
  the repo or the machine (the site is a static page), so it posts the settings to a private ntfy channel that
  `read_requests()` in collector.py polls every cycle. The channel name and the HMAC key that signs each message are
  both derived from the live key (`es.live_key(SITE_PASSWORD)`, the page's HKEY), so nothing had to be set up and a
  forged or replayed message is ignored. Accepted settings live in `state["vps"]["alert_cfg"]` and override
  settings.json (now only the starting values); `apply_settings()` puts them into the gate each cycle; `alert_hits()`
  applies the filters; `alert_status()` reports what is in force as `live["alert"]`, which the tab shows as "On the
  collector now" and uses to confirm a save. The tab's Preview re-judges the last 24 h of listings in the browser with
  the numbers typed in, saved or not. "Send test alert" asks the collector for one over the same channel. Hits push at
  priority 5, leads at 3, anything during quiet hours (America/New_York) at 2.
- Price drops and history (2026-10-05): a re-read that finds a LOWER price queues the listing in
  `state["vps"]["drops"]`; `alert_hits()` judges it with `es.verdict()` and alerts it as "Price drop: ..." (older
  listings are not in the live rows, so this is their only way in). Every alert is appended to
  `state["vps"]["alert_log"]` with a one-time token; the alert link carries the token and the request-channel name,
  and hit.html posts Brett's final tap back ({"dec": {i, tk, d: nm | lp | no}}, unsigned - the token vouches for
  it). `alert_status()` sends the last 40 as `live["alert"]["hist"]` with each listing's fate; the tab's History card
  shows them. His No taps are the running accuracy check on matching. Not built yet: the auction alerts.
- PriceCharting's picture on the check screen (2026-10-05): `pc_image()` reads the image address off the matched
  card's public page when an alert goes out (one page per card, remembered in `state["vps"]["pc_img"]`) and the link
  carries it as `pci`; hit.html shows it beside the eBay photo and falls back to the button. PriceCharting's API and
  CSV have no image field; their terms of service have no clause against automated access (the limits are on sharing
  Price Data with third parties) and robots.txt allows /game/ - both read through Brett's browser that day. An earlier
  note in this chat that it "needed their permission" was a guess and was wrong.
- Why the photo check matters: the one hit of Oct 4 (eBay 128114641633) had title AND item specifics for Charizard
  11/108 Evolutions while its photo showed a Charizard VMAX. No text check can catch that; only the picture does.
- Auction alerts (2026-10-05, Brett chose the single 10-minute ping over a 10 + 2 pair: he reviews the card, then
  watches the listing and bids by hand in the last seconds): `auction_alerts()` in collector.py runs every 5 minutes
  with one search for auctions ending 9-15 minutes out (`itemEndDate:[a..b]`, falling back to `[..b]`), keeps those on
  priceable cards whose bid + shipping + tax is still under Max buy and that clear the Alerts-tab filters (profit and
  price range are applied to the max bid), reads item specifics and photos for up to 4 a run, and pushes "Auction ends
  in N min · bid up to $X". The check screen shows the current bid, a countdown, and NM / LP with the max bid for each
  (`d.au`, 5th element of `nm` / `lp`). `auction_finish()` always reads the final price of an alerted auction and the
  History card shows it beside his max bid. The Auctions switch on the Alerts tab turns it off; with it on, this reader
  also feeds the trial's watch list and the trial's own 10-minute read is skipped. Expect many alerts and few wins:
  about 4% of the trial's first 69 auctions closed under Max buy, and most bids land in the final seconds.
- Tables (2026-10-05): every table row starts with a row-number cell that `makeTable` adds itself (`td.rn`, header
  "Row"; not part of the row data, so `data-k` indices are unchanged). Only the row of column names stays in view
  while scrolling: `.wrap` has NO overflow (with `overflow-x:auto` it became the sticky container and the header never
  stuck), the page itself scrolls both ways, and `th { position:sticky; top:0 }` pins the names to the top of the
  window; the group band on eBay Catalog is not sticky. A first version put each table in its own window-sized
  scrolling box - Brett rejected it the same day because the tabs, settings and filters then stayed on screen too.
  More rows load as the bottom of the page nears.
  Raw Data rows gained index 40 = PriceCharting sales per month (12-month count / 12) and 41 = eBay sales recorded in
  the 30-day window (`cs.k`); the order key stays the LAST element (`ordOf`). `cfg.inserted` is now a list of
  column insertions, each applied once to a saved hidden-column choice.
- LP correction tiers all showing one figure is by design, not a bug: a tier uses its own measurement only once it
  has LP_MIN_SALES (30) LP sales with a same-card reference; until then every tier falls back to the pooled figure
  (the chip now says "(pooled)").
- Revenue tab, step 1 of 2 (2026-10-05): Brett wants a tab of his OWN flips - purchase total (shipping and tax in),
  hours the listing had been up when he bought, sale total, hours it took to sell, net - plus card / set / number,
  purchase and sale dates, HOURS held (he asked for hours, not days), ROI, fees and shipping paid, source (hit, lead,
  offer, auction), predicted vs actual net, status, cash tied up; with a period picker (year, then a month range 1-12
  or a day range) showing total net, and the same picker on Raw Data for "what every hit would have netted" (sum the
  alert log; a ceiling). He chose automatic over a hand-kept sheet, so the data comes from his eBay account:
  `account.py` reads his sales (Sell Fulfillment `getOrders`) and purchases (Trading `GetOrders`, OrderRole Buyer)
  every half hour once EBAY_REFRESH_TOKEN is in /etc/pokemon-collector.env, and keeps them in `state["acct"]`
  (eBay only reaches back 90 days). Linking is his one-time act: he adds an eBay Redirect URL (RuName) in his
  developer account pointing at `link.html` on the site, approves on eBay, and runs `ebay_link.py` on the droplet with
  the code. The log gets counts only - it is public. Linked 2026-10-05 20:09 UTC (approval lasts ~547 days; his
  RuName is Brett_Schroyer-BrettSch-Cardca-yzzfsuzwm, accept / decline URLs left on eBay's defaults). The first pull
  succeeded and returned 0 purchases and 0 sales, so NOTHING in account.py has met a real order yet: the field names
  in `sale_rows()` / `buy_rows()` were written from memory of eBay's documentation - check them against the first
  real record.
- Revenue tab, step 2 (same day): `account.ledger()` builds one row per card bought, paired with its sale (exact when
  the sale's Custom label / SKU is the purchase's item number, else same matched card, oldest purchase first), plus
  sales with no purchase; `account.enrich()` finds when each listing went up (own records, else
  get_item_by_legacy_id). Net = sale total - actual eBay fee - SHIP_OUT - SUPPLIES (estimates; real label costs are
  not read yet) - paid. Rows ride in `live["acct"]["rows"]` (22 fields, see the docstring); the tab is table `rv` in
  app.js with `after: rvSummary`. `periodBar()` is the shared picker (year, then months a-b, or days a-b of one
  month); Revenue filters on the SALE date (purchase date for unsold cards). Raw Data's "if you had bought every
  hit" line sums `live["alert"]["all"]` (every logged alert: [when, promised profit, kind, answer]) over the same
  kind of period; hits only, with and without the ones he answered No to.
- Scam screen, first re-weighting (2026-10-06, from the popup's outcome table: 5,774 closed listings, "gone" 0.5%
  clean / 3.2% watch / 11.5% suspect): fb1 (seller 10-49 ratings), pct and ret no longer score (their listings were
  pulled no more than clean ones; the gate's seller bar is separate and unchanged); `dup` (photo also used by another
  seller: 8 of 16 gone, none sold) makes a listing suspect by itself. SCAM_POINTS holds the points for alert text.
  Brett chose to be ABLE to hear about suspects: Alerts-tab switch "Suspect listings" (cfg `suspects`, default off).
  With it on, `alert_hits()` re-judges a suspect with its tier set aside and, if it is a hit / lead, alerts it titled
  "SUSPECT: ..." with every reason and its points (`scam_words()`), reads its item specifics on the spot (suspects
  are not in the identity queue), and passes `risk` = [gone, closed] for the tier so the check screen can say how
  often such listings were pulled. A `dup` listing never alerts. Suspects stay out of all statistics. He turned down
  a separate, higher minimum profit for suspects. Auction alerts now carry the score's seller signals (fb0 / fbq /
  top / est) and respect the watch switch. The Alerts tab's checkboxes are drawn as on/off switches.
- THE 2-DAY RULE (2026-10-06; Brett: "I really only care about the cards that sell within 2 days"). Measured that
  day: 4,900 calls used of 5,000 (discovery + keyword page 1,730, re-reads 760, confirmations 1,370, auctions 420,
  identity / printing / enrichment 590), 3,270 listings flagged vanished a day, 13,300 waiting. Now a listing is
  followed for its first 2 days only (`es.FOLLOW_D`): re-reads every 3 h on day 1 and every 6 h to day 2.5
  (`REREAD_MAX_AGE_D`; the extra half day is what proves a listing was still up at 48 h), and `close_stale()` settles
  everything older than `STALE_D` = 2.6 days with no lookups: flagged inside its first 2 days -> stays in the
  confirmation queue; `survived()` (seen for sale at 48 h or later) -> `es.close_outlived()` = "stale"; never seen
  again after its last re-read -> removed, counted in nothing. Two exceptions he agreed to: a card's cheapest copies
  (its `cred` list and the first 3 of its `book`) stay open up to `RETAIN_MAX_D` 14 days and the existing book checks
  watch them on anchored cards; suspects get one lookup at `SUSPECT_LAST_D` 6 days (`suspect_queue`). A "stale"
  record is kept in full only when the listing carries a model stamp (ratio0 / p48_0) and only 31 days - 4,000 full
  records a day would not fit in the 1 GB droplet. The rest leave counts: `state["unsold"][card][first-seen day]`
  (feeds mu and the sell-through pool), `state["scam_stale"][day]` (the scam table's stale column; `scam_calib` adds
  it), `state["imgs"]` (photo -> seller, so a borrowed photo is still caught). CONSEQUENCE HANDLED IN THE GATE:
  `is_liquid` also required a 7-day sell-through >= 50%, which the data can no longer answer; sell-through is now the
  share sold within 48 h (pool: comparable listings first seen 3-33 days ago), and the bar is `ST_MIN` 0.25. It
  was first set to 0.20 (50% in 7 days at a steady selling rate = 18% in 2), then checked against the real listings
  at the switch (`st_translation`, logged as "Sell-through check"): of 79 fast cards with 7-day-old listings only 19
  passed the old bar, and on those same listings their 48-hour share ran 25% (lowest), 36% (lower quarter), 50%
  (middle) - sales come early, so 20% was too loose (it made 51 cards liquid against 39 under the old rule). 0.25
  keeps all 19 and admits nothing weaker than the weakest of them. HOT_MIN_SELLTHRU 0.80 -> 0.35 by the steady-rate
  formula, unchecked. The page mirrors the bar (`isLiquid`, st >= 25). The hourly "Liquidity:" log line counts the
  fast cards at 20 / 25 / 30 / 35% - the real test is the price calibration, once a month of 48-hour data exists.
  FIRST SETTLE (14:48 UTC): 13,252 outlived (4,869 full records), 769 lost sight of, 5,316 cheapest copies and 250
  suspects kept. The waiting queue still showed 11,573 "vanished inside 2 days", but most of those are the mass
  flags of Oct 4-5 (no `seen_open` yet then, so they cannot be told apart) and drop on Oct 7-8: the young / old
  split of the ~3,270 daily flags is therefore still NOT measured - read the hourly "flagged" count once those are
  gone before trusting any budget estimate. AT THE 25% BAR (15:00 UTC): 101 cards fast by sales rate; at 20 / 25 /
  30 / 35% the count passing was 50 / 31 / 20 / 12, so 31 liquid (39 that morning under the old rule, which had
  measured few cards yet and was heading for about 19 in 79). Listings passing the gate fell from 4-6 to 1. Two
  faults in that first figure were then fixed: the pool cut records by the hour and counts by the day (unsold
  counted, sold not, for part of a day - heavy while the pool is five days deep), and it counted
  vanished-but-not-yet-looked-up listings as unsold; the pool is now by first-seen calendar day on both sides and
  leaves unknown outcomes out. `st_translation` did its one job and was removed (its 7-day side decays now that
  nothing is followed past day 2; only its PRE-settle reading - 19 of 79, lowest 25% - is valid). Known costs he accepted:
  sales of copies older than 2 days go unrecorded (lambda, Sold 30d and the anchor lean to fast sales), price drops
  after day 2 are unseen, "Active / Listed now" = fresh copies + the retained cheapest. NOT built (he was offered
  them, did not ask): checking only cards with enough PriceCharting volume; waiting for a second miss before a lookup.
- RAW DATA AUCTION VIEW (2026-10-06, designed with Brett over several messages): the chip "Auctions sent to my
  phone" (`au-er`) swaps the Raw Data table to `LIVE.au` - every ordinary listing disappears - and shows four
  columns that exist only there (class `auc`; Item $ is class `fxc` and hides): Bid at alert $ (42), Sold for $ (43),
  Profit at final $ (44), ROI at final % (45); the order key moved to index 46. Rows are built by `auRows()` in the
  listing-row layout so sorts and filters work, and drawn by `auRow()`. HIS DECISIONS: reuse Max buy and Verdict, no
  new result column; the EXISTING Profit / ROI are the worst case if he wins (he pays his whole Max buy, so ROI =
  his margin on every row), the "at final" pair is the best case (the close with no bid from him); Max buy, both
  profits and the Verdict follow the SAVED Alerts-tab margin and buy tax - not the top boxes, which are disabled
  while the view is on - so changing the margin re-judges every past auction; only what selling brings in (`net`,
  NM and LP) is frozen at the alert. "Listed within" becomes "Alerted within" (hours since the ping). Collector:
  `v["au_hist"]` (60 days, `AU_HIST_KEEP_D`) gets a full record per auction alert, `auction_finish` writes fin / fb2
  / fst (sold | nobids | gone), `read_requests` copies his answer, `au_rows()` publishes them as
  `live["alert"]["au"]`; `au_backfill()` ran once for the 9 alerts sent before this existed (marked old: bid and
  shipping recovered from `auction_done`, net from the logged profit at 10% margin). Verdict: PASS = closed at or
  under Max buy, over max buy, no bids, not finished, no result. Caveat shown on the page: a final price is the
  price WITHOUT his bid; had he bid he would have lost or paid more.
- PHONE CHECK SCREEN, second layout (2026-10-06, Brett's list): the first question shows one fact per row with a line
  between rows, PriceCharting on the left and eBay across from it - Set / card number | Ungraded price vs Total
  price (card + shipping + tax, the tax being the Alerts-tab buy tax when the alert was SENT; a link already on the
  phone keeps its numbers) | Sales per month vs Sold this month | Seller. Gone at his request: the card name and the
  listing title in the columns, "Listed now", "regular printing", "item specifics agree". Kept on my advice, which
  he accepted: the printing tag when the matched card IS a special printing, a red line when the item specifics
  DISAGREE, the seller row. Tapping the eBay photo or its heading opens the listing. Under Yes / No there is "Next
  question", which shows the condition screen and records nothing; Yes now records `yes` ("same card", never
  replacing an nm / lp / no already given). A No on a listing the scam screen had not flagged is copied by
  `note_wrong()` into `v["wrong"]` (kept 365 days, `live["alert"]["wrong"]`) and listed as "Wrong matches" on the
  tab - the matcher's test cases; alert-log entries now carry `tr` (tier), `card`, `cs` for that. The ROI and tax
  on the screen were already taken from the settings in force when the alert is sent.
- TAB NAMES (same day): "Alerts" is shown as "Notification Settings" and "Revenue" as "Transaction Report". Only
  the labels and the visible wording changed: ids (`p-al`, `p-rv`), hashes (#alerts, #revenue), `TABLES.rv`, cfg
  keys and this file's older notes still say alerts / revenue.
- Auction trial sampling: the final-price lookups are capped per hour (AUCTION_LOOKUPS_PER_HOUR), newest finished
  first. The first day's 69 results all came from 8-10 PM Eastern because a daily cap ran out by then.
- The check screen also shows demand and supply from both sources: PriceCharting sales per month (its 12-month count
  / 12, all grades) on the matched-card side; on the eBay side the sales this collector has recorded in its 30-day
  window with the days it has tracked the card, and the copies listed now.

## Capacity (measured 2026-09-30 on the Actions design; the machine design above is the answer to it)
Real volume: ~9,500 matched listings/day, ~11,400 open after 2.5 days, 7,327 lookups due vs ~2,700/day possible.
Following every listing to its outcome (checks at day 3/10/30) is ~11x over budget and can never catch up; the
hourly presence walk (8,000 newest aspect-query items) reaches only ~11 h of listing age. Consequences: sales
after ~11 h are found late or never (λ biased low, safe direction), and sold copies linger in the book as
phantom competitors (p1 too low, N too high) until a check reaches them. The queue order is therefore the policy
(`check_value()`): presence-flagged listings first, then calibration listings (rank0 ≤ 3), then listings ≥ $40,
then the rest. Next step (not built): targeted book verification — re-check the 3 cheapest open copies of every
card that has a λ and a price in $40–200 every ~48 h (~1,200 calls/day) so the book and the hot-card confirmations
stay honest, and drop the day-10/30 checks for cheap listings. State growth (open listings never reaching their
day-30 check are never closed as stale) also needs a rule.

## The model (short) — the two-anchor version (2026-10-01; see README sections 3–9 for the worked example)
- λ = raw sales/day = 25th percentile of Gamma(k + ½, D), k = comparable sales in 30 d, D = days observed.
  No PriceCharting prior (decision: eBay-only). λ is NOT calibrated — the PRICE is (below).
- Anchor A (`anchor()`): the card's comparable sales in 30 d (60 d if < ANCHOR_MIN = 5), LP lifted to NM-equivalent,
  trimmed (Tukey fences ∩ median/4..×4), recency-weighted (half-life 10 d), centred with a weighted median under
  8 sales and weighted Hodges–Lehmann from 8 (`robust_center()`). A_fast = median of sales that sold within 48 h of
  listing when there are ≥ 8 of them. The gate is shut while A_n < 5 ("too few sales").
- Floor L (`credible()`): cheapest open comparable copy (BO at 90%, LP lifted) that is not watch/suspect, not from a
  seller under 50 ratings or under the feedback bar, not under 75% of A, and not older than 1.6/λ days (1..7).
  Top 5 credible copies travel in the live file (`cred`) so the page can judge a listing with itself left out.
- Sell S (`sell_price()`): min(L − $0.50, 0.95 × A), capped by A_fast, rounded down to .99; 0.93 × A with no floor.
  The old P₂₄/P₄₈ = pₙ − $1 depth rule is gone (it let the worst listing in the book set the price and assumed
  strictly cheapest-first buying); do not bring it back.
- Liquidity (`is_liquid()`): λ ≥ −ln(1 − Confidence) / (Window/24) and, once measured, sell-through ≥ 50%. The
  Confidence and Window boxes on the page set this; 48 h at 80% needs λ ≥ 0.8 (~24 sales/month), 72 h at 70% needs
  0.4. This is Brett's choice and the biggest lever on how many cards are eligible — it is exposed, not hidden.
- Gate (`verdict()` / `listing_decision()`, mirrored by `verdictOf()` / `listingDecide()` on the page): photos ≥ 2,
  not suspect, A present, A_n ≥ 5, liquid, comparable condition, seller bar, then "review" if the listing is under
  45% of A, else PASS when all-in (item + shipping + 6.25% tax) ≤ Max buy where
  net = S × (1 − 0.1325 × 1.065) − 0.40 − 4.50 − 0.30 and Max buy = net ÷ (1 + margin), margin default 10%.
  Each listing's S is computed with its own floor = the cheapest credible copy OTHER than itself. LP listings are
  judged at the LP-discounted S. Verdict strings: PASS, review, over max buy, not liquid, too few sales (n),
  no sales yet, suspect, fewer than 2 photos, condition X, seller < N%.
- Measurement: every new listing is stamped with ratio0 = price / A; `deal_calib()` tabulates closed listings by
  that ratio with how fast they sold (shown in the Scam screen modal as "How fast cheap listings go"). This is
  the data that decides whether new-listing scanning can produce hits at all; the next sourcing step (a daily
  Best Offer list on aged listings of liquid cards, auctions, resurfacing price drops on Raw Data) waits on it.
- All eBay prices are buyer totals (item + shipping). Brett lists with FREE shipping at S, Best Offer on with
  auto-accept ~3% under; unsold at 36–48 h → 0.90 × A.
- Hot card = 5 checks, then confirmed by the next 3 listings selling within 48 h.
- Condition: NM, LP and not-stated count in every COUNT (demand and supply are condition-blind); every LP
  PRICE is lifted to NM-equivalent (total ÷ (1 − LP discount)) before the book, sold median/80th, P₄₈ and
  the daily rollup, so Catalog prices are NM prices. On Raw Data a listing that says LP has its sell price
  cut by the discount → lower Max buy / Profit / ROI (hover Max buy shows the NM figure); not-stated = NM
  (Brett's decision); MP/HP excluded from everything but still listed with a "condition" verdict.
  The LP discount is measured in `lp_correction()`: per LP sale, total ÷ median of the same card's
  NM/unstated sales within ±7 d; 1 − median(ratio), pooled across cards, per NM-price tier (<100, 100–150,
  150+). Ladder: tier (≥ 30 LP sales) → global (≥ 30) → 12% default. Published in the live file as `lp`;
  the page shows the three tiers read-only next to Margin.
- Price calibration: each new listing is stamped with the model's P₄₈/P₂₄ for its card and its offset from
  it; realized 48 h / 24 h sell-through by offset bucket gives the shift where the curve crosses 70%;
  applied once ≥ 150 outcomes with ≥ 25 in the two buckets around the crossing.
- Scam screen (`score_listings()` in the collector, constants SCAM_*): every open listing gets a points
  score — price vs the card's price (from last run's `price_cache`, else the 2nd-cheapest open ask;
  <50% +4, 50–65% +2, 65–75% +1, bands +5 on $100+ cards), seller feedback count (<10 +3, 10–49 +1,
  unknown +1), count-aware feedback % (`seller_bar()`: 100+ need 98%, 20–99 need 95%, <20 ignored; fail +2),
  one photo +1, 3+ copies of a $75+ card +2, photo id reused by another seller +3, no returns and <65% +1,
  delivery window >10 d +1, Top Rated Plus −2, 500+ feedback at 99%+ −1. ≥5 = suspect, 3–4 = watch;
  a watch listing in a same-day burst of 5+ $75+ listings from an unseen seller becomes suspect.
  Suspect → out of every statistic (`comparable()`, sold, daily rollup) and hidden on Raw Data behind
  "Show suspects"; watch → in the statistics but never alone at p₁. Quantity/returns come from `enrich()`
  (≤ 6 full getItem lookups per run for cheap or thin-seller listings). Closed listings keep their stamp;
  `scam_calib()` tabulates outcomes by tier and signal (gone = pulled early ≈ scam) for hand-tuning.
- Raw Data leaves out listings with fewer than 2 photos (Brett needs front + back); the Catalog keeps them.

## Decisions already made (don't relitigate)
- eBay only for the eBay tabs; PriceCharting is the identity list. One exception (Brett, 2026-10-04): PriceCharting's
  ungraded price is the wrong-match check (under 40% / over 300% = mismatch) and a Raw Data column - never a pricing
  input. Default filter = card's eBay price
  $50–500 (adjustable; raised from $150 on 2026-10-01 when Brett asked for $500 cards); collector sweeps $25–500
  (deals sit below the band). The three tabs show card numbers as number/printed set size ("36/123"), header "Set / Card"
  at Brett's request. The size comes from the open Pokemon TCG dataset (PokemonTCG/pokemon-tcg-data, sets/en.json),
  fetched by build_catalog.py each morning and matched to PriceCharting's set names (`set_totals()`, aliases in
  SET_NAME_ALIASES; the build log prints the unmatched names - add aliases there); unmatched sets fall back to
  `set_sizes()` in the live file (learned from eBay titles, plain numbers only, 5 sightings), then the bare number.
- Retail buy/sell columns removed. Free shipping when selling. 48 h is the planned sell window, not 24.
- Rate stays as measured; calibrate the price. Don't change the model before data can check it.
- The sell price is anchored on sold comps (A) with the credible floor (L) as the undercut target; the fee wedge
  (~24% of a sale) is why hits need ~31% off at a 10% margin — explain that before touching the gate again.
- Housekeeping Brett should do: verify the real label cost; register as a MA vendor and file an ST-4 resale certificate
  with eBay's tax-exemption program (removes the 6.25% buying tax — breakeven 24% → <19%; then Buy tax box → 0 and
  BUY_TAX_PCT=0 on the machine); confirm eBay payout timing.
- Keep it simple; don't over-build. Brett prefers fewer, larger flips; ≥15% margin, ≥$5 per flip.

## Roadmap (in order)
0. Sourcing, once the deal-speed table has two weeks of data: a daily Best Offer list (aged listings of liquid
   cards, offer at this listing's Max buy), an auction watch (liquid cards ending at off-hours), and resurfacing
   price drops / relists on Raw Data (they never appear as "new"). eBay's API cannot send offers or bids: the
   site produces the list, Brett clicks.
1. After 2–3 weeks: compare Hot cards' λ with ln 2 ÷ (median hours to sale ÷ 24); if consistently higher,
   use the waiting-time λ when Sell-thru ≥ 80% and Days supply < 3 (supply-capped demand).
2. Measure the matcher, then tune it. Brett hand-checks ~150 of the cheapest-looking matches (Raw Data sorted by
   vs PC % ascending): the share that are really the card in the first columns is the first accuracy number, and the
   checked listings become the gold set for every later matcher change. Then tune from that and from the Unmatched
   list (`SET_ALIASES`, `VARIANT_WORDS`, `CLAIM_WORDS`, `REJECT`, and the PC_* cutoffs).
3. Deal alerts (e.g. open a GitHub issue when a listing PASSes) — optional, off by default.
4. Make history shards incremental once a year of snapshots makes the daily rebuild slow.
5. A flip ledger (card, buy, list, sold, hours) as the real calibration set.

## How changes get pushed
Brett works from claude.ai chat. The GitHub connector (custom MCP, api.githubcopilot.com) can push files
directly (`push_files`); the workflow is then triggered by clicking "Run workflow" through the Claude in
Chrome extension (the connector has no Actions tools). Verify a push by comparing the blob SHA
(`sha1("blob <size>\0" + bytes)`) with the directory listing. Claude Code (desktop) is the faster route
for larger changes; Brett has not adopted it yet.
Files too big to type through the connector (`ebay_sweep.py` is ~100 KB) go through Claude in Chrome instead: open
github.com/BrettS600/biotech-catelog/upload/main (or .../upload/main/page for the page files) and, with the JavaScript
tool, fetch the current file from raw.githubusercontent.com, apply the change as line edits, check the git blob SHA
against the tested copy, put the result on the page's file input (`#upload-manifest-files-input`: a DataTransfer plus a
`change` event) and click "Commit changes" - one commit per folder. (`file_upload` does not accept sandbox paths.)

## Testing before pushing
- `collector.py --dry-run --once` (with COLLECTOR_HOME pointing at a scratch folder) runs one loop cycle on the
  fixtures with no network and no git; the jsdom refresh test (test_refresh.js in the harness) needs
  `pretendToBeVisual: true` and an explicit process.exit because the page now runs timers.
- `python -c "import ast; ast.parse(open('build_catalog.py').read())"` and same for `ebay_sweep.py`.
- `python ebay_sweep.py --dry-run` with a `fixtures/` folder (catalog.csv, search.json, items.json,
  optional state.json) exercises matching, tracking and stats offline.
- The page can be exercised with jsdom (inject WebCrypto, DecompressionStream, fetch stub for the live file).
- After pushing: `gh workflow run "Update Pokemon catalog site"` and/or `gh workflow run "eBay sweep"`,
  then `gh run watch`; hard-refresh the site (Cmd+Shift+R; Pages caches ~10 min).

## Style
Plain language in replies; explain formulas with a worked example; no unrequested features.
