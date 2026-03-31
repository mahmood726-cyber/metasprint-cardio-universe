# Explainability and Trust Surfaces — Design Spec

**Date**: 2026-03-31
**Week 6 deliverable** of the 90-Day Execution Plan (April 6-12, 2026)
**Status**: Design approved, awaiting implementation plan

## Summary

Add per-opportunity explanation panels with factor contribution visualizations, provenance drill-through links for every component metric, and a three-tier confidence labeling policy. Every ranking score becomes fully inspectable.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Explanation panel location | Inline expansion in sidebar | Matches existing expand-to-show-trials pattern, keeps user in context |
| Confidence labeling | Three-tier badge on cards, per-factor flags in expanded view | Clean scannable cards, granular detail on demand |
| Provenance drill-through | Factor derivation text + trial source links | Complete audit chain: score -> formula -> trials -> registry |
| Architecture | Separate `src/engine/explainability/` module | Testable in isolation, reusable by future QA audit script |

## 1. Confidence Classifier

Pure function: `classifyConfidence(opportunity, globalContext) -> { tier, tierLabel, perFactor }`.

### Input

A scored opportunity object (as produced by the ranking engine v2).

### Output

```js
{
  tier: "high",
  tierLabel: "High confidence",
  perFactor: {
    clinicalImpact:       { status: "real", note: null },
    uncertaintyReduction: { status: "real", note: null },
    feasibility:          { status: "real", note: null },
    freshness:            { status: "imputed", note: "No year data — defaulted to floor (10)" },
    provenanceConfidence: { status: "degraded", note: "Fallback source used" },
  }
}
```

### Status detection rules

| Factor | Status | Condition |
|--------|--------|-----------|
| clinicalImpact | imputed | `totalEnrollment === 0` |
| uncertaintyReduction | imputed | `trialCount === 0` |
| feasibility | imputed | `trialCount < 2` (function returns 0) |
| freshness | imputed | `yearRange[1]` is null or not finite |
| provenanceConfidence | degraded | `usedFallback === true` in global context |

All other cases are `"real"`.

### Tier classification

- **High**: 0 non-real factors
- **Moderate**: 1-2 non-real factors
- **Low**: 3+ non-real factors

### Global context

The `usedFallback` flag comes from the opportunity's provenance context. Since this is stored at the state level (not per-opportunity), the classifier accepts an optional `globalContext` parameter:

```js
classifyConfidence(opportunity, globalContext) -> { tier, tierLabel, perFactor }
```

Where `globalContext = { usedFallback: boolean }`.

## 2. Factor Explainer

Pure function: `explainFactor(factorId, opportunity, factorScore, trials) -> { text, trialRefs[] }`.

### Output

```js
{
  text: "Clinical Impact: 82 = log2(20725 / 100) x 12 + 15 (MACE boost). 4 trials, 20,725 enrolled.",
  trialRefs: [
    { trialId: "t1", label: "NCT03036124", href: "https://clinicaltrials.gov/study/NCT03036124", year: 2019 },
    { trialId: "t2", label: "NCT03057977", href: "https://pubmed.ncbi.nlm.nih.gov/...", year: 2020 },
  ]
}
```

### Derivation text per factor

| Factor | Text pattern |
|--------|-------------|
| clinicalImpact | `"{score} = log2({enrollment} / 100) x 12 + {boost} ({domain} boost). {trialCount} trials, {enrollment} enrolled."` |
| uncertaintyReduction | `"{score} = bell curve at {trialCount} trials (peak 5) x {recencyMult} recency. {recentTrials} of {trialCount} in last 3y."` |
| feasibility | `"{score} = base {trialBase} x {yearPenalty} year-range x {sourceBonus} multi-source. {trialCount} trials, {yearSpan}y span, {sourceCount} sources."` |
| freshness | `"{score} = 100 - {age} x 15. Most recent trial: {maxYear}."` |
| provenanceConfidence | `"{score} = {sourceBase} ({sourceCount} source(s)) - {penalty} fallback penalty."` |

### Trial reference resolution

For each `trialId` in the opportunity's `trialIds` array, resolve against the full trial list:
- **Label priority**: NCT ID > PMID > DOI > trialId fallback
- **Href**: `https://clinicaltrials.gov/study/{nctId}` or `https://pubmed.ncbi.nlm.nih.gov/{pmid}/` or `https://doi.org/{doi}` or null
- **Year**: trial's `year` field

The `trials` parameter is the full trial array from state, used for lookup. The function builds a Map internally for O(1) access.

### Intermediate value computation

The function recomputes intermediate values from the opportunity data (enrollment, trialCount, yearRange, sourceCount) to show in the derivation text. It does NOT call the factor functions — it formats the same inputs using the same formulas for display purposes.

Intermediate values per factor:
- clinicalImpact: `enrollment`, `boost` (from ENDPOINT_BOOSTS), `domain` label
- uncertaintyReduction: `trialCount`, `recentTrials`, `recencyMult` (1.0 or 0.6)
- feasibility: `trialBase` (60 or 80), `yearPenalty`, `sourceBonus`, `yearSpan`
- freshness: `age` (currentYear - maxYear), `maxYear`
- provenanceConfidence: `sourceBase` (50/75/100), `sourceCount`, `penalty` (0 or 30)

## 3. Explanation Panel UI

### Confidence badge on opportunity cards

Added next to the existing priority badge (e.g., `HIGH GAP`):
- Green badge: `HIGH CONFIDENCE`
- Amber badge: `MODERATE CONFIDENCE`
- Red badge: `LOW CONFIDENCE`

### Expanded explanation panel

Renders inside the existing opportunity `<details>` expansion, below the trial list. Structure:

1. **Canvas mini bar chart** — 5 horizontal bars (one per factor), each 0-100, colored by confidence status:
   - Green (`#16a34a`): real
   - Amber (`#d97706`): imputed
   - Red (`#dc2626`): degraded
   - 280px wide, ~100px tall
   - Drawn via `<canvas>` with `ctx.fillRect()` — no Plotly dependency
   - Labels on the left (abbreviation), score on the right

2. **Factor derivation list** — 5 collapsible `<details>` rows:
   - Summary line: factor name + score + status icon (checkmark for real, warning triangle for imputed/degraded)
   - Expanded: derivation text + linked trials with source URLs
   - Trial links use `target="_blank" rel="noopener noreferrer"`

### CSS additions

```
.confidence-badge          — inline badge next to priority badge
.confidence-badge.high     — green background
.confidence-badge.moderate — amber background
.confidence-badge.low      — red background
.explain-canvas            — the mini bar chart canvas
.factor-row                — collapsible factor detail row
.factor-row summary        — factor name + score + status icon
.factor-derivation         — derivation text styling
.factor-trials             — trial reference list within factor
.status-icon               — checkmark or warning icon (text-based, no images)
```

## 4. File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/engine/explainability/confidence-classifier.js` | `classifyConfidence(opportunity, globalContext)` |
| `src/engine/explainability/factor-explainer.js` | `explainFactor(factorId, opportunity, factorScore, trials)` |
| `src/engine/explainability/index.js` | Public API re-exports |
| `tests/confidence-classifier.test.mjs` | Tier classification + per-factor status tests |
| `tests/factor-explainer.test.mjs` | Derivation text + trial ref generation tests |

### Modified files

| File | Change |
|------|--------|
| `src/discovery/ui/render.js` | Add confidence badge on cards, canvas bar chart, factor derivation list in expanded panel |
| `public/index.html` | Add CSS for confidence badges, factor bars, derivation rows, status icons |

## 5. Test Coverage

### confidence-classifier.test.mjs

- All 5 factors real data -> tier "high"
- 1 factor imputed -> tier "moderate"
- 2 factors imputed -> tier "moderate"
- 3+ factors imputed -> tier "low"
- Zero enrollment -> clinicalImpact status "imputed"
- Zero trialCount -> uncertaintyReduction status "imputed"
- trialCount 1 -> feasibility status "imputed"
- Null yearRange -> freshness status "imputed"
- usedFallback true -> provenanceConfidence status "degraded"
- All null/zero opportunity -> all imputed, tier "low"
- tierLabel matches tier string

### factor-explainer.test.mjs

- clinicalImpact derivation text contains enrollment value and boost
- uncertaintyReduction text contains trial count and recency multiplier
- feasibility text contains trial base, year span, source count
- freshness text contains max year and age
- provenanceConfidence text contains source count and penalty
- trialRefs resolves NCT ID with correct CT.gov URL
- trialRefs resolves PMID with correct PubMed URL
- trialRefs resolves DOI with correct doi.org URL
- trialRefs falls back to trialId when no standard ID
- Empty trialIds -> empty trialRefs array
- trialRefs includes year from trial data

## 6. Backward Compatibility

- Opportunity cards continue to render without explanation panels if `classifyConfidence` returns unexpected values (defensive rendering).
- The existing score breakdown line (`82 = CI:90 UR:78 F:85 EF:72 PC:80`) remains — the explanation panel supplements it, doesn't replace it.
- Existing `<details>` trial list expansion is preserved. The explanation section is appended after it.

## 7. Out of Scope

- Headless QA audit script (deferred to Week 9 benchmark harness — `classifyConfidence` is callable then).
- Provenance stitch cross-source info (deferred to Week 7 dedup adjudication).
- Factor contribution waterfall chart (the mini bar chart is sufficient for 320px sidebar).
- Persistence of expanded/collapsed state (trivial, not worth the complexity).
