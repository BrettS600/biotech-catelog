"""
cardfacts.py  -  what a card IS: its rarity and its finish, for every row of the PriceCharting catalog, and the
small vocabulary that lets an eBay listing's own rarity / finish be compared with the card it was matched to.

PriceCharting states neither (Brett, 2026-10-12). Its rows carry only a bracket tag for a non-default printing
("Charizard [Reverse Holo] #4"), and the untagged row's finish - holo or not - is never said. Two sources fill
the gap, both free, both read by the daily build (build_catalog.py):

  1. TCGplayer, through TCGCSV (tcgcsv.com, a daily mirror of TCGplayer's catalog): PriceCharting's "tcg-id"
     column is the TCGplayer product id (filled for ~84% of rows; a card's printings share one id). The product
     carries Rarity and Number; its price rows carry one entry per printing (Normal / Holofoil / Reverse
     Holofoil / 1st Edition Holofoil ...), which settles the untagged row's finish.
  2. The open Pokemon TCG dataset (github.com/PokemonTCG/pokemon-tcg-data): rarity for every English card,
     matched by set name + card number (the build already matches the set names for the /102 sizes).

Finish rules: the bracket tag wins when it names a finish (Reverse Holo, Cosmos Holo, Rainbow Foil ...); a tag
that names an edition or a stamp (1st Edition, Shadowless, Staff ...) keeps the tag and adds the base finish;
the base finish comes from TCGplayer's printings when known, else from the rarity (holo rarities are holo;
Common / Uncommon are plain; a plain "Rare" is plain before Scarlet & Violet and holo from it on).

The comparison vocabulary (rarity_tier, finish_class, rarity_agree, finish_agree) is deliberately coarse:
sellers write "Ultra Rare" for a Double Rare and "Holo Rare" for a Rare, which is noise; "Illustration Rare" on
a Common is a wrong card number (223/197 read as 23/197), which is the signal.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date

TCGCSV = "https://tcgcsv.com/tcgplayer/3"                 # category 3 = Pokemon
TCG_DATA = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master"
HOLO_WORDS = {"holo", "holofoil", "foil", "cosmos", "cracked", "rainbow", "textured", "sparkle", "galaxy",
              "confetti", "spectra", "tekno", "shiny", "shining", "gold", "silver", "prism", "crystal", "etched"}
PLAIN_WORDS = {"regular", "nonholo", "non", "normal", "standard", "none", "matte", "plain"}
PATTERN_WORDS = {"ball", "pokeball", "masterball", "pattern"}            # 151's Poke Ball / Master Ball parallels
ULTRA_WORDS = {"ex", "gx", "v", "vmax", "vstar", "lvx", "lv", "ultra", "double", "secret", "hyper", "rainbow",
               "illustration", "full", "art", "shiny", "amazing", "radiant", "ace", "spec", "break", "prime",
               "legend", "gold", "star", "prism", "crystal", "gallery", "character", "pikachu", "classic",
               "special", "mega", "tag", "team", "alternate", "alt", "textured", "shining", "delta", "futuristic"}
def norm_text(s):
    s = str(s or "").lower().replace("é", "e")
    s = s.replace("1st", "first").replace("-", " ")
    return " ".join(re.findall(r"[a-z0-9]+", s))


def rarity_tier(text):
    """'C' common | 'U' uncommon | 'R' plain rare | 'H' holo rare | 'X' everything above (ex / V / ultra /
    secret / illustration ...) | 'K' Classic Collection reprint | 'P' promo | None when the text says nothing usable."""
    t = norm_text(text)
    if not t:
        return None
    toks = set(t.split())
    if "promo" in toks or "promotional" in toks:
        return "P"
    if "classic" in toks and "collection" in toks:          # an old card reprinted with the anniversary stamp (Celebrations,
        return "K"                                           # 30th Celebration): its own kind, not the set's secret rares
    if toks & ULTRA_WORDS or "black white rare" in t:       # Black Bolt / White Flare's own top rarity
        return "X"
    if "common" in toks and "uncommon" not in toks:
        return "C"
    if "uncommon" in toks:
        return "U"
    if "holo" in toks or "holofoil" in toks or "foil" in toks:
        return "H"
    if "rare" in toks:
        return "R"
    return None


RANK = {"C": 0, "U": 1, "R": 2, "H": 3, "X": 4}


def rarity_agree(a, b):
    """How two rarity texts compare: 'same' | 'near' (one step apart: Rare vs Holo Rare, Holo Rare vs Ultra Rare -
    the usual seller imprecision - and anything against a bare "Rare") | 'far' (two steps or more, or promo
    against non-promo: another card) | None (one side unknown)."""
    ta, tb = rarity_tier(a), rarity_tier(b)
    if ta is None or tb is None:
        return None
    if ta == tb:
        return "same"
    if "P" in (ta, tb):
        return "far"
    if "K" in (ta, tb):                                      # Classic Collection against Secret / Holo / Rare: sellers reuse the
        return "near" if {ta, tb} <= {"K", "X", "H", "R"} else "far"   # original card's words (Brett, 2026-10-13: the Crystal Lugia
    if "R" in (ta, tb):                                      # a bare "Rare" is the generic word for anything above
        return "near"                                        # uncommon: never a sign of another card on its own
    return "near" if abs(RANK[ta] - RANK[tb]) == 1 else "far"


def finish_class(text):
    """'reverse' | 'holo' | 'plain' | None. Editions (1st Edition, Shadowless) say nothing about the finish."""
    t = norm_text(text)
    if not t:
        return None
    toks = set(t.split())
    if "reverse" in toks or toks & PATTERN_WORDS:
        return "reverse"
    if ("non" in toks and "holo" in toks) or toks & PLAIN_WORDS or t in ("no", "n a"):
        return "plain"
    if toks & HOLO_WORDS:
        return "holo"
    return None


def finish_agree(a, b):
    ca, cb = finish_class(a), finish_class(b)
    if ca is None or cb is None:
        return None
    return "same" if ca == cb else "far"


# ---------------- the PriceCharting side ----------------
def split_name(product_name):
    """'Charizard [Reverse Holo] #4' -> ('Charizard', 'Reverse Holo', '4')"""
    name = str(product_name or "").strip()
    m = re.search(r"#(\S+)\s*$", name)
    num = m.group(1) if m else ""
    base = name[:m.start()].strip() if m else name
    tag = " ".join(re.findall(r"\[([^\]]+)\]", base)).strip()
    base = re.sub(r"\[[^\]]+\]", "", base).strip()
    return base, tag, num


def num_key(num):
    """'021/128' | '021' | 'SWSH001' | 'TG05' | '50a' -> a key both sides agree on: prefix + number without
    leading zeros + suffix, lower case."""
    s = str(num or "").strip().split("/")[0].strip()
    m = re.match(r"^([A-Za-z]*)\s?0*(\d+)([A-Za-z]?)$", s)
    if not m:
        return s.lower()
    return (m.group(1) + m.group(2) + m.group(3)).lower()


def is_holo_rarity(rarity):
    return rarity_tier(rarity) in ("H", "X")


def base_finish(rarity, printings, sv_era):
    """The finish of a card's default printing. printings = TCGplayer's subTypeNames for the product (may be
    empty); sv_era = the set is Scarlet & Violet or later, where a plain Rare is printed holo."""
    p = {str(x).lower() for x in (printings or ())}
    tier = rarity_tier(rarity)
    if tier in ("H", "X"):
        return "Holo"
    if tier == "P":
        if "holofoil" in p and "normal" not in p:
            return "Holo"
        if "normal" in p and "holofoil" not in p:
            return "Non-holo"
        return ""
    if tier in ("C", "U"):
        if "holofoil" in p and "normal" not in p:
            return "Holo"                                    # a holo common (Classic Collection, some promos)
        return "Non-holo"
    if tier == "R":
        if "normal" in p:
            return "Non-holo"
        if "holofoil" in p:
            return "Holo"
        return "Holo" if sv_era else "Non-holo"
    if "normal" in p and "holofoil" not in p:
        return "Non-holo"
    if "holofoil" in p and "normal" not in p:
        return "Holo"
    return ""


def tag_finish(tag, base):
    """The Finish text for a PriceCharting row from its bracket tag and the default printing's finish."""
    t = norm_text(tag)
    if not t:
        return base
    toks = set(t.split())
    if "reverse" in toks:
        return "Reverse Holo"
    if ("non" in toks and "holo" in toks) or "no rarity" in t:
        return "Non-holo"
    if toks & PATTERN_WORDS:
        return tag.strip()                                   # "Poke Ball", "Master Ball": the pattern is the finish
    if toks & HOLO_WORDS:
        return tag.strip()                                   # "Cosmos Holo", "Rainbow Foil", "Cracked Ice Holo"
    return (tag.strip() + " " + base).strip()                # "1st Edition Holo", "Shadowless Holo", "Staff Non-holo"


# ---------------- sources ----------------
def _get(session, url, timeout=60):
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()


def fetch_tcgcsv(log=print, workers=6):
    """{TCGplayer product id: {"rarity", "number", "name", "group", "printings"}} for every Pokemon product
    TCGCSV lists. {} when the site cannot be read (the dataset route still runs)."""
    import requests
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) pokemon card catalog build"
    try:
        groups = _get(s, f"{TCGCSV}/groups").get("results") or []
    except Exception as e:
        log(f"TCGCSV: could not read the group list ({e}); rarity and finish come from the open dataset only")
        return {}
    out, failed = {}, []

    def one(g):
        gid = g.get("groupId")
        try:
            prods = _get(s, f"{TCGCSV}/{gid}/products").get("results") or []
            prices = _get(s, f"{TCGCSV}/{gid}/prices").get("results") or []
        except Exception as e:
            return gid, None, str(e)[:80]
        printings = {}
        for p in prices:
            if p.get("subTypeName"):
                printings.setdefault(p.get("productId"), set()).add(str(p["subTypeName"]))
        rows = {}
        for p in prods:
            ext = {str(x.get("name", "")).lower(): str(x.get("value", "")) for x in (p.get("extendedData") or [])}
            if "number" not in ext and "rarity" not in ext:
                continue                                     # sealed product
            rows[int(p["productId"])] = {"rarity": ext.get("rarity", ""), "number": ext.get("number", ""),
                                         "name": str(p.get("name", "")), "group": str(g.get("name", "")),
                                         "printings": sorted(printings.get(p.get("productId"), ()))}
        return gid, rows, None

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for gid, rows, err in ex.map(one, groups):
            if rows is None:
                failed.append(f"{gid}: {err}")
            else:
                out.update(rows)
    log(f"TCGCSV: {len(out):,} card products across {len(groups) - len(failed)} of {len(groups)} sets"
        + (f"; failed: {', '.join(failed[:5])}{' ...' if len(failed) > 5 else ''}" if failed else ""))
    return out


SET_NAME_ALIASES = {"base set": "base", "expedition": "expedition base set", "scarlet violet 151": "151",
                    "pokemon go": "go", "team magma team aqua": "team magma vs team aqua",
                    "unleashed": "hs unleashed", "undaunted": "hs undaunted", "triumphant": "hs triumphant",
                    "fire red leaf green": "firered leafgreen"}
SERIES_PREFIXES = ("scarlet violet", "sword shield", "sun moon", "xy", "black white", "diamond pearl",
                   "heartgold soulsilver", "platinum", "ex")
PROMO_SETS = {"swsh": "swshp", "sm": "smp", "xy": "xyp", "bw": "bwp", "dp": "dpp", "hgss": "hsp", "svp": "svp"}


def norm_set(name):
    s = str(name).lower().replace("é", "e").replace("&", " ").replace("'", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = [t for t in s.split() if t not in ("and", "the")]
    if toks and toks[0] == "pokemon":
        toks = toks[1:]
    return " ".join(toks)


def match_sets(pc_set_names, sets):
    """{PriceCharting set name: dataset set id}, by name (same rules as the /102 sizes in build_catalog.py)."""
    by_norm = {}
    for st in sets:
        by_norm.setdefault(norm_set(st["name"]), st["id"])
    out = {}
    for name in pc_set_names:
        n = norm_set(name)
        n = SET_NAME_ALIASES.get(n, n)
        if n.startswith("mcdonalds ") and not n.startswith("mcdonalds collection"):
            n = "mcdonalds collection " + n[len("mcdonalds "):]
        sid = by_norm.get(n)
        if sid is None:
            for series in SERIES_PREFIXES:
                if n.startswith(series + " ") and by_norm.get(n[len(series) + 1:]):
                    sid = by_norm[n[len(series) + 1:]]
                    break
        if sid is not None:
            out[name] = sid
    return out


def promo_set(num, release):
    """PriceCharting files every Black Star promo under 'Pokemon Promo'; the number's prefix (SWSH001, SM01,
    XY01, BW01, DP01, HGSS01) names the dataset's promo set, and a bare number is placed by the release date."""
    m = re.match(r"^([A-Za-z]+)\s?0*\d+", str(num or ""))
    if m:
        return PROMO_SETS.get(m.group(1).lower())
    y = str(release or "")[:4]
    if y.isdigit():
        y = int(y)
        if y >= 2023:
            return "svp"
        if 2003 <= y <= 2007:
            return "np"
        if 1999 <= y <= 2002:
            return "basep"
    return None


def fetch_sets(log=print):
    import requests
    try:
        return _get(requests.Session(), f"{TCG_DATA}/sets/en.json")
    except Exception as e:
        log(f"Pokemon TCG dataset: could not read the set list ({e})")
        return []


def fetch_dataset(set_ids, log=print, workers=8):
    """{(dataset set id, number key): card} for the sets asked for."""
    import requests
    s = requests.Session()
    want = sorted(set(set_ids))
    cards, failed = {}, []

    def one(sid):
        try:
            return sid, _get(s, f"{TCG_DATA}/cards/en/{sid}.json"), None
        except Exception as e:
            return sid, None, str(e)[:60]

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for sid, rows, err in ex.map(one, want):
            if rows is None:
                failed.append(f"{sid}: {err}")
                continue
            for c in rows:
                cards.setdefault((sid, num_key(c.get("number"))), c)
    log(f"Pokemon TCG dataset: {len(cards):,} cards from {len(want) - len(failed)} of {len(want)} sets"
        + (f"; failed: {', '.join(failed[:5])}" if failed else ""))
    return cards


def annotate(pc, log=print, tcg=None, dataset=None, sets=None):
    """pc: the PriceCharting rows (console-name, product-name, tcg-id, release-date). Returns three lists
    aligned with pc's rows: rarity, finish, source ('tcgplayer' | 'dataset' | 'tag' | ''). The sources are
    fetched unless handed in (tests hand them in)."""
    names = pc["console-name"].astype(str).str.strip().tolist()
    prods = pc["product-name"].astype(str).tolist()
    tcg_ids = pc["tcg-id"].astype(str).str.strip().tolist() if "tcg-id" in pc.columns else [""] * len(pc)
    rel = pc["release-date"].astype(str).tolist() if "release-date" in pc.columns else [""] * len(pc)
    if tcg is None:
        tcg = fetch_tcgcsv(log)
    if sets is None:
        sets = fetch_sets(log)
    set_map = match_sets(sorted(set(names)), sets)
    if dataset is None:
        want = set(set_map.values()) | set(PROMO_SETS.values()) | {"np", "basep"}
        dataset = fetch_dataset(want, log) if sets else {}
    series_of = {st["id"]: st.get("series", "") for st in sets}
    sv_sets = {sid for sid, ser in series_of.items() if ser in ("Scarlet & Violet", "Mega Evolution")}
    rarity, finish, source = [], [], []
    n_tcg = n_ds = n_num_off = 0
    for name, prod, tid, r in zip(names, prods, tcg_ids, rel):
        base, tag, num = split_name(prod)
        rar, printings, src, sid = "", (), "", None
        if tid and tid != "nan":
            p = tcg.get(int(float(tid))) if re.match(r"^\d+(\.0)?$", tid) else None
            if p:
                if not p["number"] or not num or num_key(p["number"]) == num_key(num):
                    rar, printings, src = p["rarity"], p["printings"], "tcgplayer"
                else:
                    n_num_off += 1
        if "promo" in name.lower() and name.lower().strip() == "pokemon promo":
            sid = promo_set(num, r)
        else:
            sid = set_map.get(name)
        c = dataset.get((sid, num_key(num))) if sid else None
        if c and not rar:
            rar, src = c.get("rarity") or "", "dataset"
        if src == "tcgplayer":
            n_tcg += 1
        elif src == "dataset":
            n_ds += 1
        sv = sid in sv_sets if sid else (str(r)[:4].isdigit() and int(str(r)[:4]) >= 2023)
        fin = tag_finish(tag, base_finish(rar, printings, sv)) if (rar or printings or tag) else ""
        if not src and tag:
            src = "tag"
        rarity.append(rar)
        finish.append(fin)
        source.append(src)
    n = len(names)
    log(f"Rarity / finish: {n_tcg:,} rows from TCGplayer (tcg-id), {n_ds:,} from the open dataset (set + number), "
        f"{n - n_tcg - n_ds:,} with neither ({sum(1 for x in rarity if x):,} of {n:,} rows have a rarity; "
        f"{n_num_off} tcg-ids pointed at another card number and were ignored)")
    new_words = sorted({x for x in rarity if x and rarity_tier(x) is None})   # a rarity the tier vocabulary cannot place
    if new_words:                                            # ("Futuristic Rare" on 2026-10-12): add its word to ULTRA_WORDS
        log(f"Rarity words the vocabulary does not know ({len(new_words)}): " + ", ".join(new_words[:12])
            + (" ..." if len(new_words) > 12 else "") + " - they compare as unknown until cardfacts.py learns them")
    return rarity, finish, source
