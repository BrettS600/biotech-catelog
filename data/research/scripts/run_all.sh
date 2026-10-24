#!/bin/sh
# Reproduce every experiment from the committed data/ folder (run from data/research/scripts).
# Order matters: E04/E06 read E01's market series. Needs numpy, pandas, scipy, scikit-learn, statsmodels.
set -e
cd "$(dirname "$0")"
mkdir -p ../results
for s in e01_fee_wall e02_signals e03_reversal e04_market_timing e04b_incremental e05_calendar_age e06_ml e06b_ml_variants e07_ebay_micro e08_fee_lever e09_dip_print e10_portfolio_sim e11_pv_set_index e12_risk_hold e13_ebay_daily e15_gate_variants e16_pick_composition e17_horizon_gate_sizing e18_signal_robustness e19_cap_band_grid e20_chance_table e21_fama_macbeth e22_asset_leadlag e23_exit_rules e24_exit_rule_portfolio e25_exit_rule_stress; do
  echo "== $s"; python3 $s.py > ../results/$s.log 2>&1 || { echo "FAILED $s (see results/$s.log)"; exit 1; }
done
echo done
