import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWeights,
  compositeScore,
  classifyPriority,
  DEFAULT_WEIGHTS,
} from '../src/engine/ranking/composite-scorer.js';

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

test('DEFAULT_WEIGHTS sums to 1.0', () => {
  const sum = Object.values(DEFAULT_WEIGHTS).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1.0) < 1e-9, `sum should be 1.0: ${sum}`);
});

test('DEFAULT_WEIGHTS has exactly 5 factors', () => {
  assert.equal(Object.keys(DEFAULT_WEIGHTS).length, 5);
});
