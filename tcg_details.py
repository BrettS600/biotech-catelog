"""tcg_details.py - the Artist (and the card number / rarity beside it) from TCGplayer's product page, for every card in
the graded view, cached in card-data/data/tcgplayer/details.csv (2026-10-28, Brett: "The PC illustrator can be
retrieved from the TCGplayer ID link that embeds the pricecharting listing").

TCGplayer's product page (www.tcgplayer.com/product/<id>) fills its details box - "Card Number / Rarity", "Card Type",
"Attack 1", "Artist" ... - from TCGplayer's own product-details endpoint (mp-search-api.tcgplayer.com/v1/product/<id>/
details, formattedAttributes.Artist), which is what this reads: the same words the page shows, one card at a time.
TCGCSV's daily file (cardfacts.fetch_tcgcsv) has the number and rarity but not the artist.

Run by the site workflow before graded_site.py, with card-data checked out:
    python tcg_details.py --card-data card-data/data [--max 400]
Reads ids/card_ids.csv (pricecharting_id, tcgplayer_id - the TCGplayer product PriceCharting links to); reads only the
products not on file yet (an artist never changes), at most --max a run, one every DELAY_S seconds. Any refusal (403,
429, a challenge page instead of JSON) stops the run at once: nothing is retried or worked around, and the cards left
show "not read" until a later run. A product that is gone (404) is recorded as "gone" and not asked again.

details.csv: tcgplayer_id, status (ok | gone | error), artist, number, rarity, product, set, read (date).
"""
import argparse
import csv
import os
import sys
import time
from datetime import date, datetime, timedelta

URL = "https://mp-search-api.tcgplayer.com/v1/product/{}/details"
HEADERS = {"Accept": "application/json",            # an honest name, no browser disguise: if TCGplayer turns this away,
           "User-Agent": "biotech-catelog-graded-view/1.0 (one product at a time, cached)"}   # the run stops
DELAY_S = 1.5
RETRY_ERROR_D = 7                 # an "error" row (a timeout, a bad answer) is asked again after this many days
COLS = ["tcgplayer_id", "status", "artist", "number", "rarity", "product", "set", "read"]


def norm_id(x):
    s = str(x or "").strip().split(".")[0]
    return s if s.isdigit() else ""


def load(path):
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["tcgplayer_id"]: r for r in csv.DictReader(f) if r.get("tcgplayer_id")}


def save(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for k in sorted(rows, key=int):
            w.writerow(rows[k])
    os.replace(tmp, path)


def wanted(cd):
    """The TCGplayer products of the graded view's cards, in card_ids.csv order."""
    p = os.path.join(cd, "ids", "card_ids.csv")
    out = []
    with open(p, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            t = norm_id(r.get("tcgplayer_id"))
            if t and t not in out:
                out.append(t)
    return out


def parse(j):
    """The details JSON -> (artist, number, rarity, product, set). The artist is formattedAttributes.Artist, the line
    the product page shows; "" when the page shows none."""
    fa = j.get("formattedAttributes") or {}
    ca = j.get("customAttributes") or {}
    artist = ""
    for k, v in fa.items():
        if str(k).strip().lower() in ("artist", "illustrator"):
            artist = " ".join(str(v or "").split())
            break
    return artist, str(ca.get("number") or ""), str(j.get("rarityName") or ""), str(j.get("productName") or ""), str(j.get("setName") or "")


def run(cd, max_n, delay=DELAY_S, get=None, today=None):
    today = today or date.today()
    path = os.path.join(cd, "tcgplayer", "details.csv")
    rows = load(path)
    retry_before = (today - timedelta(days=RETRY_ERROR_D)).isoformat()
    todo = [t for t in wanted(cd) if t not in rows or (rows[t].get("status") == "error" and rows[t].get("read", "") < retry_before)]
    print(f"TCGplayer details: {len(rows):,} products on file, {len(todo):,} to read" + (f" (this run reads {max_n})" if len(todo) > max_n else ""))
    if get is None:
        import requests
        sess = requests.Session()
        get = lambda u: sess.get(u, headers=HEADERS, timeout=20)
    n_ok = n_gone = n_err = 0
    stopped = None
    for i, t in enumerate(todo[:max_n]):
        if i:
            time.sleep(delay)
        try:
            r = get(URL.format(t))
        except Exception as e:
            rows[t] = {"tcgplayer_id": t, "status": "error", "read": today.isoformat(), "product": str(e)[:80]}
            n_err += 1
            continue
        if r.status_code in (401, 403, 429) or r.status_code >= 500:
            stopped = f"TCGplayer answered {r.status_code} on product {t}"
            break
        if r.status_code == 404:
            rows[t] = {"tcgplayer_id": t, "status": "gone", "read": today.isoformat()}
            n_gone += 1
            continue
        try:
            j = r.json()
        except ValueError:
            stopped = f"TCGplayer sent a page that is not the product's details (product {t}) - a check page, perhaps"
            break
        if not isinstance(j, dict) or not (j.get("productId") or j.get("productName")):
            rows[t] = {"tcgplayer_id": t, "status": "error", "read": today.isoformat(), "product": "no product in the answer"}
            n_err += 1
            continue
        artist, number, rarity, product, set_name = parse(j)
        rows[t] = {"tcgplayer_id": t, "status": "ok", "artist": artist, "number": number, "rarity": rarity,
                   "product": product[:120], "set": set_name[:80], "read": today.isoformat()}
        n_ok += 1
    save(path, rows)
    print(f"TCGplayer details: read {n_ok} (with an artist: {sum(1 for r in rows.values() if r.get('artist'))} on file), "
          f"{n_gone} gone, {n_err} errors" + (f"; STOPPED - {stopped}. Nothing retried; the rest stay 'not read'." if stopped else ""))
    return {"ok": n_ok, "gone": n_gone, "err": n_err, "stopped": stopped}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--card-data", default="card-data/data")
    ap.add_argument("--max", type=int, default=400)
    a = ap.parse_args()
    if not os.path.exists(os.path.join(a.card_data, "ids", "card_ids.csv")):
        print("TCGplayer details: no card-data/ids/card_ids.csv - nothing to read")
        return
    run(a.card_data, a.max)


if __name__ == "__main__":
    main()
