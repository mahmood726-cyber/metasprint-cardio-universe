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

test('clinicalImpact text contains enrollment and boost', () => {
  const result = explainFactor('clinicalImpact', makeOpp(), 82, makeTrials());
  assert.ok(result.text.includes('20725'), 'should contain enrollment');
  assert.ok(result.text.includes('MACE') || result.text.includes('mace'), 'should contain domain');
  assert.ok(result.text.includes('15'), 'should contain boost value');
});

test('uncertaintyReduction text contains trial count and recency', () => {
  const result = explainFactor('uncertaintyReduction', makeOpp(), 78, makeTrials());
  assert.ok(result.text.includes('4'), 'should contain trial count');
  assert.ok(result.text.includes('2'), 'should contain recent trials');
});

test('feasibility text contains trial base, year span, source count', () => {
  const result = explainFactor('feasibility', makeOpp(), 85, makeTrials());
  assert.ok(result.text.includes('80'), 'should contain trial base for 4 trials');
  assert.ok(result.text.includes('3'), 'should contain source count');
});

test('freshness text contains max year and age', () => {
  const result = explainFactor('freshness', makeOpp(), 70, makeTrials());
  assert.ok(result.text.includes('2024'), 'should contain max year');
});

test('provenanceConfidence text contains source count and penalty', () => {
  const result = explainFactor('provenanceConfidence', makeOpp(), 100, makeTrials());
  assert.ok(result.text.includes('3'), 'should contain source count');
});

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
