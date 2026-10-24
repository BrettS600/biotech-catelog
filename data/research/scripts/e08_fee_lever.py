"""E08 - The fee lever: how P(net>0) and mean net change under alternative selling-cost structures, using the realised
3-month return distribution of the band ($50-$500, sales >= 2) and of the E03 best selection (dev12 bottom decile,
strong regime). The question is not "which signal" but "how much is each dollar of friction worth" - because a
signal that adds +3% gross is worth less than a fee change of 3 points.
Scenarios (sell side; buy side = standard price unless a discount is named):
  base          13.25% x 1.065 FVF + $0.40 + $4.50 shipping + $0.30 supplies   (the site's STD_FEES)
  store         eBay Store subscription rate for trading cards 12.35% x 1.065 (+ the store's monthly fee is ignored here)
  buyer_ships   buyer pays shipping: drop the $4.50 (assumes the sale price is unchanged - optimistic)
  store+ships   both
  no_fixed      no per-item fixed costs at all (a bulk / local sale)
  tcg_like      a marketplace at 10.25% + 2.5% processing + $0.30 (TCGplayer-like) with $4.50 shipping
  zero          0% (in person / cash) - the upper bound
Buy-side discounts 0 / 10 / 15 / 20 / 25% under the standard price, each scenario.
Outputs: results/E08_fee_lever.csv
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel
from xs import features, forward
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'], P['sales'], P['months']
SCEN = {'base': (0.1325 * 1.065, 0.40 + 4.50 + 0.30), 'store': (0.1235 * 1.065, 0.40 + 4.50 + 0.30), 'buyer_ships': (0.1325 * 1.065, 0.40 + 0.30),
        'store+ships': (0.1235 * 1.065, 0.40 + 0.30), 'no_fixed': (0.1325 * 1.065, 0.0), 'tcg_like': (0.1025 + 0.025, 0.30 + 4.50), 'zero': (0.0, 0.0)}
rows = []
for h in (1, 3):
    gross, net, futs = forward(P, F, h)
    sel = {'band_all': [], 'dev12_bottom_strong': [], 'dev12_bottom_any': []}
    for j in range(months.index('2022-01'), len(months) - h):
        ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(gross[:, j]) & ~np.isnan(F['dev12'][:, j])
        if ok.sum() < 300:
            continue
        g = gross[ok, j]; b = F['buy_real'][ok, j]; s = F['dev12'][ok, j]
        q = pd.qcut(pd.Series(s).rank(method='first'), 10, labels=False).values
        sel['band_all'].append((g, b))
        sel['dev12_bottom_any'].append((g[q == 0], b[q == 0]))
        if F['reg3'][0, j] > 0.02:
            sel['dev12_bottom_strong'].append((g[q == 0], b[q == 0]))
    for name, parts in sel.items():
        g = np.concatenate([p[0] for p in parts]); b = np.concatenate([p[1] for p in parts])
        for sc, (rate, fixed) in SCEN.items():
            for d in (0.0, 0.10, 0.15, 0.20, 0.25):
                buy = b * (1 - d)
                nt = ((1 + g) * b * (1 - rate) - fixed - buy) / buy
                rows.append((h, name, len(g), sc, d, nt.mean(), np.median(nt), (nt > 0).mean(), np.percentile(nt, 10)))
df = pd.DataFrame(rows, columns=['h', 'selection', 'n', 'fee_scenario', 'buy_discount', 'net_mean', 'net_median', 'p_net_pos', 'net_p10'])
df.round(4).to_csv(os.path.join(OUT, 'E08_fee_lever.csv'), index=False)
pd.set_option('display.width', 200)
print(df[(df.buy_discount.isin([0.0, 0.2])) & (df.selection != 'dev12_bottom_any')].round(3).to_string())
