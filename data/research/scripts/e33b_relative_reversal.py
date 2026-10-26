"""E33b - Robustness of the relative-reversal signals found in E33 (peerdev, setdev) vs dev12: coverage of the band,
excess over the band by calendar year, by regime (reg3 > 0 or not), 1- and 6-month horizons, and a combined score
rel = mean of rank(setdev) and rank(peerdev) (setdev alone when the card has fewer than 2 other same-name printings).
Same universe as E33 (band $50-500, sales >= 2, set age >= 24 months), decision months 2022-12..2026-06 (h=6: ..2026-03).
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'e33_new_reversal_variants.py')).read().split("direction = {")[0])
from scipy.stats import rankdata
reg3 = F['reg3'][0]
rows = []
for h in (1, 3, 6):
    gross_h, net_h, _ = forward(P, F, h)
    fut = np.full_like(pr, np.nan); fut[:, :-h] = pr[:, h:]
    with np.errstate(all='ignore'):
        n20 = (fut * KEEP - FIXED - F['buy_real'] * 0.8) / (F['buy_real'] * 0.8)
    jmax = months.index('2026-06') if h < 6 else months.index('2026-03')
    for j in range(months.index('2022-12'), min(jmax, T - h - 1) + 1):
        base = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & (age[:, j] >= 24) & np.isfinite(gross_h[:, j]) & np.isfinite(S['dev12'][:, j])
        if base.sum() < 200: continue
        idx = np.where(base)[0]
        rs = rankdata(S['setdev'][idx, j]) / len(idx)
        pdv = S['peerdev'][idx, j]; has = np.isfinite(pdv)
        rp = np.full(len(idx), np.nan); rp[has] = rankdata(pdv[has]) / has.sum()
        rel = np.where(has, (rs + np.nan_to_num(rp)) / 2, rs)
        sigs = {'dev12': S['dev12'][idx, j], 'setdev': S['setdev'][idx, j], 'peerdev': pdv, 'rel_combo': rel}
        for k, v in sigs.items():
            ok = np.isfinite(v)
            if ok.sum() < 100: continue
            cut = np.quantile(v[ok], 0.1)
            sel = idx[ok][v[ok] <= cut]
            rows.append({'h': h, 'month': months[j], 'year': months[j][:4], 'up': reg3[j] > 0, 'signal': k, 'coverage': ok.mean(), 'n': len(sel),
                         'gross': gross_h[sel, j].mean(), 'band': gross_h[base, j].mean(), 'p_net20': (n20[sel, j] > 0).mean(), 'net20': n20[sel, j].mean()})
M = pd.DataFrame(rows); M['excess'] = M.gross - M.band
by_year = M.groupby(['h', 'signal', 'year']).excess.mean().unstack('year')
by_reg = M.groupby(['h', 'signal', 'up']).agg(excess=('excess', 'mean'), p_net20=('p_net20', 'mean'), net20=('net20', 'mean')).unstack('up')
summ = M.groupby(['h', 'signal']).agg(months=('month', 'nunique'), coverage=('coverage', 'mean'), decile_gross=('gross', 'mean'), excess=('excess', 'mean'),
                                       p_net20=('p_net20', 'mean'), net20=('net20', 'mean'), share_months_excess_pos=('excess', lambda s: (s > 0).mean()))
by_year.to_csv(os.path.join(OUT, 'E33b_relative_reversal_by_year.csv'), float_format='%.4f')
by_reg.to_csv(os.path.join(OUT, 'E33b_relative_reversal_by_regime.csv'), float_format='%.4f')
summ.to_csv(os.path.join(OUT, 'E33b_relative_reversal_summary.csv'), float_format='%.4f')
print(summ.round(4).to_string()); print(by_year.round(4).to_string()); print(by_reg.round(4).to_string())
