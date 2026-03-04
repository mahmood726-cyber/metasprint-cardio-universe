import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { runPairwiseV2 } from '../../src/engine/stats/pairwise-v2.js';

function parseArgs(argv) {
  const options = {
    fixturePath: 'reports/benchmarks/packs/v2/bias_sensitivity.v1.json',
    alpha: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.fixturePath = value;
      i += 1;
    } else if (arg === '--alpha') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0 && value < 1) options.alpha = value;
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

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax));
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function computePValue(study) {
  const p = Number(study?.pValue);
  if (Number.isFinite(p) && p >= 0 && p <= 1) return p;
  const yi = Number(study?.yi);
  const vi = Number(study?.vi);
  if (!Number.isFinite(yi) || !Number.isFinite(vi) || vi <= 0) return 1;
  const z = Math.abs(yi / Math.sqrt(vi));
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(z))));
}

function finiteEstimate(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function weightedRegression(x, y, w) {
  const n = x.length;
  if (n < 3) {
    return { intercept: null, slope: null, seIntercept: null, pIntercept: null };
  }
  let sw = 0;
  let swx = 0;
  let swy = 0;
  let swxx = 0;
  let swxy = 0;
  for (let i = 0; i < n; i += 1) {
    const wi = Number(w[i]);
    if (!(wi > 0)) continue;
    sw += wi;
    swx += wi * x[i];
    swy += wi * y[i];
    swxx += wi * x[i] * x[i];
    swxy += wi * x[i] * y[i];
  }
  const denom = sw * swxx - swx * swx;
  if (!(denom > 0) || !(sw > 0)) {
    return { intercept: null, slope: null, seIntercept: null, pIntercept: null };
  }

  const slope = (sw * swxy - swx * swy) / denom;
  const intercept = (swy - slope * swx) / sw;

  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    const wi = Number(w[i]);
    if (!(wi > 0)) continue;
    const resid = y[i] - (intercept + slope * x[i]);
    sse += wi * resid * resid;
  }
  const df = Math.max(1, n - 2);
  const sigma2 = sse / df;
  const varIntercept = (sigma2 * swxx) / denom;
  const seIntercept = varIntercept >= 0 ? Math.sqrt(varIntercept) : null;
  let pIntercept = null;
  if (seIntercept != null && seIntercept > 0) {
    const z = Math.abs(intercept / seIntercept);
    pIntercept = 2 * (1 - normalCdf(z));
  }
  return {
    intercept,
    slope,
    seIntercept,
    pIntercept,
  };
}

function pooledEstimate(studies, alpha) {
  const result = runPairwiseV2(studies, { alpha, multiArmCorrection: true });
  return {
    estimate: finiteEstimate(result?.pooled?.estimate),
    result,
  };
}

function selectionProbability(p) {
  if (p <= 0.05) return 1;
  if (p <= 0.1) return 0.7;
  return 0.4;
}

function selectionModelProxy(studies, alpha) {
  const adjusted = studies.map((study) => {
    const p = computePValue(study);
    const prob = selectionProbability(p);
    return {
      ...study,
      vi: Number(study.vi) * prob,
    };
  });
  const pooled = pooledEstimate(adjusted, alpha);
  return {
    estimate: pooled.estimate,
    adjustedStudyCount: adjusted.length,
    method: 'selection_model_proxy',
  };
}

function petPeese(studies) {
  const rows = studies
    .map((study) => {
      const yi = Number(study.yi);
      const vi = Number(study.vi);
      if (!Number.isFinite(yi) || !Number.isFinite(vi) || vi <= 0) return null;
      return {
        yi,
        vi,
        se: Math.sqrt(vi),
      };
    })
    .filter(Boolean);
  const y = rows.map((r) => r.yi);
  const se = rows.map((r) => r.se);
  const vi = rows.map((r) => r.vi);
  const w = rows.map((r) => 1 / r.vi);

  const pet = weightedRegression(se, y, w);
  const peese = weightedRegression(vi, y, w);
  const petEstimate = finiteEstimate(pet.intercept);
  const peeseEstimate = finiteEstimate(peese.intercept);
  const usePet = Number.isFinite(pet.pIntercept) ? pet.pIntercept > 0.1 : false;
  const selectedEstimate = usePet ? petEstimate : peeseEstimate;

  return {
    petEstimate,
    peeseEstimate,
    selectedEstimate,
    selectedRule: usePet ? 'PET' : 'PEESE',
    petPIntercept: Number.isFinite(pet.pIntercept) ? toFixed(pet.pIntercept) : null,
  };
}

function trimAndFillProxy(studies, alpha, centerEstimate) {
  const center = Number(centerEstimate);
  const valid = studies.filter((study) => Number.isFinite(Number(study.yi)) && Number.isFinite(Number(study.vi)));
  const left = valid.filter((study) => Number(study.yi) < center);
  const right = valid.filter((study) => Number(study.yi) > center);
  const delta = Math.abs(left.length - right.length);
  if (delta === 0) {
    return {
      estimate: center,
      imputedCount: 0,
      method: 'trim_and_fill_proxy',
    };
  }

  const majority = left.length > right.length ? left : right;
  const selected = [...majority]
    .sort((a, b) => Math.abs(Number(b.yi) - center) - Math.abs(Number(a.yi) - center))
    .slice(0, delta);

  const imputed = selected.map((study, idx) => ({
    studyId: `${study.studyId}_tf_${idx + 1}`,
    yi: center - (Number(study.yi) - center),
    vi: Number(study.vi),
    pValue: computePValue(study),
  }));
  const pooled = pooledEstimate(valid.concat(imputed), alpha);
  return {
    estimate: pooled.estimate,
    imputedCount: imputed.length,
    method: 'trim_and_fill_proxy',
  };
}

function pHackingScenario(studies, alpha) {
  const excluded = [];
  const retained = [];
  for (const study of studies) {
    const p = computePValue(study);
    if (p >= 0.045 && p <= 0.055) {
      excluded.push(study);
    } else {
      retained.push(study);
    }
  }
  if (retained.length < 2) {
    return {
      estimate: null,
      retainedCount: retained.length,
      excludedCount: excluded.length,
      method: 'p_hacking_borderline_exclusion',
    };
  }
  const pooled = pooledEstimate(retained, alpha);
  return {
    estimate: pooled.estimate,
    retainedCount: retained.length,
    excludedCount: excluded.length,
    method: 'p_hacking_borderline_exclusion',
  };
}

function nonAffirmativeScenario(studies, alpha, baselineEstimate) {
  const direction = Number(baselineEstimate) >= 0 ? 1 : -1;
  const affirmative = studies.filter((study) => {
    const yi = Number(study.yi);
    const p = computePValue(study);
    if (!Number.isFinite(yi)) return false;
    return p < 0.05 && Math.sign(yi) === direction;
  });
  const all = pooledEstimate(studies, alpha);
  const affirmativeOnly = affirmative.length >= 2 ? pooledEstimate(affirmative, alpha) : { estimate: null };
  return {
    allEstimate: all.estimate,
    affirmativeOnlyEstimate: affirmativeOnly.estimate,
    affirmativeCount: affirmative.length,
    totalCount: studies.length,
    shift:
      Number.isFinite(Number(affirmativeOnly.estimate)) && Number.isFinite(Number(all.estimate))
        ? finiteEstimate(Number(affirmativeOnly.estimate) - Number(all.estimate))
        : null,
    method: 'non_affirmative_inclusion',
  };
}

function computeRobMeAssessment(studies, baselineEstimate) {
  const pValues = studies.map((study) => computePValue(study));
  const nonSigShare =
    pValues.length > 0 ? pValues.filter((p) => p > 0.05).length / pValues.length : 0;
  const borderlineShare =
    pValues.length > 0 ? pValues.filter((p) => p >= 0.045 && p <= 0.055).length / pValues.length : 0;
  const center = Number(baselineEstimate);
  const left = studies.filter((study) => Number(study.yi) < center).length;
  const right = studies.filter((study) => Number(study.yi) > center).length;
  const asymmetry = studies.length > 0 ? Math.abs(left - right) / studies.length : 0;

  const domainPublished =
    nonSigShare < 0.2 || asymmetry > 0.35
      ? 'high'
      : nonSigShare < 0.35 || asymmetry > 0.2
        ? 'some_concerns'
        : 'low';
  const domainSelective =
    borderlineShare > 0.12 ? 'high' : borderlineShare > 0.05 ? 'some_concerns' : 'low';

  const order = { low: 0, some_concerns: 1, high: 2 };
  const overallJudgement = order[domainPublished] >= order[domainSelective] ? domainPublished : domainSelective;

  return {
    framework: 'ROB-ME',
    overallJudgement,
    domains: {
      biasDueToMissingResultsInPublishedStudies: domainPublished,
      biasDueToSelectivePublication: domainSelective,
    },
    signals: {
      studyCount: studies.length,
      nonSignificantShare: toFixed(nonSigShare, 6),
      borderlinePValueShare: toFixed(borderlineShare, 6),
      directionalAsymmetry: toFixed(asymmetry, 6),
    },
    rationale:
      overallJudgement === 'high'
        ? 'High missing-evidence risk signal due to asymmetry and/or suppression of non-significant results.'
        : overallJudgement === 'some_concerns'
          ? 'Moderate missing-evidence risk signal requiring sensitivity interpretation.'
          : 'Low missing-evidence risk signal on current scenario diagnostics.',
    assessedAt: new Date().toISOString(),
  };
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

function evaluateScenario(expected, methods, envelope, robMe) {
  const checks = [];

  const finiteMethods = methods.filter((row) => Number.isFinite(Number(row.estimate)));
  checks.push({
    check: 'finite_method_count',
    expected: Number(expected?.minMethodCount ?? 1),
    actual: finiteMethods.length,
    passed: finiteMethods.length >= Number(expected?.minMethodCount ?? 1),
  });

  const width = Number(envelope?.width);
  checks.push({
    check: 'envelope_width',
    expected: expected?.envelopeWidth ?? null,
    actual: Number.isFinite(width) ? toFixed(width) : null,
    passed: inRange(width, expected?.envelopeWidth),
  });

  const allowed = Array.isArray(expected?.robMeOverallAllowed) ? expected.robMeOverallAllowed : ['low', 'some_concerns', 'high'];
  checks.push({
    check: 'robme_overall',
    expected: allowed,
    actual: robMe.overallJudgement,
    passed: allowed.includes(robMe.overallJudgement),
  });

  checks.push({
    check: 'robme_framework',
    expected: 'ROB-ME',
    actual: robMe.framework,
    passed: robMe.framework === 'ROB-ME',
  });

  const methodMap = new Map();
  for (const row of methods) {
    methodMap.set(String(row.method), Number(row.estimate));
  }
  const locks = expected?.referenceLocks && typeof expected.referenceLocks === 'object' ? expected.referenceLocks : {};
  for (const [method, lock] of Object.entries(locks)) {
    const expectedEstimate = Number(lock?.estimate);
    const tolerance = Number.isFinite(Number(lock?.tolerance)) ? Number(lock.tolerance) : 0.01;
    const actual = methodMap.get(method);
    const delta =
      Number.isFinite(actual) && Number.isFinite(expectedEstimate)
        ? Math.abs(actual - expectedEstimate)
        : Number.POSITIVE_INFINITY;
    checks.push({
      check: `reference_lock_${method}`,
      expected: {
        estimate: Number.isFinite(expectedEstimate) ? toFixed(expectedEstimate, 6) : expectedEstimate,
        tolerance: toFixed(tolerance, 6),
      },
      actual: Number.isFinite(actual) ? toFixed(actual, 6) : null,
      delta: Number.isFinite(delta) ? toFixed(delta, 6) : null,
      passed:
        Number.isFinite(actual) &&
        Number.isFinite(expectedEstimate) &&
        Number.isFinite(delta) &&
        delta <= tolerance,
    });
  }

  return checks;
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const fixturePath = path.isAbsolute(options.fixturePath) ? options.fixturePath : path.join(root, options.fixturePath);
if (!fs.existsSync(fixturePath)) {
  console.error(`Missing bias sensitivity fixture: ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

const fixture = readJson(fixturePath);
const scenarios = Array.isArray(fixture?.scenarios) ? fixture.scenarios : [];
if (scenarios.length === 0) {
  console.error('Bias sensitivity fixture has no scenarios.');
  process.exit(1);
}

const detailRows = [];
let passedScenarios = 0;
let totalChecks = 0;
let passedChecks = 0;

for (const scenario of scenarios) {
  const alpha = options.alpha ?? Number(scenario?.alpha ?? fixture?.defaultAlpha ?? 0.05);
  const studies = Array.isArray(scenario?.studies) ? scenario.studies : [];
  if (studies.length < 2) {
    detailRows.push({
      scenarioId: String(scenario?.scenarioId ?? 'unknown'),
      description: String(scenario?.description ?? ''),
      alpha,
      passed: false,
      error: 'Scenario must include at least 2 studies',
      checks: [
        {
          check: 'min_study_count',
          expected: '>=2',
          actual: studies.length,
          passed: false,
        },
      ],
    });
    totalChecks += 1;
    continue;
  }

  const baseline = pooledEstimate(studies, alpha);
  const selection = selectionModelProxy(studies, alpha);
  const petPeeseResult = petPeese(studies);
  const trimFill = trimAndFillProxy(studies, alpha, baseline.estimate);
  const pHacking = pHackingScenario(studies, alpha);
  const nonAffirmative = nonAffirmativeScenario(studies, alpha, baseline.estimate);
  const robMe = computeRobMeAssessment(studies, baseline.estimate);

  const methods = [
    { method: 'baseline_random_effects', estimate: baseline.estimate },
    { method: 'selection_model_proxy', estimate: selection.estimate },
    { method: 'pet', estimate: petPeeseResult.petEstimate },
    { method: 'peese', estimate: petPeeseResult.peeseEstimate },
    { method: 'pet_peese_selected', estimate: petPeeseResult.selectedEstimate },
    { method: 'trim_and_fill_proxy', estimate: trimFill.estimate },
    { method: 'p_hacking_borderline_exclusion', estimate: pHacking.estimate },
    { method: 'non_affirmative_all', estimate: nonAffirmative.allEstimate },
    { method: 'non_affirmative_affirmative_only', estimate: nonAffirmative.affirmativeOnlyEstimate },
  ];

  const finite = methods
    .map((row) => Number(row.estimate))
    .filter((value) => Number.isFinite(value));
  const envelope = {
    min: finite.length > 0 ? toFixed(Math.min(...finite)) : null,
    max: finite.length > 0 ? toFixed(Math.max(...finite)) : null,
    width: finite.length > 0 ? toFixed(Math.max(...finite) - Math.min(...finite)) : null,
  };

  const checks = evaluateScenario(scenario?.expected ?? {}, methods, envelope, robMe);
  const scenarioPassed = checks.every((check) => check.passed);
  if (scenarioPassed) passedScenarios += 1;
  totalChecks += checks.length;
  passedChecks += checks.filter((check) => check.passed).length;

  detailRows.push({
    scenarioId: String(scenario?.scenarioId ?? 'unknown'),
    description: String(scenario?.description ?? ''),
    alpha,
    passed: scenarioPassed,
    checks,
    baseline,
    methods,
    envelope,
    selectionDetails: selection,
    petPeese: petPeeseResult,
    trimAndFill: trimFill,
    pHacking,
    nonAffirmative,
    robMe,
  });
}

const robMeJudgementCounts = { low: 0, some_concerns: 0, high: 0 };
for (const row of detailRows) {
  const judgement = row?.robMe?.overallJudgement;
  if (judgement && Object.prototype.hasOwnProperty.call(robMeJudgementCounts, judgement)) {
    robMeJudgementCounts[judgement] += 1;
  }
}

const generatedAt = new Date().toISOString();
const summary = {
  generatedAt,
  sourceFixture: path.relative(root, fixturePath),
  schemaVersion: fixture?.schemaVersion ?? null,
  scenarioCount: scenarios.length,
  passedScenarioCount: passedScenarios,
  passRateScenarios: toFixed(passedScenarios / scenarios.length, 4),
  checkCount: totalChecks,
  passedCheckCount: passedChecks,
  passRateChecks: totalChecks > 0 ? toFixed(passedChecks / totalChecks, 4) : 0,
  robMeCoverage: detailRows.length > 0 ? toFixed(detailRows.filter((row) => row.robMe != null).length / detailRows.length, 4) : 0,
  robMeJudgementCounts,
  overallRobMeJudgement:
    robMeJudgementCounts.high > 0
      ? 'high'
      : robMeJudgementCounts.some_concerns > 0
        ? 'some_concerns'
        : 'low',
  status: passedScenarios === scenarios.length ? 'passed' : 'failed',
  note: 'Bias robustness suite including selection proxy, PET-PEESE, trim-fill proxy, p-hacking, and non-affirmative inclusion.',
};

const robMeLatest = {
  generatedAt,
  framework: 'ROB-ME',
  overallJudgement: summary.overallRobMeJudgement,
  scenarioCoverage: summary.scenarioCount,
  judgementCounts: robMeJudgementCounts,
  sourceBenchmark: path.relative(root, fixturePath),
  status: summary.status,
};

const outDir = path.join(root, 'reports', 'benchmarks');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'bias-sensitivity.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'bias-sensitivity-eval-latest.json'), `${JSON.stringify({ generatedAt, summary, scenarios: detailRows }, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'rob-me-latest.json'), `${JSON.stringify(robMeLatest, null, 2)}\n`);

console.log('Wrote reports/benchmarks/bias-sensitivity.json');
console.log('Wrote reports/benchmarks/bias-sensitivity-eval-latest.json');
console.log('Wrote reports/benchmarks/rob-me-latest.json');
console.log(
  `Bias sensitivity suite: scenarios ${passedScenarios}/${scenarios.length}, checks ${passedChecks}/${totalChecks}, ROB-ME coverage ${toFixed(summary.robMeCoverage * 100, 2)}%`,
);

if (summary.status !== 'passed') {
  process.exit(1);
}
