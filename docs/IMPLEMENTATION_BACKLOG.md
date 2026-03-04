# Implementation Backlog (v1 to world-class)

## Track A: Foundation
- [ ] Repo scaffold with modules (`src/ui`, `src/data`, `src/engine`, `src/provenance`).
- [x] Build/lint/test tooling and CI.
- [x] Core data contracts and validators.

## Track B: Data Connectors
- [x] ClinicalTrials.gov v2 connector with query builder (v1).
- [x] AACT connector with pagination and schema-aware field mapping (v1 proxy path).
- [x] PubMed connector (E-utilities) with rate-limiter + api_key support.
- [x] OpenAlex connector with key-aware credit budgeting.
- [x] Europe PMC connector with syntax-safe query builder.

## Track C: Identity and Dedup
- [x] Trial identity graph (NCT/PMID/DOI/title-year) (v1).
- [x] Deterministic dedup scoring and explanation output (v1).
- [x] Human override queue for low-confidence merges.

## Track D: Cardio Ontology
- [x] Intervention dictionary with synonym and class mapping.
- [x] Outcome ontology for CV endpoint harmonization.
- [ ] Guideline topic map integration (ACC/ESC topic mapping layer).

## Track E: Discovery UX
- [ ] Ayat map renderer with WebGL fallback.
- [ ] Network and matrix views with cross-filtering.
- [ ] Gap scatter with confidence overlays.
- [ ] Drill-down panel with direct source citation links.
- [ ] Keyboard-only navigation and accessibility audit.

## Track F: Ranking and Explainability
- [x] Opportunity score v1.
- [ ] Ranking sensitivity view (weights and uncertainty).
- [ ] Rank change diff report per data refresh.

## Track G: Trust, Security, QA
- [x] Remove dynamic inline handlers.
- [ ] Schema hardening for import/export.
- [x] Provenance completeness checks (cluster-level stitched completeness v1).
- [ ] Gold benchmark and regression suite.
- [ ] Load/perf testing with large universes.

## Track H: Expert Adoption
- [x] 12-person board setup and scoring rubric.
- [x] Blind review dashboard.
- [ ] Weekly model calibration report.
- [x] 11/12 switch readiness report.

## Track I: Editorial Readiness
- [x] Lancet-quality gate definitions and evidence-linked checklist.
- [x] Automated readiness report pack (JSON + CSV + markdown).
- [x] Non-proxy ranking benchmark harness for editorial claims.
- [x] Consecutive-cycle adoption confirmation (>=11/12 across two blinded cycles).

## Track J: Advanced Statistics Engine
- [x] Pairwise synthesis v2 (REML + HKSJ + prediction intervals + robust variance).
- [x] Bias sensitivity suite (ROB-ME fields + selection-model/PET-PEESE/trim-and-fill/p-hacking scenarios).
- [x] Network meta-analysis engine with inconsistency diagnostics and rank uncertainty.
- [x] Certainty crosswalk and disagreement dashboard (GRADE vs CINeMA style outputs).
- [x] Living update drift control (effect/rank/certainty drift with threshold alerts).
