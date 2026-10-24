"""Dry run of the v2 Forecast rules on today's data (2026-10-24), before the tab is rebuilt.

Mirrors what the rebuilt tab will compute, from the committed data/ folder:
  - the regime today (reg1, reg3 from LAST month's $10+ cards with 2+ sales this month - the corrected definition);
  - every card's dev12 (price vs its own 12-month mean) and its rank among cards $25+ with 2+ sales in some recent
    month and a full year of history; bucket = top10 / b90 / b75 / b50 of that rank (deepest below the mean = top);
  - the chance grids: realised gross returns (sell at PriceCharting h months on / buy_real - 1) by regime x hold x
    bucket, 2022-01 .. the last month with an outcome, cards $25+ (the v2 calibration);
  - the eBay side from the newest catalog snapshot: the credible floor L, the sold anchor A and the sales behind it
    (A_n), copies listed (N), the three cheapest asks, the 30-day sales (tr_spm) - the two guards and the supply
    rule of the tab;
  - the plan at $2k / $5k / $10k: buy best-chance-first at 50%+, 20% per card, one copy per listing within 15% of
    the buy price.
Outputs: results/DRYRUN_2026-10-24_candidates.csv (top 60 by rank in the band), results/DRYRUN_2026-10-24_plans.csv
"""
import os, glob, json, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED, DATA
from xs import features, _roll_mean
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months, cards = P['price'].astype(float), P['sales'].astype(float), P['months'], P['cards']
reg1, reg3 = F['reg1'][0], F['reg3'][0]
m12 = _roll_mean(pr, 12)
J = len(months) - 1                                   # today's (partial) month
print('decision month', months[J], 'reg1 %+.3f reg3 %+.3f' % (reg1[J], reg3[J]), '-> regime', 'UP' if reg3[J] > 0 else 'DOWN', '(reg1 confirms)' if reg1[J] > 0 else '(reg1 does not confirm)')
FEES = dict(fee=0.1325 * 1.065, fixed=0.40, shipOut=4.50, supplies=0.30, tax=0.0)
QS = [round(i / 100, 2) for i in range(5, 100, 5)]
RANK_MIN = 25.0


def rank_universe(j):
    vol12 = np.nansum(sl[:, max(0, j - 11):j + 1], axis=1)
    ok = (pr[:, j] >= RANK_MIN) & ~np.isnan(m12[:, j]) & (vol12 >= 6)
    return ok


def pct_of(j):
    ok = rank_universe(j)
    dev = pr[:, j] / m12[:, j] - 1
    p = np.full(pr.shape[0], np.nan)
    idx = np.where(ok)[0]
    p[idx] = pd.Series(-dev[idx]).rank(pct=True).values          # deepest below the mean -> highest percentile
    return p, dev


def bucket(p):
    return 'top10' if p >= .9 else 'b90' if p >= .75 else 'b75' if p >= .5 else 'b50'


# ---- the grids (v2 calibration): outcomes known today, 2022-01 .. last month with price h months on
grids = {}
start = months.index('2022-01')
recs = {h: [] for h in (1, 3, 6)}
for j in range(start, J):
    p, dev = pct_of(j)
    ok = ~np.isnan(p)
    reg = 'up' if reg3[j] > 0 else 'down'
    for h in (1, 3, 6):
        if j + h > J - 1:                                 # the current month is partial: no outcome lands in it
            continue
        y = pr[:, j + h] / F['buy_real'][:, j] - 1
        m = ok & ~np.isnan(y)
        recs[h].append(pd.DataFrame({'reg': reg, 'b': [bucket(v) for v in p[m]], 'y': np.clip(y[m], -0.95, 5)}))
for h in (1, 3, 6):
    d = pd.concat(recs[h])
    for (reg, b), s in d.groupby(['reg', 'b']):
        grids[f'{h}|{reg}|{b}'] = dict(n=len(s), mean=float(s.y.mean()), q=[float(s.y.quantile(q)) for q in QS], p_up=float((s.y > 0).mean()))
    grids[f'{h}|all|all'] = dict(n=len(d), mean=float(d.y.mean()), q=[float(d.y.quantile(q)) for q in QS], p_up=float((d.y > 0).mean()))
print('grid cells', len(grids), '; 3|up|top10 n=%d mean=%+.3f p_up=%.2f' % (grids['3|up|top10']['n'], grids['3|up|top10']['mean'], grids['3|up|top10']['p_up']))


def cdf(tab, r):
    q = tab['q']; n = len(q)
    if r <= q[0]: return max(0.0, QS[0] - QS[0] * (q[0] - r) / max(1e-6, q[1] - q[0]))
    if r >= q[-1]: return min(1.0, QS[-1] + (1 - QS[-1]) * (r - q[-1]) / max(1e-6, q[-1] - q[-2]))
    i = 0
    while i < n - 1 and q[i + 1] < r: i += 1
    return QS[i] + (QS[i + 1] - QS[i]) * (r - q[i]) / max(1e-9, q[i + 1] - q[i])


def net(buy, r, sell, disc=0.0):
    return sell * (1 + r) * (1 - FEES['fee']) - FEES['fixed'] - FEES['shipOut'] - FEES['supplies'] - buy * (1 - disc)


def breakeven(buy, sell, disc=0.0):
    return (buy * (1 - disc) + FEES['fixed'] + FEES['shipOut'] + FEES['supplies']) / (sell * (1 - FEES['fee'])) - 1


# ---- today's cards
p_now, dev_now = pct_of(J)
cat = pd.read_csv(sorted(glob.glob(os.path.join(DATA, 'ebay', 'catalog', '*.csv.gz')))[-1]).set_index('card_id')
print('eBay catalog snapshot rows', len(cat))
rows = []
for i in np.where(~np.isnan(p_now))[0]:
    cid = int(cards.iloc[i]['card_id']); price = pr[i, J]; pc_buy = F['buy_real'][i, J]
    age = F['age'][i, J]
    if not (age >= 24 or np.isnan(age)):
        continue
    e = cat.loc[cid] if cid in cat.index else None
    L = A = None; A_n = 0; N = 0; asks = []; spm = None; smed = None
    if e is not None:
        L = None if pd.isna(e['L']) else float(e['L']); A = None if pd.isna(e['A']) else float(e['A']); A_n = 0 if pd.isna(e['A_n']) else int(e['A_n'])
        N = 0 if pd.isna(e['N']) else int(e['N']); asks = [float(e[k]) for k in ('p1', 'p2', 'p3') if not pd.isna(e[k])]; spm = None if pd.isna(e['tr_spm']) else int(e['tr_spm']); smed = None if pd.isna(e['smed']) else float(e['smed'])
    a_ok = A is not None and A_n >= 5
    buy = L if L is not None else A if a_ok else pc_buy
    src = 'floor' if L is not None else 'median' if a_ok else 'PC'
    sell = A if a_ok else min(pc_buy, L) if L is not None else pc_buy
    why = 'A' if a_ok else 'thin' if A is not None else 'pc'
    comp = None
    k30 = 0 if (e is None or pd.isna(e['k'])) else int(e['k'])
    if asks:                                              # only CREDIBLE asks compete (the collector's rule: not under 75% of A); the floor copy itself is the one bought
        cred_asks = [x for x in asks if (A is None or x >= 0.75 * A) and (L is None or abs(x - L) > 0.005)]
        comp = cred_asks[0] if cred_asks else None
    if comp is not None and comp < sell:
        sell, why = comp, 'ask'
    if not (50 <= buy <= 500):
        continue
    supply = None
    if e is not None and 50 <= buy <= 500:
        supply = sum(1 for x in asks if x <= buy * 1.15)
        if supply == 3 and N > 3: supply = N
    if supply == 0 or supply is None:
        continue
    b = bucket(p_now[i]); reg = 'up' if reg3[J] > 0 else 'down'
    out = {}
    for h in (1, 3, 6):
        tab = grids.get(f'{h}|{reg}|{b}') or grids[f'{h}|all|all']
        be = breakeven(buy, sell)
        out[h] = dict(p=min(0.95, 1 - cdf(tab, be)), lo=net(buy, tab['q'][QS.index(0.1)], sell), med=net(buy, tab['q'][QS.index(0.5)], sell), hi=net(buy, tab['q'][QS.index(0.9)], sell), mean=net(buy, tab['mean'], sell), be=be)
    rows.append(dict(card_id=cid, name=cards.iloc[i]['name'], set=cards.iloc[i]['set'], pc_price=round(price, 2), pc_buy=round(pc_buy, 2), buy=round(buy, 2), src=src, sell=round(sell, 2), why=why,
                     floor_vs_A=None if (L is None or A is None) else round(1 - L / A, 3), A=A, A_n=A_n, k30=k30, pc_vs_A=None if A is None else round(price / A, 2), ebay_sales_30d=spm, sold_med10=smed, listed_N=N, supply=supply, pc_sales_mo=int(sl[i, J]) if not np.isnan(sl[i, J]) else 0,
                     pc_sales_12mo=int(np.nansum(sl[i, J - 11:J + 1])), dev12=round(dev_now[i], 3), anchor12=round(m12[i, J], 2), rank_pct=round(p_now[i], 3), bucket=b, age_mo=None if np.isnan(age) else int(age),
                     breakeven3=round(out[3]['be'], 3), p1=round(out[1]['p'], 3), p3=round(out[3]['p'], 3), p6=round(out[6]['p'], 3), net3_lo=round(out[3]['lo'], 2), net3_med=round(out[3]['med'], 2), net3_hi=round(out[3]['hi'], 2), net3_mean=round(out[3]['mean'], 2)))
d = pd.DataFrame(rows).sort_values('rank_pct', ascending=False)
print('cards in the band with supply and a rank:', len(d), '; at 50%+ chance (3 mo):', (d.p3 >= .5).sum(), '; floors >= 20% under A:', (d.floor_vs_A >= .2).sum())
print('at 50%+ chance by hold: 1 mo', int((d.p1 >= .5).sum()), '; 3 mo', int((d.p3 >= .5).sum()), '(with an eBay sale in 30 d:', int(((d.p3 >= .5) & (d.k30 >= 1)).sum()), ') ; 6 mo', int((d.p6 >= .5).sum()), '(with an eBay sale in 30 d:', int(((d.p6 >= .5) & (d.k30 >= 1)).sum()), ')')
d.head(60).to_csv(os.path.join(OUT, 'DRYRUN_2026-10-24_candidates.csv'), index=False)
# ---- plans
plans = []
for cap in (2000, 5000, 10000):
    elig = d[(d.p3 >= 0.5) & (d.k30 >= 1)].copy()
    elig['pr'] = (elig.p3 * 100).round()
    elig = elig.sort_values(['pr', 'rank_pct'], ascending=[False, False])
    left = cap; picks = []
    for r in elig.itertuples():
        cost = r.buy
        q = int(min(cap * 0.2 // cost, r.supply, left // cost))
        if q > 0:
            picks.append((r.name, r.set, r.buy, q, r.p3, r.net3_mean, r.rank_pct, r.bucket)); left -= q * cost
    depth = min((p[6] for p in picks), default=None)
    plans.append(dict(capital=cap, cards=len(picks), copies=sum(p[3] for p in picks), spent=cap - left, idle=left, exp_net3=round(sum(p[3] * p[5] for p in picks), 2), deepest_rank_used=depth, picks='; '.join(f'{p[0]} ({p[1]}) x{p[3]} @${p[2]:.0f} p={p[4]:.2f} {p[7]}' for p in picks)))
    print(f'${cap}: {len(picks)} cards, {sum(p[3] for p in picks)} copies, spent ${cap - left:.0f}, idle ${left:.0f}, expected 3-mo net ${sum(p[3] * p[5] for p in picks):.0f}, reaches rank pct {depth}')
pd.DataFrame(plans).to_csv(os.path.join(OUT, 'DRYRUN_2026-10-24_plans.csv'), index=False)
pd.set_option('display.width', 250); pd.set_option('display.max_colwidth', 28)
cols = ['name', 'set', 'pc_price', 'buy', 'src', 'sell', 'why', 'floor_vs_A', 'A_n', 'k30', 'listed_N', 'supply', 'pc_sales_12mo', 'dev12', 'rank_pct', 'bucket', 'breakeven3', 'p3', 'p6', 'net3_med']
print('\n=== TOP 30 BY CHANCE, 3-month hold (what the plan buys from)'); print(d.sort_values(['p3', 'rank_pct'], ascending=False).head(30)[cols].to_string(index=False))
print('\n=== TOP 20 BY CHANCE, 6-month hold'); print(d.sort_values(['p6', 'rank_pct'], ascending=False).head(20)[cols].to_string(index=False))
d.sort_values(['p3', 'rank_pct'], ascending=False).head(60).to_csv(os.path.join(OUT, 'DRYRUN_2026-10-24_by_chance.csv'), index=False)
print('\n=== TOP 30 BY RANK (deepest below the 12-month mean) - the oddities show here')
print(d.head(40)[['name', 'set', 'pc_price', 'buy', 'src', 'sell', 'why', 'floor_vs_A', 'A_n', 'ebay_sales_30d', 'listed_N', 'supply', 'pc_sales_mo', 'pc_sales_12mo', 'dev12', 'rank_pct', 'bucket', 'breakeven3', 'p3', 'net3_med']].to_string(index=False))
