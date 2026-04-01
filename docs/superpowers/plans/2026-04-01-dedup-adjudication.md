# Dedup Adjudication UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based adjudication UI that replaces the CSV-only dedup override workflow, with decision persistence, reviewer tagging, conflict detection, and overrides.json export/import.

**Architecture:** New `src/engine/adjudication/` module with pure functions for queue parsing and decision management (testable without DOM). Standalone `public/adjudication.html` page with thin runtime. Reuses `pairKey` from existing identity engine.

**Tech Stack:** Node.js (ESM), node:test runner, localStorage for persistence, Fetch API for loading queue CSV.

**Spec:** `docs/superpowers/specs/2026-04-01-dedup-adjudication-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/engine/adjudication/queue-parser.js` | `parseOverrideQueue(csvText)` — CSV to structured QueuePair[] |
| `src/engine/adjudication/decision-store.js` | CRUD, conflict detection, export/import overrides |
| `src/engine/adjudication/index.js` | Public API re-exports |
| `tests/queue-parser.test.mjs` | CSV parsing tests |
| `tests/decision-store.test.mjs` | Decision CRUD, conflicts, export format tests |
| `public/adjudication.html` | Standalone adjudication page (HTML + CSS) |
| `public/adjudication-runtime.js` | Thin entry point (fetch CSV, render table, wire handlers) |

### Modified files
| File | Change |
|------|--------|
| `public/index.html` | Add "Adjudication" link in control bar |

---

### Task 1: Queue Parser — Tests

**Files:**
- Create: `tests/queue-parser.test.mjs`

- [ ] **Step 1: Write queue parser tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOverrideQueue } from '../src/engine/adjudication/queue-parser.js';

const HEADER = 'pair_id,left_trial_id,right_trial_id,left_source,right_source,score,recommended_decision,decision,reviewer,reason,status,generated_at';

test('parseOverrideQueue parses valid CSV row', () => {
  const csv = `${HEADER}\ntrial_A::trial_B,trial_A,trial_B,ctgov,aact,0.87,force_merge,,,,,2026-03-01T12:00:00Z`;
  const result = parseOverrideQueue(csv);
  assert.equal(result.length, 1);
  assert.equal(result[0].pairId, 'trial_A::trial_B');
  assert.equal(result[0].leftTrialId, 'trial_A');
  assert.equal(result[0].rightTrialId, 'trial_B');
  assert.equal(result[0].leftSource, 'ctgov');
  assert.equal(result[0].rightSource, 'aact');
  assert.ok(Math.abs(result[0].score - 0.87) < 0.001);
  assert.equal(result[0].recommendedDecision, 'force_merge');
  assert.equal(result[0].generatedAt, '2026-03-01T12:00:00Z');
});

test('parseOverrideQueue returns empty for header-only CSV', () => {
  const result = parseOverrideQueue(HEADER);
  assert.deepEqual(result, []);
});

test('parseOverrideQueue returns empty for empty string', () => {
  assert.deepEqual(parseOverrideQueue(''), []);
});

test('parseOverrideQueue parses multiple rows', () => {
  const csv = [
    HEADER,
    'a::b,a,b,ctgov,aact,0.95,force_merge,,,,,2026-01-01T00:00:00Z',
    'c::d,c,d,pubmed,openalex,0.72,force_split,,,,,2026-01-02T00:00:00Z',
  ].join('\n');
  const result = parseOverrideQueue(csv);
  assert.equal(result.length, 2);
  assert.equal(result[0].pairId, 'a::b');
  assert.equal(result[1].pairId, 'c::d');
});

test('parseOverrideQueue skips malformed rows', () => {
  const csv = `${HEADER}\nonly,two,columns`;
  const result = parseOverrideQueue(csv);
  assert.equal(result.length, 0);
});

test('parseOverrideQueue trims whitespace from values', () => {
  const csv = `${HEADER}\n  a::b , a , b , ctgov , aact , 0.9 , force_merge ,,,,, 2026-01-01T00:00:00Z `;
  const result = parseOverrideQueue(csv);
  assert.equal(result[0].pairId, 'a::b');
  assert.equal(result[0].leftSource, 'ctgov');
  assert.ok(Math.abs(result[0].score - 0.9) < 0.001);
});

test('parseOverrideQueue handles missing optional columns', () => {
  const csv = `${HEADER}\na::b,a,b,ctgov,aact,0.8,,,,,, `;
  const result = parseOverrideQueue(csv);
  assert.equal(result.length, 1);
  assert.equal(result[0].recommendedDecision, '');
  assert.equal(result[0].generatedAt, '');
});

test('parseOverrideQueue ignores decision/reviewer/reason columns from CSV', () => {
  const csv = `${HEADER}\na::b,a,b,ctgov,aact,0.8,force_merge,force_split,old_reviewer,old_reason,decided,2026-01-01T00:00:00Z`;
  const result = parseOverrideQueue(csv);
  assert.equal(result.length, 1);
  assert.equal(result[0].recommendedDecision, 'force_merge');
  // CSV decision/reviewer/reason fields are NOT carried into parsed output
  assert.equal(result[0].decision, undefined);
  assert.equal(result[0].reviewer, undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/queue-parser.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit test file**

```bash
cd /c/Projects/metasprint-cardio-universe
git add tests/queue-parser.test.mjs
git commit -m "test: add queue parser tests for dedup adjudication"
```

---

### Task 2: Queue Parser — Implementation

**Files:**
- Create: `src/engine/adjudication/queue-parser.js`

- [ ] **Step 1: Implement queue parser**

```js
function trimVal(value) {
  return String(value ?? '').trim();
}

export function parseOverrideQueue(csvText) {
  const text = String(csvText ?? '').trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(trimVal);
  const colIndex = {};
  for (let i = 0; i < header.length; i++) {
    colIndex[header[i]] = i;
  }

  const requiredCols = ['pair_id', 'left_trial_id', 'right_trial_id'];
  for (const col of requiredCols) {
    if (colIndex[col] == null) return [];
  }

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map(trimVal);
    if (cols.length < requiredCols.length) continue;

    const pairId = cols[colIndex['pair_id']] ?? '';
    const leftTrialId = cols[colIndex['left_trial_id']] ?? '';
    const rightTrialId = cols[colIndex['right_trial_id']] ?? '';
    if (!pairId || !leftTrialId || !rightTrialId) continue;

    const scoreRaw = parseFloat(cols[colIndex['score']] ?? '');

    results.push({
      pairId,
      leftTrialId,
      rightTrialId,
      leftSource: cols[colIndex['left_source']] ?? '',
      rightSource: cols[colIndex['right_source']] ?? '',
      score: Number.isFinite(scoreRaw) ? scoreRaw : 0,
      recommendedDecision: cols[colIndex['recommended_decision']] ?? '',
      status: cols[colIndex['status']] ?? 'pending',
      generatedAt: cols[colIndex['generated_at']] ?? '',
    });
  }

  return results;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/queue-parser.test.mjs`
Expected: All 8 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/adjudication/queue-parser.js
git commit -m "feat: implement queue parser for dedup adjudication"
```

---

### Task 3: Decision Store — Tests

**Files:**
- Create: `tests/decision-store.test.mjs`

- [ ] **Step 1: Write decision store tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadDecisions,
  saveDecision,
  removeDecision,
  setReviewerId,
  getReviewerId,
  detectConflicts,
  exportOverridesJson,
  importOverridesJson,
} from '../src/engine/adjudication/decision-store.js';

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

test('loadDecisions returns empty on fresh storage', () => {
  const storage = createMemoryStorage();
  const result = loadDecisions(storage);
  assert.deepEqual(result.decisions, {});
  assert.equal(result.reviewerId, '');
});

test('saveDecision stores decision with timestamp', () => {
  const storage = createMemoryStorage();
  saveDecision('a::b', 'force_merge', 'mahmood', 'same trial', storage);
  const result = loadDecisions(storage);
  assert.equal(result.decisions['a::b'].decision, 'force_merge');
  assert.equal(result.decisions['a::b'].reviewer, 'mahmood');
  assert.equal(result.decisions['a::b'].reason, 'same trial');
  assert.ok(result.decisions['a::b'].decidedAt);
});

test('saveDecision overwrites existing decision', () => {
  const storage = createMemoryStorage();
  saveDecision('a::b', 'force_merge', 'mahmood', 'reason1', storage);
  saveDecision('a::b', 'force_split', 'mahmood', 'reason2', storage);
  const result = loadDecisions(storage);
  assert.equal(result.decisions['a::b'].decision, 'force_split');
  assert.equal(result.decisions['a::b'].reason, 'reason2');
});

test('removeDecision deletes a decision', () => {
  const storage = createMemoryStorage();
  saveDecision('a::b', 'force_merge', 'mahmood', '', storage);
  removeDecision('a::b', storage);
  const result = loadDecisions(storage);
  assert.equal(result.decisions['a::b'], undefined);
});

test('setReviewerId and getReviewerId persist', () => {
  const storage = createMemoryStorage();
  setReviewerId('sarah', storage);
  assert.equal(getReviewerId(storage), 'sarah');
});

test('detectConflicts finds different-reviewer disagreements', () => {
  const decisions = {
    'a::b': { pairId: 'a::b', decision: 'force_merge', reviewer: 'mahmood', decidedAt: '2026-04-01T10:00:00Z' },
  };
  const imported = {
    'a::b': { pairId: 'a::b', decision: 'force_split', reviewer: 'sarah', decidedAt: '2026-04-01T11:00:00Z' },
  };
  const conflicts = detectConflicts(decisions, imported);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].pairId, 'a::b');
});

test('detectConflicts returns empty when same reviewer same decision', () => {
  const decisions = {
    'a::b': { pairId: 'a::b', decision: 'force_merge', reviewer: 'mahmood', decidedAt: '2026-04-01T10:00:00Z' },
  };
  const imported = {
    'a::b': { pairId: 'a::b', decision: 'force_merge', reviewer: 'mahmood', decidedAt: '2026-04-01T11:00:00Z' },
  };
  assert.equal(detectConflicts(decisions, imported).length, 0);
});

test('detectConflicts returns empty when no overlap', () => {
  const decisions = {
    'a::b': { pairId: 'a::b', decision: 'force_merge', reviewer: 'mahmood', decidedAt: '2026-04-01T10:00:00Z' },
  };
  const imported = {
    'c::d': { pairId: 'c::d', decision: 'force_split', reviewer: 'sarah', decidedAt: '2026-04-01T11:00:00Z' },
  };
  assert.equal(detectConflicts(decisions, imported).length, 0);
});

test('exportOverridesJson produces forceMerge and forceSplit arrays', () => {
  const decisions = {
    'a::b': { pairId: 'a::b', decision: 'force_merge', reviewer: 'mahmood', reason: 'same', decidedAt: '2026-04-01T10:00:00Z' },
    'c::d': { pairId: 'c::d', decision: 'force_split', reviewer: 'mahmood', reason: 'diff', decidedAt: '2026-04-01T10:00:00Z' },
  };
  const result = exportOverridesJson(decisions);
  assert.equal(result.forceMerge.length, 1);
  assert.equal(result.forceSplit.length, 1);
  assert.equal(result.forceMerge[0].leftTrialId, 'a');
  assert.equal(result.forceMerge[0].rightTrialId, 'b');
  assert.equal(result.forceSplit[0].leftTrialId, 'c');
  assert.equal(result.forceSplit[0].rightTrialId, 'd');
});

test('exportOverridesJson excludes clear decisions', () => {
  const decisions = {
    'a::b': { pairId: 'a::b', decision: 'clear', reviewer: 'mahmood', reason: '', decidedAt: '2026-04-01T10:00:00Z' },
  };
  const result = exportOverridesJson(decisions);
  assert.equal(result.forceMerge.length, 0);
  assert.equal(result.forceSplit.length, 0);
});

test('importOverridesJson merges and returns conflicts', () => {
  const existing = {
    'a::b': { pairId: 'a::b', decision: 'force_merge', reviewer: 'mahmood', reason: '', decidedAt: '2026-04-01T10:00:00Z' },
  };
  const json = {
    forceMerge: [],
    forceSplit: [{ leftTrialId: 'a', rightTrialId: 'b', reviewer: 'sarah', reason: 'distinct', decidedAt: '2026-04-01T11:00:00Z' }],
  };
  const result = importOverridesJson(json, existing);
  assert.ok(result.merged['a::b']);
  assert.equal(result.conflicts.length, 1);
});

test('importOverridesJson adds new pairs without conflict', () => {
  const existing = {};
  const json = {
    forceMerge: [{ leftTrialId: 'x', rightTrialId: 'y', reviewer: 'sarah', reason: '', decidedAt: '2026-04-01T11:00:00Z' }],
    forceSplit: [],
  };
  const result = importOverridesJson(json, existing);
  assert.ok(result.merged['x::y']);
  assert.equal(result.conflicts.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/decision-store.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit test file**

```bash
cd /c/Projects/metasprint-cardio-universe
git add tests/decision-store.test.mjs
git commit -m "test: add decision store tests for dedup adjudication"
```

---

### Task 4: Decision Store — Implementation

**Files:**
- Create: `src/engine/adjudication/decision-store.js`

- [ ] **Step 1: Implement decision store**

```js
import { pairKey } from '../identity/overrides.js';

const STORAGE_KEY = 'metasprint_adjudication_decisions';

function readStore(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { decisions: {}, reviewerId: '' };
    const parsed = JSON.parse(raw);
    return {
      decisions: parsed?.decisions && typeof parsed.decisions === 'object' ? parsed.decisions : {},
      reviewerId: typeof parsed?.reviewerId === 'string' ? parsed.reviewerId : '',
    };
  } catch {
    return { decisions: {}, reviewerId: '' };
  }
}

function writeStore(data, storage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadDecisions(storage) {
  return readStore(storage);
}

export function saveDecision(pairId, decision, reviewer, reason, storage) {
  const store = readStore(storage);
  store.decisions[pairId] = {
    pairId,
    decision,
    reviewer: reviewer || '',
    reason: reason || '',
    decidedAt: new Date().toISOString(),
  };
  writeStore(store, storage);
}

export function removeDecision(pairId, storage) {
  const store = readStore(storage);
  delete store.decisions[pairId];
  writeStore(store, storage);
}

export function setReviewerId(id, storage) {
  const store = readStore(storage);
  store.reviewerId = String(id ?? '');
  writeStore(store, storage);
}

export function getReviewerId(storage) {
  return readStore(storage).reviewerId;
}

export function detectConflicts(existingDecisions, importedDecisions) {
  const conflicts = [];
  for (const [pid, imported] of Object.entries(importedDecisions)) {
    const existing = existingDecisions[pid];
    if (!existing) continue;
    if (existing.reviewer !== imported.reviewer && existing.decision !== imported.decision) {
      conflicts.push({
        pairId: pid,
        existing: { reviewer: existing.reviewer, decision: existing.decision, decidedAt: existing.decidedAt },
        imported: { reviewer: imported.reviewer, decision: imported.decision, decidedAt: imported.decidedAt },
      });
    }
  }
  return conflicts;
}

function splitPairId(pid) {
  const parts = String(pid).split('::');
  return { left: parts[0] ?? '', right: parts[1] ?? '' };
}

export function exportOverridesJson(decisions) {
  const forceMerge = [];
  const forceSplit = [];

  for (const entry of Object.values(decisions)) {
    if (entry.decision === 'clear') continue;
    const { left, right } = splitPairId(entry.pairId);
    const record = {
      leftTrialId: left,
      rightTrialId: right,
      decision: entry.decision,
      reason: entry.reason ?? null,
      reviewer: entry.reviewer ?? null,
      decidedAt: entry.decidedAt ?? null,
    };
    if (entry.decision === 'force_merge') forceMerge.push(record);
    else if (entry.decision === 'force_split') forceSplit.push(record);
  }

  return { forceMerge, forceSplit };
}

export function importOverridesJson(json, existingDecisions) {
  const incoming = {};
  const forceMerge = Array.isArray(json?.forceMerge) ? json.forceMerge : [];
  const forceSplit = Array.isArray(json?.forceSplit) ? json.forceSplit : [];

  for (const entry of forceMerge) {
    const pid = pairKey(entry.leftTrialId, entry.rightTrialId);
    incoming[pid] = {
      pairId: pid,
      decision: 'force_merge',
      reviewer: entry.reviewer ?? '',
      reason: entry.reason ?? '',
      decidedAt: entry.decidedAt ?? new Date().toISOString(),
    };
  }
  for (const entry of forceSplit) {
    const pid = pairKey(entry.leftTrialId, entry.rightTrialId);
    incoming[pid] = {
      pairId: pid,
      decision: 'force_split',
      reviewer: entry.reviewer ?? '',
      reason: entry.reason ?? '',
      decidedAt: entry.decidedAt ?? new Date().toISOString(),
    };
  }

  const conflicts = detectConflicts(existingDecisions, incoming);
  const merged = { ...existingDecisions, ...incoming };

  return { merged, conflicts };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/decision-store.test.mjs`
Expected: All 13 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/adjudication/decision-store.js
git commit -m "feat: implement decision store with conflict detection and export"
```

---

### Task 5: Adjudication Module Public API

**Files:**
- Create: `src/engine/adjudication/index.js`

- [ ] **Step 1: Create public API**

```js
export { parseOverrideQueue } from './queue-parser.js';
export {
  loadDecisions,
  saveDecision,
  removeDecision,
  setReviewerId,
  getReviewerId,
  detectConflicts,
  exportOverridesJson,
  importOverridesJson,
} from './decision-store.js';
```

- [ ] **Step 2: Run all adjudication tests**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test tests/queue-parser.test.mjs tests/decision-store.test.mjs`
Expected: All tests PASS (~21 tests).

- [ ] **Step 3: Run full suite for regressions**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS (106 existing + ~21 new = ~127).

- [ ] **Step 4: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add src/engine/adjudication/index.js
git commit -m "feat: add adjudication module public API"
```

---

### Task 6: Adjudication HTML Page

**Files:**
- Create: `public/adjudication.html`

- [ ] **Step 1: Create the adjudication page**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MetaSprint Cardio Universe - Dedup Adjudication</title>
  <style>
    :root {
      --bg: #f7f8fa;
      --surface: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #d1d9e2;
      --primary: #0f766e;
      --primary-strong: #115e59;
      --danger: #b91c1c;
      --warn: #b45309;
      --success: #166534;
      --radius: 10px;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(135deg, #f7f8fa, #e8eef5 60%, #dbe7f0);
      color: var(--text);
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }

    .shell {
      max-width: 1100px;
      margin: 20px auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.08);
    }

    .header {
      padding: 18px 20px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(120deg, #0f766e, #0e7490);
      color: #fff;
    }

    .header h1 { margin: 0; font-size: 1.2rem; }
    .header p { margin: 8px 0 0; font-size: 0.86rem; opacity: 0.9; }

    .toolbar {
      padding: 12px 16px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      border-bottom: 1px solid var(--border);
      background: #f0f4f8;
    }

    .toolbar label { font-size: 0.78rem; color: var(--muted); font-weight: 600; }

    .toolbar input[type="text"] {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 0.82rem;
      width: 140px;
    }

    .btn {
      border: 1px solid var(--border);
      background: #fff;
      color: var(--text);
      border-radius: 8px;
      padding: 7px 11px;
      font-size: 0.82rem;
      cursor: pointer;
      text-decoration: none;
    }

    .btn:hover { border-color: #9fb3c8; }
    .btn.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
    .btn.primary:hover { background: var(--primary-strong); }
    .btn.active { background: #0e7490; border-color: #0e7490; color: #fff; }
    .btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
    .btn.warn { background: var(--warn); border-color: var(--warn); color: #fff; }
    .btn.success { background: var(--success); border-color: var(--success); color: #fff; }

    .stats {
      font-size: 0.78rem;
      color: var(--muted);
      margin-left: auto;
    }

    .filter-tabs {
      padding: 10px 16px;
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--border);
    }

    .queue-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }

    .queue-table th {
      background: #f2f8ff;
      color: #1e3a58;
      padding: 8px 10px;
      text-align: left;
      border-bottom: 2px solid var(--border);
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .queue-table td {
      padding: 7px 10px;
      border-bottom: 1px solid #edf2f7;
      vertical-align: top;
    }

    .queue-table tbody tr:hover { background: #f8fbff; }

    .score-cell { font-weight: 700; font-family: monospace; }
    .score-high { color: var(--success); }
    .score-mid { color: var(--warn); }
    .score-low { color: var(--danger); }

    .decision-tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      color: #fff;
    }

    .decision-tag.force_merge { background: var(--success); }
    .decision-tag.force_split { background: var(--danger); }
    .decision-tag.clear { background: #64748b; }
    .decision-tag.conflict { background: var(--warn); }

    .action-group { display: flex; gap: 4px; flex-wrap: wrap; }

    .action-group .btn {
      padding: 4px 8px;
      font-size: 0.72rem;
    }

    .detail-row td {
      padding: 8px 16px;
      background: #f8fafb;
      border-bottom: 2px solid var(--border);
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 8px;
    }

    .detail-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      background: #fff;
      font-size: 0.76rem;
    }

    .detail-card .label {
      font-size: 0.68rem;
      color: var(--muted);
      font-weight: 600;
      margin-bottom: 3px;
    }

    .reason-input {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 0.76rem;
      margin-top: 6px;
    }

    .reviewer-tag {
      font-size: 0.66rem;
      color: var(--muted);
      margin-left: 4px;
    }

    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: var(--muted);
    }

    .hidden-input { display: none; }

    @media (max-width: 800px) {
      .detail-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell" id="adjShell">
    <div class="header">
      <h1>Dedup Adjudication</h1>
      <p>Review duplicate pair candidates. Decide: merge, split, or clear. <a href="./index.html" style="color:#a5f3fc">Back to Discovery</a></p>
    </div>

    <div class="toolbar" id="toolbar">
      <label for="reviewerInput">Reviewer:</label>
      <input type="text" id="reviewerInput" placeholder="Your name" autocomplete="off">
      <button class="btn primary" id="btnExport" type="button">Export overrides.json</button>
      <label class="btn" id="btnImportLabel" tabindex="0">Import overrides.json
        <input type="file" id="btnImport" accept=".json" class="hidden-input">
      </label>
      <a class="btn" href="./index.html">Discovery</a>
      <span class="stats" id="statsLine">Loading...</span>
    </div>

    <div class="filter-tabs" id="filterTabs">
      <button class="btn active" data-filter="all">All</button>
      <button class="btn" data-filter="pending">Pending</button>
      <button class="btn" data-filter="decided">Decided</button>
      <button class="btn" data-filter="conflicts">Conflicts</button>
    </div>

    <div id="tableContainer">
      <table class="queue-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Score</th>
            <th>Left Trial</th>
            <th>Right Trial</th>
            <th>Sources</th>
            <th>Recommended</th>
            <th>Decision</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="queueBody"></tbody>
      </table>
      <div class="empty-state" id="emptyState" hidden>No pairs match the current filter.</div>
    </div>
  </div>

  <script type="module" src="./adjudication-runtime.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add public/adjudication.html
git commit -m "feat: add adjudication HTML page with table layout and CSS"
```

---

### Task 7: Adjudication Runtime

**Files:**
- Create: `public/adjudication-runtime.js`

- [ ] **Step 1: Implement the runtime**

```js
import {
  parseOverrideQueue,
  loadDecisions,
  saveDecision,
  removeDecision,
  setReviewerId,
  getReviewerId,
  detectConflicts,
  exportOverridesJson,
  importOverridesJson,
} from '../src/engine/adjudication/index.js';

const QUEUE_CSV_PATH = '../reports/dedup/override-queue.csv';

let queuePairs = [];
let currentFilter = 'all';
let decisionsCache = {};
let conflictsCache = [];

function trialHref(trialId) {
  const id = String(trialId ?? '').replace(/^trial_/i, '');
  if (/^NCT\d+$/i.test(id)) return `https://clinicaltrials.gov/study/${id}`;
  return null;
}

function trialLabel(trialId) {
  const id = String(trialId ?? '').replace(/^trial_/i, '');
  return id || trialId;
}

function scoreClass(score) {
  if (score >= 0.9) return 'score-high';
  if (score >= 0.7) return 'score-mid';
  return 'score-low';
}

function refreshState() {
  const store = loadDecisions(localStorage);
  decisionsCache = store.decisions;

  const importedFromConflicts = {};
  conflictsCache = [];

  const pending = queuePairs.filter((p) => !decisionsCache[p.pairId]);
  const decided = queuePairs.filter((p) => decisionsCache[p.pairId]);

  document.getElementById('statsLine').textContent =
    `${pending.length} pending / ${decided.length} decided / ${conflictsCache.length} conflicts`;
  document.getElementById('reviewerInput').value = store.reviewerId;
}

function getFilteredPairs() {
  if (currentFilter === 'pending') return queuePairs.filter((p) => !decisionsCache[p.pairId]);
  if (currentFilter === 'decided') return queuePairs.filter((p) => decisionsCache[p.pairId]);
  if (currentFilter === 'conflicts') return queuePairs.filter((p) => conflictsCache.some((c) => c.pairId === p.pairId));
  return queuePairs;
}

function renderRow(pair, index) {
  const dec = decisionsCache[pair.pairId];
  const tr = document.createElement('tr');
  tr.dataset.pairId = pair.pairId;

  const leftHref = trialHref(pair.leftTrialId);
  const rightHref = trialHref(pair.rightTrialId);

  tr.innerHTML = `
    <td>${index + 1}</td>
    <td class="score-cell ${scoreClass(pair.score)}">${pair.score.toFixed(2)}</td>
    <td>${leftHref ? `<a href="${leftHref}" target="_blank" rel="noopener noreferrer">${trialLabel(pair.leftTrialId)}</a>` : trialLabel(pair.leftTrialId)}</td>
    <td>${rightHref ? `<a href="${rightHref}" target="_blank" rel="noopener noreferrer">${trialLabel(pair.rightTrialId)}</a>` : trialLabel(pair.rightTrialId)}</td>
    <td>${pair.leftSource} / ${pair.rightSource}</td>
    <td>${pair.recommendedDecision || '-'}</td>
    <td>${dec ? `<span class="decision-tag ${dec.decision}">${dec.decision}</span><span class="reviewer-tag">${dec.reviewer} ${new Date(dec.decidedAt).toLocaleDateString()}</span>` : '<span style="color:#94a3b8">-</span>'}</td>
    <td class="action-group">
      <button class="btn success" data-action="merge" data-pair="${pair.pairId}" type="button">Merge</button>
      <button class="btn danger" data-action="split" data-pair="${pair.pairId}" type="button">Split</button>
      <button class="btn" data-action="clear" data-pair="${pair.pairId}" type="button">Clear</button>
      ${dec ? `<button class="btn" data-action="undo" data-pair="${pair.pairId}" type="button">Undo</button>` : ''}
    </td>
  `;
  return tr;
}

function renderTable() {
  const body = document.getElementById('queueBody');
  const empty = document.getElementById('emptyState');
  body.innerHTML = '';

  const pairs = getFilteredPairs();
  if (pairs.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (let i = 0; i < pairs.length; i++) {
    body.appendChild(renderRow(pairs[i], i));
  }
}

function handleAction(action, pairId) {
  const reviewer = document.getElementById('reviewerInput').value.trim() || 'anonymous';

  if (action === 'undo') {
    removeDecision(pairId, localStorage);
  } else if (action === 'merge') {
    saveDecision(pairId, 'force_merge', reviewer, '', localStorage);
  } else if (action === 'split') {
    saveDecision(pairId, 'force_split', reviewer, '', localStorage);
  } else if (action === 'clear') {
    saveDecision(pairId, 'clear', reviewer, '', localStorage);
  }

  refreshState();
  renderTable();
}

function handleExport() {
  const json = exportOverridesJson(decisionsCache);
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'overrides.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      const result = importOverridesJson(json, decisionsCache);
      conflictsCache = result.conflicts;

      const store = loadDecisions(localStorage);
      store.decisions = result.merged;
      localStorage.setItem('metasprint_adjudication_decisions', JSON.stringify(store));

      refreshState();
      renderTable();

      if (result.conflicts.length > 0) {
        alert(`Import complete. ${result.conflicts.length} conflict(s) detected — check the Conflicts tab.`);
      }
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

async function init() {
  try {
    const response = await fetch(QUEUE_CSV_PATH);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    queuePairs = parseOverrideQueue(csvText);
  } catch {
    queuePairs = [];
  }

  refreshState();
  renderTable();

  document.getElementById('queueBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    handleAction(btn.dataset.action, btn.dataset.pair);
  });

  document.getElementById('filterTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('#filterTabs .btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderTable();
  });

  document.getElementById('reviewerInput').addEventListener('change', (e) => {
    setReviewerId(e.target.value.trim(), localStorage);
  });

  document.getElementById('btnExport').addEventListener('click', handleExport);

  document.getElementById('btnImport').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleImport(file);
    e.target.value = '';
  });
}

void init();
```

- [ ] **Step 2: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add public/adjudication-runtime.js
git commit -m "feat: add adjudication runtime with table rendering and decision handlers"
```

---

### Task 8: Add Adjudication Link to Discovery Shell

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add link in control bar**

In `public/index.html`, find the "Review Charts" link (line 562):
```html
      <a class="btn" href="./review-dashboard.html">Review Charts</a>
```

After it, add:
```html
      <a class="btn" href="./adjudication.html">Adjudication</a>
```

- [ ] **Step 2: Commit**

```bash
cd /c/Projects/metasprint-cardio-universe
git add public/index.html
git commit -m "feat: add adjudication link to discovery shell control bar"
```

---

### Task 9: Full Test Suite Verification

**Files:** None new.

- [ ] **Step 1: Run full test suite**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test`
Expected: All tests PASS, 0 failures.

- [ ] **Step 2: Verify test count**

Run: `cd /c/Projects/metasprint-cardio-universe && node --test 2>&1 | tail -10`
Expected: `# pass` count >= 125, `# fail 0`.

- [ ] **Step 3: Smoke test adjudication page**

Open `public/adjudication.html` in a browser via local static server. Verify:
1. Page loads (may show "0 pending" if no queue CSV is served — that's expected with file:// protocol).
2. Reviewer input persists across page reload.
3. Filter tabs (All/Pending/Decided/Conflicts) switch correctly.
4. Export button downloads a valid `overrides.json` file.
5. "Back to Discovery" link works.
6. Discovery shell has "Adjudication" link in control bar.
