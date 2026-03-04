function ensureFiniteNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Expected finite number for ${label}`);
  }
  return n;
}

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const p =
    1 -
    d *
      ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530) *
      t;
  return z >= 0 ? p : 1 - p;
}

function chiSquareSurvivalApprox(q, df) {
  if (!Number.isFinite(q) || !Number.isFinite(df) || df <= 0) return null;
  if (q <= 0) return 1;
  const z =
    (Math.cbrt(q / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

function roundNumber(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function hashStringToSeed(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(rawSeed) {
  if (rawSeed == null) return 20260228;
  const asNumber = Number(rawSeed);
  if (Number.isFinite(asNumber)) return (Math.floor(asNumber) >>> 0);
  return hashStringToSeed(rawSeed);
}

function createMulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildZeroMatrix(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

function invertMatrix(matrix) {
  const n = matrix.length;
  if (n === 0) return [];
  const aug = buildZeroMatrix(n, n * 2);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) aug[i][j] = matrix[i][j];
    aug[i][n + i] = 1;
  }

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let pivotAbs = Math.abs(aug[pivotRow][col]);
    for (let r = col + 1; r < n; r += 1) {
      const candidateAbs = Math.abs(aug[r][col]);
      if (candidateAbs > pivotAbs) {
        pivotAbs = candidateAbs;
        pivotRow = r;
      }
    }
    if (!(pivotAbs > 1e-12)) return null;
    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivot = aug[col][col];
    for (let c = 0; c < n * 2; c += 1) aug[col][c] /= pivot;

    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < n * 2; c += 1) {
        aug[r][c] -= factor * aug[col][c];
      }
    }
  }

  const inv = buildZeroMatrix(n, n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      inv[i][j] = aug[i][n + j];
    }
  }
  return inv;
}

function choleskyDecomposition(matrix) {
  const n = matrix.length;
  const lower = buildZeroMatrix(n, n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) {
        sum -= lower[i][k] * lower[j][k];
      }
      if (i === j) {
        if (sum <= 0) return null;
        lower[i][j] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }
  return lower;
}

function sampleStandardNormalPair(random) {
  const u1 = Math.max(Number.EPSILON, random());
  const u2 = random();
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

function sampleStandardNormals(n, random) {
  const out = [];
  while (out.length < n) {
    const [a, b] = sampleStandardNormalPair(random);
    out.push(a);
    if (out.length < n) out.push(b);
  }
  return out;
}

function fitWls(studies, treatmentIndex, referenceTreatment, tau2) {
  const p = treatmentIndex.size;
  const rows = [];
  const y = [];
  const w = [];
  for (const study of studies) {
    const row = Array(p).fill(0);
    if (study.treatmentA !== referenceTreatment) {
      row[treatmentIndex.get(study.treatmentA)] = 1;
    }
    if (study.treatmentB !== referenceTreatment) {
      row[treatmentIndex.get(study.treatmentB)] -= 1;
    }
    rows.push(row);
    y.push(study.yi);
    w.push(1 / (study.vi + tau2));
  }

  const xwx = buildZeroMatrix(p, p);
  const xwy = Array(p).fill(0);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const wi = w[i];
    for (let a = 0; a < p; a += 1) {
      xwy[a] += wi * row[a] * y[i];
      for (let b = 0; b < p; b += 1) {
        xwx[a][b] += wi * row[a] * row[b];
      }
    }
  }

  const inv = invertMatrix(xwx);
  if (!inv) return null;

  const beta = Array(p).fill(0);
  for (let i = 0; i < p; i += 1) {
    let sum = 0;
    for (let j = 0; j < p; j += 1) sum += inv[i][j] * xwy[j];
    beta[i] = sum;
  }

  const residuals = [];
  let q = 0;
  for (let i = 0; i < rows.length; i += 1) {
    let fitted = 0;
    for (let j = 0; j < p; j += 1) fitted += rows[i][j] * beta[j];
    const resid = y[i] - fitted;
    residuals.push(resid);
    q += w[i] * resid * resid;
  }

  return {
    rows,
    y,
    w,
    beta,
    covariance: inv,
    q,
    df: Math.max(1, rows.length - p),
    residuals,
  };
}

function estimateTau2(studies, treatmentIndex, referenceTreatment) {
  let tau2 = 0;
  let fit = null;
  for (let iter = 0; iter < 50; iter += 1) {
    fit = fitWls(studies, treatmentIndex, referenceTreatment, tau2);
    if (!fit) {
      tau2 = 0;
      break;
    }
    const sumW = fit.w.reduce((acc, value) => acc + value, 0);
    const df = fit.df;
    const nextTau2 = fit.q > df && sumW > 0 ? Math.max(0, (fit.q - df) / sumW) : 0;
    if (Math.abs(nextTau2 - tau2) < 1e-9) {
      tau2 = nextTau2;
      break;
    }
    tau2 = nextTau2;
  }
  fit = fitWls(studies, treatmentIndex, referenceTreatment, tau2);
  if (!fit) {
    throw new Error('Failed to fit network model due to singular design matrix.');
  }
  return { tau2, fit };
}

function getEffectVsReference(treatment, referenceTreatment, treatmentIndex, beta) {
  if (treatment === referenceTreatment) return 0;
  return beta[treatmentIndex.get(treatment)];
}

function getVarVsReference(treatment, referenceTreatment, treatmentIndex, covariance) {
  if (treatment === referenceTreatment) return 0;
  const idx = treatmentIndex.get(treatment);
  return covariance[idx][idx];
}

function getCovBetween(a, b, referenceTreatment, treatmentIndex, covariance) {
  if (a === referenceTreatment || b === referenceTreatment) return 0;
  return covariance[treatmentIndex.get(a)][treatmentIndex.get(b)];
}

function estimatePairVariance(a, b, referenceTreatment, treatmentIndex, covariance) {
  const varA = getVarVsReference(a, referenceTreatment, treatmentIndex, covariance);
  const varB = getVarVsReference(b, referenceTreatment, treatmentIndex, covariance);
  const covAB = getCovBetween(a, b, referenceTreatment, treatmentIndex, covariance);
  return Math.max(0, varA + varB - 2 * covAB);
}

function buildDirectComparisons(studies, tau2) {
  const groups = new Map();
  for (const study of studies) {
    const key = [study.treatmentA, study.treatmentB].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(study);
  }

  const direct = new Map();
  for (const [key, rows] of groups.entries()) {
    let sumW = 0;
    let sumWY = 0;
    let significantCount = 0;
    let positiveCount = 0;
    for (const row of rows) {
      const w = 1 / (row.vi + tau2);
      sumW += w;
      sumWY += w * row.yi;
      const z = Math.abs(row.yi / Math.sqrt(row.vi));
      const p = Math.max(0, Math.min(1, 2 * (1 - normalCdf(z))));
      if (p < 0.05) significantCount += 1;
      if (row.yi > 0) positiveCount += 1;
    }
    const estimate = sumW > 0 ? sumWY / sumW : 0;
    direct.set(key, {
      key,
      treatmentA: rows[0].treatmentA,
      treatmentB: rows[0].treatmentB,
      estimate,
      variance: sumW > 0 ? 1 / sumW : Infinity,
      studyCount: rows.length,
      significantShare: rows.length > 0 ? significantCount / rows.length : 0,
      directionImbalance:
        rows.length > 0 ? Math.abs(positiveCount - (rows.length - positiveCount)) / rows.length : 0,
      rows,
    });
  }
  return direct;
}

function toPairKey(a, b) {
  return [a, b].sort().join('|');
}

function buildRoBNma(directComparisons, treatments, tau2) {
  const comparisons = [];
  const judgementRank = { low: 0, some_concerns: 1, high: 2 };
  let overall = 'low';
  let totalWeight = 0;
  for (const direct of directComparisons.values()) {
    const weight = direct.variance > 0 && Number.isFinite(direct.variance) ? 1 / direct.variance : 0;
    totalWeight += weight;
    let judgement = 'low';
    if (direct.studyCount <= 1 || direct.significantShare > 0.6) judgement = 'some_concerns';
    if (
      direct.studyCount >= 2 &&
      direct.studyCount <= 3 &&
      direct.significantShare >= 0.85 &&
      direct.directionImbalance >= 0.85
    ) {
      judgement = 'high';
    }
    if (judgementRank[judgement] > judgementRank[overall]) overall = judgement;
    comparisons.push({
      pair: direct.key,
      treatmentA: direct.treatmentA,
      treatmentB: direct.treatmentB,
      studyCount: direct.studyCount,
      significantShare: roundNumber(direct.significantShare, 6),
      directionImbalance: roundNumber(direct.directionImbalance, 6),
      judgement,
      weight: roundNumber(weight, 6),
    });
  }

  const contributionSummary = [];
  const pairs = [];
  for (let i = 0; i < treatments.length; i += 1) {
    for (let j = i + 1; j < treatments.length; j += 1) {
      pairs.push([treatments[i], treatments[j]]);
    }
  }
  for (const [a, b] of pairs) {
    const pairKey = toPairKey(a, b);
    const direct = comparisons.find((item) => item.pair === pairKey);
    const baseContrib = [];
    for (const cmp of comparisons) {
      const baseShare = totalWeight > 0 ? cmp.weight / totalWeight : 0;
      baseContrib.push({
        pair: cmp.pair,
        contribution: baseShare,
      });
    }
    if (direct) {
      const directShare = 0.6;
      const remainder = 0.4;
      const others = baseContrib.filter((c) => c.pair !== pairKey);
      const otherSum = others.reduce((acc, c) => acc + c.contribution, 0);
      const adjusted = [
        { pair: pairKey, contribution: directShare },
        ...others.map((c) => ({
          pair: c.pair,
          contribution: otherSum > 0 ? (c.contribution / otherSum) * remainder : 0,
        })),
      ];
      contributionSummary.push({
        treatmentA: a,
        treatmentB: b,
        contributions: adjusted
          .map((c) => ({ pair: c.pair, contribution: roundNumber(c.contribution, 6) }))
          .sort((x, y) => y.contribution - x.contribution),
      });
    } else {
      contributionSummary.push({
        treatmentA: a,
        treatmentB: b,
        contributions: baseContrib
          .map((c) => ({ pair: c.pair, contribution: roundNumber(c.contribution, 6) }))
          .sort((x, y) => y.contribution - x.contribution),
      });
    }
  }

  return {
    framework: 'RoB NMA',
    overallJudgement: overall,
    assessedAt: new Date().toISOString(),
    assumptions: {
      model: 'comparison-level missing-evidence heuristic',
      tau2: roundNumber(tau2),
    },
    comparisons,
    contributionSummary,
  };
}

function rankUncertainty(
  treatments,
  referenceTreatment,
  treatmentIndex,
  beta,
  covariance,
  samples,
  random,
) {
  const p = beta.length;
  const lower = choleskyDecomposition(covariance);
  const fallbackStd = covariance.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const rankCounts = new Map();
  for (const treatment of treatments) {
    rankCounts.set(treatment, Array(treatments.length).fill(0));
  }

  for (let draw = 0; draw < samples; draw += 1) {
    const z = sampleStandardNormals(p, random);
    const betaSample = Array(p).fill(0);
    for (let i = 0; i < p; i += 1) {
      let perturbation = 0;
      if (lower) {
        for (let j = 0; j <= i; j += 1) {
          perturbation += lower[i][j] * z[j];
        }
      } else {
        perturbation = fallbackStd[i] * z[i];
      }
      betaSample[i] = beta[i] + perturbation;
    }

    const effects = treatments.map((treatment) => ({
      treatment,
      effect:
        treatment === referenceTreatment
          ? 0
          : betaSample[treatmentIndex.get(treatment)],
    }));
    effects.sort((a, b) => a.effect - b.effect || a.treatment.localeCompare(b.treatment));
    for (let rank = 0; rank < effects.length; rank += 1) {
      rankCounts.get(effects[rank].treatment)[rank] += 1;
    }
  }

  const rankProbabilities = [];
  const expectedRanks = [];
  const sucraRows = [];
  const rankVarianceRows = [];
  for (const treatment of treatments) {
    const counts = rankCounts.get(treatment);
    const probs = counts.map((count) => (samples > 0 ? count / samples : 0));
    const expectedRank = probs.reduce((acc, pRank, i) => acc + (i + 1) * pRank, 0);
    const rankVariance = probs.reduce((acc, pRank, i) => {
      const rank = i + 1;
      const diff = rank - expectedRank;
      return acc + pRank * diff * diff;
    }, 0);
    const k = treatments.length;
    const sucra =
      k > 1
        ? probs.reduce((acc, pRank, i) => acc + (k - (i + 1)) * pRank, 0) / (k - 1)
        : 1;
    rankProbabilities.push({
      treatment,
      probabilities: probs.map((pRank) => roundNumber(pRank, 6)),
    });
    expectedRanks.push({
      treatment,
      expectedRank: roundNumber(expectedRank, 6),
    });
    rankVarianceRows.push({
      treatment,
      rankVariance: roundNumber(rankVariance, 6),
    });
    sucraRows.push({
      treatment,
      sucra: roundNumber(sucra, 6),
    });
  }

  const top = rankProbabilities
    .map((row) => ({
      treatment: row.treatment,
      probability: row.probabilities[0] ?? 0,
    }))
    .sort((a, b) => b.probability - a.probability || a.treatment.localeCompare(b.treatment))[0];

  const sucraValues = sucraRows.map((row) => row.sucra);
  const sucraMean =
    sucraValues.length > 0
      ? sucraValues.reduce((acc, value) => acc + value, 0) / sucraValues.length
      : 0;
  const sucraVariance =
    sucraValues.length > 0
      ? sucraValues.reduce((acc, value) => {
          const diff = value - sucraMean;
          return acc + diff * diff;
        }, 0) / sucraValues.length
      : 0;
  const k = treatments.length;
  const pothMaxVariance = k > 1 ? (k + 1) / (12 * (k - 1)) : 0;
  const poth =
    pothMaxVariance > 0
      ? Math.max(0, Math.min(1, sucraVariance / pothMaxVariance))
      : 0;

  const top3 = [...expectedRanks]
    .sort((a, b) => a.expectedRank - b.expectedRank || a.treatment.localeCompare(b.treatment))
    .slice(0, Math.min(3, expectedRanks.length))
    .map((row) => row.treatment);
  const top3Sucra = sucraRows
    .filter((row) => top3.includes(row.treatment))
    .map((row) => row.sucra);
  const top3Mean =
    top3Sucra.length > 0
      ? top3Sucra.reduce((acc, value) => acc + value, 0) / top3Sucra.length
      : 0;
  const top3Var =
    top3Sucra.length > 0
      ? top3Sucra.reduce((acc, value) => {
          const diff = value - top3Mean;
          return acc + diff * diff;
        }, 0) / top3Sucra.length
      : 0;
  const m = top3Sucra.length;
  const top3MaxVariance = m > 1 ? (m + 1) / (12 * (m - 1)) : 0;
  const top3Poth =
    top3MaxVariance > 0
      ? Math.max(0, Math.min(1, top3Var / top3MaxVariance))
      : 0;

  return {
    samples,
    topTreatment: top.treatment,
    topTreatmentProbability: roundNumber(top.probability, 6),
    rankProbabilities,
    expectedRanks: expectedRanks.sort((a, b) => a.expectedRank - b.expectedRank),
    sucra: sucraRows.sort((a, b) => b.sucra - a.sucra),
    precision: {
      method: 'POTH',
      poth: roundNumber(poth, 6),
      pothTop3: roundNumber(top3Poth, 6),
      varianceSucra: roundNumber(sucraVariance, 6),
      maxVarianceSucra: roundNumber(pothMaxVariance, 6),
      averageRankVariance: roundNumber(
        rankVarianceRows.reduce((acc, row) => acc + row.rankVariance, 0) /
          Math.max(1, rankVarianceRows.length),
        6,
      ),
      rankVarianceByTreatment: rankVarianceRows.sort((a, b) => a.treatment.localeCompare(b.treatment)),
    },
  };
}

export function runNetworkV1(rawStudies, options = {}) {
  if (!Array.isArray(rawStudies) || rawStudies.length < 2) {
    throw new Error('runNetworkV1 requires at least two studies');
  }

  const alpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 0.05;
  const samples = Number.isFinite(Number(options.samples))
    ? Math.max(500, Math.floor(Number(options.samples)))
    : 3000;
  const rankSeed = normalizeSeed(options.rankSeed);
  const random = createMulberry32(rankSeed);

  const studies = rawStudies.map((study, index) => {
    const treatmentA = String(study?.treatmentA ?? '').trim();
    const treatmentB = String(study?.treatmentB ?? '').trim();
    if (!treatmentA || !treatmentB || treatmentA === treatmentB) {
      throw new Error(`Invalid treatments at studies[${index}]`);
    }
    return {
      studyId: String(study?.studyId ?? `study_${index + 1}`),
      treatmentA,
      treatmentB,
      yi: ensureFiniteNumber(study?.yi, `studies[${index}].yi`),
      vi: ensureFiniteNumber(study?.vi, `studies[${index}].vi`),
    };
  });

  for (const study of studies) {
    if (!(study.vi > 0)) throw new Error(`Study ${study.studyId} has non-positive variance.`);
  }

  const treatmentSet = new Set();
  for (const study of studies) {
    treatmentSet.add(study.treatmentA);
    treatmentSet.add(study.treatmentB);
  }
  const treatments = [...treatmentSet].sort();
  if (treatments.length < 3) {
    throw new Error('Network model requires at least 3 treatments.');
  }

  const referenceTreatment = String(options.referenceTreatment ?? treatments[0]);
  if (!treatmentSet.has(referenceTreatment)) {
    throw new Error(`Reference treatment '${referenceTreatment}' not present in studies.`);
  }
  const parameterTreatments = treatments.filter((treatment) => treatment !== referenceTreatment);
  const treatmentIndex = new Map();
  for (let i = 0; i < parameterTreatments.length; i += 1) {
    treatmentIndex.set(parameterTreatments[i], i);
  }

  const { tau2, fit } = estimateTau2(studies, treatmentIndex, referenceTreatment);
  const fixedFit = fitWls(studies, treatmentIndex, referenceTreatment, 0);
  if (!fixedFit) {
    throw new Error('Failed to fit fixed-effect model for multiplicative heterogeneity sensitivity.');
  }
  const phiRaw = fixedFit.df > 0 ? fixedFit.q / fixedFit.df : 1;
  const phi = Math.max(1, phiRaw);

  const directComparisons = buildDirectComparisons(studies, tau2);
  const roBNma = buildRoBNma(directComparisons, treatments, tau2);

  const effects = treatments.map((treatment) => {
    const estimate = getEffectVsReference(
      treatment,
      referenceTreatment,
      treatmentIndex,
      fit.beta,
    );
    const variance = getVarVsReference(
      treatment,
      referenceTreatment,
      treatmentIndex,
      fit.covariance,
    );
    const se = Math.sqrt(Math.max(0, variance));
    const z = 1.959963984540054;
    return {
      treatment,
      estimateVsReference: roundNumber(estimate),
      se: roundNumber(se),
      ci95: {
        lower: roundNumber(estimate - z * se),
        upper: roundNumber(estimate + z * se),
      },
    };
  });

  const pairwiseEstimates = [];
  const pairDiagnostics = [];
  for (let i = 0; i < treatments.length; i += 1) {
    for (let j = i + 1; j < treatments.length; j += 1) {
      const a = treatments[i];
      const b = treatments[j];
      const estimate =
        getEffectVsReference(a, referenceTreatment, treatmentIndex, fit.beta) -
        getEffectVsReference(b, referenceTreatment, treatmentIndex, fit.beta);
      const variance = estimatePairVariance(
        a,
        b,
        referenceTreatment,
        treatmentIndex,
        fit.covariance,
      );
      const se = Math.sqrt(Math.max(0, variance));
      const z = 1.959963984540054;

      const directKey = toPairKey(a, b);
      const direct = directComparisons.get(directKey);
      const directEstimate = direct ? direct.estimate : null;
      const directVariance = direct ? direct.variance : null;
      let inconsistencyFactor = null;
      let inconsistencySe = null;
      let inconsistencyP = null;
      if (direct) {
        inconsistencyFactor = direct.estimate - estimate;
        inconsistencySe = Math.sqrt(Math.max(0, direct.variance + variance));
        if (inconsistencySe > 0) {
          const zScore = Math.abs(inconsistencyFactor / inconsistencySe);
          inconsistencyP = 2 * (1 - normalCdf(zScore));
        }
        pairDiagnostics.push({
          treatmentA: a,
          treatmentB: b,
          directEstimate: roundNumber(direct.estimate),
          indirectEstimate: roundNumber(estimate),
          inconsistencyFactor: roundNumber(inconsistencyFactor),
          inconsistencySe: roundNumber(inconsistencySe),
          inconsistencyP: inconsistencyP == null ? null : roundNumber(inconsistencyP, 6),
          directStudyCount: direct.studyCount,
        });
      }

      pairwiseEstimates.push({
        treatmentA: a,
        treatmentB: b,
        estimate: roundNumber(estimate),
        se: roundNumber(se),
        ci95: {
          lower: roundNumber(estimate - z * se),
          upper: roundNumber(estimate + z * se),
        },
        directAvailable: Boolean(direct),
        directEstimate: directEstimate == null ? null : roundNumber(directEstimate),
        directVariance: directVariance == null ? null : roundNumber(directVariance),
        inconsistencyFactor:
          inconsistencyFactor == null ? null : roundNumber(inconsistencyFactor),
        inconsistencyP: inconsistencyP == null ? null : roundNumber(inconsistencyP, 6),
      });
    }
  }

  let globalQ = 0;
  for (const pair of pairDiagnostics) {
    const se = Number(pair.inconsistencySe);
    if (se > 0) {
      const zScore = Number(pair.inconsistencyFactor) / se;
      globalQ += zScore * zScore;
    }
  }
  const inconsistencyDf = Math.max(1, pairDiagnostics.length - (treatments.length - 1));
  const globalP = chiSquareSurvivalApprox(globalQ, inconsistencyDf);

  const heterogeneityDf = Math.max(1, fit.rows.length - parameterTreatments.length);
  const i2 = fit.q > 0 ? Math.max(0, (fit.q - heterogeneityDf) / fit.q) : 0;

  const ranking = rankUncertainty(
    treatments,
    referenceTreatment,
    treatmentIndex,
    fit.beta,
    fit.covariance,
    samples,
    random,
  );

  const multiplicativeEffects = treatments.map((treatment) => {
    const estimate = getEffectVsReference(
      treatment,
      referenceTreatment,
      treatmentIndex,
      fixedFit.beta,
    );
    const varianceFe = getVarVsReference(
      treatment,
      referenceTreatment,
      treatmentIndex,
      fixedFit.covariance,
    );
    const varianceMe = varianceFe * phi;
    const seMe = Math.sqrt(Math.max(0, varianceMe));
    const z = 1.959963984540054;
    return {
      treatment,
      estimateVsReference: roundNumber(estimate),
      se: roundNumber(seMe),
      ci95: {
        lower: roundNumber(estimate - z * seMe),
        upper: roundNumber(estimate + z * seMe),
      },
    };
  });

  return {
    schemaVersion: 'network_analysis.v1',
    model: 'nma_random_effects_wls',
    input: {
      studyCount: studies.length,
      treatmentCount: treatments.length,
      treatments,
      referenceTreatment,
      alpha,
      rankSamples: samples,
      rankSeed,
    },
    effects,
    pairwiseEstimates,
    heterogeneity: {
      tau2: roundNumber(tau2),
      q: roundNumber(fit.q),
      df: heterogeneityDf,
      i2: roundNumber(i2, 6),
    },
    inconsistency: {
      globalQ: roundNumber(globalQ),
      globalDf: inconsistencyDf,
      globalP: globalP == null ? null : roundNumber(globalP, 6),
      pairDiagnostics,
    },
    ranking,
    multiplicativeHeterogeneity: {
      model: 'nma_multiplicative_effect',
      phi: roundNumber(phi),
      qFixed: roundNumber(fixedFit.q),
      dfFixed: fixedFit.df,
      effects: multiplicativeEffects,
    },
    robNma: roBNma,
  };
}
