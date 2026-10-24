"""E17 - Three follow-ups to E10/E12/E15 on the reversal strategy (dev12 bottom decile, $50-$500, sets >= 24 months):
(a) the reversal's horizon profile: cumulative gross and net (20% under) return h = 1..12 months after the signal, by
    regime - where does the reversal flatten, i.e. how long is worth holding?
(b) gate threshold sensitivity: reg3 > -1%, -0.5%, 0, +0.5%, +1%, +2% and the two-signal rule (reg1 > 0 and reg3 > 0)
    in the realistic simulation (3-month hold, 20% under, 12% availability, 1 copy, $5,000, 5 draws);
(c) fractional deployment by regime strength (a Kelly-flavoured sizing): deploy 0% when reg3 <= 0, 50% when
    0 < reg3 <= 1%, 100% above, vs all-or-nothing; and the 2-month hold that E12 flagged as the sweet spot.
Outputs: results/E17_horizon_profile.csv, results/E17_gate_thresholds.csv
"""
import os, zlib, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED
from xs import features
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
n_m = len(months)
reg3 = F['reg3'][0]; reg1 = F['reg1'][0]


def picks(j, decile_only=True):
    """The bottom dev12 decile of the band (for the horizon profile), or the whole band sorted by dev12 (for the
    simulation - as in E10, the buyer goes down the ranking until the money is spent: with 12% availability and $5,000
    the decile alone deploys only ~15% of capital, see the note)."""
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    idx = np.where(ok)[0]
    if len(idx) < 100:
        return None
    s = F['dev12'][idx, j]
    if decile_only:
        return idx[s <= np.percentile(s, 10)]
    return idx[np.argsort(s)]

# (a) horizon profile
rows = []
for j in range(months.index('2022-01'), n_m - 1):
    idx = picks(j)
    if idx is None:
        continue
    b = F['buy_real'][idx, j]
    regime = 'strong' if reg3[j] > 0.02 else ('flat' if reg3[j] > -0.005 else 'falling')
    for h in range(1, 13):
        if j + h >= n_m:
            break
        fut = pr[idx, j + h]
        ok = ~np.isnan(fut)
        if ok.sum() < 20:
            continue
        g = fut[ok] / b[ok] - 1
        n20 = (fut[ok] * KEEP - FIXED - 0.8 * b[ok]) / (0.8 * b[ok])
        # the band's own path for comparison
        okb = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(pr[:, j + h])
        gb = pr[okb, j + h] / F['buy_real'][okb, j] - 1
        rows.append((months[j], regime, h, ok.sum(), g.mean(), np.median(g), n20.mean(), (n20 > 0).mean(), gb.mean()))
d = pd.DataFrame(rows, columns=['month', 'regime', 'h', 'n', 'gross_mean', 'gross_median', 'net20_mean', 'p_net20_pos', 'band_gross'])
a1 = d.groupby('h').agg(months=('month', 'nunique'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net20_mean=('net20_mean', 'mean'), p_net20_pos=('p_net20_pos', 'mean'), band_gross=('band_gross', 'mean')).reset_index(); a1.insert(1, 'regime', 'ALL')
a2 = d.groupby(['regime', 'h']).agg(months=('month', 'nunique'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net20_mean=('net20_mean', 'mean'), p_net20_pos=('p_net20_pos', 'mean'), band_gross=('band_gross', 'mean')).reset_index()
prof = pd.concat([a1, a2], ignore_index=True)
prof['excess_vs_band'] = prof['gross_mean'] - prof['band_gross']
prof['net20_per_month'] = (1 + prof['net20_mean']) ** (1 / prof['h']) - 1
prof.round(4).to_csv(os.path.join(OUT, 'E17_horizon_profile.csv'), index=False)
pd.set_option('display.width', 250)
print(prof[prof.regime.isin(['ALL', 'strong', 'falling'])].round(3).to_string())

# (b)/(c) simulation variants
rng = np.random.RandomState(0)
LAST = months.index('2026-09'); START = months.index('2022-01')
def cycle(j, h, capital, disc, avail_p, max_copies):
    idx = picks(j, decile_only=False)
    if idx is None:
        return capital, 0
    idx = idx[rng.rand(len(idx)) < avail_p]
    fut = pr[:, j + h]; cap_per = 0.2 * capital; cash = capital; proceeds = 0.0; nc = 0
    for i in idx:
        if cash < 50 * (1 - disc): break
        if np.isnan(fut[i]): continue
        buy = F['buy_real'][i, j] * (1 - disc)
        q = int(min(cap_per // buy, cash // buy, min(max(1, int(sl[i, j] * 0.25)), max_copies)))
        if q < 1: continue
        proceeds += q * (fut[i] * KEEP - FIXED); cash -= q * buy; nc += 1
    return proceeds + cash, nc

def deploy_rule(name, j):
    r3, r1 = reg3[j], reg1[j]
    if name.startswith('reg3>'):
        return 1.0 if r3 > float(name[5:]) else 0.0
    if name == 'reg1&reg3>0':
        return 1.0 if (r3 > 0 and r1 > 0) else 0.0
    if name == 'reg1|reg3>0':
        return 1.0 if (r3 > 0 or r1 > 0) else 0.0
    if name == 'fractional':
        return 0.0 if r3 <= 0 else (0.5 if r3 <= 0.01 else 1.0)
    if name == 'fractional2':
        return 0.25 if r3 <= 0 else (0.6 if r3 <= 0.01 else 1.0)
    return 1.0

rows = []
for h in (2, 3):
    for gate in ('always', 'reg3>-0.01', 'reg3>-0.005', 'reg3>0', 'reg3>0.005', 'reg3>0.01', 'reg3>0.02', 'reg1&reg3>0', 'reg1|reg3>0', 'fractional', 'fractional2'):
        rng.seed(zlib.crc32((gate + str(h)).encode()) & 0xFFFFFFFF)
        finals = []; rets = []; idle = 0; total = 0; ncs = []
        for rep in range(5):
            for off in range(h):
                cap = 5000.0; j = START + off
                while j + h <= LAST:
                    total += 1
                    f = deploy_rule(gate, j)
                    if f <= 0:
                        idle += 1; j += h; continue
                    deployed = cap * f
                    new_dep, nc = cycle(j, h, deployed, 0.20, 0.12, 1); ncs.append(nc)
                    new_cap = new_dep + (cap - deployed)
                    rets.append(new_cap / cap - 1); cap = new_cap; j += h
                finals.append(cap)
        years = (LAST - START) / 12
        rets = np.array(rets)
        rows.append(dict(h=h, gate=gate, final_mean=np.mean(finals), final_min=np.min(finals), final_max=np.max(finals), cagr=(np.mean(finals) / 5000) ** (1 / years) - 1, idle_share=idle / total, cards_per_cycle=np.mean(ncs) if ncs else np.nan, cycle_ret_mean=rets.mean() if len(rets) else np.nan, p_cycle_loss=(rets < 0).mean() if len(rets) else np.nan, worst_cycle=rets.min() if len(rets) else np.nan))
g = pd.DataFrame(rows)
g.round(4).to_csv(os.path.join(OUT, 'E17_gate_thresholds.csv'), index=False)
print(g.round(3).to_string())
