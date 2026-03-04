# Lancet Quality Bar

Purpose:
- Define non-negotiable quality requirements before claiming submission readiness.

Quality pillars:
1. Clinical relevance
- Questions materially affect patient-important cardio outcomes.
- Top opportunities map to active guideline uncertainty.

2. Methodological rigor
- Non-proxy ranking quality metrics on blinded judgments.
- Clear benchmark recall and calibration across target packs.
- Identity dedup benchmark quality at publication-grade operating point (`dedup_f1>=0.92` with gold labels).
- Advanced pairwise, bias, and network statistics suites pass (`REML/HKSJ/PI`, sensitivity envelope, inconsistency diagnostics, deterministic rank simulation with seed control, ROB-ME and RoB NMA reporting).
- Certainty crosswalk diagnostics pass from live extracted study-level evidence (`sourceMode=live_extracted`, not synthetic-only fixture).
  minimum statistical quality: `unique_comparisons>=100`, `weighted_kappa>=0.30`, and primary-scenario `kappa_ci95_width<=0.50`.
- Ontology benchmark coverage remains high and complete (`coverage>=98%` and `unknown_terms=0`).

3. Transparency and reproducibility
- Full provenance coverage for surfaced evidence.
- Deterministic pipelines with auditable artifacts and hashes.
- Living drift monitoring on effect, rank, and certainty metrics with thresholded alerts.
- Drift monitoring is enforced with scenario-tuned thresholds in CI (`ops:living-drift:enforce`).

4. Reliability
- Strict-source runs succeed or fail explicitly with typed failure classes.
- Release gates pass continuously before manuscript lock.

5. External confidence
- Methodologist switch gate sustained at `>=11/12` over consecutive cycles.

Operational command set:
- `npm run verify:release-gates`
- `npm run dedup:identity:multisource`
- `npm run benchmark:ingestion-live`
- `npm run benchmark:ranking`
- `npm run benchmark:dedup-identity`
- `npm run benchmark:pairwise-v2`
- `npm run benchmark:bias-sensitivity`
- `npm run benchmark:network-v1`
- `npm run benchmark:certainty-crosswalk`
- `npm run ops:living-drift`
- `npm run ops:refresh-health`
- `npm run ux:task-timing`
- `npm run verify:stats-advanced`
- `npm run editorial:lancet-readiness`
- `npm run verify:lancet` (enforced fail if not ready)

Primary readiness outputs:
- `reports/editorial/lancet-readiness-latest.json`
- `reports/editorial/lancet-submission-checklist.csv`
- `docs/editorial/LANCET_READINESS_REPORT_LATEST.md`
