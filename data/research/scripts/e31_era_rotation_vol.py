"""E31 - Two portfolio-level ideas from equity practice, on the new graded data and the market series.
(a) Era rotation: each month, rank the four eras (Vintage / Classic / Mid Era / Modern) by last month's PSA 10 era-index
    return (or by the PSA 10 - raw gap over 3 months); next month's raw era-index return of the top-ranked era vs the
    bottom-ranked and vs the four-era average. Month-start values, 2022-02..2026-09.
(b) Volatility-managed exposure (Moreira-Muir 2017): does the market's trailing 3- or 6-month volatility (std of the
    monthly median move) or the cross-sectional dispersion of card returns predict the next quarter's market move or
    its downside? Spearman and terciles on the PC market series (E01) 2021-08..2026-06.
"""
import os, sys, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import load_panel
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
OUT = os.path.join(DATA, 'research', 'results')
raw = pd.read_csv(os.path.join(DATA, 'pokeviews', 'era_performance.csv'), parse_dates=['date'])
gb = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index_by_era.csv'), parse_dates=['date'])
ms = lambda d: d[d['date'].dt.day == 1]
rawm = ms(raw).set_index('date'); gbm = ms(gb).pivot(index='date', columns='era', values='graded_index_value')
eras = {'vintage': 'Vintage', 'classic': 'Classic', 'mid_era': 'Mid Era', 'modern': 'Modern'}
R = pd.DataFrame({n: rawm[f'{k}_index_value'].astype(float) for k, n in eras.items()}).loc[gbm.index]
G = gbm[list(eras.values())].astype(float)
r1, g1 = R.pct_change(), G.pct_change(); rnext = R.shift(-1) / R - 1
gap3 = G.pct_change(3) - R.pct_change(3)
rows = []
for sig_name, sig in (('psa10_last_month', g1), ('psa10_minus_raw_3m', gap3), ('raw_last_month', r1)):
    top, bot, avg = [], [], []
    for t in sig.index:
        s, y = sig.loc[t], rnext.loc[t]
        if s.isna().any() or y.isna().any(): continue
        top.append(y[s.idxmax()]); bot.append(y[s.idxmin()]); avg.append(y.mean())
    top, bot, avg = map(np.array, (top, bot, avg))
    rows.append({'signal': sig_name, 'months': len(top), 'top_era_next_raw': top.mean(), 'bottom_era_next_raw': bot.mean(), 'avg_era_next_raw': avg.mean(),
                 'top_minus_avg': (top - avg).mean(), 'top_beats_avg_share': (top > avg).mean(), 't_top_minus_avg': (top - avg).mean() / (top - avg).std(ddof=1) * np.sqrt(len(top))})
a = pd.DataFrame(rows); a.to_csv(os.path.join(OUT, 'E31_era_rotation.csv'), index=False, float_format='%.4f')
print(a.round(4).to_string(index=False))

mk = pd.read_csv(os.path.join(OUT, 'E01_market_monthly.csv')).set_index('month')
m1 = mk['median_mom1']
P = load_panel(); price = P['price']; months = list(P['months'])
disp = {}
for j in range(1, len(months)):
    a_, b_ = price[:, j - 1], price[:, j]
    ok = (a_ >= 10) & np.isfinite(b_) & (b_ > 0)
    r_ = np.log(b_[ok] / a_[ok])
    disp[months[j]] = np.subtract(*np.percentile(r_, [75, 25])) if ok.sum() > 100 else np.nan
df = pd.DataFrame({'m1': m1, 'vol3': m1.rolling(3).std(), 'vol6': m1.rolling(6).std(), 'disp': pd.Series(disp)})
df['reg3'] = m1.rolling(3).mean()
df['next3'] = (1 + m1.shift(-1)) * (1 + m1.shift(-2)) * (1 + m1.shift(-3)) - 1
d = df.loc['2021-08':'2026-06'].dropna()
rows = []
for v in ('vol3', 'vol6', 'disp'):
    q = pd.qcut(d[v], 3, labels=['low', 'mid', 'high'])
    for k, g in d.groupby(q, observed=True):
        rows.append({'risk_measure': v, 'tercile': k, 'months': len(g), 'next3_mean': g.next3.mean(), 'next3_min': g.next3.min(), 'p_next3_neg': (g.next3 < 0).mean(),
                     'spearman_with_next3': d[v].corr(d.next3, method='spearman'),
                     'spearman_with_next3_given_reg3_sign': d[d.reg3 > 0][v].corr(d[d.reg3 > 0].next3, method='spearman')})
b = pd.DataFrame(rows); b.to_csv(os.path.join(OUT, 'E31_volatility_managed.csv'), index=False, float_format='%.4f')
print(b.round(4).to_string(index=False))

# (c) is dispersion's power incremental to the regime (reg3) and to the graded 1-month move? HAC t, leave-one-year-out R2,
# and the gate 'reg3 > 0 and dispersion below its trailing-24-month median' vs reg3 > 0 alone
import statsmodels.api as sm
g = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index.csv'), parse_dates=['date'])
g = g[g.date.dt.day == 1].set_index('date')['index_value']; gm = g.shift(-1) / g - 1; gm.index = gm.index.strftime('%Y-%m')
df['graded1'] = gm
df['disp_rel'] = df['disp'] / df['disp'].rolling(24, min_periods=12).median() - 1
inc = []
for xs in (['reg3'], ['reg3', 'disp'], ['reg3', 'disp_rel'], ['disp']):
    dd = df.loc['2021-08':'2026-06'].dropna(subset=['next3'] + xs)
    m = sm.OLS(dd.next3, sm.add_constant(dd[xs])).fit(cov_type='HAC', cov_kwds={'maxlags': 3})
    yrs = dd.index.str[:4]; pred = pd.Series(index=dd.index, dtype=float)
    for yv in yrs.unique():
        tr_, te = dd[yrs != yv], dd[yrs == yv]
        pred[te.index] = sm.OLS(tr_.next3, sm.add_constant(tr_[xs])).fit().predict(sm.add_constant(te[xs], has_constant='add'))
    oos = 1 - ((dd.next3 - pred) ** 2).sum() / ((dd.next3 - dd.next3.mean()) ** 2).sum()
    inc.append({'model': ' + '.join(xs), 'n': len(dd), 'r2': m.rsquared, 'oos_r2_loyo': oos, **{f't_{x}': m.tvalues[x] for x in xs}})
dd = df.loc['2022-01':'2026-06'].dropna(subset=['next3', 'reg3', 'disp_rel'])
for name, on in (('reg3>0', dd.reg3 > 0), ('reg3>0 & disp_rel<0', (dd.reg3 > 0) & (dd.disp_rel < 0)), ('disp_rel<0', dd.disp_rel < 0)):
    inc.append({'model': 'GATE ' + name, 'n': len(dd), 'share_on': on.mean(), 'fwd3_on': dd.next3[on].mean(), 'fwd3_off': dd.next3[~on].mean(),
                'p_pos_on': (dd.next3[on] > 0).mean(), 'sign_accuracy': ((dd.next3 > 0) == on).mean()})
c = pd.DataFrame(inc); c.to_csv(os.path.join(OUT, 'E31_dispersion_incremental.csv'), index=False, float_format='%.4f')
print(c.round(3).to_string(index=False))
print(df[['m1', 'disp', 'disp_rel', 'reg3', 'next3']].loc['2022-01':'2026-10'].round(3).to_string())
