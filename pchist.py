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
import json
import os
import re
import threading
from collections import OrderedDict
from datetime import datetime, timezone

SHARDS = 200
EPOCH_Y = 2000
VGPC = re.compile(r"VGPC\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*")
REFRESH_ACTIVE_D = 7                                        # a card with eBay data is re-read this often ...
REFRESH_OTHER_D = 30                                        # ... any other card this often
MISS_RETRY_D = 7                                            # a page with no history is tried again after this long

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
    return {"m0": m0, "p": p, "v": v, "n": len(price_pts or []) + len(vol_pts or [])}


def extract(html):
    """A card page -> (monthly record or None, note for the log)."""
    series = page_series(html)
    if not series:
        return None, "no VGPC series in the page"
    price, vol, how = pick(series)
    rec = monthly(price, vol)
    shape = {n: {k: len(v) for k, v in s.items()} for n, s in series.items()}
    first = {n: {k: v[:2] for k, v in s.items()} for n, s in series.items()}
    if len(SHAPES) < 3:
        if vol is None:                                      # where does the page keep the volume bars? show the clues
            names = sorted(set(VGPC.findall(html)))
            scripts = re.findall(r"<script[^>]*src=[\"']([^\"']+)", html)
            ctx = [re.sub(r"\s+", " ", html[max(0, m.start() - 70):m.start() + 90]) for m in re.finditer(r"volume", html, re.I)]
            calls = [re.sub(r"\s+", " ", html[max(0, m.start() - 80):m.start() + 120]) for m in re.finditer(r"(?:\$\.(?:get|ajax|getJSON)|fetch\(|XMLHttpRequest|/api/|chart-data|volume_data|sales-volume)", html)][:6]
            how += (f"; no volume series - VGPC names {names}; scripts {scripts}; 'volume' {len(ctx)}x: " + " || ".join(ctx[4:12])
                    + "; calls: " + " || ".join(calls))
        SHAPES.append({"shape": shape, "first": first, "how": how,
                       "months": None if rec is None else f"{month_label(rec['m0'])}..{month_label(rec['m0'] + len(rec['p']) - 1)}"})
    if rec is None:
        return None, f"series {json.dumps(shape)} carried no usable points"
    return rec, how


# ---------------- the store ----------------
def init(store):
    """Open the shard directory and build the index of what is on file. -> cards with a record."""
    global _store, _index, _miss
    _store = store
    os.makedirs(store, exist_ok=True)
    idx, n = {}, 0
    for sh in range(SHARDS):
        for cid, rec in _load(sh).items():
            idx[int(cid)] = day_of(rec.get("t"))
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


def _load(sh):
    if sh in _cache:
        _cache.move_to_end(sh)
        return _cache[sh]
    try:
        with gzip.open(_path(sh), "rt", encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        d = {}
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
        d[str(cid)] = dict(rec, t=today)
        _save(sh, d)
        _index[int(cid)] = day_index()
        _miss.pop(int(cid), None)
        _dirty.add(sh)


def get(cid):
    with _lock:
        return _load(shard_of(cid)).get(str(cid))


def stale(cid, active=False, today=None):
    """Does this card need its page read for the history? Never read, or read longer ago than its refresh."""
    today = day_index() if today is None else today
    cid = int(cid)
    last = _index.get(cid)
    if last is None:
        m = _miss.get(cid)
        return m is None or today - m >= MISS_RETRY_D
    return today - last >= (REFRESH_ACTIVE_D if active else REFRESH_OTHER_D)


def count():
    return len(_index)


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
        raw = gzip.compress(json.dumps(d, separators=(",", ":")).encode("utf-8"))
        out[f"pc/{sh}.bin"] = encrypt(raw)
    return out


def mark_all_dirty():
    """Every shard on file goes out with the next publish (a rebuilt live checkout, a fresh start)."""
    with _lock:
        for sh in range(SHARDS):
            if os.path.exists(_path(sh)):
                _dirty.add(sh)


def dirty_count():
    return len(_dirty)
