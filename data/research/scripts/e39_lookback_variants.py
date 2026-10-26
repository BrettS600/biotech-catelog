"""E39 - Which lookback for the relative (set-demeaned) reversal? setdevK = (price / K-month mean - 1) minus the set's median
of the same, K = 6, 12, 18, 24. E33 universe and metrics
(band $50-500, sales >= 2, sets >= 24 months, 3-month hold, 2022-12..2026-06): bottom-decile gross, excess over the band,
P(net > 0) and net at 20% under, share of months beating setdev12's decile, and Fama-MacBeth with setdev12 as control.
"""
import os, sys, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
ns = {'__file__': os.path.join(HERE, 'e33_new_reversal_variants.py')}
exec(compile(open(os.path.join(HERE, 'e33_new_reversal_variants.py')).read().split("direction = {")[0], 'e33', 'exec'), ns)
S, P, F = ns['S'], ns['P'], ns['F']; pr, sl, age = ns['pr'], ns['sl'], ns['age']; months = ns['months']
gross, net20 = ns['gross'], ns['net20']; set_code, name_code = ns['set_code'], ns['name_code']
from xs import _roll_mean
from scipy.stats import rankdata
import statsmodels.api as sm
T = pr.shape[1]
def demean(raw, code, how='median', min_n=1):
    out = np.full_like(pr, np.nan)
    for j in range(T):
        ok = (pr[:, j] >= 10) & (sl[:, j] >= 1) & np.isfinite(raw[:, j])
        s = pd.Series(raw[ok, j]); g = s.groupby(code[ok])
        if how == 'median':
            out[np.where(ok)[0], j] = (s - g.transform('median')).values
        else:
            sm_, cnt = g.transform('sum'), g.transform('count')
            out[np.where(ok)[0], j] = np.where(cnt >= 3, s - (sm_ - s) / (cnt - 1), np.nan)
    return out
sig = {}
with np.errstate(all='ignore'):
    for K in (6, 12, 18, 24):
        sig[f'setdev{K}'] = demean(pr / _roll_mean(pr, K) - 1, set_code)
rows, fm = [], []
for j in range(months.index('2022-12'), months.index('2026-06') + 1):
    base = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & (age[:, j] >= 24) & np.isfinite(gross[:, j]) & np.isfinite(sig['setdev12'][:, j])
    idx = np.where(base)[0]
    if len(idx) < 200: continue
    allsig = dict(sig)
    band = gross[idx, j].mean()
    sel12 = None
    for k, s in allsig.items():
        v = s[idx, j]
        ok = np.isfinite(v)
        if ok.sum() < 100: continue
        sel = idx[ok][v[ok] <= np.quantile(v[ok], 0.1)]
        rows.append({'month': months[j], 'signal': k, 'gross': gross[sel, j].mean(), 'band': band, 'p_net20': (net20[sel, j] > 0).mean(), 'net20': net20[sel, j].mean()})
        if k != 'setdev12':
            ok2 = ok & np.isfinite(sig['setdev12'][idx, j])
            y = gross[idx[ok2], j]; y = np.clip(y, np.quantile(y, .01), np.quantile(y, .99))
            f = sm.OLS(y, sm.add_constant(np.column_stack([rankdata(v[ok2]) / ok2.sum(), rankdata(sig['setdev12'][idx[ok2], j]) / ok2.sum()]))).fit()
            fm.append({'month': months[j], 'signal': k, 'slope': f.params[1], 'slope_setdev12': f.params[2]})
M = pd.DataFrame(rows); M['excess'] = M.gross - M.band
ref = M[M.signal == 'setdev12'].set_index('month').gross
def nw(x, L=3):
    x = np.asarray(x); e = x - x.mean(); Tn = len(x); v = e @ e / Tn
    for l in range(1, L + 1): v += 2 * (1 - l / (L + 1)) * (e[l:] @ e[:-l]) / Tn
    return x.mean() / np.sqrt(v / Tn)
FM = pd.DataFrame(fm)
out = M.groupby('signal').agg(months=('month', 'nunique'), decile_gross=('gross', 'mean'), excess=('excess', 'mean'), p_net20=('p_net20', 'mean'), net20=('net20', 'mean')).reset_index()
out['share_months_beats_setdev12'] = [np.nan if s == 'setdev12' else (M[M.signal == s].set_index('month').gross > ref).mean() for s in out.signal]
out['fm_slope'] = [np.nan if s == 'setdev12' else FM[FM.signal == s].slope.mean() for s in out.signal]
out['fm_nw_t'] = [np.nan if s == 'setdev12' else nw(FM[FM.signal == s].slope) for s in out.signal]
out['fm_nw_t_setdev12_control'] = [np.nan if s == 'setdev12' else nw(FM[FM.signal == s].slope_setdev12) for s in out.signal]
out.to_csv(os.path.join(HERE, '..', 'results', 'E39_lookback_variants.csv'), index=False, float_format='%.4f')
print(out.round(4).to_string(index=False))
