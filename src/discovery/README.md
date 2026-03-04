# Discovery Module (Phase 1)

This folder contains the modularized Discovery runtime shell.

Modules:
- `state.js`: initial state for discovery domain.
- `actions.js`: state transitions, connector loading, fallback logic, and opportunity ranking.
- `ui/render.js`: DOM rendering via safe node creation and state-driven button/view sync.
- `ui/handlers.js`: delegated event handling using `data-action`.
- `data/sample-data.js`: seed dataset for shell and demos.

Data sources:
- `sample`: deterministic local baseline.
- `ctgov`: ClinicalTrials.gov connector (`src/data/connectors/ctgov.js`).
- `aact`: AACT proxy connector (`src/data/connectors/aact.js`).
- `pubmed`: PubMed E-utilities connector with keyed/non-keyed rate limits.
- `openalex`: OpenAlex works connector with request budgeting.
- `europepmc`: Europe PMC REST connector.

Identity signal:
- `actions.js` computes dedup summary each load and surfaces duplicate/cross-source cluster counts in the methodology panel.

Security posture:
- No inline event handlers in `public/` and `src/`.
- Delegated events only.
- Text-only rendering (no string-to-`innerHTML` rendering in this shell).
- Optional runtime normalized-record schema validation (AJV) at ingestion boundary:
  - `off` (default)
  - `warn` (collect schema issues without dropping rows)
  - `enforce` (drop schema-invalid rows)
  - Configure via `request.validationPolicy.normalizedTrialSchemaMode` or `METASPRINT_RUNTIME_SCHEMA_MODE`.
