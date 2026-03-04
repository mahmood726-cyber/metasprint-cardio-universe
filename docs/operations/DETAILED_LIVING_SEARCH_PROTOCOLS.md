# Detailed Living Search Protocols

Updated: 2026-03-03

Purpose:
- Provide an executable SOP for living cardio search, screening, deduplication, and reporting.
- Standardize source behavior across connectors so reruns are reproducible.
- Require chart interpretation text and per-chart downloads in dashboard outputs.

Scope of "source-complete" in this SOP:
- Complete within configured connectors: `ctgov`, `aact`, `pubmed`, `openalex`, `europepmc`.
- Plus mandatory reference snowballing from included landmark studies.
- This is not a claim of universal coverage of all global registries/databases.

Adaptation basis:
- Patterns adapted from:
  - `C:\Users\user\OneDrive - NHS\Documents\Tricuspid_TEER_LivingMeta`
  - `C:\Users\user\OneDrive - NHS\Documents\LivingMeta_Watchman_Amulet`
  - `C:\Users\user\OneDrive - NHS\Documents\PFA_AF_LivingMeta`

## 1) Protocol Freeze (required before running)

Each living topic must freeze:
1. Population.
2. Intervention and synonyms.
3. Comparator and synonyms.
4. Outcomes (primary efficacy/safety + follow-up window).
5. Design mode:
   - `rct_only` (default).
   - `rct_plus_comparative` (explicitly approved exception).
6. Language/date constraints.
7. Update cadence and run windows (UTC).

Required protocol artifact:
- Save topic protocol JSON at `reports/ops/packs/search_protocol_<topic>.v1.json`.

## 2) Query Packs (versioned, executable)

Every run must reference a pinned query pack version and run all source queries in that pack.

Pack file:
- `reports/ops/packs/search_query_pack.v1.json`

Required fields per source query:
- `topicId`
- `source`
- `enabled` (must be `true` for active topic/source pairs)
- `queryText` (or source-specific parameter map)
- `pageSize`
- `maxPages`
- `maxRecords`
- `lookbackDays`
- `updatedSinceField`

Preflight completeness gate (mandatory before acquisition):
- Build expected Cartesian set: `active_topics x configured_connectors`.
- Fail run if any expected pair lacks an `enabled=true` query record in the pinned pack.
- Emit missing pairs into `reports/ops/source-health-latest.json` and run-scoped artifact (see section 10).

### 2.1 Topic query examples (v1 baseline)

AACT mapping rule for all topics (normative):
- AACT query predicates must mirror the corresponding `ctgov` topic query semantics.
- Required translation artifact per topic: `reports/ops/packs/aact_query_map_<topic>.v1.sql`.

#### A) PFA in AF (`pfa_af`)

ClinicalTrials.gov:
```text
query.intr=pulsed+field+ablation+OR+farapulse+OR+electroporation
query.cond=atrial+fibrillation
filter.overallStatus=COMPLETED,ACTIVE_NOT_RECRUITING,RECRUITING
pageSize=100
```

PubMed:
```text
((pulsed field ablation[tiab]) OR (farapulse[tiab]) OR (electroporation ablation[tiab]))
AND (atrial fibrillation[tiab])
AND (randomized[tiab] OR trial[tiab] OR controlled[tiab])
```

OpenAlex:
```text
search="pulsed field ablation" AND "atrial fibrillation"
per-page=200
```

Europe PMC:
```text
(atrial fibrillation) AND (pulsed field ablation OR farapulse OR electroporation) AND (trial OR randomized)
```

#### B) LAAO Watchman vs Amulet (`laao_watchman_amulet`)

ClinicalTrials.gov:
```text
query.term=(left+atrial+appendage)+AND+(Watchman+OR+Amulet+OR+LAAO+OR+occluder)
filter.overallStatus=COMPLETED,ACTIVE_NOT_RECRUITING,RECRUITING
pageSize=100
```

PubMed:
```text
(left atrial appendage closure[tiab])
AND (Watchman[tiab] OR Amulet[tiab])
AND (randomized[tiab] OR trial[tiab] OR controlled[tiab])
```

OpenAlex:
```text
search="Watchman FLX" AND "Amulet"
per-page=200
```

Europe PMC:
```text
(left atrial appendage closure) AND (Watchman OR Amulet) AND (trial OR randomized)
```

#### C) Tricuspid TEER (`tricuspid_teer`)

ClinicalTrials.gov:
```text
query.term=(tricuspid)+AND+(TEER+OR+TriClip+OR+PASCAL+OR+transcatheter edge-to-edge)
filter.overallStatus=COMPLETED,ACTIVE_NOT_RECRUITING,RECRUITING
pageSize=100
```

PubMed:
```text
(tricuspid[tiab])
AND (teer[tiab] OR triclip[tiab] OR pascal[tiab] OR transcatheter edge-to-edge[tiab])
AND (trial[tiab] OR randomized[tiab] OR prospective[tiab])
```

OpenAlex:
```text
search="tricuspid" AND ("TriClip" OR "PASCAL")
per-page=200
```

Europe PMC:
```text
(tricuspid) AND (TEER OR TriClip OR PASCAL) AND (trial OR prospective OR randomized)
```

## 3) Deterministic Retrieval Rules

### 3.1 ClinicalTrials.gov (`ctgov`)
- `pageSize=100`.
- Iterate until one of:
  - no next page token,
  - `maxPages` reached,
  - `maxRecords` reached.
- Apply update lookback (`updatedSinceField=lastUpdatePostDate`) when configured.

### 3.2 AACT (`aact`)
- Use approved proxy host only.
- Pin proxy host and schema snapshot timestamp in run metadata.
- Use deterministic `limit/offset` paging with stable order:
  - `ORDER BY nct_id ASC, last_update_submitted_date DESC`.
- Stop at empty page or cap.

### 3.3 PubMed (`pubmed`)
- `esearch` with `usehistory=y`, `retmax=0` first (get `count`, `QueryKey`, `WebEnv`).
- `efetch` in batches of 200 by `retstart`.
- Stop when fetched `count` or caps reached.
- Record `count` and fetched totals; fail run if mismatch exceeds either:
  - absolute tolerance: `> 2` records, or
  - relative tolerance: `> 0.5%` of `count` (rounded to nearest integer).

### 3.4 OpenAlex (`openalex`)
- Use cursor paging (`cursor=*`, then `next_cursor`).
- Use `per-page` exactly as pinned in query pack (`200` in v1 baseline).
- Runtime override of page size is prohibited.
- If API rejects requested `per-page`, retry once with `per-page=100`, record downgrade reason in run metadata.
- Stop at cursor exhaustion or caps.

### 3.5 Europe PMC (`europepmc`)
- Use cursor-based paging (`cursorMark=*` then returned cursor).
- Use `pageSize` exactly as pinned in query pack (`1000` in v1 baseline).
- Runtime override of page size is prohibited.
- If API rejects requested `pageSize`, retry once with `pageSize=500`, record downgrade reason in run metadata.
- Stop at cursor exhaustion or caps.

### 3.6 Reference snowballing (deterministic)
- Sources: references and cited-by links from `pubmed` and `openalex`.
- Direction: backward and forward.
- Depth: 1 hop only from included landmark studies and new inclusions from current run.
- Caps:
  - max 50 candidates per seed per direction,
  - max 1000 total snowball candidates per topic per run.
- Stop rules:
  - cap reached, or
  - no unseen records in next expansion.
- Timestamp all snowball calls in UTC and store:
  - seed record ID,
  - direction,
  - source connector,
  - candidate count,
  - accepted count.

## 4) Screening Governance

### 4.1 Two-stage screening
1. Title/abstract pass.
2. Full-text eligibility pass.

### 4.2 Reviewer model
- Dual independent screening required for inclusion decisions.
- Discordance handling:
  - auto-route to adjudicator,
  - adjudicator decision final,
  - decision rationale mandatory.

### 4.3 Study-design mode handling
- `rct_only` mode:
  - excludes observational comparative studies.
- `rct_plus_comparative` mode:
  - allows pre-specified comparative cohort designs,
  - requires explicit bias-risk tag on inclusion.

### 4.4 Missing full-text fallback (deterministic)
- If full text cannot be retrieved after 2 documented attempts in 7 days:
  - assign status `awaiting_full_text`,
  - exclude from inclusion set for current run,
  - require exclusion reason code `full_text_unavailable`.
- Re-evaluate deferred records in the next scheduled run.

## 5) Auto-Exclusion Rules (deterministic)

Default regex pack (escaped, explicit):
```text
phase\s*1(?!0)|pharmacokinetic|healthy\s+volunteer|animal|in\s+vitro|single\s*arm|case\s*report|review\b|meta[-\s]*analysis|sub[-\s]*study
```

Regex execution spec (mandatory):
- Engine: ECMAScript-compatible (`JavaScript RegExp`).
- Flags: `i` (case-insensitive), Unicode disabled.
- Input text concatenation order per record:
  1. title
  2. abstract
  3. keywords
  4. study design text
- Concatenate with single spaces after trimming each field.

Design-mode conditional:
- In `rct_only`, add:
```text
observational|retrospective registry|registry-only
```
- In `rct_plus_comparative`, do not auto-exclude `observational`; route to manual adjudication.

Required exclusion reason codes:
- `duplicate_cross_source`
- `non_target_population`
- `non_target_intervention`
- `non_target_design`
- `non_clinical`
- `low_relevance_score`
- `full_text_unavailable`

## 6) Relevance Scoring and Calibration

Baseline heuristic (v1):
- Base score: `50`
- Positive signal hit: `+12`
- Negative signal hit: `-20`
- Auto-exclude threshold: `<30`

Positive signal dictionary (v1):
- intervention signals: `pulsed field ablation`, `farapulse`, `electroporation`, `watchman`, `amulet`, `tricuspid teer`, `triclip`, `pascal`.
- design signals: `randomized`, `trial`, `controlled`, `prospective`.
- population signals: `atrial fibrillation`, `left atrial appendage`, `tricuspid`.

Negative signal dictionary (v1):
- non-clinical: `animal`, `in vitro`, `healthy volunteer`, `pharmacokinetic`.
- low-evidence design: `single arm`, `case report`, `review`, `meta-analysis`, `sub-study`.

Signal matching and accumulation rules:
- Field scope: title + abstract + keywords only.
- Matching mode: case-insensitive substring match after lowercase normalization.
- A unique signal term contributes at most once per record.
- Score formula: `50 + (12 * positive_unique_hits) - (20 * negative_unique_hits)`.

Calibration requirements:
- Maintain labeled validation set per topic (`>=100` records when available).
- Track precision/recall monthly.
- Any threshold change requires version bump and change log entry.

## 7) Deduplication and Conflict Resolution

### 7.1 Dedup key order
1. `nctId`
2. `pmid`
3. `doi`
4. source-scoped ID
5. normalized title key

### 7.2 Normalized title key spec
- Unicode normalize to `NFKD`.
- ASCII fold (strip diacritics), lowercase.
- replace non-alphanumeric runs with single space.
- collapse whitespace and trim.
- remove spaces to create compact key.
- keep first 60 chars of compact key.
- append year if available (`<key>_<year|na>`).

Placeholder token list (for merge precedence rule):
- `na`
- `n/a`
- `none`
- `unknown`
- `not reported`
- `null`
- empty string

### 7.3 Cross-source merge precedence
When conflicting fields exist:
1. Registry IDs/status from `ctgov`/`aact`.
2. Publication bibliographic fields from `pubmed` (then `europepmc`, then `openalex`).
3. Text fields use longest non-placeholder value with provenance retained.

## 8) Temporal Reproducibility

Every run must declare:
- `windowStartUtc`
- `windowEndUtc`
- `lookbackDays`
- `runExecutedAtUtc`

Default cadence:
- Weekly acquisition window closes Sunday 23:59:59 UTC.
- Monthly adjudication cut is first weekday of month in UTC (Monday-Friday only, no holiday-calendar exceptions).

## 9) Chart Reporting Protocol (mandatory)

For every chart:
1. Add one line under the chart that states:
   - what the chart shows,
   - what the latest result means.
2. Provide per-chart download (PNG minimum; SVG optional).
3. Provide "download all charts" where multiple charts exist.
4. Keep interpretation synchronized with latest payload timestamp.

## 10) Auditability and Run Metadata

Persist per run:
- `runId` (immutable UUID).
- `protocolVersion`.
- `queryPackVersion`.
- connector and code version/sha.
- query hash per source.
- counts per stage (identified/screened/excluded/included).
- exclusion reasons by count.
- dedup counts by key class.
- runtime schema mode and issue summary.
- chart export status.
- UTC timestamps for all phases.

Query hash specification (mandatory):
- Canonicalize query payload as UTF-8 JSON with sorted keys and no insignificant whitespace.
- Hash algorithm: SHA-256.
- Persist hex digest in `protocol-and-query-hashes.json`.

Primary artifacts:
- `reports/ops/source-health-latest.json`
- `reports/ops/refresh-health-latest.json`
- `public/data/review-dashboard.json`

Immutable run-scoped artifacts (required):
- `reports/ops/runs/<runId>/source-health.json`
- `reports/ops/runs/<runId>/refresh-health.json`
- `reports/ops/runs/<runId>/review-dashboard.json`
- `reports/ops/runs/<runId>/protocol-and-query-hashes.json`

`*-latest.json` files are pointers to the most recent successful run and must not replace immutable run-scoped artifacts.
