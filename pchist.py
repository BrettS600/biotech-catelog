"""
pchist.py - PriceCharting's own price history for every card, as the chart on the card's page shows it
(Brett, 2026-10-12: "I want the exact graph that shows the ungraded price and total volume per month on
PriceCharting since the card was released").

The chart on a PriceCharting card page is drawn in the browser from data written into the page itself
(`VGPC.chart_data = {...}` and its companions), so the collector - which already opens every card's page for the
picture - reads those arrays at the same time and keeps, per card, one row per month: the ungraded price and the
total sales volume. Nothing is fetched from anywhere else and no API is involved.

Storage: shard files on the data disk (`<store>/<shard>.json.gz`, shard = card id % SHARDS), each
{card id: {"m0": first month (months since 2000-01), "p": [cents or null per month], "v": [sales per month],
"t": "YYYY-MM-DD" read, "n": raw points}}. The same shards go to the live branch encrypted with the site key
(`pc/<shard>.bin`), and the page fetches one shard when a card's chart is opened. An index {card id: day read}
stays in memory so the reader's plan knows which cards still need a page, or need a refresh (active cards weekly,
the rest monthly).

Graded data (2026-10-26, Brett: "Yes, please do" - save the graded data the card page already carries): the same read
keeps PriceCharting's monthly graded prices from chart_data ("g": {"g7", "g8", "g9", "g95", "psa10"}: grade 7, 8, 9,
9.5 and PSA 10, cents per month on the record's own months; grades 7-9.5 are PriceCharting's blend of every grader),
the PSA and CGC population report the page carries ("pop": {"psa": [grade 1..10], "cgc": [...]}), and the sold listings
of every graded table on the page ("gs": [[row id, date, cents, grade, grader, best offer 0/1, title], ...], newest
first, merged across reads, on the data disk only; grade "10" with the grader from the table's own label - PSA / CGC /
BGS / SGC / TAG / ACE 10, "10P" = CGC 10 Pristine, "10B" = BGS 10 Black - or 7 / 8 / 9 / 9.5 with the grader read off
the title), kept in their own files (<store>/gs/<card id % 1000>.json.gz). A grade's table shows its last 30 sales
only, so a card with a full table is re-read before its rows scroll off: after 70% of the table's span ("gdue" days,
1..29), when that comes before the normal refresh (2026-10-29, Brett: "re-read busy grades before their 30 listed
sales roll over" - a table spanning 10-40 days on a card without eBay data used to wait the full month). Rows first seen go to
a queue (pcg_queue.jsonl) that the collector writes out as pcg/<stamp>.bin chunks on the live branch; the graded lines
and the population report go out as pcgh/<shard>.bin; the Data archive workflow turns both into data/pricecharting/.

The page's variable names were not checked before the first deploy (pricecharting.com cannot be reached from
the build container): page_series() keeps every VGPC series it finds and pick() chooses the ungraded price and
the volume by name; the first pages read are logged with the names and the first points, so a wrong pick shows
up in the collector log at once.
"""
import gzip
import html as html_mod
import json
import os
import re
import threading
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

SHARDS = 200
EPOCH_Y = 2000
VGPC = re.compile(r"VGPC\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*")
REFRESH_ACTIVE_D = 7                                        # a card with eBay data is re-read this often ...
REFRESH_OTHER_D = 30                                        # ... any other card this often
MISS_RETRY_D = 7                                            # a page with no history is tried again after this long
# PriceCharting's posted ungraded sales (the "Ungraded Sold Listings" table on the card's page; 2026-10-25, Brett: "when
# you open price chart for a card, you see that there are many listings with radically different values. This would
# implicate an inaccurate price chart estimate. Maybe you can measure the variance ... and set a threshold"): the last
# sales kept with the record ("sl": [[date, cents, title], ...], newest first, on the data disk only) and their spread
# ("sp": {n, med, iqr, out, lo, hi, d} over the sales of the last SPREAD_WINDOW_D days, published with the shard)
SALES_KEEP = 20
SPREAD_WINDOW_D = 90
SPREAD_MIN_N = 6
# graded (2026-10-26)
GRADED_VERSION = 2                                          # records read by an older parser are re-read once
GRADE_SERIES = (("cib", "g7"), ("new", "g8"), ("graded", "g9"), ("boxonly", "g95"), ("manualonly", "psa10"))
GS_KEEP_D = 400                                             # graded sales kept on the data disk this long ...
GS_KEEP_N = 1500                                            # ... and at most this many per card (newest)
GS_FULL = 30                                                # a grade's table shows at most this many sales
GS_MIN_GRADE = 7                                            # the "Grade N" tables under this are not kept
GDUE_MIN_D, GDUE_MAX_D = 1, REFRESH_OTHER_D                 # a card with a full graded table spanning under GDUE_MAX_D / 0.7 days
GDUE_SHARE = 0.7                                            # is re-read after 70% of that span (1..29 days)
GS_COLS = ["card_id", "row_id", "date", "cents", "grade", "grader", "best_offer", "title"]
PAGE_DROP = ("sl", "gs", "g", "pop", "gv", "gdue", "guide", "guide_t")   # kept off the page's pc/<shard>.bin (the posted sales, the graded data)
GS_SHARDS = 1000                                            # the graded sales live in their own files (<store>/gs/<card id % 1000>.json.gz),
                                                            # so the hourly reads of every history shard stay light
OPTION = re.compile(r'<option value="completed-auctions-([a-z0-9-]+)"\s*>\s*([^<(]+?)\s*\((\d+)\)\s*</option>')
TABLE_DIV = re.compile(r'<div class="completed-auctions-([a-z0-9-]+)"[^>]*>')
GRADED_ROW = re.compile(r'<tr[^>]*?\bid="([^"]+)"[^>]*>\s*<td class="date">\s*(\d{4}-\d{2}-\d{2})\s*</td>(.*?)<td class="title">(.*?)</td>\s*'
                        r'<td class="numeric">(.*?)</td>', re.S)
PRICE = re.compile(r'\$([\d,]+(?:\.\d{2})?)')
GRADER = re.compile(r'\b(PSA|CGC|BGS|BECKETT|SGC|TAG|ACE|AGS|PCG|HGA|GMA|ISA|MNT|ARS)\b', re.I)
COMPANY_10 = re.compile(r'^(PSA|CGC|BGS|SGC|TAG|ACE|AGS)\s+10\b\s*(.*)$', re.I)
GRADE_N = re.compile(r'^Grade\s+(\d+(?:\.5)?)$', re.I)
SALE_ROW = re.compile(r'<tr[^>]*>\s*<td class="date">\s*(\d{4}-\d{2}-\d{2})\s*</td>(.*?)<td class="title">(.*?)</td>\s*<td class="numeric">\s*(?:<span[^>]*>\s*)?\$([\d,]+(?:\.\d{2})?)', re.S)

_store = None
_index = {}                                                 # card id (int) -> day index of the last read
_miss = {}                                                  # card id -> day index of a read that found nothing
_cache = OrderedDict()                                      # shard -> dict, the few shards touched lately
_dirty = set()                                              # shards changed since the last publish
_lock = threading.Lock()
_gq = []                                                    # graded sales first seen, not yet written out: [card id, *row]
_gdirty = set()                                             # shards whose graded lines / population changed since the last pcgh publish
_gstat = {"day": None, "new": 0, "by": {}, "cards": 0}      # today's graded intake, for the log
SHAPES = []                                                 # what the first pages carried, for the log


# ---------------- months ----------------
def day_index(d=None):
    d = d or datetime.now(timezone.utc)
    return (d - datetime(2000, 1, 1, tzinfo=timezone.utc)).days


def month_index(ts_ms):
    d = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
    return (d.year - EPOCH_Y) * 12 + d.month - 1


def month_label(i):
    return f"{EPOCH_Y + i // 12}-{i % 12 + 1:02d}"


def month_of_day(day):
    """day index (days since 2000-01-01) -> month index (months since 2000-01)."""
    d = datetime(2000, 1, 1, tzinfo=timezone.utc) + timedelta(days=day)
    return (d.year - EPOCH_Y) * 12 + d.month - 1


def last_complete_month(rec):
    """[month index, sales] for the latest month whose bar was complete when the volume was read: the month before
    the read date's month (the read's own month is still running). A month after the record's last point had no
    sales. None when the record carries no volume (read without the sign-in, nothing to keep)."""
    if not rec or not (rec.get("s") or rec.get("sv")):
        return None
    read = day_of(rec.get("sv") or rec.get("t"))
    if not read:
        return None
    target = month_of_day(read) - 1
    j = target - rec["m0"]
    if j < 0:
        return None
    return [target, rec["v"][j] if j < len(rec["v"]) else 0]


def last_month_all():
    """{card id: [month index, sales]} over every card on file with volume bars (Brett, 2026-10-13: "PC sales" =
    last month's bar, no more sales/yr ÷ 12). Reads every shard once; the few shards in the cache stay cached."""
    out = {}
    for sh in range(SHARDS):
        with _lock:
            d = _load(sh) if sh in _cache else _read(sh)
        for cid, rec in d.items():
            lm = last_complete_month(rec)
            if lm is not None:
                out[int(cid)] = lm
    return out


# ---------------- the page ----------------
def _is_pairs(v):
    return isinstance(v, list) and len(v) > 0 and all(
        isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in p)
        for p in v[:8])


def page_series(html):
    """Every `VGPC.<name> = <json>` in the page whose value is a series of [timestamp ms, number] pairs, or a
    dict of such series -> {name: {key: points}} (a bare list is filed under key "")."""
    dec = json.JSONDecoder()
    out = {}
    for m in VGPC.finditer(html):
        try:
            val, _ = dec.raw_decode(html, m.end())
        except ValueError:
            continue
        series = {}
        if _is_pairs(val):
            series[""] = val
        elif isinstance(val, dict):
            for k, v in val.items():
                if _is_pairs(v):
                    series[str(k)] = v
        if series:
            out[m.group(1)] = series
    return out


def pick(series):
    """(ungraded price points, volume points, how) from the page's series. The price is chart_data's "used"
    series (PriceCharting's word for ungraded on card pages); the volume is the series whose variable is named
    for it - a bare list as it is, a dict of grades summed (the chart's "total volume")."""
    price, vol, how = None, None, []
    cd = series.get("chart_data") or next((s for n, s in series.items() if "chart" in n.lower()), None)
    if cd:
        key = "used" if "used" in cd else next(iter(cd))
        price = cd[key]
        how.append(f"price = {'chart_data' if 'chart_data' in series else 'chart'}[{key!r}]")
    for name, s in series.items():
        if "volume" in name.lower() or "sales" in name.lower():
            if "" in s:
                vol = s[""]
                how.append(f"volume = {name}")
            else:
                acc = {}
                for k, pts in s.items():
                    for ts, n in pts:
                        acc[ts] = acc.get(ts, 0) + n
                vol = sorted(acc.items())
                how.append(f"volume = sum of {name}[{', '.join(s)}]")
            break
    return price, vol, "; ".join(how)


def monthly(price_pts, vol_pts, cents=None):
    """-> {"m0", "p", "v", "n"} with one entry per month from the first point to the last. The price of a month
    is its last point; the volume of a month is the sum of its points. Prices are kept in cents: when the page's
    values are whole numbers they already are (PriceCharting writes cents), fractions are dollars."""
    P, V = {}, {}
    for ts, val in sorted(price_pts or []):
        P[month_index(ts)] = val
    for ts, n in vol_pts or []:
        m = month_index(ts)
        V[m] = V.get(m, 0) + n
    if not P and not V:
        return None
    if cents is None:
        cents = all(float(v).is_integer() for v in P.values())
    m0, m1 = min(list(P) + list(V)), max(list(P) + list(V))
    p = [None if P.get(m0 + i) is None else int(round(P[m0 + i] if cents else P[m0 + i] * 100)) for i in range(m1 - m0 + 1)]
    v = [int(round(V.get(m0 + i, 0))) for i in range(m1 - m0 + 1)]
    rec = {"m0": m0, "p": p, "v": v, "n": len(price_pts or []) + len(vol_pts or [])}
    if vol_pts is not None:
        rec["s"] = 1                                         # the page carried the volume series: read signed in
    return rec


def sales_table(html):
    """The ungraded sold listings on a card page -> [[date, cents, title], ...] newest first (the page's own order), or
    None when the page has no such table. The div class="completed-auctions-used" holds one table: date, image,
    title, price, listed price, report."""
    i = html.find('<div class="completed-auctions-used"')
    if i < 0:
        return None
    seg = html[i:]
    j = seg.find("</table>")
    if j > 0:
        seg = seg[:j]
    out = []
    for m in SALE_ROW.finditer(seg):
        title = html_mod.unescape(re.sub(r"<[^>]+>", " ", m.group(3)))
        title = re.sub(r"^\[eBay\]\s*", "", re.sub(r"\s+", " ", title).strip())
        try:
            cents = int(round(float(m.group(4).replace(",", "")) * 100))
        except ValueError:
            continue
        out.append([m.group(1), cents, title[:60]])
    return out


def _plain(html_frag):
    t = html_mod.unescape(re.sub(r"<[^>]+>", " ", html_frag or ""))
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"^\[[^\]]{1,20}\]\s*", "", t)             # "[eBay] ...", "[Goldin] ..."
    return re.sub(r"\s*\[[^\]\[]{1,20}\]$", "", t)        # ... or "... [eBay]" at the end (2026-10-27: 18% of the rows)


def grade_of(label):
    """A sold-listings table's label -> (grade, grader): "PSA 10" -> ("10", "PSA"), "CGC 10 Prist." -> ("10P", "CGC"),
    "BGS 10 Black" -> ("10B", "BGS"), "Grade 9.5" -> ("9.5", None: read off each title); (None, None) for anything else."""
    label = (label or "").strip()
    m = COMPANY_10.match(label)
    if m:
        rest = m.group(2).lower()
        return ("10P" if rest.startswith("prist") else "10B" if rest.startswith("black") else "10"), m.group(1).upper()
    m = GRADE_N.match(label)
    if m:
        return m.group(1), None
    return None, None


def grader_of(title):
    m = GRADER.search(title or "")
    if not m:
        return ""
    g = m.group(1).upper()
    return "BGS" if g == "BECKETT" else g


def graded_tables(html):
    """Every graded sold-listings table on a card page -> ([[row id, date, cents, grade, grader, best offer, title], ...],
    {grade label: rows in its table}). The page lists the tables in a select (completed-auctions-<key> -> "PSA 10 (30)")
    and holds each in div class="completed-auctions-<key>" > table, rows tr#<source>-<id> (ebay / goldin / pwcc /
    heritage ...): date, image, title, the sale price (a best offer: the accepted price first, then the list price),
    listed price, report. The ungraded table is sales_table()'s; grades under GS_MIN_GRADE are skipped."""
    labels = {k: lab.strip() for k, lab, _ in OPTION.findall(html)}
    if not labels:
        return [], {}
    divs = list(TABLE_DIV.finditer(html))
    out, sizes = [], {}
    for n, m in enumerate(divs):
        key = m.group(1)
        if key == "used" or key not in labels:
            continue
        grade, grader = grade_of(labels[key])
        if grade is None:
            continue
        if grade[0].isdigit() and not grade.startswith("10") and float(grade) < GS_MIN_GRADE:
            continue
        end = divs[n + 1].start() if n + 1 < len(divs) else len(html)
        seg = html[m.end():end]
        if "<table" not in seg:
            continue
        j = seg.find("</table>")
        if j > 0:
            seg = seg[:j]
        rows = 0
        for r in GRADED_ROW.finditer(seg):
            pm = PRICE.search(r.group(5))
            if not pm:
                continue
            try:
                cents = int(round(float(pm.group(1).replace(",", "")) * 100))
            except ValueError:
                continue
            full = _plain(r.group(4))
            bo = 1 if "best offer accepted" in r.group(5).lower() else 0
            out.append([r.group(1)[:80], r.group(2), cents, grade, grader or grader_of(full), bo, full[:70]])   # the grader from the
                                                             # whole title (2026-10-27: read off the cut one, 11% of the rows had none)
            rows += 1
        sizes[labels[key]] = rows
    return out, sizes


def pop_report(html):
    """The population report the page carries (VGPC.pop_data = {"psa": [grade 1..10], "cgc": [...]}) or None."""
    m = re.search(r"VGPC\.pop_data\s*=\s*", html)
    if not m:
        return None
    try:
        val, _ = json.JSONDecoder().raw_decode(html, m.end())
    except ValueError:
        return None
    if not isinstance(val, dict):
        return None
    out = {}
    for k, v in val.items():
        if isinstance(v, list) and v and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v):
            out[str(k).lower()] = [int(x) for x in v]
    return out or None


def guide_key(label):
    """A row label of PriceCharting's Full Price Guide -> a column name: 'Grade 9.5' -> grade_9_5, 'BGS 10 Black' ->
    bgs_10_black, 'CGC 10 Pristine' -> cgc_10_pristine, 'Ungraded' -> ungraded."""
    return re.sub(r"[^a-z0-9]+", "_", str(label).lower()).strip("_")


def price_guide(html):
    """PriceCharting's "Full Price Guide" table on the card page (div#full-prices): {column: cents, or None where it
    prints "-"} - every row as the page labels it (Ungraded, Grade 1 ... 9.5, TAG 10, ACE 10, SGC 10, CGC 10, PSA 10,
    BGS 10, BGS 10 Black, CGC 10 Pristine). Grades 1 - 9.5 BLEND every grader; only the "<grader> 10" rows name one.
    Kept for the record (2026-10-29, at Brett's go-ahead); the graded view does not show it."""
    m = re.search(r'id=["\']full-prices["\']', html)
    if not m:
        return None
    end = html.find("</table>", m.end())
    if end < 0:
        return None
    out = {}
    for lab, val in re.findall(r"<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>", html[m.end():end], re.S):
        k = guide_key(_plain(lab))
        v = _plain(val).replace("$", "").replace(",", "").strip()
        if not k:
            continue
        try:
            out[k] = int(round(float(v) * 100))
        except ValueError:
            out[k] = None                                    # "-": PriceCharting has no price for that row
    return out or None


def graded_series(series, m0, length):
    """chart_data's graded lines -> {"g7": [cents|None per month], ...} on the record's months (m0, length); a line
    with no price at all is left out."""
    cd = series.get("chart_data") or {}
    out = {}
    for key, name in GRADE_SERIES:
        pts = cd.get(key)
        if not pts:
            continue
        P = {}
        for ts, val in sorted(pts):
            P[month_index(ts)] = val
        cents = all(float(v).is_integer() for v in P.values())
        arr = []
        for i in range(length):
            val = P.get(m0 + i)
            arr.append(None if not val or val <= 0 else int(round(val if cents else val * 100)))
        if any(x for x in arr):
            out[name] = arr
    return out


def graded_due(rows, sizes, today=None):
    """Days until the card's page should be read again for its graded sales: when a grade's table is full (GS_FULL
    rows), the next read should come before they scroll off - 70% of the span, 1 to 29 days (stale() takes the sooner
    of this and the card's normal refresh). None when no table is full or the busiest spans 43+ days."""
    best = None
    by = {}
    for r in rows:
        by.setdefault((r[3], r[4] if r[3].startswith("10") else ""), []).append(day_of(r[1]))
    full = {lab for lab, n in sizes.items() if n >= GS_FULL}
    if not full:
        return None
    for (grade, grader), days in by.items():
        if len(days) < GS_FULL:
            continue
        due = int((max(days) - min(days)) * GDUE_SHARE)
        if due >= GDUE_MAX_D:                                # the table spans 43+ days: the monthly refresh keeps up
            continue
        due = max(GDUE_MIN_D, due)
        best = due if best is None else min(best, due)
    return best


def spread(sales, today=None, window_d=SPREAD_WINDOW_D, min_n=SPREAD_MIN_N):
    """How far apart PriceCharting's recent ungraded sales sit: over the sales of the last window_d days (at least
    min_n of them) the median in cents, the interquartile range as a share of the median (0.5 = the middle half of the
    sales spans half the median), the share of sales outside 60-140% of the median, the lowest and highest, the days
    the sales span. None with too few sales."""
    today = day_index() if today is None else today
    recent = [c for d, c, *_ in (sales or []) if c > 0 and today - day_of(d) <= window_d]
    if len(recent) < min_n:
        return None
    s = sorted(recent)
    n = len(s)
    med = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0
    q1, q3 = s[int(round(0.25 * (n - 1)))], s[int(round(0.75 * (n - 1)))]
    days = [day_of(d) for d, c, *_ in (sales or []) if c > 0 and today - day_of(d) <= window_d]
    return {"n": n, "med": int(round(med)), "iqr": round((q3 - q1) / med, 3) if med else None,
            "out": round(sum(1 for c in s if c < 0.6 * med or c > 1.4 * med) / n, 3), "lo": s[0], "hi": s[-1], "d": max(days) - min(days)}


def extract(html):
    """A card page -> (monthly record or None, note for the log). The record carries the posted sales and their
    spread when the page has the sold-listings table (2026-10-25)."""
    series = page_series(html)
    sales = sales_table(html)
    if not series:
        return None, "no VGPC series in the page"
    price, vol, how = pick(series)
    if vol is None and re.search(r"VGPC\.volume_data\s*=", html):   # the variable is there but holds no points: a card
        vol, how = [], how + "; volume_data present but empty"      # with no sales, read signed in (not a lost sign-in)
    rec = monthly(price, vol)
    if rec is not None:                                      # the graded data on the same page (2026-10-26)
        try:
            g = graded_series(series, rec["m0"], len(rec["p"]))
            if g:
                rec["g"] = g
            pop = pop_report(html)
            if pop:
                rec["pop"] = pop
            guide = price_guide(html)
            if guide:
                rec["guide"] = guide
            gs, sizes = graded_tables(html)
            rec["gs"] = gs
            gd = graded_due(gs, sizes)
            if gd:
                rec["gdue"] = gd
            rec["gv"] = GRADED_VERSION
            how += f"; graded: {len(g)} lines, {len(gs)} sales in {len(sizes)} tables" + (", pop" if pop else "") + (", guide" if guide else "") + (f", due {gd} d" if gd else "")
        except Exception as e:                               # never lose the ungraded record over the graded part
            how += f"; graded parse failed: {str(e)[:80]}"
    if rec is not None and sales is not None:
        rec["sl"] = sales[:SALES_KEEP]
        sp = spread(sales)
        if sp is not None:
            rec["sp"] = sp
        how += f"; {len(sales)} posted sales" + (f", spread iqr {sp['iqr']}" if sp else "")
    shape = {n: {k: len(v) for k, v in s.items()} for n, s in series.items()}
    first = {n: {k: v[:2] for k, v in s.items()} for n, s in series.items()}
    if len(SHAPES) < 3:
        if vol is None:                                      # where does the page keep the volume bars? show the clues
            names = sorted(set(VGPC.findall(html)))
            scripts = re.findall(r"<script[^>]*src=[\"']([^\"']+)", html)
            ctx = [re.sub(r"\s+", " ", html[max(0, m.start() - 70):m.start() + 90]) for m in re.finditer(r"volume", html, re.I)]
            calls = [re.sub(r"\s+", " ", html[max(0, m.start() - 80):m.start() + 120]) for m in re.finditer(r"(?:\$\.(?:get|ajax|getJSON)|fetch\(|XMLHttpRequest|/api/|chart-data|volume_data|sales-volume)", html)][:6]
            how += (f"; no volume series - VGPC names {names}; scripts {scripts}; 'volume' {len(ctx)}x: " + " || ".join(ctx[4:12])
                    + "; calls: " + " || ".join(calls) + "; " + probe_js())
        SHAPES.append({"shape": shape, "first": first, "how": how,
                       "months": None if rec is None else f"{month_label(rec['m0'])}..{month_label(rec['m0'] + len(rec['p']) - 1)}"})
    if rec is None:
        return None, f"series {json.dumps(shape)} carried no usable points"
    return rec, how


PROBED = []


def probe_js():
    """Once: read PriceCharting's chart script and show where it gets the volume bars from (a one-time clue for the
    log, while the page itself carries no volume series)."""
    if PROBED:
        return PROBED[0]
    try:
        import requests
        r = requests.get("https://www.pricecharting.com/js/market_ae.js", timeout=15,
                         headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) personal card check"})
        js = r.text
        ctx = [re.sub(r"\s+", " ", js[max(0, m.start() - 160):m.start() + 200]) for m in re.finditer(r"volume", js, re.I)][:8]
        urls = sorted(set(re.findall(r"[\"'](/[a-z0-9_\-/]*(?:chart|volume|sales|history|price)[a-z0-9_\-/.]*)[\"'?]", js, re.I)))[:20]
        PROBED.append(f"market_ae.js ({r.status_code}, {len(js)} chars): 'volume' {len(re.findall('volume', js, re.I))}x: " + " || ".join(ctx) + f"; urls {urls}")
    except Exception as e:
        PROBED.append(f"market_ae.js could not be read ({str(e)[:80]})")
    return PROBED[0]


# ---------------- the store ----------------
def init(store):
    """Open the shard directory and build the index of what is on file. -> cards with a record."""
    global _store, _index, _miss
    _store = store
    os.makedirs(store, exist_ok=True)
    idx, n = {}, 0
    for sh in range(SHARDS):
        for cid, rec in _load(sh).items():
            idx[int(cid)] = (day_of(rec.get("t")), bool(rec.get("s")), rec.get("gv") or 0, rec.get("gdue"))
            n += 1
    q = []
    try:
        with open(os.path.join(store, "pcg_queue.jsonl"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    q.append(json.loads(line))
    except FileNotFoundError:
        pass
    except Exception:
        pass
    with _lock:
        _index = idx
        _gq[:] = q
    return n


def day_of(date_str):
    try:
        return day_index(datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc))
    except Exception:
        return 0


def shard_of(cid):
    return int(cid) % SHARDS


def _path(sh):
    return os.path.join(_store, f"{sh}.json.gz")


def _read(sh):
    """A shard from disk, without touching the cache."""
    try:
        with gzip.open(_path(sh), "rt", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _load(sh):
    if sh in _cache:
        _cache.move_to_end(sh)
        return _cache[sh]
    d = _read(sh)
    _cache[sh] = d
    while len(_cache) > 12:
        _cache.popitem(last=False)
    return d


def _save(sh, d):
    tmp = _path(sh) + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(d, f, separators=(",", ":"))
    os.replace(tmp, _path(sh))


def file(cid, rec, today=None):
    """Keep a card's record (rec from extract(); None = the page had none)."""
    today = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        if rec is None:
            _miss[int(cid)] = day_index()
            return
        rec = dict(rec)                                      # the caller's record is left as it was
        sh = shard_of(cid)
        d = _load(sh)
        old = d.get(str(cid))
        if old and (old.get("s") or old.get("sv")) and not rec.get("s"):
            rec = keep_volume(old, rec)
        rec = keep_graded(cid, old, rec, today)
        gs = rec.pop("gs", None)
        if gs is not None:                                   # the merged graded sales go to their own file
            gd = _gs_read(int(cid) % GS_SHARDS)
            if gs:
                gd[str(cid)] = gs
            else:
                gd.pop(str(cid), None)
            _gs_save(int(cid) % GS_SHARDS, gd)
        d[str(cid)] = dict(rec, t=today)
        _save(sh, d)
        _index[int(cid)] = (day_index(), bool(rec.get("s")), rec.get("gv") or 0, rec.get("gdue"))
        _miss.pop(int(cid), None)
        _dirty.add(sh)
        if rec.get("g") or rec.get("pop") or rec.get("guide"):
            _gdirty.add(sh)


def keep_volume(old, new):
    """A page read without the sign-in (it lapsed, or the cookie was replaced by a bad one) must not wipe the bars a
    signed read gave: the new prices with the old volume for the months the old record covered, and "sv" = the day
    that volume was read (the page says so). The record counts as unsigned, so a working sign-in re-reads it."""
    v = list(new["v"])
    for k in range(len(v)):
        j = new["m0"] + k - old["m0"]
        if 0 <= j < len(old["v"]):
            v[k] = old["v"][j]
    return dict(new, v=v, sv=old.get("sv") or old.get("t"))


def keep_graded(cid, old, new, today):
    """Merge the graded sales of a read with the ones on file (dedupe by row id, newest first, GS_KEEP_D days and
    GS_KEEP_N rows at most) and queue the rows not seen before. A read that carried no graded parse keeps the old
    graded fields. Called under _lock."""
    old = old or {}
    if new.get("guide"):                                     # the day the guide table was read (a kept one keeps its own)
        new["guide_t"] = today
    elif old.get("guide_t"):
        new["guide_t"] = old["guide_t"]
    if not new.get("gv"):
        for k in ("g", "pop", "guide", "gv", "gdue"):
            if k in old and k not in new:
                new[k] = old[k]
        new.pop("gs", None)
        return new
    for k in ("g", "pop", "guide"):                          # a page that lost a line or the report keeps the last one
        if k not in new and k in old:
            new[k] = old[k]
    cutoff = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=GS_KEEP_D)).strftime("%Y-%m-%d")
    olds = [list(r) for r in (_gs_read(int(cid) % GS_SHARDS).get(str(cid)) or old.get("gs") or [])]
    seen = {r[0] for r in olds}
    now = {r[0]: r for r in (new.get("gs") or [])}
    mended = []                                              # rows filed without a grader that this read names one for
    for r in olds:                                           # (2026-10-27: the first ~150 cards were read with the grader
        n = now.get(r[0])                                    # taken off the cut title); queued again, the archive keeps
        if n and not r[4] and n[4]:                          # the later copy
            r[4], r[6] = n[4], n[6]
            mended.append(r)
    fresh = [r for r in (new.get("gs") or []) if r[0] not in seen and r[1] >= cutoff]
    merged = sorted(olds + fresh, key=lambda r: r[1], reverse=True)
    new["gs"] = [r for r in merged if r[1] >= cutoff][:GS_KEEP_N]
    if mended:
        rows = [[int(cid)] + list(r) for r in mended]
        _gq.extend(rows)
        try:
            with open(os.path.join(_store, "pcg_queue.jsonl"), "a", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r, separators=(",", ":")) + "\n")
        except Exception:
            pass
    if fresh:
        rows = [[int(cid)] + list(r) for r in fresh]
        _gq.extend(rows)
        try:
            with open(os.path.join(_store, "pcg_queue.jsonl"), "a", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r, separators=(",", ":")) + "\n")
        except Exception:
            pass
        if _gstat["day"] != today:
            _gstat.update(day=today, new=0, by={}, cards=0)
        _gstat["new"] += len(fresh)
        _gstat["cards"] += 1
        for r in fresh:
            k = (r[4] + " " if r[4] else "") + r[3]
            _gstat["by"][k] = _gstat["by"].get(k, 0) + 1
    return new


def _gs_path(gsh):
    return os.path.join(_store, "gs", f"{gsh}.json.gz")


def _gs_read(gsh):
    try:
        with gzip.open(_gs_path(gsh), "rt", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _gs_save(gsh, d):
    os.makedirs(os.path.join(_store, "gs"), exist_ok=True)
    tmp = _gs_path(gsh) + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(d, f, separators=(",", ":"))
    os.replace(tmp, _gs_path(gsh))


def graded_sales(cid):
    """The graded sales on file for a card (newest first) - [[row id, date, cents, grade, grader, best offer, title], ...]."""
    with _lock:
        return _gs_read(int(cid) % GS_SHARDS).get(str(cid)) or []


def graded_queued():
    with _lock:
        return len(_gq)


def write_graded_chunk(folder, encrypt, stamp, keep_d=10):
    """Write the queued graded sales as <folder>/<stamp>.bin (gzip JSON {"cols", "rows"} through encrypt) and drop
    chunks older than keep_d days from the folder; the next publish commits both. -> rows written."""
    with _lock:
        rows = list(_gq)
        if not rows:
            return 0
        os.makedirs(folder, exist_ok=True)
        raw = gzip.compress(json.dumps({"cols": GS_COLS, "rows": rows}, separators=(",", ":")).encode("utf-8"))
        tmp = os.path.join(folder, f"{stamp}.bin.tmp")
        with open(tmp, "wb") as f:
            f.write(encrypt(raw))
        os.replace(tmp, os.path.join(folder, f"{stamp}.bin"))
        _gq.clear()
        try:
            open(os.path.join(_store, "pcg_queue.jsonl"), "w").close()
        except Exception:
            pass
    cut = (datetime.now(timezone.utc) - timedelta(days=keep_d)).strftime("%Y%m%d")
    for name in os.listdir(folder):
        if name.endswith(".bin") and name[:8].isdigit() and name[:8] < cut:
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass
    return len(rows)


def graded_summary():
    """For the hourly log line: cards read for grades, today's new graded sales by grade."""
    with _lock:
        n = sum(1 for v in _index.values() if len(v) > 2 and v[2] >= GRADED_VERSION)
        hot = sum(1 for v in _index.values() if len(v) > 3 and v[3])
        st = dict(_gstat)
        q = len(_gq)
    top = sorted(st["by"].items(), key=lambda kv: -kv[1])[:6] if st["by"] else []
    return (f"graded: {n:,} cards read with the graded parser ({hot:,} re-read early for busy graded tables); "
            f"{st['new']:,} graded sales new today on {st['cards']:,} cards" + (" (" + ", ".join(f"{k} {v}" for k, v in top) + ")" if top else "")
            + f", {q:,} waiting to be written out")


def get(cid):
    with _lock:
        return _load(shard_of(cid)).get(str(cid))


def stale(cid, active=False, today=None, want_signed=False, want_graded=False):
    """Does this card need its page read for the history? Never read, read longer ago than its refresh, (with a
    working sign-in) read without the volume series, (want_graded) read by an older parser than the graded one, or
    due early because a graded table is busy (gdue)."""
    today = day_index() if today is None else today
    cid = int(cid)
    last = _index.get(cid)
    if last is None:
        m = _miss.get(cid)
        return m is None or today - m >= MISS_RETRY_D
    day, signed = last[0], last[1]
    gv = last[2] if len(last) > 2 else 0
    gdue = last[3] if len(last) > 3 else None
    if want_signed and not signed:
        return True
    if want_graded and (gv or 0) < GRADED_VERSION:
        return True
    if active and month_of_day(day) < month_of_day(today):   # a new month: last month's bar is final now, read it
        return True                                           # (Brett, 2026-10-13: "PC sales" shows last month's bar)
    refresh = REFRESH_ACTIVE_D if active else REFRESH_OTHER_D
    if gdue:
        refresh = min(refresh, gdue)
    return today - day >= refresh


def count():
    return len(_index)


def count_signed():
    return sum(1 for v in _index.values() if v[1])


def publish_files(encrypt):
    """The shards changed since the last call, as {"pc/<shard>.bin": bytes} ready for the live branch
    (encrypt = the live-file encryptor, taking gzip bytes)."""
    with _lock:
        todo = sorted(_dirty)
        _dirty.clear()
    out = {}
    for sh in todo:
        with _lock:
            d = _load(sh)
        pub = {cid: {k: v for k, v in rec.items() if k not in PAGE_DROP} for cid, rec in d.items()}   # the posted sales stay on the data disk;
        raw = gzip.compress(json.dumps(pub, separators=(",", ":")).encode("utf-8"))                  # the graded fields go out in pcgh/
        out[f"pc/{sh}.bin"] = encrypt(raw)
    return out


def graded_dirty_count():
    with _lock:
        return len(_gdirty)


def publish_graded_hist(encrypt):
    """The shards whose graded lines or population report changed, as {"pcgh/<shard>.bin": bytes}: per card {m0, g, pop, guide,
    t} only (the page never reads them - they are for the Data archive, published every few hours so the live branch is
    not pushed 20 MB every ten minutes during a full pass)."""
    with _lock:
        todo = sorted(_gdirty)
        _gdirty.clear()
    out = {}
    for sh in todo:
        with _lock:
            d = _load(sh)
        pub = {cid: {k: rec[k] for k in ("m0", "g", "pop", "guide", "guide_t", "t") if k in rec} for cid, rec in d.items() if rec.get("g") or rec.get("pop") or rec.get("guide")}
        raw = gzip.compress(json.dumps(pub, separators=(",", ":")).encode("utf-8"))
        out[f"pcgh/{sh}.bin"] = encrypt(raw)
    return out


def spreads_all():
    """{card id: the spread record} over every card on file whose page carried enough posted sales, plus the day it
    was read. Reads every shard once (like last_month_all)."""
    out = {}
    for sh in range(SHARDS):
        with _lock:
            d = _load(sh) if sh in _cache else _read(sh)
        for cid, rec in d.items():
            sp = rec.get("sp")
            if sp:
                out[int(cid)] = dict(sp, t=rec.get("t"))
    return out


def mark_all_dirty():
    """Every shard on file goes out with the next publish (a rebuilt live checkout, a fresh start)."""
    with _lock:
        for sh in range(SHARDS):
            if os.path.exists(_path(sh)):
                _dirty.add(sh)
                _gdirty.add(sh)                              # pcgh/ too (skipped for shards with no graded card)


def dirty_count():
    return len(_dirty)
