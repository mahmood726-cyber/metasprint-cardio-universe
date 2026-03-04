# Strict Source Runbook

Updated: 2026-03-01

Purpose:
- Execute connector-backed dedup runs with explicit failure state when any source is degraded.
- Produce auditable source-health telemetry for every run.

## Core Commands

Strict multisource run:
- `npm run dedup:identity:multisource`

Deterministic outage and recovery validation:
- `npm run ops:resilience-check`

Runtime SLO and release-doc sync checks:
- `npm run ops:runtime-slo`
- `npm run ops:doc-sync`

Quarterly reliability drill:
- `npm run ops:quarterly-drill`

Manual simulated outage for one source:
- `node scripts/engine/run-identity-dedup.mjs --sources sample,ctgov --strict-sources --simulate-outage ctgov`

Manual recovery check (no outage simulation):
- `node scripts/engine/run-identity-dedup.mjs --sources sample,ctgov --strict-sources`

Optional runtime schema strictness:
- `node scripts/engine/run-identity-dedup.mjs --sources sample,ctgov --strict-sources --runtime-schema-mode warn`
- `node scripts/engine/run-identity-dedup.mjs --sources sample,ctgov --strict-sources --runtime-schema-mode enforce`
- Modes: `off` (default), `warn`, `enforce` (same semantics as repository ingestion runtime schema validation).

## Exit Codes

- `0`: run passed (strict mode satisfied).
- `2`: strict mode failed because at least one source is in `failed` state.
- `1`: run failed for non-strict reasons (for example, no records loaded without strict-source failure condition).

## Telemetry Artifacts

Primary:
- `reports/ops/source-health-latest.json`
- `reports/ops/source-health-<timestamp>.json`
- `reports/ops/source-health-live-latest.json` (canonical last strict live-source run)
- `reports/ops/source-health-live-<timestamp>.json`
- `summary.runtimeSchema` in each source-health report includes requested mode, mode counts, unreported source count, validated/rejected/warning totals, and validator availability.
- `sources[].runtimeSchema` in each source-health report captures per-source runtime schema mode/validator/issues.

Resilience gate:
- `reports/ops/source-resilience-check-latest.json`
- `reports/ops/source-resilience-check-<timestamp>.json`

Linked dedup output:
- `reports/dedup/latest-manifest.json` (canonical pointer for downstream consumers)
- `reports/dedup/latest.json`
- `reports/dedup/provenance-latest.json`

Derived telemetry:
- `reports/ops/refresh-health.json`
- `reports/ops/refresh-health-latest.json`
- `reports/ux/task-timing.json`
- `reports/ux/task-timing-latest.json`

## Failure Classes

- `auth_error`
- `not_found`
- `rate_limited`
- `upstream_unavailable`
- `timeout`
- `network_unreachable`
- `budget_exhausted`
- `invalid_response`
- `bad_request`
- `simulated_outage`
- `unknown`

## Operator Flow

1. Run strict command.
2. If exit code is `2`, inspect `reports/ops/source-health-latest.json`.
3. For editorial/readiness checks, use `reports/ops/source-health-live-latest.json` as source-of-truth.
4. Triage by `failureClass`:
   - `auth_error`: rotate key/token or permissions.
   - `rate_limited`: reduce frequency, validate key tier, retry.
   - `upstream_unavailable` or `network_unreachable`: treat as outage, retry after backoff window.
   - `invalid_response`: inspect upstream schema drift and connector parser.
5. Re-run strict command until `strictStatus` is `passed`.
6. Record incident outcome in weekly operations notes.
7. Run `npm run ops:runtime-slo` and `npm run ops:doc-sync` before release sign-off.

## Lock Collision Recovery

Signals:
- command exits with code `2` and `lock exists` message
- lock metrics show non-zero `collisionCount` in dedup/drift reports

Operator steps:
1. Identify lock owner from error output (`owner pid`) or lock file content.
2. Verify whether that process is healthy and still running.
3. If healthy, re-run with bounded wait, for example:
   - `node scripts/engine/run-identity-dedup.mjs --sources sample,ctgov --strict-sources --strict-integrity --lock-wait-ms 30000`
   - `node scripts/operations/compute-living-drift.mjs --lock-wait-ms 30000`
4. If stale lock is confirmed (owner pid not active), remove `*.lock` file and re-run.
5. Capture lock wait/collision metrics in incident notes.

## Source Outage Recovery

1. Run `npm run dedup:identity:multisource`.
2. If strict run fails, inspect `reports/ops/source-health-latest.json`:
   - `failureClass=auth_error`: rotate credentials and validate permission scope.
   - `failureClass=rate_limited`: reduce run frequency and confirm provider quota tier.
   - `failureClass=upstream_unavailable` or `network_unreachable`: treat as outage; retry after backoff window.
   - `failureClass=invalid_response`: inspect connector parser and upstream schema drift.
3. Confirm recovery with:
   - `npm run ops:resilience-check`
   - `npm run ops:doc-sync`
   - `npm run verify:release-gates`
4. Ensure `strictStatus=passed` and `failedSources=0` before editorial release steps.

## Quarterly Drill Protocol

1. Run `npm run ops:quarterly-drill`.
2. Confirm report status is `passed` in:
   - `reports/ops/quarterly-ops-drill-latest.json`
3. If any scenario fails, file incident and block release hardening until corrected.
