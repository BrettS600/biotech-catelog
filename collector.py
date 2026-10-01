"""
collector.py  -  the always-on version of the eBay collector, for a small Linux machine.

It reuses the matching, scoring and statistics in ebay_sweep.py but replaces the 15-minute
GitHub Actions cycle (sweep / presence walk / scheduled getItem checks) with a loop:

  every 60 s     DISCOVERY   newest raw Pokemon singles (one page; a second only in a burst);
                             the keyword backup query every 5 min
  hourly / 6 h / daily  RE-READS   listings that started in a given hour are read again with the
                             search endpoint (200 per call, itemStartDate window, $35-200 band);
                             a known listing missing from its window has probably sold
  as they appear CONFIRM     one getItem per vanished listing: sold vs ended, when, at what price
  every 48 h     BOOK CHECK  the 3 cheapest open copies of every priced card are re-verified,
                             so a sold copy cannot sit in the book as a phantom
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
import gzip
import hashlib
import io
import json
import math
import os
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
KW_EVERY_S = 300
PUBLISH_EVERY_S = 120
CODE_CHECK_EVERY_S = 300
STATE_BACKUP_EVERY_S = 3600
CATALOG_EVERY_S = 6 * 3600
RATELIMIT_EVERY_S = 3600
ENRICH_EVERY_S = 300
SUMMARY_EVERY_S = 3600
SWEEP_OVERLAP_MIN = 5            # a page covers ~15 min of listings; sweeping every minute, 5 is plenty

# ---------------- outcome detection ----------------
REREAD_BAND = (35, 200)          # listing price band that gets re-read (cheap copies of pricey cards are
                                 # caught by the book check instead)
REREAD_MAX_AGE_D = 10
REREAD_CADENCE = [(1.0, 2 * 3600), (3.0, 6 * 3600), (float(REREAD_MAX_AGE_D), 24 * 3600)]   # (age <= days, every s)
# a one-hour window holds ~450 in-band listings (3 pages); re-reading day-1 windows every two hours keeps the
# re-reads near 900 calls/day instead of 1,700
REREAD_MAX_PAGES = 8
REREAD_MAX_PER_CYCLE = 6
CONFIRM_MAX_PER_CYCLE = 12
FALSE_ALARM_LIMIT = 2            # missing from its window twice while still open -> stop re-reading it
BOOK_BAND = (40, 200)            # card price band whose cheapest copies get re-verified
BOOK_RECHECK_S = 48 * 3600
BOOK_MAX_PER_CYCLE = 3
KW_CHECK_AGES_D = [1, 3]         # listings found only by the keyword query cannot be re-read: getItem instead
KW_MAX_PER_CYCLE = 2
STALE_D = 30                     # an open listing this old is closed as unsold

# ---------------- budget ----------------
DAILY_LIMIT = 5000
SAFETY = 150                     # calls never planned into
TOKEN_CAP = 80                   # optional work can burst up to this many calls in one cycle
COST_CONFIRM, COST_BOOK, COST_KW = 1, 1, 1

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


def confirm_queue(state):
    """Vanished listings, most valuable first: in the book band before cheap, newest flag first."""
    q = [(0 if in_band(r, BOOK_BAND) else 1, r.get("vanished"), iid) for iid, r in state["open"].items() if r.get("vanished")]
    q.sort()
    return [iid for _, _, iid in q]


def book_queue(state, cards):
    """Copies that set prices: the 3 cheapest open copies of every priced card in the band, not checked in 48 h."""
    out = []
    for cid, c in cards.items():
        if c.get("lam") is None or c.get("price") is None or not (BOOK_BAND[0] <= c["price"] <= BOOK_BAND[1]):
            continue
        for entry in c.get("book", [])[:3]:
            rec = state["open"].get(entry[0])
            if not rec:
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


def close_stale(state):
    n = 0
    for iid, rec in list(state["open"].items()):
        if es.hours_between(es.parse_ts(rec["first"]), es.NOW) / 24 > STALE_D:
            es.close_listing(state, iid, rec, "stale", es.NOW)
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
    return any(f in ("collector.py", "ebay_sweep.py", "requirements.txt") for f in changed)


# ---------------- the loop ----------------
def cycle(state, cat, sched, counters):
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
    # 3. optional work, paid for with tokens: confirmations first (each is probably a sale), then window
    #    re-reads, then the price-setting copies, then the keyword-only listings, then scam enrichment
    for iid in confirm_queue(state)[:CONFIRM_MAX_PER_CYCLE]:
        if not spend(state, COST_CONFIRM):
            break
        out = confirm(state, iid, state["open"][iid], "vanished")
        counters["confirm_" + out] += 1
    if v.get("window_ok"):
        for last, key, n in due_windows(state, now)[:REREAD_MAX_PER_CYCLE]:
            est = max(1, math.ceil(n * 1.5 / 200))
            if not spend(state, est):
                break
            pages, present, flagged, repriced = reread_window(state, key, n)
            v["tokens"] -= max(0, pages - est)
            counters["windows"] += 1; counters["window_pages"] += pages
            counters["flagged"] += flagged; counters["repriced"] += repriced
    cards = counters.get("_cards") or {}
    for iid in book_queue(state, cards)[:BOOK_MAX_PER_CYCLE]:
        if not spend(state, COST_BOOK):
            break
        out = confirm(state, iid, state["open"][iid], "book")
        counters["book_" + out] += 1
    for iid in kw_queue(state)[:KW_MAX_PER_CYCLE]:
        if not spend(state, COST_KW):
            break
        out = confirm(state, iid, state["open"][iid], "kw")
        counters["kw_" + out] += 1
    if due("enrich", ENRICH_EVERY_S):
        n = min(3, int(v.get("tokens", 0)))
        if n > 0:
            before = state["calls"].get(es.TODAY, 0)
            es.enrich(state, n)
            v["tokens"] -= state["calls"].get(es.TODAY, 0) - before
    # 4. housekeeping, statistics, live file
    if due("prune", 3600):
        counters["stale"] += close_stale(state)
        es.prune(state)
    es.score_listings(state)
    lp = es.lp_correction(state)
    es.update_daily(state, lp)
    cards = es.compute_stats(state, cat, lp)
    counters["_cards"] = cards
    live = es.build_live(state, cards, lp)
    live["source"] = "vps"
    raw = gzip.compress(json.dumps(live, separators=(",", ":")).encode("utf-8"))
    state["runs"] = state.get("runs", 0) + 1
    state_raw = save_state(state)
    # 5. publish, when something changed (or every 10 min regardless, so the "as of" time keeps moving)
    sig = (len(state["open"]), len(state["closed"]), counters["matched"], counters["repriced"], counters["confirm_sold"])
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
            f"{counters['stale']} closed stale | {counters['published']} publishes | {lag_txt}")
        log(f"Now: {len(state['open'])} open, {len(state['closed'])} closed, {live['n_cards']} cards with data, "
            f"{live['n_live']} listings in 24 h, {live['n_pass']} pass the gate; budget {v['remaining']} left, "
            f"{v['per_min']} optional calls/min, {int(v.get('tokens', 0))} tokens; {live['calls_today']} calls today")
        verdicts = Counter(x[12] for x in live["live"])             # where the last 24 h of listings stop at the gate
        log("Verdicts: " + ", ".join(f"{k} {n}" for k, n in verdicts.most_common()))
        anchored = sum(1 for c in cards.values() if c.get("A_n", 0) >= es.ANCHOR_MIN)
        liquid = sum(1 for c in cards.values() if c.get("liquid"))
        log(f"Cards: {anchored} with 5+ sales behind the anchor, {liquid} liquid at the collector's defaults, "
            f"{sum(1 for c in cards.values() if c.get('liquid') and c.get('A_n', 0) >= es.ANCHOR_MIN)} both")
        for k in ("Scam screen", "LP correction", "Enrich"):
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
    for rec in state["open"].values():                       # listings the Actions version flagged: confirm them here
        if rec.get("suspect") and not rec.get("vanished"):
            rec["vanished"] = rec.get("first")
    state["vps"]["catalog"] = cat_name
    log(f"Catalog {cat_name}; state: {len(state['open'])} open, {len(state['closed'])} closed")
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
