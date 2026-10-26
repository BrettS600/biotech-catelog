"""E27d - Validate the PSA 10 / raw ratio signal on eBay's own sold prices (independent of PriceCharting's estimates).
The collector's daily rollup (data/ebay/daily_rollup.csv.gz, 2026-09-28..10-23) carries every comparable sold total
(item + shipping, NM-equivalent) per card per day. Early window = sales 09-28..10-08, late window = 10-13..10-23; a
card needs >= 2 sales in each. y = median(late) / median(early) - 1. Predictor = PriceCharting PSA 10 / raw ratio on
09-28 (plus the raw ratio's PriceCharting-implied move as a comparison). Spearman IC, terciles, rank-OLS with the
early-window eBay median relative to PriceCharting's raw price on 09-28 as a control (a card already cheap on eBay).
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from daily_panel import load_daily, DATA
import statsmodels.api as sm
OUT = os.path.join(DATA, 'research', 'results')
D = load_daily()
r = pd.read_csv(os.path.join(DATA, 'ebay', 'daily_rollup.csv.gz'))
r = r[r.sold_totals.notna() & (r.sales > 0)]
r['tots'] = r.sold_totals.astype(str).str.split('|')
r = r.explode('tots'); r['tot'] = pd.to_numeric(r.tots, errors='coerce'); r = r.dropna(subset=['tot'])
early = r[r.date.between('2026-09-28', '2026-10-08')].groupby('card_id').tot.agg(['median', 'size'])
late = r[r.date.between('2026-10-13', '2026-10-23')].groupby('card_id').tot.agg(['median', 'size'])
e = early.join(late, lsuffix='_e', rsuffix='_l', how='inner')
e = e[(e.size_e >= 2) & (e.size_l >= 2)]
d0 = '2026-09-28'
raw0 = D['loose-price'][d0]; psa0 = D['manual-only-price'][d0]
raw_pc_change = D['loose-price']['2026-10-23'] / D['loose-price']['2026-10-03'] - 1
e = e.join(pd.DataFrame({'raw0': raw0, 'ratio': psa0 / raw0, 'pc_change': raw_pc_change}), how='inner').replace([np.inf, -np.inf], np.nan).dropna()
e = e[e.ratio > 0]
e['y'] = e.median_l / e.median_e - 1
e['cheap'] = e.median_e / e.raw0 - 1
rows = [{'what': 'cards', 'value': len(e)},
        {'what': 'spearman ratio vs eBay median change', 'value': e.ratio.corr(e.y, method='spearman')},
        {'what': 'spearman ratio vs PC raw change (same cards, 10-03..10-23)', 'value': e.ratio.corr(e.pc_change, method='spearman')},
        {'what': 'spearman PC raw change vs eBay median change', 'value': e.pc_change.corr(e.y, method='spearman')}]
q = pd.qcut(e.ratio.rank(method='first'), 3, labels=['low', 'mid', 'high'])
for k, g in e.groupby(q, observed=True):
    rows.append({'what': f'tercile {k}: ratio median / eBay change mean / median / cards', 'value': f"{g.ratio.median():.1f} / {g.y.clip(-.6, 1.5).mean():+.3f} / {g.y.median():+.3f} / {len(g)}"})
rk = lambda s: s.rank(pct=True)
y = e.y.clip(e.y.quantile(.02), e.y.quantile(.98))
f = sm.OLS(y.to_numpy(), sm.add_constant(np.column_stack([rk(e.ratio), rk(e.cheap), rk(np.log(e.raw0))]))).fit(cov_type='HC1')
rows += [{'what': 'rank-OLS slope ratio (t)', 'value': f"{f.params[1]:+.3f} ({f.tvalues[1]:.2f})"},
         {'what': 'rank-OLS slope early eBay median vs PC raw (t)', 'value': f"{f.params[2]:+.3f} ({f.tvalues[2]:.2f})"},
         {'what': 'rank-OLS slope log price (t)', 'value': f"{f.params[3]:+.3f} ({f.tvalues[3]:.2f})"}]
out = pd.DataFrame(rows)
out.to_csv(os.path.join(OUT, 'E27d_ratio_on_ebay.csv'), index=False)
print(out.to_string(index=False))
