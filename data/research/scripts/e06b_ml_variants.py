"""E06b - ML variants aimed at the actual objective (clearing the fee wall at 1-3 months inside the band):
  D_band    regression as E06-A but trained and ranked inside $50-$500 only (no cheap-card dilution)
  E_cls     classifier: target = gross return clears the card's own fee wall (net > 0 at the standard price);
            rank by predicted probability; also report calibration (predicted vs realised P) - this is what the
            Forecast tab's "chance" should be
  G_cls20   classifier: target = net > 0 when bought 20% under the standard price (the scenario that pays)
Refit every 6 months, walk-forward from 2022-12. Outputs: results/E06b_variants_monthly.csv, E06b_variants_summary.csv,
E06b_calibration.csv
"""
import os, sys, numpy as np, pandas as pd, warnings, time
from sklearn.ensemble import HistGradientBoostingRegressor, HistGradientBoostingClassifier
from scipy.stats import spearmanr
from common import load_panel, KEEP, FIXED
from xs import features, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']
n_cards, n_m = pr.shape
cards = P['cards']
rar = pd.Categorical(cards['rarity'].fillna('')).codes.astype(float)
fin = pd.Categorical(cards['finish'].fillna('')).codes.astype(float)
COLS = ['mom1', 'mom3', 'mom6', 'mom12', 'mom12x1', 'accel', 'vol6', 'vol12', 'hi12', 'lo12', 'lp', 'lv', 'vgrow', 'dvol', 'vz', 'dev3', 'dev6', 'dev12', 'stale', 'age', 'set_mom1', 'set_mom3', 'rel_mom1', 'reg1', 'reg3', 'rar', 'fin']


def frame(j):
    d = {}
    for c in COLS:
        if c == 'rar': d[c] = rar
        elif c == 'fin': d[c] = fin
        elif c == 'age': d[c] = np.log1p(np.clip(F['age'][:, j], 0, 400))
        else: d[c] = F[c][:, j]
    return pd.DataFrame(d)


def run(h, variant, start='2022-12', refit_every=6):
    gross, net, futs = forward(P, F, h)
    buy = F['buy_real']
    net20 = ((1 + gross) * buy * KEEP - FIXED - 0.8 * buy) / (0.8 * buy)
    uni = (pr >= 50) & (pr <= 500) & (sl >= 2) & ~np.isnan(gross)
    if variant == 'D_band':
        y_all = np.clip(gross, -0.9, 2.0)
    elif variant == 'E_cls':
        y_all = (net > 0).astype(float)
    else:
        y_all = (net20 > 0).astype(float)
    j0 = months.index(start); model = None; last_fit = -99
    rows = []; cal = []
    for j in range(j0, n_m - h):
        if j - last_fit >= refit_every:
            tj = j - h
            Xs, ys = [], []
            for k in range(12, tj + 1):
                ok = uni[:, k]
                Xs.append(frame(k)[ok]); ys.append(y_all[ok, k])
            X = pd.concat(Xs, ignore_index=True); y = np.concatenate(ys)
            if variant == 'D_band':
                model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=100, l2_regularization=1.0, random_state=0)
            else:
                model = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=100, l2_regularization=1.0, random_state=0)
            model.fit(X, y); last_fit = j
        ok = uni[:, j]
        Xj = frame(j)[ok]
        pred = model.predict(Xj) if variant == 'D_band' else model.predict_proba(Xj)[:, 1]
        g = gross[ok, j]; nt = net[ok, j]; n20 = net20[ok, j]
        rank = pd.Series(pred).rank(pct=True).values
        rec = dict(variant=variant, h=h, month=months[j], n=ok.sum(), reg3=F['reg3'][0, j], ic=spearmanr(pred, g).correlation, band_gross=g.mean(), band_net=nt.mean(), band_pnet=(nt > 0).mean(), band_pnet20=(n20 > 0).mean())
        for q, lab in ((0.95, 'top5'), (0.90, 'top10'), (0.80, 'top20')):
            m = rank >= q
            rec[lab + '_gross'] = g[m].mean(); rec[lab + '_net'] = nt[m].mean(); rec[lab + '_pnet'] = (nt[m] > 0).mean(); rec[lab + '_pnet20'] = (n20[m] > 0).mean(); rec[lab + '_net20'] = n20[m].mean()
            if variant != 'D_band':
                rec[lab + '_pred_mean'] = pred[m].mean()
        if variant != 'D_band':
            # calibration: predicted probability bins vs realised frequency of the target
            yj = y_all[ok, j]
            bins = np.clip((pred * 10).astype(int), 0, 9)
            for b in range(10):
                mb = bins == b
                if mb.sum() >= 5:
                    cal.append((variant, h, months[j], b / 10, mb.sum(), pred[mb].mean(), yj[mb].mean()))
        rows.append(rec)
        if j % 6 == 0:
            print('%s h=%d %s ic %.3f top10 gross %+.3f pnet %.2f pnet20 %.2f' % (variant, h, months[j], rec['ic'], rec['top10_gross'], rec['top10_pnet'], rec['top10_pnet20']), flush=True)
    return pd.DataFrame(rows), pd.DataFrame(cal, columns=['variant', 'h', 'month', 'bin', 'n', 'pred_mean', 'realised'])

allm, allc = [], []
for h in (1, 3):
    for v in ('D_band', 'E_cls', 'G_cls20'):
        t0 = time.time(); m, c = run(h, v); allm.append(m); allc.append(c)
        print('--- %s h=%d %.0fs' % (v, h, time.time() - t0), flush=True)
        pd.concat(allm).round(4).to_csv(os.path.join(OUT, 'E06b_variants_monthly.csv'), index=False)
        pd.concat(allc).round(4).to_csv(os.path.join(OUT, 'E06b_calibration.csv'), index=False)
dfm = pd.concat(allm)
dfm['regime'] = pd.cut(dfm['reg3'], [-1, -0.005, 0.02, 1], labels=['falling', 'flat', 'strong'])
num = [c for c in dfm.columns if c not in ('variant', 'h', 'month', 'regime')]
s1 = dfm.groupby(['variant', 'h'])[num].mean().reset_index(); s1.insert(2, 'regime', 'ALL'); s1.insert(3, 'months', dfm.groupby(['variant', 'h']).size().values)
s2 = dfm.groupby(['variant', 'h', 'regime'], observed=True)[num].mean().reset_index(); s2.insert(3, 'months', dfm.groupby(['variant', 'h', 'regime'], observed=True).size().values)
summ = pd.concat([s1, s2], ignore_index=True)
summ.round(4).to_csv(os.path.join(OUT, 'E06b_variants_summary.csv'), index=False)
pd.set_option('display.width', 250)
print(summ[['variant', 'h', 'regime', 'months', 'ic', 'band_gross', 'band_pnet', 'band_pnet20', 'top10_gross', 'top10_net', 'top10_pnet', 'top10_pnet20', 'top10_net20', 'top5_gross', 'top5_pnet', 'top5_pnet20']].round(3).to_string())
c = pd.concat(allc)
cc = c.groupby(['variant', 'h', 'bin']).apply(lambda g: pd.Series({'n': g['n'].sum(), 'pred': np.average(g['pred_mean'], weights=g['n']), 'realised': np.average(g['realised'], weights=g['n'])})).reset_index()
print(cc.round(3).to_string())
