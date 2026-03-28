import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateGate, GATE_POLICY } from '../src/review/gate-policy.js';

test('evaluateGate enforces fixed 11 of 12 rule', () => {
  const passing = evaluateGate({ switchNow: 11, responsesReceived: 12 });
  assert.equal(passing.passed, true);
  assert.equal(passing.gap, 0);
  assert.equal(passing.insufficientResponses, false);
  assert.equal(passing.requiredSwitchNow, GATE_POLICY.requiredSwitchNow);
  assert.equal(passing.expectedReviewers, GATE_POLICY.expectedReviewers);

  const notEnoughResponses = evaluateGate({ switchNow: 11, responsesReceived: 10 });
  assert.equal(notEnoughResponses.passed, false);
  assert.equal(notEnoughResponses.insufficientResponses, true);
  assert.equal(notEnoughResponses.gap, 0);

  const belowThreshold = evaluateGate({ switchNow: 8, responsesReceived: 12 });
  assert.equal(belowThreshold.passed, false);
  assert.equal(belowThreshold.gap, 3);
});
