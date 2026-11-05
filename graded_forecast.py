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


def _prep(cd, today=None):
    """The matrices both builds use: prices W, buy (max of the price and its 3-month average), the rank pct and group,
    the market (reg1 / reg3 / breadth3 / fwd3), the month "now" and the last complete month."""
    got = load_lines(cd)
    if got is None:
        return None
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
    grp = np.minimum(GROUPS - 1, np.floor(np.nan_to_num(pct, nan=-1) * GROUPS)).astype(int)
    return dict(keys=keys, W=W, m0=m0, T=T, buy=buy, pct=pct, grp=grp, reg1=reg1, reg3=reg3, breadth3=breadth3, fwd3=fwd3,
                nreg=nreg, j_now=j_now, j_last=j_last, j_start=j_start, dev12=dev12)


def _pairs(P, h):
    """Every (decision month, group, regime, realized return) of the ranked lines for a hold of h months."""
    W, buy, pct, grp, reg3 = P["W"], P["buy"], P["pct"], P["grp"], P["reg3"]
    Ms, Ys, Gs, Rs = [], [], [], []
    for j in range(P["j_start"], P["j_last"] - h + 1):
        with np.errstate(invalid="ignore", divide="ignore"):
            y = W[:, j + h] / buy[:, j] - 1
        sel = np.isfinite(y) & np.isfinite(pct[:, j])
        if not sel.any() or not np.isfinite(reg3[j]):
            continue
        n = int(sel.sum())
        Ms.append(np.full(n, j)); Ys.append(np.clip(y[sel], *CLIP)); Gs.append(grp[sel, j]); Rs.append(np.full(n, reg3[j] > 0))
    if not Ys:
        return None
    return np.concatenate(Ms), np.concatenate(Gs), np.concatenate(Rs), np.concatenate(Ys)


def build(cd, keep_ids=None, today=None):
    t0 = datetime.now(timezone.utc)
    P = _prep(cd, today)
    if P is None:
        return {"err": "no pc_graded_monthly files in card-data"}
    keys, W, m0, T, pct = P["keys"], P["W"], P["m0"], P["T"], P["pct"]
    reg1, reg3, breadth3, fwd3, nreg = P["reg1"], P["reg3"], P["breadth3"], P["fwd3"], P["nreg"]
    j_now, j_last, j_start = P["j_now"], P["j_last"], P["j_start"]
    # the odds tables
    tables = {}
    for h in HORIZONS:
        got = _pairs(P, h)
        if got is None:
            continue
        _, G, R, Y = got
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



# ---------------- the replay (2026-11-04, Brett: the graded Forecast History - "known-at-the-time", all six holds) ----------------
HIST_QS = [round(i / 20, 2) for i in range(1, 20)]    # the replay's odds grids: 5% .. 95% (smaller file)
HIST_K = (8, 24)                                      # candidates kept per month per group and line, deepest first: groups 1-5 / 6-10 of the rank
HIST_BAND = (50.0, 5000.0)                            # the replay's candidates: buy price inside the page's default band
HIST_MIN = 30                                         # an odds cell needs this many realized cases, else the whole-period cell
RQ = [round(i / 100, 2) for i in range(1, 100)]       # the rank's cut points kept per month (Pre-Sales Spotcheck, 2026-11-05)


def build_hist(cd, keep_ids=None, today=None):
    """graded_hist.bin: for every month from 2022-01 to the last complete month, the odds each group would have shown
    THAT month (the realized returns of the decision months whose hold was over by then - in 2022, too few, so the whole
    period's tables are used, marked first) for holds 1-6 in that month's market, and the month's best-ranked lines of
    each group and line in the $50 - $5,000 band with what they went on to do: [card id, line (index into lines), standard
    price, rank x 1000, return after 1..6 months x 1000 (null while not over)]; and each month's rank cut points (rq: the
    1st .. 99th percentile of -dev12, x 10000, over the rqn lines ranked), so the page can rank any slab from its own line.
    The page runs the plan for each month with Graded Forecasting's capital, % under and the other boxes."""
    P = _prep(cd, today)
    if P is None:
        return {"err": "no pc_graded_monthly files in card-data"}
    keys, W, m0, buy, pct, grp, reg3 = P["keys"], P["W"], P["m0"], P["buy"], P["pct"], P["grp"], P["reg3"]
    j_start, j_last, dev12 = P["j_start"], P["j_last"], P["dev12"]
    keep = None if keep_ids is None else {int(k) for k in keep_ids}
    cid = keys["card_id"].astype(int).values
    lix = keys["line"].map({l: i for i, l in enumerate(LINES)}).values
    kept = np.ones(len(cid), dtype=bool) if keep is None else np.isin(cid, list(keep))
    first_honest = max(j_start, _mi("2023-01") - m0)
    cells = {}                                        # (h, reg, g) -> (decision months sorted, returns in that order)
    whole = {}
    for h in HORIZONS:
        got = _pairs(P, h)
        if got is None:
            continue
        M, G, R, Y = got
        for reg in (True, False):
            for g in range(GROUPS):
                sel = (R == reg) & (G == g)
                o = np.argsort(M[sel], kind="stable")
                cells[(h, reg, g)] = (M[sel][o], Y[sel][o])
                if sel.sum() >= HIST_MIN:
                    whole[(h, reg, g)] = Y[sel]
    def grid(y):
        return [round(float(y.mean()), 4)] + [round(float(v), 4) for v in np.quantile(y, HIST_QS)]
    months, ups, regs, firsts, tabs, cands, rqs, rqn = [], [], [], [], [], [], [], []
    for j in range(j_start, j_last + 1):
        if not np.isfinite(reg3[j]):
            continue
        up = bool(reg3[j] > 0)
        # the rank's cut points that month (Pre-Sales Spotcheck, 2026-11-05: the page ranks any slab from its own price
        # line): the 1st .. 99th percentile of -dev12 among the lines it ranked ($25+, a full year of prices), x 10000
        with np.errstate(invalid="ignore"):
            okr = (W[:, j] >= RANK_MIN_PRICE) & np.isfinite(dev12[:, j])
        v = -dev12[okr, j]
        rqs.append([int(round(float(x) * 10000)) for x in np.quantile(v, RQ)] if v.size else None); rqn.append(int(v.size))
        tab = []
        for h in HORIZONS:
            row = []
            for g in range(GROUPS):
                c = cells.get((h, up, g))
                y = None
                if j >= first_honest and c is not None:
                    k = int(np.searchsorted(c[0], j - h, side="right"))   # decided at least h months before j: over by j
                    if k >= HIST_MIN:
                        y = c[1][:k]
                if y is None and (h, up, g) in whole:
                    y = whole[(h, up, g)]
                row.append(grid(y) if y is not None else None)
            tab.append(row)
        # the candidates: each group's deepest-ranked lines of the month in the band, on the site's cards
        ok = kept & np.isfinite(pct[:, j]) & (buy[:, j] >= HIST_BAND[0]) & (buy[:, j] <= HIST_BAND[1])
        out = []
        for g in range(GROUPS):
            for li in range(len(LINES)):
                idx = np.where(ok & (grp[:, j] == g) & (lix == li))[0]
                idx = idx[np.argsort(-pct[idx, j])][:HIST_K[1] if g >= GROUPS // 2 else HIST_K[0]]
                for i in idx:
                    ys = []
                    for h in HORIZONS:
                        if j + h > j_last or not np.isfinite(W[i, j + h]):
                            ys.append(None)
                        else:
                            ys.append(int(round(float(np.clip(W[i, j + h] / buy[i, j] - 1, *CLIP)) * 1000)))
                    out.append([int(cid[i]), li, round(float(buy[i, j]), 2), int(round(float(pct[i, j]) * 1000))] + ys)
        months.append(_ym(m0 + j)); ups.append(1 if up else 0); regs.append(round(float(reg3[j]), 4)); firsts.append(1 if j < first_honest else 0); tabs.append(tab); cands.append(out)
    return {"model": VERSION, "t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "qs": HIST_QS, "lines": LINES,
            "groups": GROUPS, "horizons": list(HORIZONS), "band": list(HIST_BAND), "k": list(HIST_K), "yscale": 1000, "last": _ym(m0 + j_last),
            "months": months, "up": ups, "reg3": regs, "first": firsts, "tab": tabs, "cands": cands,
            "rqs": RQ, "rq": rqs, "rqn": rqn, "rank_min": RANK_MIN_PRICE}


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
