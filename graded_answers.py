"""graded_answers.py - what Brett answers on the PriceCharting tab's graded view, filed into card-data (2026-10-28).

Two kinds of answers travel from the page over the signed channel (alSend) to the collector, which keeps them and
publishes them as live/graded_marks.bin (encrypted with the live key):
  marks  the Review popup: Same card / Not the same card / the Flag with its reason and note, per card x grade
  terms  the word buttons' Sort: a word put under Rarity / Finish / Special / Series / Era / Meaningless (or back to
         Unidentified), optionally "the same as" another word, where it may match, and a note (Brett: "as we figure out
         the unidentified terms, we can update it accordingly ... that data folder should be updated")

The site workflow runs this before graded_site.py, with card-data checked out:
    python graded_answers.py --live graded_marks.bin --card-data card-data/data
and commits what changed:
  ids/marks.csv               pc, gk, profile, v (1 same / 0 not / blank withdrawn), reason, note, t (ms), when
                              - merged: the newest answer per card x grade wins, older files are never lost
  dictionary/terms.csv        each NEW decision applied: the word's row updated (or added) with Brett's category,
                              same_as, where, confidence "confirmed", basis "Brett (site)", changed = the day he sorted it
  dictionary/decisions.csv    every decision applied, oldest first (t, when, term, category, same_as, where, note,
                              phrase) - the history, and the guard that applies each decision once: a hand edit of
                              terms.csv later is never overwritten by an old decision
"""
import argparse
import csv
import gzip
import json
import os
import sys
from datetime import datetime, timezone

import graded_terms as gt

CATS = ("Rarity", "Finish", "Special", "Series", "Era", "Meaningless", "Unidentified")
TERM_COLS = ["term", "same_as", "category", "confidence", "basis", "where", "note", "changed"]
DEC_COLS = ["t", "when", "term", "category", "same_as", "where", "note", "phrase"]
MARK_COLS = ["pc", "gk", "profile", "v", "reason", "note", "t", "when"]


def when(t):
    return datetime.fromtimestamp(int(t) / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M")


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


def file_marks(cd, marks):
    """Merge the collector's Review answers into ids/marks.csv. -> number of rows that changed."""
    path = os.path.join(cd, "ids", "marks.csv")
    by = {}
    for r in read_csv(path):
        by[(str(r.get("pc")), str(r.get("gk")))] = r
    changed = 0
    for m in marks or []:
        try:
            pc, gk, t = str(int(m["pc"])), str(m["gk"])[:20], int(m["t"])
        except (KeyError, TypeError, ValueError):
            continue
        cur = by.get((pc, gk))
        if cur and int(float(cur.get("t") or 0)) >= t:
            continue
        v = m.get("v")
        by[(pc, gk)] = {"pc": pc, "gk": gk, "profile": str(m.get("p") or "")[:40], "v": "" if v is None else str(int(v)),
                        "reason": str(m.get("reason") or "")[:40], "note": str(m.get("note") or "")[:500], "t": str(t), "when": when(t)}
        changed += 1
    if changed or not os.path.exists(path):
        write_csv(path, MARK_COLS, sorted(by.values(), key=lambda r: (int(r["pc"]), r["gk"])))
    return changed


def file_terms(cd, terms):
    """Apply the decisions not applied before to dictionary/terms.csv. -> list of the decisions applied."""
    dpath = os.path.join(cd, "dictionary", "decisions.csv")
    tpath = os.path.join(cd, "dictionary", "terms.csv")
    done = {(str(r.get("t")), (r.get("term") or "").lower()) for r in read_csv(dpath)}
    new = []
    for d in terms or []:
        try:
            t = int(d["t"])
        except (KeyError, TypeError, ValueError):
            continue
        term = " ".join(str(d.get("term") or "").split())[:120]
        cat = str(d.get("cat") or "")
        if not term or cat not in CATS or (str(t), term.lower()) in done or not gt.norm_tokens(term):
            continue
        new.append({"t": t, "term": term, "cat": cat, "same": " ".join(str(d.get("same") or "").split())[:120],
                    "where": d.get("where") if d.get("where") in ("any", "set", "exact") else "",
                    "note": " ".join(str(d.get("note") or "").split())[:500], "ph": str(d.get("ph") or "")[:200]})
    if not new:
        return []
    rows = read_csv(tpath)
    index = {tuple(gt.norm_tokens(r.get("term"))): i for i, r in enumerate(rows)}
    log = read_csv(dpath)
    for d in sorted(new, key=lambda x: x["t"]):
        key = tuple(gt.norm_tokens(d["term"]))
        same = d["same"] if d["same"] and tuple(gt.norm_tokens(d["same"])) != key else ""
        day = when(d["t"])[:10]
        note = d["note"] or ("sorted by Brett on the site" + (f" (seen as \"{d['ph']}\")" if d["ph"] and d["ph"] != d["term"] else ""))
        if key in index:
            r = rows[index[key]]
            r.update({"same_as": same, "category": d["cat"], "confidence": "confirmed", "basis": "Brett (site)",
                      "where": d["where"] or r.get("where") or "any", "note": note, "changed": day})
        else:
            rows.append({"term": d["term"], "same_as": same, "category": d["cat"], "confidence": "confirmed",
                         "basis": "Brett (site)", "where": d["where"] or "any", "note": note, "changed": day})
            index[key] = len(rows) - 1
        log.append({"t": str(d["t"]), "when": when(d["t"]), "term": d["term"], "category": d["cat"], "same_as": same,
                    "where": d["where"], "note": d["note"], "phrase": d["ph"]})
    write_csv(tpath, TERM_COLS, rows)
    write_csv(dpath, DEC_COLS, log)
    return new


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", default="graded_marks.bin", help="live/graded_marks.bin from the collector")
    ap.add_argument("--card-data", default="card-data/data")
    a = ap.parse_args()
    pw = os.environ.get("SITE_PASSWORD", "")
    if not os.path.exists(a.live):
        print("Page answers: no graded_marks.bin on the live branch yet (no Review answer or sorted word sent so far)")
        return
    if not pw:
        print("Page answers: no SITE_PASSWORD - cannot read graded_marks.bin")
        return
    import forecast as F                                     # the live key (the collector's scheme)
    with open(a.live, "rb") as f:
        doc = json.loads(gzip.decompress(F.decrypt_live(f.read(), pw)))
    nm = file_marks(a.card_data, doc.get("marks"))
    applied = file_terms(a.card_data, doc.get("terms"))
    print(f"Page answers: {len(doc.get('marks') or [])} Review answers on file at the collector, {nm} new or changed -> ids/marks.csv; "
          f"{len(doc.get('terms') or [])} sorted words, {len(applied)} new -> dictionary/terms.csv"
          + "".join(f"\n  {d['term']} -> {d['cat']}" + (f" (same as {d['same']})" if d['same'] else "") for d in applied[:40]))


if __name__ == "__main__":
    main()
