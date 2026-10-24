"""E02 - The signal zoo: every simple card-level signal ranked into deciles each month, forward 1/3/6-month
returns at the standard price. Which signals separate winners from losers, how big is the spread, how often does
the top decile beat the universe, and does anything clear the fee wall at 1-3 months?
Outputs: results/E02_signal_summary.csv (one row per signal x horizon), results/E02_deciles.csv (full tables),
         results/E02_ic_monthly.csv (monthly Spearman IC for the main signals)
"""
import os, numpy as np, pandas as pd, warnings
from common import load_panel
from xs import features, decile_table, summarize, ic_series
warnings.filterwarnings('ignore')

OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel()
F = features(P)
SIGNALS = ['mom1', 'mom2', 'mom3', 'mom6', 'mom12', 'mom12x1', 'mom6x1', 'accel', 'vol6', 'vol12', 'hi12', 'lo12', 'hi6', 'lp', 'lv', 'vgrow', 'dvol', 'vz', 'dev3', 'dev6', 'dev12', 'pv_up', 'stale', 'age', 'set_mom1', 'set_mom3', 'rel_mom1']
summ, tabs, ics = [], [], []
for h in (1, 3, 6):
    for s in SIGNALS:
        tab, sp = decile_table(P, F, s, h, start='2022-01')
        if len(sp) == 0:
            continue
        r = summarize(tab, sp, s, h)
        summ.append(r)
        tab.insert(0, 'h', h); tab.insert(0, 'signal', s)
        tabs.append(tab)
        print('h=%d %-9s top %+.3f bot %+.3f uni %+.3f spread %+.3f hit %.2f t %+.1f  netTop %+.3f pNet %.2f' % (h, s, r['top_gross'], r['bottom_gross'], r['uni_gross'], r['spread_top_uni_gross'], r['hit_rate'], r['t_stat'], r['top_net'], r['top_p_net_pos']))
    for s in ['mom1', 'mom3', 'mom12x1', 'dev3', 'hi12', 'vgrow', 'age', 'set_mom1', 'vol6', 'lv']:
        ic = ic_series(P, F, s, h)
        ic.insert(0, 'h', h); ic.insert(0, 'signal', s)
        ics.append(ic.reset_index())
pd.DataFrame(summ).round(4).to_csv(os.path.join(OUT, 'E02_signal_summary.csv'), index=False)
pd.concat(tabs).round(4).to_csv(os.path.join(OUT, 'E02_deciles.csv'), index=False)
pd.concat(ics).round(4).to_csv(os.path.join(OUT, 'E02_ic_monthly.csv'), index=False)
