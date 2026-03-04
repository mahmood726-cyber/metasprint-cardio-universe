# Runtime SLO Policy

Updated: 2026-03-01

Policy source:
- `reports/ops/packs/runtime_slo_policy.v1.json`

Enforcement command:
- `npm run ops:runtime-slo:enforce`

Purpose:
- Keep release and nightly verification runtimes inside explicit service objectives.
- Detect sustained runtime regressions before they become release blockers.

## SLO Controls

Labels:
- `verify_phase1`
- `verify_lancet_nightly`

Checks:
1. Latest run status must be `passed`.
2. Latest runtime must not exceed configured budget seconds.
3. Latest runtime must remain within regression cap:
   - cap = `baselineSeconds * (1 + maxRegressionRatio)` and/or rolling median cap when enough history exists.
4. Consecutive failed runs must not exceed policy limit.

## Weekly Admin Procedure

1. Pull the latest CI runtime artifacts (`reports/ci/runtime-trend.csv` and `*-runtime.json`).
2. Run `npm run ops:runtime-slo`.
3. If status is warning/failed, review:
   - `reports/ops/ci-runtime-slo-latest.json`
4. Update baseline values in `reports/ops/packs/runtime_slo_policy.v1.json` when runtime shape permanently changes.
5. Record decision and rationale in weekly operations notes.

## Escalation

- First violation: QA Lead creates issue and tags Program Lead.
- Repeated violation on two consecutive runs: release freeze until root cause and mitigation are documented.
