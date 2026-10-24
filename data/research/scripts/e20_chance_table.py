"""E20 - A chance table the Forecast tab could use directly: for a card ranked in bucket b of the band's dev12 ranking
(bottom 10% / 10-25% / 25-50% / top 50%), bought d under the standard price (0 / 10 / 15 / 20 / 25%), held h months
(1 / 2 / 3 / 6), in regime r (reg3 <= 0 vs > 0): the realised share of copies with net > 0 and the mean / 10th / 50th /
90th percentile net return, 2022-01 .. 2026-09, $50-$500, sets >= 24 months. The out-of-sample check: the table built on
2022-2024 vs realised 2025-2026 for the same cells.
Outputs: results/E20_chance_table.csv, results/E20_chance_table_oos.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED
from xs import features
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
reg3 = F['reg3'][0]
recs = []
for j in range(months.index('2022-01'), len(months) - 1):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    idx = np.where(ok)[0]
    if len(idx) < 100:
        continue
    rank = pd.Series(F['dev12'][idx, j]).rank(pct=True).values   # low = deepest below its 12-month mean
    bucket = np.where(rank <= 0.10, 'bottom10', np.where(rank <= 0.25, '10-25', np.where(rank <= 0.50, '25-50', 'top50')))
    b = F['buy_real'][idx, j]
    regime = 'up' if reg3[j] > 0 else 'down'
    for h in (1, 2, 3, 6):
        if j + h >= len(months):
            continue
        fut = pr[idx, j + h]
        okf = ~np.isnan(fut)
        for d in (0.0, 0.10, 0.15, 0.20, 0.25):
            nt = (fut[okf] * KEEP - FIXED - (1 - d) * b[okf]) / ((1 - d) * b[okf])
            for bk in ('bottom10', '10-25', '25-50', 'top50'):
                m = bucket[okf] == bk
                if m.sum() < 10:
                    continue
                recs.append((months[j], months[j][:4], regime, h, d, bk, int(m.sum()), (nt[m] > 0).mean(), nt[m].mean(), np.percentile(nt[m], 10), np.median(nt[m]), np.percentile(nt[m], 90)))
d = pd.DataFrame(recs, columns=['month', 'year', 'regime', 'h', 'discount', 'bucket', 'n', 'p_net_pos', 'net_mean', 'net_p10', 'net_p50', 'net_p90'])
keys = ['regime', 'h', 'discount', 'bucket']
def agg(x):
    w = x['n']
    return pd.Series(dict(months=len(x), copies=int(w.sum()), p_net_pos=np.average(x['p_net_pos'], weights=w), net_mean=np.average(x['net_mean'], weights=w), net_p10=np.average(x['net_p10'], weights=w), net_p50=np.average(x['net_p50'], weights=w), net_p90=np.average(x['net_p90'], weights=w)))
tab = d.groupby(keys).apply(agg).reset_index()
tab.round(4).to_csv(os.path.join(OUT, 'E20_chance_table.csv'), index=False)
# out of sample: fit 2022-2024, test 2025-2026
fit = d[d['year'] <= '2024'].groupby(keys).apply(agg).reset_index().rename(columns={'p_net_pos': 'p_fit', 'net_mean': 'net_fit'})[keys + ['p_fit', 'net_fit']]
test = d[d['year'] >= '2025'].groupby(keys).apply(agg).reset_index().rename(columns={'p_net_pos': 'p_test', 'net_mean': 'net_test'})[keys + ['p_test', 'net_test']]
oos = fit.merge(test, on=keys)
oos['p_err'] = oos['p_test'] - oos['p_fit']
oos.round(4).to_csv(os.path.join(OUT, 'E20_chance_table_oos.csv'), index=False)
pd.set_option('display.width', 250)
print(tab[(tab.h == 3) & (tab.discount.isin([0.0, 0.15, 0.20]))].round(3).to_string())
print('OOS (fit 2022-24 -> 2025-26), h=3:'); print(oos[(oos.h == 3) & (oos.discount.isin([0.15, 0.20]))].round(3).to_string())
print('mean |p_err| by regime:'); print(oos.groupby('regime')['p_err'].agg(['mean', lambda x: x.abs().mean()]).round(3).to_string())
