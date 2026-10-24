"""E15 - Which regime gate? Compare gates on (a) their out-of-sample call of the next 3-month market move and (b) the
reinvesting simulation (dev12, 3-month hold, 20% under, 12% availability, 1 copy, sets >= 24 mo, $5,000):
  reg1>0        last month's market median move > 0
  reg3>0        trailing 3-month mean > 0 (E10's gate)
  reg3>2%       strong only
  ar+trends     expanding-window regression of the next-3-month market move on reg1 and the 1-month change in Google
                web-search interest (E04's best addition), fit only on months whose outcome was known at t; gate on
                prediction > 0
  pv250>0       PokeViews Top 250 index 30-day return > 0 at month-end (daily index, no monthly-averaging artifact;
                only from 2024-05)
Outputs: results/E15_gate_calls.csv, results/E15_gate_sim.csv
"""
import os, numpy as np, pandas as pd, warnings
import statsmodels.api as sm
from common import load_panel, load_trends, load_pokeviews, monthly_from_daily, KEEP, FIXED
from xs import features
warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), '..', 'results')
P = load_panel(); F = features(P)
pr, sl, months = P['price'].astype(float), P['sales'].astype(float), P['months']
n_m = len(months)
reg1 = F['reg1'][0]; reg3 = F['reg3'][0]
mk = pd.Series(reg1, index=months)
fwd3 = ((1 + mk).shift(-1) * (1 + mk).shift(-2) * (1 + mk).shift(-3) - 1)
tr = load_trends()
gt = tr['web_search'].astype(float).reindex(months)
gt_chg1 = gt.pct_change().values
pv = load_pokeviews()
t250 = pv['top250_index']['index_value']
r30 = (t250 / t250.shift(30) - 1)
pv_m = monthly_from_daily(r30).reindex(months).values

# ar+trends expanding fit: at month j, use rows k with k + 3 <= j (outcome known), min 24 rows
pred = np.full(n_m, np.nan)
for j in range(n_m):
    ks = [k for k in range(1, j - 2) if not np.isnan(fwd3.iloc[k]) and not np.isnan(gt_chg1[k]) and not np.isnan(reg1[k])]
    if len(ks) < 24 or np.isnan(gt_chg1[j]) or np.isnan(reg1[j]):
        continue
    X = sm.add_constant(np.column_stack([reg1[ks], gt_chg1[ks]]))
    y = fwd3.values[ks]
    fit = sm.OLS(y, X).fit()
    pred[j] = fit.params[0] + fit.params[1] * reg1[j] + fit.params[2] * gt_chg1[j]
gates = {'reg1>0': reg1 > 0, 'reg3>0': reg3 > 0, 'reg3>2%': reg3 > 0.02, 'ar+trends': pred > 0, 'pv250>0': pv_m > 0, 'always': np.ones(n_m, bool)}
avail = {'reg1>0': ~np.isnan(reg1), 'reg3>0': ~np.isnan(reg3), 'reg3>2%': ~np.isnan(reg3), 'ar+trends': ~np.isnan(pred), 'pv250>0': ~np.isnan(pv_m), 'always': np.ones(n_m, bool)}
# (a) calls: in months where the gate is on, what did the next 3 months do? and when off?
rows = []
j0 = months.index('2022-01')
for g, on in gates.items():
    ok = avail[g] & ~np.isnan(fwd3.values) & (np.arange(n_m) >= j0)
    on_ = on & ok; off_ = (~on) & ok
    rows.append(dict(gate=g, months=int(ok.sum()), share_on=on_.sum() / max(ok.sum(), 1), fwd3_when_on=fwd3.values[on_].mean() if on_.sum() else np.nan, fwd3_when_off=fwd3.values[off_].mean() if off_.sum() else np.nan,
                     p_fwd3_pos_when_on=(fwd3.values[on_] > 0).mean() if on_.sum() else np.nan, p_fwd3_pos_when_off=(fwd3.values[off_] > 0).mean() if off_.sum() else np.nan, sign_accuracy=((on_ & (fwd3.values > 0)) | (off_ & (fwd3.values <= 0))).sum() / max(ok.sum(), 1)))
calls = pd.DataFrame(rows)
calls.round(4).to_csv(os.path.join(OUT, 'E15_gate_calls.csv'), index=False)
print(calls.round(3).to_string())

# (b) simulation with each gate (same mechanics as E10)
rng = np.random.RandomState(7)
LAST = months.index('2026-09'); START = months.index('2022-01')
def cycle(j, h, capital, disc, avail_p, max_copies):
    ok = (pr[:, j] >= 50) & (pr[:, j] <= 500) & (sl[:, j] >= 2) & ~np.isnan(F['dev12'][:, j]) & ((F['age'][:, j] >= 24) | np.isnan(F['age'][:, j]))
    idx = np.where(ok)[0]; idx = idx[np.argsort(F['dev12'][idx, j])]
    idx = idx[rng.rand(len(idx)) < avail_p]
    fut = pr[:, j + h]; cap_per = 0.2 * capital; cash = capital; proceeds = 0.0; nc = 0
    for i in idx:
        if cash < 50 * (1 - disc): break
        if np.isnan(fut[i]): continue
        buy = F['buy_real'][i, j] * (1 - disc)
        q = int(min(cap_per // buy, cash // buy, min(max(1, int(sl[i, j] * 0.25)), max_copies)))
        if q < 1: continue
        proceeds += q * (fut[i] * KEEP - FIXED); cash -= q * buy; nc += 1
    return proceeds + cash, nc
rows = []
for g, on in gates.items():
    for start_label, start_m in (('2022-01', '2022-01'), ('2024-06', '2024-06')):
        h = 3; finals = []; rets = []; skipped = 0; total = 0
        for off in range(h):
            cap = 5000.0; j = months.index(start_m) + off
            while j + h <= LAST:
                total += 1
                if not (avail[g][j] and on[j]):
                    skipped += 1; j += h; continue
                new_cap, nc = cycle(j, h, cap, 0.20, 0.12, 1)
                rets.append(new_cap / cap - 1); cap = new_cap; j += h
            finals.append(cap)
        years = (LAST - months.index(start_m)) / 12
        rets = np.array(rets)
        rows.append(dict(gate=g, start=start_label, final_mean=np.mean(finals), cagr=(np.mean(finals) / 5000) ** (1 / years) - 1, cycles_traded=len(rets) / h, skipped_share=skipped / total, cycle_ret_mean=rets.mean() if len(rets) else np.nan, p_cycle_loss=(rets < 0).mean() if len(rets) else np.nan, worst_cycle=rets.min() if len(rets) else np.nan))
sim = pd.DataFrame(rows)
sim.round(4).to_csv(os.path.join(OUT, 'E15_gate_sim.csv'), index=False)
print(sim.round(3).to_string())
