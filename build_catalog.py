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
  4. Writes site/index.html - one self-contained page with the whole table inside it
  5. Archives a dated snapshot in snapshots/ with EVERY column PriceCharting provides
     (encrypted with SITE_PASSWORD, so the repo can be public without exposing their data)
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
FEE_FIXED = 0.30        # eBay per-order fee
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
if dates and password:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    hist_key = os.urandom(32)
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
# Page columns (the snapshot keeps every PriceCharting column regardless):
#   0 Card ID (link only) | 1 Card | 2 Set | 3 # | 4 Released | 5 Sales/yr | 6 Ungraded $
#   7 PC retail buy $ | 8 PC retail sell $ | 9 d7 % | 10 d30 % | 11 Range 90d % | 12 Volatility % | 13 Slope %/mo
page = pd.DataFrame({
    0: pc["id"].map(integer),
    1: pc["product-name"].str.strip(),
    2: pc["console-name"].str.strip(),
    3: pc["card_no"],
    4: pc["release"],
    5: col("sales-volume").map(integer),
    6: col("loose-price").map(money),
    7: col("retail-loose-buy").map(money),
    8: col("retail-loose-sell").map(money),
    9: np.round(st["d7"], 1),
    10: np.round(st["d30"], 1),
    11: np.round(st["pos"], 0),
    12: np.round(st["vol"], 2),
    13: np.round(st["ts"], 1),
})
rows = page.values.tolist()
rows = [[None if (isinstance(v, float) and v != v) else v for v in r] for r in rows]  # NaN -> null
data_json = json.dumps(rows, separators=(",", ":"), ensure_ascii=False)
sets_json = json.dumps(sets_in_order, ensure_ascii=False)
gate_json = json.dumps(GATE_CONST)

html = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pokemon Card Catalog</title>
<style>
  :root { --bg:#fff; --fg:#111; --muted:#666; --line:#e3e3e3; --head:#f5f5f5; --hover:#f0f6ff; --link:#0b5cad; --up:#15803d; --down:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111417; --fg:#e8e8e8; --muted:#9aa; --line:#2a2f35; --head:#1a1e23; --hover:#1c2733; --link:#7fb3ff; --up:#4ade80; --down:#f87171; }
  }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:16px 18px 10px; }
  h1 { margin:0 0 4px; font-size:20px; }
  .meta { color:var(--muted); font-size:13px; }
  .controls { display:flex; flex-wrap:wrap; gap:8px; padding:0 18px 12px; align-items:center; }
  .controls input, .controls select { font:inherit; padding:7px 9px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  .controls input[type=search] { flex:1 1 220px; min-width:180px; }
  .controls select { max-width:320px; }
  .ranges { display:flex; flex-wrap:wrap; gap:8px 18px; padding:0 18px 12px; align-items:center; }
  .range { display:flex; align-items:center; gap:5px; }
  .range .lbl { color:var(--muted); font-size:13px; white-space:nowrap; }
  .range input { font:inherit; width:80px; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  .range .to { color:var(--muted); }
  .reset { font:inherit; padding:6px 12px; border:1px solid var(--line); border-radius:6px; background:var(--head); color:var(--fg); cursor:pointer; }
  .count { color:var(--muted); font-size:13px; white-space:nowrap; }
  .wrap { overflow-x:auto; border-top:1px solid var(--line); }
  table { border-collapse:collapse; width:100%; min-width:1240px; }
  th, td { padding:6px 10px; border-bottom:1px solid var(--line); white-space:nowrap; text-align:left; }
  th { position:sticky; top:0; background:var(--head); cursor:pointer; user-select:none; font-weight:600; }
  th .s { color:var(--muted); font-size:11px; margin-left:4px; }
  th.on .s { color:var(--fg); }
  th:hover { text-decoration:underline; }
  th.num, td.num { text-align:right; font-variant-numeric:tabular-nums; }
  tr:hover td { background:var(--hover); }
  a { color:var(--link); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .dim { color:var(--muted); }
  .up { color:var(--up); } .down { color:var(--down); }
  .more { display:block; margin:14px auto 30px; padding:9px 18px; font:inherit; border:1px solid var(--line); border-radius:6px; background:var(--head); color:var(--fg); cursor:pointer; }
  footer { padding:0 18px 24px; color:var(--muted); font-size:12px; }
  .tbtn { font:inherit; font-size:12px; padding:2px 9px; border:1px solid var(--line); border-radius:12px; background:var(--head); color:var(--link); cursor:pointer; }
  .tbtn:hover { border-color:var(--link); }
  .help { display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px; margin-left:5px; border-radius:50%; border:1px solid var(--muted); color:var(--muted); font-size:10px; font-weight:700; background:none; cursor:pointer; vertical-align:middle; padding:0; line-height:1; }
  .help:hover { border-color:var(--link); color:var(--link); }
  /* popups */
  .ov { position:fixed; inset:0; background:rgba(0,0,0,.55); display:none; align-items:center; justify-content:center; z-index:50; padding:12px; }
  .ov.open { display:flex; }
  .modal { background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:12px; width:min(1000px, 100%); max-height:96vh; overflow:auto; padding:14px 16px 16px; box-shadow:0 10px 40px rgba(0,0,0,.4); }
  .modal.narrow { width:min(640px, 100%); }
  .modal h2 { margin:0 0 2px; font-size:17px; }
  .modal .sub { color:var(--muted); font-size:13px; margin-bottom:8px; }
  .modal .bar { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; margin:6px 0 8px; font-size:13px; }
  .modal .bar label { display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap; }
  .modal .bar input[type=number] { font:inherit; width:64px; padding:4px 6px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  .modal .bar select { font:inherit; padding:4px 6px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  .close { float:right; font:inherit; font-size:18px; line-height:1; border:none; background:none; color:var(--muted); cursor:pointer; padding:0 4px; }
  #chart { width:100%; height:380px; display:block; touch-action:none; }
  #tip { position:absolute; pointer-events:none; background:var(--head); border:1px solid var(--line); border-radius:6px; padding:6px 9px; font-size:12px; white-space:nowrap; display:none; z-index:60; box-shadow:0 4px 14px rgba(0,0,0,.25); }
  .sw { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:middle; }
  #note { color:var(--muted); font-size:12px; margin-top:6px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px 14px; margin:12px 0 6px; }
  .stat { border:1px solid var(--line); border-radius:8px; padding:7px 9px; }
  .stat .k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.03em; }
  .stat .v { font-size:16px; font-variant-numeric:tabular-nums; margin-top:2px; }
  .stat .d { color:var(--muted); font-size:11px; margin-top:1px; }
  .gate { margin-top:12px; border-top:1px solid var(--line); padding-top:10px; }
  .gate h3 { font-size:14px; margin:0 0 6px; }
  .gate table { min-width:0; width:auto; font-size:13px; border-collapse:collapse; }
  .gate td { padding:3px 10px 3px 0; border:none; white-space:normal; }
  .gate td.n { text-align:right; font-variant-numeric:tabular-nums; padding-right:16px; white-space:nowrap; }
  .gate .big td { font-weight:700; font-size:15px; }
  .gate .why { color:var(--muted); font-size:12px; }
  .formula { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12.5px; background:var(--head); border:1px solid var(--line); border-radius:6px; padding:8px 10px; white-space:pre-wrap; margin:6px 0 10px; }
  .hbody p { margin:6px 0; line-height:1.5; }
  .hbody h4 { margin:12px 0 2px; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
</style>
</head>
<body>
<header>
  <h1>Pokémon Card Catalog</h1>
  <div class="meta">Updated __UPDATED__ · __NCARDS__ cards · __NSETS__ sets · prices from PriceCharting (USD) · __HDAYS__ day(s) of history</div>
</header>
<div class="controls">
  <input type="search" id="q" placeholder="Search card or set… (e.g. charizard base)">
  <select id="set"><option value="">All sets (release order)</option></select>
  <span class="count" id="count"></span>
</div>
<div class="ranges" id="ranges">
  <button class="reset" id="reset">Reset filters</button>
</div>
<div class="wrap">
<table>
  <thead><tr>
    <th data-k="1">Card<span class="s">⇅</span><button class="help" data-h="card">?</button></th>
    <th data-k="2">Set<span class="s">⇅</span><button class="help" data-h="set">?</button></th>
    <th data-k="3">#<span class="s">⇅</span><button class="help" data-h="num">?</button></th>
    <th data-k="4">Released<span class="s">⇅</span><button class="help" data-h="released">?</button></th>
    <th data-k="5" class="num">Sales/yr<span class="s">⇅</span><button class="help" data-h="sales">?</button></th>
    <th data-k="6" class="num">Ungraded $<span class="s">⇅</span><button class="help" data-h="ungraded">?</button></th>
    <th data-k="7" class="num">PC retail buy $<span class="s">⇅</span><button class="help" data-h="buy">?</button></th>
    <th data-k="8" class="num">PC retail sell $<span class="s">⇅</span><button class="help" data-h="sell">?</button></th>
    <th data-k="9" class="num">Δ7d %<span class="s">⇅</span><button class="help" data-h="d7">?</button></th>
    <th data-k="10" class="num">Δ30d %<span class="s">⇅</span><button class="help" data-h="d30">?</button></th>
    <th data-k="11" class="num">Range 90d %<span class="s">⇅</span><button class="help" data-h="pos">?</button></th>
    <th data-k="12" class="num">Volatility %<span class="s">⇅</span><button class="help" data-h="vol">?</button></th>
    <th data-k="13" class="num">Slope 30d %/mo<span class="s">⇅</span><button class="help" data-h="ts">?</button></th>
    <th>Trend<button class="help" data-h="trend">?</button></th>
  </tr></thead>
  <tbody id="rows"></tbody>
</table>
</div>
<button class="more" id="more" hidden>Show more</button>
<footer>Default order = set release date, then card number. Click any header to sort ascending, again for descending, a third time to reset; click a header's <b>?</b> for the formula and meaning. Card names link to the PriceCharting page. Trend columns show "—" until enough daily history exists (7 days for Δ7d, 30 for Δ30d and the slope, 60 for the 90-day range, 3+ price moves for volatility).</footer>

<div class="ov" id="ov">
  <div class="modal">
    <button class="close" id="close" title="Close">✕</button>
    <h2 id="mtitle"></h2>
    <div class="sub" id="msub"></div>
    <div class="bar">
      <span class="dim">Right axis:</span>
      <label><input type="checkbox" id="c-loose" checked><span class="sw" style="background:#3b82f6"></span>Ungraded $</label>
      <label><input type="checkbox" id="c-sell"><span class="sw" style="background:#22c55e"></span>Retail sell $</label>
      <label><input type="checkbox" id="c-buy"><span class="sw" style="background:#f59e0b"></span>Retail buy $</label>
      <label><input type="checkbox" id="c-vol" checked><span class="sw" style="background:#9ca3af"></span>Sales/yr (left axis)</label>
      <label><input type="checkbox" id="c-ref" checked><span class="sw" style="background:transparent;border:1px dashed #a78bfa"></span>90d high/low + conservative sell</label>
    </div>
    <div class="bar">
      <span class="dim">Show:</span>
      <label><input type="radio" name="rng" value="all" checked> All</label>
      <label><input type="radio" name="rng" value="last"> Last</label>
      <input type="number" id="rn" value="30" min="1">
      <select id="ru"><option value="1">days</option><option value="7">weeks</option><option value="30">months</option></select>
    </div>
    <div style="position:relative"><svg id="chart"></svg><div id="tip"></div></div>
    <div id="note"></div>
    <div class="stats" id="stats"></div>
    <div class="gate" id="gate"></div>
  </div>
</div>

<div class="ov" id="hov">
  <div class="modal narrow">
    <button class="close" id="hclose" title="Close">✕</button>
    <h2 id="htitle"></h2>
    <div class="hbody" id="hbody"></div>
  </div>
</div>

<script>
const DATA = __DATA__;
const SETS = __SETS__;
const GATE = __GATE__;
const PAGE = 300;
const RANGE_COLS = [5, 6, 7, 8, 9, 10, 11, 12, 13];
const RANGE_LABEL = {5: 'Sales/yr', 6: 'Ungraded $', 7: 'Retail buy $', 8: 'Retail sell $', 9: 'Δ7d %', 10: 'Δ30d %', 11: 'Range 90d %', 12: 'Volatility %', 13: 'Slope %/mo'};
const setIndex = new Map(SETS.map((s, i) => [s, i]));
const ORD = DATA.length ? DATA[0].length : 0;          // index of the release-order key
DATA.forEach((r, i) => r.push(i));
const $ = id => document.getElementById(id);
const sel = $('set');
SETS.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
// build the range-filter row
RANGE_COLS.forEach(k => {
  const div = document.createElement('div'); div.className = 'range';
  div.innerHTML = '<span class="lbl">' + RANGE_LABEL[k] + '</span><input type="number" id="min' + k + '" placeholder="min"><span class="to">–</span><input type="number" id="max' + k + '" placeholder="max">';
  $('ranges').insertBefore(div, $('reset'));
});

let sortKey = null, sortDir = 1, view = [], shown = 0;
const dash = '<span class="dim">—</span>';
const fmtMoney = v => v == null ? dash : '$' + v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtInt = v => v == null ? dash : v.toLocaleString('en-US');
const fmtPct = (v, signed = true, nd = 1) => v == null ? dash : '<span class="' + (signed ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '') + '">' + (signed && v > 0 ? '+' : '') + v.toFixed(nd) + '%</span>';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function apply() {
  const q = $('q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const set = sel.value;
  const ranges = RANGE_COLS.map(k => {
    const lo = $('min' + k).value, hi = $('max' + k).value;
    return [k, lo === '' ? null : +lo, hi === '' ? null : +hi];
  }).filter(([, lo, hi]) => lo != null || hi != null);
  view = DATA.filter(r => {
    if (set && r[2] !== set) return false;
    for (const [k, lo, hi] of ranges) {
      const v = r[k];
      if (v == null) return false;                       // no value -> can't be in the range
      if (lo != null && v < lo) return false;
      if (hi != null && v > hi) return false;
    }
    if (q.length) { const hay = (r[1] + ' ' + r[2]).toLowerCase(); if (!q.every(w => hay.includes(w))) return false; }
    return true;
  });
  if (sortKey != null) {
    const k = sortKey, d = sortDir;
    view.sort((a, b) => {
      let x = a[k], y = b[k];
      if (k === 2) { x = setIndex.get(x); y = setIndex.get(y); }
      if (x === '') x = null; if (y === '') y = null;           // blanks always sort last
      if (x == null && y == null) return a[ORD] - b[ORD];
      if (x == null) return 1; if (y == null) return -1;
      if (typeof x === 'number') return (x - y) * d || a[ORD] - b[ORD];
      return String(x).localeCompare(String(y), undefined, {numeric: true}) * d || a[ORD] - b[ORD];
    });
  }
  $('rows').innerHTML = ''; shown = 0; renderMore();
  $('count').textContent = view.length.toLocaleString('en-US') + ' of ' + DATA.length.toLocaleString('en-US') + ' cards';
}
function renderMore() {
  const frag = document.createDocumentFragment();
  const end = Math.min(shown + PAGE, view.length);
  for (let i = shown; i < end; i++) {
    const r = view[i], tr = document.createElement('tr');
    tr.innerHTML =
      '<td><a href="https://www.pricecharting.com/game/' + r[0] + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a></td>' +
      '<td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td>' + (r[4] || dash) + '</td>' +
      '<td class="num">' + fmtInt(r[5]) + '</td>' +
      '<td class="num">' + fmtMoney(r[6]) + '</td>' +
      '<td class="num">' + fmtMoney(r[7]) + '</td>' +
      '<td class="num">' + fmtMoney(r[8]) + '</td>' +
      '<td class="num">' + fmtPct(r[9]) + '</td>' +
      '<td class="num">' + fmtPct(r[10]) + '</td>' +
      '<td class="num">' + fmtPct(r[11], false, 0) + '</td>' +
      '<td class="num">' + fmtPct(r[12], false, 2) + '</td>' +
      '<td class="num">' + fmtPct(r[13]) + '</td>' +
      '<td><button class="tbtn" data-i="' + r[ORD] + '">Trend</button></td>';
    frag.appendChild(tr);
  }
  $('rows').appendChild(frag); shown = end;
  $('more').hidden = shown >= view.length;
  $('more').textContent = 'Show more (' + (view.length - shown).toLocaleString('en-US') + ' left)';
}
document.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => {
  const k = +th.dataset.k;
  if (sortKey === k) { if (sortDir === 1) sortDir = -1; else { sortKey = null; sortDir = 1; } } else { sortKey = k; sortDir = 1; }
  document.querySelectorAll('th[data-k]').forEach(t => { t.classList.remove('on'); t.querySelector('.s').textContent = '⇅'; });
  if (sortKey != null) { th.classList.add('on'); th.querySelector('.s').textContent = sortDir === 1 ? ' ▲' : ' ▼'; }
  apply();
}));
['q', ...RANGE_COLS.flatMap(k => ['min' + k, 'max' + k])].forEach(id => $(id).addEventListener('input', apply));
$('reset').addEventListener('click', () => {
  $('q').value = ''; sel.value = '';
  RANGE_COLS.forEach(k => { $('min' + k).value = ''; $('max' + k).value = ''; });
  apply();
});
sel.addEventListener('change', apply);
$('more').addEventListener('click', renderMore);

/* ---------------- Column help ---------------- */
const pct = v => (v * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
const HELP = {
  card: {t: 'Card', f: 'PriceCharting product name = card name + [variant] + #number', m: 'Each printing is its own row with its own prices: a plain card, its [Reverse Holo], [Holo], [1st Edition] or [Shadowless] version are different products. The name links to the PriceCharting page.', e: '"Spinarak #6" and "Spinarak [Ditto] #6" are the same card number in the same set, at $0.83 and $15.24 — a seller who lists only "Spinarak 6/78" may not know which one they have.'},
  set: {t: 'Set', f: 'PriceCharting console-name', m: 'The set the card was printed in, in PriceCharting\'s naming. The table and the set dropdown are ordered by each set\'s release date.', e: '"Pokemon Base Set" (1999) sorts before "Pokemon Jungle" (1999-06) before "Pokemon Evolving Skies" (2021).'},
  num: {t: '#', f: 'the number after "#" at the end of the product name', m: 'The card\'s collector number within its set — printed on the card as 4/102 or 010/078. Set + number + variant uniquely identify a card. Kept as text because modern sets use prefixes (TG01, SV001, GG05).', e: 'Base Set #4 is Charizard; Jungle #4 is Kangaskhan. Same number, different cards.'},
  released: {t: 'Released', f: 'PriceCharting release-date', m: 'The card\'s original release date. Cards without one show "—" and their set is ordered by the earliest dated card in it.', e: '1999-01-09 for Base Set; 2022-07-01 for Pokémon Go.'},
  sales: {t: 'Sales/yr', f: 'PriceCharting sales-volume = units sold in the trailing 12 months, ALL grades combined', m: 'A liquidity measure — but it counts raw and graded sales together. For cheap modern cards almost nothing is graded, so it ≈ raw sales. For vintage cards graded sales can be most of it, so it overstates how often a raw copy sells. Use the Trend popup\'s "raw sale every N days" for the raw-only view.', e: 'Ivysaur #2 (1998 KFC): 45/yr in this column, but PriceCharting\'s page shows ungraded ≈ 12/yr, Grade 8 ≈ 12, PSA 10 ≈ 12, Grade 7 = 6, Grade 9 = 3. 12+6+12+3+12 ≈ 45.'},
  ungraded: {t: 'Ungraded $', f: 'PriceCharting loose-price', m: 'The market price of an ungraded copy — a trailing average of recent raw sales (mostly eBay). This is the anchor: every other number is measured against it. It only moves when new raw sales land, so a slow card\'s price can sit unchanged for weeks. It blends all conditions; a near-mint copy sells closer to the Grade 7–8 price.', e: 'If the anchor is $42.00 and a listing is $27.99 + $4 shipping, the listing is 76% of anchor before tax — then fees, shipping out and drift decide whether that is a deal (see Trend popup).'},
  buy: {t: 'PC retail buy $', f: 'PriceCharting retail-loose-buy (their formula off the ungraded price)', m: 'What PriceCharting suggests a card shop pay a walk-in customer for an ungraded copy. Not a market observation — a rule applied to the anchor with a shop\'s margin built in. Useful as a "never pay above this" ceiling.', e: 'Ivysaur #2: anchor $25.94, retail buy $8.70 — PriceCharting thinks a shop should pay about a third of value.'},
  sell: {t: 'PC retail sell $', f: 'PriceCharting retail-loose-sell (their formula off the ungraded price)', m: 'What PriceCharting suggests a card shop charge on the shelf for an ungraded copy. Roughly the top of the realistic listing range; listing above it means waiting. The gap between retail buy and sell is a shop\'s margin, which includes rent and staff you don\'t have.', e: 'Ivysaur #2: anchor $25.94, retail sell $28.99 — about 12% above market.'},
  d7: {t: 'Δ7d %', f: '(P_today − P_7_days_ago) / P_7_days_ago × 100', m: '"Did something just happen." On a slow card this is usually one sale landing, so pair it with a Sales/yr floor before trusting it. Sort descending for cards that just jumped (sell candidates), ascending for cards that just dropped.', e: '$42.00 today, $42.50 a week ago → (42.00 − 42.50) / 42.50 = −1.2%.'},
  d30: {t: 'Δ30d %', f: '(P_today − P_30_days_ago) / P_30_days_ago × 100', m: 'The core trend number and the one to sort by. Read it with Δ7d and the slope: 30d down but 7d flat and the slope flattening is a card that may be settling; all of them down is a card still falling. A drop is either mispricing (opportunity) or news (a reprint, a rotation) — the number cannot tell which.', e: '$42.00 today, $48.00 thirty days ago → (42.00 − 48.00) / 48.00 = −12.5%.'},
  pos: {t: 'Range 90d %', f: '(P_today − Low_90d) / (High_90d − Low_90d) × 100', m: 'Where today\'s price sits between its 90-day low (0%) and high (100%). Two cards can both be −12% over 30 days: one falling back from a spike (still at 85% of its range) and one making new lows (5%). Different bets. Ignore it when the range is tiny, and remember a low position during a steady decline is a falling knife — it is only a signal once the 30-day trend has flattened. Needs 60 days of history.', e: 'Low $38.00, high $52.00, today $42.00 → (42 − 38) / (52 − 38) = 4 / 14 = 29%.'},
  vol: {t: 'Volatility %', f: 'median of |ln(P_t / P_t−1)| over the days the price moved in the last 90 days', m: 'The typical size of a move when the price moves. The median ignores a single wild day, which a standard deviation would not. It sizes the safety cushion in the buy gate: a card that moves 2% at a time can be bought at a thinner discount than one that moves 12%. Needs at least 3 moves.', e: 'Moves of 3.82%, 3.75%, 1.78%, 4.98%, 1.40%, 1.18% → sorted 1.18, 1.40, 1.78, 3.75, 3.82, 4.98 → median = (1.78 + 3.75) / 2 = 2.77%.'},
  ts: {t: 'Slope 30d %/mo (Theil–Sen)', f: 'median over every pair of days (i, j) in the last 30 days of (ln P_j − ln P_i) / (j − i), then converted to % per month: (e^(slope × 30) − 1) × 100', m: 'The robust trend: the median of all pairwise slopes, so one spike day barely moves it, unlike a fitted line. It is the drift used in the buy gate (only negative drift counts against the sell price). Δ30d uses two endpoints; this uses all 465 pairs, so it is the steadier version of the same idea. Needs 10 points in the window.', e: '31 daily prices sliding from $48 to $42 → median pairwise slope −0.00413 per day → e^(−0.00413 × 30) − 1 = −11.7% per month. A plain regression gave −0.44%/day here; add one spike day and the two diverge.'},
  trend: {t: 'Trend', f: 'one point per day from the site\'s own snapshots', m: 'Opens the card\'s daily history: sales/yr bars on the left axis, ungraded / retail buy / retail sell on the right, dashed lines for the 90-day high and low and the conservative sell estimate, a hover crosshair, all the statistics, and the buy-gate arithmetic for this card. The history starts the day the site went live and grows by one point each morning.', e: ''}
};
function openHelp(key) {
  const h = HELP[key]; if (!h) return;
  $('htitle').textContent = h.t;
  $('hbody').innerHTML = '<h4>Formula</h4><div class="formula">' + esc(h.f) + '</div><h4>What it means</h4><p>' + esc(h.m) + '</p>' + (h.e ? '<h4>Example</h4><p>' + esc(h.e) + '</p>' : '');
  $('hov').classList.add('open');
}
document.querySelectorAll('.help').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openHelp(b.dataset.h); }));
$('hclose').addEventListener('click', () => $('hov').classList.remove('open'));
$('hov').addEventListener('click', e => { if (e.target === $('hov')) $('hov').classList.remove('open'); });

/* ---------------- Trend popup ---------------- */
const HKEY = '__HKEY__', SHARD_SIZE = __SHARD__;
const shardCache = new Map();
const hex2bytes = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
window.loadShard = async function (n) {
  if (shardCache.has(n)) return shardCache.get(n);
  if (!HKEY) throw new Error('No history has been built yet.');
  const res = await fetch('history/s' + n + '.bin', {cache: 'no-store'});
  if (!res.ok) throw new Error('No history file for this card yet.');
  const buf = new Uint8Array(await res.arrayBuffer());
  const key = await crypto.subtle.importKey('raw', hex2bytes(HKEY), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: buf.slice(0, 12)}, key, buf.slice(12));
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const data = JSON.parse(text);
  shardCache.set(n, data);
  return data;
};

const COLORS = {loose: '#3b82f6', sell: '#22c55e', buy: '#f59e0b', vol: '#9ca3af', ref: '#a78bfa'};
const LABEL = {loose: 'Ungraded', sell: 'Retail sell', buy: 'Retail buy'};
let cur = null;               // {dates, vol, loose, sell, buy, st, anchor}
let pts = [];

async function openTrend(i) {
  const r = DATA[i];
  $('mtitle').textContent = r[1];
  $('msub').textContent = r[2] + ' · #' + r[3] + (r[4] ? ' · released ' + r[4] : '');
  $('note').textContent = ''; $('stats').innerHTML = ''; $('gate').innerHTML = '';
  $('chart').innerHTML = '';
  $('ov').classList.add('open');
  try {
    const sh = await window.loadShard(Math.floor(i / SHARD_SIZE));
    const c = sh.c[String(r[0])];
    if (!c) throw new Error('No history for this card yet.');
    const nul = v => v < 0 ? null : v, cents = v => v < 0 ? null : v / 100;
    cur = {dates: sh.d, vol: c[0][0].map(nul), loose: c[0][1].map(cents), buy: c[0][2].map(cents), sell: c[0][3].map(cents), st: c[1], anchor: r[6]};
    drawChart(); renderStats();
  } catch (e) {
    cur = null;
    $('note').textContent = e.message + ' The site adds one point per card every morning.';
  }
}
function closeTrend() { $('ov').classList.remove('open'); $('tip').style.display = 'none'; }

function rangePoints() {
  const all = cur.dates.map((d, k) => ({d, t: Date.parse(d + 'T00:00:00Z'), vol: cur.vol[k], loose: cur.loose[k], sell: cur.sell[k], buy: cur.buy[k]}));
  if (document.querySelector('input[name=rng]:checked').value === 'all') return all;
  const n = Math.max(1, +$('rn').value || 1), unit = +$('ru').value;
  const cutoff = all[all.length - 1].t - (n * unit - 1) * 86400000;     // "last 30 days" = 30 points
  return all.filter(p => p.t >= cutoff);
}

function drawChart() {
  const svg = $('chart');
  svg.innerHTML = '';
  if (!cur) return;
  pts = rangePoints();
  const on = {loose: $('c-loose').checked, sell: $('c-sell').checked, buy: $('c-buy').checked, vol: $('c-vol').checked, ref: $('c-ref').checked};
  const W = svg.clientWidth || 900, H = 380, L = 56, R = 64, T = 18, B = 42;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const iw = W - L - R, ih = H - T - B, n = pts.length;
  const x = k => n === 1 ? L + iw / 2 : L + iw * k / (n - 1);
  const money = ['loose', 'sell', 'buy'].filter(s => on[s]);
  const refs = on.ref ? [['90d high', cur.st.hi], ['90d low', cur.st.lo], ['conservative sell', cur.st.csell]].filter(([, v]) => v != null) : [];
  let pmax = 0, vmax = 0;
  pts.forEach(p => { money.forEach(s => { if (p[s] != null) pmax = Math.max(pmax, p[s]); }); if (p.vol != null) vmax = Math.max(vmax, p.vol); });
  refs.forEach(([, v]) => pmax = Math.max(pmax, v));
  pmax = pmax > 0 ? pmax * 1.08 : 1; vmax = vmax > 0 ? vmax * 1.15 : 1;
  const yP = v => T + ih - ih * v / pmax, yV = v => T + ih - ih * v / vmax;
  const el = (tag, at, txt) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
  const nice = m => { const s = Math.pow(10, Math.floor(Math.log10(m / 4))); const c = [1, 2, 2.5, 5, 10].find(c => c * s * 4 >= m); return c * s; };
  const mstep = nice(pmax), vstep = nice(vmax);
  for (let v = 0; v <= pmax; v += mstep) {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: 'currentColor', 'stroke-opacity': .12});
    if (money.length || refs.length) el('text', {x: W - R + 6, y: yP(v) + 4, 'font-size': 11, fill: 'currentColor', opacity: .7}, '$' + (mstep < 1 ? v.toFixed(2) : v.toLocaleString('en-US')));
  }
  if (on.vol) for (let v = 0; v <= vmax; v += vstep) el('text', {x: L - 6, y: yV(v) + 4, 'font-size': 11, fill: 'currentColor', opacity: .7, 'text-anchor': 'end'}, Math.round(v).toLocaleString('en-US'));
  el('line', {x1: L, x2: W - R, y1: T + ih, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .35});
  const ticks = Math.min(n, Math.max(2, Math.floor(iw / 110)));
  for (let k = 0; k < ticks; k++) {
    const i = Math.round(k * (n - 1) / Math.max(1, ticks - 1));
    el('text', {x: x(i), y: H - 14, 'font-size': 11, fill: 'currentColor', opacity: .75, 'text-anchor': 'middle'}, pts[i].d);
  }
  el('text', {x: L - 6, y: 12, 'font-size': 10, fill: 'currentColor', opacity: .6, 'text-anchor': 'end'}, on.vol ? 'sales/yr' : '');
  el('text', {x: W - R + 6, y: 12, 'font-size': 10, fill: 'currentColor', opacity: .6}, (money.length || refs.length) ? 'USD' : '');
  if (on.vol) {
    const bw = Math.max(2, Math.min(18, iw / Math.max(1, n) * 0.6));
    pts.forEach((p, k) => { if (p.vol != null) el('rect', {x: x(k) - bw / 2, y: yV(p.vol), width: bw, height: T + ih - yV(p.vol), fill: COLORS.vol, opacity: .55}); });
  }
  refs.forEach(([name, v]) => {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: COLORS.ref, 'stroke-width': 1.3, 'stroke-dasharray': '6 4', opacity: .9});
    el('text', {x: L + 4, y: yP(v) - 3, 'font-size': 10, fill: COLORS.ref}, name + ' ' + fmtMoneyPlain(v));
  });
  money.forEach(s => {
    let d = '', pen = false;
    pts.forEach((p, k) => { if (p[s] == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(k) + ' ' + yP(p[s]) + ' '; pen = true; });
    el('path', {d, fill: 'none', stroke: COLORS[s], 'stroke-width': 2.2, 'stroke-linejoin': 'round'});
    if (n <= 60) pts.forEach((p, k) => { if (p[s] != null) el('circle', {cx: x(k), cy: yP(p[s]), r: 3, fill: COLORS[s]}); });
  });
  const cross = el('line', {x1: 0, x2: 0, y1: T, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .5, 'stroke-dasharray': '4 3', visibility: 'hidden'});
  const hit = el('rect', {x: L, y: T, width: iw, height: ih, fill: 'transparent'});
  const tip = $('tip');
  const move = ev => {
    const box = svg.getBoundingClientRect();
    const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - box.left;
    const px = cx * W / box.width;
    const k = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - L) / iw * (n - 1))));
    const p = pts[k];
    cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.setAttribute('visibility', 'visible');
    let h = '<b>' + p.d + '</b>';
    if (on.vol) h += '<br><span class="sw" style="background:' + COLORS.vol + '"></span>Sales/yr: ' + (p.vol == null ? '—' : p.vol.toLocaleString('en-US'));
    money.forEach(s => { h += '<br><span class="sw" style="background:' + COLORS[s] + '"></span>' + LABEL[s] + ': ' + fmtMoney(p[s]); });
    tip.innerHTML = h;
    const left = x(k) * box.width / W;
    tip.style.display = 'block';
    tip.style.left = (left + 12 + tip.offsetWidth > box.width ? left - tip.offsetWidth - 12 : left + 12) + 'px';
    tip.style.top = Math.max(0, ((ev.touches ? ev.touches[0].clientY : ev.clientY) - box.top - 28)) + 'px';
  };
  hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', ev => { move(ev); ev.preventDefault(); }, {passive: false}); hit.addEventListener('touchstart', move, {passive: true});
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  $('note').textContent = n === 1 ? '1 day of history so far — a new point is added every morning.' : n + ' days shown' + (on.vol ? ' · sales/yr is PriceCharting\u2019s trailing twelve-month count on that day' : '');
}
const fmtMoneyPlain = v => v == null ? '—' : '$' + v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pctPlain = (v, nd = 1, signed = true) => v == null ? '—' : (signed && v > 0 ? '+' : '') + v.toFixed(nd) + '%';

function renderStats() {
  const s = cur.st, A = cur.anchor;
  const cell = (k, v, d) => '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  let h = '';
  h += cell('Δ 7d', fmtPct(s.d7), 'vs 7 days ago');
  h += cell('Δ 30d', fmtPct(s.d30), 'vs 30 days ago');
  h += cell('Δ 90d', fmtPct(s.d90), 'vs 90 days ago');
  h += cell('Range 90d', pctPlain(s.pos, 0, false), s.lo != null ? 'low ' + fmtMoneyPlain(s.lo) + ' · high ' + fmtMoneyPlain(s.hi) : 'needs 60 days');
  h += cell('Stale', s.stale == null ? '—' : (s.staleMin ? '≥ ' : '') + s.stale + ' d', s.staleMin ? 'no raw price move seen yet' : 'days since the raw price moved');
  h += cell('Raw sale every', s.gap == null ? '—' : s.gap + ' d', 'median gap between price moves (90d)');
  h += cell('Volatility', pctPlain(s.vol, 2, false), 'typical move when it moves');
  h += cell('Volume drift 30d', s.vd == null ? '—' : (s.vd > 0 ? '+' : '') + s.vd + ' (' + pctPlain(s.vdp) + ')', 'last 30 days vs same 30 days a year ago');
  h += cell('Slope 30d', pctPlain(s.ts), s.ts != null ? 'Theil–Sen · middle half ' + pctPlain(s.tsq1) + ' to ' + pctPlain(s.tsq3) + ' /mo' : 'needs 10 points');
  $('stats').innerHTML = h;

  // gate math
  if (A == null || s.csell == null) { $('gate').innerHTML = '<h3>Buy gate</h3><p class="why">No ungraded price for this card, so there is nothing to anchor to.</p>'; return; }
  const assumed = [];
  if (s.gap == null) assumed.push('days between raw sales = ' + GATE.gapFallback + ' (no history yet)');
  if (s.vol == null) assumed.push('volatility = ' + GATE.volFallback + '% (no history yet)');
  if (s.ts == null) assumed.push('slope = 0 (no history yet)');
  const row = (label, val, why, big) => '<tr' + (big ? ' class="big"' : '') + '><td>' + label + '</td><td class="n">' + val + '</td><td class="why">' + (why || '') + '</td></tr>';
  let g = '<h3>Buy gate for this card</h3><table>';
  g += row('Anchor (ungraded)', fmtMoneyPlain(A), 'PriceCharting ungraded price today');
  g += row('Expected hold', s.hold.toFixed(0) + ' days', GATE.holdMult + ' × ' + s.gap_used + ' days between raw sales');
  g += row('Drift over the hold', '× ' + s.drift.toFixed(4), 'e^(slope × days), slope ' + (s.slope_used * 100).toFixed(3) + '%/day — only a falling trend counts');
  g += row('Volatility cushion', '× ' + s.cushion.toFixed(4), '1 − 2 × ' + s.vol_used.toFixed(2) + '% (two typical moves against you)');
  g += row('Conservative sell', fmtMoneyPlain(s.csell), fmtMoneyPlain(A) + ' × ' + s.drift.toFixed(4) + ' × ' + s.cushion.toFixed(4), true);
  g += row('eBay fee', '− ' + fmtMoneyPlain(s.csell * GATE.fee + GATE.fixed), pct(GATE.fee) + ' + $' + GATE.fixed.toFixed(2));
  g += row('Shipping out', '− ' + fmtMoneyPlain(GATE.shipOut), 'tracked');
  g += row('Net proceeds', fmtMoneyPlain(s.net), '', true);
  g += row('Max buy, all-in', fmtMoneyPlain(s.maxbuy), 'net ÷ (1 + ' + pct(GATE.margin) + ' margin) — item + shipping + tax must be at or below this', true);
  g += row('≈ max item price', s.maxitem > 0 ? fmtMoneyPlain(s.maxitem) : '—', 'if the seller charges $' + GATE.shipIn.toFixed(2) + ' shipping and tax is ' + pct(GATE.tax));
  g += '</table>';
  if (s.maxitem != null && s.maxitem <= 0) g += '<p class="why">Fees, shipping and tax eat everything this card can net at your margin — there is no listing price that makes it a trade. This is why cheap cards rarely pass.</p>';
  if (assumed.length) g += '<p class="why">Assumed until the history fills in: ' + assumed.join('; ') + '.</p>';
  $('gate').innerHTML = g;
}
$('rows').addEventListener('click', e => { const b = e.target.closest('.tbtn'); if (b) openTrend(+b.dataset.i); });
$('close').addEventListener('click', closeTrend);
$('ov').addEventListener('click', e => { if (e.target === $('ov')) closeTrend(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeTrend(); $('hov').classList.remove('open'); } });
['c-loose', 'c-sell', 'c-buy', 'c-vol', 'c-ref', 'rn', 'ru'].forEach(id => $(id).addEventListener('input', drawChart));
document.querySelectorAll('input[name=rng]').forEach(r => r.addEventListener('change', drawChart));
window.addEventListener('resize', () => { if ($('ov').classList.contains('open')) drawChart(); });
apply();
</script>
</body>
</html>
"""
html = (html.replace("__UPDATED__", today)
            .replace("__HKEY__", hist_key_hex)
            .replace("__SHARD__", str(SHARD))
            .replace("__HDAYS__", str(len(dates)))
            .replace("__NCARDS__", f"{n_cards:,}")
            .replace("__NSETS__", str(len(sets_in_order)))
            .replace("__GATE__", gate_json)
            .replace("__SETS__", sets_json)
            .replace("__DATA__", data_json))

os.makedirs(SITE_DIR, exist_ok=True)
with open(os.path.join(SITE_DIR, "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print(f"Wrote {SITE_DIR}/index.html ({len(html) / 1e6:.1f} MB) - "
      f"{n_cards:,} cards in {len(sets_in_order)} sets, release order.")
