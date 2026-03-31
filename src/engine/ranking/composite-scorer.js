export const DEFAULT_WEIGHTS = {
  clinicalImpact: 0.30,
  uncertaintyReduction: 0.25,
  feasibility: 0.20,
  freshness: 0.15,
  provenanceConfidence: 0.10,
};

export function normalizeWeights(rawWeights) {
  const entries = Object.entries(rawWeights);
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, Number(value) || 0), 0);

  if (total === 0) {
    const equal = 1 / entries.length;
    return Object.fromEntries(entries.map(([key]) => [key, equal]));
  }

  return Object.fromEntries(
    entries.map(([key, value]) => [key, Math.max(0, Number(value) || 0) / total]),
  );
}

export function compositeScore(factors, weights) {
  let sum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const factor = Number(factors[key]) || 0;
    sum += factor * weight;
  }
  return Math.round(sum * 10) / 10;
}

export function classifyPriority(score) {
  if (score >= 75) return 'high';
  if (score >= 50) return 'moderate';
  return 'low';
}
