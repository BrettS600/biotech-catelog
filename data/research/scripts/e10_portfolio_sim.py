"""E10 - Reinvesting-flipper simulation: what would $2,000 / $5,000 / $10,000 have become, 2022-01 .. 2026-09, cycling
the whole bankroll every h months through the top-ranked cards, with eBay fees, a per-card cap (20% of capital),
a liquidity cap (supply = max(1, floor(0.25 x monthly sales)) copies), an optional regime gate, and an optional
discount under the standard price. Non-overlapping cycles: buy at t, sell at t+h at PriceCharting's level, reinvest.
Each configuration is run from every possible starting offset (0..h-1) and the paths are averaged.
Rules: dev12 (deepest below 12-month mean first), mom12 (biggest 12-month loser first), combo (dev12 rank + set_mom1
rank, sets >= 24 months old), setmom (set momentum, sets >= 24 months), random (benchmark), top_mom3 (anti-test: chase
3-month winners).
Outputs: results/E10_sim_summary.csv, results/E10_sim_cycles.csv
"""
import os, numpy as np, pandas as pd, warnings, itertools
from common import load_panel, KEEP, FIXED
from xs import features
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
n_m = len(months)
LAST = months.index('2026-09')   # last complete month; a cycle must end by here
START = months.index('2022-01')
rng = np.random.RandomState(7)


def candidates(j, rule, age_min):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ~np.isnan(F['set_mom1'][:, j])
    if age_min:
        ok &= (F['age'][:, j] >= age_min) | np.isnan(F['age'][:, j])
    idx = np.where(ok)[0]
    if rule == 'dev12':
        score = F['dev12'][idx, j]
    elif rule == 'mom12':
        score = F['mom12'][idx, j]
    elif rule == 'combo':
        r1 = pd.Series(F['dev12'][idx, j]).rank(pct=True).values
        r2 = pd.Series(-F['set_mom1'][idx, j]).rank(pct=True).values
        score = r1 + r2
    elif rule == 'setmom':
        score = -F['set_mom1'][idx, j]
    elif rule == 'top_mom3':
        score = -F['mom3'][idx, j]
    else:
        score = rng.rand(len(idx))
    return idx[np.argsort(score)]


def cycle(j, h, rule, capital, disc, age_min, share=0.20, sell_prem=0.0, avail=1.0, max_copies=None):
    """Invest `capital` at month j, sell at j+h. Returns (proceeds, spent, n_cards, n_copies).
    avail < 1: each candidate is buyable at the discount only with probability `avail` (a floor listing exists);
    max_copies: cap on copies per card (a floor listing is usually one copy)."""
    order = candidates(j, rule, age_min)
    if avail < 1.0:
        order = order[rng.rand(len(order)) < avail]
    fut = pr[:, j + h]
    cap_per = share * capital
    cash = capital; spent = 0.0; proceeds = 0.0; nc = 0; ncop = 0
    for i in order:
        if cash < 50 * (1 - disc):
            break
        if np.isnan(fut[i]):
            continue
        buy = F['buy_real'][i, j] * (1 - disc)
        supply = max(1, int(sl[i, j] * 0.25))
        if max_copies:
            supply = min(supply, max_copies)
        q = int(min(cap_per // buy, cash // buy, supply))
        if q < 1:
            continue
        cost = q * buy
        sell = fut[i] * (1 + sell_prem)
        proceeds += q * (sell * KEEP - FIXED)
        cash -= cost; spent += cost; nc += 1; ncop += q
    return proceeds + cash, spent, nc, ncop


def run(h, rule, c0, disc, gate, age_min, sell_prem=0.0, avail=1.0, max_copies=None):
    paths = []
    rows = []
    for off in range(h):
        cap = c0; j = START + off; path = [(months[j], cap)]
        while j + h <= LAST:
            reg = F['reg3'][0, j]
            gated = (gate == 'reg3>0' and not reg > 0) or (gate == 'reg3>2%' and not reg > 0.02)
            if gated:
                rows.append((h, rule, c0, disc, gate, age_min, sell_prem, avail, max_copies or 0, off, months[j], 'skip', cap, 0, 0, 0, 0.0))
                j += h; path.append((months[j], cap)); continue
            new_cap, spent, nc, ncop = cycle(j, h, rule, cap, disc, age_min, sell_prem=sell_prem, avail=avail, max_copies=max_copies)
            r = new_cap / cap - 1
            rows.append((h, rule, c0, disc, gate, age_min, sell_prem, avail, max_copies or 0, off, months[j], 'trade', cap, spent, nc, ncop, r))
            cap = new_cap; j += h; path.append((months[j], cap))
        paths.append(path)
    cyc = pd.DataFrame(rows, columns=['h', 'rule', 'c0', 'disc', 'gate', 'age_min', 'sell_prem', 'avail', 'max_copies', 'offset', 'month', 'action', 'capital_before', 'spent', 'n_cards', 'n_copies', 'cycle_return'])
    tr = cyc[cyc.action == 'trade']
    finals = [p[-1][1] for p in paths]
    years = (LAST - START) / 12.0
    # max drawdown on the averaged path (by month index)
    mdd = []
    for p in paths:
        caps = np.array([c for _, c in p]); peak = np.maximum.accumulate(caps); mdd.append(((caps - peak) / peak).min())
    summ = dict(h=h, rule=rule, c0=c0, disc=disc, gate=gate, age_min=age_min, sell_prem=sell_prem, avail=avail, max_copies=max_copies or 0, final_mean=np.mean(finals), final_min=np.min(finals), final_max=np.max(finals),
                cagr=(np.mean(finals) / c0) ** (1 / years) - 1, cycles=len(tr) / h, cycle_ret_mean=tr['cycle_return'].mean(), cycle_ret_median=tr['cycle_return'].median(),
                p_cycle_loss=(tr['cycle_return'] < 0).mean(), worst_cycle=tr['cycle_return'].min(), best_cycle=tr['cycle_return'].max(), max_drawdown=np.mean(mdd),
                skipped_share=(cyc.action == 'skip').mean(), cards_per_cycle=tr['n_cards'].mean(), copies_per_cycle=tr['n_copies'].mean(), spent_share=(tr['spent'] / tr['capital_before']).mean())
    return summ, cyc

summs, cycs = [], []
grid = list(itertools.product((1, 3, 6), ('dev12', 'combo', 'mom12', 'setmom', 'random', 'top_mom3'), (5000,), (0.0, 0.10, 0.20), ('none', 'reg3>0', 'reg3>2%'), (24,)))
grid += list(itertools.product((1, 3), ('combo',), (2000, 10000), (0.0, 0.20), ('none', 'reg3>0'), (24,)))
grid += list(itertools.product((1, 3), ('combo', 'dev12'), (5000,), (0.0, 0.20), ('reg3>0',), (0,)))
for h, rule, c0, disc, gate, age_min in grid:
    s, c = run(h, rule, c0, disc, gate, age_min)
    summs.append(s); cycs.append(c)
# patient-sell variant: +5% on the sell price (E07: the 80th percentile of sold prices sits ~9-11% above the median)
for h in (1, 3):
    for disc in (0.0, 0.20):
        s, c = run(h, 'combo', 5000, disc, 'reg3>0', 24, sell_prem=0.05)
        summs.append(s); cycs.append(c)
# realistic availability of discounted buys (E07: ~12% of cards have a credible floor >= 20% under the median,
# ~25% have one >= 15% under, ~40% >= 10% under; a floor listing is one copy)
for h in (1, 3):
    for rule in ('dev12', 'combo', 'random'):
        for disc, avail, mc in ((0.20, 0.12, 1), (0.15, 0.25, 1), (0.10, 0.40, 2), (0.20, 0.12, 2)):
            for gate in ('none', 'reg3>0'):
                for c0 in (2000, 5000, 10000):
                    s_, c_ = run(h, rule, c0, disc, gate, 24, avail=avail, max_copies=mc)
                    summs.append(s_); cycs.append(c_)
df = pd.DataFrame(summs)
df.round(4).to_csv(os.path.join(OUT, 'E10_sim_summary.csv'), index=False)
pd.concat(cycs).round(4).to_csv(os.path.join(OUT, 'E10_sim_cycles.csv'), index=False)
pd.set_option('display.width', 250)
cols = ['h', 'rule', 'c0', 'disc', 'gate', 'age_min', 'sell_prem', 'avail', 'max_copies', 'final_mean', 'cagr', 'cycle_ret_mean', 'p_cycle_loss', 'worst_cycle', 'max_drawdown', 'skipped_share', 'cards_per_cycle', 'spent_share']
print(df[(df.avail < 1)].sort_values(['h', 'disc', 'rule', 'gate', 'c0'])[cols].round(3).to_string())

cy = pd.concat(cycs)
cy = cy[(cy.action == 'trade') & (cy.c0 == 5000)]
cy['year'] = cy['month'].str[:4]
yr = cy.groupby(['h', 'rule', 'disc', 'gate', 'avail', 'max_copies', 'year'])['cycle_return'].agg(['mean', 'count', lambda x: (x < 0).mean()]).reset_index()
yr.columns = ['h', 'rule', 'disc', 'gate', 'avail', 'max_copies', 'year', 'cycle_ret_mean', 'cycles', 'p_loss']
yr['annualised'] = (1 + yr['cycle_ret_mean']) ** (12 / yr['h']) - 1
yr.round(4).to_csv(os.path.join(OUT, 'E10_sim_by_year.csv'), index=False)
print(yr[(yr.avail < 1) & (yr.rule.isin(['dev12', 'random'])) & (yr.gate == 'none') & (yr.max_copies == 1)].round(3).to_string())
