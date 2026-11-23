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
the page reads them in page/graded_fc.js and page/graded_fh.js.

THE MODEL SINCE 2026-11-23 (v3; Brett, after the research round of 2026-11-22 in card-data data/graded/research: "first
we make those changes"). The dip rank is no longer what a slab is scored by (measured from a price one could really pay,
the deepest dips did worse than the rest); the Chance is read from three things instead, in this order:
  - THE MARKET'S LEVEL at the last complete month. The index: the median monthly log move of the lines 12+ months past
    their release with 5+ sales in both months ($50+), chained from 2021-01. red = the index is at or below the average
    of its 12 months before; amber = above it, but the month is hot (heat score 0.70+) or under 40% of the busy seasoned
    PSA lines ($100+, 10+ sales) pass the line rules; green = above, not hot, 40%+ pass. The heat score: the average
    of four gauges, each ranked against the months up to then only (2022-01 on, 12 earlier months needed) - how scattered
    the month's moves were, the share of lines at a 12-month high, sales against their 12-month average, the index's
    own move in the month.
  - THE LINE'S CELL. A card under 12 months since its release: "new" (any grader). A CGC line: "cgc". A PSA line of
    Modern / Contemporary: passes or fails the three rules - not extended (up over 0.15 in the month, or over 0.25
    above its own 6-month average), not still falling (down over 0.07 in the month, or its second half of the month
    0.07 under its first), its segment (era x PSA 10 / below 10) not up 0.20+ in 3 months; all log changes. A PSA line
    of the older eras: Vintage, or Classic / Mid Era (there the rules did not separate anything; the level does - and
    the two are apart because Classic and Mid Era moved about twice as far as Vintage in the rise). Era not known: the
    level's pooled table. The PSA cells are measured apart for busy lines (10+ sales in the decision month) and thin
    ones (3 to 9), because a rule read off a thin month's price says less.
  - THE HOLD, 1 .. 6 months.
  The odds: decision month j (everything above known at its end), bought at the NEXT month's price (the month's median,
  3+ sales - never the decision month's own), sold at the median h months after that; every line $50+ with a price in
  month j, one line per Card Ladder page and grade; by level x cell x hold: the 1 .. 99% grid, the mean (returns
  clipped to -80% .. +170%), how often up, and the 5% and 95% grids of 200 resamples of the cell's decision months
  (the Chance's range). A cell needs 30 cases over 4 decision months and half of its level's months, else the level's
  pooled seasoned PSA lines are read. Today's cell of each listed line, its flags (extended, still falling, segment ran, new card,
  thin, beyond the history ...) and its tie-breaker (the card's other grades rose more than this one over 3 months + a clean month of
  sales, ranked inside the month and segment: the order among slabs with the same Chance) are in doc.fc.sig.
  NO CHANCE BEYOND THE HISTORY (F_BEYOND): a line whose era has risen more in 3 months (the larger of its two PSA
  segments' moves) than any era of its side - older / newer - did in the months behind the odds has no past like it; the
  page shows no Chance for it and says why (end of October 2026: Classic and Mid Era, +123% and +136% against a largest
  past run of +66%).
  PriceCharting plays no part (the research's third tie-breaker term, the slab's price against the raw card's, is left
  out for that reason). The replay (build_hist, graded_hist.bin) runs this model too: each month as it read then.
  (The paragraphs above this one describe the model before it - the dip rank -, which nothing runs any more; _prep
  still makes its Pn / buy / dev12 / pct, and the trend files keep the first two.)"""
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

import cl_sales

VERSION = "graded v3 (market level and line rules) 2026-11-23"
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
TIERS = (3, 6, 12, 24)                                # (the model before v3: the sales levels its odds were measured at)
PRICE_MIN_N = 3                                       # sales behind a price (cl_sales.STD_MIN)
# ---- the model since 2026-11-23 (v3): the market's level, the line's cell, the hold ----
MODEL_START = "2021-01"                               # the index is chained from here (the research's first month)
LEVELS = ("green", "amber", "red")
ERA_NEW, ERA_OLD = ("Modern", "Contemporary"), ("Vintage", "Classic", "Mid Era")
CELLS = ("np_b", "np_t", "nf_b", "nf_t", "vin_b", "vin_t", "cm_b", "cm_t", "new", "cgc", "unk")   # (the page and the phone app
C_NEW, C_CGC, C_UNK = 8, 9, 10                                                                  # name them by this order)
CELL_NAMES = ["Modern / Contemporary PSA, passes the rules, busy line", "Modern / Contemporary PSA, passes the rules, thin line",
              "Modern / Contemporary PSA, fails a rule, busy line", "Modern / Contemporary PSA, fails a rule, thin line",
              "Vintage PSA, busy line", "Vintage PSA, thin line", "Classic / Mid Era PSA, busy line", "Classic / Mid Era PSA, thin line",
              "card under 12 months since its release", "CGC", "PSA, era not known"]
F_EXT, F_FALL, F_SEG, F_NEW, F_THIN, F_NOPRICE, F_PROXY, F_PREV, F_BEYOND = 1, 2, 4, 8, 16, 32, 64, 128, 256   # doc.fc.sig's flags
SEASONED = 12                                         # months since release
BUSY_N = 10                                           # sales in the decision month: a busy line
UNI_PRICE, GATE_PRICE = 50.0, 100.0                   # the odds' lines / the lines behind "share that pass"
EXT_MOM1, EXT_DEV6, FALL_MOM1, FALL_HALF, SEG_RUN = 0.15, 0.25, -0.07, -0.07, 0.20   # log changes
HEAT_HOT, SHARE_FEW = 0.70, 0.40
RET_CLIP = (-0.8, 1.7)                                # the mean's clip (the research's)
MIN_MONTHS = 4                                        # decision months behind an odds cell, else the level's pooled cell
BOOT = 200                                            # resamples of a cell's decision months behind the Chance's range
P_CAP = 0.85                                          # no Chance above this (it was 95%): the best past cells were measured
                                                      # on few months of one boom, and cells that claimed 70-80% in earlier
                                                      # tests delivered under 60% on years they had not seen


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


def kit_meta(cd):
    """{PriceCharting card id: (Card Ladder era, release date)} from the data kit's snapshot (card-data
    data/graded/cards.csv.gz) - only for a run of this file on its own; the site build hands over its own (graded_site)."""
    p = os.path.join(cd, "graded", "cards.csv.gz")
    if not os.path.exists(p):
        return {}
    c = pd.read_csv(p, dtype=str).fillna("")
    c = c[c["pricecharting_id"].str.isdigit()].drop_duplicates("pricecharting_id")
    rel = c["release_date"].where(c["release_date"].str.match(r"^(19|20)\d\d-"), c["set_release"])
    return {int(k): (e, r) for k, e, r in zip(c["pricecharting_id"], c["era"], rel)}


def _prep(cd, keep_ids=None, today=None, pages=None, link=None, meta=None):
    """The matrices both builds use, one row per line (card x grade): Pn (the price then), buy (max of it and the 3-month
    price), W (the month's median), n12, L12, dev12, the rank pct and group, the market; plus today's live rank. For the
    model since 2026-11-23: SD (the spread of the month's sales, log), H (the month's second half over its first, log),
    page (the Card Ladder page), first_m (the month of the page's first sale on file), era and relm (the card's Card
    Ladder era and release month - meta: {card id: (era, release date)})."""
    today = today or datetime.now(timezone.utc).date()
    link = links(cd, keep_ids) if link is None else link
    if pages is None:
        pages = cl_sales.load(os.path.join(cd, "cardladder", "lines"))
    if meta is None:
        meta = kit_meta(cd)
    byk = _pages_by_key(pages)
    cur = today.year * 12 + today.month - 1
    m0 = _mi(CALIB_START) - 14
    T = cur - m0 + 1
    keys, rows_pn, rows_buy, rows_w, rows_n, rows_known, live = [], [], [], [], [], [], []
    rows_sd, rows_h, pgs, firsts = [], [], [], []
    for cid, pid in sorted(link.items()):
        P = byk.get(_page(pid))
        if not P or not P["read"]:
            continue
        read_day = cl_sales.day_no(P["read"])
        read_m = int(cl_sales.month_index(np.array([read_day]))[0])
        first_day = min((int(d[0]) for d, _ in P["s"].values() if len(d)), default=read_day)
        first_m = int(cl_sales.month_index(np.array([first_day]))[0])
        for gk, (days, prices) in P["s"].items():
            if gk not in LINES or len(days) < PRICE_MIN_N:
                continue
            mi = cl_sales.month_index(days)
            sel = (mi >= m0) & (mi <= min(cur, read_m))
            mi_, pr = mi[sel] - m0, prices[sel]
            d64 = np.datetime64("2000-01-01") + days[sel].astype("timedelta64[D]")
            dom = (d64 - d64.astype("datetime64[M]")).astype(np.int64) + 1          # day of the month
            lpr = np.log(pr)
            last_j = min(cur, read_m) - m0
            N = np.bincount(mi_, minlength=T).astype(np.float64)[:T]
            starts = np.searchsorted(mi_, np.arange(T + 1))
            Pn = np.full(T, np.nan); B3 = np.full(T, np.nan); Wm = np.full(T, np.nan)
            Sd = np.full(T, np.nan, dtype=np.float32); Hf = np.full(T, np.nan, dtype=np.float32)
            c3 = np.convolve(N, np.ones(3))[:T]                       # sales in months j-2 .. j
            for j in np.flatnonzero(N > 0):
                a, b = starts[j], starts[j + 1]
                Wm[j] = float(np.median(pr[a:b]))
                if b - a >= 2:
                    Sd[j] = lpr[a:b].std(ddof=1)
                    h1, h2 = pr[a:b][dom[a:b] <= 15], pr[a:b][dom[a:b] > 15]
                    if len(h1) >= 2 and len(h2) >= 2:
                        Hf[j] = np.log(np.median(h2) / np.median(h1))
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
            rows_sd.append(Sd); rows_h.append(Hf); pgs.append(_page(pid)); firsts.append(first_m)
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
    era, relm = [], []
    for cid in kd["card_id"].values:
        e, r = meta.get(int(cid), ("", ""))
        e = str(e or "").replace("?", "").strip()
        era.append(e if e in ERA_NEW + ERA_OLD else "")
        r = str(r or "")
        relm.append(int(r[:4]) * 12 + int(r[5:7]) - 1 if len(r) >= 7 and r[:4].isdigit() and r[5:7].isdigit() and r[:2] in ("19", "20") else np.nan)
    return dict(keys=kd, Pn=Pn, buy=buy, W=W, N=N, n12=n12, L12=L12, dev12=dev12, pct=pct, grp=grp, reg1=reg1, reg3=reg3,
                breadth3=breadth3, fwd3=fwd3, nreg=nreg, m0=m0, T=T, j_last=j_last, j_start=j_start,
                std_now=std_now, n12_now=n12_now, dev_now=dev_now, pct_now=pct_now,
                SD=np.vstack(rows_sd), H=np.vstack(rows_h), page=np.array(pgs, dtype=object), first_m=np.array(firsts, dtype=np.float64),
                era=np.array(era, dtype=object), relm=np.array(relm, dtype=np.float64))


# ---------------- the model since 2026-11-23 (v3): the market's level, the line's cell, the hold ----------------
def _lag(A, k):
    out = np.full(A.shape, np.nan, dtype=A.dtype if A.dtype.kind == "f" else np.float64)
    out[:, k:] = A[:, :-k]
    return out


def _ffill(A, limit):
    """The last value carried forward up to `limit` months."""
    out = A.copy()
    for k in range(1, limit + 1):
        out = np.where(np.isfinite(out), out, _lag(A, k))
    return out


def _roll_mean(A, w, minp):
    """The mean of the w months BEFORE t (t-w .. t-1), needing minp of them."""
    s, n = np.zeros(A.shape), np.zeros(A.shape)
    for k in range(1, w + 1):
        x = _lag(A, k)
        ok = np.isfinite(x)
        s += np.where(ok, x, 0)
        n += ok
    return np.where(n >= minp, s / np.maximum(n, 1), np.nan)


def _chain(lp, Nz, Pm, mask, a0, min_n=5):
    """The median monthly log move of the lines of mask with min_n sales in both months, $50+ the month before, chained
    from month a0 -> (index level, move, lines used)."""
    T = lp.shape[1]
    mv, cnt = np.full(T, np.nan), np.zeros(T, dtype=int)
    with np.errstate(invalid="ignore"):
        for t in range(a0 + 1, T):
            ok = mask[:, t] & (Nz[:, t] >= min_n) & (Nz[:, t - 1] >= min_n) & (Pm[:, t - 1] >= UNI_PRICE) & np.isfinite(lp[:, t]) & np.isfinite(lp[:, t - 1])
            cnt[t] = int(ok.sum())
            if cnt[t] >= 30:
                mv[t] = float(np.median(lp[ok, t] - lp[ok, t - 1]))
    lvl = np.exp(np.nancumsum(np.nan_to_num(mv)))
    lvl[np.cumsum(np.isfinite(mv)) == 0] = np.nan
    return lvl, mv, cnt


def _chg(x, k):
    out = np.full(len(x), np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        out[k:] = np.log(x[k:] / x[:-k])
    return out


def _past_rank(v):
    """Each month's share of the months up to and including it that were at or below it (12 earlier months needed)."""
    out = np.full(len(v), np.nan)
    for i in range(12, len(v)):
        w = v[: i + 1]
        w = w[np.isfinite(w)]
        if np.isfinite(v[i]) and len(w) >= 12:
            out[i] = float((w <= v[i]).mean())
    return out


def _model(P):
    """Month by month, known at each month's end: the index, the level (green / amber / red) and its two gauges, each
    line's flags and cell. One line per Card Ladder page and grade behind every market figure (uniq): two PriceCharting
    cards on one page are one line."""
    if P.get("model") is not None:
        return P["model"]
    kd, N, W, m0, T = P["keys"], P["N"], P["W"], P["m0"], P["T"]
    L = len(kd)
    a0 = _mi(MODEL_START) - m0
    Nz = np.nan_to_num(N, nan=0.0)
    Nz[:, :a0] = 0
    Pm = np.where(Nz >= PRICE_MIN_N, W, np.nan)             # the month's price: its median on 3+ sales
    with np.errstate(invalid="ignore", divide="ignore"):
        lp = np.log(Pm)
    gk = kd["line"].values
    psa = np.array([str(g).startswith("psa|") for g in gk])
    ten = np.array([str(g).split("|")[1].startswith("g10") for g in gk])
    uniq = ~pd.DataFrame({"p": P["page"], "g": gk}).duplicated().values
    era = P["era"]
    new_era, old_era = np.isin(era, ERA_NEW), np.isin(era, ERA_OLD)
    mnum = (m0 + np.arange(T)).astype(np.float64)
    age = mnum[None, :] - P["relm"][:, None]
    age[age < 0] = np.nan
    with np.errstate(invalid="ignore"):
        strict = age >= SEASONED                             # the release date says so: behind the index and the gauges
        # the cells' "seasoned": the release date; with none, any era that ended years ago, else 12+ months of sales on file
        seas = np.where(np.isfinite(age), strict, (old_era | (era == "Modern"))[:, None] | (mnum[None, :] - P["first_m"][:, None] >= SEASONED))
    proxy = ~np.isfinite(P["relm"])
    del age
    idx, mv, cnt = _chain(lp, Nz, Pm, strict & uniq[:, None], a0)
    vs12 = np.full(T, np.nan)                                # the index against the average of its 12 months before (log)
    for t in range(a0 + 12, T):
        if np.isfinite(idx[t]) and np.isfinite(idx[t - 12:t]).any():
            vs12[t] = float(np.log(idx[t] / np.nanmean(idx[t - 12:t])))
    up = np.nan_to_num(vs12, nan=-1.0) > 0
    lpf = _ffill(lp, 2)                                      # a reference price may be up to 2 months old
    mom1 = lp - _lag(lpf, 1)
    mom3 = (lp - _lag(lpf, 3)).astype(np.float32)
    dev6 = lp - _roll_mean(lp, 6, 2)
    with np.errstate(invalid="ignore"):
        ext = (mom1 > EXT_MOM1) | (dev6 > EXT_DEV6)
        fall = (mom1 < FALL_MOM1) | (P["H"] < FALL_HALF)
    del lpf, dev6
    # the segments: era x PSA 10 / below 10 - each its own index, its 3-month move
    seg = np.full(L, -1, dtype=int)
    segm3, names = [], []
    for e in ERA_OLD + ERA_NEW:
        for gs, nm in ((ten, " PSA 10"), (~ten, " PSA below 10")):
            ls = (era == e) & psa & gs
            seg[ls] = len(names)
            names.append(e + nm)
            m3 = np.full(T, np.nan)
            if int((ls & uniq).sum()) >= 50:
                lv, _, c = _chain(lp, Nz, Pm, (ls & uniq)[:, None] & strict, a0)
                m3 = _chg(lv, 3)
                m3[c < 30] = np.nan
            segm3.append(m3)
    segm3 = np.vstack(segm3)
    # each era's run: the larger 3-month move of its two PSA segments (a segment with too few lines has none); and the
    # largest run any era of the same side (older / newer) had in the months behind the odds - a line whose era has
    # run further than that today has no past like it, and gets no Chance (F_BEYOND)
    era_run = np.vstack([np.fmax(segm3[2 * i], segm3[2 * i + 1]) for i in range(len(ERA_OLD + ERA_NEW))])
    era_ix = np.array([(ERA_OLD + ERA_NEW).index(e) if e in ERA_OLD + ERA_NEW else -1 for e in era])
    sm = np.where(seg[:, None] >= 0, segm3[np.maximum(seg, 0)], np.nan)     # each line's segment's 3-month move
    with np.errstate(invalid="ignore"):
        seg_run = sm >= SEG_RUN
        passes = ~ext & ~fall & (sm < SEG_RUN)
        gated = uniq[:, None] & psa[:, None] & strict & (Nz >= BUSY_N) & (Pm >= GATE_PRICE)
    n_gated = gated.sum(0)
    n_pass = (gated & passes).sum(0)
    share = np.where(n_gated >= 30, n_pass / np.maximum(n_gated, 1), np.nan)
    # the heat score: four gauges, each ranked against the months up to then (2022-01 on)
    disp, hi12 = np.full(T, np.nan), np.full(T, np.nan)
    su = strict & uniq[:, None]
    for t in range(a0 + 12, T):
        ok = su[:, t] & (Nz[:, t] >= 5) & (Nz[:, t - 1] >= 5) & np.isfinite(lp[:, t]) & np.isfinite(lp[:, t - 1])
        if ok.sum() >= 30:
            m = lp[ok, t] - lp[ok, t - 1]
            disp[t] = float(np.percentile(m, 75) - np.percentile(m, 25))
        blk = lp[:, t - 12:t]
        has = np.isfinite(blk).any(axis=1)
        past = np.full(L, np.nan)
        past[has] = np.nanmax(blk[has], axis=1)
        ok2 = su[:, t] & (Nz[:, t] >= 5) & np.isfinite(lp[:, t]) & np.isfinite(past)
        if ok2.sum() >= 30:
            hi12[t] = float((lp[ok2, t] >= past[ok2]).mean())
    vol = pd.Series(np.where(su, Nz, 0.0).sum(0))
    volv = (vol / vol.shift(1).rolling(12, min_periods=6).mean() - 1).to_numpy(copy=True)
    a = _mi(CALIB_START) - m0
    heat = np.full(T, np.nan)
    heat[a:] = np.vstack([_past_rank(g[a:]) for g in (disp, hi12, volv, _chg(idx, 1))]).mean(0)   # NaN while a gauge has no rank
    hot = np.nan_to_num(heat, nan=0.0) >= HEAT_HOT
    few = np.nan_to_num(share, nan=1.0) < SHARE_FEW
    level = np.where(~up, "red", np.where(hot | few, "amber", "green")).astype(object)
    # the cells
    busy = Nz >= BUSY_N
    cell = np.full((L, T), -1, dtype=np.int8)
    ps = seas & psa[:, None]
    x = ps & new_era[:, None]
    cell[x & passes & busy] = 0; cell[x & passes & ~busy] = 1; cell[x & ~passes & busy] = 2; cell[x & ~passes & ~busy] = 3
    x = ps & (era == "Vintage")[:, None]
    cell[x & busy] = 4; cell[x & ~busy] = 5
    x = ps & old_era[:, None] & (era != "Vintage")[:, None]
    cell[x & busy] = 6; cell[x & ~busy] = 7
    cell[ps & ~new_era[:, None] & ~old_era[:, None]] = C_UNK
    cell[seas & ~psa[:, None]] = C_CGC
    cell[~seas] = C_NEW
    j_last = T - 2                                           # the last complete calendar month
    while j_last > a and not np.isfinite(vs12[j_last]):
        j_last -= 1
    P["model"] = dict(Nz=Nz, Pm=Pm, uniq=uniq, psa=psa, ten=ten, seg=seg, seg_names=names, segm3=segm3, seas=seas, proxy=proxy,
                      idx=idx, mv=mv, cnt=cnt, vs12=vs12, up=up, heat=heat, hot=hot, share=share, few=few, n_gated=n_gated,
                      n_pass=n_pass, level=level, ext=ext, fall=fall, seg_run=seg_run, passes=passes, busy=busy, cell=cell,
                      mom3=mom3, j_last=j_last, a0=a0, a=a, new_era=new_era, old_era=old_era, era_run=era_run, era_ix=era_ix)
    return P["model"]


def _tb(P, M, t):
    """The tie-breaker at month t, 0 .. 1 (NaN: no price that month): inside the month and the line's segment (era x
    grader x 10 / below 10), the rank of "the card's other grades rose more than this one over 3 months" less the rank
    of the spread of the month's own sales - the two terms of the research's tie-breaker that are Card Ladder's alone."""
    kd, uniq, mom3, Pm = P["keys"], M["uniq"], M["mom3"], M["Pm"]
    L = len(kd)
    codes, _ = pd.factorize(P["page"])
    G = int(codes.max()) + 1
    m = mom3[:, t].astype(np.float64)
    o = np.isfinite(m) & uniq
    c = np.clip(np.nan_to_num(m, nan=0.0), -1.5, 1.5)
    s = np.bincount(codes[o], weights=c[o], minlength=G)
    n = np.bincount(codes[o], minlength=G)
    nn = n[codes] - o
    lead = np.where(np.isfinite(m) & (nn >= 1), (s[codes] - np.where(o, c, 0.0)) / np.maximum(nn, 1) - m, np.nan)
    sd = np.where(M["Nz"][:, t] >= PRICE_MIN_N, P["SD"][:, t].astype(np.float64), np.nan)
    sel = uniq & np.isfinite(Pm[:, t])
    out = np.full(L, np.nan)
    if sel.sum() < 30:
        return out
    d = pd.DataFrame({"seg": pd.Series(P["era"][sel]).astype(str).values + np.where(M["psa"][sel], "|psa|", "|cgc|") + np.where(M["ten"][sel], "10", "lo"),
                      "lead": lead[sel], "sd": sd[sel]})
    g = d.groupby("seg")
    d["tb"] = (g["lead"].rank(pct=True) - 0.5).fillna(0.0) - (g["sd"].rank(pct=True) - 0.5).fillna(0.0)
    out[sel] = d.groupby("seg")["tb"].rank(pct=True).values
    # a second PriceCharting card on the same page takes its line's figure
    first = pd.DataFrame({"p": P["page"], "g": kd["line"].values}).groupby(["p", "g"], sort=False).ngroup().values
    rep = np.full(int(first.max()) + 1, np.nan)
    rep[first[uniq]] = out[uniq]
    return np.where(uniq, out, rep[first])


def _bands(y, mc, rng):
    """The 5% and 95% of each point of the 1 .. 99% grid over BOOT resamples of the cell's decision months (mc: each
    trade's month, 0 .. K-1): the range the Chance is shown with."""
    K = int(mc.max()) + 1
    o = np.argsort(y, kind="stable")
    ys, ms = y[o], mc[o]
    w = rng.multinomial(K, np.full(K, 1.0 / K), size=BOOT).astype(np.float32)      # how often each month is drawn
    qb = np.empty((BOOT, len(QS)))
    qs = np.asarray(QS)
    for b in range(BOOT):
        cw = np.cumsum(w[b][ms])
        if cw[-1] <= 0:
            qb[b] = np.nan
            continue
        qb[b] = ys[np.minimum(len(ys) - 1, np.searchsorted(cw, qs * cw[-1], side="left"))]
    return np.nanpercentile(qb, 5, axis=0), np.nanpercentile(qb, 95, axis=0)


def _cell3(y, mj, rng):
    mc = pd.factorize(mj)[0]
    lo, hi = _bands(y, mc, rng)
    r4 = lambda a: [round(float(v), 4) for v in a]
    return {"n": int(len(y)), "nm": int(mc.max()) + 1, "mean": round(float(np.clip(y, *RET_CLIP).mean()), 4), "p_up": round(float((y > 0).mean()), 3),
            "q": r4(np.quantile(y, QS)), "lo": r4(lo), "hi": r4(hi)}


def _pairs3(P, M, h):
    """Every (decision month, cell, realized return) for a hold of h months: decided at the end of month j, bought at
    month j+1's price, sold at month j+1+h's - the lines $50+ with a price in month j, one per page and grade."""
    Pm, cell, uniq = M["Pm"], M["cell"], M["uniq"]
    Js, Cs, Ys = [], [], []
    for j in range(M["a"], M["j_last"] - h):
        with np.errstate(invalid="ignore", divide="ignore"):
            y = Pm[:, j + 1 + h] / Pm[:, j + 1] - 1
            sel = uniq & np.isfinite(y) & (Pm[:, j] >= UNI_PRICE) & (cell[:, j] >= 0)
        if not sel.any():
            continue
        n = int(sel.sum())
        Js.append(np.full(n, j)); Cs.append(cell[sel, j].astype(int)); Ys.append(np.clip(y[sel], *CLIP))
    if not Ys:
        return None
    return np.concatenate(Js), np.concatenate(Cs), np.concatenate(Ys)


def _tables3(P, M):
    """{"h|level|cell": odds} (a cell with MIN_CELL cases over MIN_MONTHS decision months and at least half of the level's
    months), "h|level|all" (the level's
    seasoned PSA lines pooled: what a cell without enough cases, or a line of no known era, is read from), "h|all|all"."""
    rng = np.random.default_rng(20261123)
    level = M["level"]
    tables = {}
    for h in HORIZONS:
        got = _pairs3(P, M, h)
        if got is None:
            continue
        J, C, Y = got
        lv = level[J]
        for name in LEVELS:
            at = lv == name
            need = max(MIN_MONTHS, (len(np.unique(J[at])) + 1) // 2)      # ... and half of the level's months: a cell seen in
            for c in range(len(CELLS)):                                    # few of them is those months' story, not the cell's
                s = at & (C == c)                                          # (CGC's red months are all from the last year of the fall)
                if s.sum() >= MIN_CELL and len(np.unique(J[s])) >= need:
                    tables[f"{h}|{name}|{c}"] = _cell3(Y[s], J[s], rng)
            s = at & (C != C_NEW) & (C != C_CGC)
            if s.sum() >= MIN_CELL:
                tables[f"{h}|{name}|all"] = _cell3(Y[s], J[s], rng)
        tables[f"{h}|all|all"] = _cell3(Y, J, rng)
    return tables


def beyond(M):
    """Per era (ERA_OLD + ERA_NEW): (the largest 3-month run - log - any era of its side had in the months behind the
    odds, decision months up to two before the last complete one; its own run at the last complete month); None where
    there is none."""
    run, a, jl = M["era_run"], M["a"], M["j_last"]
    n_old = len(ERA_OLD)
    out_max, out_now = [], []
    for k in range(run.shape[0]):
        side = run[:n_old, a:jl - 1] if k < n_old else run[n_old:, a:jl - 1]
        out_max.append(float(np.nanmax(side)) if np.isfinite(side).any() else None)
        out_now.append(float(run[k, jl]) if np.isfinite(run[k, jl]) else None)
    return out_max, out_now


def _is_beyond(run_now, run_max):
    """A run at all (the segment rule's 0.20) and larger than the largest in the history."""
    return bool(run_now is not None and run_now >= SEG_RUN and (run_max is None or run_now > run_max))


def _today(P, M):
    """{card id: {line index: code}} for the lines with a standard price today. code = tie-breaker x 1000 (1023: none)
    + 1024 x cell + 16384 x flags. The line's own reading (extended, still falling, busy or thin, the tie-breaker) is of
    the last complete month, else of the month before it (F_PREV), else not known (F_NOPRICE: a thin line whose rules
    cannot be read - in the newer eras it is counted with the lines that fail one); its segment's reading and the card's
    age are of today. F_BEYOND: the line's era has run further in 3 months than any era of its side did in the months
    behind the odds - the page gives such a line no Chance."""
    kd, T, jl = P["keys"], P["T"], M["j_last"]
    Pm, Nz, ext, fall = M["Pm"], M["Nz"], M["ext"], M["fall"]
    L = len(kd)
    at = np.where(np.isfinite(Pm[:, jl]), jl, np.where(np.isfinite(Pm[:, jl - 1]), jl - 1, -1))
    rows = np.arange(L)
    has = at >= 0
    ja = np.maximum(at, 0)
    e = has & ext[rows, ja]
    f = has & fall[rows, ja]
    busy = has & (Nz[rows, ja] >= BUSY_N)
    tb = np.where(at == jl, _tb(P, M, jl), np.where(at == jl - 1, _tb(P, M, jl - 1), np.nan))
    sr = M["seg_run"][:, jl]
    seg_ok = np.where(M["seg"] >= 0, np.nan_to_num(M["segm3"][np.maximum(M["seg"], 0), jl], nan=9.0) < SEG_RUN, False)
    seas = M["seas"][:, T - 1]
    psa, ne, oe, vin = M["psa"], M["new_era"], M["old_era"], P["era"] == "Vintage"
    ok = has & ~e & ~f & seg_ok                              # a line with no reading is not counted as passing
    cell = np.where(~seas, C_NEW, np.where(~psa, C_CGC, np.where(ne, np.where(ok, 0, 2) + np.where(busy, 0, 1), np.where(oe, np.where(vin, 4, 6) + np.where(busy, 0, 1), C_UNK))))
    run_max, run_now = beyond(M)
    ex = M["era_ix"]
    bey = seas & (ex >= 0) & np.array([_is_beyond(run_now[k], run_max[k]) if k >= 0 else False for k in ex])
    flags = (e * F_EXT + f * F_FALL + sr * F_SEG + (~seas) * F_NEW + (~busy) * F_THIN + (~has) * F_NOPRICE
             + (M["proxy"]) * F_PROXY + (at == jl - 1) * F_PREV + bey * F_BEYOND).astype(int)
    li = {l: i for i, l in enumerate(LINES)}
    out, n, nb = {}, np.zeros(len(CELLS), dtype=int), 0
    std = P["std_now"]
    for i, (cid, line) in enumerate(kd[["card_id", "line"]].itertuples(index=False, name=None)):
        if not np.isfinite(std[i]):
            continue
        t = 1023 if not np.isfinite(tb[i]) else int(round(float(tb[i]) * 1000))
        out.setdefault(str(int(cid)), {})[str(li[line])] = t + 1024 * int(cell[i]) + 16384 * int(flags[i])
        n[int(cell[i])] += 1
        nb += int(bool(bey[i]))
    return out, [int(v) for v in n], nb


def build(cd, keep_ids=None, today=None, pages=None, link=None, P=None, meta=None):
    t0 = datetime.now(timezone.utc)
    P = P or _prep(cd, keep_ids, today, pages, link, meta)
    if P is None:
        return {"err": "no Card Ladder sales for the listed cards yet (card-data data/cardladder/lines)"}
    kd, m0 = P["keys"], P["m0"]
    M = _model(P)
    jl, a, level = M["j_last"], M["a"], M["level"]
    tables = _tables3(P, M)
    sig, n_cells, n_beyond = _today(P, M)
    f = lambda v, nd=4: None if v is None or not np.isfinite(v) else round(float(v), nd)
    pc = lambda v: None if v is None or not np.isfinite(v) else round(float(np.exp(v) - 1), 4)      # a log change as a fraction
    now = str(level[jl])
    m3 = _chg(M["idx"], 3)
    lv = {"now": now, "month": _ym(m0 + jl), "above": bool(M["up"][jl]), "vs12": pc(M["vs12"][jl]), "mom1": pc(M["mv"][jl]), "mom3": pc(m3[jl]),
          "heat": f(M["heat"][jl], 3), "hot": bool(M["hot"][jl]), "share": f(M["share"][jl], 3), "few": bool(M["few"][jl]),
          "n_gated": int(M["n_gated"][jl]), "n_pass": int(M["n_pass"][jl]), "n_index": int(M["cnt"][jl]),
          "months": {k: int((level[a:jl + 1] == k).sum()) for k in LEVELS},
          "last": [[_ym(m0 + j), str(level[j])] for j in range(max(a, jl - 11), jl + 1)],
          "segs": [[nm, pc(M["segm3"][i, jl])] for i, nm in enumerate(M["seg_names"])],
          "beyond": [[e, pc(rn), pc(rx)] for e, rx, rn in zip(ERA_OLD + ERA_NEW, *beyond(M)) if _is_beyond(rn, rx)],
          "th": {"heat": HEAT_HOT, "share": SHARE_FEW, "seg": round(float(np.exp(SEG_RUN) - 1), 3), "ext1": round(float(np.exp(EXT_MOM1) - 1), 3),
                 "ext6": round(float(np.exp(EXT_DEV6) - 1), 3), "fall": round(float(1 - np.exp(FALL_MOM1)), 3), "busy": BUSY_N, "seasoned": SEASONED}}
    # (regime, pct: what a page still open from before the change reads - it shows "no score" until it is refreshed)
    R = {"reg1": pc(M["mv"][jl]), "reg3": None if lv["mom3"] is None else round(lv["mom3"] / 3, 4), "breadth3": None, "n": int(M["cnt"][jl]),
         "up": now != "red", "confirm": now == "green", "p_next": [None, None, 0, 0], "month": _ym(m0 + jl)}
    return {"model": VERSION, "v": 3, "src": "cl", "t": t0.strftime("%Y-%m-%dT%H:%M:%SZ"), "month": _ym(m0 + jl), "last": _ym(m0 + jl),
            "start": CALIB_START, "qs": QS, "lines": LINES, "cells": list(CELLS), "cell_names": CELL_NAMES, "groups": len(CELLS),
            "horizons": list(HORIZONS), "level": lv, "regime": R, "tables": tables, "sig": sig, "pct": {}, "cap": P_CAP,
            "n_cells": n_cells, "n_beyond": n_beyond, "n_lines": int(len(kd)), "n_ranked": int(sum(n_cells)), "n_cards": int(kd["card_id"].nunique()),
            "uni_price": UNI_PRICE, "busy": BUSY_N, "floor": PRICE_MIN_N}


# ---------------- the replay (2026-11-04, Brett: the graded Forecast History - "known-at-the-time", all six holds) ----------------
# ON THE MODEL OF 2026-11-23 SINCE THAT DAY'S SECOND CHANGE: each month's level as it read then, the odds of each cell
# from the decisions whose hold was over by then, the month's lines by cell in tie-breaker order.
HIST_QS = [round(i / 20, 2) for i in range(1, 20)]    # the replay's odds grids: 5% .. 95% (smaller file)
HIST_K = 16                                           # candidates kept per month, cell and grade, best tie-breaker first
HIST_BAND = (50.0, 5000.0)                            # the replay's candidates: bought inside the page's default band
HIST_MIN = 30                                         # an odds cell needs this many realized cases over MIN_MONTHS months ...


def beyond_then(M):
    """eras x months: the era's run that month was a run at all (0.20+, the segment rule's line) and larger than any run
    an era of its side had had up to two months before - "beyond the history" as it would have read then (the replay;
    beyond() is the same for today). The first big run of a side is beyond by definition: nothing like it had been seen."""
    run, a = M["era_run"], M["a"]
    n_old, T = len(ERA_OLD), run.shape[1]
    out = np.zeros(run.shape, dtype=bool)
    for k in range(run.shape[0]):
        side = run[:n_old] if k < n_old else run[n_old:]
        for j in range(a, T):
            past = side[:, a:max(a, j - 1)]
            if np.isfinite(run[k, j]) and run[k, j] >= SEG_RUN:      # a run at all (the segment rule's 0.20) ...
                out[k, j] = not np.isfinite(past).any() or run[k, j] > np.nanmax(past)   # ... and larger than any before it
    return out


def month_codes(P, M):
    """lines x months, a small code of each line's reading as it stood that month (-1: none): the cell + 16 x (1
    extended, 2 still falling, 4 its segment ran, 8 beyond the history then). For the trend files (graded_site.add_cf):
    Pre-Sales Spotcheck places a slab in each past month with it."""
    if M.get("codes") is None:
        bt, ex, cell = beyond_then(M), M["era_ix"], M["cell"]
        bey = np.where(ex[:, None] >= 0, bt[np.maximum(ex, 0)], False) & (cell != C_NEW) & (cell >= 0)
        f = M["ext"] * 1 + M["fall"] * 2 + M["seg_run"] * 4 + bey * 8
        M["codes"] = np.where(cell >= 0, cell.astype(np.int16) + 16 * f.astype(np.int16), -1).astype(np.int16)
    return M["codes"]


def build_hist(cd, keep_ids=None, today=None, pages=None, link=None, P=None):
    """graded_hist.bin: for every month from 2022-01 to the last complete month, what the model of 2026-11-23 would have
    read at that month's end. lv: the market's level then (up: 1 unless red; vs12: the index against the average of its 12
    months before, a fraction). tab[month][hold - 1][cell]: the odds of that cell at that level from the decisions whose
    hold was over by then - [mean, the 5% .. 95% grid] - when there were HIST_MIN cases over MIN_MONTHS months and half
    of that level's months so far; else that level's seasoned PSA lines together, known then; else (first[month] = 1
    when the 3-month hold needed it) the whole period's cell, which is hindsight and marked so. cands[month]: the month's lines $50+ with a price that month AND the
    next (one per Card Ladder page and grade), by cell and grade the HIST_K best by tie-breaker: [card id, line index,
    the price bought at - the NEXT month's median; the month's own for the last month -, code (as doc.fc.sig: tie-breaker
    x 1000 + 1024 x cell + 16384 x flags; F_BEYOND as it read then), the return 1..6 months after the buy x 1000 (null
    while not over or no price), sales that month]. Card Ladder's sales only."""
    P = P or _prep(cd, keep_ids, today, pages, link)
    if P is None:
        return {"err": "no Card Ladder sales for the listed cards yet (card-data data/cardladder/lines)"}
    M = _model(P)
    kd, m0 = P["keys"], P["m0"]
    Pm, Nz, cell, level, uniq = M["Pm"], M["Nz"], M["cell"], M["level"], M["uniq"]
    a, jl = M["a"], M["j_last"]
    cid = kd["card_id"].astype(int).values
    lix = kd["line"].map({l: i for i, l in enumerate(LINES)}).values
    nC = len(CELLS)
    codes = month_codes(P, M)
    grid = lambda y: [round(float(np.clip(y, *RET_CLIP).mean()), 4)] + [round(float(v), 4) for v in np.quantile(y, HIST_QS)]
    enough = lambda J_, need=MIN_MONTHS: len(J_) >= HIST_MIN and len(np.unique(J_)) >= need
    half = lambda J_: max(MIN_MONTHS, (len(np.unique(J_)) + 1) // 2)        # a cell needs half of its level's months (as _tables3)
    pairs = {h: _pairs3(P, M, h) for h in HORIZONS}
    whole = {}                                               # (hold, level, cell or "all") -> the whole period's grid
    for h, got in pairs.items():
        if got is None:
            continue
        J, C, Y = got
        for name in LEVELS:
            at = level[J] == name
            need = half(J[at])
            for c in range(nC):
                s_ = at & (C == c)
                if enough(J[s_], need):
                    whole[(h, name, c)] = grid(Y[s_])
            s_ = at & (C != C_NEW) & (C != C_CGC)
            if enough(J[s_]):
                whole[(h, name, "all")] = grid(Y[s_])
    months, lvs, ups, vs, firsts, tabs, cands = [], [], [], [], [], [], []
    for j in range(a, jl + 1):
        name = str(level[j])
        tab, first = [], 0
        for h in HORIZONS:
            got = pairs.get(h)
            row = [None] * nC
            if got is not None:
                J, C, Y = got
                then = (level[J] == name) & (J + 1 + h <= j)        # decided, bought and sold by the end of month j
                sp = then & (C != C_NEW) & (C != C_CGC)
                pooled = grid(Y[sp]) if enough(J[sp]) else None
                if pooled is None and h == 3:
                    first = 1
                need = half(J[then])
                for c in range(nC):
                    s_ = then & (C == c)
                    row[c] = (grid(Y[s_]) if enough(J[s_], need) else pooled if pooled is not None else whole.get((h, name, c)) or whole.get((h, name, "all")))
            tab.append(row)
        last = j == jl
        entry = Pm[:, j] if last else Pm[:, j + 1]                  # bought the month after the decision (the last month: not known yet)
        tb = _tb(P, M, j)
        with np.errstate(invalid="ignore"):
            ok = uniq & (Pm[:, j] >= UNI_PRICE) & (entry >= HIST_BAND[0]) & (entry <= HIST_BAND[1]) & (cell[:, j] >= 0)
        key = np.where(np.isfinite(tb), tb, -1.0)
        out = []
        for c in range(nC):
            for li in range(len(LINES)):
                idx = np.where(ok & (cell[:, j] == c) & (lix == li))[0]
                for i in idx[np.argsort(-key[idx], kind="stable")][:HIST_K]:
                    ys = []
                    for h in HORIZONS:
                        if last or j + 1 + h > jl or not np.isfinite(Pm[i, j + 1 + h]):
                            ys.append(None)
                        else:
                            ys.append(int(round(float(np.clip(Pm[i, j + 1 + h] / entry[i] - 1, *CLIP)) * 1000)))
                    k = int(codes[i, j])
                    fl = (k >> 4 & 1) * F_EXT + (k >> 5 & 1) * F_FALL + (k >> 6 & 1) * F_SEG + (k >> 7 & 1) * F_BEYOND + (0 if Nz[i, j] >= BUSY_N else F_THIN)
                    out.append([int(cid[i]), li, round(float(entry[i]), 2), (1023 if not np.isfinite(tb[i]) else int(round(float(tb[i]) * 1000))) + 1024 * c + 16384 * fl] + ys + [int(Nz[i, j])])
        months.append(_ym(m0 + j)); lvs.append(name); ups.append(0 if name == "red" else 1)
        vs.append(None if not np.isfinite(M["vs12"][j]) else round(float(np.exp(M["vs12"][j]) - 1), 4))
        firsts.append(first); tabs.append(tab); cands.append(out)
    return {"model": VERSION, "v": 3, "src": "cl", "t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "qs": HIST_QS, "lines": LINES,
            "cells": list(CELLS), "groups": nC, "horizons": list(HORIZONS), "band": list(HIST_BAND), "k": HIST_K, "yscale": 1000, "last": _ym(m0 + jl),
            "months": months, "lv": lvs, "up": ups, "vs12": vs, "first": firsts, "tab": tabs, "cands": cands, "cap": P_CAP, "floor": PRICE_MIN_N}


if __name__ == "__main__":
    import json, sys, time
    t = time.time()
    doc = build(sys.argv[1] if len(sys.argv) > 1 else "card-data/data")
    print(f"{time.time() - t:.0f}s", doc.get("month"), doc.get("level"), doc.get("n_lines"), doc.get("n_ranked"), len(doc.get("tables", {})))
    print("lines with a standard price by cell:", dict(zip(CELLS, doc.get("n_cells") or [])))
    lv = (doc.get("level") or {}).get("now")
    for h in (1, 3, 6):
        for c in list(range(len(CELLS))) + ["all"]:
            x = doc["tables"].get(f"{h}|{lv}|{c}")
            if x:
                print(h, lv, CELLS[c] if c != "all" else "all", "n", x["n"], "months", x["nm"], "median", x["q"][49], "up", x["p_up"], "mean", x["mean"])
    print(len(json.dumps(doc, separators=(",", ":"))) / 1e6, "MB json")
