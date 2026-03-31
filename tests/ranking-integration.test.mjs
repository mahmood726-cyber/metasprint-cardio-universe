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
  assert.equal(clinical.length, fresh.length);
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
