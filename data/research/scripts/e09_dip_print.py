"""E09 - Buying the dip at the dipped print. The standard price refuses to buy below the 3-month mean. But when a card's
PriceCharting price fell this month on MANY sales (10+), real copies changed hands at the lower level, and the eBay
collector sees asks there. What does the mean-reversion trade pay if the buy is this month's print (buy = price_t)
instead of buy_real? Deciles of dev3 (price vs its 3-month mean) and dev12, by sales count, 1 and 3 months.
Also the honest middle: buy at the average of price_t and buy_real (half the dip captured).
Outputs: results/E09_dip_print.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED
from xs import features
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
rows = []
for h in (1, 3):
    fut = np.full_like(pr, np.nan); fut[:, :-h] = pr[:, h:]
    for sig in ('dev3', 'dev12', 'mom1'):
        for j in range(months.index('2022-01'), len(months) - h):
            reg = F['reg3'][0, j]
            for vlo, vhi, vlab in ((2, 10, 'sales 2-9'), (10, 1e9, 'sales 10+')):
                ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= vlo) & (sl[:, j] < vhi) & ~np.isnan(fut[:, j]) & ~np.isnan(F[sig][:, j])
                if ok.sum() < 100:
                    continue
                s = F[sig][ok, j]; f = fut[ok, j]; p = pr[ok, j]; br = F['buy_real'][ok, j]
                q = pd.qcut(pd.Series(s).rank(method='first'), 5, labels=False).values   # quintiles (smaller groups)
                for dec, dl in ((0, 'bottom20'), (4, 'top20'), (None, 'all')):
                    m = (q == dec) if dec is not None else np.ones_like(q, bool)
                    if m.sum() < 10:
                        continue
                    for bl, buy in (('standard', br[m]), ('print', p[m]), ('half', 0.5 * (p[m] + br[m]))):
                        g = f[m] / buy - 1; nt = (f[m] * KEEP - FIXED - buy) / buy
                        rows.append((h, sig, months[j], 'strong' if reg > 0.02 else ('flat' if reg > -0.005 else 'falling'), vlab, dl, bl, m.sum(), g.mean(), np.median(g), nt.mean(), (nt > 0).mean(), (buy / br[m]).mean()))
df = pd.DataFrame(rows, columns=['h', 'signal', 'month', 'regime', 'sales', 'group', 'buy_at', 'n', 'gross_mean', 'gross_median', 'net_mean', 'p_net_pos', 'buy_over_standard'])
agg = df.groupby(['h', 'signal', 'sales', 'group', 'buy_at']).agg(months=('month', 'nunique'), n=('n', 'sum'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net_mean=('net_mean', 'mean'), p_net_pos=('p_net_pos', 'mean'), buy_over_standard=('buy_over_standard', 'mean')).reset_index()
agg.insert(1, 'regime', 'ALL')
agg2 = df.groupby(['h', 'regime', 'signal', 'sales', 'group', 'buy_at']).agg(months=('month', 'nunique'), n=('n', 'sum'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net_mean=('net_mean', 'mean'), p_net_pos=('p_net_pos', 'mean'), buy_over_standard=('buy_over_standard', 'mean')).reset_index()
out = pd.concat([agg, agg2], ignore_index=True)
out.round(4).to_csv(os.path.join(OUT, 'E09_dip_print.csv'), index=False)
pd.set_option('display.width', 250)
print(out[(out.group == 'bottom20') & (out.regime.isin(['ALL', 'strong']))].round(3).to_string())
