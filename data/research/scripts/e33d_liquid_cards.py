"""E33d - Does the relative reversal's edge over dev12 survive in LIQUID cards (more monthly sales -> PriceCharting's
monthly price is an average of more real sales, less estimation noise and less room for the E33c lag)?
E33b's bottom-decile test at h = 3 by this month's sales count: >= 2 (E33b), >= 5, >= 10. Band $50-500, sets >= 24 months,
decision months 2022-12..2026-06; excess over the same liquidity band, P(net20 > 0), net20.
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'e33_new_reversal_variants.py')).read().split("direction = {")[0])
from scipy.stats import rankdata
rows = []
for smin in (2, 5, 10):
    for j in range(months.index('2022-12'), months.index('2026-06') + 1):
        base = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= smin) & (age[:, j] >= 24) & np.isfinite(gross[:, j]) & np.isfinite(S['dev12'][:, j]) & np.isfinite(S['setdev'][:, j])
        if base.sum() < 60: continue
        idx = np.where(base)[0]
        rs = rankdata(S['setdev'][idx, j]) / len(idx)
        pdv = S['peerdev'][idx, j]; has = np.isfinite(pdv)
        rp = np.zeros(len(idx)); rp[has] = rankdata(pdv[has]) / has.sum()
        rel = np.where(has, (rs + rp) / 2, rs)
        for k, v in (('dev12', S['dev12'][idx, j]), ('setdev', S['setdev'][idx, j]), ('rel_combo', rel)):
            sel = idx[v <= np.quantile(v, 0.1)]
            rows.append({'min_sales': smin, 'month': months[j], 'signal': k, 'n_band': len(idx), 'n': len(sel), 'gross': gross[sel, j].mean(),
                         'band': gross[idx, j].mean(), 'p_net20': (net20[sel, j] > 0).mean(), 'net20': net20[sel, j].mean()})
M = pd.DataFrame(rows); M['excess'] = M.gross - M.band
out = M.groupby(['min_sales', 'signal']).agg(months=('month', 'nunique'), band_cards=('n_band', 'mean'), decile_cards=('n', 'mean'), decile_gross=('gross', 'mean'),
                                            excess=('excess', 'mean'), p_net20=('p_net20', 'mean'), net20=('net20', 'mean'),
                                            share_months_excess_pos=('excess', lambda s: (s > 0).mean())).reset_index()
ref = M[M.signal == 'dev12'].set_index(['min_sales', 'month']).gross
out['share_months_beats_dev12'] = [np.nan if r.signal == 'dev12' else (M[(M.signal == r.signal) & (M.min_sales == r.min_sales)].set_index(['min_sales', 'month']).gross > ref.reindex(M[(M.signal == r.signal) & (M.min_sales == r.min_sales)].set_index(['min_sales', 'month']).index)).mean() for r in out.itertuples()]
out.to_csv(os.path.join(OUT, 'E33d_liquid_cards.csv'), index=False, float_format='%.4f')
print(out.round(4).to_string(index=False))
