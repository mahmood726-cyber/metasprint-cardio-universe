# Advanced Stats: Latest Research Alignment (2026-02-28)

Purpose:
- Record how recent methods research is translated into this codebase with explicit, auditable outputs.

## Research-to-Implementation Mapping

1. Certainty-method disagreement is real and should be quantified, not hand-waved.
- Signal from literature: GRADE vs CINeMA comparison work reports non-trivial disagreement and motivates explicit agreement diagnostics.
- Implementation:
  - Added live bridge from `rct-extractor-v2` benchmark eval outputs to crosswalk fixture:
    - `scripts/benchmarks/build-certainty-crosswalk-live-pack.mjs`
    - output pack: `reports/benchmarks/packs/v2/certainty_crosswalk_live.v1.json`
  - Added certainty crosswalk benchmark:
    - `scripts/benchmarks/compute-certainty-crosswalk-benchmark.mjs`
    - `reports/benchmarks/packs/v2/certainty_crosswalk.v1.json`
  - Outputs:
    - `reports/benchmarks/certainty-crosswalk.json`
    - `reports/benchmarks/certainty-crosswalk-eval-latest.json`
    - `reports/benchmarks/certainty-disagreement-latest.json`

2. Living evidence workflows require drift surveillance (effect, rank, certainty).
- Signal from literature: living evidence synthesis in cardiology is accelerating and requires stable update governance.
- Implementation:
  - Added living drift monitor:
    - `scripts/operations/compute-living-drift.mjs`
    - threshold pack: `reports/ops/packs/living_drift_thresholds.v1.json`
  - Outputs:
    - `reports/ops/living-drift-history.json`
    - `reports/ops/living-drift-latest.json`
  - Tracks:
    - pairwise effect drift
    - network rank drift (top-treatment probability + POTH drift)
    - certainty drift (ROB-ME, RoB NMA, and crosswalk kappa)

3. Ranking uncertainty must be reproducible for editorial claims.
- Signal from methods standards: Monte Carlo rank outputs must be deterministic for reproducibility and drift interpretation.
- Implementation:
  - Network engine now uses a deterministic seeded PRNG for ranking simulation:
    - `src/engine/stats/network-v1.js`
    - seed surfaced in output as `input.rankSeed`
  - Contract and benchmark updated:
    - `src/contracts/schemas/network-analysis.v1.schema.json`
    - `scripts/benchmarks/compute-network-benchmark.mjs`
    - `reports/benchmarks/packs/v2/network_nma.v1.json`

## Quran-Inspired Operating Constraint Translation

- Mizan (balance): implemented as explicit balance of signal and uncertainty (POTH, multiplicative heterogeneity, drift thresholds).
- Burhan (proof): implemented as benchmarked, schema-validated, file-level artifacts for every new method output.
- Amanah (trust): implemented via deterministic rank simulation and repeatable verification gates.

## Sources (Primary)

- GRADE vs CINeMA certainty comparison (J Clin Epidemiol, PMID: 40105219): https://pubmed.ncbi.nlm.nih.gov/40105219/
- ROB-ME / missing-evidence impact in pairwise MA (BMJ 2025, e083039): https://pubmed.ncbi.nlm.nih.gov/40412603/
- Non-affirmative studies and publication-bias methods (BMJ, PMID: 39152479): https://pubmed.ncbi.nlm.nih.gov/39152479/
- Living evidence synthesis in cardiology (Nat Rev Cardiol, PMID: 40334720): https://pubmed.ncbi.nlm.nih.gov/40334720/
