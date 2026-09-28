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

Secrets used on GitHub:  PC_DOWNLOAD_URL   SITE_PASSWORD
"""
import gzip
import hashlib
import json
import os
import re
from datetime import date

import pandas as pd
import requests

PC_CSV = "pricecharting.csv"
URL_FILE = "pc_download_url.txt"     # optional, local only - your personal CSV link
SITE_DIR = "site"
SNAPSHOT_DIR = "snapshots"

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

# ---------- 6. Write the web page ----------
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
  </tr></thead>
  <tbody id="rows"></tbody>
</table>
</div>
<button class="more" id="more" hidden>Show more</button>
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
      '<td class="num">' + fmtMoney(r[8]) + '</td>';
    frag.appendChild(tr);
  }
  $('rows').appendChild(frag); shown = end;
  $('more').hidden = shown >= view.length;
  $('more').textContent = 'Show more (' + (view.length - shown).toLocaleString('en-US') + ' left)';
}
document.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
  const k = +th.dataset.k;
  if (sortKey === k) { if (sortDir === 1) sortDir = -1; else { sortKey = null; sortDir = 1; } } else { sortKey = k; sortDir = 1; }
  document.querySelectorAll('th').forEach(t => { t.classList.remove('on'); t.querySelector('.s').textContent = '⇅'; });
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
apply();
</script>
</body>
</html>
"""
html = (html.replace("__UPDATED__", today)
            .replace("__NCARDS__", f"{n_cards:,}")
            .replace("__NSETS__", str(len(sets_in_order)))
            .replace("__SETS__", sets_json)
            .replace("__DATA__", data_json))

os.makedirs(SITE_DIR, exist_ok=True)
with open(os.path.join(SITE_DIR, "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print(f"Wrote {SITE_DIR}/index.html ({len(html) / 1e6:.1f} MB) - "
      f"{n_cards:,} cards in {len(sets_in_order)} sets, release order.")
