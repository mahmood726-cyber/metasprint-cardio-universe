const TIER_LABELS = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
};

function classifyFactor(factorId, opportunity, globalContext) {
  switch (factorId) {
    case 'clinicalImpact': {
      const enrollment = Number(opportunity?.totalEnrollment);
      if (!Number.isFinite(enrollment) || enrollment <= 0) {
        return { status: 'imputed', note: 'No enrollment data — defaulted to endpoint boost only' };
      }
      return { status: 'real', note: null };
    }
    case 'uncertaintyReduction': {
      const count = Number(opportunity?.trialCount);
      if (!Number.isFinite(count) || count <= 0) {
        return { status: 'imputed', note: 'No trials — defaulted to bell curve at 0' };
      }
      return { status: 'real', note: null };
    }
    case 'feasibility': {
      const count = Number(opportunity?.trialCount);
      if (!Number.isFinite(count) || count < 2) {
        return { status: 'imputed', note: 'Fewer than 2 trials — feasibility is 0' };
      }
      return { status: 'real', note: null };
    }
    case 'freshness': {
      const yearRange = opportunity?.yearRange;
      const maxYear = Array.isArray(yearRange) ? yearRange[1] : null;
      if (!Number.isFinite(maxYear)) {
        return { status: 'imputed', note: 'No year data — defaulted to floor (10)' };
      }
      return { status: 'real', note: null };
    }
    case 'provenanceConfidence': {
      if (globalContext?.usedFallback) {
        return { status: 'degraded', note: 'Fallback source used' };
      }
      return { status: 'real', note: null };
    }
    default:
      return { status: 'real', note: null };
  }
}

const FACTOR_IDS = [
  'clinicalImpact',
  'uncertaintyReduction',
  'feasibility',
  'freshness',
  'provenanceConfidence',
];

export function classifyConfidence(opportunity, globalContext) {
  const perFactor = {};
  let nonRealCount = 0;

  for (const factorId of FACTOR_IDS) {
    const result = classifyFactor(factorId, opportunity, globalContext);
    perFactor[factorId] = result;
    if (result.status !== 'real') nonRealCount += 1;
  }

  let tier;
  if (nonRealCount === 0) tier = 'high';
  else if (nonRealCount <= 2) tier = 'moderate';
  else tier = 'low';

  return {
    tier,
    tierLabel: TIER_LABELS[tier],
    perFactor,
  };
}
