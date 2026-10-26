"""E27c - The PSA 10 / raw ratio signal (E27/E27b) in non-overlapping weekly windows inside the 29 days, by set age, and
the card-level graded -> raw lead (does last week's PSA 10 move predict next week's raw move, given last week's raw move?).
Windows start 09-28, 10-05, 10-12, 10-19 (7 days each). Band = raw $10+ (and $50-500). Spearman IC per window and the
rank-OLS slope of the next-week raw change on rank(ratio) with rank(last-week raw change) as control.
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from daily_panel import load_daily, DATA
import statsmodels.api as sm
OUT = os.path.join(DATA, 'research', 'results')
D = load_daily(); dates = D['dates']
raw, psa = D['loose-price'], D['manual-only-price']
cards = pd.read_csv(os.path.join(DATA, 'pricecharting', 'cards.csv.gz')).set_index('card_id')
age_years = (pd.Timestamp('2026-10-01') - pd.to_datetime(cards['release_date'], errors='coerce')).dt.days / 365.25
rk = lambda s: s.rank(pct=True)
starts = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']
rows = []
for s in starts:
    i = dates.index(s); e = dates[min(i + 7, len(dates) - 1)]; p = dates[i - 7] if i >= 7 else None
    for band, lo, hi in (('10+', 10, 1e9), ('50-500', 50, 500)):
        for agegrp, amin, amax in (('all', -1, 99), ('<4y', -1, 4), ('4-15y', 4, 15), ('15y+', 15, 99)):
            d = pd.DataFrame({'r0': raw[s], 'y': raw[e] / raw[s] - 1, 'ratio': psa[s] / raw[s],
                              'prev_raw': (raw[s] / raw[p] - 1) if p else np.nan, 'prev_psa': (psa[s] / psa[p] - 1) if p else np.nan,
                              'age': age_years.reindex(raw.index)})
            d = d[d.r0.between(lo, hi) & d.age.between(amin, amax)].replace([np.inf, -np.inf], np.nan).dropna(subset=['y', 'ratio'])
            d = d[d.ratio > 0]
            if len(d) < 100: continue
            y = d.y.clip(d.y.quantile(.01), d.y.quantile(.99))
            q = pd.qcut(rk(d.ratio), 5, labels=False)
            rec = {'window_start': s, 'window_end': e, 'band': band, 'set_age': agegrp, 'cards': len(d), 'ic_ratio': d.ratio.corr(d.y, method='spearman'),
                   'top_quintile_mean': y[q == 4].mean(), 'bottom_quintile_mean': y[q == 0].mean(), 'all_mean': y.mean()}
            if p:
                dd = d.dropna(subset=['prev_raw', 'prev_psa'])
                yy = dd.y.clip(dd.y.quantile(.01), dd.y.quantile(.99))
                X = sm.add_constant(np.column_stack([rk(dd.ratio), rk(dd.prev_raw), rk(dd.prev_psa)]))
                f = sm.OLS(yy.to_numpy(), X).fit(cov_type='HC1')
                rec.update({'slope_ratio': f.params[1], 't_ratio': f.tvalues[1], 'slope_prev_raw': f.params[2], 't_prev_raw': f.tvalues[2],
                            'slope_prev_psa': f.params[3], 't_prev_psa': f.tvalues[3]})
            rows.append(rec)
r = pd.DataFrame(rows)
r.to_csv(os.path.join(OUT, 'E27c_ratio_weekly.csv'), index=False, float_format='%.4f')
print(r[r.set_age == 'all'].round(4).to_string(index=False))
print(r[(r.band == '10+') & (r.set_age != 'all')][['window_start', 'set_age', 'cards', 'ic_ratio', 'top_quintile_mean', 'bottom_quintile_mean']].round(4).to_string(index=False))
