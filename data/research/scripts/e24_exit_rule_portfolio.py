"""E24 - The E23 exit rule inside a reinvesting portfolio: a month-by-month engine (positions exit on their own
schedule, cash is redeployed the next month) comparing fixed holds with "list at the 12-month mean, sell when it
prints, market-sell at month 6".

Engine. Each month j (2022-01 .. 2026-03, so every position can run its 6 months and be closed by 2026-09): first the
positions whose exit month is j are cashed; then, if the gate allows, cash is deployed down the dev12 ranking of the band
($50-$500, sales >= 2, sets >= 24 months) among the cards with a credible floor that month (12 % availability, seeded
draw), one copy per card, at buy_real x (1 - 0.20), each position at most 20 % of (cash + book value of open positions),
cards already held skipped, only cards with a full 6-month forward price path (same candidate set for every rule). The
exit month is set at purchase by the rule (fixed h; or the first month the price >= k x the 12-month mean, else month
6 / month 3). Equity = cash + the open positions' current PriceCharting value (net of selling fees).
Metrics: final capital, CAGR, max drawdown of monthly equity, share of months with negative equity change, calendar-year
returns, positions bought, average months held, mean net per position, P(net>0) per position. 5 draws, mean reported
with min/max of the final capital. Gates: none, reg3 > 0 (at purchase). Capital $5,000 (and $2,000 / $10,000 for the
headline rules).
Outputs: results/E24_exit_rule_portfolio.csv, results/E24_exit_rule_by_year.csv
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
H = 6; DISC = 0.20; AVAIL = 0.12; CAP = 0.20
START, LAST = months.index('2022-01'), months.index('2026-09')
BUY_END = LAST - H                       # last purchase month: every position closes by LAST


def ranked(j):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    ok &= ~np.isnan(pr[:, j + 1:j + H + 1]).any(1)
    idx = np.where(ok)[0]
    return idx[np.argsort(F['dev12'][idx, j])]


def exit_month(rule, i, j):
    if rule.startswith('fixed_'):
        return j + int(rule.split('_')[1])
    k = float(rule.split('_')[1]); maxh = 3 if rule.endswith('max3') else H
    anchor = k * m12[i, j]
    for m in range(1, maxh + 1):
        if pr[i, j + m] >= anchor:
            return j + m
    return j + maxh


def run(rule, gate, c0, seed):
    rng = np.random.RandomState(seed)
    cash = float(c0); open_pos = {}            # card -> (exit_j, cost, sell_price_at_exit)
    equity = []; bought = []; held_months = []
    for j in range(START, LAST + 1):
        # exits
        for i in [i for i, v in open_pos.items() if v[0] == j]:
            ej, cost, sell = open_pos.pop(i)
            cash += sell * KEEP - FIXED
        # buys
        if j <= BUY_END and (gate == 'none' or reg3[j] > 0):
            book = sum(v[1] for v in open_pos.values())
            cands = ranked(j)
            cands = cands[rng.rand(len(cands)) < AVAIL]
            for i in cands:
                if cash < 40: break
                if i in open_pos: continue
                buy = F['buy_real'][i, j] * (1 - DISC)
                if buy > cash or buy > CAP * (cash + book): continue
                ej = exit_month(rule, i, j)
                open_pos[i] = (ej, buy, pr[i, ej]); cash -= buy; book += buy
                bought.append((buy, pr[i, ej] * KEEP - FIXED)); held_months.append(ej - j)
        mv = cash + sum(max(pr[i, j] * KEEP - FIXED, 0.0) for i in open_pos)
        equity.append(mv)
    equity = np.array(equity)
    assert not open_pos
    years = (LAST - START) / 12
    dd = (equity / np.maximum.accumulate(equity) - 1).min()
    chg = np.diff(equity) / equity[:-1]
    nets = np.array([(s - b) / b for b, s in bought])
    yr = {}
    for y in ('2022', '2023', '2024', '2025', '2026'):
        ii = [t for t, mth in enumerate(months[START:LAST + 1]) if mth.startswith(y)]
        yr[y] = equity[ii[-1]] / (equity[ii[0] - 1] if ii[0] > 0 else c0) - 1
    return dict(final=cash, cagr=(cash / c0) ** (1 / years) - 1, max_dd=dd, neg_months=(chg < 0).mean(), positions=len(bought), months_held=np.mean(held_months), net_mean=nets.mean(), p_net_pos=(nets > 0).mean()), yr

RULES = ['fixed_2', 'fixed_3', 'fixed_6', 'target_0.90', 'target_1.00', 'target_1.00_max3', 'target_1.10']
rows = []; yrows = []
for c0, rule, gate in itertools.product((5000,), RULES, ('none', 'reg3>0')):
    res = []; yrs = []
    for rep in range(5):
        r, yr = run(rule, gate, c0, zlib.crc32(repr((rule, gate, c0, rep)).encode()) & 0xFFFFFFFF)
        res.append(r); yrs.append(yr)
    d = pd.DataFrame(res); m = d.mean().to_dict()
    rows.append(dict(c0=c0, rule=rule, gate=gate, **m, final_min=d['final'].min(), final_max=d['final'].max()))
    yrows.append(dict(c0=c0, rule=rule, gate=gate, **pd.DataFrame(yrs).mean().to_dict()))
for c0, rule, gate in itertools.product((2000, 10000), ('fixed_3', 'target_1.00'), ('none', 'reg3>0')):
    res = []; yrs = []
    for rep in range(5):
        r, yr = run(rule, gate, c0, zlib.crc32(repr((rule, gate, c0, rep)).encode()) & 0xFFFFFFFF)
        res.append(r); yrs.append(yr)
    d = pd.DataFrame(res); m = d.mean().to_dict()
    rows.append(dict(c0=c0, rule=rule, gate=gate, **m, final_min=d['final'].min(), final_max=d['final'].max()))
    yrows.append(dict(c0=c0, rule=rule, gate=gate, **pd.DataFrame(yrs).mean().to_dict()))
out = pd.DataFrame(rows); out.round(4).to_csv(os.path.join(OUT, 'E24_exit_rule_portfolio.csv'), index=False)
yo = pd.DataFrame(yrows); yo.round(4).to_csv(os.path.join(OUT, 'E24_exit_rule_by_year.csv'), index=False)
pd.set_option('display.width', 250)
print(out.round(3).to_string()); print(yo.round(3).to_string())
