"""
scans.py  -  Slab Show Scanner's scans.csv: the slabs the phone app reads, written into card-data.

Brett, 2026-11-09: "I want to have one called scans. And when I scan a barcode, the link will appear in the CSV file";
"the links should populate in the format like this csv" (his links.csv); "take the scans part of the code out of
collector.py, and put it into a new py ... and have the code perform the same functions".

WHERE THE FILE IS
  repo BrettS600/card-data (private), branch main, data/scans/scans.csv - in links.csv's format: a "Cert ID" header,
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

collector.py uses only record() and flush(); it sets log (its own, into collector.log) and DRY_RUN. Nothing here runs
on its own.
"""
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import json
import urllib.request

# ---------------- settings ----------------
BASE = os.environ.get("COLLECTOR_HOME", "/opt/pokemon-collector")       # the same folder collector.py uses
DATA = os.path.join(BASE, "data")
KNOWN_HOSTS = os.path.join(BASE, ".ssh", "known_hosts")                # github.com's key, written by setup.sh
KEY = os.path.join(BASE, ".ssh", "card_data_ed25519")                  # card-data's deploy key (write access)
RUN_KEY = os.path.join(BASE, ".ssh", "scrap_run_token")                # a GitHub key that can only start runs in BrettS600/scrap
RUN_URL = "https://api.github.com/repos/BrettS600/scrap/actions/workflows/15.yml/dispatches"
REMOTE = os.environ.get("CARD_DATA_REMOTE", "git@github.com:BrettS600/card-data.git")
CHECKOUT = os.path.join(DATA, "card-data-scans")                       # the sparse checkout: data/scans only
FILE = "data/scans/scans.csv"
HEADER = "Cert ID"
MAX_WAITING = 20000              # links held while card-data can't be reached
RETRY_S = 600                    # after a failed try (card-data unreachable, a key problem)
DRY_RUN = "--dry-run" in sys.argv   # collector.py sets this too; a dry run never touches git


def log(*a):                     # collector.py replaces this with its own log (collector.log)
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


# the background push's progress, read by flush() on the main loop
_run = {"thread": None, "done": None, "added": 0, "err": None, "logged": 0.0, "err_logged": 0.0, "next": 0.0, "checked": False}
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


# ---------------- 2. every minute (called by collector.py's cycle) ----------------
def flush(v):
    """Settle the last push, then start one for whatever is waiting (never two at once)."""
    th = _run["thread"]
    if th is not None and th.is_alive():
        return
    if _run["done"] is not None:
        done = set(_run["done"])
        v["scan_q"] = [x for x in v.get("scan_q", []) if x not in done]
        v["scan_n"] = v.get("scan_n", 0) + _run["added"]
        _run["done"], _run["added"] = None, 0
    if _run["err"]:
        _run["next"] = time.time() + RETRY_S
        if time.time() - _run["err_logged"] > 3600:
            _run["err_logged"] = time.time()
            log(f"Scans: card-data could not be written ({_run['err']}); {len(v.get('scan_q', []))} link(s) wait for the next try")
        _run["err"] = None
    q = v.get("scan_q") or []
    check = not _run["checked"]                              # once a start: try the key even with nothing waiting
    if (not q and not check) or DRY_RUN or time.time() < _run["next"]:
        return
    if not os.path.exists(KEY):
        if time.time() - _run["logged"] > 3600:
            _run["logged"] = time.time()
            log(f"Scans: {len(q)} slab link(s) waiting - card-data's key ({KEY}) is not on this machine yet (CLAUDE.md: Slab Show Scanner, scans.csv)")
        _run["checked"] = True
        return
    _run["checked"] = True
    _run["thread"] = threading.Thread(target=push, args=(list(q), check), daemon=True)
    _run["thread"].start()


# ---------------- 3. the write itself (in its own thread) ----------------
def git(*args, cwd=None, check=True, timeout=120):
    env = dict(os.environ)
    env["GIT_SSH_COMMAND"] = f"ssh -i {KEY} -o UserKnownHostsFile={KNOWN_HOSTS} -o IdentitiesOnly=yes -o BatchMode=yes"
    r = subprocess.run(["git", *args], cwd=cwd or CHECKOUT, capture_output=True, text=True, env=env, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])}: {r.stderr.strip()[:300]}")
    return r

def start_scan_run(n):
    """Tells BrettS600/scrap to open the new scans now. Only "start" is sent - scrap reads scans.csv itself.
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

def push(snap, check=False):
    """Add the slabs not yet in scans.csv (the Cert ID header first if the file has none), commit, push to card-data's
    main - from the top again when someone else pushed in between (the other card-data writers pull --rebase too). check
    (once a start): with nothing to add, a dry-run push proves the key may write."""
    try:
        if not os.path.isdir(os.path.join(CHECKOUT, ".git")):
            shutil.rmtree(CHECKOUT, ignore_errors=True)
            git("clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", "main", REMOTE, CHECKOUT, cwd=DATA, timeout=300)
            git("sparse-checkout", "set", "data/scans")
            git("config", "user.name", "pokemon-collector")
            git("config", "user.email", "collector@users.noreply.github.com")
        path = os.path.join(CHECKOUT, FILE)
        for _ in range(3):
            git("fetch", "-q", "--depth", "1", "origin", "main", timeout=300)
            git("reset", "-q", "--hard", "FETCH_HEAD")
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
            have = slabs_in(old)
            new = []
            for x in snap:
                for k in sorted(slabs_in(x)):
                    if k not in have:
                        have.add(k)
                        new.append(k)
            lines = old.splitlines()
            head = not lines or lines[0].strip().lstrip(chr(0xFEFF)) != HEADER
            if not new and not head:
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
            git("commit", "-q", "-m", f"scans: {len(new)} slab link(s) from Slab Show Scanner" if new else "scans: the Cert ID header (links.csv's format)")
             if git("push", "-q", "origin", "HEAD:main", check=False, timeout=300).returncode == 0:
                _run["added"], _run["done"] = len(new), list(snap)
                log(f"Scans: {len(new)} slab link(s) added to card-data {FILE} ({len(have)} in the file)" if new else
                    f"Scans: card-data's key works (read and write); the Cert ID header is in {FILE}")
                if new:
                    start_scan_run(len(new))
                return
        raise RuntimeError("card-data refused the push three times")
    except Exception as e:
        _run["err"] = str(e)[:300]
