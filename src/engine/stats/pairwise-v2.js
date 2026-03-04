function ensureFiniteNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Expected finite number for ${label}`);
  }
  return n;
}

function inverseNormalCdf(p) {
  if (!(p > 0 && p < 1)) {
    throw new Error(`inverseNormalCdf requires 0<p<1, got ${p}`);
  }
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q;
  let r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  q = p - 0.5;
  r = q * q;
  return (
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function tQuantile(p, df) {
  if (!(p > 0 && p < 1)) {
    throw new Error(`tQuantile requires 0<p<1, got ${p}`);
  }
  if (!Number.isFinite(df) || df <= 0) {
    return inverseNormalCdf(p);
  }
  const z = inverseNormalCdf(p);
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;
  const g1 = (z3 + z) / (4 * df);
  const g2 = (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df);
  const g3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df * df * df);
  return z + g1 + g2 + g3;
}

function chiSquareQuantile(p, df) {
  if (!(p > 0 && p < 1)) {
    throw new Error(`chiSquareQuantile requires 0<p<1, got ${p}`);
  }
  if (!Number.isFinite(df) || df <= 0) {
    throw new Error(`chiSquareQuantile requires df>0, got ${df}`);
  }
  const z = inverseNormalCdf(p);
  const a = 2 / (9 * df);
  const x = df * (1 - a + z * Math.sqrt(a)) ** 3;
  return Math.max(0, x);
}

function weightedMean(values, weights) {
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    numerator += values[i] * weights[i];
    denominator += weights[i];
  }
  return denominator > 0 ? numerator / denominator : NaN;
}

function sumSquaredResiduals(values, weights, mean) {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const diff = values[i] - mean;
    total += weights[i] * diff * diff;
  }
  return total;
}

function remlLogLikelihood(tau2, yi, vi) {
  if (tau2 < 0) return -Infinity;
  const wi = vi.map((v) => 1 / (v + tau2));
  const mu = weightedMean(yi, wi);
  const rss = sumSquaredResiduals(yi, wi, mu);
  const logDet = vi.reduce((acc, v) => acc + Math.log(v + tau2), 0);
  const sumW = wi.reduce((acc, v) => acc + v, 0);
  if (!(sumW > 0)) return -Infinity;
  return -0.5 * (logDet + Math.log(sumW) + rss);
}

function estimateTau2Reml(yi, vi) {
  const k = yi.length;
  if (k <= 1) return 0;

  const meanY = yi.reduce((acc, v) => acc + v, 0) / k;
  const varianceY =
    yi.reduce((acc, v) => acc + (v - meanY) * (v - meanY), 0) / Math.max(1, k - 1);
  const meanVi = vi.reduce((acc, v) => acc + v, 0) / k;
  const maxVi = Math.max(...vi);

  let hi = Math.max(1, varianceY * 10, meanVi * 20, maxVi * 10, 1e-6);
  let lo = 0;
  let fLo = remlLogLikelihood(lo, yi, vi);
  let fHi = remlLogLikelihood(hi, yi, vi);
  for (let i = 0; i < 12; i += 1) {
    if (fHi <= fLo) break;
    hi *= 2;
    fHi = remlLogLikelihood(hi, yi, vi);
  }

  const phi = (1 + Math.sqrt(5)) / 2;
  let a = lo;
  let b = hi;
  let c = b - (b - a) / phi;
  let d = a + (b - a) / phi;
  let fc = remlLogLikelihood(c, yi, vi);
  let fd = remlLogLikelihood(d, yi, vi);

  for (let iter = 0; iter < 120; iter += 1) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - (b - a) / phi;
      fc = remlLogLikelihood(c, yi, vi);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + (b - a) / phi;
      fd = remlLogLikelihood(d, yi, vi);
    }
  }

  const tau2 = (a + b) / 2;
  const llTau = remlLogLikelihood(tau2, yi, vi);
  return llTau >= fLo ? Math.max(0, tau2) : 0;
}

function qProfileBounds(yi, vi, alpha, df) {
  if (df <= 0) return { lower: null, upper: null };
  const targetLower = chiSquareQuantile(alpha / 2, df);
  const targetUpper = chiSquareQuantile(1 - alpha / 2, df);
  const qAt = (tau2) => {
    const wi = vi.map((v) => 1 / (v + tau2));
    const mu = weightedMean(yi, wi);
    return sumSquaredResiduals(yi, wi, mu);
  };

  const qAtZero = qAt(0);
  const findRoot = (target) => {
    let lo = 0;
    let hi = 1;
    let qHi = qAt(hi);
    for (let i = 0; i < 50 && qHi > target; i += 1) {
      hi *= 2;
      qHi = qAt(hi);
    }
    if (qHi > target) return null;
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2;
      const qMid = qAt(mid);
      if (qMid > target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const lower = qAtZero <= targetUpper ? 0 : findRoot(targetUpper);
  const upper = qAtZero <= targetLower ? 0 : findRoot(targetLower);
  return { lower, upper };
}

function applyMultiArmCorrection(studies) {
  const counts = new Map();
  for (const row of studies) {
    const key = String(row.studyId ?? '');
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return studies.map((row) => {
    const count = counts.get(String(row.studyId ?? '')) ?? 1;
    const correctedVi = count > 1 ? row.vi * count : row.vi;
    return { ...row, correctedVi, multiArmFactor: count };
  });
}

function computeClusterRobustVariance(yi, wi, clusterIds, alpha) {
  const sumW = wi.reduce((acc, v) => acc + v, 0);
  if (!(sumW > 0)) return { available: false, reason: 'invalid_weights' };

  const mu = weightedMean(yi, wi);
  const clusters = new Map();
  for (let i = 0; i < yi.length; i += 1) {
    const key = String(clusterIds[i] ?? `cluster_${i + 1}`);
    const residual = yi[i] - mu;
    const weightedResidual = wi[i] * residual;
    clusters.set(key, (clusters.get(key) ?? 0) + weightedResidual);
  }

  const g = clusters.size;
  const n = yi.length;
  if (g < 2) return { available: false, reason: 'fewer_than_two_clusters' };

  let meat = 0;
  for (const value of clusters.values()) {
    meat += value * value;
  }
  const varCr0 = meat / (sumW * sumW);
  const correction = (g / (g - 1)) * ((n - 1) / Math.max(1, n - 1));
  const varCr1 = varCr0 * correction;
  const seCr1 = Math.sqrt(Math.max(0, varCr1));
  const tCrit = tQuantile(1 - alpha / 2, g - 1);
  return {
    available: true,
    clusters: g,
    varCr0,
    varCr1,
    seCr1,
    ciLower: mu - tCrit * seCr1,
    ciUpper: mu + tCrit * seCr1,
  };
}

function roundNumber(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

export function runPairwiseV2(rawStudies, options = {}) {
  if (!Array.isArray(rawStudies) || rawStudies.length === 0) {
    throw new Error('runPairwiseV2 requires at least one study');
  }
  const alpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 0.05;
  const applyMultiArm = options.multiArmCorrection !== false;
  const studies = rawStudies.map((row, index) => {
    const yi = ensureFiniteNumber(row?.yi, `studies[${index}].yi`);
    const vi = ensureFiniteNumber(row?.vi, `studies[${index}].vi`);
    if (!(vi > 0)) throw new Error(`studies[${index}].vi must be > 0`);
    return {
      studyId: String(row?.studyId ?? `study_${index + 1}`),
      clusterId: String(row?.clusterId ?? row?.studyId ?? `cluster_${index + 1}`),
      yi,
      vi,
    };
  });

  const adjusted = applyMultiArm ? applyMultiArmCorrection(studies) : studies.map((s) => ({ ...s, correctedVi: s.vi, multiArmFactor: 1 }));
  const yi = adjusted.map((s) => s.yi);
  const vi = adjusted.map((s) => ensureFiniteNumber(s.correctedVi, 'correctedVi'));
  const k = yi.length;
  const df = Math.max(1, k - 1);

  const wiFixed = vi.map((v) => 1 / v);
  const muFixed = weightedMean(yi, wiFixed);
  const q = sumSquaredResiduals(yi, wiFixed, muFixed);
  const i2 = q > 0 ? Math.max(0, (q - (k - 1)) / q) : 0;
  const h2 = k > 1 ? q / (k - 1) : 1;

  const tau2 = estimateTau2Reml(yi, vi);
  const wiRandom = vi.map((v) => 1 / (v + tau2));
  const muRandom = weightedMean(yi, wiRandom);
  const sumWRandom = wiRandom.reduce((acc, v) => acc + v, 0);
  const seClassic = Math.sqrt(1 / sumWRandom);
  const hkScale = k > 1 ? sumSquaredResiduals(yi, wiRandom, muRandom) / (k - 1) : 1;
  const seHksj = Math.sqrt(Math.max(0, hkScale)) * seClassic;
  const tCrit = tQuantile(1 - alpha / 2, df);
  const ciHksj = {
    lower: muRandom - tCrit * seHksj,
    upper: muRandom + tCrit * seHksj,
  };

  const piDf = Math.max(1, k - 2);
  const tCritPi = tQuantile(1 - alpha / 2, piDf);
  const sePrediction = Math.sqrt(Math.max(0, tau2 + seClassic * seClassic));
  const predictionInterval = {
    lower: muRandom - tCritPi * sePrediction,
    upper: muRandom + tCritPi * sePrediction,
  };

  const tau2QProfile = qProfileBounds(yi, vi, alpha, k - 1);
  const robust = computeClusterRobustVariance(
    yi,
    wiRandom,
    adjusted.map((s) => s.clusterId),
    alpha,
  );

  return {
    schemaVersion: 'analysis_result.v2',
    model: 'random_effects_reml_hksj',
    input: {
      studyCount: k,
      alpha,
      multiArmCorrectionApplied: applyMultiArm,
      dependentEffectHandling: robust.available ? 'cluster_robust_cr1' : 'none',
    },
    pooled: {
      estimate: roundNumber(muRandom),
      seClassic: roundNumber(seClassic),
      seHksj: roundNumber(seHksj),
      ciHksj: {
        lower: roundNumber(ciHksj.lower),
        upper: roundNumber(ciHksj.upper),
      },
      predictionInterval: {
        lower: roundNumber(predictionInterval.lower),
        upper: roundNumber(predictionInterval.upper),
      },
    },
    heterogeneity: {
      q: roundNumber(q),
      i2: roundNumber(i2, 6),
      h2: roundNumber(h2, 6),
      tau2: roundNumber(tau2),
      tau2QProfile: {
        lower: tau2QProfile.lower == null ? null : roundNumber(tau2QProfile.lower),
        upper: tau2QProfile.upper == null ? null : roundNumber(tau2QProfile.upper),
      },
    },
    robustVariance: robust.available
      ? {
          available: true,
          clusters: robust.clusters,
          seCr1: roundNumber(robust.seCr1),
          ciCr1: {
            lower: roundNumber(robust.ciLower),
            upper: roundNumber(robust.ciUpper),
          },
        }
      : {
          available: false,
          reason: robust.reason,
        },
    adjustedStudies: adjusted.map((row) => ({
      studyId: row.studyId,
      clusterId: row.clusterId,
      yi: roundNumber(row.yi),
      viOriginal: roundNumber(row.vi),
      viAdjusted: roundNumber(row.correctedVi),
      multiArmFactor: row.multiArmFactor,
    })),
  };
}

