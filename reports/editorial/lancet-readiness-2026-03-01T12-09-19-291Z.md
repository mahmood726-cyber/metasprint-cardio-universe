# Lancet Readiness Report

Generated: 2026-03-01T12:09:19.291Z
Overall status: **ready_for_submission**
Gate score: **10/10 (100%)**

## Gates
- PASS [critical] Benchmark ingestion recall
  target: >= 95%
  actual: 100%
  evidence: `reports\benchmarks\ingestion-live.json`
- PASS [major] Certainty crosswalk and living drift control
  target: certainty_crosswalk=passed, source_mode=live_extracted, unique_comparisons>=100, weighted_kappa>=0.3, kappa_ci95_width<=0.5, living_drift in [passed, baseline_established]
  actual: certainty_crosswalk=passed; source_mode=live_extracted; unique_comparisons=127; weighted_kappa=0.545689; kappa_ci95_width=0.151309; living_drift=passed
  evidence: `reports\benchmarks\certainty-crosswalk.json; reports\ops\living-drift-latest.json`
- PASS [critical] Advanced statistics and bias robustness suite
  target: pairwise=passed, bias=passed, network=passed, ROB-ME coverage>=100%, RoB NMA coverage>=100%
  actual: pairwise=passed; bias=passed; network=passed; ROB-ME coverage=100%; RoB NMA coverage=100%
  evidence: `reports\benchmarks\pairwise-v2.json; reports\benchmarks\bias-sensitivity.json; reports\benchmarks\network-v1.json`
- PASS [major] Identity dedup benchmark quality
  target: status=passed, f1>=0.92
  actual: status=passed; f1=1
  evidence: `reports\benchmarks\dedup-identity.json`
- PASS [critical] Ranking quality measured from non-proxy benchmark judgments
  target: precision@20 >= 90%, ndcg@20 >= 82%, proxy=false
  actual: precision@20=100%; ndcg@20=99.84%; proxy=false
  evidence: `reports\benchmarks\ranking.json`
- PASS [critical] Provenance completeness
  target: >= 100%
  actual: 100%
  evidence: `reports\dedup\provenance-latest.json`
- PASS [major] Ontology mapping coverage
  target: coverage>=98%, unknown_terms<=0
  actual: coverage=100%; unknown_terms=0
  evidence: `reports\ontology\coverage-latest.json`
- PASS [major] Release gate health
  target: status=passed
  actual: passed
  evidence: `reports\ops\release-gates-latest.json`
- PASS [major] Strict live-source breadth
  target: strictStatus=passed, failedSources=0, okSources>=4
  actual: strictStatus=passed; okSources=5; failedSources=0
  evidence: `reports\ops\source-health-live-latest.json`
- PASS [major] Methodologist switch gate
  target: 2 consecutive cycles with switch_now>=11 out of 12
  actual: 2/2 consecutive cycles passed; latest=11/12
  evidence: `reports\review-cycles\cycle_001-summary.json; reports\review-cycles\cycle_002-summary.json`

## Blockers
- None. Submission gates are all green.
