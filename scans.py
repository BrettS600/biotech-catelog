"""
scans.py  -  Slab Show Scanner's scans.csv: the slabs the phone app reads, written into card-data.

Brett, 2026-11-09: "I want to have one called scans. And when I scan a barcode, the link will appear in the CSV file";
"the links should populate in the format like this csv" (his links.csv); "take the scans part of the code out of
collector.py, and put it into a new py ... and have the code perform the same functions".

WHERE THE FILE IS
  repo driftcodedev/card-data (private), branch main, data/scans/scans.csv - in links.csv's format: a "Cert ID" header,
  then one CSV-quoted cell a slab that opens the cert's page and shows the cert number, each slab once:
    Cert ID
    "=HYPERLINK(""https://www.psacard.com/cert/46790116/psa"",""46790116"")"
    "=HYPERLINK(""https://www.cgccards.com/certlookup/6153192005/"",""6153192005"")"

HOW A SCAN GETS THERE
  1. The phone app (page/app/app.js) sends every real slab it puts on a table over the site's signed channel:
     {type: 'scan', t, c: [["psa", "46790116"], ["cgc", "6153192005"], ...]}.
  2. collector.py reads the channel every minute and hands each such message to record() here; the links wait in the
     collector's state (v["scan_q"]) so nothing is lost across a restart.
  3. collector.py calls flush() every minute; flush() starts push() in the background, which adds the slabs not yet in
     scans.csv and pushes to card-data with card-data's own deploy key (/opt/pokemon-collector/.ssh/card_data_ed25519,
     write access, card-data only - Brett added it 2026-11-09). A sparse, shallow checkout keeps just data/scans on disk.
  4. Once a start, flush() tries the key even with nothing waiting (it writes the header if the file has none, else a
     dry-run push), so collector.log says at once whether card-data can be written.

START A NEW SHOW (2026-11-14, Brett: "when I click the start a new show button ... I want all of the links in the
scans.csv file to be erased ... I want that action to be immediate"; "scans still waiting to send go out before the
erase, so last show's scans can't land in the new file"): the phone sends its waiting slabs, then {type: 'scan_clear',
t}. clear() drops what still waits here (it belongs to the show that ended) and the next push writes the header alone,
then the new show's slabs. A generation number keeps a push that was already running from taking a new show's slab out
of the queue when it settles.

THE READS OF THE SCANS (2026-11-14, Brett: "as soon as read results are made available from the scans results file,
then I want those results to be immediately updated to the website ... those readings should also be uploaded to reflect
in the app itself"): Brett opens the scanned slabs' cert pages himself; his reader leaves each page, as read, in the
private repo driftcodedev/scan-results, folder scans/ (one JSON per read: grader_cert_time.json - the same shape as the cert
pages of card-data data/certs). reads_tick() (every SR_EVERY_S, from collector.py's fast tick) fetches that folder with
this machine's own read-only key (SR_KEY - made here on the first run; Brett adds its public half to scan-results as a
deploy key, read only; the website shows it while the key is not let in), reads the new files (the newest read of a
cert wins) and matches each slab to a card and grade of ours with match() and the site's index (scanidx.bin, built
by graded_site.py): the same cert known to us, else (PSA) another slab of the same card and grade in PSA's own list of
sales on that page, else the grader's wording of the card (name, set, number, variant) as on a cert page Brett opened
for a slab of ours. The grade is always the page's. A slab that matches nothing, or more than one card, or a grade we
have no data on, keeps its reason (why) - the website lists those under "Not in our data". collector.py sends the
changed reads at once on the channel's scan topic (<channel>-scr) and keeps them all in scan.bin on the live branch.
Nothing else in scan-results is read here, and nothing is ever written there. Since 2026-11-17 the fetch takes scans/
alone, by id (ONE FOLDER AT A TIME, below): scan-results also holds cardladder/ (clcerts.py reads that, once a day).

collector.py uses record(), clear(), flush() and reads_tick(); it sets log (its own, into collector.log) and DRY_RUN.
Nothing here runs on its own.
"""
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import json
import unicodedata
import urllib.request

# ---------------- settings ----------------
BASE = os.environ.get("COLLECTOR_HOME", "/opt/pokemon-collector")       # the same folder collector.py uses
DATA = os.path.join(BASE, "data")
KNOWN_HOSTS = os.path.join(BASE, ".ssh", "known_hosts")                # github.com's key, written by setup.sh
KEY = os.path.join(BASE, ".ssh", "card_data_ed25519")                  # card-data's deploy key (write access)
RUN_KEY = os.path.join(BASE, ".ssh", "scrap_run_token")                # a GitHub key that can only start runs in driftcodedev/scrap
RUN_URL = "https://api.github.com/repos/driftcodedev/scrap/actions/workflows/15.yml/dispatches"
REMOTE = os.environ.get("CARD_DATA_REMOTE", "git@github.com:driftcodedev/card-data.git")
CHECKOUT = os.path.join(DATA, "card-data-scans")                       # the sparse checkout: data/scans only
FILE = "data/scans/scans.csv"
HEADER = "Cert ID"
MAX_WAITING = 20000              # links held while card-data can't be reached
RETRY_S = 600                    # after a failed try (card-data unreachable, a key problem)
# the reads of the scans: the private repo driftcodedev/scan-results, folder scans/ only, read with this machine's own key
SR_REMOTE = os.environ.get("SCAN_RESULTS_REMOTE", "git@github.com:driftcodedev/scan-results.git")
SR_KEY = os.path.join(BASE, ".ssh", "scan_results_ed25519")            # made here on the first run; its .pub goes to the repo's deploy keys
SR_CHECKOUT = os.path.join(DATA, "scan-results")                       # a bare, tree-less clone: scans/ is all it ever fetches
SR_DIR = "scans"
SR_EVERY_S = 15                  # how often the folder is fetched (Brett: "the faster the better")
SR_RETRY_S = 120                 # after a failed fetch (the key not let in yet, GitHub unreachable)
DRY_RUN = "--dry-run" in sys.argv   # collector.py sets this too; a dry run never touches git


def log(*a):                     # collector.py replaces this with its own log (collector.log)
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


# the background push's progress, read by flush() on the main loop
_run = {"thread": None, "done": None, "added": 0, "err": None, "logged": 0.0, "err_logged": 0.0, "next": 0.0, "checked": False,
        "gen": 0, "cleared": None}
# the reads' background fetch: its result, read by reads_tick() on the main loop
_sr = {"thread": None, "out": None, "err": None, "next": 0.0, "err_logged": 0.0, "seen": {}, "first": True}
_CERT = re.compile(r"(psacard\.com/cert|cgccards\.com/certlookup)/(\d{7,13})")


# ---------------- the format ----------------
def link(grader, cert):
    """The cert's page: PSA's ends in /psa, CGC's in a slash (as in links.csv)."""
    return f"https://www.cgccards.com/certlookup/{cert}/" if grader == "cgc" else f"https://www.psacard.com/cert/{cert}/psa"


def row(grader, cert):
    """One line of scans.csv in links.csv's format: the cert's page as a clickable cell showing the cert number."""
    return f'"=HYPERLINK(""{link(grader, cert)}"",""{cert}"")"'


def slabs_in(text):
    """The slabs named in a text (a link, a row, the whole file): {(grader, cert)} - any link spelling counts."""
    return {("cgc" if "cgc" in d else "psa", c) for d, c in _CERT.findall(text or "")}


# ---------------- 1. a message from the phone (called by collector.py's read_requests) ----------------
def record(v, msg, t):
    """Slab Show Scanner's reads: queue each slab's link for scans.csv (new ones only; the file itself is checked again
    when it is written). v: the collector's state["vps"]."""
    q = v.setdefault("scan_q", [])
    have, n = set(q), 0
    for x in (msg.get("c") or [])[:200]:
        try:
            g, c = str(x[0]).lower(), str(x[1])
        except (TypeError, IndexError, KeyError):
            continue
        if (g == "psa" and re.fullmatch(r"\d{7,10}", c)) or (g == "cgc" and re.fullmatch(r"\d{7,13}", c)):
            lk = link(g, c)
            if lk not in have:
                q.append(lk)
                have.add(lk)
                n += 1
    del q[:-MAX_WAITING]
    v["scan_t"] = t
    if n:
        log(f"Scans: {n} slab link(s) from the phone app queued for card-data scans.csv ({len(q)} waiting)")


# ---------------- 1b. Start a new show on the phone (collector.py's read_requests) ----------------
def clear(v, msg, t):
    """{type: 'scan_clear', t}: empty scans.csv (the header stays). What still waits here belongs to the show that just
    ended - the phone sent it before the erase - so it goes too; the new show's slabs, queued after this, are written
    after the erase. A push already running settles without touching the new show's queue (the generation)."""
    v["scan_q"] = []
    v["scan_gen"] = v.get("scan_gen", 0) + 1
    v["scan_clear"] = t                                      # waiting to be written (flush)
    v["scan_clear_t"] = t                                    # asked (the phone and the website show "erased" once done >= asked)
    log("Scans: Start a new show on the phone - scans.csv will be emptied")


# ---------------- 2. every few seconds (called by collector.py's cycle and its fast tick) ----------------
def flush(v):
    """Settle the last push, then start one for whatever is waiting - the erase first when one was asked (never two at
    once)."""
    th = _run["thread"]
    if th is not None and th.is_alive():
        return
    if _run["done"] is not None:
        if _run["gen"] == v.get("scan_gen", 0):              # a push of the show before an erase leaves the new queue alone
            done = set(_run["done"])
            v["scan_q"] = [x for x in v.get("scan_q", []) if x not in done]
        v["scan_n"] = v.get("scan_n", 0) + _run["added"]
        _run["done"], _run["added"] = None, 0
    if _run["cleared"] is not None:
        if v.get("scan_clear") == _run["cleared"]:
            v["scan_clear"] = 0
        v["scan_cleared_t"] = max(v.get("scan_cleared_t", 0), _run["cleared"])
        _run["cleared"] = None
    if _run["err"]:
        _run["next"] = time.time() + RETRY_S
        if time.time() - _run["err_logged"] > 3600:
            _run["err_logged"] = time.time()
            log(f"Scans: card-data could not be written ({_run['err']}); {len(v.get('scan_q', []))} link(s) wait for the next try")
        _run["err"] = None
    q = v.get("scan_q") or []
    clr = v.get("scan_clear") or 0
    check = not _run["checked"]                              # once a start: try the key even with nothing waiting
    if (not q and not check and not clr) or DRY_RUN or (time.time() < _run["next"] and not clr):
        return
    if not os.path.exists(KEY):
        if time.time() - _run["logged"] > 3600:
            _run["logged"] = time.time()
            log(f"Scans: {len(q)} slab link(s) waiting - card-data's key ({KEY}) is not on this machine yet (CLAUDE.md: Slab Show Scanner, scans.csv)")
        _run["checked"] = True
        return
    _run["checked"] = True
    _run["gen"] = v.get("scan_gen", 0)
    _run["thread"] = threading.Thread(target=push, args=(list(q), check, clr), daemon=True)
    _run["thread"].start()


# ---------------- 4. the reads of the scans (scan-results/scans; called by collector.py's fast tick) ----------------
_NUM = re.compile(r"\d+(?:\.\d)?")
GRADES = {"psa": {"10", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5.5", "5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1"},
          "cgc": {"10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5.5", "5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1"}}


def grade_key(g, text, label=""):
    """The grade a cert page shows, as our grade key: PSA "NM-MT 8" -> 'psa|g8', "NM-MT+ 8.5" -> 'psa|g8_5'; CGC "7.5" ->
    'cgc|g7_5', a Pristine / Perfect 10 -> 'cgc|g10pristine' / 'cgc|g10perfect'. None when the page shows no number
    (Authentic, Unavailable)."""
    t = str(text or "")
    if g == "cgc" and re.search(r"pristine", t + " " + str(label or ""), re.I):
        return "cgc|g10pristine"
    if g == "cgc" and re.search(r"perfect", t + " " + str(label or ""), re.I):
        return "cgc|g10perfect"
    m = _NUM.findall(t)
    if not m or m[-1] not in GRADES.get(g, ()):
        return None
    return f"{g}|g{m[-1].replace('.', '_')}"


def lower_grade(gk):
    """The grade a half grade is priced at when its own line is too thin: PSA 8.5 -> 8, CGC 7.5 -> 7, a Pristine or
    Perfect 10 -> 10 (Brett, 2026-11-14: "rounding down would be safer"). Whole grades have none."""
    if not gk:
        return None
    g, k = gk.split("|", 1)
    if k in ("g10pristine", "g10perfect"):
        return f"{g}|g10"
    if k.endswith("_5"):
        return f"{g}|{k[:-2]}"
    return None


def _norm(x):
    x = unicodedata.normalize("NFKD", str(x or "")).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", x).split())


def _num(x):
    """A card number as words compare it: '084/109' and '84/109' alike, 'SWSH204' kept."""
    return re.sub(r"\d+", lambda m: str(int(m.group())), re.sub(r"[^A-Za-z0-9/]+", "", str(x or "")).upper())


def words_key(g, name, cset, number, variety, year="", language=""):
    """How the grader names the card, as one key: PSA year | brand | number | subject | variety, CGC name | set | number
    | variant | language. graded_site.py builds the index's keys with this same function from the cert pages Brett opened
    for slabs of ours, so a scanned slab's page finds its card when the grader names it the same way."""
    if g == "psa":
        parts = [_norm(year), _norm(cset), _num(number), _norm(name), _norm(variety)]
    else:
        parts = [_norm(name), _norm(cset), _num(number), _norm(variety), _norm(language or "english")]
    return "|".join(parts) if parts[0] or parts[1] else ""


def _int(x):
    try:
        return int(str(x).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _money(x):
    try:
        return round(float(str(x).replace(",", "").replace("$", "").strip()), 2)
    except (TypeError, ValueError):
        return None


def parse_read(o, name=""):
    """One file of scan-results/scans (a cert page as Brett's reader read it) -> the read, or None."""
    g = str(o.get("grader") or "").lower()
    cert = re.sub(r"\D", "", str(o.get("cert") or ""))
    if g not in ("psa", "cgc") or not cert:
        return None
    info, top = o.get("info") or {}, o.get("top") or {}
    if g == "psa":
        nm, st, no, vr, yr, lg = info.get("Subject"), info.get("Brand/Title"), info.get("Card Number"), info.get("Variety/Pedigree"), info.get("Year"), ""
        gt, lb = info.get("Item Grade") or top.get("Item Grade"), info.get("Label Type")
        pop, ph, est = _int(top.get("PSA Population")), _int(top.get("PSA Pop Higher")), _money(top.get("PSA Estimate"))
        cat = str(info.get("Category") or "")
        np_ = bool(cat) and "TCG" not in cat.upper()
        sales = []
        for x in o.get("sales") or []:
            m = re.match(r"^\s*PSA\s+(\d+(?:\.5)?)\s+(\d{7,10})\s*$", str(x.get("Cert") or ""))
            if m and m.group(2) != cert:
                sales.append(m.group(2))
    else:
        nm, st, no, vr, yr, lg = info.get("Card Name"), info.get("Card Set"), info.get("Card Number"), info.get("Variant 1"), info.get("Year"), info.get("Language")
        gt, lb = info.get("Grade"), None
        pp = o.get("pop") or {}
        pop = next((_int(v) for k, v in pp.items() if re.match(r"In .*Grade$", k) and "Higher" not in k), None)
        ph = _int(pp.get("In Higher Grades"))
        est, sales = None, []
        game = str(info.get("Game") or "")
        np_ = bool(game) and "pok" not in _norm(game)
    at = str(o.get("read_at") or "")
    if not at:
        m = re.search(r"_(\d{12,14})\.json$", name)
        at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(int(m.group(1)) / 1000)) if m else ""
    rd = {"g": g, "c": cert, "at": at, "nm": str(nm or ""), "st": str(st or ""), "no": str(no or ""), "vr": str(vr or ""),
          "yr": str(yr or ""), "lg": str(lg or ""), "gt": str(gt or ""), "lb": str(lb or ""), "pop": pop, "ph": ph, "est": est,
          "gk": grade_key(g, gt, lb), "wk": words_key(g, nm, st, no, vr, yr, lg), "sales": sales[:30]}
    if np_:
        rd["np"] = 1
    return rd


def match(rd, idx):
    """Which card and grade of ours a read is: {"cid", "gk" (always the page's grade), "how" ('cert' - the same cert is
    ours; 'sales' - PSA's own list of sales of this card and grade on the page names slabs of ours of one card; 'words' -
    the grader names it exactly as on a page Brett opened for a slab of ours), "why" ('' matched; 'no card' - not a card
    in our data, e.g. under $50; 'several' - it could be more than one of our cards; 'no grade' - the page shows no
    grade; 'no grade data' - our card, but we have no figures for this grade or the one below; 'not pokemon'; 'wait' -
    the site's index not read yet)}."""
    m = {"cid": None, "gk": rd.get("gk"), "how": "", "why": ""}
    if not idx:
        m["why"] = "wait"
        return m
    certs, words, rows, gks = idx.get("certs") or {}, idx.get("words") or {}, idx.get("rows") or {}, idx.get("gk") or []
    cid, how, several = None, "", False
    hit = certs.get(rd["g"] + ":" + rd["c"])
    if hit:
        cid, how = hit[0], "cert"
    if cid is None and rd.get("sales"):
        found = {certs[k][0] for k in (rd["g"] + ":" + c for c in rd["sales"]) if k in certs}
        if len(found) == 1:
            cid, how = found.pop(), "sales"
        elif len(found) > 1:
            several = True
    if cid is None and rd.get("wk"):
        w = words.get(rd["g"] + "|" + rd["wk"])
        if w:
            cid, how = w, "words"
        elif w == 0:
            several = True
    if cid is None:
        m["why"] = "several" if several else "not pokemon" if rd.get("np") else "no card"
        return m
    m["cid"], m["how"] = int(cid), how
    gk = rd.get("gk")
    if not gk:
        m["why"] = "no grade"
        return m
    have = set(rows.get(str(cid)) or [])
    lo = lower_grade(gk)
    if (gk not in gks or gks.index(gk) not in have) and (lo not in gks or gks.index(lo) not in have):
        m["why"] = "no grade data"
    return m


def compact(rd):
    """A read as the website and the phone get it (the empty fields left out)."""
    m = rd.get("m") or {}
    out = {"g": rd["g"], "c": rd["c"], "at": rd.get("at", ""), "gk": m.get("gk") or rd.get("gk"), "cid": m.get("cid"),
           "how": m.get("how", ""), "why": m.get("why", "")}
    for k in ("nm", "st", "no", "vr", "yr", "lg", "gt", "lb", "pop", "ph", "est"):
        if rd.get(k) not in (None, ""):
            out[k] = rd[k]
    return {k: v for k, v in out.items() if v not in (None, "")}


def sr_git(*args, cwd=None, check=True, timeout=120):
    env = dict(os.environ)
    env["GIT_SSH_COMMAND"] = f"ssh -i {SR_KEY} -o UserKnownHostsFile={KNOWN_HOSTS} -o IdentitiesOnly=yes -o BatchMode=yes"
    r = subprocess.run(["git", *args], cwd=cwd or SR_CHECKOUT, capture_output=True, text=True, env=env, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:2])}: {r.stderr.strip()[:300]}")
    return r


def sr_pub(v):
    """This machine's read-only key for scan-results (made on the first run; the private half never leaves this
    machine). Its public half is kept in v["sr_pub"] for the website, which shows it while the key is not let in."""
    if not os.path.exists(SR_KEY):
        if DRY_RUN:
            return None
        try:
            os.makedirs(os.path.dirname(SR_KEY), exist_ok=True)
            r = subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "pokemon-collector, read only: driftcodedev/scan-results",
                                "-f", SR_KEY], capture_output=True, text=True, timeout=60)
            if r.returncode != 0:
                raise RuntimeError(r.stderr.strip()[:200])
            log(f"Scans: made this machine's read-only key for scan-results; its public half: {open(SR_KEY + '.pub').read().strip()}")
        except Exception as e:
            if time.time() - _sr["err_logged"] > 3600:
                _sr["err_logged"] = time.time()
                log(f"Scans: could not make the key for scan-results ({str(e)[:200]})")
            return None
    try:
        v["sr_pub"] = open(SR_KEY + ".pub", encoding="utf-8").read().strip()
    except OSError:
        return None
    return v["sr_pub"]


# ONE FOLDER AT A TIME, NOTHING ELSE (2026-11-17): scan-results also holds cardladder/ now - Brett's reads of the Card
# Ladder certs, ~100,000 files - and a checkout, sparse or not, downloads every folder's listing on each fetch (git
# sends all the trees). So the repository here is a bare, tree-less partial clone (--filter=tree:0): a fetch brings
# the commit alone; the root's listing, the one folder's listing and that folder's new files are then fetched BY ID,
# each alone (sr_get - an object asked for by id comes without what it points to). Never let git fetch a missing tree
# on its own: its automatic fetch asks for every tree under it (that is how cardladder/'s listing came along).
_SR_GET = ["-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q", "--no-tags", "--no-write-fetch-head", "--recurse-submodules=no",
           "--filter=tree:0", "--stdin", "origin"]


def sr_run(args, cwd, inp=None, timeout=300):
    """git with this machine's scan-results key, raw bytes in and out."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    env["GIT_SSH_COMMAND"] = f"ssh -i {SR_KEY} -o UserKnownHostsFile={KNOWN_HOSTS} -o IdentitiesOnly=yes -o BatchMode=yes"
    r = subprocess.run(["git", *args], cwd=cwd, input=inp, capture_output=True, env=env, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(a for a in args[:4] if not a.startswith('-c'))}: {r.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return r.stdout


def sr_get(repo, ids, chunk=5000):
    """Fetch these objects by id, each alone (a tree without its subtrees, a file)."""
    ids = [i for i in dict.fromkeys(ids) if i]
    for n in range(0, len(ids), chunk):
        sr_run(_SR_GET, repo, inp=("\n".join(ids[n:n + chunk]) + "\n").encode(), timeout=900)


def sr_folder(repo, rev, folder):
    """{file name: blob id} of one top-level folder of the commit rev (its listing fetched alone; {} when it has none)."""
    root = re.search(rb"^tree ([0-9a-f]{40})", sr_run(["cat-file", "commit", rev], repo), re.M)
    if not root:
        return {}
    root = root.group(1).decode()
    sr_get(repo, [root])
    sub = None
    for ent in sr_run(["ls-tree", "-z", root], repo).split(b"\0"):
        meta, _, path = ent.partition(b"\t")
        if path.decode("utf-8", "replace") == folder and meta.split()[1:2] == [b"tree"]:
            sub = meta.split()[2].decode()
    if not sub:
        return {}
    sr_get(repo, [sub])
    out = {}
    for ent in sr_run(["ls-tree", "-z", sub], repo).split(b"\0"):
        meta, _, path = ent.partition(b"\t")
        parts = meta.split()
        if len(parts) == 3 and parts[1] == b"blob":
            out[path.decode("utf-8", "replace")] = parts[2].decode()
    return out


def sr_blobs(repo, ids):
    """{blob id: bytes}: the files' contents, fetched in one go (a chunk at a time) and read back with cat-file."""
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    sr_get(repo, ids)
    raw, out, i = sr_run(["cat-file", "--batch"], repo, inp=("\n".join(ids) + "\n").encode(), timeout=900), {}, 0
    while i < len(raw):
        j = raw.index(b"\n", i)
        head = raw[i:j].split()
        if len(head) != 3:                                   # "<id> missing"
            i = j + 1
            continue
        size = int(head[2])
        out[head[0].decode()] = raw[j + 1:j + 1 + size]
        i = j + 1 + size + 1
    return out


def sr_repo(repo, fresh=False):
    """The bare, tree-less clone of scan-results at repo, fetched now -> the commit to read ("HEAD" right after a clone,
    else FETCH_HEAD). The one commit is replaced on every save (Brett), so: never a pull, and now and then a fresh clone."""
    if fresh or not os.path.isfile(os.path.join(repo, "HEAD")) or os.path.isdir(os.path.join(repo, ".git")):
        shutil.rmtree(repo, ignore_errors=True)              # (also the sparse checkout the reads used before 2026-11-17)
        os.makedirs(os.path.dirname(repo), exist_ok=True)
        sr_run(["clone", "-q", "--bare", "--depth", "1", "--filter=tree:0", "--single-branch", SR_REMOTE, repo], os.path.dirname(repo))
        return "HEAD"
    try:
        if sr_run(["config", "--get", "remote.origin.url"], repo).decode().strip() != SR_REMOTE:   # a clone from before the rename
            sr_run(["remote", "set-url", "origin", SR_REMOTE], repo)                        # BrettS600 -> driftcodedev
    except Exception:
        pass
    sr_run(["fetch", "-q", "--depth", "1", "--filter=tree:0", "origin", "main"], repo, timeout=120)
    return "FETCH_HEAD"


def _sr_fetch():
    """(its own thread) Fetch scan-results and read the files of scans/ not read before. -> _sr["out"]: {grader:cert: read}.
    Only scans/'s listing and its new files are ever fetched (ONE FOLDER AT A TIME, above)."""
    try:
        _sr["n"] = _sr.get("n", 0) + 1
        rev = sr_repo(SR_CHECKOUT, fresh=_sr["n"] % 2000 == 0)
        files = {n: b for n, b in sr_folder(SR_CHECKOUT, rev, SR_DIR).items() if n.endswith(".json") and n not in _sr["seen"]}
        got, out = sr_blobs(SR_CHECKOUT, files.values()), {}
        for name in sorted(files):
            if files[name] not in got:
                continue
            _sr["seen"][name] = 1
            try:
                rd = parse_read(json.loads(got[files[name]].decode("utf-8")), name)
            except (UnicodeDecodeError, ValueError):
                continue
            if rd:
                k = rd["g"] + ":" + rd["c"]
                if k not in out or rd["at"] >= out[k]["at"]:
                    out[k] = rd
        _sr["out"] = out
    except Exception as e:
        _sr["err"] = str(e)[:300]


def reads_tick(v, idx=None):
    """Settle the last fetch of scan-results (new reads into v["scan_reads"], matched with the site's index idx), match
    every read again when the index changed, then start the next fetch once SR_EVERY_S has passed. Returns
    (the keys whose read changed, True when every read was matched again)."""
    changed, full = [], False
    th = _sr["thread"]
    if th is not None and th.is_alive():
        return changed, full
    reads = v.setdefault("scan_reads", {})
    if _sr["out"] is not None:
        out, _sr["out"] = _sr["out"], None
        for k, rd in out.items():
            old = reads.get(k)
            if old is None or rd["at"] > old.get("at", ""):
                reads[k] = rd
                changed.append(k)
        if not v.get("sr_ok"):
            log(f"Scans: scan-results is read ({len(reads)} slab read(s) on file)")
        v["sr_ok"], v["sr_err"] = True, ""
        if changed:
            log(f"Scans: {len(changed)} new read(s) from scan-results")
    if _sr["err"]:
        err, _sr["err"] = _sr["err"], None
        v["sr_ok"] = False
        v["sr_err"] = "the key is not let in yet" if re.search(r"Permission denied|not found|Could not read from remote", err, re.I) else err[:200]
        _sr["next"] = time.time() + SR_RETRY_S
        if time.time() - _sr["err_logged"] > 3600:
            _sr["err_logged"] = time.time()
            log(f"Scans: scan-results could not be read ({err[:200]}) - "
                + ("add this machine's public key to driftcodedev/scan-results as a read-only deploy key" if v["sr_err"].startswith("the key") else "next try in a while"))
    stamp = (idx or {}).get("t") if idx else None
    if stamp is not None and stamp != v.get("sr_idx_t"):
        v["sr_idx_t"] = stamp
        changed, full = list(reads), True
    for k in changed:
        reads[k]["m"] = match(reads[k], idx)
    if DRY_RUN or time.time() < _sr["next"]:
        return changed, full
    if not sr_pub(v):
        return changed, full
    _sr["next"] = time.time() + SR_EVERY_S
    _sr["thread"] = threading.Thread(target=_sr_fetch, daemon=True)
    _sr["thread"].start()
    return changed, full


# ---------------- 3. the write itself (in its own thread) ----------------
def git(*args, cwd=None, check=True, timeout=120):
    env = dict(os.environ)
    env["GIT_SSH_COMMAND"] = f"ssh -i {KEY} -o UserKnownHostsFile={KNOWN_HOSTS} -o IdentitiesOnly=yes -o BatchMode=yes"
    r = subprocess.run(["git", *args], cwd=cwd or CHECKOUT, capture_output=True, text=True, env=env, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])}: {r.stderr.strip()[:300]}")
    return r

def start_scan_run(n):
    """Tells driftcodedev/scrap to open the new scans now. Only "start" is sent - scrap reads scans.csv itself.
    A failure is only logged: the push already worked, and scrap also checks scans.csv on its own."""
    try:
        if not os.path.exists(RUN_KEY):
            if time.time() - _run.get("run_key_logged", 0) > 3600:
                _run["run_key_logged"] = time.time()
                log(f"Scans: scrap's run key ({RUN_KEY}) is not on this machine yet - the new scans wait for scrap's own check")
            return
        token = open(RUN_KEY, encoding="utf-8").read().strip()
        req = urllib.request.Request(RUN_URL, data=json.dumps({"ref": "main"}).encode(), method="POST", headers={
            "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pokemon-collector"})
        with urllib.request.urlopen(req, timeout=20) as r:
            status = r.status
        log(f"Scans: asked scrap to open the {n} new slab link(s)" if status == 204 else
            f"Scans: scrap answered {status} to the start signal")
    except Exception as e:
        log(f"Scans: couldn't start scrap's run ({str(e)[:200]}); scrap's own check will pick the scans up")

def push(snap, check=False, clr=0):
    """Add the slabs not yet in scans.csv (the Cert ID header first if the file has none), commit, push to card-data's
    main - from the top again when someone else pushed in between (the other card-data writers pull --rebase too). check
    (once a start): with nothing to add, a dry-run push proves the key may write. clr (the time of a Start a new show):
    the file is emptied first - the header, then only snap."""
    try:
        if not os.path.isdir(os.path.join(CHECKOUT, ".git")):
            shutil.rmtree(CHECKOUT, ignore_errors=True)
            git("clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", "main", REMOTE, CHECKOUT, cwd=DATA, timeout=300)
            git("sparse-checkout", "set", "data/scans")
            git("config", "user.name", "pokemon-collector")
            git("config", "user.email", "collector@users.noreply.github.com")
        if git("config", "--get", "remote.origin.url", check=False).stdout.strip() != REMOTE:   # a clone made before the account was
            git("remote", "set-url", "origin", REMOTE)       # renamed BrettS600 -> driftcodedev (2026-11-23)
        path = os.path.join(CHECKOUT, FILE)
        for _ in range(3):
            git("fetch", "-q", "--depth", "1", "origin", "main", timeout=300)
            git("reset", "-q", "--hard", "FETCH_HEAD")
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
            gone = len(slabs_in(old)) if clr else 0
            if clr:
                old = HEADER + "\n"                          # Start a new show: the file starts over
            have = slabs_in(old)
            new = []
            for x in snap:
                for k in sorted(slabs_in(x)):
                    if k not in have:
                        have.add(k)
                        new.append(k)
            lines = old.splitlines()
            head = not lines or lines[0].strip().lstrip(chr(0xFEFF)) != HEADER
            if not new and not head and not clr:
                if check:
                    git("push", "--dry-run", "-q", "origin", "HEAD:main", timeout=300)
                    log(f"Scans: card-data's key works (read and write); {FILE} is ready ({len(have)} slab(s) in it)")
                _run["added"], _run["done"] = 0, list(snap)
                return
            body = old if not old or old.endswith("\n") else old + "\n"
            if head:
                body = HEADER + "\n" + body
            body += "".join(row(g, c) + "\n" for g, c in new)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(body)
            git("add", FILE)
            msg = (f"scans: Start a new show - the {gone} link(s) of the last show erased" + (f", {len(new)} new" if new else "")) if clr else \
                f"scans: {len(new)} slab link(s) from Slab Show Scanner" if new else "scans: the Cert ID header (links.csv's format)"
            if git("diff", "--cached", "--quiet", check=False).returncode == 0:     # the same text: nothing to commit
                _run["added"], _run["done"], _run["cleared"] = 0, list(snap), (clr or None)
                return
            git("commit", "-q", "-m", msg)
            if git("push", "-q", "origin", "HEAD:main", check=False, timeout=300).returncode == 0:
                _run["added"], _run["done"] = len(new), list(snap)
                if clr:
                    _run["cleared"] = clr
                log((f"Scans: Start a new show - {FILE} emptied ({gone} link(s) of the last show erased)" + (f", {len(new)} new slab link(s) written" if new else "")) if clr else
                    f"Scans: {len(new)} slab link(s) added to card-data {FILE} ({len(have)} in the file)" if new else
                    f"Scans: card-data's key works (read and write); the Cert ID header is in {FILE}")
                if new:
                    start_scan_run(len(new))
                return
        raise RuntimeError("card-data refused the push three times")
    except Exception as e:
        _run["err"] = str(e)[:300]
