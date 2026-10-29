"""cert_lookups.py - the graded view's slabs looked up by cert number, each source kept in its own card-data folder
(2026-10-29, Brett: "Auth Pop ... Auth Pop Higher ... we should add that data to /data folder for safe keeping. in fact
we might as well add all of the psa data to /data"; "can we confirm that card hedges name, set, number, variant,
picture, are indeed correct for the specific cert? ... get scandit connected to my phone to pull the barcodes, as to see
the cert, and then match it with one of the listings in cl/pc listings").

Run by the site workflow before graded_site.py, with card-data checked out:
    python cert_lookups.py --card-data card-data/data
A source whose secret is not set is skipped (says so in the log); nothing else changes.

PSA's Public API (secret PSA_API_TOKEN - a token made at psacard.com/publicapi with Brett's PSA login):
    GET https://api.psacard.com/publicapi/cert/GetByCertNumber/<cert>   (Authorization: bearer <token>)
  -> data/psa/raw/<YYYY-MM>.jsonl.gz   every response exactly as PSA sent it: {"cert", "read", "http", "resp"}
     data/psa/certs.csv                 one row per cert (its newest read): PSA's own record - spec_id, year, brand,
                                        category, card_number, subject, variety, label_type, grade_description,
                                        card_grade, total_population, population_with_qualifier, population_higher ...
     data/psa/pop_history.csv           one row per read whose population numbers differ from that cert's previous
                                        row (the first read included): how a card's population grows over time
Card Hedge (secret CARDHEDGE_API_KEY):
    POST https://api.cardhedger.com/v1/cards/details-by-certs {"certs": [...], "grader": "PSA" | "CGC"}   (X-API-Key)
  -> data/cardhedge/raw/<YYYY-MM>.jsonl.gz
     data/cardhedge/certs.csv           grader, cert, the cert's record as Card Hedge relays it from GemRate (grade,
                                        description, gemrate ids) and Card Hedge's own matched card (card_id, player,
                                        set, number, variant, image ...), card_source (gemrate_id = a direct ID link;
                                        card_match = an AI guess from the description, with match_confidence 0-1)
     data/cardhedge/check.csv           the accuracy check: Card Hedge's card vs the card our PC <-> CL match says the
                                        cert belongs to (number, name, set) and vs the cert's own description line

Which certs: every PSA / CGC cert the graded view knows - ids/card_ids.csv (psa_cert, cgc_cert: the slab Card Ladder's
cert lookup tied to the card) and cardladder/matches (one slab per grade read off PriceCharting's sold-listing photos,
and Card Ladder's cert lookups). Never-read certs first. A PSA record is read again after PSA_REREAD_DAYS (the
population moves); a Card Hedge row is read again only when it failed or found no card.

Limits, as published (2026-10-29):
  Card Hedge "Unlimited + API" (the base tier): 10 requests a minute and 5,000 a day for the whole account, ONE UNIT PER
  CERT even inside a batch; 1,000 first-time cert lookups a day; a batch that does not fit is refused whole (HTTP 429).
  So: batches of CH_BATCH (10) certs, one batch a minute, at most --ch-minutes (15) of waiting per run - about 150
  certs a day while the first ones are looked up, then only the new ones. Stops at 401 / 403 / a 429 that does not
  clear after one Retry-After wait / 5xx / "gemrate_daily_quota_exceeded".
  PSA's API: free with a PSA login, with a daily cap for free use. --psa-max reads a run; stops at the first refusal
  (429, 401 / 403, and 500 - PSA's docs: "usually invalid credentials").
Nothing is spoofed: a plain user agent naming this tool.
"""
import argparse
import csv
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

UA = "biotech-catelog cert_lookups.py (github.com/BrettS600/biotech-catelog)"
PSA_URL = "https://api.psacard.com/publicapi/cert/GetByCertNumber/"
CH_URL = "https://api.cardhedger.com/v1/cards/details-by-certs"
CH_BATCH = 10
PACE_S = None                     # seconds between Card Hedge batches; None = wait for the next UTC minute (tests set it)
PSA_REREAD_DAYS = 30

PSA_FIELDS = [("spec_id", "SpecID"), ("spec_number", "SpecNumber"), ("year", "Year"), ("brand", "Brand"),
              ("category", "Category"), ("card_number", "CardNumber"), ("subject", "Subject"), ("variety", "Variety"),
              ("label_type", "LabelType"), ("grade_description", "GradeDescription"), ("card_grade", "CardGrade"),
              ("total_population", "TotalPopulation"), ("population_with_qualifier", "TotalPopulationWithQualifier"),
              ("population_higher", "PopulationHigher"), ("psa_dna", "IsPSADNA"), ("dual_cert", "IsDualCert"),
              ("autograph_grade", "AutographGrade"), ("primary_signers", "PrimarySigners"), ("item_status", "ItemStatus")]
PSA_COLS = ["cert"] + [a for a, _ in PSA_FIELDS] + ["server_message", "status", "read"]
POP_COLS = ["cert", "spec_id", "card_grade", "read_date", "total_population", "population_with_qualifier", "population_higher"]
CH_COLS = ["grader", "cert", "grade", "description", "gemrate_id", "universal_gemrate_id", "card_id", "player", "set",
           "number", "variant", "image", "category", "category_group", "set_type", "card_description", "card_source",
           "match_confidence", "error", "status", "read"]
CHECK_COLS = ["grader", "cert", "pricecharting_id", "card_source", "match_confidence", "ch_player", "ch_set", "ch_number",
              "our_name", "our_set", "our_number", "number", "name", "set", "description_number", "description_name",
              "verdict", "checked"]


def now():
    return datetime.now(timezone.utc)


def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path, cols, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def append_raw(folder, recs):
    """Add records to <folder>/raw/<YYYY-MM>.jsonl.gz (a gzip file may hold several members: appending is safe)."""
    if not recs:
        return
    os.makedirs(os.path.join(folder, "raw"), exist_ok=True)
    with gzip.open(os.path.join(folder, "raw", now().strftime("%Y-%m") + ".jsonl.gz"), "at", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")


def clean_cert(c):
    s = re.sub(r"\D", "", str(c or ""))
    return s if 6 <= len(s) <= 12 else ""


# ---------------- which certs ----------------
def known_certs(cd):
    """{(grader, cert): {"pc": set(pricecharting ids), "gk": set(grade keys)}} for every PSA / CGC cert the graded view knows."""
    out = {}
    id_rows = read_csv(os.path.join(cd, "ids", "card_ids.csv"))
    view = {str(r.get("pricecharting_id", "")).split(".")[0] for r in id_rows if r.get("cl_profile_id")}

    def add(grader, cert, pc, gk=None):
        g, c = str(grader or "").lower(), clean_cert(cert)
        if g not in ("psa", "cgc") or not c:
            return
        e = out.setdefault((g, c), {"pc": set(), "gk": set(), "view": False})
        if pc:
            e["pc"].add(str(pc).split(".")[0])
            e["view"] = e["view"] or str(pc).split(".")[0] in view    # a card the graded view shows: looked up first
        if gk:
            e["gk"].add(gk)
    for r in id_rows:
        add("psa", r.get("psa_cert"), r.get("pricecharting_id"))
        add("cgc", r.get("cgc_cert"), r.get("pricecharting_id"))
    import glob
    for f in sorted(glob.glob(os.path.join(cd, "cardladder", "matches", "*.jsonl.gz"))):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                for gk, x in (o.get("slabs") or {}).items():
                    add(gk.split("|")[0], (x or {}).get("cert"), o.get("pc"), gk)
                c = o.get("cl_cert") or {}
                if c.get("cert") and not c.get("err"):
                    add(c.get("grader"), c.get("cert"), o.get("pc"), f"{c.get('grader')}|{c.get('grade')}")
    return out


# ---------------- HTTP ----------------
def http(method, url, headers, body=None, timeout=40):
    """-> (status, parsed JSON or None, headers). Network errors -> (0, None, {})."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict(headers, **{"User-Agent": UA, "Accept": "application/json"}))
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            st, hd = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw, st, hd = e.read(), e.code, dict(e.headers or {})
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"  network: {e}")
        return 0, None, {}
    try:
        return st, json.loads(raw.decode("utf-8")) if raw else None, hd
    except ValueError:
        return st, None, hd


# ---------------- PSA's Public API ----------------
def ci_get(d, key):
    """case-insensitive key lookup"""
    if not isinstance(d, dict):
        return None
    if key in d:
        return d[key]
    lk = key.lower()
    for k, v in d.items():
        if str(k).lower() == lk:
            return v
    return None


def psa_row(cert, resp, st):
    rec = ci_get(resp, "PSACert") if isinstance(resp, dict) else None
    msg = str(ci_get(resp, "ServerMessage") or "") if isinstance(resp, dict) else ""
    row = {"cert": cert, "server_message": msg[:200], "read": now().strftime("%Y-%m-%dT%H:%M:%SZ")}
    if isinstance(rec, dict) and (ci_get(rec, "CertNumber") or ci_get(rec, "SpecID")):
        for a, k in PSA_FIELDS:
            v = ci_get(rec, k)
            row[a] = "" if v is None else (" ; ".join(map(str, v)) if isinstance(v, list) else str(v))
        row["status"] = "ok"
    else:
        row["status"] = "not_found" if st == 200 else f"http_{st}"
    return row


def run_psa(cd, certs, token, max_n, delay=1.0):
    folder = os.path.join(cd, "psa")
    rows = {r["cert"]: r for r in read_csv(os.path.join(folder, "certs.csv"))}
    pop = read_csv(os.path.join(folder, "pop_history.csv"))
    last_pop = {}
    for p in pop:
        last_pop[p["cert"]] = p
    cutoff = (now() - timedelta(days=PSA_REREAD_DAYS)).strftime("%Y-%m-%d")
    todo = sorted((c for (g, c) in certs if g == "psa" and c not in rows), key=lambda c: not certs[("psa", c)]["view"])
    todo += sorted((c for (g, c) in certs if g == "psa" and c in rows and (rows[c].get("status") != "ok" or rows[c].get("read", "")[:10] < cutoff)),
                   key=lambda c: rows[c].get("read", ""))
    print(f"PSA's API: {sum(1 for g, _ in certs if g == 'psa')} PSA certs known, {len(rows)} on file, {len(todo)} to read (at most {max_n} this run)")
    raw, n, stop = [], 0, None
    for cert in todo[:max_n]:
        st, resp, _ = http("GET", PSA_URL + cert, {"Authorization": "bearer " + token})
        raw.append({"cert": cert, "read": now().strftime("%Y-%m-%dT%H:%M:%SZ"), "http": st, "resp": resp})
        if st in (401, 403, 429, 500) or st == 0 or st >= 502:
            stop = f"HTTP {st}" + (f" ({ci_get(resp, 'ServerMessage') or ci_get(resp, 'Message')})" if isinstance(resp, dict) else "")
            break
        row = psa_row(cert, resp, st)
        rows[cert] = row
        n += 1
        if row["status"] == "ok":
            cur = [row.get(k, "") for k in ("total_population", "population_with_qualifier", "population_higher")]
            lp = last_pop.get(cert)
            if not lp or [lp.get(k, "") for k in ("total_population", "population_with_qualifier", "population_higher")] != cur:
                p = {"cert": cert, "spec_id": row.get("spec_id", ""), "card_grade": row.get("card_grade", ""),
                     "read_date": row["read"][:10], "total_population": cur[0], "population_with_qualifier": cur[1],
                     "population_higher": cur[2]}
                pop.append(p)
                last_pop[cert] = p
        time.sleep(delay)
    append_raw(folder, raw)
    if n:
        write_csv(os.path.join(folder, "certs.csv"), PSA_COLS, sorted(rows.values(), key=lambda r: r["cert"]))
        write_csv(os.path.join(folder, "pop_history.csv"), POP_COLS, pop)
    ok = sum(1 for r in rows.values() if r.get("status") == "ok")
    print(f"PSA's API: read {n} this run{' - stopped: ' + stop if stop else ''}; {ok} certs on file with PSA's record")
    return n, stop


# ---------------- Card Hedge ----------------
def ch_row(grader, cert, res):
    ci, card = (res or {}).get("cert_info") or {}, (res or {}).get("card") or {}
    row = {"grader": grader, "cert": cert, "read": now().strftime("%Y-%m-%dT%H:%M:%SZ"),
           "grade": ci.get("grade") or "", "description": ci.get("description") or "", "gemrate_id": ci.get("gemrate_id") or "",
           "universal_gemrate_id": ci.get("universal_gemrate_id") or "", "card_id": card.get("card_id") or "",
           "player": card.get("player") or "", "set": card.get("set") or "", "number": card.get("number") or "",
           "variant": card.get("variant") or "", "image": card.get("image") or "", "category": card.get("category") or "",
           "category_group": card.get("category_group") or "", "set_type": card.get("set_type") or "",
           "card_description": card.get("description") or "", "card_source": (res or {}).get("card_source") or "",
           "match_confidence": "" if (res or {}).get("match_confidence") is None else str(res.get("match_confidence")),
           "error": str((res or {}).get("error") or "")[:200]}
    row["status"] = ("not_found" if re.search(r"not.?found|no data", row["error"], re.I) else "error") if row["error"] else ("ok" if row["card_id"] else ("no_card" if row["grade"] or row["description"] else "not_found"))
    return row


def run_ch(cd, certs, key, max_minutes, batch=CH_BATCH):
    folder = os.path.join(cd, "cardhedge")
    rows = {(r["grader"], r["cert"]): r for r in read_csv(os.path.join(folder, "certs.csv"))}
    week = (now() - timedelta(days=7)).strftime("%Y-%m-%d")
    todo = sorted((k for k in certs if k not in rows), key=lambda k: not certs[k]["view"])
    todo += [k for k in certs if k in rows and rows[k].get("status") in ("error", "not_found") and rows[k].get("read", "")[:10] < week]   # failures: again after a week
    print(f"Card Hedge: {len(certs)} PSA / CGC certs known, {len(rows)} on file, {len(todo)} to look up "
          f"(batches of {batch}, one a minute, at most {max_minutes} minutes this run)")
    t_end = time.time() + max_minutes * 60
    raw, n, stop, first = [], 0, None, True
    by_g = {}
    for g, c in todo:
        by_g.setdefault(g, []).append(c)
    batches = [(g, cs[i:i + batch]) for g, cs in by_g.items() for i in range(0, len(cs), batch)]
    for g, chunk in batches:
        if not first:
            wait = PACE_S if PACE_S is not None else 61 - datetime.now(timezone.utc).second   # the minute window resets each UTC minute
            if time.time() + wait > t_end:
                stop = "time budget for this run used"
                break
            time.sleep(wait)
        first = False
        st, resp, hd = http("POST", CH_URL, {"X-API-Key": key}, {"certs": chunk, "grader": g.upper()}, timeout=90)
        if st == 429:
            ra = int(str(hd.get("Retry-After") or hd.get("retry-after") or "0").split(".")[0] or 0)
            if 0 < ra <= 65 and time.time() + ra < t_end:
                time.sleep(ra + 1)
                st, resp, hd = http("POST", CH_URL, {"X-API-Key": key}, {"certs": chunk, "grader": g.upper()}, timeout=90)
        raw.append({"grader": g, "certs": chunk, "read": now().strftime("%Y-%m-%dT%H:%M:%SZ"), "http": st, "resp": resp})
        if st != 200 or not isinstance(resp, dict):
            detail = resp.get("detail") if isinstance(resp, dict) else None
            stop = f"HTTP {st}" + (f" ({str(detail)[:160]})" if detail else "")
            break
        quota = False
        results = resp.get("results") or []
        for i, res in enumerate(results):
            cert = clean_cert(((res or {}).get("cert_info") or {}).get("cert") or (res or {}).get("cert"))
            if not cert and len(results) == len(chunk):
                cert = chunk[i]                                # no cert echoed (e.g. not found): results come in request order
            if not cert:
                continue
            row = ch_row(g, cert, res)
            if "quota" in row["error"]:
                quota = True
                continue                                       # not looked up: stays on the to-do list
            rows[(g, cert)] = row
            n += 1
        if quota:
            stop = "Card Hedge's daily allowance of first-time cert lookups is used (gemrate_daily_quota_exceeded)"
            break
    append_raw(folder, raw)
    if n:
        write_csv(os.path.join(folder, "certs.csv"), CH_COLS, sorted(rows.values(), key=lambda r: (r["grader"], r["cert"])))
    found = sum(1 for r in rows.values() if r.get("status") == "ok")
    print(f"Card Hedge: looked up {n} this run{' - stopped: ' + stop if stop else ''}; {found} of {len(rows)} on file have a matched card")
    return rows, n, stop


# ---------------- the accuracy check ----------------
def toks(s):
    s = str(s or "").lower().replace("é", "e").replace("&", " and ")
    return [t for t in re.findall(r"[a-z0-9]+", s) if t not in {"pokemon", "the", "of", "and", "tcg", "card", "holo", "ex"}]


def num_key(num):
    s = str(num or "").strip().lstrip("#").split("/")[0].strip()
    m = re.match(r"^([A-Za-z]*)\s?0*(\d+)([A-Za-z]?)$", s)
    return (m.group(1) + m.group(2) + m.group(3)).lower() if m else s.lower()


def same_num(a, b):
    ka, kb = num_key(a), num_key(b)
    if not ka or not kb:
        return None
    if ka == kb:
        return True
    ma, mb = re.match(r"^([a-z]*)(\d+)([a-z]?)$", ka), re.match(r"^([a-z]*)(\d+)([a-z]?)$", kb)
    return bool(ma and mb and ma.group(2) == mb.group(2) and ma.group(3) == mb.group(3) and (not ma.group(1) or not mb.group(1)))


def overlap(a, b):
    A, B = set(toks(a)), set(toks(b))
    if not A or not B:
        return None
    return len(A & B) / min(len(A), len(B))


def write_check(cd, ch_rows, certs):
    """check.csv: Card Hedge's card vs our PC <-> CL match, and vs the cert's own description line."""
    ids = {str(r.get("pricecharting_id", "")).split(".")[0]: r for r in read_csv(os.path.join(cd, "ids", "card_ids.csv"))}
    out, tally = [], {}
    for (g, cert), r in sorted(ch_rows.items()):
        pcs = sorted((certs.get((g, cert)) or {}).get("pc") or [])
        d = r.get("description", "")
        dm = re.search(r"#\s*([A-Za-z0-9-]+)", d)
        for pc in pcs or [""]:
            m = ids.get(pc) or {}
            our_name = m.get("cl_subject") or m.get("pc_name") or ""
            our_set = " / ".join(x for x in (m.get("pc_set"), m.get("cl_set")) if x)
            our_num = m.get("cl_number") or m.get("number") or ""
            res = {"grader": g, "cert": cert, "pricecharting_id": pc, "card_source": r.get("card_source", ""),
                   "match_confidence": r.get("match_confidence", ""), "ch_player": r.get("player", ""),
                   "ch_set": r.get("set", ""), "ch_number": r.get("number", ""), "our_name": our_name,
                   "our_set": our_set, "our_number": our_num, "checked": now().strftime("%Y-%m-%d")}
            if r.get("status") != "ok":
                res["verdict"] = "no card from Card Hedge" if r.get("status") in ("no_card", "not_found") else "not looked up (" + r.get("status", "") + ")"
            else:
                sn = same_num(r.get("number"), our_num) if our_num else None
                nm = max((x for x in (overlap(r.get("player"), m.get("cl_subject")), overlap(r.get("player"), m.get("pc_name"))) if x is not None), default=None)
                st_ = max((x for x in (overlap(r.get("set"), m.get("pc_set")), overlap(r.get("set"), m.get("cl_set"))) if x is not None), default=None)
                dn = same_num(r.get("number"), dm.group(1)) if dm else None
                dnm = overlap(r.get("player"), d)
                res["number"] = "" if sn is None else ("agree" if sn else "differ")
                res["name"] = "" if nm is None else ("agree" if nm >= 0.5 else "differ")
                res["set"] = "" if st_ is None else ("agree" if st_ >= 0.5 else "differ")
                res["description_number"] = "" if dn is None else ("agree" if dn else "differ")
                res["description_name"] = "" if dnm is None else ("agree" if dnm >= 0.5 else "differ")
                if not pc:
                    res["verdict"] = "no PC/CL match to compare"
                elif res["number"] == "differ" or res["name"] == "differ":
                    res["verdict"] = "differs from our match"
                elif res["number"] == "agree" and res["name"] == "agree":
                    res["verdict"] = "agrees with our match"
                else:
                    res["verdict"] = "partly checked"
            out.append(res)
            tally[res["verdict"]] = tally.get(res["verdict"], 0) + 1
    if out:
        write_csv(os.path.join(cd, "cardhedge", "check.csv"), CHECK_COLS, out)
    src = {}
    for r in ch_rows.values():
        if r.get("status") == "ok":
            src[r.get("card_source") or "?"] = src.get(r.get("card_source") or "?", 0) + 1
    print("Card Hedge check vs our PC <-> CL match: " + (", ".join(f"{k} {v}" for k, v in sorted(tally.items(), key=lambda kv: -kv[1])) or "nothing to check yet")
          + ("; how Card Hedge found its card: " + ", ".join(f"{k} {v}" for k, v in src.items()) if src else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--card-data", default="card-data/data")
    ap.add_argument("--psa-max", type=int, default=int(os.environ.get("PSA_MAX") or 100))
    ap.add_argument("--ch-minutes", type=float, default=float(os.environ.get("CH_MINUTES") or 15))
    ap.add_argument("--ch-batch", type=int, default=int(os.environ.get("CH_BATCH") or CH_BATCH))
    a = ap.parse_args()
    certs = known_certs(a.card_data)
    print(f"cert lookups: {len(certs)} certs known ({sum(1 for g, _ in certs if g == 'psa')} PSA, {sum(1 for g, _ in certs if g == 'cgc')} CGC)")
    psa_tok, ch_key = os.environ.get("PSA_API_TOKEN", "").strip(), os.environ.get("CARDHEDGE_API_KEY", "").strip()
    if psa_tok:
        run_psa(a.card_data, certs, psa_tok, a.psa_max)
    else:
        print("PSA's API: no PSA_API_TOKEN secret yet - skipped")
    if ch_key:
        rows, _, _ = run_ch(a.card_data, certs, ch_key, a.ch_minutes, max(1, min(100, a.ch_batch)))
        write_check(a.card_data, rows, certs)
    else:
        print("Card Hedge: no CARDHEDGE_API_KEY secret yet - skipped")
        rows = {(r["grader"], r["cert"]): r for r in read_csv(os.path.join(a.card_data, "cardhedge", "certs.csv"))}
        if rows:
            write_check(a.card_data, rows, certs)


if __name__ == "__main__":
    sys.exit(main())
