import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    fixturePath: 'reports/benchmarks/packs/v2/certainty_crosswalk.v1.json',
    requireLive: false,
    bootstrapSamples: 1000,
    bootstrapSeed: 20260228,
    maxDisagreements: 120,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.fixturePath = value;
      i += 1;
    } else if (arg === '--require-live') {
      options.requireLive = true;
    } else if (arg === '--bootstrap-samples') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.bootstrapSamples = Math.floor(value);
      i += 1;
    } else if (arg === '--bootstrap-seed') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value)) options.bootstrapSeed = Math.floor(value);
      i += 1;
    } else if (arg === '--max-disagreements') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.maxDisagreements = Math.floor(value);
      i += 1;
    }
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function toFixed(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function inRange(value, range) {
  if (range == null) return true;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  const min = Number(range.min);
  const max = Number(range.max);
  if (Number.isFinite(min) && n < min) return false;
  if (Number.isFinite(max) && n > max) return false;
  return true;
}

function checkRange(check, actual, expectedRange) {
  return {
    check,
    expected: expectedRange ?? null,
    actual: Number.isFinite(Number(actual)) ? toFixed(actual) : actual,
    passed: inRange(actual, expectedRange),
  };
}

function normalizeCategory(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (text === 'verylow') return 'very_low';
  if (text === 'very_low') return 'very_low';
  return text;
}

function createMatrix(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function agreementLabel(weightedKappa) {
  if (weightedKappa >= 0.8) return 'very_good';
  if (weightedKappa >= 0.6) return 'good';
  if (weightedKappa >= 0.4) return 'moderate';
  if (weightedKappa >= 0.2) return 'fair';
  return 'poor';
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
  const asNumber = Number(rawSeed);
  if (Number.isFinite(asNumber)) return Math.floor(asNumber) >>> 0;
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

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function computeWeightedKappa(matrix, n, k) {
  if (n <= 0 || k <= 1) return 0;
  const obs = createMatrix(k);
  const rowMarginal = Array(k).fill(0);
  const colMarginal = Array(k).fill(0);
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const value = matrix[i][j] / n;
      obs[i][j] = value;
      rowMarginal[i] += value;
      colMarginal[j] += value;
    }
  }

  let observedDisagreement = 0;
  let expectedDisagreement = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const weight = ((i - j) ** 2) / ((k - 1) ** 2);
      observedDisagreement += weight * obs[i][j];
      expectedDisagreement += weight * rowMarginal[i] * colMarginal[j];
    }
  }

  if (expectedDisagreement <= 0) return 1;
  const kappa = 1 - observedDisagreement / expectedDisagreement;
  return Math.max(-1, Math.min(1, kappa));
}

function computeMetricsFromPairs(
  pairs,
  categories,
  collectDetails = false,
  maxDisagreements = 120,
) {
  const k = categories.length;
  const matrix = createMatrix(k);
  let exactCount = 0;
  let adjacentCount = 0;
  let severeCount = 0;
  let totalDistance = 0;
  const disagreements = [];

  for (const pair of pairs) {
    const i = pair.gradeIndex;
    const j = pair.cinemaIndex;
    matrix[i][j] += 1;
    const distance = Math.abs(i - j);
    totalDistance += distance;
    if (distance === 0) exactCount += 1;
    if (distance <= 1) adjacentCount += 1;
    if (distance >= 2) severeCount += 1;
    if (collectDetails && distance > 0) {
      disagreements.push({
        comparisonId: pair.comparisonId,
        grade: pair.grade,
        cinema: pair.cinema,
        distance,
        severity: distance >= 2 ? 'severe' : 'adjacent',
      });
    }
  }

  const n = pairs.length;
  const weightedKappa = computeWeightedKappa(matrix, n, k);
  const exactAgreement = n > 0 ? exactCount / n : 0;
  const adjacentAgreement = n > 0 ? adjacentCount / n : 0;
  const meanDistance = n > 0 ? totalDistance / n : 0;
  const severeDisagreementRate = n > 0 ? severeCount / n : 0;

  const base = {
    comparisonCount: n,
    exactAgreement: toFixed(exactAgreement, 6),
    adjacentAgreement: toFixed(adjacentAgreement, 6),
    weightedKappa: toFixed(weightedKappa, 6),
    meanDistance: toFixed(meanDistance, 6),
    severeDisagreementCount: severeCount,
    severeDisagreementRate: toFixed(severeDisagreementRate, 6),
    agreementLabel: agreementLabel(weightedKappa),
    matrix,
  };

  if (!collectDetails) return base;

  const confusion = categories.map((grade, i) => {
    const row = { grade };
    for (let j = 0; j < categories.length; j += 1) {
      row[categories[j]] = matrix[i][j];
    }
    return row;
  });

  const transitionSummary = [];
  for (let i = 0; i < categories.length; i += 1) {
    for (let j = 0; j < categories.length; j += 1) {
      if (i === j) continue;
      const count = matrix[i][j];
      if (count <= 0) continue;
      transitionSummary.push({
        from: categories[i],
        to: categories[j],
        count,
        share: toFixed(n > 0 ? count / n : 0, 6),
      });
    }
  }
  transitionSummary.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  disagreements.sort((a, b) => b.distance - a.distance || a.comparisonId.localeCompare(b.comparisonId));
  const disagreementCount = disagreements.length;
  const disagreementsPreview = maxDisagreements > 0 ? disagreements.slice(0, maxDisagreements) : [];

  return {
    ...base,
    confusion,
    transitionSummary,
    disagreementCount,
    disagreementPreviewCount: disagreementsPreview.length,
    disagreementsTruncated: disagreementsPreview.length < disagreementCount,
    disagreements: disagreementsPreview,
  };
}

function bootstrapUncertainty(pairs, categories, samples, seed) {
  if (!Number.isFinite(samples) || samples <= 0) return null;
  if (!Array.isArray(pairs) || pairs.length < 2) return null;
  const n = pairs.length;
  const random = createMulberry32(normalizeSeed(seed));
  const kappaValues = [];
  const exactValues = [];
  const adjacentValues = [];
  const severeRateValues = [];

  for (let draw = 0; draw < samples; draw += 1) {
    const sampled = Array(n);
    for (let i = 0; i < n; i += 1) {
      const idx = Math.floor(random() * n);
      sampled[i] = pairs[idx];
    }
    const metrics = computeMetricsFromPairs(sampled, categories, false);
    kappaValues.push(Number(metrics.weightedKappa));
    exactValues.push(Number(metrics.exactAgreement));
    adjacentValues.push(Number(metrics.adjacentAgreement));
    severeRateValues.push(Number(metrics.severeDisagreementRate));
  }

  const ci = (values) => {
    const lower = percentile(values, 0.025);
    const upper = percentile(values, 0.975);
    if (lower == null || upper == null) return null;
    return {
      lower: toFixed(lower, 6),
      upper: toFixed(upper, 6),
      width: toFixed(upper - lower, 6),
    };
  };

  return {
    method: 'bootstrap_percentile',
    samples,
    seed: normalizeSeed(seed),
    weightedKappa: ci(kappaValues),
    exactAgreement: ci(exactValues),
    adjacentAgreement: ci(adjacentValues),
    severeDisagreementRate: ci(severeRateValues),
  };
}

function scenarioChecks(metrics, expected) {
  const checks = [];
  checks.push({
    check: 'min_comparisons',
    expected: Number(expected?.minComparisons ?? 0),
    actual: metrics.comparisonCount,
    passed: metrics.comparisonCount >= Number(expected?.minComparisons ?? 0),
  });
  checks.push(checkRange('exact_agreement', metrics.exactAgreement, expected?.exactAgreement));
  checks.push(checkRange('adjacent_agreement', metrics.adjacentAgreement, expected?.adjacentAgreement));
  checks.push(checkRange('weighted_kappa', metrics.weightedKappa, expected?.weightedKappa));
  checks.push({
    check: 'max_severe_disagreement',
    expected: Number(expected?.maxSevereDisagreement ?? Infinity),
    actual: metrics.severeDisagreementCount,
    passed: metrics.severeDisagreementCount <= Number(expected?.maxSevereDisagreement ?? Infinity),
  });
  if (expected?.maxMeanDistance != null) {
    checks.push({
      check: 'max_mean_distance',
      expected: Number(expected.maxMeanDistance),
      actual: toFixed(metrics.meanDistance, 6),
      passed: metrics.meanDistance <= Number(expected.maxMeanDistance),
    });
  }
  if (expected?.maxKappaCi95Width != null) {
    const width = toFiniteNumber(metrics?.uncertainty?.weightedKappa?.width);
    checks.push({
      check: 'max_kappa_ci95_width',
      expected: Number(expected.maxKappaCi95Width),
      actual: width == null ? null : toFixed(width, 6),
      passed: width != null && width <= Number(expected.maxKappaCi95Width),
    });
  }
  return checks;
}

function computeScenarioResult(scenario, categories, categoryToIndex, options) {
  const comparisons = Array.isArray(scenario?.comparisons) ? scenario.comparisons : [];
  const pairs = [];
  for (const row of comparisons) {
    const comparisonId = String(row?.comparisonId ?? '').trim() || `comparison_${pairs.length + 1}`;
    const grade = normalizeCategory(row?.grade);
    const cinema = normalizeCategory(row?.cinema);
    if (!categoryToIndex.has(grade)) {
      throw new Error(`Unknown GRADE category '${grade}' in scenario '${scenario?.scenarioId ?? 'unknown'}'.`);
    }
    if (!categoryToIndex.has(cinema)) {
      throw new Error(`Unknown CINeMA category '${cinema}' in scenario '${scenario?.scenarioId ?? 'unknown'}'.`);
    }
    pairs.push({
      comparisonId,
      grade,
      cinema,
      gradeIndex: categoryToIndex.get(grade),
      cinemaIndex: categoryToIndex.get(cinema),
    });
  }

  const metrics = computeMetricsFromPairs(pairs, categories, true, options.maxDisagreements);
  const uncertainty = bootstrapUncertainty(
    pairs,
    categories,
    options.bootstrapSamples,
    `${options.bootstrapSeed}:${scenario?.scenarioId ?? 'scenario'}`,
  );
  return {
    ...metrics,
    uncertainty,
    comparisonIds: pairs.map((pair) => pair.comparisonId),
  };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const fixturePath = path.isAbsolute(options.fixturePath) ? options.fixturePath : path.join(root, options.fixturePath);
if (!fs.existsSync(fixturePath)) {
  console.error(`Missing certainty crosswalk fixture: ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

const fixture = readJson(fixturePath);
const sourceMode = String(fixture?.sourceMode ?? 'synthetic_fixture');
if (options.requireLive && sourceMode !== 'live_extracted') {
  console.error(
    `Certainty crosswalk fixture must be live_extracted when --require-live is set. Got '${sourceMode}'.`,
  );
  process.exit(1);
}

const scenarios = Array.isArray(fixture?.scenarios) ? fixture.scenarios : [];
const rawCategories = Array.isArray(fixture?.categories) ? fixture.categories : [];
const categories = rawCategories.map((item) => normalizeCategory(item));
if (categories.length < 3) {
  console.error('Certainty crosswalk requires at least 3 certainty categories.');
  process.exit(1);
}
const categoryToIndex = new Map(categories.map((category, index) => [category, index]));
if (scenarios.length === 0) {
  console.error('Certainty crosswalk fixture has no scenarios.');
  process.exit(1);
}

const details = [];
let passedScenarios = 0;
let totalChecks = 0;
let passedChecks = 0;
let weightedAgreementNumerator = 0;
let weightedKappaNumerator = 0;
let weightedAdjacentNumerator = 0;
let weightedSevereNumerator = 0;
let totalComparisons = 0;

for (const scenario of scenarios) {
  let result = null;
  let checks = [];
  let error = null;
  try {
    result = computeScenarioResult(scenario, categories, categoryToIndex, options);
    checks = scenarioChecks(result, scenario?.expected ?? {});
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    checks = [{ check: 'execution', expected: 'no_error', actual: error, passed: false }];
  }

  const scenarioPassed = checks.every((item) => item.passed);
  if (scenarioPassed) passedScenarios += 1;
  totalChecks += checks.length;
  passedChecks += checks.filter((item) => item.passed).length;
  const comparisonCount = Number(result?.comparisonCount ?? 0);
  if (comparisonCount > 0 && result) {
    totalComparisons += comparisonCount;
    weightedAgreementNumerator += comparisonCount * Number(result.exactAgreement);
    weightedAdjacentNumerator += comparisonCount * Number(result.adjacentAgreement);
    weightedKappaNumerator += comparisonCount * Number(result.weightedKappa);
    weightedSevereNumerator += comparisonCount * Number(result.severeDisagreementRate);
  }

  details.push({
    scenarioId: String(scenario?.scenarioId ?? 'unknown'),
    description: String(scenario?.description ?? ''),
    passed: scenarioPassed,
    checks,
    result,
    error,
  });
}

const generatedAt = new Date().toISOString();
const primaryScenarioId = String(fixture?.primaryScenarioId ?? details?.[0]?.scenarioId ?? '');
const primaryScenario = details.find((row) => row.scenarioId === primaryScenarioId);
const uniqueComparisonIds = new Set();
for (const detail of details) {
  const ids = Array.isArray(detail?.result?.comparisonIds) ? detail.result.comparisonIds : [];
  for (const id of ids) uniqueComparisonIds.add(String(id));
}

const summary = {
  generatedAt,
  sourceFixture: path.relative(root, fixturePath),
  schemaVersion: fixture?.schemaVersion ?? null,
  sourceMode,
  categoryOrder: categories,
  scenarioCount: scenarios.length,
  passedScenarioCount: passedScenarios,
  passRateScenarios: toFixed(passedScenarios / scenarios.length, 4),
  checkCount: totalChecks,
  passedCheckCount: passedChecks,
  passRateChecks: totalChecks > 0 ? toFixed(passedChecks / totalChecks, 4) : 0,
  totalComparisons,
  uniqueComparisonCount: uniqueComparisonIds.size,
  weightedExactAgreement: totalComparisons > 0 ? toFixed(weightedAgreementNumerator / totalComparisons, 6) : 0,
  weightedAdjacentAgreement: totalComparisons > 0 ? toFixed(weightedAdjacentNumerator / totalComparisons, 6) : 0,
  weightedKappa: totalComparisons > 0 ? toFixed(weightedKappaNumerator / totalComparisons, 6) : 0,
  weightedSevereDisagreementRate: totalComparisons > 0 ? toFixed(weightedSevereNumerator / totalComparisons, 6) : 0,
  primaryScenarioId: primaryScenario?.scenarioId ?? null,
  primaryScenarioMetrics:
    primaryScenario?.result == null
      ? null
      : {
          comparisonCount: primaryScenario.result.comparisonCount,
          exactAgreement: primaryScenario.result.exactAgreement,
          adjacentAgreement: primaryScenario.result.adjacentAgreement,
          weightedKappa: primaryScenario.result.weightedKappa,
          weightedKappaCi95Width: toFiniteNumber(primaryScenario?.result?.uncertainty?.weightedKappa?.width),
          severeDisagreementRate: primaryScenario.result.severeDisagreementRate,
        },
  bootstrap: {
    samples: options.bootstrapSamples,
    seed: normalizeSeed(options.bootstrapSeed),
  },
  status: passedScenarios === scenarios.length ? 'passed' : 'failed',
  note: 'Certainty crosswalk benchmark quantifies agreement/disagreement between GRADE and CINeMA-style certainty classifications.',
};

const disagreementLatest = {
  generatedAt,
  framework: 'GRADE_CINEMA_crosswalk',
  sourceMode,
  status: summary.status,
  weightedKappa: summary.weightedKappa,
  weightedExactAgreement: summary.weightedExactAgreement,
  weightedAdjacentAgreement: summary.weightedAdjacentAgreement,
  weightedSevereDisagreementRate: summary.weightedSevereDisagreementRate,
  primaryScenarioId: summary.primaryScenarioId,
  primaryScenarioWeightedKappa: summary?.primaryScenarioMetrics?.weightedKappa ?? null,
  primaryScenarioWeightedKappaCi95Width:
    summary?.primaryScenarioMetrics?.weightedKappaCi95Width ?? null,
};

const outDir = path.join(root, 'reports', 'benchmarks');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'certainty-crosswalk.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(
  path.join(outDir, 'certainty-crosswalk-eval-latest.json'),
  `${JSON.stringify({ generatedAt, summary, scenarios: details }, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(outDir, 'certainty-disagreement-latest.json'),
  `${JSON.stringify(disagreementLatest, null, 2)}\n`,
);

console.log('Wrote reports/benchmarks/certainty-crosswalk.json');
console.log('Wrote reports/benchmarks/certainty-crosswalk-eval-latest.json');
console.log('Wrote reports/benchmarks/certainty-disagreement-latest.json');
console.log(
  `Certainty crosswalk benchmark: scenarios ${passedScenarios}/${scenarios.length}, checks ${passedChecks}/${totalChecks}, weighted kappa ${summary.weightedKappa}`,
);

if (summary.status !== 'passed') {
  process.exit(1);
}
