# Ranking Engine v2 — Multi-Factor Utility Model

**Date**: 2026-03-31
**Week 5 deliverable** of the 90-Day Execution Plan (March 30 - April 5, 2026)
**Status**: Design approved, awaiting implementation plan

## Summary

Replace the current 3-penalty ranking formula with a 5-factor weighted linear utility model. Change the opportunity unit from cardiology subcategory to intervention-class x endpoint-domain pairs. Add interactive sensitivity sliders to the discovery shell.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Opportunity granularity | Intervention-class x endpoint-domain pairs | Maps directly to systematic review questions; leverages existing matrix infrastructure |
| Scoring model | Weighted linear sum (5 factors, 0-100 each) | Transparent, explainable, plays well with sensitivity sliders |
| Sensitivity UI | Interactive sliders in the discovery shell | Reactive state store makes this natural; CLI export can be added later |
| Architecture | Separate `src/engine/ranking/` module | Follows existing engine module pattern; keeps factor logic independently testable |

## 1. Opportunity Builder

### Unit change

Current: one opportunity per cardiology subcategory (HF, AF, HTN, etc.).
New: one opportunity per (intervention-class, endpoint-domain) pair with at least 1 trial.

### Source

Built from `matrixSummary` (already computed by `buildMatrixSummary()` in `actions.js`). Each cell in the matrix with `count > 0` becomes one opportunity.

### Output shape

```js
{
  id: "opp_sglt2i__mace",
  interventionClassId: "sglt2i",
  interventionLabel: "SGLT2 Inhibitors",
  endpointDomainId: "mace",
  endpointLabel: "MACE",
  trialIds: ["trial_NCT03036124", ...],
  trialCount: 4,
  recentTrials: 2,
  totalEnrollment: 20725,
  yearRange: [2019, 2022],
  sourceCount: 3,
  factors: {
    clinicalImpact: 82,
    uncertaintyReduction: 71,
    feasibility: 85,
    freshness: 72,
    provenanceConfidence: 80,
  },
  compositeScore: 76.4,
  priority: "high",
}
```

### Edge cases

- Trials matching multiple intervention classes or endpoints generate separate opportunities for each pair.
- Cells with 0 trials are excluded (gaps but not yet opportunities).

## 2. Scoring Factors

Each factor is a pure function: `(opportunityData, globalContext) -> number [0-100]`.

### 2.1 Clinical Impact (default weight: 0.30)

How clinically important is this intervention-endpoint question?

- Base on total enrollment across linked trials (proxy for clinical significance).
- Endpoint domain boost: MACE/mortality +15, safety/other -10.
- Formula: `min(100, log2(totalEnrollment / 100) * 12 + endpointBoost)`

### 2.2 Uncertainty Reduction (default weight: 0.25)

How much would a new synthesis reduce uncertainty?

- Bell curve peaked at 3-8 trials (enough to synthesize, not saturated).
- Penalize if all trials are >5 years old or if >15 trials exist.
- Bell curve: `exp(-0.5 * ((trialCount - 5) / 4)^2) * 100`
- Recency multiplier: 1.0 if any trial in last 3 years, 0.6 if all trials >5 years old, linear interpolation between.
- Formula: `bellCurve * recencyMultiplier`

### 2.3 Methodological Feasibility (default weight: 0.20)

Can you actually run a good meta-analysis?

- Minimum 2 trials for pooling, boost for >=3.
- Penalize if year range >15 years (clinical practice drift).
- Boost for multi-source evidence (cross-validated across registries).
- Trial floor: 0 if count < 2, 60 if count == 2, 80 if count >= 3.
- Year range penalty: multiply by `max(0.5, 1.0 - max(0, yearSpan - 10) * 0.05)`.
- Source bonus: multiply by `1.0 + min(0.25, (sourceCount - 1) * 0.125)`.
- Formula: `trialFloor * yearRangePenalty * sourceBonus` (clamped to 0-100)

### 2.4 Evidence Freshness (default weight: 0.15)

How current is the evidence base?

- Based on most recent trial year relative to current year.
- Linear decay: current year = 100, -15 per year of age.
- Floor at 10.
- Formula: `max(10, 100 - (currentYear - maxTrialYear) * 15)`

### 2.5 Provenance Confidence (default weight: 0.10)

How trustworthy is the underlying data?

- Source diversity: 1 source = 50, 2 sources = 75, 3+ sources = 100.
- Penalize by 30 if current load used fallback (`provenance.usedFallback`).
- Formula: `sourceScore - fallbackPenalty`

### Composite Score

```
compositeScore = sum(factor_i * weight_i)  // weights sum to 1.0
```

Priority thresholds: >=75 = high, >=50 = moderate, <50 = low.

## 3. Sensitivity Panel

### State additions

```js
// Added to INITIAL_DISCOVERY_STATE
rankingWeights: {
  clinicalImpact: 0.30,
  uncertaintyReduction: 0.25,
  feasibility: 0.20,
  freshness: 0.15,
  provenanceConfidence: 0.10,
},
rankingSensitivityOpen: false,
```

### UI

- Collapsible panel toggled by a "Weights" button in the existing control bar.
- 5 labeled range sliders (0-100 each, representing relative weight).
- Weights auto-normalize to sum to 1.0 on every slider change.
- "Reset defaults" button restores original weights.
- Current weight percentages shown next to each slider label.
- Live re-rank: slider change -> `store.patchState` -> re-score -> re-render.

### Score breakdown in opportunity cards

Each opportunity in the sidebar shows composite score plus inline breakdown:

```
82 = CI:90 UR:78 F:85 EF:72 PC:80
```

### New action

`setRankingWeight(factorId, rawValue)` — normalizes all weights to sum to 1.0, re-scores all opportunities, patches state.

## 4. File Structure

### New files

```
src/engine/ranking/
  factor-computations.js   -- 5 pure factor functions
  composite-scorer.js      -- weighted sum, normalization, priority classification
  opportunity-builder.js   -- builds intervention x endpoint pairs from trials + matrix
  index.js                 -- public API: buildAndScoreOpportunities(trials, matrix, weights)
```

### Modified files

```
src/discovery/state.js          -- add rankingWeights + rankingSensitivityOpen
src/discovery/actions.js        -- replace buildOpportunitiesFromTrials() with ranking module call
src/discovery/ui/render.js      -- add weight sliders panel, score breakdown in opportunity cards
src/discovery/ui/handlers.js    -- add handler for weight slider changes + toggle
public/index.html               -- add "Weights" toggle button in control bar
```

### Tests

```
tests/ranking-factors.test.mjs       -- unit tests for each factor function
tests/composite-scorer.test.mjs      -- weighted sum, normalization, edge cases
tests/opportunity-builder.test.mjs   -- pair generation from matrix, deduplication
tests/ranking-integration.test.mjs   -- end-to-end: trials -> scored opportunities
```

### Key test cases

- Each factor at boundary values (0 trials, 1 trial, 100 trials).
- Weight normalization (all zeros -> equal weights, single factor at 100).
- Opportunities from matrix with no cells > 0 -> empty list.
- Deterministic output with same inputs.
- Composite score matches manual calculation for known fixture.
- Priority thresholds at boundaries (74.9 = moderate, 75.0 = high).

## 5. Backward Compatibility

- Existing `sortOpportunities()` continues to work (sorts by `score` field, which the new model still produces as `compositeScore` aliased to `score`).
- Sort modes (gap/recent/count) still apply on top of composite score.
- Sample data fallback still works (sample trials produce opportunities through the new builder).
- Existing views (Ayat, Network, Treemap, etc.) are unaffected — they read `trials` and `matrixSummary` from state, not opportunities.

## 6. Out of Scope

- CLI export of sensitivity report (can be added in a future sprint).
- Custom factor plugins or user-defined factors.
- Persistence of weight preferences (localStorage) — defer to a UX pass.
- Guideline-topic integration (Week 4 backlog item, separate concern).
