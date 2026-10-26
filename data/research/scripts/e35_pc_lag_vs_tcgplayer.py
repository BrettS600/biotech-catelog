"""E35 - Does PriceCharting's monthly market move lag the TCGplayer-based PokeViews indexes? (E33c found PriceCharting's
daily price trailing eBay's sold medians by weeks for hot cards in October 2026.) Month-end PV100 / PV250 (TCGplayer
market prices, daily, 2024-04..) and PokeViews' raw era indexes (PriceCharting-based, month starts) vs the PC panel's
market median move (E01) at leads/lags -2..+2. A lag would mean part of PriceCharting's 'reversal' is catch-up to a
market that already moved - not something a buyer on eBay can collect.
"""
import os, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
OUT = os.path.join(DATA, 'research', 'results')
mk = pd.read_csv(os.path.join(OUT, 'E01_market_monthly.csv')).set_index('month')['median_mom1']
rows = []
for f, col in (('top100_index.csv', 'index_value'), ('top250_index.csv', 'index_value')):
    d = pd.read_csv(os.path.join(DATA, 'pokeviews', f), parse_dates=['date']).set_index('date')[col].astype(float)
    me = d.resample('ME').last(); r = me.pct_change(); r.index = r.index.strftime('%Y-%m')
    # monthly AVERAGE level (what PriceCharting's month resembles) as a second comparison
    ma = d.resample('ME').mean(); ra = ma.pct_change(); ra.index = ra.index.strftime('%Y-%m')
    for name, s in (('month_end', r), ('month_avg', ra)):
        df = pd.DataFrame({'pv': s, 'pc': mk}).dropna()
        for k in (-2, -1, 0, 1, 2):
            # k > 0: PV leads PC by k months (corr of PV_m with PC_{m+k})
            x = pd.DataFrame({'pv': df.pv, 'pc': df.pc.shift(-k)}).dropna()
            rows.append({'tcg_index': f.split('_')[0], 'pv_month_measure': name, 'k_pv_leads_pc_by': k, 'months': len(x),
                         'spearman': x.pv.corr(x.pc, method='spearman'), 'pearson': x.pv.corr(x.pc)})
r = pd.DataFrame(rows); r.to_csv(os.path.join(OUT, 'E35_pc_lag_vs_tcgplayer.csv'), index=False, float_format='%.4f')
print(r.round(3).to_string(index=False))
