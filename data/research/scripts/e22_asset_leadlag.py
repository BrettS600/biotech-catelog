"""E22 - Do the S&P 500, gold or Bitcoin lead the card market? (backlog B14)

Data: pokeviews/pokemon_vs_assets.csv (daily index levels of the PokeViews Top-250, S&P 500, gold, BTC since
2024-04-01) and E01's monthly market median move (pricecharting, 2021-02 ..).
Tests:
  1. Monthly: month-end asset returns vs the PV250 month-end return and vs the PC market median move, Spearman at
     leads/lags -3..+3 months (asset at t+k vs cards at t; negative k = asset leads).
  2. Monthly OLS: next-month card move on its own lag (AR) + the asset's current-month return, Newey-West t,
     leave-one-year-out out-of-sample R2 gain over AR-only (the E04 recipe).
  3. Daily: 30-day asset return at day d vs the PV250's forward 30-day return from d (Spearman, with the number of
     non-overlapping 30-day windows reported, since daily points are heavily autocorrelated).
Outputs: results/E22_asset_monthly.csv, results/E22_asset_leadlag.csv, results/E22_asset_incremental.csv,
         results/E22_asset_daily.csv
"""
import os, numpy as np, pandas as pd, warnings
import statsmodels.api as sm
from scipy.stats import spearmanr
from common import DATA
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
a = pd.read_csv(os.path.join(DATA, 'pokeviews', 'pokemon_vs_assets.csv'), parse_dates=['date']).sort_values('date')
lev = a.set_index('date')[['pv250_index', 'spx_index', 'gold_index', 'btc_index']].dropna()
# 1. month-end levels -> monthly returns
try:
    me = lev.resample('ME').last()
except ValueError:              # pandas < 2.2
    me = lev.resample('M').last()
mr = me.pct_change().dropna()
mr.index = mr.index.strftime('%Y-%m')
mr.columns = ['pv250', 'spx', 'gold', 'btc']
e01 = pd.read_csv(os.path.join(OUT, 'E01_market_monthly.csv')).set_index('month')['median_mom1']
mr['pc_median'] = e01.reindex(mr.index).values
mr.round(5).to_csv(os.path.join(OUT, 'E22_asset_monthly.csv'))
rows = []
for target in ('pv250', 'pc_median'):
    for asset in ('spx', 'gold', 'btc'):
        for k in range(-3, 4):
            x = mr[asset].shift(-k); y = mr[target]     # k<0: asset's past return vs cards now (asset leads)
            ok = x.notna() & y.notna()
            if ok.sum() < 12:
                continue
            rho, p = spearmanr(x[ok], y[ok])
            rows.append(dict(target=target, asset=asset, lag_k=k, spearman=rho, p=p, n=int(ok.sum()), meaning='asset leads by %d mo' % -k if k < 0 else ('same month' if k == 0 else 'asset lags by %d mo' % k)))
ll = pd.DataFrame(rows)
ll.round(4).to_csv(os.path.join(OUT, 'E22_asset_leadlag.csv'), index=False)
# 2. incremental value over the AR term
inc = []
for target in ('pv250', 'pc_median'):
    y = mr[target].shift(-1); ar = mr[target]
    for asset in ('none', 'spx', 'gold', 'btc'):
        X = pd.DataFrame({'ar': ar})
        if asset != 'none':
            X[asset] = mr[asset]
        ok = y.notna() & X.notna().all(1)
        yy, XX = y[ok], sm.add_constant(X[ok])
        m = sm.OLS(yy, XX).fit(cov_type='HAC', cov_kwds={'maxlags': 1})
        years = pd.Series(yy.index.str[:4], index=yy.index)
        pred = pd.Series(np.nan, index=yy.index)
        for yr in years.unique():
            tr = years != yr
            if tr.sum() < 8:
                continue
            f = sm.OLS(yy[tr], XX[tr]).fit()
            pred[~tr] = f.predict(XX[~tr])
        okp = pred.notna()
        oos_r2 = 1 - ((yy[okp] - pred[okp]) ** 2).sum() / ((yy[okp] - yy[okp].mean()) ** 2).sum()
        inc.append(dict(target=target, asset=asset, n=int(ok.sum()), coef=m.params.get(asset, np.nan), hac_t=m.tvalues.get(asset, np.nan), ar_coef=m.params['ar'], in_sample_r2=m.rsquared, loyo_oos_r2=oos_r2))
inc = pd.DataFrame(inc)
inc.round(4).to_csv(os.path.join(OUT, 'E22_asset_incremental.csv'), index=False)
# 3. daily 30-day returns: asset trailing 30d vs PV250 forward 30d
d = lev.copy()
drows = []
for asset in ('spx_index', 'gold_index', 'btc_index', 'pv250_index'):
    x = d[asset] / d[asset].shift(30) - 1
    for fwd in (30, 60, 90):
        y = d['pv250_index'].shift(-fwd) / d['pv250_index'] - 1
        ok = x.notna() & y.notna()
        rho, p = spearmanr(x[ok], y[ok])
        drows.append(dict(asset=asset.replace('_index', ''), fwd_days=fwd, spearman=rho, p_naive=p, n_days=int(ok.sum()), independent_windows=int(ok.sum() // fwd)))
dd = pd.DataFrame(drows)
dd.round(4).to_csv(os.path.join(OUT, 'E22_asset_daily.csv'), index=False)
pd.set_option('display.width', 250)
print('monthly sample:', mr.index.min(), '..', mr.index.max(), len(mr), 'months')
print('contemporaneous Spearman (k=0):'); print(ll[ll.lag_k == 0].round(3).to_string())
print('strongest lead (k<0) per asset/target:'); print(ll[ll.lag_k < 0].sort_values('spearman', key=abs, ascending=False).groupby(['target', 'asset']).head(1).round(3).to_string())
print('incremental over AR:'); print(inc.round(3).to_string())
print('daily 30d -> forward:'); print(dd.round(3).to_string())
