#!/usr/bin/env python3
"""forecast.py - the Forecast tab's model (Brett, 2026-10-17: "a formula that predicts which cards' 30d% will increase
the most ... I input my capital, you tell me what cards to buy, how many, my estimated range of net profit after I
hold for a month, and a confidence %").

WHAT IT DOES. From the monthly PriceCharting history the collector reads off every card's page (pc/<shard>.bin on
the live branch: the ungraded price and the sales volume per month since Dec 2020) it fits a gradient-boosted model
of the card's price change over the next 1, 3 and 6 months and scores every card priced $10 or more today. The page
turns a score into money with the calibration tables in forecast_calib.json (realized outcomes by score bucket and
market regime, measured out of sample on 2022-2026) and the fee arithmetic the eBay tabs already use.

WHAT THE RESEARCH FOUND (2026-10-17, 2.3M card-months, rolling out-of-sample tests; details in CLAUDE.md):
  - Month-to-month "momentum" in PriceCharting's series is mostly noise: a card whose price just dropped prints a
    higher number next month 2/3 of the time, but you cannot BUY at the dropped print (asks never moved), so the
    buy price here is max(today's price, the 3-month average) and the sell price is PriceCharting's price h months
    later. On that honest basis there is no card-level momentum at one month.
  - What does predict: the market regime (the trailing 3-month median move of all $10+ cards - monthly moves are
    90% autocorrelated), the age of the set (cards from sets under 6 months old lose 10-20% a month; 12-24 months
    -4%; 2+ years flat), last month's move and its acceleration (as reversal), the set's own move, volume trend,
    distance from the 12-month high, price rank in the set, vintage, calendar month.
  - The model ranks well (Spearman IC 0.25 at every horizon, top picks beat the universe in 87% of months), but
    eBay's round trip costs 14.1% + $5.20 + shipping, so at ONE MONTH no selection has a positive expected net
    when buying at a standard price: the top 5% picks average +5-6% gross, P(net > 0) ~10%. The month only pays
    when the card is bought 20%+ under market (then P(net > 0) 57%, 25% under 73%, 30% under 86%).
  - At SIX MONTHS in a strong market (trailing 3-month median >= +2%/month) the top 20% picks average +34% gross,
    P(up) 81%, P(net > 0) ~50%, mean net +5-7%, 10th percentile net -10%, 90th +90%. In other regimes ~+10% gross.
  - The model is as good at flagging LOSERS as winners: its bottom half returns -6%/month in weak markets.

RUN (the site workflow, daily after the build):
  python forecast.py --shards live_pc/pc --snapshots snapshots --calib forecast_calib.json --out public/forecast.bin
The output is gzip(JSON) encrypted with the live key (the page's HKEY), like the history shards.
"""
import argparse, csv, glob, gzip, hashlib, io, json, os, re, sys, time
from datetime import datetime, timezone
import numpy as np
import pandas as pd

FEATS = ["mom1", "mom3", "mom6", "mom12", "accel", "vol6", "dd12", "up12", "lv", "vgrow", "dvol", "vol12", "lage", "lp", "cal",
         "reg3", "lsy", "rar", "fin", "set_mom1", "set_n", "prank", "vintage", "yoy_same", "vz", "m_since_hi", "reg1", "reg6",
         "breadth", "breadth3"]
HORIZONS = (1, 3, 6)
MIN_PRICE = 10.0              # the model's universe: cards priced $10+ (with 2+ sales in the month when training)
TRAIN_ROWS = 700000           # a random cap on training rows (the fit is ~30 s this way)
REGIME_STRONG = 0.02          # trailing 3-month median market move at or above +2%/month = "strong"
HGB = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200, l2_regularization=1.0, random_state=0)
RARITY_ORDER = None           # filled from the catalog's value counts (an integer code per rarity / finish word)


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


# ---------------- the panel and its features (identical to the research scripts) ----------------
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
    """Adds the model's inputs. Every value at month m uses data from months <= m only."""
    global RARITY_ORDER
    g = df.groupby("id")
    p = df["price"]
    lag = lambda k: g["price"].shift(k)
    df["lp"] = np.log(p)
    for k in (1, 2, 3, 6, 12):
        df[f"mom{k}"] = p / lag(k) - 1
    df["accel"] = df["mom1"] - (lag(1) / lag(2) - 1)
    lr = df["lp"] - g["lp"].shift(1)
    df["vol6"] = lr.groupby(df["id"]).transform(lambda s: s.rolling(6, min_periods=3).std())
    df["hi12"] = g["price"].transform(lambda s: s.rolling(12, min_periods=6).max())
    df["lo12"] = g["price"].transform(lambda s: s.rolling(12, min_periods=6).min())
    df["dd12"] = p / df["hi12"] - 1
    df["up12"] = p / df["lo12"] - 1
    v = df["vol"].fillna(0)
    df["lv"] = np.log1p(v)
    df["v3"] = g["vol"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    df["vgrow"] = (v + 1) / (df["v3"].fillna(0) + 1)
    df["dvol"] = np.log1p(v * p.fillna(0))
    df["vol12"] = g["vol"].transform(lambda s: s.rolling(12, min_periods=3).sum())
    df["cal"] = df["m"] % 12 + 1
    df["p3avg"] = g["price"].transform(lambda s: s.rolling(3, min_periods=2).mean())
    df["buy_real"] = np.maximum(df["price"], df["p3avg"])
    # the set's own move this month, the card left out; the set's size; the card's price rank within the set
    inset = df["price"] >= 5
    S = df[inset].groupby(["set", "m"])["mom1"].agg(["sum", "count"]).rename(columns={"sum": "ss", "count": "sn"})
    df = df.merge(S, left_on=["set", "m"], right_index=True, how="left")
    df["set_mom1"] = np.where(inset, (df["ss"] - df["mom1"].fillna(0)) / (df["sn"] - 1).replace(0, np.nan), df["ss"] / df["sn"])
    df["set_n"] = df.groupby(["set", "m"])["id"].transform("size")
    df["prank"] = df.groupby(["set", "m"])["price"].rank(pct=True)
    df["vintage"] = (df["release"].dt.year < 2004).astype(float)
    df["yoy_same"] = g["price"].shift(11) / g["price"].shift(12) - 1
    df["v12mean"] = g["vol"].transform(lambda s: s.shift(1).rolling(12, min_periods=3).mean())
    df["vz"] = (df["vol"] - df["v12mean"]) / (df["v12mean"] + 1)
    # months since the 12-month high: the smallest k with price k months ago equal to the trailing high
    since = pd.Series(np.nan, index=df.index)
    for k in range(11, -1, -1):
        hit = np.isclose(lag(k), df["hi12"])
        since = since.where(~hit, k)
    df["m_since_hi"] = since
    # the market: the median monthly move of $10+ cards with 2+ sales, its trailing means, and the breadth
    g = df.groupby("id")
    uq = df[(df["price"] >= MIN_PRICE) & (df["vol"] >= 2)]
    mk = uq.groupby("m")["mom1"].agg(reg1="median", breadth=lambda s: (s > 0).mean())
    mk["reg3"] = mk["reg1"].rolling(3).mean()
    mk["reg6"] = mk["reg1"].rolling(6).mean()
    mk["breadth3"] = mk["breadth"].rolling(3).mean()
    df = df.merge(mk, left_on="m", right_index=True, how="left")
    df["lage"] = np.log1p(df["age"].clip(0, 400))
    df["lsy"] = np.log1p(df["sales_yr"].fillna(0))
    if RARITY_ORDER is None:
        RARITY_ORDER = {"rar": {r: i for i, r in enumerate(df["rarity"].value_counts().index)},
                        "fin": {r: i for i, r in enumerate(df["finish"].value_counts().index)}}
    df["rar"] = df["rarity"].map(RARITY_ORDER["rar"]).astype(float)
    df["fin"] = df["finish"].map(RARITY_ORDER["fin"]).astype(float)
    return df.drop(columns=["ss", "sn"]), mk


def universe(df):
    return df[(df["price"] >= MIN_PRICE) & (df["vol"] >= 2)]


def targets(df, h):
    """The return of buying at max(price, 3-month average) in month m and selling at PriceCharting's price h months on."""
    return df.groupby("id")["price"].shift(-h) / df["buy_real"] - 1


def train(df, h, last_complete, seed=0):
    from sklearn.ensemble import HistGradientBoostingRegressor
    u = universe(df).copy()
    u["y"] = targets(df, h).loc[u.index].clip(-0.9, 2.0)
    tr = u[(u["m"] <= last_complete - h) & u["y"].notna()]
    if len(tr) > TRAIN_ROWS:
        tr = tr.sample(TRAIN_ROWS, random_state=seed)
    model = HistGradientBoostingRegressor(**dict(HGB, random_state=seed)).fit(tr[FEATS], tr["y"])
    return model, len(tr)


def score(df, models, m_now):
    """Every card priced $10+ at m_now -> its predictions and percentile ranks per horizon, plus the figures the page
    explains a pick with."""
    now = df[(df["m"] == m_now) & (df["price"] >= MIN_PRICE)].copy()
    for h, model in models.items():
        now[f"pred{h}"] = model.predict(now[FEATS])
        now[f"pct{h}"] = now[f"pred{h}"].rank(pct=True)
    return now


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


def publish(now, mk, m_now, calib, out, password, meta):
    reg = mk.loc[m_now] if m_now in mk.index else mk.iloc[-1]
    strong = bool(reg["reg3"] >= REGIME_STRONG)
    cards = {}
    for r in now.itertuples(index=False):
        buy = r.price if pd.isna(r.buy_real) else r.buy_real          # one month of history: no 3-month average yet
        cards[str(r.id)] = [round(float(r.price), 2), round(float(buy), 2)] + \
            [x for h in HORIZONS for x in (round(float(getattr(r, f"pred{h}")), 4), round(float(getattr(r, f"pct{h}")), 4))] + \
            [None if pd.isna(r.mom1) else round(float(r.mom1), 4), None if pd.isna(r.mom3) else round(float(r.mom3), 4),
             None if pd.isna(r.mom12) else round(float(r.mom12), 4), None if pd.isna(r.age) else int(r.age),
             None if pd.isna(r.vol) else int(r.vol), None if pd.isna(r.vol12) else int(r.vol12),
             None if pd.isna(r.dd12) else round(float(r.dd12), 4), None if pd.isna(r.set_mom1) else round(float(r.set_mom1), 4)]
    doc = {"t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "m": int(m_now), "month": f"{2000 + m_now // 12}-{m_now % 12 + 1:02d}",
           "regime": {"reg1": round(float(reg["reg1"]), 4), "reg3": round(float(reg["reg3"]), 4), "reg6": None if pd.isna(reg["reg6"]) else round(float(reg["reg6"]), 4),
                      "breadth3": None if pd.isna(reg["breadth3"]) else round(float(reg["breadth3"]), 3), "strong": strong, "threshold": REGIME_STRONG},
           "cols": ["price", "buy", "pred1", "pct1", "pred3", "pct3", "pred6", "pct6", "mom1", "mom3", "mom12", "age", "vol", "vol12", "dd12", "set_mom1"],
           "horizons": list(HORIZONS), "min_price": MIN_PRICE, "n": len(cards), "cards": cards, "calib": calib, "meta": meta}
    doc = clean(doc)
    raw = gzip.compress(json.dumps(doc, separators=(",", ":"), allow_nan=False).encode("utf-8"))   # strict: a NaN here is a bug, not a value
    open(out, "wb").write(encrypt_live(raw, password))
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", required=True, help="folder with pc/<shard>.bin from the live branch")
    ap.add_argument("--snapshots", default="snapshots", help="folder with pc_catalog_<date>.csv.gz.enc (the newest is used)")
    ap.add_argument("--catalog", help="a specific catalog file instead of the newest snapshot")
    ap.add_argument("--calib", default="forecast_calib.json")
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
    m_now = int(df["m"].max())
    last_complete = m_now - 1                               # the current month's point is still moving
    print(f"panel: {len(df):,} card-months to {2000 + m_now // 12}-{m_now % 12 + 1:02d}; market reg3 {mk.loc[m_now, 'reg3']:+.4f} ({time.time() - t0:.0f}s)")
    models, meta = {}, {"trained": {}, "features": FEATS, "hgb": HGB, "train_rows": TRAIN_ROWS}
    for h in HORIZONS:
        models[h], n = train(df, h, last_complete)
        meta["trained"][str(h)] = {"rows": n, "last_target_month": int(last_complete - h)}
        print(f"  horizon {h}: trained on {n:,} rows ({time.time() - t0:.0f}s)")
    now = score(df, models, m_now)
    calib = json.load(open(a.calib)) if os.path.exists(a.calib) else None
    doc = publish(now, mk, m_now, calib, a.out, a.password, meta)
    print(f"published {doc['n']:,} cards to {a.out} ({os.path.getsize(a.out):,} bytes, {time.time() - t0:.0f}s); regime {'strong' if doc['regime']['strong'] else 'other'} reg3 {doc['regime']['reg3']:+.4f}")
    top = now.nlargest(8, "pred6")[["card", "set", "price", "pred1", "pred6", "age", "vol"]]
    print(top.to_string(index=False))


if __name__ == "__main__":
    main()
