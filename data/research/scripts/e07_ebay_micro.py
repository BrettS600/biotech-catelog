"""E07 - eBay microstructure: how much of the fee wall can execution recover?
The PriceCharting backtests price every buy at the standard price and every sale at PriceCharting's level. On eBay the
buyer can pick the cheapest credible listing (the collector's floor L vs the sold median A) and the seller can list
above the median and wait (the 80th percentile of sold prices s80 vs the median smed). From the eBay Catalog snapshot
and the daily rollup (individual sale prices per card per day):
  (a) the floor discount L/A by price tier - how often a 10/15/20%-under buy exists right now;
  (b) the patient-sell premium s80/smed by tier;
  (c) from the rollup's individual sales: the share of sales printed >= 10/15/20% below the card's 7-day median
      (= how often a buyer who watches gets that discount) and >= 10/15% above it (what a patient seller can get);
  (d) eBay sold median vs PriceCharting price (A/pc) by tier - the two price levels the model has to reconcile;
  (e) liquidity: expected days to sell (edays) and 30-day sales (n30) by tier.
Outputs: results/E07_floor_discount.csv, results/E07_sale_dispersion.csv, results/E07_A_vs_pc.csv
"""
import os, glob, numpy as np, pandas as pd, warnings
warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, '..', 'results')
f = sorted(glob.glob(os.path.join(DATA, 'ebay', 'catalog', '*.csv.gz')))[-1]
c = pd.read_csv(f)
tiers = [(25, 50), (50, 100), (100, 250), (250, 1000)]
rows = []
for lo, hi in tiers:
    t = c[(c['A'] >= lo) & (c['A'] < hi) & c['L'].notna() & (c['A_n'] >= 3)]
    if len(t) < 10:
        continue
    disc = 1 - t['L'] / t['A']
    prem = t['s80'] / t['smed'] - 1
    rows.append(dict(tier='%d-%d' % (lo, hi), cards=len(t), floor_disc_median=disc.median(), floor_disc_p25=disc.quantile(.25), floor_disc_p75=disc.quantile(.75),
                     share_floor_10off=(disc >= .10).mean(), share_floor_15off=(disc >= .15).mean(), share_floor_20off=(disc >= .20).mean(),
                     s80_prem_median=prem.median(), s80_prem_p75=prem.quantile(.75), edays_median=t['edays'].median(), n30_median=t['n30'].median(), probT_median=t['probT'].median()))
fd = pd.DataFrame(rows)
fd.round(4).to_csv(os.path.join(OUT, 'E07_floor_discount.csv'), index=False)
print('snapshot', os.path.basename(f), 'cards', len(c), 'with A', c['A'].notna().sum(), 'with floor', c['L'].notna().sum())
print(fd.round(3).to_string())

# (c) individual sales vs the card's 7-day median
r = pd.read_csv(os.path.join(DATA, 'ebay', 'daily_rollup.csv.gz'))
r = r[r['sold_totals'].notna() & r['price_7d_median'].notna()]
recs = []
for cid, med, s in zip(r['card_id'], r['price_7d_median'], r['sold_totals']):
    for x in str(s).split('|'):
        try:
            v = float(x)
        except ValueError:
            continue
        if v > 0 and med > 0:
            recs.append((cid, med, v / med - 1))
d = pd.DataFrame(recs, columns=['card_id', 'med', 'rel'])
d['tier'] = pd.cut(d['med'], [25, 50, 100, 250, 1000, 1e9], labels=['25-50', '50-100', '100-250', '250-1000', '1000+'])
rows = []
for tier, g in d.groupby('tier', observed=True):
    rows.append(dict(tier=tier, sales=len(g), cards=g['card_id'].nunique(), rel_p10=g['rel'].quantile(.10), rel_p25=g['rel'].quantile(.25), rel_p75=g['rel'].quantile(.75), rel_p90=g['rel'].quantile(.90),
                     share_10below=(g['rel'] <= -.10).mean(), share_15below=(g['rel'] <= -.15).mean(), share_20below=(g['rel'] <= -.20).mean(), share_30below=(g['rel'] <= -.30).mean(),
                     share_10above=(g['rel'] >= .10).mean(), share_15above=(g['rel'] >= .15).mean(), share_25above=(g['rel'] >= .25).mean()))
rows.append(dict(tier='ALL 25+', sales=len(d), cards=d['card_id'].nunique(), rel_p10=d['rel'].quantile(.10), rel_p25=d['rel'].quantile(.25), rel_p75=d['rel'].quantile(.75), rel_p90=d['rel'].quantile(.90),
                 share_10below=(d['rel'] <= -.10).mean(), share_15below=(d['rel'] <= -.15).mean(), share_20below=(d['rel'] <= -.20).mean(), share_30below=(d['rel'] <= -.30).mean(),
                 share_10above=(d['rel'] >= .10).mean(), share_15above=(d['rel'] >= .15).mean(), share_25above=(d['rel'] >= .25).mean()))
sd = pd.DataFrame(rows)
sd.round(4).to_csv(os.path.join(OUT, 'E07_sale_dispersion.csv'), index=False)
print(sd.round(3).to_string())

# (d) eBay median vs PriceCharting
t = c[c['A'].notna() & c['pc'].notna() & (c['A_n'] >= 3) & (c['pc'] > 0)]
ratio = t['A'] / t['pc']
rows = []
for lo, hi in [(10, 25)] + tiers:
    g = t[(t['pc'] >= lo) & (t['pc'] < hi)]
    if len(g) >= 10:
        rr = g['A'] / g['pc']
        rows.append(dict(pc_tier='%d-%d' % (lo, hi), cards=len(g), A_over_pc_median=rr.median(), p25=rr.quantile(.25), p75=rr.quantile(.75), share_A_below_pc=(rr < 1).mean(), share_A_10pct_above=(rr > 1.1).mean()))
rows.append(dict(pc_tier='ALL', cards=len(t), A_over_pc_median=ratio.median(), p25=ratio.quantile(.25), p75=ratio.quantile(.75), share_A_below_pc=(ratio < 1).mean(), share_A_10pct_above=(ratio > 1.1).mean()))
ap = pd.DataFrame(rows)
ap.round(4).to_csv(os.path.join(OUT, 'E07_A_vs_pc.csv'), index=False)
print(ap.round(3).to_string())
