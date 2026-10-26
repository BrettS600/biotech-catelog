"""E38 - Why the relative reversal works: split dev12 into a group component and the card's own deviation, and price each
part separately (Fama-MacBeth, rank-normalised, NW t lag 3; band $50-500, sales >= 2, sets >= 24 months, 3-month gross,
2022-12..2026-06). Groups: set (median dev12 of the set's cards), Pokemon name (mean of the other printings), set x rarity,
price tier (quintile of price within the month). If the group part carries no reversal (or momentum), demeaning by that
group sharpens the signal.
"""
import os, sys, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
ns = {'__file__': os.path.join(HERE, 'e33_new_reversal_variants.py')}
exec(compile(open(os.path.join(HERE, 'e33_new_reversal_variants.py')).read().split("direction = {")[0], 'e33', 'exec'), ns)
S, P, F = ns['S'], ns['P'], ns['F']; pr, sl, age = ns['pr'], ns['sl'], ns['age']; months = ns['months']
from xs import forward
from scipy.stats import rankdata
import statsmodels.api as sm
gross, _, _ = forward(P, F, 3)
rar = P['cards']['rarity'].fillna('').values; sets = P['cards']['set'].fillna('').values
_, sr_code = np.unique(np.char.add(sets.astype(str), rar.astype(str)), return_inverse=True)
_, set_code = np.unique(sets, return_inverse=True)
dev = S['dev12']
rows = []
for j in range(months.index('2022-12'), months.index('2026-06') + 1):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & (age[:, j] >= 24) & np.isfinite(gross[:, j]) & np.isfinite(dev[:, j]) & np.isfinite(S['setdev'][:, j])
    idx = np.where(ok)[0]
    if len(idx) < 200: continue
    d = pd.DataFrame({'dev': dev[idx, j], 'set_comp': dev[idx, j] - S['setdev'][idx, j], 'name_comp': dev[idx, j] - S['peerdev'][idx, j],
                      'sr': sr_code[idx], 'p': pr[idx, j], 'y': gross[idx, j]})
    allok = (pr[:, j] >= 10) & (sl[:, j] >= 1) & np.isfinite(dev[:, j])
    srm = pd.Series(dev[allok, j]).groupby(sr_code[allok]).median()
    d['sr_comp'] = srm.reindex(d.sr).values
    d['ptier_comp'] = d.groupby(pd.qcut(d.p.rank(method='first'), 5, labels=False)).dev.transform('median')
    d['y'] = d.y.clip(d.y.quantile(.01), d.y.quantile(.99))
    rk = lambda s: rankdata(s) / len(s)
    for split in ('set', 'name', 'sr', 'ptier'):
        comp = d[f'{split}_comp']
        m = comp.notna().values
        if m.sum() < 150: continue
        own = (d.dev - comp)[m]
        f = sm.OLS(d.y[m].values, sm.add_constant(np.column_stack([rk(comp[m]), rk(own)]))).fit()
        rows.append({'month': months[j], 'group': split, 'slope_group_part': f.params[1], 'slope_own_part': f.params[2], 'n': int(m.sum())})
R = pd.DataFrame(rows)
def nw(x, L=3):
    x = np.asarray(x); e = x - x.mean(); T = len(x); v = e @ e / T
    for l in range(1, L + 1): v += 2 * (1 - l / (L + 1)) * (e[l:] @ e[:-l]) / T
    return x.mean() / np.sqrt(v / T)
out = R.groupby('group').agg(months=('month', 'nunique'), mean_slope_group_part=('slope_group_part', 'mean'), mean_slope_own_part=('slope_own_part', 'mean')).reset_index()
out['nw_t_group_part'] = [nw(R[R.group == g].slope_group_part) for g in out.group]
out['nw_t_own_part'] = [nw(R[R.group == g].slope_own_part) for g in out.group]
out.to_csv(os.path.join(HERE, '..', 'results', 'E38_dev12_decomposition.csv'), index=False, float_format='%.4f')
print(out.round(4).to_string(index=False))
