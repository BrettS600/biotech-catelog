"""E37 - A paired (common-random-numbers) comparison of the rankings in the reinvesting simulation. E34 / E36 gave each
rule its own availability draws, so their +/-10-15% draw noise hides a few points of difference. Here every rule sees the
SAME draws: for each repetition, each card-month is 'available at the discount' or not once, shared by all rules.
20 repetitions; E10's mechanics otherwise (20% cap, one copy, liquidity cap, sets >= 24 months, fees, every start
offset). Rules dev12 / setdev / rel_combo; holds 2 and 3; 20% under @ 12% availability and 15% under @ 25%; gates none
and reg3>0; $5,000. Reported: mean final capital per rule, and the paired difference vs dev12 (mean, share of draws
better, t).
"""
import os, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
ns = {'__file__': os.path.join(HERE, 'e34_sim_relative_reversal.py')}
exec(compile(open(os.path.join(HERE, 'e34_sim_relative_reversal.py')).read().split('rows = []')[0], 'e34', 'exec'), ns)
e10 = ns['ns']; F = e10['F']; pr, sl = e10['pr'], e10['sl']; months = e10['months']; START, LAST = e10['START'], e10['LAST']
KEEP, FIXED = e10['KEEP'], e10['FIXED']; cand = ns['candidates']; reg3 = F['reg3'][0]
order_cache = {}
def order(j, rule):
    k = (j, rule)
    if k not in order_cache: order_cache[k] = cand(j, rule, 24)
    return order_cache[k]
def cycle(j, h, rule, capital, disc, avail_row):
    fut = pr[:, j + h]; cap_per = 0.20 * capital; cash = capital; proceeds = 0.0
    for i in order(j, rule):
        if not avail_row[i]: continue
        if cash < 50 * (1 - disc): break
        if np.isnan(fut[i]): continue
        buy = F['buy_real'][i, j] * (1 - disc)
        q = int(min(cap_per // buy, cash // buy, 1))
        if q < 1: continue
        proceeds += q * (fut[i] * KEEP - FIXED); cash -= q * buy
    return proceeds + cash
REPS = 20
rows = []
for h in (2, 3):
    for disc, av in ((0.20, 0.12), (0.15, 0.25)):
        draws = [np.random.RandomState(1000 + rep).rand(pr.shape[0], pr.shape[1]) < av for rep in range(REPS)]
        for gate in ('none', 'reg3>0'):
            res = {}
            for rule in ('dev12', 'setdev', 'rel_combo'):
                finals = []
                for rep in range(REPS):
                    fin = []
                    for off in range(h):
                        cap = 5000.0; j = START + off
                        while j + h <= LAST:
                            if gate == 'reg3>0' and not reg3[j] > 0:
                                j += h; continue
                            cap = cycle(j, h, rule, cap, disc, draws[rep][:, j]); j += h
                        fin.append(cap)
                    finals.append(np.mean(fin))
                res[rule] = np.array(finals)
            for rule, f in res.items():
                d = f - res['dev12']
                rows.append({'h': h, 'disc': disc, 'avail': av, 'gate': gate, 'rule': rule, 'final_mean': f.mean(), 'final_p10': np.quantile(f, .1), 'final_p90': np.quantile(f, .9),
                             'cagr': (f.mean() / 5000) ** (12 / (LAST - START)) - 1,
                             'paired_diff_vs_dev12': d.mean(), 'share_draws_better': (d > 0).mean() if rule != 'dev12' else np.nan,
                             't_paired': d.mean() / (d.std(ddof=1) / np.sqrt(REPS)) if rule != 'dev12' and d.std() > 0 else np.nan})
r = pd.DataFrame(rows); r.to_csv(os.path.join(HERE, '..', 'results', 'E37_paired_sim.csv'), index=False, float_format='%.4f')
print(r.round(3).to_string(index=False))
