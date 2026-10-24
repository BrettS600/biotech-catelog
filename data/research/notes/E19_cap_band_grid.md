# E19 — Plan-construction knobs: per-card cap, price band, capital

**Question.** FINDINGS first proposed "≥ 20 positions, per-card cap ≤ 5 % for $5k+, $100–$250 as the core tier". Does
the simulation support that? Grid over per-card cap (20 / 10 / 5 % of capital), band ($50–500, $50–250, $100–250,
$100–500) and capital ($2k / $5k / $10k) with the strategy fixed (dev12 rank, sets ≥ 24 months, 20 % under, 12 %
availability, 1 copy, 3-month hold), gated and ungated, 5 draws.

**Method.** `scripts/e19_cap_band_grid.py` → `results/E19_cap_band_grid.csv`.

**Results** ($5,000; final / CAGR / losing cycles / deployed share):
* Cap 20 % vs 10 % vs 5 %, band $50–500: ungated $16.9k / 30 % · $17.4k / 31 % · $13.8k / 24 %; gated $16.5k / 29 % ·
  $15.1k / 27 % · $15.4k / 27 %. **The cap barely matters** — with one copy per card and ~60 positions it rarely binds;
  at 5 % ($250) it starts excluding the $250–500 cards and costs 5–6 points ungated. At $2,000 a 5 % cap ($100) is
  ruinous (13 %/yr vs 41 % at 20 %); at $10,000 all caps give ~21–22 %.
* Band: **$50–500 is best** (30 %); $100–500 28–29 %; $50–250 **23–24 %**; $100–250 **19–21 %** with only 55–78 % of the
  money deployed. The $250–500 cards matter (they also had the best hit rate in E16) and narrowing the band starves
  deployment.
* Capital: $2k → 41 %/yr ungated / 30 % gated (fewer, more variable positions: range $5.0–14.0k); $5k → 30 % / 29 %;
  $10k → 21 % / 22 % (only ~70 % deployed each cycle at one copy per card — availability, not selection, is the limit).

**Interpretation.** Diversification comes for free from the one-copy rule; the cap is not the lever. The band should
stay $50–$500 (the $250–500 tier earns its place). The real constraint on larger bankrolls is how many discounted
listings exist — two copies per card (E10) or a second channel is what $10k needs, not a different ranking.

**Verdict.** *Corrects FINDINGS*: keep the 20 % cap (never below 10 %), keep the whole $50–$500 band; drop the
"$100–250 core" and "≤ 5 % cap" ideas.
