"""E27 - What the 29 days of PriceCharting's full daily download (2026-09-28..10-26) say about graded vs raw prices:
(a) PriceCharting's dealer buy / sell prices are fixed multiples of the ungraded price (no information);
(b) 28-day changes and daily-change volatility: raw vs grade 9 vs PSA 10 vs BGS/CGC/SGC 10, by raw price tier;
(c) one cross-section: does the PSA 10 / raw ratio on day 0 predict the raw (or PSA 10) change over the next 28 days?
    (Spearman IC and quintiles; ONE period - suggestive only.)
PriceCharting's daily figure is its current estimate, not a single sale; it moves in steps when new sales arrive.
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from daily_panel import load_daily, DATA
OUT = os.path.join(DATA, 'research', 'results')
D = load_daily()
d0, d1 = D['dates'][0], D['dates'][-1]
raw = D['loose-price']

# (a) dealer multiples
last = pd.DataFrame({'p': raw[d1], 'buy': D['retail-loose-buy'][d1] / raw[d1], 'sell': D['retail-loose-sell'][d1] / raw[d1]})
last['tier'] = pd.cut(last.p, [0, 10, 25, 50, 100, 250, 500, 1e9], labels=['<10', '10-25', '25-50', '50-100', '100-250', '250-500', '500+'])
a = last.dropna(subset=['p']).groupby('tier', observed=True).agg(cards=('p', 'size'), with_dealer_buy=('buy', lambda s: s.notna().mean()),
        dealer_buy_ratio_median=('buy', 'median'), dealer_sell_ratio_median=('sell', 'median'))
a.to_csv(os.path.join(OUT, 'E27_dealer_multiples.csv'), float_format='%.4f')
print(a.round(3).to_string())

# (b) 28-day changes by grade, by raw tier
cols = {'raw': 'loose-price', 'grade9': 'graded-price', 'psa10': 'manual-only-price', 'bgs10': 'bgs-10-price', 'cgc10': 'condition-17-price', 'sgc10': 'condition-18-price', 'grade8': 'new-price', 'grade7': 'cib-price'}
tier = pd.cut(raw[d0], [10, 25, 50, 100, 250, 500, 1e9], labels=['10-25', '25-50', '50-100', '100-250', '250-500', '500+'])
rows = []
for name, col in cols.items():
    M = D[col]
    ch = M[d1] / M[d0] - 1
    dl = np.log(M).diff(axis=1)
    moved = (dl.abs() > 1e-9).sum(axis=1)                       # days on which PriceCharting changed the figure
    vol = dl.std(axis=1)
    ok = M[d0].notna() & M[d1].notna() & (M[d0] > 0) & tier.notna()
    for t in list(tier.cat.categories) + ['all $10+']:
        m = ok & ((tier == t) if t != 'all $10+' else True)
        if m.sum() < 30: continue
        c = ch[m].clip(-0.9, 3)
        rows.append({'grade': name, 'raw_tier': t, 'cards': int(m.sum()), 'median_price_d0': M[d0][m].median(),
                     'mean_change_28d': c.mean(), 'median_change_28d': c.median(), 'p_up': (c > 0.001).mean(), 'p_down': (c < -0.001).mean(),
                     'p_up_10pct': (c > 0.10).mean(), 'p_down_10pct': (c < -0.10).mean(),
                     'days_changed_median': moved[m].median(), 'daily_logvol_median': vol[m].median()})
b = pd.DataFrame(rows)
b.to_csv(os.path.join(OUT, 'E27_daily_changes_by_grade.csv'), index=False, float_format='%.4f')
print(b[b.raw_tier.isin(['50-100', '100-250', '250-500', 'all $10+'])][['grade', 'raw_tier', 'cards', 'median_price_d0', 'mean_change_28d', 'median_change_28d', 'p_up_10pct', 'p_down_10pct', 'days_changed_median']].round(3).to_string(index=False))

# correlation of raw and PSA 10 moves over the 28 days
m = raw[d0].gt(10) & D['manual-only-price'][d0].gt(0) & raw[d1].notna() & D['manual-only-price'][d1].notna()
rc, pc10 = (raw[d1] / raw[d0] - 1)[m], (D['manual-only-price'][d1] / D['manual-only-price'][d0] - 1)[m]
print('spearman raw vs psa10 28d change:', round(rc.corr(pc10, method='spearman'), 3), 'n', int(m.sum()))

# (c) the PSA 10 / raw ratio on day 0 as a predictor of the next 28 days (one cross-section)
ratio = D['manual-only-price'][d0] / raw[d0]
rows = []
for target_name, target in (('raw_change', raw[d1] / raw[d0] - 1), ('psa10_change', D['manual-only-price'][d1] / D['manual-only-price'][d0] - 1)):
    for lo, hi in ((10, 1e9), (50, 500)):
        mm = ratio.notna() & target.notna() & raw[d0].between(lo, hi) & (ratio > 0)
        df = pd.DataFrame({'ratio': ratio[mm], 'y': target[mm].clip(-0.9, 3)})
        df['q'] = pd.qcut(df.ratio.rank(method='first'), 5, labels=[1, 2, 3, 4, 5])
        g = df.groupby('q', observed=True).agg(ratio_med=('ratio', 'median'), y_mean=('y', 'mean'), y_med=('y', 'median'), n=('y', 'size'))
        for q, r in g.iterrows():
            rows.append({'target': target_name, 'band': f'{lo}-{hi:g}', 'quintile_of_psa10_over_raw': q, 'ratio_median': r.ratio_med,
                         'mean_change_28d': r.y_mean, 'median_change_28d': r.y_med, 'cards': r.n,
                         'spearman_ic': df.ratio.corr(df.y, method='spearman')})
c = pd.DataFrame(rows)
c.to_csv(os.path.join(OUT, 'E27_ratio_predicts.csv'), index=False, float_format='%.4f')
print(c.round(4).to_string(index=False))
