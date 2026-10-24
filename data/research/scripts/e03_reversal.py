"""E03 - Is the reversal real, and does anything clear the fee wall inside the $50-$500 buying band?
E02 found a strong reversal at every horizon (the biggest 3/6/12-month losers beat the universe at 3 and 6 months)
and that past winners lose. Two worries: (a) PriceCharting's monthly price is an average of a few sales, so a dip made
of 2-3 low sales bounces back mechanically - noise reversion you cannot trade; (b) the universe is dominated by $10
cards that can never clear the $5.20 fixed costs. Here: the same tables restricted to $50-$500, the reversal split by
how many sales made the dip (real move vs noise), and split by market regime.
Outputs: results/E03_band_signals.csv, results/E03_reversal_by_sales.csv, results/E03_reversal_by_regime.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED
from xs import features, decile_table, summarize, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']

# (1) signal zoo inside the band
rows = []
for h in (1, 3, 6):
    for s in ['mom1', 'mom3', 'mom12', 'mom12x1', 'dev3', 'dev6', 'dev12', 'hi12', 'lo12', 'vol6', 'vgrow', 'vz', 'lv', 'age', 'set_mom1', 'set_mom3', 'rel_mom1', 'stale', 'pv_up', 'accel']:
        tab, sp = decile_table(P, F, s, h, pmin=50, pmax=500, vmin=2, start='2022-01')
        if len(sp) == 0:
            continue
        r = summarize(tab, sp, s, h); r['band'] = '50-500'
        rows.append(r)
        print('BAND h=%d %-9s top %+.3f bot %+.3f uni %+.3f spread %+.3f hit %.2f t %+.1f | top net %+.3f pNet %.2f | bot net %+.3f pNet %.2f' % (h, s, r['top_gross'], r['bottom_gross'], r['uni_gross'], r['spread_top_uni_gross'], r['hit_rate'], r['t_stat'], r['top_net'], r['top_p_net_pos'], r['bottom_net'], r['bottom_p_net_pos']))
pd.DataFrame(rows).round(4).to_csv(os.path.join(OUT, 'E03_band_signals.csv'), index=False)

# (2) reversal realness: bottom decile of dev12 (far below the 12-month mean) split by this month's sales count
def split_table(sig, h, pmin, pmax, groups, label):
    gross, net, futs = forward(P, F, h)
    out = []
    for j in range(months.index('2022-01'), len(months) - h):
        ok = (pr[:, j] >= pmin) & (pr[:, j] <= pmax) & (sl[:, j] >= 2) & ~np.isnan(gross[:, j]) & ~np.isnan(F[sig][:, j])
        if ok.sum() < 300:
            continue
        s = F[sig][ok, j]; g = gross[ok, j]; n = net[ok, j]; v = sl[ok, j]; reg = F['reg3'][0, j]
        q = pd.qcut(pd.Series(s).rank(method='first'), 10, labels=False).values
        for name, lo, hi in groups:
            for dec, dl in ((0, 'bottom'), (9, 'top'), (None, 'all')):
                m = (q == dec) if dec is not None else np.ones_like(q, bool)
                m = m & (v >= lo) & (v < hi)
                if m.sum() >= 10:
                    out.append((label, h, months[j], reg, name, dl, m.sum(), g[m].mean(), np.median(g[m]), n[m].mean(), (n[m] > 0).mean(), g.mean()))
    df = pd.DataFrame(out, columns=['signal', 'h', 'month', 'reg3', 'group', 'decile', 'n', 'gross_mean', 'gross_median', 'net_mean', 'p_net_pos', 'uni_gross'])
    return df
groups = [('sales 2-4', 2, 5), ('sales 5-9', 5, 10), ('sales 10-24', 10, 25), ('sales 25+', 25, 1e9)]
parts = []
for sig in ('dev12', 'mom3', 'dev3'):
    for h in (1, 3, 6):
        for band in ((10, 1e9, 'all 10+'), (50, 500, '50-500')):
            d = split_table(sig, h, band[0], band[1], groups, sig)
            d['band'] = band[2]
            parts.append(d)
df = pd.concat(parts)
agg = df.groupby(['signal', 'band', 'h', 'group', 'decile']).agg(months=('month', 'nunique'), n=('n', 'sum'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net_mean=('net_mean', 'mean'), p_net_pos=('p_net_pos', 'mean'), uni_gross=('uni_gross', 'mean')).reset_index()
agg.round(4).to_csv(os.path.join(OUT, 'E03_reversal_by_sales.csv'), index=False)
print(agg[(agg.signal == 'dev12') & (agg.decile == 'bottom')].round(3).to_string())

# (3) by regime: reg3 (trailing 3-month median market move) terciles
df['regime'] = pd.cut(df['reg3'], [-1, -0.005, 0.02, 1], labels=['falling', 'flat', 'strong'])
agg2 = df.groupby(['signal', 'band', 'h', 'regime', 'decile'], observed=True).agg(months=('month', 'nunique'), n=('n', 'sum'), gross_mean=('gross_mean', 'mean'), net_mean=('net_mean', 'mean'), p_net_pos=('p_net_pos', 'mean'), uni_gross=('uni_gross', 'mean')).reset_index()
agg2.round(4).to_csv(os.path.join(OUT, 'E03_reversal_by_regime.csv'), index=False)
print(agg2[(agg2.signal == 'dev12') & (agg2.band == '50-500')].round(3).to_string())
