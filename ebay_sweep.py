"""
ebay_sweep.py  -  eBay side of the catalog. Runs on GitHub Actions every 15 minutes
(see .github/workflows/ebay_sweep.yml). Your laptop is never involved.

Each run:
  1. SWEEP   pulls every raw (Ungraded) Pokemon single listed on eBay US since the last run,
             $25-$500, fixed price, and matches each title to one card in the PriceCharting
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

Is it the right card? Three checks sit on top of the title match (settings: "identity checks"):
  - the set's printed total ("/165", from the open Pokemon TCG dataset) decides between two sets that
    both fit the title, and an eBay product id is trusted only when the title agrees with it;
  - a listing priced far from the card's PriceCharting ungraded price is treated as a wrong match:
    out of every statistic, never a hit, listed on Raw Data for a look by hand;
  - a listing that clears the price gate has its eBay item specifics read once (one getItem) and
    compared with the matched card; a conflict blocks the PASS.

State lives in one encrypted file on the "snapshots" release (ebay_state.json.gz.enc):
open listings, closed listings for the last 60 days, seen ids, learned set totals, API usage.

Secrets: EBAY_CLIENT_ID  EBAY_CLIENT_SECRET  SITE_PASSWORD      Optional variable: BUYER_ZIP
The card list comes from the newest PriceCharting snapshot on the release. PriceCharting's ungraded
price is used for one thing only - the wrong-match check above; every price statistic is eBay's.
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

SWEEP_PRICE = (25, 500)      # listing price band pulled from eBay (wider than the tab's $50-500,
                             # so a $60 copy of a $100 card is seen)
TAB_PRICE = (50, 500)        # the tab's default filter; only affects what goes in the live file
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
TRACK_MAX_CALLS = 35         # getItem calls per run at most; lookup_budget() lowers it to fit the day
TRACK_MIN_TOTAL = 40.0       # scheduled checks go first to listings at or above this price (the cards that matter)
DAILY_BUDGET = 4800          # eBay allows 5,000 calls/day; sweeps are reserved first, lookups get the rest
SWEEP_RESERVE = 8            # calls one sweep needs (two queries, a few pages each)
CHECK_AGES_D = [3, 10, 30]   # scheduled getItem checks, days since first seen
KW_FIRST_CHECK_D = 1         # listings found only by the keyword query get an extra day-1 check
TRACK_GIVE_UP_D = 30         # after the last check the listing counts as unsold ("stale")
KEEP_CLOSED_D = 60           # closed listings kept in state
# ---- the 2-day rule (Brett, 2026-10-06) ----
# He only flips cards that sell inside his 48-hour window, and 5,000 calls a day could not follow every listing to
# day 10: about 3,270 disappeared a day against some 1,370 lookups, so half the outcomes were never read. A listing
# is now FOLLOWED FOR ITS FIRST 2 DAYS ONLY. One that is still for sale after that is "stale" - it did not sell in the
# window, and what becomes of it later is not asked. Two exceptions (collector.close_stale): a card's cheapest
# copies stay in the book whatever their age, and suspects get one last look so the scam table still sees takedowns.
FOLLOW_D = 2.0
KEEP_STALE_D = 31            # "outlived 2 days" records are kept this long (the reach of the sell-through pool)
ST_POOL_MIN_AGE_D = 3        # a listing's 48-hour outcome is known once it is this old
ST_MIN = 0.25                # liquidity: share of a card's listings that sold within 48 h, once measured. The rule used
                             # to be 50% within 7 days. A steady selling rate would make that 18% within 2 days, but
                             # sales come early: on the day of the switch, the 19 fast cards that passed the old bar
                             # had 25% (the lowest) to 50% (the middle one) of those same listings sold within 48 h.
                             # 25% keeps every one of them and lets in nothing weaker than the weakest of them
DAILY_KEEP_D = 120           # per-card daily rollup (sales, 7-day median price, cheapest ask) kept this long
DAILY_REFRESH_D = 3          # the last N days are recomputed every run (late-confirmed sales land on their day)
MED_WINDOW_D = 7             # the price series = median sold total over a trailing 7-day window ...
MED_MIN_SALES = 3            # ... needing at least this many sales in the window
STAT_WINDOW_D = 30           # window for lambda, mu, sold prices, sell-through
CONFIDENCE = 0.70            # liquidity rule: P(at least one buyer inside the sell window) >= this
SELL_WINDOW_H = 48           # the planned sell window (the page lets Brett change both)
DEPTH_CAP = 3                # calibration records keep the rank a listing entered the book at (<= this)
# --- the sell price: two anchors ---
# A = what buyers actually pay: recency-weighted robust centre of the card's sales (median under 8, Hodges-
#     Lehmann from 8), after trimming outliers; needs ANCHOR_MIN sales in 30 d (else 60 d) to be trusted.
# L = the cheapest CREDIBLE competing copy: not a watch/suspect copy, not a thin seller, not more than 25%
#     under A (that is a deal or junk, not a price), not a copy that has sat longer than this card's buyers allow.
# S = min(L - UNDERCUT, SELL_UNDER_A * A); with no credible L, SELL_NO_FLOOR * A; capped by the median of fast
#     sales when there are enough of them. Rounded down to .99.
ANCHOR_WINDOW_D = 30
ANCHOR_WIDE_D = 60           # fallback window when the 30-day one holds fewer than ANCHOR_MIN sales
ANCHOR_MIN = 5               # sales needed before the gate trusts A
ANCHOR_HL_MIN = 8            # Hodges-Lehmann from this many trimmed sales; weighted median below
ANCHOR_HALF_LIFE_D = 10.0    # a sale 10 days old counts half as much as one today
FAST_MIN = 8                 # fast-sale cross-check needs this many sales that sold within FAST_HRS of listing
FAST_HRS = 48
SELL_UNDER_A = 0.95
SELL_NO_FLOOR = 0.93
UNDERCUT = 0.50              # dollars under the credible floor
CRED_MIN_FB = 50             # a copy from a seller with fewer ratings is shown but never sets the price
CRED_MIN_RATIO = 0.75        # a copy under this share of A is a deal or junk, not a reference
STALE_K = 1.6                # a copy sat longer than STALE_K / lambda days (1..7) has been passed over by buyers
REVIEW_RATIO = 0.45          # a listing under this share of A goes to manual review, not the gate
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
HOT_MIN_SELLTHRU = 0.35      # within 48 h (was 80% within 7 days: 1 - 0.2^(2/7) = 37%)
HOT_MAX_HRS = 48
HOT_CONFIRM_N = 3

# --- is it the right card? (identity checks) ---
# 1. Price against PriceCharting. A listing whose total is far from the card's PriceCharting ungraded price is
#    treated as a wrong match ("mismatch"): it never passes the gate and stays out of every statistic. Too-cheap
#    ones are still shown on Raw Data so a real steal can be checked by hand. This is the only place a
#    PriceCharting price is used on the eBay side.
PC_LOW = 0.40                # total under 40% of the PriceCharting ungraded price -> "mismatch: too cheap"
PC_HIGH = 3.00               # total over 300% of it -> "mismatch: too high"
PC_MIN_SALES = 20            # the rule only applies when PriceCharting has this many sales/yr behind its price ...
PC_NEW_SET_D = 30            # ... and the card was released at least this many days ago (new-set prices fall
                             # faster than PriceCharting follows them)
# 2. Item specifics. A listing that clears the price gate (at any margin) is looked up once and the seller's item
#    specifics - card number, card name, set, language, card size, finish - are compared with the matched card.
VERIFY_MAX_CALLS = 2         # identity lookups per run (per minute on the always-on machine)
VERIFY_DAILY_MAX = 200       # ... and per UTC day
#    The same lookup also settles WHICH PRINTING a listing is when the title leaves it open: the specifics' Finish /
#    Features / Card Size are matched to the bracketed printings PriceCharting lists for the card. Spent on unmatched
#    "ambiguous variant" titles and on mismatch-flagged listings that another printing's price would fit.
PRINTING_EVERY_S = 600       # at most one such lookup every 10 minutes ...
PRINTING_DAILY_MAX = 150     # ... and this many per UTC day
PRINT_FIT = (0.6, 1.7)       # "fits" = the listing's total is within this share of that printing's PriceCharting price
PENDING_MIN_TOTAL = 40.0     # an ambiguous-printing listing waits for a lookup only at or above this price ...
PENDING_KEEP_H = 12          # ... and for at most this long
MATCH_VERSION = 3            # bump when the title matcher changes: every stored listing is then matched again
                             # (rematch()) the next time the collector starts, so old mistakes do not linger
# 3. Printed set totals ("36/123" -> 123) from the open Pokemon TCG dataset, the same source the page uses
TCG_SETS_URL = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json"

# --- leads: PriceCharting as a stand-in anchor where eBay has too few sales (Brett, 2026-10-04) ---
# A card with fewer than ANCHOR_MIN eBay sales cannot be judged by the gate at all, and most listings are on such
# cards. For those, PriceCharting's ungraded price stands in for the anchor - ALWAYS capped by the cheapest believable
# copy listed right now, because a stale PriceCharting price is a trap (30th Celebration Mew ex: $147 there, unsold
# copies at $95 here). The verdict is "LEAD", never "PASS": a listing to look at, photos and condition first.
LEAD_MIN_PC_SALES = 100      # PriceCharting sales/yr the card needs (the stand-in for "it sells")
LEAD_MIN_PC = 40.0           # ... and a PriceCharting price of at least this
LEAD_SELL_PC = 0.95          # sell no higher than this share of the PriceCharting price ...
LEAD_SELL_NO_FLOOR = 0.93    # ... or this share when no other believable copy is listed

# ---- Gate (keep in step with build_catalog.py) ----
FEE_PCT = 0.1325             # eBay final value fee, trading cards
BUYER_TAX = 0.065            # eBay charges the fee on the buyer's total incl. their sales tax
FEE_FIXED = 0.40             # eBay per-order fee on orders over $10
SHIP_OUT = 4.50              # tracked label; verify against real label costs
SUPPLIES = 0.30              # sleeve, top loader, bubble mailer
TAX = 0.0625                 # sales tax you pay when buying (MA) - a resale certificate filed with eBay removes it
MARGIN = 0.10                # default; deal flow, not capital, is the limit, so a lower margin on liquid cards wins
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


def whole(v):
    try:
        return int(float(str(v).replace(",", "").strip()))
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
    "masterball": "master ball", "pokeball": "poke ball", "oversized": "jumbo", "oversize": "jumbo",
    "30c": "30th celebration", "25th": "25th celebrations",
}
# Words around a Pokemon's name that many different cards share: the name check goes by the first word that is not
# one of these ("Mega Lucario ex" must show "lucario"; a "Mega Mewtwo EX" title used to pass on "mega" and "ex").
GENERIC_NAME = {"mega", "m", "dark", "light", "shining", "radiant", "team", "rocket", "rockets", "galarian", "alolan",
                "hisuian", "paldean", "ex", "gx", "v", "vmax", "vstar", "lv", "x", "y", "prime", "legend", "break",
                "star", "delta", "species", "tag", "crystal", "the", "of", "and"}
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
    # "HP" next to a number is the card's hit points ("120 HP", "HP 180"), which most catalog-style titles carry
    (re.compile(r"\b(heavily played|heavy play|poor)\b|(?<!\d)(?<!\d[\s-])\bhp\b(?!\s?[:=]?\s?\d)", re.I), "HP"),
]
COMPARABLE_CONDS = {"NM", "LP", "UNK"}


def norm_tokens(s):
    s = s.lower().replace("\u00e9", "e").replace("&", " ").replace("'", "").replace("\u2019", "").replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return [t for t in s.split() if t and t not in STOP]


# Printed set sizes from the open Pokemon TCG dataset, matched to PriceCharting's set names exactly the way
# build_catalog.py does it for the page (keep the two in step: same aliases, same rules). A size learned from eBay
# titles (state["denoms"]) is the fallback for sets the dataset does not have yet.
SET_NAME_ALIASES = {"base set": "base", "expedition": "expedition base set", "scarlet violet 151": "151",
                    "pokemon go": "go", "team magma team aqua": "team magma vs team aqua",
                    "unleashed": "hs unleashed", "undaunted": "hs undaunted", "triumphant": "hs triumphant",
                    "fire red leaf green": "firered leafgreen"}
SERIES_PREFIXES = ("scarlet violet", "sword shield", "sun moon", "xy", "black white", "diamond pearl",
                   "heartgold soulsilver", "platinum", "ex")
_totals_cache = {}


def norm_set(name):
    s = str(name).lower().replace("\u00e9", "e").replace("&", " ").replace("'", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = [t for t in s.split() if t not in ("and", "the")]
    if toks and toks[0] == "pokemon":
        toks = toks[1:]
    return " ".join(toks)


def official_totals(set_names):
    """{PriceCharting set name: printed size}. A failed download keeps the sizes from the last good one."""
    global _totals_cache
    try:
        if DRY_RUN:
            p = os.path.join("fixtures", "sets.json")
            data = json.load(open(p)) if os.path.exists(p) else []
        else:
            r = requests.get(TCG_SETS_URL, timeout=60)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        log(f"Set sizes: could not fetch the Pokemon TCG set list ({e}); keeping {len(_totals_cache)} from before")
        return dict(_totals_cache)
    by_norm = {}
    for st in data:
        if "promo" in st.get("name", "").lower():          # promos print SWSH001-style numbers, no size
            continue
        tot = st.get("printedTotal") or st.get("total")
        if tot:
            by_norm[norm_set(st["name"])] = int(tot)
    out = {}
    for name in set_names:
        n = norm_set(name)
        if "promo" in n:
            continue
        n = SET_NAME_ALIASES.get(n, n)
        if n.startswith("mcdonalds ") and not n.startswith("mcdonalds collection"):
            n = "mcdonalds collection " + n[len("mcdonalds "):]
        tot = by_norm.get(n)
        if tot is None:
            for series in SERIES_PREFIXES:                  # "scarlet violet obsidian flames" -> "obsidian flames"
                if n.startswith(series + " ") and by_norm.get(n[len(series) + 1:]):
                    tot = by_norm[n[len(series) + 1:]]
                    break
        if tot is not None:
            out[name] = tot
    if out:
        _totals_cache = out
    return out


def stem(t):
    return t[:-1] if len(t) > 3 and t.endswith("s") and not t.endswith("ss") else t


class Catalog:
    """Card identities from the newest PriceCharting snapshot, indexed for title matching."""

    def __init__(self, df):
        self.cards = []
        self.by_num = defaultdict(list)          # numeric card number -> card indexes
        self.by_key = defaultdict(list)          # (set, prefix, number, suffix) -> the printings of that one card
        set_tokens_all = Counter()               # how many SETS use each word
        self.set_toks = {}                       # set name -> its words
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
            release = str(r.get("release-date", "")).strip()[:10]
            try:
                rel = datetime.strptime(release, "%Y-%m-%d").date().toordinal()
            except ValueError:
                rel = None                             # no release date: treated as an old card
            if setname not in self.set_toks:
                self.set_toks[setname] = stoks
                set_tokens_all.update(set(stoks))
            self.cards.append({
                "id": int(float(r["id"])), "name": base, "variant": variant, "num": num,
                "pre": pre, "n": n, "suf": suf, "set": setname, "stoks": stoks,
                "ntoks": norm_tokens(base), "vtoks": expand_aliases(norm_tokens(variant)),
                "nkey": next((t for t in norm_tokens(base) if t not in GENERIC_NAME), (norm_tokens(base) or ["?"])[0]),
                "epid": str(r.get("epid", "")).strip(), "release": release, "rel": rel,
                # PriceCharting's ungraded price and sales/yr: used only by the wrong-match check (pc_flag)
                "pc": money(r.get("loose-price", "")), "vol": whole(r.get("sales-volume", "")),
            })
        first = {}                               # each set's earliest dated card ...
        for c in self.cards:
            if c["rel"] and c["rel"] < first.get(c["set"], 10 ** 9):
                first[c["set"]] = c["rel"]
        for c in self.cards:                     # ... dates its undated rows (variant rows often have none); not in promo
            if c["rel"] is None and "promo" not in c["set"].lower():   # sets, whose cards span decades
                c["rel"] = first.get(c["set"])
        self.by_id = {c["id"]: c for c in self.cards}
        self.by_epid = {}                        # eBay product id -> card indexes (usually one)
        for i, c in enumerate(self.cards):
            self.by_num[c["n"]].append(i)
            self.by_key[(c["set"], c["pre"], c["n"], c["suf"])].append(i)
            if c["epid"] and c["epid"] not in ("", "nan"):
                self.by_epid.setdefault(c["epid"], []).append(i)
        n_sets = len(self.set_toks)
        # rarer set words are more informative: "flames" beats "base"
        self.set_idf = {t: math.log((n_sets + 1) / (k + 1)) + 0.5 for t, k in set_tokens_all.items()}
        self.totals = official_totals(sorted(self.set_toks))        # set name -> printed size ("/165")
        log(f"Catalog: {len(self.cards):,} cards, {n_sets} sets, {len(self.by_epid):,} ePIDs, "
            f"printed totals for {len(self.totals)} sets.")

    def set_fit(self, text, setname):
        """How well a set name written by a seller (the Set item specific) fits the matched set and the best
        other set: (weight of its words found in the matched set, best weight in any other set, that set)."""
        words = {stem(t) for t in expand_aliases(norm_tokens(text))}
        mine, best, best_set = 0.0, 0.0, None
        for name, toks in self.set_toks.items():
            w = sum(self.set_idf[t] for t in set(toks) if stem(t) in words)
            if name == setname:
                mine = w
            elif w > best:
                best, best_set = w, name
        return mine, best, best_set


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


# Printing words: when the title says one of these and the catalog lists no such printing for the card, the listing
# is left unmatched - filing it under the plain card would price the wrong thing (a jumbo, a reverse holo, a
# Master Ball pattern). Words that are part of the card's own name ("Reverse Valley", the "Master Ball" item) don't count.
CLAIM_WORDS = {"reverse": ["reverse"], "1st edition": ["1st", "edition"], "shadowless": ["shadowless"],
               "master ball": ["master", "ball"], "poke ball": ["poke", "ball"], "jumbo": ["jumbo"],
               "staff": ["staff"], "prerelease": ["prerelease"], "cosmos": ["cosmos"]}


def need_of(c):
    """The title words that name this printing: the VARIANT_WORDS entry, else the bracket text's own words."""
    return VARIANT_WORDS.get(c["variant"]) or c["vtoks"] or c["variant"].split()


def missing_printing(cat, idxs, tset):
    """The printing these words name that the catalog does not list for this card ("jumbo", "reverse"...), else None."""
    name = set(cat.cards[idxs[0]]["ntoks"])
    for word, need in CLAIM_WORDS.items():
        if all(w in tset for w in need) and not all(w in name for w in need) \
                and not any(all(w in cat.cards[i]["vtoks"] for w in need) for i in idxs):
            if word == "shadowless" and all(w in tset for w in CLAIM_WORDS["1st edition"]):
                continue                              # every 1st Edition Base card is shadowless: that row covers it
            return word
    return None


def unknown_printing(cat, idxs, tset):
    """True when the title names a printing the catalog does not list for this card."""
    return missing_printing(cat, idxs, tset) is not None


def epid_match(cat, idxs, parsed, tset):
    """The catalog row behind the eBay product id (ePID) a listing carries - trusted only when the title agrees
    with it, because sellers pick the wrong catalog product: the same card number when the title shows one, a
    printed total that does not contradict the set, and the card's name. The printing is settled from the title."""
    c = cat.cards[idxs[0]]
    key = (c["set"], c["pre"], c["n"], c["suf"])
    if any((cat.cards[i]["set"], cat.cards[i]["pre"], cat.cards[i]["n"], cat.cards[i]["suf"]) != key for i in idxs):
        return None                                   # one ePID on several different cards tells us nothing
    if parsed:
        if parsed[0] != c["pre"] or parsed[1] != c["n"]:
            return None
        official = cat.totals.get(c["set"])
        if parsed[3] is not None and not parsed[0] and official is not None and official != parsed[3]:
            return None                               # "4/130" on a /102 set: let the title matcher decide
    if c["nkey"] not in tset:
        return None
    group = cat.by_key[key]
    if unknown_printing(cat, group, tset):
        return None
    choice = resolve_variant(cat, group, tset)
    return choice if choice is not None else (idxs[0] if len(idxs) == 1 else None)


def match_title(cat, title, epid, denoms, out=None):
    """Return (card_index, method, score) or (None, reason, 0). When the title fits one card but not one printing
    of it ("ambiguous variant"), that card's catalog rows are left in out["group"] for the item specifics to settle."""
    rj = REJECT.search(title)
    if rj:
        return None, "rejected: " + rj.group(1).lower(), 0
    parsed = parse_number(title)
    # "Stage 2" is the card's evolution stage; its "2" must not read as the "2" of Base Set 2
    ttoks = expand_aliases(norm_tokens(re.sub(r"\bstage\s?[12]\b", " ", title, flags=re.I)))
    tset = set(ttoks)
    if "celebrations" in tset:                    # "30th Celebrations" is the set PriceCharting calls "30th Celebration"
        tset.add("celebration")
    if epid and epid in cat.by_epid:
        ci = epid_match(cat, cat.by_epid[epid], parsed, tset)
        if ci is not None:
            return ci, "epid", 1.0
    if not parsed:
        return None, "no card number", 0
    pre, n, suf, den = parsed
    cands = cat.by_num.get(n, [])
    if not cands:
        return None, f"no card #{n}", 0
    scored = []
    for i in cands:
        c = cat.cards[i]
        if pre != c["pre"]:                       # "TG20" and "#20" are different cards
            continue
        if suf and c["suf"] and suf != c["suf"]:
            continue
        if c["nkey"] not in tset:                 # the Pokemon's own name has to be there
            continue
        # set score: idf-weighted share of the set's words found in the title;
        # the set's single most distinctive word alone is worth 0.6 ("151", "jungle", "fossil")
        weights = {t: cat.set_idf[t] for t in c["stoks"]}
        tot = sum(weights.values()) or 1.0
        hitw = sum(w for t, w in weights.items() if t in tset)
        set_score = hitw / tot
        if weights and max(weights, key=weights.get) in tset:
            set_score = max(set_score, 0.6)
        # the set's printed total ("/165") can stand in for a missing set name: the official size from the
        # Pokemon TCG dataset, or (for sets the dataset lacks) the size learned from eBay titles
        den_ok = den_bad = False
        if den is not None and not pre:
            official = cat.totals.get(c["set"])
            dmap = denoms.get(c["set"], {})
            learned = bool(dmap) and dmap.get(str(den), 0) >= 5 and dmap.get(str(den)) == max(dmap.values())
            den_ok = official == den or learned
            den_bad = official is not None and not den_ok
        if set_score < 0.5 and not den_ok:
            continue
        ntoks = c["ntoks"] or ["?"]
        name_hits = sum(1 for t in ntoks if t in tset)
        name_score = name_hits / len(ntoks)
        if name_score < 0.5:
            continue
        score = 0.6 * max(set_score, 0.9 if den_ok else 0) + 0.4 * name_score
        hit_a = sum(w for t, w in weights.items() if t in tset and not (len(t) == 1 and t.isdigit()))
        scored.append((round(score, 4), round(hitw, 4), i, set_score >= 0.5, den_ok, den_bad, name_hits, hit_a))
    if not scored:
        return None, "no set/name agreement", 0
    # Anniversary reprints carry the ORIGINAL card's number and total ("Lugia 149/147"), so the title's "30th" /
    # "25th" / "Celebrations" / "Classic Collection" is the only thing that tells them from the original: such a
    # listing cannot be a card printed before the anniversary year.
    year = 2026 if "30th" in tset else 2021 if (("celebrations" in tset or ("classic" in tset and "collection" in tset))
                                                and "mcdonalds" not in tset and "mcdonald" not in tset) else None
    if year:
        mark = "30th" if year == 2026 else "celebrations"
        named = [x for x in scored if mark in cat.cards[x[2]]["stoks"]]
        if named:                                 # the anniversary set has this card: that is the one
            scored = named
        else:
            cut = datetime(year, 1, 1).date().toordinal()
            scored = [x for x in scored if not (cat.cards[x[2]]["rel"] and cat.cards[x[2]]["rel"] < cut)]
            if not scored:
                return None, "anniversary reprint, not the original", 0
    # The printed total settles it between two sets that both fit the title's words ("Charizard 4/130 Base" is
    # Base Set 2, not Base Set): a set whose total contradicts the title gives way to one whose total matches -
    # unless the title names it with more distinctive words ("Celebrations" on a 4/102 Classic Collection reprint).
    ok_w = max((x[7] for x in scored if x[4]), default=None)      # words, not a stray single digit
    if ok_w is not None:
        scored = [x for x in scored if not (x[5] and x[7] <= ok_w)]
    # best first: score, then the set's words in the title, then how much of the title the card's name explains
    # ("Charizard ex 006/165" is the 151 card, not Expedition's plain Charizard with the same number and total)
    scored.sort(key=lambda x: (x[0], x[1], x[6]), reverse=True)
    best_s, best_w, best_i, by_set, _, bad, best_k, _ = scored[0]
    best_set = cat.cards[best_i]["set"]
    group = [x[2] for x in scored if cat.cards[x[2]]["set"] == best_set]           # that card's printings
    others = [x for x in scored if cat.cards[x[2]]["set"] != best_set]
    if others and best_s - others[0][0] < 0.15 and best_w <= others[0][1] and best_k <= others[0][6]:
        return None, "ambiguous set", 0
    if unknown_printing(cat, group, tset):          # the title says reverse / 1st ed / jumbo / Master Ball ...
        return None, "printing not in catalog", 0   # ... and the catalog has no such printing of this card
    choice = resolve_variant(cat, group, tset)
    if choice is None:
        if out is not None:
            out["group"] = group
        return None, "ambiguous variant", 0
    how = "number+set" if by_set else "number+total"
    return choice, how + (" (total differs)" if bad else ""), best_s


def resolve_variant(cat, idxs, tset):
    """Pick one row among a card's printings; None when the title is unclear. Callers rule out
    unknown_printing() first."""
    if len(idxs) == 1:
        c = cat.cards[idxs[0]]
        if any(w in c["vtoks"] for w in ("jumbo", "staff", "prerelease")) and not all(w in tset for w in need_of(c)):
            return None                             # a jumbo / staff / prerelease row is never the default printing
        return idxs[0]
    non_holo = "non" in tset and "holo" in tset                 # "Non-Holo" is not a claim to the [Holo] printing
    claimed = []
    for i in idxs:
        c = cat.cards[i]
        if c["variant"]:
            need = need_of(c)
            if all(w in tset for w in need) and not (non_holo and set(need) == {"holo"}):
                claimed.append((len(need), len(c["variant"]), i))
    if claimed:                                     # the most specific printing the title names:
        claimed.sort(reverse=True)                  # "Master Ball reverse holo" is the Master Ball row, not Reverse Holo
        return claimed[0][2]
    plain = [i for i in idxs if not cat.cards[i]["variant"]]
    if len(plain) == 1:
        return plain[0]
    holo = [i for i in idxs if cat.cards[i]["variant"] in ("holo", "cosmos holo")]
    if not plain and len(holo) == 1 and len(idxs) == 2 and not non_holo:
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
    rc = state.setdefault("recent_calls", [])              # sliding 24 h record, for the always-on runner
    rc.append(int(time.time()))
    if len(rc) > 6000 and len(rc) % 500 == 0:
        cutoff = int(time.time()) - 86400
        state["recent_calls"] = [t for t in rc if t >= cutoff]
    for attempt in range(3):
        headers = {"Authorization": "Bearer " + get_token(),
                   "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
                   "X-EBAY-C-ENDUSERCTX": f"contextualLocation=country%3DUS%2Czip%3D{BUYER_ZIP}"}
        try:
            r = requests.get(f"{API}{path}", headers=headers, params=params, timeout=60)
        except requests.RequestException as e:            # reset by peer, timeout, DNS: retry, then give up on this call
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"eBay {path} -> {type(e).__name__}: {e}")
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


def lookup_budget(state):
    """getItem calls this run may spend so that every remaining sweep and hourly presence walk of the UTC
    day still fits under DAILY_BUDGET. Recomputed each run from actual usage, so it self-corrects: if the
    day runs ahead, lookups shrink (to zero if need be) and the sweeps keep going."""
    used = state["calls"].get(TODAY, 0)
    mins_left = 24 * 60 - (NOW.hour * 60 + NOW.minute)
    runs_left = max(1, mins_left // 15)
    reserve = runs_left * SWEEP_RESERVE + (mins_left // 60) * PRESENCE_MAX_PAGES
    return max(0, (DAILY_BUDGET - used - reserve) // runs_left), used, runs_left


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
        "origin": s.get("itemOriginDate") or s.get("itemCreationDate"), "created": s.get("itemCreationDate"),
        "end": s.get("itemEndDate"),
        "epid": s.get("epid") or "", "img": (s.get("image") or {}).get("imageUrl"),
        # front, back and two more, straight from the search result: the check screens show them (none = key left out)
        **({"imgs": [u for u in [(p or {}).get("imageUrl") for p in [s.get("image")] + list(s.get("additionalImages") or [])] if u][:4]}
           if s.get("additionalImages") else {}),
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


def search_pages(state, qname, max_pages, cutoff, extra_filter=None):
    """Yield (page_items, oldest_origin_on_page) walking newest -> oldest until cutoff is passed.
    extra_filter: more Browse filter terms (e.g. an itemStartDate window) appended to the query's filter."""
    q = dict(QUERIES[qname])
    if extra_filter:
        q["filter"] = q["filter"] + "," + extra_filter
    for page in range(max_pages):
        if DRY_RUN:
            pages = json.load(open(os.path.join("fixtures", "search.json")))
            pages = pages if isinstance(pages, list) else [pages]
            if page >= len(pages):
                return
            j = pages[page]
        else:
            j = api_get(state, "/buy/browse/v1/item_summary/search", dict(q, offset=str(page * 200)))
        items = j.get("itemSummaries") or []
        oldest = None
        for s in items:
            o = parse_ts(s.get("itemOriginDate") or s.get("itemCreationDate") or "")
            if o is not None:
                oldest = o if oldest is None else min(oldest, o)
        yield items, oldest
        if len(items) < 200 or (oldest is not None and oldest < cutoff):
            return


def sweep(state, cat, queries=None, overlap_min=SWEEP_OVERLAP_MIN, quiet=False):
    """Read the newest listings back to (last sweep - overlap) and file the matched ones as open.
    Returns (summaries read, new, matched, unmatched)."""
    last = parse_ts(state["last_sweep"]) if state["last_sweep"] else None
    cutoff = (last - timedelta(minutes=overlap_min)) if last else (NOW - timedelta(hours=24))
    if not quiet:
        log(f"Sweep: listings since {ts(cutoff)}")
    seen_now, new, matched, unmatched = set(), 0, 0, 0
    learned_bad = bad_titles(state)                          # (seller, title) pairs Brett marked as wrong matches, by card
    if queries is None:
        queries = ["aspect"] if DRY_RUN else list(QUERIES)
    for qname in queries:
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
                out = {}
                ci, how, score = match_title(cat, rec["title"], rec["epid"], state["denoms"], out)
                if ci is None:
                    unmatched += 1
                    state["unmatched"].append([ts(NOW), iid, rec["title"], rec["total"], rec["url"], how])
                    if out.get("group") and (rec["total"] or 0) >= PENDING_MIN_TOTAL:   # one card, printing unclear
                        g = cat.cards[out["group"][0]]
                        rec.update({"ckey": [g["set"], g["pre"], g["n"], g["suf"]], "first": ts(NOW), "src": qname,
                                    "tcond": title_condition(rec["title"])})
                        state.setdefault("pending", {})[iid] = rec
                    continue
                c = cat.cards[ci]
                if c["id"] in learned_bad.get((rec.get("seller"), title_key(rec["title"])), ()):   # this seller, this very title
                    unmatched += 1
                    state["unmatched"].append([ts(NOW), iid, rec["title"], rec["total"], rec["url"], "learned: you marked this seller's same title a wrong match for " + c["name"]])
                    continue
                matched += 1
                parsed = parse_number(rec["title"])
                if parsed and parsed[3] is not None and not parsed[0] and how.startswith("number+set") and score >= 0.85:
                    d = state["denoms"].setdefault(c["set"], {})          # the set's printed size, learned from titles
                    d[str(parsed[3])] = d.get(str(parsed[3]), 0) + 1
                rec.update({"card": c["id"], "how": how, "tcond": title_condition(rec["title"]),
                            "first": ts(NOW), "src": qname, "checked": None, "checked_age": 0.0,
                            "suspect": False, "rev": None, "hist": []})
                rec["pc"], rec["pcm"] = c.get("pc"), pc_flag(rec, c)
                state["open"][iid] = rec
    state["last_sweep"] = ts(NOW)
    if not quiet:
        log(f"Sweep: {len(seen_now)} summaries read, {new} new, {matched} matched, {unmatched} unmatched.")
    return len(seen_now), new, matched, unmatched


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
        "eff0": rec.get("eff0"), "ratio0": rec.get("ratio0"),
        # scam-screen stamp at close (calibration record) and the listing facts behind it
        "seller": rec.get("seller"), "n_img": rec.get("n_img"), "qty": rec.get("qty"), "ret": rec.get("ret"),
        "img": rec.get("img"), "top": rec.get("top"), "sc": rec.get("sc"), "scr": rec.get("scr", []),
        **({"tier": rec["tier"]} if "tier" in rec else {}),
        **{k: rec[k] for k in ("pc", "pcm", "idv", "idr") if k in rec},     # identity checks, as they stood
    })
    del state["open"][iid]


def stamped(rec):
    """The model made a claim about this listing when it appeared (a price ratio or a sell price to check later)."""
    return rec.get("ratio0") is not None or rec.get("p48_0") is not None


def close_outlived(state, iid, rec):
    """A listing still for sale FOLLOW_D days after it went up: it did not sell inside the window. With a model stamp
    it gets a full closed record (out = "stale"), which the price calibration reads. Without one only counts are
    kept - a full record for each of ~4,000 a day would not fit in the machine's memory: per card and first-seen day
    (the sell-through pool and listings-per-day), per scam tier and signal (the scam table), and its photo (the
    borrowed-photo check must still know the picture after the listing is forgotten). -> "record" or "count"."""
    if stamped(rec):
        close_listing(state, iid, rec, "stale", NOW)
        return "record"
    if comparable(rec):
        days = state.setdefault("unsold", {}).setdefault(str(rec["card"]), {})
        days[rec["first"][:10]] = days.get(rec["first"][:10], 0) + 1
    if "tier" in rec:
        sd = state.setdefault("scam_stale", {}).setdefault(TODAY, {"t": {}, "s": {}})
        sd["t"][rec["tier"]] = sd["t"].get(rec["tier"], 0) + 1
        for code in rec.get("scr", []):
            sd["s"][code] = sd["s"].get(code, 0) + 1
    k = img_key(rec.get("img"))
    if k and rec.get("seller"):
        state.setdefault("imgs", {})[k] = [rec["seller"], TODAY]
    del state["open"][iid]
    return "count"


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


def check_value(rec):
    """What a scheduled lookup is worth: 0 = a calibration listing (was in the buyable top of a book when it
    appeared, so its outcome tests the price model), 1 = priced where the cards that matter live, 2 = the rest."""
    if rec.get("rank0") is not None and rec["rank0"] <= DEPTH_CAP:
        return 0
    if (rec.get("total") or 0) >= TRACK_MIN_TOTAL:
        return 1
    return 2


def track(state, max_calls=TRACK_MAX_CALLS):
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
    # 2. decide who gets a getItem call this run: presence-flagged listings first (each is probably a sale),
    #    then scheduled checks by what they are worth (check_value), soonest age first. The queue is far longer
    #    than the budget, so the order is the policy.
    due = []
    for iid, rec in state["open"].items():
        age_d = hours_between(parse_ts(rec["first"]), NOW) / 24
        if rec.get("suspect"):
            due.append((0, 0, 0, iid))
            continue
        ages = ([KW_FIRST_CHECK_D] if rec.get("src") == "kw" else []) + CHECK_AGES_D
        nxt = next((a for a in ages if a > rec.get("checked_age", 0.0) and a <= age_d), None)
        if nxt is not None:
            due.append((1, check_value(rec), nxt, iid))
        elif age_d > TRACK_GIVE_UP_D and rec.get("checked_age", 0.0) >= CHECK_AGES_D[-1]:
            close_listing(state, iid, rec, "stale", NOW)
    due.sort()
    ids = [d[3] for d in due][:max_calls]
    n_flag = sum(1 for d in due[:max_calls] if d[0] == 0)
    sold = ended = gone = changed = still = 0
    for iid in ids:
        rec = state["open"].get(iid)
        if not rec:
            continue
        if DRY_RUN:
            fx = json.load(open(os.path.join("fixtures", "items.json")))
            it = fx.get(iid)
        else:
            try:
                it = api_get(state, f"/buy/browse/v1/item/{iid}", {"fieldgroups": "COMPACT"}, ok_404=True)
            except RuntimeError as e:
                log(f"Track: lookup failed for {iid}, left for next run ({e})")
                continue
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
    log(f"Track: {len(ids)} looked up ({n_flag} presence-flagged; {len(due)} due) - {sold} sold, {ended} ended, "
        f"{gone} gone, {still} still open, {changed} repriced.")


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


# ---------------- anniversary reprints: the same card, the same printed number, a fraction of the price ----------------
# The Celebrations sets (2021, and 30th Celebration in 2026) reprint famous old cards WITH THEIR ORIGINAL NUMBER:
# the 30th Celebration Charizard still says 4/102, like the 1999 Base Set card it copies, plus an anniversary stamp
# on the artwork. Sellers - and eBay's own listing form - label the copy "Base Set 4/102", so the title and the
# item specifics both point at the original; only the photo and the price give it away (Brett, 2026-10-06: a $90
# auction and two "hits" at $171 and $206 on a $446 card whose reprint is $199.50). Elsewhere in the catalog two
# cards sharing a name and a number is a coincidence the printed set size already tells apart, so the rule is kept
# to these sets (REPRINT_SETS). For each original the cut is the geometric middle of its PriceCharting price and its
# dearest reprint's: a listing under it is nearer the reprint than the card - a reprint, or a played original; either
# way not the near-mint copy the gate's arithmetic assumes. verdict() answers "reprint?" there; the statistics are
# NOT touched (Brett approved holding such listings back as hits, nothing more).
REPRINT_SETS = re.compile(r"celebration", re.I)
REPRINT_MAX_RATIO = 0.75         # a reprint only matters when it is worth at most this share of the original
REPRINT_MIN_VOL = 20             # ... and PriceCharting has this many sales a year behind its price


def reprint_twins(cat):
    """{original card id: [cut, [[reprint's set, its price, its card id], ...]]}, dearest reprint first, at most two.
    WHICH card a reprint copies: several old cards can share its name and number (Charizard #4 is in Base Set, Base
    Set 2 and Crystal Guardians; Umbreon #17 in Delta Species and POP Series 5), and the catalog does not say which.
    These sets reprint the FAMOUS card, so the original is taken to be the dearest card with that name and number,
    with every printing of it in that same set (1st Edition, Shadowless); the other namesakes are left alone.
    Checked against Brett's catalog on 2026-10-06: 34 originals in his price range, the earliest-card rule got
    Umbreon wrong (Delta Species 2005 instead of the POP 5 Gold Star 2007), this one did not."""
    tw = getattr(cat, "_twins", None)
    if tw is not None:
        return tw
    reprints, others = defaultdict(list), defaultdict(list)
    for c in cat.cards:
        key = (c["name"].lower(), c["pre"], c["n"], c["suf"])
        if REPRINT_SETS.search(c["set"]):
            if c.get("pc") and (c.get("vol") or 0) >= REPRINT_MIN_VOL:
                reprints[key].append(c)
        else:
            others[key].append(c)
    tw = {}
    for key, ys in reprints.items():
        xs = others.get(key)
        if not xs:
            continue
        priced = [x for x in xs if x.get("pc")]
        if not priced:
            continue
        first_set = max(priced, key=lambda x: x["pc"])["set"]
        one = {}
        for y in sorted(ys, key=lambda y: (bool(y["variant"]), -y["pc"])):     # one per reprint set, its plain printing first
            one.setdefault(y["set"], y)
        for x in xs:
            if x["set"] != first_set or not x.get("pc"):
                continue
            mine = sorted((y for y in one.values() if y["pc"] <= REPRINT_MAX_RATIO * x["pc"]
                           and (not x.get("rel") or not y.get("rel") or y["rel"] > x["rel"])), key=lambda y: -y["pc"])[:2]
            if mine:
                tw[x["id"]] = [round(math.sqrt(x["pc"] * mine[0]["pc"]), 2), [[y["set"].replace("Pokemon ", ""), y["pc"], y["id"]] for y in mine]]
    cat._twins = tw
    return tw


def wrong_card(rec):
    """An identity check says this listing is probably not the card it was matched to - or Brett did (rec["um"])."""
    return bool(rec.get("pcm")) or rec.get("idv") == "conflict" or bool(rec.get("um"))


# ---------------- learning from the listings Brett marks as mismatches (2026-10-06) ----------------
# He marks a listing "mismatch" on the Raw Data tab, or answers "No, not the same card" on the phone. Each mark is kept
# in state["vps"]["wrong"] and teaches three things, from the narrowest and surest to the broadest:
#   1. the listing itself leaves the statistics and can never be a hit (rec["um"], see wrong_card / verdict);
#   2. the same seller's same title is never filed under that card again (sellers relist word for word), and the
#      same seller's other listings of that card are held back as "learned" instead of passing;
#   3. a WORD that keeps turning up in his mismatches and hardly anywhere else becomes a warning word: a listing whose
#      title carries it is held back the same way. The bar is deliberately high, because a handful of marks is thin
#      evidence: LEARN_MIN of his mismatches must contain the word (the matched card's own name and set words do not
#      count), no listing he confirmed as the right card may contain it, at most LEARN_BG_MAX of all tracked titles
#      may contain it, and it must be LEARN_LIFT times as common among his mismatches as among all titles.
# Rule 3 holds listings back from being hits; it does not touch the statistics. A mismatch whose title was right and
# whose PHOTO was wrong teaches nothing here - the words in it are all the right card's - and that is correct.
LEARN_MIN = 3
LEARN_BG_MAX = 0.02
LEARN_LIFT = 10
_WORD = re.compile(r"[a-z][a-z0-9'-]{2,}")
_bg = {"hour": None, "n": 0, "df": {}}


def title_key(title):
    return " ".join(re.findall(r"[a-z0-9]+", (title or "").lower()))


def title_words(title):
    return set(_WORD.findall((title or "").lower()))


def bad_titles(state):
    """{(seller, title key): {card ids}} for the listings he marked as mismatches. The SAME SELLER's same title only
    (Brett, 2026-10-06): many titles are written by eBay's own listing tool from the item specifics, so another
    seller's genuine copy can carry the identical words - "Charizard 4/102 Base Set Holo Rare Pokemon TCG English
    120 HP Stage 2 Arita" was a 30th Celebration reprint from one seller and is the real card from the next. A mark
    with no seller on record (an auction, an old phone answer) teaches no title at all."""
    out = {}
    for w in (state.get("vps") or {}).get("wrong", []):
        if w.get("ti") and w.get("sl") and w.get("card") is not None:
            out.setdefault((w["sl"], title_key(w["ti"])), set()).add(w["card"])
    return out


def learn_tables(state, cat):
    """-> {"titles": {(seller, key): {cards}}, "sellers": {(seller, card)}, "words": {word: mismatches containing it}}"""
    v = state.get("vps") or {}
    wrong = v.get("wrong", [])
    out = {"titles": bad_titles(state), "sellers": {(w["sl"], w["card"]) for w in wrong if w.get("sl") and w.get("card") is not None}, "words": {}}
    if len(wrong) < LEARN_MIN:
        return out
    hour = ts(NOW)[:13]
    if _bg["hour"] != hour:                                  # how common each word is across every title on file
        df, n = Counter(), 0
        for r in list(state["open"].values()) + state["closed"]:
            n += 1
            df.update(title_words(r.get("title")))
        _bg.update(hour=hour, n=n, df=df)
    bad = Counter()
    for w in wrong:
        c = cat.by_id.get(w.get("card")) if w.get("card") is not None else None
        own = title_words(" ".join([c["name"], c["set"], c.get("variant") or ""])) if c else set()
        bad.update(title_words(w.get("ti")) - own)
    good = set()
    for e in v.get("alert_log", []):
        if e.get("dec") in ("nm", "lp", "yes") and not e.get("um"):
            good |= title_words(e.get("ti"))
    for g in v.get("right", []):                             # "Same card" answers given with the site's Review button
        good |= title_words(g.get("ti"))
    n = max(1, _bg["n"])
    for word, k in bad.items():
        share = _bg["df"].get(word, 0) / n
        if k >= LEARN_MIN and word not in good and share <= LEARN_BG_MAX and k / len(wrong) >= LEARN_LIFT * share:
            out["words"][word] = k
    return out


def apply_learning(state, tables):
    """Stamp the last day's open listings with rec["lrn"] = why it is held back (rules 2 and 3), or clear it."""
    cut = ts(NOW - timedelta(hours=24))                      # the Raw Data window: the only listings a verdict is shown for
    for rec in state["open"].values():
        if rec["first"] < cut or rec.get("um"):
            rec.pop("lrn", None)
            continue
        why = None
        if rec.get("seller") and (rec["seller"], rec.get("card")) in tables["sellers"]:
            why = "this seller's earlier listing of this card was a wrong match"
        elif tables["words"]:
            hit = title_words(rec.get("title")) & tables["words"].keys()
            if hit:
                word = max(hit, key=lambda x: tables["words"][x])
                why = f'"{word}" was in {tables["words"][word]} of your wrong matches'
        if why:
            rec["lrn"] = why
        else:
            rec.pop("lrn", None)


def comparable(rec):
    return rec.get("tcond", "UNK") in COMPARABLE_CONDS and rec.get("tier") != "suspect" and not wrong_card(rec)


# ---------------- identity checks: is the listing really the card it was matched to? ----------------
def pc_flag(rec, c):
    """'low' / 'high' when the listing's total is implausibly far from the card's PriceCharting ungraded price -
    far more often a wrong match (another printing, another language, a lot, a fake) than a real price - else ''.
    Skipped when PriceCharting's own price is thin or the set is new, and on the low side for MP/HP copies,
    which are cheap for a reason."""
    total, pc = rec.get("total"), (c or {}).get("pc")
    if not total or not pc or (c.get("vol") or 0) < PC_MIN_SALES:
        return ""
    if c.get("rel") and NOW.date().toordinal() - c["rel"] < PC_NEW_SET_D:
        return ""
    ratio = total / pc
    if ratio < PC_LOW:
        return "low" if rec.get("tcond", "UNK") in COMPARABLE_CONDS else ""
    return "high" if ratio > PC_HIGH else ""


def rematch(state, cat):
    """Run the current matcher over every stored listing - open and closed. A listing an older matcher filed under
    the wrong card moves to the right one, one it should not have matched at all is dropped, and the condition
    words are read again. A printing that came from the item specifics is kept. The daily rollup is rebuilt from
    the corrected records. -> (moved, dropped, conditions changed)"""
    n = {"moved": 0, "dropped": 0, "cond": 0}

    def redo(r):
        title = r.get("title") or ""
        t = title_condition(title)
        if t != r.get("tcond", "UNK"):
            r["tcond"] = t
            n["cond"] += 1
        if "specifics" in (r.get("how") or ""):
            return True
        ci, how, _ = match_title(cat, title, r.get("epid") or "", state["denoms"])
        if ci is None:
            n["dropped"] += 1
            return False
        if cat.cards[ci]["id"] != r["card"]:
            n["moved"] += 1
            r["card"] = cat.cards[ci]["id"]
            for k in ("lam0", "rank0", "p48_0", "p24_0", "eff0", "ratio0", "idv", "idr", "pcm"):
                r.pop(k, None)                            # judged afresh against the right card
        if "how" in r:
            r["how"] = how
        return True

    state["open"] = {iid: r for iid, r in state["open"].items() if redo(r)}
    state["closed"] = [r for r in state["closed"] if redo(r)]
    state["daily"] = {}
    state["match_v"] = MATCH_VERSION
    return n["moved"], n["dropped"], n["cond"]


def stamp_pc(state, cat):
    """Judge every open listing against today's PriceCharting price (prices move, listings get repriced) and
    every closed one that was never judged. Runs each cycle before the statistics; it is a dictionary lookup."""
    for r in state["open"].values():
        c = cat.by_id.get(r["card"])
        if c:
            r["pc"], r["pcm"] = c.get("pc"), pc_flag(r, c)
    for r in state["closed"]:
        if "pcm" not in r:
            c = cat.by_id.get(r["card"])
            r["pc"], r["pcm"] = (c.get("pc"), pc_flag(r, c)) if c else (None, "")


def item_facts(r, it):
    """Quantity, returns and photo count from a full getItem payload (the scam score uses them)."""
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
    pics = [(p or {}).get("imageUrl") for p in [it.get("image")] + list(it.get("additionalImages") or [])]
    if any(pics):
        r["imgs"] = [u for u in pics if u][:4]             # front, back and two more, for the phone's check screen


def specifics(it):
    """getItem payload -> {item specific name (lower case): [values]}"""
    asp = defaultdict(list)
    for a in (it or {}).get("localizedAspects") or []:
        name, val = str(a.get("name", "")).strip().lower(), a.get("value")
        if name and val not in (None, ""):
            asp[name].append(str(val).strip())
    return asp


def printing_words(asp):
    """What a seller's Finish / Features / Card Size specifics say, as title words ("reverse", "holo", "jumbo")."""
    return set(expand_aliases(norm_tokens(" ".join(asp.get("finish", []) + asp.get("features", []) + asp.get("card size", [])))))


def check_identity(cat, c, it, title="", total=None):
    """Compare the seller's item specifics with the catalog card the title was matched to.
    -> (status, notes, move). status: 'ok' | 'conflict' | 'none' ('none' = nothing usable was filled in); notes say
    what disagreed; move = the catalog row to file the listing under instead, when the specifics name another
    printing of the same card that the catalog lists (Finish: Reverse Holo -> the [Reverse Holo] row).
    Hard conflicts: another card number, another card name, a set name that fits a different set clearly better,
    a language other than English, graded, a printing the catalog does not list for this card (a jumbo...).
    Silence proves nothing: a plain "Holo", or no Finish at all, never moves a listing. And the specifics are not
    believed blindly either - sellers stuff Features (the 2026-10-04 trial found "1st Edition" on a listing titled
    "Unlimited"): a move needs a title that names no printing of its own and a price that fits the printing named;
    otherwise the disagreement is a conflict, to be settled from the photos."""
    asp = specifics(it)
    first = lambda *names: next((asp[n][0] for n in names if asp.get(n)), None)
    bad, notes = [], []
    num_ok = name_ok = set_ok = False
    num = first("card number")
    p = (parse_number(num) or parse_number("#" + num)) if num else None
    if p:
        if p[1] != c["n"] or (p[0] and p[0] != c["pre"]):
            bad.append(f"card number {num}")
        else:
            num_ok = True
            official = cat.totals.get(c["set"])
            if p[3] is not None and not p[0] and official is not None and official != p[3]:
                notes.append(f"printed total {p[3]} vs {official}")
    name = first("card name", "character")
    if name:
        ntoks, want = set(norm_tokens(name)), c["ntoks"] or ["?"]
        if ntoks:
            if sum(1 for t in want if t in ntoks) / len(want) >= 0.5 or max(want, key=len) in ntoks:
                name_ok = True
            else:
                bad.append(f"card name {name}")
    setv = first("set")
    if setv:
        mine, other, other_set = cat.set_fit(setv, c["set"])
        if other > 1.5 * mine:                         # its words belong to a different set
            bad.append(f"set {setv}")
        elif mine > 0:
            set_ok = True
    lang = first("language")
    if lang and "english" not in lang.lower():
        bad.append(f"language {lang}")
    if (first("graded") or "").lower().startswith("y"):
        bad.append("graded")
    # the printing: what Finish / Features / Card Size say, against the rows PriceCharting lists for this card
    said, move = printing_words(asp), None
    group = cat.by_key[(c["set"], c["pre"], c["n"], c["suf"])]
    gone = missing_printing(cat, group, said)
    if gone:
        bad.append(f"printing {gone} (the catalog lists none for this card)")
    else:
        named = [cat.cards[i] for i in group if cat.cards[i]["variant"] and set(need_of(cat.cards[i])) - {"holo"}
                 and all(w in said for w in need_of(cat.cards[i]))]
        if named and not any(x["id"] == c["id"] for x in named):      # they name a printing this listing is not filed under
            ttoks = set(expand_aliases(norm_tokens(title)))
            pick = resolve_variant(cat, group, said | ttoks)
            m = cat.cards[pick] if pick is not None else named[0]
            if c["variant"] or "unlimited" in ttoks:                  # ... and the title names a different one
                bad.append(f"printing: the title says {c['variant'] or 'unlimited'}, the item specifics say {m['variant']}")
            elif total and m.get("pc") and not PRINT_FIT[0] <= total / m["pc"] <= PRINT_FIT[1]:
                bad.append(f"printing: the item specifics say {m['variant']}, but the price does not fit that printing "
                           f"(PriceCharting ${m['pc']:,.2f})")
            elif m["id"] != c["id"]:
                move = m
                notes.append(f"filed under [{m['variant']}] from the item specifics")
    if bad:
        return "conflict", bad, None
    return ("ok" if num_ok or (name_ok and set_ok) else "none"), notes, move


def wants_id_check(rec, cs):
    """0 / 1 / 2 when the listing deserves one lookup of its item specifics (a PASS at the collector's settings,
    the review band, a PASS at some smaller margin or with no buying tax - the page lets Brett change those and
    the liquidity rule), else None."""
    if rec.get("idv") or rec.get("total") is None or not cs:
        return None
    if cs.get("A") is None or cs.get("A_n", 0) < ANCHOR_MIN:
        # a PriceCharting lead: looked up when it would qualify with no buying tax (the page may be set that way)
        if rec.get("pcm") or rec.get("tier") == "suspect" or (rec.get("n_img") is not None and rec["n_img"] < 2) \
                or rec.get("tcond", "UNK") not in COMPARABLE_CONDS or seller_bar(rec) is not None:
            return None
        maxbuy = lead_decision(rec, cs)[2]
        return 2 if maxbuy is not None and rec["total"] <= maxbuy else None
    v, _ = verdict(rec, dict(cs, liquid=True))
    if v in ("PASS", "review"):
        return 0 if v == "PASS" and cs.get("liquid") else 1
    if v == "over max buy":
        net = listing_decision(rec, cs)[1]
        if net is not None and rec["total"] <= net:
            return 2
    return None


def printing_fits(cat, rec):
    """A mismatch-flagged listing on a card with several printings, one of which is priced where the listing is:
    the title probably left the printing out, and the item specifics may name it."""
    c = cat.by_id.get(rec["card"])
    if not c or not rec.get("total"):
        return False
    for i in cat.by_key[(c["set"], c["pre"], c["n"], c["suf"])]:
        o = cat.cards[i]
        if o["id"] != c["id"] and o.get("pc") and PRINT_FIT[0] <= rec["total"] / o["pc"] <= PRINT_FIT[1]:
            return True
    return False


def refile(rec, c):
    """Move a listing to another printing of the same card (the row its item specifics name)."""
    rec["card"], rec["how"] = c["id"], (rec.get("how") or "title") + "+specifics"
    rec["pc"], rec["pcm"] = c.get("pc"), pc_flag(rec, c)
    for k in ("lam0", "rank0", "p48_0", "p24_0", "eff0", "ratio0"):     # stamps made against the other row's book
        rec.pop(k, None)


def settle_pending(state, cat, iid, rec, it):
    """An unmatched "ambiguous variant" listing, now with its item specifics: file it under the printing they
    name, or let it go. -> what happened, for the log."""
    del state["pending"][iid]
    idxs = cat.by_key.get(tuple(rec.get("ckey") or ()), [])
    if not it or not idxs:
        return "gone"
    words = printing_words(specifics(it)) | set(expand_aliases(norm_tokens(rec["title"])))
    if missing_printing(cat, idxs, words):
        return "printing not in catalog"
    pick = resolve_variant(cat, idxs, words)
    if pick is None:
        return "still unclear"
    c = cat.cards[pick]
    status, notes, _ = check_identity(cat, c, it, rec["title"])
    if status == "conflict":
        return "conflict: " + ", ".join(notes)
    rec.pop("ckey", None)
    item_facts(rec, it)
    rec.update({"card": c["id"], "how": "specifics", "checked": None, "checked_age": 0.0, "suspect": False,
                "rev": None, "hist": [], "enriched": True, "idv": status,
                "idr": notes + ["printing taken from the item specifics"]})
    rec["pc"], rec["pcm"] = c.get("pc"), pc_flag(rec, c)
    state["open"][iid] = rec
    return f"filed as {c['name']}" + (f" [{c['variant']}]" if c["variant"] else "") + f" #{c['num']}"


def verify_hits(state, cat, cards, max_calls=VERIFY_MAX_CALLS):
    """Item-specifics lookups: one full getItem per listing, once each, most valuable first. Returns how many.
      rank 0-2  listings from the last 24 h that clear the price gate (wants_id_check)
      rank 3    unmatched "ambiguous variant" listings (state["pending"]) on a card that has an anchor
      rank 4    listings flagged too cheap where another printing of the card is priced where the listing is
      rank 5    the other ambiguous-variant listings          rank 6  too-high flags another printing fits
    Ranks 0-2 may use VERIFY_DAILY_MAX lookups a day; ranks 3-6 get one every PRINTING_EVERY_S, PRINTING_DAILY_MAX a day."""
    used = {d: k for d, k in state.get("idchecks", {}).items() if d == TODAY}
    pused = {d: k for d, k in state.get("printchecks", {}).items() if d == TODAY}
    state["idchecks"], state["printchecks"] = used, pused
    pend = state.setdefault("pending", {})
    day_ago = ts(NOW - timedelta(hours=24))
    queue = []
    for iid, r in state["open"].items():
        if r.get("idv") or r["first"] < day_ago:        # ISO stamps compare as text
            continue
        rank = wants_id_check(r, cards.get(str(r["card"])))
        if rank is None and r.get("pcm") and printing_fits(cat, r):
            rank = 4 if r["pcm"] == "low" else 6
        if rank is not None:
            queue.append((rank, -(r.get("total") or 0), iid))
    for iid, r in pend.items():
        idxs = cat.by_key.get(tuple(r.get("ckey") or ()), [])
        anchored = any((cards.get(str(cat.cards[i]["id"])) or {}).get("A_n", 0) >= ANCHOR_MIN for i in idxs)
        queue.append((3 if anchored else 5, -(r.get("total") or 0), iid))
    queue.sort()
    n = 0
    for rank, _, iid in queue:
        if n >= max_calls:
            break
        if rank <= 2:
            if used.get(TODAY, 0) >= VERIFY_DAILY_MAX:
                continue
        elif pused.get(TODAY, 0) >= PRINTING_DAILY_MAX or time.time() - state.get("print_last", 0) < PRINTING_EVERY_S:
            continue
        r = pend[iid] if iid in pend else state["open"][iid]
        if DRY_RUN:
            it = json.load(open(os.path.join("fixtures", "items.json"))).get(iid)
        else:
            try:
                it = api_get(state, f"/buy/browse/v1/item/{iid}", {}, ok_404=True)
            except RuntimeError as e:
                log(f"ID check: lookup failed for {iid} ({e})")
                continue
        n += 1
        if rank <= 2:
            used[TODAY] = used.get(TODAY, 0) + 1
        else:
            pused[TODAY], state["print_last"] = pused.get(TODAY, 0) + 1, time.time()
        if iid in pend:
            log(f"ID check: printing unclear - {r['title'][:70]} -> {settle_pending(state, cat, iid, r, it)}")
            continue
        c = cat.by_id.get(r["card"])
        if not it or not c:
            r["idv"], r["idr"] = "none", ["listing no longer there"]
            continue
        item_facts(r, it)
        r["enriched"] = True
        r["idv"], r["idr"], move = check_identity(cat, c, it, r["title"], r.get("total"))
        if move is not None:
            refile(r, move)
        log(f"ID check: {r['idv']} - {r['title'][:70]} -> {c['name']} #{c['num']} ({c['set']})"
            + (f": {', '.join(r['idr'])}" if r["idr"] else ""))
    return n


# ---------------- scam screen ----------------
# Points per signal. Re-weighted 2026-10-06 from the outcome table (5,774 closed listings; "gone" = pulled before its
# end date, usually by eBay: clean 0.5%, watch 3.2%, suspect 11.5%). Kept: seller under 10 ratings (4.4% gone), the
# price steps (7.7 / 4.1 / 1.5%), one photo and slow delivery (2.3% each). Dropped, because they sat at or under the
# clean rate: seller with 10-49 ratings (0.5%), feedback % below the bar (0 of 112; the gate's seller bar still
# applies on its own), no returns (0 of 46). A photo also used by another seller (8 of 16 gone, none sold) now makes
# a listing suspect by itself. Old records keep the codes they were stamped with, so the labels stay.
SCAM_POINTS = {"p50": 4, "p65": 2, "p75": 1, "fb0": 3, "fbq": 1, "img": 1, "qty": 2, "dup": 3, "slow": 1,
               "top": -2, "est": -1, "burst": 0, "fb1": 1, "pct": 2, "ret": 1}
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
    for k, (sl, _) in (state.get("imgs") or {}).items():     # photos of listings that outlived 2 days (close_outlived)
        img_sellers[k].add(sl)
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
        if r.get("total") is not None and r.get("tcond", "UNK") in COMPARABLE_CONDS and not wrong_card(r):
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
        if r.get("n_img") is not None and r["n_img"] <= 1:
            pts += 1; why.append("img")
        if r.get("qty") is not None and r["qty"] >= 3 and (ref or total or 0) >= SCAM_QTY_MIN_PRICE \
                and (fb is None or fb < 500):                # "a $75+ card": the card's price, else the ask
            pts += 2; why.append("qty")
        k = img_key(r.get("img"))
        if k and r.get("seller") and len(img_sellers[k] - {r["seller"]}) > 0:
            pts += 3; why.append("dup")
        dmax = parse_ts(r.get("dmax") or "")
        origin = parse_ts(r.get("origin") or "") or parse_ts(r["first"])
        if dmax and origin and (dmax - origin).days > 10:
            pts += 1; why.append("slow")
        if r.get("top"):
            pts -= 2; why.append("top")
        if fb is not None and fb >= 500 and pct is not None and pct >= 99:
            pts -= 1; why.append("est")
        tier = "suspect" if (pts >= SCAM_SUSPECT or "dup" in why) else "watch" if pts >= SCAM_WATCH else "clean"
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
    for sd in (state.get("scam_stale") or {}).values():      # listings that outlived 2 days and kept no record
        for tier, n in sd.get("t", {}).items():
            tiers.setdefault(tier, Counter())["stale"] += n
        for code, n in sd.get("s", {}).items():
            signals.setdefault(code, Counter())["stale"] += n
    return {"tiers": {k: dict(v) for k, v in tiers.items()}, "signals": {k: dict(v) for k, v in signals.items()},
            "labels": SCAM_LABELS, "watch": SCAM_WATCH, "suspect": SCAM_SUSPECT}


def enrich(state, max_calls=ENRICH_MAX_CALLS):
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
    for _, iid in cands[:max_calls]:
        r = state["open"][iid]
        if DRY_RUN:
            it = json.load(open(os.path.join("fixtures", "items.json"))).get(iid)
        else:
            try:
                it = api_get(state, f"/buy/browse/v1/item/{iid}", {}, ok_404=True)
            except RuntimeError as e:
                log(f"Enrich: lookup failed for {iid} ({e})")
                continue
        r["enriched"] = True
        if not it:
            continue
        item_facts(r, it)
        n += 1
    if cands:
        log(f"Enrich: {n} of {len(cands)} candidate listings looked up for quantity/returns.")


def r2(v):
    return None if v is None else round(v, 2)


def gate(csell, margin=None):
    margin = MARGIN if margin is None else margin          # read when called: settings.json can change it while running
    net = csell * (1 - FEE_EFF) - FEE_FIXED - SHIP_OUT - SUPPLIES
    return round(net, 2), round(net / (1 + margin), 2)


# ---------------- the two anchors ----------------
def weighted_median(vals, weights):
    pairs = sorted(zip(vals, weights))
    total = sum(w for _, w in pairs)
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= total / 2:
            return v
    return pairs[-1][0]


def robust_center(vals, weights):
    """Weighted median under ANCHOR_HL_MIN points; weighted Hodges-Lehmann (median of pairwise averages,
    weights multiplied) from there - the same idea as the Theil-Sen slope, about 15% less noisy than a median."""
    if not vals:
        return None
    if len(vals) < ANCHOR_HL_MIN:
        return weighted_median(vals, weights)
    walsh, ww = [], []
    for i in range(len(vals)):
        for j in range(i, len(vals)):
            walsh.append((vals[i] + vals[j]) / 2)
            ww.append(weights[i] * weights[j])
    return weighted_median(walsh, ww)


def trim_sales(vals):
    """Tukey fences (1.5 IQR) intersected with median/4 .. median*4; the fences only with 4+ points."""
    if not vals:
        return []
    v = sorted(vals)
    med = pct(v, 0.5)
    lo, hi = med / 4, med * 4
    if len(v) >= 4:
        q1, q3 = pct(v, 0.25), pct(v, 0.75)
        iqr = q3 - q1
        lo, hi = max(lo, q1 - 1.5 * iqr), min(hi, q3 + 1.5 * iqr)
    return [x for x in v if lo <= x <= hi]


def anchor(sold, nm_eq):
    """(A, sales used, window days, A_fast) from a card's comparable sales. sold = closed records, newest
    last. The 30-day window is widened to 60 when it holds fewer than ANCHOR_MIN sales."""
    for win in (ANCHOR_WINDOW_D, ANCHOR_WIDE_D):
        start = NOW - timedelta(days=win)
        recs = [r for r in sold if r["total"] is not None and parse_ts(r["closed"]) >= start]
        if len(recs) >= ANCHOR_MIN or win == ANCHOR_WIDE_D:
            break
    if not recs:
        return None, 0, None, None
    vals = [nm_eq(r) for r in recs]
    keep = set(trim_sales(vals))
    kept = [(nm_eq(r), r) for r in recs if nm_eq(r) in keep]
    ages = [hours_between(parse_ts(r["closed"]), NOW) / 24 for _, r in kept]
    weights = [0.5 ** (a / ANCHOR_HALF_LIFE_D) for a in ages]
    a = robust_center([v for v, _ in kept], weights)
    fast = [(v, 0.5 ** (hours_between(parse_ts(r["closed"]), NOW) / 24 / ANCHOR_HALF_LIFE_D))
            for v, r in kept if r.get("hrs") is not None and r["hrs"] <= FAST_HRS]
    a_fast = weighted_median([v for v, _ in fast], [w for _, w in fast]) if len(fast) >= FAST_MIN else None
    return r2(a), len(kept), win, r2(a_fast)


def stale_days(lam):
    """How long a credible copy can sit before buyers have evidently passed on it."""
    if not lam:
        return None
    return min(7.0, max(1.0, STALE_K / lam))


def credible(book, a, lam):
    """The copies allowed to set the floor, cheapest first: [[id, effective price], ...] (top 5).
    Each record must carry _eff (NM-equivalent total, Best Offer at 90%)."""
    out = []
    limit = stale_days(lam)
    for r in book:
        if r.get("tier") in ("watch", "suspect"):
            continue
        if r.get("fb") is None or r["fb"] < CRED_MIN_FB or seller_bar(r) is not None:
            continue
        if a and r["_eff"] < CRED_MIN_RATIO * a:
            continue
        if limit is not None:
            origin = parse_ts(r.get("origin") or r["first"]) or parse_ts(r["first"])
            if hours_between(origin, NOW) / 24 > limit:
                continue
        out.append([r["id"], r["_eff"]])
        if len(out) == 5:
            break
    return out


def round99(x):
    return None if x is None else max(0.99, math.floor(x) - 0.01)


def sell_price(floor, a, a_fast):
    """S = min(floor - UNDERCUT, SELL_UNDER_A * A), capped by the fast-sale median when there is one;
    SELL_NO_FLOOR * A with no credible floor. None without an anchor."""
    if a is None:
        return None
    cap = SELL_UNDER_A * a
    if a_fast is not None:
        cap = min(cap, a_fast)
    s = min(floor - UNDERCUT, cap) if floor is not None else SELL_NO_FLOOR * a
    return round99(s)


def is_liquid(lam, st, conf=None, window_h=None):
    """P(at least one buyer inside the window) >= conf, i.e. lambda >= -ln(1 - conf) / T; and the measured
    48-hour sell-through, once there is one, at least ST_MIN."""
    conf = CONFIDENCE if conf is None else conf
    window_h = SELL_WINDOW_H if window_h is None else window_h
    if not lam:
        return False
    lam_min = -math.log(1 - conf) / (window_h / 24.0)
    return lam >= lam_min and (st is None or st >= ST_MIN)


def lp_correction(state):
    """Measured LP discount: for every LP sale, its total divided by the median of the same card's
    NM/unstated sales within +/- LP_REF_WINDOW_D days; the discount is 1 - median(ratio), pooled across
    all cards, per price tier of the reference price. Ladder: tier (>= LP_MIN_SALES) -> global -> default."""
    by_card = defaultdict(lambda: {"ref": [], "lp": []})
    for r in state["closed"]:
        if r["out"] != "sold" or r["total"] is None or wrong_card(r):
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
        if r["out"] == "sold" and r.get("tcond", "UNK") in COMPARABLE_CONDS and r["total"] is not None \
                and not wrong_card(r):
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
                and r.get("tier") != "suspect" and not wrong_card(r):
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
        if comparable(r) and r["total"] is not None and not r.get("vanished"):
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
    by_id = cat.by_id
    twins = reprint_twins(cat)
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
                and r.get("tcond", "UNK") in COMPARABLE_CONDS and r.get("tier") != "suspect" and not wrong_card(r)]
        k = len(sold)
        lam = round(gamma_q(k + 0.5, D, 0.25), 3) if k >= 1 else None
        # --- LP normalization: prices of LP copies are lifted to NM-equivalent for every price stat.
        # The tier is picked from the card's raw sold median (or cheapest ask before any sale).
        raw_tot = [r["total"] for r in sold if r["total"] is not None]
        # a listing the collector has flagged as gone from eBay ("vanished", waiting for its lookup) is not a
        # competing copy any more: it stays out of the book whether it sold or merely ended
        raw_ask = [r["total"] for r in opens[cid] if comparable(r) and r["total"] is not None and not r.get("vanished")]
        lpd = lp_frac(lp, pct(raw_tot, 0.5) if len(raw_tot) >= 3 else (min(raw_ask) if raw_ask else pct(raw_tot, 0.5)))
        nm_eq = lambda r: r["total"] / (1 - lpd) if r.get("tcond") == "LP" else r["total"]
        # --- supply (the book) ---
        book = [r for r in opens[cid] if comparable(r) and r["total"] is not None and not r.get("vanished")]
        for r in book:
            r["_eff"] = round(nm_eq(r) * (BO_HAIRCUT if r["bo"] else 1.0), 2)
        book.sort(key=lambda r: r["_eff"])
        N = len(book)
        p = [r["_eff"] for r in book[:3]] + [None] * 3
        unsold = (state.get("unsold") or {}).get(str(cid)) or {}     # outlived 2 days, no record kept: {first-seen day: n}
        win_day = win_start.date().isoformat()                       # by calendar day on both sides, so they line up
        new30 = sum(1 for r in opens[cid] + closed[cid] if comparable(r) and r["first"][:10] >= win_day) \
            + sum(n for d, n in unsold.items() if d >= win_day)
        mu = round(new30 / D, 3)
        dos = round(N / lam, 1) if lam else None
        io_ = round(mu / lam, 2) if lam else None
        # --- sold prices ---
        sold_sorted = sorted(sold, key=lambda r: r["closed"])
        last10 = [nm_eq(r) for r in sold_sorted[-10:] if r["total"] is not None]
        smed, s80 = pct(last10, 0.5), pct(last10, 0.8)
        hrs = pct([r["hrs"] for r in sold_sorted[-10:]], 0.5)
        # sell-through: of comparable listings first seen about 3-33 days ago, the share that sold within 48 h of going up
        # (listings are only followed for 2 days now, so 48 h is the only horizon the data can answer)
        # The pool is cut by first-seen CALENDAR DAY for records and counts alike. (The first version cut records by
        # the hour and counts by the day: for part of a day the unsold were counted and the sold were not, which
        # pulled every card's figure down while the pool was only five days deep.) A listing that vanished and has
        # not been looked up yet is left out altogether: sold or merely ended is not known.
        st_lo = (NOW - timedelta(days=STAT_WINDOW_D + ST_POOL_MIN_AGE_D + 1)).date().isoformat()
        st_hi = (NOW - timedelta(days=ST_POOL_MIN_AGE_D + 1)).date().isoformat()     # every listing in it is 3+ days old
        st_pool = [r for r in opens[cid] + closed[cid] if comparable(r) and st_lo <= r["first"][:10] <= st_hi
                   and not (r.get("out") is None and r.get("vanished"))]
        st_n = len(st_pool) + sum(n for d, n in unsold.items() if st_lo <= d <= st_hi)
        st_sold = [r for r in st_pool if r.get("out") == "sold" and r["hrs"] <= FOLLOW_D * 24]
        st = round(len(st_sold) / st_n, 3) if st_n >= 3 else None
        # --- pricing: the two anchors ---
        A, A_n, A_win, A_fast = anchor(sold_sorted, nm_eq)
        cred = credible(book, A, lam)
        L = cred[0][1] if cred else None
        S = sell_price(L, A, A_fast)
        price = A if A is not None else (p[0] if p[0] is not None else smed)
        probT = round((1 - math.exp(-lam * SELL_WINDOW_H / 24)) * 100, 1) if lam else None
        edays = round(-math.log(1 - CONFIDENCE) / lam, 1) if lam else None       # days at rank 1 to reach the confidence
        liq = is_liquid(lam, st)
        csell, basis = (S, "sell") if S is not None else (None, None)
        net, maxbuy = gate(csell) if csell is not None else (None, None)
        # Calibration record: for listings that appeared this run, remember the model's claim about them -
        # lambda, their rank in the book, the sell price S and their price relative to A. Later, "did it sell
        # within 48 h" vs "how far above/below S it was priced" calibrates the price, and the cheap ones
        # (ratio0) show how fast underpriced copies actually go.
        for rank, r in enumerate(book, start=1):
            if r["first"] == ts(NOW) and r.get("rank0") is None:
                r["lam0"], r["rank0"], r["eff0"] = lam, rank, r["_eff"]
                r["p48_0"] = S
                r["p24_0"] = None
                r["ratio0"] = round(r["_eff"] / A, 3) if A else None
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
            "A": A, "A_n": A_n, "A_win": A_win, "A_fast": A_fast, "cred": cred, "L": L, "S": S, "liquid": liq,
            "basis": basis, "probT": probT, "edays": edays, "csell": r2(csell), "net": net, "maxbuy": maxbuy,
            "hot": hot, "confirm": confirm,
            "pc": (by_id.get(cid) or {}).get("pc"), "pcv": (by_id.get(cid) or {}).get("vol"),
            "tw": twins.get(cid),                    # a cheaper anniversary reprint with this card's number: [cut, [[set, price, id]]]
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


CAL_SINCE = "2026-10-01T18:00:00Z"   # the sell price changed model here; earlier stamps measured a different claim
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
        if not ref or r.get("eff0") is None or r.get("rank0") is None or r["rank0"] > DEPTH_CAP or wrong_card(r):
            continue
        first = parse_ts(r["first"])
        if first is None or first > cutoff or r["first"] < CAL_SINCE:
            continue                                  # outcome not knowable yet, or stamped by the old model
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


def listing_decision(rec, cs):
    """(sell price, net, maxbuy) for ONE listing: the card's floor is taken from the credible copies other than
    this listing (you buy it, it leaves the market, your relist competes with what remains), and an LP listing
    sells at the LP discount."""
    if not cs or cs.get("A") is None:
        return None, None, None
    floor = next((eff for iid, eff in cs.get("cred", []) if iid != rec["id"]), None)
    s = sell_price(floor, cs["A"], cs.get("A_fast"))
    if s is None:
        return None, None, None
    sell = s * (1 - cs.get("lpd", LP_DEFAULT_PCT) / 100) if rec.get("tcond") == "LP" else s
    net, maxbuy = gate(sell)
    return s, net, maxbuy


def lead_decision(rec, cs):
    """(sell price, net, maxbuy) for a listing on a card eBay cannot judge yet, from PriceCharting's price capped by
    the cheapest believable copy other than this one; (None, None, None) when the card does not qualify as a lead.
    The page mirrors this in leadDecide()."""
    pc = (cs or {}).get("pc")
    if not pc or pc < LEAD_MIN_PC or (cs.get("pcv") or 0) < LEAD_MIN_PC_SALES:
        return None, None, None
    floor = next((eff for iid, eff in cs.get("cred", []) if iid != rec["id"]), None)
    s = round99(min(floor - UNDERCUT, LEAD_SELL_PC * pc) if floor is not None else LEAD_SELL_NO_FLOOR * pc)
    sell = s * (1 - cs.get("lpd", LP_DEFAULT_PCT) / 100) if rec.get("tcond") == "LP" else s
    net, maxbuy = gate(sell)
    return s, net, maxbuy


def verdict(rec, cs):
    """Gate verdict for one listing given its card's stats (collector defaults: 70% / 48 h / 10% margin).
    The page mirrors this in verdictOf(); keep the two in step."""
    if rec["total"] is None:
        return "no price", None
    allin = round(rec["total"] + (rec["item"] or 0) * TAX, 2)
    if rec.get("um"):                                # Brett marked it: not the card it was matched to
        return "mismatch: marked by you", allin
    if rec.get("n_img") is not None and rec["n_img"] < 2:
        return "fewer than 2 photos", allin
    if rec.get("tier") == "suspect":
        return "suspect", allin
    if rec.get("lrn"):                               # held back by what his earlier marks taught (apply_learning)
        return "learned", allin
    if rec.get("pcm"):                               # far from PriceCharting's price: treated as a wrong match
        return ("mismatch: too cheap" if rec["pcm"] == "low" else "mismatch: too high"), allin
    if cs and cs.get("tw") and rec["total"] < cs["tw"][0]:   # priced nearer its anniversary reprint than the card itself
        return "reprint?", allin
    if not cs or cs.get("A") is None or cs.get("A_n", 0) < ANCHOR_MIN:
        # eBay cannot judge this card yet. Is the listing a lead on PriceCharting's price?
        if cs and rec.get("tcond", "UNK") in COMPARABLE_CONDS and seller_bar(rec) is None:
            maxbuy = lead_decision(rec, cs)[2]
            if maxbuy is not None and allin <= maxbuy:
                return ("ID conflict" if rec.get("idv") == "conflict" else "LEAD"), allin
        if not cs or cs.get("A") is None:
            return ("no sales yet" if cs else "no data yet"), allin
        return f"too few sales ({cs.get('A_n', 0)})", allin
    if not cs.get("liquid"):
        return "not liquid", allin
    if rec.get("tcond", "UNK") not in COMPARABLE_CONDS:
        return "condition " + rec.get("tcond", "?"), allin
    bar = seller_bar(rec)
    if bar is not None:
        return f"seller < {bar:.0f}%", allin
    if rec["total"] < REVIEW_RATIO * cs["A"]:
        return "review", allin
    s, net, maxbuy = listing_decision(rec, cs)
    if maxbuy is None:
        return "no sales yet", allin
    if allin <= maxbuy:                              # a hit - unless its item specifics say it is another card
        return ("ID conflict" if rec.get("idv") == "conflict" else "PASS"), allin
    return "over max buy", allin


DEAL_BUCKETS = [(0.0, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0)]


def deal_calib(state):
    """How fast cheap listings actually go: closed listings by price-to-anchor at first sight."""
    rows = []
    for lo, hi in DEAL_BUCKETS:
        recs = [r for r in state["closed"] if r.get("ratio0") is not None and lo <= r["ratio0"] < hi
                and r.get("out") in ("sold", "ended", "gone", "stale") and not wrong_card(r)]
        sold = [r for r in recs if r["out"] == "sold" and r.get("hrs") is not None]
        rows.append({"lo": lo, "hi": hi, "n": len(recs), "sold": len(sold),
                     "sold_1h": sum(1 for r in sold if r["hrs"] <= 1), "sold_6h": sum(1 for r in sold if r["hrs"] <= 6),
                     "sold_24h": sum(1 for r in sold if r["hrs"] <= 24), "sold_48h": sum(1 for r in sold if r["hrs"] <= 48),
                     "med_hrs": r2(pct([r["hrs"] for r in sold], 0.5)) if sold else None})
    return rows


def set_sizes(state):
    """Printed size of each set ("36/123" -> 123), the denominator seen most often in matched titles, once it has
    been seen 5 times. The page shows card numbers as number/size on every tab."""
    out = {}
    for setname, d in state.get("denoms", {}).items():
        best = max(d, key=d.get)
        if d[best] >= 5:
            out[setname] = int(best)
    return out


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
        s_own = listing_decision(r, cs)[0]
        live.append([r["id"], r["card"], r["first"], round(hours_between(origin, NOW), 1), r["title"],
                     r["item"], r["ship"], r["total"], allin,
                     cs["price"] if cs else None,
                     None if not cs or not cs.get("price") or r["total"] is None else round((r["total"] / cs["price"] - 1) * 100, 1),
                     listing_decision(r, cs)[2], v, r.get("tcond", "UNK"), int(r["bo"]), r["fb"], r["pct"],
                     r.get("out") or "open", r["url"], r.get("img"), r.get("how"),
                     r.get("hrs") if r.get("out") else None,          # 21: hours from listing to outcome
                     r.get("n_img"), r.get("tier", "clean"), r.get("sc", 0), r.get("scr", []),   # 22-25: photos, tier, score, signals
                     s_own,                                                                      # 26: this listing's own sell price
                     r.get("pc"), r.get("pcm") or "",             # 27-28: PriceCharting ungraded price, mismatch flag (low/high)
                     r.get("idv") or "", r.get("idr") or [],      # 29-30: item-specifics check (ok/conflict/none), what it found
                     1 if r.get("um") else 0, r.get("lrn") or "",   # 31: marked a mismatch by Brett; 32: held back by learning, and why
                     (r.get("imgs") or [])[1:4]])                   # 33: the listing's other photos (the first is 20), for the Review screen
    live.sort(key=lambda x: x[2], reverse=True)
    unmatched = [u for u in state["unmatched"] if parse_ts(u[0]) >= day_ago][-300:]
    passes = sum(1 for x in live if x[12] == "PASS")
    return {
        "t": ts(NOW), "runs": state["runs"], "calls_today": state["calls"].get(TODAY, 0),
        "n_open": len(state["open"]), "n_closed": len(state["closed"]), "n_cards": len(cards),
        "n_live": len(live), "n_pass": passes, "band": TAB_PRICE,
        "gate": {"fee": FEE_PCT, "buyerTax": BUYER_TAX, "fixed": FEE_FIXED, "shipOut": SHIP_OUT, "supplies": SUPPLIES,
                 "tax": TAX, "margin": MARGIN, "confidence": CONFIDENCE, "sellWindowH": SELL_WINDOW_H,
                 "undercut": UNDERCUT, "boHaircut": BO_HAIRCUT, "window": STAT_WINDOW_D, "minSales": ANCHOR_MIN,
                 "sellUnderA": SELL_UNDER_A, "sellNoFloor": SELL_NO_FLOOR, "reviewRatio": REVIEW_RATIO,
                 "pcLow": PC_LOW, "pcHigh": PC_HIGH, "pcMinSales": PC_MIN_SALES, "pcNewSetD": PC_NEW_SET_D,
                 "leadMinSales": LEAD_MIN_PC_SALES, "leadMinPc": LEAD_MIN_PC, "leadSellPc": LEAD_SELL_PC,
                 "leadSellNoFloor": LEAD_SELL_NO_FLOOR},
        "cards": cards, "live": live, "unmatched": unmatched, "lp": lp, "scam": scam_calib(state),
        "deals": deal_calib(state), "sets": set_sizes(state),
        "calib": {"h48": calibrate(state, 48, "p48_0"), "h24": calibrate(state, 24, "p24_0")},
    }


# ---------------- housekeeping ----------------
def prune(state):
    keep_from = NOW - timedelta(days=KEEP_CLOSED_D)
    stale_from = NOW - timedelta(days=KEEP_STALE_D)
    state["closed"] = [r for r in state["closed"] if parse_ts(r["closed"]) >= keep_from
                       and (r.get("out") != "stale" or parse_ts(r["closed"]) >= stale_from)]
    day_from = (NOW - timedelta(days=STAT_WINDOW_D + ST_POOL_MIN_AGE_D + 1)).date().isoformat()
    state["unsold"] = {c: d2 for c, d2 in ((c, {d: n for d, n in days.items() if d >= day_from})
                                           for c, days in (state.get("unsold") or {}).items()) if d2}
    state["scam_stale"] = {d: v for d, v in (state.get("scam_stale") or {}).items() if d >= keep_from.date().isoformat()}
    img_from = (NOW - timedelta(days=30)).date().isoformat()
    state["imgs"] = {k: v for k, v in (state.get("imgs") or {}).items() if v[1] >= img_from}
    seen_from = NOW - timedelta(hours=48)
    state["seen"] = {k: v for k, v in state["seen"].items() if parse_ts(v) >= seen_from}
    um_from = NOW - timedelta(hours=48)
    state["unmatched"] = [u for u in state["unmatched"] if parse_ts(u[0]) >= um_from][-2000:]
    state["calls"] = {d: n for d, n in state["calls"].items() if d >= (NOW - timedelta(days=7)).date().isoformat()}
    day_ago_s = int(time.time()) - 86400
    state["recent_calls"] = [t for t in state.get("recent_calls", []) if t >= day_ago_s]
    keep = ts(NOW - timedelta(hours=PENDING_KEEP_H))
    state["pending"] = {k: r for k, r in state.get("pending", {}).items() if r["first"] >= keep}


# ---------------- main ----------------
def main():
    if not PASSWORD and not DRY_RUN:
        raise SystemExit("SITE_PASSWORD secret is missing (it encrypts the state and the live file).")
    cat = load_catalog()
    state = load_state()
    if state.get("match_v") != MATCH_VERSION:
        log("Re-matched every stored listing: %d moved to another card, %d dropped, %d conditions re-read" % rematch(state, cat))
    state["runs"] = state.get("runs", 0) + 1
    if state["calls"].get(TODAY, 0) >= 4950:
        log("Daily API limit reached - skipping this run.")     # backstop only; lookup_budget() keeps us under it
        return
    sweep(state, cat)
    budget, used, runs_left = lookup_budget(state)
    enrich_n = min(ENRICH_MAX_CALLS, budget // 7)
    log(f"Budget: {budget} lookups this run ({used} calls used today, {runs_left} runs left in the day).")
    enrich(state, enrich_n)
    track(state, max(0, budget - enrich_n))
    prune(state)
    stamp_pc(state, cat)
    score_listings(state)
    lp = lp_correction(state)
    update_daily(state, lp)
    cards = compute_stats(state, cat, lp)
    verify_hits(state, cat, cards, min(VERIFY_MAX_CALLS, budget))
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
