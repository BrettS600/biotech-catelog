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
import queue
import re
import statistics
import subprocess
import sys
import threading
import time
import traceback
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

import ebay_sweep as es
import account
import pchist                                                # PriceCharting's own monthly history, off each card's page

# ---------------- layout ----------------
BASE = os.environ.get("COLLECTOR_HOME", "/opt/pokemon-collector")
REPO = os.path.join(BASE, "repo")
DATA = os.path.join(BASE, "data")
LIVE_DIR = os.path.join(DATA, "live")                 # one-commit checkout of the "live" branch
ARCHIVE_DIR = os.path.join(DATA, "archive")           # checkout of the "archive" branch: the long-run dataset
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
SAVE_EVERY_S = 180               # the state goes to disk this often (and before every restart), not every cycle: writing 85 MB of
                                 # JSON a minute was most of the droplet's memory churn (2026-10-21); a crash loses 3 minutes
DISK_MIN_MB = 1500               # below this much free space the live checkout is swept (see sweep_live_repo)
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
    if name:                                                 # the day's file can be replaced by a later build (new
        blob = fetch_asset(name)                             # columns), so the bytes decide, not the name: 1.6 MB, 4x a day
        if blob is None:
            raise RuntimeError(f"catalog {name} vanished from the release")
        digest = hashlib.sha256(blob).hexdigest()
        if digest != state.get("vps", {}).get("catalog_sha") or not os.path.exists(CATALOG_CACHE):
            open(CATALOG_CACHE, "wb").write(es.decrypt_file_blob(blob, es.PASSWORD))
            state.setdefault("vps", {})["catalog_sha"] = digest
            if name == cached:
                log(f"Catalog: {name} was replaced on the release; reading the new copy")
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
    raw = es.json_gz(state)                                  # piecewise: no 85 MB JSON string (the 2026-10-21 memory diet)
    if DRY_RUN:
        return raw
    os.makedirs(DATA, exist_ok=True)
    disk_check()
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
    reserve = mins * ((2 / 3 if v.get("facts_big") else 1) + 60 / KW_EVERY_S)   # discovery: every minute, or 2 in 3 during the facts pass
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


def confirm(state, iid, rec, why, cat=None):
    """One getItem: close the listing as sold / ended / gone, or note a false alarm. The first look at a listing
    is the full item with fieldgroups=PRODUCT (same one call, bigger reply; the product container only comes with
    that field group): it carries eBay's catalog product and the seller's item
    specifics, which teach the record and the ePID memory what the card is (es.learn_facts) - the only way to read
    them for every listing that sells without spending a call of its own (Brett, 2026-10-12)."""
    full = cat is not None and "ef" not in rec
    if DRY_RUN:
        it = json.load(open(os.path.join("fixtures", "items.json"))).get(iid)
    else:
        try:
            it = es.api_get(state, f"/buy/browse/v1/item/{iid}", {"fieldgroups": "PRODUCT"} if full else {"fieldgroups": "COMPACT"}, ok_404=True)
        except RuntimeError as e:
            log(f"Confirm: lookup failed for {iid} ({e})")
            return "error"
    if full and it is not None:
        try:
            es.learn_facts(state, cat, rec, it)
        except Exception as e:                        # a surprise in the payload must not cost the confirmation
            log(f"Facts: could not read eBay's facts for {iid} ({e})")
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


FACTS_MAX_PER_CYCLE = 1          # the backlog pass (Brett, 2026-10-13: "option 2 ... return to its previous rate after the
                                 # backlog"): one lookup a minute for a card whose open listings carry no eBay record yet
FACTS_BIG = 100                  # while this many cards or more wait, discovery sits out every third cycle (480 calls a day
                                 # freed) and the reserve shrinks with it; back to every minute by itself when the pile is gone
FACTS_RETRY_D = 3                # a card whose lookup taught nothing is tried again, with another listing, after this long


def facts_backlog(state):
    """Cards with open listings and eBay's record on none of them -> [(card id, listing id)] in the order worth reading:
    cards with the most open listings first; for each, the listing whose product (epid) covers the most open listings
    (one lookup teaches the ePID memory and inherit_facts() fills the rest), else its cheapest copy. A card tried in
    the last FACTS_RETRY_D days waits."""
    tried = state.setdefault("vps", {}).setdefault("facts_tried", {})
    by_card, has, epid_n, n_open = defaultdict(list), set(), Counter(), Counter()
    for iid, r in state["open"].items():
        c = r.get("card")
        if c is None:
            continue
        n_open[c] += 1
        if r.get("ef"):
            has.add(c)
        if r.get("epid"):
            epid_n[str(r["epid"])] += 1
        if "ef" not in r and not r.get("nocheck"):
            by_card[c].append((iid, r))
    out = []
    for c, lst in by_card.items():
        if c in has:
            continue
        t = es.parse_ts(tried.get(str(c)) or "")
        if t and (es.NOW - t).total_seconds() < FACTS_RETRY_D * 86400:
            continue
        iid, _ = max(lst, key=lambda x: (epid_n[str(x[1].get("epid"))] if x[1].get("epid") else 0, -(x[1].get("total") or 1e9)))
        out.append((n_open[c], c, iid))
    out.sort(key=lambda x: -x[0])
    return [(c, iid) for _, c, iid in out]


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


COND_MAX_PER_CYCLE = 1           # the condition pass: a full look at a listing whose title names no condition ...
COND_EVERY_S = 90                # ... at most one every 90 s (960 a day) ...
COND_DAILY_MAX = 400             # ... and this many a day at most, 8% of the API budget


def cond_queue(state, cfg):
    """Listings the Raw Data tab shows as "n/s" that eBay's own condition field would settle (Brett, 2026-10-17):
    matched, first seen in the last 24 h, in the alert price band, not suspect, two or more photos, never looked
    up in full. Dearest first - those are the rows that matter - and each gets ONE full look (confirm with the
    PRODUCT field group), which also teaches the record eBay's set / rarity / finish."""
    day_ago = es.ts(es.NOW - timedelta(hours=24))
    lo, hi = float(cfg.get("pmin") or 0), float(cfg.get("pmax") or 1e9)
    out = []
    for iid, rec in state["open"].items():
        if rec.get("tcond", "UNK") != "UNK" or "ef" in rec or rec.get("cond_tried") or rec.get("card") is None \
                or rec["first"] < day_ago or rec.get("tier") == "suspect" or rec.get("total") is None \
                or not lo <= rec["total"] <= hi or (rec.get("n_img") is not None and rec["n_img"] < 2):
            continue
        out.append((-rec["total"], iid))
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
        if val.get("n"):                                     # a column header renamed on the site (2026-10-08)
            store[key]["n"] = str(val["n"])[:60]
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
    for e in v.get("alert_log", []) + v.get("au_hist", []) + v.get("hit_hist", []):
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


def review_listing(state, iid, same, t):
    """The Review button on the Raw Data tab, the site's copy of the phone's first question. "Not the same" is the
    Mismatch tick (the listing leaves every statistic, is filed as a wrong match, and the matcher learns from it);
    "Same card" clears any mismatch and records a confirmed match, which the learning rules read as a title that
    must never become a warning word (`learn_tables`: good titles). Both are remembered in v["reviews"] so the
    column shows the answer after a reload. `same` None = answer withdrawn."""
    v = state["vps"]
    rv = v.setdefault("reviews", {})
    if same is None:
        rv.pop(iid, None)
        mark_listing(state, iid, False, t)
        return
    same = bool(same)
    rv[iid] = {"v": 1 if same else 0, "t": es.ts(es.NOW)}
    mark_listing(state, iid, not same, t)
    if same:                                                 # a confirmed match: the learning rules treat its title as good
        rec = find_rec(state, iid)
        for e in v.get("alert_log", []) + v.get("au_hist", []) + v.get("hit_hist", []):
            if e["i"] == iid and not e.get("dec"):
                e["dec"], e["dt"] = "yes", es.ts(es.NOW)
        good = v.setdefault("right", [])
        if rec is not None and not any(g["i"] == iid for g in good):
            good.append({"t": es.ts(es.NOW), "i": iid, "ti": rec.get("title"), "card": rec.get("card"), "sl": rec.get("seller")})
        v["right"] = good[-2000:]
    for k in list(rv)[:-20000]:
        del rv[k]
    v["review_t"] = t
    log(f"Review on the site: {'same card' if same else 'not the same'} ({iid})")


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


# ---------------- Favorites (Brett, 2026-10-23: a star on every row; the starred rows gathered on a Favorites tab) ----------------
FAV_MAX = 400                    # favorites kept (the oldest star goes when a new one would be one too many)
FAV_SRC = ("pc", "ec", "er", "fc", "um")   # where a star can come from: the catalog tabs, a listing, a Forecast pick, an unmatched title


def fav_set(state, msg, t):
    """A star clicked on the site: {type: 'fav', t, s: source, k: key (card id, item id), c: card id or null, v: 1 on /
    0 off, m: a few words kept for rows that may leave the data (title, link, price; the Forecast's horizon and
    numbers)}. Kept in v["favs"] as {s:k -> {s, k, c, t, m}}; the live file carries the list (fav_live) and the page
    shows a star at once, confirmed by fav_t. A starred listing's record and photos survive the prune (ebay_sweep:
    fav_listing_ids) and its alert history is never trimmed, so the Favorites tab can always show it."""
    v = state["vps"]
    favs = v.setdefault("favs", {})
    s, k = str(msg.get("s") or "")[:4], str(msg.get("k") if msg.get("k") is not None else "")[:60]
    if s not in FAV_SRC or not k:
        return
    key = f"{s}:{k}"
    if msg.get("v"):
        m = msg.get("m") if isinstance(msg.get("m"), dict) else {}
        m = {str(mk)[:12]: (mv[:120] if isinstance(mv, str) else mv) for mk, mv in list(m.items())[:16] if isinstance(mv, (str, int, float)) or mv is None}
        c = msg.get("c")
        try:
            c = int(c) if c is not None else None
        except (TypeError, ValueError):
            c = None
        favs[key] = {"s": s, "k": k, "c": c, "t": t, "m": m}
        for old in sorted(favs, key=lambda kk: favs[kk]["t"])[:max(0, len(favs) - FAV_MAX)]:
            del favs[old]
    else:
        favs.pop(key, None)
    v["fav_t"] = t
    log(f"Favorite {'added' if msg.get('v') else 'removed'} on the site: {key} ({len(favs)} on file)")


def fav_live(state, cards, live_ids):
    """The Favorites block of the live file: t = the last star taken, list = [[s, k, c, t, m], ...] oldest first, rows =
    the Raw Data row (ebay_sweep.live_row) of every starred listing that is not in the 24-hour table any more, so the
    Favorites tab can show it judged like the rest."""
    v = state["vps"]
    favs = v.get("favs") or {}
    out = {"t": v.get("fav_t", 0), "list": [[f["s"], f["k"], f.get("c"), f["t"], f.get("m") or None] for f in sorted(favs.values(), key=lambda f: f["t"])], "rows": {}}
    for f in favs.values():
        if f["s"] == "er" and f["k"] not in live_ids:
            rec = find_rec(state, f["k"])
            if rec is not None:
                try:
                    out["rows"][f["k"]] = es.live_row(rec, cards.get(str(rec["card"])))
                except Exception:
                    pass                                     # a record the row builder cannot read: the page falls back to the words saved with the star
    return out


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
                for e in v.get("alert_log", []) + v.get("au_hist", []) + v.get("hit_hist", []):
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
        elif msg.get("type") == "review" and msg.get("i"):
            review_listing(state, str(msg["i"])[:60], msg.get("v"), t)
        elif msg.get("type") == "pcimg" and msg.get("c") is not None:   # Review pressed on a card without its picture
            try:
                if pc_worker() is not None:
                    pc_worker().want(int(msg["c"]))
            except (TypeError, ValueError):
                pass
        elif msg.get("type") == "forecast":
            forecast_record(v, msg, t)
        elif msg.get("type") == "read" and msg.get("i"):            # Review pressed on a listing with an incomplete eBay record
            q = v.setdefault("site_read_q", [])
            if str(msg["i"])[:60] not in q:
                q.append(str(msg["i"])[:60])
        elif msg.get("type") == "fav" and msg.get("k") is not None:   # a star clicked on the site (Favorites)
            fav_set(state, msg, t)


# ---------------- Forecast records (Brett, 2026-10-17): the Forecast tab's recorded picks, scored at maturity ----------------
FORECAST_KEEP = 100              # records kept (newest), each with its picks and, once mature, the realized result


def forecast_record(v, msg, t):
    """A forecast Brett recorded on the Forecast tab: {type: 'forecast', t, h (months), cap, disc (bought this far under
    the standard price), fees {fee, fixed, shipOut, supplies, tax}, picks [[card id, qty, buy price, expected net per
    copy], ...], exp / lo / hi (the portfolio's expected net and its 10th / 90th percentile), p (P(net > 0)), reg
    (the market regime), month (the model's data month)}. Kept in the state; scored by forecast_score() at maturity."""
    try:
        h = int(msg.get("h") or 1)
        fees = msg.get("fees") or {}
        rec = {"t": t, "h": h if h in (1, 3, 6) else 1, "cap": round(float(msg.get("cap") or 0), 2), "disc": round(float(msg.get("disc") or 0), 4),
               "fees": {k: round(float(fees.get(k, d)), 6) for k, d in (("fee", 0.1411), ("fixed", 0.4), ("shipOut", 4.5), ("supplies", 0.3), ("tax", 0.0))},
               "picks": [[int(p[0]), int(p[1]), round(float(p[2]), 2), round(float(p[3]), 2)] for p in (msg.get("picks") or [])[:60] if int(p[1]) > 0],
               "exp": round(float(msg.get("exp") or 0), 2), "lo": round(float(msg.get("lo") or 0), 2), "hi": round(float(msg.get("hi") or 0), 2),
               "p": round(float(msg.get("p") or 0), 3), "reg": str(msg.get("reg") or "")[:12], "month": str(msg.get("month") or "")[:7], "done": None}
    except (TypeError, ValueError, KeyError, IndexError):
        return
    if not rec["picks"]:
        return
    recs = v.setdefault("forecasts", [])
    recs.append(rec)
    del recs[:-FORECAST_KEEP]
    v["forecast_t"] = t
    log(f"Forecast recorded: {len(rec['picks'])} cards, ${rec['cap']:.0f} for {rec['h']} month(s), expected net ${rec['exp']:.0f}")


def forecast_score(v, cat, cards=None):
    """A record whose hold is up (t + h x 30 days) is scored once with what the card sells for on eBay now - the sold
    median A from the card stats, PriceCharting's price for a card without one (the tab projects the sale the same
    way): realized net per copy = P1 x (1 - fee) - fixed - shipping - supplies - buy x (1 - discount) x (1 + tax)."""
    now_ms = time.time() * 1000
    for rec in v.get("forecasts", []):
        if rec.get("done") or now_ms < rec["t"] + rec["h"] * 30 * 86400000:
            continue
        f, total, rows = rec["fees"], 0.0, []
        for cid, qty, buy, exp in rec["picks"]:
            p1 = ((cards or {}).get(str(cid)) or {}).get("A") or (cat.by_id.get(cid) or {}).get("pc")
            if not p1:
                rows.append([cid, None, None])
                continue
            net = p1 * (1 - f["fee"]) - f["fixed"] - f["shipOut"] - f["supplies"] - buy * (1 - rec["disc"]) * (1 + f["tax"])
            rows.append([cid, round(p1, 2), round(net, 2)])
            total += net * qty
        rec["done"], rec["actual"], rec["res"] = es.ts(es.NOW), round(total, 2), rows
        v["forecast_t"] = int(now_ms)
        log(f"Forecast scored: recorded {rec['t']}, expected net ${rec['exp']:.0f}, realized ${total:.0f}")


SITE_READS_PER_HOUR = 60         # Review pressed on the site: one full look per press, at most this many an hour


def site_reply(obj):
    """An answer for the page on the channel's reply topic (<channel>-pcr), signed like everything else on it."""
    if DRY_RUN or not es.PASSWORD:
        return
    topic, key = alert_channel()
    body = json.dumps(dict(obj, t=int(time.time() * 1000)), separators=(",", ":"))
    try:
        requests.post(f"{NTFY_SERVER}/{topic}-pcr", data=json.dumps({"m": body, "s": hmac.new(key, body.encode(), "sha256").hexdigest()}).encode(), timeout=5)
    except Exception:
        pass


def site_read(state, cat, iid):
    """Review pressed on the site for a listing whose eBay record is incomplete (Brett, 2026-10-23: "no photo on file",
    "not read", n/s where the listing states its condition): one full getItem now, whatever the listing's state - open
    (the record learns like any confirmation and a sold listing closes), closed, or an alerted auction / hit kept only
    in the histories - and the answer goes straight back to the page on the reply topic (the live file follows at the
    next publish). One call per press; SITE_READS_PER_HOUR caps it. -> True when something was read."""
    v = state["vps"]
    box = v.setdefault("site_reads", {})
    if box.get("hour") != es.ts(es.NOW)[:13]:
        box["hour"], box["n"] = es.ts(es.NOW)[:13], 0
    if box["n"] >= SITE_READS_PER_HOUR:
        return False
    box["n"] += 1
    rec = state["open"].get(iid)
    hist = [e for e in v.get("au_hist", []) + v.get("hit_hist", []) if e.get("i") == iid]
    closed = None if rec is not None else next((r for r in state["closed"] if r.get("id") == iid), None)
    if rec is None and closed is None and not hist:
        return False
    if DRY_RUN:
        it = json.load(open(os.path.join("fixtures", "items.json"))).get(iid)
    else:
        try:
            it = es.api_get(state, f"/buy/browse/v1/item/{iid}", {"fieldgroups": "PRODUCT"}, ok_404=True)
        except RuntimeError as e:
            log(f"Site read: lookup failed for {iid} ({e})")
            return False
    if it is None:
        site_reply({"type": "read", "i": iid, "gone": 1})
        log(f"Site read: {iid} is no longer on eBay")
        return True
    src = rec if rec is not None else closed
    probe = rec if rec is not None else {"id": iid, "card": (src or hist[0]).get("card"), "title": (src or {}).get("title") or hist[0].get("ti") or "",
                                        "epid": (src or {}).get("epid") or "", "tcond": (src or {}).get("tcond") or hist[0].get("tc") or "UNK"}
    es.item_facts(probe, it)                                 # photos, photo count, quantity, returns, eBay's condition
    if probe.get("card") is not None:
        try:
            es.learn_facts(state, cat, probe, it)            # eBay's set / rarity / finish, compared with the card
        except Exception as e:
            log(f"Site read: facts failed for {iid} ({e})")
    fields = {"img": probe.get("img") or ((it.get("image") or {}).get("imageUrl")), "imgs": (probe.get("imgs") or [])[:es.IMGS_KEEP],
              "tc": probe.get("tcond", "UNK"), "ec": probe.get("ec", ""), "ef": es.facts_row(probe), "ph": probe.get("n_img")}
    if rec is not None:
        rec["checked"], rec["cond_tried"] = es.ts(es.NOW), 1
        rec.setdefault("img", fields["img"])
        kind, price, end = es.classify(it)
        if kind in ("sold", "ended"):                        # the look doubles as a confirmation
            es.close_listing(state, iid, rec, kind, end or es.NOW, None if price is None else round(price + (rec.get("ship") or 0), 2))
    if closed is not None:
        closed.update({k: probe[k] for k in ("ef", "ec", "ecc", "tcond", "n_img") if k in probe})
        closed["img"] = closed.get("img") or fields["img"]
        if fields["imgs"]:
            closed["imgs"] = fields["imgs"]
    for e in hist:                                           # the auction / hit history rows: photos, condition, facts
        e["img"] = e.get("img") or fields["img"]
        if fields["imgs"]:
            e["imgs"] = fields["imgs"]
        if fields["tc"] != "UNK":
            e["tc"] = fields["tc"]
        e["ec"] = fields["ec"]
        if "ef" in probe:
            e["ef"] = probe["ef"]
        if fields["ph"] is not None:
            e["ph"] = fields["ph"]
    site_reply(dict(fields, type="read", i=iid))
    log(f"Site read: {iid} ({probe.get('title', '')[:50]}) - {len(fields['imgs'])} photos, condition {fields['tc']}"
        f"{' (' + fields['ec'] + ')' if fields['ec'] else ''}, facts {'read' if fields['ef'] else 'none'}")
    return True


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


PC_LAST_READ = {}                # what the last page read looked like: status code, seconds, error - for the log
PC_COOKIE = os.environ.get("PC_COOKIE", "").strip().strip('"').strip("'")   # Brett's PriceCharting sign-in (/etc/pokemon-collector.env):
                                 # their chart's volume bars are served to signed-in subscribers only (2026-10-12)
PC_SIGNIN_CLUES = {}             # once per kind (page with / without the volume series): what the page said about the sign-in
PC_SIGNIN_STRIKES = 5            # pages in a row without the volume series before the sign-in counts as lost
PC_JAR_PATH = os.path.join(DATA, "pc_cookies.txt")   # the PriceCharting sign-in as a browser keeps it (an LWP cookie file)
_pc_sess = {}                    # {"s": the requests session, "snap": the jar as last saved}
_pc_lock = threading.Lock()


def pc_session():
    """One requests session for PriceCharting with a cookie jar that lives on disk like a browser's: seeded from
    PC_COOKIE (vgpc_daily left out - the site re-issues its daily cookie when it sees none, which is how a browser
    keeps a sign-in alive), then kept up to date from every Set-Cookie the site sends, so a session the site extends
    or rotates stays signed in with no hand on the env file (Brett, 2026-10-12: "I don't want to remember resetting
    cookies"). A new PC_COOKIE (a different vgpc_session) reseeds the jar; the seed's fingerprint is kept beside it."""
    s = _pc_sess.get("s")
    if s is not None:
        return s
    import requests
    from http.cookiejar import LWPCookieJar, Cookie
    jar = LWPCookieJar(PC_JAR_PATH)
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
    except Exception:
        pass
    seed = {}
    for part in PC_COOKIE.split(";"):
        if "=" in part:
            k, val = part.strip().split("=", 1)
            seed[k.strip()] = val.strip()
    fp = hashlib.sha256(seed.get("vgpc_session", "").encode()).hexdigest()[:16]
    try:
        had = open(PC_JAR_PATH + ".seed").read().strip()
    except Exception:
        had = ""
    fresh = bool(seed) and fp != had
    if fresh:                                                # a cookie just pasted (or changed): start the jar from it
        jar.clear()
        for k, val in seed.items():
            if k and k != "vgpc_daily":
                jar.set_cookie(Cookie(0, k, val, None, False, ".pricecharting.com", True, True, "/", True, False, None, False, None, None, {}))
        try:
            jar.save(ignore_discard=True, ignore_expires=True)
            open(PC_JAR_PATH + ".seed", "w").write(fp)
        except Exception as e:
            log(f"PriceCharting sign-in: the cookie jar could not be saved ({str(e)[:80]})")
    s = requests.Session()
    s.cookies = jar
    _pc_sess.update(s=s, snap=pc_jar_snapshot(jar), fresh=fresh, n=sum(1 for _ in jar))
    return s


def pc_jar_snapshot(jar):
    return tuple(sorted((c.name, c.value, c.expires or 0) for c in jar))


def pc_jar_keep(s):
    """After a page read: when the site changed a cookie, keep the jar on disk (names only in the log, never values).
    LastViewedItems (the site's "recently viewed" list, rewritten on every page) is dropped: it is not part of the
    sign-in and would otherwise rewrite the jar on every read."""
    for c in [c for c in s.cookies if c.name == "LastViewedItems"]:
        try:
            s.cookies.clear(c.domain, c.path, c.name)
        except KeyError:
            pass
    snap = pc_jar_snapshot(s.cookies)
    if snap == _pc_sess.get("snap"):
        return
    was = {n for n, _, _ in _pc_sess.get("snap") or ()}
    _pc_sess["snap"] = snap
    try:
        s.cookies.save(ignore_discard=True, ignore_expires=True)
    except Exception as e:
        log(f"PriceCharting sign-in: the cookie jar could not be saved ({str(e)[:80]})")
        return
    names = sorted({n for n, _, _ in snap})
    changed = sorted({n for n, v, e in snap} - was) or ["(a value or expiry)"]
    if _pc_sess.get("logged", 0) < 5:                        # the first few changes, for the record
        _pc_sess["logged"] = _pc_sess.get("logged", 0) + 1
        log(f"PriceCharting sign-in: the site updated the cookie jar (new or changed: {changed}; jar now {names})")


def pc_signin_startup_note():
    if not PC_COOKIE:
        return "none (no PC_COOKIE in /etc/pokemon-collector.env): prices without the volume bars"
    try:
        pc_session()
        n, fresh = _pc_sess.get("n", 0), _pc_sess.get("fresh")
        return (f"set - cookie jar {'seeded from PC_COOKIE just now' if fresh else 'kept from the earlier runs'} ({n} cookies, "
                f"updated from the site as it goes); the first page read tells whether it works")
    except Exception as e:
        return f"set, but the cookie jar failed ({str(e)[:80]})"


def pc_signin_clues(r):
    """For the log, once per kind of page: did the page come back signed in? (VGPC.user_id, the words on the page,
    the redirects, the cookies the server set - names only, never values)."""
    html = r.text
    uid = re.search(r"VGPC\.user_id\s*=\s*([^;\n]{0,40})", html)
    words = {w: len(re.findall(w, html, re.I)) for w in ("logout", "log out", "sign out", "log in", "sign in", "volume_data", "pricecharting-pro", "subscri")}
    try:
        setc = sorted(set(c.split("=", 1)[0].strip() for c in r.raw.headers.getlist("Set-Cookie")))
    except Exception:
        setc = ["?"]
    sent = sorted(c.name for c in _pc_sess["s"].cookies) if _pc_sess.get("s") else [p.split("=", 1)[0].strip() for p in PC_COOKIE.split(";") if "=" in p]
    return (f"{len(r.history)} redirect(s) to {r.url}; VGPC.user_id = {uid.group(1).strip() if uid else '?'}; words {words}; "
            f"server set cookies {setc or 'none'}; sent {sent}")


def pc_read_page(pid):
    """One PriceCharting card page -> (status, picture address, monthly history, note). status: "ok" (a picture),
    "none" (the page has no picture, or does not exist), "error" (could not be read just now; the background reader
    then backs off). The history (pchist.extract: the data behind the chart on the page) comes with the same read;
    None when the page carries none."""
    t0 = time.time()
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) personal card check, one page per card"}
    try:
        import requests
        if PC_COOKIE:                                        # read as Brett: the page then carries the volume series
            with _pc_lock:
                s = pc_session()
                r = s.get(f"https://www.pricecharting.com/game/{pid}", timeout=15, headers=headers)
                pc_jar_keep(s)
        else:
            r = requests.get(f"https://www.pricecharting.com/game/{pid}", timeout=15, headers=headers)
    except Exception as e:
        PC_LAST_READ.update(code=None, s=time.time() - t0, err=str(e)[:80])
        return "error", None, None, ""
    PC_LAST_READ.update(code=r.status_code, s=time.time() - t0, err=None)
    if r.status_code == 404:
        return "none", None, None, "no such page"
    if r.status_code != 200:
        return "error", None, None, ""
    m = PC_IMG.search(r.text)
    try:
        hist, note = pchist.extract(r.text)
    except Exception as e:
        hist, note = None, f"history parse failed: {str(e)[:80]}"
    if PC_COOKIE and hist is not None and bool(hist.get("s")) not in PC_SIGNIN_CLUES:
        try:
            PC_SIGNIN_CLUES[bool(hist.get("s"))] = pc_signin_clues(r)
        except Exception as e:
            PC_SIGNIN_CLUES[bool(hist.get("s"))] = f"clues failed: {str(e)[:80]}"
    return ("ok", f"https://storage.googleapis.com/images.pricecharting.com/{m.group(1)}/1600.jpg", hist, note) if m else ("none", None, hist, note)


def pc_read_image(pid):
    """(status, picture address) - the page read without the history."""
    status, url, hist, _ = pc_read_page(pid)
    if status != "error":
        try:
            pchist.file(pid, hist)                           # never waste a page read
        except Exception:
            pass
    return status, url


def pc_image(state, pid):
    """PriceCharting's own picture of a card, for the phone's check screen (Brett compares it with the eBay photo:
    a listing whose title and item specifics both name one card while the photo shows another can only be caught
    by eye). Their data feed has no image field, so the address is read off the card's public page - one page per
    card. Their terms have no rule against it and robots.txt allows /game/ (both read 2026-10-05). Usually the
    background reader (`PcImageWorker`) has the picture on file already; otherwise the page is read now. None when
    it cannot be had; the screen then shows the button instead."""
    cache = state["vps"].setdefault("pc_img", {})
    if str(pid) in cache:
        return cache[str(pid)]
    status, url = pc_read_image(pid)
    if not url:
        return None                                          # not remembered: the next alert for this card tries again
    cache[str(pid)] = url
    for k in list(cache)[:-12000]:                           # every card with eBay data, with room to spare
        del cache[k]
    return url


PC_PREFETCH_GAP_S = 2.0          # the background reader waits this long between PriceCharting pages (30 a minute)
PC_HIST_PUBLISH_S = 600          # changed history shards go to the live branch this often
PCM_PUBLISH_S = 3600             # pcm.bin (every card's last complete month of PriceCharting sales) goes out hourly
PC_IMG_FAIL_RETRY_D = 7          # a card whose page gave no picture is tried again after this many days


class PcImageWorker(threading.Thread):
    """Reads PriceCharting's picture for every card the Review button on the site can be pressed for, in the
    background, so the site has the picture ready the way the phone does. A card Brett asks for (Review pressed on a
    card without one) goes first; otherwise the reader follows the plan the main loop hands it each cycle
    (`pc_plan`: newest listings first, then every card with eBay data). One page every PC_PREFETCH_GAP_S seconds
    while there is a backlog - the whole backlog is read in a few hours, after which only new cards need a read.
    PriceCharting page reads, not eBay calls. The thread never touches the state: what it finds goes through
    `results`, and the main loop files it (`file_pc_images`). On a page it cannot read it backs off (a minute, then
    a quarter of an hour after five failures in a row)."""

    def __init__(self, state):
        super().__init__(daemon=True, name="pc-images")
        self.state, self.lock = state, threading.Lock()
        self.plan, self.wanted, self.done = deque(), deque(), set()
        self.wanted_hist = deque()                           # cards whose history the site asked to refresh now
        self.results = queue.Queue()
        self.errors, self.paused_until, self.read = 0, 0.0, 0
        self.gap, self.streak, self.logged = PC_PREFETCH_GAP_S, 0, 0.0   # the gap adapts to what their site tolerates
        self.req_since, self.polled, self.tries = None, 0.0, {}
        self.rush = False                                    # the card being read was asked for from the site's chart

    def set_plan(self, cards):
        """cards: [(card id, picture wanted)] - a card read for its history alone does not fill the picture cache."""
        with self.lock:
            self.plan, self.done = deque(cards), set()

    def want(self, cid):                                     # from the site: first in line
        with self.lock:
            if cid not in self.wanted:
                self.wanted.append(cid)

    def want_hist(self, cid):                                # from the site: read the page again for its history
        with self.lock:
            if cid not in self.wanted_hist:
                self.wanted_hist.append(cid)

    def backlog(self):
        return len(self.plan) + len(self.wanted)

    def poll_requests(self):
        """Picture requests from the site's Review button arrive on their own topic (<channel>-pc), so this thread can
        look every few seconds instead of once a cycle; the answer goes back on <channel>-pcr the moment the page has
        been read (`answer`), and the page shows the picture without waiting for the next live file (which the raw
        CDN holds for up to five minutes anyway). Same signature as the main channel."""
        self.polled = time.time()
        if DRY_RUN or not es.PASSWORD:
            return
        topic, key = alert_channel()
        try:
            import requests
            r = requests.get(f"{NTFY_SERVER}/{topic}-pc/json", params={"poll": "1", "since": self.req_since or "2m"}, timeout=5)
            lines = r.text.splitlines() if r.status_code == 200 else []
        except Exception:
            return
        for line in lines:
            try:
                ev = json.loads(line)
                if ev.get("event") != "message":
                    continue
                self.req_since = ev["id"]
                env = json.loads(ev["message"])
                if not hmac.compare_digest(hmac.new(key, env["m"].encode(), "sha256").hexdigest(), str(env.get("s"))):
                    continue
                msg = json.loads(env["m"])
                if msg.get("type") in ("pcimg", "pchist") and msg.get("c") is not None and abs(time.time() * 1000 - int(msg["t"])) < 600_000:
                    (self.want if msg["type"] == "pcimg" else self.want_hist)(int(msg["c"]))
            except Exception:
                continue

    def answer(self, cid, url):
        """Tell the page what the read found: the picture's code, or None when PriceCharting has no picture."""
        if DRY_RUN or not es.PASSWORD:
            return
        topic, key = alert_channel()
        m = PC_IMG_ID.search(url or "")
        body = json.dumps({"type": "pcimg", "c": cid, "code": m.group(1) if m else None, "t": int(time.time() * 1000)}, separators=(",", ":"))
        try:
            import requests
            requests.post(f"{NTFY_SERVER}/{topic}-pcr", data=json.dumps({"m": body, "s": hmac.new(key, body.encode(), "sha256").hexdigest()}).encode(), timeout=5)
        except Exception:
            pass

    def next_card(self):
        cache = self.state["vps"].get("pc_img", {})
        cid, urgent, want_img, ready = None, False, True, []
        with self.lock:
            while self.wanted:
                c = self.wanted.popleft()
                if str(c) in cache:                          # read already - the page's live file runs minutes behind
                    ready.append(c)
                    continue
                cid, urgent = c, True
                break
            if cid is None and self.wanted_hist:              # a chart Brett has open: its page is read now
                cid, want_img, self.rush = self.wanted_hist.popleft(), False, True
            if cid is None:
                while self.plan:
                    c, want_img = self.plan.popleft()
                    if c not in self.done:                   # read once per plan, even if filed later
                        cid = c
                        break
            if cid is not None:
                self.done.add(cid)
        for c in ready:                                      # so tell the page now, from what is on file
            self.answer(c, cache.get(str(c)))
        return cid, urgent, want_img

    def step(self):
        cid, urgent, want_img = self.next_card()
        if cid is None:
            return False
        status, url, hist, note = pc_read_page(cid)
        rush, self.rush = self.rush, False
        self.results.put((cid, status, url, hist, note, urgent or rush, want_img))
        if urgent:                                           # the site is waiting: answer now, or try again shortly
            if status != "error":
                self.answer(cid, url)
            elif self.tries.get(cid, 0) < 3:
                self.tries[cid] = self.tries.get(cid, 0) + 1
                self.want(cid)
        if status == "error":
            self.errors += 1
            self.streak = 0
            lr = PC_LAST_READ
            refused = lr.get("code") in (403, 429, 503)      # their site said no: back right off
            if refused or self.errors >= 3:
                self.gap = min(30.0, self.gap * 2)
                self.paused_until = time.time() + (900 if self.errors >= 5 else 60)
            else:                                            # a slow or dropped page: carry on; the card comes round again
                self.paused_until = time.time() + 5
            if time.time() - self.logged > 600:              # one line per ten minutes, with what the read looked like
                self.logged = time.time()
                log(f"PriceCharting pictures: page read failed (HTTP {lr.get('code')}, {lr.get('s', 0):.1f} s"
                    f"{', ' + lr['err'] if lr.get('err') else ''}); {self.errors} in a row, "
                    f"{'pausing 15 min' if self.errors >= 5 else 'pausing 60 s' if refused or self.errors >= 3 else 'carrying on'}, "
                    f"one page every {self.gap:g} s")
        else:
            self.errors = 0
            self.read += 1
            self.streak += 1
            if self.streak >= 20 and self.gap > PC_PREFETCH_GAP_S:    # a run of good reads: speed back up, gently
                self.streak = 0
                self.gap = max(PC_PREFETCH_GAP_S, self.gap * 0.75)
        return True

    def run(self):
        while True:
            try:
                if time.time() - self.polled >= 4:
                    self.poll_requests()
                if time.time() < self.paused_until or not self.step():
                    time.sleep(2)
                else:
                    time.sleep(self.gap)
            except Exception:
                time.sleep(30)


PC_WORKER = None


def pc_worker(state=None):
    """The one background reader, started on the first call that brings the state (main); None before that."""
    global PC_WORKER
    if PC_WORKER is None and state is not None:
        PC_WORKER = PcImageWorker(state)
        if not DRY_RUN:
            PC_WORKER.start()
    return PC_WORKER


PC_REST_ORDER = {}               # catalog id -> the rest of the catalog by price, computed once per catalog


def pc_plan(state, cards, cat=None):
    """The order the background reader takes cards in: the newest listings' cards first (the top of the Raw Data
    tab), then every card with eBay data, then the rest of the catalog by price. A card is in the plan when its
    picture is wanted (the first two groups, no picture on file and no miss this week) or its PriceCharting history
    is due (pchist.stale: never read, or older than a week for cards with eBay data, a month otherwise).
    -> [(card id, picture wanted)]."""
    v = state["vps"]
    cache, miss = v.get("pc_img", {}), v.get("pc_miss", {})
    today = datetime.strptime(es.TODAY, "%Y-%m-%d")

    def fresh_miss(k):
        d = miss.get(k)
        return d is not None and (today - datetime.strptime(d, "%Y-%m-%d")).days < PC_IMG_FAIL_RETRY_D
    cut = es.ts(es.NOW - timedelta(hours=24))
    recent = sorted((rec for rec in state["open"].values() if rec["first"] >= cut and rec.get("card") is not None),
                    key=lambda r: r["first"], reverse=True)
    active = {int(c) for c in cards}
    rest = []
    if cat is not None:
        if PC_REST_ORDER.get("cat") is not cat:              # holds the catalog object, so a new one is never mistaken for it
            PC_REST_ORDER.clear()
            PC_REST_ORDER["cat"] = cat
            PC_REST_ORDER["ids"] = [c["id"] for c in sorted(cat.cards, key=lambda c: -(c.get("pc") or 0))]
        rest = PC_REST_ORDER["ids"]
    out, seen = [], set()
    today_i = pchist.day_index()
    want_signed = bool(PC_COOKIE) and v.get("pch_signin") != "expired"   # a sign-in that works (or is untested): re-read for the bars
    for group, ids in enumerate(([r["card"] for r in recent], list(active), rest)):
        for cid in ids:
            k = str(cid)
            if cid in seen:
                continue
            want_img = group < 2 and k not in cache and not fresh_miss(k)
            if want_img or pchist.stale(cid, active=cid in active, today=today_i, want_signed=want_signed):
                seen.add(cid)
                out.append((cid, want_img))
    return out


def file_pc_images(state, worker):
    """File what the background reader found since the last cycle (it never writes the state itself). Returns how
    many pages were read and how many of them were cards Brett had asked for from the site - those get published at
    once."""
    v = state["vps"]
    cache, miss = v.setdefault("pc_img", {}), v.setdefault("pc_miss", {})
    n = urgent = 0
    if worker is None:
        return 0, 0
    while True:
        try:
            cid, status, url, hist, note, urg, want_img = worker.results.get_nowait()
        except queue.Empty:
            break
        k = str(cid)
        n += 1
        if status != "error":                                # the page was read: file the history it carried
            try:
                pchist.file(cid, hist)
                if PC_COOKIE and hist is not None:           # does the sign-in work? the page carries the volume series when it does
                    was = v.get("pch_signin")
                    if hist.get("s"):
                        v["pch_nosig"], v["pch_signin"] = 0, "ok"
                    else:                                    # one page without the series proves nothing (2026-10-13: a run of
                        v["pch_nosig"] = v.get("pch_nosig", 0) + 1   # no-sales pages flipped the verdict - and the phone - every minute)
                        if v["pch_nosig"] >= PC_SIGNIN_STRIKES:
                            v["pch_signin"] = "expired"
                    if v["pch_signin"] != was:
                        log("PriceCharting sign-in: " + ("working - pages carry the volume series" if hist.get("s") else
                            "the page came WITHOUT the volume series: the PC_COOKIE in /etc/pokemon-collector.env has expired "
                            "or was not accepted. The chart keeps the bars it has until it is replaced and the service restarted")
                            + "; the page: " + PC_SIGNIN_CLUES.get(bool(hist.get("s")), "?"))
                        if v["pch_signin"] == "expired" and time.time() - v.get("pch_push_t", 0) > 86400:   # the phone: once a day at most
                            v["pch_push_t"] = time.time()
                            push("PriceCharting sign-in expired",
                                 "The collector's PriceCharting session no longer works, so new months get no volume bars (the bars "
                                 "already on file stay). When convenient: copy a fresh vgpc_session from Chrome, put it in "
                                 "PC_COOKIE in /etc/pokemon-collector.env, systemctl restart pokemon-collector.", priority=3, tags=("key",))
                if len(pchist.SHAPES) and v.get("pch_shape_logged") != 4:   # the first page: what it carried, once
                    v["pch_shape_logged"] = 4
                    sh = pchist.SHAPES[0]
                    log(f"PriceCharting history: first page read for card {cid}: series {json.dumps(sh['shape'])}; "
                        f"first points {json.dumps(sh['first'])[:400]}; {sh['how']}; months {sh['months']}")
                if hist is None and note and counters_note(v, note):
                    log(f"PriceCharting history: card {cid}: {note[:200]}")
            except Exception as e:
                log(f"PriceCharting history: could not file card {cid} ({str(e)[:120]})")
        if status == "ok":
            if want_img or urg:
                cache[k] = url
            miss.pop(k, None)
            urgent += 1 if urg else 0
        elif status == "none" and (want_img or urg):
            miss[k] = es.TODAY
    for k in list(cache)[:-12000]:
        del cache[k]
    for k in list(miss)[:-5000]:
        del miss[k]
    return n, urgent


def counters_note(v, note):
    """Log a 'page carried no history' reason at most a few times a day, so a changed page layout shows up."""
    key = "pch_notes_" + es.TODAY
    v[key] = v.get(key, 0) + 1
    for k in [k for k in v if k.startswith("pch_notes_") and k != key]:
        del v[k]
    return v[key] <= 3


def pc_image_table(state):
    """Card id -> the unique part of its PriceCharting picture address, for the site (the page rebuilds the address).
    About 15 KB compressed for 7,000 cards."""
    out = {}
    for k, url in state["vps"].get("pc_img", {}).items():
        m = PC_IMG_ID.search(url or "")
        if m:
            out[k] = m.group(1)
    return out


PC_IMG_ID = re.compile(r"images\.pricecharting\.com/([A-Za-z0-9_-]+)/")


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
            "rp": [list(t) for t in (cs.get("tw") or [0, []])[1]],
            # set name, rarity and finish from both sides (2026-10-12): the card's own words (cardfacts.py, the daily
            # build) and eBay's record of this listing - es.facts_row: None = not read, [] = nothing on the listing
            "rf": [c.get("rarity") or "", c.get("finish") or ""], "ef": es.facts_row(rec)}


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


def card_matches(state, cids):
    """{card id: listings the matcher has filed under the card, open and closed}, for the cards asked about - so a
    mismatch count can be read against how often the card is matched at all (Brett, 2026-10-08)."""
    want = set(cids)
    out = {c: 0 for c in want}
    if want:
        for rec in list(state["open"].values()) + list(state["closed"]):
            c = rec.get("card")
            if c in want:
                out[c] += 1
    return out


def match_table(state):
    """{card id: [listings Brett marked as the same card, listings he marked as not this card, listings the matcher
    filed under the card]} for every card with a listing or a mark on record. The "match:mismatch" column on both
    eBay tabs shows the first two - only what Brett marked himself, so most cards read 0:0 (Brett, 2026-10-09: "I
    only want to see where I specifically marked it as a match"); the matcher's own count rides along third, for
    the cell's tooltip. A mark counts once per listing however it was given - the site's Review button ("Same card"
    / "Not the same"), the Mismatch tick, or the phone's Yes / NM / LP / No - and a listing marked both ways counts
    the way its mismatch mark says, since that is the mark the statistics follow."""
    v = state["vps"]
    closed_by_id = {r.get("id"): r for r in state["closed"]}

    def card_of(iid, hint=None):
        if hint is not None:
            return hint
        rec = state["open"].get(iid) or closed_by_id.get(iid)
        return rec.get("card") if rec else None

    wrong_ids, good_ids = {}, {}                             # listing id -> card, one mark per listing
    for w in v.get("wrong", []):
        c = card_of(w.get("i"), w.get("card")) if w.get("i") else None
        if c is not None:
            wrong_ids.setdefault(str(w["i"]), c)
    for g in v.get("right", []):                             # "Same card" on the site
        c = card_of(g.get("i"), g.get("card")) if g.get("i") else None
        if c is not None:
            good_ids.setdefault(str(g["i"]), c)
    for iid, r in v.get("reviews", {}).items():
        if r.get("v") == 1:
            c = card_of(iid)
            if c is not None:
                good_ids.setdefault(str(iid), c)
    for e in v.get("alert_log", []) + v.get("au_hist", []) + v.get("hit_hist", []):
        if e.get("dec") in ("yes", "nm", "lp") and e.get("i") and not e.get("um"):      # "Yes, same card" on the phone
            c = card_of(e["i"], e.get("card"))
            if c is not None:
                good_ids.setdefault(str(e["i"]), c)
    for iid in wrong_ids:
        good_ids.pop(iid, None)
    auto = Counter(rec["card"] for rec in list(state["open"].values()) + state["closed"] if rec.get("card") is not None)
    good, wrong = Counter(good_ids.values()), Counter(wrong_ids.values())
    return {str(c): [good.get(c, 0), wrong.get(c, 0), auto.get(c, 0)] for c in set(good) | set(wrong) | set(auto)}


def hits_30d(state):
    """{card id: alerts sent on the card in the last 30 days} - Buy It Now hits from the hit history, auctions from
    the auction history. Deal flow per card: the cards that actually produce buys."""
    v = state["vps"]
    cut = es.ts(es.NOW - timedelta(days=30))
    out = Counter()
    for e in v.get("hit_hist", []) + v.get("au_hist", []):
        if e.get("t", "") >= cut and e.get("card") is not None:
            out[e["card"]] += 1
    return {str(c): n for c, n in out.items()}


def hit_listings_30d(state):
    """{card id: Buy It Now listings that got a hit in the last 30 days}, each listing once (a price-drop re-alert
    is the same listing). The Hit % numerator (Brett, 2026-10-13: "if 100 were listed and 30 got a hit, 30%"); the
    denominator is the card's n30 (comparable listings first seen in 30 days, compute_stats). Auctions are a
    separate watch and are not among the listings counted, so they stay out of both."""
    v = state["vps"]
    cut = es.ts(es.NOW - timedelta(days=30))
    seen = defaultdict(set)
    for e in v.get("hit_hist", []):
        if e.get("t", "") >= cut and e.get("card") is not None and e.get("i"):
            seen[e["card"]].add(e["i"])
    return {str(c): len(ids) for c, ids in seen.items()}


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
                it = es.api_get(state, f"/buy/browse/v1/item/{iid}", {"fieldgroups": "PRODUCT"}, ok_404=True)
            except Exception:
                it = None
            if it:
                rec["idv"], rec["idr"], _ = es.check_identity(cat, cat.by_id.get(rec["card"]), it, rec.get("title") or "", rec["total"])
                es.item_facts(rec, it)
                try:
                    es.learn_facts(state, cat, rec, it)      # eBay's set / rarity / finish for the check screen
                except Exception as e:
                    log(f"Facts: could not read {iid} ({e})")
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
        if kind == "hit":
            v.setdefault("hit_hist", []).append(hit_snapshot(rec, d, hist[-1]["kd"], cs))
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
        hist.append([e["t"], e["c"], e["ti"], e["u"], e["tot"], e["p"], e["kd"], e.get("dec"), out, hrs, e["i"], e.get("card")])   # 10-11: item id, card id (the star on the site)
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
        it = es.api_get(state, f"/buy/browse/v1/item/{iid}", {"fieldgroups": "PRODUCT"}, ok_404=True)   # PRODUCT: eBay's catalog product too
        if not it:
            continue
        status, notes, _ = es.check_identity(cat, cat.by_id.get(rec["card"]), it, rec["title"], rec["total"])
        if status == "conflict":
            sent[iid] = es.ts(es.NOW)                        # the specifics name another card: never alert this one
            continue
        rec["idv"], rec["idr"] = status, notes
        es.item_facts(rec, it)
        try:
            es.learn_facts(state, cat, rec, it)              # eBay's set / rarity / finish for the check screen
        except Exception as e:
            log(f"Facts: could not read {iid} ({e})")
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
            "tier": rec["tier"], "sc": rec["sc"], "scr": rec["scr"], "ph": rec.get("n_img"),
            "img": rec.get("img"), "imgs": (rec.get("imgs") or [])[:4],    # its photos, for the Review screen after the auction
            "ec": rec.get("ec", ""), **({"ef": rec["ef"]} if "ef" in rec else {})})   # eBay's condition text and facts, read for the alert (2026-10-23)
    return n


HIT_HIST_KEEP_D = 60             # the Raw Data tab can show the hits of any day this far back


def hit_snapshot(rec, d, kd, cs):
    """A Buy It Now hit exactly as it was when its alert went out: the listing, and the numbers the alert promised.
    The Raw Data table only holds the last 24 hours and judges every listing as it stands NOW, so by the evening a
    morning hit has left it or lost its verdict (Brett, 2026-10-06: "7 hits" above a table of 2). With "Only show
    hits" on, the table is drawn from these, by the day they alerted, whatever became of them since."""
    return {"i": rec["id"], "t": es.ts(es.NOW), "tk": d.get("tk"), "card": rec["card"], "kd": kd, "tr": rec.get("tier", "clean"),
            "ti": rec.get("title"), "u": rec.get("url"), "first": rec.get("origin") or rec.get("first"),
            "item": rec.get("item"), "ship": rec.get("ship"), "tot": rec["total"], "tc": rec.get("tcond", "UNK"),
            "bo": 1 if rec.get("bo") else 0, "fb": rec.get("fb"), "pct": rec.get("pct"), "ph": rec.get("n_img"),
            "sc": rec.get("sc", 0), "scr": rec.get("scr") or [], "idv": rec.get("idv") or "", "A": cs.get("A"),
            "s": d["nm"][0], "mb": d["nm"][1], "p": d["nm"][2], "roi": d["nm"][3], "tax": d.get("tax"),
            "img": rec.get("img"), "imgs": (rec.get("imgs") or [])[:4],   # its photos, for the Review screen once it has left the table
            "ec": rec.get("ec", ""), **({"ef": rec["ef"]} if "ef" in rec else {})}   # eBay's condition text and facts as read for the alert (2026-10-23)


def hh_backfill(state, cat):
    """Once: the hits alerted before the snapshots existed, rebuilt from the alert log (which kept the total and the
    promised profit) and from the listing itself where the collector still has it. Marked old: the Max buy is worked
    back from the profit at the margin in force, and no sell price or anchor is on record for them."""
    v = state["vps"]
    hh = v.setdefault("hit_hist", [])
    have = {r["i"] for r in hh}
    m = alert_cfg(state).get("margin", 10) / 100.0
    for e in v.get("alert_log", []):
        if not str(e.get("kd", "")).startswith("hit") or e["i"] in have:
            continue
        rec = find_rec(state, e["i"]) or {}
        cid = e.get("card") if e.get("card") is not None else rec.get("card")
        if cid is None:
            try:
                ci = es.match_title(cat, e.get("ti") or "", "", state.get("denoms", {}))[0]
                cid = cat.cards[ci]["id"] if ci is not None else None
            except Exception:
                cid = None
        tot, p = e.get("tot"), e.get("p")
        hh.append({"i": e["i"], "t": e["t"], "tk": e.get("tk"), "card": cid, "kd": e["kd"], "tr": e.get("tr") or rec.get("tier", "clean"),
                   "ti": rec.get("title") or e.get("ti"), "u": e.get("u"), "first": rec.get("origin") or rec.get("first"),
                   "item": rec.get("item"), "ship": rec.get("ship"), "tot": tot, "tc": rec.get("tcond") or es.title_condition(e.get("ti") or ""),
                   "bo": 1 if rec.get("bo") else 0, "fb": rec.get("fb"), "pct": rec.get("pct"), "ph": rec.get("n_img"),
                   "sc": rec.get("sc", 0), "scr": rec.get("scr") or [], "idv": rec.get("idv") or "", "A": None, "s": None,
                   "mb": round((tot + p) / (1 + m), 2) if tot and p is not None else None, "p": p,
                   "roi": round(p / tot * 100, 1) if tot and p is not None else None, "tax": None, "old": 1,
                   "dec": e.get("dec"), "um": e.get("um")})
    hh.sort(key=lambda r: r["t"])


def hh_rows(state):
    """The hit history for the site, kept HIT_HIST_KEEP_D days, each row with what has become of the listing."""
    v = state["vps"]
    cut, favs = es.ts(es.NOW - timedelta(days=HIT_HIST_KEEP_D)), es.fav_listing_ids(state)
    v["hit_hist"] = [r for r in v.get("hit_hist", []) if r["t"] >= cut or r["i"] in favs]   # a starred hit stays (Favorites)
    want = {r["i"] for r in v["hit_hist"]}
    closed = {r["id"]: r for r in state["closed"] if r["id"] in want}
    rows = []
    for r in v["hit_hist"]:
        rec = state["open"].get(r["i"]) or closed.get(r["i"])
        out = "open" if r["i"] in state["open"] else (rec.get("out") or "closed") if rec else "unknown"
        rows.append([r["i"], r["t"], r.get("card"), r.get("ti"), r.get("u"), r.get("first"), r.get("item"), r.get("ship"), r.get("tot"),
                     r.get("tc"), r.get("bo", 0), r.get("fb"), r.get("pct"), r.get("ph"), r.get("tr"), r.get("sc", 0), r.get("scr") or [],
                     r.get("idv") or "", r.get("A"), r.get("s"), r.get("mb"), r.get("p"), r.get("roi"), r.get("tax"), r.get("kd"),
                     r.get("dec"), 1 if (r.get("um") or (rec or {}).get("um")) else 0, out, r.get("old", 0),
                     r.get("img") or (rec or {}).get("img"), (r.get("imgs") or (rec or {}).get("imgs") or [])[:4],   # 29-30: photos for the Review screen
                     es.facts_row(r if "ef" in r else (rec or {})), r.get("ec") or (rec or {}).get("ec") or ""])      # 31-32: eBay's facts and condition text
    return rows


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
    cut, favs = es.ts(es.NOW - timedelta(days=AU_HIST_KEEP_D)), es.fav_listing_ids(state)
    v["au_hist"] = [r for r in v.get("au_hist", []) if r["t"] >= cut or r["i"] in favs]   # a starred auction stays (Favorites)
    want = {r["i"] for r in v["au_hist"] if not r.get("img")}             # older records: the photo from the listing itself
    closed = {r["id"]: r for r in state["closed"] if r["id"] in want}
    rec_of = lambda r: state["open"].get(r["i"]) or closed.get(r["i"]) or {}
    return [[r["i"], r["t"], r.get("card"), r.get("ti"), r.get("u"), r.get("bid"), r.get("ship"), r.get("nb"), r.get("end"),
             r.get("tc"), r.get("fb"), r.get("pct"), r.get("kd"), r.get("s"), (r.get("net") or [None, None])[0],
             (r.get("net") or [None, None])[1], r.get("tier"), r.get("sc"), r.get("scr") or [], r.get("ph"), r.get("fin"),
             r.get("fb2"), r.get("fst"), r.get("dec"), r.get("old", 0), r.get("tot0"), 1 if r.get("um") else 0,
             r.get("img") or rec_of(r).get("img"),                                           # 27-28: photos for the Review screen
             (r.get("imgs") or rec_of(r).get("imgs") or [])[:4],
             es.facts_row(r if "ef" in r else rec_of(r)), r.get("ec") or rec_of(r).get("ec") or ""] for r in v["au_hist"]]   # 29-30: facts, condition text


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
        path = os.path.join(LIVE_DIR, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)   # pc/<shard>.bin lives in a folder
        with open(path, "wb") as f:
            f.write(data)
    git("add", "-A")
    has_commit = subprocess.run(["git", "rev-parse", "--verify", "-q", "HEAD"], cwd=LIVE_DIR, capture_output=True).returncode == 0
    git("commit", "-q", *(["--amend"] if has_commit else []), "-m", f"live {es.ts(es.NOW)}")
    git("push", "-q", "--force", "origin", "live")
    _publishes += 1
    if _publishes % 60 == 0:                                 # amended commits leave garbage behind; sweep it up
        sweep_live_repo()


def sweep_live_repo():
    """Every amended commit leaves the previous one's objects behind (2 MB a publish, 720 publishes a day, plus the
    hourly 6 MB state backup), and the reflog keeps them all alive, so `git gc --prune=now` on its own removed
    nothing: the disk filled on 2026-10-10 and the collector could not save its state for two days. Now the reflog
    is switched off and expired first, loose objects are pruned (that works on a full disk), then gc repacks."""
    if DRY_RUN or not os.path.isdir(os.path.join(LIVE_DIR, ".git")):
        return
    for args in (["config", "core.logAllRefUpdates", "false"], ["reflog", "expire", "--expire=now", "--all"],
                 ["prune", "--expire=now"], ["gc", "-q", "--prune=now"]):
        subprocess.run(["git", *args], cwd=LIVE_DIR, capture_output=True, timeout=600)


def disk_check(force=False):
    """Free space on the data disk; below DISK_MIN_MB the live checkout is swept, and if that is not enough its
    .git is thrown away (publish() rebuilds it: the branch is one commit anyway). -> free MB."""
    import shutil
    try:
        free = shutil.disk_usage(DATA).free / 1e6
    except Exception:
        return None
    if free < DISK_MIN_MB or force:
        sweep_live_repo()
        free = shutil.disk_usage(DATA).free / 1e6
        if free < DISK_MIN_MB and os.path.isdir(os.path.join(LIVE_DIR, ".git")):
            shutil.rmtree(os.path.join(LIVE_DIR, ".git"), ignore_errors=True)
            free = shutil.disk_usage(DATA).free / 1e6
            log(f"Disk: only {free:.0f} MB free after the sweep; the live checkout's .git was removed and will be rebuilt")
    return free


def archive_put(files):
    """Add files to the 'archive' branch - ordinary commits, never amended, never trimmed: the long-run dataset for
    analysis later (Brett, 2026-10-08), holding what the live branch overwrites and the state forgets."""
    if DRY_RUN:
        return
    if not os.path.isdir(os.path.join(ARCHIVE_DIR, ".git")):
        os.makedirs(ARCHIVE_DIR, exist_ok=True)
        git("clone", "-q", "--branch", "archive", "--single-branch", PUSH_REMOTE, ARCHIVE_DIR, cwd=DATA, check=False)
        if not os.path.isdir(os.path.join(ARCHIVE_DIR, ".git")):   # no such branch yet: start it
            git("init", "-q", "-b", "archive", cwd=ARCHIVE_DIR)
            git("remote", "add", "origin", PUSH_REMOTE, cwd=ARCHIVE_DIR)
        git("config", "user.name", "pokemon-collector", cwd=ARCHIVE_DIR)
        git("config", "user.email", "collector@users.noreply.github.com", cwd=ARCHIVE_DIR)
    for name, data in files.items():
        path = os.path.join(ARCHIVE_DIR, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
    git("add", "-A", cwd=ARCHIVE_DIR)
    git("commit", "-q", "-m", f"archive {es.ts(es.NOW)}", cwd=ARCHIVE_DIR)
    git("push", "-q", "origin", "archive", cwd=ARCHIVE_DIR)


CARD_ARCHIVE_KEYS = ("k", "D", "N", "lam", "mu", "smed", "s80", "hrs", "st", "A", "A_n", "L", "S", "liquid", "probT",
                     "net", "maxbuy", "hot", "pc", "pcv", "price", "dos", "io")


def archive_tick(state, cards):
    """Once a day, every card's numbers as they stood (cards/<day>.json: the model's view, which nothing else keeps);
    on the first day of a month, last month's closed listings (closed/<month>.jsonl: every listing with its prices,
    seller, timing and outcome, which leave the state after 60 days). Gzipped and encrypted like the state."""
    v = state["vps"]
    if time.time() < v.get("arch_retry", 0):
        return
    files, today = {}, es.TODAY
    if v.get("arch_day") != today and cards:
        snap = {str(c): {k: st.get(k) for k in CARD_ARCHIVE_KEYS if st.get(k) is not None} for c, st in cards.items()}
        files[f"cards/{today}.json.gz.enc"] = es.encrypt_file_blob(gzip.compress(json.dumps(snap, separators=(",", ":")).encode("utf-8")), es.PASSWORD)
    month = today[:7]
    if v.get("arch_month") != month:
        prev = (datetime.strptime(today, "%Y-%m-%d").replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
        rows = [r for r in state["closed"] if str(r.get("first", ""))[:7] == prev]
        if rows:
            files[f"closed/{prev}.jsonl.gz.enc"] = es.encrypt_file_blob(gzip.compress("\n".join(json.dumps(r, separators=(",", ":")) for r in rows).encode("utf-8")), es.PASSWORD)
    if not files:
        v["arch_day"], v["arch_month"] = today, month
        return
    try:
        archive_put(files)
        v["arch_day"], v["arch_month"] = today, month
        log(f"Archive: {', '.join(files)} ({sum(len(b) for b in files.values()) // 1024} KB) added to the archive branch")
    except Exception as e:
        v["arch_retry"] = time.time() + 3600
        log(f"Archive failed ({str(e)[:160]}); trying again in an hour")


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
    for iid in v.pop("site_read_q", []):                     # Review pressed on the site: read the listing now (site_read)
        try:
            if site_read(state, cat, iid):
                v["read_t"] = int(t * 1000)                  # publish this cycle (part of the signature below)
        except Exception as e:
            log(f"Site read: {iid} failed ({str(e)[:120]})")

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
    if v.get("facts_big") and counters["cycles"] % 3 == 0:  # the facts pass: discovery sits out every third cycle
        queries = []
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
    # the condition pass: eBay's own condition field for the "n/s" rows (Brett, 2026-10-17). One full look every
    # COND_EVERY_S, COND_DAILY_MAX a day, taken here - behind the identity lookups, ahead of the re-reads - because
    # at the tail of the optional work the bucket never had a token left for it (0 looks in its first hours)
    cond_day = v.setdefault("cond_day", {})
    if cond_day.get("d") != es.TODAY:
        cond_day.clear(); cond_day.update({"d": es.TODAY, "n": 0, "named": 0})
    if cards and cond_day["n"] < COND_DAILY_MAX and v.get("tokens", 0) >= 2 and due("cond", COND_EVERY_S):
        for iid in cond_queue(state, alert_cfg(state))[:COND_MAX_PER_CYCLE]:
            if not spend(state, COST_CONFIRM):
                break
            rec = state["open"][iid]
            rec["cond_tried"] = 1
            out = confirm(state, iid, rec, "cond", cat)
            cond_day["n"] += 1
            counters["cond_" + out] += 1
            if rec.get("ecc"):
                cond_day["named"] += 1
                counters["cond_named"] += 1
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
    if cards:                                                # the backlog pass: cards with no eBay record on any open listing
        backlog = facts_backlog(state)
        v["facts_back"] = len(backlog)
        big = len(backlog) >= FACTS_BIG
        if big != bool(v.get("facts_big")):
            v["facts_big"] = big
            log("Facts pass: " + (f"{len(backlog)} cards have no eBay record on any open listing - one lookup a minute for them, "
                                  "and discovery sits out every third cycle meanwhile" if big else
                                  f"the pile is down to {len(backlog)} cards - discovery back to every minute; a new card still gets its one lookup"))
        if not saving:
            for cid, iid in backlog[:FACTS_MAX_PER_CYCLE]:
                if not spend(state, COST_CONFIRM):
                    break
                v.setdefault("facts_tried", {})[str(cid)] = es.ts(now)
                out = confirm(state, iid, state["open"][iid], "facts", cat)
                counters["facts_" + out] += 1
                v["facts_done"] = v.get("facts_done", 0) + 1
                es.inherit_facts(state, cat)                 # what this lookup taught reaches the product's other listings now
    if not saving:
        for iid in book_queue(state, cards)[:BOOK_MAX_PER_CYCLE]:
            if not spend(state, COST_BOOK):
                break
            out = confirm(state, iid, state["open"][iid], "book", cat)
            counters["book_" + out] += 1
        for iid in confirm_queue(state, cat)[:CONFIRM_MAX_PER_CYCLE]:
            if not spend(state, COST_CONFIRM):
                break
            out = confirm(state, iid, state["open"][iid], "vanished", cat)
            counters["confirm_" + out] += 1
        for iid in kw_queue(state)[:KW_MAX_PER_CYCLE]:
            if not spend(state, COST_KW):
                break
            out = confirm(state, iid, state["open"][iid], "kw", cat)
            counters["kw_" + out] += 1
        for iid in suspect_queue(state)[:SUSPECT_MAX_PER_CYCLE]:
            if not spend(state, COST_CONFIRM):
                break
            rec = state["open"][iid]
            out = confirm(state, iid, rec, "suspect", cat)   # sold / ended / gone close it here
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
    live["alert"]["reviews"] = {k: r["v"] for k, r in v.get("reviews", {}).items()}   # Review answers given on the site
    live["alert"]["review_t"] = v.get("review_t", 0)
    pc = pc_worker()                                         # the background reader: file what it found, hand it the next plan
    got, urgent = file_pc_images(state, pc)
    counters["pc_img"] += got
    if pc is not None:
        try:
            pc.set_plan(pc_plan(state, cards, cat))
        except Exception as e:
            log(f"PriceCharting pictures: plan failed this minute ({str(e)[:100]})")
    if urgent:                                               # a picture Brett is waiting for on the site: publish now
        sched["publish"] = 0
    if pc is not None and pc.backlog() and due("pictures", 600):   # while the backlog lasts: a line every ten minutes
        log(f"Pictures: {len(v.get('pc_img', {}))} on file, {pc.read} pages read since the start, {pc.backlog()} to go, "
            f"one page every {pc.gap:g} s, last read HTTP {PC_LAST_READ.get('code')} in {PC_LAST_READ.get('s', 0):.1f} s; "
            f"history: {pchist.count():,} of {len(cat.cards):,} cards on file, {pchist.count_signed():,} with the volume series")
    live["pcimg"] = pc_image_table(state)
    live["pch"] = {"n": pchist.count(), "total": len(cat.cards), "shards": pchist.SHARDS,   # the page's "history for N cards so far"
                   "signed": pchist.count_signed(), "signin": v.get("pch_signin", "none") if PC_COOKIE else "none"}
    live["alert"]["learned"] = {"words": sorted(learned["words"].items(), key=lambda kv: -kv[1])[:40],
                                "titles": len(learned["titles"]), "sellers": len(learned["sellers"])}
    if not v.get("au_backfilled"):
        au_backfill(state, cat)
        v["au_backfilled"] = 1
    live["alert"]["au"] = au_rows(state)                     # every auction sent to the phone, for the Raw Data tab
    if not v.get("hh_backfilled"):
        hh_backfill(state, cat)
        v["hh_backfilled"] = 1
    live["alert"]["hh"] = hh_rows(state)                     # every Buy It Now hit as it was when it alerted
    live["alert"]["wrong"] = wrong_rows(v)                   # clean listings Brett said were not the matched card
    mm_seed(v)
    mm = mm_counts(v)                                        # per card: [marked, of those alerts, alerts sent, listings matched]
    matched = card_matches(state, mm)
    live["alert"]["mm"] = {str(k): n + [matched.get(k, 0)] for k, n in mm.items()}
    live["mt"] = match_table(state)                          # per card: [confirmed, mismatches, filed by the matcher], both eBay tabs
    live["hits30"] = hits_30d(state)                         # per card: alerts in the last 30 days
    live["hl30"] = hit_listings_30d(state)                   # per card: listings that got a hit in 30 days (Hit % with each card's n30)
    live["since"] = es.data_since(state)                     # the first day with data: "last month" shows only for a month that began after it
    live["help"] = {"t": v.get("help_t", 0), "v": v.get("help") or {}}   # descriptions and READMEs he rewrote on the site
    forecast_score(v, cat, cards)
    live["forecasts"] = {"t": v.get("forecast_t", 0), "recs": v.get("forecasts") or []}   # the Forecast tab's recorded picks and their results
    live["favs"] = fav_live(state, cards, {x[0] for x in live["live"]})   # the stars (Favorites tab), with rows for starred listings past 24 h
    live["source"] = "vps"
    raw = es.json_gz(live)
    state["runs"] = state.get("runs", 0) + 1
    if due("save", SAVE_EVERY_S):
        save_state(state)
    # 5. publish, when something changed (or every 10 min regardless, so the "as of" time keeps moving)
    sig = (len(state["open"]), len(state["closed"]), counters["matched"], counters["repriced"], counters["confirm_sold"],
           v.get("alert_t", 0), v.get("test_t", 0), v.get("help_t", 0), v.get("mark_t", 0), v.get("review_t", 0), v.get("forecast_t", 0),
           v.get("read_t", 0), v.get("fav_t", 0))   # a change on the Alerts tab, a listing read for the Review screen or a star is published at once
    changed = sig != v.get("pub_sig") or urgent > 0
    if due("publish", PUBLISH_EVERY_S) and (changed or t - sched.get("published", 0) >= 600):
        sched["published"] = t
        v["pub_sig"] = sig
        files = {"ebay_live.bin": es.encrypt_live(raw, es.PASSWORD) if es.PASSWORD else raw}
        try:
            files["collector.log"] = open(LOG_PATH, "rb").read()[-120_000:]
        except Exception:
            pass
        if due("backup", STATE_BACKUP_EVERY_S):
            state_raw = save_state(state)
            files[es.STATE_NAME] = es.encrypt_file_blob(state_raw, es.PASSWORD) if es.PASSWORD else state_raw
        if pchist.dirty_count() and (due("pchist", PC_HIST_PUBLISH_S) or urgent):   # PriceCharting history shards that changed
            try:
                files.update(pchist.publish_files(lambda raw: es.encrypt_live(raw, es.PASSWORD) if es.PASSWORD else raw))
            except Exception as e:
                log(f"PriceCharting history: publish failed ({str(e)[:120]})")
        if due("pcm", PCM_PUBLISH_S):                        # every card's last complete month of PriceCharting sales ("PC sales")
            try:
                pcm = pchist.last_month_all()
                raw_pcm = gzip.compress(json.dumps(pcm, separators=(",", ":")).encode("utf-8"))
                files["pcm.bin"] = es.encrypt_live(raw_pcm, es.PASSWORD) if es.PASSWORD else raw_pcm
                if due("pcm_log", 6 * 3600):
                    log(f"PC sales: last month's bar on file for {len(pcm):,} cards ({len(raw_pcm) // 1024} KB published)")
            except Exception as e:
                log(f"PC sales: pcm.bin failed ({str(e)[:120]})")
        try:
            publish(files)
            counters["published"] += 1
        except Exception as e:
            log(f"Publish failed: {e}")
    try:                                                     # the long-run dataset: once a day, and monthly
        archive_tick(state, cards)
    except Exception as e:
        log(f"Archive: {str(e)[:160]}")
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
        ec = Counter("named" if r.get("ecc") else "stated" if r.get("ec") else "none" for r in state["open"].values() if "ec" in r)
        day_ago = es.ts(es.NOW - timedelta(hours=24))
        ns = sum(1 for r in state["open"].values() if r["first"] >= day_ago and r.get("tcond", "UNK") == "UNK")
        log(f"Conditions: eBay's condition field read on {sum(ec.values())} open listings ({ec['named']} name a grade, {ec['stated']} say "
            f"something else, {ec['none']} carry none); the condition pass made {v.get('cond_day', {}).get('n', 0)} of its "
            f"{COND_DAILY_MAX} looks today, {len(cond_queue(state, alert_cfg(state)))} in its queue; {ns} listings of the last 24 h still n/s")
        log(f"Pictures: {len(v.get('pc_img', {}))} cards with a PriceCharting picture on file, {counters['pc_img']} pages read this hour, "
            f"{len(v.get('pc_miss', {}))} cards whose page had none, {pc_worker().backlog() if pc_worker() else 0} still to read "
            f"(one page every {pc_worker().gap if pc_worker() else 0:g} s, last read HTTP {PC_LAST_READ.get('code')} in "
            f"{PC_LAST_READ.get('s', 0):.1f} s); {len(v.get('reviews', {}))} Review answers on the site")
        by_spec = sum(1 for r in state["open"].values() if (r.get("how") or "").endswith("specifics"))
        log(f"Printing: {by_spec} open listings filed under a printing their item specifics named; "
            f"{len(state.get('pending', {}))} unmatched 'ambiguous variant' listings waiting for a lookup; "
            f"{state.get('printchecks', {}).get(es.TODAY, 0)} printing lookups today")
        refreshed = es.refresh_facts(state, cat)             # verdicts follow the vocabulary and the card as they are now
        moved = es.apply_epid_memory(state, cat)
        inherited = es.inherit_facts(state, cat)             # a known product's facts reach all its listings for free
        mem = state.get("epids") or {}
        with_facts = sum(1 for r in state["open"].values() if r.get("ef"))
        far = sum(1 for r in state["open"].values() if "far" in ((r.get("ef") or {}).get("cmp") or {}).values())
        log(f"Facts: eBay's record on {with_facts} open listings ({far} disagree with the card on set, rarity or finish; "
            f"{inherited} just inherited from their product this hour); "
            f"{len(mem)} products in the ePID memory, {sum(1 for m in mem.values() if m.get('v'))} tied to a card; "
            f"{moved} listings moved to their product's card this hour, {refreshed} verdicts re-read; backlog pass: "
            f"{v.get('facts_done', 0)} lookups so far, {v.get('facts_back', 0)} cards still without eBay's record"
            + (" (discovery sits out every third cycle)" if v.get("facts_big") else ""))
        free = disk_check()
        if free is not None:
            log(f"Disk: {free / 1000:.1f} GB free on the data disk (the live checkout is swept below {DISK_MIN_MB / 1000:.1f} GB)")
        hour_ago = es.ts(now - timedelta(hours=1))
        why = Counter("no card #" if u[5].startswith("no card #") else u[5].split(":")[0]
                      for u in state["unmatched"] if u[0] >= hour_ago)
        log("Unmatched this hour: " + (", ".join(f"{k} {n}" for k, n in why.most_common()) or "none"))
        if NTFY_TOPIC:
            log(f"Alerts: {counters['alerts']} hit alerts and {counters['au_alerts']} auction alerts sent this hour to the phone")
        line = auction_summary(state)
        if line:
            log(line + f"; trial ends {v.get('auction', {}).get('until', '?')[:10]}")
        for k in ("Scam screen", "LP correction", "Enrich", "ID check", "Condition"):   # Condition: the last raw descriptor payload seen
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
            free = disk_check()                              # a full disk (2026-10-10) must not stop the start: the
            if free is not None:                             # live checkout is swept or rebuilt before anything is written
                log(f"Disk: {free / 1000:.1f} GB free on the data disk")
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
    try:
        n_h = pchist.init(os.path.join(DATA, "pc_hist"))     # PriceCharting's monthly history, read off each card's page
        pchist.mark_all_dirty()                              # every shard goes out with the first publish (a rebuilt checkout)
        log(f"PriceCharting history: {n_h:,} of {len(cat.cards):,} cards on file ({pchist.count_signed():,} with the volume "
            f"series); the page reader fills in the rest (one page every {PC_PREFETCH_GAP_S:g} s) and refreshes cards weekly "
            f"(with eBay data) or monthly; PriceCharting sign-in: {pc_signin_startup_note()}")
        if not PC_COOKIE:                                    # the verdict survives a restart; a replaced cookie gets a fresh test
            state["vps"]["pch_signin"] = "none"
        elif _pc_sess.get("fresh") or state["vps"].get("pch_signin") not in ("ok", "expired"):
            state["vps"]["pch_signin"] = "unknown"
    except Exception as e:
        log(f"PriceCharting history: store failed to open ({e})")
    pc_worker(state)                                         # PriceCharting pictures for the Review button, in the background
    log(f"PriceCharting pictures: {len(state['vps'].get('pc_img', {}))} on file; the background reader takes one page every "
        f"{PC_PREFETCH_GAP_S:g} s until every card has one")
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
    n = es.refresh_facts(state, cat)                         # the vocabulary (cardfacts.py) or a card's row may have
    if n:                                                    # changed since a listing's eBay record was last compared
        log(f"Facts: {n} stored verdicts re-read against the card the listing is filed under")
    sched = {"catalog": time.time()}
    counters = defaultdict(int)
    while True:
        t0 = time.time()
        try:
            if time.time() - sched.get("catalog", 0) >= CATALOG_EVERY_S:
                sched["catalog"] = time.time()
                sha = state["vps"].get("catalog_sha")
                cat, name = load_catalog(state)
                if name != state["vps"].get("catalog"):
                    state["vps"]["catalog"] = name
                    log(f"Catalog refreshed: {name}")
                if state["vps"].get("catalog_sha") != sha:  # other rows, maybe other rarity / finish words
                    n = es.refresh_facts(state, cat)
                    if n:
                        log(f"Facts: {n} stored verdicts re-read against the new catalog")
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
