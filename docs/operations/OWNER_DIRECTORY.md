# Owner Directory

Updated: 2026-03-01

Purpose:
- Define clear ownership for operational gates, runbooks, and escalation.
- Remove ambiguity for who updates policies, triages incidents, and signs release readiness.

## Role Directory

| Role | Scope | Backup | Escalates To |
|---|---|---|---|
| Program Lead | Release decision, cadence tracking, KPI governance | QA Lead | Executive Sponsor |
| Data Lead | Connector health, strict-source reliability, dedup pipeline integrity | QA Lead | Program Lead |
| Methods Lead | Editorial readiness, ranking/statistics gate interpretation | Program Lead | Executive Sponsor |
| UX Lead | Discovery workflow timing and UX throughput | Program Lead | QA Lead |
| QA Lead | CI gate enforcement, regression checks, quarterly drills | Data Lead | Program Lead |

## Command Ownership

| Command / Artifact | Primary Owner | Backup Owner | Cadence |
|---|---|---|---|
| `npm run verify:phase1` | QA Lead | Data Lead | Every PR / push |
| `npm run verify:release-gates` | QA Lead | Program Lead | Every PR / push |
| `npm run ops:runtime-slo` | QA Lead | Program Lead | Weekly + CI |
| `npm run ops:doc-sync` | Program Lead | QA Lead | Weekly + CI |
| `npm run ops:resilience-check` | Data Lead | QA Lead | Weekly + before release |
| `npm run ops:quarterly-drill` | QA Lead | Data Lead | Quarterly |
| `reports/ops/ci-runtime-slo-latest.json` | QA Lead | Program Lead | Weekly |
| `reports/ops/release-doc-sync-latest.json` | Program Lead | QA Lead | Weekly |
| `reports/ops/quarterly-ops-drill-latest.json` | QA Lead | Data Lead | Quarterly |

## Admin Cadence (Non-Optional)

Weekly:
1. Run `npm run ops:runtime-slo`.
2. Run `npm run ops:doc-sync`.
3. Update `reports/ops/packs/runtime_slo_policy.v1.json` baseline values if sustained runtime drift is observed.

Quarterly:
1. Run `npm run ops:quarterly-drill`.
2. Log outcomes in operations notes and link the latest drill report.
3. Reconfirm role backups and escalation chain.
