# MetaSprint Cardio Universe

This is the dedicated spin-off workspace for the Universe/Discovery module from MetaSprint Autopilot.

Scope:
- Cardiology trial universe ingestion and normalization.
- Discovery UX (Ayat map, network, matrix, gap scatter, timeline, pipeline).
- Opportunity and prioritization engine for living systematic reviews.
- Provenance-first drill-down and auditability.

Core principles (Quran-inspired, product-oriented):
- Ilm (knowledge): maximize truthful, current knowledge capture.
- Burhan (proof): every claim must be traceable to source evidence.
- Adl (justice): represent populations fairly, avoid blind spots.
- Amanah (trust): transparent methods, reproducible outputs.
- Shura (consultation): continuous expert review and user feedback loops.
- Ihsan (excellence): quality bar set at world-class, not "good enough".

Read first:
- docs/EXECUTION_PLAN_90_DAYS.md
- docs/MASTER_PLAN.md
- docs/ADVANCED_STATS_RESEARCH_PLAN_2026-02-28.md
- docs/ADVANCED_STATS_LATEST_RESEARCH_2026-02-28.md
- docs/IMPLEMENTATION_BACKLOG.md
- docs/ONTOLOGY_V1.md
- docs/editorial/LANCET_QUALITY_BAR.md
- docs/editorial/LANCET_CLOSEOUT_PLAN.md
- docs/SOURCE_STANDARDS.md
- docs/SCOPE_EXTRACTION.md

Program operations:
- docs/operations/WEEKLY_EXECUTION_TRACKER.csv
- docs/operations/KPI_SCORECARD_90D_TEMPLATE.csv
- docs/operations/RISK_REGISTER_90D.csv
- docs/operations/OWNER_RACI_90D.md
- docs/operations/CADENCE_CALENDAR_2026Q2.md
- docs/operations/STRICT_SOURCE_RUNBOOK.md
- docs/operations/DETAILED_LIVING_SEARCH_PROTOCOLS.md
- docs/operations/RELEASE_GATES.md
- docs/operations/RELEASE_DOC_SYNC.v1.json
- docs/operations/RUNTIME_SLO_POLICY.md
- docs/operations/OWNER_DIRECTORY.md
- docs/operations/RUNTIME_SLO_POLICY.md
- docs/operations/OWNER_DIRECTORY.md

Quick start:
1. `npm install`
2. `npm run extract:phase0`
3. `npm run verify:phase1`
4. `npm run ops:baseline`
5. `npm run validate:ontology`
6. `npm run ops:resilience-check`
7. `npm run benchmark:ingestion-live`
8. `npm run benchmark:ranking`
9. `npm run benchmark:pairwise-v2` (advanced stats phase-A benchmark: REML + HKSJ + PI + robust variance)
10. `npm run benchmark:dedup-identity` (gold-label identity dedup precision/recall/F1 benchmark)
11. `npm run benchmark:bias-sensitivity` (Phase-B bias robustness + ROB-ME-compatible benchmark)
12. `npm run benchmark:network-v1` (Phase-C NMA + inconsistency diagnostics + rank uncertainty + RoB NMA)
13. `npm run benchmark:certainty-crosswalk` (live extracted study-level certainty crosswalk from `C:/Users/user/rct-extractor-v2`)
14. `npm run ops:living-drift` (scenario-tuned living update drift monitor for effect/rank/certainty stability)
15. `npm run verify:stats-advanced`
16. `npm run benchmark:rct-bridge` (imports external cardiology PDF corpus IDs from `C:/Users/user/rct-extractor-v2`)
17. `npm run verify:release-gates`
18. `npm run ops:runtime-slo`
19. `npm run ops:doc-sync`
20. `npm run editorial:lancet-readiness`
21. `npm run review:new-cycle -- -CycleId cycle_001`
22. Fill `reports/review-cycles/cycle_001/scores.csv`
23. `npm run review:summary -- reports/review-cycles/cycle_001/scores.csv`
24. `npm run review:new-cycle -- -CycleId cycle_002`
25. Fill `reports/review-cycles/cycle_002/scores.csv`
26. `npm run review:summary -- reports/review-cycles/cycle_002/scores.csv`
27. `npm run review:dashboard-data`
28. `npm run verify:lancet`
29. Open `public/review-dashboard.html` via local static server

Discovery shell:
- Open `public/index.html` in a local static server context.
- Source toggles in the top control bar:
  - `Sample` (deterministic offline baseline)
  - `CT.gov` (ClinicalTrials.gov v2)
  - `AACT` (expects local proxy at `http://127.0.0.1:8765`)
  - `PubMed` (NCBI E-utilities; optional `NCBI_API_KEY`)
  - `OpenAlex` (optional `OPENALEX_API_KEY` + `OPENALEX_EMAIL`)
  - `Europe PMC` (REST search API)

Identity and dedup:
- `npm run dedup:identity`
- `npm run dedup:identity:synthetic` (demo-only synthetic pair injection)
- `npm run dedup:identity:multisource`
- `npm run dedup:apply-overrides`
- `npm run ops:resilience-check` (strict outage/recovery gate)
- `npm run verify:release-gates` (phase gate + resilience gate CI-equivalent run)
- `npm run ops:runtime-slo` (runtime SLO alert/regression checks)
- `npm run ops:doc-sync` (runbook/evidence freshness checks)
- `npm run ops:quarterly-drill` (quarterly lock/outage/doc-sync drills)
- `node scripts/engine/run-identity-dedup.mjs --sources sample,ctgov --strict-sources --simulate-outage ctgov`
- `node scripts/engine/run-identity-dedup.mjs --sources sample,ctgov --strict-sources --runtime-schema-mode warn`
- Writes:
  - `reports/dedup/latest.json` (dedup + review queue + provenance summary)
  - `reports/dedup/provenance-latest.json` (cross-source stitched provenance ledger)
  - `reports/dedup/override-queue.csv` (human review queue)
  - `reports/dedup/overrides.json` (persisted force-merge/force-split rules)
  - `reports/ops/source-health-latest.json` (connector health + failure classes + runtime schema drift telemetry)
  - `reports/ops/source-health-live-latest.json` (last strict live-source run health)
  - `reports/ops/source-resilience-check-latest.json` (strict outage/recovery check)
  - `reports/ops/release-gates-latest.json` (release gate pass/fail summary)
- Workflow details: `docs/IDENTITY_OVERRIDE_WORKFLOW.md`

Editorial readiness:
- `npm run benchmark:ingestion-live` (live recall benchmark from expected NCT IDs)
- `npm run benchmark:ranking` (non-proxy ranking benchmark from blinded judgments)
- `npm run benchmark:pairwise-v2` (advanced pairwise stats benchmark)
- `npm run benchmark:dedup-identity` (identity dedup benchmark with gold duplicate/review pairs)
- `npm run benchmark:bias-sensitivity` (advanced bias robustness suite with ROB-ME-compatible summary)
- `npm run benchmark:network-v1` (network meta-analysis benchmark with inconsistency diagnostics and RoB NMA summary)
- `npm run benchmark:certainty-crosswalk` (certainty framework agreement benchmark from live extracted study-level signals; requires `sourceMode=live_extracted`; includes bootstrap uncertainty intervals)
- `npm run ops:living-drift` (effect/rank/certainty drift tracking with scenario-tuned threshold pack)
- `npm run verify:stats-advanced` (strict advanced-stats gate)
- `npm run benchmark:rct-bridge` (imports external `rct-extractor-v2` benchmark IDs and extraction coverage summary)
- `npm run editorial:lancet-readiness` (build scorecard + checklist + report)
- `npm run verify:lancet` (strict fail if not submission-ready)
- Writes:
  - `reports/benchmarks/ingestion-live.json`
  - `reports/benchmarks/ranking-eval-latest.json`
  - `reports/benchmarks/pairwise-v2.json`
  - `reports/benchmarks/pairwise-v2-eval-latest.json`
  - `reports/benchmarks/dedup-identity.json`
  - `reports/benchmarks/dedup-identity-eval-latest.json`
  - `reports/benchmarks/bias-sensitivity.json`
  - `reports/benchmarks/bias-sensitivity-eval-latest.json`
  - `reports/benchmarks/rob-me-latest.json`
  - `reports/benchmarks/network-v1.json`
  - `reports/benchmarks/network-v1-eval-latest.json`
  - `reports/benchmarks/rob-nma-latest.json`
  - `reports/benchmarks/certainty-crosswalk.json`
  - `reports/benchmarks/certainty-crosswalk-eval-latest.json`
  - `reports/benchmarks/certainty-disagreement-latest.json`
  - `reports/benchmarks/certainty-crosswalk-bridge-latest.json`
  - `reports/benchmarks/packs/v2/certainty_crosswalk_live.v1.json`
  - `reports/ops/living-drift-latest.json`
  - `reports/ops/packs/living_drift_thresholds.v1.json`
  - `reports/benchmarks/rct-extractor-bridge-latest.json`
  - `reports/benchmarks/packs/v1/rct_extractor_publications.v1.json`
  - `reports/editorial/lancet-readiness-latest.json`
  - `reports/editorial/lancet-submission-checklist.csv`
  - `docs/editorial/LANCET_READINESS_REPORT_LATEST.md`

Ontology:
- `npm run validate:ontology`
- `npm run test:ontology-mappings`
- default gate: `coverage>=98%` and `unknown_terms<=0` on benchmark entities
- Writes:
  - `reports/ontology/coverage-latest.json`
  - `reports/ontology/unknown-term-queue-latest.json`
  - `reports/ontology/unknown-term-queue.csv`
  - `reports/ontology/mapping-regression-latest.json`

Operations telemetry:
- `npm run ops:refresh-health`
- `npm run ux:task-timing`
- `refresh-health` now includes runtime-schema drift counters (warning/rejection/validator-unavailable runs and row totals), plus unique issue-source names/counts and run totals derived from source-health history.
- outputs:
  - `reports/ops/refresh-health.json`
  - `reports/ops/refresh-health-latest.json`
  - `reports/ux/task-timing.json`
  - `reports/ux/task-timing-latest.json`
- Core files:
  - `src/ontology/intervention-dictionary.js`
  - `src/ontology/endpoint-ontology.js`
  - `src/ontology/index.js`

Working outputs:
- `extracts/phase0/` mechanical extraction from the monolith.
- `extracts/hardened/` handler-hardened markup migration copies.
- `public/review-dashboard.html` blinded-review adoption dashboard.
- `public/data/review-dashboard.json` generated dashboard payload.
- `src/contracts/` canonical schemas and type declarations.
- `tests/fixtures/` valid/invalid contract fixtures.
- `docs/review/` 12-person blinded-review governance pack.
- `reports/review-cycles/` cycle-specific scoring and adoption summaries.
