"""forecast_math.py - the Forecast tab's arithmetic in Python, no sklearn (Brett, 2026-10-23: the "forecast hits only"
alert toggle, the collector's monthly archive of the standard plans, the Forecast history replay).

Every function here mirrors one in page/app.js's Forecast section and must give the same number: bucket() = fcBucket,
table() = fcTable, net() = fcNet, break_even() = fcBreakEven, cdf() = fcCdf, draw() = fcDraw, dist() = fcDist,
levels() = fcLevels (the two guards), listing_chance() = fcListing (the Raw Data column, the alerts' filter), plan() =
fcCompute (the picks and the greedy allocation), monte_carlo() = fcMonteCarlo (the same linear-congruential generator
and Gaussian copula, so the basket figures match the page draw for draw). ut/test_forecast_math.py checks them
against the page on one fixture.

The model file (forecast.bin, the site workflow builds it daily) is gzip(JSON) encrypted with the live key:
{t, m, month, model, regime {up, confirm, reg1, reg3, ...}, cols, cards {cid: [price, buy, pred1, pct1, pred3, pct3, pred6,
pct6, ..., dev12, m12]}, calib {quantiles, tables {"h|regime|bucket": {q, mean, p_up, n}}}}. Version 2 (2026-10-24,
data/research/FINDINGS.md): pct is the card's rank by how far its price sits below its own 12-month mean (the same for
every hold), the bucket is top10 / b90 / b75 / b50 of that rank, the regime is "up" when the trailing 3-month median
market move is positive and "down" otherwise, and the tables are the realized gross returns by hold x regime x bucket.
The card stats are the collector's own (A = eBay's sold median, A_n the sales behind it, k the comparable sales in the
30-day window, cred the credible copies cheapest first [[item id, effective total], ...], book the copies listed
[[item id, total, ...], ...]).
"""
import gzip, json, math

P_CAP = 0.95                     # no stated chance above this: the measured ranges end at the 5th percentile
MIN_VOL12 = 6                    # a card needs six PriceCharting sales in its last twelve months
BO_HAIRCUT = 0.90                # a Best Offer listing counts at 90% of its ask (ebay_sweep.BO_HAIRCUT); an LP copy at its NM-equivalent (the card's lpd)
RHO = 0.5                        # share of each pick's variance that is the market's (the Monte Carlo's copula)
BUCKETS = ("b50", "b75", "b90", "top10")
# the constants of the archived plans and the history replay (Brett, 2026-10-23: "fees included held constant 14.1% +
# $5.20 where i assume 0% buy tax ... price range held constant ($50 to $500) ... buy only at 50% or better")
STD_FEES = {"fee": 0.1325 * 1.065, "fixed": 0.40, "shipOut": 4.50, "supplies": 0.30, "tax": 0.0}
STD_INPUTS = {"pmin": 50.0, "pmax": 500.0, "share": 0.2, "minp": 0.5, "young": False, "untracked": False, "copies": 1, "recent": True, "gate": True}
STD_CAPS = (500, 1000, 5000, 10000, 25000)
STD_HOLDS = (1, 3, 6)
STD_DISCS = (0.0, 0.2)


def decrypt_doc(blob, key):
    """forecast.bin -> the model document (key = the 32-byte live key, es.live_key(password))."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return json.loads(gzip.decompress(AESGCM(key).decrypt(blob[:12], blob[12:], None)))


def col_index(doc):
    return {k: i for i, k in enumerate(doc["cols"])}


def bucket(pct):
    return "top10" if pct >= .9 else "b90" if pct >= .75 else "b75" if pct >= .5 else "b50"


def regime_word(doc):
    """"up" / "down" (version 2: the sign of the trailing 3-month market move); a version-1 file's "strong" / "other"."""
    R = doc["regime"]
    if "up" in R:
        return "up" if R["up"] else "down"
    return "strong" if R.get("strong") else "other"


def table(doc, h, b):
    """The realized-return quantile grid for (horizon, the market's regime, bucket); None when the file has none."""
    cal = doc.get("calib")
    if not cal:
        return None
    return cal["tables"].get(f"{h}|{regime_word(doc)}|{b}") or cal["tables"].get(f"{h}|all|all")


def net(buy, r, S, disc, sell):
    """Net profit per copy at a gross return r: the sale from the sell level, the cost from the buy price."""
    return sell * (1 + r) * (1 - S["fee"]) - S["fixed"] - S["shipOut"] - S["supplies"] - buy * (1 - disc) * (1 + S["tax"])


def break_even(buy, S, disc, sell):
    return (buy * (1 - disc) * (1 + S["tax"]) + S["fixed"] + S["shipOut"] + S["supplies"]) / (sell * (1 - S["fee"])) - 1


def cdf(qs, tab, r):
    """P(return <= r) from the quantile grid, the tails extended linearly."""
    q = tab["q"]
    n = len(q)
    if r <= q[0]:
        return max(0.0, qs[0] - qs[0] * (q[0] - r) / max(1e-6, q[1] - q[0]))
    if r >= q[n - 1]:
        return min(1.0, qs[n - 1] + (1 - qs[n - 1]) * (r - q[n - 1]) / max(1e-6, q[n - 1] - q[n - 2]))
    i = 0
    while i < n - 1 and q[i + 1] < r:
        i += 1
    return qs[i] + (qs[i + 1] - qs[i]) * (r - q[i]) / max(1e-9, q[i + 1] - q[i])


def draw(qs, tab, u):
    """A return at probability u (the inverse of the grid)."""
    q = tab["q"]
    n = len(q)
    if u <= qs[0]:
        return q[0] - (q[1] - q[0]) * (qs[0] - u) / qs[0]
    if u >= qs[n - 1]:
        return q[n - 1] + (q[n - 1] - q[n - 2]) * (u - qs[n - 1]) / (1 - qs[n - 1])
    i = 0
    while i < n - 1 and qs[i + 1] < u:
        i += 1
    return q[i] + (q[i + 1] - q[i]) * (u - qs[i]) / (qs[i + 1] - qs[i])


def dist(qs, tab, buy, S, disc, sell):
    """The copy's net at the 10th / 50th / 90th percentile, its mean, and P(net > 0)."""
    at = lambda p: tab["q"][qs.index(p)]
    return {"lo": net(buy, at(0.1), S, disc, sell), "med": net(buy, at(0.5), S, disc, sell), "hi": net(buy, at(0.9), S, disc, sell),
            "mean": net(buy, tab["mean"], S, disc, sell), "p": min(P_CAP, 1 - cdf(qs, tab, break_even(buy, S, disc, sell)))}


def levels(c, pc_buy, min_sales, skip=None):
    """What a copy costs (buy) and the level the sale is projected from (sell), with the two guards of 2026-10-23:
    (1) eBay's sold median counts only with min_sales behind it (the gate's ANCHOR_MIN, 5), else the sale is projected
    from PriceCharting's level capped by the floor; (2) the sale must undercut the cheapest competing credible copy -
    the one bought leaves the market. skip = the listing being bought (not competition): the floor copy by default."""
    c = c or {}
    cred = c.get("cred") or []
    L = cred[0][1] if cred else None
    n = c.get("A_n") or 0
    a_ok = c.get("A") is not None and n >= min_sales
    buy = L if L is not None else c["A"] if a_ok else pc_buy
    src = "eBay floor" if L is not None else "eBay sold median" if a_ok else "PriceCharting"
    sell = c["A"] if a_ok else min(pc_buy, L) if L is not None else pc_buy
    why = "A" if a_ok else "thin" if c.get("A") is not None else "pc"
    skip_id = skip if skip is not None else (cred[0][0] if cred else None)
    comp = next((e for e in cred if e[0] != skip_id), None)
    if comp and comp[1] < sell:
        sell, why = comp[1], "ask"
    return {"buy": buy, "sell": sell, "src": src, "why": why, "A": c.get("A"), "An": n, "comp": comp[1] if comp else None}


def listing_chance(doc, ix, cards, cid, total, iid, h, S, min_sales):
    """fcListing: the chance of a profit buying this listing at its own price and holding h months; None when the
    model has no score for the card or the listing has no price."""
    if not doc or total is None or not total > 0:
        return None
    a = doc["cards"].get(str(cid))
    if not a:
        return None
    pct = a[ix["pct%d" % h]]
    if pct is None:
        return None
    tab = table(doc, h, bucket(pct))
    if not tab:
        return None
    lv = levels((cards or {}).get(str(cid)), a[ix["buy"]], min_sales, iid)
    return round(dist(doc["calib"]["quantiles"], tab, total, S, 0.0, lv["sell"]).get("p") * 1000) / 1000


def book_eff(b, c):
    """What a book copy costs on the floor's own basis: a Best Offer listing at 90% of its ask, an LP copy at its
    NM-equivalent (the card's lpd). b = a book entry [id, total, item, ship, tcond, bo, ...]."""
    if b[1] is None:
        return None
    lpd = ((c or {}).get("lpd") or 0) / 100.0
    e = b[1] * (BO_HAIRCUT if len(b) > 5 and b[5] else 1.0)
    return e / (1 - lpd) if len(b) > 4 and b[4] == "LP" and lpd < 1 else e


def supply_at(c, price):
    """The open copies at or under the plan's price (Brett, 2026-10-25: "if it says 3, then it shows 3 listings"): their
    number, the dearest's asking total, the cheapest ask of all, their ids. None without a book."""
    book = (c or {}).get("book")
    if book is None:
        return None
    at = [b for b in book if (lambda e: e is not None and e <= price + 0.005)(book_eff(b, c))]
    asks = [b[1] for b in book if b[1] is not None]
    return {"n": len(at), "dear": max((b[1] for b in at), default=None), "cheapest": min(asks, default=None), "ids": [b[0] for b in at]}


def plan(doc, cards, S, inputs, band, min_sales, names=None):
    """fcCompute: every ranked card in the price band with enough history and known supply gets its chance; cards at or
    above the bar get money best chance first (the share cap, the copies-per-card cap, the eBay supply, the money
    left) - unless the gate is on and the market is down, when nothing is bought. inputs: cap, h, disc, pmin, pmax,
    share, minp, young, untracked, copies (per card, default 1), recent (a card needs an eBay sale in the collector's
    30-day window, default True; a replay stub with "supply" is exempt), gate (default True). names: {cid: (name, set)}
    for the rows (optional). Returns {rows, picks, spent, gated} with rows in buy order (chance, then rank).
    Supply (2026-10-25) = the open copies at or under the plan's price for the card, buy x (1 - disc), on the floor's
    basis (supply_at); a card with none stays in the rows (so the page can say so) but gets no money."""
    ix = col_index(doc)
    qs = doc["calib"]["quantiles"]
    I = inputs
    copies = int(I.get("copies", 1) or 1)
    gated = bool(I.get("gate", True)) and regime_word(doc) in ("down", "other") and "up" in doc["regime"]
    rows = []
    for cid, a in doc["cards"].items():
        pc_buy, pct, age, vol12 = a[ix["buy"]], a[ix["pct%d" % I["h"]]], a[ix["age"]], a[ix["vol12"]] or 0
        if pc_buy is None or pct is None:
            continue
        c = (cards or {}).get(str(cid))
        lv = levels(c, pc_buy, min_sales)
        buy, sell = lv["buy"], lv["sell"]
        if not (I["pmin"] <= buy <= I["pmax"]) or vol12 < MIN_VOL12:
            continue
        if not I["young"] and not (age is not None and age >= 24):
            continue
        supply, ask, dear = None, None, None
        book = (c or {}).get("book")
        if c and c.get("supply") is not None:              # the history replay: a supply from PriceCharting's monthly sales (no book then)
            supply = c["supply"]
        elif c and book is not None and band[0] <= buy <= band[1]:
            sa = supply_at(c, buy * (1 - I["disc"]))
            supply, ask, dear = sa["n"], sa["cheapest"], sa["dear"]
        if supply is None and not I["untracked"]:
            continue
        if I.get("recent", True) and c and c.get("supply") is None and not ((c.get("k") or 0) >= 1):
            continue                                        # no comparable eBay sale in the window: nobody is buying it
        b = bucket(pct)
        tab = table(doc, I["h"], b)
        if not tab:
            continue
        d = dist(qs, tab, buy, S, I["disc"], sell)
        nm = (names or {}).get(int(cid)) or ("", "")
        rows.append(dict(d, cid=int(cid), name=nm[0], set=nm[1], price=a[ix["price"]], pc_buy=pc_buy, buy=buy, sell=sell, src=lv["src"], why=lv["why"],
                         A=lv["A"], An=lv["An"], ask=ask, supply=supply, dear=dear, pct=pct, bucket=b, tab=tab, age=age, vol12=vol12, qty=0))
    rows.sort(key=lambda r: (-round(r["p"] * 100), -r["pct"]))
    elig = [r for r in rows if r["p"] >= I["minp"]]
    left = I["cap"]
    if not gated:
        for r in elig:
            cost = r["buy"] * (1 - I["disc"]) * (1 + S["tax"])
            q = min(math.floor(I["cap"] * I["share"] / cost), copies)
            if r["supply"] is not None:
                q = min(q, r["supply"])
            q = min(q, math.floor(left / cost))
            if q > 0:
                r["qty"] = q
                left -= q * cost
    return {"rows": rows, "picks": [r for r in elig if r["qty"] > 0], "spent": I["cap"] - left, "gated": gated}


def _phi(z):
    t = 1 / (1 + 0.2316419 * abs(z))
    d = 0.3989423 * math.exp(-z * z / 2)
    p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
    return 1 - p if z > 0 else p


def actual_net(picks, S, disc, y_of):
    """The realized net of a basket: each pick sold at its own realized return (y_of(cid) -> gross return, or None when
    the hold is not up yet); None when any pick's outcome is missing."""
    total = 0.0
    for r in picks:
        y = y_of(r["cid"])
        if y is None:
            return None
        total += r["qty"] * net(r["buy"], y, S, disc, r["sell"])
    return total


def monte_carlo(qs, picks, S, disc, n=3000, rho=RHO, seed=12345):
    """fcMonteCarlo: the basket's net over n pretend holds - one market draw shared by every pick plus each pick's own
    (a Gaussian copula with rho of the variance shared), the same generator as the page so the figures agree."""
    if not picks:
        return None
    st = [seed]

    def rnd():
        st[0] = (st[0] * 1664525 + 1013904223) % 4294967296
        return (st[0] + 0.5) / 4294967296

    def gauss():
        a = math.sqrt(-2 * math.log(rnd()))
        return a * math.cos(2 * math.pi * rnd())

    wm, wo = math.sqrt(rho), math.sqrt(1 - rho)
    tot = []
    for _ in range(n):
        zm = gauss()
        s = 0.0
        for r in picks:
            u = min(0.9995, max(0.0005, _phi(wm * zm + wo * gauss())))
            s += r["qty"] * net(r["buy"], draw(qs, r["tab"], u), S, disc, r["sell"])
        tot.append(s)
    a = sorted(tot)
    at = lambda p: a[min(n - 1, math.floor(p * n))]
    return {"lo": at(0.1), "q25": at(0.25), "med": at(0.5), "q75": at(0.75), "hi": at(0.9), "mean": sum(a) / n,
            "p": min(P_CAP, sum(1 for v in a if v > 0) / n)}


def standard_plans(doc, cards, band, min_sales, names=None, caps=STD_CAPS, holds=STD_HOLDS, discs=STD_DISCS):
    """The archived plans of a month: every capital x hold x discount at the standard constants. Each returns the
    record the collector keeps (the page's Record message, plus the inputs)."""
    out = []
    qs = doc["calib"]["quantiles"]
    for h in holds:
        for disc in discs:
            for cap in caps:
                I = dict(STD_INPUTS, cap=float(cap), h=h, disc=disc)
                P = plan(doc, cards, STD_FEES, I, band, min_sales, names)
                mc = monte_carlo(qs, P["picks"], STD_FEES, disc)
                rec = {"h": h, "cap": cap, "disc": disc, "spent": round(P["spent"], 2), "fees": dict(STD_FEES),
                       "picks": [[r["cid"], r["qty"], round(r["buy"], 2), round(r["mean"], 2)] for r in P["picks"]],
                       "exp": round(mc["mean"], 2) if mc else 0.0, "lo": round(mc["lo"], 2) if mc else 0.0, "hi": round(mc["hi"], 2) if mc else 0.0,
                       "p": round(mc["p"], 3) if mc else 0.0, "reg": regime_word(doc), "month": doc.get("month", ""), "model": doc.get("model", "v1"),
                       "gated": P["gated"], "n_elig": sum(1 for r in P["rows"] if r["p"] >= I["minp"]), "n_rows": len(P["rows"]),
                       "best": round(max((r["p"] for r in P["rows"]), default=0.0), 3)}
                out.append(rec)
    return out
