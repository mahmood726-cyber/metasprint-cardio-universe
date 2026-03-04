# 90-Day Execution Plan (Cardio Universe)

Program window:
- Start: March 2, 2026 (Monday)
- End: May 31, 2026 (Sunday)
- Duration: 13 weeks

Mission:
- Convert the current strong foundation into a world-leading cardiology evidence operating system for discovery, prioritization, and rapid review production.

## Day-90 Outcomes

By May 31, 2026, all of the following should hold:
- Coverage: >=95% recall on curated cardio benchmark packs.
- Prioritization quality: >=0.82 NDCG@20 from blinded expert judgments.
- Trust: 100% of surfaced metrics have click-through provenance.
- Freshness: daily incremental updates completed in <=30 min.
- Reliability: >=99% successful scheduled refresh jobs over trailing 30 days.
- Human acceptance: 11/12 methodologists choose `switch_now` in 2 consecutive cycles.
- Editorial utility: time from domain prompt to ranked review shortlist <=10 min.

## Program Structure

Execution streams:
1. Stream A - Data and Connectors
2. Stream B - Identity, Dedup, and Provenance
3. Stream C - Cardio Ontology and Guideline Mapping
4. Stream D - Ranking and Explainability
5. Stream E - Discovery UX and Interaction
6. Stream F - Benchmarks, QA, and Reliability
7. Stream G - Methodology Board and Calibration
8. Stream H - Release and Change Management

Owner model:
- Program Lead: cadence, blockers, delivery risk.
- Data Lead: connectors, data contracts, refresh reliability.
- Methods Lead: benchmark curation, board calibration, scoring validity.
- UX Lead: discovery workflow speed and clarity.
- QA Lead: automated gates and regression quality.

## Weekly Roadmap

## Week 1 (March 2-8, 2026) - Program Mobilization and Baseline Lock

Deliverables:
- Freeze benchmark packs v1 (SGLT2i, GLP-1, antithrombotics, HF therapies).
- Lock baseline metrics snapshot from current build.
- Establish 90-day scorecard and risk register.

Acceptance criteria:
- Benchmark fixture sets checked into repo with version tags.
- Baseline KPI file published under `docs/operations/`.
- Weekly governance cadence scheduled for full 13-week period.

## Week 2 (March 9-15, 2026) - Unified Cardio Knowledge Graph Schema

Deliverables:
- Finalize graph entities: trial, publication, intervention, endpoint, subgroup, guideline-topic.
- Add schema validators for graph edges and provenance completeness.

Acceptance criteria:
- Graph schema passes fixture suite with >=50 edge-case examples.
- No orphan entity nodes in validation output.

## Week 3 (March 16-22, 2026) - Ingestion Hardening and Source Resilience

Deliverables:
- Harden connector retries/backoff/budget controls.
- Add strict-source refresh mode for production runs.
- Add source health telemetry and failure classes.

Acceptance criteria:
- Simulated outage run produces explicit failed state in strict mode.
- Recovery run succeeds after source restoration.

## Week 4 (March 23-29, 2026) - Ontology v1 and Endpoint Harmonization

Deliverables:
- Cardio intervention synonym dictionary v1.
- Endpoint ontology for MACE variants and cardio-renal composites.
- Deterministic mapping audit output for every normalization step.

Acceptance criteria:
- >=95% mapping coverage on benchmark entities.
- Unknown-term queue produced for unresolved mappings.

## Week 5 (March 30-April 5, 2026) - Ranking Engine v2 (Expected-Value Oriented)

Deliverables:
- Replace simple score with multi-factor utility model:
  - clinical impact potential
  - uncertainty reduction potential
  - methodological feasibility
  - evidence freshness
  - provenance confidence penalty
- Add ranking sensitivity report.

Acceptance criteria:
- Reproducible rank list with fixed seed.
- Sensitivity output generated for top 50 clusters.

## Week 6 (April 6-12, 2026) - Explainability and Trust Surfaces

Deliverables:
- Per-opportunity explanation panel with feature contribution breakdown.
- Provenance drill-through links for every component metric.
- Confidence labeling policy enforcement.

Acceptance criteria:
- 0 unexplained ranking scores in QA audit.
- 0 provenance-link failures in automated check.

## Week 7 (April 13-19, 2026) - Dedup Adjudication UI

Deliverables:
- Reviewer-facing adjudication UI replacing CSV-only override flow.
- Decision capture for `force_merge`, `force_split`, and `clear`.
- Conflict queue for multi-reviewer disagreement.

Acceptance criteria:
- End-to-end adjudication updates graph output without manual file edits.
- Decision audit trail includes reviewer and timestamp for 100% decisions.

## Week 8 (April 20-26, 2026) - Discovery UX Real Views

Deliverables:
- Replace placeholder frame with production Ayat, Network, Treemap foundations.
- Cross-filtering from view selections to opportunity shortlist.
- Keyboard-first navigation and accessibility pass v1.

Acceptance criteria:
- Core discovery tasks completed in <=10 min median in internal usability test.
- WCAG-focused keyboard path passes for primary workflows.

## Week 9 (April 27-May 3, 2026) - Benchmark Harness and CI Gates

Deliverables:
- CI benchmark job for recall/precision/NDCG and dedup F1.
- Regression snapshots for ranking and provenance payloads.
- Perf harness for large-universe load testing.

Acceptance criteria:
- All benchmark gates visible in CI summary.
- Failing gate blocks release branch promotion.

## Week 10 (May 4-10, 2026) - Blind Review Cycle 1

Deliverables:
- Run full 12-methodologist blinded cycle on top opportunities.
- Publish dissent themes and remediation map.

Acceptance criteria:
- Complete scorecard with no missing reviewer submissions.
- Remediation actions assigned with owners and due dates.

## Week 11 (May 11-17, 2026) - Remediation Sprint and Blind Cycle 2

Deliverables:
- Ship fixes from cycle 1 blockers.
- Execute second blinded cycle.

Acceptance criteria:
- Reach >=11/12 `switch_now` in cycle 2.
- No unresolved red-flag trust issues.

## Week 12 (May 18-24, 2026) - Editorial Output Layer

Deliverables:
- One-click editorial brief export:
  - candidate question set
  - evidence rationale
  - key trials and confidence notes
  - unresolved controversies
- Guideline-topic overlays in output.

Acceptance criteria:
- Editorial brief generated for top 20 opportunities without manual patching.
- Reviewers confirm output is publication-planning ready.

## Week 13 (May 25-31, 2026) - Release Hardening and Go/No-Go

Deliverables:
- Full reliability sweep, security sweep, and rollback playbook.
- Day-90 KPI attestation and launch recommendation memo.

Acceptance criteria:
- All hard gates green for 7 consecutive days.
- Go/no-go decision signed by Program Lead and Methods Lead.

## Hard Gates (Non-Negotiable)

Release can proceed only if all are true:
- Security: no inline event handlers or dynamic executable injection paths.
- Provenance: 0 orphan metrics in production build.
- Quality: benchmark thresholds met for 3 consecutive runs.
- Reliability: strict-source runs pass without unresolved connector failure.
- Methodology: 11/12 switch gate achieved in two consecutive cycles.

## KPI Operating Model

Track weekly in `docs/operations/KPI_SCORECARD_90D_TEMPLATE.csv`:
- Ingestion recall
- Opportunity precision@20
- NDCG@20
- Dedup precision/recall/F1
- Provenance completeness
- Refresh success rate
- Refresh runtime p95
- Median discovery workflow time
- Switch-now count / 12

Escalation thresholds:
- Any KPI off-target by >10% for 2 weeks triggers escalation.
- Any security/provenance hard-gate failure triggers same-day fix window.

## Execution Cadence

Daily:
- 15-minute engineering standup: blockers, risks, gate health.
- Automated overnight refresh review and anomaly triage.

Weekly (Monday):
- KPI review and milestone checkpoint.
- Risk register update and owner confirmation.

Weekly (Thursday):
- Methods + engineering calibration round.
- Prioritization changes recorded in decision log.

Biweekly:
- Blinded board review cycle (or dry-run rehearsal when not in formal cycle).

## Initial Risk Register (Top 8)

1. Connector instability (external APIs)
- Mitigation: strict-source mode + fallback/alerting.

2. Ontology drift from new cardio terminology
- Mitigation: unknown-term queue + weekly ontology adjudication.

3. Dedup false merges
- Mitigation: reviewer adjudication queue + conservative thresholds.

4. Benchmark overfitting
- Mitigation: holdout benchmark sets and rotation every 2 weeks.

5. Reviewer disagreement variance
- Mitigation: calibration sessions + rubric clarifications.

6. UX complexity creep
- Mitigation: workflow-time KPI and user-task scripts.

7. Perf degradation at scale
- Mitigation: weekly perf regression tests.

8. Delivery fragmentation across streams
- Mitigation: single program board with clear owner accountability.

## Immediate Next 10 Working Days

Day 1-2 (March 2-3):
- finalize benchmark packs and KPI baseline.

Day 3-4 (March 4-5):
- graph schema finalization and validator scaffolding.

Day 5 (March 6):
- strict-source connector runbook and incident classes.

Day 6-7 (March 9-10):
- ontology dictionary seed + unknown-term queue.

Day 8 (March 11):
- ranking v2 feature definitions and weight policy draft.

Day 9 (March 12):
- explainability payload contract and acceptance tests.

Day 10 (March 13):
- KPI review, risk update, and sprint re-plan checkpoint.

## Repo Artifacts Linked to This Plan

- `docs/operations/WEEKLY_EXECUTION_TRACKER.csv`
- `docs/operations/KPI_SCORECARD_90D_TEMPLATE.csv`
- `docs/operations/RISK_REGISTER_90D.csv`
- `docs/operations/OWNER_RACI_90D.md`
- `docs/operations/CADENCE_CALENDAR_2026Q2.md`

Execution principle:
- This plan is authoritative for March 2 through May 31, 2026. Any scope change must update tracker, KPI target, and risk register in the same pull request.
