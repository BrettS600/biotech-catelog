"""E19 - Plan-construction knobs in the realistic simulation: per-card cap (20% / 10% / 5% of capital), price band
($50-500 / $50-250 / $100-250 / $100-500) and capital ($2k / $5k / $10k), with the strategy fixed at dev12 rank x sets
>= 24 months x 20% under x 12% availability x 1 copy x 3-month hold, gated reg3 > 0 and ungated, 5 draws.
Does a lower cap (more positions) reduce losing cycles without costing return? Is the $100-250 tier a better core?
Outputs: results/E19_cap_band_grid.csv
"""
import os, zlib, numpy as np, pandas as pd, warnings, itertools
from common import load_panel, KEEP, FIXED
from xs import features
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
reg3 = F['reg3'][0]
LAST = months.index('2026-09'); START = months.index('2022-01')
rng = np.random.RandomState(0)


def ranked(j, lo, hi):
    ok = (pr[:, j] >= lo) & (pr[:, j] <= hi) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    idx = np.where(ok)[0]
    return idx[np.argsort(F['dev12'][idx, j])]


def cycle(j, h, capital, share, lo, hi):
    idx = ranked(j, lo, hi)
    idx = idx[rng.rand(len(idx)) < 0.12]
    fut = pr[:, j + h]; cap_per = share * capital; cash = capital; proceeds = 0.0; nc = 0
    for i in idx:
        if cash < 40: break
        if np.isnan(fut[i]): continue
        buy = F['buy_real'][i, j] * 0.8
        q = int(min(cap_per // buy, cash // buy, 1))
        if q < 1: continue
        proceeds += q * (fut[i] * KEEP - FIXED); cash -= q * buy; nc += 1
    return proceeds + cash, nc, capital - cash

rows = []
h = 3
for c0, share, (lo, hi), gate in itertools.product((2000, 5000, 10000), (0.20, 0.10, 0.05), ((50, 500), (50, 250), (100, 250), (100, 500)), ('none', 'reg3>0')):
    rng.seed(zlib.crc32(repr((c0, share, lo, hi, gate)).encode()) & 0xFFFFFFFF)
    finals = []; rets = []; ncs = []; dep = []; idle = 0; total = 0
    for rep in range(5):
        for off in range(h):
            cap = float(c0); j = START + off
            while j + h <= LAST:
                total += 1
                if gate == 'reg3>0' and not reg3[j] > 0:
                    idle += 1; j += h; continue
                new_cap, nc, spent = cycle(j, h, cap, share, lo, hi)
                rets.append(new_cap / cap - 1); ncs.append(nc); dep.append(spent / cap); cap = new_cap; j += h
            finals.append(cap)
    years = (LAST - START) / 12
    rets = np.array(rets)
    rows.append(dict(c0=c0, cap_share=share, band='%d-%d' % (lo, hi), gate=gate, final_mean=np.mean(finals), final_min=np.min(finals), final_max=np.max(finals), cagr=(np.mean(finals) / c0) ** (1 / years) - 1, cycle_ret_mean=rets.mean(), p_cycle_loss=(rets < 0).mean(), worst_cycle=rets.min(), cards_per_cycle=np.mean(ncs), deployed_share=np.mean(dep), idle_share=idle / total))
g = pd.DataFrame(rows)
g.round(4).to_csv(os.path.join(OUT, 'E19_cap_band_grid.csv'), index=False)
pd.set_option('display.width', 250)
print(g[g.c0 == 5000].round(3).to_string())
print(g[(g.c0 != 5000) & (g.band == '50-500')].round(3).to_string())
