"""
clcerts.py  -  the CL Cert columns' lookups: Brett's reads of the Card Ladder certs, into card-data once a day.

(The account is driftcodedev since 2026-11-23: the repo is driftcodedev/scan-results.)
Brett, 2026-11-17: "results for the card ladders certs will be stored here: https://github.com/driftcodedev/scan-results/
tree/main/cardladder ... only retrieve results from this file. please update the card ladder columns with all of the
results in the files once per day. furthermore, this will enable us to match the PC cards with CL cards because if the
text from pc cert matches the text from the cl cert, then we know they are same the card"; asked about the reads, "i have
special api access to psa and cgc"; on a mismatch: flag it, he reviews (nothing re-paired).

WHAT IT DOES
  The certs are the ones in card-data data/cardladder/pic_certs/card_ladder_cert.csv (cl_certs.js: the cert numbers read
  off Card Ladder's sale pictures, and since 2026-11-20 the PriceCharting photo certs not read yet - pic_certs/
  pc_certs.csv; every read is filed here alike, and graded_site.py puts each page under the side its cert is from).
  Brett's reader leaves one JSON a cert page in scan-results/cardladder/
  (<grader>_<cert>_<ms>.json - the same shape as scans/, parsed with scans.parse_read). Once a UTC day, after HOUR_UTC
  (the site builds at 10:00 UTC), collector.py's fast tick starts tick() here, which in its own thread:
    1. fetches scan-results' cardladder/ ALONE (scans.sr_repo / sr_folder / sr_blobs: a bare, tree-less clone of its own;
       the listing and the files not filed yet, by id - nothing of any other folder),
    2. reads the new files (the newest read of a cert wins),
    3. appends one row a cert to card-data data/cardladder/cert_pages/cert_pages_<YYYY-MM>.csv (the month it is filed;
       COLS) and pushes with card-data's own deploy key (scans.KEY; a sparse checkout of that folder alone).
  graded_site.load_cl_pages reads those files at the next site build and fills the eleven CL Cert columns, and the
  PC/CL Cert Match column beside them.
  A file already filed (by name - its time is in the name) is not read again. State in v["clp"]: the day done, the
  totals, the last error (retried after RETRY_S).

collector.py uses tick(); it sets scans.log / scans.DRY_RUN (shared). Nothing here runs on its own.
"""
import csv
import io
import json
import os
import re
import shutil
import threading
import time

import scans

DIR = "cardladder"                                                      # the one folder of scan-results read here
SR_REPO = os.path.join(scans.DATA, "scan-results-cardladder")           # its own bare, tree-less clone
CD_CHECKOUT = os.path.join(scans.DATA, "card-data-certpages")           # card-data, data/cardladder/cert_pages only
CD_DIR = "data/cardladder/cert_pages"
HOUR_UTC = 8                     # once a UTC day, from 08:00 UTC (the site builds at 10:00 UTC)
RETRY_S = 1800                   # after a failed run
FRESH_RUNS = 30                  # a fresh clone of scan-results every so many runs (its one commit is replaced on every save)
CHUNK = 5000                     # files fetched and read at a time
COLS = ["file", "read_at", "grader", "cert", "name", "set", "number", "variety", "year", "language", "category", "grade",
        "label", "pop", "pop_higher", "estimate"]
_FILE = re.compile(r"^(psa|cgc)_(\d{7,13})_(\d{10,14})\.json$")

_run = {"thread": None, "res": None, "err": None, "next": 0.0}


def _day():
    return time.strftime("%Y-%m-%d", time.gmtime())


def tick(v):
    """Called every few seconds by collector.py: settle a finished run, start today's once it is due."""
    st = v.setdefault("clp", {})
    th = _run["thread"]
    if th is not None and th.is_alive():
        return
    if _run["res"] is not None:
        res, _run["res"] = _run["res"], None
        st.update(day=res["day"], t=int(time.time()), files=res["files"], new=res["new"], filed=res["filed"], err="")
        scans.log(f"CL certs: scan-results/{DIR} has {res['files']:,} read(s); {res['new']:,} new filed into card-data "
                  f"{CD_DIR} ({res['filed']:,} certs on file)")
    if _run["err"]:
        err, _run["err"] = _run["err"], None
        st["err"] = err
        _run["next"] = time.time() + RETRY_S
        scans.log(f"CL certs: the daily run failed ({err}) - next try in {RETRY_S // 60} min")
    if scans.DRY_RUN or st.get("day") == _day() or time.gmtime().tm_hour < HOUR_UTC or time.time() < _run["next"]:
        return
    if not os.path.exists(scans.SR_KEY) or not os.path.exists(scans.KEY):
        return                                               # the keys come with scans.py's own setup (logged there)
    st["runs"] = st.get("runs", 0) + 1
    _run["thread"] = threading.Thread(target=_daily, args=(st["runs"] % FRESH_RUNS == 0,), daemon=True)
    _run["thread"].start()


def row_of(name, raw):
    """One file of scan-results/cardladder -> its row (COLS), or None."""
    try:
        o = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    rd = scans.parse_read(o, name)
    if not rd:
        return None
    info = o.get("info") or {}
    cat = info.get("Category") or info.get("Game") or ""
    return {"file": name, "read_at": rd["at"], "grader": rd["g"], "cert": rd["c"], "name": rd["nm"], "set": rd["st"],
            "number": rd["no"], "variety": rd["vr"], "year": rd["yr"], "language": rd["lg"], "category": str(cat),
            "grade": rd["gt"], "label": rd["lb"], "pop": "" if rd["pop"] is None else rd["pop"],
            "pop_higher": "" if rd["ph"] is None else rd["ph"], "estimate": "" if rd["est"] is None else rd["est"]}


def on_file(folder):
    """The files already filed ({name}) and the newest read time filed for each (grader, cert)."""
    names, newest = set(), {}
    for f in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not re.match(r"^cert_pages_\d{4}-\d{2}\.csv$", f):
            continue
        with open(os.path.join(folder, f), newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                names.add(r.get("file") or "")
                k = (r.get("grader") or "", r.get("cert") or "")
                if (r.get("read_at") or "") > newest.get(k, ""):
                    newest[k] = r.get("read_at") or ""
    return names, newest


def _daily(fresh=False):
    """(its own thread) scan-results/cardladder -> card-data cert_pages. -> _run["res"] / _run["err"]."""
    try:
        rev = scans.sr_repo(SR_REPO, fresh=fresh)
        listing = {n: b for n, b in scans.sr_folder(SR_REPO, rev, DIR).items() if _FILE.match(n)}
        # card-data: a sparse checkout of the cert pages folder alone, card-data's own key
        if not os.path.isdir(os.path.join(CD_CHECKOUT, ".git")):
            shutil.rmtree(CD_CHECKOUT, ignore_errors=True)
            scans.git("clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", "main", scans.REMOTE, CD_CHECKOUT,
                      cwd=scans.DATA, timeout=300)
            scans.git("sparse-checkout", "set", CD_DIR, cwd=CD_CHECKOUT)
            scans.git("config", "user.name", "pokemon-collector", cwd=CD_CHECKOUT)
            scans.git("config", "user.email", "collector@users.noreply.github.com", cwd=CD_CHECKOUT)
        folder = os.path.join(CD_CHECKOUT, CD_DIR)
        for _ in range(3):
            scans.git("fetch", "-q", "--depth", "1", "origin", "main", cwd=CD_CHECKOUT, timeout=300)
            scans.git("reset", "-q", "--hard", "FETCH_HEAD", cwd=CD_CHECKOUT)
            names, newest = on_file(folder)
            todo = sorted(n for n in listing if n not in names)
            best = {}                                        # (grader, cert) -> the newest new read
            for i in range(0, len(todo), CHUNK):             # a chunk of files at a time: the first run has ~100,000
                part = todo[i:i + CHUNK]
                got = scans.sr_blobs(SR_REPO, [listing[n] for n in part])
                for n in part:
                    r = row_of(n, got[listing[n]]) if listing[n] in got else None
                    if not r:
                        continue
                    k = (r["grader"], r["cert"])
                    if r["read_at"] > newest.get(k, "") and (k not in best or r["read_at"] >= best[k]["read_at"]):
                        best[k] = r
            new = sorted(best.values(), key=lambda r: (r["read_at"], r["grader"], r["cert"]))
            filed = len(set(newest) | set(best))
            res = {"day": _day(), "files": len(listing), "new": len(new), "filed": filed}
            if not new:
                _run["res"] = res
                return
            path = os.path.join(folder, f"cert_pages_{time.strftime('%Y-%m', time.gmtime())}.csv")
            os.makedirs(folder, exist_ok=True)
            head = not os.path.exists(path) or os.path.getsize(path) == 0
            buf = io.StringIO()
            w = csv.DictWriter(buf, fieldnames=COLS, lineterminator="\n")
            if head:
                w.writeheader()
            w.writerows(new)
            with open(path, "a", encoding="utf-8", newline="") as fh:
                fh.write(buf.getvalue())
            scans.git("add", "--", CD_DIR, cwd=CD_CHECKOUT)
            scans.git("commit", "-q", "-m", f"CL cert pages: {len(new)} read(s) from scan-results/{DIR}", cwd=CD_CHECKOUT)
            if scans.git("push", "-q", "origin", "HEAD:main", check=False, cwd=CD_CHECKOUT, timeout=300).returncode == 0:
                _run["res"] = res
                return
        raise RuntimeError("card-data refused the push three times")
    except Exception as e:
        _run["err"] = str(e)[:300]
