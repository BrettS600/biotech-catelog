"""E05 - Calendar seasonality and set age, inside the $50-$500 band.
(a) Is there a month-of-year pattern in the market-wide median move (and in the band)? Each calendar month's
    average over 2021-2026, with the number of years it was positive - six years is thin, so treat as suggestive.
(b) Set age (months since release) -> forward 1/3/6-month gross and net returns, by age bucket and regime: the 2026-10-17
    research found young sets lose 10-20%/month; here the full curve, and whether any age bucket clears fees.
Outputs: results/E05_seasonality.csv, results/E05_set_age.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel
from xs import features, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']

# (a) seasonality of the one-month move by calendar month, two universes
rows = []
for j in range(1, len(months)):
    for lo, hi, lab in ((10, 1e9, 'all 10+'), (50, 500, '50-500')):
        ok = (pr[:, j - 1] >= lo) & (pr[:, j - 1] < hi) & (sl[:, j] >= 2) & ~np.isnan(F['mom1'][:, j])
        if ok.sum() < 100:
            continue
        rows.append((months[j], int(months[j][5:]), lab, ok.sum(), np.median(F['mom1'][ok, j]), (F['mom1'][ok, j] > 0).mean()))
d = pd.DataFrame(rows, columns=['month', 'cal', 'universe', 'n', 'median_mom1', 'breadth_up'])
s = d.groupby(['universe', 'cal']).agg(years=('month', 'nunique'), mean_median_mom1=('median_mom1', 'mean'), min_=('median_mom1', 'min'), max_=('median_mom1', 'max'), years_positive=('median_mom1', lambda x: (x > 0).sum()), mean_breadth=('breadth_up', 'mean')).reset_index()
# de-trended: each month minus that year's average (removes the 2021 slump / 2025-26 boom)
d['year'] = d['month'].str[:4]
d['dm'] = d['median_mom1'] - d.groupby(['universe', 'year'])['median_mom1'].transform('mean')
s2 = d.groupby(['universe', 'cal'])['dm'].agg(['mean', lambda x: (x > 0).sum()]).reset_index()
s2.columns = ['universe', 'cal', 'detrended_mean', 'detrended_years_positive']
s = s.merge(s2, on=['universe', 'cal'])
s.round(4).to_csv(os.path.join(OUT, 'E05_seasonality.csv'), index=False)
print(s[s.universe == '50-500'].round(3).to_string())
print(d.pivot_table(index='year', columns='cal', values='median_mom1', aggfunc='first').loc[:, :].round(3).to_string())

# (b) set age curve
rows = []
buckets = [(-1, 3, '0-2'), (3, 6, '3-5'), (6, 12, '6-11'), (12, 24, '12-23'), (24, 48, '24-47'), (48, 96, '48-95'), (96, 180, '96-179'), (180, 400, '180+')]
for h in (1, 3, 6):
    gross, net, futs = forward(P, F, h)
    for j in range(months.index('2022-01'), len(months) - h):
        reg = F['reg3'][0, j]
        regime = 'strong' if reg > 0.02 else ('flat' if reg > -0.005 else 'falling')
        for lo, hi, lab in buckets:
            ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(gross[:, j]) & (F['age'][:, j] >= lo) & (F['age'][:, j] < hi)
            if ok.sum() < 15:
                continue
            rows.append((h, months[j], regime, lab, ok.sum(), gross[ok, j].mean(), np.median(gross[ok, j]), net[ok, j].mean(), (net[ok, j] > 0).mean()))
a = pd.DataFrame(rows, columns=['h', 'month', 'regime', 'age_bucket', 'n', 'gross_mean', 'gross_median', 'net_mean', 'p_net_pos'])
agg = a.groupby(['h', 'age_bucket']).agg(months=('month', 'nunique'), n=('n', 'sum'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net_mean=('net_mean', 'mean'), p_net_pos=('p_net_pos', 'mean')).reset_index()
agg.insert(1, 'regime', 'ALL')
agg2 = a.groupby(['h', 'regime', 'age_bucket']).agg(months=('month', 'nunique'), n=('n', 'sum'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net_mean=('net_mean', 'mean'), p_net_pos=('p_net_pos', 'mean')).reset_index()
out = pd.concat([agg, agg2], ignore_index=True)
order = {b[2]: i for i, b in enumerate(buckets)}
out['o'] = out['age_bucket'].map(order); out = out.sort_values(['h', 'regime', 'o']).drop(columns='o')
out.round(4).to_csv(os.path.join(OUT, 'E05_set_age.csv'), index=False)
print(out[out.regime.isin(['ALL', 'strong'])].round(3).to_string())
