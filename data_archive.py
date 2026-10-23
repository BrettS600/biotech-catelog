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
}
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
        if not a.skip_ebay:
            report["ebay"] = ebay(a.out, a.live_dir, a.snapshots, a.password, a.full)
    report["seconds"] = round(time.time() - t0)
    json.dump(report, open(os.path.join(a.out, "last_run.json"), "w"), indent=1)
    log(f"done in {report['seconds']} s")


if __name__ == "__main__":
    main()
