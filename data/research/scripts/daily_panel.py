"""Loader for data/pricecharting/daily/ (every column of PriceCharting's daily download, 2026-09-28 on).

    from daily_panel import load_daily
    D = load_daily()     # {column: DataFrame [card_id x date]} for the 18 numeric columns, plus D['ids'] (identity frame)

A month = its full_<date> file + its changes_<date> files applied in date order (see data/README.md, pc_day()).
"""
import os, glob, re
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
FOLDER = os.path.join(DATA, 'pricecharting', 'daily')
NUM = ["loose-price", "cib-price", "new-price", "graded-price", "box-only-price", "manual-only-price", "bgs-10-price",
       "condition-17-price", "condition-18-price", "retail-loose-buy", "retail-loose-sell", "retail-cib-buy",
       "retail-cib-sell", "retail-new-buy", "retail-new-sell", "gamestop-price", "gamestop-trade-price", "sales-volume"]
_day = lambda f: re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(f)).group(1)


def load_daily(folder=FOLDER):
    files = sorted(glob.glob(os.path.join(folder, '*.csv.gz')), key=lambda f: (_day(f), 0 if 'full_' in f else 1))
    cur, snaps, ids = None, {}, None
    for f in files:
        d = _day(f)
        if os.path.basename(f).startswith('full_'):
            t = pd.read_csv(f, dtype={'tcg-id': str}, low_memory=False)
            ids = t.drop(columns=[c for c in NUM if c in t.columns] + ['date'])
            cur = t.set_index('id')[NUM].copy()
        else:
            c = pd.read_csv(f).set_index('card_id')
            gone = c.index[c['status'] == 'removed']
            upd = c[c['status'] != 'removed'][NUM]
            cur = pd.concat([cur.drop(gone.union(upd.index), errors='ignore'), upd])
        snaps[d] = cur.copy()
    dates = sorted(snaps)
    out = {col: pd.DataFrame({d: snaps[d][col] for d in dates}) for col in NUM}
    out['ids'] = ids.set_index('id')
    out['dates'] = dates
    return out
