"""E27b - Is the PSA 10 / raw ratio's 28-day power (E27) just the reversal (dev12) seen through another anchor?
Cards priced $10+ (and the $50-500 band) on 2026-09-28; target = raw (loose-price) change 09-28 -> 10-26 from the daily
download; controls from the monthly panel as of September 2026: dev12 = Sep price / mean(Oct 2025..Sep 2026) - 1,
mom1 = Sep / Aug - 1, log price, sales in Sep. Cross-sectional OLS on rank-normalised (0..1) characteristics (slope =
change from the lowest to the highest rank), heteroskedasticity-robust t. ONE cross-section of 4 weeks.
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_panel
from daily_panel import load_daily, DATA
import statsmodels.api as sm
OUT = os.path.join(DATA, 'research', 'results')
P = load_panel(); D = load_daily()
months = list(P['months']); j = months.index('2026-09')
price, sales = P['price'], P['sales']
ids = P['cards']['card_id'].to_numpy()
m12 = np.nanmean(price[:, j - 11:j + 1], axis=1)
cnt = np.sum(~np.isnan(price[:, j - 11:j + 1]), axis=1)
mon = pd.DataFrame({'dev12': np.where(cnt >= 9, price[:, j] / m12 - 1, np.nan), 'mom1': price[:, j] / price[:, j - 1] - 1,
                    'sales_sep': sales[:, j], 'p_sep': price[:, j]}, index=ids)
d0, d1 = D['dates'][0], D['dates'][-1]
raw0, raw1 = D['loose-price'][d0], D['loose-price'][d1]
psa0, psa1 = D['manual-only-price'][d0], D['manual-only-price'][d1]
g90 = D['graded-price'][d0]
df = pd.DataFrame({'raw0': raw0, 'y_raw': raw1 / raw0 - 1, 'y_psa': psa1 / psa0 - 1, 'ratio10': psa0 / raw0, 'ratio9': g90 / raw0,
                   'vol_pc': D['sales-volume'][d0]}).join(mon, how='inner')
rows = []
rk = lambda s: s.rank(pct=True)
for band, lo, hi in (('10+', 10, 1e9), ('50-500', 50, 500)):
    for target in ('y_raw', 'y_psa'):
        d = df[df.raw0.between(lo, hi)].replace([np.inf, -np.inf], np.nan).dropna(subset=['ratio10', 'dev12', 'mom1', target, 'sales_sep'])
        d = d[(d.ratio10 > 0)]
        y = d[target].clip(d[target].quantile(.01), d[target].quantile(.99))
        for spec in (['ratio10'], ['dev12'], ['ratio10', 'dev12'], ['ratio10', 'dev12', 'mom1', 'logp', 'sales_sep']):
            X = pd.DataFrame({c: rk(np.log(d.raw0) if c == 'logp' else d[c]) for c in spec})
            fit = sm.OLS(y.to_numpy(), sm.add_constant(X.to_numpy())).fit(cov_type='HC1')
            for i, c in enumerate(spec):
                rows.append({'band': band, 'target': target, 'spec': '+'.join(spec), 'var': c, 'slope': fit.params[i + 1], 't': fit.tvalues[i + 1], 'n': len(d), 'r2': fit.rsquared})
r = pd.DataFrame(rows)
r.to_csv(os.path.join(OUT, 'E27b_ratio_vs_dev12.csv'), index=False, float_format='%.4f')
print(r.round(3).to_string(index=False))
print('spearman ratio10 vs dev12 (10+):', round(df.replace([np.inf, -np.inf], np.nan).dropna(subset=['ratio10', 'dev12']).query('raw0>10')[['ratio10', 'dev12']].corr(method='spearman').iloc[0, 1], 3))
