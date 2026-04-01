# Dedup Adjudication UI — Design Spec

**Date**: 2026-04-01
**Week 7 deliverable** of the 90-Day Execution Plan (April 13-19, 2026)
**Status**: Design approved, awaiting implementation plan

## Summary

Replace the CSV-only dedup override workflow with a browser-based adjudication UI. Reviewers process the override queue interactively with force_merge/force_split/clear decisions, reviewer ID tagging, timestamps, and conflict detection for multi-reviewer disagreement.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Page location | Standalone `public/adjudication.html` | Different workflow/role from discovery; keeps concerns separate |
| Data persistence | Static files + localStorage | Offline-first, no server; session persistence prevents lost work |
| Multi-reviewer | Reviewer ID tagging + conflict flagging | Satisfies audit trail requirement; conflicts visible when same pair has different-reviewer decisions |
| Architecture | Separate `src/engine/adjudication/` module | Testable pure functions; thin runtime for rendering |

## 1. Queue Parser

Pure function: `parseOverrideQueue(csvText) -> QueuePair[]`.

### Input

Raw CSV text from `reports/dedup/override-queue.csv`. Header:
```
pair_id,left_trial_id,right_trial_id,left_source,right_source,score,recommended_decision,decision,reviewer,reason,status,generated_at
```

### Output

```js
[
  {
    pairId: "trial_NCT001::trial_NCT002",
    leftTrialId: "trial_NCT001",
    rightTrialId: "trial_NCT002",
    leftSource: "ctgov",
    rightSource: "aact",
    score: 0.87,
    recommendedDecision: "force_merge",
    status: "pending",
    generatedAt: "2026-03-01T12:34:07.471Z",
  },
]
```

The `decision`, `reviewer`, `reason` columns from the CSV are ignored on load — decisions come from localStorage/overrides.json instead.

Simple split-based parsing (no external CSV library). Machine-generated CSV has no quoting edge cases. Malformed rows are skipped.

## 2. Decision Store

Pure functions for managing adjudication decisions. Accepts a `storage` parameter (defaults to `localStorage` in browser, replaceable with in-memory Map for testing).

### Stored data structure

localStorage key: `metasprint_adjudication_decisions`

```js
{
  decisions: {
    "trial_NCT001::trial_NCT002": {
      pairId: "trial_NCT001::trial_NCT002",
      decision: "force_merge",
      reviewer: "mahmood",
      reason: "Same DAPA-HF trial across registries",
      decidedAt: "2026-04-15T10:30:00.000Z",
    },
  },
  reviewerId: "mahmood",
}
```

### Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `loadDecisions` | `(storage) -> { decisions, reviewerId }` | Read from storage, return decisions map + reviewer ID |
| `saveDecision` | `(pairId, decision, reviewer, reason, storage) -> void` | Add/update one decision with ISO timestamp, persist |
| `removeDecision` | `(pairId, storage) -> void` | Remove a decision (undo), persist |
| `setReviewerId` | `(id, storage) -> void` | Persist default reviewer ID |
| `getReviewerId` | `(storage) -> string` | Read persisted reviewer ID |
| `detectConflicts` | `(existingDecisions, importedDecisions) -> ConflictPair[]` | Find pairs where 2+ distinct reviewer IDs made different decisions |
| `exportOverridesJson` | `(decisions) -> { forceMerge, forceSplit }` | Convert decisions to existing `overrides.json` schema. `clear` decisions are excluded (they remove overrides). |
| `importOverridesJson` | `(json, existingDecisions) -> { merged, conflicts }` | Merge imported overrides into current decisions. Return merged map + conflict pairs. |

### Conflict detection

A conflict occurs when the same `pairId` has decisions from 2+ distinct `reviewer` values with different `decision` types. `detectConflicts` returns:

```js
[
  {
    pairId: "trial_NCT001::trial_NCT002",
    existing: { reviewer: "mahmood", decision: "force_merge", decidedAt: "..." },
    imported: { reviewer: "sarah", decision: "force_split", decidedAt: "..." },
  },
]
```

For v1, the decision store is single-writer (latest decision wins for a given pairId). Conflicts are detected when importing another reviewer's `overrides.json` — the import preserves the reviewer field from the imported data, making disagreements visible.

### Export format

`exportOverridesJson` produces output matching the existing `reports/dedup/overrides.json` schema:

```js
{
  forceMerge: [
    { leftTrialId: "...", rightTrialId: "...", decision: "force_merge", reason: "...", reviewer: "...", decidedAt: "..." },
  ],
  forceSplit: [
    { leftTrialId: "...", rightTrialId: "...", decision: "force_split", reason: "...", reviewer: "...", decidedAt: "..." },
  ],
}
```

The existing `pairKey` function from `src/engine/identity/overrides.js` is reused for consistent key generation.

## 3. Adjudication UI

### Page structure (`public/adjudication.html`)

**Header bar:**
- Title: "MetaSprint Cardio Universe — Dedup Adjudication"
- Reviewer ID text input (persisted to localStorage on change)
- Stats line: "X pending / Y decided / Z conflicts"
- Buttons: "Export overrides.json" (download), "Import overrides.json" (file input)

**Filter tabs:**
- **All** — full queue
- **Pending** — pairs without a decision
- **Decided** — pairs with a decision
- **Conflicts** — pairs where 2+ reviewer IDs disagree

**Queue table:**

| Column | Content |
|--------|---------|
| # | Row number |
| Score | Similarity score, color-coded: >0.9 green, 0.7-0.9 amber, <0.7 red |
| Left Trial | Trial ID (clickable link to registry where available) |
| Right Trial | Trial ID (clickable link to registry) |
| Sources | e.g., "ctgov / aact" |
| Recommended | Machine-recommended decision from dedup engine |
| Decision | Current human decision + reviewer tag + timestamp |
| Actions | Merge / Split / Clear / Undo buttons |

**Expandable detail row:** Clicking a row expands to show:
- Left trial title + right trial title side by side
- Reason text input (saved with decision)
- Which fields matched in the similarity comparison

### Runtime (`public/adjudication-runtime.js`)

Thin entry point:
1. Fetch `reports/dedup/override-queue.csv` and parse with `parseOverrideQueue`
2. Load existing decisions from localStorage via `loadDecisions`
3. Render the table
4. Wire up event handlers (action buttons, filter tabs, reviewer ID, export/import)
5. On decision change → `saveDecision` → re-render stats and affected row

### Trial links

Same resolution as the existing discovery shell:
- NCT ID → `https://clinicaltrials.gov/study/{nctId}`
- PMID → `https://pubmed.ncbi.nlm.nih.gov/{pmid}/`
- DOI → `https://doi.org/{doi}`

Trial IDs in the queue start with `trial_` prefix — strip it for display if the remainder looks like an NCT ID.

### Link from discovery shell

Add an "Adjudication" link button in `public/index.html` control bar (next to existing "Review Charts" link):
```html
<a class="btn" href="./adjudication.html">Adjudication</a>
```

## 4. File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/engine/adjudication/queue-parser.js` | `parseOverrideQueue(csvText)` — CSV to structured pairs |
| `src/engine/adjudication/decision-store.js` | CRUD, conflict detection, export/import |
| `src/engine/adjudication/index.js` | Public API re-exports |
| `tests/queue-parser.test.mjs` | CSV parsing tests |
| `tests/decision-store.test.mjs` | Decision CRUD, conflicts, export format |
| `public/adjudication.html` | Standalone adjudication page |
| `public/adjudication-runtime.js` | Thin entry point |

### Modified files

| File | Change |
|------|--------|
| `public/index.html` | Add "Adjudication" link in control bar |

## 5. Test Coverage

### queue-parser.test.mjs

- Parse valid CSV with all columns → correct QueuePair objects
- Empty CSV (header only) → empty array
- Missing optional columns → defaults applied
- Numeric score parsed correctly as float
- Malformed rows (wrong column count) skipped gracefully
- Whitespace in values trimmed

### decision-store.test.mjs

- `saveDecision` stores decision with reviewer + ISO timestamp
- `loadDecisions` returns previously saved decisions
- `removeDecision` deletes a decision
- `loadDecisions` on empty storage returns empty map
- `setReviewerId` / `getReviewerId` persists and reads reviewer ID
- `detectConflicts` finds same-pair different-reviewer disagreements
- `detectConflicts` returns empty when all decisions from same reviewer
- `detectConflicts` returns empty when no decisions exist
- `exportOverridesJson` produces `{ forceMerge: [...], forceSplit: [...] }`
- `exportOverridesJson` excludes `clear` decisions
- `exportOverridesJson` splits pairId into leftTrialId and rightTrialId
- `importOverridesJson` merges incoming decisions, preserves existing
- `importOverridesJson` returns conflicts when reviewers disagree on same pair

### Storage abstraction for testing

Decision store functions accept a `storage` parameter. In tests, pass a simple in-memory implementation:

```js
function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}
```

## 6. Backward Compatibility

- Existing CLI workflow (`npm run dedup:identity`, `npm run dedup:apply-overrides`) is unchanged.
- The exported `overrides.json` from the UI matches the existing schema exactly — drop-in replacement.
- The queue CSV format is not modified. The UI reads it as-is.
- Existing `src/engine/identity/overrides.js` functions (`pairKey`, `normalizeOverrides`, `buildOverrideMap`) are reused, not duplicated.

## 7. Out of Scope

- Real-time multi-user collaboration (would need a server).
- Automatic re-running of dedup pipeline from the browser (still requires `npm run dedup:identity`).
- Similarity breakdown visualization in detail rows (deferred — would need the similarity engine to expose per-field scores).
- Keyboard shortcuts for Merge/Split/Clear (can be added in a UX pass).
