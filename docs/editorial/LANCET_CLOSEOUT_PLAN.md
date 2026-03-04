# Lancet Closeout Plan

Current readiness snapshot (2026-02-28):
- Gate score: `10/10` passed (`100%`)
- Overall status: `ready_for_submission`
- Source of truth:
  - `reports/editorial/lancet-readiness-latest.json`

## What Closed the Gap

1. Non-proxy ranking benchmark
- Added blinded ranking judgments fixture.
- Added deterministic ranking benchmark runner.
- `reports/benchmarks/ranking.json` now emits `proxy=false`.

2. Provenance completeness
- Upgraded provenance links with source-record fallbacks.
- Moved completeness to strict traceability contract checks.
- `reports/dedup/provenance-latest.json` now reaches `100%`.

3. Live-source editorial gating
- Added dedicated live source-health artifact:
  - `reports/ops/source-health-live-latest.json`
- Updated Lancet readiness gate to use live-source health as canonical evidence.

4. Advanced statistics + bias robustness
- Added pairwise-v2 benchmark gate (`REML`, `HKSJ`, prediction interval, robust variance).
- Added bias sensitivity suite with ROB-ME-compatible outputs.
- Added network meta-analysis benchmark with inconsistency diagnostics, deterministic rank uncertainty (seeded), ranking precision (POTH), multiplicative heterogeneity sensitivity, and RoB NMA outputs.
- Added strict advanced-stats verification command:
  - `npm run verify:stats-advanced`

5. Certainty disagreement + living drift controls
- Added certainty crosswalk benchmark (GRADE vs CINeMA-style agreement/disagreement) sourced from live extracted study-level certainty signals:
  - `npm run benchmark:certainty-crosswalk`
- Added living drift monitor for effect/rank/certainty shifts with scenario-tuned threshold pack and hard enforcement:
  - `npm run ops:living-drift`
  - `npm run ops:living-drift:enforce`

6. Identity dedup benchmark + operations telemetry
- Added gold-labeled identity dedup benchmark gate:
  - `npm run benchmark:dedup-identity`
- Added refresh telemetry computation from strict source-health history:
  - `npm run ops:refresh-health`
- Added discovery workflow timing telemetry from release-gate runtime history:
  - `npm run ux:task-timing`

## Sustainment Loop (Required Before Any Submission Freeze)

1. `npm run verify:release-gates`
2. `npm run ops:runtime-slo`
3. `npm run ops:doc-sync`
4. `npm run dedup:identity:multisource`
5. `npm run benchmark:dedup-identity`
6. `npm run benchmark:ingestion-live`
7. `npm run benchmark:ranking`
8. `npm run verify:stats-advanced`
9. `npm run benchmark:network-v1`
10. `npm run benchmark:certainty-crosswalk`
11. `npm run ops:living-drift`
12. `npm run ops:refresh-health`
13. `npm run ux:task-timing`
14. `npm run validate:ontology`
15. `npm run verify:lancet`

Quarterly add-on:
- `npm run ops:quarterly-drill`

## Hard Rule

Do not freeze manuscript outputs if any gate in `verify:lancet` fails.
