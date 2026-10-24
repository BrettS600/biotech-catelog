"""E25 - Stress test of the E24 headline (anchor exit, $5k, 20% under, 12% availability): how much survives when the
optimistic assumptions are removed one at a time and all together?
  base          E24 as run (sell at the month's PriceCharting price in the exit month)
  sell_at_anchor the copy is listed at max(anchor, price at purchase) and the target exit pays that listing price
                 (the month's average only decides whether it sold), not the month's average
  min_hold_2    no exit before month 2 (shipping in, listing, payout: the 1-month flip is not available)
  avail_6       half the discounted floors (6% of band cards instead of 12%)
  haircut       5% of positions (seeded) sell 30% below the planned price (condition / forced sale)
  all           every penalty at once
for rules fixed_3 and target_1.00, ungated and gated, 5 draws, 2022-01 .. 2026-09.
Outputs: results/E25_exit_rule_stress.csv
"""
import os, zlib, numpy as np, pandas as pd, warnings, itertools
from common import load_panel, KEEP, FIXED
from xs import features, _roll_mean
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
reg3 = F['reg3'][0]
m12 = _roll_mean(pr, 12)
H = 6; DISC = 0.20; CAP = 0.20
START, LAST = months.index('2022-01'), months.index('2026-09')
BUY_END = LAST - H


def ranked(j):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    ok &= ~np.isnan(pr[:, j + 1:j + H + 1]).any(1)
    idx = np.where(ok)[0]
    return idx[np.argsort(F['dev12'][idx, j])]


def plan_exit(rule, i, j, min_hold, sell_at_anchor):
    """-> (exit month, planned sell price)"""
    if rule.startswith('fixed_'):
        h = int(rule.split('_')[1]); return j + h, pr[i, j + h]
    anchor = m12[i, j]
    listing = max(anchor, pr[i, j])          # never list below the current market price
    for m in range(min_hold, H + 1):
        if pr[i, j + m] >= (listing if sell_at_anchor else anchor):
            return j + m, (listing if sell_at_anchor else pr[i, j + m])
    return j + H, pr[i, j + H]


def run(rule, gate, c0, seed, sell_at_anchor=False, min_hold=1, avail=0.12, haircut=False):
    rng = np.random.RandomState(seed)
    cash = float(c0); open_pos = {}; bought = []; equity = []
    for j in range(START, LAST + 1):
        for i in [i for i, v in open_pos.items() if v[0] == j]:
            ej, cost, sell = open_pos.pop(i); cash += sell * KEEP - FIXED
        if j <= BUY_END and (gate == 'none' or reg3[j] > 0):
            book = sum(v[1] for v in open_pos.values())
            cands = ranked(j); cands = cands[rng.rand(len(cands)) < avail]
            for i in cands:
                if cash < 40: break
                if i in open_pos: continue
                buy = F['buy_real'][i, j] * (1 - DISC)
                if buy > cash or buy > CAP * (cash + book): continue
                ej, sell = plan_exit(rule, i, j, min_hold, sell_at_anchor)
                if haircut and rng.rand() < 0.05: sell *= 0.70
                open_pos[i] = (ej, buy, sell); cash -= buy; book += buy
                bought.append((buy, sell * KEEP - FIXED, ej - j))
        equity.append(cash + sum(max(pr[i, j] * KEEP - FIXED, 0.0) for i in open_pos))
    equity = np.array(equity); years = (LAST - START) / 12
    nets = np.array([(s - b) / b for b, s, _ in bought])
    return dict(final=cash, cagr=(cash / c0) ** (1 / years) - 1, max_dd=(equity / np.maximum.accumulate(equity) - 1).min(), positions=len(bought), months_held=np.mean([m for _, _, m in bought]), net_mean=nets.mean(), p_net_pos=(nets > 0).mean())

SCEN = {'base': {}, 'sell_at_anchor': dict(sell_at_anchor=True), 'min_hold_2': dict(min_hold=2), 'avail_6': dict(avail=0.06), 'haircut': dict(haircut=True),
        'all': dict(sell_at_anchor=True, min_hold=2, avail=0.06, haircut=True)}
rows = []
for scen, rule, gate in itertools.product(SCEN, ('fixed_3', 'target_1.00'), ('none', 'reg3>0')):
    res = [run(rule, gate, 5000, zlib.crc32(repr((rule, gate, 5000, rep)).encode()) & 0xFFFFFFFF, **SCEN[scen]) for rep in range(5)]
    d = pd.DataFrame(res); m = d.mean().to_dict()
    rows.append(dict(scenario=scen, rule=rule, gate=gate, **m, final_min=d['final'].min(), final_max=d['final'].max()))
out = pd.DataFrame(rows); out.round(4).to_csv(os.path.join(OUT, 'E25_exit_rule_stress.csv'), index=False)
pd.set_option('display.width', 250); print(out.round(3).to_string())
