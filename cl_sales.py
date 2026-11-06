"""cl_sales.py - Card Ladder's own sales, as the graded view and the graded Forecast read them (2026-11-05).

Brett, 2026-11-05: "Moving forward card ladder will be used as the primary reference point, and PC will be there to
confirm matching"; "we need to change statistics to be based on card ladder, the stats columns"; the Forecast's
calculations use Card Ladder only ("id rather keep PC out completely of forcast, but only as it applies to the
calculations. i still want to see the pc price and sales in the rows").

The sales come from card-data data/cardladder/lines/ (card-data tools/clingest/cl_lines.py writes it; load() here reads
the same format - keep the two in step): one record per Card Ladder page read, each holding only the sales not on file
before, per grader|grade: [minutes since 2000-01-01 UTC as gaps, price, kind] (kind 0 auction, 1 best offer, 2 fixed
price, 3 other, +4 qualifier, +8 autograph grade), and Card Ladder's value per grade at that read.

THE STANDARD PRICE (Brett, 2026-11-05, decision 1): the robust middle (Hodges-Lehmann: the median of every pairwise
average) of the grade's sales in the 30 days to the page's last read, needing 3 sales; with fewer, 60 days, then 90; with
fewer than 3 even then, no price. Sales Card Ladder marks with a qualifier or an autograph grade are left out of every
figure here. Card Ladder's own value is shown beside it (at its top confidence it is the last sale: within 2% of it 78%
of the time).
"""
import glob
import gzip
import json
import os
from datetime import date, datetime, timedelta, timezone

import numpy as np

EPOCH_DAY = date(2000, 1, 1).toordinal()
WINDOWS = (30, 60, 90)
STD_MIN = 3
HL_MAX = 60                                                 # past this many sales the median (the same thing, near enough)


def files(lines_dir):
    return sorted(glob.glob(os.path.join(lines_dir, "base_*.jsonl.gz"))) + sorted(glob.glob(os.path.join(lines_dir, "*", "cl_lines_*.jsonl.gz")))


def load(lines_dir, graders=("psa", "cgc")):
    """Every page on file -> {pid: {"pcs", "read" (newest, YYYY-MM-DD), "reads", "cv": [(read, t, {gk: [value, conf,
    last sold, pop]})], "s": {gk: (days since 2000-01-01, prices)}}} - plain sales only (no qualifier / autograph),
    sorted by time, a sale on file twice counted once."""
    pages, parts = {}, {}
    for f in files(lines_dir):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                pid = r.get("pid")
                if not pid:
                    continue
                P = pages.setdefault(pid, {"pcs": set(), "read": "", "reads": [], "cv": [], "s": {}})
                if r.get("pc") is not None:
                    P["pcs"].add(r["pc"])
                rd = r.get("read") or ""
                P["reads"].append(rd)
                P["read"] = max(P["read"], rd)
                if r.get("cv"):
                    P["cv"].append((rd, r.get("t") or 0, r["cv"]))
                for gk, enc in (r.get("s") or {}).items():
                    if gk.split("|", 1)[0] not in graders or not enc:
                        continue
                    a = np.asarray(enc, dtype=np.float64)
                    parts.setdefault((pid, gk), []).append(np.column_stack([np.cumsum(a[:, 0]), a[:, 1], a[:, 2]]))
    for (pid, gk), L in parts.items():
        a = np.concatenate(L) if len(L) > 1 else L[0]
        if len(L) > 1:
            cents = np.round(a[:, 1] * 100)
            o = np.lexsort((cents, a[:, 0]))
            a, cents = a[o], cents[o]
            keep = np.ones(len(a), bool)
            keep[1:] = (a[1:, 0] != a[:-1, 0]) | (cents[1:] != cents[:-1])
            a = a[keep]
        a = a[a[:, 2] < 4]                                  # no qualifier, no autograph grade
        if len(a):
            pages[pid]["s"][gk] = ((a[:, 0] // 1440).astype(np.int32), a[:, 1].copy())
    for P in pages.values():
        P["cv"].sort(key=lambda x: (x[0], x[1]))
    return pages


def day_no(d):
    """YYYY-MM-DD (or a date) -> days since 2000-01-01."""
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return d.toordinal() - EPOCH_DAY


def day_str(n):
    return date.fromordinal(int(n) + EPOCH_DAY).isoformat()


_IU = {}


def hl(x):
    """Hodges-Lehmann estimate (the median of every pairwise average, each value with itself included); the median past
    HL_MAX values."""
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    if n == 0:
        return float("nan")
    if n == 1:
        return float(x[0])
    if n > HL_MAX:
        return float(np.median(x))
    iu = _IU.get(n)
    if iu is None:
        iu = _IU[n] = np.triu_indices(n)
    return float(np.median((x[:, None] + x[None, :])[iu] / 2))


def window(days, prices, end, span):
    """The sales of the span days ending on day end (inclusive)."""
    lo = np.searchsorted(days, end - span + 1, side="left")
    hi = np.searchsorted(days, end, side="right")
    return prices[lo:hi]


def standard(days, prices, end):
    """The standard price as of day end -> (price, window days, sales in it) or (None, None, n in 90 days)."""
    for span in WINDOWS:
        w = window(days, prices, end, span)
        if len(w) >= STD_MIN:
            return round(hl(w), 2), span, int(len(w))
    return None, None, int(len(window(days, prices, end, WINDOWS[-1])))


def last_month(days, prices, last_m):
    """Last calendar month (YYYY-MM): (Hodges-Lehmann of its sales or None, how many)."""
    y, m = int(last_m[:4]), int(last_m[5:7])
    a = day_no(date(y, m, 1))
    b = day_no(date(y + (m == 12), m % 12 + 1, 1)) - 1
    w = window(days, prices, b, b - a + 1)
    return (round(hl(w), 2) if len(w) else None), int(len(w))


def count(days, end, span):
    return int(np.searchsorted(days, end, side="right") - np.searchsorted(days, end - span + 1, side="left"))


def stats(days, prices, end):
    """The graded view's analysis columns from Card Ladder's sales, as of day end (the page's last read):
    {d7, d30, ts, pos, vol} in percent - d7 / d30: the median of the last 7 / 30 days against the 7 / 30 before (5+ / 3+
    sales in each); ts: the Theil-Sen slope of the last 90 days' sales (5+ sales over 30+ days), % a month; pos (Range
    90d): where the standard price sits between the lowest and highest 30-day price of the last 90 days (a point a
    week, 3+ sales behind each); vol (Volatility): how far a typical sale of the last 90 days sits from their median
    (the median absolute log distance, 5+ sales) - and [n7, n7 before, n30, n30 before, n90]."""
    out = {}
    n = []
    for key, w, mn in (("d7", 7, 5), ("d30", 30, 3)):
        now = window(days, prices, end, w)
        bef = window(days, prices, end - w, w)
        n += [int(len(now)), int(len(bef))]
        if len(now) >= mn and len(bef) >= mn:
            out[key] = round((float(np.median(now)) / float(np.median(bef)) - 1) * 100, 2)
    lo = np.searchsorted(days, end - 89, side="left")
    hi = np.searchsorted(days, end, side="right")
    d90, p90 = days[lo:hi], prices[lo:hi]
    n.append(int(len(p90)))
    if len(p90) >= 5 and int(d90[-1]) - int(d90[0]) >= 30:
        t = d90.astype(np.float64)
        L = np.log(p90)
        if len(p90) > 200:                                  # every pair of 200+ sales is a lot: an even sample keeps the slope
            k = np.linspace(0, len(p90) - 1, 200).astype(int)
            t, L = t[k], L[k]
        iu = np.triu_indices(len(t), 1)
        dt, dl = (t[None, :] - t[:, None])[iu], (L[None, :] - L[:, None])[iu]
        sl = dl[dt != 0] / dt[dt != 0]
        if sl.size:
            out["ts"] = round((float(np.exp(np.median(sl) * 30)) - 1) * 100, 2)
    if len(p90) >= 5:
        lm = np.log(p90)
        out["vol"] = round(float(np.median(np.abs(lm - np.median(lm)))) * 100, 2)
    pts = []
    for back in range(0, 90, 7):                            # a 30-day price a week over the last 90 days
        w = window(days, prices, end - back, 30)
        if len(w) >= STD_MIN:
            pts.append(hl(w))
    if len(pts) >= 4:
        lo_, hi_ = min(pts), max(pts)
        if hi_ > lo_:
            out["pos"] = round((pts[0] - lo_) / (hi_ - lo_) * 100, 2)
    return out, n


def value_now(P, gk):
    """Card Ladder's value of the grade at the page's newest read: [value, confidence, last sold, read] or None."""
    for rd, _, cv in reversed(P.get("cv") or []):
        v = cv.get(gk)
        if v and (v[0] is not None or v[2] is not None):
            return [v[0], v[1], v[2], rd]
    return None


def month_index(days):
    """days since 2000-01-01 -> year x 12 + month - 1 (numpy, vectorised)."""
    d = np.datetime64("2000-01-01") + np.asarray(days).astype("timedelta64[D]")
    return d.astype("datetime64[M]").astype(np.int64) + 1970 * 12


def ym_of(mi):
    return f"{int(mi) // 12}-{int(mi) % 12 + 1:02d}"


def monthly(days, prices):
    """[[YYYY-MM, n, Hodges-Lehmann], ...] - the Trend chart's Card Ladder line and Pre-Sales Spotcheck's months."""
    if not len(days):
        return []
    mi = month_index(days)
    cut = np.flatnonzero(np.diff(mi)) + 1
    out = []
    for a, b in zip(np.r_[0, cut], np.r_[cut, len(mi)]):
        out.append([ym_of(mi[a]), int(b - a), round(hl(prices[a:b]), 2)])
    return out
