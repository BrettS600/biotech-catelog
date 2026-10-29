"""graded_terms.py - what PriceCharting (with the TCGplayer product it links) and Card Ladder each say a card IS, read
with the dictionary in card-data/data/dictionary/terms.csv (2026-10-28, Brett: "pc data has to come from pc or tcg link
that embeds pc. cl has to come from cl. if something is not there, then it should none"; "we need to store them in a
button for review ... figure out where they go, and which ones mean the same things").

Each side is read only from its own source:
  PC   rarity  = TCGplayer's rarity for the product PriceCharting's tcg-id names; else rarity words in PriceCharting's
               [brackets]; else none
       finish  = finish words in the [brackets]; else TCGplayer's printings (only Holofoil -> Holo, only Normal ->
               Non-Holo); else none. No guessing from the rarity.
       special = 1st Edition / Shadowless / stamps ... in the [brackets]
       number  = TCGplayer's number ("001/102" -> 1/102); else PriceCharting's number + "/none"
  CL   rarity / finish / special = dictionary words in Card Ladder's variation, the part of its card name after a
               hyphen ("Alakazam-Holo"), its set name, and the variations its cert lookups returned
       number  = Card Ladder's number; the total from its CGC cert lookup when the profile has none; else "/none"
  Series / Era = only where a series / era name is written in the text (set names count) - nothing looked up yet.
  Auth         = what the grader says, per slab (2026-10-29): PSA's own cert record from PSA's Public API (subject, brand,
               variety, label type), else the one-line description Card Hedge relays from GemRate; CGC slabs only the
               latter. auth_side() reads it with the same dictionary; compare_auth() checks it against PC and CL.
  Illustrator  = PC: the "Artist" TCGplayer's product page shows for the product PriceCharting links to (tcg_details.py
               caches it in card-data/data/tcgplayer/details.csv), only when that product carries the same card number;
               CL: none (Card Ladder does not record it).
Words the dictionary does not know (the leftovers of a bracket or a variation, a TCGplayer rarity it has not seen) are
kept as Unidentified, with where they were seen and the unknown words themselves (what Brett sorts on the page).
"""
import collections
import csv
import os
import re

CATS = ["Rarity", "Finish", "Special", "Series", "Era"]
# the regular printing's own word: a source that leaves it out is saying the same thing (PriceCharting brackets
# [1st Edition] / [Shadowless] and never writes "Unlimited")
DEFAULT_SPECIAL = {"Unlimited"}
STOP = {"pokemon", "tcg", "the", "of", "and", "a", "an", "card", "cards", "version"}


def norm_tokens(s):
    s = str(s or "").lower().replace("é", "e").replace("☆", " star ").replace("&", " and ")
    return re.findall(r"[a-z0-9]+", s)


def orig_tokens(s):
    """The same words as norm_tokens, in their own case ("Spectra", not "spectra") - for showing the unknown words."""
    s = str(s or "").replace("é", "e").replace("É", "E").replace("☆", " Qstar ").replace("&", " Qamp ")
    return [{"Qstar": "☆", "Qamp": "&"}.get(w, w) for w in re.findall(r"[A-Za-z0-9]+", s)]


def meaningful(left):
    return any(t not in STOP and not t.isdigit() for w in left for t in norm_tokens(w))


class Dictionary:
    """terms.csv as a matcher: the longest known term wins, whole words only; where = any | set (only inside a set
    name) | exact (only the whole text)."""

    def __init__(self, rows):
        self.by = {}
        self.maxlen = 1
        self.n = 0
        for r in rows:
            term, cat = (r.get("term") or "").strip(), (r.get("category") or "").strip()
            if not term or cat not in CATS + ["Meaningless"]:
                continue
            toks = tuple(norm_tokens(term))
            if not toks or toks in self.by:
                continue
            self.by[toks] = {"canon": (r.get("same_as") or "").strip() or term, "cat": cat,
                             "conf": (r.get("confidence") or "likely").strip(), "where": (r.get("where") or "any").strip()}
            self.maxlen = max(self.maxlen, len(toks))
            self.n += 1

    @classmethod
    def load(cls, cd):
        p = os.path.join(cd, "dictionary", "terms.csv")
        if not os.path.exists(p):
            return cls([])
        with open(p, newline="", encoding="utf-8") as f:
            return cls(list(csv.DictReader(f)))

    def canon(self):
        """{category: the names the dictionary files words under} - the page's "same as" suggestions."""
        out = {}
        for t in self.by.values():
            if t["cat"] in CATS:
                out.setdefault(t["cat"], set()).add(t["canon"])
        return {c: sorted(v, key=str.lower) for c, v in out.items()}

    def match(self, text, kind="any"):
        """-> (found [{canon, cat, conf}], leftover words in their own case)"""
        toks = norm_tokens(text)
        if not toks:
            return [], []
        orig = orig_tokens(text)
        if len(orig) != len(toks):
            orig = toks
        ex = self.by.get(tuple(toks))
        if ex and ex["where"] == "exact":
            return [ex], []
        found, left, i = [], [], 0
        while i < len(toks):
            hit = None
            for L in range(min(self.maxlen, len(toks) - i), 0, -1):
                t = self.by.get(tuple(toks[i:i + L]))
                if t and t["where"] != "exact" and (t["where"] == "any" or kind == "set"):
                    hit = (t, L)
                    break
            if hit:
                found.append(hit[0])
                i += hit[1]
            else:
                left.append(orig[i])
                i += 1
        return found, left


class Side:
    """What one source says: terms per category (canonical name -> confidence), unidentified phrases, display values."""

    def __init__(self):
        self.t = {c: {} for c in CATS}
        self.src = {c: {} for c in CATS}                    # canonical -> where it was read ("PC bracket", ...)
        self.unid = {}                                      # phrase -> where
        self.unid_left = {}                                 # phrase -> its unknown words ("Spectra" in "Spectra Holo")
        self.artist = None                                  # PC: TCGplayer's Artist (None = not read, "" = read, none given)
        self.artist_from = None
        self.name = self.set_name = self.year = self.num_raw = self.num = ""
        self.rarity_text = self.finish_text = None
        self.lang, self.lang_said, self.source = None, False, None   # Auth: the card's language, whether the grader wrote it, the source

    def add(self, found, where, cats=None):
        for x in found:
            if x["cat"] not in CATS or (cats and x["cat"] not in cats):
                continue
            cur = self.t[x["cat"]].get(x["canon"])
            if cur is None or (cur != "confirmed" and x["conf"] == "confirmed"):
                self.t[x["cat"]][x["canon"]] = x["conf"]
            self.src[x["cat"]].setdefault(x["canon"], where)

    def unknown(self, phrase, left, where):
        self.unid.setdefault(phrase, where)
        self.unid_left.setdefault(phrase, " ".join(left))

    def terms(self, cat):
        return list(self.t[cat].keys())

    def shown(self, cat):
        """'Holo, Reverse Holo?' - a likely categorization carries a ?"""
        return ", ".join(k + ("" if v == "confirmed" else "?") for k, v in self.t[cat].items())


def split_brackets(name):
    return [b.strip() for b in re.findall(r"\[([^\]]+)\]", str(name or "")) if b.strip()]


def strip_brackets(name):
    s = re.sub(r"\[[^\]]+\]", "", str(name or ""))
    return re.sub(r"#\S+\s*$", "", s).strip()


def num_key(num):
    s = str(num or "").strip().split("/")[0].strip()
    m = re.match(r"^([A-Za-z]*)\s?0*(\d+)([A-Za-z]?)$", s)
    return (m.group(1) + m.group(2) + m.group(3)).lower() if m else s.lower()


def clean_num(num):
    """'001/102' -> '1/102'; 'TG05/TG30' -> 'TG5/TG30'; no total -> '…/none'."""
    s = str(num or "").strip()
    if not s:
        return ""
    parts = [p.strip() for p in s.split("/", 1)]

    def z(p):
        m = re.match(r"^([A-Za-z]*)0*(\d+)([A-Za-z]?)$", p)
        return (m.group(1) + m.group(2) + m.group(3)) if m else p
    if len(parts) == 2 and parts[1]:
        return z(parts[0]) + "/" + z(parts[1])
    return z(parts[0]) + "/none"


def total_of(num):
    s = str(num or "")
    if "/" not in s:
        return None
    t = s.split("/", 1)[1].strip()
    m = re.match(r"^[A-Za-z]*0*(\d+)", t)
    return int(m.group(1)) if m else None


def printing_finish(printings):
    """TCGplayer's printings of the product -> the default printing's finish, when they say it plainly."""
    P = [str(p).lower() for p in (printings or [])]
    holo = any("holofoil" in p and "reverse" not in p for p in P)
    normal = any(p.endswith("normal") for p in P)
    if holo and not normal:
        return "Holo"
    if normal and not holo:
        return "Non-Holo"
    return None


def pc_side(name, set_name, number, tcgf, dic, det=None):
    """det: TCGplayer's product details for the product PriceCharting links to (tcg_details.py), or None if not read."""
    s = Side()
    for b in split_brackets(name):
        found, left = dic.match(b, "any")
        s.add(found, "PC bracket")
        if meaningful(left):
            s.unknown(b, left, "PC bracket")
    s.add(dic.match(set_name, "set")[0], "PC set name", cats={"Series", "Era", "Special"})   # Special too: CL's set names count
    s.add(dic.match(strip_brackets(name), "any")[0], "PC card name", cats={"Series", "Era"})
    tr = (tcgf or [""])[0] if tcgf else ""
    if tr:
        found, left = dic.match(tr, "any")
        rar = [x for x in found if x["cat"] == "Rarity"]
        if rar:
            s.t["Rarity"] = {}
            for x in rar:
                s.t["Rarity"][x["canon"]] = "confirmed"         # TCGplayer's rarity field: rarity by definition
                s.src["Rarity"][x["canon"]] = "TCGplayer rarity"
        if not rar or meaningful(left):
            s.unknown(tr, left if rar else orig_tokens(tr), "TCGplayer rarity")
        s.rarity_text = tr
    else:
        s.rarity_text = s.shown("Rarity") or None
    s.rarity_from = "TCGplayer" if tr else ("PriceCharting's [brackets]" if s.t["Rarity"] else None)
    if s.t["Finish"]:
        s.finish_text, s.finish_from = s.shown("Finish"), "PriceCharting's [brackets]"
    else:
        pf = printing_finish((tcgf or [None, None, []])[2] if tcgf else [])
        if pf:
            s.t["Finish"][pf] = "confirmed"
            s.src["Finish"][pf] = "TCGplayer printings"
        s.finish_text, s.finish_from = pf, ("TCGplayer's printings" if pf else None)
    tn = (tcgf or ["", ""])[1] if tcgf else ""
    s.num_raw = tn or str(number or "")
    s.num = clean_num(tn) if tn else (clean_num(number) if number else "")
    s.num_from = "TCGplayer" if tn else ("PriceCharting" if number else None)
    if det and det.get("status") == "ok":
        dn = str(det.get("number") or "")
        if dn and number and not same_number(dn, number):
            s.artist_from = "TCGplayer product with another card number (" + dn + ") - not used"
        else:
            s.artist, s.artist_from = str(det.get("artist") or "").strip(), "TCGplayer product page"
    return s


def cl_side(pr, lookups, dic):
    s = Side()
    pr = pr or {}
    variations = []
    if (pr.get("variation") or "").strip():
        variations.append((pr["variation"].strip(), "CL variation"))
    for c in lookups or []:
        v = (c.get("variation") or "").strip()
        if v and v not in [x for x, _ in variations]:
            variations.append((v, "CL cert lookup (" + str(c.get("grader") or "").upper() + " label)"))
    for v, where in variations:
        found, left = dic.match(v, "any")
        s.add(found, where)
        if meaningful(left):
            s.unknown(v, left, where)
    subj = str(pr.get("subject") or "")
    if "-" in subj:
        s.add(dic.match(subj.split("-", 1)[1], "any")[0], "CL card name")
    sets = [str(pr.get("set") or "")] + [str(c.get("set") or "") for c in lookups or []]
    for st in dict.fromkeys(x for x in sets if x):
        s.add(dic.match(st, "set")[0], "CL set name")
    s.rarity_text = s.shown("Rarity") or None
    s.finish_text = s.shown("Finish") or None
    num = str(pr.get("number") or "").strip()
    s.num_raw, s.num_from = num, "Card Ladder" if num else None
    if num and "/" not in num:
        for c in lookups or []:
            cn = str(c.get("number") or "")
            if "/" in cn and num_key(cn) == num_key(num):
                s.num_raw, s.num_from = cn, "Card Ladder's CGC cert lookup"
                break
    s.num = clean_num(s.num_raw) if s.num_raw else ""
    return s


LANGS = {"japanese": "Japanese", "japan": "Japanese", "korean": "Korean", "chinese": "Chinese", "french": "French",
         "german": "German", "italian": "Italian", "spanish": "Spanish", "portuguese": "Portuguese", "dutch": "Dutch",
         "polish": "Polish", "russian": "Russian", "thai": "Thai", "indonesian": "Indonesian"}


def language_of(*texts):
    """The grader names a card's language only when it is not English ("POKEMON JAPANESE ...")."""
    for t in texts:
        for w in norm_tokens(t):
            if w in LANGS:
                return LANGS[w], True
    return "English", False


def parse_description(d):
    """GemRate's one-line description of a slab ("1999 Pokemon Game #1 Alakazam-Holo") -> year, set, number, name."""
    d = " ".join(str(d or "").split())
    out = {"year": "", "set": "", "num": "", "name": ""}
    m = re.match(r"^(\d{4})(?:-\d{2,4})?\s+(.*)$", d)
    rest = d
    if m:
        out["year"], rest = m.group(1), m.group(2)
    m = re.search(r"\s#\s*([A-Za-z0-9-]+)\s*", " " + rest)
    if m:
        pre, post = (" " + rest)[:m.start()].strip(), (" " + rest)[m.end():].strip()
        out["set"], out["num"], out["name"] = pre, m.group(1), post
    else:
        out["set"] = rest
    return out


def auth_side(rec, dic):
    """What the grader says the card is, read with the dictionary - from PSA's own cert record (src 'psa') or from the
    one-line description Card Hedge relays from GemRate (src 'ch'). rec: {"src", "subject", "brand", "variety",
    "label", "desc"}. Sets name / set_name / num / year / lang on the Side."""
    s = Side()
    if not rec:
        return s
    if rec.get("src") == "psa":
        subj, brand = str(rec.get("subject") or ""), str(rec.get("brand") or "")
        parts = [(subj.split("-", 1)[1], "PSA card name (after the hyphen)")] if "-" in subj else []
        parts += [(rec.get("variety"), "PSA variety"), (rec.get("label"), "PSA label type")]
        for txt, where in parts:
            if not str(txt or "").strip():
                continue
            found, left = dic.match(txt, "any")
            s.add(found, where)
            if meaningful(left):
                s.unknown(str(txt).strip(), left, where)
        s.add(dic.match(brand, "set")[0], "PSA set (brand)")
        s.name, s.set_name, s.year = subj, brand, str(rec.get("year") or "")[:4]
        s.num_raw = str(rec.get("number") or "")
        s.lang, s.lang_said = language_of(brand, rec.get("category"), rec.get("variety"))
        s.source = "PSA's cert record (PSA's Public API)"
    else:
        p = parse_description(rec.get("desc"))
        name = p["name"]
        if "-" in name:
            found, left = dic.match(name.split("-", 1)[1], "any")
            s.add(found, "GemRate description (after the hyphen)")
            if meaningful(left):
                s.unknown(name.split("-", 1)[1].strip(), left, "GemRate description")
        s.add(dic.match(p["set"], "set")[0], "GemRate description (set)")
        s.name, s.set_name, s.year, s.num_raw = name, p["set"], p["year"], p["num"]
        s.lang, s.lang_said = language_of(rec.get("desc"))
        s.source = "the cert's description as Card Hedge relays it from GemRate"
    s.num = clean_num(s.num_raw) if s.num_raw else ""             # graders print no set size: "1/none"
    s.rarity_text = s.shown("Rarity") or None
    s.finish_text = s.shown("Finish") or None
    return s


def compare_auth(au, pc, cl, pc_year, cl_year):
    """{field: [auth shown, result]}: match = agrees with every side that says something, mismatch = disagrees with
    PC or CL, auth_none = the grader's record does not say, others_none = neither PC nor CL says."""
    out = {}

    def res(a, others, same):
        if not a:
            return "auth_none"
        said = [o for o in others if o]
        if not said:
            return "others_none"
        return "match" if all(same(a, o) for o in said) else "mismatch"
    out["number"] = [au.num, res(au.num_raw, [pc.num_raw, cl.num_raw], same_number)]
    for cat, key in (("Rarity", "rarity"), ("Finish", "finish"), ("Special", "special"), ("Series", "series"), ("Era", "era")):
        A = set(au.terms(cat))
        P, C = set(pc.terms(cat)), set(cl.terms(cat))
        if cat in ("Rarity", "Finish", "Series", "Era"):
            out[key] = [", ".join(sorted(A)), res(A, [P, C], lambda a, o: bool(a & o))]
        else:                                                  # Special: the same words on every side; silence counts (compare())
            A2, P2, C2 = A - DEFAULT_SPECIAL, P - DEFAULT_SPECIAL, C - DEFAULT_SPECIAL
            out[key] = [", ".join(sorted(A)), "auth_none" if not (A2 or P2 or C2) else ("match" if A2 == P2 == C2 else "mismatch")]
    ya = str(au.year or "")[:4]
    ya = ya if ya.isdigit() else ""
    py, cy = str(pc_year or "")[:4], str(cl_year or "")[:4]
    out["release"] = [ya, res(ya, [y for y in (py, cy) if y.isdigit()], lambda a, o: a == o)]
    return out


def same_number(a, b):
    """021 = 21; SWSH141 = 141 (PSA and Card Ladder drop a promo's prefix); TG23 != 23 only when both carry prefixes
    that differ."""
    ka, kb = num_key(a), num_key(b)
    if ka == kb:
        return True
    ma, mb = re.match(r"^([a-z]*)(\d+)([a-z]?)$", ka), re.match(r"^([a-z]*)(\d+)([a-z]?)$", kb)
    return bool(ma and mb and ma.group(2) == mb.group(2) and ma.group(3) == mb.group(3) and (not ma.group(1) or not mb.group(1)))


def compare(pc, cl, pc_year, cl_year):
    """{field: [pc shown, cl shown, result]}; result: match | mismatch | pc_none | cl_none | both_none | not_read"""
    out = {}

    def res(a, b, same):
        if not a and not b:
            return "both_none"
        if not a:
            return "pc_none"
        if not b:
            return "cl_none"
        return "match" if same else "mismatch"
    a, b = pc.num_raw, cl.num_raw
    out["number"] = [pc.num, cl.num, res(a, b, same_number(a, b))]
    ta, tb = total_of(a), total_of(b)
    out["total"] = [ta, tb, res(ta, tb, ta == tb)]
    for cat, key in (("Rarity", "rarity"), ("Finish", "finish"), ("Special", "special"), ("Series", "series"), ("Era", "era")):
        A, B = set(pc.terms(cat)), set(cl.terms(cat))
        if cat == "Special":
            # silence counts (2026-10-29, Brett: "u can do #8"): a Special word (1st Edition, a stamp, Ultra Premium
            # Collection ...) that one side names and the other does not means two different printings - the other
            # side is the regular card. So it is a mismatch, not "one side says nothing". Unlimited = the regular card.
            A2, B2 = A - DEFAULT_SPECIAL, B - DEFAULT_SPECIAL
            out[key] = [", ".join(sorted(A)), ", ".join(sorted(B)), "both_none" if not A2 and not B2 else ("match" if A2 == B2 else "mismatch")]
            continue
        out[key] = [", ".join(sorted(A)), ", ".join(sorted(B)), res(A, B, bool(A & B))]
    ya, yb = str(pc_year or "")[:4], str(cl_year or "")[:4]
    ya = ya if ya.isdigit() else ""
    yb = yb if yb.isdigit() else ""
    out["release"] = [ya, yb, res(ya, yb, ya == yb)]
    if pc.artist is None:
        out["illustrator"] = ["not read", "", "not_read"]
    else:
        out["illustrator"] = [pc.artist, "", res(pc.artist, "", False)]   # Card Ladder never says: cl_none / both_none
    return out


class Tally:
    """How often each term / unidentified phrase appears: cards in the graded view per side, and PriceCharting's whole
    catalog for the [bracket] words."""

    def __init__(self):
        self.n = collections.defaultdict(lambda: {"pc": set(), "cl": set(), "auth": set(), "cat": 0, "conf": "", "where": set(), "ex": [], "left": ""})

    def side(self, cid, side, s):
        for cat in CATS:
            for k, conf in s.t[cat].items():
                e = self.n[(cat, k)]
                e[side].add(cid)
                e["conf"] = e["conf"] or conf
                e["where"].add(s.src[cat].get(k, ""))
        for ph, where in s.unid.items():
            e = self.n[("Unidentified", ph)]
            e[side].add(cid)
            e["where"].add(where)
            e["left"] = e["left"] or s.unid_left.get(ph, "")

    def catalog(self, names, dic):
        for name in names:
            for b in split_brackets(name):
                found, left = dic.match(b, "any")
                for x in found:
                    if x["cat"] in CATS:
                        e = self.n[(x["cat"], x["canon"])]
                        e["cat"] += 1
                        e["conf"] = e["conf"] or x["conf"]
                        e["where"].add("PC bracket")
                if meaningful(left):
                    e = self.n[("Unidentified", b)]
                    e["cat"] += 1
                    e["where"].add("PC bracket")
                    e["left"] = e["left"] or " ".join(left)
                    if len(e["ex"]) < 3:
                        e["ex"].append(name)

    def lists(self):
        out = {c: [] for c in CATS + ["Unidentified"]}
        for (cat, k), e in self.n.items():
            out[cat].append([k, e["conf"] or ("" if cat == "Unidentified" else "likely"), len(e["pc"]), len(e["cl"]), e["cat"],
                             " · ".join(sorted(x for x in e["where"] if x)), e["left"], len(e["auth"])])
        for cat in out:
            out[cat].sort(key=lambda r: (-(r[2] + r[3] + r[7]), -r[4], r[0].lower()))
        return out

    def rows(self, built):
        for (cat, k), e in sorted(self.n.items(), key=lambda kv: (kv[0][0], -(len(kv[1]["pc"]) + len(kv[1]["cl"]) + len(kv[1]["auth"])), -kv[1]["cat"], kv[0][1].lower())):
            yield [cat, k, e["conf"], len(e["pc"]), len(e["cl"]), len(e["auth"]), e["cat"], e["left"], " · ".join(sorted(x for x in e["where"] if x)),
                   " | ".join(e["ex"][:3]), built]
