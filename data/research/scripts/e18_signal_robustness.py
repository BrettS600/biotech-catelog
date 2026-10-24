"""E18 - Robustness of the reversal signal: year by year and variant by variant, inside the band ($50-$500, sales >= 2,
sets >= 24 months), 3-month hold. For each candidate ranking signal (dev12, dev6, mom12, mom12x1, hi12, a dev6+dev12
average rank, and dev12 restricted to sales >= 5) the bottom-decile gross return minus the band's, per calendar year,
with the share of months the decile beat the band - is the edge there in the losing years too, and which variant is
the most consistent? Also the decile's net at 20% under per year.
Outputs: results/E18_signal_by_year.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED
from xs import features, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']
h = 3
gross, net, futs = forward(P, F, h)
with np.errstate(all='ignore'):
    F['dev6_12'] = np.full_like(F['dev12'], np.nan)
rows = []
for j in range(months.index('2022-01'), len(months) - h):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(gross[:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    idx = np.where(ok)[0]
    if len(idx) < 100:
        continue
    g = gross[idx, j]; b = F['buy_real'][idx, j]
    n20 = ((1 + g) * b * KEEP - FIXED - 0.8 * b) / (0.8 * b)
    band_g = g.mean()
    sigs = {'dev12': F['dev12'][idx, j], 'dev6': F['dev6'][idx, j], 'mom12': F['mom12'][idx, j], 'mom12x1': F['mom12x1'][idx, j], 'hi12': F['hi12'][idx, j]}
    r6 = pd.Series(F['dev6'][idx, j]).rank(pct=True).values; r12 = pd.Series(F['dev12'][idx, j]).rank(pct=True).values
    sigs['dev6+dev12'] = (r6 + r12) / 2
    s5 = F['dev12'][idx, j].copy(); s5[sl[idx, j] < 5] = np.nan
    sigs['dev12_sales5'] = s5
    for name, s in sigs.items():
        okk = ~np.isnan(s)
        if okk.sum() < 50:
            continue
        cut = np.nanpercentile(s[okk], 10)
        m = okk & (s <= cut)
        rows.append((months[j], months[j][:4], name, int(m.sum()), g[m].mean(), band_g, n20[m].mean(), (n20[m] > 0).mean()))
d = pd.DataFrame(rows, columns=['month', 'year', 'signal', 'n', 'decile_gross', 'band_gross', 'decile_net20', 'p_net20_pos'])
d['excess'] = d['decile_gross'] - d['band_gross']
agg = d.groupby(['signal', 'year']).agg(months=('month', 'nunique'), decile_gross=('decile_gross', 'mean'), band_gross=('band_gross', 'mean'), excess=('excess', 'mean'), months_beating_band=('excess', lambda x: (x > 0).mean()), decile_net20=('decile_net20', 'mean'), p_net20_pos=('p_net20_pos', 'mean')).reset_index()
allyrs = d.groupby('signal').agg(months=('month', 'nunique'), decile_gross=('decile_gross', 'mean'), band_gross=('band_gross', 'mean'), excess=('excess', 'mean'), months_beating_band=('excess', lambda x: (x > 0).mean()), decile_net20=('decile_net20', 'mean'), p_net20_pos=('p_net20_pos', 'mean')).reset_index()
allyrs.insert(1, 'year', 'ALL')
out = pd.concat([allyrs, agg], ignore_index=True)
out.round(4).to_csv(os.path.join(OUT, 'E18_signal_by_year.csv'), index=False)
pd.set_option('display.width', 250)
print(out.sort_values(['year', 'excess'], ascending=[True, False]).round(3).to_string())
