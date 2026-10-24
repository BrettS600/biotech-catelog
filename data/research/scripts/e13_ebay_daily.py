"""E13 - eBay daily dynamics from the collector's rollup (26 days so far - a first look, to be rerun as it accumulates).
(a) Weekly reversal / momentum at the eBay level: change in a card's 7-day sold median over the past 7 days vs its change
    over the next 7 days (cross-sectional Spearman per day, quintile means).
(b) Are deep floors adversely selected? cheapest_ask / 7-day median on day t vs the median's change over the next 7 and
    14 days. If cards with asks far below the median see their median fall, "20% under" buys are not bargains but
    early information; if the median holds, they are bargains.
Outputs: results/E13_ebay_weekly_reversal.csv, results/E13_floor_adverse_selection.csv
"""
import os, numpy as np, pandas as pd, warnings
from scipy.stats import spearmanr
warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, '..', 'results')
r = pd.read_csv(os.path.join(DATA, 'ebay', 'daily_rollup.csv.gz'))
r['date'] = pd.to_datetime(r['date'])
med = r.pivot_table(index='date', columns='card_id', values='price_7d_median').sort_index()
ask = r.pivot_table(index='date', columns='card_id', values='cheapest_ask').sort_index()
sales = r.pivot_table(index='date', columns='card_id', values='sales').sort_index().fillna(0)
med = med.where(med >= 25)   # the band of interest
chg_back = med / med.shift(7) - 1
chg_fwd7 = med.shift(-7) / med - 1
chg_fwd14 = med.shift(-14) / med - 1
rows = []
for d in med.index:
    x = chg_back.loc[d]; y = chg_fwd7.loc[d]
    ok = x.notna() & y.notna()
    if ok.sum() < 50:
        continue
    q = pd.qcut(x[ok].rank(method='first'), 5, labels=False)
    rows.append(dict(date=d.strftime('%Y-%m-%d'), n=int(ok.sum()), spearman=spearmanr(x[ok], y[ok]).correlation, bottom20_fwd7=y[ok][q == 0].mean(), top20_fwd7=y[ok][q == 4].mean(), all_fwd7=y[ok].mean(), bottom20_back=x[ok][q == 0].mean(), top20_back=x[ok][q == 4].mean()))
w = pd.DataFrame(rows)
w.round(4).to_csv(os.path.join(OUT, 'E13_ebay_weekly_reversal.csv'), index=False)
print(w.round(3).to_string())
print('mean spearman %.3f, share negative %.2f, bottom20 fwd7 %.3f top20 fwd7 %.3f all %.3f' % (w['spearman'].mean(), (w['spearman'] < 0).mean(), w['bottom20_fwd7'].mean(), w['top20_fwd7'].mean(), w['all_fwd7'].mean()))

# (b) floors
ratio = ask / med
rows = []
for d in med.index:
    x = ratio.loc[d]; y7 = chg_fwd7.loc[d]; y14 = chg_fwd14.loc[d]
    ok = x.notna() & y7.notna()
    if ok.sum() < 50:
        continue
    bins = pd.cut(x[ok], [0, 0.8, 0.9, 1.0, 1.1, 10], labels=['<0.80', '0.80-0.90', '0.90-1.00', '1.00-1.10', '>1.10'])
    for b in bins.cat.categories:
        m = bins == b
        if m.sum() >= 5:
            rows.append(dict(date=d.strftime('%Y-%m-%d'), ask_over_median=b, n=int(m.sum()), fwd7_median_change=y7[ok][m].mean(), fwd14_median_change=y14[ok][m].mean() if y14[ok][m].notna().sum() >= 5 else np.nan, sales_next7=sales.shift(-7).rolling(7).sum().loc[d][ok][m].mean() if False else np.nan))
fa = pd.DataFrame(rows)
agg = fa.groupby('ask_over_median', observed=True).agg(days=('date', 'nunique'), card_days=('n', 'sum'), fwd7_median_change=('fwd7_median_change', 'mean'), fwd14_median_change=('fwd14_median_change', 'mean')).reset_index()
agg.round(4).to_csv(os.path.join(OUT, 'E13_floor_adverse_selection.csv'), index=False)
print(agg.round(3).to_string())
