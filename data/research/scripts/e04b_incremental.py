"""E04b - Does any indicator add to the market's own momentum? Regressions of the next 1- and 3-month PriceCharting-wide
median move on last month's median move (the AR term) plus one candidate at a time; Newey-West t-stats and the
out-of-sample gain from a leave-one-year-out fit. Output: results/E04_incremental.csv
"""
import os, numpy as np, pandas as pd, warnings
import statsmodels.api as sm
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
m = pd.read_csv(os.path.join(OUT, 'E04_monthly_merged.csv')).set_index('month')
cands = ['breadth_up', 'median_trail3', 'sales_chg3', 'dvol_chg3', 't250_ret1', 'hci_gauge', 'mms_all', 'new_highs', 'pct_above_30d', 'hi_minus_lo', 'dist_ema90', 'dist_sma200', 'pct_above_ema90', 'rsi14', 'gt_web_search', 'gt_web_search_z12', 'gt_web_search_chg1', 'gt_web_search_chg3', 'gt_news_search_z12', 'gt_image_search_z12', 'gt_youtube_search_z12', 'gt_google_shopping_z12']
rows = []
for target in ('median_fwd1', 'median_fwd3'):
    for c in [None] + cands:
        cols = ['median_mom1'] + ([c] if c else [])
        d = m[[target] + cols].dropna()
        if len(d) < 15:
            continue
        X = sm.add_constant(d[cols]); y = d[target]
        fit = sm.OLS(y, X).fit(cov_type='HAC', cov_kwds={'maxlags': 3})
        # leave-one-year-out
        yrs = d.index.str[:4]
        pred = pd.Series(index=d.index, dtype=float)
        for yv in yrs.unique():
            tr = yrs != yv
            if tr.sum() < 10:
                continue
            f2 = sm.OLS(y[tr], X[tr]).fit()
            pred[~tr] = f2.predict(X[~tr])
        ok = pred.notna()
        oos_r2 = 1 - ((y[ok] - pred[ok]) ** 2).sum() / ((y[ok] - y[ok].mean()) ** 2).sum()
        # sign accuracy out of sample
        acc = ((pred[ok] > 0) == (y[ok] > 0)).mean()
        rows.append((target, c or '(AR only)', len(d), fit.rsquared, fit.params.get(c, np.nan), fit.tvalues.get(c, np.nan), oos_r2, acc))
df = pd.DataFrame(rows, columns=['target', 'added_predictor', 'n', 'r2_in_sample', 'coef', 'hac_t', 'r2_leave_one_year_out', 'oos_sign_accuracy'])
df.round(4).to_csv(os.path.join(OUT, 'E04_incremental.csv'), index=False)
print(df.round(3).to_string())
