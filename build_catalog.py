"""
build_catalog.py  -  Turn PriceCharting's Pokemon price guide into a password-protected
website with a searchable, sortable table.

Runs on GitHub Actions every morning (see .github/workflows/update_catalog.yml).
The workflow then password-protects site/index.html and publishes it to GitHub Pages.

What it does
  1. Downloads the PriceCharting Pokemon CSV using the PC_DOWNLOAD_URL secret
     (locally: pc_download_url.txt if present, else pricecharting.csv in this folder)
  2. Keeps every PriceCharting product (see the two flags below)
  3. Orders sets by release date, and cards by card number within each set
  4. Writes site/index.html - one self-contained page with three tabs:
       PriceCharting Catalog (default) | eBay Catalog | eBay Raw Data
     The page's CSS, markup and JavaScript live in page/ (style.css, body.html, app.js, help.js)
     and are stitched into a shell template here at build time.
     The eBay tabs read live/ebay_live.bin, which ebay_sweep.py publishes to the repo's
     "live" branch every 15 minutes (same encryption key, derived from SITE_PASSWORD).
  5. Archives a dated snapshot in snapshots/ with EVERY column PriceCharting provides
     (encrypted with SITE_PASSWORD, so the repo can be public without exposing their data).
     The workflow keeps these on a GitHub Release tagged "snapshots" - downloaded into the
     folder before each run, uploaded after - instead of committing them, so the repo stays small.
  6. Re-reads every past snapshot, computes trend statistics for every card, and writes
     per-card history files (public/history/*.bin, encrypted) that power the "Trend" popup

Secrets used on GitHub:  PC_DOWNLOAD_URL   SITE_PASSWORD
"""
import glob
import gzip
import warnings
import hashlib
import json
import os
import re
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import requests

PC_CSV = "pricecharting.csv"
URL_FILE = "pc_download_url.txt"     # optional, local only - your personal CSV link
SITE_DIR = "site"
SNAPSHOT_DIR = "snapshots"
HISTORY_DIR = os.path.join("public", "history")   # staticrypt writes index.html next to this
SHARD = 300                                       # cards per history file (page rows are grouped by set)

ENGLISH_ONLY = True        # False -> every language PriceCharting tracks (Japanese, Korean, ...)
SINGLES_ONLY = True        # False -> also keep booster boxes, packs, tins, decks (no "#" in name)
ENCRYPT_SNAPSHOTS = True   # False only if the repo is private (needs GitHub Pro for Pages)

# ---- Gate assumptions behind "Max buy $" (edit to taste; the page shows them) ----
FEE_PCT = 0.1325        # eBay final value fee for trading cards
FEE_FIXED = 0.40        # eBay per-order fee (orders over $10)
SHIP_OUT = 4.50         # what you pay to ship a sold card (tracked)
SHIP_IN = 4.00          # typical shipping charged by the seller when you buy
TAX = 0.0625            # sales tax on the item price when you buy (MA)
MARGIN = 0.15           # required profit on all-in cost
HOLD_MULT = 2           # expected holding period = HOLD_MULT x median days between raw sales
GAP_FALLBACK = 5        # days between raw sales assumed until the history knows better
VOL_FALLBACK = 0.03     # typical move assumed until the history knows better
STATS_WINDOW = 90       # days used for range / volatility / gap
SLOPE_WINDOW = 30       # days used for the Theil-Sen slope

NON_ENGLISH = re.compile(
    r"\b(?:Japanese|Korean|Chinese|Thai|Indonesian|German|French|Italian|Spanish|"
    r"Portuguese|Dutch|Russian|Polish)\b", re.I)


# ---------- helpers ----------
def money(v):
    v = str(v).replace("$", "").replace(",", "").strip()
    try:
        return round(float(v), 2)
    except ValueError:
        return None


def integer(v):
    v = str(v).replace(",", "").strip()
    try:
        return int(float(v))
    except ValueError:
        return None


def card_number(name):
    m = re.search(r"#(\S+)\s*$", name)
    return m.group(1) if m else ""


def number_parts(num):
    """'4' -> ('', 4, '')   'SWSH001' -> ('SWSH', 1, '')   'TG01a' -> ('TG', 1, 'a')"""
    m = re.match(r"^(\D*?)(\d+)(.*)$", num)
    if m:
        return m.group(1).upper(), int(m.group(2)), m.group(3)
    return num.upper(), 10**9, ""


# ---------- 1. Get the PriceCharting CSV ----------
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

DOWNLOAD_BASE = "https://www.pricecharting.com/price-guide/download-custom"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/128.0 Safari/537.36 pokemon-catalog/1.0"}


def tidy_url(u):
    u = u.strip().strip('"').strip("'")
    if re.fullmatch(r"[0-9a-fA-F]{40}", u):          # a bare token was pasted -> build the link
        return f"{DOWNLOAD_BASE}?t={u}&category=pokemon-cards"
    return u


def redacted(u):
    """The link with the token hidden, safe to print in a public log."""
    p = urlsplit(u)
    q = parse_qsl(p.query, keep_blank_values=True)
    tlen = next((len(v) for k, v in q if k == "t"), 0)
    shown = urlencode([(k, "TOKEN" if k == "t" else v) for k, v in q])
    return f"{urlunsplit((p.scheme, p.netloc, p.path, shown, ''))}   [token length: {tlen}]"


url = os.environ.get("PC_DOWNLOAD_URL", "").strip()
if not url and os.path.exists(URL_FILE):
    url = open(URL_FILE, encoding="utf-8").read().strip()
if url:
    url = tidy_url(url)
    print("Downloading a fresh Pokemon CSV from PriceCharting ...")
    print("Link in use:", redacted(url))
    try:
        r = requests.get(url, headers=HEADERS, timeout=300, allow_redirects=True)
    except requests.RequestException as e:
        raise SystemExit(f"Download failed: {type(e).__name__}")
    ctype = r.headers.get("Content-Type", "")
    print(f"Response: HTTP {r.status_code}, {ctype or 'no content-type'}, {len(r.content) / 1e6:.1f} MB")
    if r.status_code != 200:
        raise SystemExit("PriceCharting rejected that link. It should look like\n"
                         "  https://www.pricecharting.com/price-guide/download-custom?t=<40-char token>&category=pokemon-cards\n"
                         "Copy it from Subscriptions -> API/Download (right-click the Pokemon Cards link -> Copy Link Address). "
                         "Note: one CSV download per 10 minutes.")
    if "product-name" not in r.text[:1000]:
        raise SystemExit("That link returned a web page, not a CSV. Re-copy the Pokemon Cards "
                         "download link from Subscriptions -> API/Download.")
    with open(PC_CSV, "w", encoding="utf-8", newline="") as f:
        f.write(r.text)
    print(f"Saved to {PC_CSV}")

if not os.path.exists(PC_CSV):
    raise SystemExit(f"{PC_CSV} not found. On GitHub, add the PC_DOWNLOAD_URL secret. "
                     f"Locally, download the CSV into this folder or put your link in {URL_FILE}.")

pc = pd.read_csv(PC_CSV, dtype=str).fillna("")
need = {"id", "console-name", "product-name"}
if not need <= set(pc.columns):
    print("Columns found:", list(pc.columns))
    raise SystemExit("Unexpected CSV format - expected id, console-name, product-name.")
print(f"PriceCharting rows loaded: {len(pc):,}")


def col(name):
    return pc[name] if name in pc.columns else pd.Series([""] * len(pc), index=pc.index)


# ---------- 2. Filter ----------
if ENGLISH_ONLY:
    before = len(pc)
    pc = pc[~pc["console-name"].str.contains(NON_ENGLISH)].copy()
    print(f"English-only filter: {before - len(pc):,} non-English rows removed")

pc["card_no"] = pc["product-name"].map(card_number)
if SINGLES_ONLY:
    before = len(pc)
    pc = pc[pc["card_no"] != ""].copy()
    print(f"Singles-only filter: {before - len(pc):,} products without a card # removed")

# ---------- 3. Order: sets by release date, cards by number ----------
pc["release"] = col("release-date").str.strip()
plausible = pc["release"].between("1996-01-01", f"{date.today().year + 2}-12-31")   # ignore junk dates
set_date = pc[plausible].groupby("console-name")["release"].min()
pc["set_date"] = pc["console-name"].map(set_date).fillna("9999-12-31")

parts = pc["card_no"].map(number_parts)
pc["n_prefix"] = [p[0] for p in parts]
pc["n_num"] = [p[1] for p in parts]
pc["n_suffix"] = [p[2] for p in parts]
pc = pc.sort_values(["set_date", "console-name", "n_prefix", "n_num", "n_suffix", "product-name"],
                    kind="stable")

# ---------- 4. Build the rows ----------
today = date.today().isoformat()
n_cards = len(pc)
sets_in_order = list(dict.fromkeys(pc["console-name"].str.strip()))     # keeps release order
print(f"{n_cards:,} cards across {len(sets_in_order)} sets.")

# ---------- 5. Snapshot: every PriceCharting column, for the rows we kept ----------
helper_cols = ["card_no", "release", "set_date", "n_prefix", "n_num", "n_suffix"]
snapshot = pc.drop(columns=helper_cols).copy()
snapshot.insert(3, "card-number", pc["card_no"])            # our one added column
os.makedirs(SNAPSHOT_DIR, exist_ok=True)
raw = gzip.compress(snapshot.to_csv(index=False).encode("utf-8"))
password = os.environ.get("SITE_PASSWORD", "")
if ENCRYPT_SNAPSHOTS and password:
    # AES-256-GCM, stored as raw bytes (not base64) so GitHub's secret scanner
    # can't mistake a stretch of ciphertext for a leaked key.
    # File layout: 16-byte salt | 12-byte nonce | ciphertext
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, nonce = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000)
    blob = salt + nonce + AESGCM(key).encrypt(nonce, raw, None)
    snap = os.path.join(SNAPSHOT_DIR, f"pc_catalog_{today}.csv.gz.enc")
else:
    blob = raw
    snap = os.path.join(SNAPSHOT_DIR, f"pc_catalog_{today}.csv.gz")
with open(snap, "wb") as f:
    f.write(blob)
print(f"Snapshot archived: {snap} ({len(blob) / 1e6:.1f} MB, "
      f"{len(snapshot.columns)} columns x {len(snapshot):,} rows)")


# ---------- 6. History: one point per day, from every snapshot on disk ----------
# Old snapshots used friendlier column names; map both spellings to one.
ALIASES = {"Card ID": "id", "PC Sales Volume": "sales-volume", "PC Ungraded $": "loose-price"}
SERIES = ["sales-volume", "loose-price", "retail-loose-buy", "retail-loose-sell"]


def read_snapshot(path):
    blob = open(path, "rb").read()
    if path.endswith(".enc"):
        if not password:
            return None
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), blob[:16], 600_000)
        try:
            blob = AESGCM(key).decrypt(blob[16:28], blob[28:], None)
        except Exception:
            print(f"  skipping {os.path.basename(path)} (different password?)")
            return None
    import io
    df = pd.read_csv(io.BytesIO(gzip.decompress(blob)), dtype=str).fillna("").rename(columns=ALIASES)
    if "id" not in df.columns:
        return None
    return df


ids = pc["id"].map(integer).tolist()                       # current catalog, page order
pos = {cid: i for i, cid in enumerate(ids)}
files = sorted(glob.glob(os.path.join(SNAPSHOT_DIR, "pc_catalog_*.csv.gz*")))
dates, layers = [], []                                     # layers[k]: int32 array (4 x n_cards), -1 = missing
for path in files:
    d = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(path)).group(1)
    df = read_snapshot(path)
    if df is None:
        continue
    row = df["id"].map(integer).map(pos)
    ok = row.notna()
    idx = row[ok].astype(int).to_numpy()
    layer = np.full((4, len(ids)), -1, dtype=np.int32)
    for k, c in enumerate(SERIES):
        if c not in df.columns:
            continue
        vals = pd.to_numeric(df.loc[ok, c].map(integer if k == 0 else money), errors="coerce")
        vals = (vals * (1 if k == 0 else 100)).round().fillna(-1)     # blanks -> -1 (missing)
        layer[k, idx] = vals.to_numpy(dtype=np.int64).astype(np.int32)
    dates.append(d)
    layers.append(layer)
print(f"History: {len(dates)} day(s) of snapshots read.")

# ---------- 6b. Trend statistics per card ----------
n_cards = len(ids)
NAN = np.full(n_cards, np.nan)
st = {k: NAN.copy() for k in ["d7", "d30", "d90", "lo", "hi", "pos", "stale", "gap", "vol",
                              "vd", "vdp", "ts", "tsq1", "tsq3", "npts"]}
stale_min = np.zeros(n_cards, dtype=bool)                  # True = "no change seen yet, at least N days"
span_days = 0

if dates:
    dts = [datetime.strptime(d, "%Y-%m-%d").date() for d in dates]
    last = dts[-1]
    n_days = len(dts)
    span_days = (last - dts[0]).days
    S = np.stack(layers).astype(np.float64)                # (n_dates, 4, n_cards)
    S[S < 0] = np.nan
    V = S[:, 0, :]                                         # sales/yr
    P = S[:, 1, :] / 100.0                                 # ungraded $
    P[P <= 0] = np.nan
    L = np.log(P)
    P_now, V_now = P[-1], V[-1]

    def idx_days_ago(n):
        target = last - timedelta(days=n)
        for k in range(n_days - 1, -1, -1):
            if dts[k] <= target:
                return k
        return None

    # change over a window
    for key, n in (("d7", 7), ("d30", 30), ("d90", 90)):
        k = idx_days_ago(n)
        if k is not None:
            st[key] = (P_now / P[k] - 1) * 100
    k30 = idx_days_ago(30)
    if k30 is not None:
        st["vd"] = V_now - V[k30]
        with np.errstate(divide="ignore", invalid="ignore"):
            st["vdp"] = np.where(V[k30] > 0, st["vd"] / V[k30] * 100, np.nan)

    # 90-day range (needs at least 60 days of history to mean anything)
    win = [k for k in range(n_days) if (last - dts[k]).days < STATS_WINDOW]
    if span_days >= 60:
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore")                # cards with no price at all
            st["lo"] = np.nanmin(P[win], axis=0)
            st["hi"] = np.nanmax(P[win], axis=0)
            width = st["hi"] - st["lo"]
            st["pos"] = np.where(width > 0, (P_now - st["lo"]) / width * 100, np.nan)

    # price changes: day k counts when the price differs from the previous snapshot
    if n_days >= 2:
        both = ~np.isnan(P[1:]) & ~np.isnan(P[:-1])
        C = np.zeros_like(P, dtype=bool)
        C[1:] = both & (P[1:] != P[:-1])
        mag = np.zeros_like(P)
        mag[1:] = np.where(C[1:], np.abs(L[1:] - L[:-1]), 0.0)
        day_ago = np.array([(last - d).days for d in dts])
        last_change = np.where(C.any(axis=0), n_days - 1 - np.argmax(C[::-1], axis=0), -1)
        st["stale"] = np.where(last_change >= 0, day_ago[np.clip(last_change, 0, None)], span_days).astype(float)
        stale_min = last_change < 0
        win_mask = np.array([(last - d).days < STATS_WINDOW for d in dts])
        Cw = C & win_mask[:, None]
        n_ch = Cw.sum(axis=0)
        for c in np.flatnonzero(n_ch >= 3):                # per-card medians (only cards with >= 3 moves)
            ks = np.flatnonzero(Cw[:, c])
            st["gap"][c] = np.median(np.diff([day_ago[k] for k in ks]) * -1)
            st["vol"][c] = np.median(mag[ks, c]) * 100

    # Theil-Sen slope of log price over the last 30 days (all pairs, median)
    W = [k for k in range(n_days) if (last - dts[k]).days < SLOPE_WINDOW]
    st["npts"] = (~np.isnan(L[W])).sum(axis=0).astype(float)
    if len(W) >= 10:
        pairs_i, pairs_j = np.triu_indices(len(W), k=1)
        dd = np.array([(dts[W[j]] - dts[W[i]]).days for i, j in zip(pairs_i, pairs_j)], dtype=float)
        LW = L[W]
        ok = st["npts"] >= 10
        st["ts_day"] = np.full(n_cards, np.nan)
        if ok.any():
            with np.errstate(all="ignore"):
                slopes = (LW[pairs_j] - LW[pairs_i]) / dd[:, None]    # (n_pairs, n_cards), per day
                med = np.nanmedian(slopes[:, ok], axis=0)
                q1, q3 = np.nanpercentile(slopes[:, ok], [25, 75], axis=0)
            st["ts"][ok] = (np.exp(med * 30) - 1) * 100              # % per month
            st["tsq1"][ok] = (np.exp(q1 * 30) - 1) * 100
            st["tsq3"][ok] = (np.exp(q3 * 30) - 1) * 100
            st["ts_day"][ok] = med                                   # per-day log slope, for the gate
else:
    P_now = np.full(n_cards, np.nan)

if "ts_day" not in st:
    st["ts_day"] = NAN.copy()

# ---------- 6c. Gate: conservative sell -> net -> max buy ----------
anchor = pd.to_numeric(col("loose-price").map(money), errors="coerce").to_numpy(dtype=float)
gap_used = np.where(np.isnan(st["gap"]), GAP_FALLBACK, st["gap"])
vol_used = np.where(np.isnan(st["vol"]), VOL_FALLBACK, st["vol"] / 100)
slope_used = np.where(np.isnan(st["ts_day"]), 0.0, np.minimum(st["ts_day"], 0.0))
hold = HOLD_MULT * gap_used
drift = np.exp(slope_used * hold)
cushion = 1 - 2 * vol_used
csell = anchor * drift * cushion
net = csell * (1 - FEE_PCT) - FEE_FIXED - SHIP_OUT
maxbuy = net / (1 + MARGIN)
maxitem = (maxbuy - SHIP_IN) / (1 + TAX)
gate = {"hold": hold, "drift": drift, "cushion": cushion, "csell": csell, "net": net, "maxbuy": maxbuy,
        "maxitem": maxitem, "gap_used": gap_used, "vol_used": vol_used * 100, "slope_used": slope_used}
GATE_CONST = {"fee": FEE_PCT, "fixed": FEE_FIXED, "shipOut": SHIP_OUT, "shipIn": SHIP_IN, "tax": TAX,
              "margin": MARGIN, "holdMult": HOLD_MULT, "gapFallback": GAP_FALLBACK,
              "volFallback": VOL_FALLBACK * 100, "spanDays": span_days, "days": len(dates)}
print(f"Trend stats: {int((~np.isnan(st['d7'])).sum()):,} cards with a 7d change, "
      f"{int((~np.isnan(st['d30'])).sum()):,} with 30d, {int((~np.isnan(st['ts'])).sum()):,} with a slope.")


def clean(v, nd=2):
    return None if v is None or (isinstance(v, float) and (v != v or v in (float("inf"), float("-inf")))) else round(float(v), nd)


# ---------- 6d. History shards: series + statistics per card ----------
# One key for the history shards AND the eBay live file: derived from the site password, so
# ebay_sweep.py (which runs separately every 15 minutes) can encrypt files this page can read.
LIVE_URL = (f"https://raw.githubusercontent.com/{os.environ['GITHUB_REPOSITORY']}/live/ebay_live.bin"
            if os.environ.get("GITHUB_REPOSITORY") else os.environ.get("LIVE_URL", ""))
if dates and password:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    hist_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b"biotech-catalog-live-v1", 600_000)
    os.makedirs(HISTORY_DIR, exist_ok=True)
    for f in glob.glob(os.path.join(HISTORY_DIR, "*.bin")):
        os.remove(f)
    stack = np.stack(layers)                               # (n_dates, 4, n_cards)
    n_shards = 0
    for start in range(0, n_cards, SHARD):
        cards = {}
        for j in range(start, min(start + SHARD, n_cards)):
            stats = {k: clean(st[k][j]) for k in ("d7", "d30", "d90", "lo", "hi", "pos", "stale", "gap",
                                                    "vol", "vd", "vdp", "ts", "tsq1", "tsq3", "npts")}
            stats["staleMin"] = bool(stale_min[j])
            stats.update({k: clean(gate[k][j], 5 if k == "slope_used" else 4 if k in ("drift", "cushion") else 2) for k in gate})
            cards[str(ids[j])] = [stack[:, :, j].T.tolist(), stats]
        payload = gzip.compress(json.dumps({"d": dates, "c": cards}, separators=(",", ":")).encode("utf-8"))
        nonce = os.urandom(12)
        with open(os.path.join(HISTORY_DIR, f"s{start // SHARD}.bin"), "wb") as f:
            f.write(nonce + AESGCM(hist_key).encrypt(nonce, payload, None))
        n_shards += 1
    hist_key_hex = hist_key.hex()
    print(f"History: wrote {n_shards} shard files to {HISTORY_DIR}/")
else:
    hist_key_hex = ""
    print("History: skipped (no SITE_PASSWORD or no snapshots).")

# ---------- 7. Write the web page ----------
# Page columns (the snapshot keeps every PriceCharting column regardless, including retail buy/sell):
#   0 Card ID (link only) | 1 Card | 2 Set | 3 # | 4 Released | 5 Sales/yr | 6 Ungraded $
#   7 d7 % | 8 d30 % | 9 Range 90d % | 10 Volume drift 30d % | 11 Volume drift 30d (units, display only)
#   12 Volatility % | 13 Slope %/mo
# Columns 1-4 are the shared identity columns: the eBay tabs show the same four first.
page = pd.DataFrame({
    0: pc["id"].map(integer),
    1: pc["product-name"].str.strip(),
    2: pc["console-name"].str.strip(),
    3: pc["card_no"],
    4: pc["release"],
    5: col("sales-volume").map(integer),
    6: col("loose-price").map(money),
    7: np.round(st["d7"], 1),
    8: np.round(st["d30"], 1),
    9: np.round(st["pos"], 0),
    10: np.round(st["vdp"], 1),
    11: np.round(st["vd"], 0),
    12: np.round(st["vol"], 2),
    13: np.round(st["ts"], 1),
})
rows = page.values.tolist()
rows = [[None if (isinstance(v, float) and v != v) else v for v in r] for r in rows]  # NaN -> null
data_json = json.dumps(rows, separators=(",", ":"), ensure_ascii=False)
sets_json = json.dumps(sets_in_order, ensure_ascii=False)
gate_json = json.dumps(GATE_CONST)

# ---- printed set sizes ("36/123" -> 123) from the open Pokemon TCG dataset, matched to PriceCharting's set names.
# The page shows every card number as number/size; sets that do not match fall back to sizes the collector learns
# from eBay titles, and the bare number after that. Unmatched names are printed so aliases can be added here.
TCG_SETS_URL = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json"
SET_NAME_ALIASES = {"base set": "base", "expedition": "expedition base set", "scarlet violet 151": "151",
                    "pokemon go": "go", "team magma team aqua": "team magma vs team aqua",
                    "unleashed": "hs unleashed", "undaunted": "hs undaunted", "triumphant": "hs triumphant",
                    "fire red leaf green": "firered leafgreen"}
SERIES_PREFIXES = ("scarlet violet", "sword shield", "sun moon", "xy", "black white", "diamond pearl",
                   "heartgold soulsilver", "platinum", "ex")


def norm_set(name):
    s = str(name).lower().replace("\u00e9", "e").replace("&", " ").replace("'", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = [t for t in s.split() if t not in ("and", "the")]
    if toks and toks[0] == "pokemon":
        toks = toks[1:]
    return " ".join(toks)


def set_totals(set_names):
    try:
        r = requests.get(TCG_SETS_URL, timeout=60)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"Set sizes: could not fetch the Pokemon TCG set list ({e}); the page falls back to sizes learned from eBay titles")
        return {}
    by_norm = {}
    for st in data:
        if "promo" in st.get("name", "").lower():          # promos print SWSH001-style numbers, no size
            continue
        tot = st.get("printedTotal") or st.get("total")
        if tot:
            by_norm[norm_set(st["name"])] = int(tot)
    out, missed = {}, []
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
        if tot is None:
            missed.append(name)
        else:
            out[name] = tot
    print(f"Set sizes: {len(out)} of {len(set_names)} sets matched to the Pokemon TCG set list"
          + (f"; unmatched ({len(missed)}): {', '.join(missed)}" if missed else ""))
    return out


set_totals_json = json.dumps(set_totals(sets_in_order), ensure_ascii=False)

PAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "page")
def page_part(name):
    with open(os.path.join(PAGE_DIR, name), encoding="utf-8") as f:
        return f.read()


# The page lives in page/: style.css, body.html and app.js are read here and dropped into this shell.
html = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pokemon Card Catalog</title>
<style>
__STYLE__</style>
</head>
<body>
__BODY__<script>
__SCRIPT__</script>
</body>
</html>
"""
html = (html.replace("__STYLE__", page_part("style.css")).replace("__BODY__", page_part("body.html"))
            .replace("__SCRIPT__", page_part("app.js") + "\n" + page_part("help.js")))   # help.js: README + column help
html = (html.replace("__UPDATED__", today)
            .replace("__HKEY__", hist_key_hex)
            .replace("__LIVE_URL__", LIVE_URL)
            .replace("__GATE_EBAY__", json.dumps({"fee": FEE_PCT, "buyerTax": 0.065, "fixed": FEE_FIXED, "shipOut": SHIP_OUT,
                                                   "tax": TAX, "margin": MARGIN}))
            .replace("__SHARD__", str(SHARD))
            .replace("__HDAYS__", str(len(dates)))
            .replace("__NCARDS__", f"{n_cards:,}")
            .replace("__NSETS__", str(len(sets_in_order)))
            .replace("__GATE__", gate_json)
            .replace("__SET_TOTALS__", set_totals_json)
            .replace("__SETS__", sets_json)
            .replace("__DATA__", data_json))

os.makedirs(SITE_DIR, exist_ok=True)
with open(os.path.join(SITE_DIR, "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print(f"Wrote {SITE_DIR}/index.html ({len(html) / 1e6:.1f} MB) - "
      f"{n_cards:,} cards in {len(sets_in_order)} sets, release order.")
