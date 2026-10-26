"""E33 - New reversal formulations borrowed from equity / pairs trading, tested against dev12 (the incumbent):
  ou3     Ornstein-Uhlenbeck (AR(1)) mean reversion fitted per card on the last 24 months of x = log(price / 12-month mean)
          (pairs (x_s, x_s+1) with s+1 <= t only); predicted 3-month log move = x_t (phi^3 - 1). High = buy.
  zdev    dev12 / the card's 12-month volatility of log moves (a Bollinger-style z-score). Low = buy.
  dev24   price vs its 24-month mean. Low = buy.
  peerdev dev12 minus the mean dev12 of the other cards of the same Pokemon (name without the number / brackets) in the
          universe that month (needs >= 2 other printings). Low = buy (cheap relative to the same character's other printings).
  setdev  dev12 minus the set's median dev12 (idiosyncratic deviation). Low = buy.
  max12   the largest single-month gain of the last 12 months (Bali-Cakici-Whitelaw 'MAX' lottery effect). Low = buy?
Universe: price $50-500, sales >= 2, set age >= 24 months, decision months 2022-12..2026-06 (dev24 and ou3 need 24 months
of history), 3-month hold, bought at the standard price (buy_real) and at 20% under it. For each signal: the 'buy'
decile's gross / net / P(net20 > 0), its excess
over the band, the share of months it beats dev12's decile, and a monthly rank regression (Fama-MacBeth) of the 3-month
gross return on rank(signal) with rank(dev12) as control (NW t, lag 3).
"""
import os, sys, re, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_panel, KEEP, FIXED
from xs import features, forward, _roll_mean, _roll_std, _shift
import statsmodels.api as sm
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
OUT = os.path.join(DATA, 'research', 'results')
P = load_panel(); F = features(P)
pr = F['price']; sl = F['sales']; months = list(P['months']); n, T = pr.shape
with np.errstate(all='ignore'):
    x = np.log(pr / _roll_mean(pr, 12))
    S = {}
    S['dev12'] = F['dev12']
    S['zdev'] = F['dev12'] / F['vol12']
    S['dev24'] = pr / _roll_mean(pr, 24) - 1
    r1 = np.log(pr) - np.log(_shift(pr, 1))
    mx = np.full_like(pr, np.nan)
    for j in range(11, T):
        mx[:, j] = np.nanmax(r1[:, j - 11:j + 1], axis=1)
    S['max12'] = mx
    ou = np.full_like(pr, np.nan)
    for j in range(24, T):
        X = x[:, j - 24:j]; Y = x[:, j - 23:j + 1]
        ok = ~np.isnan(X) & ~np.isnan(Y)
        sxx = np.where(ok, X * X, 0).sum(1); sxy = np.where(ok, X * Y, 0).sum(1)
        phi = np.clip(np.where((ok.sum(1) >= 12) & (sxx > 0), sxy / sxx, np.nan), -0.5, 0.999)
        ou[:, j] = x[:, j] * (phi ** 3 - 1)
    S['ou3'] = ou
# peers: same Pokemon name
names = P['cards']['name'].fillna('').str.replace(r'\[.*?\]', '', regex=True).str.replace(r'#.*$', '', regex=True).str.strip().str.lower().values
sets = P['cards']['set'].fillna('').values
_, name_code = np.unique(names, return_inverse=True); _, set_code = np.unique(sets, return_inverse=True)
age = F['age']
gross, net, futs = forward(P, F, 3)
fut = np.full_like(pr, np.nan); fut[:, :-3] = pr[:, 3:]
with np.errstate(all='ignore'):
    buy20 = F['buy_real'] * 0.8
    net20 = (fut * KEEP - FIXED - buy20) / buy20
peer = np.full_like(pr, np.nan); setd = np.full_like(pr, np.nan)
for j in range(T):
    ok = (pr[:, j] >= 10) & (sl[:, j] >= 1) & ~np.isnan(S['dev12'][:, j])
    d = pd.DataFrame({'n': name_code[ok], 's': set_code[ok], 'v': S['dev12'][ok, j]})
    gs = d.groupby('n')['v'].agg(['sum', 'count'])
    ssum = gs['sum'].reindex(d['n']).values; scnt = gs['count'].reindex(d['n']).values
    pm = np.where(scnt >= 3, (ssum - d['v'].values) / (scnt - 1), np.nan)
    peer[np.where(ok)[0], j] = d['v'].values - pm
    med = d.groupby('s')['v'].transform('median').values
    setd[np.where(ok)[0], j] = d['v'].values - med
S['peerdev'] = peer; S['setdev'] = setd
direction = {'dev12': 'low', 'zdev': 'low', 'dev24': 'low', 'max12': 'low', 'ou3': 'high', 'peerdev': 'low', 'setdev': 'low'}
j0, j1 = months.index('2022-12'), months.index('2026-06')   # 24 months of history for dev24 / ou3
rows, mon = [], []
from scipy.stats import rankdata
for j in range(j0, j1 + 1):
    base = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & (age[:, j] >= 24) & ~np.isnan(gross[:, j]) & ~np.isnan(S['dev12'][:, j])
    if base.sum() < 200: continue
    band_g, band_n20 = gross[base, j].mean(), np.nanmean(net20[base, j])
    picks = {}
    for k, s in S.items():
        ok = base & np.isfinite(s[:, j])
        if ok.sum() < 100: continue
        v = s[ok, j] if direction[k] == 'high' else -s[ok, j]
        cut = np.quantile(v, 0.9)
        sel = np.where(ok)[0][v >= cut]
        picks[k] = sel
        mon.append({'month': months[j], 'signal': k, 'n': len(sel), 'gross': gross[sel, j].mean(), 'net': net[sel, j].mean(),
                    'p_net20': (net20[sel, j] > 0).mean(), 'net20': net20[sel, j].mean(), 'band_gross': band_g, 'band_net20': band_n20})
        # Fama-MacBeth slope with dev12 control
        if k != 'dev12':
            ok2 = ok & np.isfinite(S['dev12'][:, j])
            yv = gross[ok2, j]; yv = np.clip(yv, np.quantile(yv, .01), np.quantile(yv, .99))
            a = rankdata(s[ok2, j]) / ok2.sum(); b = rankdata(S['dev12'][ok2, j]) / ok2.sum()
            f = sm.OLS(yv, sm.add_constant(np.column_stack([a, b]))).fit()
            rows.append({'month': months[j], 'signal': k, 'slope_signal': f.params[1], 'slope_dev12': f.params[2]})
M = pd.DataFrame(mon)
inc = M[M.signal == 'dev12'].set_index('month')['gross']
summ = []
for k, g in M.groupby('signal'):
    g = g.set_index('month')
    beats = (g['gross'] > inc.reindex(g.index)).mean() if k != 'dev12' else np.nan
    summ.append({'signal': k, 'buy_side': direction[k], 'months': len(g), 'decile_gross_3m': g.gross.mean(), 'band_gross_3m': g.band_gross.mean(),
                 'excess_over_band': (g.gross - g.band_gross).mean(), 'net_std_price': g.net.mean(), 'p_net_pos_20under': g.p_net20.mean(),
                 'net_20under': g.net20.mean(), 'share_months_beats_dev12_decile': beats})
fm = pd.DataFrame(rows)
def nw(x, L=3):
    x = np.asarray(x); x = x[~np.isnan(x)]; m = x.mean(); e = x - m; T_ = len(x)
    v = (e @ e) / T_
    for l in range(1, L + 1):
        v += 2 * (1 - l / (L + 1)) * (e[l:] @ e[:-l]) / T_
    return m / np.sqrt(v / T_)
fms = fm.groupby('signal').agg(mean_slope_signal=('slope_signal', 'mean'), mean_slope_dev12=('slope_dev12', 'mean')).reset_index()
fms['nw_t_signal'] = [nw(fm[fm.signal == s].slope_signal) for s in fms.signal]
fms['nw_t_dev12'] = [nw(fm[fm.signal == s].slope_dev12) for s in fms.signal]
out = pd.DataFrame(summ).merge(fms, on='signal', how='left')
out.to_csv(os.path.join(OUT, 'E33_reversal_variants.csv'), index=False, float_format='%.4f')
M.to_csv(os.path.join(OUT, 'E33_reversal_variants_monthly.csv'), index=False, float_format='%.4f')
print(out.round(4).to_string(index=False))
