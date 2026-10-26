"""E29 - Buy raw, grade with PSA, sell the slab on eBay: expected value per card from PriceCharting's prices of the newest
day (pricecharting/daily), under grade-outcome scenarios and PSA's 2026 fees.
Costs: buy at the raw (loose) price (+0 / -15% discount variants); PSA Regular $79.99/card (Value tiers paused in 2026;
$24.99 'Value Bulk' as the if-it-returns case); $6/card shipping+insurance both ways amortised; ~4.5 months from purchase
to sale (Regular 70-80 business days + transit + listing). Sale: eBay fee model (13.25% x 1.065 + $0.40) + $8 slab
shipping. Grade distribution scenarios (share of copies landing at 10 / 9 / 8 / 7 / <=6):
  modern_pack_fresh (2020s set, own pulls)        .55 / .33 / .08 / .03 / .01   (PSA 2025: TCG gem rate 50%, 2020s cards 59%)
  modern_bought_raw (2020s, bought raw on eBay)  .30 / .45 / .15 / .07 / .03   (adverse selection: the best copies were already graded)
  vintage_bought_raw (pre-2010, optimistic)      .08 / .30 / .30 / .20 / .12
  vintage_realistic (pre-2010, typical eBay raw)  .02 / .12 / .25 / .25 / .36   (vintage WOTC holos rarely gem; an 'ungraded' price
                                                                                  is an average copy, often played)
A grade <= 6 is sold at the raw price. EV = sum p_g x net_sale(price_g) - cost. Cards: raw $10-1000 with all four graded
prices present. Reported: share of cards with EV > 0, median ROI, the top-decile ROI, and ROI per month of capital.
The graded prices of thinly traded cards are PriceCharting estimates; the 'liquid' rows keep cards with 100+ PC sales/yr.
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from daily_panel import load_daily, DATA
OUT = os.path.join(DATA, 'research', 'results')
D = load_daily(); d = D['dates'][-1]
cards = pd.read_csv(os.path.join(DATA, 'pricecharting', 'cards.csv.gz')).set_index('card_id')
age = (pd.Timestamp(d) - pd.to_datetime(cards['release_date'], errors='coerce')).dt.days / 365.25
df = pd.DataFrame({'raw': D['loose-price'][d], 'g10': D['manual-only-price'][d], 'g9': D['graded-price'][d], 'g8': D['new-price'][d],
                   'g7': D['cib-price'][d], 'vol': D['sales-volume'][d]}).join(age.rename('age'), how='left').dropna(subset=['raw', 'g10', 'g9', 'g8', 'g7'])
df = df[df.raw.between(10, 1000)]
KEEP = 1 - 0.1325 * 1.065
net = lambda p: p * KEEP - 0.40 - 8.0
SC = {'modern_pack_fresh': (.55, .33, .08, .03, .01), 'modern_bought_raw': (.30, .45, .15, .07, .03), 'vintage_bought_raw': (.08, .30, .30, .20, .12),
      'vintage_realistic': (.02, .12, .25, .25, .36)}
rows, top = [], []
for sc, (p10, p9, p8, p7, p6) in SC.items():
    sub = df[(df.age < 7) if sc.startswith('modern') else (df.age >= 16)]
    for fee_name, fee in (('regular_79.99', 79.99), ('value_bulk_24.99', 24.99)):
        for disc in (0.0, 0.15):
            for liq_name, liq in (('all', sub), ('liquid_100+_sales', sub[sub.vol >= 100])):
                cost = liq.raw * (1 - disc) + fee + 6.0
                ev = p10 * net(liq.g10) + p9 * net(liq.g9) + p8 * net(liq.g8) + p7 * net(liq.g7) + p6 * (liq.raw * KEEP - 5.20) - cost
                roi = ev / cost
                if len(roi) < 20: continue
                rows.append({'scenario': sc, 'psa_fee': fee_name, 'buy_discount': disc, 'cards': liq_name, 'n': len(roi),
                             'share_ev_pos': (ev > 0).mean(), 'median_roi': roi.median(), 'top_decile_roi': roi.quantile(.9),
                             'median_roi_per_month': roi.median() / 4.5, 'top_decile_roi_per_month': roi.quantile(.9) / 4.5,
                             'median_raw_price': liq.raw.median(), 'median_g10_over_raw': (liq.g10 / liq.raw).median(),
                             'breakeven_gem_rate_median': np.nan})
                if fee_name == 'regular_79.99' and disc == 0 and liq_name == 'liquid_100+_sales':
                    t = liq.assign(ev=ev, roi=roi).sort_values('roi', ascending=False).head(15)
                    t['scenario'] = sc; top.append(t)
r = pd.DataFrame(rows)
# break-even gem rate per card (modern_bought_raw shape for the non-10 outcomes, renormalised), Regular fee, no discount
mod = df[df.age < 7].copy()
rest = np.array([.45, .15, .07, .03]); rest = rest / rest.sum()
v_rest = rest[0] * net(mod.g9) + rest[1] * net(mod.g8) + rest[2] * net(mod.g7) + rest[3] * (mod.raw * KEEP - 5.20)
cost = mod.raw + 79.99 + 6
mod['be_gem'] = ((cost - v_rest) / (net(mod.g10) - v_rest)).clip(0, 1.5)
be = mod.assign(tier=pd.cut(mod.raw, [10, 25, 50, 100, 250, 500, 1000])).groupby('tier', observed=True).be_gem.describe(percentiles=[.25, .5, .75])[['count', '25%', '50%', '75%']]
r.to_csv(os.path.join(OUT, 'E29_grading_ev.csv'), index=False, float_format='%.4f')
be.to_csv(os.path.join(OUT, 'E29_breakeven_gem_rate_modern.csv'), float_format='%.4f')
pd.concat(top).reset_index().rename(columns={'index': 'card_id'}).to_csv(os.path.join(OUT, 'E29_top_grading_candidates.csv'), index=False, float_format='%.3f')
print(r[(r.cards == 'liquid_100+_sales')].drop(columns=['breakeven_gem_rate_median']).round(3).to_string(index=False))
# vintage: the share of copies that must come back 9 or better to break even (Regular fee, 9s and 10s split 1:6 like the realistic mix)
vin = df[df.age >= 16].copy()
lo_mix = np.array([.25, .25, .36]); lo_mix = lo_mix / lo_mix.sum()
v_lo = lo_mix[0] * net(vin.g8) + lo_mix[1] * net(vin.g7) + lo_mix[2] * (vin.raw * KEEP - 5.20)
v_hi = (1 / 7) * net(vin.g10) + (6 / 7) * net(vin.g9)
vin['be_9plus'] = ((vin.raw + 79.99 + 6 - v_lo) / (v_hi - v_lo)).clip(0, 1.5)
bv = vin.assign(tier=pd.cut(vin.raw, [10, 25, 50, 100, 250, 500, 1000])).groupby('tier', observed=True).be_9plus.describe(percentiles=[.25, .5, .75])[['count', '25%', '50%', '75%']]
bv.to_csv(os.path.join(OUT, 'E29_breakeven_9plus_rate_vintage.csv'), float_format='%.4f')
print(bv.round(3).to_string())
print(be.round(3).to_string())
