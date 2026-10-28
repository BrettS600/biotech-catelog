"""graded_site.py - the data behind the PriceCharting tab's graded view (Brett, 2026-10-27: "only show graded ...
PSA or CGC ID ... CL set name ... PC to CL % difference ... a PSA Trend with PC and CL lines").

Run by the site workflow after build_catalog.py (which leaves pricecharting.csv and the snapshots on disk):

    python graded_site.py --card-data card-data/data --out public

Reads (card-data is the private repo BrettS600/card-data, checked out by the workflow with DATA_REPO_TOKEN):
  ids/card_ids.csv                         which Card Ladder profile each PriceCharting card is (cardmatch / the barcode
                                           chain): pricecharting_id, cl_profile_id, psa_spec, cgc_id, psa_cert, cgc_cert,
                                           status (confirmed / likely / review / no_match), note
  cardladder/profiles/*.jsonl.gz           the Card Ladder profile reads, one JSON object per line (newest wins):
                                           {pc, read, pid, label, year, set, number, subject, variation, image, graders:
                                           [{g, id, pop, grades: [[key, label, pop, cl value, last sold, conf]]}],
                                           monthly: {"psa|g10": [[YYYY-MM, n, avg, n auction, n best offer, n fixed]]}}
  ids/marks.csv                            the Review answers and flags sent from the page (optional)
  pricecharting/pop/pop_<YYYY-MM>.csv.gz   PriceCharting's PSA / CGC population (the newest file)
  pricecharting/graded_sales/*.csv.gz      PriceCharting's graded sold listings (grade, grader read off the title)
  pricecharting/pc_graded_monthly_*.csv.gz PriceCharting's monthly graded chart lines (optional - full archive runs)
and pricecharting.csv (today's PriceCharting prices) and snapshots/pc_catalog_*.csv.gz.enc (the daily history).

Writes, encrypted with the page's history key (PBKDF2 of SITE_PASSWORD, salt biotech-catalog-live-v1 - the key the
Trend shards and the eBay live file use, so the page can read them):
  <out>/graded.bin        {v, built, gk: [grade keys], cards: {pc id: card meta}, rows: [[...]]} - the table
  <out>/gtrend/s<n>.bin   {pc id: {cl: {gk: [[YYYY-MM, n, avg]]}, pc: {gk: [[YYYY-MM, price]]}, ps: {gk: [[YYYY-MM, n, median]]},
                          pd: [[date, PSA 10]]}} - 300 cards a file (cards[id].sh says which), loaded when a Trend popup opens

Only Card Ladder's PSA and CGC grades are used (Brett: "I only care about CGC and PSA graded cards").
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


def load_marks(cd):
    p = os.path.join(cd, "ids", "marks.csv")
    if not os.path.exists(p):
        return {}
    d = pd.read_csv(p, dtype=str).fillna("")
    out = {}
    for r in d.sort_values("t").itertuples():
        out[(r.pc, r.gk)] = {"v": r.v, "reason": getattr(r, "reason", ""), "note": getattr(r, "note", ""), "t": r.t}
    return out


def load_pop(cd, ids):
    fs = sorted(glob.glob(os.path.join(cd, "pricecharting", "pop", "pop_*.csv.gz")))
    if not fs:
        return {}
    d = pd.read_csv(fs[-1])
    d = d[d["card_id"].isin(ids)]
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
def build(cd, pc_csv, snap_dir, out_dir, pw, today=None):
    today = today or date.today()
    last_m = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    ids_df = load_ids(cd)
    prof = load_profiles(cd)
    marks = load_marks(cd)
    ids = sorted({int(x) for x in ids_df["pricecharting_id"] if str(x).isdigit()})
    print(f"graded: {len(ids)} matched cards, {len(prof)} Card Ladder profile reads")
    pc = pd.read_csv(pc_csv, dtype=str).fillna("") if os.path.exists(pc_csv) else pd.DataFrame(columns=["id"])
    pc["id"] = pd.to_numeric(pc["id"], errors="coerce")
    pc = pc[pc["id"].isin(ids)].set_index("id")
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
            rows.append([cid, GI[k], r2(pc_price), src, pc_n1, pop.get(cid, {}).get(k), r2(cl[1]), r2(cl[2]), cl_n1,
                         r2(cl_avg1), cl[0], st.get("d7"), st.get("d30"), st.get("pos"), st.get("vol"), st.get("ts"),
                         (mk or {}).get("v"), (mk or {}).get("reason") or None])
        cards[str(cid)] = {
            "pid": r.get("cl_profile_id", ""), "spec": r.get("psa_spec", ""), "cgc": r.get("cgc_id", "") or "",
            "pcert": r.get("psa_cert", ""), "ccert": r.get("cgc_cert", ""), "st": r.get("status", ""),
            "by": r.get("confirmed_by", ""), "note": r.get("note", "")[:200],
            "cl": [pr.get(x) for x in ("label", "year", "set", "number", "subject", "variation", "image")] if pr else None,
            "read": (pr or {}).get("read", ""), "tcg": r.get("tcgplayer_id", ""),
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
    doc = {"v": 1, "built": today.isoformat(), "lastm": last_m, "gk": GK, "cards": cards, "rows": rows,
           "shard": SHARD, "cols": ["pc", "gi", "pcp", "src", "pcn1", "pcpop", "clv", "cll", "cln1", "clavg1", "clpop",
                                    "d7", "d30", "pos", "vol", "ts", "mark", "reason"]}
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--card-data", default="card-data/data")
    ap.add_argument("--pc-csv", default="pricecharting.csv")
    ap.add_argument("--snapshots", default="snapshots")
    ap.add_argument("--out", default="public")
    a = ap.parse_args()
    build(a.card_data, a.pc_csv, a.snapshots, a.out, os.environ.get("SITE_PASSWORD", ""))


if __name__ == "__main__":
    main()
