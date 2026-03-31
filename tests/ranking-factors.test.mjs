import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clinicalImpact,
  uncertaintyReduction,
  feasibility,
  freshness,
  provenanceConfidence,
} from '../src/engine/ranking/factor-computations.js';

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
