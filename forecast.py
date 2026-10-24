#!/usr/bin/env python3
"""forecast.py - the Forecast tab's model, version 2 (2026-10-24, from the research in data/research: "Spend 3 hours
analyzing all of that data ... improve the predictive power of my forecast model"; then "can you just do it for me?
and the build?").

WHAT IT DOES. From the monthly PriceCharting history the collector reads off every card's page (pc/<shard>.bin on
the live branch: the ungraded price and the sales volume per month since Dec 2020) it ranks every card by how far
its price sits below its own 12-month mean (the reversal signal), reads the market regime, and builds the chance
tables - the realized gross returns of buying at max(price, 3-month average) and selling at PriceCharting's price 1,
3 or 6 months on, by regime x hold x rank bucket, over 2022 to the last complete month. The page turns a rank into
money with those tables and the fee arithmetic the eBay tabs already use, at the eBay prices of the moment.

WHAT THE RESEARCH FOUND (data/research/FINDINGS.md, 25 experiments, 2.3M card-months):
  - The one robust card-level signal is mean reversion toward the card's own 12-month level: the decile furthest
    below it returns +6 to +10 points per quarter more than the band in EVERY year 2022-2026 (53 of 55 months), and
    Fama-MacBeth regressions show the premium survives every control (momentum, 52-week high, volatility, price,
    liquidity, set age, market beta) and is alpha, not beta. The gradient-boosted model of version 1 ranked well but
    did not beat this single rank; set-level momentum was an artifact of PriceCharting's monthly averaging. So the
    rank is dev12 and nothing else.
  - The market regime is persistent: when the trailing 3-month median move of the market is positive the next quarter
    is up 95% of the time; negative, 12%. The tables are split by that sign, and the tab treats a negative regime as
    "do not buy" by default. The regime is measured on cards priced $10+ LAST month with 2+ sales this month (the
    version-1 filter on this month's price biased it upward).
  - Fees are the wall (+22% needed on a $100 card); the discount under the standard price is the business (each point
    ~1.3 points of net) - the tab prices every card at eBay's credible floor; the chance tables keyed by the rank
    bucket and the regime had a 5-point out-of-sample error (E20).
  - Hold 2-4 months (3 by default), one copy per card, 20+ cards; stop-losses and take-profit listings do not help.

RUN (the site workflow, daily after the build):
  python forecast.py --shards live_pc/pc --snapshots snapshots --calib forecast_calib.json --out public/forecast.bin
The output is gzip(JSON) encrypted with the live key (the page's HKEY), like the history shards. --write-calib writes
the tables to forecast_calib.json as well (the static fallback the history replay uses for its first year).
"""
import argparse, glob, gzip, hashlib, io, json, os, time
from datetime import datetime, timezone
import numpy as np
import pandas as pd

VERSION = "v2 reversal 2026-10-24"
HORIZONS = (1, 3, 6)
MIN_PRICE = 10.0              # every card priced $10+ is published (the Raw Data column, the alerts)
RANK_MIN_PRICE = 25.0         # the ranked and calibrated universe: cards $25+ ...
RANK_MIN_VOL12 = 6            # ... with six PriceCharting sales in their last twelve months (the tab's own filter)
CALIB_START_M = 264           # 2022-01: the first decision month of the chance tables
CALIB_CLIP = (-0.95, 5.0)
QS = [round(i / 100, 2) for i in range(5, 100, 5)]
BUCKETS = ("b50", "b75", "b90", "top10")
BUCKET_EDGES = [0, .5, .75, .9, 1.0]
REGIME_STRONG = 0.02          # kept for the old records' word ("strong"); the tables and the gate use the sign of reg3
MIN_CELL = 30


# ---------------- keys and files (the same scheme as ebay_sweep.py / build_catalog.py) ----------------
_KEYS = {}


def live_key(password):
    if password not in _KEYS:                              # 600k PBKDF2 rounds: derive once, not once per shard
        _KEYS[password] = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b"biotech-catalog-live-v1", 600_000)
    return _KEYS[password]


def _aes():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return AESGCM


def decrypt_live(blob, password):
    return _aes()(live_key(password)).decrypt(blob[:12], blob[12:], None)


def encrypt_live(raw, password):
    nonce = os.urandom(12)
    return nonce + _aes()(live_key(password)).encrypt(nonce, raw, None)


def decrypt_file_blob(blob, password):
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), blob[:16], 600_000)
    return _aes()(key).decrypt(blob[16:28], blob[28:], None)


def read_shards(folder, password):
    """pc/<shard>.bin -> {card id: {m0, p, v, ...}}"""
    hist = {}
    for f in sorted(glob.glob(os.path.join(folder, "*.bin"))):
        b = open(f, "rb").read()
        if not b:
            continue
        hist.update(json.loads(gzip.decompress(decrypt_live(b, password))))
    return hist


def read_catalog(path, password=None):
    """A snapshot (pc_catalog_<date>.csv.gz.enc, encrypted) or a plain csv -> DataFrame of the columns the model uses."""
    if path.endswith(".enc"):
        raw = gzip.decompress(decrypt_file_blob(open(path, "rb").read(), password))
    elif path.endswith(".gz"):
        raw = gzip.decompress(open(path, "rb").read())
    else:
        raw = open(path, "rb").read()
    cat = pd.read_csv(io.BytesIO(raw), dtype=str).fillna("")
    money = lambda s: pd.to_numeric(s.str.replace("$", "", regex=False).str.replace(",", "", regex=False), errors="coerce")
    out = pd.DataFrame({"id": pd.to_numeric(cat["id"], errors="coerce"), "set": cat["console-name"], "card": cat["product-name"],
                        "num": cat.get("card-number", ""), "pc_now": money(cat["loose-price"]),
                        "sales_yr": pd.to_numeric(cat.get("sales-volume", ""), errors="coerce"),
                        "release": pd.to_datetime(cat.get("release-date", ""), errors="coerce"),
                        "rarity": cat.get("rarity", ""), "finish": cat.get("finish", "")})
    return out[out["id"].notna()].astype({"id": int})


def latest_snapshot(folder):
    files = sorted(glob.glob(os.path.join(folder, "pc_catalog_*.csv.gz.enc")))
    if not files:
        raise SystemExit("no pc_catalog_*.csv.gz.enc in " + folder)
    return files[-1]


# ---------------- the panel and its features (the research's definitions, data/research/scripts/xs.py) ----------------
def panel(hist, cat):
    rows = []
    for cid, r in hist.items():
        p, v = r.get("p") or [], r.get("v") or [0] * len(r.get("p") or [])
        hasv = bool(r.get("s") or r.get("sv"))
        m0 = r["m0"]
        for k, (pp, vv) in enumerate(zip(p, v)):
            rows.append((int(cid), m0 + k, pp, float(vv) if hasv else np.nan))
    df = pd.DataFrame(rows, columns=["id", "m", "cents", "vol"])
    df["price"] = df["cents"] / 100.0
    df.loc[~(df["price"] > 0), "price"] = np.nan
    df = df.merge(cat, on="id", how="left")
    rel = df["release"]
    df["rel_m"] = (rel.dt.year - 2000) * 12 + rel.dt.month - 1
    df["age"] = df["m"] - df["rel_m"]
    return df.sort_values(["id", "m"]).reset_index(drop=True)


def features(df):
    """Adds the signal, the figures the page explains a pick with, and the market. Every value at month m uses data
    from months <= m only."""
    g = df.groupby("id")
    p = df["price"]
    lag = lambda k: g["price"].shift(k)
    for k in (1, 3, 12):
        df[f"mom{k}"] = p / lag(k) - 1
    df["hi12"] = g["price"].transform(lambda s: s.rolling(12, min_periods=6).max())
    df["dd12"] = p / df["hi12"] - 1
    df["m12"] = g["price"].transform(lambda s: s.rolling(12, min_periods=12).mean())    # the card's own 12-month mean: the anchor
    df["dev12"] = p / df["m12"] - 1                                                       # the signal: how far below (negative) or above it
    df["vol12"] = g["vol"].transform(lambda s: s.rolling(12, min_periods=3).sum())
    df["p3avg"] = g["price"].transform(lambda s: s.rolling(3, min_periods=2).mean())
    df["buy_real"] = np.maximum(df["price"], df["p3avg"])                                  # you cannot buy at a print that just dipped
    inset = df["price"] >= 5                                                               # the set's own move (shown, not used: an averaging artifact, E11)
    S = df[inset].groupby(["set", "m"])["mom1"].agg(["sum", "count"]).rename(columns={"sum": "ss", "count": "sn"})
    df = df.merge(S, left_on=["set", "m"], right_index=True, how="left")
    df["set_mom1"] = np.where(inset, (df["ss"] - df["mom1"].fillna(0)) / (df["sn"] - 1).replace(0, np.nan), df["ss"] / df["sn"])
    # the market: the median monthly move of cards priced $10+ LAST month with 2+ sales this month (the research's
    # correction: filtering on this month's price lets the month's winners define the month), its trailing means, breadth
    g = df.groupby("id")
    df["price_lag1"] = g["price"].shift(1)
    uq = df[(df["price_lag1"] >= MIN_PRICE) & (df["vol"] >= 2) & df["mom1"].notna()]
    mk = uq.groupby("m")["mom1"].agg(reg1="median", breadth=lambda s: (s > 0).mean(), n="size")
    mk["reg3"] = mk["reg1"].rolling(3).mean()
    mk["reg6"] = mk["reg1"].rolling(6).mean()
    mk["breadth3"] = mk["breadth"].rolling(3).mean()
    df = df.merge(mk[["reg1", "reg3", "reg6", "breadth3"]], left_on="m", right_index=True, how="left")
    return df.drop(columns=["ss", "sn", "price_lag1"]), mk


def rank(df):
    """pct: the card's percentile among the month's ranked universe (cards $25+ with six sales in their last twelve
    months and a full year of history), deepest below its 12-month mean = 1.0. NaN outside the universe."""
    ok = (df["price"] >= RANK_MIN_PRICE) & (df["vol12"] >= RANK_MIN_VOL12) & df["dev12"].notna()
    df["pct"] = np.nan
    df.loc[ok, "pct"] = (-df.loc[ok, "dev12"]).groupby(df.loc[ok, "m"]).rank(pct=True)
    return df


def bucket_of(pct):
    return np.where(pct >= .9, "top10", np.where(pct >= .75, "b90", np.where(pct >= .5, "b75", "b50")))


def targets(df, h):
    """The gross return of buying at max(price, 3-month average) in month m and selling at PriceCharting's price h months on."""
    return df.groupby("id")["price"].shift(-h) / df["buy_real"] - 1


def calib(df, last_complete, start_m=CALIB_START_M):
    """The chance tables: realized gross returns by hold x regime (the sign of reg3 at the decision month) x rank
    bucket, decision months start_m .. last_complete - h, the ranked universe. Quantile grid 5..95%, the mean, P(up)."""
    tables, months = {}, {}
    base = df[df["pct"].notna() & (df["m"] >= start_m)]
    for h in HORIZONS:
        y = targets(df, h).loc[base.index]
        Q = base[(base["m"] <= last_complete - h) & y.notna()].assign(y=y.clip(*CALIB_CLIP))
        Q = Q.assign(reg=np.where(Q["reg3"] > 0, "up", "down"), b=bucket_of(Q["pct"].values))
        months[str(h)] = [int(Q["m"].min()), int(Q["m"].max())] if len(Q) else None
        for (reg, b), s in Q.groupby(["reg", "b"]):
            if len(s) < MIN_CELL:
                continue
            tables[f"{h}|{reg}|{b}"] = {"n": int(len(s)), "mean": round(float(s["y"].mean()), 4), "q": [round(float(s["y"].quantile(q)), 4) for q in QS], "p_up": round(float((s["y"] > 0).mean()), 3)}
        tables[f"{h}|all|all"] = {"n": int(len(Q)), "mean": round(float(Q["y"].mean()), 4), "q": [round(float(Q["y"].quantile(q)), 4) for q in QS], "p_up": round(float((Q["y"] > 0).mean()), 3)}
    return {"made": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "model": VERSION, "quantiles": QS, "buckets": list(BUCKETS), "bucket_edges": BUCKET_EDGES,
            "regime": "up when the trailing 3-month median market move is > 0, else down", "rank": f"dev12 within cards ${RANK_MIN_PRICE:.0f}+ with {RANK_MIN_VOL12}+ sales in 12 months",
            "start": month_name(start_m), "months": months, "tables": tables}


def month_name(m):
    return f"{2000 + m // 12}-{m % 12 + 1:02d}"


def score(df, m_now):
    """Every card priced $10+ at m_now with its rank (NaN outside the ranked universe) and the figures the page shows."""
    return df[(df["m"] == m_now) & (df["price"] >= MIN_PRICE)].copy()


def clean(o):
    """NaN / inf -> null, recursively: Python's json writes NaN, which a browser's JSON.parse refuses, so the file
    must never carry one (2026-10-17: a card with one month of history has no 3-month average -> buy was NaN)."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, float) and not np.isfinite(o):
        return None
    return o


COLS = ["price", "buy", "pred1", "pct1", "pred3", "pct3", "pred6", "pct6", "mom1", "mom3", "mom12", "age", "vol", "vol12", "dd12", "set_mom1", "dev12", "m12"]


def regime_doc(mk, m_now):
    reg = mk.loc[m_now] if m_now in mk.index else mk.iloc[-1]
    f = lambda v, nd=4: None if pd.isna(v) else round(float(v), nd)
    reg3 = float(reg["reg3"]) if not pd.isna(reg["reg3"]) else 0.0
    return {"reg1": f(reg["reg1"]), "reg3": f(reg["reg3"]), "reg6": f(reg["reg6"]), "breadth3": f(reg["breadth3"], 3), "n": int(reg["n"]) if "n" in reg and not pd.isna(reg["n"]) else None,
            "up": bool(reg3 > 0), "confirm": bool(not pd.isna(reg["reg1"]) and float(reg["reg1"]) > 0), "strong": bool(reg3 >= REGIME_STRONG), "threshold": REGIME_STRONG}


def publish(now, mk, m_now, cal, out, password, meta):
    R = regime_doc(mk, m_now)
    regw = "up" if R["up"] else "down"
    cards = {}
    for r in now.itertuples(index=False):
        buy = r.price if pd.isna(r.buy_real) else r.buy_real          # one month of history: no 3-month average yet
        pct = None if pd.isna(r.pct) else round(float(r.pct), 4)
        b = None if pct is None else str(bucket_of(np.array([pct]))[0])
        preds = []
        for h in HORIZONS:
            t = cal["tables"].get(f"{h}|{regw}|{b}") if b else None
            preds += [None if t is None else t["mean"], pct]
        v = lambda x, nd=4: None if pd.isna(x) else round(float(x), nd)
        cards[str(r.id)] = [round(float(r.price), 2), round(float(buy), 2)] + preds + \
            [v(r.mom1), v(r.mom3), v(r.mom12), None if pd.isna(r.age) else int(r.age), None if pd.isna(r.vol) else int(r.vol), None if pd.isna(r.vol12) else int(r.vol12),
             v(r.dd12), v(r.set_mom1), v(r.dev12), v(r.m12, 2)]
    doc = {"t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "m": int(m_now), "month": month_name(m_now), "model": VERSION,
           "regime": R, "cols": COLS, "horizons": list(HORIZONS), "min_price": MIN_PRICE, "rank_min_price": RANK_MIN_PRICE, "rank_min_vol12": RANK_MIN_VOL12,
           "n": len(cards), "n_ranked": int(now["pct"].notna().sum()), "cards": cards, "calib": cal, "meta": meta}
    doc = clean(doc)
    raw = gzip.compress(json.dumps(doc, separators=(",", ":"), allow_nan=False).encode("utf-8"))   # strict: a NaN here is a bug, not a value
    open(out, "wb").write(encrypt_live(raw, password))
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", required=True, help="folder with pc/<shard>.bin from the live branch")
    ap.add_argument("--snapshots", default="snapshots", help="folder with pc_catalog_<date>.csv.gz.enc (the newest is used)")
    ap.add_argument("--catalog", help="a specific catalog file instead of the newest snapshot")
    ap.add_argument("--calib", default="forecast_calib.json", help="unused by v2 except as the --write-calib default; the tables are rebuilt every run")
    ap.add_argument("--write-calib", nargs="?", const="forecast_calib.json", help="also write the tables to this json (the replay's static fallback)")
    ap.add_argument("--out", default="forecast.bin")
    ap.add_argument("--password", default=os.environ.get("SITE_PASSWORD", ""))
    a = ap.parse_args()
    if not a.password:
        raise SystemExit("SITE_PASSWORD is not set")
    t0 = time.time()
    hist = read_shards(a.shards, a.password)
    cat = read_catalog(a.catalog or latest_snapshot(a.snapshots), a.password)
    print(f"history: {len(hist):,} cards; catalog: {len(cat):,} rows ({time.time() - t0:.0f}s)")
    df = panel(hist, cat)
    df, mk = features(df)
    df = rank(df)
    m_now = int(df["m"].max())
    last_complete = m_now - 1                               # the current month's point is still moving
    R = regime_doc(mk, m_now)
    print(f"panel: {len(df):,} card-months to {month_name(m_now)}; market reg1 {R['reg1']:+.4f} reg3 {R['reg3']:+.4f} -> {'UP' if R['up'] else 'DOWN'} ({time.time() - t0:.0f}s)")
    cal = calib(df, last_complete)
    print(f"tables: {len(cal['tables'])} cells from {cal['start']} ({time.time() - t0:.0f}s); 3|up|top10 " + json.dumps({k: cal['tables'].get('3|up|top10', {}).get(k) for k in ('n', 'mean', 'p_up')}))
    if a.write_calib:
        json.dump(cal, open(a.write_calib, "w"), separators=(",", ":"))
        print(f"wrote {a.write_calib}")
    now = score(df, m_now)
    meta = {"model": VERSION, "rank": cal["rank"], "regime": cal["regime"], "calib_months": cal["months"], "last_complete": month_name(last_complete), "research": "data/research/FINDINGS.md"}
    doc = publish(now, mk, m_now, cal, a.out, a.password, meta)
    print(f"published {doc['n']:,} cards ({doc['n_ranked']:,} ranked) to {a.out} ({os.path.getsize(a.out):,} bytes, {time.time() - t0:.0f}s)")
    top = now[now["pct"].notna()].nlargest(8, "pct")[["card", "set", "price", "buy_real", "dev12", "pct", "age", "vol12"]]
    print(top.to_string(index=False))


if __name__ == "__main__":
    main()
