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
SALE_ROW = re.compile(r'<tr[^>]*>\s*<td class="date">\s*(\d{4}-\d{2}-\d{2})\s*</td>(.*?)<td class="title">(.*?)</td>\s*<td class="numeric">\s*(?:<span[^>]*>\s*)?\$([\d,]+(?:\.\d{2})?)', re.S)

_store = None
_index = {}                                                 # card id (int) -> day index of the last read
_miss = {}                                                  # card id -> day index of a read that found nothing
_cache = OrderedDict()                                      # shard -> dict, the few shards touched lately
_dirty = set()                                              # shards changed since the last publish
_lock = threading.Lock()
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
            idx[int(cid)] = (day_of(rec.get("t")), bool(rec.get("s")))
            n += 1
    with _lock:
        _index = idx
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
        sh = shard_of(cid)
        d = _load(sh)
        old = d.get(str(cid))
        if old and (old.get("s") or old.get("sv")) and not rec.get("s"):
            rec = keep_volume(old, rec)
        d[str(cid)] = dict(rec, t=today)
        _save(sh, d)
        _index[int(cid)] = (day_index(), bool(rec.get("s")))
        _miss.pop(int(cid), None)
        _dirty.add(sh)


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


def get(cid):
    with _lock:
        return _load(shard_of(cid)).get(str(cid))


def stale(cid, active=False, today=None, want_signed=False):
    """Does this card need its page read for the history? Never read, read longer ago than its refresh, or (with a
    working sign-in) read without the volume series."""
    today = day_index() if today is None else today
    cid = int(cid)
    last = _index.get(cid)
    if last is None:
        m = _miss.get(cid)
        return m is None or today - m >= MISS_RETRY_D
    day, signed = last
    if want_signed and not signed:
        return True
    if active and month_of_day(day) < month_of_day(today):   # a new month: last month's bar is final now, read it
        return True                                           # (Brett, 2026-10-13: "PC sales" shows last month's bar)
    return today - day >= (REFRESH_ACTIVE_D if active else REFRESH_OTHER_D)


def count():
    return len(_index)


def count_signed():
    return sum(1 for _, signed in _index.values() if signed)


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
        pub = {cid: ({k: v for k, v in rec.items() if k != "sl"} if "sl" in rec else rec) for cid, rec in d.items()}   # the posted sales stay on the data disk
        raw = gzip.compress(json.dumps(pub, separators=(",", ":")).encode("utf-8"))
        out[f"pc/{sh}.bin"] = encrypt(raw)
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


def dirty_count():
    return len(_dirty)
