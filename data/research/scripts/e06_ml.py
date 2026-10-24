"""E06 - Walk-forward gradient boosting at 1 and 3 months (and 6 for reference), three feature sets:
  A  card-only (what the live forecast.py uses: momentum, reversal, volatility, volume, age, set momentum, regime)
  B  A + market-level exogenous features (Google Trends web-search change / z-score, breadth)
  C  B without the card's own 1-3 month momentum (reversal + structure only)
Refit every 6 months on all months whose outcome is known (<= t-h), score every card at t, rank within the month.
Metrics per month: Spearman IC; top 5% and top decile mean gross/net and P(net>0) inside $50-$500; by regime.
Also: the discount under the standard price at which the top decile's P(net>0) would reach 60%.
Outputs: results/E06_ml_summary.csv, results/E06_ml_monthly.csv, results/E06_ml_importance.csv
"""
import os, sys, numpy as np, pandas as pd, warnings, time
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from common import load_panel, load_trends, KEEP, FIXED
from xs import features, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']
n_cards, n_m = pr.shape
cards = P['cards']
rar = pd.Categorical(cards['rarity'].fillna('')).codes.astype(float)
fin = pd.Categorical(cards['finish'].fillna('')).codes.astype(float)
tr = load_trends()
gt = tr['web_search'].astype(float).reindex(months)
gt_chg1 = (gt.pct_change()).values
gt_z12 = ((gt - gt.rolling(12).mean()) / gt.rolling(12).std()).values
mk = pd.read_csv(os.path.join(OUT, 'E01_market_monthly.csv')).set_index('month')
breadth = mk['breadth_up'].reindex(months).values
cal = np.array([int(m[5:]) for m in months], dtype=float)

CARD = ['mom1', 'mom3', 'mom6', 'mom12', 'mom12x1', 'accel', 'vol6', 'vol12', 'hi12', 'lo12', 'lp', 'lv', 'vgrow', 'dvol', 'vz', 'dev3', 'dev6', 'dev12', 'stale', 'age', 'set_mom1', 'set_mom3', 'rel_mom1', 'reg1', 'reg3']
EXO = ['gt_chg1', 'gt_z12', 'breadth', 'cal']
SETS = {'A_card': CARD + ['rar', 'fin'], 'B_card+exo': CARD + ['rar', 'fin'] + EXO, 'C_noshortmom+exo': [c for c in CARD if c not in ('mom1', 'mom3', 'accel', 'rel_mom1', 'dev3')] + ['rar', 'fin'] + EXO}


def frame(j, cols):
    d = {}
    for c in cols:
        if c == 'rar': d[c] = rar
        elif c == 'fin': d[c] = fin
        elif c == 'gt_chg1': d[c] = np.full(n_cards, gt_chg1[j])
        elif c == 'gt_z12': d[c] = np.full(n_cards, gt_z12[j])
        elif c == 'breadth': d[c] = np.full(n_cards, breadth[j])
        elif c == 'cal': d[c] = np.full(n_cards, cal[j])
        elif c == 'age': d[c] = np.log1p(np.clip(F['age'][:, j], 0, 400))
        else: d[c] = F[c][:, j]
    return pd.DataFrame(d)


def run(h, cols, label, start='2022-12', refit_every=6):
    gross, net, futs = forward(P, F, h)
    uni = (pr >= 10) & (sl >= 2) & ~np.isnan(gross)
    y_all = np.clip(gross, -0.9, 2.0)
    j0 = months.index(start)
    model = None; last_fit = -99
    rows = []; imps = []
    for j in range(j0, n_m - h):
        if j - last_fit >= refit_every:
            tj = j - h   # last month whose outcome is known
            Xs, ys = [], []
            for k in range(12, tj + 1):
                ok = uni[:, k]
                Xk = frame(k, cols)[ok]
                Xs.append(Xk); ys.append(y_all[ok, k])
            X = pd.concat(Xs, ignore_index=True); y = np.concatenate(ys)
            model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200, l2_regularization=1.0, random_state=0)
            model.fit(X, y)
            last_fit = j
            if j == j0 or j >= n_m - h - refit_every:
                sub = np.random.RandomState(0).choice(len(X), min(20000, len(X)), replace=False)
                pi = permutation_importance(model, X.iloc[sub], y[sub], n_repeats=3, random_state=0)
                imps.append(pd.DataFrame({'set': label, 'h': h, 'fit_month': months[j], 'feature': cols, 'importance': pi.importances_mean}))
        ok = uni[:, j]
        Xj = frame(j, cols)[ok]
        pred = model.predict(Xj)
        g = gross[ok, j]; nt = net[ok, j]; p = pr[ok, j]; b = F['buy_real'][ok, j]
        from scipy.stats import spearmanr
        ic = spearmanr(pred, g).correlation
        band = (p >= 50) & (p <= 500)
        reg = F['reg3'][0, j]
        rank = pd.Series(pred).rank(pct=True).values
        rec = dict(set=label, h=h, month=months[j], n=ok.sum(), n_band=band.sum(), reg3=reg, ic=ic, uni_gross=g.mean(), band_gross=g[band].mean(), band_net=nt[band].mean(), band_pnet=(nt[band] > 0).mean())
        for q, lab in ((0.95, 'top5'), (0.90, 'top10'), (0.80, 'top20')):
            m = band & (rank >= q)
            if m.sum() >= 5:
                rec[lab + '_n'] = m.sum(); rec[lab + '_gross'] = g[m].mean(); rec[lab + '_gross_med'] = np.median(g[m]); rec[lab + '_net'] = nt[m].mean(); rec[lab + '_pnet'] = (nt[m] > 0).mean(); rec[lab + '_pgross'] = (g[m] > 0).mean()
                # discount at which P(net>0) reaches 60%: net_d = ((1+g) b KEEP - FIXED - (1-d) b) / ((1-d) b) > 0  <=>  d > 1 - ((1+g) KEEP - FIXED/b)
                need = 1 - ((1 + g[m]) * KEEP - FIXED / b[m])
                rec[lab + '_disc_for_p60'] = np.percentile(need, 60)
                rec[lab + '_pnet_at20off'] = (need < 0.20).mean()
                rec[lab + '_pnet_at15off'] = (need < 0.15).mean()
        m = band & (rank <= 0.10)
        if m.sum() >= 5:
            rec['bot10_gross'] = g[m].mean(); rec['bot10_net'] = nt[m].mean()
        rows.append(rec)
        print('%s h=%d %s ic %.3f top10 gross %+.3f net %+.3f pnet %.2f (band %+.3f) p20off %.2f' % (label, h, months[j], ic, rec.get('top10_gross', np.nan), rec.get('top10_net', np.nan), rec.get('top10_pnet', np.nan), rec['band_gross'], rec.get('top10_pnet_at20off', np.nan)), flush=True)
    return pd.DataFrame(rows), (pd.concat(imps) if imps else None)

allm, allimp = [], []
hs = [int(a) for a in sys.argv[1:]] or [1, 3, 6]
for h in hs:
    for label, cols in SETS.items():
        t0 = time.time()
        dfm, imp = run(h, cols, label)
        allm.append(dfm)
        if imp is not None: allimp.append(imp)
        print('--- %s h=%d done in %.0fs' % (label, h, time.time() - t0), flush=True)
        pd.concat(allm).round(4).to_csv(os.path.join(OUT, 'E06_ml_monthly.csv'), index=False)
        if allimp: pd.concat(allimp).round(5).to_csv(os.path.join(OUT, 'E06_ml_importance.csv'), index=False)
dfm = pd.concat(allm)
dfm['regime'] = pd.cut(dfm['reg3'], [-1, -0.005, 0.02, 1], labels=['falling', 'flat', 'strong'])
def agg(g):
    out = {'months': len(g), 'ic_mean': g['ic'].mean(), 'ic_pos_share': (g['ic'] > 0).mean(), 'band_gross': g['band_gross'].mean(), 'band_net': g['band_net'].mean(), 'band_pnet': g['band_pnet'].mean()}
    for lab in ('top5', 'top10', 'top20'):
        for k in ('gross', 'gross_med', 'net', 'pnet', 'pgross', 'disc_for_p60', 'pnet_at20off', 'pnet_at15off'):
            c = lab + '_' + k
            if c in g: out[c] = g[c].mean()
        if lab + '_gross' in g: out[lab + '_beats_band'] = (g[lab + '_gross'] > g['band_gross']).mean()
    out['bot10_gross'] = g['bot10_gross'].mean() if 'bot10_gross' in g else np.nan
    return pd.Series(out)
s1 = dfm.groupby(['set', 'h']).apply(agg).reset_index(); s1.insert(2, 'regime', 'ALL')
s2 = dfm.groupby(['set', 'h', 'regime'], observed=True).apply(agg).reset_index()
summ = pd.concat([s1, s2], ignore_index=True)
summ.round(4).to_csv(os.path.join(OUT, 'E06_ml_summary.csv'), index=False)
print(summ.round(3).to_string())
