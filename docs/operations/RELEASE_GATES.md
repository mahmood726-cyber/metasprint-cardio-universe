# Release Gates

Updated: 2026-03-01

Command:
- `npm run verify:release-gates`

Current gate sequence:
1. `npm run verify:phase1`
2. `npm run ops:resilience-check`
3. `npm run ops:doc-sync:enforce`

Artifacts:
- `reports/ops/release-gates-latest.json`
- `reports/ops/release-gates-<timestamp>.json`
- `reports/ops/release-doc-sync-latest.json`
- `reports/ops/ci-runtime-slo-latest.json`

CI:
- `.github/workflows/release-gates.yml`
- `.github/workflows/nightly-lancet.yml`
- `.github/workflows/quarterly-ops-drill.yml`
- Note: in `release-gates.yml`, `verify:phase1` runs once via budget wrapper; gate runner is invoked with `--skip phase1` to avoid duplicate execution.

Pass condition:
- All configured gates return exit code `0`.
- `verify:phase1` includes ontology regression and dedup identity benchmark checks before resilience validation.
- Runtime SLO checks pass in CI for the active runtime label.

Fail condition:
- Any gate exits non-zero; execution stops and report status is `failed`.
- Runtime SLO violation in CI blocks promotion until policy/baseline is corrected.
