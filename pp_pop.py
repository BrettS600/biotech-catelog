"""
pp_pop.py  -  PSA's population history from PokemonPrice.com, into card-data data/graded/psa_pop (a one-time backfill).

Brett, 2026-11-20: "We should make a new data folder for the graded cards data ... for a given card at a specific grade,
I want to store the data for how many cards of that grade and card type were graded across every month dating back to
2017. We do not need to include this data on the website ... we will eventually consider this data when we decide to
build the predictive forecast model". Asked about the site's rules - its terms (8 Jan 2025): "personal, non-commercial
purposes only", "Do not copy, modify, or distribute any content without prior written consent"; its robots.txt:
ordinary automated reading allowed, no collecting to train AI models, AI crawlers shut out by name - he chose "Go
ahead, personal use": one slow pass over the pages that may be his Card Ladder cards, the data kept in the private
card-data alone, nothing republished. CGC is NOT stored from here (the site knows PSA only): Brett's "assume CGC graded
per month is the same as PSA" is left to the model, where it can be changed.

THE SITE: every card page (https://www.pokemonprice.com/<set>/<card>) carries, in the data behind its "Population"
chart, PSA's population of the grades 1-10 on each date the site looked: {"id", "card_id", "pop1" .. "pop10",
"date_checked"} - from 2017-09-26, every ~5 days up to 2020, thinner after, the last in June 2024 (the site stopped
looking then). Whole grades only: no half grades, no qualifiers. Some pages carry no rows; a few carry two series under
one card (a second row on the same dates with small numbers). /sitemap.xml lists all its card pages (30,473 in 167
sets on 2026-11-20).

WHAT IT DOES (its own thread, started by collector.py's fast tick through tick(); nothing here runs on its own):
  1. the catalog, once: /sitemap.xml -> card-data data/graded/psa_pop/catalog.csv.gz (set, card: the two parts of each
     page's address).
  2. the pages on the list card-data data/graded/psa_pop/todo.csv (column "path" = <set>/<card>; made by card-data
     tools/graded/pp_match.py from the catalog: the pages that may be one of Brett's Card Ladder cards), set by set,
     ONE PAGE EVERY PACE_S SECONDS. A page's rows go to snapshots/<set>.csv.gz (card, row, date, pop1..pop10 - as the
     site has them, nothing worked out) and one line to pages.csv (path, read_at, status ok / none = no rows / gone =
     no such page, pp_card_id, title, snapshots, first, last, note). A set is committed and pushed once all its pages
     are read; until then its rows wait in the collector's own data folder (WORK), so a restart loses nothing. A page
     already in pages.csv is not read again.
  It stops for a day at a refused request (HTTP 403 / 429) or a check page - it never tries to get around one - and
  for half an hour after five reads in a row that fail. When the list is through it looks every six hours whether the
  list has grown.
  The months (how many were graded in each) and the tie to each Card Ladder card are worked out from these files by
  card-data tools/graded/ - not here.

collector.py uses tick(); it sets scans.log / scans.DRY_RUN (shared with scans.py and clcerts.py).
"""
import csv
import gzip
import html
import io
import json
import os
import re
import shutil
import threading
import time

import requests

import scans

SITE = "https://www.pokemonprice.com"
CD_DIR = "data/graded/psa_pop"
CD_CHECKOUT = os.path.join(scans.DATA, "card-data-psapop")              # card-data, data/graded/psa_pop only
WORK = os.path.join(scans.DATA, "pp_pop_work")                          # the set being read: its rows, till it is pushed
PACE_S = 4.0                     # one page every four seconds
RETRY_S = 1800                   # after a run that failed
REFUSED_S = 24 * 3600            # after a refused request
IDLE_S = 6 * 3600                # the list is through: look again for a longer one
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) personal card check, one page per card"}
PAGE_COLS = ["path", "read_at", "status", "pp_card_id", "title", "snapshots", "first", "last", "note"]
SNAP_COLS = ["card", "row", "date"] + [f"pop{i}" for i in range(1, 11)]
_OBJ = re.compile(r'\{[^{}]*"date_checked":"\d{4}-\d{2}-\d{2}"[^{}]*\}')
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S)
_LOC = re.compile(r"<loc>\s*https?://[^/<\s]+/([a-z0-9][a-z0-9-]*)/([^/<\s]+?)\s*</loc>")
_SKIP_SETS = {"card-lists"}

_run = {"thread": None, "msg": [], "next": 0.0, "read": 0, "left": None, "sets": 0, "said": 0.0, "idle": ""}


class Refused(Exception):
    pass


def _say(text):
    _run["msg"].append(text)


def tick(v):
    """Called every few seconds by collector.py: pass on what the thread has to say, start it when it is due."""
    while _run["msg"]:
        scans.log("PSA pop history: " + _run["msg"].pop(0))
    th = _run["thread"]
    if th is not None and th.is_alive():
        if time.time() - _run["said"] > 3600 and _run["left"] is not None:
            _run["said"] = time.time()
            scans.log(f"PSA pop history: {_run['read']:,} page(s) read since the start, {_run['left']:,} left on the list "
                      f"({_run['sets']} set(s) filed in card-data {CD_DIR}); one page every {PACE_S:.0f} s")
        return
    if scans.DRY_RUN or time.time() < _run["next"] or not os.path.exists(scans.KEY):
        return
    _run["next"] = time.time() + RETRY_S                     # whatever happens, not again before this (the thread moves it)
    _run["thread"] = threading.Thread(target=_work, daemon=True)
    _run["thread"].start()


def parse_page(text):
    """A card page -> (title, rows): rows [{"id", "card_id", "date", "pops": [pop1..pop10]}], oldest first."""
    m = _TITLE.search(text)
    title = html.unescape(m.group(1)).strip() if m else ""
    rows, seen = [], set()
    for m in _OBJ.finditer(text.replace('\\"', '"')):
        try:
            o = json.loads(m.group(0))
        except ValueError:
            continue
        if "pop10" not in o or o.get("id") in seen:
            continue
        seen.add(o.get("id"))
        rows.append({"id": str(o.get("id") or ""), "card_id": str(o.get("card_id") or ""), "date": o["date_checked"],
                     "pops": [o.get(f"pop{i}") for i in range(1, 11)]})
    rows.sort(key=lambda r: (r["date"], r["id"]))
    return title, rows


def _get(path):
    r = requests.get(SITE + "/" + path, timeout=40, headers=HEADERS)
    head = r.text[:3000].lower() if r.status_code != 404 else ""
    if r.status_code in (403, 429) or (r.status_code == 503 and "just a moment" in head) or "cf-challenge" in head:
        raise Refused(f"HTTP {r.status_code}")
    return r


def read_page(path):
    """-> a pages.csv line (dict) and the page's rows; status "error" = not read just now (tried again another run)."""
    line = {"path": path, "read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "status": "error", "pp_card_id": "",
            "title": "", "snapshots": 0, "first": "", "last": "", "note": ""}
    try:
        r = _get(path)
    except Refused:
        raise
    except Exception as e:
        line["note"] = str(e)[:80]
        return line, []
    if r.status_code == 404:
        line["status"] = "gone"
        return line, []
    if r.status_code != 200:
        line["note"] = f"HTTP {r.status_code}"
        return line, []
    title, rows = parse_page(r.text)
    if not title and not rows:
        line["note"] = "nothing recognised on the page"
        return line, []
    line.update(status="ok" if rows else "none", title=title[:200], snapshots=len(rows))
    if rows:
        ids = sorted({x["card_id"] for x in rows})
        line.update(pp_card_id=ids[0], first=rows[0]["date"], last=rows[-1]["date"],
                    note="" if len(ids) == 1 else f"{len(ids)} card ids")
    return line, rows


def fetch_catalog():
    """/sitemap.xml -> [(set, card)], in the site's order."""
    r = _get("sitemap.xml")
    if r.status_code != 200:
        raise RuntimeError(f"the sitemap answered HTTP {r.status_code}")
    out, seen = [], set()
    for s, c in _LOC.findall(r.text):
        if s in _SKIP_SETS or (s, c) in seen:
            continue
        seen.add((s, c))
        out.append((s, c))
    if len(out) < 1000:
        raise RuntimeError(f"the sitemap lists only {len(out)} card pages")
    return out


# ---- card-data: a sparse checkout of data/graded/psa_pop alone, card-data's own key (as clcerts.py) ----
def _checkout():
    if not os.path.isdir(os.path.join(CD_CHECKOUT, ".git")):
        shutil.rmtree(CD_CHECKOUT, ignore_errors=True)
        scans.git("clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", "main", scans.REMOTE, CD_CHECKOUT,
                  cwd=scans.DATA, timeout=300)
        scans.git("sparse-checkout", "set", CD_DIR, cwd=CD_CHECKOUT)
        scans.git("config", "user.name", "pokemon-collector", cwd=CD_CHECKOUT)
        scans.git("config", "user.email", "collector@users.noreply.github.com", cwd=CD_CHECKOUT)


def _sync():
    scans.git("fetch", "-q", "--depth", "1", "origin", "main", cwd=CD_CHECKOUT, timeout=300)
    scans.git("reset", "-q", "--hard", "FETCH_HEAD", cwd=CD_CHECKOUT)


def _push(write, msg):
    """write() puts the new files into the fresh checkout; then commit and push - three tries, card-data moves often."""
    for _ in range(3):
        _sync()
        write()
        scans.git("add", "--", CD_DIR, cwd=CD_CHECKOUT)
        if scans.git("diff", "--cached", "--quiet", check=False, cwd=CD_CHECKOUT).returncode == 0:
            return
        scans.git("commit", "-q", "-m", msg, cwd=CD_CHECKOUT)
        if scans.git("push", "-q", "origin", "HEAD:main", check=False, cwd=CD_CHECKOUT, timeout=300).returncode == 0:
            return
        time.sleep(5)
    raise RuntimeError("card-data refused the push three times")


def _rows(path):
    if not os.path.exists(path):
        return []
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if None not in r.values()]   # a line cut short by a restart is dropped


def _folder():
    return os.path.join(CD_CHECKOUT, CD_DIR)


def _write_catalog(pairs):
    os.makedirs(_folder(), exist_ok=True)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["set", "card"])
    w.writerows(pairs)
    with gzip.open(os.path.join(_folder(), "catalog.csv.gz"), "wt", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())


def _write_set(s):
    """The set's waiting rows (WORK) into the checkout: snapshots/<set>.csv.gz (with what it held) and pages.csv."""
    snaps = _rows(os.path.join(_folder(), "snapshots", s + ".csv.gz")) + _rows(os.path.join(WORK, s + ".snaps.csv"))
    seen, out = set(), []
    for r in snaps:
        k = (r["card"], r["row"])
        if k not in seen:
            seen.add(k)
            out.append(r)
    os.makedirs(os.path.join(_folder(), "snapshots"), exist_ok=True)
    if out:
        with gzip.open(os.path.join(_folder(), "snapshots", s + ".csv.gz"), "wt", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=SNAP_COLS, lineterminator="\n")
            w.writeheader()
            w.writerows(out)
    p = os.path.join(_folder(), "pages.csv")
    have = {r["path"] for r in _rows(p)}
    new = [r for r in _rows(os.path.join(WORK, s + ".pages.csv")) if r["path"] not in have]
    head = not os.path.exists(p) or os.path.getsize(p) == 0
    with open(p, "a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=PAGE_COLS, lineterminator="\n")
        if head:
            w.writeheader()
        w.writerows(new)


def _append(path, cols, rows):
    head = not os.path.exists(path) or os.path.getsize(path) == 0
    with open(path, "a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        if head:
            w.writeheader()
        w.writerows(rows)


def _work():
    """(its own thread) the catalog once, then the pages on the list, set by set."""
    try:
        os.makedirs(WORK, exist_ok=True)
        _checkout()
        _sync()
        if not os.path.exists(os.path.join(_folder(), "catalog.csv.gz")):
            pairs = fetch_catalog()
            _push(lambda: _write_catalog(pairs), f"PSA pop history: PokemonPrice's catalog ({len(pairs):,} card pages)")
            _say(f"the catalog - {len(pairs):,} card pages in {len({s for s, _ in pairs})} sets (PokemonPrice.com's sitemap) - "
                 f"is in card-data {CD_DIR}/catalog.csv.gz")
        todo, seen = {}, set()                               # set -> [card], in the list's order
        for r in _rows(os.path.join(_folder(), "todo.csv")):
            p = (r.get("path") or "").strip().strip("/")
            if p.count("/") != 1 or p in seen:
                continue
            seen.add(p)
            s, c = p.split("/")
            todo.setdefault(s, []).append(c)
        if not todo:
            if _run["idle"] != "no list":
                _run["idle"] = "no list"
                _say("waiting for the list of pages to read (card-data " + CD_DIR + "/todo.csv)")
            return
        done = {r["path"] for r in _rows(os.path.join(_folder(), "pages.csv"))}
        _run["left"] = sum(1 for p in seen if p not in done)
        _run["sets"] = sum(1 for s, cs in todo.items() if all(f"{s}/{c}" in done for c in cs))
        if not _run["left"]:
            if _run["idle"] != f"done {len(seen)}":
                _run["idle"] = f"done {len(seen)}"
                _say(f"all {len(seen):,} pages on the list are read and filed ({len(todo)} sets)")
            _run["next"] = time.time() + IDLE_S
            return
        _run["idle"], _run["said"] = "", _run["said"] or time.time()
        _say(f"{_run['left']:,} of {len(seen):,} pages on the list to read, one every {PACE_S:.0f} s (about "
             f"{_run['left'] * PACE_S / 3600:.0f} hours)")
        last, fails, unread = 0.0, 0, 0
        for s, cards in todo.items():
            left = [c for c in cards if f"{s}/{c}" not in done]
            if not left:
                continue
            wp, ws = os.path.join(WORK, s + ".pages.csv"), os.path.join(WORK, s + ".snaps.csv")
            waiting = {r["path"] for r in _rows(wp)}
            for c in left:
                path = f"{s}/{c}"
                if path in waiting:
                    continue
                time.sleep(max(0.0, PACE_S - (time.time() - last)))
                last = time.time()
                line, rows = read_page(path)
                if line["status"] == "error":
                    fails += 1
                    unread += 1
                    if fails >= 5:
                        raise RuntimeError(f"five reads in a row failed (the last: {path}: {line['note']})")
                    continue
                fails = 0
                _append(ws, SNAP_COLS, [dict({"card": c, "row": x["id"], "date": x["date"]},
                                             **{f"pop{i + 1}": ("" if v is None else v) for i, v in enumerate(x["pops"])}) for x in rows])
                _append(wp, PAGE_COLS, [line])
                waiting.add(path)
                _run["read"] += 1
                _run["left"] -= 1
            if all(f"{s}/{c}" in waiting for c in left):
                _push(lambda s=s: _write_set(s), f"PSA pop history: {s} ({len(left)} page(s) from PokemonPrice.com)")
                for f in (wp, ws):
                    if os.path.exists(f):
                        os.remove(f)
                done.update(f"{s}/{c}" for c in left)
                _run["sets"] += 1
        _run["next"] = time.time() + RETRY_S if unread else 0.0   # pages that failed: later; all read: the idle check at once
    except Refused as e:
        _run["next"] = time.time() + REFUSED_S
        _say(f"PokemonPrice.com refused a request ({e}) - stopped for a day; nothing is tried to get around it")
    except Exception as e:
        _run["next"] = time.time() + RETRY_S
        _say(f"stopped ({str(e)[:200]}) - next try in {RETRY_S // 60} min")
