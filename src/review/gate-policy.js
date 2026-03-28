export const GATE_POLICY = Object.freeze({
  policyId: 'fixed_11_of_12',
  requiredSwitchNow: 11,
  expectedReviewers: 12,
  target: '>=11 switch_now out of 12',
});

export function evaluateGate({ switchNow, responsesReceived }) {
  const safeSwitchNow = Number.isFinite(Number(switchNow)) ? Number(switchNow) : 0;
  const safeResponses = Number.isFinite(Number(responsesReceived)) ? Number(responsesReceived) : 0;
  const passed =
    safeSwitchNow >= GATE_POLICY.requiredSwitchNow && safeResponses >= GATE_POLICY.expectedReviewers;
  return {
    ...GATE_POLICY,
    responsesReceived: safeResponses,
    passed,
    gap: Math.max(0, GATE_POLICY.requiredSwitchNow - safeSwitchNow),
    insufficientResponses: safeResponses < GATE_POLICY.expectedReviewers,
  };
}
