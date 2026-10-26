"""E26b - Does the PSA 10 index lead the raw index (era level, month-start points 2022-01..2026-10), beyond raw's own
momentum? Pooled panel of 4 eras: next-month (and next-3-month) raw return on last month's raw return and last month's
PSA 10 return (and the PSA 10 - raw gap in trailing 3-month returns), era fixed effects, cluster-robust by month.
Also the reverse (raw leading PSA 10). Month-start values only (the days between are PCHIP interpolation).
"""
import os, numpy as np, pandas as pd
import statsmodels.formula.api as smf
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
OUT = os.path.join(DATA, 'research', 'results')
raw = pd.read_csv(os.path.join(DATA, 'pokeviews', 'era_performance.csv'), parse_dates=['date'])
gb = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index_by_era.csv'), parse_dates=['date'])
ms = lambda d: d[d['date'].dt.day == 1]
rawm, gbm = ms(raw).set_index('date'), ms(gb).pivot(index='date', columns='era', values='graded_index_value')
eras = {'vintage': 'Vintage', 'classic': 'Classic', 'mid_era': 'Mid Era', 'modern': 'Modern'}
rows = []
for k, name in eras.items():
    r = rawm[f'{k}_index_value'].astype(float); g = gbm[name].astype(float)
    c = r.index.intersection(g.index); r, g = r.loc[c], g.loc[c]
    df = pd.DataFrame({'r1': r.pct_change(), 'g1': g.pct_change(), 'r3': r.pct_change(3), 'g3': g.pct_change(3)})
    df['r_next1'] = r.shift(-1) / r - 1; df['r_next3'] = r.shift(-3) / r - 1
    df['g_next1'] = g.shift(-1) / g - 1; df['g_next3'] = g.shift(-3) / g - 1
    df['gap3'] = df.g3 - df.r3; df['era'] = name; df['month'] = df.index
    rows.append(df)
P = pd.concat(rows).dropna()
res = []
for f in ['r_next1 ~ r1 + C(era)', 'r_next1 ~ r1 + g1 + C(era)', 'r_next3 ~ r3 + C(era)', 'r_next3 ~ r3 + g3 + C(era)', 'r_next3 ~ r3 + gap3 + C(era)',
          'g_next1 ~ g1 + C(era)', 'g_next1 ~ g1 + r1 + C(era)', 'g_next3 ~ g3 + r3 + C(era)']:
    m = smf.ols(f, data=P).fit(cov_type='cluster', cov_kwds={'groups': P['month'].astype('int64')})
    for v in m.params.index:
        if v.startswith('C(') or v == 'Intercept': continue
        res.append({'model': f, 'var': v, 'coef': m.params[v], 't_cluster_month': m.tvalues[v], 'r2': m.rsquared, 'n': int(m.nobs)})
out = pd.DataFrame(res)
out.to_csv(os.path.join(OUT, 'E26b_graded_leads_raw.csv'), index=False, float_format='%.4f')
print(out.round(3).to_string(index=False))
