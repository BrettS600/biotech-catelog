"""E28 - Market timing with the new data: does the PSA 10 market (PokeViews Top 250 Graded, graded era indexes) or any
of the five Google Trends properties (web, image, news, shopping, YouTube) forecast the raw market's next 1 and 3
months beyond the market's own trailing move (the reg1 / reg3 gate)?
Target: E01's market series (median 1-month move of cards $10+ with 2+ sales; next-3 = compounded next three).
Month m's predictors are known at the end of month m: graded index change over the month (month-start m+1 vs m),
Trends 1-month change (log), raw reg1 / reg3. OLS with Newey-West (lag 3) t; leave-one-year-out out-of-sample R2;
sign accuracy of the gates 'reg3>0', 'reg3>0 and graded 1-mo>0', 'graded 1-mo>0'. 2022-01..2026-09.
"""
import os, numpy as np, pandas as pd
import statsmodels.api as sm
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
OUT = os.path.join(DATA, 'research', 'results')
mk = pd.read_csv(os.path.join(OUT, 'E01_market_monthly.csv')).set_index('month')
m1 = mk['median_mom1']
df = pd.DataFrame({'reg1': m1, 'reg3': m1.rolling(3).mean()})
df['next1'] = m1.shift(-1)
df['next3'] = (1 + m1.shift(-1)) * (1 + m1.shift(-2)) * (1 + m1.shift(-3)) - 1
g = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index.csv'), parse_dates=['date'])
g = g[g.date.dt.day == 1].set_index('date')['index_value']
# month m (YYYY-MM) -> change from the 1st of m to the 1st of m+1 (known at the end of m)
gm = (g.shift(-1) / g - 1); gm.index = gm.index.strftime('%Y-%m')
df['graded1'] = gm
df['graded3'] = (1 + gm).rolling(3).apply(np.prod, raw=True) - 1
ge = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index_by_era.csv'), parse_dates=['date'])
ge = ge[ge.date.dt.day == 1].pivot(index='date', columns='era', values='graded_index_value')
gem = (ge.shift(-1) / ge - 1).mean(axis=1); gem.index = gem.index.strftime('%Y-%m')
df['graded_era1'] = gem
tr = pd.read_csv(os.path.join(DATA, 'google_trends', 'pokemon_cards_interest.csv')).set_index('month')
for c in ['web_search', 'image_search', 'news_search', 'google_shopping', 'youtube_search']:
    s = tr[c].astype(float).replace(0, np.nan)
    df[c] = np.log(s).diff()
df = df.loc['2022-01':'2026-09']
res = []
def fit(y, xs, d):
    d = d.dropna(subset=[y] + xs)
    X = sm.add_constant(d[xs]); m = sm.OLS(d[y], X).fit(cov_type='HAC', cov_kwds={'maxlags': 3})
    # leave-one-year-out OOS R2
    yrs = d.index.str[:4]; pred = pd.Series(index=d.index, dtype=float)
    for yv in yrs.unique():
        tr_, te = d[yrs != yv], d[yrs == yv]
        if len(tr_) < 12: continue
        mm = sm.OLS(tr_[y], sm.add_constant(tr_[xs])).fit()
        pred[te.index] = mm.predict(sm.add_constant(te[xs], has_constant='add'))
    ok = pred.notna(); oos = 1 - ((d[y][ok] - pred[ok]) ** 2).sum() / ((d[y][ok] - d[y][ok].mean()) ** 2).sum()
    return m, oos, len(d)
for y in ('next1', 'next3'):
    base = 'reg1' if y == 'next1' else 'reg3'
    for extra in [[], ['graded1'], ['graded3'], ['graded_era1'], ['web_search'], ['image_search'], ['news_search'], ['google_shopping'], ['youtube_search'], ['graded1', 'web_search']]:
        xs = [base] + extra
        m, oos, n = fit(y, xs, df)
        res.append({'target': y, 'model': ' + '.join(xs), 'n_months': n, 'r2': m.rsquared, 'oos_r2_loyo': oos,
                    **{f'coef_{v}': m.params[v] for v in xs}, **{f't_{v}': m.tvalues[v] for v in xs}})
r = pd.DataFrame(res)
r.to_csv(os.path.join(OUT, 'E28_market_timing_new.csv'), index=False, float_format='%.4f')
print(r[['target', 'model', 'n_months', 'r2', 'oos_r2_loyo'] + [c for c in r.columns if c.startswith('t_')]].round(3).to_string(index=False))
# gate sign accuracy on next3
d = df.dropna(subset=['next3', 'reg3'])
gates = {'reg3>0': d.reg3 > 0, 'graded1>0': d.graded1 > 0, 'reg3>0 & graded1>0': (d.reg3 > 0) & (d.graded1 > 0), 'reg3>0 | graded3>0.05': (d.reg3 > 0) | (d.graded3 > 0.05)}
gr = []
for k, on in gates.items():
    on = on.fillna(False)
    gr.append({'gate': k, 'months': len(d), 'share_on': on.mean(), 'fwd3_on': d.next3[on].mean(), 'fwd3_off': d.next3[~on].mean(),
               'p_pos_on': (d.next3[on] > 0).mean(), 'p_pos_off': (d.next3[~on] > 0).mean(), 'sign_accuracy': ((d.next3 > 0) == on).mean()})
gr = pd.DataFrame(gr); gr.to_csv(os.path.join(OUT, 'E28_gate_sign.csv'), index=False, float_format='%.4f')
print(gr.round(3).to_string(index=False))
