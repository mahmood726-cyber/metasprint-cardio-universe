const ENDPOINT_BOOSTS = {
  mace: 15,
  mortality: 15,
  hf: 5,
  renal: 5,
  safety: -10,
  frailty: 0,
  other: -10,
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function clinicalImpact({ totalEnrollment, endpointDomainId }) {
  const enrollment = Number.isFinite(totalEnrollment) ? Math.max(0, totalEnrollment) : 0;
  const boost = ENDPOINT_BOOSTS[endpointDomainId] ?? 0;
  if (enrollment <= 0) return clamp(boost);
  const base = Math.log2(enrollment / 100) * 12;
  return clamp(Math.round(base + boost));
}

export function uncertaintyReduction({ trialCount, recentTrials }) {
  const count = Number.isFinite(trialCount) ? Math.max(0, trialCount) : 0;
  const recent = Number.isFinite(recentTrials) ? Math.max(0, recentTrials) : 0;
  const bell = Math.exp(-0.5 * Math.pow((count - 5) / 4, 2)) * 100;
  const recencyMultiplier = count === 0 ? 0.6 : recent > 0 ? 1.0 : 0.6;
  return clamp(Math.round(bell * recencyMultiplier));
}

export function feasibility({ trialCount, yearRange, sourceCount }) {
  const count = Number.isFinite(trialCount) ? Math.max(0, trialCount) : 0;
  if (count < 2) return 0;
  const trialBase = count >= 3 ? 80 : 60;
  const years = Array.isArray(yearRange) && yearRange.length === 2
    ? Math.abs((yearRange[1] ?? 0) - (yearRange[0] ?? 0))
    : 0;
  const yearPenalty = Math.max(0.5, 1.0 - Math.max(0, years - 10) * 0.05);
  const sources = Number.isFinite(sourceCount) ? Math.max(1, sourceCount) : 1;
  const sourceBonus = 1.0 + Math.min(0.25, (sources - 1) * 0.125);
  return clamp(Math.round(trialBase * yearPenalty * sourceBonus));
}

export function freshness({ maxYear }) {
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(maxYear)) return 10;
  const age = currentYear - maxYear;
  return clamp(Math.round(100 - age * 15), 10, 100);
}

export function provenanceConfidence({ sourceCount, usedFallback }) {
  const sources = Number.isFinite(sourceCount) ? Math.max(0, sourceCount) : 0;
  let base;
  if (sources >= 3) base = 100;
  else if (sources === 2) base = 75;
  else base = 50;
  const penalty = usedFallback ? 30 : 0;
  return clamp(base - penalty);
}
