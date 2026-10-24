"""E04 - Market timing: can anything forecast the market's next 1-3 months better than its own trailing move?
The regime (trailing median move of $10+ cards) is the biggest predictor of returns (2026-10-17 research) and it
is ~90% autocorrelated. Candidates tested here as leading indicators of the PriceCharting-wide median move and
of the PokeViews Top 250 index: the market's own history (AR), breadth, PokeViews' Hot & Cold gauge, Market
Momentum (% above 30-day), New Highs/Lows, Trend Extension (distance from EMA90 / SMA200, % above), RSI, and
Google Trends interest for "pokemon cards" (web / image / news / shopping / youtube).
Outputs: results/E04_monthly_merged.csv (the aligned monthly table), results/E04_leadlag.csv (cross-correlations
by lag), results/E04_daily_pv250.csv (PokeViews indicator level -> forward 30/60/90-day Top250 return by quintile)
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel, load_pokeviews, load_trends, monthly_from_daily
from xs import features
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')

mk = pd.read_csv(os.path.join(OUT, 'E01_market_monthly.csv')).set_index('month')
pv = load_pokeviews()
tr = load_trends()

# --- monthly table ---------------------------------------------------------------------------
m = mk[['n', 'median_mom1', 'mean_mom1', 'breadth_up', 'median_mom1_50plus', 'total_sales', 'dollar_volume_musd']].copy()
m['median_fwd1'] = m['median_mom1'].shift(-1)
m['median_fwd3'] = (1 + m['median_mom1']).shift(-1).rolling(3).apply(np.prod, raw=True).shift(-2) - 1   # next 3 months compounded
m['median_trail3'] = (1 + m['median_mom1']).rolling(3).apply(np.prod, raw=True) - 1
m['sales_chg3'] = m['total_sales'] / m['total_sales'].shift(3) - 1
m['dvol_chg3'] = m['dollar_volume_musd'] / m['dollar_volume_musd'].shift(3) - 1
t250 = pv['top250_index']['index_value']
mt = monthly_from_daily(t250)
m['t250'] = mt.reindex(m.index)
m['t250_ret1'] = m['t250'].pct_change()
m['t250_fwd1'] = m['t250_ret1'].shift(-1)
m['t250_fwd3'] = m['t250'].shift(-3) / m['t250'] - 1
hc = pv['hot_cold_index']
m['hci_gauge'] = monthly_from_daily(hc['gauge']).reindex(m.index)
m['hci_display'] = monthly_from_daily(hc['display_score']).reindex(m.index)
m['mms_all'] = monthly_from_daily(hc['mms_all']).reindex(m.index)
m['new_highs'] = monthly_from_daily(hc['new_highs']).reindex(m.index)
mm = pv['market_momentum']
m['pct_above_30d'] = monthly_from_daily(mm['pct_above_30d']).reindex(m.index)
m['pct_above_30d_100_200'] = monthly_from_daily(mm['pct_above_30d_tier_100_200']).reindex(m.index)
nh = pv['new_highs_lows']
m['hi_minus_lo'] = monthly_from_daily(nh['pct_at_30d_high'] - nh['pct_at_30d_low']).reindex(m.index)
te = pv['trend_extension']
m['dist_ema90'] = monthly_from_daily(te['distance_from_ema90']).reindex(m.index)
m['dist_sma200'] = monthly_from_daily(te['distance_from_sma200']).reindex(m.index)
m['pct_above_ema90'] = monthly_from_daily(te['pct_above_ema90']).reindex(m.index)
m['rsi14'] = monthly_from_daily(pv['top250_index']['rsi_14d']).reindex(m.index)
for c in ['web_search', 'image_search', 'news_search', 'google_shopping', 'youtube_search']:
    s = tr[c].reindex(m.index).astype(float)
    m['gt_' + c] = s
    m['gt_%s_chg1' % c] = s.pct_change()
    m['gt_%s_chg3' % c] = s / s.shift(3) - 1
    m['gt_%s_z12' % c] = (s - s.rolling(12).mean()) / s.rolling(12).std()
m.round(5).to_csv(os.path.join(OUT, 'E04_monthly_merged.csv'))

# --- lead/lag cross-correlations: indicator at t vs market move at t+k --------------------------
preds = ['median_mom1', 'median_trail3', 'breadth_up', 'sales_chg3', 'dvol_chg3', 't250_ret1', 'hci_gauge', 'hci_display', 'mms_all', 'new_highs', 'pct_above_30d', 'pct_above_30d_100_200', 'hi_minus_lo', 'dist_ema90', 'dist_sma200', 'pct_above_ema90', 'rsi14'] + [c for c in m.columns if c.startswith('gt_')]
rows = []
for p in preds:
    for target in ('median_mom1', 't250_ret1'):
        for k in (0, 1, 2, 3):
            x = m[p]; y = m[target].shift(-k)
            ok = x.notna() & y.notna()
            if ok.sum() < 12:
                continue
            r = np.corrcoef(x[ok], y[ok])[0, 1]
            rs = pd.Series(x[ok]).rank().corr(pd.Series(y[ok]).rank())
            rows.append((p, target, k, ok.sum(), r, rs))
ll = pd.DataFrame(rows, columns=['predictor', 'target', 'lead_months', 'n', 'pearson', 'spearman'])
ll.round(4).to_csv(os.path.join(OUT, 'E04_leadlag.csv'), index=False)
print(ll[(ll.target == 'median_mom1') & (ll.lead_months == 1)].sort_values('spearman', key=abs, ascending=False).round(3).to_string())
print(ll[(ll.target == 't250_ret1') & (ll.lead_months == 1)].sort_values('spearman', key=abs, ascending=False).round(3).to_string())

# --- regime persistence --------------------------------------------------------------------------
x = m['median_mom1'].dropna()
print('AR(1) of median_mom1: %.2f ; P(next>0 | this>0) = %.2f ; P(next>0 | this<=0) = %.2f' % (x.autocorr(1), (x.shift(-1)[x > 0] > 0).mean(), (x.shift(-1)[x <= 0] > 0).mean()))
tr3 = m['median_trail3'].dropna()
print('AR(1) of median_trail3: %.2f ; corr(trail3, fwd3) = %.2f' % (tr3.autocorr(1), m[['median_trail3', 'median_fwd3']].dropna().corr().iloc[0, 1]))

# --- daily: PokeViews indicator level -> forward Top250 return, quintiles -------------------------
d = pd.DataFrame({'t250': t250})
d['fwd30'] = d['t250'].shift(-30) / d['t250'] - 1
d['fwd60'] = d['t250'].shift(-60) / d['t250'] - 1
d['fwd90'] = d['t250'].shift(-90) / d['t250'] - 1
d['ret30'] = d['t250'] / d['t250'].shift(30) - 1
d['hci_gauge'] = hc['gauge'].reindex(d.index)
d['mms_all'] = hc['mms_all'].reindex(d.index)
d['pct_above_30d'] = mm['pct_above_30d'].reindex(d.index)
d['hi_minus_lo'] = (nh['pct_at_30d_high'] - nh['pct_at_30d_low']).reindex(d.index)
d['dist_ema90'] = te['distance_from_ema90'].reindex(d.index)
d['dist_sma200'] = te['distance_from_sma200'].reindex(d.index)
d['pct_above_ema90'] = te['pct_above_ema90'].reindex(d.index)
d['rsi14'] = pv['top250_index']['rsi_14d'].reindex(d.index)
rows = []
for p in ['ret30', 'hci_gauge', 'mms_all', 'pct_above_30d', 'hi_minus_lo', 'dist_ema90', 'dist_sma200', 'pct_above_ema90', 'rsi14']:
    ok = d[p].notna() & d['fwd90'].notna()
    q = pd.qcut(d.loc[ok, p], 5, labels=False, duplicates='drop')
    for qq in sorted(q.unique()):
        sub = d.loc[ok][q == qq]
        rows.append((p, qq, len(sub), sub[p].mean(), sub['fwd30'].mean(), (sub['fwd30'] > 0).mean(), sub['fwd60'].mean(), sub['fwd90'].mean(), (sub['fwd90'] > 0).mean()))
    rows.append((p, 'spearman_fwd30', ok.sum(), np.nan, d.loc[ok, p].corr(d.loc[ok, 'fwd30'], method='spearman'), np.nan, d.loc[ok, p].corr(d.loc[ok, 'fwd60'], method='spearman'), d.loc[ok, p].corr(d.loc[ok, 'fwd90'], method='spearman'), np.nan))
dq = pd.DataFrame(rows, columns=['indicator', 'quintile', 'n_days', 'level_mean', 'fwd30_mean', 'p_fwd30_pos', 'fwd60_mean', 'fwd90_mean', 'p_fwd90_pos'])
dq.round(4).to_csv(os.path.join(OUT, 'E04_daily_pv250.csv'), index=False)
print(dq.round(3).to_string())
print(m[['median_mom1', 'median_fwd1', 't250_ret1', 'hci_gauge', 'pct_above_30d', 'dist_ema90', 'rsi14', 'gt_web_search', 'gt_youtube_search']].tail(12).round(3).to_string())
