# Owner RACI (90 Days)

Program roles:
- Program Lead
- Data Lead
- Methods Lead
- UX Lead
- QA Lead

RACI legend:
- R: Responsible
- A: Accountable
- C: Consulted
- I: Informed

## Workstream RACI

| Workstream | Program Lead | Data Lead | Methods Lead | UX Lead | QA Lead |
|---|---|---|---|---|---|
| Connector resilience and refresh reliability | C | A/R | I | I | C |
| Identity graph and dedup adjudication | C | A/R | C | I | C |
| Provenance completeness and trust checks | C | R | C | I | A |
| Cardio ontology and endpoint harmonization | I | C | A/R | I | C |
| Ranking model and sensitivity | C | C | A/R | C | C |
| Discovery UX views and workflow speed | C | I | C | A/R | C |
| Benchmark CI and quality gates | I | C | C | I | A/R |
| Blinded board cycles and adoption gate | C | I | A/R | I | C |
| Release go/no-go decision | A/R | C | C | C | C |

## Weekly accountability checklist

Every Monday, owners must update:
- `docs/operations/WEEKLY_EXECUTION_TRACKER.csv`
- `docs/operations/KPI_SCORECARD_90D_TEMPLATE.csv`
- `docs/operations/RISK_REGISTER_90D.csv`

If a milestone misses date or acceptance criteria:
- Program Lead opens a corrective-action entry within 24 hours.
- Owner posts mitigation and revised due date in same tracker row.

Operational ownership map:
- `docs/operations/OWNER_DIRECTORY.md`

Additional mandatory cadence:
- Weekly: `npm run ops:runtime-slo`
- Weekly: `npm run ops:doc-sync`
- Quarterly: `npm run ops:quarterly-drill`
