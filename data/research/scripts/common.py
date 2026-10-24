"""Shared loader for the research scripts in data/research/scripts.

Reads ONLY from the data/ folder of the repo (pass its path, default ../../ relative to this file),
so any model (Claude, ChatGPT, Opus, a human) can rerun every experiment from the committed data.

    from common import load_panel
    P = load_panel()          # dict with numpy arrays, see below

P['price']  float32 [n_cards, n_months]  PriceCharting ungraded price in USD (NaN = no history that month)
P['sales']  float32 [n_cards, n_months]  PriceCharting sales count that month (NaN = unknown)
P['months'] list of 'YYYY-MM' for the columns (2020-12 .. last month in the files)
P['mi']     int months-since-2000-01 for each column
P['cards']  pandas DataFrame, one row per panel row: card_id, name, set, number, rarity, finish,
            release_date, rel_mi (release month index), price_now, sales_year
Caches the arrays in <cache_dir>/panel.npz (rebuilt when missing).

Fee model (eBay, Brett's actual round trip, same constants as the site):
    net_sale(price) = price * (1 - 0.1325 * 1.065) - 0.40 - 4.50 - 0.30  = price * 0.8589 - 5.20
"""
import os, glob, json, gzip
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
CACHE = os.environ.get('RESEARCH_CACHE', os.path.join(DATA, '..', '.research_cache'))

FEE_RATE = 0.1325 * 1.065      # final value fee incl. sales tax on the fee
FIXED = 0.40 + 4.50 + 0.30     # per-order fee + outbound shipping + supplies
KEEP = 1 - FEE_RATE            # 0.8589


def net_sale(price):
    """Cash kept after selling one copy on eBay at `price` (buyer pays shipping)."""
    return price * KEEP - FIXED


def net_return(buy, sell):
    """Net return on one copy bought at `buy` (no buy-side fees; cost = price) and sold at `sell`."""
    return (net_sale(sell) - buy) / buy


def breakeven_gross(buy):
    """Gross price move needed to break even: sell such that net_sale(sell) == buy."""
    return ((buy + FIXED) / KEEP) / buy - 1


def mi_of(s):
    y, m = s.split('-')[:2]
    return (int(y) - 2000) * 12 + int(m) - 1


def ym_of(mi):
    return '%04d-%02d' % (2000 + mi // 12, mi % 12 + 1)


def load_panel(data=DATA, cache=CACHE):
    os.makedirs(cache, exist_ok=True)
    npz = os.path.join(cache, 'panel.npz')
    cards_path = os.path.join(data, 'pricecharting', 'cards.csv.gz')
    cards = pd.read_csv(cards_path, dtype={'number': str})
    if os.path.exists(npz):
        z = np.load(npz, allow_pickle=True)
        ids = z['ids']
        cards = cards.set_index('card_id').reindex(ids).reset_index()
        return dict(price=z['price'], sales=z['sales'], months=list(z['months']), mi=z['mi'], ids=ids, cards=_cards(cards))
    files = sorted(glob.glob(os.path.join(data, 'pricecharting', 'pc_monthly_*.csv.gz')))
    df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    df['mi'] = df['month'].map(mi_of)
    mis = np.arange(df['mi'].min(), df['mi'].max() + 1)
    ids = np.sort(df['card_id'].unique())
    ri = pd.Series(np.arange(len(ids)), index=ids)
    r = ri[df['card_id'].values].values
    c = (df['mi'].values - mis[0])
    price = np.full((len(ids), len(mis)), np.nan, dtype=np.float32)
    sales = np.full((len(ids), len(mis)), np.nan, dtype=np.float32)
    price[r, c] = df['price'].values
    sales[r, c] = df['sales'].values
    months = np.array([ym_of(m) for m in mis])
    np.savez_compressed(npz, price=price, sales=sales, months=months, mi=mis, ids=ids)
    cards = cards.set_index('card_id').reindex(ids).reset_index()
    return dict(price=price, sales=sales, months=list(months), mi=mis, ids=ids, cards=_cards(cards))


def _cards(cards):
    rd = pd.to_datetime(cards['release_date'], errors='coerce')
    cards['rel_mi'] = ((rd.dt.year - 2000) * 12 + rd.dt.month - 1).astype('float')
    return cards


def load_pokeviews(data=DATA):
    """The PokeViews market feeds as daily DataFrames keyed by date (pandas Timestamp)."""
    pv = os.path.join(data, 'pokeviews')
    out = {}
    for name in ['top100_index', 'top250_index', 'hot_cold_index', 'market_momentum', 'new_highs_lows', 'trend_extension', 'pokemon_vs_assets', 'era_performance']:
        f = os.path.join(pv, name + '.csv')
        if os.path.exists(f):
            d = pd.read_csv(f)
            d['date'] = pd.to_datetime(d['date'])
            out[name] = d.set_index('date').sort_index()
    for name in ['series_performance', 'set_performance']:
        f = os.path.join(pv, name + '.csv.gz')
        if os.path.exists(f):
            d = pd.read_csv(f)
            d['date'] = pd.to_datetime(d['date'])
            out[name] = d
    return out


def load_trends(data=DATA):
    """Google Trends 'pokemon cards' monthly interest (0-100 per source), indexed by month 'YYYY-MM'."""
    f = os.path.join(data, 'google_trends', 'pokemon_cards_interest.csv')
    d = pd.read_csv(f)
    return d.set_index('month')


def monthly_from_daily(series, how='last'):
    """Daily series -> value per 'YYYY-MM' (last trading day of the month by default)."""
    s = series.dropna()
    g = s.groupby(s.index.strftime('%Y-%m'))
    return g.last() if how == 'last' else g.mean()
