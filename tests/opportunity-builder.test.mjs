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
