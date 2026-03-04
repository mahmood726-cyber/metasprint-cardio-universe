# Master Plan - MetaSprint Cardio Universe

Date: 2026-02-28
Owner: MetaSprint
Mission: Build the best cardiology discovery and evidence-universe platform in the world.

Execution note:
- The active delivery baseline for this quarter is `docs/EXECUTION_PLAN_90_DAYS.md` (March 2, 2026 through May 31, 2026).

## 1) North Star

Primary outcome:
- A cardiology methodologist can move from "domain question" to a ranked, fully traceable review opportunity in less than 10 minutes.

Success criteria:
- Coverage: >=95% recall of benchmark cardiology RCTs in target domains.
- Precision: >=90% precision for "likely review-worthy" opportunities in top 50 ranked clusters.
- Trust: 100% of displayed metrics have click-through provenance.
- Speed: full universe refresh + rank generation in <=20 min on standard workstation.
- Adoption gate: 11/12 methodologists state they would switch immediately after blind testing.

## 2) Quran-inspired Operating Charter

Use these as engineering constraints, not slogans:
- Iqra (read, learn): build the widest high-quality ingestion and indexing pipeline.
- Burhan (clear proof): no metric without inspectable derivation and source links.
- La taqfu ma laysa laka bihi ilm (17:36): no unsupported inference in ranking labels.
- Adl (justice, 4:135): explicitly measure representation gaps by sex, age, geography, ethnicity proxies where available.
- Shura (3:159): structured weekly expert review with dissent logging.
- Mizan (55:9): balance signal and uncertainty; never overstate confidence.

## 3) Product Scope (Spin-off)

In scope:
- Universe ingestion, normalization, deduplication, entity resolution.
- Discovery views and interaction model.
- Opportunity scoring and prioritization.
- Provenance drill-down, explainability panels, and export contracts.
- Cardiology taxonomy and guideline alignment layer.

Out of scope for v1:
- Full meta-analysis authoring workflow (kept in parent app).
- Manuscript generation.
- Non-cardiology universes.

## 4) Target Users

- Methodologists running living SR/MA in cardio.
- Clinical guideline teams (ACC/ESC/AHA-aligned workflows).
- Clinical fellows and trialists scouting evidence gaps.
- HTA and value teams prioritizing synthesis backlog.

## 5) Architecture Target

## 5.1 Frontend
- Split monolith into modules:
  - `universe-canvas`
  - `network-view`
  - `matrix-view`
  - `gap-engine-ui`
  - `drilldown-provenance`
  - `filters-query-builder`
- Replace inline `onclick` strings with delegated event listeners.
- Use explicit state store for view/model separation.
- Add command palette and keyboard-first navigation for power users.

## 5.2 Data/Backend Layer
- Connector abstraction:
  - ClinicalTrials.gov API v2
  - AACT PostgreSQL
  - PubMed E-utilities
  - OpenAlex
  - Europe PMC
- Unified trial identity graph:
  - Primary IDs: NCT, PMID, DOI
  - Secondary: title-year-arm fingerprint
- Refresh model:
  - incremental deltas daily
  - full rebuild weekly
  - hard integrity snapshots monthly

## 5.3 Analytics Layer
- Intervention normalization:
  - drug class mapping
  - molecule alias harmonization
  - combination therapy decomposition
- Outcome normalization:
  - CVOT-specific endpoint ontology
  - MACE decomposition and comparability flags
- Ranking engine:
  - evidence gap score
  - freshness score
  - feasibility score
  - uncertainty penalty
  - guideline relevance multiplier

## 5.4 Audit and Trust Layer
- Every node/score gets:
  - source count and source mix
  - last refresh timestamp
  - transformation lineage
  - confidence class
- Immutable audit log for ranking changes.

## 6) Cardiology Domain Depth Plan

Taxonomy backbone (phase 1):
- HF (HFrEF/HFmrEF/HFpEF)
- ACS and chronic coronary syndromes
- Atrial fibrillation and rhythm disorders
- Hypertension and resistant HTN
- Lipids/atherosclerosis
- Valvular and structural heart disease
- Antithrombotics and thromboembolism
- Cardiometabolic risk and CKD-cardio intersection

Endpoint ontology minimum:
- MACE variants (3-point, 4-point, 5-point)
- CV death, all-cause death, HF hospitalization
- MI, stroke, urgent revascularization
- Renal composite where cardio trials include cardio-renal outcomes

Guideline linkage layer:
- Map clusters to ACC and ESC topic families.
- Surface guideline class/level context as context only, never as auto-claims.

## 7) Quality and Validation Program

## 7.1 Benchmarks
- Curate gold benchmark packs:
  - landmark CVOT corpora (SGLT2i, GLP-1RA, antithrombotics, HF therapies)
  - historical "known blind spot" sets
  - rapidly evolving areas (new devices/drug classes)

## 7.2 Metrics
- Ingestion recall/precision by source.
- Dedup F1.
- Entity resolution accuracy.
- Cluster coherence score.
- Rank utility (NDCG@k from expert judgments).
- Time-to-action and click-depth for users.

## 7.3 Gates
- P0 security gate: no dynamic JS injection paths.
- P0 provenance gate: 0 orphan metrics.
- P1 quality gate: benchmark thresholds hit for 3 consecutive runs.

## 8) Governance: 12-Person Shura Methodology Board

Composition:
- 4 SR/MA methodologists
- 3 cardiologists (different subspecialties)
- 2 biostatisticians
- 1 information specialist/librarian
- 1 guideline-methods expert
- 1 patient/public representative

Process:
- Biweekly blinded review of top-ranked opportunities.
- Structured disagreement form with required rationale.
- Decision rubric:
  - switch now
  - switch with conditions
  - not yet

Agreement target:
- 11/12 "switch now" sustained across two consecutive review cycles.

## 9) Security and Reliability Plan

Immediate remediations inherited from monolith review:
- Remove inline JS handlers in generated HTML.
- Add strict schema validation for imported JSON objects and arrays.
- Add content-security-policy where hosting mode allows.
- Add retry/backoff/circuit-breaker for source connectors.
- Add OS-aware test bootstrap; do not hard-fail on unsupported runtime symlink edge cases.

## 10) Delivery Roadmap

## Phase 0 (Week 1)
- Create spin-off repo skeleton and architecture docs.
- Extract current universe/discovery requirements and contracts.
- Freeze baseline benchmark datasets and expected outputs.

## Phase 1 (Weeks 2-4)
- Build modular UI shell and state store.
- Implement source connector SDK and normalized trial schema.
- Implement provenance model and baseline drill-down panel.

## Phase 2 (Weeks 5-8)
- Ship v1 discovery views (Ayat, Network, Matrix, Gap Scatter, Timeline).
- Ship deterministic ranking v1 with explainability.
- Add expert feedback capture and recalibration loop.

## Phase 3 (Weeks 9-12)
- Add cardiology ontology depth and guideline context overlays.
- Run blinded board evaluations.
- Performance tuning and reliability hardening.
- Candidate release for 11/12 switch threshold.

## 11) Non-negotiable Engineering Standards

- Type-safe data contracts at all external boundaries.
- No unbounded string-to-HTML injection with executable attributes.
- 100% deterministic ranking with fixed seed and audit log.
- Snapshot tests for all major visual views.
- Synthetic and real-world benchmark suites in CI.

## 12) Immediate Next 10 Actions

1. Extract discovery/universe code into isolated module files.
2. Define canonical trial schema (`TrialRecordV1`) and cluster schema.
3. Implement secure renderer utilities (`text`, `attr`, `js-string`) and ban inline handlers.
4. Build connector adapters with shared retry policy.
5. Create source reconciliation rules (NCT-PMID-DOI-title-year).
6. Implement provenance payload contract and UI viewer.
7. Build benchmark harness and golden fixtures.
8. Implement ranking v1 and sensitivity panel.
9. Stand up methodologist review workflow and scorecards.
10. Run first blinded cycle and publish calibration report.
