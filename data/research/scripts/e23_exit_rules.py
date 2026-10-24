"""E23 - Exit rules for the reversal trade: fixed holds vs "sell when the card is back at its 12-month mean"
(take-profit at the anchor), a stop-loss, and the two combined. Trading-desk mechanics the stock market uses; with
monthly data the check happens once a month.

Universe: dev12 bottom decile of the band ($50-$500, sales >= 2, sets >= 24 months), decision months 2022-01 .. 2026-03
(so every rule can run 6 months), bought d under buy_real (d = 0.15, 0.20), sold at the PriceCharting price of the
exit month, net of fees. Rules:
  fixed_h   sell at month h (1, 2, 3, 6)
  target_k  sell at the first month m (1..6) where price_{t+m} >= k x the card's 12-month mean at decision time
            (k = 0.90, 1.00, 1.10); otherwise at month 6 ("max hold")
  target_k_max3  the same with the max hold at 3 months
  stop_s    sell at month 1 if price_{t+1} < (1 - s) x price_t (s = 0.10, 0.15), otherwise hold to month 3
  target_1.00_stop_0.15  take-profit at the mean, stop at month 1, max hold 6
Metrics per rule, by regime at decision time: mean net, P(net>0), mean months held, net per month of capital
(sum of net / sum of months, i.e. the capital-weighted rate the money compounds at), share exited by target.
Outputs: results/E23_exit_rules.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED
from xs import features, _roll_mean
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
reg3 = F['reg3'][0]
m12 = _roll_mean(pr, 12)
H = 6
rows = []
START, END = months.index('2022-01'), months.index('2026-03')
recs = []   # one record per pick: regime, buy, path of 6 forward prices
for j in range(START, END + 1):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    idx = np.where(ok)[0]
    if len(idx) < 100:
        continue
    q10 = np.percentile(F['dev12'][idx, j], 10)
    pick = idx[F['dev12'][idx, j] <= q10]
    path = pr[pick, j + 1:j + H + 1]
    full = ~np.isnan(path).any(1)
    pick, path = pick[full], path[full]
    for i, p in zip(pick, path):
        recs.append(('up' if reg3[j] > 0 else 'down', months[j], F['buy_real'][i, j], pr[i, j], m12[i, j], p))
reg = np.array([r[0] for r in recs]); buy0 = np.array([r[2] for r in recs]); p0 = np.array([r[3] for r in recs])
anchor = np.array([r[4] for r in recs]); path = np.array([r[5] for r in recs])
print('picks:', len(recs), 'up:', (reg == 'up').sum(), 'down:', (reg == 'down').sum())


def evaluate(exit_month, d):
    """exit_month: int array (1..6) per pick -> net return and months."""
    sell = path[np.arange(len(path)), exit_month - 1]
    cost = buy0 * (1 - d)
    net = (sell * KEEP - FIXED - cost) / cost
    return net, exit_month.astype(float)


def rule_exit(name):
    n = len(path)
    if name.startswith('fixed_'):
        return np.full(n, int(name.split('_')[1]))
    if name.startswith('target_'):
        parts = name.split('_'); k = float(parts[1]); maxh = 3 if 'max3' in name else H
        stop = 0.15 if 'stop' in name else None
        ex = np.full(n, maxh)
        hit = np.zeros(n, bool)
        for m in range(1, maxh + 1):
            cond = (path[:, m - 1] >= k * anchor) & ~hit
            if stop is not None and m == 1:
                cond = cond | ((path[:, 0] < (1 - stop) * p0) & ~hit)
            ex[cond] = m; hit |= cond
        return ex
    if name.startswith('stop_'):
        s = float(name.split('_')[1])
        ex = np.full(n, 3)
        ex[path[:, 0] < (1 - s) * p0] = 1
        return ex
    raise ValueError(name)

RULES = ['fixed_1', 'fixed_2', 'fixed_3', 'fixed_6', 'target_0.90', 'target_1.00', 'target_1.10', 'target_1.00_max3', 'stop_0.10', 'stop_0.15', 'target_1.00_stop_0.15']
for d in (0.15, 0.20):
    for name in RULES:
        ex = rule_exit(name)
        net, mo = evaluate(ex, d)
        for r in ('all', 'up', 'down'):
            sel = np.ones(len(net), bool) if r == 'all' else (reg == r)
            by_target = ((ex < (3 if 'max3' in name else H)) & (path[np.arange(len(path)), ex - 1] >= anchor * (float(name.split('_')[1]) if name.startswith('target_') else np.inf)))[sel].mean() if name.startswith('target_') else np.nan
            rows.append(dict(discount=d, rule=name, regime=r, n=int(sel.sum()), net_mean=net[sel].mean(), p_net_pos=(net[sel] > 0).mean(), net_p10=np.percentile(net[sel], 10), net_p50=np.median(net[sel]), months_mean=mo[sel].mean(), net_per_month_of_capital=net[sel].sum() / mo[sel].sum(), share_exited_early=(ex[sel] < (3 if 'max3' in name else (H if not name.startswith('fixed') and not name.startswith('stop') else int(name.split('_')[1]) if name.startswith('fixed') else 3))).mean(), share_target_hit=by_target))
out = pd.DataFrame(rows)
out.round(4).to_csv(os.path.join(OUT, 'E23_exit_rules.csv'), index=False)
pd.set_option('display.width', 250)
for d in (0.15, 0.20):
    print('discount', d)
    print(out[(out.discount == d)].pivot(index='rule', columns='regime', values=['net_mean', 'p_net_pos', 'months_mean', 'net_per_month_of_capital']).round(3).to_string())
