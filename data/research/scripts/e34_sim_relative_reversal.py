"""E34 - The E10 reinvesting-flipper simulation with the relative-reversal rankings from E33/E33b in place of dev12.
Same engine (e10_portfolio_sim.py, executed up to its grid): non-overlapping cycles from every start offset, eBay fees,
20% per-card cap, liquidity cap, sets >= 24 months, discount availability draws (5 seeds), 2022-01..2026-09.
Rules: dev12 (incumbent), setdev (dev12 minus the set's median dev12), rel_combo (mean rank of setdev and peerdev, setdev
alone with fewer than 2 other same-name printings). Holds 1 / 2 / 3; 20% under with 12% availability and 15% under with 25%; one copy per
card; gate none / reg3>0; $2k / $5k / $10k.
"""
import os, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
ns = {'__file__': os.path.join(HERE, 'e10_portfolio_sim.py')}
src = open(os.path.join(HERE, 'e10_portfolio_sim.py')).read().split('summs, cycs = [], []')[0]
exec(compile(src, 'e10_portfolio_sim.py', 'exec'), ns)
ns2 = {'__file__': os.path.join(HERE, 'e33_new_reversal_variants.py')}
src2 = open(os.path.join(HERE, 'e33_new_reversal_variants.py')).read().split("direction = {")[0]
exec(compile(src2, 'e33', 'exec'), ns2)
S = ns2['S']; F = ns['F']; pr = ns['pr']; sl = ns['sl']; rng = ns['rng']
old_candidates = ns['candidates']
def candidates(j, rule, age_min):
    if rule not in ('setdev', 'rel_combo'):
        return old_candidates(j, rule, age_min)
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & np.isfinite(F['dev12'][:, j]) & np.isfinite(S['setdev'][:, j])
    if age_min:
        ok &= (F['age'][:, j] >= age_min) | np.isnan(F['age'][:, j])
    idx = np.where(ok)[0]
    rs = pd.Series(S['setdev'][idx, j]).rank(pct=True).values
    if rule == 'setdev':
        score = rs
    else:
        pdv = S['peerdev'][idx, j]; has = np.isfinite(pdv)
        rp = np.zeros(len(idx)); rp[has] = pd.Series(pdv[has]).rank(pct=True).values
        score = np.where(has, (rs + rp) / 2, rs)
    return idx[np.argsort(score)]
ns['candidates'] = candidates
rows = []
for h in (1, 2, 3):
    for rule in ('dev12', 'setdev', 'rel_combo'):
        for disc, avail in ((0.20, 0.12), (0.15, 0.25)):
            for gate in ('none', 'reg3>0'):
                for c0 in ((2000, 5000, 10000) if h == 3 else (5000,)):
                    s, _ = ns['run'](h, rule, c0, disc, gate, 24, avail=avail, max_copies=1)
                    rows.append(s)
r = pd.DataFrame(rows)
r.to_csv(os.path.join(HERE, '..', 'results', 'E34_sim_relative_reversal.csv'), index=False, float_format='%.4f')
print(r[['h', 'rule', 'c0', 'disc', 'avail', 'gate', 'final_mean', 'final_min', 'final_max', 'cagr', 'p_cycle_loss', 'worst_cycle', 'max_drawdown', 'cards_per_cycle', 'spent_share']].round(3).to_string(index=False))
