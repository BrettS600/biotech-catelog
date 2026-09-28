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
  6. Re-reads every past snapshot and writes per-card price/volume history files
     (public/history/*.bin, encrypted) that power the "Trend" popup on the page

Secrets used on GitHub:  PC_DOWNLOAD_URL   SITE_PASSWORD
"""
import glob
import gzip
import hashlib
import json
import os
import re
from datetime import date

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
dates, layers = [], []                                     # layers[k]: int32 array (n_dates x n_cards), -1 = missing
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
        vals = df.loc[ok, c].map(integer if k == 0 else money)
        vals = vals.map(lambda v: -1 if v is None else int(round(v * (1 if k == 0 else 100))))
        layer[k, idx] = vals.to_numpy(dtype=np.int32)
    dates.append(d)
    layers.append(layer)
print(f"History: {len(dates)} day(s) of snapshots read.")

if dates and password:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    hist_key = os.urandom(32)
    os.makedirs(HISTORY_DIR, exist_ok=True)
    for f in glob.glob(os.path.join(HISTORY_DIR, "*.bin")):
        os.remove(f)
    stack = np.stack(layers)                               # (n_dates, 4, n_cards)
    n_shards = 0
    for start in range(0, len(ids), SHARD):
        cards = {}
        for j in range(start, min(start + SHARD, len(ids))):
            cards[str(ids[j])] = stack[:, :, j].T.tolist()  # 4 lists, one value per date
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
# Page columns (the snapshot above keeps every PriceCharting column regardless):
#   0 Card ID (link only) | 1 Card | 2 Set | 3 # | 4 Released | 5 Sales/yr
#   6 Ungraded $ (loose-price) | 7 PC retail buy $ (retail-loose-buy) | 8 PC retail sell $ (retail-loose-sell)
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
})
rows = page.values.tolist()
rows = [[None if (isinstance(v, float) and v != v) else v for v in r] for r in rows]  # NaN -> null
data_json = json.dumps(rows, separators=(",", ":"), ensure_ascii=False)
sets_json = json.dumps(sets_in_order, ensure_ascii=False)

html = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pokemon Card Catalog</title>
<style>
  :root { --bg:#fff; --fg:#111; --muted:#666; --line:#e3e3e3; --head:#f5f5f5; --hover:#f0f6ff; --link:#0b5cad; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111417; --fg:#e8e8e8; --muted:#9aa; --line:#2a2f35; --head:#1a1e23; --hover:#1c2733; --link:#7fb3ff; }
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
  .range input { font:inherit; width:88px; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  .range .to { color:var(--muted); }
  .reset { font:inherit; padding:6px 12px; border:1px solid var(--line); border-radius:6px; background:var(--head); color:var(--fg); cursor:pointer; }
  .count { color:var(--muted); font-size:13px; white-space:nowrap; }
  .wrap { overflow-x:auto; border-top:1px solid var(--line); }
  table { border-collapse:collapse; width:100%; min-width:820px; }
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
  .more { display:block; margin:14px auto 30px; padding:9px 18px; font:inherit; border:1px solid var(--line); border-radius:6px; background:var(--head); color:var(--fg); cursor:pointer; }
  footer { padding:0 18px 24px; color:var(--muted); font-size:12px; }
  .tbtn { font:inherit; font-size:12px; padding:2px 9px; border:1px solid var(--line); border-radius:12px; background:var(--head); color:var(--link); cursor:pointer; }
  .tbtn:hover { border-color:var(--link); }
  /* trend popup */
  #ov { position:fixed; inset:0; background:rgba(0,0,0,.55); display:none; align-items:center; justify-content:center; z-index:50; padding:12px; }
  #ov.open { display:flex; }
  #modal { background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:12px; width:min(1000px, 100%); max-height:96vh; overflow:auto; padding:14px 16px 16px; box-shadow:0 10px 40px rgba(0,0,0,.4); }
  #modal h2 { margin:0 0 2px; font-size:17px; }
  #modal .sub { color:var(--muted); font-size:13px; margin-bottom:8px; }
  #modal .bar { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; margin:6px 0 8px; font-size:13px; }
  #modal .bar label { display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap; }
  #modal .bar input[type=number] { font:inherit; width:64px; padding:4px 6px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  #modal .bar select { font:inherit; padding:4px 6px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  #close { float:right; font:inherit; font-size:18px; line-height:1; border:none; background:none; color:var(--muted); cursor:pointer; padding:0 4px; }
  #chart { width:100%; height:380px; display:block; touch-action:none; }
  #tip { position:absolute; pointer-events:none; background:var(--head); border:1px solid var(--line); border-radius:6px; padding:6px 9px; font-size:12px; white-space:nowrap; display:none; z-index:60; box-shadow:0 4px 14px rgba(0,0,0,.25); }
  .sw { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:middle; }
  #note { color:var(--muted); font-size:12px; margin-top:6px; }
</style>
</head>
<body>
<header>
  <h1>Pokémon Card Catalog</h1>
  <div class="meta">Updated __UPDATED__ · __NCARDS__ cards · __NSETS__ sets · prices from PriceCharting (USD)</div>
</header>
<div class="controls">
  <input type="search" id="q" placeholder="Search card or set… (e.g. charizard base)">
  <select id="set"><option value="">All sets (release order)</option></select>
  <span class="count" id="count"></span>
</div>
<div class="ranges">
  <div class="range"><span class="lbl">Sales/yr</span><input type="number" id="min5" placeholder="min" min="0"><span class="to">–</span><input type="number" id="max5" placeholder="max" min="0"></div>
  <div class="range"><span class="lbl">Ungraded $</span><input type="number" id="min6" placeholder="min" min="0" step="0.01"><span class="to">–</span><input type="number" id="max6" placeholder="max" min="0" step="0.01"></div>
  <div class="range"><span class="lbl">Retail buy $</span><input type="number" id="min7" placeholder="min" min="0" step="0.01"><span class="to">–</span><input type="number" id="max7" placeholder="max" min="0" step="0.01"></div>
  <div class="range"><span class="lbl">Retail sell $</span><input type="number" id="min8" placeholder="min" min="0" step="0.01"><span class="to">–</span><input type="number" id="max8" placeholder="max" min="0" step="0.01"></div>
  <button class="reset" id="reset">Reset filters</button>
</div>
<div class="wrap">
<table>
  <thead><tr>
    <th data-k="1">Card<span class="s">⇅</span></th>
    <th data-k="2">Set<span class="s">⇅</span></th>
    <th data-k="3">#<span class="s">⇅</span></th>
    <th data-k="4">Released<span class="s">⇅</span></th>
    <th data-k="5" class="num">Sales/yr<span class="s">⇅</span></th>
    <th data-k="6" class="num">Ungraded $<span class="s">⇅</span></th>
    <th data-k="7" class="num">PC retail buy $<span class="s">⇅</span></th>
    <th data-k="8" class="num">PC retail sell $<span class="s">⇅</span></th>
    <th>Trend</th>
  </tr></thead>
  <tbody id="rows"></tbody>
</table>
</div>
<button class="more" id="more" hidden>Show more</button>
<div id="ov">
  <div id="modal">
    <button id="close" title="Close">✕</button>
    <h2 id="mtitle"></h2>
    <div class="sub" id="msub"></div>
    <div class="bar">
      <span class="dim">Right axis:</span>
      <label><input type="checkbox" id="c-loose" checked><span class="sw" style="background:#3b82f6"></span>Ungraded $</label>
      <label><input type="checkbox" id="c-sell"><span class="sw" style="background:#22c55e"></span>Retail sell $</label>
      <label><input type="checkbox" id="c-buy"><span class="sw" style="background:#f59e0b"></span>Retail buy $</label>
      <label><input type="checkbox" id="c-vol" checked><span class="sw" style="background:#9ca3af"></span>Sales/yr (left axis)</label>
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
  </div>
</div>
<footer>Default order = set release date, then card number. Click any header to sort ascending, again for descending, a third time to reset. Range filters can be used alone (only a min, or only a max) or together; cards with no value in that column are left out while a range is set. Card names link to the PriceCharting page. "PC retail buy/sell" are PriceCharting's suggested prices for a shop buying an ungraded copy from a customer / selling one.</footer>
<script>
const DATA = __DATA__;
const SETS = __SETS__;
const PAGE = 300;
const RANGE_COLS = [5, 6, 7, 8];                       // Sales/yr, Ungraded, Retail buy, Retail sell
const setIndex = new Map(SETS.map((s, i) => [s, i]));
const ORD = DATA.length ? DATA[0].length : 0;          // index of the release-order key
DATA.forEach((r, i) => r.push(i));
const $ = id => document.getElementById(id);
const sel = $('set');
SETS.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });

let sortKey = null, sortDir = 1, view = [], shown = 0;
const dash = '<span class="dim">—</span>';
const fmtMoney = v => v == null ? dash : '$' + v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtInt = v => v == null ? dash : v.toLocaleString('en-US');
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
  if (sortKey != null) { th.classList.add('on'); th.querySelector('.s').textContent = sortDir === 1 ? '▲' : '▼'; }
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

const COLORS = {loose: '#3b82f6', sell: '#22c55e', buy: '#f59e0b', vol: '#9ca3af'};
const LABEL = {loose: 'Ungraded', sell: 'Retail sell', buy: 'Retail buy'};
let cur = null;               // {dates:[...], vol:[...], loose:[...], sell:[...], buy:[...]}
let pts = [];                 // points currently drawn (after range filter)

async function openTrend(i) {
  const r = DATA[i];
  $('mtitle').textContent = r[1];
  $('msub').textContent = r[2] + ' · #' + r[3];
  $('note').textContent = '';
  $('chart').innerHTML = '';
  $('ov').classList.add('open');
  try {
    const sh = await window.loadShard(Math.floor(i / SHARD_SIZE));
    const c = sh.c[String(r[0])];
    if (!c) throw new Error('No history for this card yet.');
    const nul = v => v < 0 ? null : v;
    cur = {dates: sh.d, vol: c[0].map(nul), loose: c[1].map(v => v < 0 ? null : v / 100),
           buy: c[2].map(v => v < 0 ? null : v / 100), sell: c[3].map(v => v < 0 ? null : v / 100)};
    drawChart();
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
  const on = {loose: $('c-loose').checked, sell: $('c-sell').checked, buy: $('c-buy').checked, vol: $('c-vol').checked};
  const W = svg.clientWidth || 900, H = 380, L = 56, R = 64, T = 18, B = 42;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const iw = W - L - R, ih = H - T - B, n = pts.length;
  const x = k => n === 1 ? L + iw / 2 : L + iw * k / (n - 1);
  const money = ['loose', 'sell', 'buy'].filter(s => on[s]);
  let pmax = 0, vmax = 0;
  pts.forEach(p => { money.forEach(s => { if (p[s] != null) pmax = Math.max(pmax, p[s]); }); if (p.vol != null) vmax = Math.max(vmax, p.vol); });
  pmax = pmax > 0 ? pmax * 1.08 : 1; vmax = vmax > 0 ? vmax * 1.15 : 1;
  const yP = v => T + ih - ih * v / pmax, yV = v => T + ih - ih * v / vmax;
  const el = (tag, at, txt) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
  const nice = m => { const s = Math.pow(10, Math.floor(Math.log10(m / 4))); const c = [1, 2, 2.5, 5, 10].find(c => c * s * 4 >= m); return c * s; };
  // grid + axes
  const mstep = nice(pmax), vstep = nice(vmax);
  for (let v = 0; v <= pmax; v += mstep) {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: 'currentColor', 'stroke-opacity': .12});
    if (money.length) el('text', {x: W - R + 6, y: yP(v) + 4, 'font-size': 11, fill: 'currentColor', opacity: .7}, '$' + (mstep < 1 ? v.toFixed(2) : v.toLocaleString('en-US')));
  }
  if (on.vol) for (let v = 0; v <= vmax; v += vstep) el('text', {x: L - 6, y: yV(v) + 4, 'font-size': 11, fill: 'currentColor', opacity: .7, 'text-anchor': 'end'}, Math.round(v).toLocaleString('en-US'));
  el('line', {x1: L, x2: W - R, y1: T + ih, y2: T + ih, stroke: 'currentColor', 'stroke-opacity': .35});
  const ticks = Math.min(n, Math.max(2, Math.floor(iw / 110)));
  for (let k = 0; k < ticks; k++) {
    const i = Math.round(k * (n - 1) / Math.max(1, ticks - 1));
    el('text', {x: x(i), y: H - 14, 'font-size': 11, fill: 'currentColor', opacity: .75, 'text-anchor': 'middle'}, pts[i].d);
  }
  el('text', {x: L - 6, y: 12, 'font-size': 10, fill: 'currentColor', opacity: .6, 'text-anchor': 'end'}, on.vol ? 'sales/yr' : '');
  el('text', {x: W - R + 6, y: 12, 'font-size': 10, fill: 'currentColor', opacity: .6}, money.length ? 'USD' : '');
  // volume bars
  if (on.vol) {
    const bw = Math.max(2, Math.min(18, iw / Math.max(1, n) * 0.6));
    pts.forEach((p, k) => { if (p.vol != null) el('rect', {x: x(k) - bw / 2, y: yV(p.vol), width: bw, height: T + ih - yV(p.vol), fill: COLORS.vol, opacity: .55}); });
  }
  // price lines
  money.forEach(s => {
    let d = '', pen = false;
    pts.forEach((p, k) => { if (p[s] == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(k) + ' ' + yP(p[s]) + ' '; pen = true; });
    el('path', {d, fill: 'none', stroke: COLORS[s], 'stroke-width': 2.2, 'stroke-linejoin': 'round'});
    if (n <= 60) pts.forEach((p, k) => { if (p[s] != null) el('circle', {cx: x(k), cy: yP(p[s]), r: 3, fill: COLORS[s]}); });
  });
  // crosshair + tooltip
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
$('rows').addEventListener('click', e => { const b = e.target.closest('.tbtn'); if (b) openTrend(+b.dataset.i); });
$('close').addEventListener('click', closeTrend);
$('ov').addEventListener('click', e => { if (e.target === $('ov')) closeTrend(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTrend(); });
['c-loose', 'c-sell', 'c-buy', 'c-vol', 'rn', 'ru'].forEach(id => $(id).addEventListener('input', drawChart));
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
            .replace("__NCARDS__", f"{n_cards:,}")
            .replace("__NSETS__", str(len(sets_in_order)))
            .replace("__SETS__", sets_json)
            .replace("__DATA__", data_json))

os.makedirs(SITE_DIR, exist_ok=True)
with open(os.path.join(SITE_DIR, "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print(f"Wrote {SITE_DIR}/index.html ({len(html) / 1e6:.1f} MB) - "
      f"{n_cards:,} cards in {len(sets_in_order)} sets, release order.")
