import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';

import { runPairwiseV2 } from '../../src/engine/stats/pairwise-v2.js';

function parseArgs(argv) {
  const options = {
    fixturePath: 'reports/benchmarks/packs/v2/pairwise_stress.v1.json',
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

function inRange(value, range) {
  if (range == null) return true;
  if (!Number.isFinite(value)) return false;
  if (Number.isFinite(Number(range.min)) && value < Number(range.min)) return false;
  if (Number.isFinite(Number(range.max)) && value > Number(range.max)) return false;
  return true;
}

function checkRange(name, value, range) {
  const passed = inRange(value, range);
  return {
    check: name,
    expected: range ?? null,
    actual: Number.isFinite(value) ? toFixed(value) : value,
    passed,
  };
}

function scenarioChecks(result, expected) {
  const checks = [];
  const pooledEstimate = Number(result?.pooled?.estimate);
  const tau2 = Number(result?.heterogeneity?.tau2);
  const i2 = Number(result?.heterogeneity?.i2);
  const hksjWidth = Number(result?.pooled?.ciHksj?.upper) - Number(result?.pooled?.ciHksj?.lower);
  const predictionWidth =
    Number(result?.pooled?.predictionInterval?.upper) - Number(result?.pooled?.predictionInterval?.lower);

  checks.push(checkRange('pooled_estimate', pooledEstimate, expected?.pooledEstimate));
  checks.push(checkRange('tau2', tau2, expected?.tau2));
  checks.push(checkRange('i2', i2, expected?.i2));
  checks.push(checkRange('hksj_width', hksjWidth, expected?.hksjWidth));
  checks.push(checkRange('prediction_width', predictionWidth, expected?.predictionWidth));

  if (typeof expected?.robustAvailable === 'boolean') {
    checks.push({
      check: 'robust_available',
      expected: expected.robustAvailable,
      actual: Boolean(result?.robustVariance?.available),
      passed: Boolean(result?.robustVariance?.available) === expected.robustAvailable,
    });
  }

  if (Number.isFinite(Number(expected?.minClusters))) {
    const actualClusters = Number(result?.robustVariance?.clusters ?? 0);
    checks.push({
      check: 'min_clusters',
      expected: Number(expected.minClusters),
      actual: actualClusters,
      passed: actualClusters >= Number(expected.minClusters),
    });
  }

  if (Number.isFinite(Number(expected?.requireMultiArmFactorAtLeast))) {
    const factor = Math.max(
      ...((result?.adjustedStudies ?? []).map((row) => Number(row?.multiArmFactor ?? 0))),
    );
    checks.push({
      check: 'multi_arm_factor',
      expected: Number(expected.requireMultiArmFactorAtLeast),
      actual: factor,
      passed: factor >= Number(expected.requireMultiArmFactorAtLeast),
    });
  }

  return checks;
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const fixturePath = path.isAbsolute(options.fixturePath) ? options.fixturePath : path.join(root, options.fixturePath);
if (!fs.existsSync(fixturePath)) {
  console.error(`Missing pairwise benchmark fixture: ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

const fixture = readJson(fixturePath);
const scenarios = Array.isArray(fixture?.scenarios) ? fixture.scenarios : [];
if (scenarios.length === 0) {
  console.error('Pairwise benchmark fixture has no scenarios.');
  process.exit(1);
}

const schemaPath = path.join(root, 'src', 'contracts', 'schemas', 'analysis-result.v2.schema.json');
const schema = readJson(schemaPath);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const details = [];
let passedChecks = 0;
let totalChecks = 0;
let passedScenarios = 0;

for (const scenario of scenarios) {
  const alpha = options.alpha ?? Number(scenario?.alpha ?? fixture?.defaultAlpha ?? 0.05);
  let result = null;
  let schemaErrors = [];
  let checks = [];
  let error = null;

  try {
    result = runPairwiseV2(scenario.studies ?? [], { alpha, multiArmCorrection: true });
    const valid = validate(result);
    if (!valid) {
      schemaErrors = (validate.errors ?? []).map((err) => `${err.instancePath || '/'} ${err.message}`);
    }
    checks = scenarioChecks(result, scenario.expected ?? {});
    if (schemaErrors.length > 0) {
      checks.push({
        check: 'analysis_result_v2_schema',
        expected: 'valid',
        actual: schemaErrors.join('; '),
        passed: false,
      });
    } else {
      checks.push({
        check: 'analysis_result_v2_schema',
        expected: 'valid',
        actual: 'valid',
        passed: true,
      });
    }
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
  passedChecks += checks.filter((item) => item.passed).length;
  totalChecks += checks.length;

  details.push({
    scenarioId: String(scenario?.scenarioId ?? 'unknown_scenario'),
    description: String(scenario?.description ?? ''),
    alpha,
    passed: scenarioPassed,
    checks,
    result,
    error,
  });
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
  status: passedScenarios === scenarios.length ? 'passed' : 'failed',
  note: 'Pairwise v2 benchmark validates REML/HKSJ/prediction interval and dependent-effects handling.',
};

const outDir = path.join(root, 'reports', 'benchmarks');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'pairwise-v2.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(
  path.join(outDir, 'pairwise-v2-eval-latest.json'),
  `${JSON.stringify({ generatedAt, summary, details }, null, 2)}\n`,
);

console.log('Wrote reports/benchmarks/pairwise-v2.json');
console.log('Wrote reports/benchmarks/pairwise-v2-eval-latest.json');
console.log(
  `Pairwise v2 benchmark: scenarios ${passedScenarios}/${scenarios.length}, checks ${passedChecks}/${totalChecks}`,
);

if (summary.status !== 'passed') {
  process.exit(1);
}

