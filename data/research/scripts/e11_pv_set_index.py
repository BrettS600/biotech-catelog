"""E11 - Does PokeViews' daily set index add a timelier set-momentum signal than PriceCharting's own monthly set move?
PokeViews publishes a daily index per set (top-10 cards, data/pokeviews/set_performance.csv.gz, daily from 2024).
At each month-end compute the set index's trailing 30-day and 90-day return and its distance from its 90-day mean,
map the set to PriceCharting's set (strip the 'Pokemon ' prefix), and test against the next 1- and 3-month returns of
ALL the set's $50-$500 cards: (a) Spearman IC of each set-level signal across sets (set-level), (b) card-level decile
tables of the set signal, side by side with PC's own set_mom1 / set_mom3 on the same months.
Outputs: results/E11_pv_set_signal.csv
"""
import os, numpy as np, pandas as pd, warnings
from scipy.stats import spearmanr
from common import load_panel, load_pokeviews
from xs import features, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']
pv = load_pokeviews()
sp = pv['set_performance']
sp = sp[sp['data_source'].isin(['daily_current', 'daily', 'interpolated', 'monthly'])]
sp['ym'] = sp['date'].dt.strftime('%Y-%m')
# month-end value per set, trailing returns from daily values
sp = sp.sort_values(['set_name', 'date'])
last = sp.groupby(['set_name', 'ym']).last().reset_index()[['set_name', 'ym', 'date', 'index_value', 'data_source']]
# daily-based 30/90-day returns at month end
piv = sp.pivot_table(index='date', columns='set_name', values='index_value').sort_index().ffill()
r30 = piv / piv.shift(30) - 1
r90 = piv / piv.shift(90) - 1
dev90 = piv / piv.rolling(90).mean() - 1
def at_month_end(d):
    g = d.groupby(d.index.strftime('%Y-%m')).last()
    return g
R30, R90, D90 = at_month_end(r30), at_month_end(r90), at_month_end(dev90)
sets_pc = P['cards']['set'].fillna('').str.replace(r'^Pokemon ', '', regex=True).values
rows = []
for h in (1, 3):
    gross, net, futs = forward(P, F, h)
    for j in range(months.index('2024-06'), len(months) - h):
        ym = months[j]
        if ym not in R30.index:
            continue
        ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(gross[:, j])
        df = pd.DataFrame({'set': sets_pc[ok], 'g': gross[ok, j], 'n': net[ok, j], 'set_mom1': F['set_mom1'][ok, j], 'set_mom3': F['set_mom3'][ok, j], 'dev12': F['dev12'][ok, j]})
        df['pv_r30'] = df['set'].map(R30.loc[ym])
        df['pv_r90'] = df['set'].map(R90.loc[ym])
        df['pv_dev90'] = df['set'].map(D90.loc[ym])
        df = df.dropna(subset=['pv_r30'])
        if len(df) < 200:
            continue
        # set-level: average next return per set vs set signal
        g_set = df.groupby('set').agg(g=('g', 'mean'), n_cards=('g', 'size'), pv_r30=('pv_r30', 'first'), pv_r90=('pv_r90', 'first'), pv_dev90=('pv_dev90', 'first'), set_mom1=('set_mom1', 'first'), set_mom3=('set_mom3', 'first'))
        g_set = g_set[g_set['n_cards'] >= 5]
        rec = dict(h=h, month=ym, n_cards=len(df), n_sets=len(g_set), reg3=F['reg3'][0, j], uni_gross=df['g'].mean())
        for s in ('pv_r30', 'pv_r90', 'pv_dev90', 'set_mom1', 'set_mom3'):
            x = g_set[s].astype(float); y = g_set['g']
            okk = x.notna() & y.notna()
            rec['setIC_' + s] = spearmanr(x[okk], y[okk]).correlation if okk.sum() >= 8 else np.nan
            xc = df[s].astype(float); okc = xc.notna()
            rec['cardIC_' + s] = spearmanr(xc[okc], df['g'][okc]).correlation if okc.sum() >= 50 else np.nan
            # top-quintile of sets by the signal: mean card return
            q = pd.qcut(xc[okc].rank(method='first'), 5, labels=False)
            rec['top20_' + s] = df['g'][okc][q == 4].mean(); rec['bot20_' + s] = df['g'][okc][q == 0].mean()
        rows.append(rec)
res = pd.DataFrame(rows)
res.round(4).to_csv(os.path.join(OUT, 'E11_pv_set_signal.csv'), index=False)
pd.set_option('display.width', 250)
summ = res.groupby('h').agg(months=('month', 'nunique'), **{c: (c, 'mean') for c in res.columns if c.startswith(('setIC', 'cardIC', 'top20', 'bot20', 'uni'))})
print(summ.T.round(3).to_string())
pos = res.groupby('h')[[c for c in res.columns if c.startswith('setIC')]].apply(lambda g: (g > 0).mean())
print('share of months with positive set-level IC'); print(pos.T.round(2).to_string())

# --- clean test without the monthly-averaging artifact: set index -> its OWN forward 30/90-day return (daily data only)
fwd30 = piv.shift(-30) / piv - 1
fwd90 = piv.shift(-90) / piv - 1
rows2 = []
for d in piv.index[piv.index >= '2024-04-01']:
    if d.day != 1 and d != piv.index[-1]:
        continue
    x30, x90, xd = r30.loc[d], r90.loc[d], dev90.loc[d]
    y30, y90 = fwd30.loc[d], fwd90.loc[d]
    for name, x in (('r30', x30), ('r90', x90), ('dev90', xd)):
        ok = x.notna() & y30.notna()
        if ok.sum() < 20:
            continue
        rec = dict(date=d.strftime('%Y-%m-%d'), signal=name, n_sets=int(ok.sum()), ic_fwd30=spearmanr(x[ok], y30[ok]).correlation)
        ok9 = x.notna() & y90.notna()
        rec['ic_fwd90'] = spearmanr(x[ok9], y90[ok9]).correlation if ok9.sum() >= 20 else np.nan
        q = pd.qcut(x[ok].rank(method='first'), 5, labels=False)
        rec['top20_fwd30'] = y30[ok][q == 4].mean(); rec['bot20_fwd30'] = y30[ok][q == 0].mean(); rec['all_fwd30'] = y30[ok].mean()
        rows2.append(rec)
r2 = pd.DataFrame(rows2)
r2.round(4).to_csv(os.path.join(OUT, 'E11_pv_set_own_momentum.csv'), index=False)
s2 = r2.groupby('signal').agg(months=('date', 'nunique'), ic_fwd30=('ic_fwd30', 'mean'), ic_fwd30_pos=('ic_fwd30', lambda x: (x > 0).mean()), ic_fwd90=('ic_fwd90', 'mean'), top20_fwd30=('top20_fwd30', 'mean'), bot20_fwd30=('bot20_fwd30', 'mean'), all_fwd30=('all_fwd30', 'mean'))
print('set index -> its own forward return (no PC averaging):'); print(s2.round(3).to_string())
