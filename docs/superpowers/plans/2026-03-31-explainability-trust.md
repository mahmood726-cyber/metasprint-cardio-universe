# Explainability and Trust Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-opportunity explanation panels with confidence badges, factor bar charts, derivation text, and provenance drill-through links so every ranking score is fully inspectable.

**Architecture:** New `src/engine/explainability/` module with pure functions for confidence classification and factor explanation. The discovery render layer consumes these to add badges, canvas bar charts, and collapsible derivation rows inside existing opportunity cards.

**Tech Stack:** Node.js (ESM), node:test runner, Canvas 2D API (for mini bar charts), existing DOM helpers (`el`, `append`, `clearNode`).

**Spec:** `docs/superpowers/specs/2026-03-31-explainability-trust-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/engine/explainability/confidence-classifier.js` | `classifyConfidence(opportunity, globalContext)` — tier + per-factor status |
| `src/engine/explainability/factor-explainer.js` | `explainFactor(factorId, opportunity, factorScore, trials)` — derivation text + trial refs |
| `src/engine/explainability/index.js` | Public API re-exports |
| `tests/confidence-classifier.test.mjs` | Tier classification + per-factor status tests |
| `tests/factor-explainer.test.mjs` | Derivation text + trial ref generation tests |

### Modified files
| File | Change |
|------|--------|
| `src/discovery/ui/render.js` | Add confidence badge, canvas bar chart, factor derivation list in opportunity cards |
| `public/index.html` | Add CSS for confidence badges, factor bars, derivation rows, status icons |

---

### Task 1: Confidence Classifier — Tests

**Files:**
- Create: `tests/confidence-classifier.test.mjs`

- [ ] **Step 1: Write confidence classifier tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyConfidence } from '../src/engine/explainability/confidence-classifier.js';

function makeOpp({ totalEnrollment = 5000, trialCount = 5, yearRange = [2020, 2024], sourceCount = 2 } = {}) {
  return { totalEnrollment, trialCount, yearRange, sourceCount, recentTrials: 3 };
}

// --- tier classification ---

test('classifyConfidence returns high when all factors have real data', () => {
  const result = classifyConfidence(makeOpp(), { usedFallback: false });
  assert.equal(result.tier, 'high');
  assert.equal(result.tierLabel, 'High confidence');
  for (const factor of Object.values(result.perFactor)) {
    assert.equal(factor.status, 'real');
  }
});

test('classifyConfidence returns moderate for 1 non-real factor', () => {
  const result = classifyConfidence(makeOpp({ totalEnrollment: 0 }), { usedFallback: false });
  assert.equal(result.tier, 'moderate');
  assert.equal(result.perFactor.clinicalImpact.status, 'imputed');
});

test('classifyConfidence returns moderate for 2 non-real factors', () => {
  const result = classifyConfidence(makeOpp({ totalEnrollment: 0, yearRange: [null, null] }), { usedFallback: false });
  assert.equal(result.tier, 'moderate');
});

test('classifyConfidence returns low for 3+ non-real factors', () => {
  const result = classifyConfidence(makeOpp({ totalEnrollment: 0, trialCount: 0, yearRange: [null, null] }), { usedFallback: false });
  assert.equal(result.tier, 'low');
});

// --- per-factor status ---

test('clinicalImpact is imputed when totalEnrollment is 0', () => {
  const result = classifyConfidence(makeOpp({ totalEnrollment: 0 }), { usedFallback: false });
  assert.equal(result.perFactor.clinicalImpact.status, 'imputed');
  assert.ok(result.perFactor.clinicalImpact.note);
});

test('uncertaintyReduction is imputed when trialCount is 0', () => {
  const result = classifyConfidence(makeOpp({ trialCount: 0 }), { usedFallback: false });
  assert.equal(result.perFactor.uncertaintyReduction.status, 'imputed');
});

test('feasibility is imputed when trialCount < 2', () => {
  const result = classifyConfidence(makeOpp({ trialCount: 1 }), { usedFallback: false });
  assert.equal(result.perFactor.feasibility.status, 'imputed');
});

test('freshness is imputed when yearRange[1] is null', () => {
  const result = classifyConfidence(makeOpp({ yearRange: [null, null] }), { usedFallback: false });
  assert.equal(result.perFactor.freshness.status, 'imputed');
});

test('provenanceConfidence is degraded when usedFallback is true', () => {
  const result = classifyConfidence(makeOpp(), { usedFallback: true });
  assert.equal(result.perFactor.provenanceConfidence.status, 'degraded');
});

test('all factors imputed for empty opportunity returns low', () => {
  const result = classifyConfidence(
    { totalEnrollment: 0, trialCount: 0, yearRange: [null, null], sourceCount: 0, recentTrials: 0 },
    { usedFallback: true },
  );
  assert.equal(result.tier, 'low');
  const statuses = Object.values(result.perFactor).map((f) => f.status);
  assert.ok(statuses.every((s) => s !== 'real'), 'all should be non-real');
});

test('tierLabel matches tier', () => {
  assert.equal(classifyConfidence(makeOpp(), { usedFallback: false }).tierLabel, 'High confidence');
  assert.equal(classifyConfidence(makeOpp({ totalEnrollment: 0 }), { usedFallback: false }).tierLabel, 'Moderate confidence');
  assert.equal(
    classifyConfidence({ totalEnrollment: 0, trialCount: 0, yearRange: [null, null], sourceCount: 0, recentTrials: 0 }, { usedFallback: true }).tierLabel,
    'Low confidence',
  );
});

test('perFactor has exactly 5 entries', () => {
  const result = classifyConfidence(makeOpp(), { usedFallback: false });
  assert.equal(Object.keys(result.perFactor).length, 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/confidence-classifier.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit test file**

```bash
cd /c/Projects/metasprint-cardio-universe
git add tests/confidence-classifier.test.mjs
git commit -m "test: add confidence classifier tests for explainability"
```

---

### Task 2: Confidence Classifier — Implementation

**Files:**
- Create: `src/engine/explainability/confidence-classifier.js`

- [ ] **Step 1: Implement confidence classifier**

```js
const TIER_LABELS = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
};

function classifyFactor(factorId, opportunity, globalContext) {
  switch (factorId) {
    case 'clinicalImpact': {
      const enrollment = Number(opportunity?.totalEnrollment);
      if (!Number.isFinite(enrollment) || enrollment <= 0) {
        return { status: 'imputed', note: 'No enrollment data — defaulted to endpoint boost only' };
      }
      return { status: 'real', note: null };
    }
    case 'uncertaintyReduction': {
      const count = Number(opportunity?.trialCount);
      if (!Number.isFinite(count) || count <= 0) {
        return { status: 'imputed', note: 'No trials — defaulted to bell curve at 0' };
      }
      return { status: 'real', note: null };
    }
    case 'feasibility': {
      const count = Number(opportunity?.trialCount);
      if (!Number.isFinite(count) || count < 2) {
        return { status: 'imputed', note: 'Fewer than 2 trials — feasibility is 0' };
      }
      return { status: 'real', note: null };
    }
    case 'freshness': {
      const yearRange = opportunity?.yearRange;
      const maxYear = Array.isArray(yearRange) ? yearRange[1] : null;
      if (!Number.isFinite(maxYear)) {
        return { status: 'imputed', note: 'No year data — defaulted to floor (10)' };
      }
      return { status: 'real', note: null };
    }
    case 'provenanceConfidence': {
      if (globalContext?.usedFallback) {
        return { status: 'degraded', note: 'Fallback source used' };
      }
      return { status: 'real', note: null };
    }
    default:
      return { status: 'real', note: null };
  }
}

const FACTOR_IDS = [
  'clinicalImpact',
  'uncertaintyReduction',
  'feasibility',
  'freshness',
  'provenanceConfidence',
];

export function classifyConfidence(opportunity, globalContext) {
  const perFactor = {};
  let nonRealCount = 0;

  for (const factorId of FACTOR_IDS) {
    const result = classifyFactor(factorId, opportunity, globalContext);
    perFactor[factorId] = result;
    if (result.status !== 'real') nonRealCount += 1;
  }

  let tier;
  if (nonRealCount === 0) tier = 'high';
  else if (nonRealCount <= 2) tier = 'moderate';
  else tier = 'low';

  return {
    tier,
    tierLabel: TIER_LABELS[tier],
    perFactor,
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/confidence-classifier.test.mjs`
Expected: All 12 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/explainability/confidence-classifier.js
git commit -m "feat: implement confidence classifier for opportunity trust labeling"
```

---

### Task 3: Factor Explainer — Tests

**Files:**
- Create: `tests/factor-explainer.test.mjs`

- [ ] **Step 1: Write factor explainer tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { explainFactor } from '../src/engine/explainability/factor-explainer.js';

function makeOpp({
  totalEnrollment = 20725,
  trialCount = 4,
  recentTrials = 2,
  yearRange = [2019, 2024],
  sourceCount = 3,
  endpointDomainId = 'mace',
  trialIds = ['t1', 't2'],
} = {}) {
  return { totalEnrollment, trialCount, recentTrials, yearRange, sourceCount, endpointDomainId, trialIds };
}

function makeTrials() {
  return [
    { trialId: 't1', nctId: 'NCT03036124', pmid: null, doi: null, year: 2019, title: 'DAPA-HF' },
    { trialId: 't2', nctId: null, pmid: '33567890', doi: null, year: 2020, title: 'EMPEROR-Reduced' },
    { trialId: 't3', nctId: null, pmid: null, doi: '10.1234/test', year: 2022, title: 'DOI Trial' },
    { trialId: 't4', nctId: null, pmid: null, doi: null, year: 2023, title: 'No ID Trial' },
  ];
}

// --- clinicalImpact ---

test('clinicalImpact text contains enrollment and boost', () => {
  const result = explainFactor('clinicalImpact', makeOpp(), 82, makeTrials());
  assert.ok(result.text.includes('20725'), 'should contain enrollment');
  assert.ok(result.text.includes('MACE') || result.text.includes('mace'), 'should contain domain');
  assert.ok(result.text.includes('15'), 'should contain boost value');
});

// --- uncertaintyReduction ---

test('uncertaintyReduction text contains trial count and recency', () => {
  const result = explainFactor('uncertaintyReduction', makeOpp(), 78, makeTrials());
  assert.ok(result.text.includes('4'), 'should contain trial count');
  assert.ok(result.text.includes('2'), 'should contain recent trials');
});

// --- feasibility ---

test('feasibility text contains trial base, year span, source count', () => {
  const result = explainFactor('feasibility', makeOpp(), 85, makeTrials());
  assert.ok(result.text.includes('80'), 'should contain trial base for 4 trials');
  assert.ok(result.text.includes('5') || result.text.includes('year'), 'should reference year span');
  assert.ok(result.text.includes('3'), 'should contain source count');
});

// --- freshness ---

test('freshness text contains max year and age', () => {
  const result = explainFactor('freshness', makeOpp(), 70, makeTrials());
  assert.ok(result.text.includes('2024'), 'should contain max year');
});

// --- provenanceConfidence ---

test('provenanceConfidence text contains source count and penalty', () => {
  const result = explainFactor('provenanceConfidence', makeOpp(), 100, makeTrials());
  assert.ok(result.text.includes('3'), 'should contain source count');
  assert.ok(result.text.includes('0') || result.text.includes('penalty'), 'should reference penalty');
});

// --- trialRefs ---

test('trialRefs resolves NCT ID with CT.gov URL', () => {
  const result = explainFactor('clinicalImpact', makeOpp({ trialIds: ['t1'] }), 82, makeTrials());
  assert.equal(result.trialRefs.length, 1);
  assert.equal(result.trialRefs[0].label, 'NCT03036124');
  assert.ok(result.trialRefs[0].href.includes('clinicaltrials.gov'));
  assert.equal(result.trialRefs[0].year, 2019);
});

test('trialRefs resolves PMID with PubMed URL', () => {
  const result = explainFactor('clinicalImpact', makeOpp({ trialIds: ['t2'] }), 82, makeTrials());
  assert.equal(result.trialRefs[0].label, 'PMID 33567890');
  assert.ok(result.trialRefs[0].href.includes('pubmed.ncbi.nlm.nih.gov'));
});

test('trialRefs resolves DOI with doi.org URL', () => {
  const result = explainFactor('clinicalImpact', makeOpp({ trialIds: ['t3'] }), 82, makeTrials());
  assert.equal(result.trialRefs[0].label, 'DOI 10.1234/test');
  assert.ok(result.trialRefs[0].href.includes('doi.org'));
});

test('trialRefs falls back to trialId when no standard ID', () => {
  const result = explainFactor('clinicalImpact', makeOpp({ trialIds: ['t4'] }), 82, makeTrials());
  assert.equal(result.trialRefs[0].label, 't4');
  assert.equal(result.trialRefs[0].href, null);
});

test('empty trialIds returns empty trialRefs', () => {
  const result = explainFactor('clinicalImpact', makeOpp({ trialIds: [] }), 82, makeTrials());
  assert.deepEqual(result.trialRefs, []);
});

test('trialRefs includes year from trial data', () => {
  const result = explainFactor('clinicalImpact', makeOpp({ trialIds: ['t1', 't2'] }), 82, makeTrials());
  assert.equal(result.trialRefs[0].year, 2019);
  assert.equal(result.trialRefs[1].year, 2020);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/factor-explainer.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit test file**

```bash
cd /c/Projects/metasprint-cardio-universe
git add tests/factor-explainer.test.mjs
git commit -m "test: add factor explainer tests for explainability"
```

---

### Task 4: Factor Explainer — Implementation

**Files:**
- Create: `src/engine/explainability/factor-explainer.js`

- [ ] **Step 1: Implement factor explainer**

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

const ENDPOINT_LABELS = {
  mace: 'MACE',
  mortality: 'Mortality',
  hf: 'Heart Failure',
  renal: 'Renal',
  safety: 'Safety',
  frailty: 'Frailty',
  other: 'Other',
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveTrialRef(trialId, trialById) {
  const trial = trialById.get(String(trialId));
  if (!trial) return { trialId: String(trialId), label: String(trialId), href: null, year: null };

  if (trial.nctId) {
    return {
      trialId: String(trialId),
      label: trial.nctId,
      href: `https://clinicaltrials.gov/study/${encodeURIComponent(trial.nctId)}`,
      year: trial.year ?? null,
    };
  }
  if (trial.pmid) {
    return {
      trialId: String(trialId),
      label: `PMID ${trial.pmid}`,
      href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(trial.pmid)}/`,
      year: trial.year ?? null,
    };
  }
  if (trial.doi) {
    return {
      trialId: String(trialId),
      label: `DOI ${trial.doi}`,
      href: `https://doi.org/${encodeURIComponent(trial.doi)}`,
      year: trial.year ?? null,
    };
  }

  return { trialId: String(trialId), label: String(trialId), href: null, year: trial.year ?? null };
}

function buildTrialRefs(trialIds, trials) {
  if (!Array.isArray(trialIds) || trialIds.length === 0) return [];
  const trialById = new Map();
  for (const trial of trials ?? []) {
    if (trial?.trialId) trialById.set(String(trial.trialId), trial);
  }
  return trialIds.map((id) => resolveTrialRef(id, trialById));
}

function explainClinicalImpact(opp, score) {
  const enrollment = num(opp.totalEnrollment);
  const domain = opp.endpointDomainId ?? 'other';
  const boost = ENDPOINT_BOOSTS[domain] ?? 0;
  const domainLabel = ENDPOINT_LABELS[domain] ?? domain;
  const boostSign = boost >= 0 ? '+' : '';
  if (enrollment <= 0) {
    return `${score} = endpoint boost only (${boostSign}${boost} ${domainLabel}). No enrollment data.`;
  }
  return `${score} = log2(${enrollment} / 100) x 12 ${boostSign} ${boost} (${domainLabel} boost). ${num(opp.trialCount)} trials, ${enrollment.toLocaleString()} enrolled.`;
}

function explainUncertaintyReduction(opp, score) {
  const count = num(opp.trialCount);
  const recent = num(opp.recentTrials);
  const recencyMult = count === 0 ? 0.6 : recent > 0 ? 1.0 : 0.6;
  return `${score} = bell curve at ${count} trials (peak 5) x ${recencyMult} recency. ${recent} of ${count} in last 3y.`;
}

function explainFeasibility(opp, score) {
  const count = num(opp.trialCount);
  if (count < 2) {
    return `${score} = 0 (fewer than 2 trials required for pooling). ${count} trial(s) available.`;
  }
  const trialBase = count >= 3 ? 80 : 60;
  const yearRange = Array.isArray(opp.yearRange) ? opp.yearRange : [null, null];
  const minYear = num(yearRange[0]);
  const maxYear = num(yearRange[1]);
  const yearSpan = maxYear > minYear ? maxYear - minYear : 0;
  const yearPenalty = Math.max(0.5, 1.0 - Math.max(0, yearSpan - 10) * 0.05);
  const sources = Math.max(1, num(opp.sourceCount));
  const sourceBonus = 1.0 + Math.min(0.25, (sources - 1) * 0.125);
  return `${score} = base ${trialBase} x ${yearPenalty.toFixed(2)} year-range x ${sourceBonus.toFixed(3)} multi-source. ${count} trials, ${yearSpan}y span, ${sources} sources.`;
}

function explainFreshness(opp, score) {
  const yearRange = Array.isArray(opp.yearRange) ? opp.yearRange : [null, null];
  const maxYear = yearRange[1];
  if (!Number.isFinite(maxYear)) {
    return `${score} = floor (10). No year data available.`;
  }
  const currentYear = new Date().getFullYear();
  const age = currentYear - maxYear;
  return `${score} = 100 - ${age} x 15. Most recent trial: ${maxYear}.`;
}

function explainProvenanceConfidence(opp, score) {
  const sources = Math.max(0, num(opp.sourceCount));
  let sourceBase;
  if (sources >= 3) sourceBase = 100;
  else if (sources === 2) sourceBase = 75;
  else sourceBase = 50;
  const penalty = score < sourceBase ? sourceBase - score : 0;
  return `${score} = ${sourceBase} (${sources} source(s)) - ${penalty} fallback penalty.`;
}

const EXPLAINERS = {
  clinicalImpact: explainClinicalImpact,
  uncertaintyReduction: explainUncertaintyReduction,
  feasibility: explainFeasibility,
  freshness: explainFreshness,
  provenanceConfidence: explainProvenanceConfidence,
};

export function explainFactor(factorId, opportunity, factorScore, trials) {
  const explain = EXPLAINERS[factorId];
  const text = explain ? explain(opportunity, factorScore) : `${factorScore} (no explanation available)`;
  const trialRefs = buildTrialRefs(opportunity?.trialIds, trials);
  return { text, trialRefs };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/factor-explainer.test.mjs`
Expected: All 12 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/explainability/factor-explainer.js
git commit -m "feat: implement factor explainer with derivation text and trial refs"
```

---

### Task 5: Explainability Module Public API

**Files:**
- Create: `src/engine/explainability/index.js`

- [ ] **Step 1: Create public API**

```js
export { classifyConfidence } from './confidence-classifier.js';
export { explainFactor } from './factor-explainer.js';
```

- [ ] **Step 2: Run all explainability tests**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/confidence-classifier.test.mjs tests/factor-explainer.test.mjs`
Expected: All tests PASS (~24 tests).

- [ ] **Step 3: Run full suite**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS (83 existing + ~24 new = ~107).

- [ ] **Step 4: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/explainability/index.js
git commit -m "feat: add explainability module public API"
```

---

### Task 6: Add CSS for Explainability UI

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add CSS before the closing `</style>` tag**

```css
    .confidence-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 0.64rem;
      font-weight: 600;
      margin-left: 4px;
      color: #fff;
    }

    .confidence-badge.high { background: #16a34a; }
    .confidence-badge.moderate { background: #d97706; }
    .confidence-badge.low { background: #dc2626; }

    .explain-section {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
    }

    .explain-canvas {
      display: block;
      margin-bottom: 8px;
      border-radius: 6px;
      background: #f8fafc;
    }

    .factor-row {
      margin-bottom: 4px;
      font-size: 0.73rem;
    }

    .factor-row summary {
      cursor: pointer;
      color: #334155;
      font-weight: 600;
      padding: 3px 0;
      list-style: none;
    }

    .factor-row summary::-webkit-details-marker { display: none; }

    .factor-row summary::before {
      content: '\25B6 ';
      font-size: 0.6rem;
      margin-right: 4px;
      color: #94a3b8;
    }

    .factor-row[open] summary::before {
      content: '\25BC ';
    }

    .factor-derivation {
      padding: 4px 0 4px 16px;
      font-size: 0.7rem;
      color: #475569;
      font-family: monospace;
      line-height: 1.4;
    }

    .factor-trials {
      padding: 2px 0 4px 16px;
      font-size: 0.7rem;
    }

    .factor-trials a {
      color: #0f4c81;
      text-decoration: none;
      font-weight: 600;
    }

    .factor-trials a:hover { text-decoration: underline; }

    .status-icon {
      margin-left: 4px;
      font-size: 0.68rem;
    }

    .status-icon.real { color: #16a34a; }
    .status-icon.imputed { color: #d97706; }
    .status-icon.degraded { color: #dc2626; }
```

- [ ] **Step 2: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add public/index.html
git commit -m "feat: add CSS for explainability badges, bar chart, and factor rows"
```

---

### Task 7: Update Render — Confidence Badge + Explanation Panel

**Files:**
- Modify: `src/discovery/ui/render.js`

- [ ] **Step 1: Add import for explainability module**

At the top of `src/discovery/ui/render.js`, after the existing import line (`import { append, byId, clearNode, el, setText } from '../../core/dom.js';`), add:

```js
import { classifyConfidence, explainFactor } from '../../engine/explainability/index.js';
```

- [ ] **Step 2: Add the canvas bar chart and explanation panel render functions**

Add these functions after `renderWeightsPanel` (after line ~870) and before `renderDiscovery`:

```js
const STATUS_ICONS = {
  real: '\u2713',
  imputed: '\u26A0',
  degraded: '\u26A0',
};

const FACTOR_NAMES = {
  clinicalImpact: 'Clinical Impact',
  uncertaintyReduction: 'Uncertainty Reduction',
  feasibility: 'Feasibility',
  freshness: 'Freshness',
  provenanceConfidence: 'Provenance Confidence',
};

const STATUS_COLORS = {
  real: '#16a34a',
  imputed: '#d97706',
  degraded: '#dc2626',
};

const BAR_COLORS = {
  real: '#16a34a',
  imputed: '#d97706',
  degraded: '#dc2626',
};

function drawFactorBars(canvas, factors, confidence) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = 280;
  const barHeight = 14;
  const gap = 4;
  const labelWidth = 30;
  const scoreWidth = 28;
  const barMaxWidth = width - labelWidth - scoreWidth - 12;
  const factorIds = Object.keys(FACTOR_NAMES);
  const height = factorIds.length * (barHeight + gap) + gap;

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.clearRect(0, 0, width, height);
  ctx.font = '10px monospace';

  for (let i = 0; i < factorIds.length; i++) {
    const fid = factorIds[i];
    const y = gap + i * (barHeight + gap);
    const score = Math.round(Number(factors?.[fid]) || 0);
    const status = confidence?.perFactor?.[fid]?.status ?? 'real';
    const barWidth = Math.max(0, (score / 100) * barMaxWidth);

    ctx.fillStyle = '#94a3b8';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(FACTOR_ABBREVS[fid] ?? fid.slice(0, 2).toUpperCase(), 2, y + barHeight / 2);

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(labelWidth, y, barMaxWidth, barHeight);

    ctx.fillStyle = BAR_COLORS[status] ?? BAR_COLORS.real;
    ctx.fillRect(labelWidth, y, barWidth, barHeight);

    ctx.fillStyle = '#334155';
    ctx.textAlign = 'right';
    ctx.fillText(String(score), width - 2, y + barHeight / 2);
  }
}

function renderExplanationPanel(container, item, state) {
  const globalContext = { usedFallback: Boolean(state.provenance?.usedFallback) };
  const confidence = classifyConfidence(item, globalContext);
  const factors = item.factors ?? {};

  const section = el('div', { className: 'explain-section' });

  const canvas = document.createElement('canvas');
  canvas.className = 'explain-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Factor contribution bar chart');
  section.appendChild(canvas);
  drawFactorBars(canvas, factors, confidence);

  const factorIds = Object.keys(FACTOR_NAMES);
  for (const fid of factorIds) {
    const score = Math.round(Number(factors[fid]) || 0);
    const status = confidence.perFactor?.[fid]?.status ?? 'real';
    const explanation = explainFactor(fid, item, score, state.trials ?? []);

    const row = el('details', { className: 'factor-row' });
    const summaryEl = el('summary');
    summaryEl.textContent = `${FACTOR_NAMES[fid]}: ${score}`;

    const icon = el('span', {
      className: `status-icon ${status}`,
      text: STATUS_ICONS[status] ?? '',
      attrs: { 'aria-label': status },
    });
    summaryEl.appendChild(icon);
    row.appendChild(summaryEl);

    const derivation = el('div', { className: 'factor-derivation', text: explanation.text });
    row.appendChild(derivation);

    if (explanation.trialRefs.length > 0) {
      const trialDiv = el('div', { className: 'factor-trials' });
      for (const ref of explanation.trialRefs.slice(0, 10)) {
        const trialLine = el('div');
        if (ref.href) {
          const link = el('a', {
            text: ref.label,
            attrs: { href: ref.href, target: '_blank', rel: 'noopener noreferrer' },
          });
          trialLine.appendChild(link);
        } else {
          trialLine.appendChild(el('span', { text: ref.label }));
        }
        if (ref.year) trialLine.appendChild(el('span', { text: ` (${ref.year})` }));
        trialDiv.appendChild(trialLine);
      }
      if (explanation.trialRefs.length > 10) {
        trialDiv.appendChild(el('div', { text: `... and ${explanation.trialRefs.length - 10} more` }));
      }
      row.appendChild(trialDiv);
    }

    section.appendChild(row);
  }

  container.appendChild(section);
}
```

- [ ] **Step 3: Update renderOpportunityList to add confidence badge and explanation panel**

In `renderOpportunityList`, find the line where the priority badge is created (around line 184-188):

```js
    const badge = el('span', {
      className: `badge ${item.priority}`,
      text: `${item.priority.toUpperCase()} GAP`,
    });
    title.appendChild(badge);
```

After `title.appendChild(badge);`, add the confidence badge:

```js
    const globalCtx = { usedFallback: Boolean(state.provenance?.usedFallback) };
    const confidence = classifyConfidence(item, globalCtx);
    const confBadge = el('span', {
      className: `confidence-badge ${confidence.tier}`,
      text: confidence.tierLabel.toUpperCase(),
    });
    title.appendChild(confBadge);
```

Then find the `<details>` block where trials are listed (around line 221-250). After the details closing (`li.appendChild(details);` around line 250), add the explanation panel:

```js
    renderExplanationPanel(li, item, state);
```

- [ ] **Step 4: Run all tests**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS (~107).

- [ ] **Step 5: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/discovery/ui/render.js
git commit -m "feat: render confidence badges, factor bar chart, and explanation panels"
```

---

### Task 8: Full Test Suite + Smoke Test

**Files:** None new.

- [ ] **Step 1: Run full test suite**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS, 0 failures.

- [ ] **Step 2: Verify test count**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test 2>&1 | tail -10`
Expected: `# pass` count >= 100, `# fail 0`.

- [ ] **Step 3: Open discovery shell for smoke test**

Open `public/index.html` in a browser. Verify:
1. Each opportunity card shows a confidence badge (HIGH/MODERATE/LOW CONFIDENCE) next to the priority badge.
2. Below the trial list expansion, a canvas bar chart shows 5 factor bars.
3. Each factor row is collapsible — clicking shows derivation text.
4. Trial references within factor rows link to CT.gov/PubMed/DOI.
5. Bars are colored green/amber/red based on data quality.
6. Existing features (weight sliders, sort buttons, views) still work.

- [ ] **Step 4: Final commit if needed**

```bash
cd /c/Projects/metasprint-cardio-universe
git status
# Only commit if there are ranking-related changes
```
