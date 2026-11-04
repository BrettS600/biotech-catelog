#!/usr/bin/env python3
"""graded_forecast.py - the model behind the Forecast tab's Graded cards > Forecasting page (2026-11-04).

Brett: "lets just use the same predictive model but on the graded cards"; "its okay if its flawed because we will fix
it later. i just want to see the listings populate"; "the green circle ... have it show all 6 months".

THE SAME METHOD AS THE RAW MODEL (forecast.py, version 2), run on PriceCharting's monthly graded chart lines
(card-data pricecharting/pc_graded_monthly_<year>.csv.gz: PSA 10, Grade 9.5, 9, 8 and 7, one value a month since
2021) instead of the ungraded price:
  - the rank: how far a line's price sits below its own 12-month mean (dev12), as a percentile among every graded line
    priced $25+ with a full year of prices that month - deepest below = 1.0. Ten groups (deciles; raw uses four), so
    the order of the list means more.
  - the market: the monthly move of graded lines priced $10+ the month before, "up" when its trailing 3-month mean is
    above zero (the raw model's rule). One change: the raw model takes the month's MEDIAN move, but PriceCharting's
    graded value does not move at all for about 4 lines in 10 in a month, so the median was 0 in every month since 2021
    and the market would always read "down". The graded market is the MEAN move (each line's clipped to +-50%): from
    2022 on, when its 3-month figure was positive the next quarter was up 79% of the time (28 months), when negative
    26% (27 months) - the raw rule's 95% / 12% is sharper. The page states the measured figures (regime.p_next).
  - the odds: the realized return of buying at max(price, 3-month average) and selling at PriceCharting's price h
    months on, h = 1 .. 6, by regime x group, decision months 2022-01 .. the last complete month - h; a quantile grid
    (1 .. 99%), the mean, how often it was up.
Known flaws (to fix with the graded model to come): PriceCharting's Grade 7 / 8 / 9 / 9.5 lines blend every grader
(PSA, CGC, BGS ...); grades with no line of their own (CGC 10, PSA 8.5, grades 1-6) get no score; the history has no
sales counts, so the raw model's "six sales a year" filter is a full year of prices instead.

Called by graded_site.py (build), which puts the result in graded.bin as doc["fc"]; the page reads it in
page/graded_fc.js."""
import glob, os
from datetime import datetime, timezone
import numpy as np
import pandas as pd

VERSION = "graded v1 (the raw model's method on PriceCharting's graded lines) 2026-11-04"
LINES = ["psa_10", "grade_9_5", "grade_9", "grade_8", "grade_7"]
HORIZONS = (1, 2, 3, 4, 5, 6)
RANK_MIN_PRICE = 25.0
REGIME_MIN_PRICE = 10.0
REGIME_CLIP = 0.5
CALIB_START = "2022-01"
CLIP = (-0.95, 5.0)
QS = [round(i / 100, 2) for i in range(1, 100)]
GROUPS = 10
MIN_CELL = 30


def _mi(ym):
    y, m = str(ym)[:7].split("-")
    return int(y) * 12 + int(m) - 1


def _ym(mi):
    return f"{mi // 12}-{mi % 12 + 1:02d}"


def load_lines(cd):
    """{(card id, line): monthly prices} as a matrix: W[line row, month column], NaN where PriceCharting has none."""
    fs = sorted(glob.glob(os.path.join(cd, "pricecharting", "pc_graded_monthly_*.csv.gz")))
    if not fs:
        return None
    d = pd.concat([pd.read_csv(f, usecols=lambda c: c in ["card_id", "month"] + LINES) for f in fs], ignore_index=True)
    d["mi"] = d["month"].map(_mi)
    d = d.drop_duplicates(["card_id", "mi"], keep="last")
    m0, m1 = int(d["mi"].min()), int(d["mi"].max())
    long = d.melt(id_vars=["card_id", "mi"], value_vars=[c for c in LINES if c in d.columns], var_name="line", value_name="p")
    long = long[pd.to_numeric(long["p"], errors="coerce") > 0]
    long["p"] = long["p"].astype(float)
    keys = long[["card_id", "line"]].drop_duplicates().reset_index(drop=True)
    keys["row"] = np.arange(len(keys))
    long = long.merge(keys, on=["card_id", "line"])
    W = np.full((len(keys), m1 - m0 + 1), np.nan)
    W[long["row"].values, (long["mi"] - m0).values] = long["p"].values
    return keys, W, m0


def _roll(W, k, need):
    """Rolling mean over k months ending at each column, NaN unless at least `need` of them have a price."""
    v = ~np.isnan(W)
    z = np.where(v, W, 0.0)
    cs = np.concatenate([np.zeros((W.shape[0], 1)), np.cumsum(z, axis=1)], axis=1)
    cn = np.concatenate([np.zeros((W.shape[0], 1)), np.cumsum(v, axis=1)], axis=1)
    out = np.full(W.shape, np.nan)
    for j in range(W.shape[1]):
        a = max(0, j - k + 1)
        s, n = cs[:, j + 1] - cs[:, a], cn[:, j + 1] - cn[:, a]
        ok = (n >= need) & (j - a + 1 == k if need == k else True)
        out[ok, j] = s[ok] / n[ok]
    return out


def build(cd, keep_ids=None, today=None):
    t0 = datetime.now(timezone.utc)
    got = load_lines(cd)
    if got is None:
        return {"err": "no pc_graded_monthly files in card-data"}
    keys, W, m0 = got
    T = W.shape[1]
    m12 = _roll(W, 12, 12)
    p3 = _roll(W, 3, 2)
    buy = np.where(np.isnan(p3), W, np.fmax(W, p3))                      # you cannot buy at a print that just dipped
    with np.errstate(invalid="ignore", divide="ignore"):
        dev12 = W / m12 - 1
        prev = np.concatenate([np.full((W.shape[0], 1), np.nan), W[:, :-1]], axis=1)
        mom1 = W / prev - 1
    # the rank: percentile of -dev12 among the month's lines $25+ with a full year of prices
    ok = (W >= RANK_MIN_PRICE) & np.isfinite(dev12)
    pct = pd.DataFrame(np.where(ok, -dev12, np.nan)).rank(axis=0, pct=True).values
    # the market: the mean monthly move (each clipped to +-50%) of lines priced $10+ the month before - see the top
    reg1 = np.full(T, np.nan); breadth = np.full(T, np.nan); nreg = np.zeros(T, dtype=int)
    for j in range(1, T):
        u = (prev[:, j] >= REGIME_MIN_PRICE) & np.isfinite(mom1[:, j])
        if u.sum() >= 50:
            x = mom1[u, j]
            reg1[j] = float(np.clip(x, -REGIME_CLIP, REGIME_CLIP).mean()); breadth[j] = float((x > 0).mean()); nreg[j] = int(u.sum())
    reg3 = pd.Series(reg1).rolling(3).mean().values
    breadth3 = pd.Series(breadth).rolling(3).mean().values
    fwd3 = pd.Series(reg1).shift(-1).rolling(3).sum().shift(-2).values          # the market's next three months
    # the latest month, and the last complete one (the current calendar month is still filling in). The newest column
    # can hold only the few lines read so far this month (2026-11-04, first live run: 881 of ~150,000): "now" is the
    # newest month with at least half the lines of the busiest recent month
    today = today or datetime.now(timezone.utc).date()
    cur = today.year * 12 + today.month - 1
    cnt = np.isfinite(W).sum(axis=0)
    ref = cnt[max(0, T - 13):].max()
    j_now = T - 1
    while j_now > 0 and cnt[j_now] < 0.5 * ref:
        j_now -= 1
    j_last = j_now - 1 if m0 + j_now >= cur else j_now
    j_start = max(0, _mi(CALIB_START) - m0)
    # the odds tables
    tables = {}
    grp = np.minimum(GROUPS - 1, np.floor(np.nan_to_num(pct, nan=-1) * GROUPS)).astype(int)
    for h in HORIZONS:
        Ys, Gs, Rs = [], [], []
        for j in range(j_start, j_last - h + 1):
            with np.errstate(invalid="ignore", divide="ignore"):
                y = W[:, j + h] / buy[:, j] - 1
            sel = np.isfinite(y) & np.isfinite(pct[:, j])
            if not sel.any() or not np.isfinite(reg3[j]):
                continue
            Ys.append(np.clip(y[sel], *CLIP)); Gs.append(grp[sel, j]); Rs.append(np.full(int(sel.sum()), reg3[j] > 0))
        if not Ys:
            continue
        Y, G, R = np.concatenate(Ys), np.concatenate(Gs), np.concatenate(Rs)
        def cell(y):
            return {"n": int(len(y)), "mean": round(float(y.mean()), 4), "p_up": round(float((y > 0).mean()), 3),
                    "q": [round(float(v), 4) for v in np.quantile(y, QS)]}
        for reg, rv in (("up", True), ("down", False)):
            for g in range(GROUPS):
                s = Y[(R == rv) & (G == g)]
                if len(s) >= MIN_CELL:
                    tables[f"{h}|{reg}|{g}"] = cell(s)
        tables[f"{h}|all|all"] = cell(Y)
    # today's rank of every line, for the cards on the site
    keep = None if keep_ids is None else {int(k) for k in keep_ids}
    li = {l: i for i, l in enumerate(LINES)}
    out = {}
    pn = pct[:, j_now]
    for (cid, line), p in zip(keys[["card_id", "line"]].itertuples(index=False, name=None), pn):
        if not np.isfinite(p) or (keep is not None and int(cid) not in keep):
            continue
        out.setdefault(str(int(cid)), [None] * len(LINES))[li[line]] = int(round(float(p) * 1000))
    f = lambda v, nd=4: None if v is None or not np.isfinite(v) else round(float(v), nd)
    hist = [(reg3[j] > 0, fwd3[j] > 0) for j in range(j_start, T) if np.isfinite(reg3[j]) and np.isfinite(fwd3[j])]
    nu = [b for a, b in hist if a]; nd = [b for a, b in hist if not a]
    R = {"reg1": f(reg1[j_now]), "reg3": f(reg3[j_now]), "breadth3": f(breadth3[j_now], 3), "n": int(nreg[j_now]),
         "up": bool(np.isfinite(reg3[j_now]) and reg3[j_now] > 0), "confirm": bool(np.isfinite(reg1[j_now]) and reg1[j_now] > 0),
         "p_next": [round(float(np.mean(nu)), 2) if nu else None, round(float(np.mean(nd)), 2) if nd else None, len(nu), len(nd)]}
    return {"model": VERSION, "t": t0.strftime("%Y-%m-%dT%H:%M:%SZ"), "month": _ym(m0 + j_now), "last": _ym(m0 + j_last),
            "start": CALIB_START, "qs": QS, "lines": LINES, "groups": GROUPS, "horizons": list(HORIZONS), "regime": R,
            "tables": tables, "pct": out, "n_lines": int(W.shape[0]), "n_ranked": int(np.isfinite(pn).sum()),
            "rank_min": RANK_MIN_PRICE}


if __name__ == "__main__":
    import json, sys, time
    t = time.time()
    doc = build(sys.argv[1] if len(sys.argv) > 1 else "card-data/data")
    print(f"{time.time() - t:.0f}s", doc.get("month"), doc.get("last"), doc.get("regime"), doc.get("n_lines"), doc.get("n_ranked"), len(doc.get("tables", {})))
    for h in (1, 3, 6):
        for reg in ("up", "down"):
            c = doc["tables"].get(f"{h}|{reg}|9")
            if c:
                print(h, reg, "deepest 10%: n", c["n"], "median", c["q"][49], "up", c["p_up"], "mean", c["mean"])
    print(len(json.dumps(doc, separators=(",", ":"))) / 1e6, "MB json")
