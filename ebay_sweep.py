"""
ebay_sweep.py  -  eBay side of the catalog. Runs on GitHub Actions every 15 minutes
(see .github/workflows/ebay_sweep.yml). Your laptop is never involved.

Each run:
  1. SWEEP   pulls every raw (Ungraded) Pokemon single listed on eBay US since the last run,
             $25-$200, fixed price, and matches each title to one card in the PriceCharting
             catalog (set + card number + variant). Unmatched titles are kept for review.
  2. TRACK   notices listings that vanished from the newest-first results (hourly presence sweep)
             and confirms each with one getItem call: sold or merely ended, and when. Every
             listing is also looked up at fixed ages (day 3, 10, 30). This is the only sales
             data the Browse API gives you, and it only exists for listings seen while live.
  3. STATS   recomputes every per-card number the eBay Catalog tab shows: raw sales/day
             (lambda), the book of competing listings, sold prices, depth pricing (P24 / P48),
             probability of a 24-hour sale, max buy, and the hot-card checks. It also stamps
             each new listing with the model's claim about it (lambda, rank, P48) so that,
             once a few hundred outcomes exist, the PRICE can be calibrated: how far above or
             below the model's P48 do listings actually sell within 48 hours 70% of the time.
             A per-card daily rollup (sales, cheapest ask) kept for 120 days gives the eBay trend
             columns - the PriceCharting trend formulas applied to a 7-day median of raw sale totals.
  4. PUBLISH writes live/ebay_live.bin (encrypted) which the site fetches - listings posted in
             the last 24 hours, the per-card statistics, each card's book and daily history.

State lives in one encrypted file on the "snapshots" release (ebay_state.json.gz.enc):
open listings, closed listings for the last 60 days, seen ids, learned set totals, API usage.

Secrets: EBAY_CLIENT_ID  EBAY_CLIENT_SECRET  SITE_PASSWORD      Optional variable: BUYER_ZIP
The card list comes from the newest PriceCharting snapshot on the release; nothing else from
PriceCharting is used here.
"""
import base64
import gzip
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

# ---------------- settings ----------------
RELEASE_TAG = "snapshots"
STATE_NAME = "ebay_state.json.gz.enc"
LIVE_DIR = "live"
LIVE_NAME = "ebay_live.bin"

SWEEP_PRICE = (25, 200)      # listing price band pulled from eBay (wider than the tab's $50-150,
                             # so a $60 copy of a $100 card is seen)
TAB_PRICE = (50, 150)        # the tab's default filter; only affects what goes in the live file
CATEGORY_CCG_SINGLES = "183454"          # Toys & Hobbies > Collectible Card Games > CCG Individual Cards
COND_UNGRADED = "4000"                   # eBay condition id: Ungraded (2750 = Graded)
MARKETPLACE = "EBAY_US"
BUYER_ZIP = os.environ.get("BUYER_ZIP", "02101")   # for calculated-shipping estimates
SWEEP_MAX_PAGES = 12         # 200 listings per page, per query
SWEEP_OVERLAP_MIN = 20       # re-read this many minutes before the last sweep (safety margin)
# Tracking. eBay's batch getItems is partner-only, so every status check is one getItem call
# (5,000 calls/day total). Two mechanisms keep that affordable:
#   presence sweep - once an hour, page through the newest listings again; a tracked listing
#                    that has vanished from the results is sold or ended -> one getItem confirms
#   scheduled checks - each tracked listing is looked up at fixed ages, then given up on
PRESENCE_EVERY_H = 1
PRESENCE_HOURS = 36          # how far back the presence sweep looks
PRESENCE_MAX_PAGES = 40
TRACK_MAX_CALLS = 35         # getItem calls per run (35 x 96 runs = 3,360/day)
CHECK_AGES_D = [3, 10, 30]   # scheduled getItem checks, days since first seen
KW_FIRST_CHECK_D = 1         # listings found only by the keyword query get an extra day-1 check
TRACK_GIVE_UP_D = 30         # after the last check the listing counts as unsold ("stale")
KEEP_CLOSED_D = 60           # closed listings kept in state
DAILY_KEEP_D = 120           # per-card daily rollup (sales, 7-day median price, cheapest ask) kept this long
DAILY_REFRESH_D = 3          # the last N days are recomputed every run (late-confirmed sales land on their day)
MED_WINDOW_D = 7             # the price series = median sold total over a trailing 7-day window ...
MED_MIN_SALES = 3            # ... needing at least this many sales in the window
STAT_WINDOW_D = 30           # window for lambda, mu, sold prices, sell-through
CONFIDENCE = 0.70            # depth pricing: P(at least n buyers) >= this
DEPTH_CAP = 3                # never price off deeper than the 3rd cheapest copy
UNDERCUT = 1.00              # dollars under the reference copy
BO_HAIRCUT = 0.90            # Best Offer listings rank at 90% of ask
# Seller feedback bar, count-aware: 100+ ratings need 98%, 20-99 need 95%, under 20 the % is ignored
# (one negative at 20 ratings reads 95%). Failing the bar is a scam-score signal and a gate reason.
SELLER_BARS = [(100, 98.0), (20, 95.0)]
# Scam screen: every listing gets a score from cheap signals; suspect listings are kept out of every
# statistic and hidden (reviewable) on Raw Data; watch listings never sit alone as a card's cheapest copy.
SCAM_WATCH, SCAM_SUSPECT = 3, 5
SCAM_QTY_MIN_PRICE = 75.0    # quantity 3+ only counts on cards worth this much
SCAM_BURST_N, SCAM_BURST_PRICE = 5, 75.0   # tie-breaker: 5+ listings >= $75 in 24 h from an unseen seller
ENRICH_MAX_CALLS = 6         # getItem lookups per run for quantity/returns on cheap or thin-seller listings
ENRICH_RATIO = 0.75          # ... when priced under this share of the card's price
# LP correction: LP copies sell below NM. Prices are normalized to NM-equivalent inside the stats
# (LP total / (1 - discount)) and the page applies the discount back to LP listings on Raw Data.
# The discount starts at LP_DEFAULT_PCT and is replaced by the measured LP-to-NM ratio, per price tier,
# once a tier has LP_MIN_SALES LP sales (falling back to the global ratio, then the default).
LP_DEFAULT_PCT = 12.0
LP_TIERS = [(0, 100), (100, 150), (150, 10**9)]   # by the card's NM price; 150+ is one tier
LP_MIN_SALES = 30
LP_REF_WINDOW_D = 7          # an LP sale is compared with NM/unstated sales of the same card within +/- this
LP_REF_MIN = 2               # ... needing at least this many reference sales
HOT_MIN_SALES = 5
HOT_MIN_SELLTHRU = 0.80
HOT_MAX_HRS = 48
HOT_CONFIRM_N = 3

# ---- Gate (keep in step with build_catalog.py) ----
FEE_PCT = 0.1325             # eBay final value fee, trading cards
BUYER_TAX = 0.065            # eBay charges the fee on the buyer's total incl. their sales tax
FEE_FIXED = 0.30
SHIP_OUT = 4.50
TAX = 0.0625                 # sales tax you pay when buying (MA)
MARGIN = 0.15
FEE_EFF = FEE_PCT * (1 + BUYER_TAX)

UTC = timezone.utc
NOW = datetime.now(UTC).replace(microsecond=0)
TODAY = NOW.date().isoformat()
PASSWORD = os.environ.get("SITE_PASSWORD", "")
DRY_RUN = "--dry-run" in sys.argv                 # use fixtures/, touch nothing on GitHub


def log(*a):
    print(*a, flush=True)


def ts(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(s):
    try:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=UTC)
    except Exception:
        return None


def hours_between(a, b):
    return (b - a).total_seconds() / 3600.0


# ---------------- encryption (same layout as build_catalog.py) ----------------
def _aes():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return AESGCM


def encrypt_file_blob(raw, password):
    """16-byte salt | 12-byte nonce | ciphertext  (password-derived key, like the snapshots)."""
    salt, nonce = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000)
    return salt + nonce + _aes()(key).encrypt(nonce, raw, None)


def decrypt_file_blob(blob, password):
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), blob[:16], 600_000)
    return _aes()(key).decrypt(blob[16:28], blob[28:], None)


def live_key(password):
    """Deterministic key shared with the page (build_catalog.py derives the same one)."""
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b"biotech-catalog-live-v1", 600_000)


def encrypt_live(raw, password):
    nonce = os.urandom(12)
    return nonce + _aes()(live_key(password)).encrypt(nonce, raw, None)


# ---------------- GitHub release as a folder ----------------
def gh(*args, check=True):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def release_asset_names():
    out = gh("release", "view", RELEASE_TAG, "--json", "assets", "-q", ".assets[].name", check=False)
    return [n for n in out.split("\n") if n.strip()]


def release_download(name, dest_dir):
    os.makedirs(dest_dir, exist_ok=True)
    gh("release", "download", RELEASE_TAG, "--dir", dest_dir, "--pattern", name, "--clobber")
    return os.path.join(dest_dir, name)


def release_upload(path):
    gh("release", "upload", RELEASE_TAG, path, "--clobber")


# ---------------- state ----------------
def empty_state():
    return {"last_sweep": None, "last_presence": None, "seen": {}, "open": {}, "closed": [], "unmatched": [],
            "denoms": {}, "hot": {}, "calls": {}, "runs": 0, "daily": {}}


def load_state():
    if DRY_RUN:
        p = os.path.join("fixtures", "state.json")
        return json.load(open(p)) if os.path.exists(p) else empty_state()
    if STATE_NAME not in release_asset_names():
        log("No state on the release yet - starting fresh.")
        return empty_state()
    blob = open(release_download(STATE_NAME, "work"), "rb").read()
    return json.loads(gzip.decompress(decrypt_file_blob(blob, PASSWORD)).decode("utf-8"))


def save_state(state):
    raw = gzip.compress(json.dumps(state, separators=(",", ":")).encode("utf-8"))
    os.makedirs("work", exist_ok=True)
    path = os.path.join("work", STATE_NAME)
    with open(path, "wb") as f:
        f.write(encrypt_file_blob(raw, PASSWORD))
    if not DRY_RUN:
        release_upload(path)
    log(f"State saved ({len(raw) / 1e6:.2f} MB gz): {len(state['open'])} open, "
        f"{len(state['closed'])} closed, {len(state['seen'])} seen ids.")


# ---------------- the catalog (card identities only) ----------------
def money(v):
    v = str(v).replace("$", "").replace(",", "").strip()
    try:
        return round(float(v), 2)
    except ValueError:
        return None


def number_parts(num):
    m = re.match(r"^(\D*?)(\d+)(.*)$", str(num))
    if m:
        return m.group(1).upper(), int(m.group(2)), m.group(3).lower()
    return str(num).upper(), 10 ** 9, ""


STOP = {"pokemon", "the", "of", "and", "set", "series", "tcg", "card", "cards"}
# eBay-title shorthand -> the words PriceCharting uses in the set name
SET_ALIASES = {
    "swsh": "sword shield", "sv": "scarlet violet", "svi": "scarlet violet", "sm": "sun moon",
    "bw": "black white", "dp": "diamond pearl", "hgss": "heartgold soulsilver", "hs": "heartgold soulsilver",
    "obf": "obsidian flames", "pal": "paldea evolved", "par": "paradox rift", "paf": "paldean fates",
    "tef": "temporal forces", "twm": "twilight masquerade", "sfa": "shrouded fable", "scr": "stellar crown",
    "ssp": "surging sparks", "jtg": "journey together", "dri": "destined rivals",
    "blk": "black bolt", "wht": "white flare", "meg": "mega evolution", "crz": "crown zenith",
    "sit": "silver tempest", "lor": "lost origin", "pgo": "pokemon go", "asr": "astral radiance",
    "brs": "brilliant stars", "fst": "fusion strike", "cel": "celebrations", "evs": "evolving skies",
    "cre": "chilling reign", "bst": "battle styles", "shf": "shining fates", "viv": "vivid voltage",
    "cpa": "champions path", "daa": "darkness ablaze", "rcl": "rebel clash", "ssh": "sword shield",
    "cec": "cosmic eclipse", "hif": "hidden fates", "unm": "unified minds", "unb": "unbroken bonds",
    "teu": "team up", "drm": "dragon majesty", "ces": "celestial storm",
    "fli": "forbidden light", "upr": "ultra prism", "cin": "crimson invasion", "slg": "shining legends",
    "bus": "burning shadows", "gri": "guardians rising", "sum": "sun moon", "evo": "evolutions",
    "sts": "steam siege", "fco": "fates collide", "gen": "generations", "bkp": "breakpoint",
    "bkt": "breakthrough", "aor": "ancient origins", "ros": "roaring skies", "phf": "phantom forces",
    "ffi": "furious fists", "flf": "flashfire", "ltr": "legendary treasures", "plb": "plasma blast",
    "plf": "plasma freeze", "pls": "plasma storm", "bcr": "boundaries crossed", "drx": "dragons exalted",
    "dex": "dark explorers", "nxd": "next destinies", "nvi": "noble victories", "epo": "emerging powers",
    "blw": "black white", "cl": "call of legends", "tm": "triumphant", "ud": "undaunted", "ul": "unleashed",
    "1st": "1st", "first": "1st", "wotc": "", "holo": "holo", "rh": "reverse holo",
}
VARIANT_WORDS = {  # PriceCharting bracket text -> tokens that must all appear in the title
    "reverse holo": ["reverse"], "reverse foil": ["reverse"], "1st edition": ["1st", "edition"],
    "shadowless": ["shadowless"], "holo": ["holo"], "cosmos holo": ["cosmos"], "staff": ["staff"],
    "prerelease": ["prerelease"], "master ball": ["master", "ball"], "poke ball": ["poke", "ball"],
    "ditto": ["ditto"], "stamped": ["stamped"], "non-holo": ["non", "holo"], "no rarity": ["no", "rarity"],
    "unlimited": ["unlimited"], "error": ["error"], "misprint": ["misprint"], "jumbo": ["jumbo"],
    "gold stamp": ["gold", "stamp"], "league": ["league"], "winner": ["winner"], "e-reader": ["e", "reader"],
    "alternate art": ["alternate", "art"], "full art": ["full", "art"], "secret rare": ["secret"], "gold": ["gold"],
}
REJECT = re.compile(
    r"\b(lot|lots|bundle|bulk|x\d|\dx|choose|pick|you pick|u pick|complete your|playset|"
    r"psa|cgc|bgs|sgc|ace graded|tag graded|graded|slab|gem mint 10|"
    r"proxy|custom|orica|fan made|metal card|gold card|"
    r"japanese|japan|jpn|korean|chinese|german|french|italian|spanish|portuguese|dutch|"
    r"code card|online code|digital|ptcgo|ptcgl|booster box|booster pack|elite trainer|"
    r"repack|mystery|playtest|sticker|coin|damaged|dmg)\b", re.I)
COND_WORDS = [
    (re.compile(r"\b(near mint|nm|mint|pack fresh|nm/m|nm-m)\b", re.I), "NM"),
    (re.compile(r"\b(lightly played|light play|lp|nm/lp|nm-lp|excellent)\b", re.I), "LP"),
    (re.compile(r"\b(moderately played|moderate play|mp|very good)\b", re.I), "MP"),
    (re.compile(r"\b(heavily played|heavy play|hp|poor)\b", re.I), "HP"),
]
COMPARABLE_CONDS = {"NM", "LP", "UNK"}


def norm_tokens(s):
    s = s.lower().replace("&", " ").replace("'", "").replace("\u2019", "").replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return [t for t in s.split() if t and t not in STOP]


class Catalog:
    """Card identities from the newest PriceCharting snapshot, indexed for title matching."""

    def __init__(self, df):
        self.cards = []
        self.by_num = defaultdict(list)          # numeric card number -> card indexes
        set_tokens_all = Counter()               # how many SETS use each word
        seen_sets = set()
        for _, r in df.iterrows():
            name_full = str(r["product-name"]).strip()
            m = re.search(r"#(\S+)\s*$", name_full)
            if not m:
                continue
            num = m.group(1)
            base = name_full[:m.start()].strip()
            variant = " ".join(re.findall(r"\[([^\]]+)\]", base)).lower().strip()
            base = re.sub(r"\[[^\]]+\]", "", base).strip()
            pre, n, suf = number_parts(num)
            setname = str(r["console-name"]).strip()
            stoks = norm_tokens(setname)
            if setname not in seen_sets:
                seen_sets.add(setname)
                set_tokens_all.update(set(stoks))
            self.cards.append({
                "id": int(float(r["id"])), "name": base, "variant": variant, "num": num,
                "pre": pre, "n": n, "suf": suf, "set": setname, "stoks": stoks,
                "ntoks": norm_tokens(base), "epid": str(r.get("epid", "")).strip(),
                "release": str(r.get("release-date", "")).strip()[:10],
            })
        for i, c in enumerate(self.cards):
            self.by_num[c["n"]].append(i)
        n_sets = len({c["set"] for c in self.cards})
        # rarer set words are more informative: "flames" beats "base"
        self.set_idf = {t: math.log((n_sets + 1) / (k + 1)) + 0.5 for t, k in set_tokens_all.items()}
        self.by_epid = {c["epid"]: i for i, c in enumerate(self.cards) if c["epid"] and c["epid"] not in ("", "nan")}
        log(f"Catalog: {len(self.cards):,} cards, {n_sets} sets, {len(self.by_epid):,} with an ePID.")


def load_catalog():
    if DRY_RUN:
        df = pd.read_csv(os.path.join("fixtures", "catalog.csv"), dtype=str).fillna("")
    else:
        names = sorted(n for n in release_asset_names() if n.startswith("pc_catalog_"))
        if not names:
            raise SystemExit("No PriceCharting snapshot on the release yet - run the daily workflow first.")
        blob = open(release_download(names[-1], "work"), "rb").read()
        if names[-1].endswith(".enc"):
            blob = decrypt_file_blob(blob, PASSWORD)
        df = pd.read_csv(io.BytesIO(gzip.decompress(blob)), dtype=str).fillna("")
        log(f"Catalog source: {names[-1]}")
    return Catalog(df)


# ---------------- title parsing and matching ----------------
KNOWN_PREFIXES = {"TG", "GG", "SV", "SWSH", "SVP", "SM", "XY", "BW", "DP", "HGSS", "RC", "H", "SH", "GR", "BEP", "TR"}
NUM_SLASH = re.compile(r"(?<![\w/])([A-Za-z]{1,4})?(\d{1,3})([a-z])?\s*/\s*([A-Za-z]{1,4})?(\d{1,3})(?![\w/])")
NUM_HASH = re.compile(r"(?:#|\bno\.?\s?)\s?([A-Za-z]{0,4}\d{1,3}[a-z]?)\b", re.I)
NUM_PREFIXED = re.compile(r"\b(SWSH|SVP|SV|SM|XY|BW|DP|HGSS|TG|GG|RC|SH|GR|BEP|TR)\s?(\d{1,3})([a-z])?\b", re.I)


def _pre(p):
    p = (p or "").upper()
    return p if p in KNOWN_PREFIXES else ""


def parse_number(title):
    """-> (prefix, number, suffix, denominator or None) or None"""
    m = NUM_SLASH.search(title)
    if m:
        return _pre(m.group(1)), int(m.group(2)), (m.group(3) or "").lower(), int(m.group(5))
    m = NUM_HASH.search(title)
    if m:
        pre, n, suf = number_parts(m.group(1))
        return _pre(pre), n, suf, None
    m = NUM_PREFIXED.search(title)
    if m:
        return _pre(m.group(1)), int(m.group(2)), (m.group(3) or "").lower(), None
    return None


def title_condition(title):
    for rx, c in COND_WORDS:
        if rx.search(title):
            return c
    return "UNK"


def expand_aliases(tokens):
    out = []
    for t in tokens:
        if t in SET_ALIASES:
            out.extend(SET_ALIASES[t].split())
        else:
            out.append(t)
    return out


CLAIM_WORDS = {"reverse": ["reverse"], "1st edition": ["1st", "edition"], "shadowless": ["shadowless"]}


def match_title(cat, title, epid, denoms):
    """Return (card_index, method, score) or (None, reason, 0)."""
    rj = REJECT.search(title)
    if rj:
        return None, "rejected: " + rj.group(1).lower(), 0
    if epid and epid in cat.by_epid:
        return cat.by_epid[epid], "epid", 1.0
    parsed = parse_number(title)
    if not parsed:
        return None, "no card number", 0
    pre, n, suf, den = parsed
    cands = cat.by_num.get(n, [])
    if not cands:
        return None, f"no card #{n}", 0
    ttoks = expand_aliases(norm_tokens(title))
    tset = set(ttoks)
    scored = []
    for i in cands:
        c = cat.cards[i]
        if pre != c["pre"]:                       # "TG20" and "#20" are different cards
            continue
        if suf and c["suf"] and suf != c["suf"]:
            continue
        # set score: idf-weighted share of the set's words found in the title;
        # the set's single most distinctive word alone is worth 0.6 ("151", "jungle", "fossil")
        weights = {t: cat.set_idf[t] for t in c["stoks"]}
        tot = sum(weights.values()) or 1.0
        hitw = sum(w for t, w in weights.items() if t in tset)
        set_score = hitw / tot
        if weights and max(weights, key=weights.get) in tset:
            set_score = max(set_score, 0.6)
        # a learned set total ("/165") can stand in for a missing set name
        den_ok = False
        if den is not None:
            dmap = denoms.get(c["set"], {})
            if dmap and dmap.get(str(den), 0) >= 5 and dmap.get(str(den)) == max(dmap.values()):
                den_ok = True
        if set_score < 0.5 and not den_ok:
            continue
        ntoks = c["ntoks"] or ["?"]
        if ntoks[0] not in tset:                  # the Pokemon's name has to be there
            continue
        name_score = sum(1 for t in ntoks if t in tset) / len(ntoks)
        if name_score < 0.5:
            continue
        score = 0.6 * max(set_score, 0.9 if den_ok else 0) + 0.4 * name_score
        scored.append((round(score, 4), round(hitw, 4), i, set_score >= 0.5))
    if not scored:
        return None, "no set/name agreement", 0
    scored.sort(reverse=True)
    best_s, best_w, best_i, by_set = scored[0]
    best_set = cat.cards[best_i]["set"]
    group = [i for s_, w_, i, _ in scored if cat.cards[i]["set"] == best_set]      # that card's variants
    others = [(s_, w_) for s_, w_, i, _ in scored if cat.cards[i]["set"] != best_set]
    if others and best_s - others[0][0] < 0.15 and best_w <= others[0][1]:
        return None, "ambiguous set", 0
    choice = resolve_variant(cat, group, tset)
    if choice is None:
        return None, "ambiguous variant", 0
    return choice, ("number+set" if by_set else "number+total"), best_s


def resolve_variant(cat, idxs, tset):
    """Pick one row among a card's printings; None when the title is unclear."""
    def claims(v):
        need = VARIANT_WORDS.get(v)
        if need is None:
            need = v.split()
        return all(w in tset for w in need)
    for word, need in CLAIM_WORDS.items():         # the title says reverse / 1st ed / shadowless ...
        if all(w in tset for w in need) and not any(word in cat.cards[i]["variant"] for i in idxs):
            return None                             # ... and the catalog has no such printing here
    if len(idxs) == 1:
        return idxs[0]
    claimed = [(len(cat.cards[i]["variant"]), i) for i in idxs if cat.cards[i]["variant"] and claims(cat.cards[i]["variant"])]
    if claimed:
        claimed.sort(reverse=True)
        return claimed[0][1]
    plain = [i for i in idxs if not cat.cards[i]["variant"]]
    if len(plain) == 1:
        return plain[0]
    holo = [i for i in idxs if cat.cards[i]["variant"] in ("holo", "cosmos holo")]
    if not plain and len(holo) == 1 and len(idxs) == 2:
        return holo[0]
    return None


# ---------------- eBay API ----------------
API = "https://api.ebay.com"
_token = {"v": None, "exp": 0}


def get_token():
    if _token["v"] and time.time() < _token["exp"] - 60:
        return _token["v"]
    cid, sec = os.environ.get("EBAY_CLIENT_ID", ""), os.environ.get("EBAY_CLIENT_SECRET", "")
    if not cid or not sec:
        raise SystemExit("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET secrets are missing.")
    r = requests.post(f"{API}/identity/v1/oauth2/token",
                      headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode(),
                               "Content-Type": "application/x-www-form-urlencoded"},
                      data={"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"},
                      timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"eBay token request failed: HTTP {r.status_code} {r.text[:200]}")
    j = r.json()
    _token["v"], _token["exp"] = j["access_token"], time.time() + int(j.get("expires_in", 7200))
    return _token["v"]


def api_get(state, path, params, ok_404=False):
    state["calls"][TODAY] = state["calls"].get(TODAY, 0) + 1
    for attempt in range(3):
        headers = {"Authorization": "Bearer " + get_token(),
                   "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
                   "X-EBAY-C-ENDUSERCTX": f"contextualLocation=country%3DUS%2Czip%3D{BUYER_ZIP}"}
        r = requests.get(f"{API}{path}", headers=headers, params=params, timeout=60)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            time.sleep(3 * (attempt + 1))
            continue
        if r.status_code == 401:
            _token["v"] = None
            continue
        if r.status_code == 404 and ok_404:
            return None
        raise RuntimeError(f"eBay {path} -> HTTP {r.status_code}: {r.text[:300]}")
    raise RuntimeError(f"eBay {path} failed after retries")


def summary_record(s):
    """Flatten an item summary to what we keep."""
    price = money(s.get("price", {}).get("value"))
    ship = None
    so = s.get("shippingOptions") or []
    if so:
        ship = money(so[0].get("shippingCost", {}).get("value"))
    seller = s.get("seller") or {}
    pct = seller.get("feedbackPercentage")
    return {
        "id": s.get("itemId"), "legacy": s.get("legacyItemId"), "title": s.get("title", ""),
        "item": price, "ship": ship, "shipType": (so[0].get("shippingCostType") if so else None),
        "total": None if price is None else round(price + (ship or 0), 2),
        "cond": s.get("condition"), "condId": s.get("conditionId"),
        "bo": "BEST_OFFER" in (s.get("buyingOptions") or []),
        "seller": seller.get("username"),
        "fb": seller.get("feedbackScore"), "pct": float(pct) if pct not in (None, "") else None,
        "n_img": (1 if s.get("image") else 0) + len(s.get("additionalImages") or []),
        "dmax": (so[0].get("maxEstimatedDeliveryDate") if so else None),
        "origin": s.get("itemOriginDate") or s.get("itemCreationDate"), "end": s.get("itemEndDate"),
        "epid": s.get("epid") or "", "img": (s.get("image") or {}).get("imageUrl"),
        "url": s.get("itemWebUrl"), "loc": (s.get("itemLocation") or {}).get("stateOrProvince"),
        "promo": bool(s.get("priorityListing")), "top": bool(s.get("topRatedBuyingExperience")),
    }


# ---------------- 1. SWEEP ----------------
BASE_QUERY = {
    "category_ids": CATEGORY_CCG_SINGLES,
    "filter": f"conditionIds:{{{COND_UNGRADED}}},price:[{SWEEP_PRICE[0]}..{SWEEP_PRICE[1]}],"
              f"priceCurrency:USD,buyingOptions:{{FIXED_PRICE}},itemLocationCountry:US",
    "sort": "newlyListed", "limit": "200",
}
QUERIES = {"aspect": dict(BASE_QUERY, aspect_filter=f"categoryId:{CATEGORY_CCG_SINGLES},Game:{{Pok\u00e9mon TCG}}"),
           "kw": dict(BASE_QUERY, q="pokemon")}


def search_pages(state, qname, max_pages, cutoff):
    """Yield (page_items, oldest_origin_on_page) walking newest -> oldest until cutoff is passed."""
    for page in range(max_pages):
        if DRY_RUN:
            pages = json.load(open(os.path.join("fixtures", "search.json")))
            pages = pages if isinstance(pages, list) else [pages]
            if page >= len(pages):
                return
            j = pages[page]
        else:
            j = api_get(state, "/buy/browse/v1/item_summary/search", dict(QUERIES[qname], offset=str(page * 200)))
        items = j.get("itemSummaries") or []
        oldest = None
        for s in items:
            o = parse_ts(s.get("itemOriginDate") or s.get("itemCreationDate") or "")
            if o is not None:
                oldest = o if oldest is None else min(oldest, o)
        yield items, oldest
        if len(items) < 200 or (oldest is not None and oldest < cutoff):
            return


def sweep(state, cat):
    last = parse_ts(state["last_sweep"]) if state["last_sweep"] else None
    cutoff = (last - timedelta(minutes=SWEEP_OVERLAP_MIN)) if last else (NOW - timedelta(hours=24))
    log(f"Sweep: listings since {ts(cutoff)}")
    seen_now, new, matched, unmatched = set(), 0, 0, 0
    for qname in (["aspect"] if DRY_RUN else list(QUERIES)):
        for items, _oldest in search_pages(state, qname, SWEEP_MAX_PAGES, cutoff):
            for s in items:
                rec = summary_record(s)
                iid = rec["id"]
                if not iid or iid in seen_now:
                    continue
                seen_now.add(iid)
                if iid in state["seen"] or iid in state["open"]:
                    continue
                if rec["cond"] and "ungraded" not in rec["cond"].lower():
                    continue
                new += 1
                state["seen"][iid] = ts(NOW)
                ci, how, score = match_title(cat, rec["title"], rec["epid"], state["denoms"])
                if ci is None:
                    unmatched += 1
                    state["unmatched"].append([ts(NOW), iid, rec["title"], rec["total"], rec["url"], how])
                    continue
                matched += 1
                c = cat.cards[ci]
                parsed = parse_number(rec["title"])
                if parsed and parsed[3] is not None and how == "number+set" and score >= 0.85:
                    d = state["denoms"].setdefault(c["set"], {})
                    d[str(parsed[3])] = d.get(str(parsed[3]), 0) + 1
                rec.update({"card": c["id"], "how": how, "tcond": title_condition(rec["title"]),
                            "first": ts(NOW), "src": qname, "checked": None, "checked_age": 0.0,
                            "suspect": False, "rev": None, "hist": []})
                state["open"][iid] = rec
    state["last_sweep"] = ts(NOW)
    log(f"Sweep: {len(seen_now)} summaries read, {new} new, {matched} matched, {unmatched} unmatched.")


# ---------------- 2. TRACK ----------------
def close_listing(state, iid, rec, outcome, when, total=None):
    first = parse_ts(rec["first"]) or NOW
    origin = parse_ts(rec.get("origin") or "") or first
    end = when or NOW
    state["closed"].append({
        "id": iid, "card": rec["card"], "first": rec["first"], "origin": ts(origin), "closed": ts(end),
        "out": outcome, "total": total if total is not None else rec["total"], "item": rec["item"],
        "ship": rec["ship"], "tcond": rec.get("tcond", "UNK"), "bo": rec["bo"], "pct": rec["pct"],
        "fb": rec["fb"], "hrs": round(max(0.0, hours_between(origin, end)), 1), "title": rec["title"],
        "url": rec["url"],
        # what the model believed when this listing first appeared (for price calibration)
        "lam0": rec.get("lam0"), "rank0": rec.get("rank0"), "p48_0": rec.get("p48_0"), "p24_0": rec.get("p24_0"),
        "eff0": rec.get("eff0"),
        # scam-screen stamp at close (calibration record) and the listing facts behind it
        "seller": rec.get("seller"), "n_img": rec.get("n_img"), "qty": rec.get("qty"), "ret": rec.get("ret"),
        "img": rec.get("img"), "top": rec.get("top"), "sc": rec.get("sc"), "scr": rec.get("scr", []),
        **({"tier": rec["tier"]} if "tier" in rec else {}),
    })
    del state["open"][iid]


def presence_sweep(state):
    """Re-read the newest listings; return (ids present, oldest origin reached)."""
    horizon = NOW - timedelta(hours=PRESENCE_HOURS)
    present, reached = set(), NOW
    for items, oldest in search_pages(state, "aspect", PRESENCE_MAX_PAGES, horizon):
        for s in items:
            if s.get("itemId"):
                present.add(s["itemId"])
        if oldest is not None:
            reached = min(reached, oldest)
    state["last_presence"] = ts(NOW)
    return present, reached


def classify(it):
    """getItem (COMPACT) payload -> ('sold' | 'ended' | 'open', price)."""
    av = (it.get("estimatedAvailabilities") or [{}])[0]
    status = av.get("estimatedAvailabilityStatus", "")
    sold_q = av.get("estimatedSoldQuantity") or 0
    remaining = av.get("estimatedRemainingQuantity")
    if remaining is None:
        remaining = av.get("estimatedAvailableQuantity")
    price = money((it.get("price") or {}).get("value"))
    end = parse_ts(it.get("itemEndDate") or "")
    over = (end is not None and end <= NOW) or status == "OUT_OF_STOCK" or remaining == 0
    if not over:
        return "open", price, None
    return ("sold" if sold_q >= 1 else "ended"), price, end


def track(state):
    # 1. presence sweep: anything tracked that should still be in the results but isn't is suspect
    suspects = 0
    last_p = parse_ts(state.get("last_presence") or "") if state.get("last_presence") else None
    if last_p is None or hours_between(last_p, NOW) >= PRESENCE_EVERY_H:
        present, reached = presence_sweep(state)
        margin = reached + timedelta(minutes=30)
        for iid, rec in state["open"].items():
            origin = parse_ts(rec.get("origin") or rec["first"]) or parse_ts(rec["first"])
            if rec.get("src") == "aspect" and origin > margin and hours_between(parse_ts(rec["first"]), NOW) > 0.5 \
                    and iid not in present and not rec.get("suspect"):
                rec["suspect"] = True
                suspects += 1
        log(f"Presence: {len(present)} listings visible back to {ts(reached)}; {suspects} newly missing.")
    # 2. decide who gets a getItem call this run
    due = []
    for iid, rec in state["open"].items():
        age_d = hours_between(parse_ts(rec["first"]), NOW) / 24
        if rec.get("suspect"):
            due.append((0, iid))
            continue
        ages = ([KW_FIRST_CHECK_D] if rec.get("src") == "kw" else []) + CHECK_AGES_D
        nxt = next((a for a in ages if a > rec.get("checked_age", 0.0) and a <= age_d), None)
        if nxt is not None:
            due.append((1 + nxt, iid))
        elif age_d > TRACK_GIVE_UP_D and rec.get("checked_age", 0.0) >= CHECK_AGES_D[-1]:
            close_listing(state, iid, rec, "stale", NOW)
    due.sort()
    ids = [iid for _, iid in due][:TRACK_MAX_CALLS]
    sold = ended = gone = changed = still = 0
    for iid in ids:
        rec = state["open"].get(iid)
        if not rec:
            continue
        if DRY_RUN:
            fx = json.load(open(os.path.join("fixtures", "items.json")))
            it = fx.get(iid)
        else:
            it = api_get(state, f"/buy/browse/v1/item/{iid}", {"fieldgroups": "COMPACT"}, ok_404=True)
        rec["checked"] = ts(NOW)
        rec["checked_age"] = hours_between(parse_ts(rec["first"]), NOW) / 24
        if it is None:
            close_listing(state, iid, rec, "gone", NOW)          # removed by eBay/seller before we saw it end
            gone += 1
            continue
        kind, price, end = classify(it)
        total = None if price is None else round(price + (rec["ship"] or 0), 2)
        if kind == "sold":
            close_listing(state, iid, rec, "sold", end or NOW, total)
            sold += 1
        elif kind == "ended":
            close_listing(state, iid, rec, "ended", end or NOW, total)
            ended += 1
        else:
            still += 1
            rec["suspect"] = False
            sold_q = ((it.get("estimatedAvailabilities") or [{}])[0].get("estimatedSoldQuantity") or 0)
            if sold_q > rec.get("soldq", 0):                     # a multi-quantity listing sold some copies
                for _ in range(min(3, sold_q - rec.get("soldq", 0))):
                    origin = parse_ts(rec.get("origin") or rec["first"]) or parse_ts(rec["first"])
                    state["closed"].append({
                        "id": f"{iid}#{sold_q}", "card": rec["card"], "first": rec["first"], "origin": ts(origin),
                        "closed": ts(NOW), "out": "sold", "total": total, "item": price, "ship": rec["ship"],
                        "tcond": rec.get("tcond", "UNK"), "bo": rec["bo"], "pct": rec["pct"], "fb": rec["fb"],
                        "hrs": round(max(0.0, hours_between(origin, NOW)), 1), "title": rec["title"], "url": rec["url"]})
                    sold += 1
                rec["soldq"] = sold_q
            if price is not None and rec["item"] is not None and abs(price - rec["item"]) >= 0.01:
                rec["hist"].append([ts(NOW), rec["item"], price])
                rec["item"], rec["total"] = price, total
                changed += 1
            rec["rev"] = it.get("sellerItemRevision")
    log(f"Track: {len(ids)} looked up ({len(due)} due) - {sold} sold, {ended} ended, {gone} gone, "
        f"{still} still open, {changed} repriced.")


# ---------------- 3. STATS ----------------
def gamma_q(shape, rate, p):
    """Wilson-Hilferty approximation of the Gamma quantile (good enough for shape >= 0.5)."""
    z = {0.25: -0.6745, 0.5: 0.0, 0.75: 0.6745}[p]
    a = shape
    x = a * (1 - 1 / (9 * a) + z / (3 * math.sqrt(a))) ** 3
    return max(x, 0.0) / rate


def poisson_ge_prob(lam, n):
    """P(X >= n) for X ~ Poisson(lam)."""
    if n <= 0:
        return 1.0
    p, cum = math.exp(-lam), math.exp(-lam)
    for k in range(1, n):
        p *= lam / k
        cum += p
    return max(0.0, 1 - cum)


def depth(lam, T):
    if lam is None:
        return None
    best = 0
    for n in range(1, DEPTH_CAP + 1):
        if poisson_ge_prob(lam * T, n) >= CONFIDENCE:
            best = n
    return best


def pct(vals, q):
    if not vals:
        return None
    v = sorted(vals)
    k = (len(v) - 1) * q
    f, c = math.floor(k), math.ceil(k)
    return v[f] if f == c else v[f] + (v[c] - v[f]) * (k - f)


def seller_bar(rec):
    """None when the seller clears the count-aware feedback bar, else the bar it failed (98.0 or 95.0)."""
    fb, pct = rec.get("fb"), rec.get("pct")
    if pct is None or fb is None:
        return None
    for min_fb, bar in SELLER_BARS:
        if fb >= min_fb:
            return bar if pct < bar else None
    return None


def comparable(rec):
    return rec.get("tcond", "UNK") in COMPARABLE_CONDS and rec.get("tier") != "suspect"


# ---------------- scam screen ----------------
SCAM_LABELS = {
    "p50": "priced under 50% of the card's price", "p65": "priced 50-65% of the card's price",
    "p75": "priced 65-75% of the card's price", "fb0": "seller feedback under 10", "fb1": "seller feedback 10-49",
    "fbq": "seller feedback unknown", "pct": "feedback % below the bar for its count", "img": "one photo only",
    "qty": "3+ copies available of a $75+ card", "dup": "photo also used by another seller",
    "ret": "no returns and priced under 65%", "slow": "delivery window over 10 days",
    "top": "Top Rated Plus", "est": "500+ feedback at 99%+", "burst": "same-day burst from an unseen seller",
}


def img_key(url):
    m = re.search(r"/images/g/([^/]+)/", url or "")
    return m.group(1) if m else None


def score_listings(state):
    """Stamp every open listing with a scam score, the signals behind it and a tier (clean/watch/suspect).
    Closed listings keep the stamp they had when they closed (that is the calibration record)."""
    opens = list(state["open"].values())
    recs_all = opens + state["closed"]
    cache = state.get("price_cache", {})
    day_ago = NOW - timedelta(hours=24)
    # photo reuse: image id -> sellers that used it
    img_sellers = defaultdict(set)
    for r in recs_all:
        k = img_key(r.get("img"))
        if k and r.get("seller"):
            img_sellers[k].add(r["seller"])
    # seller bursts: listings >= $75 first seen in the last 24 h, and whether the seller has older history
    burst_n, prior = Counter(), set()
    for r in recs_all:
        sl = r.get("seller")
        if not sl:
            continue
        t = parse_ts(r["first"])
        if t and t >= day_ago:
            if r.get("total") is not None and r["total"] >= SCAM_BURST_PRICE:
                burst_n[sl] += 1
        else:
            prior.add(sl)
    # second-cheapest open ask per card, the price reference before a card has a price of its own
    asks = defaultdict(list)
    for r in opens:
        if r.get("total") is not None and r.get("tcond", "UNK") in COMPARABLE_CONDS:
            asks[r["card"]].append((r["total"], r["id"]))
    tiers, fired = Counter(), Counter()
    for r in opens:
        total = r.get("total")
        ref = cache.get(str(r["card"]))
        if ref is None:
            others = sorted(v for v, iid in asks.get(r["card"], []) if iid != r["id"])
            ref = others[1] if len(others) >= 2 else None
        pts, why = 0, []
        ratio = total / ref if (total is not None and ref) else None
        if ratio is not None:
            hi = ref >= 100
            if ratio < 0.50:
                pts += 4; why.append("p50")
            elif ratio < (0.70 if hi else 0.65):
                pts += 2; why.append("p65")
            elif ratio < (0.80 if hi else 0.75):
                pts += 1; why.append("p75")
        fb, pct = r.get("fb"), r.get("pct")
        if fb is None:
            pts += 1; why.append("fbq")
        elif fb < 10:
            pts += 3; why.append("fb0")
        elif fb < 50:
            pts += 1; why.append("fb1")
        if seller_bar(r) is not None:
            pts += 2; why.append("pct")
        if r.get("n_img") is not None and r["n_img"] <= 1:
            pts += 1; why.append("img")
        if r.get("qty") is not None and r["qty"] >= 3 and (ref or total or 0) >= SCAM_QTY_MIN_PRICE \
                and (fb is None or fb < 500):                # "a $75+ card": the card's price, else the ask
            pts += 2; why.append("qty")
        k = img_key(r.get("img"))
        if k and r.get("seller") and len(img_sellers[k] - {r["seller"]}) > 0:
            pts += 3; why.append("dup")
        if r.get("ret") is False and ratio is not None and ratio < 0.65:
            pts += 1; why.append("ret")
        dmax = parse_ts(r.get("dmax") or "")
        origin = parse_ts(r.get("origin") or "") or parse_ts(r["first"])
        if dmax and origin and (dmax - origin).days > 10:
            pts += 1; why.append("slow")
        if r.get("top"):
            pts -= 2; why.append("top")
        if fb is not None and fb >= 500 and pct is not None and pct >= 99:
            pts -= 1; why.append("est")
        tier = "suspect" if pts >= SCAM_SUSPECT else "watch" if pts >= SCAM_WATCH else "clean"
        sl = r.get("seller")
        if tier == "watch" and sl and burst_n[sl] >= SCAM_BURST_N and sl not in prior:
            tier = "suspect"; why.append("burst")
        r["sc"], r["scr"], r["tier"] = pts, why, tier
        tiers[tier] += 1
        fired.update(why)
    log(f"Scam screen: {tiers['clean']} clean, {tiers['watch']} watch, {tiers['suspect']} suspect among open listings; "
        "signals: " + ", ".join(f"{k} {n}" for k, n in fired.most_common()))


def scam_calib(state):
    """Outcomes of closed listings by tier and by signal: the data that says whether the score works."""
    tiers, signals = {}, {}
    for r in state["closed"]:
        if "tier" not in r:
            continue
        out = r.get("out") or "?"
        t = tiers.setdefault(r["tier"], Counter())
        t[out] += 1
        for code in r.get("scr", []):
            signals.setdefault(code, Counter())[out] += 1
    return {"tiers": {k: dict(v) for k, v in tiers.items()}, "signals": {k: dict(v) for k, v in signals.items()},
            "labels": SCAM_LABELS, "watch": SCAM_WATCH, "suspect": SCAM_SUSPECT}


def enrich(state):
    """One full getItem for new listings the score could turn on quantity/returns: priced well under the
    card's price, or from a thin seller on a $75+ card. Capped per run to protect the API budget."""
    cache = state.get("price_cache", {})
    cands = []
    day_ago = NOW - timedelta(hours=24)
    for iid, r in state["open"].items():
        if r.get("enriched") or r.get("total") is None or parse_ts(r["first"]) < day_ago:
            continue                                     # only listings seen in the last day, once each
        ref = cache.get(str(r["card"]))
        cheap = ref is not None and r["total"] < ENRICH_RATIO * ref
        thin = r["total"] >= SCAM_QTY_MIN_PRICE and (r.get("fb") is None or r["fb"] < 10)   # the +3 tier only
        if cheap or thin:
            cands.append((r["total"] / ref if ref else 1.0, iid))
    cands.sort()
    n = 0
    for _, iid in cands[:ENRICH_MAX_CALLS]:
        r = state["open"][iid]
        if DRY_RUN:
            it = json.load(open(os.path.join("fixtures", "items.json"))).get(iid)
        else:
            it = api_get(state, f"/buy/browse/v1/item/{iid}", {}, ok_404=True)
        r["enriched"] = True
        if not it:
            continue
        av = (it.get("estimatedAvailabilities") or [{}])[0]
        q = av.get("estimatedAvailableQuantity")
        if q is None:
            q = av.get("estimatedRemainingQuantity")
        r["qty"] = q
        rt = it.get("returnTerms") or {}
        if "returnsAccepted" in rt:
            r["ret"] = bool(rt["returnsAccepted"])
        if it.get("additionalImages") is not None:
            r["n_img"] = (1 if it.get("image") else 0) + len(it.get("additionalImages") or [])
        n += 1
    if cands:
        log(f"Enrich: {n} of {len(cands)} candidate listings looked up for quantity/returns.")


def r2(v):
    return None if v is None else round(v, 2)


def gate(csell):
    net = csell * (1 - FEE_EFF) - FEE_FIXED - SHIP_OUT
    return round(net, 2), round(net / (1 + MARGIN), 2)


def lp_correction(state):
    """Measured LP discount: for every LP sale, its total divided by the median of the same card's
    NM/unstated sales within +/- LP_REF_WINDOW_D days; the discount is 1 - median(ratio), pooled across
    all cards, per price tier of the reference price. Ladder: tier (>= LP_MIN_SALES) -> global -> default."""
    by_card = defaultdict(lambda: {"ref": [], "lp": []})
    for r in state["closed"]:
        if r["out"] != "sold" or r["total"] is None:
            continue
        c = r.get("tcond", "UNK")
        t = parse_ts(r["closed"])
        if c in ("NM", "UNK"):
            by_card[r["card"]]["ref"].append((t, r["total"]))
        elif c == "LP":
            by_card[r["card"]]["lp"].append((t, r["total"]))
    ratios = []                                        # (reference price, ratio)
    win = timedelta(days=LP_REF_WINDOW_D)
    for cid, d in by_card.items():
        for t, total in d["lp"]:
            ref = [v for (tt, v) in d["ref"] if abs(tt - t) <= win]
            if len(ref) < LP_REF_MIN:
                continue
            ref_med = pct(ref, 0.5)
            if ref_med and 0.4 <= total / ref_med <= 1.2:      # outside this it is a mislabel, not a discount
                ratios.append((ref_med, total / ref_med))
    def disc(rs):
        return None if len(rs) < LP_MIN_SALES else round((1 - pct([x[1] for x in rs], 0.5)) * 100, 1)
    g_pct = disc(ratios)
    tiers = []
    for lo, hi in LP_TIERS:
        rs = [x for x in ratios if lo <= x[0] < hi]
        t_pct = disc(rs)
        if t_pct is not None:
            tiers.append({"lo": lo, "hi": hi, "pct": t_pct, "n": len(rs), "src": "tier"})
        elif g_pct is not None:
            tiers.append({"lo": lo, "hi": hi, "pct": g_pct, "n": len(rs), "src": "global"})
        else:
            tiers.append({"lo": lo, "hi": hi, "pct": LP_DEFAULT_PCT, "n": len(rs), "src": "default"})
    return {"default": LP_DEFAULT_PCT, "minSales": LP_MIN_SALES, "window": LP_REF_WINDOW_D,
            "global": {"pct": g_pct, "n": len(ratios)}, "tiers": tiers}


def lp_frac(lp, price):
    """The LP discount (as a fraction) for a card at this NM price."""
    if price is None:
        return lp["tiers"][0]["pct"] / 100
    for t in lp["tiers"]:
        if t["lo"] <= price < t["hi"]:
            return t["pct"] / 100
    return lp["tiers"][-1]["pct"] / 100


# ---------------- daily rollup (the eBay trend series) ----------------
def update_daily(state, lp):
    """state['daily'][card][YYYY-MM-DD] = [sold totals that day (NM-equivalent), cheapest comparable ask, new listings].
    Frozen once a day is older than DAILY_REFRESH_D; recent days are rebuilt from the records."""
    daily = state.setdefault("daily", {})
    ref_price = {}                                       # card -> median raw sold total, to pick the LP tier
    tots = defaultdict(list)
    for r in state["closed"]:
        if r["out"] == "sold" and r.get("tcond", "UNK") in COMPARABLE_CONDS and r["total"] is not None:
            tots[r["card"]].append(r["total"])
    for cid, v in tots.items():
        ref_price[cid] = pct(v, 0.5)
    keep_from = (NOW - timedelta(days=DAILY_KEEP_D)).date().isoformat()
    refresh = {(NOW - timedelta(days=i)).date().isoformat() for i in range(DAILY_REFRESH_D)}
    if not daily:                                        # first run with a rollup: build it from everything on hand
        refresh = {r["closed"][:10] for r in state["closed"]} | {r["first"][:10] for r in state["closed"]} \
            | {r["first"][:10] for r in state["open"].values()} | refresh
    # rebuild the recent days
    fresh = defaultdict(lambda: defaultdict(lambda: [[], None, 0]))
    for r in state["closed"]:
        if r["out"] == "sold" and r.get("tcond", "UNK") in COMPARABLE_CONDS and r["total"] is not None \
                and r.get("tier") != "suspect":
            d = r["closed"][:10]
            if d in refresh:
                tot = r["total"] / (1 - lp_frac(lp, ref_price.get(r["card"]))) if r.get("tcond") == "LP" else r["total"]
                fresh[str(r["card"])][d][0].append(round(tot, 2))
    for r in list(state["open"].values()) + state["closed"]:
        if comparable(r):
            d = r["first"][:10]
            if d in refresh:
                fresh[str(r["card"])][d][2] += 1
    today = NOW.date().isoformat()
    for r in state["open"].values():                    # today's cheapest ask per card
        if comparable(r) and r["total"] is not None:
            eff = round(r["total"] * (BO_HAIRCUT if r["bo"] else 1.0), 2)
            cell = fresh[str(r["card"])][today]
            if cell[1] is None or eff < cell[1]:
                cell[1] = eff
    for cid, days in fresh.items():
        dd = daily.setdefault(cid, {})
        for d, cell in days.items():
            old_cell = dd.get(d)
            if old_cell and cell[1] is None:
                cell[1] = old_cell[1]                  # keep an earlier ask reading for a past day
            dd[d] = [cell[0], cell[1], cell[2]]
    # prune
    for cid in list(daily):
        daily[cid] = {d: v for d, v in daily[cid].items() if d >= keep_from}
        if not daily[cid]:
            del daily[cid]


def theil_sen(points):
    """points = [(day_index, ln price)] -> (median slope/day, q1, q3) or None."""
    slopes = []
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            dt = points[j][0] - points[i][0]
            if dt > 0:
                slopes.append((points[j][1] - points[i][1]) / dt)
    if not slopes:
        return None
    return pct(slopes, 0.5), pct(slopes, 0.25), pct(slopes, 0.75)


def trend_stats(days):
    """days = {date: [sold totals, ask, new]} for one card -> trend columns + the series for the chart."""
    if not days:
        return None, None
    d0 = datetime.strptime(min(days), "%Y-%m-%d").date()
    today = NOW.date()
    n = (today - d0).days + 1
    idx = [(d0 + timedelta(days=i)).isoformat() for i in range(n)]
    sales = [len(days[d][0]) if d in days else 0 for d in idx]
    asks = [days[d][1] if d in days else None for d in idx]
    price = []
    for i in range(n):                                   # trailing 7-day median of sold totals
        pool = []
        for j in range(max(0, i - MED_WINDOW_D + 1), i + 1):
            pool += days[idx[j]][0] if idx[j] in days else []
        price.append(round(pct(pool, 0.5), 2) if len(pool) >= MED_MIN_SALES else None)
    hist_days = n
    last = n - 1
    def at(back):                                        # price `back` days ago (nearest earlier valid day)
        for k in range(last - back, max(-1, last - back - 3), -1):
            if k >= 0 and price[k] is not None:
                return price[k]
        return None
    p_now = at(0)
    def chg(back):
        p_then = at(back)
        return round((p_now / p_then - 1) * 100, 1) if p_now and p_then and hist_days > back else None
    d7, d30 = chg(7), chg(30)
    valid90 = [v for v in price[max(0, n - 90):] if v is not None]
    pos = hi = lo = None
    if hist_days >= 60 and len(valid90) >= 10 and p_now is not None:
        lo, hi = min(valid90), max(valid90)
        pos = round((p_now - lo) / (hi - lo) * 100, 0) if hi > lo else 50.0
    moves = []
    prev = None
    for v in price[max(0, n - 90):]:
        if v is not None and prev is not None and v != prev:
            moves.append(abs(math.log(v / prev)))
        if v is not None:
            prev = v
    vol = round(pct(moves, 0.5) * 100, 2) if len(moves) >= 3 else None
    pts30 = [(i, math.log(price[i])) for i in range(max(0, n - 30), n) if price[i] is not None]
    ts = tsq1 = tsq3 = None
    if hist_days >= 30 and len(pts30) >= 10:
        r = theil_sen(pts30)
        if r:
            ts, tsq1, tsq3 = (round((math.exp(v * 30) - 1) * 100, 1) for v in r)
    spm = sum(sales[max(0, n - 30):])
    vd = vdp = None
    if hist_days >= 60:
        prev30 = sum(sales[max(0, n - 60):n - 30])
        vd = spm - prev30
        vdp = round((spm / prev30 - 1) * 100, 1) if prev30 else None
    tr = {"d7": d7, "d30": d30, "pos": pos, "hi": hi, "lo": lo, "vol": vol, "ts": ts, "tsq1": tsq1, "tsq3": tsq3,
          "spm": spm, "vd": vd, "vdp": vdp, "days": hist_days}
    hist = {"start": idx[0], "sales": sales, "price": price, "ask": asks}
    return tr, hist


def compute_stats(state, cat, lp):
    by_id = {c["id"]: c for c in cat.cards}
    win_start = NOW - timedelta(days=STAT_WINDOW_D)
    opens = defaultdict(list)
    for iid, rec in state["open"].items():
        opens[rec["card"]].append(rec)
    closed = defaultdict(list)
    for r in state["closed"]:
        closed[r["card"]].append(r)
    first_seen = {}
    for cid, recs in opens.items():
        for r in recs:
            t = parse_ts(r["first"])
            first_seen[cid] = min(first_seen.get(cid, t), t)
    for cid, recs in closed.items():
        for r in recs:
            t = parse_ts(r["first"])
            first_seen[cid] = min(first_seen.get(cid, t), t)

    cards = {}
    hot_state = state["hot"]
    for cid in set(opens) | set(closed):
        if cid not in by_id:
            continue
        # --- demand ---
        D = max(1.0 / 24, min(STAT_WINDOW_D, hours_between(first_seen[cid], NOW) / 24))
        sold = [r for r in closed[cid] if r["out"] == "sold" and parse_ts(r["closed"]) >= win_start
                and r.get("tcond", "UNK") in COMPARABLE_CONDS and r.get("tier") != "suspect"]
        k = len(sold)
        lam = round(gamma_q(k + 0.5, D, 0.25), 3) if k >= 1 else None
        # --- LP normalization: prices of LP copies are lifted to NM-equivalent for every price stat.
        # The tier is picked from the card's raw sold median (or cheapest ask before any sale).
        raw_tot = [r["total"] for r in sold if r["total"] is not None]
        raw_ask = [r["total"] for r in opens[cid] if comparable(r) and r["total"] is not None]
        lpd = lp_frac(lp, pct(raw_tot, 0.5) if len(raw_tot) >= 3 else (min(raw_ask) if raw_ask else pct(raw_tot, 0.5)))
        nm_eq = lambda r: r["total"] / (1 - lpd) if r.get("tcond") == "LP" else r["total"]
        # --- supply (the book) ---
        book = [r for r in opens[cid] if comparable(r) and r["total"] is not None]
        for r in book:
            r["_eff"] = round(nm_eq(r) * (BO_HAIRCUT if r["bo"] else 1.0), 2)
        book.sort(key=lambda r: r["_eff"])
        # a watch-tier copy never sits alone as the cheapest: the first clean copy takes p1
        if book and book[0].get("tier") == "watch":
            j = next((i for i, r in enumerate(book) if r.get("tier") != "watch"), None)
            if j is not None:
                book.insert(0, book.pop(j))
        N = len(book)
        p = [r["_eff"] for r in book[:3]] + [None] * 3
        new30 = sum(1 for r in opens[cid] + closed[cid] if comparable(r) and parse_ts(r["first"]) >= win_start)
        mu = round(new30 / D, 3)
        dos = round(N / lam, 1) if lam else None
        io_ = round(mu / lam, 2) if lam else None
        # --- sold prices ---
        sold_sorted = sorted(sold, key=lambda r: r["closed"])
        last10 = [nm_eq(r) for r in sold_sorted[-10:] if r["total"] is not None]
        smed, s80 = pct(last10, 0.5), pct(last10, 0.8)
        hrs = pct([r["hrs"] for r in sold_sorted[-10:]], 0.5)
        # sell-through: of comparable listings first seen 7-37 days ago, share sold within 7 days
        st_pool = [r for r in opens[cid] + closed[cid] if comparable(r)
                   and 7 <= hours_between(parse_ts(r["first"]), NOW) / 24 <= STAT_WINDOW_D + 7]
        st_sold = [r for r in st_pool if r.get("out") == "sold" and r["hrs"] <= 7 * 24]
        st = round(len(st_sold) / len(st_pool), 3) if len(st_pool) >= 3 else None
        # --- pricing ---
        n24, n48 = depth(lam, 1), depth(lam, 2)
        price = smed if k >= 3 else (p[0] if p[0] is not None else smed)
        p24 = p48 = None
        if lam is not None:
            if n24 and N >= n24:
                p24 = p[n24 - 1] - UNDERCUT
            elif n24 and smed is not None:
                p24 = smed if p[0] is None else min(smed, p[0] - UNDERCUT)
            if n48 and N >= n48:
                p48 = p[n48 - 1] - UNDERCUT
            elif n48 and s80 is not None:
                p48 = s80 if p[0] is None else min(s80, p[0] - UNDERCUT)
            cap = s80 if s80 is not None else (smed * 1.15 if smed else None)
            if p48 is not None and cap is not None:
                p48 = min(p48, cap)
            if p24 is not None and p48 is not None:
                p48 = max(p48, p24)
        # price for the honest window when 24/48 h are not on offer: cheapest copy minus the undercut
        pw = None
        if lam is not None:
            pw = (p[0] - UNDERCUT) if p[0] is not None else smed
            if pw is not None and cap is not None:
                pw = min(pw, cap)
        prob24 = round((1 - math.exp(-lam)) * 100, 1) if lam else None
        edays = round(-math.log(1 - CONFIDENCE) / lam, 1) if lam else None       # 70% window, rank 1
        csell, basis = (p24, "24h") if p24 is not None else (p48, "48h") if p48 is not None else (pw, "window")
        net, maxbuy = gate(csell) if csell is not None else (None, None)
        # Calibration record: for listings that appeared this run, remember the model's claim about
        # them - lambda, their rank in the book, and the P48 / P24 the model would have set. Later,
        # "did it sell within 48 h" vs "how far above/below P48 it was priced" calibrates the price.
        for rank, r in enumerate(book, start=1):
            if r["first"] == ts(NOW) and r.get("rank0") is None:
                r["lam0"], r["rank0"], r["eff0"] = lam, rank, r["_eff"]
                r["p48_0"] = r2(p48) if p48 is not None else None
                r["p24_0"] = r2(p24) if p24 is not None else None
        # --- hot-card checks ---
        checks = {
            "sales": k >= HOT_MIN_SALES,
            "sellthru": st is not None and st >= HOT_MIN_SELLTHRU,
            "fast": hrs is not None and hrs <= HOT_MAX_HRS,
            "realized": (smed is not None and (N == 0 or smed >= 0.95 * pct([r["_eff"] for r in book], 0.5))),
            "trend": True,
        }
        if len(sold_sorted) >= 10:
            recent = pct([nm_eq(r) for r in sold_sorted[-5:] if r["total"]], 0.5)
            earlier = pct([nm_eq(r) for r in sold_sorted[-10:-5] if r["total"]], 0.5)
            if recent is not None and earlier is not None:
                checks["trend"] = recent >= 0.97 * earlier
        hot = 0
        confirm = 0
        hs = hot_state.get(str(cid))
        if all(checks.values()):
            if not hs:
                hs = {"since": ts(NOW)}
                hot_state[str(cid)] = hs
            since = parse_ts(hs["since"])
            later = [r for r in opens[cid] + closed[cid] if comparable(r) and parse_ts(r["first"]) > since]
            later.sort(key=lambda r: r["first"])
            ok = 0
            failed = False
            for r in later[:HOT_CONFIRM_N]:
                if r.get("out") == "sold" and r["hrs"] <= 48:
                    ok += 1
                elif r.get("out") in ("ended", "gone", "stale") or \
                        (r.get("out") is None and hours_between(parse_ts(r["first"]), NOW) > 48):
                    failed = True
            if failed:
                hs["since"] = ts(NOW)
                confirm = 0
            else:
                confirm = ok
            hot = 2 if confirm >= HOT_CONFIRM_N else 1
        elif hs:
            del hot_state[str(cid)]

        tr, hist = trend_stats(state.get("daily", {}).get(str(cid), {}))
        cards[str(cid)] = {
            "tr": tr, "hist": hist if hist and any(hist["sales"]) else None,
            "price": r2(price), "k": k, "D": round(D, 1), "lam": lam, "N": N, "p1": p[0], "p2": p[1], "p3": p[2],
            "mu": mu, "dos": dos, "io": io_, "smed": r2(smed), "s80": r2(s80), "hrs": hrs, "st": None if st is None else round(st * 100, 1),
            "n24": n24, "n48": n48, "p24": r2(p24), "p48": r2(p48), "pw": r2(pw), "basis": basis if csell is not None else None,
            "prob24": prob24, "edays": edays, "csell": r2(csell), "net": net, "maxbuy": maxbuy, "hot": hot, "confirm": confirm,
            "checks": [key for key, v in checks.items() if not v], "lpd": round(lpd * 100, 1),
            "book": [[r["id"], r["total"], r["item"], r["ship"], r.get("tcond", "UNK"), int(r["bo"]), r["fb"], r["pct"],
                      round(hours_between(parse_ts(r["origin"] or r["first"]) or NOW, NOW), 1), r["url"], r["title"]]
                     for r in book[:8]],
            "sold": [[r["closed"][:10], r["total"], r["hrs"], r.get("tcond", "UNK"), int(r["bo"]), r["url"], r["title"]]
                     for r in sold_sorted[-10:]][::-1],
        }
    for r in state["open"].values():
        r.pop("_eff", None)
    state["price_cache"] = {cid: c["price"] for cid, c in cards.items() if c.get("price")}
    return cards


CAL_BUCKETS = [(-999, -15), (-15, -10), (-10, -5), (-5, -2), (-2, 2), (2, 5), (5, 10), (10, 20), (20, 999)]
CAL_MIN_TOTAL = 150          # outcomes needed before an adjustment is published
CAL_MIN_BUCKET = 25          # ... and in each of the two buckets around the 70% crossing


def calibrate(state, horizon_h, key):
    """Realized sell-through within `horizon_h` hours versus how the listing was priced relative
    to the model's own P48 (key='p48_0') or P24 (key='p24_0') when it appeared.
    Returns {n, rows:[[lo, hi, n, sold, realized%]], delta%: offset where realized crosses 70%}."""
    cutoff = NOW - timedelta(hours=horizon_h)
    rows = [{"lo": lo, "hi": hi, "n": 0, "sold": 0} for lo, hi in CAL_BUCKETS]
    recs = list(state["closed"]) + list(state["open"].values())
    for r in recs:
        ref = r.get(key)
        if not ref or r.get("eff0") is None or r.get("rank0") is None or r["rank0"] > DEPTH_CAP:
            continue
        first = parse_ts(r["first"])
        if first is None or first > cutoff:
            continue                                  # outcome not knowable yet
        out = r.get("out")
        if out == "gone":
            continue                                  # unknown outcome
        sold_in = out == "sold" and r.get("hrs") is not None and \
            (parse_ts(r["closed"]) - first).total_seconds() / 3600 <= horizon_h
        off = (r["eff0"] / ref - 1) * 100
        for b in rows:
            if b["lo"] <= off < b["hi"]:
                b["n"] += 1
                b["sold"] += 1 if sold_in else 0
                break
    n = sum(b["n"] for b in rows)
    delta = None
    if n >= CAL_MIN_TOTAL:
        # walk from cheapest to dearest; find where realized sell-through falls through 70%
        prev = None
        for b in rows:
            if b["n"] < CAL_MIN_BUCKET:
                continue
            rate = b["sold"] / b["n"]
            mid = max(b["lo"], -30) if b["hi"] == 999 else min(b["hi"], 30) if b["lo"] == -999 else (b["lo"] + b["hi"]) / 2
            if prev is not None and prev[1] >= CONFIDENCE > rate:
                pm, pr = prev
                delta = round(pm + (pr - CONFIDENCE) / (pr - rate) * (mid - pm), 1)
                break
            prev = (mid, rate)
    return {"n": n, "delta": delta,
            "rows": [[b["lo"], b["hi"], b["n"], b["sold"], round(100 * b["sold"] / b["n"], 1) if b["n"] else None] for b in rows]}


def listing_gate(rec, cs):
    """(net, maxbuy) for one listing: the card's gate, discounted when the listing says LP."""
    if not cs or cs.get("maxbuy") is None:
        return None, None
    if rec.get("tcond") == "LP" and cs.get("csell") is not None:
        return gate(cs["csell"] * (1 - cs.get("lpd", LP_DEFAULT_PCT) / 100))
    return cs["net"], cs["maxbuy"]


def verdict(rec, cs):
    """Gate verdict for one listing given its card's stats."""
    if rec["total"] is None:
        return "no price", None
    allin = round(rec["total"] + (rec["item"] or 0) * TAX, 2)
    if rec.get("n_img") is not None and rec["n_img"] < 2:
        return "fewer than 2 photos", allin
    if rec.get("tier") == "suspect":
        return "suspect", allin
    if not cs or cs.get("maxbuy") is None:
        return ("no sales yet" if cs else "no data yet"), allin
    if cs.get("price") and rec["total"] < 0.5 * cs["price"]:
        return "too cheap - scam check", allin
    if rec.get("tcond", "UNK") not in COMPARABLE_CONDS:
        return "condition " + rec.get("tcond", "?"), allin
    bar = seller_bar(rec)
    if bar is not None:
        return f"seller < {bar:.0f}%", allin
    if allin <= listing_gate(rec, cs)[1]:
        return "PASS", allin
    return "over max buy", allin


def build_live(state, cards, lp):
    day_ago = NOW - timedelta(hours=24)
    live = []
    recs = list(state["open"].values()) + [r for r in state["closed"] if parse_ts(r["first"]) >= day_ago]
    for r in recs:
        if parse_ts(r["first"]) < day_ago:
            continue
        cs = cards.get(str(r["card"]))
        v, allin = verdict(r, cs)
        origin = parse_ts(r.get("origin") or r["first"]) or parse_ts(r["first"])
        live.append([r["id"], r["card"], r["first"], round(hours_between(origin, NOW), 1), r["title"],
                     r["item"], r["ship"], r["total"], allin,
                     cs["price"] if cs else None,
                     None if not cs or not cs.get("price") or r["total"] is None else round((r["total"] / cs["price"] - 1) * 100, 1),
                     listing_gate(r, cs)[1], v, r.get("tcond", "UNK"), int(r["bo"]), r["fb"], r["pct"],
                     r.get("out") or "open", r["url"], r.get("img"), r.get("how"),
                     r.get("hrs") if r.get("out") else None,          # 21: hours from listing to outcome
                     r.get("n_img"), r.get("tier", "clean"), r.get("sc", 0), r.get("scr", [])])   # 22-25: photos, tier, score, signals
    live.sort(key=lambda x: x[2], reverse=True)
    unmatched = [u for u in state["unmatched"] if parse_ts(u[0]) >= day_ago][-300:]
    passes = sum(1 for x in live if x[12] == "PASS")
    return {
        "t": ts(NOW), "runs": state["runs"], "calls_today": state["calls"].get(TODAY, 0),
        "n_open": len(state["open"]), "n_closed": len(state["closed"]), "n_cards": len(cards),
        "n_live": len(live), "n_pass": passes, "band": TAB_PRICE,
        "gate": {"fee": FEE_PCT, "buyerTax": BUYER_TAX, "fixed": FEE_FIXED, "shipOut": SHIP_OUT, "tax": TAX,
                 "margin": MARGIN, "confidence": CONFIDENCE, "depthCap": DEPTH_CAP, "undercut": UNDERCUT,
                 "boHaircut": BO_HAIRCUT, "window": STAT_WINDOW_D},
        "cards": cards, "live": live, "unmatched": unmatched, "lp": lp, "scam": scam_calib(state),
        "calib": {"h48": calibrate(state, 48, "p48_0"), "h24": calibrate(state, 24, "p24_0")},
    }


# ---------------- housekeeping ----------------
def prune(state):
    keep_from = NOW - timedelta(days=KEEP_CLOSED_D)
    state["closed"] = [r for r in state["closed"] if parse_ts(r["closed"]) >= keep_from]
    seen_from = NOW - timedelta(hours=48)
    state["seen"] = {k: v for k, v in state["seen"].items() if parse_ts(v) >= seen_from}
    um_from = NOW - timedelta(hours=48)
    state["unmatched"] = [u for u in state["unmatched"] if parse_ts(u[0]) >= um_from][-2000:]
    state["calls"] = {d: n for d, n in state["calls"].items() if d >= (NOW - timedelta(days=7)).date().isoformat()}


# ---------------- main ----------------
def main():
    if not PASSWORD and not DRY_RUN:
        raise SystemExit("SITE_PASSWORD secret is missing (it encrypts the state and the live file).")
    cat = load_catalog()
    state = load_state()
    state["runs"] = state.get("runs", 0) + 1
    if state["calls"].get(TODAY, 0) >= 4800:
        log("Daily API budget nearly used - skipping this run.")
        return
    sweep(state, cat)
    enrich(state)
    track(state)
    prune(state)
    score_listings(state)
    lp = lp_correction(state)
    update_daily(state, lp)
    cards = compute_stats(state, cat, lp)
    live = build_live(state, cards, lp)
    log("LP correction: " + ", ".join(f"{t['lo']}-{t['hi'] if t['hi'] < 10**9 else '+'}: {t['pct']}% ({t['src']}, n={t['n']})" for t in lp["tiers"]))
    os.makedirs(LIVE_DIR, exist_ok=True)
    raw = gzip.compress(json.dumps(live, separators=(",", ":")).encode("utf-8"))
    with open(os.path.join(LIVE_DIR, LIVE_NAME), "wb") as f:
        f.write(encrypt_live(raw, PASSWORD) if PASSWORD else raw)
    log(f"Live file: {len(raw) / 1e3:.0f} KB gz - {live['n_cards']} cards with data, "
        f"{live['n_live']} listings in the last 24 h, {live['n_pass']} pass the gate, "
        f"{live['calls_today']} API calls today.")
    save_state(state)
    if DRY_RUN:
        with open(os.path.join(LIVE_DIR, "ebay_live.json"), "w") as f:
            json.dump(live, f, indent=1)


if __name__ == "__main__":
    main()
