#!/usr/bin/env python3
"""Brett's own eBay purchases and sales, for the Revenue tab.

The collector normally sees eBay as a stranger does (an application token: public listings only). Once Brett has
approved it (ebay_link.py, a one-time step he does himself) it also holds a refresh token for HIS account and may
read his orders. It only ever reads: nothing here buys, bids, lists or changes anything.

Privacy: the collector's log is public (the live branch), so nothing personal goes into it - counts and field names
only. What is read here is kept in the encrypted state and leaves the machine only inside the encrypted live file.

  sales      Sell Fulfillment API  GET /sell/fulfillment/v1/order           (orders where Brett is the seller)
  purchases  Trading API           GetOrders with OrderRole = Buyer         (eBay has no REST call for a buyer's history)
Both reach back 90 days at most, so the record is built up here from the day the account is linked.
"""
import base64
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

API = "https://api.ebay.com"
SCOPES = " ".join(["https://api.ebay.com/oauth/api_scope",
                   "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
                   "https://api.ebay.com/oauth/api_scope/sell.finances"])
PULL_EVERY_S = 1800          # how often the collector asks eBay for new orders
LOOKBACK_D = 89              # eBay's limit for one request is 90 days
NS = {"e": "urn:ebay:apis:eBLBaseComponents"}
_tok = {"v": None, "exp": 0.0}


def linked():
    return bool(os.environ.get("EBAY_REFRESH_TOKEN", "").strip())


def _basic():
    cid, sec = os.environ.get("EBAY_CLIENT_ID", ""), os.environ.get("EBAY_CLIENT_SECRET", "")
    return "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode()


def _http(url, data=None, headers=None, timeout=45):
    """-> (status, body bytes). Never raises on an HTTP error status."""
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def token_request(fields):
    """POST to eBay's token endpoint. -> (ok, parsed json or {'error': short text})."""
    status, body = _http(API + "/identity/v1/oauth2/token", urllib.parse.urlencode(fields).encode(),
                         {"Authorization": _basic(), "Content-Type": "application/x-www-form-urlencoded"})
    try:
        j = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        j = {}
    if status == 200 and j.get("access_token"):
        return True, j
    return False, {"error": f"HTTP {status} {j.get('error', '')} {str(j.get('error_description', ''))[:120]}".strip()}


def user_token():
    """A short-lived token for Brett's account, from the long-lived refresh token he approved."""
    if _tok["v"] and time.time() < _tok["exp"] - 120:
        return _tok["v"]
    ok, j = token_request({"grant_type": "refresh_token", "refresh_token": os.environ["EBAY_REFRESH_TOKEN"].strip(), "scope": SCOPES})
    if not ok:
        raise RuntimeError("eBay would not renew the account token (" + j["error"] + ")")
    _tok["v"], _tok["exp"] = j["access_token"], time.time() + int(j.get("expires_in", 7200))
    return _tok["v"]


def _money(d):
    try:
        return round(float((d or {}).get("value")), 2)
    except (TypeError, ValueError):
        return None


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def sale_rows(orders):
    """Fulfillment-API orders -> one flat row per line item. The marketplace fee is charged per order; it is shared
    between the line items by their share of the order's value."""
    rows = []
    for o in orders:
        fee = _money(o.get("totalMarketplaceFee"))
        ps, pay = o.get("pricingSummary") or {}, o.get("paymentSummary") or {}
        items = o.get("lineItems") or []
        whole = sum((_money(li.get("total")) or 0) for li in items) or None
        for li in items:
            total = _money(li.get("total"))
            share = (total / whole) if (total and whole) else (1.0 / len(items))
            rows.append({"key": f"{o.get('orderId')}|{li.get('lineItemId')}", "oid": o.get("orderId"), "t": o.get("creationDate"),
                         "iid": li.get("legacyItemId"), "title": li.get("title"), "sku": li.get("sku"), "qty": li.get("quantity"),
                         "total": total, "item": _money(li.get("lineItemCost")),
                         "ship": _money((li.get("deliveryCost") or {}).get("shippingCost")),
                         "fee": None if fee is None else round(fee * share, 2),
                         "order_total": _money(ps.get("total")), "due": _money(pay.get("totalDueSeller")),
                         "status": o.get("orderFulfillmentStatus"), "pay": o.get("orderPaymentStatus"),
                         "cancel": (o.get("cancelStatus") or {}).get("cancelState")})
    return rows


def pull_sales(since):
    orders, url = [], API + "/sell/fulfillment/v1/order?" + urllib.parse.urlencode(
        {"filter": f"creationdate:[{_iso(since)}..]", "limit": "200"})
    for _ in range(20):
        status, body = _http(url, headers={"Authorization": "Bearer " + user_token(), "Accept": "application/json"})
        if status != 200:
            raise RuntimeError(f"sales: HTTP {status} {body[:160].decode('utf-8', 'replace')}")
        j = json.loads(body.decode("utf-8"))
        orders += j.get("orders") or []
        url = j.get("next")
        if not url:
            break
    return orders


def buy_rows(xml_bytes):
    """Trading-API GetOrders (buyer role) XML -> (rows, has more pages). One row per item bought."""
    root = ET.fromstring(xml_bytes)
    if root.findtext("e:Ack", "", NS) not in ("Success", "Warning"):
        raise RuntimeError("purchases: " + (root.findtext("e:Errors/e:ShortMessage", "eBay refused the request", NS))[:160])
    f = lambda node, path: node.findtext(path, None, NS)
    num = lambda v: None if v in (None, "") else round(float(v), 2)
    rows = []
    for o in root.findall("e:OrderArray/e:Order", NS):
        trans = o.findall("e:TransactionArray/e:Transaction", NS)
        for t in trans:
            tax = f(t, "e:eBayCollectAndRemitTaxes/e:TotalTaxAmount") or f(t, "e:Taxes/e:TotalTaxAmount")
            rows.append({"key": f"{f(o, 'e:OrderID')}|{f(t, 'e:Item/e:ItemID')}|{f(t, 'e:TransactionID')}", "oid": f(o, "e:OrderID"),
                         "t": f(o, "e:CreatedTime"), "paid": f(o, "e:PaidTime"), "iid": f(t, "e:Item/e:ItemID"),
                         "title": f(t, "e:Item/e:Title"), "qty": f(t, "e:QuantityPurchased"),
                         "item": num(f(t, "e:TransactionPrice")), "tax": num(tax),
                         "ship": num(f(o, "e:ShippingServiceSelected/e:ShippingServiceCost")),
                         "order_total": num(f(o, "e:Total")), "subtotal": num(f(o, "e:Subtotal")), "n_in_order": len(trans),
                         "status": f(o, "e:OrderStatus")})
    return rows, root.findtext("e:HasMoreOrders", "false", NS) == "true"


def pull_buys(since, until):
    rows = []
    for page in range(1, 21):
        body = ('<?xml version="1.0" encoding="utf-8"?><GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
                f"<OrderRole>Buyer</OrderRole><OrderStatus>All</OrderStatus><CreateTimeFrom>{_iso(since)}</CreateTimeFrom>"
                f"<CreateTimeTo>{_iso(until)}</CreateTimeTo><Pagination><EntriesPerPage>100</EntriesPerPage>"
                f"<PageNumber>{page}</PageNumber></Pagination></GetOrdersRequest>")
        status, out = _http(API + "/ws/api.dll", body.encode(), {
            "X-EBAY-API-SITEID": "0", "X-EBAY-API-COMPATIBILITY-LEVEL": "1349", "X-EBAY-API-CALL-NAME": "GetOrders",
            "X-EBAY-API-IAF-TOKEN": user_token(), "Content-Type": "text/xml"})
        if status != 200:
            raise RuntimeError(f"purchases: HTTP {status}")
        got, more = buy_rows(out)
        rows += got
        if not more:
            break
    return rows


def pull(state, now=None):
    """Ask eBay for the last 90 days of Brett's purchases and sales and fold them into the record kept in the state.
    -> a line for the log (counts only)."""
    now = now or datetime.now(timezone.utc)
    acct = state.setdefault("acct", {"buys": {}, "sales": {}})
    since = now - timedelta(days=LOOKBACK_D)
    notes, new = [], {"buys": 0, "sales": 0}
    for kind, fetch in (("sales", lambda: sale_rows(pull_sales(since))), ("buys", lambda: pull_buys(since, now))):
        try:
            for r in fetch():
                new[kind] += r["key"] not in acct[kind]
                acct[kind][r["key"]] = dict(acct[kind].get(r["key"], {}), **r)
        except Exception as e:                               # one side failing must not lose the other
            notes.append(str(e)[:200])
    acct["pulled"], acct["ok"], acct["note"] = now.strftime("%Y-%m-%dT%H:%M:%SZ"), not notes, "; ".join(notes)
    return (f"Account: {len(acct['buys'])} purchases and {len(acct['sales'])} sales on record "
            f"({new['buys']} and {new['sales']} new)" + (" - problem: " + acct["note"] if notes else ""))


# ---------------------------------------------------------------- the ledger the Revenue tab shows
def _dt(text):
    try:
        return datetime.strptime((text or "")[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _hours(a, b):
    a, b = _dt(a), _dt(b)
    return None if not a or not b else round((b - a).total_seconds() / 3600, 1)


def enrich(state, es, cap=6):
    """When did each listing go up? Needed for "hours on eBay before I bought it" and "hours it took to sell". Taken
    from the collector's own record of the listing when it tracked it, else one public lookup by item number (at most
    `cap` per call; a listing that cannot be found is tried three times, then left blank)."""
    acct = state.get("acct") or {}
    known = {}
    for r in list(state.get("open", {}).values()) + list(state.get("closed", [])):
        known[str(r.get("id", "")).split("|")[1] if "|" in str(r.get("id", "")) else ""] = r.get("origin") or r.get("created") or r.get("first")
    used = 0
    for kind in ("buys", "sales"):
        for row in (acct.get(kind) or {}).values():
            if row.get("listed") or not row.get("iid") or row.get("tries", 0) >= 3:
                continue
            if known.get(row["iid"]):
                row["listed"] = known[row["iid"]]
                continue
            if used >= cap:
                continue
            used += 1
            row["tries"] = row.get("tries", 0) + 1
            try:
                it = es.api_get(state, "/buy/browse/v1/item/get_item_by_legacy_id", {"legacy_item_id": row["iid"]}, ok_404=True)
            except Exception:
                it = None
            if it and it.get("itemCreationDate"):
                row["listed"] = it["itemCreationDate"][:19] + "Z"
    return used


def ledger(state, cat, es):
    """One row per card bought, paired with its sale when there is one, plus sales that have no purchase on record.
    Pairing: exact when the sale's custom label (SKU) is the purchase's eBay item number; otherwise the same card
    (the title matcher), oldest unpaired purchase first. Shipping label and supplies are the collector's standing
    estimates until eBay's own figures are read.
    Row: [card id, card, set, number, bought, paid, hours listed before the buy, sold, sale total, hours to sell,
          hours held, eBay fee, shipping + supplies, net, ROI %, source, predicted net, status, purchase title,
          purchase item number, sale title, sale item number]"""
    acct = state.get("acct") or {}
    alerts = {str(e.get("i", "")).split("|")[1]: e for e in (state.get("vps") or {}).get("alert_log", []) if "|" in str(e.get("i", ""))}

    def card_of(title):
        try:
            ci = es.match_title(cat, title or "", "", state.get("denoms", {}))[0]
        except Exception:
            ci = None
        return cat.cards[ci] if ci is not None else None

    buys = []
    for b in sorted((acct.get("buys") or {}).values(), key=lambda r: r.get("t") or ""):
        if (b.get("status") or "").lower() in ("cancelled", "inactive"):
            continue
        n = max(1, int(b.get("n_in_order") or 1))
        paid = round((b.get("item") or 0) * max(1, int(float(b.get("qty") or 1))) + (b.get("ship") or 0) / n + (b.get("tax") or 0), 2)
        buys.append({"r": b, "card": card_of(b.get("title")), "paid": paid, "sale": None})
    out_cost = es.SHIP_OUT + es.SUPPLIES
    rows, loose = [], []
    for s in sorted((acct.get("sales") or {}).values(), key=lambda r: r.get("t") or ""):
        if (s.get("cancel") or "NONE_REQUESTED") not in ("NONE_REQUESTED", "CANCEL_REJECTED"):
            continue
        card = card_of(s.get("title"))
        match = next((b for b in buys if not b["sale"] and s.get("sku") and str(s["sku"]).strip() == b["r"].get("iid")), None) or \
            next((b for b in buys if not b["sale"] and card and b["card"] and b["card"]["id"] == card["id"]
                  and (b["r"].get("t") or "") <= (s.get("t") or "")), None)
        if match:
            match["sale"] = s
        else:
            loose.append((s, card))

    def row(b, s, card):
        r = (b or {}).get("r") or {}
        paid = b["paid"] if b else None
        total = s.get("total") if s else None
        fee = s.get("fee") if s else None
        net = None if (not s or total is None or paid is None) else round(total - (fee or 0) - out_cost - paid, 2)
        al = alerts.get(r.get("iid") or "")
        src = "other" if not al else {"hit": "hit", "hit-drop": "price drop", "lead": "lead", "lead-drop": "price drop",
                                      "auction": "auction", "auction-lead": "auction"}.get(al.get("kd"), al.get("kd"))
        name = (card["name"] + (f" [{card['variant'].title()}]" if card.get("variant") else "")) if card else (r.get("title") or s.get("title") or "")[:60]
        return [card["id"] if card else None, name, card["set"] if card else "", card["num"] if card else "",
                r.get("t"), paid, _hours(r.get("listed"), r.get("t")),
                s.get("t") if s else None, total, _hours(s.get("listed"), s.get("t")) if s else None,
                _hours(r.get("t"), s.get("t")) if (b and s) else None,
                fee, round(out_cost, 2) if s else None, net,
                None if (net is None or not paid) else round(net / paid * 100, 1),
                src if b else "not bought on eBay", al.get("p") if al else None,
                "sold" if (b and s) else "holding" if b else "sold, no purchase on record",
                r.get("title"), r.get("iid"), s.get("title") if s else None, s.get("iid") if s else None]

    for b in buys:
        rows.append(row(b, b["sale"], b["card"]))
    for s, card in loose:
        rows.append(row(None, s, card))
    rows.sort(key=lambda x: x[7] or x[4] or "", reverse=True)          # newest activity first
    return {"rows": rows[:2000], "tied": round(sum(x[5] or 0 for x in rows if x[17] == "holding"), 2),
            "est_out": round(out_cost, 2)}
