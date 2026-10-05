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
