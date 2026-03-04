# Benchmark Packs

Benchmark pack baseline (week 1):
- `packs/v1/index.json` manifest
- curated packs:
  - `sglt2_hf_cardiorenal.v1.json`
  - `glp1_cv_outcomes.v1.json`
  - `antithrombotic_af_stroke.v1.json`
  - `hf_foundational_therapy.v1.json`
  - `ontology_entities.v1.json` (ontology coverage entities)
  - `ranking_judgments.v1.json` (non-proxy ranking judgments)

Generated baseline artifacts:
- `ingestion.json`
- `ranking.json`

Generation command:
- `npm run ops:baseline`

Ontology command:
- `npm run validate:ontology`

Live ingestion benchmark:
- `npm run benchmark:ingestion-live`
- output:
  - `ingestion-live.json`

Ranking benchmark:
- `npm run benchmark:ranking`
- outputs:
  - `ranking.json`
  - `ranking-eval-latest.json`

Dedup identity benchmark:
- `npm run benchmark:dedup-identity`
- outputs:
  - `dedup-identity.json`
  - `dedup-identity-eval-latest.json`
