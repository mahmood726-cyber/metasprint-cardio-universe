# Contracts

Canonical contracts for the spin-off discovery/universe engine.

Schemas:
- `schemas/trial-record.v1.schema.json`
- `schemas/universe-normalized-trial.v1.schema.js`
- `schemas/cluster.v1.schema.json`
- `schemas/provenance.v1.schema.json`
- `schemas/graph-entity.v1.schema.json`
- `schemas/graph-edge.v1.schema.json`
- `schemas/graph-dataset.v1.schema.json`

Examples:
- `examples/graph_dataset.example.json`

Type declarations:
- `types/index.d.ts`

Validation command:
- `npm run validate:fixtures`
- `npm run validate:graph-suite`

Design goals:
- Strict external boundaries.
- Deterministic, auditable IDs and references.
- Explicit provenance links for every scored cluster.
- Graph integrity enforcement (no duplicate IDs, no self loops, no dangling edges, no orphan entities).
