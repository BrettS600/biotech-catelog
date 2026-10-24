"""E01 - The fee wall: what a buy-and-hold of h months at the standard price returns, gross and net of eBay fees,
by price tier and by year. No selection at all - this is the base rate every strategy must beat.
Outputs: results/E01_base_rates.csv, results/E01_market_monthly.csv
"""
import os, numpy as np, pandas as pd
from common import load_panel, breakeven_gross
from xs import features, forward

OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel()
F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']
tiers = [(10, 25), (25, 50), (50, 100), (100, 250), (250, 1000), (1000, 1e9)]
rows = []
for h in (1, 2, 3, 6):
    gross, net, futs = forward(P, F, h)
    for j in range(months.index('2021-06'), len(months) - h):
        yr = months[j][:4]
        for lo, hi in tiers:
            ok = (pr[:, j] >= lo) & (pr[:, j] < hi) & (sl[:, j] >= 2) & ~np.isnan(gross[:, j])
            if ok.sum() < 30:
                continue
            g, n = gross[ok, j], net[ok, j]
            be = breakeven_gross(F['buy_real'][ok, j])
            rows.append((h, months[j], yr, '%d-%d' % (lo, hi if hi < 1e9 else 99999), ok.sum(), g.mean(), np.median(g), n.mean(), np.median(n), (g > 0).mean(), (n > 0).mean(), (g > be).mean(), np.percentile(n, 10), np.percentile(n, 90)))
df = pd.DataFrame(rows, columns=['h', 'month', 'year', 'tier', 'n', 'gross_mean', 'gross_median', 'net_mean', 'net_median', 'p_gross_pos', 'p_net_pos', 'p_clears_fees', 'net_p10', 'net_p90'])
agg = df.groupby(['h', 'year', 'tier']).agg(months=('month', 'nunique'), n=('n', 'sum'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net_mean=('net_mean', 'mean'), net_median=('net_median', 'mean'), p_gross_pos=('p_gross_pos', 'mean'), p_net_pos=('p_net_pos', 'mean'), p_clears_fees=('p_clears_fees', 'mean'), net_p10=('net_p10', 'mean'), net_p90=('net_p90', 'mean')).reset_index()
allyrs = df.groupby(['h', 'tier']).agg(months=('month', 'nunique'), n=('n', 'sum'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net_mean=('net_mean', 'mean'), net_median=('net_median', 'mean'), p_gross_pos=('p_gross_pos', 'mean'), p_net_pos=('p_net_pos', 'mean'), p_clears_fees=('p_clears_fees', 'mean'), net_p10=('net_p10', 'mean'), net_p90=('net_p90', 'mean')).reset_index()
allyrs.insert(1, 'year', 'ALL')
out = pd.concat([allyrs, agg], ignore_index=True)
out.round(4).to_csv(os.path.join(OUT, 'E01_base_rates.csv'), index=False)

# market-wide monthly series (median move of $10+ cards with 2+ sales) for the regime work
mk = []
for j in range(1, len(months)):
    ok = (pr[:, j - 1] >= 10) & (sl[:, j] >= 2) & ~np.isnan(F['mom1'][:, j])
    m1 = F['mom1'][ok, j]
    ok50 = ok & (pr[:, j - 1] >= 50)
    mk.append((months[j], ok.sum(), np.median(m1), m1.mean(), (m1 > 0).mean(), np.median(F['mom1'][ok50, j]), np.nansum(sl[:, j]), np.nansum(pr[:, j] * sl[:, j]) / 1e6))
pd.DataFrame(mk, columns=['month', 'n', 'median_mom1', 'mean_mom1', 'breadth_up', 'median_mom1_50plus', 'total_sales', 'dollar_volume_musd']).round(5).to_csv(os.path.join(OUT, 'E01_market_monthly.csv'), index=False)
print(allyrs.round(3).to_string())
print(pd.DataFrame(mk, columns=['month', 'n', 'median_mom1', 'mean_mom1', 'breadth_up', 'median_mom1_50plus', 'total_sales', 'dollar_volume_musd']).tail(14).round(3).to_string())
