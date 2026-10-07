"""
collector.py  -  the always-on version of the eBay collector, for a small Linux machine.

It reuses the matching, scoring and statistics in ebay_sweep.py but replaces the 15-minute
GitHub Actions cycle (sweep / presence walk / scheduled getItem checks) with a loop:

  every 60 s     DISCOVERY   newest raw Pokemon singles (one page; a second only in a burst);
                             the keyword backup query every 5 min
  hourly / 6 h / daily  RE-READS   listings that started in a given hour are read again with the
                             search endpoint (200 per call, itemStartDate window, $35-500 band);
                             a known listing missing from its window has probably sold
  as they appear CONFIRM     one getItem per vanished listing: sold vs ended, when, at what price
  every 48 h     BOOK CHECK  the 3 cheapest open copies of every priced card are re-verified,
                             so a sold copy cannot sit in the book as a phantom
  as they appear ID CHECK    a listing that clears the price gate has its item specifics read (one
                             getItem) and compared with the matched card, ahead of all other optional work
  every cycle    STATS       the per-card numbers, the live file for the site
  every 2 min    PUBLISH     live/ebay_live.bin + collector.log (+ hourly state backup) are
                             force-pushed to the one-commit "live" branch with a deploy key
  hourly         LIMIT       eBay's own remaining-calls figure is read (Developer Analytics);
                             all optional work is paced from it, discovery is reserved first
  every 5 min    UPDATE      the repo is pulled; if the code changed the process exits and
                             systemd restarts it on the new version

State lives in data/ebay_state.json.gz.enc on the machine (same format as the Actions version,
so the release copy can seed it). Secrets come from /etc/pokemon-collector.env via systemd.
Run with --dry-run to exercise the loop on the fixtures with no network and no git.
"""
import base64
import gzip
import hashlib
import hmac
import io
import json
import math
import os
import re
import statistics
import subprocess
import sys
import time
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

import ebay_sweep as es
import account

# ---------------- layout ----------------
BASE = os.environ.get("COLLECTOR_HOME", "/opt/pokemon-collector")
REPO = os.path.join(BASE, "repo")
DATA = os.path.join(BASE, "data")
LIVE_DIR = os.path.join(DATA, "live")                 # one-commit checkout of the "live" branch
STATE_PATH = os.path.join(DATA, es.STATE_NAME)
LOG_PATH = os.path.join(DATA, "collector.log")
CATALOG_CACHE = os.path.join(DATA, "catalog.csv.gz")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "BrettS600/biotech-catelog")
# release assets by direct link: the REST API allows only 60 unsigned requests an hour per machine (a restart
# loop burned through that on day one); the download links have no such limit
RELEASE_DL = f"https://github.com/{GITHUB_REPO}/releases/download/{es.RELEASE_TAG}/"
PUSH_REMOTE = f"git@github.com:{GITHUB_REPO}.git"
SSH_KEY = os.path.join(BASE, ".ssh", "id_ed25519")
KNOWN_HOSTS = os.path.join(BASE, ".ssh", "known_hosts")

# ---------------- cadence ----------------
CYCLE_S = 60
KW_EVERY_S = 600
PUBLISH_EVERY_S = 120
CODE_CHECK_EVERY_S = 300
STATE_BACKUP_EVERY_S = 3600
CATALOG_EVERY_S = 6 * 3600
RATELIMIT_EVERY_S = 3600
ENRICH_EVERY_S = 300
SUMMARY_EVERY_S = 3600
SWEEP_OVERLAP_MIN = 5            # a page covers ~15 min of listings; sweeping every minute, 5 is plenty

# ---------------- outcome detection ----------------
REREAD_BAND = (40, 500)          # listing price band that gets re-read (cheap copies of pricey cards are
                                 # caught by the book check instead)
REREAD_MAX_AGE_D = 2.5           # the 2-day rule (es.FOLLOW_D): a listing is followed for its first 2 days. The half
                                 # day on top guarantees one more read after the 48-hour mark, which is what proves
                                 # a listing outlived the window (or catches a sale at hour 47)
REREAD_CADENCE = [(1.0, 3 * 3600), (float(REREAD_MAX_AGE_D), 6 * 3600)]   # (age <= days, every s)
# a one-hour window holds ~450 in-band listings (3 pages); day-1 windows every three hours, then every six to day
# 2.5. Until 2026-10-06 they ran daily to day 10: 760 calls a day, and 3,270 vanished listings a day to look up
# with room for 1,370
WINDOW_SETTLE_S = 1800           # a window is re-read only once it has been closed this long (indexing lag ~4 min,
                                 # with a long tail): re-reading the current hour flags listings not indexed yet
VANISH_KEEP_D = 3                # a listing flagged as gone and still unconfirmed after this many days is dropped
                                 # (outcome unknown), so the confirmation queue cannot grow without end
CHEAP_DROP_D = 2                 # open listings under the re-read band are dropped (not closed) after this many days:
                                 # nothing would ever check them, and they only cost memory
FLAG_MAX_AGE_D = 3               # suspect flags inherited from the Actions version are kept only this fresh
REREAD_MAX_PAGES = 8
REREAD_MAX_PER_CYCLE = 6
CONFIRM_MAX_PER_CYCLE = 12
FALSE_ALARM_LIMIT = 2            # missing from its window twice while still open -> stop re-reading it
BOOK_BAND = (40, 500)            # card price band whose cheapest copies get re-verified
BOOK_RECHECK_S = 48 * 3600
BOOK_MAX_PER_CYCLE = 1
KW_CHECK_AGES_D = [1, 2]         # listings found only by the keyword query cannot be re-read: getItem instead
KW_MAX_PER_CYCLE = 2
STALE_D = 2.6                    # an open listing this old has had its last re-read: it is settled (close_stale)
RETAIN_MAX_D = 14                # ... except a card's cheapest copies, which stay in the book up to this age
SUSPECT_LAST_D = 6               # ... and suspects, which get one lookup at this age (eBay pulls scams late)
SUSPECT_MAX_PER_CYCLE = 1

# ---------------- budget ----------------
DAILY_LIMIT = 5000
SAFETY = 150                     # calls never planned into
TOKEN_CAP = 80                   # optional work can burst up to this many calls in one cycle
COST_CONFIRM, COST_BOOK, COST_KW = 1, 1, 1

# ---------------- one-off trial: can a filtered search stand in for reading item specifics one by one? ----------------
TRIAL_RUNS = 0                   # how many times aspect_trial() runs (0 = off; it ran on 2026-10-04, see CLAUDE.md)
TRIAL_EVERY_S = 12 * 3600
TRIAL_CLAIMS = [("Finish", "Reverse Holo", "reverse"), ("Features", "1st Edition", "1st"),
                ("Card Size", "Oversized", "jumbo"), ("Language", "Japanese", "japanese")]

# ---------------- phone alerts ----------------
# A hit (verdict PASS) is pushed to Brett's phone through ntfy the minute it is found. The private channel name
# lives only in /etc/pokemon-collector.env (NTFY_TOPIC=...); without it nothing is sent. Tapping the alert opens
# hit.html on the site, with everything about the hit packed into the link itself (nothing is stored anywhere).
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
NTFY_SERVER = os.environ.get("NTFY_SERVER", "https://ntfy.sh")
CHECK_PAGE = "https://bretts600.github.io/biotech-catelog/hit.html"
ALERTS_PER_HOUR = 20             # a ceiling, so a bug can never flood the phone

# ---------------- trial: do auctions end under max buy? (log only; Brett approved it on 2026-10-04) ----------------
AUCTION_TRIAL_DAYS = 4           # runs this many days from its first read, then stops by itself (0 = off)
AUCTION_EVERY_S = 600            # read the 200 auctions ending soonest this often (one search call)
AUCTION_LOOKUPS_PER_HOUR = 5     # final-price lookups: one getItem per finished auction on a card we can price. Per
                                 # hour, not per day: a daily cap was used up in the first two hours after midnight UTC,
                                 # so the first day's sample was all 8-10 PM Eastern
AUCTION_LOOKUPS_PER_CYCLE = 2

# ---------------- auction alerts: about 10 minutes before the end (Brett, 2026-10-05) ----------------
# Brett reviews the card on the check screen, then watches the listing and bids by hand in the last seconds.
AUCTION_ALERT_EVERY_S = 300      # one search this often, for the auctions that end 9 to 15 minutes from now
AUCTION_ALERT_WINDOW = (9, 15)   # minutes before the end; read every 5 minutes, each auction is seen once or twice
AUCTION_ALERT_CHECKS = 4         # item lookups per read: identity and photos of the auctions about to alert
AUCTION_ALERTS_PER_HOUR = 12     # a ceiling on auction alerts
AU_HIST_KEEP_D = 60              # the Raw Data tab's "Auctions sent to my phone" view reaches back this far

DRY_RUN = "--dry-run" in sys.argv
ONCE = "--once" in sys.argv

_log_file = None
_es_last = {}                    # last message of each kind from ebay_sweep's own log (shown hourly)


def es_quiet_log(*a):
    msg = " ".join(str(x) for x in a)
    _es_last[msg.split(":")[0]] = msg


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0)


def log(*a):
    global _log_file
    line = now_utc().strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a)
    print(line, flush=True)
    try:
        if _log_file is None:
            os.makedirs(DATA, exist_ok=True)
            _log_file = open(LOG_PATH, "a", encoding="utf-8")
        _log_file.write(line + "\n")
        _log_file.flush()
        if _log_file.tell() > 400_000:                    # keep the file small: last ~250 KB
            _log_file.close()
            data = open(LOG_PATH, "rb").read()[-250_000:]
            open(LOG_PATH, "wb").write(data[data.find(b"\n") + 1:])
            _log_file = open(LOG_PATH, "a", encoding="utf-8")
    except Exception:
        pass


def clock(state):
    """Refresh ebay_sweep's notion of 'now' for this cycle (its functions read the module globals)."""
    es.NOW = now_utc()
    es.TODAY = es.NOW.date().isoformat()
    return es.NOW


# ---------------- catalog and state ----------------
def asset_exists(name):
    r = requests.head(RELEASE_DL + name, timeout=30, allow_redirects=False)
    return r.status_code in (200, 302)


def fetch_asset(name):
    """The bytes of a release asset, or None when there is no such asset."""
    r = requests.get(RELEASE_DL + name, timeout=180, allow_redirects=True)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content


def latest_catalog_name(days_back=10):
    """The daily snapshot is pc_catalog_<date>.csv.gz.enc; the newest one is today's or a recent day's."""
    for i in range(days_back):
        name = f"pc_catalog_{(now_utc() - timedelta(days=i)).date().isoformat()}.csv.gz.enc"
        if asset_exists(name):
            return name
    return None


def load_catalog(state):
    """Newest PriceCharting snapshot from the release, cached on disk; the cache serves if GitHub is unreachable."""
    if DRY_RUN:
        df = pd.read_csv(os.path.join("fixtures", "catalog.csv"), dtype=str).fillna("")
        return es.Catalog(df), "fixtures"
    cached = state.get("vps", {}).get("catalog")
    name = None
    try:
        name = latest_catalog_name()
    except Exception as e:
        log(f"Catalog: could not check the release ({e})")
    if name and (name != cached or not os.path.exists(CATALOG_CACHE)):
        blob = fetch_asset(name)
        if blob is None:
            raise RuntimeError(f"catalog {name} vanished from the release")
        blob = es.decrypt_file_blob(blob, es.PASSWORD)
        open(CATALOG_CACHE, "wb").write(blob)
    elif os.path.exists(CATALOG_CACHE):
        name = cached or "cached"
    else:
        raise RuntimeError("no PriceCharting snapshot available (release unreachable and nothing cached)")
    df = pd.read_csv(io.BytesIO(gzip.decompress(open(CATALOG_CACHE, "rb").read())), dtype=str).fillna("")
    return es.Catalog(df), name


def load_state():
    if DRY_RUN:
        p = os.path.join("fixtures", "state.json")
        return json.load(open(p)) if os.path.exists(p) else es.empty_state()
    if os.path.exists(STATE_PATH):
        blob = open(STATE_PATH, "rb").read()
        return json.loads(gzip.decompress(es.decrypt_file_blob(blob, es.PASSWORD)).decode("utf-8"))
    # first start: seed from the release copy the Actions version kept, if there is one
    try:
        blob = fetch_asset(es.STATE_NAME)
        if blob:
            state = json.loads(gzip.decompress(es.decrypt_file_blob(blob, es.PASSWORD)).decode("utf-8"))
            log(f"State seeded from the release copy: {len(state['open'])} open, {len(state['closed'])} closed.")
            return state
        log("No saved state on the release; starting fresh.")
    except Exception as e:
        log(f"Could not seed state from the release ({e}); starting fresh.")
    return es.empty_state()


def save_state(state):
    raw = gzip.compress(json.dumps(state, separators=(",", ":")).encode("utf-8"))
    if DRY_RUN:
        return raw
    os.makedirs(DATA, exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "wb") as f:
        f.write(es.encrypt_file_blob(raw, es.PASSWORD))
    os.replace(tmp, STATE_PATH)
    return raw


# ---------------- budget ----------------
def fetch_ratelimit(state):
    """eBay's own view of the Browse API allowance (Developer Analytics). Falls back to our own count."""
    if DRY_RUN:
        return
    try:
        r = requests.get("https://api.ebay.com/developer/analytics/v1_beta/rate_limit/",
                         params={"api_context": "buy", "api_name": "browse"},
                         headers={"Authorization": "Bearer " + es.get_token()}, timeout=30)
        if r.status_code != 200:
            log(f"Rate limit: HTTP {r.status_code} from the analytics API ({r.text[:120]}) - using own count")
            return
        cands = []
        for api in r.json().get("rateLimits", []):
            for res in api.get("resources", []):
                for rate in res.get("rates", []):
                    if rate.get("limit") is not None:
                        cands.append({"name": res.get("name", ""), "limit": rate["limit"], "remaining": rate.get("remaining", 0),
                                      "reset": rate.get("reset"), "window": rate.get("timeWindow")})
        # the shared pool is the resource named buy.browse; failing that, the largest limit on offer
        shared = [c for c in cands if c["name"].endswith("buy.browse")]
        best = shared[0] if shared else (max(cands, key=lambda c: c["limit"]) if cands else None)
        if not best:
            log("Rate limit: analytics API returned no browse figures - using own count")
            return
        reset_ts = es.parse_ts(best["reset"] or "")
        state["ratelimit"] = {"limit": best["limit"], "remaining": best["remaining"], "name": best["name"],
                              "reset_ts": reset_ts.timestamp() if reset_ts else None, "fetched_ts": time.time(),
                              "window": best["window"]}
        log(f"Rate limit: {best['remaining']} of {best['limit']} calls left ({best['name']}), "
            f"resets {best['reset']}, window {best['window']} s")
    except Exception as e:
        log(f"Rate limit: could not read the analytics API ({e}) - using own count")


def allowance(state):
    """(calls remaining, seconds until they come back). From eBay's figure when we have a fresh one,
    corrected by our own calls since; otherwise from our sliding 24-hour record."""
    now = time.time()
    recent = state.get("recent_calls", [])
    rl = state.get("ratelimit") or {}
    if rl.get("reset_ts") and rl.get("fetched_ts") and rl["reset_ts"] > now and now - rl["fetched_ts"] < 2 * RATELIMIT_EVERY_S:
        since = sum(1 for t in recent if t >= rl["fetched_ts"])
        return max(0, rl["remaining"] - since), rl["reset_ts"] - now
    day_ago = now - 86400
    used = sum(1 for t in recent if t >= day_ago)
    return max(0, DAILY_LIMIT - used), 86400.0


def refill(state):
    """Token bucket for optional work. Discovery (one page a minute plus the keyword page every five)
    is reserved first; what is left over is spread evenly until the calls come back."""
    v = state.setdefault("vps", {})
    remaining, secs = allowance(state)
    mins = max(1.0, secs / 60)
    reserve = mins * (1 + 60 / KW_EVERY_S)
    spare = remaining - SAFETY - reserve
    per_min = max(0.0, spare / mins)
    v["tokens"] = min(TOKEN_CAP, v.get("tokens", 0.0) + per_min)
    v["per_min"] = round(per_min, 2)
    v["remaining"] = remaining
    return remaining


def spend(state, n):
    v = state["vps"]
    if v.get("tokens", 0.0) >= n:
        v["tokens"] -= n
        return True
    return False


# ---------------- outcome detection ----------------
def in_band(rec, band):
    t = rec.get("total")
    return t is not None and band[0] <= t <= band[1]


def rec_start(rec):
    return es.parse_ts(rec.get("created") or rec.get("origin") or rec["first"])


def bucket_of(dt):
    return dt.replace(minute=0, second=0, microsecond=0)


def cadence_for(age_d):
    for max_age, every in REREAD_CADENCE:
        if age_d <= max_age:
            return every
    return None


def due_windows(state, now):
    """Hour buckets (by listing start) that hold re-readable listings and are due, oldest-due first."""
    reads = state["vps"].setdefault("reread", {})
    counts = defaultdict(int)
    for rec in state["open"].values():
        if rec.get("src") != "aspect" or rec.get("nocheck") or not in_band(rec, REREAD_BAND):
            continue
        st = rec_start(rec)
        if st is None:
            continue
        counts[bucket_of(st).strftime("%Y-%m-%dT%H")] += 1
    due = []
    for key, n in counts.items():
        b0 = datetime.strptime(key, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
        if (now - (b0 + timedelta(hours=1))).total_seconds() < WINDOW_SETTLE_S:
            continue                                         # still filling, or not yet indexed
        age_d = (now - b0).total_seconds() / 86400
        every = cadence_for(age_d)
        if every is None:
            continue
        last = reads.get(key, 0)
        if time.time() - last >= every:
            overdue = (time.time() - last) / every if last else 1e9
            due.append((-overdue, -b0.timestamp(), last, key, n))
    due.sort()
    return [(last, key, n) for _, _, last, key, n in due]


def reread_window(state, key, n_expected):
    """Search the hour window; every known open listing in it that is not in the results is flagged."""
    b0 = datetime.strptime(key, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
    b1 = b0 + timedelta(hours=1)
    flt = f"itemStartDate:[{es.ts(b0)}..{es.ts(b1)}]"
    q = dict(es.QUERIES["aspect"])
    q["filter"] = q["filter"].replace(f"price:[{es.SWEEP_PRICE[0]}..{es.SWEEP_PRICE[1]}]",
                                      f"price:[{REREAD_BAND[0]}..{REREAD_BAND[1]}]") + "," + flt
    present, pages, total = {}, 0, None
    for page in range(REREAD_MAX_PAGES):
        if DRY_RUN:
            j = json.load(open(os.path.join("fixtures", "search.json")))
            j = j[0] if isinstance(j, list) else j
        else:
            j = es.api_get(state, "/buy/browse/v1/item_summary/search", dict(q, offset=str(page * 200)))
        pages += 1
        items = j.get("itemSummaries") or []
        total = j.get("total", total)
        for s in items:
            if s.get("itemId"):
                present[s["itemId"]] = s
        if len(items) < 200:
            break
    flagged = repriced = 0
    for iid, rec in state["open"].items():
        if rec.get("src") != "aspect" or rec.get("nocheck") or not in_band(rec, REREAD_BAND):
            continue
        st = rec_start(rec)
        if st is None or not (b0 <= st < b1):
            continue
        s = present.get(iid)
        if s is None:
            if not rec.get("vanished"):
                rec["vanished"] = es.ts(es.NOW)
                flagged += 1
        else:
            rec["vanished"] = None
            rec["seen_open"] = es.ts(es.NOW)
            price = es.money((s.get("price") or {}).get("value"))
            if price is not None and rec.get("item") is not None and abs(price - rec["item"]) >= 0.01:
                rec.setdefault("hist", []).append([es.ts(es.NOW), rec["item"], price])
                if rec["item"] is not None and price < rec["item"]:
                    state["vps"].setdefault("drops", []).append(iid)     # a price cut: may now be a hit (alert_hits)
                rec["item"], rec["total"] = price, round(price + (rec.get("ship") or 0), 2)
                repriced += 1
    state["vps"]["reread"][key] = time.time()
    return pages, len(present), flagged, repriced


def confirm(state, iid, rec, why):
    """One getItem: close the listing as sold / ended / gone, or note a false alarm."""
    if DRY_RUN:
        it = json.load(open(os.path.join("fixtures", "items.json"))).get(iid)
    else:
        try:
            it = es.api_get(state, f"/buy/browse/v1/item/{iid}", {"fieldgroups": "COMPACT"}, ok_404=True)
        except RuntimeError as e:
            log(f"Confirm: lookup failed for {iid} ({e})")
            return "error"
    rec["checked"] = es.ts(es.NOW)
    rec["checked_age"] = es.hours_between(es.parse_ts(rec["first"]), es.NOW) / 24
    if it is None:
        es.close_listing(state, iid, rec, "gone", es.NOW)
        return "gone"
    kind, price, end = es.classify(it)
    total = None if price is None else round(price + (rec.get("ship") or 0), 2)
    if kind == "sold":
        es.close_listing(state, iid, rec, "sold", end or es.NOW, total)
        return "sold"
    if kind == "ended":
        es.close_listing(state, iid, rec, "ended", end or es.NOW, total)
        return "ended"
    # still open
    rec["vanished"] = None
    rec["suspect"] = False
    if why == "vanished":
        rec["false_alarms"] = rec.get("false_alarms", 0) + 1
        if rec["false_alarms"] >= FALSE_ALARM_LIMIT:
            rec["nocheck"] = True                     # it left the query for a benign reason; stop flagging it
    sold_q = ((it.get("estimatedAvailabilities") or [{}])[0].get("estimatedSoldQuantity") or 0)
    if sold_q > rec.get("soldq", 0):                  # a multi-copy listing sold some
        origin = es.parse_ts(rec.get("origin") or rec["first"]) or es.parse_ts(rec["first"])
        for _ in range(min(3, sold_q - rec.get("soldq", 0))):
            state["closed"].append({
                "id": f"{iid}#{sold_q}", "card": rec["card"], "first": rec["first"], "origin": es.ts(origin),
                "closed": es.ts(es.NOW), "out": "sold", "total": total, "item": price, "ship": rec.get("ship"),
                "tcond": rec.get("tcond", "UNK"), "bo": rec["bo"], "pct": rec.get("pct"), "fb": rec.get("fb"),
                "hrs": round(max(0.0, es.hours_between(origin, es.NOW)), 1), "title": rec["title"], "url": rec["url"]})
        rec["soldq"] = sold_q
    if price is not None and rec.get("item") is not None and abs(price - rec["item"]) >= 0.01:
        rec.setdefault("hist", []).append([es.ts(es.NOW), rec["item"], price])
        rec["item"], rec["total"] = price, total
    rec["rev"] = it.get("sellerItemRevision")
    return "open"


def alive_until(rec):
    """The last moment this listing was seen for sale: found, re-read, or looked up and still open."""
    ts_ = [es.parse_ts(rec.get(k) or "") for k in ("first", "seen_open", "checked")]
    return max(t for t in ts_ if t is not None)


def survived(rec):
    """Seen for sale 48 hours or more after it went up: it did not sell inside the window, whatever happened next."""
    st = rec_start(rec)
    return st is not None and (alive_until(rec) - st).total_seconds() >= es.FOLLOW_D * 86400


def confirm_queue(state, cat):
    """Vanished listings in the order they are worth a lookup. There are far more of them than lookups (hundreds an
    hour against about two a minute), so the order is the policy: listings in the price band first; then the cards
    that sell the most, by PriceCharting's sales count, because only a fast-selling card can ever pass the gate
    and its sales rate is only right if nearly all of its sales are seen; newest flag first within a card.
    (PriceCharting's count is used to decide where to look, never as a number in the model.)"""
    flagged = sorted(((r["vanished"], iid) for iid, r in state["open"].items()
                      if r.get("vanished") and not survived(r)), reverse=True)   # outlived the window: no lookup

    def worth(x):
        r = state["open"][x[1]]
        return (0 if in_band(r, BOOK_BAND) else 1, -((cat.by_id.get(r["card"]) or {}).get("vol") or 0))
    flagged.sort(key=worth)                                  # a stable sort: newest flag first within a card
    return [iid for _, iid in flagged]


def rereadable(rec):
    """True when the window re-reads will notice this listing disappearing (so nothing else needs to watch it)."""
    st = rec_start(rec)
    return rec.get("src") == "aspect" and not rec.get("nocheck") and in_band(rec, REREAD_BAND) and st is not None \
        and (es.NOW - st).total_seconds() / 86400 <= REREAD_MAX_AGE_D


def book_queue(state, cards):
    """Copies that set prices and that the window re-reads cannot see (under the re-read band, found only by the
    keyword query, older than the re-reads go): the 3 cheapest open copies of every card that has an anchor, not
    checked in 48 h. Copies the re-reads do cover are confirmed through the vanished queue instead - checking them
    here as well took every spare lookup and left none for the re-reads or the confirmations (2026-10-04)."""
    out = []
    for cid, c in cards.items():
        if c.get("A_n", 0) < es.ANCHOR_MIN or c.get("price") is None or not (BOOK_BAND[0] <= c["price"] <= BOOK_BAND[1]):
            continue
        for entry in c.get("book", [])[:3]:
            rec = state["open"].get(entry[0])
            if not rec or rereadable(rec):
                continue
            if rec.get("vanished"):                          # missing from its last re-read: probably just sold
                out.append((0, entry[0]))
                continue
            last = es.parse_ts(rec.get("checked") or rec.get("seen_open") or "")
            if last is None or (es.NOW - last).total_seconds() >= BOOK_RECHECK_S:
                out.append((last.timestamp() if last else 0, entry[0]))
    out.sort()
    return [iid for _, iid in out]


def kw_queue(state):
    out = []
    for iid, rec in state["open"].items():
        if rec.get("src") != "kw":
            continue
        age_d = es.hours_between(es.parse_ts(rec["first"]), es.NOW) / 24
        nxt = next((a for a in KW_CHECK_AGES_D if a > rec.get("checked_age", 0.0) and a <= age_d), None)
        if nxt is not None:
            out.append((nxt, iid))
    out.sort()
    return [iid for _, iid in out]


def suspect_queue(state):
    """Suspects past the 2 days get one last lookup at SUSPECT_LAST_D: eBay often pulls a scam listing days after it
    went up, and the scam table is only honest if those takedowns are still seen. Oldest first."""
    out = []
    for iid, rec in state["open"].items():
        st = rec_start(rec)
        if rec.get("tier") == "suspect" and not rec.get("vanished") and not rec.get("fin") and st is not None \
                and in_band(rec, REREAD_BAND) and (es.NOW - st).total_seconds() / 86400 >= SUSPECT_LAST_D:
            out.append((st, iid))
    out.sort()
    return [iid for _, iid in out]


def close_stale(state, cards):
    """Settle every listing that is past its re-reads (the 2-day rule, see es.FOLLOW_D). No lookups are spent here.
      - flagged as vanished inside its first 2 days: left for the confirmation queue (that is where the sales are)
      - one of its card's cheapest copies (the floor-setters and the three cheapest): stays in the book up to
        RETAIN_MAX_D - on a busy card the copy that sells is often an older one that has become the cheapest, and the
        book checks keep watching these for cards that have a price
      - a suspect: waits for its one lookup at SUSPECT_LAST_D (suspect_queue)
      - seen for sale at 48 h or later: it outlived the window -> es.close_outlived ("stale")
      - anything else was never seen again after its last re-read: outcome unknown, removed and counted in nothing
    -> Counter of what happened."""
    keep = set()
    for c in cards.values():
        keep.update(e[0] for e in c.get("cred") or [])
        keep.update(e[0] for e in (c.get("book") or [])[:3])
    res = Counter()
    for iid, rec in list(state["open"].items()):
        st = rec_start(rec)
        age_d = (es.NOW - st).total_seconds() / 86400 if st else 0.0
        if age_d <= STALE_D:
            continue
        lived = survived(rec)
        if rec.get("vanished") and not lived:
            continue
        if iid in keep and age_d <= RETAIN_MAX_D:
            anchored = ((cards.get(str(rec["card"])) or {}).get("A_n") or 0) >= es.ANCHOR_MIN
            if rec.get("vanished") and not anchored:         # known gone, and no book check will ever read it
                res[es.close_outlived(state, iid, rec)] += 1
            else:
                res["kept"] += 1                             # a flag stays on: book_queue reads flagged copies first
        elif rec.get("tier") == "suspect" and not rec.get("fin") and in_band(rec, REREAD_BAND) and age_d <= SUSPECT_LAST_D + 2:
            rec["vanished"] = None
            res["suspects"] += 1
        elif lived:
            res[es.close_outlived(state, iid, rec)] += 1
        else:
            del state["open"][iid]
            res["unknown"] += 1
    return res


def drop_cheap(state):
    """Open listings under the re-read band that nothing will ever check again: removed outright, with no closed
    record, so they count in nothing (a closed-as-stale record would read as 'did not sell')."""
    n = 0
    for iid, rec in list(state["open"].items()):
        t = rec.get("total")
        if (t is None or t < REREAD_BAND[0]) and not rec.get("vanished") \
                and es.hours_between(es.parse_ts(rec["first"]), es.NOW) / 24 > CHEAP_DROP_D:
            del state["open"][iid]
            n += 1
    return n


def drop_unconfirmed(state):
    """Listings flagged as gone that no lookup reached in VANISH_KEEP_D days: removed with no closed record (sold or
    merely ended is unknown, so they count in nothing)."""
    n = 0
    for iid, rec in list(state["open"].items()):
        t = es.parse_ts(rec.get("vanished") or "")
        if t and (es.NOW - t).total_seconds() / 86400 > VANISH_KEEP_D:
            del state["open"][iid]
            n += 1
    return n


def selftest_window(state):
    """One search that must return a listing we already know: proves the itemStartDate filter works here."""
    if DRY_RUN:
        state["vps"]["window_ok"] = True
        return
    # listings old enough to be indexed (30 min) and young enough to still be up (20 h)
    lo, hi = es.NOW - timedelta(hours=20), es.NOW - timedelta(minutes=30)
    cands = [r for r in state["open"].values() if r.get("src") == "aspect" and in_band(r, REREAD_BAND)
             and rec_start(r) and lo <= es.parse_ts(r["first"]) <= hi and not r.get("vanished")]
    if len(cands) < 3:
        log("Self-test: not enough known listings to test the date window with yet; will retry")
        return
    cands.sort(key=lambda r: r["first"], reverse=True)
    picks = cands[:3]
    found = 0
    for rec in picks:
        b0 = bucket_of(rec_start(rec))
        q = dict(es.QUERIES["aspect"])
        q["filter"] = q["filter"].replace(f"price:[{es.SWEEP_PRICE[0]}..{es.SWEEP_PRICE[1]}]",
                                          f"price:[{REREAD_BAND[0]}..{REREAD_BAND[1]}]") + \
            f",itemStartDate:[{es.ts(b0)}..{es.ts(b0 + timedelta(hours=1))}]"
        try:
            j = es.api_get(state, "/buy/browse/v1/item_summary/search", q)
        except RuntimeError as e:
            log(f"Self-test: window search failed ({e}); re-reads stay off until it passes")
            state["vps"]["window_ok"] = False
            return
        ids = {x.get("itemId") for x in (j.get("itemSummaries") or [])}
        log(f"Self-test: window {es.ts(b0)} +1h returned {len(ids)} listings (total {j.get('total')}); "
            f"known listing {'found' if rec['id'] in ids else 'not found'}")
        if rec["id"] in ids:
            found += 1
            break
    state["vps"]["window_ok"] = found > 0
    log("Self-test: date-window re-reads " + ("ENABLED" if found else "DISABLED (none of 3 known listings came back) - tell Claude"))


def aspect_trial(state, cat):
    """eBay's search can filter on an item specific (aspect_filter). If "Finish: Reverse Holo" really returns the
    reverse holos, a few searches an hour would tell every listing's printing without one lookup per listing.
    This measures it and logs what it finds; it changes nothing else. About 17 calls a run."""
    q, path = dict(es.QUERIES["aspect"]), "/buy/browse/v1/item_summary/search"
    j = es.api_get(state, path, dict(q, limit="1", fieldgroups="ASPECT_REFINEMENTS"))
    log(f"Aspect trial: {j.get('total')} raw singles in the price band right now; how sellers fill in the specifics:")
    for a in (j.get("refinement") or {}).get("aspectDistributions") or []:
        if a.get("localizedAspectName") in ("Finish", "Features", "Card Size", "Language", "Graded"):
            vals = sorted(((v.get("matchCount") or 0, str(v.get("localizedAspectValue")))
                           for v in a.get("aspectValueDistributions") or []), reverse=True)[:8]
            log(f"Aspect trial:   {a['localizedAspectName']}: " + ", ".join(f"{val} {n}" for n, val in vals))
    for name, value, word in TRIAL_CLAIMS:
        j = es.api_get(state, path, dict(q, aspect_filter=q["aspect_filter"] + f",{name}:{{{value}}}"))
        items = j.get("itemSummaries") or []
        in_title = sum(1 for x in items if word in x.get("title", "").lower())
        tracked = [state["open"][x["itemId"]] for x in items if x.get("itemId") in state["open"]]
        other_row = sum(1 for r in tracked if word not in " ".join((cat.by_id.get(r["card"]) or {}).get("vtoks", [])))
        agree = checked = 0
        for x in items[:3]:                                  # read three of them the slow way: does the filter tell the truth?
            it = es.api_get(state, f"/buy/browse/v1/item/{x['itemId']}", {}, ok_404=True) or {}
            vals = [str(a.get("value")) for a in it.get("localizedAspects") or [] if a.get("name") == name]
            checked += 1
            agree += any(value.lower() in val.lower() for val in vals)
            log(f"Aspect trial:     {x.get('title', '')[:60]} -> {name}: {', '.join(vals) or 'blank'}")
        log(f"Aspect trial: {name} = {value}: {j.get('total')} listings ({len(items)} read); {in_title} say '{word}' in "
            f"the title; {len(tracked)} are tracked here, {other_row} of them under a row that is not {value}; "
            f"lookups agree on {agree} of {checked}")


ALERT_TZ = "America/New_York"    # quiet hours are in Brett's local time
_file_cfg = {"stamp": None, "cfg": None}
_cfg_said = [None]
_chan = {}


def clean_cfg(c):
    """Alert settings from wherever they came (the Alerts tab, settings.json), forced into safe ranges; None when
    they cannot be read. One flat dict: margin / tax / conf (percent), window (hours), min_profit and the price
    range (dollars), what to send, quiet hours."""
    try:
        return {"margin": min(50.0, max(0.0, float(c["margin"]))), "tax": min(15.0, max(0.0, float(c["tax"]))),
                "conf": min(95.0, max(50.0, float(c["conf"]))), "window": min(168.0, max(24.0, float(c["window"]))),
                "min_profit": min(1000.0, max(0.0, float(c.get("min_profit", 0)))),
                "pmin": max(0.0, float(c.get("pmin", 25))), "pmax": max(1.0, float(c.get("pmax", 500))),
                "hits": bool(c.get("hits", True)), "leads": bool(c.get("leads", False)), "watch": bool(c.get("watch", True)),
                "auctions": bool(c.get("auctions", True)), "suspects": bool(c.get("suspects", False)),
                "quiet": bool(c.get("quiet", False)), "q_from": int(c.get("q_from", 23)) % 24, "q_to": int(c.get("q_to", 7)) % 24}
    except (KeyError, TypeError, ValueError):
        return None


def alert_cfg(state):
    """The settings in force: what the site's Alerts tab last sent (kept in the state), else settings.json in the
    repo, else the constants in ebay_sweep.py."""
    cfg = (state.get("vps") or {}).get("alert_cfg")
    if cfg:
        return cfg
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "settings.json")
    try:
        stamp = os.path.getmtime(path)
        if stamp != _file_cfg["stamp"]:
            raw = json.load(open(path, encoding="utf-8"))
            _file_cfg["stamp"] = stamp
            _file_cfg["cfg"] = clean_cfg({"margin": raw["margin_pct"], "tax": raw["buy_tax_pct"],
                                          "conf": raw["confidence_pct"], "window": raw["window_h"]})
    except Exception:
        pass
    return _file_cfg["cfg"] or clean_cfg({"margin": es.MARGIN * 100, "tax": es.TAX * 100, "conf": es.CONFIDENCE * 100,
                                          "window": es.SELL_WINDOW_H})


def apply_settings(state):
    """Put the settings in force into the gate (ebay_sweep reads these when it judges a listing). The boxes on the
    Raw Data tab only exist in Brett's browser; the Alerts tab is what reaches this machine."""
    cfg = alert_cfg(state)
    es.MARGIN, es.TAX, es.CONFIDENCE, es.SELL_WINDOW_H = cfg["margin"] / 100, cfg["tax"] / 100, cfg["conf"] / 100, cfg["window"]
    said = json.dumps(cfg, sort_keys=True)
    if said != _cfg_said[0]:
        _cfg_said[0] = said
        log(f"Settings: margin {cfg['margin']:g}%, buying tax {cfg['tax']:g}%, sells within {cfg['window']:g} h with "
            f"{cfg['conf']:g}% confidence; alerts: hits {'on' if cfg['hits'] else 'off'}, leads {'on' if cfg['leads'] else 'off'}, "
            f"profit from ${cfg['min_profit']:g}, price ${cfg['pmin']:g}-${cfg['pmax']:g}, scam-watch "
            f"{'included' if cfg['watch'] else 'left out'}, suspects {'alerted' if cfg.get('suspects') else 'blocked'}, "
            f"auctions {'on' if cfg.get('auctions', True) else 'off'}, quiet hours "
            + (f"{cfg['q_from']}:00-{cfg['q_to']}:00" if cfg["quiet"] else "off"))
    return cfg


def alert_channel():
    """The private channel the site's Alerts tab talks to this machine on (ntfy, the other way round). Its name and
    the key that signs every message both come from the site password, so only the unlocked page and this machine
    can use it; nothing new had to be set up."""
    if not _chan:
        hk = es.live_key(es.PASSWORD).hex()
        _chan["topic"] = "pc-" + hashlib.sha256((hk + ":alerts-topic").encode()).hexdigest()[:40]
        _chan["key"] = hashlib.sha256((hk + ":alerts-key").encode()).hexdigest().encode()
    return _chan["topic"], _chan["key"]


WRONG_KEEP_D = 365               # "not the same card" answers on clean listings are kept this long
HELP_KEY = re.compile(r"^(h:[A-Za-z0-9_]{1,40}|r:(pc|ec|er|al|rv))$")


def help_edit(v, msg, t):
    """A description or a README Brett rewrote on the site (the pencil on a "?" popup or a README). It arrives signed,
    like the alert settings, and is handed back in the live file so the page shows his wording on every device and
    after every rebuild. A text can be longer than one ntfy message holds (4 KB), so it comes in numbered pieces and
    counts only once every piece is in. `del` puts the original wording back. Keys: h:<column> -> {f, m, e} (formula,
    meaning, example); r:<tab> -> the README's HTML. Nothing here is executed or trusted beyond being shown to him."""
    key = str(msg.get("key") or "")
    if not HELP_KEY.match(key):
        return
    store, parts = v.setdefault("help", {}), v.setdefault("help_parts", {})
    for k in [k for k, p in parts.items() if t - p["t"] > 3600 * 1000]:
        del parts[k]                                         # an edit that never finished arriving
    if msg.get("del"):
        store.pop(key, None)
        v["help_t"] = t
        log(f"Site text: {key} put back to the original")
        return
    try:
        n, i, pid = int(msg.get("n") or 1), int(msg.get("i") or 0), str(msg.get("id") or "")[:24]
    except (TypeError, ValueError):
        return
    if not pid or not 1 <= n <= 80 or not 0 <= i < n:
        return
    p = parts.setdefault(pid, {"key": key, "n": n, "d": {}, "t": t})
    p["d"][str(i)] = str(msg.get("d") or "")[:4000]
    if p["key"] != key or len(p["d"]) < p["n"]:
        return
    del parts[pid]
    try:
        val = json.loads(base64.b64decode("".join(p["d"][str(k)] for k in range(p["n"]))).decode("utf-8"))
    except Exception:
        return
    if key.startswith("h:") and isinstance(val, dict):
        store[key] = {k: str(val.get(k) or "")[:8000] for k in ("f", "m", "e")}
    elif key.startswith("r:") and isinstance(val, str):
        store[key] = val[:150000]
    else:
        return
    v["help_t"] = t
    log(f"Site text: {key} rewritten on the site ({n} piece{'s' if n != 1 else ''})")


def note_wrong(v, e, state=None, forced=False):
    """Brett said No, not the same card, to an alert on a listing the scam screen had not flagged - or ticked
    "Mismatch" on the Raw Data tab (forced: that says mismatch whatever the scam tier). A wrong match by the title
    matcher, or a listing whose title lies about its photo. Kept apart from the 300-alert log: these are what the
    matcher learns from (es.learn_tables). A phone No on a watch / suspect listing is not kept: there it may mean
    "scam". -> True when it counts as a mismatch."""
    if not forced and e.get("tr", "clean") in ("watch", "suspect"):
        return False
    wrong = v.setdefault("wrong", [])
    if not any(w["i"] == e["i"] for w in wrong):
        alerted = any(x["i"] == e["i"] for x in v.get("alert_log", []) + v.get("au_hist", []))
        wrong.append({"t": e.get("dt") or es.ts(es.NOW), "i": e["i"], "ti": e.get("ti"), "u": e.get("u"), "c": e.get("c"),
                      "cs": e.get("cs"), "card": e.get("card"), "kd": e.get("kd"), "tot": e.get("tot"), "sl": e.get("sl"),
                      "al": 1 if alerted else 0})
    if state is not None:
        set_um(state, e["i"], True)
    return True


def find_rec(state, iid):
    return state["open"].get(iid) or next((r for r in state["closed"] if r["id"] == iid), None)


def set_um(state, iid, on):
    """Put the "marked a mismatch by Brett" flag on everything that knows this listing: the listing (which takes it
    out of the statistics and stops it being a hit), its alert, and its auction record."""
    v = state["vps"]
    rec = find_rec(state, iid)
    if rec is not None:
        if on:
            rec["um"] = 1
        else:
            rec.pop("um", None)
    for e in v.get("alert_log", []) + v.get("au_hist", []):
        if e["i"] == iid:
            if on:
                e["um"] = 1
            else:
                e.pop("um", None)
    return rec


def mark_listing(state, iid, on, t):
    """The Mismatch tick on the site (Raw Data rows, the auction view, the list behind the hit total)."""
    v = state["vps"]
    rec = set_um(state, iid, on)
    if on:
        e = next((x for x in v.get("alert_log", []) if x["i"] == iid), None) or next((x for x in v.get("au_hist", []) if x["i"] == iid), None) or {}
        note_wrong(v, {"i": iid, "dt": es.ts(es.NOW), "ti": (rec or {}).get("title") or e.get("ti"), "u": (rec or {}).get("url") or e.get("u"),
                       "c": e.get("c"), "cs": e.get("cs"), "card": (rec or {}).get("card", e.get("card")), "kd": e.get("kd") or "marked on the site",
                       "tot": (rec or {}).get("total", e.get("tot")), "sl": (rec or {}).get("seller")}, forced=True)
    else:
        v["wrong"] = [w for w in v.get("wrong", []) if w["i"] != iid]
    v["mark_t"] = t
    log(f"Mismatch mark {'set' if on else 'removed'} on the site ({len(v.get('wrong', []))} wrong matches on file)")


def wrong_rows(v):
    """The wrong-match list for the site, newest first: [when, item, title, link, matched card, its set, card id, kind, total]."""
    cut = es.ts(es.NOW - timedelta(days=WRONG_KEEP_D))
    if not v.get("wrong_backfilled"):                        # answers given before this list existed
        for e in v.get("alert_log", []):
            if e.get("dec") == "no":
                note_wrong(v, e)
        v["wrong_backfilled"] = 1
    v["wrong"] = sorted((w for w in v.get("wrong", []) if w["t"] >= cut), key=lambda w: w["t"])[-1000:]
    return [[w["t"], w["i"], w.get("ti"), w.get("u"), w.get("c"), w.get("cs"), w.get("card"), w.get("kd"), w.get("tot")]
            for w in reversed(v["wrong"])]


def read_requests(state):
    """What the Alerts tab sent since the last look: new settings, or a request for a test alert. A message counts
    only when its signature is right and it is newer than the last one acted on."""
    if DRY_RUN or not es.PASSWORD:
        return
    v = state["vps"]
    topic, key = alert_channel()
    try:
        import requests
        r = requests.get(f"{NTFY_SERVER}/{topic}/json", params={"poll": "1", "since": v.get("req_since") or "12h"}, timeout=10)
        lines = r.text.splitlines() if r.status_code == 200 else []
    except Exception:
        return
    for line in lines:
        try:
            ev = json.loads(line)
            if ev.get("event") != "message":
                continue
            v["req_since"] = ev["id"]
            env = json.loads(ev["message"])
            if "dec" in env:                      # Brett's Yes / No on the phone's check screen
                dec = env["dec"]
                for e in v.get("alert_log", []) + v.get("au_hist", []):
                    if e["i"] == dec.get("i") and e.get("tk") == dec.get("tk") and dec.get("d") in ("nm", "lp", "no", "yes"):
                        if dec["d"] == "yes" and e.get("dec"):
                            continue                 # "same card" never replaces an answer already given
                        e["dec"], e["dt"] = dec["d"], es.ts(es.NOW)
                        if dec["d"] == "no" and "tot" in e:
                            rec = find_rec(state, e["i"])       # the listing itself: its seller and its whole title
                            note_wrong(v, dict(e, sl=(rec or {}).get("seller"), ti=(rec or {}).get("title") or e.get("ti")), state)
                continue
            if not hmac.compare_digest(hmac.new(key, env["m"].encode(), "sha256").hexdigest(), str(env.get("s"))):
                continue
            msg = json.loads(env["m"])
            t = int(msg["t"])
        except Exception:
            continue
        if t <= v.get("req_t", 0) or abs(time.time() * 1000 - t) > 24 * 3600 * 1000:
            continue
        v["req_t"] = t
        if msg.get("type") == "settings":
            cfg = clean_cfg(msg.get("cfg") or {})
            if cfg:
                v["alert_cfg"], v["alert_t"] = cfg, t
                log("Alerts tab: new settings received")
        elif msg.get("type") == "test":
            if push("Test alert", "Sent from the Notification Settings tab. Your phone alerts are working.", priority=4, tags=("white_check_mark",)):
                v["test_t"] = t
            log("Alerts tab: test alert requested" + ("" if NTFY_TOPIC else " - but no channel is set on this machine"))
        elif msg.get("type") == "help":
            help_edit(v, msg, t)
        elif msg.get("type") == "mark" and msg.get("i"):
            mark_listing(state, str(msg["i"])[:60], bool(msg.get("v")), t)


def quiet_now(cfg):
    if not cfg.get("quiet") or cfg["q_from"] == cfg["q_to"]:
        return False
    try:
        from zoneinfo import ZoneInfo
        h = datetime.now(ZoneInfo(ALERT_TZ)).hour
    except Exception:
        h = (now_utc().hour - 4) % 24
    a, b = cfg["q_from"], cfg["q_to"]
    return a <= h < b if a < b else h >= a or h < b


def push(title, message, click=None, image=None, priority=5, tags=("moneybag",)):
    """One notification to the phone. Returns True when ntfy accepted it."""
    if not NTFY_TOPIC or DRY_RUN:
        return False
    body = {"topic": NTFY_TOPIC, "title": title, "message": message, "priority": priority, "tags": list(tags)}
    if click:
        body["click"] = click
    if image:
        body["attach"] = image
    try:
        import requests
        return requests.post(NTFY_SERVER, json=body, timeout=10).status_code < 300
    except Exception as e:
        log(f"Alert not sent ({e})")
        return False


PC_IMG = re.compile(r"https://storage\.googleapis\.com/images\.pricecharting\.com/([A-Za-z0-9_-]+)/\d+\.jpg")


def pc_image(state, pid):
    """PriceCharting's own picture of a card, for the phone's check screen (Brett compares it with the eBay photo:
    a listing whose title and item specifics both name one card while the photo shows another can only be caught
    by eye). Their data feed has no image field, so the address is read off the card's public page - one page per
    card, fetched only when an alert is about to go out. Their terms have no rule against it and robots.txt allows
    /game/ (both read 2026-10-05). None when it cannot be had; the screen then shows the button instead."""
    cache = state["vps"].setdefault("pc_img", {})
    if str(pid) in cache:
        return cache[str(pid)]
    try:
        import requests
        r = requests.get(f"https://www.pricecharting.com/game/{pid}", timeout=6,
                         headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) personal card check, one page per alert"})
        m = PC_IMG.search(r.text) if r.status_code == 200 else None
    except Exception:
        m = None
    if not m:
        return None                                          # not remembered: the next alert for this card tries again
    cache[str(pid)] = f"https://storage.googleapis.com/images.pricecharting.com/{m.group(1)}/1600.jpg"
    for k in list(cache)[:-2000]:
        del cache[k]
    return cache[str(pid)]


def hit_payload(rec, cs, cat, kind="hit"):
    """Everything the check screen shows for one hit or lead, as a compact dict (it travels inside the alert's link)."""
    c = cat.by_id.get(rec["card"]) or {}
    allin = round(rec["total"] + (rec.get("item") or 0) * es.TAX, 2)
    decision = es.listing_decision if kind == "hit" else es.lead_decision

    def side(cond):                                          # the gate's numbers if the copy is NM / LP
        s, net, maxbuy = decision(dict(rec, tcond=cond), cs)
        return [s, round(maxbuy, 2), round(net - allin, 2), round((net - allin) / allin * 100, 1)]
    return {"i": rec["id"], "u": rec.get("url"), "t": rec.get("title"), "im": (rec.get("imgs") or [rec.get("img")])[:4],
            "tot": rec["total"], "it": rec.get("item"), "sh": rec.get("ship"), "ai": allin,
            "c": c.get("name", "") + (f" [{c['variant'].title()}]" if c.get("variant") else "") + f" #{c.get('num', '')}",
            "s": c.get("set"), "n": c.get("num"), "st": cat.totals.get(c.get("set")), "v": c.get("variant") or "",
            "pc": c.get("pc"), "pid": c.get("id"), "nm": side("NM"), "lp": side("LP"), "roi": round(es.MARGIN * 100, 1),
            "tier": rec.get("tier", "clean"), "sc": rec.get("sc", 0), "scr": rec.get("scr", []),
            "idv": rec.get("idv") or "", "idr": rec.get("idr") or [], "fb": rec.get("fb"), "pct": rec.get("pct"),
            "ph": rec.get("n_img"), "A": cs.get("A"), "An": cs.get("A_n"), "tax": round(es.TAX * 100, 2),
            # demand and supply from both sources: PriceCharting's 12-month sales count (all grades), and what this
            # collector has seen on eBay - sales in its 30-day window, the days it has watched the card, copies listed
            "pv": c.get("vol"), "k": cs.get("k"), "D": cs.get("D"), "N": cs.get("N"), "kd": kind,
            # a cheaper anniversary reprint that carries this card's number (es.reprint_twins): [[set, price, card id]]
            "rp": [list(t) for t in (cs.get("tw") or [0, []])[1]]}


def mm_seed(v):
    """Once: start the per-card alert counts from the alerts still on record, give the wrong-match entries made
    before 2026-10-06 their card (old alert-log rows had none) and say whether each was an alert."""
    if v.get("mm_seeded"):
        return
    ca, seen = v.setdefault("card_alerts", {}), set()
    for e in v.get("alert_log", []) + v.get("au_hist", []):
        if e.get("card") is not None and e["i"] not in seen:
            seen.add(e["i"])
            ca[str(e["card"])] = ca.get(str(e["card"]), 0) + 1
    known = {}
    for e in v.get("alert_log", []) + v.get("au_hist", []):  # the record of each alerted listing that names its card, if any does
        if e["i"] not in known or (known[e["i"]].get("card") is None and e.get("card") is not None):
            known[e["i"]] = e
    for w in v.get("wrong", []):
        if w.get("card") is None and w["i"] in known:
            w["card"] = known[w["i"]].get("card")
        w.setdefault("al", 1 if w["i"] in known or str(w.get("kd", "")).split("-")[0] in ("hit", "lead", "auction") else 0)
    v["mm_seeded"] = 1


def mm_counts(v):
    """{card id: [listings Brett marked as mismatches, how many of those were alerts, alerts sent on the card]} for
    every card he has marked at least once - "3 of 12 alerts". Alerts are counted from 2026-10-06 (card_alerts)."""
    mm_seed(v)
    out = {}
    for w in v.get("wrong", []):
        if w.get("card") is not None:
            n = out.setdefault(w["card"], [0, 0, 0])
            n[0] += 1
            n[1] += 1 if w.get("al") else 0
    for cid, n in out.items():
        n[2] = max(v.get("card_alerts", {}).get(str(cid), 0), n[1])      # never fewer alerts than alerted mismatches
    return out


def alert_extras(state, d, rec):
    """What an alert carries beyond the listing itself: the reprint's picture to compare against, how often this card
    has been a mismatch before - and the alert is counted for that card."""
    v = state["vps"]
    if d.get("rp"):
        d["rp"][0] = d["rp"][0][:3] + [pc_image(state, d["rp"][0][2])]
    mm = mm_counts(v).get(rec["card"])
    if mm:
        d["mm"] = mm


def scam_words(rec):
    """ "+3 seller feedback under 10, +2 priced 50-65% of the card's price = 5 points" """
    parts = [f"{es.SCAM_POINTS.get(k, 0):+d} {es.SCAM_LABELS.get(k, k)}" for k in rec.get("scr") or []]
    return ", ".join(parts) + f" = {rec.get('sc', 0)} points"


def tier_risk(state, tier):
    """[pulled before its end date, closed] for listings of this scam tier so far - the check screen shows it."""
    t = (es.scam_calib(state).get("tiers") or {}).get(tier) or {}
    n = sum(t.values())
    return [t.get("gone", 0), n] if n else None


def alert_hits(state, cat, cards, live, cfg):
    """Push every new hit (and lead, when switched on) once, if it clears the Alerts-tab filters: the listings first
    seen in the last 24 hours (the live rows), and older listings whose price a re-read just found lower. A listing
    the filters hold back is not marked as sent, so it can still alert after the settings change. Each alert is
    logged with a one-time token, which the check screen sends back with Brett's Yes / No."""
    if not NTFY_TOPIC:
        return 0
    v = state["vps"]
    sent = v.setdefault("alerted", {})                       # item id -> when
    hist = v.setdefault("alert_log", [])
    hour = es.ts(es.NOW)[:13]
    box = v.setdefault("alert_box", {})
    if box.get("hour") != hour:
        box["hour"], box["n"] = hour, 0
    quiet = quiet_now(cfg)
    back = alert_channel()[0] if es.PASSWORD else None

    def consider(iid, verdict, drop):
        rec = state["open"].get(iid)
        suspect = verdict == "suspect"
        if suspect:                               # hidden from the gate; alerted only when Brett switched suspects on,
            if not rec or not cfg.get("suspects") or "dup" in (rec.get("scr") or []):   # and never with a borrowed photo
                return 0
            verdict = es.verdict(dict(rec, tier="clean"), cards.get(str(rec["card"])))[0]   # what the price test says
        kind = "hit" if verdict == "PASS" and cfg["hits"] else "lead" if verdict == "LEAD" and cfg["leads"] else None
        if not kind or not rec or iid in sent or box["n"] >= ALERTS_PER_HOUR:
            return 0
        cs = cards.get(str(rec["card"]))
        if not cs or (rec.get("tier") == "watch" and not cfg["watch"]) or not cfg["pmin"] <= rec["total"] <= cfg["pmax"]:
            return 0
        if suspect and not rec.get("idv"):        # suspects are not in the identity queue: read the specifics now
            try:
                it = es.api_get(state, f"/buy/browse/v1/item/{iid}", {}, ok_404=True)
            except Exception:
                it = None
            if it:
                rec["idv"], rec["idr"], _ = es.check_identity(cat, cat.by_id.get(rec["card"]), it, rec.get("title") or "", rec["total"])
                es.item_facts(rec, it)
            if rec.get("idv") == "conflict":
                sent[iid] = es.ts(es.NOW)
                return 0
        d = hit_payload(rec, cs, cat, kind)
        if d["nm"][2] is None or d["nm"][2] < cfg["min_profit"]:
            return 0
        d["tk"], d["rq"] = hashlib.sha1(os.urandom(16)).hexdigest()[:12], back
        d["pci"] = pc_image(state, d["pid"])
        alert_extras(state, d, rec)
        flagged = rec.get("tier") in ("watch", "suspect")
        if flagged:
            d["risk"] = tier_risk(state, rec["tier"])
        link = CHECK_PAGE + "#" + base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).decode().rstrip("=")
        msg = (f"Max buy ${d['nm'][1]:.2f}, ROI {d['nm'][3]:.0f}%" + (" - LEAD, priced from PriceCharting" if kind == "lead" else "")
               + (f"\n{'SUSPECT' if suspect else 'Scam watch'}: {scam_words(rec)}" if flagged else "")
               + (f"\nA cheaper reprint has this number ({d['rp'][0][0]}): look for the stamp" if d.get("rp") else "")
               + f"\n{rec.get('title', '')[:80]}\nSeller {rec.get('fb') or '?'} ratings" + (" - ID conflict?" if d["idv"] == "conflict" else ""))
        title = ("SUSPECT: " if suspect else "") + ("Price drop: " if drop else "") + f"+${d['nm'][2]:.0f} \u00b7 {d['c']} \u00b7 ${rec['total']:.0f}"
        if not push(title, msg, click=link, image=rec.get("img"),
                    priority=2 if quiet else 4 if suspect else 5 if kind == "hit" else 3,
                    tags=("warning",) if suspect else ("moneybag",) if kind == "hit" else ("mag",)):
            return 0
        sent[iid] = es.ts(es.NOW)
        box["n"] += 1
        v.setdefault("card_alerts", {})[str(rec["card"])] = v.get("card_alerts", {}).get(str(rec["card"]), 0) + 1
        hist.append({"i": iid, "t": es.ts(es.NOW), "tk": d["tk"], "c": d["c"], "ti": (rec.get("title") or "")[:70],
                     "u": rec.get("url"), "tot": rec["total"], "p": d["nm"][2],
                     "kd": kind + ("-suspect" if suspect else "") + ("-drop" if drop else ""),
                     "tr": rec.get("tier", "clean"), "card": rec["card"], "cs": d.get("s")})
        return 1

    n = sum(consider(x[0], x[12], False) for x in live["live"] if x[17] == "open")
    for iid in dict.fromkeys(v.pop("drops", [])):            # price cuts the re-reads found on older listings
        rec = state["open"].get(iid)
        if rec and iid not in sent:
            n += consider(iid, es.verdict(rec, cards.get(str(rec["card"])))[0], True)
    cutoff = es.ts(es.NOW - timedelta(days=3))
    for iid in [k for k, t in sent.items() if t < cutoff]:
        del sent[iid]
    del hist[:-300]
    return n


def alert_status(state, cfg):
    """What the Alerts tab shows as "on the collector now"."""
    v = state["vps"]
    day_ago = es.ts(es.NOW - timedelta(hours=24))
    times = sorted(v.get("alerted", {}).values())
    log_rows = v.get("alert_log", [])[-40:]
    want = {e["i"] for e in log_rows}
    closed = {r["id"]: r for r in state["closed"] if r["id"] in want}
    hist = []
    for e in reversed(log_rows):                             # newest first
        r = closed.get(e["i"])
        out = "open" if e["i"] in state["open"] else (r.get("out") or "closed") if r else "unknown"
        if e["kd"].startswith("auction"):
            out = f"closed at ${e['fin']:.2f}; your max bid was ${e.get('mb', 0):.2f}" if e.get("fin") is not None else "auction not finished yet"
        hrs = round(es.hours_between(es.parse_ts(e["t"]), es.parse_ts(r["closed"])), 1) if r and r.get("closed") else None
        hist.append([e["t"], e["c"], e["ti"], e["u"], e["tot"], e["p"], e["kd"], e.get("dec"), out, hrs])
    return {"cfg": cfg, "t": v.get("alert_t", 0), "on": bool(NTFY_TOPIC), "test_t": v.get("test_t", 0),
            "sent24": sum(1 for t in times if t >= day_ago), "last": times[-1] if times else None,
            "quiet_now": quiet_now(cfg), "hist": hist}


def auction_read(state, cat, cards):
    """The collector only buys from fixed-price listings; this trial measures whether auctions would be a better
    source. One page of raw-single auctions ending soonest: those on a card that can be priced (an eBay anchor, or a
    PriceCharting lead card) are remembered until they end. Nothing here touches the statistics or the site."""
    q = dict(es.QUERIES["aspect"], sort="endingSoonest")
    q["filter"] = f"conditionIds:{{{es.COND_UNGRADED}}},price:[..{es.SWEEP_PRICE[1]}],priceCurrency:USD," \
                  f"buyingOptions:{{AUCTION}},itemLocationCountry:US"
    j = es.api_get(state, "/buy/browse/v1/item_summary/search", q)
    watch, new = state.setdefault("auctions", {}), 0
    for x in j.get("itemSummaries") or []:
        iid, end = x.get("itemId"), x.get("itemEndDate")
        if not iid or not end:
            continue
        try:
            bid = float((x.get("currentBidPrice") or x.get("price") or {}).get("value"))
        except (TypeError, ValueError):
            continue
        if iid in watch:
            watch[iid]["bid"], watch[iid]["bids"] = bid, x.get("bidCount")
            continue
        title = x.get("title") or ""
        ci, how, _ = es.match_title(cat, title, x.get("epid") or "", state["denoms"])
        if ci is None or es.title_condition(title) not in es.COMPARABLE_CONDS:
            continue
        cid = cat.cards[ci]["id"]
        cs = cards.get(str(cid)) or {}
        basis = "ebay" if cs.get("A_n", 0) >= es.ANCHOR_MIN and cs.get("liquid") else \
                "pc" if (cs.get("pc") or 0) >= es.LEAD_MIN_PC and (cs.get("pcv") or 0) >= es.LEAD_MIN_PC_SALES else None
        if not basis:
            continue
        opts = x.get("shippingOptions") or [{}]
        try:
            ship = float((opts[0].get("shippingCost") or {}).get("value"))
        except (TypeError, ValueError):
            ship = 5.0                                       # calculated shipping: assume a tracked envelope
        watch[iid] = {"card": cid, "title": title[:90], "end": end[:19] + "Z", "bid": bid, "bids": x.get("bidCount"),
                      "ship": ship, "basis": basis, "tcond": es.title_condition(title), "url": x.get("itemWebUrl")}
        new += 1
    return new


def auction_alerts(state, cat, cards, cfg):
    """Push the auctions that end in about 10 minutes and whose current bid is still under what the gate would pay.
    Bids pile in during the last seconds, so most of these will finish above the max: the alert's job is to give
    Brett time to look at the card and the number he may bid up to, never more. One search per call, plus a lookup
    (item specifics, photos) for the few about to be sent. Returns the alerts sent."""
    v = state["vps"]
    lo, hi = AUCTION_ALERT_WINDOW
    q = dict(es.QUERIES["aspect"], sort="endingSoonest")
    base = f"conditionIds:{{{es.COND_UNGRADED}}},price:[..{es.SWEEP_PRICE[1]}],priceCurrency:USD," \
           f"buyingOptions:{{AUCTION}},itemLocationCountry:US"
    try:
        q["filter"] = base + f",itemEndDate:[{es.ts(es.NOW + timedelta(minutes=lo))}..{es.ts(es.NOW + timedelta(minutes=hi))}]"
        j = es.api_get(state, "/buy/browse/v1/item_summary/search", q)
    except Exception:                                        # a date range eBay will not take: ask for "ends before" only
        q["filter"] = base + f",itemEndDate:[..{es.ts(es.NOW + timedelta(minutes=hi))}]"
        j = es.api_get(state, "/buy/browse/v1/item_summary/search", q)
    watch, sent, hist = state.setdefault("auctions", {}), v.setdefault("alerted", {}), v.setdefault("alert_log", [])
    box = v.setdefault("au_box", {})
    if box.get("hour") != es.ts(es.NOW)[:13]:
        box["hour"], box["n"] = es.ts(es.NOW)[:13], 0
    cands = []
    for x in j.get("itemSummaries") or []:
        iid, end = x.get("itemId"), x.get("itemEndDate")
        if not iid or not end:
            continue
        end = end[:19] + "Z"
        left = (es.parse_ts(end) - es.NOW).total_seconds() / 60
        try:
            bid = float((x.get("currentBidPrice") or x.get("price") or {}).get("value"))
        except (TypeError, ValueError):
            continue
        title = x.get("title") or ""
        a = watch.get(iid)
        if a is None:
            ci, _, _ = es.match_title(cat, title, x.get("epid") or "", state["denoms"])
            if ci is None or es.title_condition(title) not in es.COMPARABLE_CONDS:
                continue
            cid = cat.cards[ci]["id"]
            cs = cards.get(str(cid)) or {}
            basis = "ebay" if cs.get("A_n", 0) >= es.ANCHOR_MIN and cs.get("liquid") else \
                    "pc" if (cs.get("pc") or 0) >= es.LEAD_MIN_PC and (cs.get("pcv") or 0) >= es.LEAD_MIN_PC_SALES else None
            if not basis:
                continue
            try:
                ship = float(((x.get("shippingOptions") or [{}])[0].get("shippingCost") or {}).get("value"))
            except (TypeError, ValueError):
                ship = 5.0
            a = watch[iid] = {"card": cid, "title": title[:90], "end": end, "bid": bid, "bids": x.get("bidCount"), "ship": ship,
                              "basis": basis, "tcond": es.title_condition(title), "url": x.get("itemWebUrl")}
        else:
            a["bid"], a["bids"] = bid, x.get("bidCount")
        kind = "hit" if a["basis"] == "ebay" else "lead"
        if iid in sent or not lo - 1 <= left <= hi + 1 or not cfg["hits" if kind == "hit" else "leads"]:
            continue
        seller = x.get("seller") or {}
        pct = seller.get("feedbackPercentage")
        rec = {"id": iid, "card": a["card"], "title": title, "url": a["url"], "total": round(bid + a["ship"], 2), "item": bid,
               "ship": a["ship"], "tcond": a["tcond"], "fb": seller.get("feedbackScore"),
               "pct": float(pct) if pct not in (None, "") else None, "img": (x.get("image") or {}).get("imageUrl"),
               "n_img": (1 if x.get("image") else 0) + len(x.get("additionalImages") or []), "tier": "clean", "sc": 0, "scr": []}
        fb = rec["fb"]                              # the scam score's seller signals; a bid says nothing about price
        if fb is None:
            rec["sc"] += 1; rec["scr"].append("fbq")
        elif fb < 10:
            rec["sc"] += 3; rec["scr"].append("fb0")
        if x.get("topRatedBuyingExperience"):
            rec["sc"] -= 2; rec["scr"].append("top")
        if fb is not None and fb >= 500 and rec["pct"] is not None and rec["pct"] >= 99:
            rec["sc"] -= 1; rec["scr"].append("est")
        if rec["sc"] >= es.SCAM_WATCH:
            rec["tier"] = "watch"
            if not cfg["watch"]:
                continue
        cs = cards.get(str(a["card"])) or {}
        decision = es.listing_decision if kind == "hit" else es.lead_decision
        _, net, maxbuy = decision(rec, cs)
        if maxbuy is None or es.seller_bar(rec) is not None or rec["n_img"] < 2:
            continue
        allin = rec["total"] + bid * es.TAX
        if allin > maxbuy or net - maxbuy < cfg["min_profit"] or maxbuy < cfg["pmin"] or rec["total"] > cfg["pmax"]:
            continue
        cands.append((maxbuy - allin, iid, rec, cs, kind, decision, end, left))
    cands.sort(key=lambda t: -t[0])                          # the most room under the max first
    quiet, back, n = quiet_now(cfg), alert_channel()[0] if es.PASSWORD else None, 0
    for _, iid, rec, cs, kind, decision, end, left in cands[:AUCTION_ALERT_CHECKS]:
        if box["n"] >= AUCTION_ALERTS_PER_HOUR:
            break
        it = es.api_get(state, f"/buy/browse/v1/item/{iid}", {}, ok_404=True)
        if not it:
            continue
        status, notes, _ = es.check_identity(cat, cat.by_id.get(rec["card"]), it, rec["title"], rec["total"])
        if status == "conflict":
            sent[iid] = es.ts(es.NOW)                        # the specifics name another card: never alert this one
            continue
        rec["idv"], rec["idr"] = status, notes
        es.item_facts(rec, it)
        d = hit_payload(rec, cs, cat, kind)

        nets = {}                                            # what selling it brings in after fees: frozen with the alert

        def side(cond):                                      # [sell, max buy, profit at the max, ROI at the max, max bid]
            s2, net2, mb2 = decision(dict(rec, tcond=cond), cs)
            nets[cond] = round(net2, 2)
            return [s2, round(mb2, 2), round(net2 - mb2, 2), round((net2 - mb2) / mb2 * 100, 1),
                    math.floor((mb2 - rec["ship"]) / (1 + es.TAX) * 100) / 100]
        d["nm"], d["lp"] = side("NM"), side("LP")
        d["au"] = {"e": end, "b": rec["item"], "n": watch[iid].get("bids") or 0}
        d["tk"], d["rq"], d["pci"] = hashlib.sha1(os.urandom(16)).hexdigest()[:12], back, pc_image(state, d["pid"])
        alert_extras(state, d, rec)
        if rec["tier"] == "watch":
            d["risk"] = tier_risk(state, "watch")
        link = CHECK_PAGE + "#" + base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).decode().rstrip("=")
        msg = (f"Now ${rec['item']:.2f} + ${rec['ship']:.2f} shipping, {d['au']['n']} bids. Bid up to ${d['nm'][4]:.2f} for a near-mint copy"
               + (" - LEAD, priced from PriceCharting" if kind == "lead" else "")
               + (f"\nA cheaper reprint has this number ({d['rp'][0][0]}): look for the stamp" if d.get("rp") else "")
               + (f"\nScam watch: {scam_words(rec)}" if rec["tier"] == "watch" else "") + f"\n{rec['title'][:80]}\nSeller {rec.get('fb') or '?'} ratings")
        title = f"Auction ends in {left:.0f} min \u00b7 bid up to ${d['nm'][4]:.0f} \u00b7 {d['c']}"
        if not push(title, msg, click=link, image=rec.get("img"), priority=2 if quiet else 5 if kind == "hit" else 3, tags=("hammer",)):
            continue
        sent[iid] = es.ts(es.NOW)
        box["n"] += 1
        n += 1
        v.setdefault("card_alerts", {})[str(rec["card"])] = v.get("card_alerts", {}).get(str(rec["card"]), 0) + 1
        watch[iid]["al"] = True
        hist.append({"i": iid, "t": es.ts(es.NOW), "tk": d["tk"], "c": d["c"], "ti": rec["title"][:70], "u": rec["url"],
                     "tot": rec["total"], "p": d["nm"][2], "kd": "auction" + ("" if kind == "hit" else "-lead"), "mb": d["nm"][4],
                     "tr": rec["tier"], "card": rec["card"], "cs": d.get("s")})
        # the Raw Data tab's auction view: the bid when the phone was pinged, and everything needed to re-judge the
        # row later under whatever the Alerts tab then says. The sell side (net) is frozen here; margin and tax are not
        v.setdefault("au_hist", []).append({
            "i": iid, "t": es.ts(es.NOW), "tk": d["tk"], "card": rec["card"], "ti": rec["title"][:90], "u": rec["url"],
            "bid": rec["item"], "ship": rec["ship"], "nb": watch[iid].get("bids") or 0, "end": end, "tc": rec["tcond"],
            "fb": rec.get("fb"), "pct": rec.get("pct"), "kd": kind, "s": d["nm"][0], "net": [nets.get("NM"), nets.get("LP")],
            "tier": rec["tier"], "sc": rec["sc"], "scr": rec["scr"], "ph": rec.get("n_img")})
    return n


def au_backfill(state, cat):
    """Once: give the auction alerts sent before 2026-10-06 a row in the auction view. Their own log kept little
    (the total at the alert, the profit at the max, the final price), so shipping, bids and the card come from the
    finished-auction list where the same card closed at the same price. Rows built this way are marked old."""
    v = state["vps"]
    hist = v.setdefault("au_hist", [])
    have = {e["i"] for e in hist}
    m = alert_cfg(state).get("margin", 10) / 100.0 or 0.10
    for e in v.get("alert_log", []):
        if not str(e.get("kd", "")).startswith("auction") or e["i"] in have:
            continue
        try:
            ci = es.match_title(cat, e.get("ti") or "", "", state.get("denoms", {}))[0]
        except Exception:
            ci = None
        cid = cat.cards[ci]["id"] if ci is not None else None
        t0 = es.parse_ts(e["t"])
        hit = next((dn for dn in state.get("auction_done", []) if e.get("fin") is not None and dn[1] == cid
                    and abs(dn[2] - e["fin"]) < 0.005 and t0 and es.parse_ts(dn[0]) and 0 <= (es.parse_ts(dn[0]) - t0).total_seconds() <= 3600), None)
        ship = hit[3] if hit else None
        net = round(e["p"] * (1 + 1 / m), 2) if e.get("p") is not None else None     # p = net - max buy = margin x max buy
        row = {"i": e["i"], "t": e["t"], "tk": e.get("tk"), "card": cid, "ti": e.get("ti"), "u": e.get("u"),
               "bid": round(e["tot"] - ship, 2) if ship is not None else None, "ship": ship, "nb": None, "end": hit[0] if hit else None,
               "tc": es.title_condition(e.get("ti") or ""), "fb": None, "pct": None, "kd": "hit" if e["kd"] == "auction" else "lead",
               "s": None, "net": [net, net], "tier": "clean", "sc": 0, "scr": [], "ph": None, "old": 1, "tot0": e.get("tot"), "dec": e.get("dec")}
        if e.get("fin") is not None:
            row["fin"], row["fb2"] = e["fin"], (hit[4] if hit else None)
            row["fst"] = "nobids" if hit and not hit[4] else "sold"
        hist.append(row)
    hist.sort(key=lambda r: r["t"])


def au_rows(state):
    """The auction view's rows for the live file, oldest dropped after AU_HIST_KEEP_D days."""
    v = state["vps"]
    cut = es.ts(es.NOW - timedelta(days=AU_HIST_KEEP_D))
    v["au_hist"] = [r for r in v.get("au_hist", []) if r["t"] >= cut]
    return [[r["i"], r["t"], r.get("card"), r.get("ti"), r.get("u"), r.get("bid"), r.get("ship"), r.get("nb"), r.get("end"),
             r.get("tc"), r.get("fb"), r.get("pct"), r.get("kd"), r.get("s"), (r.get("net") or [None, None])[0],
             (r.get("net") or [None, None])[1], r.get("tier"), r.get("sc"), r.get("scr") or [], r.get("ph"), r.get("fin"),
             r.get("fb2"), r.get("fst"), r.get("dec"), r.get("old", 0), r.get("tot0"), 1 if r.get("um") else 0] for r in v["au_hist"]]


def auction_finish(state, cards, n):
    """Read the final price of finished auctions (one getItem each): every one Brett was alerted about, plus up to n
    others for the trial, and record whether each closed at or under what the gate would have paid for that card.
    Returns the lookups made."""
    watch, done = state.setdefault("auctions", {}), state.setdefault("auction_done", [])
    cutoff = es.ts(es.NOW - timedelta(minutes=3))
    ended = sorted((a["end"], iid) for iid, a in watch.items() if a["end"] < cutoff)
    todo = [e for e in ended if watch[e[1]].get("al")] + ([e for e in ended if not watch[e[1]].get("al")][-n:] if n > 0 else [])
    used = 0
    for _, iid in todo:                                      # the trial takes the most recently finished: each hour samples itself
        a = watch.pop(iid)
        it = es.api_get(state, f"/buy/browse/v1/item/{iid}", {}, ok_404=True)
        used += 1
        mine = next((r for r in state["vps"].get("au_hist", []) if r["i"] == iid), None) if a.get("al") else None
        if not it:
            if mine is not None:
                mine["fst"] = "gone"                         # eBay no longer has the listing: no result to show
            continue
        try:
            final = float((it.get("currentBidPrice") or it.get("price") or {}).get("value"))
        except (TypeError, ValueError):
            continue
        bids = it.get("bidCount") if it.get("bidCount") is not None else a.get("bids")
        if mine is not None:
            mine["fin"], mine["fb2"], mine["fst"] = final, bids or 0, "sold" if bids else "nobids"
        cs = cards.get(str(a["card"])) or {}
        rec = {"id": iid, "total": final + a["ship"], "item": final, "ship": a["ship"], "tcond": a["tcond"]}
        maxbuy = (es.listing_decision(rec, cs) if a["basis"] == "ebay" else es.lead_decision(rec, cs))[2]
        ref = cs.get("A") if a["basis"] == "ebay" else cs.get("pc")
        allin = round(rec["total"] + final * es.TAX, 2)
        under = bool(bids) and maxbuy is not None and allin <= maxbuy
        done.append([a["end"], a["card"], final, a["ship"], bids or 0, maxbuy, a["basis"], int(under), ref])
        for e in state["vps"].get("alert_log", []) if a.get("al") else []:
            if e["i"] == iid:
                e["fin"] = final                             # the history shows what the auction closed at
        if under:
            log(f"Auction trial: closed UNDER max buy - {a['title']} | final ${final:.2f} + ${a['ship']:.2f} shipping, "
                f"{bids} bids, max buy ${maxbuy:.2f}, reference ${ref} ({a['basis']}) | {a.get('url')}")
    for iid in [k for k, a in watch.items() if a["end"] < es.ts(es.NOW - timedelta(hours=12))]:
        del watch[iid]                                       # never looked up: let it go
    del done[:-5000]
    return used


def auction_summary(state):
    done = [d for d in state.get("auction_done", []) if d[4]]              # finished with at least one bid
    if not done and not state.get("auctions"):
        return None
    under = [d for d in done if d[7]]
    ratios = sorted((d[2] + d[3]) / d[8] for d in done if d[8])
    med = f"{ratios[len(ratios) // 2]:.0%}" if ratios else "-"
    by = Counter(d[6] for d in done)
    hours = Counter(d[0][11:13] for d in under).most_common(3)
    return (f"Auction trial: {len(state.get('auctions', {}))} being watched; {len(done)} finished with bids so far "
            f"({by['ebay']} on judged cards, {by['pc']} on PriceCharting-lead cards), {len(under)} closed at or under max "
            f"buy ({(100 * len(under) / len(done)) if done else 0:.0f}%); median final price is {med} of the reference"
            + (f"; under-max-buy closings by UTC hour: {', '.join(f'{h}h x{n}' for h, n in hours)}" if hours else ""))


# ---------------- publishing ----------------
def git(*args, cwd=LIVE_DIR, check=True):
    env = dict(os.environ)
    env["GIT_SSH_COMMAND"] = f"ssh -i {SSH_KEY} -o UserKnownHostsFile={KNOWN_HOSTS} -o IdentitiesOnly=yes -o BatchMode=yes"
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=env, timeout=120)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()[:300]}")
    return r.stdout


_publishes = 0


def publish(files):
    """Write the files into the one-commit 'live' checkout, amend the commit and force-push it. Keeping the
    checkout between publishes means each push only uploads what changed (the state backup is 1.5 MB)."""
    global _publishes
    if DRY_RUN:
        return
    os.makedirs(LIVE_DIR, exist_ok=True)
    if not os.path.isdir(os.path.join(LIVE_DIR, ".git")):
        git("init", "-q", "-b", "live")
        git("config", "user.name", "pokemon-collector")
        git("config", "user.email", "collector@users.noreply.github.com")
        git("remote", "add", "origin", PUSH_REMOTE)
    for name, data in files.items():
        with open(os.path.join(LIVE_DIR, name), "wb") as f:
            f.write(data)
    git("add", "-A")
    has_commit = subprocess.run(["git", "rev-parse", "--verify", "-q", "HEAD"], cwd=LIVE_DIR, capture_output=True).returncode == 0
    git("commit", "-q", *(["--amend"] if has_commit else []), "-m", f"live {es.ts(es.NOW)}")
    git("push", "-q", "--force", "origin", "live")
    _publishes += 1
    if _publishes % 300 == 0:                                # amended commits leave garbage behind; sweep it up
        subprocess.run(["git", "gc", "-q", "--prune=now"], cwd=LIVE_DIR, capture_output=True)


def code_update():
    """Pull main; if the collector's code changed, ask for a restart (systemd brings it back on the new code)."""
    if DRY_RUN:
        return False
    before = git("rev-parse", "HEAD", cwd=REPO).strip()
    git("fetch", "-q", "origin", "main", cwd=REPO)
    after = git("rev-parse", "origin/main", cwd=REPO).strip()
    if before == after:
        return False
    changed = git("diff", "--name-only", before, after, cwd=REPO).split()
    git("merge", "-q", "--ff-only", "origin/main", cwd=REPO)
    log(f"Code updated {before[:7]} -> {after[:7]}: {', '.join(changed)[:200]}")
    if "requirements.txt" in changed:
        subprocess.run([os.path.join(BASE, "venv", "bin", "pip"), "install", "-q", "-r", os.path.join(REPO, "requirements.txt")], check=False)
    return any(f == "requirements.txt" or (f.endswith(".py") and "/" not in f) for f in changed)


# ---------------- the loop ----------------
def cycle(state, cat, sched, counters):
    read_requests(state)
    cfg = apply_settings(state)
    now = clock(state)
    v = state.setdefault("vps", {})
    t = time.time()

    def due(key, every):
        if t - sched.get(key, 0) >= every:
            sched[key] = t
            return True
        return False

    # 1. limit and budget
    if due("ratelimit", RATELIMIT_EVERY_S):
        fetch_ratelimit(state)
    refill(state)
    remaining = v["remaining"]
    if remaining < SAFETY // 3:
        log(f"Budget: only {remaining} calls left - idling this cycle")
        return
    # 2. discovery: the main query every cycle, the keyword backup every 5 min
    queries = ["aspect"]
    if due("kw", KW_EVERY_S) and not DRY_RUN:
        queries.append("kw")
    if remaining < SAFETY:                                   # nearly out: main query only, and only every other cycle
        queries = ["aspect"] if counters["cycles"] % 2 == 0 else []
    if queries:
        read, new, matched, unmatched = es.sweep(state, cat, queries=queries, overlap_min=SWEEP_OVERLAP_MIN, quiet=True)
        counters["read"] += read; counters["new"] += new; counters["matched"] += matched; counters["unmatched"] += unmatched
        for rec in state["open"].values():                   # indexing lag of the listings that just arrived
            if rec["first"] == es.ts(now) and rec.get("created"):
                c = es.parse_ts(rec["created"])
                if c:
                    v.setdefault("lags", []).append(round((now - c).total_seconds() / 60, 1))
        v["lags"] = v.get("lags", [])[-500:]
    if not v.get("window_ok") and due("selftest", 1800):
        selftest_window(state)
    if not DRY_RUN and remaining > 400 and counters.get("_cards"):
        tr = v.setdefault("auction", {})
        tr.setdefault("until", es.ts(now + timedelta(days=AUCTION_TRIAL_DAYS)))
        if tr.get("hour") != es.ts(now)[:13]:
            tr["hour"], tr["hn"] = es.ts(now)[:13], 0
        trial_on = bool(AUCTION_TRIAL_DAYS) and es.ts(now) < tr["until"]
        alerts_on = bool(NTFY_TOPIC) and cfg.get("auctions", True)
        try:
            if alerts_on and due("au_alert", AUCTION_ALERT_EVERY_S):
                counters["au_alerts"] += auction_alerts(state, cat, counters["_cards"], cfg)
            elif trial_on and not alerts_on and due("auctions", AUCTION_EVERY_S):
                counters["auctions_new"] += auction_read(state, cat, counters["_cards"])
            k = min(AUCTION_LOOKUPS_PER_CYCLE, AUCTION_LOOKUPS_PER_HOUR - tr["hn"]) if trial_on else 0
            if k > 0 or any(a.get("al") for a in state.get("auctions", {}).values()):
                tr["hn"] += auction_finish(state, counters["_cards"], k)
        except Exception as e:
            log(f"Auctions: skipped this minute ({e})")
    if account.linked() and not DRY_RUN and due("account", account.PULL_EVERY_S):
        try:                                                 # Brett's own purchases and sales (read-only; account.py)
            line = account.pull(state)
            account.enrich(state, es)
        except Exception as e:
            line = f"Account: could not be read ({str(e)[:160]})"
        if line != v.get("acct_said"):                       # say it once, not every half hour
            v["acct_said"] = line
            log(line)
    if not DRY_RUN and v.get("trial_runs", 0) < TRIAL_RUNS and remaining > 400 and due("trial", TRIAL_EVERY_S):
        v["trial_runs"] = v.get("trial_runs", 0) + 1
        try:
            aspect_trial(state, cat)
        except Exception as e:
            log(f"Aspect trial: stopped ({e})")
    # 3. optional work, paid for with tokens, in this order:
    #    a. identity lookups for listings that clear the gate (rare, and they decide a hit)
    #    b. window re-reads - they are what notices a listing has gone. When one is due and the bucket cannot pay for
    #       it yet, NOTHING below spends this minute: otherwise the bucket never reaches the price of a big window and
    #       no window is ever read again (that happened twice: the confirmations starved the re-reads for three days,
    #       then the book checks starved both - 0 windows and 0 confirmations an hour on 2026-10-04)
    #    c. one book check for a price-setting copy the re-reads cannot see
    #    d. confirmations of vanished listings, with everything that is left (see confirm_queue for the order)
    #    e. keyword-only listings, scam enrichment
    cards = counters.get("_cards") or {}
    n_id = min(es.VERIFY_MAX_CALLS, int(v.get("tokens", 0))) if cards else 0
    if n_id > 0:
        done = es.verify_hits(state, cat, cards, n_id)
        v["tokens"] -= done
        counters["verified"] += done
    saving = False
    if v.get("window_ok"):
        for last, key, n in due_windows(state, now)[:REREAD_MAX_PER_CYCLE]:
            est = max(1, math.ceil(n * 1.5 / 200))
            if not spend(state, est):
                saving = True
                break
            pages, present, flagged, repriced = reread_window(state, key, n)
            v["tokens"] += est - pages                       # charge what it actually cost
            counters["windows"] += 1; counters["window_pages"] += pages
            counters["flagged"] += flagged; counters["repriced"] += repriced
    if not saving:
        for iid in book_queue(state, cards)[:BOOK_MAX_PER_CYCLE]:
            if not spend(state, COST_BOOK):
                break
            out = confirm(state, iid, state["open"][iid], "book")
            counters["book_" + out] += 1
        for iid in confirm_queue(state, cat)[:CONFIRM_MAX_PER_CYCLE]:
            if not spend(state, COST_CONFIRM):
                break
            out = confirm(state, iid, state["open"][iid], "vanished")
            counters["confirm_" + out] += 1
        for iid in kw_queue(state)[:KW_MAX_PER_CYCLE]:
            if not spend(state, COST_KW):
                break
            out = confirm(state, iid, state["open"][iid], "kw")
            counters["kw_" + out] += 1
        for iid in suspect_queue(state)[:SUSPECT_MAX_PER_CYCLE]:
            if not spend(state, COST_CONFIRM):
                break
            rec = state["open"][iid]
            out = confirm(state, iid, rec, "suspect")        # sold / ended / gone close it here
            counters["sus_" + out] += 1
            if out == "open":
                rec["fin"] = es.ts(es.NOW)
                es.close_outlived(state, iid, rec)           # still up at its last look: it outlived the window
        if due("enrich", ENRICH_EVERY_S):
            n = min(3, int(v.get("tokens", 0)))
            if n > 0:
                before = state["calls"].get(es.TODAY, 0)
                es.enrich(state, n)
                v["tokens"] -= state["calls"].get(es.TODAY, 0) - before
    # 4. housekeeping, statistics, live file
    if cards and due("settle", 3600):                        # needs the cards' books, so not before the first statistics
        res = close_stale(state, cards)
        counters["stale"] += res["record"] + res["count"]
        counters["stale_unknown"] += res["unknown"]
        v["held"] = [res["kept"], res["suspects"]]
        if res["record"] + res["count"] + res["unknown"]:
            log(f"Settled: {res['record'] + res['count']} listings outlived 2 days (stale; {res['record']} keep a full record), "
                f"{res['unknown']} lost sight of; kept in the book: {res['kept']} cheapest copies, {res['suspects']} suspects")
    if due("prune", 3600):
        counters["dropped"] += drop_cheap(state)
        counters["unconfirmed"] += drop_unconfirmed(state)
        es.prune(state)
    es.stamp_pc(state, cat)                                  # listings priced far from PriceCharting = wrong matches
    es.score_listings(state)
    learned = es.learn_tables(state, cat)                    # what Brett's mismatch marks teach (titles, sellers, words)
    es.apply_learning(state, learned)
    lp = es.lp_correction(state)
    es.update_daily(state, lp)
    cards = es.compute_stats(state, cat, lp)
    counters["_cards"] = cards
    live = es.build_live(state, cards, lp)
    if NTFY_TOPIC and not DRY_RUN:
        fresh = [x[0] for x in live["live"] if x[12] == "PASS" and x[17] == "open" and x[0] not in v.get("alerted", {})]
        if fresh and any(not state["open"].get(i, {}).get("idv") for i in fresh) and v.get("tokens", 0) >= 1:
            done = es.verify_hits(state, cat, cards, min(es.VERIFY_MAX_CALLS, int(v["tokens"])))
            v["tokens"] -= done
            counters["verified"] += done
            live = es.build_live(state, cards, lp)           # the lookup may have turned a PASS into an ID conflict
        counters["alerts"] += alert_hits(state, cat, cards, live, cfg)
    live["alert"] = alert_status(state, cfg)
    acct = state.get("acct") or {}
    live["acct"] = {"linked": account.linked(), "pulled": acct.get("pulled"), "ok": acct.get("ok"),
                    "buys": len(acct.get("buys") or {}), "sales": len(acct.get("sales") or {})}
    try:
        live["acct"].update(account.ledger(state, cat, es))  # the Revenue tab's rows
    except Exception as e:
        live["acct"]["rows"], live["acct"]["note"] = [], f"ledger failed: {str(e)[:120]}"
    # every alert ever logged, compact, for "what every hit would have netted": [when, promised profit, kind, answer]
    live["alert"]["all"] = [[e["t"], e.get("p"), e.get("kd"), e.get("dec"), e["i"], e.get("c"), e.get("u"), e.get("tot"),
                             1 if e.get("um") else 0, e.get("ti")] for e in v.get("alert_log", [])]
    live["alert"]["mark_t"] = v.get("mark_t", 0)             # the page shows a tick at once; this confirms it arrived
    live["alert"]["learned"] = {"words": sorted(learned["words"].items(), key=lambda kv: -kv[1])[:40],
                                "titles": len(learned["titles"]), "sellers": len(learned["sellers"])}
    if not v.get("au_backfilled"):
        au_backfill(state, cat)
        v["au_backfilled"] = 1
    live["alert"]["au"] = au_rows(state)                     # every auction sent to the phone, for the Raw Data tab
    live["alert"]["wrong"] = wrong_rows(v)                   # clean listings Brett said were not the matched card
    mm_seed(v)
    live["alert"]["mm"] = {str(k): n for k, n in mm_counts(v).items()}   # per card: [marked, of those alerts, alerts sent]
    live["help"] = {"t": v.get("help_t", 0), "v": v.get("help") or {}}   # descriptions and READMEs he rewrote on the site
    live["source"] = "vps"
    raw = gzip.compress(json.dumps(live, separators=(",", ":")).encode("utf-8"))
    state["runs"] = state.get("runs", 0) + 1
    state_raw = save_state(state)
    # 5. publish, when something changed (or every 10 min regardless, so the "as of" time keeps moving)
    sig = (len(state["open"]), len(state["closed"]), counters["matched"], counters["repriced"], counters["confirm_sold"],
           v.get("alert_t", 0), v.get("test_t", 0), v.get("help_t", 0), v.get("mark_t", 0))         # a change on the Alerts tab is published at once
    changed = sig != v.get("pub_sig")
    if due("publish", PUBLISH_EVERY_S) and (changed or t - sched.get("published", 0) >= 600):
        sched["published"] = t
        v["pub_sig"] = sig
        files = {"ebay_live.bin": es.encrypt_live(raw, es.PASSWORD) if es.PASSWORD else raw}
        try:
            files["collector.log"] = open(LOG_PATH, "rb").read()[-120_000:]
        except Exception:
            pass
        if due("backup", STATE_BACKUP_EVERY_S):
            files[es.STATE_NAME] = es.encrypt_file_blob(state_raw, es.PASSWORD) if es.PASSWORD else state_raw
        try:
            publish(files)
            counters["published"] += 1
        except Exception as e:
            log(f"Publish failed: {e}")
    # 6. hourly summary
    if due("summary", SUMMARY_EVERY_S):
        lags = v.get("lags", [])
        lag_txt = f"median indexing lag {statistics.median(lags):.1f} min" if len(lags) >= 5 else "indexing lag: not enough data"
        log(f"Hour: discovery read {counters['read']} summaries, {counters['new']} new, {counters['matched']} matched, "
            f"{counters['unmatched']} unmatched | re-reads {counters['windows']} windows / {counters['window_pages']} pages, "
            f"{counters['flagged']} flagged, {counters['repriced']} repriced | confirmed: "
            f"{counters['confirm_sold']} sold, {counters['confirm_ended']} ended, {counters['confirm_gone']} gone, "
            f"{counters['confirm_open']} still open | book checks: {counters['book_sold']} sold, {counters['book_ended'] + counters['book_gone']} ended/gone, "
            f"{counters['book_open']} open | kw checks {counters['kw_sold']} sold / {counters['kw_open']} open | "
            f"{counters['stale']} outlived 2 days (stale), {counters['stale_unknown']} lost sight of, "
            f"{counters['dropped']} cheap dropped | suspects' last look: {counters['sus_sold']} sold, "
            f"{counters['sus_ended']} ended, {counters['sus_gone']} gone, {counters['sus_open']} still up | "
            f"{counters['published']} publishes | {lag_txt}")
        log(f"Now: {len(state['open'])} open, {len(state['closed'])} closed, {live['n_cards']} cards with data, "
            f"{live['n_live']} listings in 24 h, {live['n_pass']} pass the gate; budget {v['remaining']} left, "
            f"{v['per_min']} optional calls/min, {int(v.get('tokens', 0))} tokens; {live['calls_today']} calls today")
        held = v.get("held") or [0, 0]
        log(f"Waiting: {len(confirm_queue(state, cat))} listings that vanished inside their first 2 days to confirm, "
            f"{len(due_windows(state, now))} windows due for a re-read, {len(book_queue(state, cards))} book copies due, "
            f"{len(suspect_queue(state))} suspects due a last look; {counters['unconfirmed']} dropped unconfirmed after "
            f"{VANISH_KEEP_D} days; kept past 2 days: {held[0]} cheapest copies, {held[1]} suspects")
        verdicts = Counter(x[12] for x in live["live"])             # where the last 24 h of listings stop at the gate
        log("Verdicts: " + ", ".join(f"{k} {n}" for k, n in verdicts.most_common()))
        anchored = sum(1 for c in cards.values() if c.get("A_n", 0) >= es.ANCHOR_MIN)
        liquid = sum(1 for c in cards.values() if c.get("liquid"))
        log(f"Cards: {anchored} with 5+ sales behind the anchor, {liquid} liquid at the collector's defaults, "
            f"{sum(1 for c in cards.values() if c.get('liquid') and c.get('A_n', 0) >= es.ANCHOR_MIN)} both")
        lam_min = -math.log(1 - es.CONFIDENCE) / (es.SELL_WINDOW_H / 24.0)
        fast = [c for c in cards.values() if c.get("lam") and c["lam"] >= lam_min]
        sts = sorted(c["st"] for c in fast if c.get("st") is not None)
        log(f"Liquidity: {len(fast)} cards sell often enough for the window; their 48-hour sell-through is measured on "
            f"{len(sts)} (median {sts[len(sts) // 2] if sts else '-'}%), {sum(1 for x in sts if x >= es.ST_MIN * 100)} of those "
            f"at or over the {es.ST_MIN:.0%} bar (at 20% / 25% / 30% / 35%: "
            + " / ".join(str(sum(1 for x in sts if x >= b)) for b in (20, 25, 30, 35)) + ")")
        flags = Counter(r.get("pcm") or "-" for r in state["open"].values())
        ids = Counter(r["idv"] for r in state["open"].values() if r.get("idv"))
        log(f"Identity: {flags['low']} open listings under {es.PC_LOW:.0%} of the PriceCharting price, {flags['high']} over "
            f"{es.PC_HIGH:.0%} (kept out of the statistics); item specifics read on {sum(ids.values())} open listings "
            f"({ids['ok']} agree, {ids['conflict']} conflict, {ids['none']} blank), {counters['verified']} read this hour; "
            f"printed totals for {len(cat.totals)} sets")
        by_spec = sum(1 for r in state["open"].values() if (r.get("how") or "").endswith("specifics"))
        log(f"Printing: {by_spec} open listings filed under a printing their item specifics named; "
            f"{len(state.get('pending', {}))} unmatched 'ambiguous variant' listings waiting for a lookup; "
            f"{state.get('printchecks', {}).get(es.TODAY, 0)} printing lookups today")
        hour_ago = es.ts(now - timedelta(hours=1))
        why = Counter("no card #" if u[5].startswith("no card #") else u[5].split(":")[0]
                      for u in state["unmatched"] if u[0] >= hour_ago)
        log("Unmatched this hour: " + (", ".join(f"{k} {n}" for k, n in why.most_common()) or "none"))
        if NTFY_TOPIC:
            log(f"Alerts: {counters['alerts']} hit alerts and {counters['au_alerts']} auction alerts sent this hour to the phone")
        line = auction_summary(state)
        if line:
            log(line + f"; trial ends {v.get('auction', {}).get('until', '?')[:10]}")
        for k in ("Scam screen", "LP correction", "Enrich", "ID check"):
            if k in _es_last:
                log(_es_last[k])
        for k in list(counters):
            if not k.startswith("_"):
                counters[k] = 0
    # 7. code updates
    if due("code", CODE_CHECK_EVERY_S) and code_update():
        save_state(state)
        log("Restarting on the new code.")
        sys.exit(0)


def main():
    if not es.PASSWORD and not DRY_RUN:
        raise SystemExit("SITE_PASSWORD is missing (set it in /etc/pokemon-collector.env)")
    es.log = es_quiet_log
    es.TAX = float(os.environ.get("BUY_TAX_PCT", str(es.TAX * 100))) / 100   # 0 once eBay approves the resale certificate
    _get_token = es.get_token

    def guarded_token():                                     # the module exits on a bad credential; here we retry
        try:
            return _get_token()
        except SystemExit as e:
            raise RuntimeError(str(e))
    es.get_token = guarded_token
    log(f"Collector starting ({'dry run' if DRY_RUN else BASE}); pid {os.getpid()}; buying tax {es.TAX * 100:.2f}%")
    while True:
        try:
            state = load_state()
            state.setdefault("vps", {})
            cat, cat_name = load_catalog(state)
            break
        except Exception as e:
            if DRY_RUN:
                raise
            log(f"Startup failed ({e}); trying again in 5 minutes")
            time.sleep(300)
    kept = cleared = 0
    for rec in state["open"].values():                       # listings the Actions version flagged as missing
        if rec.get("suspect"):
            if es.hours_between(es.parse_ts(rec["first"]), now_utc()) / 24 <= FLAG_MAX_AGE_D:
                if not rec.get("vanished"):
                    rec["vanished"] = rec.get("first")
                kept += 1
            else:                                            # too old to be worth a call; the stale rule closes it
                rec["suspect"] = False
                rec["vanished"] = None
                cleared += 1
    if kept or cleared:
        log(f"Inherited flags: {kept} kept for confirmation, {cleared} cleared as too old")
    state["vps"]["catalog"] = cat_name
    log(f"Catalog {cat_name}; state: {len(state['open'])} open, {len(state['closed'])} closed")
    if NTFY_TOPIC:
        tag = hashlib.sha1(NTFY_TOPIC.encode()).hexdigest()[:10]
        if state["vps"].get("ntfy_hello") != tag and push(
                "Alerts are on", "Your card collector will send hits to this phone. Tap one to check the card before buying.",
                priority=3, tags=("white_check_mark",)):
            state["vps"]["ntfy_hello"] = tag
            log("Phone alerts: channel set, test alert sent")
    else:
        log("Phone alerts: off (no NTFY_TOPIC in /etc/pokemon-collector.env)")
    log("eBay account: linked - purchases and sales are read every half hour" if account.linked() else
        "eBay account: not linked (the Revenue tab needs ebay_link.py run once)")
    if NTFY_TOPIC and not DRY_RUN:                           # can this machine read PriceCharting's card pages at all?
        log("PriceCharting pictures for the check screen: " + ("reachable" if pc_image(state, 960299) else
            "NOT reachable from this machine - the check screen will show the button instead"))
    if state.get("match_v") != es.MATCH_VERSION:              # the matcher changed: correct what the old one filed
        t0 = time.time()
        moved, dropped, cond = es.rematch(state, cat)
        log(f"Re-matched every stored listing with the current matcher in {time.time() - t0:.0f} s: {moved} moved to "
            f"another card, {dropped} dropped as no longer matching, {cond} conditions re-read; now "
            f"{len(state['open'])} open, {len(state['closed'])} closed")
    sched = {"catalog": time.time()}
    counters = defaultdict(int)
    while True:
        t0 = time.time()
        try:
            if time.time() - sched.get("catalog", 0) >= CATALOG_EVERY_S:
                sched["catalog"] = time.time()
                cat, name = load_catalog(state)
                if name != state["vps"].get("catalog"):
                    state["vps"]["catalog"] = name
                    log(f"Catalog refreshed: {name}")
            cycle(state, cat, sched, counters)
            counters["cycles"] += 1
        except SystemExit:
            raise
        except Exception as e:
            log("Cycle failed:\n" + traceback.format_exc()[-1500:])
            time.sleep(300 if "token" in str(e).lower() else 30)    # a bad credential: wait, don't hammer eBay
        if ONCE:
            break
        time.sleep(max(1.0, CYCLE_S - (time.time() - t0)))


if __name__ == "__main__":
    main()
