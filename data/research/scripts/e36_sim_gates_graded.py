"""E36 - The reinvesting simulation (E10 engine, E34's relative-reversal ranking) with the new market gates from E28:
  reg3>0 (incumbent) | reg3>0 & graded1>0 (PSA 10 Top 250 index rose over the decision month) | reg1>0 & reg3>0 |
  graded1>0 alone | none.  graded1 for decision month m = index on the 1st of m+1 / the 1st of m - 1 (known at the end of m).
Rules dev12 and rel_combo; holds 1 / 2 / 3 months; 20% under with 12% availability (one copy), and 15% under with 25%;
$5,000; 5 availability draws; 2022-01..2026-09.
"""
import os, zlib, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
ns = {'__file__': os.path.join(HERE, 'e34_sim_relative_reversal.py')}
src = open(os.path.join(HERE, 'e34_sim_relative_reversal.py')).read().split('rows = []')[0]
exec(compile(src, 'e34', 'exec'), ns)
e10 = ns['ns']; F = e10['F']; months = e10['months']; START, LAST = e10['START'], e10['LAST']
DATA = os.path.abspath(os.path.join(HERE, '..', '..'))
g = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index.csv'), parse_dates=['date'])
g = g[g.date.dt.day == 1].set_index('date')['index_value']; gm = g.shift(-1) / g - 1; gm.index = gm.index.strftime('%Y-%m')
graded1 = np.array([gm.get(m, np.nan) for m in months])
reg1, reg3 = F['reg1'][0], F['reg3'][0]
GATES = {'none': lambda j: True, 'reg3>0': lambda j: reg3[j] > 0, 'reg3>0 & graded1>0': lambda j: reg3[j] > 0 and graded1[j] > 0,
         'reg1>0 & reg3>0': lambda j: reg1[j] > 0 and reg3[j] > 0, 'graded1>0': lambda j: graded1[j] > 0}
def run(h, rule, c0, disc, gate, avail, mc=1):
    rng = e10['rng']; rng.seed(zlib.crc32(repr((h, rule, c0, disc, gate, avail)).encode()) & 0xFFFFFFFF)
    finals, cyc_r, skips, trades, mdds = [], [], 0, 0, []
    for rep in range(5):
        for off in range(h):
            cap = c0; j = START + off; caps = [cap]
            while j + h <= LAST:
                if not GATES[gate](j):
                    skips += 1; j += h; caps.append(cap); continue
                new_cap, spent, nc, ncop = e10['cycle'](j, h, rule, cap, disc, 24, avail=avail, max_copies=mc)
                cyc_r.append(new_cap / cap - 1); trades += 1; cap = new_cap; j += h; caps.append(cap)
            finals.append(cap); c = np.array(caps); mdds.append((c / np.maximum.accumulate(c) - 1).min())
    yrs = (LAST - START) / 12
    cr = np.array(cyc_r)
    return {'h': h, 'rule': rule, 'c0': c0, 'disc': disc, 'avail': avail, 'gate': gate, 'final_mean': np.mean(finals), 'final_min': np.min(finals),
            'cagr': (np.mean(finals) / c0) ** (1 / yrs) - 1, 'p_cycle_loss': (cr < 0).mean() if len(cr) else np.nan,
            'worst_cycle': cr.min() if len(cr) else np.nan, 'max_drawdown': np.mean(mdds), 'share_cycles_skipped': skips / max(1, skips + trades)}
rows = []
for h in (1, 2, 3):
    for rule in ('dev12', 'rel_combo'):
        for disc, avail in ((0.20, 0.12), (0.15, 0.25)):
            for gate in GATES:
                rows.append(run(h, rule, 5000, disc, gate, avail))
r = pd.DataFrame(rows); r.to_csv(os.path.join(HERE, '..', 'results', 'E36_sim_gates_graded.csv'), index=False, float_format='%.4f')
print(r.round(3).to_string(index=False))
