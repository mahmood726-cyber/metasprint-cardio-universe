import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { runNetworkV1 } from '../../src/engine/stats/network-v1.js';

function parseArgs(argv) {
  const options = {
    fixturePath: 'reports/benchmarks/packs/v2/network_nma.v1.json',
    alpha: null,
    samples: null,
    rankSeed: null,
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
    } else if (arg === '--samples') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 500) options.samples = Math.floor(value);
      i += 1;
    } else if (arg === '--rank-seed') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.rankSeed = Math.floor(value);
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

function checkRankProbabilities(result) {
  const checks = [];
  const rows = Array.isArray(result?.ranking?.rankProbabilities) ? result.ranking.rankProbabilities : [];
  for (const row of rows) {
    const probs = Array.isArray(row?.probabilities) ? row.probabilities : [];
    const sum = probs.reduce((acc, p) => acc + Number(p), 0);
    const bounded = probs.every((p) => Number.isFinite(Number(p)) && Number(p) >= -1e-6 && Number(p) <= 1 + 1e-6);
    checks.push({
      check: `rank_probabilities_${row.treatment}`,
      expected: 'sum~=1 and each in [0,1]',
      actual: `sum=${toFixed(sum, 6)}`,
      passed: Math.abs(sum - 1) <= 1e-3 && bounded,
    });
  }
  return checks;
}

function scenarioChecks(result, expected) {
  const checks = [];
  checks.push(
    checkRange(
      'treatment_count',
      Number(result?.input?.treatmentCount),
      Number.isFinite(Number(expected?.treatmentCount))
        ? { min: Number(expected.treatmentCount), max: Number(expected.treatmentCount) }
        : null,
    ),
  );
  checks.push(checkRange('tau2', Number(result?.heterogeneity?.tau2), expected?.tau2));
  checks.push(
    checkRange('global_inconsistency_q', Number(result?.inconsistency?.globalQ), expected?.globalInconsistencyQ),
  );
  checks.push(
    checkRange('global_inconsistency_p', Number(result?.inconsistency?.globalP), expected?.globalInconsistencyP),
  );
  checks.push(
    checkRange(
      'top_treatment_probability',
      Number(result?.ranking?.topTreatmentProbability),
      expected?.topTreatmentProbability,
    ),
  );
  checks.push(
    checkRange(
      'rank_seed_non_negative',
      Number(result?.input?.rankSeed),
      { min: 0 },
    ),
  );
  checks.push(
    checkRange(
      'ranking_precision_poth',
      Number(result?.ranking?.precision?.poth),
      { min: 0, max: 1 },
    ),
  );
  checks.push(
    checkRange(
      'ranking_precision_poth_top3',
      Number(result?.ranking?.precision?.pothTop3),
      { min: 0, max: 1 },
    ),
  );
  checks.push(
    checkRange(
      'multiplicative_phi',
      Number(result?.multiplicativeHeterogeneity?.phi),
      { min: 1 },
    ),
  );

  const allowedTop = Array.isArray(expected?.allowedTopTreatments) ? expected.allowedTopTreatments : [];
  checks.push({
    check: 'top_treatment_allowed',
    expected: allowedTop,
    actual: String(result?.ranking?.topTreatment ?? 'unknown'),
    passed: allowedTop.length === 0 ? true : allowedTop.includes(String(result?.ranking?.topTreatment ?? '')),
  });

  const pairDiagCount = Array.isArray(result?.inconsistency?.pairDiagnostics) ? result.inconsistency.pairDiagnostics.length : 0;
  checks.push({
    check: 'min_pair_diagnostics',
    expected: Number(expected?.minPairDiagnostics ?? 0),
    actual: pairDiagCount,
    passed: pairDiagCount >= Number(expected?.minPairDiagnostics ?? 0),
  });

  const robAllowed = Array.isArray(expected?.robNmaOverallAllowed) ? expected.robNmaOverallAllowed : [];
  checks.push({
    check: 'rob_nma_overall',
    expected: robAllowed,
    actual: String(result?.robNma?.overallJudgement ?? 'unknown'),
    passed: robAllowed.length === 0 ? true : robAllowed.includes(String(result?.robNma?.overallJudgement ?? '')),
  });

  const comparisonCount = Array.isArray(result?.robNma?.comparisons) ? result.robNma.comparisons.length : 0;
  checks.push({
    check: 'rob_nma_min_comparisons',
    expected: Number(expected?.robNmaMinComparisons ?? 0),
    actual: comparisonCount,
    passed: comparisonCount >= Number(expected?.robNmaMinComparisons ?? 0),
  });

  checks.push(...checkRankProbabilities(result));
  return checks;
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const fixturePath = path.isAbsolute(options.fixturePath) ? options.fixturePath : path.join(root, options.fixturePath);
if (!fs.existsSync(fixturePath)) {
  console.error(`Missing network benchmark fixture: ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

const fixture = readJson(fixturePath);
const scenarios = Array.isArray(fixture?.scenarios) ? fixture.scenarios : [];
if (scenarios.length === 0) {
  console.error('Network benchmark fixture has no scenarios.');
  process.exit(1);
}

const schemaPath = path.join(root, 'src', 'contracts', 'schemas', 'network-analysis.v1.schema.json');
const schema = readJson(schemaPath);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const details = [];
let passedScenarios = 0;
let totalChecks = 0;
let passedChecks = 0;

for (const scenario of scenarios) {
  const alpha = options.alpha ?? Number(scenario?.alpha ?? fixture?.defaultAlpha ?? 0.05);
  const samples = options.samples ?? Number(scenario?.samples ?? fixture?.defaultRankSamples ?? 3000);
  const rankSeed = options.rankSeed ?? Number(scenario?.rankSeed ?? fixture?.defaultRankSeed ?? 20260228);
  let result = null;
  let checks = [];
  let error = null;
  let schemaErrors = [];

  try {
    result = runNetworkV1(scenario?.studies ?? [], {
      alpha,
      samples,
      rankSeed,
      referenceTreatment: scenario?.referenceTreatment,
    });
    const valid = validate(result);
    if (!valid) {
      schemaErrors = (validate.errors ?? []).map((err) => `${err.instancePath || '/'} ${err.message}`);
    }
    checks = scenarioChecks(result, scenario?.expected ?? {});
    checks.push({
      check: 'network_schema_valid',
      expected: 'valid',
      actual: schemaErrors.length === 0 ? 'valid' : schemaErrors.join('; '),
      passed: schemaErrors.length === 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    checks = [
      {
        check: 'execution',
        expected: 'no_error',
        actual: error,
        passed: false,
      },
    ];
  }

  const scenarioPassed = checks.every((item) => item.passed);
  if (scenarioPassed) passedScenarios += 1;
  totalChecks += checks.length;
  passedChecks += checks.filter((item) => item.passed).length;

  details.push({
    scenarioId: String(scenario?.scenarioId ?? 'unknown'),
    description: String(scenario?.description ?? ''),
    alpha,
    samples,
    rankSeed,
    passed: scenarioPassed,
    checks,
    result,
    error,
  });
}

const robNmaJudgementCounts = { low: 0, some_concerns: 0, high: 0 };
for (const detail of details) {
  const judgement = detail?.result?.robNma?.overallJudgement;
  if (judgement && Object.prototype.hasOwnProperty.call(robNmaJudgementCounts, judgement)) {
    robNmaJudgementCounts[judgement] += 1;
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
  robNmaCoverage:
    scenarios.length > 0
      ? toFixed(details.filter((detail) => detail?.result?.robNma?.framework === 'RoB NMA').length / scenarios.length, 4)
      : 0,
  robNmaJudgementCounts,
  overallRobNmaJudgement:
    robNmaJudgementCounts.high > 0
      ? 'high'
      : robNmaJudgementCounts.some_concerns > 0
        ? 'some_concerns'
        : 'low',
  status: passedScenarios === scenarios.length ? 'passed' : 'failed',
  note: 'Network v1 benchmark validates NMA estimation, inconsistency diagnostics, rank uncertainty, and RoB NMA outputs.',
};

const robNmaLatest = {
  generatedAt,
  framework: 'RoB NMA',
  overallJudgement: summary.overallRobNmaJudgement,
  networkCount: summary.scenarioCount,
  judgementCounts: robNmaJudgementCounts,
  sourceBenchmark: path.relative(root, fixturePath),
  status: summary.status,
};

const outDir = path.join(root, 'reports', 'benchmarks');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'network-v1.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'network-v1-eval-latest.json'), `${JSON.stringify({ generatedAt, summary, scenarios: details }, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'rob-nma-latest.json'), `${JSON.stringify(robNmaLatest, null, 2)}\n`);

console.log('Wrote reports/benchmarks/network-v1.json');
console.log('Wrote reports/benchmarks/network-v1-eval-latest.json');
console.log('Wrote reports/benchmarks/rob-nma-latest.json');
console.log(
  `Network v1 benchmark: scenarios ${passedScenarios}/${scenarios.length}, checks ${passedChecks}/${totalChecks}, RoB NMA coverage ${toFixed(summary.robNmaCoverage * 100, 2)}%`,
);

if (summary.status !== 'passed') {
  process.exit(1);
}
