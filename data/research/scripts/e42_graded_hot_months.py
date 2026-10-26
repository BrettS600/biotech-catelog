"""E42 - What followed the PSA 10 market's hottest months? (October 2026: Top 250 Graded +33% in a month, all-time high.)
Month-start series 2022-01..2026-10: Top 250 Graded index, the four graded era indexes and the four raw era indexes, plus
the PriceCharting market median (E01). For months whose graded 1-month gain was in the top fifth (and >= +10%), the next
1 / 3 / 6-month graded and raw returns vs all months. Small n - descriptive; the 2022-2026 sample has no graded crash.
"""
import os, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, '..', 'results')
g = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index.csv'), parse_dates=['date']); g = g[g.date.dt.day == 1].set_index('date')['index_value']
ge = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index_by_era.csv'), parse_dates=['date']); ge = ge[ge.date.dt.day == 1].pivot(index='date', columns='era', values='graded_index_value')
re_ = pd.read_csv(os.path.join(DATA, 'pokeviews', 'era_performance.csv'), parse_dates=['date']); re_ = re_[re_.date.dt.day == 1].set_index('date')
raw = pd.DataFrame({k: re_[f'{k}_index_value'] for k in ('vintage', 'classic', 'mid_era', 'modern')}).astype(float)
G = g.astype(float); Ge = ge.mean(axis=1); Rw = raw.mean(axis=1)    # equal-weight of the era indexes' levels' returns below
r = lambda s, h: s.shift(-h) / s - 1
df = pd.DataFrame({'g_past1': G / G.shift(1) - 1, 'g_next1': r(G, 1), 'g_next3': r(G, 3), 'g_next6': r(G, 6),
                   'raw_next1': raw.pct_change(-1).mul(-1).pipe(lambda x: (raw.shift(-1) / raw - 1).mean(axis=1)), 'raw_next3': (raw.shift(-3) / raw - 1).mean(axis=1),
                   'raw_next6': (raw.shift(-6) / raw - 1).mean(axis=1)}).dropna(subset=['g_past1'])
hot = df.g_past1 >= max(0.10, df.g_past1.quantile(0.8))
rows = []
for name, m in (('hot graded month (top fifth, >= +10%)', hot), ('all other months', ~hot)):
    d = df[m]
    rows.append({'months_group': name, 'n': int(m.sum()), 'g_past1_mean': d.g_past1.mean(),
                 **{c + '_mean': d[c].mean() for c in ['g_next1', 'g_next3', 'g_next6', 'raw_next1', 'raw_next3', 'raw_next6']},
                 'p_g_next3_neg': (d.g_next3.dropna() < 0).mean(), 'p_raw_next3_neg': (d.raw_next3.dropna() < 0).mean(), 'hot_months': ', '.join(d.index.strftime('%Y-%m')) if name.startswith('hot') else ''})
out = pd.DataFrame(rows); out.to_csv(os.path.join(OUT, 'E42_graded_hot_months.csv'), index=False, float_format='%.4f')
print(out.round(3).T.to_string())
