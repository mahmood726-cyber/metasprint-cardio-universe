import { buildOpportunities } from './opportunity-builder.js';
import {
  clinicalImpact,
  uncertaintyReduction,
  feasibility,
  freshness,
  provenanceConfidence,
} from './factor-computations.js';
import { compositeScore, classifyPriority } from './composite-scorer.js';

export { DEFAULT_WEIGHTS, normalizeWeights } from './composite-scorer.js';

function scoreOpportunity(opp, weights, globalContext) {
  const factors = {
    clinicalImpact: clinicalImpact({
      totalEnrollment: opp.totalEnrollment,
      endpointDomainId: opp.endpointDomainId,
    }),
    uncertaintyReduction: uncertaintyReduction({
      trialCount: opp.trialCount,
      recentTrials: opp.recentTrials,
    }),
    feasibility: feasibility({
      trialCount: opp.trialCount,
      yearRange: opp.yearRange,
      sourceCount: opp.sourceCount,
    }),
    freshness: freshness({
      maxYear: Array.isArray(opp.yearRange) ? opp.yearRange[1] : null,
    }),
    provenanceConfidence: provenanceConfidence({
      sourceCount: opp.sourceCount,
      usedFallback: Boolean(globalContext?.usedFallback),
    }),
  };

  const score = compositeScore(factors, weights);
  const priority = classifyPriority(score);

  return { ...opp, factors, compositeScore: score, score, priority };
}

export function buildAndScoreOpportunities(trials, matrixSummary, weights, globalContext) {
  const rawOpportunities = buildOpportunities(trials, matrixSummary);
  const scored = rawOpportunities.map((opp) => scoreOpportunity(opp, weights, globalContext));
  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  return scored;
}
