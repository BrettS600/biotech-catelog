#!/usr/bin/env python3
"""forecast_hist.py - the Forecast history tab's replay (Brett, 2026-10-23: "a forecast history tab ... for a 1-month
hold, 3-month hold, 6-month hold for $500 ... $25,000 ... price range held constant ($50 to $500), fees 14.1% + $5.20
with 0% buy tax, I buy at 0% under the standard price held constant [and 20% under], Buy only at 50% or better ...
if i wanted to see how much I would have made in March 2025 with a $5000 investment in the card purchase
recommendation for that particular month"). Version 2 (2026-10-24): the reversal rank, the regime gate and the
empirical chance tables of forecast.py v2 (data/research/FINDINGS.md).

WHAT IT DOES. The Forecast tab, month by month, the honest way: for every month since January 2022 every card is
ranked by how far it sits below its own 12-month mean (the same rank the live tab uses, which needs no fitting), the
market regime is read, the chance tables (the realized gross return per hold x regime x rank bucket) are built from
the outcomes known by then, and the tab's plan is run at the standard constants for every capital x hold x discount -
one copy per card, bought only when the market is rising - then scored with PriceCharting's price when the hold is
up. A gated month (falling market) records what the ungated plan would have made, so the gate's value can be read
off. There is no eBay history before October 2026, so here the standard price is PriceCharting's price (max of the
month's print and its 3-month average, like the model's own buy_real) and the sale is PriceCharting's price h months
later; the supply cap is a quarter of the month's PriceCharting sales. The live plans the collector archives each
month (live.fc_auto, with eBay's floors and medians) are the other half of the tab.

RUN (the Forecast history workflow, monthly; ~2 minutes):
  python forecast_hist.py --shards live_pc/pc --snapshots snapshots --calib forecast_calib.json --out forecast_hist.bin
The output is gzip(JSON) encrypted with the live key, like forecast.bin:
  {t, made, model, format, from, to, last_month, consts, caps, holds, discs, free, cards {cid: [name, set]},
   months [{m, month, reg, reg3, reg1, n, calib, cells {"h|disc|cap": {n_elig, best, gated, picks [[cid, qty, buy, mean, y]],
   copies, spent, exp, lo, hi, p, actual, roi, inside, done, forced_roi, forced_n}},
   cards {id [...], buy [...], pct [...], sup [...], y1 [...], y3 [...], y6 [...]}, tables {"h|bucket": {q, mean, p_up, n}, "h|all": ...}}]}

FORMAT 2 (2026-10-24, Brett: "would it be possible to have this as a variable ... the investment, as well as the bought
under"): besides the 30 standard cells, every month carries its INGREDIENTS - the candidate cards of the plan (in the
band, six sales in twelve months, a set two years old: id, the buy price to the cent, the rank to four decimals, the
supply cap, the realized return per hold to four decimals) and the month's chance tables for its regime - so the page
can run the plan itself for any capital and any discount (the Forecast History tab's two inputs) with the same
arithmetic (page/app.js fhCompute = forecast_math.plan + monte_carlo + actual_net). The standard cells are computed from
the same rounded figures, so the page's recomputation of a standard cell equals the file's (ut/test_fh2.py checks).
"""
import argparse, json, math, os, sys, time
from datetime import datetime, timezone
import numpy as np
import pandas as pd

import forecast as F
import forecast_math as fm

START_M = 264                # 2022-01: the first month scored (a full year of history behind the first rank)
SUPPLY_FRAC = 0.25           # copies the plan may buy: this share of the month's PriceCharting sales (at least one)
MIN_CALIB_MONTHS = 12        # months of out-of-sample outcomes before the expanding tables replace the static ones
MC_N = 2000                  # Monte Carlo draws per plan (the page uses 3,000; the replay has ~1,700 plans)
BAND = (50.0, 500.0)
QS = F.QS
MIN_AGE = 24                 # the standard plan's "sets two years old" (STD_INPUTS young=False)
FREE = {"cap": [100, 1000000], "disc": [0.0, 0.6]}   # what the page lets the capital and the discount be (format 2)
FORMAT = 2


def month_name(m):
    return F.month_name(m)


def calib_tables(P, h, t):
    """The expanding calibration: the realized-return quantile grid per regime x bucket from the ranked card-months
    whose outcome is known by month t (decision month <= t - h). None when too few months are in."""
    Q = P[(P["m"] <= t - h) & P[f"y{h}"].notna()]
    if Q.empty or Q["m"].nunique() < MIN_CALIB_MONTHS:
        return None
    Q = Q.assign(y=Q[f"y{h}"].clip(*F.CALIB_CLIP), reg=np.where(Q["reg3"] > 0, "up", "down"), b=F.bucket_of(Q["pct"].values))
    tables = {}
    for (reg, b), s in Q.groupby(["reg", "b"]):
        if len(s) < F.MIN_CELL:
            continue
        tables[f"{h}|{reg}|{b}"] = {"n": int(len(s)), "mean": round(float(s["y"].mean()), 4), "q": [round(float(s["y"].quantile(q)), 4) for q in QS], "p_up": round(float((s["y"] > 0).mean()), 3)}
    tables[f"{h}|all|all"] = {"n": int(len(Q)), "mean": round(float(Q["y"].mean()), 4), "q": [round(float(Q["y"].quantile(q)), 4) for q in QS], "p_up": round(float((Q["y"] > 0).mean()), 3)}
    return tables


def replay(df, mk, cat, static_calib, log=print):
    """Rank every month (the rank needs no fitting), then run the standard plans per month."""
    t0 = time.time()
    m_last = int(df["m"].max())
    names = {int(r.id): (str(r.card), str(r.set)) for r in cat.itertuples(index=False)}
    for h in F.HORIZONS:                                     # the realized gross return of buying at buy_real and selling at PriceCharting's price h months on
        df[f"y{h}"] = F.targets(df, h)
    ranked = df[df["pct"].notna() & (df["m"] >= START_M)].copy()
    log(f"ranked {len(ranked):,} card-months, {month_name(START_M)} to {month_name(m_last)} ({time.time() - t0:.0f}s)")
    months, cards_used = [], {}
    for t in range(START_M, m_last + 1):
        S = ranked[ranked["m"] == t]
        if S.empty:
            continue
        R = F.regime_doc(mk, t)
        regw = "up" if R["up"] else "down"
        tables, calib_mode = {}, "expanding"
        for h in F.HORIZONS:
            tb = calib_tables(ranked, h, t)
            if tb is None:
                calib_mode = "static"
                tables.update({k: v for k, v in static_calib["tables"].items() if k.startswith(f"{h}|")})
            else:
                tables.update(tb)
        cards, stubs, ys = {}, {}, {h: {} for h in F.HORIZONS}
        ing = {"id": [], "buy": [], "pct": [], "sup": []}       # the page's ingredients (format 2), ascending id = S's order
        for h in F.HORIZONS:
            ing[f"y{h}"] = []
        for r in S.itertuples(index=False):
            buy = r.price if pd.isna(r.buy_real) else r.buy_real
            buy = round(float(buy), 2)                          # to the cent, the rank to four decimals, the return to four: the figures the page gets
            if not (BAND[0] <= buy <= BAND[1]):
                continue
            cid = int(r.id)
            pct = round(float(r.pct), 4); b = str(F.bucket_of(np.array([pct]))[0])
            age = None if pd.isna(r.age) else int(r.age)
            vol = 0 if pd.isna(r.vol) else int(r.vol)
            vol12 = None if pd.isna(r.vol12) else int(r.vol12)
            preds = []
            for h in F.HORIZONS:
                tb = tables.get(f"{h}|{regw}|{b}")
                preds += [None if tb is None else tb["mean"], pct]
            cards[str(cid)] = [float(r.price), buy] + preds + \
                [None, None, None, age, vol, vol12, None, None,
                 None if pd.isna(r.dev12) else float(r.dev12), None if pd.isna(r.m12) else float(r.m12)]
            sup = max(1, int(vol * SUPPLY_FRAC))
            stubs[str(cid)] = {"supply": sup}
            yy = {}
            for h in F.HORIZONS:
                y = getattr(r, f"y{h}")
                yy[h] = ys[h][cid] = None if pd.isna(y) else round(float(y), 4)
            if (vol12 or 0) >= fm.MIN_VOL12 and age is not None and age >= MIN_AGE:   # the plan's own fixed filters: only these cards can be picked
                ing["id"].append(cid); ing["buy"].append(buy); ing["pct"].append(pct); ing["sup"].append(sup)
                for h in F.HORIZONS:
                    ing[f"y{h}"].append(yy[h])
        doc = {"cols": F.COLS, "cards": cards, "calib": {"quantiles": QS, "tables": tables}, "regime": R, "month": month_name(t), "model": F.VERSION}
        month_tables = {}                                     # the tables the plan reads this month: the regime's per bucket, and the all-cards fallback
        for h in F.HORIZONS:
            for b in F.BUCKETS:
                if f"{h}|{regw}|{b}" in tables:
                    month_tables[f"{h}|{b}"] = tables[f"{h}|{regw}|{b}"]
            if f"{h}|all|all" in tables:
                month_tables[f"{h}|all"] = tables[f"{h}|all|all"]
        cells = {}
        for h in F.HORIZONS:
            done = t + h <= m_last
            for disc in fm.STD_DISCS:
                for cap in fm.STD_CAPS:
                    I = dict(fm.STD_INPUTS, cap=float(cap), h=h, disc=disc)
                    P = fm.plan(doc, stubs, fm.STD_FEES, I, BAND, 5, names)
                    picks = P["picks"]
                    mc = fm.monte_carlo(QS, picks, fm.STD_FEES, disc, n=MC_N) if picks else None
                    actual = fm.actual_net(picks, fm.STD_FEES, disc, lambda cid: ys[h].get(cid)) if picks and done else None
                    cell = {"n_elig": sum(1 for r in P["rows"] if r["p"] >= I["minp"]), "best": round(max((r["p"] for r in P["rows"]), default=0.0), 3), "gated": P["gated"],
                            "picks": [[r["cid"], r["qty"], round(r["buy"], 2), round(r["mean"], 2), None if ys[h].get(r["cid"]) is None else round(ys[h][r["cid"]], 4)] for r in picks],
                            "copies": sum(r["qty"] for r in picks), "spent": round(P["spent"], 2), "done": done}
                    if mc:
                        cell.update({"exp": round(mc["mean"], 2), "lo": round(mc["lo"], 2), "hi": round(mc["hi"], 2), "p": round(mc["p"], 3)})
                    if actual is not None:
                        cell.update({"actual": round(actual, 2), "roi": round(actual / P["spent"], 4) if P["spent"] else None, "inside": bool(mc["lo"] <= actual <= mc["hi"])})
                    if not picks and done:                   # what buying anyway would have made: the ungated plan (a gated month), else the top-ranked cards with no bar
                        P0 = fm.plan(doc, stubs, fm.STD_FEES, dict(I, gate=False, minp=I["minp"] if P["gated"] else 0.0), BAND, 5, names)
                        a0 = fm.actual_net(P0["picks"], fm.STD_FEES, disc, lambda cid: ys[h].get(cid)) if P0["picks"] else None
                        cell["forced_roi"] = round(a0 / P0["spent"], 4) if a0 is not None and P0["spent"] else None
                        cell["forced_n"] = len(P0["picks"])
                    for r in picks:
                        cards_used[r["cid"]] = names.get(r["cid"], ("", ""))
                    cells[f"{h}|{disc:g}|{cap}"] = cell
        months.append({"m": t, "month": month_name(t), "reg": regw, "reg3": R["reg3"], "reg1": R["reg1"], "n": len(cards), "calib": calib_mode, "cells": cells,
                       "cards": ing, "tables": month_tables})
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
    df = F.rank(df)
    print(f"panel: {len(df):,} card-months to {month_name(int(df['m'].max()))} ({time.time() - t0:.0f}s)")
    static_calib = json.load(open(a.calib)) if os.path.exists(a.calib) else F.calib(df, int(df["m"].max()) - 1)
    if static_calib.get("buckets") != list(F.BUCKETS):     # a version-1 file: rebuild the fallback from the data
        static_calib = F.calib(df, int(df["m"].max()) - 1)
    months, cards_used, m_last = replay(df, mk, cat, static_calib)
    doc = {"t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "made": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "model": F.VERSION, "format": FORMAT,
           "from": month_name(START_M), "to": month_name(m_last), "last_month": month_name(m_last), "m_last": int(m_last),
           "consts": {"fees": fm.STD_FEES, "inputs": fm.STD_INPUTS, "band": BAND, "supply_frac": SUPPLY_FRAC, "min_calib_months": MIN_CALIB_MONTHS, "mc_n": MC_N, "start": month_name(START_M), "rank": static_calib.get("rank"), "regime": static_calib.get("regime"),
                      "quantiles": QS, "min_vol12": fm.MIN_VOL12, "min_age": MIN_AGE, "p_cap": fm.P_CAP, "rho": fm.RHO},
           "caps": list(fm.STD_CAPS), "holds": list(F.HORIZONS), "discs": list(fm.STD_DISCS), "free": FREE,
           "cards": {str(k): list(v) for k, v in cards_used.items()}, "months": months}
    doc = F.clean(doc)
    raw = __import__("gzip").compress(json.dumps(doc, separators=(",", ":"), allow_nan=False).encode("utf-8"))
    open(a.out, "wb").write(F.encrypt_live(raw, a.password))
    with_buys = sum(1 for mo in months for c in mo["cells"].values() if c["picks"])
    gated = sum(1 for mo in months if mo["reg"] == "down")
    n_ing = sum(len(mo["cards"]["id"]) for mo in months)
    print(f"published {len(months)} months ({gated} gated), {with_buys} plans with buys, {n_ing:,} candidate card-months for the page's own plans, to {a.out} ({os.path.getsize(a.out):,} bytes, {time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
