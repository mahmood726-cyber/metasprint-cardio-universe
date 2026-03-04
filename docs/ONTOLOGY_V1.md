# Ontology v1 Delivery

Date: 2026-02-28

Delivered artifacts:
- Intervention dictionary v1:
  - `src/ontology/intervention-dictionary.js`
- Endpoint ontology v1:
  - `src/ontology/endpoint-ontology.js`
- Mapping utilities:
  - `src/ontology/index.js`
- Ontology benchmark entities:
  - `reports/benchmarks/packs/v1/ontology_entities.v1.json`
- Coverage validator:
  - `scripts/ontology/validate-ontology-coverage.mjs`

Acceptance checks:
- Coverage gate:
  - `npm run validate:ontology`
  - thresholds: `>=98%` mapped terms and `unknownTermCount<=0` on benchmark entities
- Mapping regression gate:
  - `npm run test:ontology-mappings`
  - verifies critical intervention/endpoint aliases and mixed-text extraction behavior
- Unknown-term queue:
  - `reports/ontology/unknown-term-queue.csv`
  - `reports/ontology/unknown-term-queue-latest.json`

Current baseline result (2026-02-28):
- Coverage: `100%` (`60/60`)
- Unknown queue terms: `0`
- Mapping regression: `7/7` checks passed

Operational notes:
- Normalized ontology signals (`interventionClassIds`, `endpointIds`) are now attached during trial normalization in:
  - `src/data/repository/universe-repository.js`
- Use unknown-term queue during weekly methods adjudication to decide whether to add new synonyms/classes/endpoints.
