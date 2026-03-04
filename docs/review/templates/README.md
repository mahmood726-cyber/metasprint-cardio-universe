# Review Templates

Templates in this folder:
- `reviewers_template.csv`: board member roster and roles.
- `opportunities_template.csv`: opportunity pack for blinded cycle.
- `cycle_scoring_template.csv`: per-reviewer decision and scoring grid.
- `disagreement_log_template.csv`: structured dissent capture.

Workflow:
1. Copy templates into `reports/review-cycles/<cycle_id>/`.
2. Fill scores.
3. Run adoption summary script.
4. Rebuild dashboard payload with `npm run review:dashboard-data`.
