"""graded_site.py - the data behind the PriceCharting tab's graded view (Brett, 2026-10-27: "only show graded ...
PSA or CGC ID ... CL set name ... PC to CL % difference ... a PSA Trend with PC and CL lines").

Run by the site workflow after build_catalog.py (which leaves pricecharting.csv and the snapshots on disk):

    python graded_site.py --card-data card-data/data --out public

Reads (card-data is the private repo BrettS600/card-data, checked out by the workflow with DATA_REPO_TOKEN):
  ids/card_ids.csv                         which Card Ladder profile each PriceCharting card is (cardmatch / the barcode
                                           chain): pricecharting_id, cl_profile_id, psa_spec, cgc_id, psa_cert, cgc_cert,
                                           status (confirmed / likely / review / no_match), note
  cardladder/matches/*.jsonl.gz            the slab evidence: one cert per grade read off PriceCharting's sold-listing
                                           photos (slabs), Card Ladder's cert lookups (grade, label, finish)
  cardladder/profiles/*.jsonl.gz           the Card Ladder profile reads, one JSON object per line (newest wins):
                                           {pc, read, pid, label, year, set, number, subject, variation, image, graders:
                                           [{g, id, pop, grades: [[key, label, pop, cl value, last sold, conf]]}],
                                           monthly: {"psa|g10": [[YYYY-MM, n, avg, n auction, n best offer, n fixed]]}}
  ids/marks.csv                            the Review answers and flags sent from the page (optional)
  pricecharting/pop/pop_<YYYY-MM>.csv.gz   PriceCharting's PSA / CGC population (the newest file)
  pricecharting/graded_sales/*.csv.gz      PriceCharting's graded sold listings (grade, grader read off the title)
  pricecharting/pc_graded_monthly_*.csv.gz PriceCharting's monthly graded chart lines (optional - full archive runs)
  dictionary/terms.csv                     the words that sort what each side says into Rarity / Finish / Special /
                                           Series / Era (graded_terms.py; Brett, 2026-10-28)
  dictionary/decisions.csv                 the words Brett sorted on the page, as graded_answers.py filed them
  tcgplayer/details.csv                    TCGplayer's product page details - the Artist (tcg_details.py)
  psa/certs.csv                            PSA's own record of each slab, from PSA's Public API (cert_lookups.py)
  cardhedge/certs.csv                      each slab as Card Hedge relays it from GemRate, and Card Hedge's matched card
and tcg_facts.json.gz (build_catalog.py: TCGplayer's own rarity / number / printings for the product each
PriceCharting card links to), pricecharting.csv (today's PriceCharting prices) and snapshots/pc_catalog_*.csv.gz.enc (the daily history).

Writes, encrypted with the page's history key (PBKDF2 of SITE_PASSWORD, salt biotech-catalog-live-v1 - the key the
Trend shards and the eBay live file use, so the page can read them):
  <out>/graded.bin        {v, built, gk: [grade keys], cards: {pc id: card meta}, rows: [[...]]} - the table
  <out>/gtrend/s<n>.bin   {pc id: {cl: {gk: [[YYYY-MM, n, avg]]}, pc: {gk: [[YYYY-MM, price]]}, ps: {gk: [[YYYY-MM, n, median]]},
                          pd: [[date, PSA 10]]}} - 300 cards a file (cards[id].sh says which), loaded when a Trend popup opens

Only Card Ladder's PSA and CGC grades are used (Brett: "I only care about CGC and PSA graded cards").

The Auth side (2026-10-29, Brett: "auth set ... the rows that are psa are to be filled out by set name data derived from
psa, where as cgc text is derived from cgc"): what the grader says, from the slab certs - a PSA row from PSA's own cert
record (PSA's Public API), else the description Card Hedge relays from GemRate; a CGC row from Card Hedge. Card-level
facts (name, set, number, release, language, rarity / finish words) per grader in cards[id].a; the slab's own facts
(grade, label, population, population higher, cert) per row in the "auth" column.

PC Graded / CL Graded are LAST MONTH's prices (2026-10-29, Brett: "i thought those were suppose to be grade for last
month"): Card Ladder's average of last month's sales of the grade, and the average of last month's sales of the grade
and grader PriceCharting recorded (else its monthly chart value) - both averages, so PC to CL % compares like with like.

Also writes into the card-data checkout (the site workflow commits them there):
  dictionary/term_counts.csv   every term and unidentified phrase seen: category, how many graded cards carry it on
                               each side, how often PriceCharting's whole catalog has it in a [bracket]
  ids/field_checks.csv         per card and field (number, total, rarity, finish, special, series, era, release,
                               illustrator): what PC says, what CL says, match / mismatch / pc_none / cl_none / both_none
"""
import argparse
import glob
import gzip
import hashlib
import io
import json
import os
import re
import statistics
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

import graded_terms as gt

SHARD = 300
GK = (["psa|g10", "psa|g9", "psa|g8_5", "psa|g8", "psa|g7", "psa|g6", "psa|g5", "psa|g4", "psa|g3", "psa|g2",
       "psa|g1_5", "psa|g1"] +
      ["cgc|g10perfect", "cgc|g10pristine", "cgc|g10", "cgc|g9_5", "cgc|g9", "cgc|g8_5", "cgc|g8", "cgc|g7_5",
       "cgc|g7", "cgc|g6_5", "cgc|g6", "cgc|g5_5", "cgc|g5", "cgc|g4_5", "cgc|g4", "cgc|g3_5", "cgc|g3", "cgc|g2_5",
       "cgc|g2", "cgc|g1_5", "cgc|g1"])
GI = {k: i for i, k in enumerate(GK)}
# PriceCharting's own price columns: which grade each prices (PriceCharting's API mapping). Only PSA 10 names its
# grader; 7 / 8 / 9 / 9.5 blend every grader, and its CGC 10 is often a formula (0.40 x PSA 10).
PC_COL = {"psa|g10": ("manual-only-price", "pc"), "cgc|g10": ("condition-17-price", "pc"),
          "psa|g9": ("graded-price", "mixed"), "cgc|g9": ("graded-price", "mixed"), "cgc|g9_5": ("box-only-price", "mixed"),
          "psa|g8": ("new-price", "mixed"), "cgc|g8": ("new-price", "mixed"),
          "psa|g7": ("cib-price", "mixed"), "cgc|g7": ("cib-price", "mixed")}
PC_LINES = {"psa_10": "psa|g10", "grade_9_5": "cgc|g9_5", "grade_9": "psa|g9", "grade_8": "psa|g8", "grade_7": "psa|g7"}
SNAP_COLS = ["manual-only-price", "condition-17-price", "graded-price", "box-only-price", "new-price", "cib-price"]
STATS_WINDOW, SLOPE_WINDOW = 90, 30


def money(v):
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except ValueError:
        return None


def hist_key(pw):
    return hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), b"biotech-catalog-live-v1", 600_000)


def write_enc(path, obj, key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    payload = gzip.compress(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    nonce = os.urandom(12)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as f:
        f.write(nonce + AESGCM(key).encrypt(nonce, payload, None))
    return len(payload)


def r2(v):
    return None if v is None or (isinstance(v, float) and (v != v or v in (float("inf"), float("-inf")))) else round(float(v), 2)


# ---------------- inputs ----------------
def load_ids(cd):
    p = os.path.join(cd, "ids", "card_ids.csv")
    if not os.path.exists(p):
        return pd.DataFrame(columns=["pricecharting_id", "cl_profile_id"])
    d = pd.read_csv(p, dtype=str).fillna("")
    d = d[d["cl_profile_id"] != ""]
    d = d[d["status"].isin(["confirmed", "likely", "review"])] if "status" in d.columns else d
    return d


def load_profiles(cd):
    out = {}
    for f in sorted(glob.glob(os.path.join(cd, "cardladder", "profiles", "*.jsonl.gz"))):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                if o.get("err") or not o.get("pid"):
                    continue
                k = str(o.get("pc") or "")
                if k and (k not in out or str(o.get("read", "")) >= str(out[k].get("read", ""))):
                    out[k] = o
    return out


def load_matches(cd):
    """{pc id: {"slabs": {gk: cert}, "cl": [Card Ladder cert lookups]}} from data/cardladder/matches (newest read wins)."""
    out = {}
    for f in sorted(glob.glob(os.path.join(cd, "cardladder", "matches", "*.jsonl.gz"))):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                e = out.setdefault(str(o.get("pc")), {"slabs": {}, "cl": []})
                for gk, x in (o.get("slabs") or {}).items():
                    if gk in GI and x.get("cert"):
                        e["slabs"][gk] = x["cert"]
                c = o.get("cl_cert")
                if c and c.get("cert") and not c.get("err"):
                    e["cl"].append(c)
    for e in out.values():                                  # a slab Card Ladder looked up names its own grade
        for c in e["cl"]:
            gk = f"{c.get('grader')}|{c.get('grade')}"
            if gk in GI:
                e["slabs"].setdefault(gk, c["cert"])
    return out


def load_marks(cd):
    p = os.path.join(cd, "ids", "marks.csv")
    if not os.path.exists(p):
        return {}
    d = pd.read_csv(p, dtype=str).fillna("")
    if d.empty:
        return {}
    d["tn"] = pd.to_numeric(d["t"], errors="coerce").fillna(0)
    out = {}
    for r in d.sort_values("tn").itertuples():               # the newest answer for a card x grade wins
        v = {"1": 1, "0": 0}.get(str(r.v).strip().split(".")[0])
        out[(str(r.pc).split(".")[0], r.gk)] = {"v": v, "reason": getattr(r, "reason", "") or None,
                                                "note": getattr(r, "note", ""), "t": int(r.tn)}
    return out


def load_tcg_details(cd):
    """{TCGplayer product id: {"artist", "number", "status", ...}} from tcgplayer/details.csv (tcg_details.py)."""
    import csv
    p = os.path.join(cd, "tcgplayer", "details.csv")
    if not os.path.exists(p):
        return {}
    with open(p, newline="", encoding="utf-8") as f:
        return {str(r.get("tcgplayer_id", "")).split(".")[0]: r for r in csv.DictReader(f)}


def decisions_t(cd):
    """The newest page decision graded_answers.py has filed into the dictionary (ms) - the page drops its own echo of
    anything older, since the data now carries it."""
    import csv
    p = os.path.join(cd, "dictionary", "decisions.csv")
    if not os.path.exists(p):
        return 0
    with open(p, newline="", encoding="utf-8") as f:
        return max((int(float(r.get("t") or 0)) for r in csv.DictReader(f)), default=0)


def load_psa_certs(cd):
    """{cert: PSA's record} from psa/certs.csv (cert_lookups.py)."""
    import csv
    p = os.path.join(cd, "psa", "certs.csv")
    if not os.path.exists(p):
        return {}
    with open(p, newline="", encoding="utf-8") as f:
        return {r["cert"]: r for r in csv.DictReader(f) if r.get("cert")}


def load_ch_certs(cd):
    """{(grader, cert): Card Hedge's row} from cardhedge/certs.csv (cert_lookups.py)."""
    import csv
    p = os.path.join(cd, "cardhedge", "certs.csv")
    if not os.path.exists(p):
        return {}
    with open(p, newline="", encoding="utf-8") as f:
        return {(r["grader"], r["cert"]): r for r in csv.DictReader(f) if r.get("cert")}


def toint(v):
    try:
        return int(float(str(v).replace(",", "")))
    except (TypeError, ValueError):
        return None


def auth_rec(g, cert, psa, ch):
    """One slab, as the grader says: {"src": "psa" | "ch" | None, "st": "ok" | "nf" (looked up, not found) | "wait"
    (not looked up yet), ...}. PSA slabs: PSA's own record first; Card Hedge's (from GemRate) otherwise."""
    cert = re.sub(r"\D", "", str(cert or ""))
    if not cert:
        return None
    h = ch.get((g, cert))
    chc = None
    if h and h.get("status") == "ok":
        chc = {"player": h.get("player", ""), "set": h.get("set", ""), "number": h.get("number", ""), "variant": h.get("variant", ""),
               "image": h.get("image", ""), "source": h.get("card_source", ""), "conf": h.get("match_confidence", "")}
    p = psa.get(cert) if g == "psa" else None
    if p and p.get("status") == "ok":
        return {"src": "psa", "st": "ok", "cert": cert, "subject": p.get("subject", ""), "brand": p.get("brand", ""),
                "category": p.get("category", ""), "variety": p.get("variety", ""), "label": p.get("label_type", ""),
                "year": p.get("year", ""), "number": p.get("card_number", ""),
                "grade": p.get("grade_description") or p.get("card_grade") or "", "pop": toint(p.get("total_population")),
                "popq": toint(p.get("population_with_qualifier")), "poph": toint(p.get("population_higher")),
                "spec": p.get("spec_id", ""), "read": str(p.get("read", ""))[:10], "ch": chc,
                "desc": (h or {}).get("description", "")}
    if h and h.get("status") in ("ok", "no_card") and (h.get("grade") or h.get("description")):
        return {"src": "ch", "st": "ok", "cert": cert, "desc": h.get("description", ""), "grade": h.get("grade", ""),
                "pop": None, "popq": None, "poph": None, "label": None, "read": str(h.get("read", ""))[:10], "ch": chc}
    nf = (p is not None and p.get("status") == "not_found") or (h is not None and h.get("status") == "not_found")
    return {"src": None, "st": "nf" if nf else "wait", "cert": cert}


def merge_sides(sides):
    m = gt.Side()
    for s in sides:
        for c in gt.CATS:
            for k, v in s.t[c].items():
                if k not in m.t[c] or v == "confirmed":
                    m.t[c][k] = v
                m.src[c].setdefault(k, s.src[c].get(k, ""))
        for ph, w in s.unid.items():
            m.unid.setdefault(ph, w)
            m.unid_left.setdefault(ph, s.unid_left.get(ph, ""))
    return m


def load_pop(cd, ids):
    fs = sorted(glob.glob(os.path.join(cd, "pricecharting", "pop", "pop_*.csv.gz")))
    if not fs:
        return {}
    d = pd.read_csv(fs[-1])
    d = d[d["card_id"].isin(ids)]
    if "read_date" in d.columns:                             # a month's file keeps the month's first and latest read of a card
        d = d.sort_values("read_date").drop_duplicates("card_id", keep="last")
    out = {}
    for r in d.to_dict("records"):
        m = {}
        for i in range(1, 11):
            for g in ("psa", "cgc"):
                v = r.get(f"{g}_{i}")
                if v is not None and v == v and int(v) > 0:
                    m[f"{g}|g{i}"] = int(v)
        out[int(r["card_id"])] = m
    return out


def load_pop_hist(cd, ids, last_m):
    """{card id: {gk: [graded since the first read (None until a second read), first read date, latest read date,
    latest population, graded last month (None until both last month's and the month before's files exist)]}} - the
    number of new PSA / CGC slabs of a grade, from the change in the population PriceCharting's page shows."""
    fs = sorted(glob.glob(os.path.join(cd, "pricecharting", "pop", "pop_*.csv.gz")))
    idset, per, month_last = set(ids), {}, {}
    for f in fs:
        mo = re.search(r"(\d{4}-\d{2})", os.path.basename(f))
        mo = mo.group(1) if mo else ""
        d = pd.read_csv(f)
        d = d[d["card_id"].isin(idset)]
        for r in d.to_dict("records"):
            cid, rd = int(r["card_id"]), str(r.get("read_date") or mo)
            for g in ("psa", "cgc"):
                for i in range(1, 11):
                    v = r.get(f"{g}_{i}")
                    if v is None or v != v:
                        continue
                    k = f"{g}|g{i}"
                    per.setdefault(cid, {}).setdefault(k, []).append((rd, int(v)))
                    cur = month_last.setdefault((cid, k), {}).get(mo)
                    if cur is None or rd >= cur[0]:
                        month_last[(cid, k)][mo] = (rd, int(v))
    prev_m = (datetime.strptime(last_m + "-01", "%Y-%m-%d").date() - timedelta(days=1)).strftime("%Y-%m")
    out = {}
    for cid, m in per.items():
        o = {}
        for k, pts in m.items():
            pts = sorted(set(pts))
            first, last = pts[0], pts[-1]
            ml = month_last.get((cid, k), {})
            lm = ml[last_m][1] - ml[prev_m][1] if last_m in ml and prev_m in ml else None
            o[k] = [last[1] - first[1] if last[0] != first[0] else None, first[0], last[0], last[1], lm]
        out[cid] = o
    return out


def load_tcg_facts(path):
    if not path or not os.path.exists(path):
        return {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


TITLE_GRADE = re.compile(r"\b(PSA|CGC)\s*(?:GEM\s*MI?N?T\s*|MINT\s*|NM-?MT\s*|NM\s*)?(10|9\.5|9|8\.5|8|7\.5|7)\b", re.I)


def gk_of_sale(grade, grader, title):
    g = str(grader or "").upper()
    if g not in ("PSA", "CGC"):
        return None
    grade = str(grade)
    if grade == "10P":
        return "cgc|g10pristine" if g == "CGC" else None
    if grade == "10B":
        return None
    m = TITLE_GRADE.search(title or "")
    if m and m.group(1).upper() == g and m.group(2) != grade and m.group(2).split(".")[0] == grade.split(".")[0]:
        grade = m.group(2)                                  # "8" table, title "CGC 8.5" -> 8.5
    key = f"{g.lower()}|g{grade.replace('.', '_')}"
    return key if key in GI else None


def load_pc_sales(cd, ids, today):
    fs = sorted(glob.glob(os.path.join(cd, "pricecharting", "graded_sales", "graded_sales_*.csv.gz")))
    keep_from = (today.replace(day=1) - timedelta(days=400)).strftime("%Y-%m")
    parts = []
    for f in fs:
        m = re.search(r"(\d{4}-\d{2})", os.path.basename(f))
        if m and m.group(1) < keep_from:
            continue
        d = pd.read_csv(f, dtype={"grade": str, "grader": str, "row_id": str, "title": str})
        parts.append(d[d["card_id"].isin(ids)])
    if not parts:
        return {}
    d = pd.concat(parts, ignore_index=True).drop_duplicates(["card_id", "row_id"])
    out = {}
    for r in d.itertuples():
        k = gk_of_sale(r.grade, r.grader, r.title)
        if not k:
            continue
        out.setdefault(int(r.card_id), {}).setdefault(k, []).append((str(r.date), float(r.price)))
    return out


def load_pc_monthly(cd, ids):
    out = {}
    for f in sorted(glob.glob(os.path.join(cd, "pricecharting", "pc_graded_monthly_*.csv.gz"))):
        d = pd.read_csv(f)
        d = d[d["card_id"].isin(ids)]
        for r in d.to_dict("records"):
            c = out.setdefault(int(r["card_id"]), {})
            for col in PC_LINES:
                v = r.get(col)
                if v is not None and v == v and v != "":
                    c.setdefault(col, []).append([str(r["month"])[:7], round(float(v), 2)])
    return out


def load_snap_history(snap_dir, ids, pw):
    """{card id: {column: [(date, price)]}} from the encrypted daily snapshots - only the graded columns, only our cards."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    out = {}
    idset = set(ids)
    for path in sorted(glob.glob(os.path.join(snap_dir, "pc_catalog_*.csv.gz*"))):
        m = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(path))
        if not m:
            continue
        blob = open(path, "rb").read()
        if path.endswith(".enc"):
            if not pw:
                continue
            key = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), blob[:16], 600_000)
            try:
                blob = AESGCM(key).decrypt(blob[16:28], blob[28:], None)
            except Exception:
                continue
        df = pd.read_csv(io.BytesIO(gzip.decompress(blob)), dtype=str).fillna("")
        if "id" not in df.columns:
            continue
        df["id"] = pd.to_numeric(df["id"], errors="coerce")
        df = df[df["id"].isin(idset)]
        for r in df.to_dict("records"):
            c = out.setdefault(int(r["id"]), {})
            for col in SNAP_COLS:
                v = money(r.get(col, ""))
                if v and v > 0:
                    c.setdefault(col, []).append((m.group(1), v))
    return out


# ---------------- statistics (build_catalog.py's formulas, on one price series) ----------------
def series_stats(pts, today):
    """pts: [(YYYY-MM-DD, price)] ascending. -> {d7, d30, pos, vol, ts} (percent), None where history is too short."""
    if len(pts) < 2:
        return {}
    dts = [datetime.strptime(d, "%Y-%m-%d").date() for d, _ in pts]
    P = np.array([p for _, p in pts], dtype=float)
    last = dts[-1]
    out = {}

    def ago(n):
        for k in range(len(dts) - 1, -1, -1):
            if (last - dts[k]).days >= n:
                return k
        return None
    for key, n in (("d7", 7), ("d30", 30)):
        k = ago(n)
        if k is not None and P[k] > 0:
            out[key] = r2((P[-1] / P[k] - 1) * 100)
    span = (last - dts[0]).days
    win = [k for k in range(len(dts)) if (last - dts[k]).days < STATS_WINDOW]
    if span >= 60 and win:
        lo, hi = P[win].min(), P[win].max()
        if hi > lo:
            out["pos"] = r2((P[-1] - lo) / (hi - lo) * 100)
    L = np.log(P)
    ch = [k for k in range(1, len(P)) if P[k] != P[k - 1] and (last - dts[k]).days < STATS_WINDOW]
    if len(ch) >= 3:
        out["vol"] = r2(statistics.median([abs(L[k] - L[k - 1]) for k in ch]) * 100)
    W = [k for k in range(len(dts)) if (last - dts[k]).days < SLOPE_WINDOW]
    if len(W) >= 10:
        sl = [(L[W[j]] - L[W[i]]) / (dts[W[j]] - dts[W[i]]).days for i in range(len(W)) for j in range(i + 1, len(W))
              if (dts[W[j]] - dts[W[i]]).days > 0]
        if sl:
            out["ts"] = r2((np.exp(statistics.median(sl) * 30) - 1) * 100)
    return out


def sales_price(sales, today):
    """PriceCharting's own sold listings for one grade and grader -> (median price, how many, window days)."""
    for days in (90, 365):
        since = (today - timedelta(days=days)).isoformat()
        ps = [p for d, p in sales if d >= since]
        if len(ps) >= 3:
            return round(statistics.median(ps), 2), len(ps), days
    return None, 0, 0


# ---------------- build ----------------
def build(cd, pc_csv, snap_dir, out_dir, pw, today=None, tcg_path="tcg_facts.json.gz"):
    today = today or date.today()
    last_m = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    ids_df = load_ids(cd)
    prof = load_profiles(cd)
    marks = load_marks(cd)
    matches = load_matches(cd)
    ids = sorted({int(x) for x in ids_df["pricecharting_id"] if str(x).isdigit()})
    print(f"graded: {len(ids)} matched cards, {len(prof)} Card Ladder profile reads")
    pc = pd.read_csv(pc_csv, dtype=str).fillna("") if os.path.exists(pc_csv) else pd.DataFrame(columns=["id"])
    pc["id"] = pd.to_numeric(pc["id"], errors="coerce")
    dic = gt.Dictionary.load(cd)
    tally = gt.Tally()
    if "product-name" in pc.columns:                        # PriceCharting's [bracket] words over the whole catalog
        tally.catalog(pc["product-name"].tolist(), dic)
    pc = pc[pc["id"].isin(ids)].set_index("id")
    tcgf = load_tcg_facts(tcg_path)
    tdet = load_tcg_details(cd)
    pop_hist = load_pop_hist(cd, ids, last_m)
    psa_c, ch_c = load_psa_certs(cd), load_ch_certs(cd)
    checks = []
    print(f"graded: dictionary {dic.n} terms, TCGplayer facts for {len(tcgf):,} PriceCharting cards, "
          f"TCGplayer product pages read for {sum(1 for d in tdet.values() if d.get('status') == 'ok'):,}, "
          f"population history for {len(pop_hist)} cards, {len(marks)} Review answers, "
          f"PSA cert records {sum(1 for r in psa_c.values() if r.get('status') == 'ok')}, Card Hedge cert rows {len(ch_c)}")
    pop = load_pop(cd, ids)
    psales = load_pc_sales(cd, ids, today)
    pmon = load_pc_monthly(cd, ids)
    first_seen = {cid: min(d for v in m.values() for d, _ in v) for cid, m in psales.items() if m}
    snaps = load_snap_history(snap_dir, ids, pw) if snap_dir and os.path.isdir(snap_dir) else {}
    print(f"graded: PriceCharting pop {len(pop)}, graded sales {len(psales)}, monthly {len(pmon)}, daily history {len(snaps)} cards")
    cards, rows, trends = {}, [], {}
    for r in ids_df.to_dict("records"):
        cid = int(r["pricecharting_id"])
        pr = prof.get(str(cid))
        clg = {}                                            # gk -> [pop, cl value, last sold]
        if pr:
            for g in pr.get("graders") or []:
                for x in g.get("grades") or []:
                    k = f"{g['g']}|{x[0]}"
                    if k in GI:
                        clg[k] = [x[2], x[3], x[4]]
        mon = (pr or {}).get("monthly") or {}
        slabs = (matches.get(str(cid)) or {}).get("slabs", {})
        recs = {}                                           # (grader, cert) -> the slab as the grader says
        for g, card_cert in (("psa", r.get("psa_cert", "")), ("cgc", r.get("cgc_cert", ""))):
            for cert in [card_cert] + [v for k, v in slabs.items() if k.startswith(g + "|")]:
                a = auth_rec(g, cert, psa_c, ch_c)
                if a:
                    recs.setdefault((g, a["cert"]), a)
        best = {}                                           # grader -> the record the card-level Auth facts come from
        for (g, _), a in recs.items():
            if a["st"] != "ok":
                continue
            if g not in best or (best[g]["src"] != "psa" and a["src"] == "psa"):
                best[g] = a
        stats_by_col = {col: series_stats(pts, today) for col, pts in (snaps.get(cid) or {}).items()}
        pcrow = pc.loc[cid] if cid in pc.index else None
        keys = set(clg) | {k for k in mon if k in GI} | set((psales.get(cid) or {}).keys()) | set(pop.get(cid, {}).keys())
        keys |= {k for k, (col, _) in PC_COL.items() if pcrow is not None and money(pcrow.get(col, "")) and k.startswith("psa|g10")}
        for k in sorted(keys, key=lambda x: GI.get(x, 99)):
            col, kind = PC_COL.get(k, (None, None))
            pc_price = money(pcrow.get(col, "")) if (pcrow is not None and col) else None
            src = kind if pc_price else None
            sp, sn, sd = sales_price((psales.get(cid) or {}).get(k, []), today)
            if k == "cgc|g10" and pc_price and pcrow is not None:
                p10 = money(pcrow.get("manual-only-price", ""))
                if p10 and abs(pc_price - round(p10 * 0.4, 2)) < 0.02:
                    src = "formula"                         # PriceCharting's CGC 10 = 0.40 x PSA 10: not a market price
            if sp is not None and src in (None, "mixed", "formula"):
                pc_price, src = sp, f"sales:{sn}:{sd}"
            ps_list = (psales.get(cid) or {}).get(k, [])
            pc_n1 = sum(1 for d, _ in ps_list if d[:7] == last_m)
            # PriceCharting lists only the latest 30 sales of a grade: when this grade's recorded sales (or, for a quiet
            # grade, the card's) do not reach back to the start of last month, last month's count is not known
            cover = min((d for d, _ in ps_list), default=None) if len(ps_list) >= 30 else first_seen.get(cid)
            if cover is None or cover > last_m + "-03":
                pc_n1 = None
            cl = clg.get(k, [None, None, None])
            m = {x[0]: x for x in mon.get(k, [])}
            cl_n1 = m[last_m][1] if last_m in m else (0 if mon.get(k) else None)
            cl_avg1 = m[last_m][2] if last_m in m else None
            st = stats_by_col.get(col, {}) if col else {}
            mk = marks.get((str(cid), k))
            if not (pc_price or cl[1] or cl[2] or mon.get(k) or ps_list):
                continue                                    # a grade with a population and no price or sale anywhere: no row
            # last month's PriceCharting price of this grade and grader: the average of the sales it recorded, else its
            # monthly chart value (PSA 10 its own line; 9 / 9.5 / 8 / 7 blend every grader)
            m1 = [p for d, p in ps_list if d[:7] == last_m]
            pc1 = [r2(sum(m1) / len(m1)), len(m1), "sales"] if m1 else None
            if pc1 is None:
                gnum = k.split("|g", 1)[1]
                line = "psa_10" if k == "psa|g10" else ({"9": "grade_9", "9_5": "grade_9_5", "8": "grade_8", "7": "grade_7"}.get(gnum))
                pts = dict((x[0], x[1]) for x in (pmon.get(cid) or {}).get(line, [])) if line else {}
                if last_m in pts:
                    pc1 = [r2(pts[last_m]), None, "chart" if k == "psa|g10" else "chart_mixed"]
            ar = auth_rec(k.split("|")[0], slabs.get(k), psa_c, ch_c)
            auth = None if not ar else [ar["st"], ar.get("grade") or None, ar.get("label") or None, ar.get("pop"), ar.get("poph"),
                                        ar.get("src"), ar["cert"], ar.get("popq"), ar.get("read") or None]
            rows.append([cid, GI[k], r2(pc_price), src, pc_n1, pop.get(cid, {}).get(k), r2(cl[1]), r2(cl[2]), cl_n1,
                         r2(cl_avg1), cl[0], st.get("d7"), st.get("d30"), st.get("pos"), st.get("vol"), st.get("ts"),
                         (mk or {}).get("v"), (mk or {}).get("reason") or None, pc1, auth])
        pname = str(pcrow.get("product-name", "")) if pcrow is not None else ""
        pset = str(pcrow.get("console-name", "")) if pcrow is not None else ""
        mnum = re.search(r"#(\S+)\s*$", pname)
        tid = str(r.get("tcgplayer_id", "") or "").split(".")[0]
        ps = gt.pc_side(pname, pset, mnum.group(1) if mnum else "", tcgf.get(str(cid)), dic, tdet.get(tid) if tid else None)
        cs = gt.cl_side(pr, (matches.get(str(cid)) or {}).get("cl", []), dic)
        pc_year = pcrow.get("release-date", "") if pcrow is not None else ""
        aside = {}
        for g, a in best.items():
            aside[g] = gt.auth_side({"src": a["src"], "subject": a.get("subject"), "brand": a.get("brand"), "category": a.get("category"),
                                     "variety": a.get("variety"), "label": a.get("label"), "year": a.get("year"),
                                     "number": a.get("number"), "desc": a.get("desc")}, dic)
        au = merge_sides(aside.values()) if aside else None
        tally.side(cid, "pc", ps)
        tally.side(cid, "cl", cs)
        if au:
            tally.side(cid, "auth", au)
        fc = gt.compare(ps, cs, pc_year, (pr or {}).get("year"))
        afc = {g: gt.compare_auth(s_, ps, cs, pc_year, (pr or {}).get("year")) for g, s_ in aside.items()}
        a1 = afc.get("psa") or afc.get("cgc") or {}
        for f, (a, b, res) in fc.items():
            checks.append([cid, f, a if a is not None else "", b if b is not None else "", res,
                           (a1.get(f) or ["", ""])[0], (a1.get(f) or ["", ""])[1]])
        cards[str(cid)] = {
            "pn": ps.num, "pnf": ps.num_from, "pr": ps.rarity_text, "prf": ps.rarity_from, "pf": ps.finish_text,
            "pff": ps.finish_from, "ps": ps.shown("Special"), "pi": ps.artist, "pif": ps.artist_from,
            "cn": cs.num, "cnf": cs.num_from, "cr": cs.rarity_text, "cf": cs.finish_text, "cs": cs.shown("Special"),
            "ser": [ps.shown("Series"), cs.shown("Series"), au.shown("Series") if au else ""],
            "era": [ps.shown("Era"), cs.shown("Era"), au.shown("Era") if au else ""],
            "t": {"pc": {c: ps.terms(c) for c in gt.CATS},
                  "cl": {c: cs.terms(c) for c in gt.CATS},
                  "auth": {c: au.terms(c) for c in gt.CATS} if au else {},
                  "u": {"pc": list(ps.unid), "cl": list(cs.unid), "auth": list(au.unid) if au else []}},
            "a": {g: {"cert": best[g]["cert"], "src": best[g]["src"], "name": s_.name, "set": s_.set_name, "num": s_.num,
                      "year": s_.year, "lang": s_.lang, "ls": s_.lang_said, "rar": s_.shown("Rarity"), "fin": s_.shown("Finish"),
                      "sp": s_.shown("Special"), "from": s_.source, "spec": best[g].get("spec", ""), "desc": best[g].get("desc", ""),
                      "ch": best[g].get("ch"), "fc": {f: v[1] for f, v in afc[g].items()}, "read": best[g].get("read", "")}
                  for g, s_ in aside.items()},
            "aw": sorted({g for (g, _), x in recs.items() if x["st"] == "wait"}),   # graders with a cert not looked up yet
            "fc": {f: v[2] for f, v in fc.items()},
            "pg": pop_hist.get(cid, {}),
            "pid": r.get("cl_profile_id", ""), "spec": r.get("psa_spec", ""), "cgc": r.get("cgc_id", "") or "",
            "pcert": r.get("psa_cert", ""), "ccert": r.get("cgc_cert", ""), "st": r.get("status", ""),
            "by": r.get("confirmed_by", ""), "note": r.get("note", "")[:200],
            "cl": [pr.get(x) for x in ("label", "year", "set", "number", "subject", "variation", "image")] if pr else None,
            "read": (pr or {}).get("read", ""), "tcg": r.get("tcgplayer_id", ""),
            "certs": (matches.get(str(cid)) or {}).get("slabs", {}),
            "imgs": {k.rsplit("|", 1)[0]: v for k, v in ((pr or {}).get("imgs") or {}).items() if k.endswith("|base") and k.rsplit("|", 1)[0] in GI},
        }
        tr = {"cl": {k: [[x[0], x[1], x[2]] for x in v] for k, v in mon.items() if k in GI},
              "pc": {PC_LINES[c]: v for c, v in (pmon.get(cid) or {}).items()},
              "ps": {}}
        for k, sl in (psales.get(cid) or {}).items():
            by = {}
            for d, p in sl:
                by.setdefault(d[:7], []).append(p)
            tr["ps"][k] = [[ym, len(v), round(statistics.median(v), 2)] for ym, v in sorted(by.items())]
        if snaps.get(cid, {}).get("manual-only-price"):    # this month's PSA 10 from the daily history, when the chart line has not caught up
            tr["pd"] = [[d, p] for d, p in snaps[cid]["manual-only-price"]][-120:]
        trends[cid] = tr
    for i, cid in enumerate(sorted(trends)):               # trend files: 300 cards each, in card id order (card ids run to
        cards[str(cid)]["sh"] = i // SHARD                  # 13 million, so id // 300 would scatter them over thousands of files)
    key = hist_key(pw) if pw else None
    write_card_data(cd, tally, checks, today)
    doc = {"v": 2, "built": today.isoformat(), "lastm": last_m, "gk": GK, "cards": cards, "rows": rows,
           "terms": tally.lists(), "dict": {"n": dic.n}, "canon": dic.canon(), "dect": decisions_t(cd),
           "markt": max((m["t"] for m in marks.values()), default=0),
           "shard": SHARD, "cols": ["pc", "gi", "pcp", "src", "pcn1", "pcpop", "clv", "cll", "cln1", "clavg1", "clpop",
                                    "d7", "d30", "pos", "vol", "ts", "mark", "reason", "pc1", "auth"],
           "certs_read": {"psa": sum(1 for x in psa_c.values() if x.get("status") == "ok"), "ch": sum(1 for x in ch_c.values() if x.get("status") in ("ok", "no_card"))}}
    if key is None:
        print("graded: no SITE_PASSWORD - nothing written")
        return doc, trends
    n = write_enc(os.path.join(out_dir, "graded.bin"), doc, key)
    shards = {}
    for cid, tr in trends.items():
        shards.setdefault(cards[str(cid)]["sh"], {})[str(cid)] = tr
    for s, obj in shards.items():
        write_enc(os.path.join(out_dir, "gtrend", f"s{s}.bin"), obj, key)
    print(f"graded: {len(rows)} rows over {len(cards)} cards -> {out_dir}/graded.bin ({n / 1e3:.0f} KB gzip), "
          f"{len(shards)} trend file(s)")
    return doc, trends


def write_card_data(cd, tally, checks, today):
    """term_counts.csv and field_checks.csv into the card-data checkout (the site workflow commits them)."""
    import csv
    built = today.isoformat()
    try:
        os.makedirs(os.path.join(cd, "dictionary"), exist_ok=True)
        with open(os.path.join(cd, "dictionary", "term_counts.csv"), "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["category", "term", "confidence", "graded_cards_pc", "graded_cards_cl", "graded_cards_auth", "catalog_pc_brackets",
                        "unknown_words", "seen_in", "examples", "built"])
            w.writerows(tally.rows(built))
        os.makedirs(os.path.join(cd, "ids"), exist_ok=True)
        with open(os.path.join(cd, "ids", "field_checks.csv"), "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["pricecharting_id", "field", "pc", "cl", "result", "auth", "auth_result", "built"])
            w.writerows(c + [built] for c in checks)
        print(f"graded: wrote dictionary/term_counts.csv and ids/field_checks.csv ({len(checks)} checks)")
    except OSError as e:
        print(f"graded: term counts / field checks not written ({e})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--card-data", default="card-data/data")
    ap.add_argument("--pc-csv", default="pricecharting.csv")
    ap.add_argument("--snapshots", default="snapshots")
    ap.add_argument("--out", default="public")
    ap.add_argument("--tcg-facts", default="tcg_facts.json.gz")
    a = ap.parse_args()
    build(a.card_data, a.pc_csv, a.snapshots, a.out, os.environ.get("SITE_PASSWORD", ""), tcg_path=a.tcg_facts)


if __name__ == "__main__":
    main()
