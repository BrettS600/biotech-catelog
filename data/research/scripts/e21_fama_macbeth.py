"""E21 - The stock-market workhorse applied to cards: Fama-MacBeth cross-sectional regressions and a CAPM-style
alpha/beta test of the reversal portfolio.

Each month t (2022-01 ..), inside the band ($50-$500, sales >= 2, sets >= 24 months), regress the forward h-month gross
return (sell at PriceCharting price t+h, buy at buy_real) on cross-sectionally rank-normalised card characteristics
(rank in [0,1] within the month, so a coefficient = the return spread between the lowest- and highest-ranked card):
    dev12 (price vs own 12-mo mean), mom1, mom12x1 (12-1 momentum, the equity standard), lp (log price = "size"),
    lv (log sales = liquidity), vol12 (volatility), hi12 (distance from 12-mo high), age (set age), beta (24-month
    rolling slope of the card's monthly return on the market median move).
Dependent variable winsorised at 1/99 % per month. Coefficients averaged across months with Newey-West t (lag h).
Specs: univariate per characteristic; the full multivariate; the full one split by regime (reg3 > 0 vs <= 0).
Then the portfolio test: bottom-decile-minus-top-decile dev12 return each month regressed on the market median move
(CAPM-style alpha and beta, HAC t), and the bottom decile's excess over the band likewise.
Outputs: results/E21_fm_univariate.csv, results/E21_fm_multivariate.csv, results/E21_fm_by_regime.csv,
         results/E21_capm_portfolio.csv, results/E21_fm_monthly_coefs.csv
"""
import os, numpy as np, pandas as pd, warnings
import statsmodels.api as sm
from common import load_panel
from xs import features
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
reg3 = F['reg3'][0]
n, T = pr.shape
# monthly card returns and the market median move (same definition as E01: median mom1 of cards $10+ with 2+ sales)
ret = pr[:, 1:] / pr[:, :-1] - 1                         # column j-1 holds the move from month j-1 to j
ret = np.concatenate([np.full((n, 1), np.nan), ret], axis=1)
mkt = np.full(T, np.nan)
for j in range(1, T):
    ok = (pr[:, j - 1] >= 10) & (sl[:, j] >= 2) & ~np.isnan(ret[:, j])
    if ok.sum() >= 200:
        mkt[j] = np.nanmedian(ret[ok, j])
# rolling 24-month beta of each card on the market median (needs >= 12 common observations), known at month j
W = 24
beta = np.full((n, T), np.nan)
for j in range(W, T):
    R = ret[:, j - W + 1:j + 1]; M = mkt[j - W + 1:j + 1]
    good = ~np.isnan(R) & ~np.isnan(M)[None, :]
    cnt = good.sum(1)
    Rz = np.where(good, R, 0.0); Mz = np.where(good, M[None, :], 0.0)
    rm = Rz.sum(1) / np.maximum(cnt, 1); mm = Mz.sum(1) / np.maximum(cnt, 1)
    cov = ((Rz - rm[:, None]) * (Mz - mm[:, None]) * good).sum(1) / np.maximum(cnt - 1, 1)
    var = ((Mz - mm[:, None]) ** 2 * good).sum(1) / np.maximum(cnt - 1, 1)
    b = cov / np.where(var > 0, var, np.nan)
    b[cnt < 12] = np.nan
    beta[:, j] = b
F['beta'] = beta
CHARS = ['dev12', 'mom1', 'mom12x1', 'lp', 'lv', 'vol12', 'hi12', 'age', 'beta']


def rank01(x):
    r = pd.Series(x).rank(pct=True).values
    return r - np.nanmean(r)


def month_frame(j, h):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    for c in CHARS:
        ok &= ~np.isnan(F[c][:, j])
    fut = pr[:, j + h]
    ok &= ~np.isnan(fut)
    idx = np.where(ok)[0]
    if len(idx) < 150:
        return None
    y = fut[idx] / F['buy_real'][idx, j] - 1
    lo, hi = np.percentile(y, [1, 99]); y = np.clip(y, lo, hi)
    X = pd.DataFrame({c: rank01(F[c][idx, j]) for c in CHARS})
    return y, X, idx


def nw_mean(series, lag):
    s = np.asarray(series, float); s = s[~np.isnan(s)]
    if len(s) < 5:
        return np.nan, np.nan, len(s)
    m = sm.OLS(s, np.ones(len(s))).fit(cov_type='HAC', cov_kwds={'maxlags': lag})
    return float(m.params[0]), float(m.tvalues[0]), len(s)


uni, multi, byreg, monthly, capm = [], [], [], [], []
START = months.index('2022-01')
for h in (1, 3, 6):
    coefs = {c: [] for c in CHARS}; ucoefs = {c: [] for c in CHARS}; mon = []; regs = []
    ls_ret = []; dec_ex = []; mk_h = []
    for j in range(START, T - h):
        fr = month_frame(j, h)
        if fr is None:
            continue
        y, X, idx = fr
        mon.append(months[j]); regs.append('up' if reg3[j] > 0 else 'down')
        # univariate
        for c in CHARS:
            b = sm.OLS(y, sm.add_constant(X[[c]])).fit().params[c]
            ucoefs[c].append(b)
        # multivariate
        m = sm.OLS(y, sm.add_constant(X)).fit()
        for c in CHARS:
            coefs[c].append(m.params[c])
        # portfolio: dev12 bottom decile minus top decile; bottom decile minus band
        d = F['dev12'][idx, j]; q10, q90 = np.percentile(d, [10, 90])
        ls_ret.append(y[d <= q10].mean() - y[d >= q90].mean())
        dec_ex.append(y[d <= q10].mean() - y.mean())
        mk_h.append(np.prod(1 + np.nan_to_num(mkt[j + 1:j + h + 1])) - 1)
    for c in CHARS:
        mu, t, k = nw_mean(ucoefs[c], h)
        uni.append(dict(h=h, char=c, mean_coef=mu, nw_t=t, months=k, share_pos=np.mean(np.array(ucoefs[c]) > 0)))
        mu, t, k = nw_mean(coefs[c], h)
        multi.append(dict(h=h, char=c, mean_coef=mu, nw_t=t, months=k, share_pos=np.mean(np.array(coefs[c]) > 0)))
        for r in ('up', 'down'):
            sel = np.array(regs) == r
            mu, t, k = nw_mean(np.array(coefs[c])[sel], h)
            byreg.append(dict(h=h, regime=r, char=c, mean_coef=mu, nw_t=t, months=k))
        for mth, b, ub in zip(mon, coefs[c], ucoefs[c]):
            monthly.append(dict(h=h, month=mth, char=c, multi_coef=b, uni_coef=ub))
    # CAPM-style: portfolio return on the market's h-month move
    for name, y_ in (('bottom_minus_top_decile', ls_ret), ('bottom_decile_minus_band', dec_ex)):
        y_ = np.array(y_); x_ = np.array(mk_h)
        m = sm.OLS(y_, sm.add_constant(x_)).fit(cov_type='HAC', cov_kwds={'maxlags': h})
        capm.append(dict(h=h, portfolio=name, alpha=m.params[0], alpha_t=m.tvalues[0], beta=m.params[1], beta_t=m.tvalues[1], r2=m.rsquared, mean_ret=y_.mean(), share_pos=(y_ > 0).mean(), months=len(y_),
                         mean_up=y_[np.array(regs) == 'up'].mean(), mean_down=y_[np.array(regs) == 'down'].mean()))
pd.DataFrame(uni).round(4).to_csv(os.path.join(OUT, 'E21_fm_univariate.csv'), index=False)
pd.DataFrame(multi).round(4).to_csv(os.path.join(OUT, 'E21_fm_multivariate.csv'), index=False)
pd.DataFrame(byreg).round(4).to_csv(os.path.join(OUT, 'E21_fm_by_regime.csv'), index=False)
pd.DataFrame(capm).round(4).to_csv(os.path.join(OUT, 'E21_capm_portfolio.csv'), index=False)
pd.DataFrame(monthly).round(5).to_csv(os.path.join(OUT, 'E21_fm_monthly_coefs.csv'), index=False)
pd.set_option('display.width', 250)
print('UNIVARIATE (coef = return spread lowest-to-highest rank)'); print(pd.DataFrame(uni).round(3).pivot(index='char', columns='h', values=['mean_coef', 'nw_t']).to_string())
print('MULTIVARIATE'); print(pd.DataFrame(multi).round(3).pivot(index='char', columns='h', values=['mean_coef', 'nw_t']).to_string())
print('BY REGIME (multivariate)'); print(pd.DataFrame(byreg).round(3).pivot(index=['char', 'regime'], columns='h', values=['mean_coef', 'nw_t']).to_string())
print('CAPM-STYLE PORTFOLIO TEST'); print(pd.DataFrame(capm).round(3).to_string())
