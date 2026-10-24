"""Cross-sectional research engine: card-level features from the PriceCharting panel and
decile tables of forward returns (gross and net of eBay fees).

Conventions (match the site's Forecast tab so results transfer):
  * month t = the decision month; everything used at t is known by the end of month t.
  * buy price "standard" = buy_real = max(price_t, mean(price_{t-2..t}))  - you cannot buy at a dipped print.
  * sell price = PriceCharting price at t+h (h = 1, 2, 3, 6 months).
  * net return = (sell * 0.8589 - 5.20 - buy) / buy  (eBay round trip, buyer pays shipping).
  * universe at t: price >= pmin (default 10), sales_t >= vmin (default 2), both prices known.
Decile tables average across months with equal weight, and report the hit rate (share of months in
which the top decile beat the whole universe) and a t-stat of the monthly top-minus-universe spread.
"""
import numpy as np, pandas as pd
from common import load_panel, net_return, KEEP, FIXED


def _shift(a, k):
    """a[:, j - k] aligned at j (NaN where it runs off the start)."""
    out = np.full_like(a, np.nan)
    if k == 0:
        return a.copy()
    out[:, k:] = a[:, :-k]
    return out


def _roll_mean(a, w):
    """Trailing mean over w columns including the current one (NaN if any missing)."""
    out = np.full_like(a, np.nan)
    c = np.nancumsum(np.where(np.isnan(a), 0, a), axis=1)
    cnt = np.cumsum(~np.isnan(a), axis=1)
    out[:, w - 1:] = (c[:, w - 1:] - np.concatenate([np.zeros((a.shape[0], 1)), c[:, :-w]], axis=1)) / w
    full = (cnt[:, w - 1:] - np.concatenate([np.zeros((a.shape[0], 1), dtype=int), cnt[:, :-w]], axis=1)) == w
    out[:, w - 1:][~full] = np.nan
    return out


def _roll_max(a, w):
    out = np.full_like(a, np.nan)
    for j in range(w - 1, a.shape[1]):
        out[:, j] = np.nanmax(a[:, j - w + 1:j + 1], axis=1)
    return out


def _roll_min(a, w):
    out = np.full_like(a, np.nan)
    for j in range(w - 1, a.shape[1]):
        out[:, j] = np.nanmin(a[:, j - w + 1:j + 1], axis=1)
    return out


def _roll_std(a, w):
    out = np.full_like(a, np.nan)
    for j in range(w - 1, a.shape[1]):
        blk = a[:, j - w + 1:j + 1]
        ok = (~np.isnan(blk)).sum(1) == w
        s = np.nanstd(blk, axis=1)
        s[~ok] = np.nan
        out[:, j] = s
    return out


def features(P):
    """Return dict of [n_cards, n_months] arrays, each usable at column t with data <= t."""
    pr = P['price'].astype(np.float64)
    sl = P['sales'].astype(np.float64)
    with np.errstate(all='ignore'):
        lp = np.log(pr)
        r1 = lp - _shift(lp, 1)                          # log return this month
        F = {}
        F['price'] = pr
        F['sales'] = sl
        F['buy_real'] = np.fmax(pr, _roll_mean(pr, 3))
        F['buy_real'] = np.where(np.isnan(_roll_mean(pr, 3)), pr, F['buy_real'])
        F['mom1'] = pr / _shift(pr, 1) - 1
        F['mom2'] = pr / _shift(pr, 2) - 1
        F['mom3'] = pr / _shift(pr, 3) - 1
        F['mom6'] = pr / _shift(pr, 6) - 1
        F['mom12'] = pr / _shift(pr, 12) - 1
        F['mom12x1'] = _shift(pr, 1) / _shift(pr, 12) - 1   # 12-1 momentum (skip the last month)
        F['mom6x1'] = _shift(pr, 1) / _shift(pr, 6) - 1
        F['accel'] = F['mom1'] - F['mom3'] / 3
        F['vol6'] = _roll_std(r1, 6)
        F['vol12'] = _roll_std(r1, 12)
        F['hi12'] = pr / _roll_max(pr, 12) - 1              # distance below the 12-month high (<= 0)
        F['lo12'] = pr / _roll_min(pr, 12) - 1              # distance above the 12-month low (>= 0)
        F['hi6'] = pr / _roll_max(pr, 6) - 1
        F['lp'] = lp
        F['lv'] = np.log1p(sl)
        F['vgrow'] = sl / (_roll_mean(_shift(sl, 1), 3) + 0.5)   # this month's sales vs the prior 3-month mean
        F['dvol'] = np.log1p(pr * sl)                        # dollar volume
        F['vz'] = (sl - _roll_mean(_shift(sl, 1), 6)) / (_roll_std(_shift(sl, 1), 6) + 1)
        F['dev3'] = pr / _roll_mean(pr, 3) - 1               # price vs its 3-month mean (dip = negative)
        F['dev6'] = pr / _roll_mean(pr, 6) - 1
        F['dev12'] = pr / _roll_mean(pr, 12) - 1
        F['pv_up'] = ((F['mom1'] > 0) & (F['vgrow'] > 1)).astype(float) - ((F['mom1'] > 0) & (F['vgrow'] < 1)).astype(float)
        # stale: months since the last month with a sale
        stale = np.zeros_like(sl)
        run = np.zeros(sl.shape[0])
        for j in range(sl.shape[1]):
            run = np.where(sl[:, j] > 0, 0, run + 1)
            stale[:, j] = run
        F['stale'] = stale
        # age in months since the set's release
        rel = P['cards']['rel_mi'].values.astype(float)
        F['age'] = P['mi'][None, :] - rel[:, None]
        # set-level momentum: median mom1 / mom3 of the set's cards (price >= 5, sales > 0)
        sets = P['cards']['set'].fillna('').values
        codes, inv = np.unique(sets, return_inverse=True)
        for key, src in (('set_mom1', 'mom1'), ('set_mom3', 'mom3')):
            out = np.full_like(pr, np.nan)
            m = src
            for j in range(pr.shape[1]):
                col = F[m][:, j]
                ok = ~np.isnan(col) & (pr[:, j] >= 5) & (sl[:, j] > 0)
                df = pd.DataFrame({'c': inv[ok], 'v': col[ok]})
                med = df.groupby('c')['v'].median()
                cnt = df.groupby('c')['v'].size()
                med = med[cnt >= 5]
                out[:, j] = med.reindex(inv).values
            F[key] = out
        F['rel_mom1'] = F['mom1'] - F['set_mom1']            # idiosyncratic move vs the set
        # market regime: median mom1 of the universe each month, trailing 3-month mean. The universe is cards that were
        # $10+ LAST month with 2+ sales this month - conditioning on this month's price would drop the cards that fell
        # below $10 and bias the median up (that bug made 2022 look flat-positive in the first runs of E03/E05/E08-E10).
        reg1 = np.full(pr.shape[1], np.nan)
        for j in range(1, pr.shape[1]):
            ok = (pr[:, j - 1] >= 10) & (sl[:, j] >= 2) & ~np.isnan(F['mom1'][:, j])
            if ok.sum() > 100:
                reg1[j] = np.median(F['mom1'][ok, j])
        reg3 = pd.Series(reg1).rolling(3).mean().values
        F['reg1'] = np.broadcast_to(reg1, pr.shape)
        F['reg3'] = np.broadcast_to(reg3, pr.shape)
    return F


def forward(P, F, h, sell='pc'):
    """Gross and net forward returns for a hold of h months bought at buy_real; NaN where unknown."""
    pr = P['price'].astype(np.float64)
    sl = P['sales'].astype(np.float64)
    fut = np.full_like(pr, np.nan)
    fut[:, :-h] = pr[:, h:]
    futs = np.full_like(pr, np.nan)
    futs[:, :-h] = sl[:, h:]
    buy = F['buy_real']
    with np.errstate(all='ignore'):
        gross = fut / buy - 1
        net = (fut * KEEP - FIXED - buy) / buy
    return gross, net, futs


def decile_table(P, F, signal, h, pmin=10, pmax=None, vmin=2, start='2022-01', end=None, nq=10, need_future_sale=False, buy='buy_real'):
    """Average forward returns by signal decile, equal-weighting months. Returns (table DataFrame, monthly spread Series)."""
    pr = P['price']; sl = P['sales']
    months = P['months']
    gross, net, futs = forward(P, F, h)
    if buy != 'buy_real':
        fut = np.full_like(pr, np.nan, dtype=np.float64); fut[:, :-h] = pr[:, h:]
        b = F[buy]
        with np.errstate(all='ignore'):
            gross = fut / b - 1
            net = (fut * KEEP - FIXED - b) / b
    sig = F[signal] if isinstance(signal, str) else signal
    j0 = months.index(start)
    j1 = len(months) - h - 1 if end is None else months.index(end)
    rows = []
    spreads = []
    for j in range(j0, j1 + 1):
        ok = (pr[:, j] >= pmin) & (sl[:, j] >= vmin) & ~np.isnan(gross[:, j]) & ~np.isnan(sig[:, j])
        if pmax is not None:
            ok &= pr[:, j] <= pmax
        if need_future_sale:
            ok &= futs[:, j] >= 1
        n = ok.sum()
        if n < 200:
            continue
        s = sig[ok, j]
        g = gross[ok, j]
        nt = net[ok, j]
        q = pd.qcut(pd.Series(s).rank(method='first'), nq, labels=False).values
        uni_g, uni_n = g.mean(), nt.mean()
        for d in range(nq):
            m = q == d
            rows.append((months[j], d, m.sum(), g[m].mean(), np.median(g[m]), nt[m].mean(), (nt[m] > 0).mean(), (g[m] > 0).mean(), uni_g, uni_n))
        spreads.append((months[j], g[q == nq - 1].mean() - uni_g, nt[q == nq - 1].mean() - uni_n, (nt[q == nq - 1] > 0).mean() - (nt > 0).mean()))
    df = pd.DataFrame(rows, columns=['month', 'decile', 'n', 'gross_mean', 'gross_median', 'net_mean', 'p_net_pos', 'p_gross_pos', 'uni_gross', 'uni_net'])
    tab = df.groupby('decile').agg(n=('n', 'sum'), months=('month', 'nunique'), gross_mean=('gross_mean', 'mean'), gross_median=('gross_median', 'mean'), net_mean=('net_mean', 'mean'), p_net_pos=('p_net_pos', 'mean'), p_gross_pos=('p_gross_pos', 'mean'), uni_gross=('uni_gross', 'mean'), uni_net=('uni_net', 'mean')).reset_index()
    sp = pd.DataFrame(spreads, columns=['month', 'spread_gross', 'spread_net', 'spread_pnet']).set_index('month')
    return tab, sp


def summarize(tab, sp, signal, h, label=None):
    """One row: top-decile vs bottom vs universe, hit rate, t-stat."""
    top = tab[tab['decile'] == tab['decile'].max()].iloc[0]
    bot = tab[tab['decile'] == 0].iloc[0]
    t = sp['spread_gross'].mean() / (sp['spread_gross'].std(ddof=1) / np.sqrt(len(sp))) if len(sp) > 2 else np.nan
    return dict(signal=label or signal, h=h, months=len(sp), top_gross=top['gross_mean'], top_net=top['net_mean'], top_p_net_pos=top['p_net_pos'],
                bottom_gross=bot['gross_mean'], bottom_net=bot['net_mean'], bottom_p_net_pos=bot['p_net_pos'], uni_gross=top['uni_gross'], uni_net=top['uni_net'],
                spread_top_uni_gross=sp['spread_gross'].mean(), hit_rate=(sp['spread_gross'] > 0).mean(), t_stat=t,
                spearman_like=np.corrcoef(tab['decile'], tab['gross_mean'])[0, 1])


def ic_series(P, F, signal, h, pmin=10, vmin=2, start='2022-01'):
    """Monthly Spearman rank correlation between the signal and the forward gross return."""
    from scipy.stats import spearmanr
    pr = P['price']; sl = P['sales']; months = P['months']
    gross, net, futs = forward(P, F, h)
    sig = F[signal] if isinstance(signal, str) else signal
    out = []
    for j in range(months.index(start), len(months) - h):
        ok = (pr[:, j] >= pmin) & (sl[:, j] >= vmin) & ~np.isnan(gross[:, j]) & ~np.isnan(sig[:, j])
        if ok.sum() < 200:
            continue
        out.append((months[j], spearmanr(sig[ok, j], gross[ok, j]).correlation, ok.sum()))
    return pd.DataFrame(out, columns=['month', 'ic', 'n']).set_index('month')
