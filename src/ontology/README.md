# Cardio Ontology v1

Intervention dictionary:
- `intervention-dictionary.js`

Endpoint ontology:
- `endpoint-ontology.js`

Mapper utilities:
- `index.js`

Usage:
- `mapInterventionTerm(text)` -> matched intervention classes.
- `mapEndpointTerm(text)` -> matched endpoint IDs/domains.
- `enrichTrialWithOntologySignals(trial)` -> adds `interventionClassIds` and `endpointIds`.

Validation:
- `npm run validate:ontology`

Outputs:
- `reports/ontology/coverage-latest.json`
- `reports/ontology/unknown-term-queue-latest.json`
- `reports/ontology/unknown-term-queue.csv`
