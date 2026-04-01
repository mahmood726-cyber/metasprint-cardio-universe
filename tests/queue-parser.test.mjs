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
  assert.equal(result[0].decision, undefined);
  assert.equal(result[0].reviewer, undefined);
});
