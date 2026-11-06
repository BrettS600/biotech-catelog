#!/usr/bin/env python3
"""graded_forecast.py - the model behind the Forecast tab's Graded cards pages (2026-11-04; on Card Ladder 2026-11-05).

Brett, 2026-11-04: "lets just use the same predictive model but on the graded cards". 2026-11-05: "Moving forward card
ladder will be used as the primary reference point, and PC will be there to confirm matching"; "id rather keep PC out
completely of forcast, but only as it applies to the calculations". So the model now runs on Card Ladder's own sales of
each card's grade (card-data data/cardladder/lines, read by cl_sales.py) - PriceCharting plays no part in it. A card is
in the model once the Card Ladder run has read its page (decision 2: no PriceCharting fallback while it waits) and it
has not been answered "Not the same card".

A LINE is one card at one PSA or CGC grade (every grade, each grader apart - no blended "Grade 9"; CGC 10 Pristine and
CGC 10 are separate lines). Month by month, from its sales (no qualifier / autograph sales):
  - the price THEN (the standard price on a month grid): the Hodges-Lehmann middle of the month's sales, needing 3; with
    fewer, the last two months', then three (the page's 30 / 60 / 90 days, in months). After the page's last read the
    line's months are unknown (not "no sales").
  - the 12-month level: the median of its monthly prices (the median of each month's sales) over the 12 months to then.
  - the rank: how far the price then sits below the 12-month level (dev12), as a percentile among every line priced
    $25+ with at least FLOOR sales in its last 12 months - deepest below = 1.0. Ten groups.
  - the market: the mean monthly move (each clipped to +-50%) of the lines with 3+ sales in both months and priced $10+
    the month before; "up" when its trailing 3-month mean is above zero. The page states how often the next quarter
    followed (regime.p_next).
  - the odds: the realized return of buying at the price then (or the 3-month price, whichever is higher - you cannot
    count on buying at a month that just dipped) and selling at the price h months on, h = 1 .. 6, by market x group,
    decision months 2022-01 .. the last complete month - h: a quantile grid (1 .. 99%), the mean, how often it was up.
    MEASURED AT FOUR SALES LEVELS (Brett, 2026-11-05: a Card Ladder min-sales filter "later"): tables = lines with 3+
    sales in their last 12 months (the floor), tiers["6"] / ["12"] / ["24"] = only those with that many - the page uses
    the level matching its filter, so the Chance shown is measured on lines like the ones bought.
  - TODAY's rank of each listed line: its standard price as of the page's last read (cl_sales.standard: 30 / 60 / 90
    days) against its 12-month level then, among the lines read.

Called by graded_site.py (build), which puts the result in graded.bin as doc["fc"] and the replay in graded_hist.bin;
the page reads them in page/graded_fc.js and page/graded_fh.js."""
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

import cl_sales

VERSION = "graded v2 (Card Ladder's own sales) 2026-11-05"
LINES = (["psa|g10", "psa|g9", "psa|g8_5", "psa|g8", "psa|g7", "psa|g6", "psa|g5", "psa|g4", "psa|g3", "psa|g2",
          "psa|g1_5", "psa|g1"] +
         ["cgc|g10perfect", "cgc|g10pristine", "cgc|g10", "cgc|g9_5", "cgc|g9", "cgc|g8_5", "cgc|g8", "cgc|g7_5",
          "cgc|g7", "cgc|g6_5", "cgc|g6", "cgc|g5_5", "cgc|g5", "cgc|g4_5", "cgc|g4", "cgc|g3_5", "cgc|g3", "cgc|g2_5",
          "cgc|g2", "cgc|g1_5", "cgc|g1"])                  # graded_site.GK: the page's grade keys
HORIZONS = (1, 2, 3, 4, 5, 6)
RANK_MIN_PRICE = 25.0
REGIME_MIN_PRICE = 10.0
REGIME_CLIP = 0.5
REGIME_MIN_N = 3                                      # sales in each of the two months behind a line's monthly move
CALIB_START = "2022-01"
CLIP = (-0.95, 5.0)
QS = [round(i / 100, 2) for i in range(1, 100)]
GROUPS = 10
MIN_CELL = 30
FLOOR = 3                                             # sales in the last 12 months for a line to be ranked at all
TIERS = (3, 6, 12, 24)                                # the sales levels the odds are measured at (TIERS[0] = FLOOR)
PRICE_MIN_N = 3                                       # sales behind a price (cl_sales.STD_MIN)


def _mi(ym):
    y, m = str(ym)[:7].split("-")
    return int(y) * 12 + int(m) - 1


def _ym(mi):
    return f"{mi // 12}-{mi % 12 + 1:02d}"


def links(cd, keep_ids=None):
    """{PriceCharting card id: Card Ladder page} for the cards the model may use: matched (data/ids/card_ids.csv), read,
    listed on the site (keep_ids), not answered "Not the same card" for that page (ids/marks.csv, card level)."""
    p = os.path.join(cd, "ids", "card_ids.csv")
    if not os.path.exists(p):
        return {}
    ids = pd.read_csv(p, dtype=str).fillna("")
    if "status" in ids.columns:
        ids = ids[ids["status"].isin(["confirmed", "likely", "review"])]
    keep = None if keep_ids is None else {int(k) for k in keep_ids}
    no = set()
    mp = os.path.join(cd, "ids", "marks.csv")
    if os.path.exists(mp):
        mk = pd.read_csv(mp, dtype=str).fillna("")
        if {"pc", "gk", "v", "t"} <= set(mk.columns):
            mk = mk[mk["gk"] == "card"].copy()
            mk["tn"] = pd.to_numeric(mk["t"], errors="coerce").fillna(0)
            last = {}
            for r in mk.sort_values("tn").to_dict("records"):
                last[str(r["pc"]).split(".")[0]] = r      # the newest answer for the card wins
            for c, r in last.items():
                if str(r.get("v")).split(".")[0] == "0":
                    no.add((c, _page(r.get("profile", ""))))
    out = {}
    for r in ids.to_dict("records"):
        c, pid = r.get("pricecharting_id", ""), r.get("cl_profile_id", "")
        if not c.isdigit() or not pid or (keep is not None and int(c) not in keep):
            continue
        if (c, _page(pid)) in no or (c, "") in no:
            continue
        out[int(c)] = pid
    return out


def _page(pid):
    """matched-<spec> and psa-<spec> are one page."""
    pid = str(pid or "")
    return "psa-" + pid.split("-", 1)[1] if pid.startswith("matched-") else pid


def _pages_by_key(pages):
    return {_page(pid): P for pid, P in pages.items()}


def _prep(cd, keep_ids=None, today=None, pages=None, link=None):
    """The matrices both builds use, one row per line (card x grade): Pn (the price then), buy (max of it and the 3-month
    price), W (the month's median), n12, L12, dev12, the rank pct and group, the market; plus today's live rank."""
    today = today or datetime.now(timezone.utc).date()
    link = links(cd, keep_ids) if link is None else link
    if pages is None:
        pages = cl_sales.load(os.path.join(cd, "cardladder", "lines"))
    byk = _pages_by_key(pages)
    cur = today.year * 12 + today.month - 1
    m0 = _mi(CALIB_START) - 14
    T = cur - m0 + 1
    keys, rows_pn, rows_buy, rows_w, rows_n, rows_known, live = [], [], [], [], [], [], []
    for cid, pid in sorted(link.items()):
        P = byk.get(_page(pid))
        if not P or not P["read"]:
            continue
        read_day = cl_sales.day_no(P["read"])
        read_m = int(cl_sales.month_index(np.array([read_day]))[0])
        for gk, (days, prices) in P["s"].items():
            if gk not in LINES or len(days) < PRICE_MIN_N:
                continue
            mi = cl_sales.month_index(days)
            sel = (mi >= m0) & (mi <= min(cur, read_m))
            mi_, pr = mi[sel] - m0, prices[sel]
            last_j = min(cur, read_m) - m0
            N = np.bincount(mi_, minlength=T).astype(np.float64)[:T]
            starts = np.searchsorted(mi_, np.arange(T + 1))
            Pn = np.full(T, np.nan); B3 = np.full(T, np.nan); Wm = np.full(T, np.nan)
            c3 = np.convolve(N, np.ones(3))[:T]                       # sales in months j-2 .. j
            for j in np.flatnonzero(N > 0):
                Wm[j] = float(np.median(pr[starts[j]:starts[j + 1]]))
            for j in np.flatnonzero(c3 >= PRICE_MIN_N):
                if j > last_j:
                    break
                for k in (0, 1, 2):
                    a = max(0, j - k)
                    if N[a:j + 1].sum() >= PRICE_MIN_N:
                        Pn[j] = cl_sales.hl(pr[starts[a]:starts[j + 1]])
                        break
                a = max(0, j - 2)
                B3[j] = cl_sales.hl(pr[starts[a]:starts[j + 1]])
            known = np.arange(T) <= last_j
            N[~known] = np.nan
            keys.append((cid, gk, read_m - m0))
            rows_pn.append(Pn); rows_buy.append(np.fmax(Pn, np.where(np.isfinite(Pn), B3, np.nan)))
            rows_w.append(Wm); rows_n.append(N); rows_known.append(known)
            std, span, nstd = cl_sales.standard(days, prices, read_day)
            live.append((std, cl_sales.count(days, read_day, 365)))
    if not keys:
        return None
    Pn = np.vstack(rows_pn); buy = np.vstack(rows_buy); W = np.vstack(rows_w); N = np.vstack(rows_n)
    n12 = pd.DataFrame(np.nan_to_num(N, nan=0.0).T).rolling(12, min_periods=1).sum().T.values.copy()
    n12[np.isnan(N)] = np.nan
    L12 = np.full(W.shape, np.nan)
    for j in range(W.shape[1]):
        a = max(0, j - 11)
        blk = W[:, a:j + 1]
        has = np.isfinite(blk).any(axis=1) & (n12[:, j] >= FLOOR)
        if has.any():
            with np.errstate(all="ignore"):
                L12[has, j] = np.nanmedian(blk[has], axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        dev12 = Pn / L12 - 1
    ok = (Pn >= RANK_MIN_PRICE) & np.isfinite(dev12) & (n12 >= FLOOR)
    pct = pd.DataFrame(np.where(ok, -dev12, np.nan)).rank(axis=0, pct=True).values
    grp = np.minimum(GROUPS - 1, np.floor(np.nan_to_num(pct, nan=-1) * GROUPS)).astype(int)
    # the market: the mean monthly move of lines with 3+ sales in both months, priced $10+ the month before
    reg1 = np.full(T, np.nan); breadth = np.full(T, np.nan); nreg = np.zeros(T, dtype=int)
    with np.errstate(invalid="ignore", divide="ignore"):
        mom1 = W[:, 1:] / W[:, :-1] - 1
    for j in range(1, T):
        u = (N[:, j] >= REGIME_MIN_N) & (N[:, j - 1] >= REGIME_MIN_N) & (W[:, j - 1] >= REGIME_MIN_PRICE) & np.isfinite(mom1[:, j - 1])
        if u.sum() >= 50:
            x = mom1[u, j - 1]
            reg1[j] = float(np.clip(x, -REGIME_CLIP, REGIME_CLIP).mean()); breadth[j] = float((x > 0).mean()); nreg[j] = int(u.sum())
    reg3 = pd.Series(reg1).rolling(3).mean().values
    breadth3 = pd.Series(breadth).rolling(3).mean().values
    fwd3 = pd.Series(reg1).shift(-1).rolling(3).sum().shift(-2).values
    j_last = T - 2                                     # the last complete calendar month (this one is still filling in)
    while j_last > 0 and not np.isfinite(reg3[j_last]):
        j_last -= 1
    j_start = _mi(CALIB_START) - m0
    # today's rank: each line's standard price as of its page's last read against its 12-month level then
    kd = pd.DataFrame(keys, columns=["card_id", "line", "j_read"])
    jr = np.clip(kd["j_read"].values, 0, T - 1)
    std_now = np.array([np.nan if s is None else s for s, _ in live], dtype=np.float64)
    n12_now = np.array([n for _, n in live], dtype=np.float64)
    L_now = L12[np.arange(len(kd)), jr]
    with np.errstate(invalid="ignore", divide="ignore"):
        dev_now = std_now / L_now - 1
    ok_now = (std_now >= RANK_MIN_PRICE) & np.isfinite(dev_now) & (n12_now >= FLOOR)
    pct_now = pd.Series(np.where(ok_now, -dev_now, np.nan)).rank(pct=True).values
    return dict(keys=kd, Pn=Pn, buy=buy, W=W, N=N, n12=n12, L12=L12, dev12=dev12, pct=pct, grp=grp, reg1=reg1, reg3=reg3,
                breadth3=breadth3, fwd3=fwd3, nreg=nreg, m0=m0, T=T, j_last=j_last, j_start=j_start,
                std_now=std_now, n12_now=n12_now, dev_now=dev_now, pct_now=pct_now)


def _pairs(P, h, tier=FLOOR):
    """Every (decision month, group, market, realized return) of the ranked lines with tier+ sales in their last 12
    months, for a hold of h months."""
    Pn, buy, pct, grp, reg3, n12 = P["Pn"], P["buy"], P["pct"], P["grp"], P["reg3"], P["n12"]
    Ms, Ys, Gs, Rs = [], [], [], []
    for j in range(P["j_start"], P["j_last"] - h + 1):
        with np.errstate(invalid="ignore", divide="ignore"):
            y = Pn[:, j + h] / buy[:, j] - 1
        sel = np.isfinite(y) & np.isfinite(pct[:, j]) & (n12[:, j] >= tier)
        if not sel.any() or not np.isfinite(reg3[j]):
            continue
        n = int(sel.sum())
        Ms.append(np.full(n, j)); Ys.append(np.clip(y[sel], *CLIP)); Gs.append(grp[sel, j]); Rs.append(np.full(n, reg3[j] > 0))
    if not Ys:
        return None
    return np.concatenate(Ms), np.concatenate(Gs), np.concatenate(Rs), np.concatenate(Ys)


def _cell(y):
    return {"n": int(len(y)), "mean": round(float(y.mean()), 4), "p_up": round(float((y > 0).mean()), 3),
            "q": [round(float(v), 4) for v in np.quantile(y, QS)]}


def _tables(P, tier):
    tables = {}
    for h in HORIZONS:
        got = _pairs(P, h, tier)
        if got is None:
            continue
        _, G, R, Y = got
        for reg, rv in (("up", True), ("down", False)):
            for g in range(GROUPS):
                s = Y[(R == rv) & (G == g)]
                if len(s) >= MIN_CELL:
                    tables[f"{h}|{reg}|{g}"] = _cell(s)
        tables[f"{h}|all|all"] = _cell(Y)
    return tables


def build(cd, keep_ids=None, today=None, pages=None, link=None, P=None):
    t0 = datetime.now(timezone.utc)
    P = P or _prep(cd, keep_ids, today, pages, link)
    if P is None:
        return {"err": "no Card Ladder sales for the listed cards yet (card-data data/cardladder/lines)"}
    kd, m0, T, j_last, j_start = P["keys"], P["m0"], P["T"], P["j_last"], P["j_start"]
    reg1, reg3, breadth3, fwd3, nreg = P["reg1"], P["reg3"], P["breadth3"], P["fwd3"], P["nreg"]
    tables = _tables(P, TIERS[0])
    tiers = {str(t): _tables(P, t) for t in TIERS[1:]}
    li = {l: i for i, l in enumerate(LINES)}
    out = {}
    for (cid, line), p in zip(kd[["card_id", "line"]].itertuples(index=False, name=None), P["pct_now"]):
        if np.isfinite(p):
            out.setdefault(str(int(cid)), {})[str(li[line])] = int(round(float(p) * 1000))
    f = lambda v, nd=4: None if v is None or not np.isfinite(v) else round(float(v), nd)
    hist = [(reg3[j] > 0, fwd3[j] > 0) for j in range(j_start, T) if np.isfinite(reg3[j]) and np.isfinite(fwd3[j])]
    nu = [b for a, b in hist if a]; ndn = [b for a, b in hist if not a]
    R = {"reg1": f(reg1[j_last]), "reg3": f(reg3[j_last]), "breadth3": f(breadth3[j_last], 3), "n": int(nreg[j_last]),
         "up": bool(np.isfinite(reg3[j_last]) and reg3[j_last] > 0), "confirm": bool(np.isfinite(reg1[j_last]) and reg1[j_last] > 0),
         "p_next": [round(float(np.mean(nu)), 2) if nu else None, round(float(np.mean(ndn)), 2) if ndn else None, len(nu), len(ndn)],
         "month": _ym(m0 + j_last)}
    return {"model": VERSION, "src": "cl", "t": t0.strftime("%Y-%m-%dT%H:%M:%SZ"), "month": _ym(m0 + j_last), "last": _ym(m0 + j_last),
            "start": CALIB_START, "qs": QS, "lines": LINES, "groups": GROUPS, "horizons": list(HORIZONS), "regime": R,
            "tables": tables, "tiers": tiers, "tier_levels": list(TIERS), "floor": FLOOR, "pct": out,
            "n_lines": int(len(kd)), "n_ranked": int(np.isfinite(P["pct_now"]).sum()), "n_cards": int(kd["card_id"].nunique()),
            "rank_min": RANK_MIN_PRICE}


# ---------------- the replay (2026-11-04, Brett: the graded Forecast History - "known-at-the-time", all six holds) ----------------
HIST_QS = [round(i / 20, 2) for i in range(1, 20)]    # the replay's odds grids: 5% .. 95% (smaller file)
HIST_K = (8, 24)                                      # candidates kept per month per group and line, deepest first: groups 1-5 / 6-10 of the rank
HIST_BAND = (50.0, 5000.0)                            # the replay's candidates: buy price inside the page's default band
HIST_MIN = 30                                         # an odds cell needs this many realized cases, else the whole-period cell
RQ = [round(i / 100, 2) for i in range(1, 100)]       # the rank's cut points kept per month (Pre-Sales Spotcheck, 2026-11-05)


def build_hist(cd, keep_ids=None, today=None, pages=None, link=None, P=None):
    """graded_hist.bin: for every month from 2022-01 to the last complete month, the odds each group would have shown
    THAT month (the realized returns of the decision months whose hold was over by then - in 2022, too few, so the whole
    period's tables are used, marked first) for holds 1-6 in that month's market, and the month's best-ranked lines of
    each group and line in the $50 - $5,000 band with what they went on to do: [card id, line (index into lines), standard
    price, rank x 1000, return after 1..6 months x 1000 (null while not over or not known), sales in its last 12
    months]; and each month's rank cut points (rq: the 1st .. 99th percentile of -dev12, x 10000, over the rqn lines
    ranked), so the page can rank any slab from its own line. Card Ladder's sales only (the floor's lines)."""
    P = P or _prep(cd, keep_ids, today, pages, link)
    if P is None:
        return {"err": "no Card Ladder sales for the listed cards yet (card-data data/cardladder/lines)"}
    kd, Pn, m0, buy, pct, grp, reg3, n12 = P["keys"], P["Pn"], P["m0"], P["buy"], P["pct"], P["grp"], P["reg3"], P["n12"]
    j_start, j_last, dev12 = P["j_start"], P["j_last"], P["dev12"]
    cid = kd["card_id"].astype(int).values
    lix = kd["line"].map({l: i for i, l in enumerate(LINES)}).values
    first_honest = max(j_start, _mi("2023-01") - m0)
    cells, whole = {}, {}
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
        with np.errstate(invalid="ignore"):
            okr = (Pn[:, j] >= RANK_MIN_PRICE) & np.isfinite(dev12[:, j]) & (n12[:, j] >= FLOOR)
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
        with np.errstate(invalid="ignore"):
            ok = np.isfinite(pct[:, j]) & (buy[:, j] >= HIST_BAND[0]) & (buy[:, j] <= HIST_BAND[1])
        out = []
        for g in range(GROUPS):
            for li in range(len(LINES)):
                idx = np.where(ok & (grp[:, j] == g) & (lix == li))[0]
                idx = idx[np.argsort(-pct[idx, j])][:HIST_K[1] if g >= GROUPS // 2 else HIST_K[0]]
                for i in idx:
                    ys = []
                    for h in HORIZONS:
                        if j + h > j_last or not np.isfinite(Pn[i, j + h]):
                            ys.append(None)
                        else:
                            ys.append(int(round(float(np.clip(Pn[i, j + h] / buy[i, j] - 1, *CLIP)) * 1000)))
                    out.append([int(cid[i]), li, round(float(buy[i, j]), 2), int(round(float(pct[i, j]) * 1000))] + ys + [int(n12[i, j])])
        months.append(_ym(m0 + j)); ups.append(1 if up else 0); regs.append(round(float(reg3[j]), 4)); firsts.append(1 if j < first_honest else 0); tabs.append(tab); cands.append(out)
    return {"model": VERSION, "src": "cl", "t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "qs": HIST_QS, "lines": LINES,
            "groups": GROUPS, "horizons": list(HORIZONS), "band": list(HIST_BAND), "k": list(HIST_K), "yscale": 1000, "last": _ym(m0 + j_last),
            "months": months, "up": ups, "reg3": regs, "first": firsts, "tab": tabs, "cands": cands,
            "rqs": RQ, "rq": rqs, "rqn": rqn, "rank_min": RANK_MIN_PRICE, "floor": FLOOR}


if __name__ == "__main__":
    import json, sys, time
    t = time.time()
    doc = build(sys.argv[1] if len(sys.argv) > 1 else "card-data/data")
    print(f"{time.time() - t:.0f}s", doc.get("month"), doc.get("regime"), doc.get("n_lines"), doc.get("n_ranked"), len(doc.get("tables", {})))
    for h in (1, 3, 6):
        for reg in ("up", "down"):
            c = doc["tables"].get(f"{h}|{reg}|9")
            if c:
                print(h, reg, "deepest 10%: n", c["n"], "median", c["q"][49], "up", c["p_up"], "mean", c["mean"])
    print(len(json.dumps(doc, separators=(",", ":"))) / 1e6, "MB json")
