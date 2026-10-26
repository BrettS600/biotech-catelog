"""E41 - Reprint event study (backlog B07): Celebrations' Classic Collection (revealed June 2021, released 8 Oct 2021)
reprinted 25 famous cards. What did the ORIGINALS do vs the rest of their own set? Abnormal log return = card's log price
change minus the median log change of its set's other cards ($5+, priced in both months), from 2021-05 (before the reveal)
to each later month. Two groups: the unlimited / plain originals (24 found) and the 1st Edition originals (7). One event,
small n, mid-2021 mania - descriptive only.
"""
import os, sys, numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import load_panel
OUT = os.path.join(HERE, '..', 'results')
P = load_panel(); pr = P['price'].astype(float); months = list(P['months']); ids = P['cards']['card_id'].to_numpy(); sets = P['cards']['set'].fillna('').values
plain = [630417, 630415, 630428, 630486, 643460, 2371055, 762221, 762339, 762535, 9906691, 886420, 888970, 889567, 762776, 921169, 925505, 1287193, 886672, 886698, 886699, 955906, 806590, 958899, 960557]
first = [715593, 715591, 715604, 1341350, 1450209, 2324851, 2427440]
row_of = {c: i for i, c in enumerate(ids)}
b = months.index('2021-05')
rows = []
for grp, lst in (('plain originals', plain), ('1st Edition originals', first)):
    for m in ('2021-06', '2021-07', '2021-08', '2021-10', '2021-12', '2022-01', '2022-04', '2022-07', '2022-10', '2023-04'):
        j = months.index(m); ab = []
        for c in lst:
            i = row_of.get(c)
            if i is None or not (pr[i, b] > 0 and pr[i, j] > 0): continue
            same = (sets == sets[i]) & (pr[:, b] >= 5) & (pr[:, j] > 0) & (np.arange(len(ids)) != i)
            if same.sum() < 10: continue
            ab.append(np.log(pr[i, j] / pr[i, b]) - np.median(np.log(pr[same, j] / pr[same, b])))
        ab = np.array(ab)
        rows.append({'group': grp, 'from': '2021-05', 'to': m, 'cards': len(ab), 'mean_abnormal_log': ab.mean(), 'median_abnormal_log': np.median(ab),
                     'share_beat_own_set': (ab > 0).mean(), 'mean_abnormal_pct': np.exp(ab.mean()) - 1})
r = pd.DataFrame(rows); r.to_csv(os.path.join(OUT, 'E41_reprint_event.csv'), index=False, float_format='%.4f')
print(r.round(3).to_string(index=False))
