"""E12 - Risk structure and hold-period economics for the reversal picks (dev12 bottom decile, $50-$500, sets >= 24 mo).
(a) How much of a pick's return is the market month vs the card? Variance decomposition of card returns into the
    month mean (market) and the residual; implied correlation between two picks in the same month.
(b) Diversification: random equal-weight baskets of n = 1..40 picks per month, bought 20% under: std, P(loss), 5th pct.
(c) Hold-period economics: expected net per month of capital for h = 1, 2, 3, 6, by discount and regime,
    i.e. (1 + mean net)^(1/h) - 1 and the share of cycles that lose - which hold compounds fastest at each discount?
Outputs: results/E12_variance_decomp.csv, results/E12_diversification.csv, results/E12_hold_economics.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel, KEEP, FIXED
from xs import features, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']
rng = np.random.RandomState(11)


def picks(j, h, gross):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(gross[:, j]) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    idx = np.where(ok)[0]
    if len(idx) < 100:
        return None
    s = F['dev12'][idx, j]
    cut = np.percentile(s, 10)
    return idx[s <= cut]

# (a) variance decomposition and (b) diversification, h = 1 and 3, bought 20% under
vd, dv = [], []
for h in (1, 3):
    gross, net, futs = forward(P, F, h)
    allr = []
    for j in range(months.index('2022-01'), len(months) - h):
        idx = picks(j, h, gross)
        if idx is None:
            continue
        b = F['buy_real'][idx, j]
        g = gross[idx, j]
        n20 = ((1 + g) * b * KEEP - FIXED - 0.8 * b) / (0.8 * b)
        allr.append((months[j], F['reg3'][0, j], n20))
        for n in (1, 2, 3, 5, 10, 20, 40):
            for _ in range(50):
                take = rng.choice(len(n20), min(n, len(n20)), replace=False)
                dv.append((h, months[j], n, n20[take].mean()))
    tot = np.concatenate([r[2] for r in allr])
    mm = np.concatenate([np.full(len(r[2]), r[2].mean()) for r in allr])
    var_tot = tot.var(); var_month = mm.var(); var_resid = (tot - mm).var()
    vd.append(dict(h=h, months=len(allr), picks=len(tot), mean_net20=tot.mean(), std_net20=np.sqrt(var_tot), std_month_means=np.sqrt(var_month), std_residual=np.sqrt(var_resid), share_market=var_month / var_tot, implied_pair_corr=var_month / var_tot,
                   p_month_mean_neg=np.mean([r[2].mean() < 0 for r in allr]), corr_month_mean_vs_reg3=np.corrcoef([r[1] for r in allr], [r[2].mean() for r in allr])[0, 1]))
pd.DataFrame(vd).round(4).to_csv(os.path.join(OUT, 'E12_variance_decomp.csv'), index=False)
print(pd.DataFrame(vd).round(3).to_string())
d = pd.DataFrame(dv, columns=['h', 'month', 'n', 'basket_net20'])
agg = d.groupby(['h', 'n']).agg(mean=('basket_net20', 'mean'), std=('basket_net20', 'std'), p_loss=('basket_net20', lambda x: (x < 0).mean()), p5=('basket_net20', lambda x: x.quantile(.05)), p25=('basket_net20', lambda x: x.quantile(.25))).reset_index()
agg.round(4).to_csv(os.path.join(OUT, 'E12_diversification.csv'), index=False)
print(agg.round(3).to_string())

# (c) hold-period economics
rows = []
for h in (1, 2, 3, 6):
    gross, net, futs = forward(P, F, h)
    for j in range(months.index('2022-01'), len(months) - h):
        idx = picks(j, h, gross)
        if idx is None:
            continue
        b = F['buy_real'][idx, j]; g = gross[idx, j]; reg = F['reg3'][0, j]
        regime = 'strong' if reg > 0.02 else ('flat' if reg > -0.005 else 'falling')
        for disc in (0.0, 0.10, 0.15, 0.20):
            nt = ((1 + g) * b * KEEP - FIXED - (1 - disc) * b) / ((1 - disc) * b)
            rows.append((h, months[j], regime, 'reg3>0' if reg > 0 else 'reg3<=0', disc, len(idx), nt.mean(), np.median(nt), (nt > 0).mean()))
e = pd.DataFrame(rows, columns=['h', 'month', 'regime', 'gate', 'disc', 'n', 'net_mean', 'net_median', 'p_net_pos'])
def summ(e, keys):
    g = e.groupby(keys).agg(months=('month', 'nunique'), net_mean=('net_mean', 'mean'), p_net_pos=('p_net_pos', 'mean'), p_month_loss=('net_mean', lambda x: (x < 0).mean()), worst_month=('net_mean', 'min')).reset_index()
    g['net_per_month'] = (1 + g['net_mean']) ** (1 / g['h']) - 1
    return g
s1 = summ(e, ['h', 'disc']); s1.insert(2, 'subset', 'ALL')
s2 = summ(e, ['h', 'disc', 'regime']).rename(columns={'regime': 'subset'})
s3 = summ(e, ['h', 'disc', 'gate']).rename(columns={'gate': 'subset'})
out = pd.concat([s1, s2, s3], ignore_index=True)
out.round(4).to_csv(os.path.join(OUT, 'E12_hold_economics.csv'), index=False)
pd.set_option('display.width', 250)
print(out[out.subset.isin(['ALL', 'reg3>0', 'reg3<=0'])].sort_values(['disc', 'subset', 'h']).round(3).to_string())
