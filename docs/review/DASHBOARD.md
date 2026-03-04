# Blind Review Dashboard

Purpose:
- Provide a cycle-level adoption view for the 12-person blinded board.
- Track 11/12 gate status, dissent themes, and blockers in one screen.

Build data:
1. Ensure cycle summary JSON exists:
   - `npm run review:summary -- reports/review-cycles/<cycle_id>/scores.csv`
2. Build dashboard payload:
   - `npm run review:dashboard-data`

Open dashboard:
- Serve `public/` via a local static server and open:
  - `public/review-dashboard.html`

Generated artifact:
- `public/data/review-dashboard.json`

Input sources:
- `reports/review-cycles/*-summary.json`
- `reports/review-cycles/<cycle_id>/scores.csv` (or `scores_sample_filled.csv`)

Latest-cycle metrics rendered:
- Gate pass/fail and switch distribution
- Average rubric scores
- Top dissent themes (notes + required improvements)
- Critical blockers (`not_yet`, method-validity <=2, transparency <=2)
