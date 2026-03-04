# Advanced Statistics Research Plan (Cardio Universe)

Date: 2026-02-28
Scope: Upgrade evidence synthesis and ranking rigor to top-tier journal expectations.

## 1) Research Signals To Adopt

1. Cochrane 2024/2025 methods updates emphasize stronger random-effects defaults and explicit small-sample handling.
2. ROB-ME introduces a formal risk-of-bias framework for missing evidence in pairwise meta-analysis.
3. RoB NMA extends missing-evidence bias assessment into network meta-analysis.
4. Recent methods show p-hacking correction and non-affirmative study inclusion can materially change pooled effects.
5. New network methods (including composite-likelihood approaches) improve scalability and robustness in larger evidence graphs.
6. Recent work comparing GRADE and CINeMA highlights the need to quantify certainty-method agreement and disagreement explicitly.
7. ML-NMR case studies show practical ways to transport treatment effects across patient-mix and trial-context differences.

## 2) Upgrade Targets (What "Best-in-class" Means)

1. Pairwise synthesis defaults:
- REML tau2, Hartung-Knapp-Sidik-Jonkman interval, Q-profile tau2 CI, prediction intervals.
- Robust variance estimation for multi-arm and dependent effects.

2. Bias robustness:
- ROB-ME scoring in pipeline artifacts.
- Sensitivity families: trim-and-fill, selection model, PET-PEESE, p-hacking correction, non-affirmative inclusion analysis.

3. Network synthesis:
- NMA engine with global and local inconsistency checks.
- RoB NMA support with bias-aware contribution summaries.
- Rank outputs with uncertainty (not rank point estimates only).

4. Transportability and subgroup depth:
- Meta-regression and ML-NMR style adjustment for key cardio effect modifiers (HF phenotype, CKD strata, diabetes status, age bins, sex).

5. Living meta-analysis control:
- Sequential update guardrails (false-positive control for repeated updates).
- Stability dashboards: effect drift, certainty drift, rank drift.

## 3) 12-Week Execution Plan

## Phase A (Weeks 1-3): Pairwise Core v2
1. Build `src/engine/stats/pairwise-v2` with REML + HKSJ + prediction intervals.
2. Add robust variance for dependent effects and multi-arm correction.
3. Add benchmark fixtures for known edge cases (rare events, high heterogeneity, few studies).
4. Gate: agreement against reference implementations on locked fixtures and tolerance bands.

## Phase B (Weeks 4-6): Bias and Sensitivity Layer
1. Implement ROB-ME-compatible evidence fields in contracts and reports.
2. Add automated sensitivity bundle per analysis:
- selection model proxy,
- PET-PEESE,
- trim-and-fill,
- p-hacking and non-affirmative study scenario.
3. Gate: every top-ranked opportunity has primary estimate plus sensitivity envelope.

## Phase C (Weeks 7-9): Network Meta-analysis v1
1. Add NMA data model and synthesis module (consistency + inconsistency diagnostics).
2. Implement RoB NMA data capture and contribution summaries.
3. Add rank uncertainty outputs (rank intervals / rank probabilities, not only point ranks).
4. Gate: NMA validation pack passes with reproducible outputs and audit trails.

## Phase D (Weeks 10-12): Transportability + Living Updates
1. Add meta-regression/transport layer for core modifiers.
2. Implement sequential monitoring and drift alerts for living updates.
3. Surface certainty disagreement dashboard (GRADE vs CINeMA-style crosswalk where applicable).
4. Gate: weekly run produces stable drift metrics and actionable alerts.

## 4) Metrics and Hard Gates

1. Pairwise engine:
- >=99% fixture-level numerical agreement vs reference tolerances.
- 100% analyses include prediction interval and tau2 uncertainty.

2. Bias robustness:
- 100% of published opportunities include sensitivity envelope outputs.
- 100% include missing-evidence risk field (ROB-ME compatible).

3. Network:
- 100% NMA runs include inconsistency diagnostics and rank uncertainty.
- 0 unexplained disconnected-network failures in benchmark suite.

4. Living control:
- effect-drift and rank-drift metrics generated on every refresh.
- alerts generated when certainty class changes or rank crosses threshold bands.

## 5) Immediate Build Tasks (Next 10)

1. Create stats engine module skeleton under `src/engine/stats/`.
2. Add pairwise-v2 schema (`analysis-result.v2`) with uncertainty and sensitivity blocks.
3. Add benchmark pack `reports/benchmarks/packs/v2/pairwise_stress.v1.json`.
4. Add script `scripts/benchmarks/compute-pairwise-v2-benchmark.mjs`.
5. Add ROB-ME data fields to provenance/report contracts.
6. Add script `scripts/benchmarks/compute-bias-sensitivity-suite.mjs`.
7. Add NMA schema and fixture pack under `reports/benchmarks/packs/v2/network/`.
8. Add script `scripts/benchmarks/compute-network-benchmark.mjs`.
9. Add drift report script `scripts/operations/compute-living-drift.mjs`.
10. Add new release gate command `verify:stats-advanced`.

## 6) Source References (Primary)

1. Cochrane Handbook, Chapter 10 (Analysing data and undertaking meta-analyses): https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-10
2. Cochrane methods update (2024): https://www.cochrane.org/methods/news/new-guidance-available-random-effects-method-meta-analysis
3. ROB-ME framework (BMJ, PMID: 39009105): https://pubmed.ncbi.nlm.nih.gov/39009105/
4. RoB NMA framework (BMJ, PMID: 40547289): https://pubmed.ncbi.nlm.nih.gov/40547289/
5. p-hacking correction in random-effects MA (Res Synth Methods, PMID: 38652495): https://pubmed.ncbi.nlm.nih.gov/38652495/
6. Non-affirmative studies + publication bias methods (BMJ, PMID: 39152479): https://pubmed.ncbi.nlm.nih.gov/39152479/
7. ML-NMR case study for effect transportability (Stat Med, PMID: 39420113): https://pubmed.ncbi.nlm.nih.gov/39420113/
8. GRADE vs CINeMA certainty comparison in NMA (J Clin Epidemiol, PMID: 40105219): https://pubmed.ncbi.nlm.nih.gov/40105219/
9. Composite-likelihood NMA method (Res Synth Methods, PMID: 41626971): https://pubmed.ncbi.nlm.nih.gov/41626971/
