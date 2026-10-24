# CLAUDE.md — Pokémon card catalog (repo: BrettS600/biotech-catelog)

Read this first. It is the whole context; the owner (Brett) would rather not re-explain.

## What this is
A private, password-protected website for buying and reselling **raw (ungraded) Pokémon singles on eBay**.
Live at https://bretts600.github.io/biotech-catelog/ (GitHub Pages, encrypted with staticrypt).
Everything runs on GitHub Actions; nothing runs on Brett's laptop. Never commit secrets or data.

The tabs (PriceCharting Catalog, eBay Catalog, eBay Raw Data, Forecast, Notification Settings, Transaction Report):
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
- `forecast.py` (the Forecast tab's model, run by the site workflow), `forecast_math.py` (the tab's plan arithmetic in
  Python, a line-for-line mirror of app.js: `levels`, `plan`, `standard_plans`, `actual_net`; the collector and the
  replay import it) and `forecast_hist.py` (the Forecast history replay, run by `.github/workflows/forecast_history.yml`
  on the 2nd of each month; writes forecast_hist.bin to the snapshots release, which the site build copies into the
  page). See THE FORECAST TAB and FORECAST HISTORY below.
- `data_archive.py` + `.github/workflows/data_archive.yml` — the data folder (`data/`, see THE DATA FOLDER below): PokeViews'
  feeds, the PriceCharting panel, the eBay Catalog of the day, committed to main by the workflow daily. `data/README.md` is
  the dictionary; read it before analyzing anything in there.
- `data/research/` — the forecast research log (2026-10-24, see THE RESEARCH FOLDER below): `experiments.csv` (the
  registry), `FINDINGS.md` (what to build), `notes/`, `results/`, `scripts/` (rerun with `run_all.sh` or the
  `Research results` workflow), `ideas_backlog.csv`, `sources.md`. Read experiments.csv and FINDINGS.md before touching the
  Forecast model.
- `requirements.txt` — pandas, numpy, requests, cryptography, scikit-learn.

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
THE BOX TODAY (2026-10-23, after the memory incident below): 2 GB RAM / 1 vCPU / 25 GB disk ($12/mo; resized from
the $6 1 GB plan with "keep the storage size fixed" ticked, so it can be downsized again), plus a 2 GB swap file
(/swapfile, in /etc/fstab, vm.swappiness=10 in /etc/sysctl.d/99-swap.conf). Droplet id 605047934, IP 165.22.191.104.
Brett does not want his Mac used to reach it (he refused an ssh from device_bash): droplet work goes through the
DigitalOcean web console in his Chrome, https://cloud.digitalocean.com/droplets/605047934/terminal/ui/ (a root
shell; the repo on the box is owned by user `collector`, so `git` there wants `sudo -u collector` or
`safe.directory`). The service: `systemctl status/restart pokemon-collector`, `journalctl -u pokemon-collector -f`,
Restart=always / RestartSec=15, ExecStartPre `git pull --ff-only`. Between 2026-10-21 07:00 and 2026-10-23 15:17
the OOM killer killed the collector 839 times (every ~4.5 min, 18 s restart, never reaching a publish) on 1 GB with
no swap; the diet below plus the swap file brought the first publish back at 15:27 UTC, the resize followed.

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
- LAYOUT (2026-10-07, Brett's screenshot): the Confidence / Window / Only show hits / Margin / Buy tax boxes, the LP
  correction chips and Calibration left the tab row. They are `#gatebar`, the first thing inside the Raw Data panel,
  so they show under the tabs on that tab only; same ids, so `settings()` and everything else is untouched. They
  STILL drive the eBay Catalog's Decisions band (its note now says so) - he asked for them to be hidden there. The
  tab row keeps the tabs and README.
- README PER TAB (same day): `README` in help.js is now {pc, ec, er, al, rv}; the button opens the one for the
  tab in view (`curTab()`). The old single README's 16 sections were split between eBay Catalog and eBay Raw Data
  with cross-references rewritten; the PriceCharting, Notification Settings and Transaction Report ones were written
  new from the column help. Sections are numbered from 1 in each.
- THE PENCIL (same day): every "?" popup and every README has a pencil. A "?" edit is three plain-text boxes
  (formula, meaning, example); a README is edited in place (contenteditable, cleaned by `cleanHtml()`: structure
  tags and classes only). `sendEdit()` signs the text like the alert settings and posts it to the same private ntfy
  channel as base64 pieces of 2,400 characters (ntfy holds 4 KB a message); `help_edit()` in collector.py reassembles
  them into `v["help"]` ('h:<column key>' -> {f, m, e}, 'r:<tab>' -> html) and publishes `live["help"]` = {t, v}, so
  an edit shows on every device and survives rebuilds. Until the collector confirms (help.t >= the edit's time) the
  page shows it from `PEND`. "Restore the original" sends `del`. The public log names the key, never the text. The
  built-in wording in help.js stays the fallback - when help.js changes, an entry he has edited keeps HIS text.
- HIT TOTAL vs THE TABLE (2026-10-06 evening). Brett saw "$289.48 from 7 hits" over a table of 4. Both were right:
  the total counts every hit ALERTED in the period (`live["alert"]["all"]`), the table shows the last 24 hours judged
  as they stand NOW. Of that day's 7: 4 still passed, 2 had turned "not liquid" since their alert (Blastoise #2,
  Team Rocket's Mewtwo ex #231 at +$116 - most of the total, and probably a wrong match), 1 was first seen more than
  24 h earlier. The line now reads "$T = N hits from Buy It Now ($A) + X hits from auctions ($B, at the final
  price) · M left out as mismatches · Show them", and `openHits()` lists each with where it stands in the table now.
  Auction hits = alerted auctions whose close was at or under Max buy, valued at Profit at final.
- RARITY AND FINISH, FROM BOTH SIDES (2026-10-12, Brett: "most of the PriceCharting-to-eBay mismatches are finish
  and rarity mismatches"). PriceCharting states neither. cardfacts.py (new, shared by the build and the collector)
  fills them in during the daily build: `annotate(pc)` joins every row to TCGplayer's catalog through the tcg-id
  column (TCGCSV, tcgcsv.com/tcgplayer/3/<group>/products + /prices: Rarity and Number in extendedData, one price
  row per printing - Normal / Holofoil / Reverse Holofoil ...; ~84% of rows) and to the open Pokemon TCG dataset by
  set name + card number (the build's set aliases, plus Black Star promos by number prefix / release year; ~85%);
  the finish of the untagged row comes from TCGplayer's printings, else from the rarity (holo rarities holo,
  Common / Uncommon plain, a plain Rare plain before Scarlet & Violet and holo from it on), and the bracket tag
  overrides (tag_finish). New snapshot columns `rarity`, `finish`, `rf-source` (tcgplayer | dataset | tag), page
  rows DATA[14], DATA[15]. The vocabulary for comparing the two sides is coarse on purpose (rarity_tier C / U / R /
  H / X / P, rarity_agree same / near / far; finish_class reverse / holo / plain): "near" is seller imprecision,
  "far" is another card. CLASSIC COLLECTION (2026-10-13, the Crystal Lugia 149/147 hit): tier "K" = an old card
  reprinted with the anniversary stamp (Celebrations, 30th Celebration); TCGplayer lists it as its own rarity, apart
  from the set's own Secret Rares. K vs Secret / Holo / Rare = "near" (sellers reuse the ORIGINAL card's rarity
  word), K vs Common / Uncommon / promo = "far". The printed total decides: the reprint keeps its original number
  (149/147, 4/102), the set's own cards carry the set total (/128) - check_identity notes the first and calls the
  second a conflict on a Classic Collection row; compare_facts marks /<set total> on a K card "far". learn_facts
  falls back to the ePID memory's product record when the payload has no product block and the seller's words are
  all there is (src "memory"). The page mirrors tier K (rarityTier / rarityAgree, the amber tooltip), the number
  cell shows "149 cc" instead of 149/128 for a K card, hit.html says "numbered as the original card was".
  Brett also wanted EVERY photo on the Review / check screens: imgs keeps up to 24 (was 4). ut/test_classic.py. THE EBAY SIDE: a getItem with fieldgroups=PRODUCT (the product container comes ONLY with
  that field group - found the hard way on deploy day) carries eBay's catalog product (`product.aspectGroups` -
  the "About this product" block: Set, Rarity, Finish, Card Number, Card Name) and the seller's `localizedAspects`;
  es.ebay_facts(it) takes the product's word first -> rec["ef"] = {s, r, f, n, k, src, cmp} (es.learn_facts), kept
  on the closed record too. It is read at a listing's FIRST lookup: the collector's confirm() asks for
  fieldgroups=PRODUCT instead of COMPACT when the record has no "ef" (same one call, bigger reply - no extra API
  budget; the budget is fully spent and the confirm queue already starves), and the ID checks (verify_hits) ask
  for PRODUCT too.
  THE EPID MEMORY: state["epids"][epid] = the product's facts + votes {card id: n} for the catalog card its
  listings were filed under when the number named the card and nothing was "far"; es.match_title(..., mem=
  state["epids"]) tries memory_card() first (how = "epid"), checked by epid_match against the title;
  es.inherit_facts() (hourly, same log line) gives every open listing of a KNOWN product the product's facts with
  no call of its own (src "memory"; on deploy night 2,779 of 24,553 open listings qualified at once, 18,291 carry
  an epid, 5,126 distinct) - the only way the eBay Set / Rarity / Finish fill in faster than one call per listing
  while eBay's 5,000 calls a day are spent (discovery 1,440, confirms ~700 with a backlog, re-reads, ID checks).
  Brett wants them in days, not weeks and will NOT raise the eBay limit: he chose the BACKLOG PASS (same night):
  facts_backlog() lists cards with open listings and eBay's record on none (most listings first; per card the
  listing whose epid covers the most open listings, else the cheapest; a tried card waits FACTS_RETRY_D = 3 days),
  the cycle spends FACTS_MAX_PER_CYCLE = 1 token a minute on them (after the ID checks and window re-reads, before
  the book / confirm queues; confirm(..., "facts", cat) does the lookup, inherit_facts() right after), and while
  FACTS_BIG = 100 or more cards wait, discovery sits out every third cycle (refill()'s reserve shrinks to match).
  It returns to the normal rate BY ITSELF when the pile is below 100 ("Facts pass: ..." log lines mark both
  transitions); a new card still gets its one lookup. v["facts_done"], v["facts_back"], v["facts_tried"]; the hourly
  "Facts:" line reports the pass. ut/test_factspass.py.
  es.apply_epid_memory() (hourly, with the "Facts:" log line) moves open listings their product contradicts
  (>= 2 votes for another card, none for theirs, title agrees). CONFLICT RULES (check_identity): the product's
  aspects feed the number / name / set checks before the seller's; rarity "far" is a hard conflict; a finish
  "far" from the product record is a hard conflict only when the catalog's finish is TCGplayer-backed or a tag
  (`rfsrc`), otherwise a note; the product's Finish also drives the printing move (Reverse Holo -> the [Reverse
  Holo] row). LIVE FILE: listing row 34 = facts_row [set, rarity, finish, name, number, src, set cmp, rarity cmp,
  finish cmp] (None = not looked up, [] = nothing on it); live["ef"] = card_facts {card: [majority rarity,
  majority finish, n with facts, n far]}; live["epids"] = memory size. PAGE: cells4(r, mid, afterSet); PC
  Rarity/Finish after Set / Card on all three tabs (pc data-k 14, inserted {v:4, at:4, n:1}; ec row 46 text / 47
  facts / 48 sort text, inserted {v:5, at:4, n:2}, Card band colspan 8, Compact indexes +2); Raw Data: "Set" is
  "PC Set Name" (help er_pcset), "eBay Set Name" beside it (row 49), PC / eBay Rarity/Finish after Set / Card
  (rows 47 / 48 facts / 50), inserted {v:10, at:4, n:1}, {v:11, at:6, n:2}; cells red (td.rfbad) on "far", amber
  (td.rfnear) on "near"; "Disagrees only" switch (#dis-er, rfBad(r), count #ndis); auction and hit-history rows
  copy the facts from the live row of the same listing. Help: rf_pc, rf_ebay, er_pcset, er_eset. The workflow
  re-uploads the day's snapshot with --clobber when a later run the same day rebuilt it, and the collector's
  load_catalog() re-reads the newest snapshot whenever its bytes change (sha256 in vps.catalog_sha), not only when
  the name does. Coverage at the change (Oct 11 snapshot, dataset route only, TCGCSV unreachable from the
  container): rarity for 37,417 of 43,939 rows; the rest are Topps / Burger King / Dunkin / Artbox cards and old
  promos. Tests: ut/test_cardfacts.py, ut/test_facts.py, ut/test_confirm.py, t/test_ui5.js.
  LESSONS FROM THE FIRST LIVE HOURS (same day): (1) the stored verdict (ef["cmp"]) is written when the listing is
  looked up and never changed by itself, so a vocabulary fix showed on the page only for NEW lookups -
  es.refresh_facts(state, cat) now re-reads every record's verdict at startup, hourly (before apply_epid_memory;
  "... N verdicts re-read" on the Facts line) and whenever load_catalog() finds other bytes; the page's own
  rarityAgree / finishAgree are used only for the eBay Catalog's per-card cell, the Raw Data cells show the
  collector's verdict. (2) A bare "Rare" from a seller is the generic word for anything above Uncommon (a seller's
  "Rare" on a Special Illustration Rare is not another card): rarity_agree is never "far" when either side is tier
  R (cardfacts.py and app.js alike). (3) PriceCharting's one "Pokemon Promo" set has no counterpart in eBay's set
  words ("SM Black Star Promos", "Sun & Moon", just "SM"): for a promo card the set verdict is "same" when eBay's
  set says promo and None otherwise - the card number decides, never the set words. (4) "Futuristic Rare" and
  "Black White Rare" (Mega Evolution / Black Bolt - White Flare) are top-tier (X) rarities. The 13 "disagrees" of
  the first hour became 8, all real questions (a 151 card filed under 30th Celebration, a Triumphant original vs
  the Classic Collection reprint, "XY" on a Pitch Black card, a prerelease stamp the seller calls a Holo Rare).
- CHECK SCREEN ROWS (same evening, Brett: "three more lines - Set Name, Rarity, Finish - in each column for the
  eBay listing and the PriceCharting listing, so I can compare the two"): hit.html and the laptop's Review modal
  (openReview) show them right under "Set / card number". Left = the card's own words (hit_payload "rf" = [rarity,
  finish]; the set name with its "Pokemon " dropped, as the title line already did; "unknown" when the build has
  none). Right = eBay's record of the listing (hit_payload "ef" = es.facts_row(rec): None -> "not read", [] ->
  "not stated"), red (b.bad) when the collector's verdict is "far", amber on "near" - the same verdicts as the Raw
  Data cells, never recomputed on the page. So that the record is there when the alert goes out, every getItem
  before an alert now asks for fieldgroups=PRODUCT and calls learn_facts: the suspect path in alert_hits and the
  auction lookup in auction_alerts (the hit path already went through verify_hits). ONE LINE EACH (Brett: "if the
  set name is too long, decrease the font so it fits on its own line"): fitRows() shrinks b.fit cells from 16px to
  12px; if the name still overflows it drops eBay's era prefix up to the first ": " ("Scarlet & Violet: Obsidian
  Flames" -> "Obsidian Flames", "SWSH: Sword & Shield Promo Cards" -> "Sword & Shield Promo Cards") and shrinks
  again to 9px; a name no shrink fits (the Topps sets, 1.6% of cards) wraps at 11px rather than being clipped.
  Measured at 360px wide (Playwright, t/hit/test_hit.py): the column is 155px, "Special Illustration Rare" sits
  at 13.5px, everything else at 16px. t/test_review.js opens the modal in jsdom. The build log now names rarity
  words the tier vocabulary cannot place ("Rarity words the vocabulary does not know"), so a new era's rarity is
  caught the day it appears.
- PRICECHARTING'S OWN CHART, PER CARD (2026-10-12 evening, Brett: "I want the exact graph that shows the ungraded
  price and total volume per month on PriceCharting since the card was released. There must be a way"). THE WAY: the
  chart on a card's PriceCharting page is drawn by their /js/market_ae.js from data written into the page -
  `VGPC.chart_data = {used, cib, new, graded, boxonly, manualonly}` (one point per month, [ms timestamp at the
  Pacific month start, cents]; "used" = ungraded; the record starts when PriceCharting began tracking the card, e.g.
  2021-01 for a 2013 Plasma Blast card, the release month for 2025 sets) and `VGPC.volume_data.volume` for the
  "Volume ... (total volume)" bars. The collector already opens every card's page for the picture, so pchist.py reads
  the arrays in the same read: page_series() keeps every `VGPC.<name> = <json>` series, pick() takes chart_data
  ["used"] and any *volume*/*sales* series (a bare list, or a dict of grades summed), monthly() makes one row per
  calendar month (last price, summed volume; whole numbers are cents, fractions dollars). THE CATCH: the public page
  carries chart_data only - VGPC names on an anonymous read are category, chart_data, console_uid, forex_rates,
  pop_data, product, user_id, www_url - so volume_data is served to signed-in (Pro) users; Brett sees the bars
  because he is signed in. The collector reads anonymously, so the record has prices and no volume (v all 0), and
  the page draws the line without bars and says why. Getting the bars means reading the pages as Brett (his
  PriceCharting sign-in on the droplet, typed into /etc/pokemon-collector.env by him, never in chat); the login
  form was NOT probed - the harness refused that fetch (it looked like credential scouting) and Brett was asked
  instead. HE SAID YES (same night): the sign-in is his browser's session cookie, not a password - PC_COOKIE in
  /etc/pokemon-collector.env (the whole "Cookie:" request-header value from Chrome's DevTools, in single quotes;
  systemd's EnvironmentFile takes it; the three site cookies vgpc_session, vgpc_visitor, vgpc_daily are enough -
  cf_clearance is bound to his Mac's IP), sent on every card-page read as a cookie JAR bound to .pricecharting.com
  (pc_cookies(), requests' cookies=): the first try wrote a Cookie HEADER by hand and the first signed read came back
  without the bars - /game/<id> redirects to the card's named address and requests DROPS a hand-written Cookie
  header on a redirect (the jar is re-applied; proven in a redirect simulation). The verdict log line now carries
  pc_signin_clues(): redirects and final address, VGPC.user_id, counts of logout/log in/volume_data words, the
  cookie NAMES the server set and the names sent - never values. A page read signed in
  carries VGPC.volume_data, and pchist.monthly() marks such a record "s": 1; the index keeps (day read, signed).
  pc_plan() re-reads every record without "s" while the sign-in works (want_signed = PC_COOKIE set and
  v["pch_signin"] != "expired"); v["pch_signin"] is "unknown" at every start (a replaced cookie gets a fresh test),
  then "ok" or "expired" from the first page read (a page without the volume series while a cookie is set = the
  cookie no longer works; logged once per change: "PriceCharting sign-in: ..."), and an expired cookie never
  loops over the catalog. live["pch"] = {n, total, shards, signed, signin}; the chart note reads it ("the volume
  bars come once this card's page is read again" / "sign-in has expired: replace PC_COOKIE and restart") and a
  record read before the sign-in is asked for again (pcHistAsk) while the popup is open. To replace the cookie:
  edit the env line, `systemctl restart pokemon-collector`. A LAPSED SIGN-IN NEVER WIPES THE BARS: pchist.file()
  merges a read without "s" over a record that had it (keep_volume: new prices, the old volume for the months it
  covered, "sv" = the day that volume was read, no "s" so a working cookie re-reads it); the chart note then says
  "volume bars as of <sv> ... sign-in has lapsed". NO HAND ON THE COOKIE (Brett, same night: "I don't want to
  remember resetting cookies"): the reads go through ONE requests.Session whose jar lives on disk like a browser's
  (data/pc_cookies.txt, LWP format; pc_session() / pc_jar_keep()): seeded from PC_COOKIE WITHOUT vgpc_daily - the
  site re-issues its daily cookie when it sees none, which is how a browser keeps a sign-in alive - then updated from
  every Set-Cookie (a rotated or extended session follows by itself); a new PC_COOKIE (different vgpc_session,
  fingerprint in pc_cookies.txt.seed) reseeds. The jar is used only while PC_COOKIE is set. Cookie NAMES go to the
  log, never values. When the sign-in does lapse, push() tells the phone once ("PriceCharting sign-in expired").
  The daily CSV CANNOT stand in for the bars: its sales-volume (trailing-year count) is a different measure - on
  152 cards read signed in, sum(last 12 monthly bars)/CSV count had median 1.30, quartiles 1.01-1.68 - so the
  exact monthly volume exists only behind the sign-in. ut/test_jar.py covers the jar (local stand-in server:
  redirect, daily cookie, rotation, restart, reseed, values absent from the log). THE PILL: a small oval in the
  header (#pcpill, paintPcPill() on every live rebuild) reads live.pch.signin - green "PriceCharting connected"
  (ok), red "PriceCharting not connected" (expired / none), neutral "checking..." (unknown: only right after a NEW
  cookie was seeded - the verdict now survives restarts, so the pill does not flash red at every restart). STORE: data/pc_hist/<card id % 200>.json.gz ({id: {m0: months since 2000-01, p: [cents|null], v: [n],
  t: date read, n: raw points}}), a card index in memory; published as pc/<shard>.bin on the live branch (gzip
  under the live key, like ebay_live.bin), changed shards every PC_HIST_PUBLISH_S = 600 s (or at once for a card
  the site asked for); publish() now creates the pc/ folder. READER: PcImageWorker's plan is [(card id, picture
  wanted)] (pc_plan with the catalog: newest listings' cards, cards with eBay data, then the whole catalog by price;
  a card is in when its picture is wanted - first two groups - or pchist.stale(): never read, or older than 7 days
  with eBay data / 30 without; a history-only read never fills the 12,000-entry picture cache, which would otherwise
  churn); pc_read_page() returns (status, picture, history, note); file_pc_images files both. A card page read for
  the picture from the alert path (pc_image) files its history too. The whole catalog takes ~1.5 days at one page
  every 2 s (190 pages per 10 min measured). The first pages' shapes are logged once ("PriceCharting history: first
  page read ..."; v["pch_shape_logged"] gates it, bump the number to log again) and "card N: <note>" at most 3x a
  day when a page carries nothing, so a layout change shows up. The site can ask for a card now: {type: "pchist",
  c} on the -pc topic -> worker.want_hist() -> read next, "rush" -> urgent publish; the page asks when the record is
  missing or older than a day (pcHistAsk) and polls the shard every 45 s for 6 min. PAGE: openTrend() is
  PriceCharting's chart now (drawPcChart: monthly volume bars left axis, the ungraded line right axis as a
  Catmull-Rom spline, Zoom 6m/1y/5y/All remembered as pc-zoom, hover readout "<Month Year> / Volume: n (total
  volume) / Ungraded: $"; without volume no bars, no left axis, no Volume legend), then the month-by-month table
  (newest first, change vs the previous month, Download CSV) in #pctable, then this site's own daily stats row
  (renderStats(s), may be empty), then the BUY GATE rebuilt on the collector's rule (renderGate: sell = decide()
  when the card has an eBay anchor - $0.50 under the cheapest credible copy, <= 95% of A, A_fast cap - else the lead
  rule 93% of PriceCharting / 95% capped by a credible copy; fee x (1 + buyer tax) + $0.40 + ship out + supplies;
  max buy = net / (1 + margin); max item = (max buy - seller shipping) / (1 + tax)); its Margin and Buy tax inputs
  ARE the Raw Data tab's #margin / #buytax boxes (synced both ways via the input event, one set of numbers), the
  seller shipping is localStorage pc-shipin (default GATE.shipIn $4); the inputs are built once so typing keeps the
  focus, #g-body re-renders. Retail sell / Retail buy are gone (LABEL_PC deleted; the shared drawChart() serves
  the eBay history only, its bars have ids ebbar1 / ebbar2; pcMode() switches the popup). The old daily-shard chart
  for PriceCharting is no longer drawn (the shards still carry it for the stats). Tests: ut/test_pchist.py (parser,
  store, plan, filing), t/pcpop/test_pcpop.py (Playwright: chart, hover, zoom, gate inputs, CSV download, the
  no-history and no-volume cases), t/test_review.js. mkedits.py now merges hunks closer than 6 lines (overlapping
  anchors made the app.js edit impossible otherwise).
- THE DROPLET'S DISK FILLED (found 2026-10-12 while deploying the above; "No space left on device" in save_state
  from 2026-10-10 02:29 UTC, the collector then ran without saving or publishing for most of two days). Cause:
  publish() amends the one commit of the live checkout (data/live) 720 times a day with a 2 MB file (plus the 6 MB
  state backup hourly), and git's reflog kept every amended commit's objects alive, so the `git gc --prune=now`
  every 300 publishes removed nothing. Fix: sweep_live_repo() (core.logAllRefUpdates off, reflog expire, prune,
  gc) every 60 publishes; disk_check() before every state save and hourly ("Disk: N GB free" log line): under
  DISK_MIN_MB (1.5 GB) it sweeps, and if that is not enough removes data/live/.git (publish rebuilds it - the branch
  is one commit anyway). Recovery on a box that is already full needs a hand: `rm -rf
  /opt/pokemon-collector/data/live/.git` frees it at once; the next 5-minute pull then brings the new code.
- MATCH:MISMATCH COUNTS ONLY BRETT'S OWN MARKS (2026-10-09, "I only want to see where I specifically marked it as
  a match"). `match_table()` now returns {card: [confirmed, mismatched, filed by the matcher]}: confirmed = listings
  he answered "Same card" to (v["right"] / v["reviews"] v=1 from the site's Review button, or a phone entry with
  dec yes/nm/lp and no um flag, in alert_log/au_hist/hit_hist - the card comes from the mark or from the listing
  record); mismatched = v["wrong"], one mark per listing, and a listing marked both ways counts as a mismatch; the
  third number is the matcher's own count (open + closed) and is only the cell's tooltip (`mtOf` encodes
  "a:b|n", `mmRatio` splits it). So most cards read 0:0; at the change 7 confirmed listings on 5 cards. The
  Mismatches / Review popups still say "N of M listings" with M = `card_matches()` (the matcher's count), since
  that line answers how often a card's title goes wrong.
- EBAY CATALOG REBUILT, PICKERS, RENAMES, THE ARCHIVE (2026-10-08 night, Brett's request after a column review).
  eBay Catalog (37 columns, the row keeps every old index): Card band + "Match:mismatch" (row 45, from
  `live["mt"]`, `match_table()` - see the 2026-10-09 entry above for what it counts now); Observed = eBay sales (k, was "Sold 30d"), PC sales (row 41 = pcv/12,
  was the duplicate "Sales/month"), Active, New/day, Sold med, Sold 80%, Hrs to sale, Sell-thru; Rates unchanged;
  Decisions + PC $ (row 42, c.pc or the catalog price), vs PC % (row 43 = A/PC - 1, red under -40% or over +200%)
  and Hits 30d (row 44, `live["hits30"]` = alerts per card from hit_hist + au_hist, 30 days); Trends minus
  Sales/month; Days obs. and p1-p3 are no longer shown (still in the row for the Book). The paragraph above the
  table is gone (the band legend stays). `inserted: {v: 4, reset: 1}` cleared saved eyes/order/widths/highlights
  once; `compact: [...]` is the lean view (the 10 diagnostics hidden: New/day, Sold med, Sold 80%, Hrs, λ, Price,
  Days supply, In/out, Floor, Exp. days) applied when no hide-ec is saved. Raw Data gets Match:mismatch after
  Released (row 46; `inserted {v: 9, at: 6, n: 1}`; auction and hit-history rows carry it too). EVERY TAB: a
  "Columns..." button (checklist of all columns, Compact where defined, All; `t.setHidden`, same hide-<tab> memory
  as the eyes) and a "Filters..." button (which chips show above the table; a hidden chip is neutralised -
  numbers cleared, condition/status ticks all on, switches off - so nothing filters unseen; `chips-<tab>`;
  Reset filters keeps hidden chips neutral). THE 2026-10-13 BATCH (Brett, "build"): a hidden chip now LEAVES the
  row (`.range[hidden]{display:none}` - `.range` is inline-flex, which used to beat the hidden attribute) and the
  rest close up; CHIP DRAG on every tab: press a chip anywhere but its boxes, hold still 300 ms (CHIP_HOLD) until
  it lifts (class lifted, a fixed-position clone `.ghost` rides with the pointer, body.chip-drag), drag, let go -
  `dropAt()` picks the nearest row of chips and the first chip whose centre is right of the pointer (drop-l) else
  the row's last (drop-r); the order is saved as `chiporder-<tab>` (chip ids, chipId(); removed when natural),
  `loadChipOrder()` puts an unknown chip after its natural neighbour, "Default order" in the Filters picker
  (`t.resetChipOrder`); a lifted chip's release is not a click (capture-phase click guard, `t.justLifted`), a
  press that moves before it lifts is left alone (selection, scroll). Raw Data's chip order is `chips: [24, 5,
  25]` (Profit $, Listed within, ROI %) - cfg.chips orders the generated chips, ranges and maxes mixed. The
  PriceCharting tab has three eBay columns before Trend (eBay sales, Max buy $, vs PC %; header data-k 16/17/18,
  `PC_LIVE` indexes 16-19 on the DATA rows - 19 = the liquid flag - filled by rebuildLive from the same c.k /
  d.maxbuy / anchor-vs-PC the eBay Catalog row gets, cleared and refilled on every live refresh, the
  release-order key moved to index 20; `inserted {v: 5, at: 14, n: 3}`; help keys pc_k / pc_maxbuy / pc_vspc;
  range chips 16-18). `t.apply(true)` (what rebuildLive calls) keeps the rows already shown through "Show more"
  on view instead of cutting back to 300. Raw Data's period starts on TODAY (`periodBar(key, onChange, 'd')`:
  by day, from = to = today, label "day 13 of month 10, 2026"; `roll()` from tickAge moves an untouched bar
  along at midnight) and `erRows()` shows the whole 24-hour window whenever the period reaches the present
  (`P.now()`), so last evening's listings do not vanish at midnight; a past period still filters by first-seen.
  Raw Data's eBay Rarity/Finish cell carries the eBay Catalog's dim count (`efCount`: live.ef[card][2] listings
  looked up; the tooltip names the majority and whether this listing agrees; `cardFacts(cid)`). The eBay
  Catalog's band-title row (`tr.grp`) keeps only the Card and Trends titles (Brett, later the same day: "keep the
  card header and the trends header"); the Observed / Rates / Decisions titles are gone and their 23 columns sit
  under one blank cell, so `bands()` lets a column move anywhere among those 23 but not into Card or Trends. The
  band COLOURS are gone everywhere (same day: "left over color in the borders ... remove those"): no g-obs /
  g-rate / g-dec / g-tr classes in body.html, no legend line under the tab line (the README keeps its inline
  legend words), the two titles sit in one quiet fill (`--band`, class band) with no border darker than the
  fill, and header rules use `--hline` (never darker than the header). A HIDDEN COLUMN NOW VANISHES, eye and all
  (`th.col-hidden, td.col-hidden {display:none}`; "i also want the eye to disappear"); Columns... is the way
  back; a band title (tr.grp) spans only the columns still showing (`paintBands`, data-span keeps the real span
  for `bands()`). THE MONTH COLUMNS (2026-10-13, Brett: "pc sales for last month, ebay sales for last month, and a
  column that records the number of ebay sales that have accrued since the start of this month"; Hits 30d and a
  Hit % on all three tabs; Anchor $ in place of Max buy $ on the PriceCharting tab): PC SALES (last mo) =
  PriceCharting's volume bar for the last complete month on the card's page (every grade; `pchist.
  last_complete_month(rec)`: the month before the volume read date's month - `sv` or `t` - a month past the record's
  last point = 0, no bars = None), for EVERY card via `pcm.bin` ({cid: [month index, sales]}, `pchist.
  last_month_all()`, published hourly, PCM_PUBLISH_S; the page's `loadPcm()` fetches it once an hour and
  `fillPcm()` puts it on the DATA rows); a bar older than last month shows its month in grey; `pchist.stale()`
  marks an active card stale on the first read of a new month so its bar turns final within days (REFRESH_ACTIVE_D
  otherwise weekly). EBAY SALES (last mo) / (this mo) = `es.month_sales(daily)` from the daily rollup (calendar
  months, UTC) -> card `km` / `kt`; last month is shown only when `live.since` (`es.data_since`: the oldest rollup
  day) is on or before the 1st of that month - the collector started 2026-09-28, so October is its first whole
  month and the column fills on November 1 (until then a dim dash with the reason). The trailing-30-day count k is
  NO LONGER A COLUMN anywhere (λ, Hot and the anchor still run on it). HIT % = `live.hl30` (`hit_listings_30d`:
  Buy It Now listings alerted in 30 d, each once; auctions out) ÷ card `n30` (compute_stats' new30: comparable
  listings first seen in 30 d incl. the unsold counts), `Math.min` so it never passes 100; Hits 30d stays the alert
  count (hits_30d, BIN + auctions). ROW INDEXES: DATA 16 pcm, 17 its month, 18 km, 19 kt, 20 Anchor A, 21 vs PC %,
  22 hits30, 23 hit % (`PC_LIVE`), ord at 24, `r.n30` expando for the tooltip; ec 41 = pcm (was pcv ÷ 12), 49 km, 50
  kt, 51 n30, 52 hit %, 53 pcm month, header data-k 5 -> 49, `inserted {v: 6, at: 9, n: 1}, {v: 7, at: 32, n: 1}`,
  compact shifted, band colspan 25; er 40 = pcm, 41 = km, 51 kt, 52 hits30, 53 hit %, 54 pcm month (auRows and
  hhRows read them off the DATA row), `inserted {v: 12, at: 22, n: 3}`; pc `inserted {v: 6, at: 14, n: 1}, {v: 7,
  at: 16, n: 1}, {v: 8, at: 19, n: 2}`. Cells: `pcSalesCell`, `kmCell`, `hitsCell`, `hitPctCell` (app.js). Tests:
  ut/test_months.py, t/pcpop/test_ui6.py. HEADER RENAMES: the "?" popup's pencil has a "Column name" field;
  the name is stored with the description (`h:<key>.n`, collector `help_edit` keeps n up to 60 chars) and
  `applyNames()` (help.js) writes it into every header sharing that key, on every live refresh; the original is
  kept in th.dataset.on; an empty name restores it. THE ARCHIVE: `archive_tick()` (collector.py), after the publish
  each cycle, writes once a day cards/<day>.json.gz.enc (every card's numbers: CARD_ARCHIVE_KEYS) and on the first
  cycle of a month closed/<prev month>.jsonl.gz.enc (last month's closed listings, whole records) to the
  "archive" branch (`archive_put`: an ordinary, append-only branch; checkout in data/archive, cloned or started on
  first use), encrypted like the state (es.encrypt_file_blob). Failures back off an hour. This is the long-run
  dataset for later analysis: the live branch is overwritten and the state forgets closed listings after 60 days.
  THE EBAY TREND CHART (2026-10-13 evening, Brett: "have the ebay catalog trend chart resemble the price chart trend
  chart ... built on ebay data ... switch to daily time points or weekly timepoints", plus his yes to a dot per sale
  and a bar of new listings): the eBay Catalog's Trend button opens the same popup as PriceCharting's chart
  (`openTrendEbay`, `drawChart`, `renderEbTable`, `ebBuckets`, `ebLabel`, `rangePoints` in app.js) drawn only from
  `live.cards[cid].hist`, which `trend_stats` (ebay_sweep.py) now ships with two more series: `sp` = every sale total
  in day order (the page splits it with `sales`) and `new` = listings that appeared each day (the rollup's third
  cell). POINTS: Day / Week / Month (`#ebpts` .zb buttons, remembered in localStorage `eb-pts`, default Day); the
  page folds the daily series itself - Week = Monday-to-Sunday (UTC), Month = calendar month. One slot per period as
  PriceCharting's chart (x = L + iw(k+.5)/n), bars = sales in the period (`rect.bar-s`), New listings (`#c-new`, off
  by default) = a paler amber bar beside it (`rect.bar-n`, COLORS.fresh), the price line = `hist.price` (the 7-day
  median) with Day points or the median of the period's own sales with Week / Month (EB_MED_MIN 3 or blank), Each
  sale (`#c-dots`, on by default, Day points only - disabled otherwise) = a faint dot per sale spread inside the
  slot (`circle.dot-s`), the cheapest ask = the period's last reading. A period still running (end >= today UTC:
  `open`) or that the history starts inside (`from`) is faded with a dashed edge (`data-part`) and says "to date" /
  "from <day>" in the hover readout (sales, new listings, median, low - high, cheapest ask) and in the table.
  `#ebtable` under the chart (the periods newest first, `tr.part` italic for open/from, Download CSV `#ebcsv`:
  period_start, period_end, sales, median_usd, low_usd, high_usd, cheapest_ask_usd, new_listings) is the eBay
  counterpart of `#pctable`; `pcMode(on)` swaps the two sets of controls (`ebpts`, `ebbar1`, `ebbar2`, `ebtable` vs
  `pczoom`, `pctable`). Show: Last N days/weeks/months keeps the periods whose last day is inside the window. An old
  payload without `sp`/`new` still draws (no dots, no week/month medians, note says the next publish fills them).
  This rewrite also removed a ReferenceError (`LABEL_PC`, deleted earlier but still read in drawChart's note) that
  had been stopping renderStatsEbay after the chart drew. Help: `et_trend` (the Trend header's "?") explains every
  control, caveat and the PriceCharting comparison; README ec section 2; the pc `trend` entry now describes
  PriceCharting's chart. Tests: ut/test_hist.py (sp/new), t/pcpop/test_ui7.py (the popup end to end).
  DOWNLOAD HISTORY CSV (same evening, Brett: "a csv that combines all of the csvs from the pricechart trend chart ...
  every card, the year the card was released, the pricechart volume per month ... the ungraded price per month ... a
  small download button"): `#pchist-btn` beside Filters... on the PriceCharting tab (inserted after the tables are
  built, app.js `downloadPcHistory`). The page fetches all `pch.shards` history shards ten at a time (the Trend
  popup's pc/<shard>.bin files, ~3 MB in all), decrypts them with HKEY and writes ONE ROW PER CATALOG CARD in DATA
  order, months as columns: card_id, card, set, number, released, release_year, first_month_on_record,
  months_on_file, read (rec.t), then `volume YYYY-MM` for every month from the earliest m0 on file to the newest
  point (PriceCharting's Pokemon record starts 2020-12, so about 70 months), then `ungraded YYYY-MM` (dollars, 2 dp;
  blank where p is null). A card without a record is a row with 0 months and blank cells; volume cells are written
  only when the record was read signed in (`s` or `sv`), as the chart does. Progress on the button ("Reading 50 of
  200..."), then "Downloaded ✓ N of M cards on file" for 8 s; the file is `pricecharting history YYYY-MM-DD.csv`,
  built from Blob parts (no collector work, nothing new stored). No long (card-month) layout: 44k cards x ~70 months
  is past Excel's row limit; build it only if he asks. Help: the pc README section 3. Test: t/pcpop/test_ui8.py.
- THE FORECAST TAB (2026-10-17, Brett: "I input my capital that I can spend, then you tell me what cards to buy with
  that capital, how many of each to buy, and my estimate range of net profit after I hold for a month and then sell,
  and confidence% ... spend at least 3 hours manipulating the historical price chart data and testing algorithms").
  THE RESEARCH (scripts in the session's /tmp/claude-0/fc/an; 2.3M card-months from the pc/<shard>.bin history,
  Dec 2020 - Oct 2026, 43,924 cards; rolling out-of-sample backtests refit every 6 months, scoring 2022-12 on):
  (1) PriceCharting's month-to-month moves are mostly noise - a card whose price just fell prints higher next month
  (Spearman IC of last month's move vs next month's -0.23, negative in 67 of 67 months) but it cannot be bought at
  the dipped print, so the honest buy price is max(price, 3-month average) ("buy_real") and the sell price is
  PriceCharting's price h months on; on that basis card-level 1-month momentum is nil. (2) The market regime (the
  trailing 3-month MEDIAN move of $10+ cards with 2+ sales; "strong" >= +2%/mo) is 90% autocorrelated month to month
  and is the biggest predictor; 2021 fell, 2022-24 flat/slightly up, 2025-26 strong (+3-7%/mo). (3) Set age is the
  most reliable structural effect: sets < 6 months lose 10-20%/mo, 6-11 mo -5%, 12-23 -4%, 2+ years ~flat/up - in
  every year including the 2025-26 rally. (4) A gradient-boosted model (sklearn HistGradientBoostingRegressor,
  30 features: mom1/3/6/12, accel, vol6, dd12, up12, lv, vgrow, dvol, vol12, lage, lp, cal, reg1/3/6, breadth/3,
  lsy, rarity/finish codes, set_mom1, set_n, prank, vintage, yoy_same, vz, m_since_hi) ranks well (IC ~0.25 at
  every horizon; top-50 beats the universe in 87% of months) but at ONE MONTH the top 5% average only +5-6% gross;
  with eBay's 14.1% + $5.20 round trip NO selection has a positive expected net at a standard price (P(net>0) ~10%
  for the best picks, mean net -15 to -30%); the month pays only bought 20%+ under market (P(net>0) 57%; 25% under
  73%; 30% under 86%). (5) At 6 months in a strong market the model's upper buckets did +26-36% gross, P(up) 73-83%,
  P(net>0) ~45-50%, mean net ~+5%; BUT the 6-month ranking is regime-fragile: trained through 2025-06 it had IC
  0.32 on 2024-25 and ~0 on 2025-26 (its top picks +15% vs the universe +36%: that rally was cheap old commons /
  reverse holos it did not favour). Recency weighting, dropping the reversal features, a structural prior, blends -
  none fixed it. (6) eBay sold medians run ~even with PriceCharting's ungraded (median A/pc 1.04 on anchored cards),
  but cheapest asks sit well below PC on some promos, so the tab prices at eBay's level when it has one.
  THE PIECES: `forecast.py` (repo root; identical feature code to the research; `panel`, `features`, `train`,
  `score`, `publish`) runs in the site workflow after staticrypt (step "Forecast", continue-on-error): fetches the
  live branch's pc/ shards, decrypts with SITE_PASSWORD (live key), reads the newest snapshot, fits one model per
  horizon (1/3/6; universe price >= $10 and vol >= 2; targets clipped -0.9..2; months <= last complete - h) and
  writes public/forecast.bin = encrypt_live(gzip(JSON)): {t, m, month, regime {reg1, reg3, reg6, breadth3,
  strong}, cols, cards {cid: [price, buy, pred1, pct1, pred3, pct3, pred6, pct6, mom1, mom3, mom12, age, vol, vol12,
  dd12, set_mom1]} for every $10+ card (~10.5k), calib, meta}. `forecast_calib.json` = the realized-return quantile
  grids (5..95%) by "h|regime|bucket" (buckets b50/b80/b90/b95/top5 of the percentile rank; regime strong/other)
  for cards >= $25, out of sample 2022-2026 (make_calib.py) - RERUN THE RESEARCH to refresh it; it is static.
  requirements.txt gained scikit-learn (the Action; the droplet does not import forecast.py). PAGE (app.js
  "Forecast tab" section, body.html #p-fc, help.js README.fc + fc_* entries, style.css .fc): inputs capital,
  hold 1/3/6, discount under the standard price (default 0), price range (50-500: the collector's listing band),
  per-card share (20%), confidence bar (50%), allow young sets (off), allow unknown supply (off). For each scored
  card: buy = c.L (credible eBay floor) else c.A else buy_real (PC) - what the copy costs; SELL base = c.A (eBay's
  sold median, what buyers actually pay), else min(buy_real, c.L) for a card with a credible floor but no anchor
  (too few recent sales: it cannot be assumed to sell above its cheapest credible competing ask - PC printed $256
  against $185 asks on the second live build), else buy_real (PC); the sale is sell x (1 + r) with the model's
  PC-series return applied to eBay's own level; forecast_score() scores the same way (A from the card stats at maturity, else
  PC). PC alone misled both ways on the first live build: a $161-on-PC card that clears for ~$100 on eBay showed as
  a 40% deal at $95 (100% chance), and a $77 card asking $170 as a buy - hence A. A credible floor is never more
  than 25% under A (CRED_MIN_RATIO), so a standard-price buy's built-in margin is at most that; no stated chance
  exceeds FC_P_CAP = 0.95 (the grids end at the 5th percentile). The Price cell shows buy, then "sells $A · PC $x"
  when they differ (red when buy is 30% off the sell level). Fixture: floor $90, sells $95, PC $120 -> 12% at the
  standard price, 78% at 25% under; needs vol12 >= 6 and age >= 24 unless allowed; supply = book copies
  <= 1.15 x buy (null outside the band = untracked); bucket -> calib grid -> net per copy at the 10/50/90th percentile
  (`fcNet(buy, r, S, disc, sell)` = sell(1+r)(1-fee) - fixed - label - supplies - buy(1-disc)(1+tax), fees from
  settings()), P(net>0) = 1 - cdf(break-even return) on the grid (`fcCdf`). Allocation: cards with P >= the bar,
  best chance (whole percent) first then the model's rank, qty = min(share cap, supply, money left). Basket
  range/chance: Monte Carlo (3,000
  draws) with a Gaussian copula - half of each pick's variance is a shared market draw (`FC_RHO`). When nothing
  clears the bar the summary names the discount at which the best card would. The regime card shows the trailing
  moves and what the 80-90th percentile bucket did at each hold in this regime (`fcRenderRegime`). RECORDS:
  "Record this forecast" -> alSend {type:'forecast', t, h, cap, disc, fees, picks [[cid, qty, buy, mean net]], exp,
  lo, hi, p, reg, month}; collector `forecast_record()` keeps the newest FORECAST_KEEP=100 in v["forecasts"],
  `forecast_score()` scores a record at t + h x 30 d with cat.by_id[cid]["pc"] (realized net per copy with the
  record's own fees), published as live["forecasts"] {t, recs} (forecast_t in the publish signature); the tab's
  Past forecasts table shows expected vs actual with the score line (mean miss, inside the 10-90% range, right side
  of zero). forecast.bin is fetched from the site itself (same origin, hourly bucket); a missing/garbled file only
  blanks the tab (loadForecast validates the doc; rebuildLive wraps fcCompute in try/catch). LESSON (build #96): the
  first live file carried a NaN (a card with one month of history has no 3-month average, so buy_real was NaN) and
  Python's json.dumps writes NaN, which the browser's JSON.parse refuses while Python's own loads accepts it - so a
  Python-only check of the file proves nothing; `publish()` now runs `clean()` (NaN/inf -> null, buy = price when
  there is no average) and dumps with allow_nan=False, and ut/test_forecast_pub.py parses the output with Node.
  Tests: t/pcpop/test_ui9.py (the tab end to end against a forecast.bin fixture served over http),
  ut/test_forecast_rec.py (records), ut/test_forecast_pub.py (strict JSON). The research scripts: build.py,
  features.py/features2.py, explore1-4.py, backtest.py/backtest2.py, calib.py, final_model.py, make_calib.py,
  validate_pipeline.py, recency.py, structural.py, blend.py.
- REVIEW ON AUCTIONS, THE RISK POINTS POPUP, EBAY'S CONDITION FIELD (2026-10-17 evening, Brett: "the review button does
  not work for auctions sent to my phone"; "press the watch button and have a popup revealing the points"; "many
  listings say condition n/s but the posting states the condition"). (1) openReview(iid) found its row only in
  LIVE.erMap (the 24-hour live table), so an auction (alert.au) or a hit from the history (alert.hh) whose listing
  had left the table did nothing; it now falls back to LIVE.au / LIVE.hh, and those records carry the photos: the
  collector stores img + the first 4 imgs on hit_snapshot and the au_hist record and publishes them at hh row 29-30
  / au row 27-28 (falling back to the live/closed record); closed records keep imgs[:4] too. (2) riskCell renders
  a <button class="riskb"> around the badge (and around the dash when signals fired but the tier is clean);
  openRisk(iid) shows the signals that fired with their points (live.scam.points = SCAM_POINTS, published since
  this change, SCAM_POINTS_DEFAULT in the page meanwhile), the thresholds (watch 3, suspect 5, dup alone, burst),
  and per signal what closed listings with it did (live.scam.signals: sold/ended/gone/stale). (3) The condition:
  es.ebay_condition(it) reads getItem's conditionDescriptors (name containing "condition"/"grade", values as
  {content} or strings), else the "card condition"/"condition" item specific, else the seller's
  conditionDescription note; the title's COND_WORDS decide the code, "damaged" -> HP; apply_condition(rec, it)
  stores rec["ec"] (text) and, when it names a grade, rec["ecc"] and rec["tcond"] (eBay's declaration beats title
  words; the re-match pass keeps ecc; rec["ec"] = "" when the listing states nothing, so "read, none there" is told
  apart from "never read"). It runs inside item_facts() AND learn_facts(), so every full look (identity checks,
  confirmations, book/suspect/facts lookups, alerts) reads it. The CONDITION PASS (collector, right after the
  identity lookups and AHEAD of the window re-reads - its first version sat last in the optional work and made 0 of
  its 400 looks in its first hours, the bucket never had a token left by then): cond_queue() = n/s, matched, first
  seen < 24 h, in the alert price band, not suspect, 2+ photos, never looked up, dearest first; one look every
  COND_EVERY_S = 90 s (COND_MAX_PER_CYCLE 1) when the bucket holds 2+ tokens, COND_DAILY_MAX 400 a day
  (v["cond_day"]), each a confirm(..., "cond", cat) full look, once per listing (rec["cond_tried"]). Live row 35 =
  rec["ec"]; the page's condCell shows the grade with a small "e" when it is eBay's and explains n/s on hover; the
  hourly "Conditions:" log line counts the listings read with the condition code (before the "" marker it counted
  every listing with facts on file and said 13,413 "carry none" when it meant "not read for this yet"). The first
  three descriptor payloads are logged raw ("Condition: <id> descriptors ..."; ebay_sweep's log is quiet inside the
  collector, so the last such line comes out with the hourly summary) - CHECK THE LOG
  after the first deploy: eBay's exact JSON shape for trading-card descriptors was not verifiable from the docs, so
  the reader accepts both shapes and the log confirms which one arrives. Tests: ut/test_cond.py, t/test_risk.js.
- FAVORITES (2026-10-23, Brett: "I want each tab to have an additional column called favorites ... a star icon.
  Clicking the star turns it into a yellow color and toggles it on ... I want the entire row to go to a tab called
  Favorites ... Unmatched titles, Scam screen, Mismatches, phone notifications, review button to also have the option
  ... after I click Favorites I am presented the option to click one of: pricecharting, ebay catalog, ebay raw data,
  forecast ... it populates the favorite tab with the exact columns from the corresponding tab", plus "one option can
  just be show all, where it shows everything through ebay lens"). A FAVORITE IS A POINTER, NOT A COPY: {s: source
  (pc / ec / er = any listing-shaped row / fc / um = an unmatched title), k: key (card id on pc, ec, fc; item id on
  er, um), c: card id or null, t: ms, m: a few words for rows that may leave the data (listing: ti / u / p (+ why for
  um); Forecast: h, d, buy, med, lo, hi, p, q, n, s)}. PAGE (app.js, "Favorites" block after LIVE and "The Favorites
  tab" block after TABLES): FAV_MAP = live.favs.list + local echoes FAVS (cleared when live.favs.t >= echo.t, like
  MARKS); favBtn(s, k, c, m) draws the star and files its {c, m} in FAV_META; one document click handler ->
  favToggle -> favSend: echo, favPaint (every star on the page, the counts, the Favorites tab if showing), alSend
  {type: 'fav', t, s, k, c, v, m} with a STRICTLY INCREASING t (FAV_LAST_T: the collector drops a message older
  than its last). The star is a real column: `<th class="favh" data-k="fav" data-label="Favorite">` second after Row
  in the pc / ec / er header rows (ec's Card band colspan 8 -> 9; `inserted` v9 / v8 / v13 {at: 1, n: 1} shift the
  saved eyes / order / widths / highlights; ec `compact` indexes moved up one); makeTable renders
  `favCell(cfg.fav, r)` after the Row cell when cfg.fav = {s (a tab or a function of the row), k, c, m}; a header
  click with data-k "fav" sorts favorites first / last / default (the comparator maps k === 'fav' through isFav);
  colLabel honours data-label. THE TAB (#p-fv, nav button data-t="fv", hash #favorites, showTab allows 'fv' and calls
  fvRender): chips All / PriceCharting / eBay Catalog / eBay Raw Data / Forecast with counts (fav-sel remembered;
  All default). fvBuild() runs BEFORE the tables are made and clones each source tab's <thead> into #fv-fall (ec's),
  #fv-fpc, #fv-fec, #fv-fer with fresh controls / ranges / tbody ids (q-fpc ...); FV_TABLES = the source cfg with
  rows = the starred rows (newest star first), extra null, defaults {}, store = the source tab (makeTable's new
  `store` option names the localStorage keys hide-/order-/hl-/width-/chips-/chiporder-/cols-<store>, and `root` the
  selector of the header row), so a view shows the tab's columns AS SET UP THERE; t.resync() re-reads those keys
  before each showing. Raw Data view rows: erMap -> LIVE.au -> LIVE.hh -> LIVE.favEr (rows the collector builds for
  starred listings past 24 h, live.favs.rows, judged by erowOf - the live-row builder factored out of rebuildLive) ->
  erStub (the words saved with the star); unmatched titles are unmStub rows drawn by unmRow (every column, mostly
  blank; the row builder picks unmRow when r.unm or a card-less stub). The .auc / .fxc columns show in the view
  (the #p-er CSS does not reach it). All view: favRowsAll groups every favorite by card into FV_FROM, uses the ec
  row or ecStub(cid) (catalog columns + PC price, dashes elsewhere), appends fvFromNote into the Card cell ("from:
  PriceCharting · 2 listings", titles on hover); its star key is 'all:<cid>' and favToggle on it removes every
  favorite of the card; favsOf('um') go in the strip #fv-um (fvRenderUm). Forecast view (fvRenderFc, a plain list):
  the pick as starred (m) and "Now" from FC.rows. Stars elsewhere: fcRenderPicks (first cell), openScam's suspects,
  openMismatches' <li>, the Unmatched popup (kind um), openHits (ledger entries carry cid), alHistory (the collector's
  hist rows now carry item id and card id at 10-11), alRender's Preview, openReview ($('bsub'), class rvstar).
  Scroll handler: on the Favorites tab the id is FV.cur. COLLECTOR: fav_set() (read_requests, type 'fav') keeps
  v["favs"] {s:k -> {s, k, c, t, m}} capped at FAV_MAX 400 (oldest out), v["fav_t"]; fav_live() publishes
  live["favs"] = {t, list: [[s, k, c, t, m] ...] oldest first, rows: {iid: es.live_row(rec, cs)} for starred listings
  not in the 24-hour table} (fav_t is in the publish signature); es.live_row(r, cs) is build_live's row factored out;
  es.fav_listing_ids(state) exempts starred listings from es.prune (record + imgs), from close_listing's photo rule,
  and from the 60-day trims in hh_rows / au_rows; alert_status hist rows append e["i"], e.get("card"). CSS: .favb
  (yellow #f5b301 when .on), th.favh / td.favc, .fvchip, .fvsec, .fvfrom, .fvum, .fvfc, #fvtoast (favSay). Help:
  HELP.fav, README.fv. Tests: t/test_fav.js (14 checks incl. load order on #favorites), ut/test_fav.py; test_page.js
  band indexes moved up one. Not starred: Transaction Report rows (his own flips), the Book and Offer lists, hit.html.
- THE TWO GUARDS, EXPECTED ROI, THE RAW DATA FORECAST COLUMN, STICKY ROWS (2026-10-23 evening, Brett: "Next to expected
  net lets include expected ROI%", "the ebay raw data tab, to have a forecasted hit check mark tick option next to the
  only hit tick option", "for all tabs, when i click on a row, i want that row to stay highlighted until i click on a
  different row", and "i like those two guards"). THE GUARDS came out of the first live picks: the tab showed 11 cards
  at 80%+ and +$711 on $5,000 at a one-month hold, and every one of them rested on a sold median made of two or three
  sales (eBay's "A") sitting far above the card's floor, which the 25% credibility rule then let the floor undercut -
  a margin built from noise. (1) A counts only with A_n >= gate.minSales (5; `FC_MIN_SALES()` on the page, ANCHOR_MIN
  in forecast_math / the collector); a thinner card sells no higher than PriceCharting's level, capped by its floor:
  sell = min(pcBuy, L) when a floor exists, else pcBuy (the Price cell says "thin" / "pc" beside the sell level).
  (2) The sale must undercut the cheapest competing credible ask - the copy you buy leaves the market, so the next
  credible ask (cred[1], or cred[0] when the pick is not the floor copy) caps the sell ("ask", the median it replaced
  on hover). `fcLevels(c, pcBuy, skip)` (app.js) / `levels()` (forecast_math.py) return {buy, sell, src, why, A, An,
  comp}; buy = L ?? (A if ok) ?? pcBuy as before; forecast_score() applies guard 1 at scoring time too. Live result
  after the guards (build #114): 8 picks at 52-84%, +7.4% expected ROI, 876 cards "thin", 68 "ask". ROI: the summary
  shows the expected net and its ROI on the money actually spent (exp / spent), and the range's ends as percentages
  of it; "Buy only at" help text corrected (it had claimed the bar was a per-card net margin). RAW DATA: a "Forecast %"
  column (er row index 56, header position 32, `inserted {v: 14, at: 32, n: 1}`): `fcStampRows()` stamps every er / au /
  hh / favEr row with `fcListing(cid, total, iid, h, S)` = the chance of a profit buying THIS listing at its total
  (the Forecast tab's hold, the Raw Data buy tax, the guards' sell level with the listing itself skipped as the
  competing ask), re-stamped after fcCompute and every rebuild; the "Forecast hits" tick (`#fchits`, saved in
  ebay-settings) keeps rows with r[56] >= the Forecast tab's bar (`fcErOk`); the Favorites Raw Data view carries it.
  STICKY ROWS on every table: `SEL` (a Map keyed by `table.dataset.sel`) remembers the clicked row's `data-key`; one
  document-level click handler marks `tr.sel` (CSS: an inset box-shadow tint on the first cell, so it shows through
  the tab's own row tints) and `selApply(table)` re-marks it after every render; makeTable sets `tbl.dataset.sel = id`
  and `tr.dataset.key = keyOf(row)` (cfg.key: er String(r[22]), rv 'rv' + the last field, default r[0]); the Forecast
  tables, the Favorites views and the popups' tables carry data-sel too. Tests: t/pcpop/test_ui10.py (ROI, the
  guards against fixtures - a 2-sale median capped by PC, a competing ask - the Raw Data column and tick, sticky rows
  on five tabs); test_ui9.py / test_ui6.py indexes shifted for the star column.
- FORECAST HITS ONLY, AND THE MONTHLY ARCHIVE (2026-10-23 evening, Brett: "have the alarm notification tab, have an
  toggle option to only be notified for forecast card hits"). NOTIFICATION SETTINGS: cfg fields `fc_only` (bool),
  `fc_h` (1 / 3 / 6, the hold the chance is judged at) and `fc_minp` (0-95, the bar; default the Forecast tab's); the
  Alerts tab's preview shows what would pass now (`alRender()` after fcCompute, so the preview waits for the model).
  COLLECTOR: `forecast_doc()` reads the site's own forecast.bin once an hour (decrypted with the live key; cached in
  memory, never in the state), `forecast_chance(cards, cfg, cid, total, iid)` = the page's fcListing in Python
  (forecast_math), `forecast_gate(cfg, fcp)` decides; a hit push (and an auction push, judged at max bid + shipping)
  carries "Forecast: NN% chance of a profit at a <h>-month hold" and, under the bar with fc_only on, is HELD BACK -
  not marked sent, so it goes out if the chance later clears (the listing is still in the window); the alert-log
  entries carry "fc" and alert_status's hist rows publish it at index 12; a model file that is missing or stale (> 2
  days) leaves the filter open and logs once. THE ARCHIVE (the Forecast history tab's live half): `fc_auto_tick()`
  runs on the first cycle of each calendar month (v["fc_auto_month"]) and files `forecast_math.standard_plans()` -
  5 capitals (500 / 1,000 / 5,000 / 10,000 / 25,000) x 3 holds x 2 discounts (0 / 0.2) = 30 plans at STD_FEES {fee
  0.1325 x 1.065, fixed 0.40, shipOut 4.50, supplies 0.30, tax 0} and STD_INPUTS {pmin 50, pmax 500, share 0.2, minp
  0.5, young off, untracked off} with the live eBay floors / medians of that moment (the guards applied) - as records
  like Brett's own ({t, auto: 1, cal: "2026-10", done: None, ...}), kept 24 months in v["fc_auto"], scored by
  forecast_score() when the hold is up (roi added to every scored record, his included), published as live["fc_auto"]
  = {t, recs} (fc_auto_t in the publish signature). First set filed 2026-10-23 20:26 UTC: 30 plans for 2026-10.
  forecast_math.py mirrors app.js EXACTLY - the same LCG (seed 12345) and Box-Muller draws, the Gaussian copula (RHO
  0.5), P_CAP 0.95, MC_N - so a plan the collector files is the plan the tab showed; ut/test_fcmath.py runs both on
  one fixture and asserts identical numbers (keep it passing when either side changes). `plan()` accepts a card stub
  {"supply": n} for the replay; `actual_net(picks, S, disc, y_of)` scores a basket. Tests: t/pcpop/test_ui11.py (the
  toggle and the preview), ut/test_forecast_rec.py (guard 1 at scoring, the archive, the gate), ut/test_fcmath.py.
- FORECAST HISTORY (2026-10-23 evening, Brett: "a forecast history tab. Where it shows the estimate net profit range, and
  the actual profit range and the actual %roi. for a 1-month hold, 3-month hold, 6-month hold for $500 ... $25,000 ...
  so for instance, if i wanted to see how much I would have made in march 2025, with a $5000 dollar investment ...
  You can design it how ever you see best"; then "you can include the 0% standard as well as the under 20%"). TWO
  HALVES. (1) THE REPLAY, `forecast_hist.py` (repo root; imports forecast.py's panel / features / train and
  forecast_math): from START_M 275 (2022-12) to the last complete month, the model is refit every 6 months on the
  months before (F.train(df, h, t - 1)), every $10+ card scored and ranked within its month (pct), the chance tables
  built from the outcomes known by then (months <= t - h, price >= $25; under 12 such months the static
  forecast_calib.json tables stand in and the month is marked calib "static"), and the standard plans run for every
  cap x hold x disc with BAND (50, 500), the standard price = buy_real (max(price, 3-month average); there is no eBay
  history), supply = max(1, int(vol x 0.25)), MC_N 2000, then scored with PriceCharting's price h months on
  (`actual_net`); a month without buys records `forced_roi` / `forced_n` = the top-ranked cards bought anyway. Output
  (encrypted like forecast.bin, ~107 KB): {t, made, from, to, last_month, consts, caps, holds, discs, cards {cid:
  [name, set]}, months [{m, month, reg, reg3, n, calib, cells {"h|disc|cap": {n_elig, best, picks [[cid, qty, buy,
  mean, y]], copies, spent, done, exp, lo, hi, p, actual, roi, inside, forced_roi, forced_n}}}]}. Args --shards /
  --hist-json, --snapshots, --catalog, --calib, --out, --password (SITE_PASSWORD env). `.github/workflows/
  forecast_history.yml` (cron 07:41 UTC on the 2nd + dispatch, ~3.5 min on Actions): the newest pc_catalog_* snapshot
  + the live branch's shards -> forecast_hist.py -> `gh release upload snapshots forecast_hist.bin --clobber`; the
  site workflow's "Forecast history" step downloads it into public/ (continue-on-error: no file = the tab says so and
  shows the live plans). First run 2026-10-23: 47 months, 776 plans with buys. (2) THE LIVE PLANS = live.fc_auto
  (above), scored at eBay's sold median when each hold is up - the test of the tab as it really ran, floor picks
  included; the replay can only test the model. PAGE (app.js "Forecast history tab" block, body.html #p-fh / #fh-body,
  style.css .fh, help.js README.fh + fh_replay / fh_live; nav data-t="fh", hash #forecast-history): FH {doc, err,
  loaded, cap, disc, open}; chips pick the capital (fh-cap) and the scenario (fh-disc: "At the standard price" /
  "Bought 20% under", remembered); `loadForecastHist()` fetches forecast_hist.bin?t=<hour> (same origin); per half:
  `fhSummary` tiles (one per hold: months with buys, scored months profitable, expected -> actual, mean ROI per hold,
  inside the 10-90% range) and `fhTable` (data-sel 'fh' / 'fhlive'; a row per month, newest first, six cells per hold:
  Buys = cards · copies + spent, Expected + ROI, 10-90% range, Chance, Actual (tick = inside the range), ROI; a no-buy
  cell shows the best chance and the forced ROI; * = the static-calib first year); a click on a month toggles its
  detail row (`fhDetail`: every pick with the realized net per copy via fcNet(buy, y, FH_S, disc, buy); FH.open keyed
  '<sel>:<month>') and keeps the sticky highlight (SEL.set before the repaint, since the document handler runs after
  this one on the old row); the tab's help buttons are drawn dynamically, so the #fh-body click handler opens them
  (openHelp). showTab defers the first render with setTimeout: with #forecast-history in the address at load, FH is
  declared further down (TDZ). rebuildLive re-renders the live half. WIDTH: 20 columns must fit Brett's 1440 px window
  (box 1364 px) at every capital and scenario - the range cell stacks lo over "to hi", the header is "Range" (the
  10-90% explanation on hover; "10-90% range" alone was 103 px), cell padding 4px 5px, and .fh overrides the Forecast
  tab's `.fc .fc-box td:first-child { min-width: 170px }` (the panel carries .fc for its look); measure
  `table.scrollWidth` against the box after any column change. WHAT THE REPLAY SAYS (the honest answer to "can
  the model predict 10% in a month?"): at the standard price the 1- and 3-month plans NEVER cleared the 50% bar in
  47 months (best chance 22% / 42%) - with the buy and the sell at the same level eBay's round trip needs ~22% in a
  month and no rank bucket delivers it; the 6-month plan had buys in 18 of 47 months, 9 of 12 scored profitable, mean
  ROI +5.5%; bought 20% under (the hit-alert price): 1-month 42 of 46 profitable, +9.5% mean ROI, 3-month 38 of 44
  +14.5%, 6-month 37 of 41 +28%. March 2025, $5,000, 1-month: standard no buys (top picks anyway -15.2%); 20% under
  17 copies, expected +$666, actual +$102 (+2.0%). The one-month edge, if any, is the collector's floor picks - which
  only the live half can test. Tests: t/pcpop/test_ui12.py (needs /tmp/claude-0/t/forecast_hist.bin, a real replay
  re-keyed to the test page's key, + forecast_hist_local.json), ut/test_fcmath.py; a replay run locally takes ~3.5
  min (`SITE_PASSWORD=... python3 forecast_hist.py --shards <pc dir> --snapshots <dir> --out forecast_hist.bin`).
- THE EBAY TREND COLUMNS WAIT FOR HISTORY (2026-10-23 night, Brett: "the volume drift, 30%, and slope 30% column should
  show data because we have been collecting data for at least a month"; also "the ebay sales for last [month] column
  ... is not showing"). Not bugs: the collector's daily rollup (`state["daily"]`, live.since) began 2026-09-28, so every
  card had at most 26 days, and `trend_stats()` counts each column's minimum from the card's first day in the rollup
  (tr.days): Δ30d needs hist_days > 30 and a priced day (7-day median of 3+ sales) 30 days back; Range 90d and Volume
  drift need 60 (the drift compares the last 30 days with the 30 before - impossible sooner); Volatility 3 moves; the
  Slope needed 30 days AND 10 priced days - the 30-day floor was redundant and is gone: 10 priced days spanning 14+
  days (~300 cards qualified that night). "eBay sales last month" (km) stays blank until the collector has watched a
  whole calendar month (`covered` in rebuildLive: live.since <= the 1st of last month): October is the first, so the
  column fills on 2026-11-01. The page's blank trend cells now carry the reason on hover (`trendDash(trDays(cid), need,
  why)`, the card's own day count and live.since; Trend popup notes match). Expect Δ30d and Slope to fill from ~10-28,
  Range and drift from ~11-27 - say so instead of lowering a minimum.
- THE RESEARCH FOLDER (2026-10-24, Brett: "Spend 3-hours, analyzing all of that data you saved in data/ ... store what you
  learned in the data folder: storing mathematical models that you tried and failed, things that worked ... store it as
  data ... Do not update the website. Do not apply your findings to the forecast tab"). Twenty-three experiments (E01-E23)
  on the committed data/ folder, recorded in `data/research/` as a registry (experiments.csv), one note per experiment,
  result tables, reproducible scripts (common.py loader, xs.py cross-sectional engine, e##_*.py), a backlog and a sources
  file; `FINDINGS.md` is the synthesis. THE FINDINGS, in short: (1) fees are the first-order problem - a +22% move is
  needed at $100 to break even and no selection clears that at the standard price within 1-3 months (base-rate P(net>0)
  6-18%); (2) the one large robust card signal is REVERSAL toward the card's own 6-12-month level (dev12 bottom decile
  +10.5% in 3 months vs +3.7% for the band, +24% in strong markets; past winners lose at every horizon; volume /
  volatility are not buy signals; the GBM ranks (IC 0.26) but does not beat the single reversal decile); (3) set-level
  momentum is an ARTIFACT of PriceCharting's monthly averaging (E11: PokeViews' daily set index has zero forward power) -
  never rank on it; the market regime's persistence is real (daily PV index confirms); (4) the regime gate (trailing
  3-month market median move > 0, reg3; reg1 as the fast confirm) calls the next quarter's sign right 91% of the time
  and removes essentially every losing cycle in the simulation; Google Trends web-search change improves the level
  forecast but not the gate; PokeViews gauges add nothing yet; (5) the DISCOUNT is the business: each point of buy
  discount ~1.3 points of net; with realistic availability (12% of band cards have a credible floor >=20% under the sold
  median, 25% >=15%, 40% >=10% - E07) the 3-month hold x dev12 x sets>=24 months x 20% under compounds $5k at +31%/yr
  ungated / +28% gated with 0 losing cycles (E10, 2022-2026; the profit is all 2024-26, 2022 lost 12%/yr even at 20%
  under, which is what the gate avoids); 15% under: +22%/+20%; 10% under: only gated 3-mo positive; 1-month holds need
  the full 20%; (6) hold 2-3 months with >=20 cards: picks are nearly uncorrelated (market explains 3-6% of pick variance)
  so 20 positions cut the basket loss probability from 40% to 15% at 3 months (E12); 6 months only for near-standard
  buys; (7) execution edges: patient selling at the 80th percentile of sold prices +9-11%, buyer-pays-shipping ~5 points,
  Store rate ~1 point (E07/E08); deep floors are mildly adversely selected (-4% median drift in 14 days, E13). THE SECOND
  ROUND (E17-E22): the reversal's per-month rate peaks at a 2-4-month hold (E17); its excess over the band is +6 to +10
  pts per quarter in EVERY year 2022-26, 53/55 months (E18); DILUTION - with $5k and 12% discount availability the pure
  decile deploys ~15% of the money, the simulated 31%/yr is the return of the best discounted HALF of the dev12 ranking
  (E17); cap/band grid (E19) CORRECTS the first draft: keep the 20% per-card cap (never below 10%) and the whole $50-500
  band - narrowing to $50-250 / $100-250 costs 6-10 CAGR points through under-deployment; E20 is an EMPIRICAL CHANCE TABLE
  (results/E20_chance_table.csv: regime x hold x discount x dev12 rank bucket -> P(net>0), mean, p10/p50/p90; e.g.
  3-mo, up regime, 20% under, bottom decile 74% / +23%; out-of-sample error ~5 pts) meant to replace the standard-price
  classifier probabilities; Fama-MacBeth regressions (E21) show dev12 survives every control (12-1 momentum, 12-mo-high
  distance, volatility, price, liquidity, set age, market beta) and the reversal portfolio's excess is ALPHA NOT BETA
  (+7%/quarter over the band, t 12, beta -0.2; wider in down months) - cards have no 12-1 momentum premium; in a down
  market a card that dropped last month keeps dropping another month (mom1 +3.8 pts, t 5.5); S&P/gold/BTC do not lead
  the card market (E22); THE EXIT RULE (E23): list each copy at its own 12-month mean on arrival, sell when it prints,
  market-sell at month 6 - beats every fixed hold (chance 66 -> 78%, 5.1 -> 5.7% per month of capital, up markets 7.4 ->
  8.7%/mo with the money back in 2.3 months instead of 3; 87% of picks reach the anchor within 6 months); stop-losses
  HURT a reversal trade; assumes a copy listed at the anchor sells within the month the monthly average reaches it
  (time-to-sell at a fixed ask is unmeasured, backlog B03/B12). THE
  REGIME BUG: computing the regime from cards priced $10+ in the current month biases it up (2022 looked flat-positive);
  use last month's price (xs.py). NOT YET APPLIED TO THE SITE - Brett will ask for that in a later prompt; FINDINGS.md
  lists the build order (gate display, reversal rank, discount-centred plan, 3-month default, calibrated chance at the
  entered discount, fee options).
- THE DATA FOLDER (2026-10-23 night, Brett: "save the data, because if I want you to analyze the data in the future, then
  you will have it saved and at your quick and easy disposal ... store the data from the ungraded price and the sales
  volume per month since December 2020 ... all of the data from the ebay catalog data tab ... google trend data ...
  save it in a data folder in github"). `data/` on main, four sub-folders, `data/README.md` = the dictionary (every file,
  every column, PokeViews' own descriptions as Brett pasted them). (1) `data/pokeviews/`: PokeViews' charts are
  TradingView-style canvases fed by public JSON files at storage.googleapis.com/pokeviews-prod/<feed>/<feed>.json.gz
  (found via performance.getEntriesByType('resource') in his Chrome; the page fetches them from the browser, so the
  sandbox cannot - the egress allowlist refuses the host). Feeds: top100_index, top250_index (+ constituents_table,
  series_composition), bull_bear_indicator (= Hot & Cold), mms (Market Momentum), new_highs_lows, asset_comparison (+
  asset_correlation/correlation_matrix), trend_exhaustion (= Trend Extension), pc_era_index, pc_series_index (+
  constituents), pc_set_index_<series slug> x 15 (+ constituents; slug = lower, & -> and, spaces -> _, hyphens kept:
  "e-card"). data_archive.py writes every column of every feed to CSV (gzipped over 1.5 MB), one row per day (or per
  day x series / set), plus manifest.json. Checked against the charts: every Top 100 right-axis label equals the feed's
  last row and the 30-day EMA recomputes from index_value to 6e-7; the Hot & Cold page shows the `gauge` column, not
  `display_score`. (2) `data/pricecharting/`: pc_monthly_<year>.csv.gz (card_id, month, price $, sales) from the live
  branch's pc/ shards - 2,309,526 card-months, 2020-12..2026-10, 43,955 cards - split by year so a monthly refresh
  rewrites ~2 MB, not 10; cards.csv.gz from the newest snapshot. (3) `data/ebay/catalog/<date>.csv.gz` daily (~385 KB:
  every live.cards scalar, tr.* flattened, today's rollup cell, names from the snapshot) and `daily_rollup.csv.gz`
  monthly (card, date, sales, sold totals, 7-day median, cheapest ask, new listings). (4) `data/google_trends/`: Brett's
  five Google Trends exports for "pokemon cards" (web from 2004, image / news / shopping / YouTube from 2008, each 0-100
  on its own peak) + pokemon_cards_interest.csv side by side - manual, he downloads them. THE WORKFLOW runs daily 10:41
  UTC (+ dispatch with full = true; the 2nd of the month is full) on GitHub's machine - it can reach the feeds, the live
  branch and the snapshot release, decrypts with SITE_PASSWORD, and `git push`es to main with the GITHUB_TOKEN (rebase
  and retry when main moved). First run 2026-10-23 22:44 UTC: 25 s, ~17 MB. Growth: ~140 MB/yr of daily eBay files +
  ~25 MB/yr of panel rewrites - watch `git count-objects -vH`; move old daily files to a release if it ever matters.
  FROM THE SANDBOX: `git fetch --depth 1 origin main && git archive FETCH_HEAD data | tar -x -C <dir>` - the whole folder
  in seconds; pandas reads the .csv.gz directly. HOW IT GOT THERE (the routes, for next time): no push access from the
  sandbox (add_repo: "link your GitHub account"), so text files <= ~40 KB went through the connector's push_files (byte-
  identical, verified by blob sha - the only change was a trailing newline on files that lacked one), the workflow file
  through the editor, and every big or binary file through the workflow itself. That division is the rule now: data is
  built on GitHub, never typed through a tool call.
- NTFY RATIONS REQUESTS PER ADDRESS, AND THE PICTURE WORKER WAS EATING THE RATION (found 2026-10-23 while testing the
  first star): the message sat on the channel, signed and valid, for ten minutes while the collector saw nothing.
  From the droplet, `since=<id>` polls (what read_requests sends) came back 429 while `since=12h` came back 200 a
  second earlier. ntfy.sh's per-visitor request bucket (about 60, one back every few seconds) was drained by the
  picture worker polling `<channel>-pc` every 4 s, so the main channel's once-a-cycle poll was refused most of the
  time - and read_requests treated any non-200 as "no messages", silently. That is why marks, reviews, forecast
  records and reads arrived minutes late (or only when a restart paused the worker). Fix: PC_POLL_S = 20 for the
  worker; read_requests counts refused polls in v["req_bad"] and logs "Requests: ntfy answered 429 ..." once an hour.
  RULE: everything that talks to ntfy.sh from the droplet shares ONE ration - add no poller faster than ~20 s, and
  never let a non-200 pass in silence. (A poll with an unknown `since` id also returns nothing: a req_since older
  than ntfy's 12-hour cache would blind the channel until a restart; not seen yet, but worth knowing.)
- REVIEW READS THE LISTING ON DEMAND; ALERT HISTORIES KEEP THEIR FACTS (2026-10-23, Brett: "some of the ebay auction
  pictures are not showing in the review button", "a lot of the set names and raritys say not read??? why", "many
  cards that are 'read' report n/s but the item specifics report the condition"). Why "not read": a full look is one
  of the 5,000 eBay calls a day and discovery / re-reads / confirmations come first, so most listings never get one
  (17K of 27K open listings had facts on 2026-10-21, inherited mostly); the auction and hit alerts DID read the
  listing (identity check with PRODUCT) but threw the facts away, so every auction row said "not read". Now: (1)
  au_hist / hit_snapshot records keep "ec" and "ef" (only when the rec has it - None must stay "not read", [] is
  "nothing on the listing"); au_rows publishes facts row + ec at 29-30, hh_rows at 31-32; the page's histFacts()
  fills row 48/49/50/55 from them when the listing is not in the live table. (2) site_read(state, cat, iid)
  (collector): a {type: "read", i} request from the page (main channel; queued in v["site_read_q"] by read_requests,
  run at the top of cycle()) does ONE getItem with PRODUCT for an open listing (item_facts + learn_facts, a sold
  one closes), a closed record, or a history entry (a probe dict with the card), fills photos / condition / facts on
  whatever holds the listing, answers on the reply topic (site_reply, same signature as the picture answers) and
  publishes this cycle (v["read_t"] in the publish signature); SITE_READS_PER_HOUR 60. PAGE: openReview() asks
  (readAsk, once per 5 min per listing, READ_DONE remembers an answer) when the eBay side is incomplete - no photo,
  ef == null, or n/s with no eBay condition text - and shows the "being read now" note; readWait() polls -pcr every
  5 s for up to 3 min while the popup stays on that listing; applyRead() patches the live row (x[19/33/34/35/13]),
  the au entry (27-30, 9) and the hh entry (29-32, 9), rebuilds, and the popup re-renders. Tests: ut/test_siteread.py,
  t/test_read.js (+ test_risk.js, test_page.js, test_tabs.js, test_review.js, test_ui5.js still pass).
- THE DROPLET RAN OUT OF MEMORY (found 2026-10-23: the collector died every ~40 minutes through the night of
  2026-10-20/21 - "Collector starting" with no "Cycle failed" or "Restarting on the new code" before it, process lives
  shrinking from 4 h to 40 min as the state grew - and stopped publishing altogether at 07:13 UTC on the 21st; the
  state backup had reached 14 MB gzipped / 86 MB of JSON, 27K open + 56K closed records). Measured on a copy of that
  state: 191 MB as Python objects (open 70, closed 78), the catalog 45 MB, the libraries 60 MB - and json.dumps()
  of the state, run EVERY CYCLE by save_state, peaked at +171 MB of transient string, with the live file's dump on
  top: enough to hit the 1 GB droplet's ceiling. THE DIET: es.json_gz(obj) gzips the JSON piecewise (a top-level
  list element by element, a big top-level dict entry by entry; +19 MB transient, same bytes back), used for the
  state and the live file; the state is saved every SAVE_EVERY_S (180 s) and before a restart, not every minute
  (the hourly backup saves on its own turn); KEEP_CLOSED_D 60 -> 35 (the statistics reach 30 + 3 days, the archive
  takes last month's rows on the 1st); IMGS_KEEP = 4 photos per listing (discovery had kept all 24 eBay allows -
  46 MB of JSON across the open listings; every screen shows four); closed records keep imgs only for listings in
  v["alerted"] (the hit / auction history falls back to them); es.prune() trims what older records already carry.
  Recovery needs a hand on the droplet (DigitalOcean power cycle, or `systemctl restart pokemon-collector`; the
  unit's ExecStartPre pulls main first, so the new code runs from the first start); a swap file or the 2 GB size
  is the safety net the box lacks. Tests: ut/test_cond.py (json_gz round trip, prune, close_listing).
- RAW DATA TIDY-UP, COLUMN WIDTHS AND HIGHLIGHTS (2026-10-08 evening, Brett's request). Every tab: a header's right
  edge is a drag handle (`.rsz`) - the width is pinned as width/min/max on the header and every cell of the column
  (`th.sized, td.sized` clip with an ellipsis), remembered per tab in localStorage `width-<tab>` {original index: px};
  double-click the handle to let the column size itself; the click that ends a resize is swallowed so it is not a
  sort. The small ring beside the eye (`.hlb`) paints the header neon green (`th.hl`, #39ff14), remembered in
  `hl-<tab>`; "Reset columns" now resets order, widths and highlights. Raw Data: the Photos column is gone (the
  filter "at least 2 photos" stays; `inserted` got `{v: 8, at: 28, n: -1}` and the makeTable migration handles n < 0:
  the removed index is dropped and later ones shift, for hide-, order-, hl- and width-); a Status chip (open / sold /
  ended / gone / stale, `statOk`, remembered as `stat-er`); the explanatory paragraph above the table is gone and its
  five tools are buttons (`.actbar .actbtn`); the "a ceiling: ..." sentence after the every-hit total is gone; the
  "Too cheap only" counter has its own span `#ncheap` (it shared `#nmm` with the Mismatches button and never
  updated). Mismatches: `live["alert"]["mm"]` carries a 4th number, listings matched to the card (`card_matches()`,
  open + closed), shown as "N of M listings (x%)" in the Mismatches popup and on the Review popup's "Mismatched
  before" row.
- REVIEWER COLUMN AND DRAGGABLE COLUMNS (2026-10-08, Brett's request, "so that I may check card identity on my
  laptop website, just like my phone"). The Mismatch tick became the "Reviewer" column (`umCell` -> a `button.rvb`):
  "Review" opens `openReview()` in the book modal - a copy of the phone's first question: PriceCharting's picture
  (click -> their page) beside the eBay photos with thumbnails (click -> the listing; row field 33 carries the
  listing's other photos, kept from the search's additionalImages in `summary_record`), the facts row by row, then
  "Not the same card" / "Same card" / "Withdraw my answer". Answers go over the signed channel as
  `{type: "review", i, v: 1 | 0 | null}`; `review_listing()` in collector.py: 0 = `mark_listing(on)` (the old tick,
  same flag, same learning), 1 = mark off + `v["right"]` (confirmed matches; `learn_tables` reads their titles as
  good words) + `dec: "yes"` on any alert entry, null = withdrawn. `v["reviews"]` (item -> {v, t}) is published as
  `live["alert"]["reviews"]` with `review_t`; the page shows ✓ same / ✗ mismatch from `REVIEWS` until confirmed.
  THE PICTURE IS READY LIKE ON THE PHONE: `PcImageWorker` (collector.py), a daemon thread started in main(), reads
  PriceCharting card pages in the background, one every PC_PREFETCH_GAP_S = 2 s while there is a backlog (the
  first version read 5 a minute inside the cycle; after 40 minutes only 137 of the 2,769 cards listed that day had
  a picture and Brett saw the button instead - 2026-10-08 evening). Order (`pc_plan()`, handed to the thread every
  cycle): the newest listings' cards first (the top of the Raw Data tab), then every card with eBay data; cards
  with a picture, or whose page gave none this week, are skipped. A card Brett presses Review on without a picture
  goes first: the page posts `{type: "pcimg", c}` (signed as usual) to the channel's side topic `<topic>-pc`
  (`pcAsk()`, once per 5 min per card); the thread polls that topic every 4 s (`poll_requests`), reads the page and
  posts the signed answer `{c, code | null}` to `<topic>-pcr` (`answer`); the page polls `-pcr` every 4 s for 2.5
  minutes (`pcWait()`), verifies the signature, keeps the code in `PCIMG_KNOWN` and swaps the picture into the open
  popup (`reviewPicRefresh()`, the `.rvbox[data-pc]` placeholder) - typically 5-15 s after the click. The live file
  carries it too (an urgent result -> sched["publish"] = 0 and `changed`), but raw.githubusercontent holds the live
  file up to 5 min (cache-control: max-age=300) and the page polls it once a minute, so the live file alone was too
  slow: Brett still saw the button (2026-10-08). `read_requests` on the main topic accepts `pcimg` as well. THE
  THREAD NEVER WRITES THE STATE: results go through
  `worker.results` and `file_pc_images()` files them on the main thread into `v["pc_img"]` (the cache `pc_image()`
  already uses for alerts, cap 12,000) and `v["pc_miss"]` (retried after PC_IMG_FAIL_RETRY_D = 7 days). Backoff: a
  page that cannot be read pauses the thread a minute, five in a row a quarter of an hour. `pc_read_image()` is the
  one HTTP read (404 = none). The whole table travels as `live["pcimg"]` = {card id: the unique part of the
  address} (`pc_image_table()`; the page rebuilds https://storage.googleapis.com/images.pricecharting.com/<code>/
  1600.jpg). PriceCharting page reads, not eBay calls. Hourly log line "Pictures: ... still to read".
  DRAGGABLE COLUMNS, all five tabs (makeTable): headers are draggable; a drop reorders the header row and every
  row's cells; the order is `localStorage['order-' + id]` (a permutation of ORIGINAL indexes); every cell carries
  `data-ci` = its original index (`t.stampRow`, called in renderMore), so the eyes (`cellOf`), sorts (`data-k`) and
  the row builders are untouched; "Reset columns" beside Reset filters restores it. On the eBay Catalog a column
  moves only inside its band (the `tr.grp` colspans). Drags cannot start on the eye or the "?" buttons.
- MISMATCH MARKS (same evening, his request). Raw Data has a "Mismatch" column after Row (`umCell`); ticking sends a
  signed `{type: "mark", i, v}`; `mark_listing()` sets `rec["um"]` and the same flag on the alert-log and au_hist
  entries, and files the listing in `v["wrong"]` (forced, whatever the scam tier). `um` makes `wrong_card()` true -
  out of the book, sold prices, lambda, trends - and `verdict()` returns "mismatch: marked by you" first of all.
  The row stays, tinted (`tr.umm`), and shows even under "Only show hits". Live row fields 31 (um) and 32 (lrn).
  The page shows a tick at once from `MARKS` until `live["alert"]["mark_t"]` passes it. A phone "No" on a clean
  listing does the same through `note_wrong(v, e, state)`.
- THE MATCHER LEARNS FROM THOSE MARKS (ebay_sweep.py, "learning" block), three rules, narrow to broad:
  (1) the marked listing itself; (2) `bad_titles()` - the SAME SELLER's same title is never filed under that card
  again (checked in `sweep()`, it goes to the unmatched list as "learned: ..."), and the same seller's other
  listings of that card get `rec["lrn"]`. The title rule was any-seller for a few hours and Brett had it narrowed
  (2026-10-06): eBay's listing tool writes many titles from the item specifics, so a genuine copy from another
  seller can carry the very words of a mislabelled one. A mark with no seller on record (auctions) teaches no title.
  A phone "No" now stores the listing's whole title, not the alert log's first 70 characters; (3) warning words - a word in >= LEARN_MIN (3) of his mismatches, not among the matched card's own
  name / set words, in no title he confirmed as right, in <= 2% of all titles on file and >= 10x as common among his
  mismatches as overall. `apply_learning()` stamps `rec["lrn"]` each cycle on the last day's open listings and
  `verdict()` returns "learned" (never a hit; statistics untouched). `live["alert"]["learned"]` shows the counts on
  the Wrong matches card. HONEST LIMITS told to him: a mismatch whose title was right and whose photo was wrong
  (the Charizard 11/108 one) teaches rules 1-2 only; rule 3 needs three marks sharing a rare word, so it is slow by
  design; there is no button yet to drop a learned word other than unticking the marks behind it.
- ANNIVERSARY REPRINTS (2026-10-06 night; the 30th Celebration Charizard that printed 4/102 and was sold as "Base
  Set"). `es.reprint_twins(cat)`: for a card outside the Celebrations sets (REPRINT_SETS = /celebration/), the cards
  in those sets with the same name and number, later, worth <= 75% of it, 20+ PC sales/yr - and only for the DEAREST
  namesake's set when several old cards share the name and number (the reprint copies the famous one: Base Set
  Charizard, not Crystal Guardians #4; POP 5 Umbreon, not Delta Species #17 - "earliest" got Umbreon wrong) -> `tw` =
  [cut, [[set, price, id], ...]] with cut = sqrt(original's PC price x dearest reprint's). `verdict()` (and the
  page's verdictOf) answer "reprint?" for a listing under the cut: never a hit, statistics untouched. Every alert on
  such a card carries `rp` (hit_payload + `alert_extras()` adds the reprint's picture) -> a "Reprint check" box on
  the phone and a line in the push text; that is all an auction can get, its price saying nothing before the close.
  WHY ONLY THOSE SETS: in Brett's catalog 138 in-range cards share name+number with a cheaper card in a later set,
  but only ~25 are true reprints - the rest are coincidences the printed set size already separates. He approved
  the narrow version. The reprint's own listings (title says 30th / Celebrations) match the reprint's row as before.
- MISMATCHES BY CARD (same night). "Mismatches (N)" beside Scam screen on Raw Data opens `openMismatches()`: one row
  per PriceCharting card he has marked a listing against, count, "x of y alerts", search box, click a row for the
  listings. Collector: `mm_counts(v)` -> {card: [marked, of those alerts, alerts sent]}, `v["card_alerts"]` counts
  alerts per card from now on (seeded once by `mm_seed()` from the alerts still on record), wrong entries carry `al`
  (was it an alert). Published as `live["alert"]["mm"]`; each alert carries `mm` when the card has >= 1 mark and the
  phone shows "Mismatched before: 1 of 2 alerts" in the eBay column, only then (he asked for it there).
- THE TABLE FOLLOWS THE PERIOD (2026-10-06 late; Brett: "I selected day 6 to day 6, yet I only see 2 listings
  instead of all 7"). The live rows are a rolling 24 h judged as they stand NOW, so by evening a morning hit has aged
  out or lost its verdict (that day: 2 still passed, 2 had turned "not liquid", 3 were older than 24 h). Now the
  Year / month / day picker chooses the Raw Data table's rows as well as the total: `erRows()`. Only show hits ON ->
  every Buy It Now hit ALERTED in the period, from `live["alert"]["hh"]` (collector `v["hit_hist"]`, a snapshot taken
  by `hit_snapshot()` when the alert goes out, kept 60 days, 29 fields via `hh_rows()`), drawn with the numbers the
  alert promised; `hhNote()` adds "alerted ... · still passes / now: not liquid / older than 24 h, sold" under the
  verdict; a live row that passes now without an alert is added and labelled; a marked row stays. Only show hits OFF
  -> live rows first seen in the period, with `#per-note` saying how many of the 24 h fall outside it. The hit total
  reads the same snapshots, so the Profit column of the rows adds up to the line above. `hh_backfill()` rebuilt the
  hits alerted before this from the alert log (marked old: Max buy worked back from the promised profit, no sell
  price). Phone answers and Mismatch ticks are written to hit_hist entries too (same loops as alert_log / au_hist).
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
- The Forecast tab's sell level obeys the two guards (a sold median needs 5 sales; the sale undercuts the next
  credible ask) - Brett approved them 2026-10-23 after the thin-median picks; the Forecast history replay prices at
  PriceCharting with no eBay history and shows both the standard price and 20% under (his choice, same day).

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
Files too big to type through the connector (`collector.py` 165 KB, `ebay_sweep.py`, `page/app.js`, `CLAUDE.md`: one
tool call cannot carry them) go through Claude in Chrome: open github.com/BrettS600/biotech-catelog/edit/main/<path>
(the CodeMirror editor), inject two helpers with the JavaScript tool - `__sha()` (git blob SHA of the editor text) and
`__applySeq(ops, want)` (each op {a: a unique anchor string, b: its replacement}, applied with `view.dispatch`, returning
OK <sha> / MISMATCH / ANCHOR PROBLEM) - generate the ops from the tested local copy (`mkedits.py old new ops.json`
widens each hunk to a unique anchor and prints both SHAs), then "Commit changes..." with the message and the two
attribution lines in the description. Verify any commit with `git fetch --depth 1 origin main && git ls-tree FETCH_HEAD
<path>` (only git reaches GitHub from the sandbox; api.github.com and github.io do not).
WHEN CHROME IS NOT CONNECTED (2026-10-17: the extension dropped mid-session): the "Apply patch" workflow
(.github/workflows/apply_patch.yml). Commit `patches/<name>.diff` (plain `git diff` output, a/ b/ paths, any number of
files) and `patches/<name>.msg` (the commit message, attribution lines included) to main through the connector
(`create_or_update_file`, content as-is, and compare the returned blob sha with `git hash-object` of the local file);
the push triggers the workflow, which `git apply --check`s and applies the diff, commits with that message, removes the
patch files, pushes, and starts the site workflow when page/, the build scripts, the forecast or requirements.txt
changed. A diff that does not apply fails the run and stays in patches/ untouched. Build the diff in a scratch repo
whose first commit is main's blobs (`git show FETCH_HEAD:<path>`), copy the tested files over and `git diff`; test it
with the same script the workflow runs (ut/test_applypatch.sh [branch]). The connector's token CANNOT create or
change workflow files (403 Forbidden): those need the editor. First real run 2026-10-23 (CLAUDE.md + collector.py +
page/app.js, 22 KB diff): applied and committed 7 s after the push, site build dispatched. Two lessons: content
pushed through the connector has backslash-u escapes UNESCAPED (`\u2019` in a JS string arrived as the character
itself - harmless there, but the blob sha differs from the local file, so compare and re-align the local copy), and
long lines with non-ASCII characters (help.js) are safer through the editor, where the ops are small.

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
