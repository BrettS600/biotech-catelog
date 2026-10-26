"""E32 - Weekly card-level dynamics in the daily download (4 non-overlapping weekly windows, 2026-10-05..10-26, raw $10+):
(a) PSA 10 price momentum or reversal at the card level (last week's PSA 10 change -> next week's PSA 10 change);
(b) sales pace: the 7-day change in PriceCharting's trailing-year sales count (new sales recorded) -> next week's raw
    change, with last week's raw change and the PSA 10 / raw ratio as controls.
Rank-OLS slopes (lowest to highest rank), HC1 t, per window; plus the mean over windows.
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from daily_panel import load_daily, DATA
import statsmodels.api as sm
OUT = os.path.join(DATA, 'research', 'results')
D = load_daily(); dates = D['dates']
raw, psa, vol = D['loose-price'], D['manual-only-price'], D['sales-volume']
rk = lambda s: s.rank(pct=True)
rows = []
for s in ['2026-10-05', '2026-10-12', '2026-10-19']:
    i = dates.index(s); e = dates[i + 7] if i + 7 < len(dates) else dates[-1]; p = dates[i - 7]
    d = pd.DataFrame({'r0': raw[s], 'y_raw': raw[e] / raw[s] - 1, 'y_psa': psa[e] / psa[s] - 1, 'prev_raw': raw[s] / raw[p] - 1,
                      'prev_psa': psa[s] / psa[p] - 1, 'ratio': psa[s] / raw[s], 'dvol': (vol[s] - vol[p]) / vol[p].clip(lower=1)}).replace([np.inf, -np.inf], np.nan)
    d = d[d.r0 >= 10].dropna()
    for target, xs in (('y_psa', ['prev_psa', 'prev_raw']), ('y_raw', ['dvol', 'prev_raw', 'ratio'])):
        y = d[target].clip(d[target].quantile(.01), d[target].quantile(.99))
        f = sm.OLS(y.to_numpy(), sm.add_constant(np.column_stack([rk(d[x]) for x in xs]))).fit(cov_type='HC1')
        for k, x in enumerate(xs):
            rows.append({'window_start': s, 'target': target, 'var': x, 'slope': f.params[k + 1], 't': f.tvalues[k + 1], 'n': len(d)})
r = pd.DataFrame(rows)
summ = r.groupby(['target', 'var']).agg(mean_slope=('slope', 'mean'), min_t=('t', 'min'), max_t=('t', 'max'), windows=('t', 'size')).reset_index()
r.to_csv(os.path.join(OUT, 'E32_weekly_signals.csv'), index=False, float_format='%.4f')
summ.to_csv(os.path.join(OUT, 'E32_weekly_signals_summary.csv'), index=False, float_format='%.4f')
print(summ.round(4).to_string(index=False))
