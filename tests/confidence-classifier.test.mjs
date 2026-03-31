import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyConfidence } from '../src/engine/explainability/confidence-classifier.js';

function makeOpp({ totalEnrollment = 5000, trialCount = 5, yearRange = [2020, 2024], sourceCount = 2 } = {}) {
  return { totalEnrollment, trialCount, yearRange, sourceCount, recentTrials: 3 };
}

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
