function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value) {
  const tokens = normalizeText(value)
    .split(' ')
    .filter((t) => t.length >= 3);
  return new Set(tokens);
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function safeYear(value) {
  const year = Number(value);
  return Number.isFinite(year) ? year : null;
}

function yearDistanceScore(a, b) {
  const ya = safeYear(a);
  const yb = safeYear(b);
  if (ya == null || yb == null) return 0;
  const delta = Math.abs(ya - yb);
  if (delta === 0) return 0.15;
  if (delta === 1) return 0.1;
  if (delta <= 2) return 0.05;
  return 0;
}

function enrollmentSimilarityScore(a, b) {
  const ea = Number(a?.enrollment ?? 0);
  const eb = Number(b?.enrollment ?? 0);
  if (!Number.isFinite(ea) || !Number.isFinite(eb) || ea <= 0 || eb <= 0) return 0;
  const ratio = Math.min(ea, eb) / Math.max(ea, eb);
  if (ratio >= 0.8) return 0.08;
  if (ratio >= 0.6) return 0.05;
  if (ratio >= 0.4) return 0.02;
  return 0;
}

function sameValue(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export function scoreIdentityPair(a, b) {
  const reasons = [];

  if (sameValue(a.nctId, b.nctId)) {
    return { score: 0.99, duplicate: true, reasons: ['exact_nct_id'] };
  }
  if (sameValue(a.doi, b.doi)) {
    return { score: 0.97, duplicate: true, reasons: ['exact_doi'] };
  }
  if (sameValue(a.pmid, b.pmid)) {
    return { score: 0.95, duplicate: true, reasons: ['exact_pmid'] };
  }

  let score = 0;
  const titleSimilarity = jaccard(tokenSet(a.title), tokenSet(b.title));
  if (titleSimilarity >= 0.92) {
    score += 0.72;
    reasons.push('title_similarity_very_high');
  } else if (titleSimilarity >= 0.82) {
    score += 0.58;
    reasons.push('title_similarity_high');
  } else if (titleSimilarity >= 0.7) {
    score += 0.42;
    reasons.push('title_similarity_moderate');
  }

  const yearScore = yearDistanceScore(a.year, b.year);
  if (yearScore > 0) {
    score += yearScore;
    reasons.push('year_alignment');
  }

  const enrollmentScore = enrollmentSimilarityScore(a, b);
  if (enrollmentScore > 0) {
    score += enrollmentScore;
    reasons.push('enrollment_similarity');
  }

  if (sameValue(a.subcategoryId, b.subcategoryId) && a.subcategoryId != null) {
    score += 0.05;
    reasons.push('subcategory_alignment');
  }

  if (sameValue(a.source, b.source)) {
    score -= 0.05;
    reasons.push('same_source_penalty');
  }

  const duplicate = score >= 0.85;
  return {
    score: Number(Math.max(0, Math.min(0.99, score)).toFixed(3)),
    duplicate,
    reasons,
  };
}
