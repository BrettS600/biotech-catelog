"""E26 - Graded (PSA 10) vs raw (ungraded) at the index level, 2022-01..2026-10.

PokeViews publishes two index families built the same way (top-N cards per era by price, equal-weighted, rebalanced
monthly on the 1st, PCHIP between rebalancing points, PriceCharting prices):
  era_performance.csv    - ungraded, top 50 per era, index = average $ price  (5 eras)
  graded_index_by_era    - PSA 10,   top 50 per era, index base 100          (4 eras: no Contemporary)
  graded_index.csv       - PSA 10 Top 250 (all eras)
Only the month-start values are used (the days between are interpolated, not observed).
For each era and horizon h = 1, 2, 3 months: the index's h-month return from every month start, its mean, median,
std, share positive, worst, and the same net of a round trip: raw at the site's eBay fee model on the average
constituent price, graded with the same eBay fee + $20 insured shipping/handling (a slab ships tracked + insured).
The index is a basket of the most valuable cards re-selected every month - it is NOT a buyable portfolio (it drops
cards that fell out of the top 50 and adds the new risers), so its return is an upper bound for a buy-and-hold of the
same cards. Both families share that bias, so the comparison between them is fair; the levels are not.
"""
import os, sys, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
OUT = os.path.join(DATA, 'research', 'results')
FEE = 0.1325 * 1.065

raw = pd.read_csv(os.path.join(DATA, 'pokeviews', 'era_performance.csv'), parse_dates=['date'])
gb = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index_by_era.csv'), parse_dates=['date'])
g250 = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index.csv'), parse_dates=['date'])
cons = pd.read_csv(os.path.join(DATA, 'pokeviews', 'graded_index_by_era_constituents.csv'))

eras = {'vintage': 'Vintage', 'classic': 'Classic', 'mid_era': 'Mid Era', 'modern': 'Modern'}
ms = lambda d: d[d['date'].dt.day == 1]
rawm = ms(raw).set_index('date')
gbm = ms(gb).pivot(index='date', columns='era', values='graded_index_value')
g250m = ms(g250).set_index('date')['index_value']

rows = []
for key, name in eras.items():
    r = rawm[f'{key}_index_value'].astype(float)
    g = gbm[name].astype(float)
    common = r.index.intersection(g.index)
    r, g = r.loc[common], g.loc[common]
    # average constituent price of the raw index = the index value itself (dollars); PSA 10 average from constituents now
    psa_avg_now = cons.loc[cons['era'] == name, 'psa10_price'].mean()
    for h in (1, 2, 3, 6):
        for kind, s in (('raw', r), ('psa10', g)):
            ret = (s.shift(-h) / s - 1).dropna()
            if kind == 'raw':
                p0 = r.loc[ret.index].to_numpy()                  # dollars per card at the start
                p1 = p0 * (1 + ret.to_numpy())
                net = (p1 * (1 - FEE) - 5.20 - p0) / p0
            else:
                # scale the graded index to the current average PSA 10 price of the era's constituents
                scale = psa_avg_now / g.iloc[-1]
                p0 = g.loc[ret.index].to_numpy() * scale
                p1 = p0 * (1 + ret.to_numpy())
                net = (p1 * (1 - FEE) - 0.40 - 20.0 - p0) / p0
            for period, mask in (('2022-01..', np.ones(len(ret), bool)), ('2024-01..', ret.index >= '2024-01-01')):
                x, n = ret.to_numpy()[mask], net[mask]
                if len(x) < 3:
                    continue
                rows.append({'era': name, 'kind': kind, 'h_months': h, 'period': period, 'n_starts': len(x),
                             'mean_gross': x.mean(), 'median_gross': np.median(x), 'std_gross': x.std(ddof=1),
                             'p_gross_pos': (x > 0).mean(), 'worst_gross': x.min(), 'best_gross': x.max(),
                             'mean_net': n.mean(), 'p_net_pos': (n > 0).mean(), 'worst_net': n.min(),
                             'avg_price_start': p0[mask].mean(),
                             'sharpe_like_gross': x.mean() / x.std(ddof=1) if x.std(ddof=1) > 0 else np.nan})
res = pd.DataFrame(rows)
res.to_csv(os.path.join(OUT, 'E26_graded_vs_raw_by_era.csv'), index=False, float_format='%.4f')

# monthly return correlation and drawdowns, raw vs graded, per era
cr = []
for key, name in eras.items():
    r = rawm[f'{key}_index_value'].astype(float); g = gbm[name].astype(float)
    common = r.index.intersection(g.index); r, g = r.loc[common], g.loc[common]
    rr, gg = r.pct_change().dropna(), g.pct_change().dropna()
    dd = lambda s: (s / s.cummax() - 1).min()
    lead = [np.corrcoef(gg.shift(k).dropna().loc[rr.index[k:]] if k > 0 else gg, rr.loc[gg.shift(k).dropna().index] if k > 0 else rr)[0, 1] for k in (0,)]
    # does last month's graded move lead next month's raw move (and vice versa)?
    def lagcorr(a, b, k):
        a2, b2 = a.shift(k), b
        m = a2.notna() & b2.notna()
        return np.corrcoef(a2[m], b2[m])[0, 1]
    cr.append({'era': name, 'months': len(rr), 'corr_same_month': lagcorr(gg, rr, 0),
               'corr_graded_leads_raw_1m': lagcorr(gg, rr, 1), 'corr_raw_leads_graded_1m': lagcorr(rr, gg, 1),
               'corr_graded_leads_raw_3m_sum': lagcorr(gg.rolling(3).sum(), rr.rolling(3).sum().shift(-3), 0),
               'raw_total_return': r.iloc[-1] / r.iloc[0] - 1, 'psa10_total_return': g.iloc[-1] / g.iloc[0] - 1,
               'raw_max_drawdown': dd(r), 'psa10_max_drawdown': dd(g),
               'raw_monthly_vol': rr.std(), 'psa10_monthly_vol': gg.std()})
pd.DataFrame(cr).to_csv(os.path.join(OUT, 'E26_graded_vs_raw_structure.csv'), index=False, float_format='%.4f')
print(res[(res.period == '2022-01..') & (res.h_months.isin([1, 3]))][['era', 'kind', 'h_months', 'n_starts', 'mean_gross', 'std_gross', 'p_gross_pos', 'worst_gross', 'mean_net', 'p_net_pos', 'avg_price_start']].to_string(index=False))
print(pd.DataFrame(cr).to_string(index=False))
