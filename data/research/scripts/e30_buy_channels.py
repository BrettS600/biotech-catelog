"""E30 - Where to buy: the round-trip arithmetic of each buying channel when the copy is resold on eBay at market.
PriceCharting's dealer prices are fixed multiples of its ungraded price (E27): a shop SELLS at 1.10 x market and BUYS at
22% (<$10), 28% ($10-25), 44% ($25-100), 55% ($100-500), 66% ($500+) of market. Channels, as a multiple of market P:
  retail_shop_sell 1.10 | ebay_at_market 1.00 | ebay_floor_15_under 0.85 | ebay_floor_20_under 0.80 |
  private_seller_at_dealer_buy (Facebook / collections / shows, paying what a shop would) = the dealer-buy multiple |
  private_seller_midway = halfway between the dealer-buy multiple and market.
Resale on eBay at P (and at P x 1.10 for a patient seller, E07's 80th-percentile premium), fee model as the site.
Reported per price point: immediate net return (no price move) and the market move needed to break even.
"""
import os, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RESEARCH_DATA', os.path.abspath(os.path.join(HERE, '..', '..')))
OUT = os.path.join(DATA, 'research', 'results')
KEEP = 1 - 0.1325 * 1.065
dealer_buy = lambda p: 0.22 if p < 10 else 0.28 if p < 25 else 0.44 if p < 100 else 0.55 if p < 500 else 0.66
rows = []
for P in (25, 50, 100, 250, 500):
    ch = {'retail_shop_sell': 1.10, 'ebay_at_market': 1.00, 'ebay_floor_15_under': 0.85, 'ebay_floor_20_under': 0.80,
          'private_midway': (dealer_buy(P) + 1) / 2, 'private_at_dealer_buy': dealer_buy(P)}
    for name, mult in ch.items():
        cost = P * mult
        for sell_name, sell_mult in (('sell_at_market', 1.0), ('patient_sell_+10%', 1.10)):
            proceeds = P * sell_mult * KEEP - 5.20
            be_move = (cost + 5.20) / (P * sell_mult * KEEP) - 1
            rows.append({'market_price': P, 'channel': name, 'buy_multiple': round(mult, 3), 'sell': sell_name,
                         'net_return_no_move': proceeds / cost - 1, 'breakeven_market_move': be_move})
r = pd.DataFrame(rows)
r.to_csv(os.path.join(OUT, 'E30_buy_channels.csv'), index=False, float_format='%.4f')
print(r[r.sell == 'sell_at_market'].pivot(index='channel', columns='market_price', values='net_return_no_move').round(3).to_string())
print(r[r.sell == 'sell_at_market'].pivot(index='channel', columns='market_price', values='breakeven_market_move').round(3).to_string())
