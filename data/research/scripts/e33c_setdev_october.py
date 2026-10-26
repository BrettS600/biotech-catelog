"""E33c - The relative reversal (setdev, as of September 2026) in the one out-of-sample window we hold at daily
resolution: PriceCharting's raw price 09-28 -> 10-26 (daily download) and eBay's own sold prices (rollup medians
early 09-28..10-08 vs late 10-13..10-23, >= 2 sales each). Band $50-500 for the PC test; eBay cards as available.
Spearman IC and quintiles, with dev12 alongside.
"""
import os, sys, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
ns = {'__file__': os.path.join(HERE, 'e33_new_reversal_variants.py')}
exec(compile(open(os.path.join(HERE, 'e33_new_reversal_variants.py')).read().split("direction = {")[0], 'e33', 'exec'), ns)
from daily_panel import load_daily, DATA
OUT = os.path.join(DATA, 'research', 'results')
S, P = ns['S'], ns['P']; months = list(P['months']); j = months.index('2026-09')
ids = P['cards']['card_id'].to_numpy()
sig = pd.DataFrame({'setdev': S['setdev'][:, j], 'dev12': S['dev12'][:, j], 'peerdev': S['peerdev'][:, j], 'age': ns['age'][:, j]}, index=ids)
D = load_daily(); d0, d1 = D['dates'][0], D['dates'][-1]
pc = pd.DataFrame({'r0': D['loose-price'][d0], 'y': D['loose-price'][d1] / D['loose-price'][d0] - 1}).join(sig, how='inner').dropna(subset=['y', 'setdev', 'dev12'])
pc = pc[pc.r0.between(50, 500) & (pc.age >= 24)]
r = pd.read_csv(os.path.join(DATA, 'ebay', 'daily_rollup.csv.gz')); r = r[r.sold_totals.notna() & (r.sales > 0)]
r['tot'] = r.sold_totals.astype(str).str.split('|'); r = r.explode('tot'); r['tot'] = pd.to_numeric(r.tot, errors='coerce')
e = r[r.date.between('2026-09-28', '2026-10-08')].groupby('card_id').tot.agg(['median', 'size']).join(
    r[r.date.between('2026-10-13', '2026-10-23')].groupby('card_id').tot.agg(['median', 'size']), lsuffix='_e', rsuffix='_l', how='inner')
e = e[(e.size_e >= 2) & (e.size_l >= 2)]; e['y'] = e.median_l / e.median_e - 1
e = e.join(sig, how='inner').dropna(subset=['setdev', 'dev12'])
rows = []
for src, d in (('pricecharting_raw_28d', pc), ('ebay_sold_median_2wk', e)):
    for k in ('setdev', 'dev12', 'peerdev'):
        dd = d.dropna(subset=[k])
        q = pd.qcut(dd[k].rank(method='first'), 5, labels=False)
        rows.append({'source': src, 'signal': k, 'cards': len(dd), 'spearman_ic': dd[k].corr(dd.y, method='spearman'),
                     'bottom_quintile_mean': dd.y[q == 0].clip(-.6, 1.5).mean(), 'top_quintile_mean': dd.y[q == 4].clip(-.6, 1.5).mean(), 'all_mean': dd.y.clip(-.6, 1.5).mean()})
out = pd.DataFrame(rows); out.to_csv(os.path.join(OUT, 'E33c_setdev_october.csv'), index=False, float_format='%.4f')
print(out.round(4).to_string(index=False))

# Same eBay cards: PriceCharting's change over the same span (10-03 -> 10-23) by dev12 quintile, beside eBay's change, and
# the gap between eBay's early median and PriceCharting's price at the start (is PriceCharting lagging eBay?)
pcs = (D['loose-price']['2026-10-23'] / D['loose-price']['2026-10-03'] - 1).rename('pc_change')
e2 = e.join(pcs, how='inner').join(D['loose-price']['2026-10-03'].rename('pc_start'), how='inner').dropna(subset=['pc_change'])
e2['ebay_vs_pc_at_start'] = e2.median_e / e2.pc_start - 1
e2['q'] = pd.qcut(e2.dev12.rank(method='first'), 5, labels=['Q1 far below mean', 'Q2', 'Q3', 'Q4', 'Q5 far above mean'])
lag = e2.groupby('q', observed=True).agg(cards=('y', 'size'), ebay_change=('y', lambda s: s.clip(-.6, 1.5).mean()), pc_change=('pc_change', 'mean'),
                                          ebay_early_vs_pc_start=('ebay_vs_pc_at_start', 'median'), dev12_median=('dev12', 'median')).reset_index()
lag.to_csv(os.path.join(OUT, 'E33c_pc_vs_ebay_by_dev12.csv'), index=False, float_format='%.4f')
print(lag.round(4).to_string(index=False))
print('spearman dev12 vs (eBay early median / PC start - 1):', round(e2.dev12.corr(e2.ebay_vs_pc_at_start, method='spearman'), 3))
