#!/usr/bin/env python3
"""forecast_hist.py - the Forecast history tab's replay (Brett, 2026-10-23: "a forecast history tab ... for a 1-month
hold, 3-month hold, 6-month hold for $500 ... $25,000 ... price range held constant ($50 to $500), fees 14.1% + $5.20
with 0% buy tax, I buy at 0% under the standard price held constant [and 20% under], Buy only at 50% or better ...
if i wanted to see how much I would have made in March 2025 with a $5000 investment in the card purchase
recommendation for that particular month").

WHAT IT DOES. The Forecast tab, month by month, the honest way: for every month since December 2022 the model is
refit on the months before it (every six months, like the research), every $10+ card is scored and ranked, the
calibration tables (the chance of a profit per rank bucket and market regime) are built from the outcomes known by
then, and the tab's plan is run at the standard constants for every capital x hold x discount - then scored with
PriceCharting's price when the hold is up. There is no eBay history before October 2026, so here the standard price
is PriceCharting's price (max of the month's print and its 3-month average, like the model's own buy_real) and the
sale is PriceCharting's price h months later; the supply cap is a quarter of the month's PriceCharting sales. The
live plans the collector archives each month (live.fc_auto, with eBay's floors and medians) are the other half of
the tab.

RUN (the Forecast history workflow, monthly; ~25 minutes):
  python forecast_hist.py --shards live_pc/pc --snapshots snapshots --calib forecast_calib.json --out forecast_hist.bin
The output is gzip(JSON) encrypted with the live key, like forecast.bin:
  {t, made, from, to, last_month, consts, caps, holds, discs, cards {cid: [name, set]},
   months [{m, month, reg, reg3, n, calib, cells {"h|disc|cap": {n_elig, best, picks [[cid, qty, buy, mean, y]],
   copies, spent, exp, lo, hi, p, actual, roi, inside, done, forced_roi}}]}
"""
import argparse, json, math, os, sys, time
from datetime import datetime, timezone
import numpy as np
import pandas as pd

import forecast as F
import forecast_math as fm

START_M = 275                # 2022-12: the first month scored (two years of history behind the first fit, as in the research)
REFIT_EVERY = 6              # months between refits
SUPPLY_FRAC = 0.25           # copies the plan may buy: this share of the month's PriceCharting sales (at least one)
MIN_CALIB_MONTHS = 12        # months of out-of-sample outcomes before the expanding tables replace the static ones
CALIB_MIN_PRICE = 25.0       # the tables are built on cards $25+, like forecast_calib.json
MC_N = 2000                  # Monte Carlo draws per plan (the page uses 3,000; the replay has 1,400 plans)
BAND = (50.0, 500.0)
QS = [round(i / 100, 2) for i in range(5, 100, 5)]
BUCKET_EDGES = [0, .5, .8, .9, .95, 1.0]


def month_name(m):
    return f"{2000 + m // 12}-{m % 12 + 1:02d}"


def calib_tables(P, h, t):
    """The expanding calibration: the realized-return quantile grid per regime x bucket from the out-of-sample
    predictions whose outcome is known by month t (m <= t - h), cards $25+. None when too few months are in."""
    Q = P[(P["m"] <= t - h) & (P["price"] >= CALIB_MIN_PRICE) & P[f"y{h}"].notna()]
    if Q.empty or Q["m"].nunique() < MIN_CALIB_MONTHS:
        return None
    Q = Q.assign(bucket=pd.cut(Q[f"pct{h}"], BUCKET_EDGES, labels=fm.BUCKETS, include_lowest=True), reg=np.where(Q["reg3"] >= F.REGIME_STRONG, "strong", "other"))
    tables = {}
    for (reg, b), s in Q.groupby(["reg", "bucket"], observed=True):
        y = s[f"y{h}"].clip(-0.95, 5)
        if len(y) < 30:
            continue
        tables[f"{h}|{reg}|{b}"] = {"n": int(len(y)), "mean": round(float(y.mean()), 4), "q": [round(float(y.quantile(q)), 4) for q in QS], "p_up": round(float((y > 0).mean()), 3)}
    y = Q[f"y{h}"].clip(-0.95, 5)
    tables[f"{h}|all|all"] = {"n": int(len(y)), "mean": round(float(y.mean()), 4), "q": [round(float(y.quantile(q)), 4) for q in QS], "p_up": round(float((y > 0).mean()), 3)}
    return tables


def replay(df, mk, cat, static_calib, log=print):
    """Score every month out of sample (refit every REFIT_EVERY months), then run the standard plans per month."""
    t0 = time.time()
    m_last = int(df["m"].max())
    names = {int(r.id): (str(r.card), str(r.set)) for r in cat.itertuples(index=False)}
    g = df.groupby("id")["price"]
    for h in F.HORIZONS:                                     # the realized gross return of buying at buy_real and selling at PriceCharting's price h months on
        df[f"y{h}"] = g.shift(-h) / df["buy_real"] - 1
    scored = df[(df["price"] >= F.MIN_PRICE) & (df["m"] >= START_M)].copy()
    for h in F.HORIZONS:
        scored[f"pred{h}"] = np.nan
    models = None
    for t in range(START_M, m_last + 1):
        if models is None or (t - START_M) % REFIT_EVERY == 0:
            models = {}
            for h in F.HORIZONS:
                models[h], n = F.train(df, h, t - 1)
                log(f"  refit at {month_name(t)}, horizon {h}: {n:,} rows ({time.time() - t0:.0f}s)")
        rows = scored.index[scored["m"] == t]
        if not len(rows):
            continue
        X = scored.loc[rows, F.FEATS]
        for h in F.HORIZONS:
            scored.loc[rows, f"pred{h}"] = models[h].predict(X)
    for h in F.HORIZONS:
        scored[f"pct{h}"] = scored.groupby("m")[f"pred{h}"].rank(pct=True)
    log(f"scored {len(scored):,} card-months, {month_name(START_M)} to {month_name(m_last)} ({time.time() - t0:.0f}s)")
    # the plans, month by month
    cols = ["price", "buy", "pred1", "pct1", "pred3", "pct3", "pred6", "pct6", "mom1", "mom3", "mom12", "age", "vol", "vol12", "dd12", "set_mom1"]
    months, cards_used = [], {}
    for t in range(START_M, m_last + 1):
        S = scored[scored["m"] == t]
        if S.empty:
            continue
        reg3 = float(mk.loc[t, "reg3"]) if t in mk.index and pd.notna(mk.loc[t, "reg3"]) else 0.0
        strong = reg3 >= F.REGIME_STRONG
        cards, stubs, ys = {}, {}, {h: {} for h in F.HORIZONS}
        for r in S.itertuples(index=False):
            buy = r.price if pd.isna(r.buy_real) else r.buy_real
            if not (BAND[0] <= buy <= BAND[1]):
                continue
            cid = int(r.id)
            cards[str(cid)] = [float(r.price), float(buy)] + [x for h in F.HORIZONS for x in (float(getattr(r, f"pred{h}")), float(getattr(r, f"pct{h}")))] + \
                [None, None, None, None if pd.isna(r.age) else int(r.age), None if pd.isna(r.vol) else int(r.vol), None if pd.isna(r.vol12) else int(r.vol12), None, None]
            stubs[str(cid)] = {"supply": max(1, int((0 if pd.isna(r.vol) else r.vol) * SUPPLY_FRAC))}
            for h in F.HORIZONS:
                y = getattr(r, f"y{h}")
                ys[h][cid] = None if pd.isna(y) else float(y)
        cells, calib_mode = {}, "expanding"
        tables = {}
        for h in F.HORIZONS:
            tb = calib_tables(scored, h, t)
            if tb is None:
                calib_mode = "static"
                tables.update({k: v for k, v in static_calib["tables"].items() if k.startswith(f"{h}|")})
            else:
                tables.update(tb)
        doc = {"cols": cols, "cards": cards, "calib": {"quantiles": QS, "tables": tables}, "regime": {"strong": strong, "reg3": reg3}, "month": month_name(t)}
        for h in F.HORIZONS:
            done = t + h <= m_last
            for disc in fm.STD_DISCS:
                for cap in fm.STD_CAPS:
                    I = dict(fm.STD_INPUTS, cap=float(cap), h=h, disc=disc)
                    P = fm.plan(doc, stubs, fm.STD_FEES, I, BAND, 5, names)
                    picks = P["picks"]
                    mc = fm.monte_carlo(QS, picks, fm.STD_FEES, disc, n=MC_N) if picks else None
                    actual = fm.actual_net(picks, fm.STD_FEES, disc, lambda cid: ys[h].get(cid)) if picks and done else None
                    cell = {"n_elig": sum(1 for r in P["rows"] if r["p"] >= I["minp"]), "best": round(max((r["p"] for r in P["rows"]), default=0.0), 3),
                            "picks": [[r["cid"], r["qty"], round(r["buy"], 2), round(r["mean"], 2), None if ys[h].get(r["cid"]) is None else round(ys[h][r["cid"]], 4)] for r in picks],
                            "copies": sum(r["qty"] for r in picks), "spent": round(P["spent"], 2), "done": done}
                    if mc:
                        cell.update({"exp": round(mc["mean"], 2), "lo": round(mc["lo"], 2), "hi": round(mc["hi"], 2), "p": round(mc["p"], 3)})
                    if actual is not None:
                        cell.update({"actual": round(actual, 2), "roi": round(actual / P["spent"], 4) if P["spent"] else None, "inside": bool(mc["lo"] <= actual <= mc["hi"])})
                    if not picks and done:                   # what buying the top-ranked cards anyway would have made: the plan with no bar
                        P0 = fm.plan(doc, stubs, fm.STD_FEES, dict(I, minp=0.0), BAND, 5, names)
                        a0 = fm.actual_net(P0["picks"], fm.STD_FEES, disc, lambda cid: ys[h].get(cid)) if P0["picks"] else None
                        cell["forced_roi"] = round(a0 / P0["spent"], 4) if a0 is not None and P0["spent"] else None
                        cell["forced_n"] = len(P0["picks"])
                    for r in picks:
                        cards_used[r["cid"]] = names.get(r["cid"], ("", ""))
                    cells[f"{h}|{disc:g}|{cap}"] = cell
        months.append({"m": t, "month": month_name(t), "reg": "strong" if strong else "other", "reg3": round(reg3, 4), "n": len(cards), "calib": calib_mode, "cells": cells})
        if (t - START_M) % 6 == 0:
            log(f"  plans through {month_name(t)} ({time.time() - t0:.0f}s)")
    log(f"replayed {len(months)} months ({time.time() - t0:.0f}s)")
    return months, cards_used, m_last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards", help="folder with pc/<shard>.bin from the live branch")
    ap.add_argument("--snapshots", default="snapshots")
    ap.add_argument("--catalog")
    ap.add_argument("--calib", default="forecast_calib.json")
    ap.add_argument("--out", default="forecast_hist.bin")
    ap.add_argument("--password", default=os.environ.get("SITE_PASSWORD", ""))
    ap.add_argument("--hist-json", help="a decrypted shard dump instead of --shards (tests)")
    a = ap.parse_args()
    if not a.password:
        raise SystemExit("SITE_PASSWORD is not set")
    t0 = time.time()
    if not a.shards and not a.hist_json:
        raise SystemExit("--shards (or --hist-json) is needed")
    hist = json.load(open(a.hist_json)) if a.hist_json else F.read_shards(a.shards, a.password)
    cat = F.read_catalog(a.catalog or F.latest_snapshot(a.snapshots), a.password)
    print(f"history: {len(hist):,} cards; catalog: {len(cat):,} rows ({time.time() - t0:.0f}s)")
    df = F.panel(hist, cat)
    df, mk = F.features(df)
    print(f"panel: {len(df):,} card-months to {month_name(int(df['m'].max()))} ({time.time() - t0:.0f}s)")
    static_calib = json.load(open(a.calib))
    months, cards_used, m_last = replay(df, mk, cat, static_calib)
    doc = {"t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "made": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
           "from": month_name(START_M), "to": month_name(m_last), "last_month": month_name(m_last),
           "consts": {"fees": fm.STD_FEES, "inputs": fm.STD_INPUTS, "band": BAND, "supply_frac": SUPPLY_FRAC, "refit_every": REFIT_EVERY, "min_calib_months": MIN_CALIB_MONTHS, "mc_n": MC_N, "start": month_name(START_M)},
           "caps": list(fm.STD_CAPS), "holds": list(F.HORIZONS), "discs": list(fm.STD_DISCS),
           "cards": {str(k): list(v) for k, v in cards_used.items()}, "months": months}
    doc = F.clean(doc)
    raw = __import__("gzip").compress(json.dumps(doc, separators=(",", ":"), allow_nan=False).encode("utf-8"))
    open(a.out, "wb").write(F.encrypt_live(raw, a.password))
    with_buys = sum(1 for mo in months for c in mo["cells"].values() if c["picks"])
    print(f"published {len(months)} months, {with_buys} plans with buys, to {a.out} ({os.path.getsize(a.out):,} bytes, {time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
