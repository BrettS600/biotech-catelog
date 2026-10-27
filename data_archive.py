#!/usr/bin/env python3
"""data_archive.py - the data folder (Brett, 2026-10-23: "save the data ... so if I want you to analyze the data in the
future, then you will have it saved and at your quick and easy disposal").

Runs on GitHub's machine (.github/workflows/data_archive.yml, daily after the site build; the 2nd of each month and any
"Run workflow" with full=true also export the big PriceCharting panel) and commits the results to data/ on main:

  data/pokeviews/*.csv            PokeViews' market indexes and indicators, straight from the JSON feeds their charts
                                  draw from (storage.googleapis.com/pokeviews-prod/...): every column of every feed,
                                  one row per day (or per day x series / set). manifest.json records when, from where,
                                  how many rows. README.md in data/ says what each column means.
  data/pricecharting/             pc_monthly_<year>.csv.gz = the collector's PriceCharting history: every card's
                                  ungraded price and sales volume per month since December 2020 (the pc/ shards on the
                                  live branch, ~2.3M card-months, one file per year); cards.csv.gz = the catalog those
                                  ids belong to (the newest pc_catalog snapshot). Full runs only.
  data/ebay/catalog/<date>.csv.gz  the eBay Catalog tab's figures for every card with eBay data, as the collector
                                  published them that day (live.cards: demand, supply, prices, trends, today's rollup).
  data/ebay/daily_rollup.csv.gz   the collector's per-card daily rollup (sales, their totals, the 7-day median, the
                                  cheapest ask, new listings) for the 120 days it keeps. Full runs only; overwritten.
  data/pricecharting/daily/       every column of PriceCharting's daily download (the pc_catalog snapshots, 2026-09-28 on):
                                  full_<date>.csv.gz = the whole table on the month's first snapshot day, changes_<date>.csv.gz
                                  = the cards whose prices or volume moved since the snapshot before (graded prices PSA 10 /
                                  BGS 10 / CGC 10 / SGC 10 / grade 7-9.5, the dealer buy / sell prices, sales volume). Daily;
                                  a missing day is filled in from the release on the next run (2026-10-26, Brett).
  data/pricecharting/graded_sales/ graded_sales_<YYYY-MM>.csv.gz = every graded sale the collector read off the card pages'
                                  sold-listings tables (PSA / CGC / BGS / SGC / TAG / ACE 10, CGC 10 Pristine, BGS 10 Black,
                                  grade 7 / 8 / 9 / 9.5 with the grader read off the title), from the live branch's pcg/
                                  chunks; by sale month, deduplicated. Daily (2026-10-26, Brett: "Yes, please do").
  data/pricecharting/pop/         pop_<YYYY-MM>.csv.gz = the PSA and CGC population report each card page carries (grades
                                  1-10), as of the page's last read; the month's file is rewritten daily, so the last one
                                  of each month is that month's snapshot.
  data/pricecharting/             pc_graded_monthly_<year>.csv.gz = PriceCharting's monthly graded prices off each card's
                                  chart (grade 7, 8, 9, 9.5 - every grader blended - and PSA 10). Full runs only.

Keys: SITE_PASSWORD (env) decrypts the shards, the live file and the snapshot - nothing written here is encrypted,
the repository is private. Nothing here changes the site or the collector.

Local run (research): SITE_PASSWORD=... python3 data_archive.py --live-dir live_pc --snapshots snapshots --out data --full
"""
import argparse, csv, glob, gzip, io, json, os, re, sys, time
from datetime import datetime, timezone, timedelta

import forecast as F                      # keys, shard and snapshot readers (the same scheme as the collector)

PV = "https://storage.googleapis.com/pokeviews-prod/"
# name -> feed path. One CSV per name; the set index is many files (one per series), combined below.
FEEDS = {
    "top100_index": "top100_index/top100_index.json.gz",
    "top100_constituents": "top100_index/top100_constituents_table.json.gz",
    "top100_series_composition": "top100_index/top100_series_composition.json.gz",
    "top250_index": "top250_index/top250_index.json.gz",
    "top250_constituents": "top250_index/top250_constituents_table.json.gz",
    "top250_series_composition": "top250_index/top250_series_composition.json.gz",
    "hot_cold_index": "bull_bear_indicator/bull_bear_indicator.json.gz",
    "market_momentum": "mms/mms.json.gz",
    "new_highs_lows": "new_highs_lows/new_highs_lows.json.gz",
    "pokemon_vs_assets": "asset_comparison/asset_comparison.json.gz",
    "trend_extension": "trend_exhaustion/trend_exhaustion.json.gz",
    "era_performance": "pc_era_index/pc_era_index.json.gz",
    "series_performance": "pc_series_index/pc_series_index.json.gz",
    "series_constituents": "pc_series_index/pc_series_index_constituents_table.json.gz",
    "set_constituents": "pc_set_index/pc_set_index_constituents_table.json.gz",
    # PSA 10 (2026-10-26, Brett: "the grading opportunity heat map data, as well as the graded index graph data")
    "graded_index": "graded_index/graded_index.json.gz",
    "graded_index_constituents": "graded_index/graded_index_constituents_table.json.gz",
    "graded_index_series_composition": "graded_index/graded_index_series_composition.json.gz",
    "graded_index_by_era": "graded_index_by_era/graded_index_by_era.json.gz",
    "graded_index_by_era_constituents": "graded_index_by_era/graded_index_by_era_constituents_table.json.gz",
    "grading_opportunity": "grading/grading_opportunity.json.gz",
}
# feeds that are one day's picture (no history in the feed): each run's rows are also added to <name>_history.csv,
# replacing that day's rows if the day was already there
SNAPSHOT_FEEDS = ("grading_opportunity",)
CORRELATION = "asset_correlation/correlation_matrix.json.gz"
SET_INDEX = "pc_set_index/pc_set_index_{slug}.json.gz"
GZIP_OVER = 1_500_000                     # a CSV bigger than this is written gzipped (GitHub shows the small ones inline)


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ---------------- PokeViews ----------------
def fetch_json(path, retries=3):
    import requests
    url = path if path.startswith("http") else PV + path
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, timeout=120)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            b = r.content
            if b[:2] == bytes([31, 139]):                              # served raw-gzipped (GCS usually transcodes)
                b = gzip.decompress(b)
            return json.loads(b.decode("utf-8"))
        except Exception as e:                                         # noqa
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def cell(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, (list, dict)):
        return json.dumps(v, separators=(",", ":"))
    return v


def write_rows(rows, path, columns=None, force_gz=None):
    """rows = list of dicts -> CSV (gzipped when big). Columns: the union of keys in first-seen order."""
    if columns is None:
        columns = []
        seen = set()
        for r in rows:
            for k in r:
                if k not in seen:
                    seen.add(k)
                    columns.append(k)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(columns)
    for r in rows:
        w.writerow([cell(r.get(c)) for c in columns])
    text = buf.getvalue()
    gz = force_gz if force_gz is not None else len(text) > GZIP_OVER
    if gz:
        path = path if path.endswith(".gz") else path + ".gz"
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as f:
            f.write(text)
    else:
        path = path[:-3] if path.endswith(".gz") else path
        open(path, "w", encoding="utf-8").write(text)
    return path, len(rows), columns


def date_span(rows, key="date"):
    ds = [r.get(key) for r in rows if r.get(key)]
    return (min(ds), max(ds)) if ds else (None, None)


def read_csv_any(path):
    """A CSV written by write_rows (plain or gzipped) -> list of dicts (strings), or [] when absent."""
    for cand in (path, path + ".gz", path[:-3] if path.endswith(".gz") else None):
        if cand and os.path.exists(cand):
            opener = gzip.open if cand.endswith(".gz") else open
            with opener(cand, "rt", encoding="utf-8", newline="") as f:
                return list(csv.DictReader(f))
    return []


def keep_history(folder, name, rows, url):
    """<name>_history.csv: every day's rows of a one-day feed (the feed itself only ever holds today). Today's rows
    replace the same day's earlier rows; older days stay as they were."""
    path = os.path.join(folder, name + "_history.csv")
    days = {r.get("date") for r in rows}
    old = [r for r in read_csv_any(path) if r.get("date") not in days]
    for f in (path, path + ".gz"):
        if os.path.exists(f):
            os.remove(f)
    allrows = old + [{k: cell(v) for k, v in r.items()} for r in rows]
    allrows.sort(key=lambda r: str(r.get("date") or ""))
    p, n, cols = write_rows(allrows, path)
    lo, hi = date_span(allrows)
    log(f"pokeviews {name}_history: {n} rows, {lo}..{hi} ({len({r.get('date') for r in allrows})} days)")
    return {"url": url, "file": os.path.basename(p), "rows": n, "columns": cols, "first_date": lo, "last_date": hi,
            "days": len({r.get("date") for r in allrows})}


def slug(series):
    """PokeViews' file name for a series: lower case, '&' -> 'and', spaces -> '_', hyphens kept ("e-card")."""
    s = series.lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9-]+", "_", s).strip("_")
    return s


def pokeviews(out):
    folder = os.path.join(out, "pokeviews")
    os.makedirs(folder, exist_ok=True)
    manifest = {"fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": PV, "feeds": {}}
    old = [f for f in os.listdir(folder) if f.endswith((".csv", ".csv.gz"))]
    for name, path in FEEDS.items():
        rows = fetch_json(path)
        if rows is None:
            log(f"pokeviews {name}: 404 at {path} - skipped")
            continue
        if not isinstance(rows, list):
            rows = [rows]
        p, n, cols = write_rows(rows, os.path.join(folder, name + ".csv"))
        lo, hi = date_span(rows)
        manifest["feeds"][name] = {"url": PV + path, "file": os.path.basename(p), "rows": n, "columns": cols, "first_date": lo, "last_date": hi}
        log(f"pokeviews {name}: {n} rows, {lo}..{hi} -> {os.path.basename(p)}")
        if name in SNAPSHOT_FEEDS:
            manifest["feeds"][name + "_history"] = keep_history(folder, name, rows, PV + path)
    # the correlation matrix: labels x labels per aggregation and window -> long rows
    corr = fetch_json(CORRELATION)
    if corr:
        labels, rows = corr.get("labels") or [], []
        for agg, wins in (corr.get("data") or {}).items():
            for win, m in (wins or {}).items():
                for i, a in enumerate(labels):
                    for j, b in enumerate(labels):
                        try:
                            v = m[i][j]
                        except (IndexError, TypeError):
                            v = None
                        rows.append({"aggregation": agg, "window": win, "asset_a": a, "asset_b": b, "correlation": v,
                                     "last_updated": corr.get("last_updated")})
        p, n, cols = write_rows(rows, os.path.join(folder, "asset_correlation.csv"))
        manifest["feeds"]["asset_correlation"] = {"url": PV + CORRELATION, "file": os.path.basename(p), "rows": n, "columns": cols,
                                                  "last_updated": corr.get("last_updated"), "labels": labels}
        log(f"pokeviews asset_correlation: {n} rows")
    # the set index: one feed per series, named after the series
    cons = fetch_json(FEEDS["set_constituents"]) or []
    series = sorted({r.get("series_name") for r in cons if r.get("series_name")})
    allrows, files = [], {}
    for s in series:
        got = None
        for cand in (slug(s), slug(s).replace("-", "_"), slug(s).replace("-", "")):
            got = fetch_json(SET_INDEX.format(slug=cand))
            if got is not None:
                files[s] = SET_INDEX.format(slug=cand)
                break
        if got is None:
            log(f"pokeviews set index: no feed for series {s!r}")
            continue
        for r in got:
            if "pc_set_name" in r and "set_name" not in r:
                r = dict(r)
                r["set_name"] = r.pop("pc_set_name")
            allrows.append(r)
    if allrows:
        order = ["date", "series_name", "set_name"]
        p, n, cols = write_rows(allrows, os.path.join(folder, "set_performance.csv"), columns=order + [c for c in allrows[0] if c not in order])
        lo, hi = date_span(allrows)
        manifest["feeds"]["set_performance"] = {"url": PV + SET_INDEX, "files": files, "file": os.path.basename(p), "rows": n, "columns": cols,
                                                "first_date": lo, "last_date": hi, "series": len(files), "sets": len({r.get("set_name") for r in allrows})}
        log(f"pokeviews set_performance: {n} rows, {len(files)} series, {lo}..{hi}")
    json.dump(manifest, open(os.path.join(folder, "manifest.json"), "w"), indent=1)
    # a feed renamed or dropped leaves no stale file behind
    for f in old:
        base = f[:-3] if f.endswith(".gz") else f
        if not any(v.get("file") in (f, base, base + ".gz") for v in manifest["feeds"].values()):
            os.remove(os.path.join(folder, f))
            log(f"pokeviews: removed stale {f}")
    return manifest


# ---------------- PriceCharting: the monthly panel ----------------
def month_name(m):
    return f"{2000 + m // 12:04d}-{m % 12 + 1:02d}"


def pricecharting(out, live_dir, snapshots, password):
    folder = os.path.join(out, "pricecharting")
    os.makedirs(folder, exist_ok=True)
    hist = F.read_shards(os.path.join(live_dir, "pc"), password)
    snap = F.latest_snapshot(snapshots)
    cat = F.read_catalog(snap, password)
    log(f"pricecharting: {len(hist):,} cards with history, catalog {snap} ({len(cat):,} rows)")
    # one file per calendar year (pc_monthly_2026.csv.gz ...): a monthly refresh rewrites only the current year's,
    # so the repository grows by ~2 MB a month, not by the whole 10 MB panel
    by_year = {}
    for cid in sorted(hist, key=int):
        r = hist[cid]
        p = r.get("p") or []
        v = r.get("v") if r.get("s") or r.get("sv") else None
        m0 = r["m0"]
        for k, cents in enumerate(p):
            price = round(cents / 100.0, 2) if cents and cents > 0 else ""
            sales = (v[k] if v is not None and k < len(v) and v[k] is not None else "")
            if price == "" and sales == "":
                continue
            mn = month_name(m0 + k)
            by_year.setdefault(mn[:4], []).append((cid, mn, price, sales))
    n = 0
    for f in glob.glob(os.path.join(folder, "pc_monthly*.csv.gz")):
        os.remove(f)
    for year, rows in sorted(by_year.items()):
        path = os.path.join(folder, f"pc_monthly_{year}.csv.gz")
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["card_id", "month", "price", "sales"])
            w.writerows(rows)
        n += len(rows)
        log(f"pricecharting: {len(rows):,} card-months of {year} -> {os.path.basename(path)}")
    log(f"pricecharting: {n:,} card-months in {len(by_year)} files")
    rows = []
    for rec in cat.to_dict("records"):
        h = hist.get(str(rec["id"]))
        rows.append({"card_id": rec["id"], "name": rec["card"], "set": rec["set"], "number": rec["num"], "rarity": rec["rarity"],
                     "finish": rec["finish"], "release_date": None if rec["release"] is None or str(rec["release"]) == "NaT" else str(rec["release"])[:10],
                     "price_now": None if rec["pc_now"] != rec["pc_now"] else rec["pc_now"],
                     "sales_year": None if rec["sales_yr"] != rec["sales_yr"] else rec["sales_yr"],
                     "history_months": len(h.get("p") or []) if h else 0, "history_from": month_name(h["m0"]) if h else None,
                     "history_read": h.get("t") if h else None})
    write_rows(rows, os.path.join(folder, "cards.csv"), force_gz=True)
    log(f"pricecharting: {len(rows):,} cards -> cards.csv.gz")
    return {"snapshot": os.path.basename(snap), "cards_with_history": len(hist), "card_months": n, "catalog_rows": len(rows)}


# ---------------- PriceCharting: every column of the daily download ----------------
# PriceCharting's price guide for cards (their names; the grade each one means for a card, per PriceCharting's API docs):
PC_MONEY = ["loose-price",            # ungraded
            "cib-price",              # grade 7 / 7.5
            "new-price",              # grade 8 / 8.5
            "graded-price",           # grade 9
            "box-only-price",         # grade 9.5
            "manual-only-price",      # PSA 10
            "bgs-10-price",           # BGS 10
            "condition-17-price",     # CGC 10
            "condition-18-price",     # SGC 10
            "retail-loose-buy", "retail-loose-sell",      # PriceCharting's suggested dealer buy / sell prices: ungraded,
            "retail-cib-buy", "retail-cib-sell",          # grade 7, grade 8 (the cib / new columns)
            "retail-new-buy", "retail-new-sell",
            "gamestop-price", "gamestop-trade-price"]     # always empty for cards
PC_NUM = PC_MONEY + ["sales-volume"]


def snap_date(path):
    m = re.search(r"pc_catalog_(\d{4}-\d{2}-\d{2})", os.path.basename(path))
    return m.group(1) if m else None


def read_snapshot_raw(path, password):
    """A pc_catalog snapshot -> every column as PriceCharting wrote it (strings), plus the build's card-number /
    rarity / finish / rf-source."""
    import pandas as pd
    raw = gzip.decompress(F.decrypt_file_blob(open(path, "rb").read(), password))
    return pd.read_csv(io.BytesIO(raw), dtype=str, keep_default_na=False)


def pc_numbers(df):
    """The snapshot's prices in dollars (\"$1,234.50\" -> 1234.5) and the sales volume, indexed by card id."""
    import pandas as pd
    out = pd.DataFrame(index=pd.Index(pd.to_numeric(df["id"], errors="coerce").astype("int64"), name="card_id"))
    for c in PC_NUM:
        v = df[c] if c in df.columns else pd.Series([""] * len(df))
        v = pd.to_numeric(v.astype(str).str.replace(r"[$,\s]", "", regex=True), errors="coerce").to_numpy()
        out[c] = v.round(2) if c != "sales-volume" else v
    return out[~out.index.duplicated(keep="last")]


def pc_daily(out, snapshots, password):
    """data/pricecharting/daily/: one file per snapshot day not yet archived. The month's first day (and the very first
    day) is written whole - full_<date>.csv.gz, every column of PriceCharting's download with the prices in dollars -
    the other days as changes_<date>.csv.gz: date, card_id, status (changed / new / removed) and the card's 18 numbers
    that day, for every card whose prices or volume differ from the snapshot before. A month = its full file + its
    changes files, applied in date order."""
    import pandas as pd
    folder = os.path.join(out, "pricecharting", "daily")
    os.makedirs(folder, exist_ok=True)
    found = (re.search(r"(\d{4}-\d{2}-\d{2})", f) for f in os.listdir(folder) if f.endswith(".csv.gz"))
    done = sorted({m.group(1) for m in found if m})
    last = done[-1] if done else None
    snaps = sorted((p for p in glob.glob(os.path.join(snapshots, "pc_catalog_*.csv.gz.enc")) if snap_date(p)), key=snap_date)
    todo = [p for p in snaps if last is None or snap_date(p) > last]
    info = {"days_on_file": len(done), "written": []}
    if not todo:
        log(f"pricecharting daily: nothing new (last {last})")
        return info
    base = [p for p in snaps if last is not None and snap_date(p) <= last]
    prev, prev_day = None, None
    if base:
        prev, prev_day = pc_numbers(read_snapshot_raw(base[-1], password)), snap_date(base[-1])
    for p in todo:
        day = snap_date(p)
        df = read_snapshot_raw(p, password)
        num = pc_numbers(df)
        if prev is None or prev_day[:7] != day[:7]:
            full = df.copy()
            for c in PC_MONEY:
                if c in full.columns:
                    full[c] = num[c].reindex(pd.to_numeric(full["id"], errors="coerce").astype("int64")).to_numpy()
            full.insert(0, "date", day)
            path = os.path.join(folder, f"full_{day}.csv.gz")
            full.to_csv(path, index=False, compression={"method": "gzip", "compresslevel": 6})
            kind, n = "full", len(full)
        else:
            j = num.join(prev, rsuffix="__p", how="outer")
            in_cur, in_prev = j.index.isin(num.index), j.index.isin(prev.index)
            moved = pd.Series(False, index=j.index)
            for c in PC_NUM:
                a, b = j[c], j[c + "__p"]
                moved |= ~((a == b) | (a.isna() & b.isna()))
            keep = (moved | ~in_cur | ~in_prev).to_numpy()
            ch = j.loc[keep, PC_NUM].copy()
            ch.insert(0, "status", pd.Series(in_cur, index=j.index)[keep].map({True: "changed", False: "removed"}).to_numpy())
            ch.loc[~pd.Series(in_prev, index=j.index)[keep].to_numpy(), "status"] = "new"
            ch.loc[ch["status"] == "removed", PC_NUM] = None
            ch = ch.reset_index()
            ch.insert(0, "date", day)
            ch["sales-volume"] = ch["sales-volume"].astype("Int64")
            path = os.path.join(folder, f"changes_{day}.csv.gz")
            ch.to_csv(path, index=False, compression={"method": "gzip", "compresslevel": 6})
            kind, n = "changes", len(ch)
        info["written"].append({"date": day, "kind": kind, "rows": n, "bytes": os.path.getsize(path)})
        log(f"pricecharting daily {day}: {kind}, {n:,} rows -> {os.path.basename(path)} ({os.path.getsize(path) / 1e6:.2f} MB)")
        prev, prev_day = num, day
    info["days_on_file"] = len(done) + len(todo)
    return info


# ---------------- eBay: the catalog's figures and the daily rollup ----------------
TR_KEYS = ["spm", "d7", "d30", "pos", "hi", "lo", "vol", "ts", "tsq1", "tsq3", "vd", "vdp", "days"]
CARD_KEYS = ["price", "k", "D", "lam", "N", "p1", "p2", "p3", "n30", "km", "kt", "mu", "dos", "io", "smed", "s80", "hrs", "st",
             "A", "A_n", "A_win", "A_fast", "L", "S", "liquid", "basis", "probT", "edays", "csell", "net", "maxbuy", "hot", "confirm",
             "pc", "pcv", "lpd"]


def read_live(live_dir, password):
    blob = open(os.path.join(live_dir, "ebay_live.bin"), "rb").read()
    raw = F.decrypt_live(blob, password)
    try:
        raw = gzip.decompress(raw)
    except Exception:                                                  # noqa - an older, plain JSON live file
        pass
    return json.loads(raw.decode("utf-8"))


def names_by_id(snapshots, password):
    try:
        cat = F.read_catalog(F.latest_snapshot(snapshots), password)
        return {int(r["id"]): (r["card"], r["set"], r["num"]) for r in cat.to_dict("records")}
    except SystemExit:
        return {}


def ebay(out, live_dir, snapshots, password, full):
    live = read_live(live_dir, password)
    day = (live.get("t") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))[:10]
    names = names_by_id(snapshots, password)
    folder = os.path.join(out, "ebay", "catalog")
    os.makedirs(folder, exist_ok=True)
    rows = []
    for cid, c in sorted(live.get("cards", {}).items(), key=lambda x: int(x[0])):
        nm = names.get(int(cid), ("", "", ""))
        row = {"card_id": int(cid), "name": nm[0], "set": nm[1], "number": nm[2], "as_of": live.get("t")}
        for k in CARD_KEYS:
            row[k] = c.get(k)
        tr = c.get("tr") or {}
        for k in TR_KEYS:
            row["tr_" + k] = tr.get(k)
        cred = c.get("cred") or []
        row["cred_n"] = len(cred)
        row["cred_min"] = cred[0][1] if cred else None
        row["book_n"] = len(c.get("book") or [])
        row["sold_n"] = len(c.get("sold") or [])
        row["checks_failed"] = ",".join(c.get("checks") or [])
        tw = c.get("tw")
        row["reprint_cut"] = tw[0] if tw else None
        h = c.get("hist")
        if h and h.get("sales"):
            last = len(h["sales"]) - 1
            row["rollup_start"] = h.get("start")
            row["rollup_days"] = last + 1
            row["sales_today"] = h["sales"][last]
            row["price7_today"] = (h.get("price") or [None] * (last + 1))[last]
            row["ask_today"] = (h.get("ask") or [None] * (last + 1))[last]
            row["new_today"] = (h.get("new") or [None] * (last + 1))[last]
        rows.append(row)
    p, n, cols = write_rows(rows, os.path.join(folder, day + ".csv"), force_gz=True)
    log(f"ebay catalog {day}: {n:,} cards -> {os.path.basename(p)}")
    info = {"as_of": live.get("t"), "cards": n, "file": os.path.relpath(p, out), "gate": live.get("gate"), "band": live.get("band"), "since": live.get("since")}
    if full:
        rr = []
        for cid, c in sorted(live.get("cards", {}).items(), key=lambda x: int(x[0])):
            h = c.get("hist")
            if not h or not h.get("sales"):
                continue
            start = datetime.strptime(h["start"], "%Y-%m-%d").date()
            sp, pos = h.get("sp") or [], 0
            for i, n_s in enumerate(h["sales"]):
                tots = sp[pos:pos + n_s]
                pos += n_s
                price7 = (h.get("price") or [None] * (i + 1))[i] if i < len(h.get("price") or []) else None
                ask = (h.get("ask") or [])[i] if i < len(h.get("ask") or []) else None
                new = (h.get("new") or [])[i] if i < len(h.get("new") or []) else None
                if not n_s and price7 is None and ask is None and not new:
                    continue
                rr.append({"card_id": int(cid), "date": (start + timedelta(days=i)).isoformat(), "sales": n_s,
                           "sold_totals": "|".join(str(t) for t in tots), "price_7d_median": price7, "cheapest_ask": ask, "new_listings": new})
        p2, n2, _ = write_rows(rr, os.path.join(out, "ebay", "daily_rollup.csv"), force_gz=True)
        log(f"ebay daily rollup: {n2:,} card-days -> {os.path.basename(p2)}")
        info["rollup_rows"] = n2
    return info


# ---------------- PriceCharting: the graded data the collector reads off the card pages (2026-10-26) ----------------
GRADED_SERIES = (("g7", "grade_7"), ("g8", "grade_8"), ("g9", "grade_9"), ("g95", "grade_9_5"), ("psa10", "psa_10"))
GS_OUT = ["card_id", "date", "grade", "grader", "price", "best_offer", "source", "row_id", "title"]


def pc_graded(out, live_dir, password, full):
    """(1) The collector's pcg/<stamp>.bin chunks (graded sales first seen on the card pages) -> graded_sales/
    graded_sales_<YYYY-MM>.csv.gz by sale month, merged with what is there and deduplicated on (card_id, row_id);
    (2) the PSA / CGC population report on each pcgh/<shard>.bin record -> pop/pop_<this month>.csv.gz; (3) full runs:
    the monthly graded prices on each record -> pc_graded_monthly_<year>.csv.gz."""
    import pandas as pd
    folder = os.path.join(out, "pricecharting")
    res = {}
    chunks = sorted(glob.glob(os.path.join(live_dir, "pcg", "*.bin")))
    rows = []
    for f in chunks:
        try:
            doc = json.loads(gzip.decompress(F.decrypt_live(open(f, "rb").read(), password)))
        except Exception as e:
            log(f"graded: chunk {os.path.basename(f)} unreadable ({str(e)[:80]})")
            continue
        cols = doc.get("cols") or []
        rows.extend(dict(zip(cols, r)) for r in doc.get("rows") or [])
    added = 0
    if rows:
        gfolder = os.path.join(folder, "graded_sales")
        os.makedirs(gfolder, exist_ok=True)
        df = pd.DataFrame(rows)
        df["row_id"] = df["row_id"].astype(str)
        df["source"] = df["row_id"].str.split("-").str[0]
        df["price"] = (pd.to_numeric(df["cents"], errors="coerce") / 100).round(2)
        df["grade"] = df["grade"].astype(str)
        df = df[GS_OUT]
        for month, part in df.groupby(df["date"].astype(str).str[:7]):
            path = os.path.join(gfolder, f"graded_sales_{month}.csv.gz")
            n0 = 0
            if os.path.exists(path):
                old = pd.read_csv(path, dtype={"grade": str, "row_id": str, "grader": str, "title": str})
                n0 = len(old)
                part = pd.concat([old, part], ignore_index=True)
            part = part.drop_duplicates(["card_id", "row_id"], keep="last").sort_values(["date", "card_id", "row_id"])   # a row queued
                                                     # again (its grader mended on a later read) replaces the earlier copy
            part.to_csv(path, index=False, compression={"method": "gzip", "compresslevel": 6})
            added += len(part) - n0
    res["graded_sales"] = {"chunks": len(chunks), "rows_read": len(rows), "rows_added": added}
    log(f"graded: {len(chunks)} chunk(s), {len(rows):,} rows read, {added:,} new graded sales filed")
    try:
        hist = F.read_shards(os.path.join(live_dir, "pcgh"), password)   # the collector's graded shards: {m0, g, pop, t} per card
    except Exception as e:
        log(f"graded: shards unreadable ({str(e)[:80]})")
        return res
    pop_rows = []
    for cid, r in hist.items():
        p = r.get("pop")
        if not p:
            continue
        psa = list((p.get("psa") or [])[:10]); cgc = list((p.get("cgc") or [])[:10])
        psa += [None] * (10 - len(psa)); cgc += [None] * (10 - len(cgc))
        pop_rows.append([int(cid), r.get("t")] + psa + cgc)
    if pop_rows:
        pfolder = os.path.join(folder, "pop")
        os.makedirs(pfolder, exist_ok=True)
        cols = ["card_id", "read_date"] + [f"psa_{i}" for i in range(1, 11)] + [f"cgc_{i}" for i in range(1, 11)]
        path = os.path.join(pfolder, f"pop_{datetime.now(timezone.utc).strftime('%Y-%m')}.csv.gz")
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(cols)
            w.writerows(sorted(pop_rows))
    res["pop_cards"] = len(pop_rows)
    log(f"graded: population report on {len(pop_rows):,} cards")
    if full:
        by_year = {}
        for cid in sorted(hist, key=int):
            r = hist[cid]
            g = r.get("g")
            if not g:
                continue
            m0 = r["m0"]
            L = max(len(v) for v in g.values())
            for k in range(L):
                vals = [(g.get(key) or [])[k] if k < len(g.get(key) or []) else None for key, _ in GRADED_SERIES]
                if not any(vals):
                    continue
                mn = month_name(m0 + k)
                by_year.setdefault(mn[:4], []).append([cid, mn] + [round(v / 100.0, 2) if v else "" for v in vals])
        n = 0
        if by_year:
            for f in glob.glob(os.path.join(folder, "pc_graded_monthly*.csv.gz")):
                os.remove(f)
            for year, yr in sorted(by_year.items()):
                path = os.path.join(folder, f"pc_graded_monthly_{year}.csv.gz")
                with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as f:
                    w = csv.writer(f, lineterminator="\n")
                    w.writerow(["card_id", "month"] + [c for _, c in GRADED_SERIES])
                    w.writerows(yr)
                n += len(yr)
        res["graded_monthly_rows"] = n
        log(f"graded: {n:,} card-months of graded prices in {len(by_year)} file(s)")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data")
    ap.add_argument("--live-dir", default="live_pc", help="a checkout of the live branch's pc/ folder and ebay_live.bin")
    ap.add_argument("--snapshots", default="snapshots")
    ap.add_argument("--password", default=os.environ.get("SITE_PASSWORD", ""))
    ap.add_argument("--full", action="store_true", help="also the PriceCharting panel and the eBay daily rollup")
    ap.add_argument("--skip-pokeviews", action="store_true")
    ap.add_argument("--skip-ebay", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    os.makedirs(a.out, exist_ok=True)
    report = {"run": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "full": a.full}
    if not a.skip_pokeviews:
        report["pokeviews"] = {k: {"rows": v["rows"], "last_date": v.get("last_date")} for k, v in pokeviews(a.out)["feeds"].items()}
    if not a.password:
        log("no SITE_PASSWORD: the PriceCharting and eBay exports need it - skipped")
    else:
        if a.full:
            report["pricecharting"] = pricecharting(a.out, a.live_dir, a.snapshots, a.password)
        report["pricecharting_daily"] = pc_daily(a.out, a.snapshots, a.password)
        try:
            report["pricecharting_graded"] = pc_graded(a.out, a.live_dir, a.password, a.full)
        except Exception as e:                       # the rest of the archive must not fail over the graded part
            log(f"graded: failed ({str(e)[:160]})")
            report["pricecharting_graded"] = {"error": str(e)[:160]}
        if not a.skip_ebay:
            report["ebay"] = ebay(a.out, a.live_dir, a.snapshots, a.password, a.full)
    report["seconds"] = round(time.time() - t0)
    json.dump(report, open(os.path.join(a.out, "last_run.json"), "w"), indent=1)
    log(f"done in {report['seconds']} s")


if __name__ == "__main__":
    main()
