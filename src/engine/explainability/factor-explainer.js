const ENDPOINT_BOOSTS = {
  mace: 15,
  mortality: 15,
  hf: 5,
  renal: 5,
  safety: -10,
  frailty: 0,
  other: -10,
};

const ENDPOINT_LABELS = {
  mace: 'MACE',
  mortality: 'Mortality',
  hf: 'Heart Failure',
  renal: 'Renal',
  safety: 'Safety',
  frailty: 'Frailty',
  other: 'Other',
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveTrialRef(trialId, trialById) {
  const trial = trialById.get(String(trialId));
  if (!trial) return { trialId: String(trialId), label: String(trialId), href: null, year: null };

  if (trial.nctId) {
    return {
      trialId: String(trialId),
      label: trial.nctId,
      href: `https://clinicaltrials.gov/study/${encodeURIComponent(trial.nctId)}`,
      year: trial.year ?? null,
    };
  }
  if (trial.pmid) {
    return {
      trialId: String(trialId),
      label: `PMID ${trial.pmid}`,
      href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(trial.pmid)}/`,
      year: trial.year ?? null,
    };
  }
  if (trial.doi) {
    return {
      trialId: String(trialId),
      label: `DOI ${trial.doi}`,
      href: `https://doi.org/${encodeURIComponent(trial.doi)}`,
      year: trial.year ?? null,
    };
  }

  return { trialId: String(trialId), label: String(trialId), href: null, year: trial.year ?? null };
}

function buildTrialRefs(trialIds, trials) {
  if (!Array.isArray(trialIds) || trialIds.length === 0) return [];
  const trialById = new Map();
  for (const trial of trials ?? []) {
    if (trial?.trialId) trialById.set(String(trial.trialId), trial);
  }
  return trialIds.map((id) => resolveTrialRef(id, trialById));
}

function explainClinicalImpact(opp, score) {
  const enrollment = num(opp.totalEnrollment);
  const domain = opp.endpointDomainId ?? 'other';
  const boost = ENDPOINT_BOOSTS[domain] ?? 0;
  const domainLabel = ENDPOINT_LABELS[domain] ?? domain;
  const boostSign = boost >= 0 ? '+' : '';
  if (enrollment <= 0) {
    return `${score} = endpoint boost only (${boostSign}${boost} ${domainLabel}). No enrollment data.`;
  }
  return `${score} = log2(${enrollment} / 100) x 12 ${boostSign} ${boost} (${domainLabel} boost). ${num(opp.trialCount)} trials, ${enrollment.toLocaleString()} enrolled.`;
}

function explainUncertaintyReduction(opp, score) {
  const count = num(opp.trialCount);
  const recent = num(opp.recentTrials);
  const recencyMult = count === 0 ? 0.6 : recent > 0 ? 1.0 : 0.6;
  return `${score} = bell curve at ${count} trials (peak 5) x ${recencyMult} recency. ${recent} of ${count} in last 3y.`;
}

function explainFeasibility(opp, score) {
  const count = num(opp.trialCount);
  if (count < 2) {
    return `${score} = 0 (fewer than 2 trials required for pooling). ${count} trial(s) available.`;
  }
  const trialBase = count >= 3 ? 80 : 60;
  const yearRange = Array.isArray(opp.yearRange) ? opp.yearRange : [null, null];
  const minYear = num(yearRange[0]);
  const maxYear = num(yearRange[1]);
  const yearSpan = maxYear > minYear ? maxYear - minYear : 0;
  const yearPenalty = Math.max(0.5, 1.0 - Math.max(0, yearSpan - 10) * 0.05);
  const sources = Math.max(1, num(opp.sourceCount));
  const sourceBonus = 1.0 + Math.min(0.25, (sources - 1) * 0.125);
  return `${score} = base ${trialBase} x ${yearPenalty.toFixed(2)} year-range x ${sourceBonus.toFixed(3)} multi-source. ${count} trials, ${yearSpan}y span, ${sources} sources.`;
}

function explainFreshness(opp, score) {
  const yearRange = Array.isArray(opp.yearRange) ? opp.yearRange : [null, null];
  const maxYear = yearRange[1];
  if (!Number.isFinite(maxYear)) {
    return `${score} = floor (10). No year data available.`;
  }
  const currentYear = new Date().getFullYear();
  const age = currentYear - maxYear;
  return `${score} = 100 - ${age} x 15. Most recent trial: ${maxYear}.`;
}

function explainProvenanceConfidence(opp, score) {
  const sources = Math.max(0, num(opp.sourceCount));
  let sourceBase;
  if (sources >= 3) sourceBase = 100;
  else if (sources === 2) sourceBase = 75;
  else sourceBase = 50;
  const penalty = score < sourceBase ? sourceBase - score : 0;
  return `${score} = ${sourceBase} (${sources} source(s)) - ${penalty} fallback penalty.`;
}

const EXPLAINERS = {
  clinicalImpact: explainClinicalImpact,
  uncertaintyReduction: explainUncertaintyReduction,
  feasibility: explainFeasibility,
  freshness: explainFreshness,
  provenanceConfidence: explainProvenanceConfidence,
};

export function explainFactor(factorId, opportunity, factorScore, trials) {
  const explain = EXPLAINERS[factorId];
  const text = explain ? explain(opportunity, factorScore) : `${factorScore} (no explanation available)`;
  const trialRefs = buildTrialRefs(opportunity?.trialIds, trials);
  return { text, trialRefs };
}
