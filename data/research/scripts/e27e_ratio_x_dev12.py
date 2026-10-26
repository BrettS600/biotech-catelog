"""E27e - The one window we have (2026-09-28 -> 10-26), band $50-500: raw 28-day change and net return (eBay fee model;
bought at PriceCharting's price, or 15% / 20% under it; sold at PriceCharting's price 28 days later) by PSA 10 / raw ratio
quintile x dev12 tercile (dev12 as of September 2026 from the monthly panel). Shows whether the ratio and the reversal
stack. ONE window in a graded boom: an illustration, not a back-test.
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_panel
from daily_panel import load_daily, DATA
OUT = os.path.join(DATA, 'research', 'results')
P = load_panel(); D = load_daily()
months = list(P['months']); j = months.index('2026-09'); price = P['price']
m12 = np.nanmean(price[:, j - 11:j + 1], axis=1); cnt = np.sum(~np.isnan(price[:, j - 11:j + 1]), axis=1)
dev = pd.Series(np.where(cnt >= 9, price[:, j] / m12 - 1, np.nan), index=P['cards']['card_id'].to_numpy())
d0, d1 = D['dates'][0], D['dates'][-1]
r0, r1 = D['loose-price'][d0], D['loose-price'][d1]
df = pd.DataFrame({'r0': r0, 'r1': r1, 'ratio': D['manual-only-price'][d0] / r0, 'dev12': dev}).replace([np.inf, -np.inf], np.nan).dropna()
df = df[df.r0.between(50, 500) & (df.ratio > 0)]
df['chg'] = df.r1 / df.r0 - 1
KEEP = 1 - 0.1325 * 1.065
for disc in (0, 15, 20):
    df[f'net{disc}'] = (df.r1 * KEEP - 5.20 - df.r0 * (1 - disc / 100)) / (df.r0 * (1 - disc / 100))
df['ratio_q'] = pd.qcut(df.ratio.rank(method='first'), 5, labels=['Q1 low', 'Q2', 'Q3', 'Q4', 'Q5 high'])
df['dev_t'] = pd.qcut(df.dev12.rank(method='first'), 3, labels=['below 12m mean', 'middle', 'above'])
g = df.groupby(['ratio_q', 'dev_t'], observed=True).agg(cards=('chg', 'size'), mean_change=('chg', 'mean'), median_change=('chg', 'median'),
        p_net_pos_at_pc=('net0', lambda s: (s > 0).mean()), p_net_pos_15under=('net15', lambda s: (s > 0).mean()),
        p_net_pos_20under=('net20', lambda s: (s > 0).mean()), mean_net_20under=('net20', 'mean')).reset_index()
g.to_csv(os.path.join(OUT, 'E27e_ratio_x_dev12_window.csv'), index=False, float_format='%.4f')
print(g.round(3).to_string(index=False))
print(df.groupby('ratio_q', observed=True).agg(cards=('chg', 'size'), mean_change=('chg', 'mean'), p_net20=('net20', lambda s: (s > 0).mean()), mean_net20=('net20', 'mean')).round(3).to_string())
