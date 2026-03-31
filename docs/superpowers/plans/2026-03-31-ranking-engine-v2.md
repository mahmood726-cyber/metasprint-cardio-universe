# Ranking Engine v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-penalty ranking formula with a 5-factor weighted linear utility model, change opportunity granularity to intervention-class x endpoint-domain pairs, and add interactive sensitivity sliders to the discovery shell.

**Architecture:** New `src/engine/ranking/` module with pure functions for factor computation, composite scoring, and opportunity building. The discovery layer (`actions.js`, `render.js`, `handlers.js`, `state.js`) integrates the module and adds weight sliders. All factor functions are independently testable with no DOM dependency.

**Tech Stack:** Node.js (ESM), node:test runner, Plotly.js (existing), delegated event handlers (existing `attachActionDelegates` pattern).

**Spec:** `docs/superpowers/specs/2026-03-31-ranking-engine-v2-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/engine/ranking/factor-computations.js` | 5 pure factor functions (clinicalImpact, uncertaintyReduction, feasibility, freshness, provenanceConfidence) |
| `src/engine/ranking/composite-scorer.js` | Weighted sum, weight normalization, priority classification |
| `src/engine/ranking/opportunity-builder.js` | Build intervention x endpoint pairs from trials + matrixSummary |
| `src/engine/ranking/index.js` | Public API: `buildAndScoreOpportunities(trials, matrixSummary, weights, globalContext)` |
| `tests/ranking-factors.test.mjs` | Unit tests for each factor function |
| `tests/composite-scorer.test.mjs` | Weighted sum, normalization, edge cases |
| `tests/opportunity-builder.test.mjs` | Pair generation from matrix |
| `tests/ranking-integration.test.mjs` | End-to-end: trials -> scored opportunities |

### Modified files
| File | Change |
|------|--------|
| `src/discovery/state.js` | Add `rankingWeights` and `rankingSensitivityOpen` to initial state |
| `src/discovery/actions.js` | Replace `buildOpportunitiesFromTrials()` with ranking module call; add `setRankingWeight` and `toggleSensitivityPanel` actions |
| `src/discovery/ui/handlers.js` | Add handlers for `toggle-weights`, `set-weight`, `reset-weights` |
| `src/discovery/ui/render.js` | Add `renderWeightsPanel()`, update `renderOpportunityList()` with score breakdown |
| `public/index.html` | Add "Weights" toggle button in control bar |

---

### Task 1: Factor Computations — Tests

**Files:**
- Create: `tests/ranking-factors.test.mjs`

- [ ] **Step 1: Write factor computation tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clinicalImpact,
  uncertaintyReduction,
  feasibility,
  freshness,
  provenanceConfidence,
} from '../src/engine/ranking/factor-computations.js';

// --- clinicalImpact ---

test('clinicalImpact returns 0 for 0 enrollment', () => {
  const result = clinicalImpact({ totalEnrollment: 0, endpointDomainId: 'other' });
  assert.equal(typeof result, 'number');
  assert.ok(result >= 0 && result <= 100, `out of range: ${result}`);
});

test('clinicalImpact boosts MACE endpoint', () => {
  const mace = clinicalImpact({ totalEnrollment: 5000, endpointDomainId: 'mace' });
  const other = clinicalImpact({ totalEnrollment: 5000, endpointDomainId: 'other' });
  assert.ok(mace > other, `mace ${mace} should exceed other ${other}`);
});

test('clinicalImpact boosts mortality endpoint', () => {
  const mortality = clinicalImpact({ totalEnrollment: 5000, endpointDomainId: 'mortality' });
  const safety = clinicalImpact({ totalEnrollment: 5000, endpointDomainId: 'safety' });
  assert.ok(mortality > safety, `mortality ${mortality} should exceed safety ${safety}`);
});

test('clinicalImpact scales with enrollment', () => {
  const small = clinicalImpact({ totalEnrollment: 200, endpointDomainId: 'hf' });
  const large = clinicalImpact({ totalEnrollment: 20000, endpointDomainId: 'hf' });
  assert.ok(large > small, `large ${large} should exceed small ${small}`);
});

test('clinicalImpact clamps to 100', () => {
  const result = clinicalImpact({ totalEnrollment: 1e9, endpointDomainId: 'mace' });
  assert.ok(result <= 100, `should clamp: ${result}`);
});

// --- uncertaintyReduction ---

test('uncertaintyReduction peaks around 5 trials', () => {
  const at5 = uncertaintyReduction({ trialCount: 5, recentTrials: 3 });
  const at1 = uncertaintyReduction({ trialCount: 1, recentTrials: 1 });
  const at20 = uncertaintyReduction({ trialCount: 20, recentTrials: 5 });
  assert.ok(at5 > at1, `5 trials ${at5} should exceed 1 trial ${at1}`);
  assert.ok(at5 > at20, `5 trials ${at5} should exceed 20 trials ${at20}`);
});

test('uncertaintyReduction penalizes zero recent trials', () => {
  const recent = uncertaintyReduction({ trialCount: 5, recentTrials: 3 });
  const stale = uncertaintyReduction({ trialCount: 5, recentTrials: 0 });
  assert.ok(recent > stale, `recent ${recent} should exceed stale ${stale}`);
});

test('uncertaintyReduction returns 0-100', () => {
  for (const count of [0, 1, 3, 5, 10, 50]) {
    const result = uncertaintyReduction({ trialCount: count, recentTrials: Math.min(count, 2) });
    assert.ok(result >= 0 && result <= 100, `out of range for count=${count}: ${result}`);
  }
});

// --- feasibility ---

test('feasibility returns 0 for fewer than 2 trials', () => {
  assert.equal(feasibility({ trialCount: 0, yearRange: [2020, 2020], sourceCount: 1 }), 0);
  assert.equal(feasibility({ trialCount: 1, yearRange: [2020, 2020], sourceCount: 1 }), 0);
});

test('feasibility gives base score for 2 trials', () => {
  const result = feasibility({ trialCount: 2, yearRange: [2020, 2022], sourceCount: 1 });
  assert.ok(result >= 50 && result <= 70, `expected ~60: ${result}`);
});

test('feasibility boosts for 3+ trials', () => {
  const two = feasibility({ trialCount: 2, yearRange: [2020, 2022], sourceCount: 1 });
  const three = feasibility({ trialCount: 3, yearRange: [2020, 2022], sourceCount: 1 });
  assert.ok(three > two, `3 trials ${three} should exceed 2 trials ${two}`);
});

test('feasibility penalizes wide year range', () => {
  const narrow = feasibility({ trialCount: 5, yearRange: [2018, 2023], sourceCount: 2 });
  const wide = feasibility({ trialCount: 5, yearRange: [2000, 2023], sourceCount: 2 });
  assert.ok(narrow > wide, `narrow ${narrow} should exceed wide ${wide}`);
});

test('feasibility boosts multi-source', () => {
  const single = feasibility({ trialCount: 5, yearRange: [2020, 2023], sourceCount: 1 });
  const multi = feasibility({ trialCount: 5, yearRange: [2020, 2023], sourceCount: 3 });
  assert.ok(multi > single, `multi ${multi} should exceed single ${single}`);
});

// --- freshness ---

test('freshness returns 100 for current year', () => {
  const now = new Date().getFullYear();
  assert.equal(freshness({ maxYear: now }), 100);
});

test('freshness decays 15 per year', () => {
  const now = new Date().getFullYear();
  assert.equal(freshness({ maxYear: now - 1 }), 85);
  assert.equal(freshness({ maxYear: now - 2 }), 70);
});

test('freshness floors at 10', () => {
  assert.equal(freshness({ maxYear: 1990 }), 10);
});

test('freshness returns 10 for null maxYear', () => {
  assert.equal(freshness({ maxYear: null }), 10);
});

// --- provenanceConfidence ---

test('provenanceConfidence returns 50 for single source', () => {
  assert.equal(provenanceConfidence({ sourceCount: 1, usedFallback: false }), 50);
});

test('provenanceConfidence returns 75 for 2 sources', () => {
  assert.equal(provenanceConfidence({ sourceCount: 2, usedFallback: false }), 75);
});

test('provenanceConfidence returns 100 for 3+ sources', () => {
  assert.equal(provenanceConfidence({ sourceCount: 3, usedFallback: false }), 100);
  assert.equal(provenanceConfidence({ sourceCount: 5, usedFallback: false }), 100);
});

test('provenanceConfidence penalizes fallback by 30', () => {
  assert.equal(provenanceConfidence({ sourceCount: 3, usedFallback: true }), 70);
  assert.equal(provenanceConfidence({ sourceCount: 1, usedFallback: true }), 20);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/ranking-factors.test.mjs`
Expected: FAIL — module `../src/engine/ranking/factor-computations.js` not found.

- [ ] **Step 3: Commit test file**

```bash
cd /c/Projects/metasprint-cardio-universe
git add tests/ranking-factors.test.mjs
git commit -m "test: add factor computation tests for ranking engine v2"
```

---

### Task 2: Factor Computations — Implementation

**Files:**
- Create: `src/engine/ranking/factor-computations.js`

- [ ] **Step 1: Implement factor functions**

```js
const ENDPOINT_BOOSTS = {
  mace: 15,
  mortality: 15,
  hf: 5,
  renal: 5,
  safety: -10,
  frailty: 0,
  other: -10,
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function clinicalImpact({ totalEnrollment, endpointDomainId }) {
  const enrollment = Number.isFinite(totalEnrollment) ? Math.max(0, totalEnrollment) : 0;
  const boost = ENDPOINT_BOOSTS[endpointDomainId] ?? 0;
  if (enrollment <= 0) return clamp(boost);
  const base = Math.log2(enrollment / 100) * 12;
  return clamp(Math.round(base + boost));
}

export function uncertaintyReduction({ trialCount, recentTrials }) {
  const count = Number.isFinite(trialCount) ? Math.max(0, trialCount) : 0;
  const recent = Number.isFinite(recentTrials) ? Math.max(0, recentTrials) : 0;

  // Bell curve peaked at 5, width 4
  const bell = Math.exp(-0.5 * Math.pow((count - 5) / 4, 2)) * 100;

  // Recency multiplier: 1.0 if any recent, 0.6 if none
  const recencyMultiplier = count === 0 ? 0.6 : recent > 0 ? 1.0 : 0.6;

  return clamp(Math.round(bell * recencyMultiplier));
}

export function feasibility({ trialCount, yearRange, sourceCount }) {
  const count = Number.isFinite(trialCount) ? Math.max(0, trialCount) : 0;
  if (count < 2) return 0;

  // Trial floor
  const trialBase = count >= 3 ? 80 : 60;

  // Year range penalty
  const years = Array.isArray(yearRange) && yearRange.length === 2
    ? Math.abs((yearRange[1] ?? 0) - (yearRange[0] ?? 0))
    : 0;
  const yearPenalty = Math.max(0.5, 1.0 - Math.max(0, years - 10) * 0.05);

  // Source bonus
  const sources = Number.isFinite(sourceCount) ? Math.max(1, sourceCount) : 1;
  const sourceBonus = 1.0 + Math.min(0.25, (sources - 1) * 0.125);

  return clamp(Math.round(trialBase * yearPenalty * sourceBonus));
}

export function freshness({ maxYear }) {
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(maxYear)) return 10;
  const age = currentYear - maxYear;
  return clamp(Math.round(100 - age * 15), 10, 100);
}

export function provenanceConfidence({ sourceCount, usedFallback }) {
  const sources = Number.isFinite(sourceCount) ? Math.max(0, sourceCount) : 0;
  let base;
  if (sources >= 3) base = 100;
  else if (sources === 2) base = 75;
  else base = 50;
  const penalty = usedFallback ? 30 : 0;
  return clamp(base - penalty);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/ranking-factors.test.mjs`
Expected: All 18 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/ranking/factor-computations.js
git commit -m "feat: implement 5 ranking factor computation functions"
```

---

### Task 3: Composite Scorer — Tests

**Files:**
- Create: `tests/composite-scorer.test.mjs`

- [ ] **Step 1: Write composite scorer tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWeights,
  compositeScore,
  classifyPriority,
  DEFAULT_WEIGHTS,
} from '../src/engine/ranking/composite-scorer.js';

// --- normalizeWeights ---

test('normalizeWeights sums to 1.0', () => {
  const weights = { a: 30, b: 25, c: 20, d: 15, e: 10 };
  const normalized = normalizeWeights(weights);
  const sum = Object.values(normalized).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1.0) < 1e-9, `sum should be 1.0: ${sum}`);
});

test('normalizeWeights preserves ratios', () => {
  const normalized = normalizeWeights({ a: 60, b: 40 });
  assert.ok(Math.abs(normalized.a - 0.6) < 1e-9);
  assert.ok(Math.abs(normalized.b - 0.4) < 1e-9);
});

test('normalizeWeights handles all zeros as equal weights', () => {
  const normalized = normalizeWeights({ a: 0, b: 0, c: 0 });
  const expected = 1 / 3;
  for (const value of Object.values(normalized)) {
    assert.ok(Math.abs(value - expected) < 1e-9, `expected ~${expected}: ${value}`);
  }
});

test('normalizeWeights handles single factor at 100', () => {
  const normalized = normalizeWeights({ a: 100, b: 0, c: 0 });
  assert.ok(Math.abs(normalized.a - 1.0) < 1e-9);
  assert.ok(Math.abs(normalized.b - 0.0) < 1e-9);
});

// --- compositeScore ---

test('compositeScore computes weighted sum', () => {
  const factors = { a: 100, b: 50 };
  const weights = { a: 0.6, b: 0.4 };
  const result = compositeScore(factors, weights);
  assert.ok(Math.abs(result - 80) < 0.1, `expected 80: ${result}`);
});

test('compositeScore returns 0 for all-zero factors', () => {
  const factors = { a: 0, b: 0 };
  const weights = { a: 0.5, b: 0.5 };
  assert.equal(compositeScore(factors, weights), 0);
});

test('compositeScore ignores weights for missing factors', () => {
  const factors = { a: 80 };
  const weights = { a: 0.5, b: 0.5 };
  const result = compositeScore(factors, weights);
  assert.ok(Math.abs(result - 40) < 0.1, `expected 40: ${result}`);
});

// --- classifyPriority ---

test('classifyPriority returns high for >=75', () => {
  assert.equal(classifyPriority(75), 'high');
  assert.equal(classifyPriority(100), 'high');
});

test('classifyPriority returns moderate for 50-74.9', () => {
  assert.equal(classifyPriority(50), 'moderate');
  assert.equal(classifyPriority(74.9), 'moderate');
});

test('classifyPriority returns low for <50', () => {
  assert.equal(classifyPriority(49.9), 'low');
  assert.equal(classifyPriority(0), 'low');
});

// --- DEFAULT_WEIGHTS ---

test('DEFAULT_WEIGHTS sums to 1.0', () => {
  const sum = Object.values(DEFAULT_WEIGHTS).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1.0) < 1e-9, `sum should be 1.0: ${sum}`);
});

test('DEFAULT_WEIGHTS has exactly 5 factors', () => {
  assert.equal(Object.keys(DEFAULT_WEIGHTS).length, 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/composite-scorer.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit test file**

```bash
cd /c/Projects/metasprint-cardio-universe
git add tests/composite-scorer.test.mjs
git commit -m "test: add composite scorer tests for ranking engine v2"
```

---

### Task 4: Composite Scorer — Implementation

**Files:**
- Create: `src/engine/ranking/composite-scorer.js`

- [ ] **Step 1: Implement composite scorer**

```js
export const DEFAULT_WEIGHTS = {
  clinicalImpact: 0.30,
  uncertaintyReduction: 0.25,
  feasibility: 0.20,
  freshness: 0.15,
  provenanceConfidence: 0.10,
};

export function normalizeWeights(rawWeights) {
  const entries = Object.entries(rawWeights);
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, Number(value) || 0), 0);

  if (total === 0) {
    const equal = 1 / entries.length;
    return Object.fromEntries(entries.map(([key]) => [key, equal]));
  }

  return Object.fromEntries(
    entries.map(([key, value]) => [key, Math.max(0, Number(value) || 0) / total]),
  );
}

export function compositeScore(factors, weights) {
  let sum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const factor = Number(factors[key]) || 0;
    sum += factor * weight;
  }
  return Math.round(sum * 10) / 10;
}

export function classifyPriority(score) {
  if (score >= 75) return 'high';
  if (score >= 50) return 'moderate';
  return 'low';
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/composite-scorer.test.mjs`
Expected: All 10 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/ranking/composite-scorer.js
git commit -m "feat: implement composite scorer with weight normalization"
```

---

### Task 5: Opportunity Builder — Tests

**Files:**
- Create: `tests/opportunity-builder.test.mjs`

- [ ] **Step 1: Write opportunity builder tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOpportunities } from '../src/engine/ranking/opportunity-builder.js';

function makeTrial({ trialId, year, enrollment, source, subcategoryId }) {
  return { trialId, year, enrollment, source, subcategoryId, nctId: null, pmid: null, doi: null, title: `Trial ${trialId}` };
}

function makeMatrix(rows, columns) {
  return { rows, columns, totalTrials: 0, matchedTrials: 0 };
}

function makeRow(id, label, trialCount, trialIds, cells) {
  return { id, label, trialCount, trialIds, cells };
}

function makeCol(id, label, trialCount) {
  return { id, label, trialCount };
}

test('buildOpportunities returns empty for empty matrix', () => {
  const result = buildOpportunities([], makeMatrix([], []));
  assert.deepEqual(result, []);
});

test('buildOpportunities creates one opportunity per nonzero cell', () => {
  const trials = [
    makeTrial({ trialId: 't1', year: 2023, enrollment: 1000, source: 'ctgov', subcategoryId: 'hf' }),
    makeTrial({ trialId: 't2', year: 2024, enrollment: 2000, source: 'aact', subcategoryId: 'hf' }),
  ];

  const cols = [makeCol('mace', 'MACE', 2), makeCol('mortality', 'Mortality', 0)];
  const rows = [
    makeRow('sglt2i', 'SGLT2 Inhibitors', 2, ['t1', 't2'], [
      { id: 'mace', count: 2, trialIds: ['t1', 't2'] },
      { id: 'mortality', count: 0, trialIds: [] },
    ]),
  ];

  const result = buildOpportunities(trials, makeMatrix(rows, cols));
  assert.equal(result.length, 1, 'should have 1 opportunity (1 nonzero cell)');
  assert.equal(result[0].interventionClassId, 'sglt2i');
  assert.equal(result[0].endpointDomainId, 'mace');
  assert.equal(result[0].trialCount, 2);
  assert.deepEqual(result[0].trialIds, ['t1', 't2']);
});

test('buildOpportunities computes enrollment and year range from trials', () => {
  const trials = [
    makeTrial({ trialId: 't1', year: 2019, enrollment: 4744, source: 'ctgov', subcategoryId: 'hf' }),
    makeTrial({ trialId: 't2', year: 2022, enrollment: 6263, source: 'aact', subcategoryId: 'hf' }),
  ];

  const cols = [makeCol('hf', 'Heart Failure', 2)];
  const rows = [
    makeRow('sglt2i', 'SGLT2 Inhibitors', 2, ['t1', 't2'], [
      { id: 'hf', count: 2, trialIds: ['t1', 't2'] },
    ]),
  ];

  const result = buildOpportunities(trials, makeMatrix(rows, cols));
  assert.equal(result[0].totalEnrollment, 4744 + 6263);
  assert.deepEqual(result[0].yearRange, [2019, 2022]);
});

test('buildOpportunities counts distinct sources', () => {
  const trials = [
    makeTrial({ trialId: 't1', year: 2023, enrollment: 100, source: 'ctgov', subcategoryId: 'hf' }),
    makeTrial({ trialId: 't2', year: 2023, enrollment: 100, source: 'aact', subcategoryId: 'hf' }),
    makeTrial({ trialId: 't3', year: 2023, enrollment: 100, source: 'ctgov', subcategoryId: 'hf' }),
  ];

  const cols = [makeCol('mace', 'MACE', 3)];
  const rows = [
    makeRow('sglt2i', 'SGLT2i', 3, ['t1', 't2', 't3'], [
      { id: 'mace', count: 3, trialIds: ['t1', 't2', 't3'] },
    ]),
  ];

  const result = buildOpportunities(trials, makeMatrix(rows, cols));
  assert.equal(result[0].sourceCount, 2);
});

test('buildOpportunities counts recent trials within 3 years', () => {
  const now = new Date().getFullYear();
  const trials = [
    makeTrial({ trialId: 't1', year: now, enrollment: 100, source: 'ctgov', subcategoryId: 'hf' }),
    makeTrial({ trialId: 't2', year: now - 5, enrollment: 100, source: 'ctgov', subcategoryId: 'hf' }),
  ];

  const cols = [makeCol('mace', 'MACE', 2)];
  const rows = [
    makeRow('sglt2i', 'SGLT2i', 2, ['t1', 't2'], [
      { id: 'mace', count: 2, trialIds: ['t1', 't2'] },
    ]),
  ];

  const result = buildOpportunities(trials, makeMatrix(rows, cols));
  assert.equal(result[0].recentTrials, 1);
});

test('buildOpportunities generates stable deterministic IDs', () => {
  const trials = [makeTrial({ trialId: 't1', year: 2023, enrollment: 100, source: 'ctgov', subcategoryId: 'hf' })];
  const cols = [makeCol('mace', 'MACE', 1)];
  const rows = [
    makeRow('sglt2i', 'SGLT2i', 1, ['t1'], [{ id: 'mace', count: 1, trialIds: ['t1'] }]),
  ];

  const result = buildOpportunities(trials, makeMatrix(rows, cols));
  assert.equal(result[0].id, 'opp_sglt2i__mace');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/opportunity-builder.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit test file**

```bash
cd /c/Projects/metasprint-cardio-universe
git add tests/opportunity-builder.test.mjs
git commit -m "test: add opportunity builder tests for ranking engine v2"
```

---

### Task 6: Opportunity Builder — Implementation

**Files:**
- Create: `src/engine/ranking/opportunity-builder.js`

- [ ] **Step 1: Implement opportunity builder**

```js
export function buildOpportunities(trials, matrixSummary) {
  const rows = Array.isArray(matrixSummary?.rows) ? matrixSummary.rows : [];
  const columns = Array.isArray(matrixSummary?.columns) ? matrixSummary.columns : [];

  if (rows.length === 0 || columns.length === 0) return [];

  const trialById = new Map();
  for (const trial of trials) {
    if (trial?.trialId) trialById.set(String(trial.trialId), trial);
  }

  const currentYear = new Date().getFullYear();
  const opportunities = [];

  for (const row of rows) {
    for (const cell of row.cells ?? []) {
      const count = Number(cell.count ?? 0);
      if (count <= 0) continue;

      const trialIds = Array.isArray(cell.trialIds) ? cell.trialIds.map(String) : [];
      const linkedTrials = trialIds.map((id) => trialById.get(id)).filter(Boolean);

      let totalEnrollment = 0;
      let minYear = Infinity;
      let maxYear = -Infinity;
      let recentTrials = 0;
      const sourceSet = new Set();

      for (const trial of linkedTrials) {
        totalEnrollment += Number.isFinite(trial.enrollment) ? trial.enrollment : 0;
        const year = Number(trial.year);
        if (Number.isFinite(year)) {
          if (year < minYear) minYear = year;
          if (year > maxYear) maxYear = year;
          if (year >= currentYear - 3) recentTrials += 1;
        }
        if (trial.source) sourceSet.add(String(trial.source));
      }

      const colMeta = columns.find((col) => col.id === cell.id);

      opportunities.push({
        id: `opp_${row.id}__${cell.id}`,
        interventionClassId: row.id,
        interventionLabel: row.label ?? row.id,
        endpointDomainId: cell.id,
        endpointLabel: colMeta?.label ?? cell.id,
        trialIds,
        trialCount: trialIds.length,
        recentTrials,
        totalEnrollment,
        yearRange: Number.isFinite(minYear) && Number.isFinite(maxYear) ? [minYear, maxYear] : [null, null],
        sourceCount: sourceSet.size,
      });
    }
  }

  return opportunities;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/opportunity-builder.test.mjs`
Expected: All 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/ranking/opportunity-builder.js
git commit -m "feat: implement opportunity builder (intervention x endpoint pairs)"
```

---

### Task 7: Ranking Module Public API — Tests + Implementation

**Files:**
- Create: `src/engine/ranking/index.js`
- Create: `tests/ranking-integration.test.mjs`

- [ ] **Step 1: Write integration tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAndScoreOpportunities } from '../src/engine/ranking/index.js';
import { DEFAULT_WEIGHTS } from '../src/engine/ranking/composite-scorer.js';

function makeTrial({ trialId, year, enrollment, source }) {
  return { trialId, year, enrollment, source, subcategoryId: 'hf', nctId: null, pmid: null, doi: null, title: `Trial ${trialId}` };
}

const TRIALS = [
  makeTrial({ trialId: 't1', year: 2019, enrollment: 4744, source: 'ctgov' }),
  makeTrial({ trialId: 't2', year: 2020, enrollment: 3730, source: 'aact' }),
  makeTrial({ trialId: 't3', year: 2022, enrollment: 6263, source: 'ctgov' }),
];

const MATRIX = {
  rows: [
    {
      id: 'sglt2i',
      label: 'SGLT2 Inhibitors',
      trialCount: 3,
      trialIds: ['t1', 't2', 't3'],
      cells: [
        { id: 'mace', count: 2, trialIds: ['t1', 't2'] },
        { id: 'hf', count: 3, trialIds: ['t1', 't2', 't3'] },
      ],
    },
  ],
  columns: [
    { id: 'mace', label: 'MACE', trialCount: 2 },
    { id: 'hf', label: 'Heart Failure', trialCount: 3 },
  ],
  totalTrials: 3,
  matchedTrials: 3,
};

const GLOBAL_CONTEXT = { usedFallback: false };

test('buildAndScoreOpportunities returns scored opportunities', () => {
  const result = buildAndScoreOpportunities(TRIALS, MATRIX, DEFAULT_WEIGHTS, GLOBAL_CONTEXT);
  assert.equal(result.length, 2);

  for (const opp of result) {
    assert.equal(typeof opp.compositeScore, 'number');
    assert.ok(opp.compositeScore >= 0 && opp.compositeScore <= 100);
    assert.ok(['high', 'moderate', 'low'].includes(opp.priority));
    assert.equal(typeof opp.factors, 'object');
    assert.equal(typeof opp.factors.clinicalImpact, 'number');
    assert.equal(typeof opp.factors.uncertaintyReduction, 'number');
    assert.equal(typeof opp.factors.feasibility, 'number');
    assert.equal(typeof opp.factors.freshness, 'number');
    assert.equal(typeof opp.factors.provenanceConfidence, 'number');
  }
});

test('buildAndScoreOpportunities sorts by composite score descending', () => {
  const result = buildAndScoreOpportunities(TRIALS, MATRIX, DEFAULT_WEIGHTS, GLOBAL_CONTEXT);
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i - 1].compositeScore >= result[i].compositeScore,
      `result[${i - 1}].compositeScore ${result[i - 1].compositeScore} < result[${i}].compositeScore ${result[i].compositeScore}`);
  }
});

test('buildAndScoreOpportunities produces score alias for backward compat', () => {
  const result = buildAndScoreOpportunities(TRIALS, MATRIX, DEFAULT_WEIGHTS, GLOBAL_CONTEXT);
  for (const opp of result) {
    assert.equal(opp.score, opp.compositeScore, 'score should alias compositeScore');
  }
});

test('buildAndScoreOpportunities returns empty for empty trials', () => {
  const result = buildAndScoreOpportunities([], { rows: [], columns: [], totalTrials: 0, matchedTrials: 0 }, DEFAULT_WEIGHTS, GLOBAL_CONTEXT);
  assert.deepEqual(result, []);
});

test('buildAndScoreOpportunities respects custom weights', () => {
  const onlyClinical = { clinicalImpact: 1.0, uncertaintyReduction: 0, feasibility: 0, freshness: 0, provenanceConfidence: 0 };
  const onlyFreshness = { clinicalImpact: 0, uncertaintyReduction: 0, feasibility: 0, freshness: 1.0, provenanceConfidence: 0 };

  const clinical = buildAndScoreOpportunities(TRIALS, MATRIX, onlyClinical, GLOBAL_CONTEXT);
  const fresh = buildAndScoreOpportunities(TRIALS, MATRIX, onlyFreshness, GLOBAL_CONTEXT);

  // Both should produce results but with different scores
  assert.equal(clinical.length, fresh.length);
  // The HF opportunity has more trials/enrollment so clinical score should differ
  const clinicalHf = clinical.find((o) => o.endpointDomainId === 'hf');
  const freshHf = fresh.find((o) => o.endpointDomainId === 'hf');
  assert.ok(clinicalHf.compositeScore !== freshHf.compositeScore,
    'different weights should produce different scores');
});

test('buildAndScoreOpportunities deterministic on repeated calls', () => {
  const a = buildAndScoreOpportunities(TRIALS, MATRIX, DEFAULT_WEIGHTS, GLOBAL_CONTEXT);
  const b = buildAndScoreOpportunities(TRIALS, MATRIX, DEFAULT_WEIGHTS, GLOBAL_CONTEXT);
  assert.deepEqual(
    a.map((o) => ({ id: o.id, score: o.compositeScore })),
    b.map((o) => ({ id: o.id, score: o.compositeScore })),
  );
});
```

- [ ] **Step 2: Implement the public API**

```js
import { buildOpportunities } from './opportunity-builder.js';
import {
  clinicalImpact,
  uncertaintyReduction,
  feasibility,
  freshness,
  provenanceConfidence,
} from './factor-computations.js';
import { compositeScore, classifyPriority } from './composite-scorer.js';

export { DEFAULT_WEIGHTS, normalizeWeights } from './composite-scorer.js';

function scoreOpportunity(opp, weights, globalContext) {
  const factors = {
    clinicalImpact: clinicalImpact({
      totalEnrollment: opp.totalEnrollment,
      endpointDomainId: opp.endpointDomainId,
    }),
    uncertaintyReduction: uncertaintyReduction({
      trialCount: opp.trialCount,
      recentTrials: opp.recentTrials,
    }),
    feasibility: feasibility({
      trialCount: opp.trialCount,
      yearRange: opp.yearRange,
      sourceCount: opp.sourceCount,
    }),
    freshness: freshness({
      maxYear: Array.isArray(opp.yearRange) ? opp.yearRange[1] : null,
    }),
    provenanceConfidence: provenanceConfidence({
      sourceCount: opp.sourceCount,
      usedFallback: Boolean(globalContext?.usedFallback),
    }),
  };

  const score = compositeScore(factors, weights);
  const priority = classifyPriority(score);

  return { ...opp, factors, compositeScore: score, score, priority };
}

export function buildAndScoreOpportunities(trials, matrixSummary, weights, globalContext) {
  const rawOpportunities = buildOpportunities(trials, matrixSummary);

  const scored = rawOpportunities.map((opp) => scoreOpportunity(opp, weights, globalContext));
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return scored;
}
```

- [ ] **Step 3: Run all ranking tests**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/ranking-factors.test.mjs tests/composite-scorer.test.mjs tests/opportunity-builder.test.mjs tests/ranking-integration.test.mjs`
Expected: All tests PASS (~40 tests).

- [ ] **Step 4: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/ranking/index.js tests/ranking-integration.test.mjs
git commit -m "feat: implement ranking module public API with integration tests"
```

---

### Task 8: Update Discovery State

**Files:**
- Modify: `src/discovery/state.js`

- [ ] **Step 1: Add ranking state fields**

In `src/discovery/state.js`, add `rankingWeights` and `rankingSensitivityOpen` to `INITIAL_DISCOVERY_STATE`:

```js
import { DEFAULT_WEIGHTS } from '../engine/ranking/index.js';

export const INITIAL_DISCOVERY_STATE = {
  universeLoaded: false,
  loading: false,
  lastRefreshIso: null,
  currentView: 'ayat',
  sortMode: 'gap',
  dataSource: 'sample',
  lastError: null,
  provenance: {
    requestedSource: 'sample',
    loadedSource: 'sample',
    requestedLimit: 100,
    loadedCount: 0,
    usedFallback: false,
    fallbackReason: null,
  },
  trials: [],
  opportunities: [],
  matrixSummary: {
    rows: [],
    columns: [],
    totalTrials: 0,
    matchedTrials: 0,
  },
  dedupSummary: {
    duplicateClusterCount: 0,
    edgeCount: 0,
    multiSourceClusterCount: 0,
  },
  kpis: {
    totalTrials: 0,
    subcategories: 0,
    recentTrials3y: 0,
    highPriorityClusters: 0,
  },
  methodologyGate: {
    label: 'Pending',
    detail: 'Run at least one loaded cycle before evaluation.',
    status: 'moderate',
  },
  rankingWeights: { ...DEFAULT_WEIGHTS },
  rankingSensitivityOpen: false,
};
```

- [ ] **Step 2: Run existing tests to ensure no regression**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All existing tests PASS (38+).

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/discovery/state.js
git commit -m "feat: add ranking weights and sensitivity panel state"
```

---

### Task 9: Wire Ranking Module into Actions

**Files:**
- Modify: `src/discovery/actions.js`

- [ ] **Step 1: Replace opportunity building with ranking module**

At the top of `src/discovery/actions.js`, add the import:

```js
import { buildAndScoreOpportunities, normalizeWeights, DEFAULT_WEIGHTS } from '../engine/ranking/index.js';
```

Replace the `buildOpportunitiesFromTrials` function call inside `loadUniverse`'s success path (around line 338). Change this block:

```js
      const computedOpportunities = buildOpportunitiesFromTrials(trials);
      const opportunities = sortOpportunities(
        computedOpportunities.length > 0 ? computedOpportunities : SAMPLE_OPPORTUNITIES,
        currentSortMode,
      );
```

To:

```js
      const currentWeights = store.getState().rankingWeights ?? DEFAULT_WEIGHTS;
      const globalContext = { usedFallback: usedFallbackTrials };
      const computedOpportunities = buildAndScoreOpportunities(trials, matrixSummary, currentWeights, globalContext);
      const opportunities = sortOpportunities(
        computedOpportunities.length > 0 ? computedOpportunities : SAMPLE_OPPORTUNITIES,
        currentSortMode,
      );
```

Apply the same change in the error/fallback path (around line 386):

```js
      const fallbackOpportunities = sortOpportunities(
        buildOpportunitiesFromTrials(fallbackTrials),
        store.getState().sortMode,
      );
```

To:

```js
      const fallbackWeights = store.getState().rankingWeights ?? DEFAULT_WEIGHTS;
      const fallbackGlobalCtx = { usedFallback: true };
      const fallbackMatrixSummary = buildMatrixSummary(fallbackTrials);
      const fallbackScoredOpportunities = buildAndScoreOpportunities(fallbackTrials, fallbackMatrixSummary, fallbackWeights, fallbackGlobalCtx);
      const fallbackOpportunities = sortOpportunities(
        fallbackScoredOpportunities.length > 0 ? fallbackScoredOpportunities : SAMPLE_OPPORTUNITIES,
        store.getState().sortMode,
      );
```

Then add two new actions to the returned object:

```js
    setRankingWeight(factorId, rawValue) {
      const currentWeights = { ...store.getState().rankingWeights };
      currentWeights[factorId] = Math.max(0, Number(rawValue) || 0);
      const normalized = normalizeWeights(currentWeights);

      const { trials, matrixSummary, provenance, sortMode } = store.getState();
      const globalContext = { usedFallback: Boolean(provenance?.usedFallback) };
      const scored = buildAndScoreOpportunities(trials, matrixSummary, normalized, globalContext);
      const opportunities = sortOpportunities(scored, sortMode);

      store.patchState({ rankingWeights: normalized, opportunities }, 'weights:set');
    },

    resetRankingWeights() {
      const weights = { ...DEFAULT_WEIGHTS };
      const { trials, matrixSummary, provenance, sortMode } = store.getState();
      const globalContext = { usedFallback: Boolean(provenance?.usedFallback) };
      const scored = buildAndScoreOpportunities(trials, matrixSummary, weights, globalContext);
      const opportunities = sortOpportunities(scored, sortMode);

      store.patchState({ rankingWeights: weights, opportunities }, 'weights:reset');
    },

    toggleSensitivityPanel() {
      const open = !store.getState().rankingSensitivityOpen;
      store.patchState({ rankingSensitivityOpen: open }, 'sensitivity:toggle');
    },
```

- [ ] **Step 2: Run all tests**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS. The existing `discovery-actions.test.mjs` should still pass because the store state shape is backward-compatible and `sortOpportunities` still works on the `score` field.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/discovery/actions.js
git commit -m "feat: wire ranking module into discovery actions"
```

---

### Task 10: Add Weights Toggle Button to HTML

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add Weights button and sensitivity panel container**

In `public/index.html`, add a "Weights" button at the end of the control bar (after the "Review Charts" link on line 428):

```html
      <button class="btn" data-action="toggle-weights" aria-expanded="false">Weights</button>
```

Add a new `<div>` immediately after the closing `</div>` of the controls div (after line 429) and before the tabs div:

```html
    <div class="weights-panel" id="weightsPanel" hidden>
      <div class="weights-grid" id="weightsGrid"></div>
      <button class="btn" data-action="reset-weights" type="button">Reset defaults</button>
    </div>
```

- [ ] **Step 2: Add CSS for the weights panel**

Add this CSS before the closing `</style>` tag (before line 406):

```css
    .weights-panel {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: #f8fafb;
    }

    .weights-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }

    .weight-control {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .weight-control label {
      font-size: 0.76rem;
      color: var(--muted);
      font-weight: 600;
    }

    .weight-control .weight-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .weight-control input[type="range"] {
      flex: 1;
      accent-color: var(--primary);
    }

    .weight-control .weight-pct {
      font-size: 0.74rem;
      font-weight: 700;
      color: var(--text);
      min-width: 36px;
      text-align: right;
    }

    .score-breakdown {
      font-size: 0.68rem;
      color: #2e4f74;
      font-family: monospace;
      margin-top: 2px;
    }
```

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add public/index.html
git commit -m "feat: add weights toggle button and sensitivity panel markup"
```

---

### Task 11: Add Handlers for Weight Controls

**Files:**
- Modify: `src/discovery/ui/handlers.js`

- [ ] **Step 1: Add weight-related handlers**

Replace the full contents of `src/discovery/ui/handlers.js` with:

```js
import { listConnectors } from '../../data/connectors/index.js';
import { attachActionDelegates } from '../../core/delegates.js';

const ALLOWED_VIEWS = new Set(['ayat', 'network', 'treemap', 'timeline', 'matrix', 'gapscatter', 'pipeline']);
const ALLOWED_SORTS = new Set(['gap', 'recent', 'count']);
const ALLOWED_SOURCES = new Set(['sample', ...listConnectors()]);
const ALLOWED_FACTORS = new Set([
  'clinicalImpact', 'uncertaintyReduction', 'feasibility', 'freshness', 'provenanceConfidence',
]);

export function attachDiscoveryHandlers(root, actions) {
  const detach = attachActionDelegates(root, {
    'load-universe': () => actions.loadUniverse(),
    'refresh-universe': () => actions.refreshUniverse(),
    'switch-view': (trigger) => {
      const view = trigger.dataset.view;
      if (!ALLOWED_VIEWS.has(view)) return;
      actions.switchView(view);
    },
    'sort-opportunities': (trigger) => {
      const sort = trigger.dataset.sort;
      if (!ALLOWED_SORTS.has(sort)) return;
      actions.sortOpportunities(sort);
    },
    'set-data-source': async (trigger) => {
      const source = trigger.dataset.source;
      if (!ALLOWED_SOURCES.has(source)) return;
      const changed = actions.setDataSource(source);
      if (!changed) return;
      await actions.loadUniverse();
    },
    'toggle-weights': () => actions.toggleSensitivityPanel(),
    'reset-weights': () => actions.resetRankingWeights(),
  });

  // Range input handler for weight sliders (not button-based, so needs direct listener)
  const onWeightInput = (event) => {
    const input = event.target;
    if (!input || input.type !== 'range' || !input.dataset.factor) return;
    const factorId = input.dataset.factor;
    if (!ALLOWED_FACTORS.has(factorId)) return;
    actions.setRankingWeight(factorId, Number(input.value));
  };

  root.addEventListener('input', onWeightInput);

  return () => {
    if (typeof detach === 'function') detach();
    root.removeEventListener('input', onWeightInput);
  };
}
```

- [ ] **Step 2: Run all tests**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/discovery/ui/handlers.js
git commit -m "feat: add weight slider and toggle handlers"
```

---

### Task 12: Update Render — Weights Panel + Score Breakdown

**Files:**
- Modify: `src/discovery/ui/render.js`

- [ ] **Step 1: Add the weight panel render function**

Add this function after `renderMethodologyGate` (after line 803) in `src/discovery/ui/render.js`:

```js
const FACTOR_LABELS = {
  clinicalImpact: 'Clinical Impact',
  uncertaintyReduction: 'Uncertainty Reduction',
  feasibility: 'Feasibility',
  freshness: 'Freshness',
  provenanceConfidence: 'Provenance Confidence',
};

const FACTOR_ABBREVS = {
  clinicalImpact: 'CI',
  uncertaintyReduction: 'UR',
  feasibility: 'F',
  freshness: 'EF',
  provenanceConfidence: 'PC',
};

function renderWeightsPanel(state) {
  const panel = byId('weightsPanel');
  const grid = byId('weightsGrid');
  const toggle = document.querySelector('[data-action="toggle-weights"]');
  if (!panel || !grid) return;

  const open = Boolean(state.rankingSensitivityOpen);
  panel.hidden = !open;
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open) return;

  clearNode(grid);
  const weights = state.rankingWeights ?? {};

  for (const [factorId, label] of Object.entries(FACTOR_LABELS)) {
    const weight = Number(weights[factorId]) || 0;
    const pct = Math.round(weight * 100);

    const control = el('div', { className: 'weight-control' });
    const labelEl = el('label', { text: label, attrs: { for: `weight-${factorId}` } });

    const row = el('div', { className: 'weight-row' });
    const input = el('input', {
      attrs: {
        type: 'range',
        id: `weight-${factorId}`,
        min: '0',
        max: '100',
        value: String(pct),
        'data-factor': factorId,
        'aria-label': `${label} weight`,
      },
    });
    const pctLabel = el('span', { className: 'weight-pct', text: `${pct}%` });

    append(row, input, pctLabel);
    append(control, labelEl, row);
    grid.appendChild(control);
  }
}
```

- [ ] **Step 2: Update renderOpportunityList to show score breakdown**

In `renderOpportunityList`, after the `rationale` element is created (around line 205), add the score breakdown. Replace this line:

```js
    append(li, title, meta, formulaNode, rationale);
```

With:

```js
    // Score factor breakdown
    const factors = item.factors;
    let breakdownText = '';
    if (factors && typeof factors === 'object') {
      const parts = Object.entries(FACTOR_ABBREVS)
        .map(([key, abbr]) => `${abbr}:${Math.round(Number(factors[key]) || 0)}`)
        .join(' ');
      breakdownText = `${Math.round(item.compositeScore ?? item.score)} = ${parts}`;
    }
    const breakdown = el('div', { className: 'score-breakdown', text: breakdownText });

    append(li, title, meta, formulaNode, rationale, breakdown);
```

- [ ] **Step 3: Call renderWeightsPanel from renderDiscovery**

In the `renderDiscovery` function (around line 824), add the call after `renderMethodologyGate(state)`:

```js
  renderWeightsPanel(state);
```

- [ ] **Step 4: Run all tests**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/discovery/ui/render.js
git commit -m "feat: render sensitivity sliders and score breakdown in opportunity cards"
```

---

### Task 13: Update KPI — High Priority Count from New Model

**Files:**
- Modify: `src/discovery/actions.js`

- [ ] **Step 1: Update computeKpis in actions.js**

In `src/discovery/actions.js`, in the `computeKpis` function (around line 64), change the subcategories line from:

```js
  const subcategories = new Set(trials.map((t) => t.subcategoryId ?? 'general')).size;
```

To:

```js
  const subcategories = new Set(
    opportunities.map((o) => o.interventionClassId ?? o.subcategoryId ?? 'general'),
  ).size;
```

This makes the KPI show distinct intervention classes rather than subcategories (more meaningful for the new model). The `highPriorityClusters` line already works because scored opportunities have a `priority` field — no change needed there.

- [ ] **Step 1b: Update KPI label in render.js**

In `src/discovery/ui/render.js`, in the `renderKpis` function (around line 123), change the label:

```js
    ['Subcategories', state.kpis.subcategories],
```

To:

```js
    ['Intervention Classes', state.kpis.subcategories],
```

- [ ] **Step 2: Run all tests**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/discovery/actions.js src/discovery/ui/render.js
git commit -m "feat: update KPIs for intervention-class granularity"
```

---

### Task 14: Full Test Suite + Manual Smoke Test

**Files:** None new.

- [ ] **Step 1: Run full test suite**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS (38 existing + ~40 new ranking tests = ~78 total).

- [ ] **Step 2: Verify test count**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test 2>&1 | tail -10`
Expected: `# pass` count >= 70, `# fail 0`.

- [ ] **Step 3: Open discovery shell for smoke test**

Open `public/index.html` in a browser (via local static server or file://). Verify:
1. Sample data loads and shows opportunities in sidebar with score breakdowns.
2. "Weights" button toggles the sensitivity panel.
3. Moving a slider live-updates the opportunity ranking.
4. "Reset defaults" restores original weights.
5. All 7 view tabs still render correctly.

- [ ] **Step 4: Final commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add -A
git commit -m "chore: ranking engine v2 complete — 5-factor model with sensitivity sliders"
```
