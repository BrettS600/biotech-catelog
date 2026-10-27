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
- `forecast.py` (the Forecast tab's model, run by the site workflow; VERSION 2 since 2026-10-24: the reversal rank, the
  corrected regime and the empirical chance tables, no sklearn), `forecast_math.py` (the tab's plan arithmetic in
  Python, a line-for-line mirror of app.js: `levels`, `plan`, `standard_plans`, `actual_net`; the collector and the
  replay import it), `forecast_calib.json` (the v2 tables as the replay's static fallback; `forecast.py --write-calib`
  refreshes it) and `forecast_hist.py` (the Forecast history replay, run by `.github/workflows/forecast_history.yml`
  on the 2nd of each month; writes forecast_hist.bin to the snapshots release, which the site build copies into the
  page). See THE FORECAST TAB, FORECAST HISTORY and THE FORECAST TAB, VERSION 2 below (version 2 wins where they differ).
- `data_archive.py` + `.github/workflows/data_archive.yml` — the data folder (`data/`, see THE DATA FOLDER below): PokeViews'
  feeds, the PriceCharting panel, the eBay Catalog of the day, committed to main by the workflow daily. `data/README.md` is
  the dictionary; read it before analyzing anything in there.
- `data/research/` — the forecast research log (round 1 2026-10-24, round 2 2026-10-26; see THE RESEARCH FOLDER and THE
  RESEARCH FOLDER, ROUND 2 below): `experiments.csv` (the
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
- THE FORECAST TAB (VERSION 1 - the model, the regime word and the buckets described here were superseded on 2026-10-24
  by THE FORECAST TAB, VERSION 2 below; the page pieces, the two guards, the records, the archive and the tests stand.
  2026-10-17, Brett: "I input my capital that I can spend, then you tell me what cards to buy with
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
- FORECAST HISTORY (the version-1 replay; the replay's model, start month and figures below were superseded on
  2026-10-24 by THE FORECAST TAB, VERSION 2; the two halves, the file layout, the page and the tests stand. 2026-10-23
  evening, Brett: "a forecast history tab. Where it shows the estimate net profit range, and
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
  data ... Do not update the website. Do not apply your findings to the forecast tab"). Twenty-five experiments (E01-E25)
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
  the card market (E22); EXIT RULES (E23-E25): stop-losses HURT a reversal trade (E23); a take-profit listing at the
  card's 12-month mean looked like the biggest improvement of the study (E23/E24: 47%/yr vs 29%, positive every year)
  and was WITHDRAWN the same day by the stress test (E25) - the back-test sold at the exit month's average price, the
  very number that had triggered the exit; paid at the listing price the rule is break-even per position and compounds
  at 6%/yr, BELOW the fixed 3-month hold. The exit stays "sell at market after 2-4 months, 3 by default" with the gate.
  THE LESSON, binding for every future rule: never let a rule both condition on and transact at the same PriceCharting
  monthly average (the same trap as the set-momentum artifact, E11). THE
  REGIME BUG: computing the regime from cards priced $10+ in the current month biases it up (2022 looked flat-positive);
  use last month's price (xs.py). APPLIED TO THE SITE THE SAME DAY (Brett: "can you just do it for me? and the build?") -
  see THE FORECAST TAB, VERSION 2 below; of FINDINGS.md's build list only the fee options (Store rate, buyer-pays-shipping
  as plan options) are not built. The dry run that preceded the build is `scripts/dryrun_today.py` +
  `notes/DRYRUN_2026-10-24.md` + `results/DRYRUN_2026-10-24_*.csv` (not in the registry: a check, not an experiment).
- THE RESEARCH FOLDER, ROUND 2 (2026-10-26, Brett: "may you see if buying graded cards and reselling is better than raw
  cards. also is it better to to buy from retail and then sell on ebay ... Spend 1-hours, analyzing all of that data you
  saved in data/ ... store what you learned in the data folder ... Do not update the website. Do not apply your findings
  to the forecast tab ... In the next prompt, I will have you apply your findings"). Seventeen experiments E26-E42
  (registry rows incl. b-e variants), same conventions as round 1; `FINDINGS.md` now OPENS with a round-2 section (round 1
  below it still stands except where round 2 says otherwise); notes E26_E28_graded_market, E27_psa10_raw_ratio,
  E29_E30_grading_and_buy_channels, E31_E35_risk_and_pc_lag, E33_relative_reversal, E41_reprint_event; new loader
  `scripts/daily_panel.py` (rebuilds every day of data/pricecharting/daily from full_ + changes_ files: graded columns,
  dealer prices, volume); backlog B15-B21. ANSWERS: graded (PSA 10) indexes outran raw in every era 2022-26 and net
  better in % (no fixed-cost bite on $1.5k+ slabs) but $2-10k buys 1-5 slabs (no diversification) at an unprecedented
  graded extreme - do NOT switch to slabs (E26); grading raw cards yourself fails the 1-3-month goal (PSA Regular $79.99,
  70-80 business days, Value tiers paused; modern bought raw: 12% of liquid cards EV>0, median -48%) (E29); buying at
  retail (shop sells 1.10x market) to resell on eBay loses 23-41% before any move - the money is in the buy: deep eBay
  floors and private / collection purchases at or near shop-buy levels (+29-72% before any move) (E30). FOR THE NEXT BUILD
  (FINDINGS.md round 2 "What to build"): (1) replace dev12 with the RELATIVE REVERSAL rel_combo = mean of rank(setdev =
  dev12 minus the set's median dev12) and rank(peerdev = dev12 minus the mean dev12 of the same Pokemon's other
  printings, needs >= 2 others; setdev alone otherwise) - beats dev12 every year / regime / horizon (3-mo excess +9.6 vs
  +7.5 pts, P(net>0 at 20% under) 69% vs 66%) and in 100% of paired simulation draws (+$780-1,566 on $5k) (E33, E33b,
  E37); the reversal is entirely idiosyncratic - group (set / name) moves carry none (E38); setdev24 >= setdev12 (E39);
  (2) the E40 chance table (results/E40_chance_table_rel.csv, E20's cells on rel_combo; 3-mo up 20% under bottom decile
  76% / +27%); (3) the PSA 10 / raw ratio (manual-only-price / loose-price) as a tilt + displayed fact: IC 0.25 on PC's
  next 28 days, independent of dev12, every week, and 0.37 on eBay's own sold medians - but ONE month inside the record
  graded rally, so re-test monthly (B16) (E27-E27e, E32); (4) keep the reg3>0 gate; show last month's Top 250 Graded
  move beside it (best new 1-month timing input, OOS R2 0.42 -> 0.55) - as a gate it did not raise the simulated
  bankroll (E28, E36, E26b, E42); (5) holds: 2 months for 20%-under buys, 3 for 15%-under (E37); (6) warn when a pick's
  eBay median is already well above PC: E33c RED FLAG - in October, for 290 eBay-liquid cards the reversal pointed the
  WRONG way on eBay prices (hot cards +25% on eBay vs +2.7% on PC: PC can lag eBay for fast movers; no market-level lag,
  E35); validating the reversal on eBay transactions (B04/B15) is the most important open question. FAILED (do not
  repeat without new data): volatility-managed exposure, dispersion gate, era rotation (E31); OU / z-score / MAX
  reversal variants (E33); Trends image / news / shopping / YouTube (E28); PC dealer prices and sales pace as signals
  (E27, E32); "buy the post-reprint dip" (E41: Celebrations originals rose into the announcement, lagged after). The
  `Research results` workflow's loop and `scripts/run_all.sh` include e26-e42 (research.yml timeout 120 min).
- THE FORECAST TAB, VERSION 2 (2026-10-24, Brett: "before updating the forcast tab and forcast history, i wanted to ask if
  you needed more time to look at the data" - no; then "can you just do it for me? and the build? like the number of ebay
  sales and the mis-listed copies obviouslyt need to be considered. wouldnt want the forcast telling me to buy a card,
  when there is no supply for it"). THE DRY RUN FIRST (the research's rules on that day's data, before any code moved):
  market up (reg3 +1.7%/mo, reg1 +2.2%), 2,045 band cards with a rank, eBay supply and a chance; 25 cleared 50% at a
  3-month hold (15 at one month, 282 at six), every one a card whose credible floor sat 15-24% under a sold median with
  5+ sales (Armored Mewtwo SM228 88%, Umbreon & Darkrai GX SM241 84%, Sabrina's Gengar 84%, M Charizard EX #69/#101
  76%...), one copy each $2,888 for an expected +$511. It caught three things the research's averages could not: the
  top of the RAW ranking is junk (prints crashed on one odd sale, promos with one listing and no sales), the v1
  allocation (20% of the capital per card, capped only by the supply) bought 11 copies of Sabrina's Gengar and 23 of a
  Charizard at $10,000, and non-credible asks (under 75% of A) must not cap the sell level. Hence, on top of FINDINGS:
  ONE COPY PER CARD by default (an input, 1-5), a card needs a comparable eBay sale in the collector's 30-day window
  (c.k >= 1; an input, on by default), and the list is shown in BUY ORDER (chance to the whole percent, then rank).
  THE MODEL (forecast.py, VERSION "v2 reversal 2026-10-24"; no sklearn, 36 s locally): `features()` adds m12 (the
  card's own rolling 12-month mean, min 12 months) and dev12 = price / m12 - 1, and the MARKET from cards priced $10+
  LAST month with 2+ sales this month (price_lag1 >= MIN_PRICE: the research's regime fix - filtering on this month's
  price let the month's winners define the month); `rank()`: pct = the percentile of -dev12 within the month among
  cards >= RANK_MIN_PRICE $25 with vol12 >= RANK_MIN_VOL12 6 (deepest below the mean = 1.0; NaN outside - the same
  rank for every hold, pct1 = pct3 = pct6); `bucket_of`: top10 (>= .9) / b90 (>= .75) / b75 (>= .5) / b50; the regime
  doc {reg1, reg3, reg6, breadth3, n, up: reg3 > 0, confirm: reg1 > 0, strong, threshold} (strong kept only for the
  old records' word); `calib()` = THE CHANCE TABLES, rebuilt EVERY RUN from the data: for h in 1/3/6, decision months
  2022-01 (CALIB_START_M 264) .. last complete - h, y = price_{t+h} / buy_real - 1 clipped (-0.95, 5), cells
  "h|up/down|bucket" (the regime = the sign of reg3 at the decision month; MIN_CELL 30) plus "h|all|all", each {n,
  mean, q (5..95%), p_up} - 27 cells. `publish()`: every $10+ card (10,587) with pred{h} = the table mean for its
  (h, regime, bucket) or null, pct{h}, the 16 old columns + dev12 + m12 (COLS), doc {model, rank_min_price,
  rank_min_vol12, n_ranked (4,704 on the first live build), calib (the whole tables), meta {model, rank, regime, calib_months, last_complete,
  research}}; --write-calib writes forecast_calib.json (v2 content on main; the replay's fallback for its first year).
  `clean()` + allow_nan=False as before. forecast_math.py: BUCKETS, `bucket()`, `regime_word(doc)` (up / down; a
  version-1 file still reads as strong / other), `table()` keys on it, STD_INPUTS gains copies 1, recent True, gate
  True; `plan()` caps the quantity at I["copies"], skips a card without an eBay sale in the window unless it is a
  replay stub ("supply" set), sorts the rows in buy order, and when gate is on and the file says the market is down
  (a v1 file is never gated) allocates nothing and returns gated=True; standard_plans' records carry reg (the word),
  model and gated. forecast_hist.py: START_M 264 (2022-01), NO REFITS (the rank needs none), `calib_tables()` = the
  expanding tables per regime x bucket from the ranked card-months whose outcome is known (static forecast_calib.json
  under 12 months; a v1 calib file is rebuilt with F.calib), per month a doc with the regime, every cell carries
  "gated", a gated month records forced_roi / forced_n = THE SAME PLAN WITHOUT THE GATE (an ungated no-buy month: the
  top-ranked cards with no bar, as before), months carry reg / reg3 / reg1 / calib. Replay of 2026-10-24: 58 months,
  33 gated (all of 2022-2023 and Feb-Oct 2024: the corrected regime reads those years as falling), 455 plans with
  buys, 149 KB, 3 min on Actions. WHAT IT SAYS ($5,000): at the standard price the 1- and 3-month plans never clear
  the bar (unchanged from v1), the 6-month plan bought in 18 months, 12 scored, 12 profitable, mean ROI +15.4%; bought
  20% under: 1-month 24 of 24 scored profitable, +10.8%; 3-month 22 of 22, +21.1% (every month of 2025 +8 to +50%);
  6-month 18 of 18, +39.7%; ranges held 20-22 of 22-24. THE GATE'S COST, read off the gated months' forced plans: at
  20% under / 3 months the 33 gated months would have averaged +9.5% (28 positive; the losers Aug-Nov 2022 and Apr
  2023) - with the 50% bar at 20% under the plan already keeps to the deepest dips, so the gate mostly costs in this
  replay (the research's losing 2022 was the whole decile with no bar). It stays ON by default as the research's
  rule and is one click to override; the tab shows the counterfactual. CAVEAT: every ungated month is a boom month
  (2024-01, 2024-11 onward), so the profitable rows are the boom. PAGE: app.js fcBucket / FC_BUCKET_WORDS (deepest
  10% / top 25% / upper half / lower half), `fcRegimeWord()` (reads a v2 or a v1 file), fcTable keys on it; fcInputs
  adds copies (fc-copies, 1-5, default 1), recent (fc-recent, checked), gate (fc-gate, checked); hold default 3
  (fc-h option 3 selected; fcStampRows / fcErCell default 3); fcCompute: the recent rule, rows carry k / dev12 / m12 /
  be (the breakeven), rows sorted in buy order, `gated = I.gate && 'up' in doc.regime && !doc.regime.up` allocates
  nothing, q = min(share cap, I.copies, supply, money left), FC.gated; fcRenderRegime = a LIGHT (`.fc-light-green`
  rising + last month up / `-amber` rising but last month down / `-red` falling) with the 95% / 12% persistence
  sentence and the top10 table; fcWhy = "N% under its 12-mo mean of $X · needs +Y% to break even · age · last month ·
  PC sales / 12 mo · eBay sales / 30 d"; fcRenderPicks: a gated summary ("Nothing to buy: the market is falling ...
  untick the box to override"), an IDLE-MONEY note when more than 10% of the capital is left ("only N cards clear your
  bar today at 1 copy each - the supply of discounted copies, not the capital, is the limit"); fcRecord adds reg (the
  word) and model; the Forecast history tab's no-buy cell says "gate: falling market · the plan without the gate: +x%";
  meta-fc / the replay paragraph reworded; body.html the three inputs; style.css .fc-light*; help.js README.fc section
  2 rewritten as the v2 story (fees, the one signal, the regime, the hold, the tables, supply), README.fh's replay
  paragraph, entries fc_copies / fc_gate / fc_recent, fc_hold / fc_regime / fc_picks / fh_replay reworded. DEPLOYED
  2026-10-24 20:07 UTC: the model files by MCP push (b93dff2), the page files through the editor (app.js 62b185c7,
  body.html 4c45cc88, help.js ee0e5836, style.css 5c88e372), Forecast history run #2 (58 months, 33 gated, 455 plans
  with buys, identical to the local run), site build #121 (10,587 cards, 4,704 ranked); the live tab at $1,000 said
  9 cards / 9 copies / $957, 84% basket chance, Armored Mewtwo SM228 first at 87%; at $5,000 34 cards and $872 idle
  with the note; the history tab's tiles matched the local summary and both tables fit 1364 px exactly. TESTS (all
  ported to v2, .v1 copies kept beside them in the session's /tmp/claude-0/t and /ut): ut/test_fcmath.py (page =
  Python on one v2 fixture, incl. the gate: equal pick counts), t/pcpop/test_ui9 / 10 / 11 (the one-month fixtures
  set the hold to 1 now that 3 is the default; ui11's rounding tolerance 0.51 for Python's half-even vs JS), test_ui12
  (the v2 replay fixture), ut/test_forecast_pub.py (the new columns / signature), ut/test_forecast_rec.py (fixture
  cards carry k). The droplet: forecast_math.py changed on main -> the collector's 5-minute pull restarts it; the
  monthly archive and the alert filter read the v2 file through the same functions (pct the same at every hold, the
  tables keyed by the regime word). requirements.txt still lists scikit-learn (harmless; nothing imports it now).
- THE WARNINGS BUTTON, THE UNDER-ANCHOR CHIP, TREND AND BOOK ON RAW DATA (2026-10-24 night, Brett: "For the ntfy ...
  when there is a warning, may you have it show a warning button, and when i click it, i can see the what warnings it
  received and how many points it recieved, similar to the way on the website itself. also may you capital the H in
  forcast history tab name ... in the ebay raw data tab, can you add a % buy under filter. may you also add the trend
  column that is in the ebay catelogue tab to the ebay raw data tab ... and also, next to the book column"; the Forecast
  tab's own "% buy under" input already existed - "I buy at __% under" - so nothing was added there). (1) THE PHONE: a
  watch / suspect hit alert (and a watch-tier auction alert) carries an ntfy ACTION BUTTON "Warnings" (`push(...,
  actions=[{"action": "view", "label": WARN_LABEL, "url": link + ".w"}])`; ntfy shows up to three; the plain tap still
  opens the check screen as before). `warnings_payload(state, rec)` adds to the alert's payload d["scs"] = {signal code:
  [sold, ended, gone, outlived 2 days]} for the fired codes, from es.scam_calib(state)["signals"] (a code with no closed
  listings yet is left out), and d["sct"] = [SCAM_WATCH, SCAM_SUSPECT]. hit.html reads an optional flag after a dot in
  the hash (`#<base64>.w`; base64url never contains a dot) and, for a watch / suspect alert, draws the scam box as a
  header line + a "Warnings" button that swaps the plain-language list (#wlist) for the site's table (#wtab, class wt):
  Signal (the site's SCAM_LABELS wording, copied into hit.html as LAB, with the code) | Points | Listings with this
  signal ("18,664 closed: 3,287 sold (18%), 1,818 ended, 173 gone (1%), 13,386 outlived 2 days", or "no closed listings
  with this signal yet") | a Total row ("watch: 3 to 4" / "suspect: at or over 5, or the shared photo alone / the
  seller burst") | the Risk popup's footer sentence; with the ".w" flag the table is open on arrival and scrolled to. The
  "So far eBay has pulled N of M" line stays. (2) "Forecast History": the tab button, the meta line, README_TITLE.fh,
  the replay-file error message in app.js. (3) RAW DATA "Under anchor %" chip: makeTable accepts cfg.get = {key: r =>
  value} for a chip that reads a DERIVED value - the er cfg's ranges / chips gain the string key 'ua' with get.ua = r =>
  -r[12] (vs anchor % with the sign flipped), labels.ua 'Under anchor %', so "20" keeps listings at least 20% under the
  sold median; chip id 'rua' in chips-er / chiporder-er; the Favorites Raw Data view inherits it. (4) RAW DATA Trend and
  Book: two header cells at the end of #p-er's header (positions 43-44; `inserted {v: 15, at: 43, n: 2}` keeps saved
  orders / eyes / widths valid), `erTrendBook(r)` appended by the listing row, auRow and unmRow (dashes without a card):
  `<button class="tbtn ebtn" data-id=cid>Trend</button>` and `<button class="tbtn bbtn" data-id=cid data-iid=item
  id>Book</button>`; the click handler for .ebtn / .bbtn moved from $('rows-ec') to the DOCUMENT, so the eBay Catalog,
  Raw Data and the Favorites views (whose buttons were dead before) all work; `openBook(cid, iid)` marks the row's own
  listing in the card's book (tr.mine, "this one", the sub says "the listing you came from is marked"; a note when the
  listing is not among the ranked copies). Deployed 2026-10-24 ~21:45 UTC through the editor (app.js a0e5faad,
  body.html 7a9060c7, help.js 6b91508f, style.css 70616f1a, hit.html 0826ce16, collector.py 3c730c27), site build #122;
  the droplet pulls collector.py on its 5-minute cycle. Tests: ut/test_warn.py (the payload and the ntfy body),
  t/hit/test_warn.py (the check screen's table, folded / open / the flag / a suspect), t/pcpop/test_ui13.py (the chip,
  the two columns on every row, the Book marker, the Trend popup, the Catalog's buttons), test_ui6 / test_ui12 ported
  (the chip order gains 'rua'; the README title).
- THE CARD POPUP, THE + AND THE PLANNING VIEW (2026-10-24 late, Brett: "when i click on a card in the forcast tab, i
  would like to see a popup with the available listing ... all of the ebay raw data tab column, but ... a column toggle
  button ... on the forcast button page itself ... the available listings with the buy under X% of anchor ... a
  forcasting button and planning button ... a column with a plus sign button, when i click the plus sign, it goes to
  the planning button ... planning button to have the same columns as the forcast button [and] the 'Expected net profit
  ...' ... these numbers will be adjusated with each additional lisring that i add ... i would like collector so it
  follows from labtop to phone ... a star column in popup for adding it to favorites"). (1) THE POPUP (#lov, class
  modal.listings): a clone of #p-er's header row made before makeTable decorates it (fclBuild, like the Favorites
  views) run by makeTable('fcl', FCL_TABLE) = TABLES.er with rows () => FCL.rows, extra fclOk (status open, and vs
  anchor % <= -FCL.ua), no ranges / chips, store 'fc' (hide-fc, order-fc, width-fc, hl-fc: ITS OWN column choices, so
  "Listing columns..." (#fc-cols -> tables.fcl.openColumns()) on the Forecast bar sets every card's popup at once and
  leaves the Raw Data tab alone), root '#lov'. Rows (fclRowsFor): the 24-hour table's rows for the card + LIVE.favEr +
  live.plan.rows + live/fc_rows.bin, deduped by item id, cheapest first (sortKey 9 unless a header was clicked), r[56]
  stamped with fcListing. live/fc_rows.bin (collector fc_rows_file, every 10 minutes, FC_ROWS_LIMIT 1.15): the Raw Data
  row (es.live_row) of every book copy within 15% of the card's standard price (L, else A, else price) that the 24-hour
  table does not carry, keyed by card id; the page fetches it in 10-minute buckets when a popup opens (fclLoad). The
  card's name and its Supply figure open it (a.fcl-open; the PriceCharting link moved to a small arrow); the sub says
  anchor, credible floor, open copies, the under-anchor filter in force. "Listings at least __% under the anchor"
  (#fc-ua, localStorage fc-ua) is the popup's "% buy under". (2) THE + (Planning): a column after the star on the Raw
  Data header (th.plh data-k="plan"; `inserted {v: 16, at: 2, n: 1}` keeps saved orders / eyes / widths valid), so it is
  on every Raw Data row, the Favorites Raw Data view and the popup (cfg.plan = {k: item id, c: card id, m: favMetaEr}
  -> planCell; the header sorts planned rows first like the star). The plan is a list of LISTINGS kept on the
  collector exactly like the favorites: a click sends {type: 'plan', t, i: item id, c: card id, v: 1/0, m: {ti, u, p}}
  over the signed channel (planSend / alSend), shows at once from PLANS (the echo), and live.plan {t, list [[i, c, t,
  m], ...] oldest first, rows {item id: live_row for a planned listing past the 24-hour table}} confirms it (rebuildLive
  clears an echo once live.plan.t >= its t; planIndex -> PLAN_MAP; planPaint repaints every button.plb and the count on
  the Planning chip). Collector: plan_set (v["plan"] = {i: {i, c, t, m}}, PLAN_MAX 200 oldest-out, v["plan_t"] in the
  publish-at-once signature), plan_live; ebay_sweep.fav_listing_ids returns the planned ids too, so a planned listing
  survives the prune. (3) FORECASTING / PLANNING (#fc-modes, FC.mode, localStorage fc-mode): Forecasting is the tab as
  it was (#fc-main); Planning (#fc-plan) is plRender: one row per planned listing (plRows: the row from LIVE.erMap /
  favEr / live.plan.rows / fc_rows.bin, else a stub from the click's m), priced like a Forecast pick AT THE LISTING'S
  OWN PRICE with disc 0 (fcTable(h, bucket) -> fcLevels(cs, pcBuy, iid) -> fcDist(total, tab, S, 0, lv.sell)), Buy = 1
  while open, Cost = total x (1 + tax); the same four tiles from fcMonteCarlo(picks, S, 0) and the "Spend $X of $cap on
  N cards (M listings), hold h months" line, recomputed on every + / - and on every input change (fcCompute ends with
  plRender when the mode is pl); a sold / ended listing stays listed, greyed, out of the totals; "Record this plan"
  (plRecord) sends a forecast record with disc 0, picks [cid, 1, total, mean], plan: 1 and iids, which the collector
  scores like any record and the Past forecasts table labels "plan". Help: plan, fc_modes, fc_ua, fc_plan; the Forecast
  README's "From a card to a listing" paragraph; the Raw Data README's + sentence. Deployed 2026-10-24 ~23:00 UTC
  through the editor (ebay_sweep.py 83332502, collector.py 66d0d3c1, style.css 85b302e0, body.html 77e62177, help.js
  2d8d5e22, app.js e77d8994), site build #123; the droplet picked the collector up on its 5-minute pull (live.plan and
  fc_rows.bin were live by 22:51 UTC: 7,460 copies on 3,960 cards). Checked live: the popup (Armored Mewtwo, 8 open
  copies), a + confirmed by the collector within two minutes, the Planning view's figures, the - again. Tests:
  ut/test_plan.py (plan_set / cap / removal, the prune, plan_live's rows for a 40-day-old record, the plan flag,
  fc_rows_file's rule), t/pcpop/test_ui14.py (46 Raw Data headers with + at index 2, the popup's rows from the table and
  from a fake fc_rows.bin, the under-anchor filter, the column picker's store 'fc', the + message, the Planning
  summary and chance, Record this plan, the live confirmation, the -, the Raw Data + and its sort, the Favorites view),
  test_ui10 / test_ui13 ported (the Forecast % header is index 33 now, the card cell children[4]). NOT done: the phone
  check screen (hit.html) has no + yet.
- SUPPLY AT YOUR PRICE, THE REVIEW POPUP'S WARNINGS AND CONDITION QUESTION, A "NO" HIDES THE LISTING EVERYWHERE
  (2026-10-25, Brett: "says the supply is 3 (from $65.00). even though it says 3 listings it only shows 1. and idk
  what (from $65.00) even means. shouldnt it be like under instead of from? like if i say buy at 20% under ...
  if it says 3, then it shows 3 listing, with the one closest to 20%=< ... as 1 of the 3, and then remaining 2
  listings are marked as a price below"; "that warning button you added to ntfy, need to also be added to the pc
  review button"; "needs to show the conditions underneath the 'finish' section. i want to see the ebay sellers
  reported condition, and then in the next question, i can answer the condition based on my thoughts of the images";
  "if i answer 'no' ... then that listing should dissapear from all tabs, and reappear in the mismatch button popup
  ... a column that says restore"). Before: Supply counted book copies within 15% ABOVE the standard price (so "3
  (from $65)" for Garchomp & Giratina GX: $65, $75.43 and $76.61 against a $74.44 floor x 1.15), while the popup
  filtered by the separate under-the-anchor box - two different rules, so the count and the rows disagreed. Now:
  (A) Supply = the open copies in the collector's book whose effective price - a Best Offer ask at 90%
  (BO_HAIRCUT), an LP copy at its NM-equivalent (the card's lpd), the floor's own basis - is at or under the PLAN'S
  price for the card, buy x (1 - "I buy at"): fcSupplyAt / fcBookEff on the page, forecast_math.supply_at / book_eff
  in Python (ASK_LIMIT is gone; test_fcmath still holds parity). The cell reads "3 (up to $65.00)" - the dearest
  of the counted copies - or "0 (cheapest $76.61)"; a card with supply 0 stays on the list in buy order but is not
  bought (qty 0), and the summary says "Nothing listed at your price" when the bar is cleared but no copy is listed
  that cheap, or "N more clear it with nothing listed that cheap" beside the idle money. At 20% under most cards
  show 0 - that is the honest answer (nothing is listed that cheap today), and the alerts are what catch such a
  copy. The card popup opens on EXACTLY those copies: chips above the rows (#fcl-mode) "At your price <= $T (N)" |
  "All open copies (M)" (FCL.mode, localStorage fcl-mode; FCL.at = fclPlanAt(cid, cs) = fcLevels buy x (1 - disc) +
  fcSupplyAt), refreshed by fcCompute (the discount box) and rebuildLive; the "Listings at least N% under the anchor"
  box (fc-ua, help fc_ua) is gone. Rows the floor would not count as credible are greyed (tr.nocred via fcCredWhy:
  watch/suspect, seller under 50 ratings or under the bar, condition not NM/LP/n.s, eff under 75% of A, sat longer
  than min(7, max(1, 1.6/lam)) days) - still buyable, which is where Review and its Warnings matter. (B) The Review
  popup carries the phone's scam block (reviewScamHtml: tier + points, a Warnings button that unfolds riskTableHtml,
  the table openRisk now shares; a clean listing with no signal gets one dim line). (C) The condition: a row under
  Finish - "Condition . seller" (eBay's condition field, else the title; r[58]) and "Condition . you" (r[57]) - and
  under the two buttons the second question "What condition is it, from the photos?" NM / LP / MP / HP / DMG (+
  "back to the seller's"), sent as {type: 'cond', t, i, v} (CONDS echoes until live.alert.cond_t; live.alert.conds
  carries them all). His grade outranks the seller's everywhere: erowOf / auRows / hhRows put it in r[15] (the
  verdict follows: "condition MP"), condCell marks it "you" with the seller's on hover; the collector's cond_set sets
  rec tcond + bc (and the alert records' bc), None goes back to es.seller_cond (ecc, else the title); ebay_sweep's
  apply_condition and rematch leave a graded listing alone; live_row adds 36 = bc and 37 = the seller's basis when
  graded; hit_payload carries tc / ec (None = never read) / bc. The phone's check screen: the same row under Finish,
  the second question says what the seller claims, and a third button "Worse than lightly played" tells 'mp' (the
  collector files MP; nm / lp file NM / LP now too) and opens nothing. (D) "Not the same card" (the Review popup, the
  phone's No) takes the listing out of EVERY tab: TABLES.er extra (!r.um; the hits view no longer keeps marked rows),
  fclOk, favRowsEr / favRowsAll / fvCounts / fvRenderFl (favHidden), plRows (hidden count, a note in the Planning
  summary). The Mismatches popup lists the listings behind a card as a table with a Restore column
  (restoreListing: REVIEWS[iid] = {v: null}, MARKS[iid] = {v: 0}, type 'review' v null; the collector's
  review_listing(None) also clears a phone 'no' and sets review_t) and hides restored ones (mmRestored) until the
  collector's list catches up. A phone No on a watch / suspect listing used to be dropped ("may mean scam"); now
  note_wrong keeps it with sc: 1 - hidden and restorable like any other, shown in the popup as "watch/suspect: no
  lesson for the matcher" (wrong_rows index 9) - and learn_tables / bad_titles skip it; mm_counts and match_table
  still count it as his mark. Deployed 2026-10-25 ~01:30 UTC through the editor (collector.py 6343d495, ebay_sweep.py
  840f56e0, forecast_math.py 4e0ce0a8, body.html 79204fe9, style.css 04509b8d, hit.html 48529054, help.js 93cbb07a,
  app.js d15409f5), site build #127. Tests: t/pcpop/test_ui17.py (the cell at 0 / 20 / 40% under, the popup's chips
  and rows, the greying reasons, the Review scam block and its table, the condition rows, grading X1 MP -> the
  message, the popup, the Cond cell, the verdict; back to the seller's; a grade from the live file on an fc_rows copy;
  a No hides X1 from the popup, Raw Data, Favorites and Planning; the Mismatches table with the sc note; Restore),
  t/hit/test_cond.py (the row under Finish in four states, the second question, 'mp', the No message),
  ut/test_cond2.py (cond_set round trip, the sweep leaving bc alone, live_row 36-37, the payload, a watch No's sc flag
  and what learns from it, Restore clearing the phone's No, supply_at / book_eff); test_page (hidden + Restore),
  test_ui9 / test_ui10 / test_ui14 / test_ui16 and ut/test_forecast_rec ported to the new supply rule (a cheap copy
  added to their books so the discount lever still finds one).
- THE PC GAP HOLD AND THE FLAGS ARCHIVE, "?" CONDITIONS, THE SUPPLY SWITCHES, THE PLANNING FILTERS (2026-10-25, Brett:
  "My one concern about the forecast tab, occurs when the ebay anchor differs alot from pc charting ... scammers
  deliberately influence pricecharting ... a threshold ... the removal of the listings that exceed the difference must
  be stored in a button similar to matches button but called 'PC% High' ... the same columns as the popup/ebay-raw-data
  tab ... mark it as such [set mismatch, name mismatch, condition, unknown, fraud, unmarked as the first column] ... a
  description box, where i can type in my reasoning ... stored for permanent archive ... '2 of 10' ... underneath
  'sells $305.75 . PC $333.70', there should be text that states the PC%"; the Gyarados EX whose Cond said n/s while
  eBay's field said Lightly Played: "This is a big problem ... the most recently posted cards rather than the old
  cards"; "the ? conditions listings probably shouldnt even be shown in the forcast tab or forcast history tab. nor
  should they go to high PC% differences archive, at not until their condition is actually read"; "i would like the
  newest listings to go to PC% High and then the other older ones can back fill"; "the forecast button and planning
  button should have their own respective filters ... 'warning' ... their stated condition"; "for the default state you
  can have it not show watch and suspect"). (1) THE "?": es.cond_known(r) = a grade in the title or eBay's condition
  field read ("ec" in rec, even ""); live_row 35 is None until then (was "" for both), erowOf keeps null, condUnread(r)
  on the page = UNK + r[55] null + no grade of Brett's -> the Cond cell shows "?" (not "n/s"), the Review row says
  "not read yet ... being read now" and openReview asks the collector for the read (readAsk, as for a missing photo);
  the card popup lists "N copies at the price not read yet (reading...)" and asks up to 6 reads at once (fclAskReads,
  READ_ONLY_ASKED). Until read, a copy counts in NOTHING on the Forecast tab: book rows carry [11] cond_known and [12]
  the scam tier; copy_ok / fcCopyOk refuse b[11] = 0; flags_update skips UNK-and-unread live rows; the Forecast
  History tab lists cards, not listings, so nothing to exclude there. WHY THE GYARADOS HAPPENED: cond_queue counted a
  listing as read when "ef" was present - and the ePID memory gives the facts (set / rarity / finish) WITHOUT reading
  the copy, so inherited listings were never queued; and only the last 24 h were queued, dearest first. Now
  cond_queue(state, cfg, cards): every unknown-condition listing, tiers plan (0) / a card's cheapest copies at or
  under its floor (1, not pcm) / alerted (2) / the rest in the band (3), newest first inside each tier, no age cutoff;
  COND_DAILY_MAX 400 -> 600 (12% of the budget; still one read every 90 s). (2) THE GAP HOLD: es.card_gap(state, cid,
  A, A_n, pc) -> (gap %, hold): a card with a backed anchor (ANCHOR_MIN sales) whose anchor and PriceCharting price are
  GAP_HOLD_PCT = 30%+ apart is HELD - verdict "PC gap" (no hits, no leads; compute_stats cs.gap / cs.gap_hold),
  forecast_math.levels why "gap" projects the sale from the LOWER of the two (pc_buy when under the sell), plan() gives
  a held card no money (elig excludes hold; rows carry gap / hold), the page mirrors it (fcLevels / fcCompute, the row
  greyed tr.fc-held, Buy cell "held", "+80% vs PC" in red under "sells . PC" via fcRenderPicks' gapNote - every row shows
  its gap, red at 30%+ -, the summary "N cards are held ... see Flags"). A card verdict in Flags (any state but
  unknown / unmarked) releases the card for GAP_RELEASE_D = 30 days (vps.gap_marks[cid] = {state, note, t, mt}). Brett
  chose the hold over a mere flag ("im okay with holding flagged cards from both buys and hits until reviewed"); the
  threshold is mine ("for the gap, you would know what is best"). (3) THE FLAGS ARCHIVE (he named it "PC% High"; the
  button is "Flags N" on the Raw Data and Forecast tabs, N = unmarked): collector.flags_update after each build files a
  snapshot (flag_snapshot: the listing's words, prices, seller, condition, photos, facts; the card's A / A_n / pc / L /
  gap; vspc; status; verdict; state "unmarked", note "", mt) of every live row whose verdict is "PC gap" (kind gap),
  "mismatch: too cheap" / "too high" (pclow / pchigh), "review" (under 45% of the anchor) - condition known only - plus,
  once per hold (vps.gap_flagged), up to GAP_SOLD_MAX = 20 of the sales behind a held card's anchor (st "sold", v "sold
  behind the anchor"); FLAGS_NEW_MAX 300 a pass, FLAGS_KEEP 5000 newest in vps.flags, the month's entries to
  flags/<YYYY-MM>.jsonl.gz.enc on the archive branch (archive_tick). live/flags.bin = flags_file (every entry newest
  first, gap_marks, held = [[cid, gap, A, A_n, pc, L]], the state lists), published every 10 min or at once after a
  mark (vps.flag_t != flag_pub_t); live.alert.flag_n = {total, unmarked, held, t} and live.alert.gap_marks. Marks:
  'flag' {t, i, state, note} -> flag_mark (set / name mismatch also answers "not the same card" through review_listing;
  fraud sets rec.fraud and adds the seller to vps.fraud_sellers - score_listings gives "fsl" +5 = suspect to the listing
  and the seller's others; condition / pc stale / unknown just record), 'gapmark' {t, c, state, note} -> gap_mark. The
  page (app.js "The Flags archive" block, store 'fg', FG_TABLE = TABLES.er with State and Note as the first columns after
  Row / star / +; fgBuild clones the Raw Data header): #fov overlay (z 44, under the card popup) with the held-card strip
  (fgHeld: gap, "eBay $A (n sales) vs PC $pc . floor", card verdict select + note + Save -> gapMark, GAPM echo; released
  cards for 30 days), chips State x Kind with counts (fgChips), a day filter, sortable / pickable columns like Raw Data,
  the State cell "fraud / 1 of 2" (its share of the reviewed listings; click = openReview, which puts the Flag section
  first: why it was flagged, the six states, the note, "Save the mark" -> flagMark, FLAGM echo until flag_n.t), the Note
  cell's icon opens the note (#hov), Download CSV (fgCsv, what is shown with the marks). fgRowOf takes the live row
  while there is one, else a row built from the snapshot (erStub + the saved fields), so a listing long gone from eBay
  still shows its words, prices and photos; openReview falls back to FG.rows. (4) THE SWITCHES: "Supply counts copies
  that are..." under the Forecast inputs (#fc-sup: NM / LP / n/s, "no watch / suspect copies" ON by default, "seller >=
  N ratings"; FC_SUP_DEFAULT, inputs.sup -> fcCopyOk / fcSupplyAt and forecast_math.copy_ok / supply_at(c, price, sup);
  STD_INPUTS.sup for the collector's standard plan; test_fcmath holds parity). The popup's "At your price" chip follows
  the same rule, so the count and the rows agree. (5) THE PLANNING FILTERS (#pl-filt, PL_F in localStorage pl-filt):
  "no watch / suspect" (on by default), NM / LP / n/s / other condition; plRows drops what they exclude and the summary
  says "N planned listings left out by the filters above" (the money is unchanged: a planned copy is a buy). Help:
  fc_sup, fc_nowatch, fc_minfb, pl_filt, fg; er_cond ("?" and the order of the reads), er_verdict ("PC gap"); the
  Forecast README's Supply paragraph; the Raw Data README's Flags bullet. Tests: ut/test_flags.py (cond_known /
  cond_queue tiers and order / card_gap release / flags_update's kinds, the condition rule, the sold entries once per
  hold, the cap / flag_mark's three side effects / gap_mark / flags_file / the live counts), ut/test_cond.py ported to
  the new order, t/pcpop/test_ui18.py (the switches and the cell, the popup's chips, "?" and the read request, the
  Review row, the held row and summary, the "PC gap" verdict, the Flags popup: counts, chips, day filter, note popup,
  a fraud mark from Review with its message, the card verdict, a name-mismatch mark hiding the listing, the CSV, the
  Planning filters), t/test_risk.js (the "?" cell). Pre-existing, unrelated failures left as they were: ut/test_classic
  (photo count), ut/test_pc2 (FakeRequests headers), ut/test_cardfacts (needs PW), t/test_pcask.js (the process
  lingers on jsdom timers; its checks pass). Deployed 2026-10-25 ~03:30 UTC through the editor (collector.py 48f079d2,
  ebay_sweep.py 17177b99, forecast_math.py 3599d919, body.html 5f388b10, style.css f85c702b, help.js af21a4da, app.js
  fe47cdc3); the droplet picks the collector up on its 5-minute pull. FIRST LIVE LOOK (03:30 UTC, site build #128):
  the collector had filed 1,080 entries in two passes (331 gap - 70 open copies + 261 sales behind the anchors of 39
  held cards -, 703 "too high vs PC", 46 "too cheap"); 13 of the 1,380 Forecast rows held; the 24-hour table 57% "?"
  (4,003 of 7,059 rows unread; 41% of the 15,087 book copies known, the cheapest copy known on 1,810 of 4,677 cards -
  the Forecast tab's Supply is thinner until the reads catch up at 600 a day, tier 1 first). Three things fixed in
  the follow-up (r41b, ~03:55 UTC): (a) the gap figure is measured against PriceCharting's price TODAY (cs.pc, the
  catalog's loose price) while the row's "PC $" is the forecast doc's figure (this month's average so far, the
  model's series) - "sells $172.74 . PC $170.79 . -11% vs PC" read as a contradiction (the daily price was $194.99),
  so the row now says "-11% vs PC today $194.99" when the two differ (fcCompute row.pcNow, the tooltip names both);
  (b) the Flags button's count is the cards HELD (what wants his verdict; a verdict echoed through GAPM lowers it at
  once), the listing counts are on hover - 1,080 unmarked listings read as a to-do list and most are the collector's
  own "too high vs PC" wrong matches; (c) a card verdict "pc stale" also stands the per-listing PriceCharting rule
  down for the card for 30 days (es.pc_stale_cards, stamp_pc leaves pcm "") - the top held cards were 30th
  Celebration singles PriceCharting lists at $1.99 (eBay $55.72 on 20 sales, +2700%), and without this a release
  would still leave every copy "mismatch: too high"; a fraud mark on a SALE now takes it out of the anchor
  (wrong_card includes rec.fraud), so marking the inflated sales behind a held card brings its anchor back. Also the
  Planning view with every listing filtered out says so instead of "Nothing on your plan yet" (his one planned
  listing is a watch copy, hidden by the default filter), and its listing line shows "?" and the watch / suspect
  tier. Tests extended: ut/test_flags (wrong_card fraud, stamp_pc under the three verdict states), t/pcpop/test_ui18
  (the badge = held, "vs PC today", the empty Planning text, the tier on the line). r41c (~04:10 UTC, app.js only):
  the popup's batch of read requests reached the collector but ONLY THE FIRST WAS SERVED - read_requests drops a
  message whose t is not newer than the last one acted on (the replay guard), and fclAskReads stamped the six with
  Date.now() in one loop (equal t) and posted them concurrently (out of order). Now nextT() hands out strictly
  increasing stamps and alSend posts one message at a time in the order made (AL_CHAIN); readAsk and fclAskReads use
  nextT. Seen live: of five reads asked for Mewtwo & Mew GX #SM191 one came back (LP, "Lightly played (Excellent)" -
  the Gyarados case caught), the log showed one "Site read" per cycle. test_ui18 asks two and checks both arrive in
  order. Confirmed live at 04:12 UTC: five reads asked for Blastoise #2's cheap "?" copies, all five served (two came
  back MP, the rest left the book the same cycle - a $70 Base Set Blastoise is damaged or not the card). COMMIT ORDER
  LESSON: the droplet pulled collector.py (03:25) a few minutes before ebay_sweep.py landed and two cycles failed
  ("module 'ebay_sweep' has no attribute 'cond_known'") until the next pull - when collector.py starts using a new
  ebay_sweep / forecast_math name, commit THOSE first and collector.py last (the loop catches the exception and
  carries on, so nothing was lost, but the live file stood still for the gap).
- FLAGS ON EVERY LISTING, THE STATE COLUMN, "PC INACCURACY" AS THE CARD'S VERDICT, PHOTOS -> SUSPECT, THE "?" SWITCH
  (2026-10-25 evening, round 3 stage 1; Brett's note: "there should be a column next to the (+) column, called 'flag'
  ... each cell has a flag icon that i can toggle on or off ... the listing will appear in the flags button ... i
  should not receive any hits for flagged listings ... a state column ... 'No Flag' ... a number, specifying what
  number of the same pokemon card has received that same flag state"; "if i flag one of them [in a card's popup], then
  i want it to disappear from forecast tab because it means that card isnt even an option to buy. but it doesnt have
  to disappear in ebay raw data tab. also, it will reappear in flags tab"; "Listing with fewer than 2 photos should
  never be shown, and always be labeled suspect"; "next to Supply counts copies that are... i would also like to have a
  question mark toggle"; the Review flag box "for all review buttons"; the card verdict should be "PC Inaccuracy ...
  not listing specific, but rather pokemon card generalized"). (1) FLAG + STATE COLUMNS after the + on Raw Data (TABLES.er
  flag = {k: item id, c: card id}, inserted v17 at 3 n 2 so saved column choices shift; the sort keys 'flag' and
  'state'), the card popup (FCL_TABLE = Raw Data's columns), the Flags popup (it clones the header) and the Planning
  table (flagCells({k: iid, c: cid})); flagCells renders button.flb (grey = no flag, amber .auto = the collector's own
  gap / pclow / pchigh / review entry with no reason of yours, red .on = your reason) and td.fls = the state + a badge
  with how many listings of the card carry the same state (flCounts from live.alert.fl, the FLAGM echo first), "No
  Flag" in grey. A grey / amber flag opens #flpop (z 70): the reasons FLAG_REASONS = set mismatch / name mismatch /
  condition / fraud / unknown, a note box, "Open Review"; a red flag comes off at once ('unmarked'). flagMark(iid,
  state, note, cid) echoes in FLAGM (with c), REVIEWS v:0 for a mismatch (v:null when a mismatch flag comes off),
  rebuildLive, alSend {type:'flag', t: nextT(), i, state, note}. The Review popup's Flag section is on EVERY listing
  (openReview builds a virtual entry {i, k:'manual', state:'unmarked', virtual:1} when the archive has none; class
  'off' until flagged; "Flag it" / "Save the change" / "Take the flag off"). (2) WHAT A FLAG DOES: ebay_sweep.wrong_card
  includes rec.fl, so a flagged listing is out of comparable(), every statistic, the anchor and the floor; verdict()
  says "flagged: <reason>" (after the um check; the page's verdictOf agrees through flaggedBy); the lead path skips it;
  auction_alerts and alert_hits skip it (no hits); fcCopyOk / forecast_math.copy_ok (b[11] = fl) drop it from Supply
  and "At your price"; fclOk hides it from the popup's plan mode (greyed on 'all'); plRows marks it "flagged: <reason>"
  with qty 0 (no money); it STAYS on Raw Data (grey row) and sits in Flags as kind "your flag" (manual). Collector:
  FLAG_STATES = unmarked / set mismatch / name mismatch / condition / fraud / unknown; flag_mark(state, cat, cards,
  iid, st, note, t) creates a kind-"manual" entry (flag_snapshot of the open / closed record or the alert history via
  hist_rec, verdict "flagged by you") when the archive has none, sets / pops rec["fl"], a mismatch also answers "not
  the same card" (review_listing False; None when it comes off), fraud sets rec.fraud + vps.fraud_sellers (cleared
  when the flag comes off and the seller has no other fraud record), 'unmarked' on a manual entry deletes it;
  flag_states_live -> live.alert.fl = {iid: [kind, state, cid]} (the page's counts and the "flagged:" verdicts);
  read_requests(state, cat, cards) so the 'flag' handler has the catalog. (3) THE CARD'S VERDICT is one of
  CARD_STATES = unmarked / "pc inaccuracy" / "pc fine" (gap_mark maps the old "pc stale" to "pc inaccuracy"; the held
  strip's select shows FG_CARD_WORDS); PC_WRONG_STATES = ("pc inaccuracy", "pc stale") stands the per-listing
  PriceCharting rule down (pc_stale_cards) and releases the hold (card_gap) for GAP_RELEASE_D; "pc fine" keeps the hold
  (the badge counts both verdicts as a card that wants nothing more). The automatic detector (the spread of
  PriceCharting's posted sales) is stage 2. (4) THE SALES BEHIND THE ANCHOR in the popup: fc_rows.bin carries sales =
  {cid: [live_row(sale)...]} from ebay_sweep.anchor_sales_all (the 20 newest comparable sales of the window per card,
  um / fl / fraud-marked ones included so a mark can be undone); the popup's chip "Sales behind the anchor N" lists
  them (r.sale rows, FCL.mode 'sales', not persisted; the note "anchor $A on N sales . K marked out by you . flag an
  odd sale..."), so a fraud / mismatch flag on an inflated sale brings the anchor back by itself (wrong_card). (5)
  PHOTOS: score_listings tiers "img" (fewer than 2 photos) as suspect outright, like dup / fsl, so such a copy never
  counts and never shows in the popup's plan mode. (6) THE "?" SWITCH (#fc-sup-q, FC_SUP_DEFAULT.q = false,
  STD_INPUTS.sup.q False): unread copies count in Supply / At your price only when it is on (fcCopyOk / copy_ok: b[11]
  flagged -> never; unread -> sup.q); the Supply cell says ". N ?" for the unread copies left out. CSS: .flb / .fls /
  #flpop / .rvflag.off; the Forecast boxes' card cell has its own class (td.cardc) because the old "td.favc + td"
  wrap rule hit the new Flag cell and the Planning table overflowed (test_ui15 caught it: 1904 vs 1364 px). Help:
  er_flag, er_state, fc_sup ("?"), fg (two ways out of a hold, the columns, "your flag"), er_verdict ("flagged:").
  Tests: ut/test_flags.py (flag_mark's manual entry / unflag / history flag / flag_states_live, photos -> suspect,
  anchor_sales_all, fc_rows sales, the card states incl. "pc fine" keeping the hold), t/pcpop/test_ui18.py (the fl map,
  the sales fixture, the "?" switch -> Supply 5, the Raw Data flag flow "unknown 2", the plan's spent 0, the popup's
  chips, the sales chip + a flag / unflag on a sale, the Flags popup's 49 heads with Flag / State / Note, marks through
  "Open Review" and directly, the card verdict options, "pc fine" keeping the badge), test_ui10 / 13 / 14 / 15 ported
  to the two new columns (Forecast % index 35, Planning cells shifted by 2, td.cardc). Deployed 2026-10-25 ~18:45 UTC
  through the editor in dependency order (ebay_sweep.py 0179b004 and forecast_math.py 4e5a4fbc BEFORE collector.py
  46630d94; then style.css 668fbdf6, body.html 644f94fd, help.js 67a9e573, app.js d6b04933). Stage 2 (next): the
  phone's Q1 condition row + "No" -> reason + note -> flag_mark, Q2 one condition's figures (red over the max, still
  clickable), hit vs forecast hit details, a test alert; auctions under the Supply cell ("3 (up to $X) auction",
  visibility and alerts only, no effect on the figures); the automatic PC-inaccuracy detector (a measurement pass over
  PriceCharting's posted sales first); more Forecast filters.
- THE PHONE'S CHECK SCREEN TALKS BACK WITH REASONS; THE PUSH IN THE BACKGROUND (2026-10-25 evening, round 3 stage 2a;
  Brett: "if it asks is this the same card, and i select 'no', then a popup will appear and i select the reason why,
  and provide a text response, that is saved and archived ... question 1 ask for the condition ... if i select LP,
  then go to second question, i want it to only show the lightly played max bid, profit, roi ... if changing the
  condition ... causes bid to be over your max, then the light played should appear as the color red instead of
  color green. Even if it is red, i would still like it to be clickable ... question 2 should specify if it is a hit
  or forecast hit. If it is a forecast hit, then the 1 3 and 6 month holds should be specified, as well as the other
  input variables. I would also like the hits, to have variables such as confidence and margin ... Please send ntfy
  test example to phone so that i can confirm"). page/hit.html: Q1 carries the condition row (NM / LP / MP / HP / DMG,
  button.cb; a tap tells nm / lp / mp / hp / dmg at once and pre-selects from d.bc); No opens the reason panel
  (#nopanel: set mismatch / name mismatch / condition / fraud / unknown, a note, Send -> tell({d: 'no', st, note}),
  Cancel); Yes -> Q2. Q2: "The numbers" + the kind badge (Hit / Forecast hit when d.fc.on / Lead / Auction / Test),
  the condition row again (synced), ONE figure block for the chosen grade (figBtn: green .yes = a buy, red .over =
  over the max buy or under the ROI, both open the listing through go(); MP / HP / DMG = .nobuy "Not a buy at this
  grade" with "Open the listing anyway"; no grade yet = both NM and LP), "How the max buy is computed" (#how: the sell
  level for the grade, the anchor + fast-sale median, the floor other than this copy, confidence within the window,
  the rate and sell-through, margin, fees, all-in vs the max), the Forecast section (#fcb, when d.fc: the filter's
  state, a table of the 1 / 3 / 6-month chance of a profit at this price + the card's rank + expected move, the
  projected sale and why, the standard price and 12-month mean, model month, market, fees). tell() takes an object.
  Collector: PHONE_GRADES / PHONE_ANSWERS; the dec handler takes st + note with a No -> flag_mark (a mismatch reason is
  the old "not the same card", fraud marks the seller, the rest flag the listing), an old plain No keeps the old
  note_wrong path, the side effects run once per listing even when it sits in two histories; hit_payload adds conf,
  win, L (the floor other than this copy), af, lpd, fee [pct, fixed], lam, stt; forecast_block(cards, cfg, cid, total,
  iid) = {h, on, bar, q{1,3,6}, pct{}, pred{}, sell, why, comp, std, m12, month, reg, fees} rides as d["fc"] on hit and
  auction alerts (the auction's at the max bid + shipping); test_hit(state, cat, cards) sends a sample check screen
  with the test alert on the best-looking open listing (a PASS, else a LEAD, else the cheapest judged copy; never
  watch / suspect / um / fl), d["test"] = 1, logged kind "test-hit" and never counted as the listing's alert. The
  Alerts tab names the new answers (ans: mp / hp / dmg, "No (the reason is on its flag)"); help: the test alert's
  sample. THE PUSH: since 12:56 UTC every other push to the live branch timed out at 120 s (88 "Publish failed" in six
  hours, each stalling the loop two minutes; the live file was 5-25 min stale). publish() now writes and commits,
  then push_live() force-pushes in a daemon thread (PUSH_TIMEOUT_S 600); a publish under a running push is skipped
  (the next carries everything); slow pushes (> 90 s) and skips are logged every 30 min at most with the size; git()
  takes a timeout; the repo sweep never runs under a push. fc_rows.bin doubled with the sales behind the anchors
  (864 -> 1,832 KB every 10 min) - watch the push log line. Tests: t/hit/test_cond.py rewritten (the condition row,
  Q2 with no grade / LP red but a link / MP not a buy, the forecast hit's badge, table and inputs, No -> fraud with
  a note -> {d, st, note}, name mismatch -> "Rejected", Cancel), ut/test_phone.py (the dec stream through a fake poll:
  fraud / name mismatch / an old No / hp + dmg / a wrong token; the payload's inputs; forecast_block on a tiny model
  file; test_hit's pick, link, log entry and its skipping of flagged copies), ut/test_push.py. Deployed 2026-10-25
  ~19:25 UTC: collector.py 894e4a59 then fb656e2a (the push), hit.html 9e122544, app.js 9429782c, help.js 9e062c61;
  site build #133.
- AUCTIONS UNDER SUPPLY, FORECAST AUCTION ALERTS, THE AUTOMATIC PC INACCURACY, THE FORECAST FILTERS (2026-10-25 evening,
  round 3 stages 2b-2d; Brett: "there is an at your price, but maybe should another option for at your price auction
  ... 3 (up to $91.61) auction underneath it ... auctions shouldnt affect forecast numbers or modeling, its really
  just there for visibility and alerts ... forecast auction hits should alert my phone as well"; "when you open
  price chart for a card, you see that there are many listings with radically different values ... measure the
  variance ... set a threshold ... automatically gets flagged ... PC Inaccuracy"; "I would prefer to have some more
  filters in the forecast tab"). (1) AUCTIONS: collector.auction_supply every AUCTION_SUPPLY_EVERY_S = 1200 reads up
  to AUCTION_SUPPLY_PAGES = 4 pages (800) of raw-single auctions ending soonest (the trial's search, one call a
  page), matches each title to a card (MP / HP titles and flagged ids out) -> state["au_open"] = {t, until, read,
  rows}; au_open_live publishes the running ones as live.au_open rows [id, card, bid, ship, bids, end, title, url,
  tcond, fb, pct, photos, img]. Page: auByCard() (ended / flagged out; AU_BY_CARD reset on every live file and flag),
  fcAuctionsAt(cid, price, sup) on the Supply switches' conditions and seller bar; fcCompute rows carry au = {n, dear,
  soon}; the Supply cell's second line "N (up to $X) auctions" (span.fc-au, the tooltip explains); the summary's
  fc-aunote (how many, the read's size and time); the popup's "Auctions N . K at your price" chip (mode 'au', not
  persisted; fclAuRender draws #fcl-au above the hidden main table: ends in, Flag / State, bid, + ship, bids,
  condition, seller, photos, title; green = at your price; flagCells so an auction can be flagged - collector.au_rec
  builds its record for flag_mark). Nothing enters Supply, the odds or the plan. FORECAST AUCTION ALERTS:
  forecast_auction(cards, cfg, cid, bid, ship, iid) = the card's standard buy price T (forecast_math.levels: the
  floor, else the anchor, else PriceCharting; the plan's universe: $50-500, 6 PC sales a year, 2 years old), bid +
  ship <= T, the chance at T for the Alerts tab's hold at or over its bar (fc_minp) -> {T, p, h, sell, why, nm, lp}
  with [sell, T, net - T, ROI, max bid = (T - ship) / (1 + tax)] on the Forecast fee arithmetic (the LP side at the
  LP discount). auction_alerts: the gate's hits / leads first; what they do not qualify, and cards only the model
  prices (basis "fc"), go through forecast_auction -> kind "fcau", title "Forecast auction ends in N min . bid up to
  $X", kd "auction-forecast" (the page labels it ", forecast"), d["kd"] = "fcau" on the check screen ("Auction .
  forecast" badge, the max bid's basis named). hit_payload's side() returns blanks for a card without gate numbers;
  auction_finish prices a forecast auction's close against the max bid it was sent with. NOTE: at the standard price
  the chance is usually ~35% (buy = sell = the floor, the model's expected move alone), so with the default 50% bar
  few auctions qualify - the bar is the Alerts tab's; lower it there for more. (2) THE AUTOMATIC PC INACCURACY:
  pchist.sales_table(html) parses the card page's "Ungraded Sold Listings" table (div.completed-auctions-used >
  table > tr#ebay-N: td.date YYYY-MM-DD, td.image, td.title "[eBay] <a>TITLE</a>", td.numeric > span.js-price
  "$482.81", td.numeric.listed-price, td.thumb-down - the structure read from a live page in Brett's Chrome on
  2026-10-25; the page is server-rendered, so the worker's existing read carries it); pchist.spread(sales) over the
  sales of the last SPREAD_WINDOW_D = 90 days (SPREAD_MIN_N = 6): {n, med (cents), iqr = (q3 - q1) / median, out =
  the share outside 60-140% of the median, lo, hi, d}; extract() keeps "sl" (the last SALES_KEEP = 20 [date, cents,
  title]) and "sp" on the record (the data disk); publish_files drops "sl" from the published shard (the push is
  heavy enough), keeps "sp"; spreads_all() reads every shard. collector.pc_spread_tick every PC_SPREAD_EVERY_S = 6 h:
  a card with iqr >= PC_SPREAD_BAR (0.5 at first, 0.7 since 2026-10-26) gets gap_marks[cid] = {state "pc inaccuracy", auto 1, sp [n, iqr, med], note
  "PriceCharting's last N ungraded sales (90 days) spread +-X% around $M ($lo to $hi)...", t refreshed} - released
  from the gap hold and its per-listing PriceCharting rule down (PC_WRONG_STATES) -, withdrawn when it falls under
  the bar or the spread leaves the file; a verdict Brett gave by hand (no auto) is never touched; the distribution
  is logged each pass ("PC spread: N cards measured; iqr/median p50 .. p95; K at or over the 0.7 bar") - THE BAR WAS
  TUNED 0.5 -> 0.7 on 2026-10-26 (the scheduled check after a day of reads): 766 cards judged, iqr/median p50 0.43 /
  p75 0.65 / p90 0.85 / p95 0.99, so 0.5 flagged 43%. Checked against the collector's own eBay sold anchor (205 cards
  with 5+ comparable sales): the share 25%+ apart from PriceCharting rises with the spread (<0.3: 2%, 0.3-0.5: ~15%,
  0.5-0.6: 17%, 0.6-0.8: 32%, 0.8+: 40%; Spearman 0.39), but many wide-spread cards are vintage WOTC holos whose
  posted "ungraded" sales mix played and near-mint copies while PriceCharting's price equals eBay's anchor (Base Set
  Blastoise iqr 0.77, PC $103.99 vs anchor $104.40 on 91 sales; Team Rocket Dark Charizard 0.75, $219.99 vs $213.00).
  0.7 flags ~20% (153 of 766), 43% of the flagged eBay-anchored cards sit 25%+ from the anchor (28% at 0.5), and it
  still releases 5 of the 15 cards 30%+ apart (8 at 0.5; the other gap cards stay held for review in Flags, which is
  what a hold is for), while the per-listing PriceCharting rule stays on for twice as many cards. The measure's
  blind spot, not fixed by any bar: PriceCharting LAGGING a fast mover (research E33c) - of the 7 cards 30%+ apart that
  even 0.5 missed, 4 are 30th Celebration cards with tight posted sales and an eBay anchor 34-67% above PC (a new
  set rising faster than PC's 90-day window); a lag measure (PC's price vs the median of its own last ~30 days of
  posted sales, from the "sl" kept on the data disk) would catch those. The pages are re-read weekly for active cards,
  monthly otherwise, so the measure keeps filling in. live.alert.gap_marks carry auto + sp. Page: fgHeld lists
  the automatic verdicts apart (div.fgauto: "PriceCharting unreliable for N cards (automatic)", each with "+-X%
  around $M on n sales", widest first, 12 then "+ N more"; they are not "released" rows); the Forecast row's price
  cell says "PC unreliable" (span.fc-pcbad) with the figures. (3) THE FORECAST FILTERS (#fc-filt above the picks,
  FC_F in localStorage fc-filt): set / rarity / finish selects (fcFiltOptions fills them from the scored cards after
  the model loads), the four rank buckets, "a copy at my price" (Supply >= 1), "an auction at my price", "not held",
  "PriceCharting trusted" (no automatic verdict), floors on PC sales / yr (vol12) and eBay sales / 30 d (c.k); they
  narrow the candidates IN fcCompute (FC.filtered counts the cards left out; the summary's fc-filtnote), so the plan
  follows; Reset. Help: fc_supply (the auction line), al_fc (forecast auctions), fg (the automatic verdict), fc_filt.
  Tests: ut/test_auctions.py (auction_supply's pages / matches / flagged ids, au_open_live, forecast_auction's
  qualification and figures, a flag on an auction), ut/test_pcsales.py (the parser on the page structure, spread,
  extract, the published shard without "sl", spreads_all, pc_spread_tick's verdicts / his verdict kept / withdrawal /
  the release and the PC rule), t/pcpop/test_ui19.py (the Supply line, the n/s switch, the summary note, the popup's
  Auctions chip and table, a flag from it, the automatic verdict's word and list, the filters: options, set, not
  held, PC trusted, a bucket, remembered across a reload, Reset, auction, eBay sales), t/hit/test_cond.py. Deployed
  2026-10-25: ~20:00 UTC collector.py 42dd4393 (the auctions; its first read at 19:54 found 585 open auctions on
  known cards among the 800 ending soonest, published as live.au_open) then the page (app.js 43941d6d, style.css
  483c9198, help.js 8ac936a4, hit.html 2d0d0666; site build #134); ~20:25 UTC pchist.py b8240911 (9f2ee3e) BEFORE
  collector.py 827b7b8e (0ea7a59; the droplet restarted on both at 20:24:37 - the unit's ExecStartPre pull took the
  second commit made 20 s earlier), then the page (app.js a387247b, body.html e0b79981, style.css e5fbc3a0, help.js
  3b2b9211; site build #135). The first "PC spread:" line comes once pages have been re-read with the new parser (the
  tick at start found no spread on file; the next is 6 h later). The push after the fix: 91 s for 25.7 MB, no timeouts.
  FIRST LOOK (21:25 UTC, the shards decrypted locally - the key from the password in an env var, never a file): 13 of
  the ~52 pages read since the restart carried a spread (the parser works on the worker's pages; no "sl" leaked), but
  the widest were penny cards (a $0.06 card: 36 sales from $0.01 to $2.13, iqr/median 4.4 - eBay's price steps, not
  PriceCharting's error). So PC_SPREAD_MIN_MED = 1000 (cents): a card whose median sale is under $10 is never judged
  (an earlier automatic verdict on it is withdrawn) and the distribution line counts the cards from $10 only, naming
  the cheaper ones left out; the Flags note and help say "cards from $10". Deployed ~22:13 UTC: collector.py c2049b5e,
  app.js 8035ae29, help.js b52888dc (site build #136). The bar itself (0.5) is still to be judged from the log line.
  Round 3 is complete bar the bar-tuning note above.
- THE CARD POPUP'S BUTTONS AND ITS STAR (2026-10-25, Brett: "In the popup for forecast button and planning button in forecast
  tab, the four buttons do not work: reset, reset columns, columns, and filters ... the review button does not work. The
  trend button works. The book button does not work. Also, the star favorites button works ... however in the favorites
  tab, it gets stored as ebay raw data, when it should be stored in the forecast"). (1) Review, Book, Columns and
  Filters all open #bov, which comes BEFORE #lov in the DOM at the same z-index (50), so they opened BEHIND the popup
  (Trend uses #ov, after #lov: it worked). `#lov { z-index:45 }`. (2) openReview also finds a popup row (FCL.rows) and
  its compact row for the photos in live.plan.rows / fc_rows.bin, so Review works for a copy the 24-hour table does not
  carry; rebuildLive refreshes an open popup (a Review answered, a copy sold). The popup has no filter chips, so its
  "Filters..." button is removed after makeTable; "Reset" (the search box) and "Reset columns" were working. (3) A new
  favorite kind, fl = a listing starred on the Forecast tab: FCL_TABLE.fav = {s: 'fl', k: item id, c: card id, m:
  favMetaFl} and the Planning view's star use it; favMetaFl keeps the words (ti, u, p) plus h (the hold), c (the chance
  at its price), lo / med / hi (the net per copy) and sell (the level the sale is projected from) at that moment. The
  Favorites tab counts fl under the Forecast chip (fvCounts), the Forecast view shows "Listings starred on the Forecast
  tab" above the cards (fvRenderFl: the figures then, and Now = status + the chance at the current hold, via flRowOf =
  the 24-hour row / live.favs.rows / live.plan.rows / fc_rows.bin), the All view's note says "from: Forecast · N
  listings"; the Raw Data view does not list them. Collector: FAV_SRC accepts fl, fav_live builds a row for an fl star
  past the 24-hour table like an er star, ebay_sweep.fav_listing_ids keeps it from the prune. Help: fav, the Forecast
  README's popup paragraph, the Favorites README's Forecast view. Deployed 2026-10-25 ~00:35 UTC (ebay_sweep.py
  08328562, collector.py ba1ee177, style.css fa18c77c, help.js b12de7c0, app.js f03a1e5f), site build #126. Tests:
  t/pcpop/test_ui16.py (the z-order, Columns... from the popup, Reset / Reset columns, no Filters..., Book with the row
  marked, Review for X1 and for L1 (fc_rows.bin only), the star's fl message with the figures from the popup and from
  the plan, the Favorites chips (Forecast 2, Raw Data 0), the Forecast view's listing rows, the All view's note, the
  live confirmation with the collector's row), ut/test_fav.py (an fl star: the live block's list and row, the prune).
- THE INPUTS CARD FOLDS AWAY (2026-10-24 late, Brett: "have the your plans variable pane, on the left ... collapsible,
  so that the other side ... will enlarge, so that way, i dont have to right scroll to the right to see all of the
  column. do this for both the planning and forcast buttons"). "Hide" (button.fc-fold, #fc-fold) in the header of the
  inputs card (#fc-side, the left column of #fc-al) sets FC.fold (localStorage fc-fold): .al.fc.folded makes the grid
  one column and hides #fc-side, so #fc-main (Forecasting) or #fc-plan (Planning) takes the whole width - at 1440 px
  the Planning table fits with no sideways scroll (t/pcpop/test_ui15.py measures scrollWidth == clientWidth); the bar
  shows "Inputs" (#fc-unfold, hidden otherwise) with the settings in a few words ("$1,000 · 3 mo · 20% under",
  refreshed by fcCompute) to bring the card back. Help: fc_modes and the Forecast README. Deployed 2026-10-25 ~00:05
  UTC (body.html f2cc7e73, style.css 840b306a, app.js 7a8151bc, help.js fb167c9d), site build #125.
- THE FORECAST HISTORY TAB'S TWO FREE VARIABLES (2026-10-24 late, Brett: "would it be possible to have this as a variable
  ['Bought 20% under'] ... also if it possible to have the investment, as well as the bought under, as a variable").
  forecast_hist.py FORMAT 2: besides the 30 standard cells, every month carries its INGREDIENTS - cards {id, buy, pct,
  sup, y1, y3, y6} (the candidate cards of the plan: in the band, vol12 >= 6, age >= 24 - MIN_AGE - in ascending id;
  the buy to the cent, the rank to four decimals, the realized return per hold to four decimals or null) and tables
  {"h|bucket", "h|all"} (the month's chance tables for its regime) - plus format, m_last, free {cap [100, 1000000], disc
  [0, 0.6]} and consts.quantiles / min_vol12 / min_age / p_cap / rho; the standard cells are computed from the SAME
  rounded figures (20 of 1,740 cells changed picks against the unrounded run, the biggest by $234 of expected net), so
  the page's recomputation of a standard cell equals the file's. The file grew from 149 KB to 879 KB (47,027 candidate
  card-months); the tab fetches it once an hour. Page (app.js, the Forecast History block): FH.cap and FH.disc are any
  number (fhSet clamps to FH_FREE, localStorage fh-cap / fh-disc); two boxes (#fh-cap, #fh-disc, label.fh-in, on
  'change' - every keystroke would rerun 170 plans) beside the chips, which are presets now; with a format-2 file
  (fhFree) every cell is the page's own: fhPlan = forecast_math.plan on the month's ingredients (fcDist at the buy less
  the discount, sell = buy; the buy order by fhRound = Python's half-to-even round of p x 100, then the rank; the
  greedy allocation under share 0.2, one copy, the supply cap, the money left; a 'down' month buys nothing with the
  gate), fhCompute = the cell (fcMonteCarlo with the file's mc_n 2000 - fcCdf / fcDraw / fcDist now take fcQs(): the
  model file's quantiles, else FC_QS, the standard 5..95 grid, so the tab runs without forecast.bin -, fhActual when
  the hold is up (m + h <= m_last), the forced plan of a month with no buys), cached per "cap|disc" (12 settings, then
  cleared), run a few cells at a time between frames by fhRun with a "Running the plans for $X, bought Y% under... n of
  174" line (a $25,000 20%-under run is ~3.5 s of arithmetic; a box being typed in survives the redraw; FH.committing
  skips that on a commit so a clamped value shows). An older (format-1) file still works: the chips only, the boxes
  hidden, the settings snapped to the nearest standard. The live half (the collector's archive) exists only at the
  standard settings, so it shows the nearest archived capital (ties to the lower) and discount (>= 10% -> 20%) and says
  so. Help: the fh README (the boxes, how the page runs the replay, the nearest note), fh_replay, fh_live. Deployed
  2026-10-24 ~23:40 UTC (forecast_hist.py 2f589f79, style.css b8ca283c, help.js 162d946f, app.js 479e57a3); Forecast
  history run #3 (3m 36s, the format-2 file on the snapshots release), site build #124. Tests: t/pcpop/test_fh2.py
  (every standard preset's 174 cells equal the file's Python cells - picks, spent, expected / range / chance, actual /
  ROI / inside, the forced figures; a custom $3,000 / 15% cell against forecast_math on the same ingredients; the
  boxes, the clamp, the progress line, typing during a run, the nearest-archive note, README and help), test_ui12
  ported (the format-2 fixture t/fh2_local.json from a local run of forecast_hist.py on fc/data/hist.json; waits for
  the run). The local replay: `cd cur && SITE_PASSWORD=<any> python3 forecast_hist.py --hist-json
  /tmp/claude-0/fc/data/hist.json --catalog /tmp/claude-0/fc/data/catalog.csv --calib forecast_calib.json --out
  /tmp/claude-0/t/fh2_local.bin` (~3 minutes), decrypted with forecast.decrypt_live(blob, <the same password>).
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
- THE DATA FOLDER, ROUND 2: GRADED DATA (2026-10-26, Brett: "could you add all of that data [the PriceCharting CSV columns the
  site does not use] to the /data file on github, as well as the 'grading' opportunity heat map data, as well as the graded
  index graph data from pokeviews? along with a description of what it so that you know, for when we analyze the data in
  the future ... dont add the data to the website though"). Nothing on the site changed. (1) POKEVIEWS: six more feeds in
  data_archive.FEEDS, found the old way (performance.getEntriesByType('resource') on pokeviews.com/graded_index and
  /grading_opportunity in his Chrome): graded_index/graded_index(.json.gz) (Top 250 Graded, PSA 10, daily from
  2022-01-01, index base 100, change_*_pct in PERCENT) + _constituents_table (250) + _series_composition;
  graded_index_by_era/graded_index_by_era (4 eras x daily; returns are FRACTIONS) + _constituents_table (200);
  grading/grading_opportunity (the 96-cell heatmap: raw_price_bucket x ratio_bucket, one card each, ungraded and PSA 10
  price, ratio, grading_profit = psa10 - raw - $25, annual PSA 10 sales, date). The heatmap feed only ever holds today,
  so SNAPSHOT_FEEDS + keep_history() add each run's rows to pokeviews/grading_opportunity_history.csv (the same day
  replaced, registered in the manifest so the stale-file sweep keeps it). Checked against the page: era ranks 1647.53 /
  890.70 / 838.71 / 566.57, Top 250 Graded 673.78, 30-day returns = return_30d x 100; the heatmap's prices equal that
  day's snapshot loose-price / manual-only-price. (2) PRICECHARTING, EVERY COLUMN: pc_daily() writes
  data/pricecharting/daily/ from the pc_catalog snapshots (2026-09-28 on): full_<date>.csv.gz on each month's first
  snapshot day (every column of the download, prices in dollars; ~1.6 MB), changes_<date>.csv.gz otherwise (date,
  card_id, status changed / new / removed, the card's 18 numbers; 5-13K cards a day, ~0.25 MB). Columns for a card
  (PriceCharting's API mapping): loose = ungraded, cib = 7/7.5, new = 8/8.5, graded = 9, box-only = 9.5, manual-only =
  PSA 10, bgs-10, condition-17 = CGC 10, condition-18 = SGC 10, retail-{loose,cib,new}-{buy,sell} = PriceCharting's
  suggested dealer buy / sell, sales-volume; gamestop-*, upc, asin, epid always empty. Growth ~9 MB a month (~110 MB a
  year, beside the eBay files' ~140) - watch it. The workflow's snapshot step now downloads the newest snapshot + the last
  archived day's + every later day (all 29 on the first run). Checked locally on all 29 snapshots: full + changes
  rebuild every day exactly (README's pc_day()). data/README.md describes every new file and column and carries
  PokeViews' own text for the Graded Indexes and Grading Opportunity (Brett pasted it). Deployed 2026-10-26 ~21:00 UTC:
  data_archive.py 2cdc2adc, .github/workflows/data_archive.yml 146ce7ec, data/README.md 7218f3ba. Data archive run #5
  (dispatch, daily mode, 1 min 28 s) committed 547cae1: all 29 daily files (byte-identical to the local run that was
  checked), the six feeds (graded_index 1,759 rows, graded_index_by_era 7,036, heatmap 96 + its history from 2026-10-25).
- THE GRADED DATA ON THE CARD PAGES (2026-10-26/27, Brett: "So how did Poke Views get the grading index ... are you sure
  there's no other sources ... to get PSA or CGC data" -> "Yes, please do"). PokeViews' graded indexes are PriceCharting's
  PSA 10 prices (their methodology: "non-PSA graded cards" excluded, "based on PriceCharting data"). What a card page
  carries, read in Brett's Chrome on 2026-10-26 (Base Set Charizard 630417, Mega Charizard X ex 11069001): chart_data =
  {used, cib, new, graded, boxonly, manualonly} monthly lines (ungraded, 7, 8, 9, 9.5, PSA 10; 71 points); volume_data =
  {volume: [...]} ONE series - the bars are every grade summed, there are NO per-grade monthly counts; VGPC.pop_data =
  {"psa": [grade 1..10], "cgc": [grade 1..10]} (the population report; also on anonymous reads); and a sold-listings
  table per grade: select#completed-auctions-condition options "completed-auctions-<key>" -> "PSA 10 (30)" (keys: used
  = Ungraded (up to 60: 30 eBay + 30 TCGplayer), manual-only = PSA 10, grade-seventeen = CGC 10, grade-nineteen = CGC 10
  Prist., loose-and-box = BGS 10, grade-twenty = BGS 10 Black, grade-eighteen = SGC 10, grade-twenty-one = TAG 10,
  grade-twenty-two = ACE 10, box-only = Grade 9.5, graded = 9, new = 8, cib = 7, grade-six .. grade-three,
  box-and-manual = 2, loose-and-manual = 1), each div class="completed-auctions-<key>" style=... > table.hoverable-rows
  > tbody > tr id="<source>-<id>" (ebay / goldin / pwcc / heritage / tcgplayer): td.date, td.image, td.title, td.numeric
  (a best offer: span.js-price title="best offer accepted price" first, then the list price), td.numeric.listed-price,
  td.thumb-down. AT MOST 30 ROWS PER GRADE: the hot card's PSA 10 table spanned 1 day, its CGC 10 two months. Titles name
  the grader for the blended grade tables (all but 2 of 318 rows); some rows are filed under the wrong card (a
  Celebrations Classic Collection reprint in the original Charizard's CGC 10 table) - filter on titles. PriceCharting's
  download's non-PSA 10 prices are mostly FORMULAS (2026-10-26, 21,342 cards with PSA 10 >= $50): BGS 10 = 1.30 x PSA 10
  for 97%, SGC 10 = 0.60 x for 93%, CGC 10 = 0.40 x for 50%. THE COLLECTOR NOW KEEPS IT (pchist, same page read, no eBay
  call): extract() adds rec["g"] = {g7, g8, g9, g95, psa10} (cents per month on the record's months, a line with no price
  left out; graded_series), rec["pop"] (pop_report), the graded sold listings (graded_tables: the 10s with the grader
  from the label - "10P" = CGC 10 Pristine, "10B" = BGS 10 Black - and grades 7/8/9/9.5 with the grader read off the title
  (grader_of: PSA CGC BGS/BECKETT SGC TAG ACE AGS PCG ...); grades under GS_MIN_GRADE 7 skipped; rows [row id, date, cents,
  grade, grader, best offer, title70]), rec["gv"] = GRADED_VERSION 1 and rec["gdue"] = graded_due(): a full (30-row) table
  spanning under ~10 days asks for the next read after 70% of its span (1-6 days; stale() takes min(normal refresh,
  gdue)). file() -> keep_graded(): merges the sales with the card's file in <store>/gs/<card id % 1000>.json.gz (dedupe by
  row id, newest first, GS_KEEP_D 400 days, GS_KEEP_N 1,500), queues the rows not seen before (_gq + pcg_queue.jsonl,
  reloaded at start); a read without the graded parse keeps the old graded fields. pc_plan asks stale(want_graded=True):
  every record without gv is re-read once - a full pass over the ~44,000 pages at one page every 2 s (~1 day from
  2026-10-27). PUBLISHING: pc/<shard>.bin (the page's) is unchanged (PAGE_DROP keeps sl / gs / g / pop / gv / gdue off it);
  the graded lines + population go out as pcgh/<shard>.bin ({m0, g, pop, t} per card with any; publish_graded_hist,
  every PCGH_PUBLISH_S = 6 h - not with the 10-minute shard publish, which would push ~20 MB every ten minutes during the
  pass); the new sales go out as pcg/<YYYYmmdd-HHMMSS>.bin chunks ({cols: GS_COLS, rows}) written straight into the live
  checkout by write_graded_chunk (the next publish commits them; chunks older than PCG_KEEP_D 10 days dropped). Log:
  "PriceCharting graded: ..." hourly (pchist.graded_summary: cards read with the graded parser, re-read early, today's
  new graded sales by grade, queue) and on each chunk. THE ARCHIVE: data_archive.pc_graded (daily, after pc_daily):
  pcg chunks -> data/pricecharting/graded_sales/graded_sales_<YYYY-MM>.csv.gz by sale month (card_id, date, grade, grader,
  price, best_offer, source, row_id, title; dedupe on card_id + row_id); pcgh -> pop/pop_<YYYY-MM>.csv.gz (card_id,
  read_date, psa_1..10, cgc_1..10; the month's file rewritten daily); full runs -> pc_graded_monthly_<year>.csv.gz
  (card_id, month, grade_7, grade_8, grade_9, grade_9_5, psa_10). The workflow fetch step adds pcg / pcgh when the live
  branch has them. data/README.md documents all three and the formula finding. COUNTS UNDERCOUNT BUSY GRADES (30 rows
  per table between reads); prices are fine. NEXT (promised to Brett): once the pass is through, run the archive with
  full = true and test the Forecast's ranking / chance table / reinvesting simulation on PSA 10 and grade 9 history
  (data/research, round 3) - does it pick slabs that beat the graded average? Tests: ut/test_graded.py (a page built on
  the live structure: tables, best offer, Goldin / PWCC / Heritage rows, labels, pop, series, due, merge / dedupe /
  retention / queue / restart, stale, pcgh, chunk), ut/test_archive_graded.py.
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
