# Identity Override Workflow

Purpose:
- Route low-confidence cross-source identity pairs to human methodologist review.
- Persist forced merge/split decisions and re-apply them on every dedup run.

Artifacts:
- Queue CSV: `reports/dedup/override-queue.csv`
- Override rules: `reports/dedup/overrides.json`
- Dedup manifest (canonical pointers): `reports/dedup/latest-manifest.json`
- Dedup report: `reports/dedup/latest.json`
- Provenance ledger: `reports/dedup/provenance-latest.json`

Commands:
1. Rebuild dedup + queue:
   - `npm run dedup:identity`
   - For strict multisource runs: `npm run dedup:identity:multisource` (fails if any connector fetch fails)
2. Fill decision columns in queue CSV:
   - `decision`: `force_merge`, `force_split`, `clear`, or blank
   - `reviewer`: reviewer id
   - `reason`: concise rationale
3. Apply decisions:
   - `npm run dedup:apply-overrides`
4. Re-run dedup to re-materialize clusters with overrides:
   - `npm run dedup:identity`

Decision guidance:
- `force_merge` for same study/publication represented across sources.
- `force_split` for look-alike titles that are distinct studies.
- `clear` to remove prior override decision.
