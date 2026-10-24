"""E16 - What do the picks look like? Composition of the dev12-bottom-decile picks ($50-$500, sets >= 24 months) by set,
series era, price tier, rarity and sales count over time - to see concentration risk (is it one set's crash?), what the
strategy is really buying, and how the picks' forward returns differ by these groups (3-month hold, 20% under).
Also the current month's picks (2026-10) as a list for eyeballing.
Outputs: results/E16_pick_composition.csv, results/E16_current_picks.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED
from xs import features, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']
cards = P['cards']
h = 3
gross, net, futs = forward(P, F, h)
rows = []
for j in range(months.index('2022-01'), len(months)):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    idx = np.where(ok)[0]
    if len(idx) < 100:
        continue
    s = F['dev12'][idx, j]; cut = np.percentile(s, 10); pk = idx[s <= cut]
    b = F['buy_real'][pk, j]; g = gross[pk, j]
    n20 = ((1 + g) * b * KEEP - FIXED - 0.8 * b) / (0.8 * b)
    for i, p in enumerate(pk):
        rows.append((months[j], int(cards['card_id'].iloc[p]), cards['name'].iloc[p], cards['set'].iloc[p], cards['rarity'].iloc[p], pr[p, j], sl[p, j], F['dev12'][p, j], F['mom12'][p, j], F['age'][p, j], g[i], n20[i]))
d = pd.DataFrame(rows, columns=['month', 'card_id', 'name', 'set', 'rarity', 'price', 'sales', 'dev12', 'mom12', 'age_months', 'gross_3m', 'net20_3m'])
d['tier'] = pd.cut(d['price'], [50, 100, 250, 500], labels=['50-100', '100-250', '250-500'], include_lowest=True)
d['age_bucket'] = pd.cut(d['age_months'], [23, 48, 96, 180, 400], labels=['2-4y', '4-8y', '8-15y', '15y+'])
d['sales_bucket'] = pd.cut(d['sales'], [1, 4, 9, 24, 1e9], labels=['2-4', '5-9', '10-24', '25+'])
hist = d[d['gross_3m'].notna()]
out = []
for col in ('tier', 'age_bucket', 'sales_bucket', 'rarity'):
    g = hist.groupby(col, observed=True).agg(picks=('card_id', 'size'), share=('card_id', lambda x: len(x) / len(hist)), gross_3m=('gross_3m', 'mean'), net20_3m=('net20_3m', 'mean'), p_net20_pos=('net20_3m', lambda x: (x > 0).mean())).reset_index().rename(columns={col: 'value'})
    g.insert(0, 'dimension', col)
    out.append(g[g['picks'] >= 30])
# set concentration: top sets by share of picks, with their outcome
g = hist.groupby('set').agg(picks=('card_id', 'size'), months=('month', 'nunique'), gross_3m=('gross_3m', 'mean'), net20_3m=('net20_3m', 'mean'), p_net20_pos=('net20_3m', lambda x: (x > 0).mean())).reset_index()
g['share'] = g['picks'] / len(hist); g = g.sort_values('picks', ascending=False).head(25).rename(columns={'set': 'value'})
g.insert(0, 'dimension', 'set (top 25)')
out.append(g)
# per-month concentration: share of the month's picks in its single most common set
conc = d.groupby('month').apply(lambda x: x['set'].value_counts(normalize=True).iloc[0]).rename('top_set_share')
out.append(pd.DataFrame([dict(dimension='concentration', value='mean share of a month\'s picks in its most common set', picks=len(d), share=conc.mean(), gross_3m=np.nan, net20_3m=np.nan, p_net20_pos=np.nan)]))
comp = pd.concat(out, ignore_index=True)
comp.round(4).to_csv(os.path.join(OUT, 'E16_pick_composition.csv'), index=False)
pd.set_option('display.width', 250)
print(comp.round(3).to_string())
cur = d[d['month'] == months[-1]].sort_values('dev12')[['card_id', 'name', 'set', 'rarity', 'price', 'sales', 'dev12', 'mom12', 'age_months']]
cur.round(3).to_csv(os.path.join(OUT, 'E16_current_picks.csv'), index=False)
print(months[-1], 'picks:', len(cur)); print(cur.head(30).round(3).to_string())
