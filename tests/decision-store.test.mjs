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
