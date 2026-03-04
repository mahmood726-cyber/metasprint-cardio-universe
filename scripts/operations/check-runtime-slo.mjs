import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    policyPath: 'reports/ops/packs/runtime_slo_policy.v1.json',
    trendCsvPath: 'reports/ci/runtime-trend.csv',
    outputDir: 'reports/ops',
    label: null,
    enforce: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--policy') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.policyPath = value;
      i += 1;
      continue;
    }
    if (arg === '--trend-csv') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.trendCsvPath = value;
      i += 1;
      continue;
    }
    if (arg === '--output-dir') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.outputDir = value;
      i += 1;
      continue;
    }
    if (arg === '--label') {
      const value = String(argv[i + 1] ?? '').trim();
      options.label = value || null;
      i += 1;
      continue;
    }
    if (arg === '--enforce') {
      options.enforce = true;
    }
  }

  return options;
}

function resolvePath(root, targetPath) {
  if (!targetPath) return null;
  return path.isAbsolute(targetPath) ? targetPath : path.join(root, targetPath);
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      if (current.length > 0 || row.length > 0) {
        row.push(current);
        rows.push(row);
      }
      row = [];
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function toObjects(rows) {
  const [header, ...body] = rows;
  if (!Array.isArray(header) || header.length === 0) return [];
  return body
    .filter((row) => Array.isArray(row) && row.length > 0)
    .map((row) => {
      const obj = {};
      for (let i = 0; i < header.length; i += 1) {
        obj[String(header[i] ?? '').trim()] = String(row[i] ?? '').trim();
      }
      return obj;
    });
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeRows(csvText) {
  return toObjects(parseCsv(csvText))
    .map((row) => ({
      generatedAt: String(row.generated_at ?? row.generatedAt ?? ''),
      label: String(row.label ?? ''),
      durationSeconds: toNumber(row.duration_seconds ?? row.durationSeconds),
      budgetSeconds: toNumber(row.budget_seconds ?? row.budgetSeconds),
      status: String(row.status ?? '').toLowerCase(),
    }))
    .filter((row) => row.label && Number.isFinite(Date.parse(row.generatedAt)))
    .sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
}

function getDefaults(policy) {
  return {
    historyWindow: Number.isFinite(Number(policy?.defaults?.historyWindow))
      ? Math.max(1, Math.floor(Number(policy.defaults.historyWindow)))
      : 12,
    minHistoricalSamples: Number.isFinite(Number(policy?.defaults?.minHistoricalSamples))
      ? Math.max(0, Math.floor(Number(policy.defaults.minHistoricalSamples)))
      : 4,
    maxRegressionRatio: Number.isFinite(Number(policy?.defaults?.maxRegressionRatio))
      ? Math.max(0, Number(policy.defaults.maxRegressionRatio))
      : 0.2,
    maxConsecutiveFailures: Number.isFinite(Number(policy?.defaults?.maxConsecutiveFailures))
      ? Math.max(0, Math.floor(Number(policy.defaults.maxConsecutiveFailures)))
      : 1,
  };
}

function evaluateLabel(rows, label, rule, defaults) {
  const violations = [];
  const warnings = [];
  const scopedRows = rows.filter((row) => row.label === label);

  if (scopedRows.length === 0) {
    warnings.push(`No runtime trend rows found for label "${label}".`);
    return {
      label,
      status: 'warning',
      runCount: 0,
      latest: null,
      baselineMedianSeconds: null,
      allowedMaxSeconds: null,
      violations,
      warnings,
      ownerRole: String(rule?.ownerRole ?? ''),
    };
  }

  const latest = scopedRows[scopedRows.length - 1];
  const historyWindow = Number.isFinite(Number(rule?.historyWindow))
    ? Math.max(1, Math.floor(Number(rule.historyWindow)))
    : defaults.historyWindow;
  const minHistoricalSamples = Number.isFinite(Number(rule?.minHistoricalSamples))
    ? Math.max(0, Math.floor(Number(rule.minHistoricalSamples)))
    : defaults.minHistoricalSamples;
  const maxRegressionRatio = Number.isFinite(Number(rule?.maxRegressionRatio))
    ? Math.max(0, Number(rule.maxRegressionRatio))
    : defaults.maxRegressionRatio;
  const maxConsecutiveFailures = Number.isFinite(Number(rule?.maxConsecutiveFailures))
    ? Math.max(0, Math.floor(Number(rule.maxConsecutiveFailures)))
    : defaults.maxConsecutiveFailures;
  const configuredBudgetSeconds = toNumber(rule?.budgetSeconds);
  const baselineSeconds = toNumber(rule?.baselineSeconds);

  let trailingFailures = 0;
  for (let i = scopedRows.length - 1; i >= 0; i -= 1) {
    if (scopedRows[i].status === 'passed') break;
    trailingFailures += 1;
  }

  if (latest.status !== 'passed') {
    violations.push(`Latest runtime row status is "${latest.status}" (expected "passed").`);
  }
  if (trailingFailures > maxConsecutiveFailures) {
    violations.push(
      `Trailing failure streak ${trailingFailures} exceeds maxConsecutiveFailures=${maxConsecutiveFailures}.`,
    );
  }

  const budgetToUse = configuredBudgetSeconds ?? latest.budgetSeconds;
  if (Number.isFinite(budgetToUse) && Number.isFinite(latest.durationSeconds) && latest.durationSeconds > budgetToUse) {
    violations.push(
      `Latest runtime ${latest.durationSeconds}s exceeds budget ${budgetToUse}s.`,
    );
  }

  const priorPassedDurations = scopedRows
    .slice(0, -1)
    .filter((row) => row.status === 'passed' && Number.isFinite(row.durationSeconds))
    .map((row) => row.durationSeconds);
  const windowDurations = priorPassedDurations.slice(-historyWindow);
  const baselineMedianSeconds = median(windowDurations);

  if (windowDurations.length < minHistoricalSamples) {
    warnings.push(
      `Insufficient history for regression check (${windowDurations.length}/${minHistoricalSamples} passing rows).`,
    );
  }

  let allowedMaxSeconds = null;
  if (Number.isFinite(baselineMedianSeconds)) {
    allowedMaxSeconds = baselineMedianSeconds * (1 + maxRegressionRatio);
    if (latest.status === 'passed' && Number.isFinite(latest.durationSeconds) && latest.durationSeconds > allowedMaxSeconds) {
      violations.push(
        `Latest runtime ${latest.durationSeconds}s exceeds regression cap ${allowedMaxSeconds.toFixed(3)}s (median=${baselineMedianSeconds.toFixed(3)}s, ratio=${maxRegressionRatio}).`,
      );
    }
  }

  if (Number.isFinite(baselineSeconds)) {
    const baselineAllowed = baselineSeconds * (1 + maxRegressionRatio);
    if (latest.status === 'passed' && Number.isFinite(latest.durationSeconds) && latest.durationSeconds > baselineAllowed) {
      violations.push(
        `Latest runtime ${latest.durationSeconds}s exceeds configured baseline cap ${baselineAllowed.toFixed(3)}s (baseline=${baselineSeconds}s, ratio=${maxRegressionRatio}).`,
      );
    }
    if (!Number.isFinite(allowedMaxSeconds)) {
      allowedMaxSeconds = baselineAllowed;
    }
  }

  const status = violations.length > 0 ? 'failed' : warnings.length > 0 ? 'warning' : 'passed';
  return {
    label,
    status,
    runCount: scopedRows.length,
    latest,
    baselineMedianSeconds: Number.isFinite(baselineMedianSeconds)
      ? Number(baselineMedianSeconds.toFixed(3))
      : null,
    allowedMaxSeconds: Number.isFinite(allowedMaxSeconds) ? Number(allowedMaxSeconds.toFixed(3)) : null,
    thresholds: {
      historyWindow,
      minHistoricalSamples,
      maxRegressionRatio,
      maxConsecutiveFailures,
      budgetSeconds: Number.isFinite(configuredBudgetSeconds) ? configuredBudgetSeconds : null,
      baselineSeconds: Number.isFinite(baselineSeconds) ? baselineSeconds : null,
    },
    ownerRole: String(rule?.ownerRole ?? ''),
    violations,
    warnings,
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const policyPath = resolvePath(root, options.policyPath);
const trendCsvPath = resolvePath(root, options.trendCsvPath);
const outputDir = resolvePath(root, options.outputDir);
const generatedAt = new Date().toISOString();

const policy = readJson(policyPath, null);
const defaults = getDefaults(policy);
const csvText = trendCsvPath && fs.existsSync(trendCsvPath) ? fs.readFileSync(trendCsvPath, 'utf8') : '';
const rows = csvText ? normalizeRows(csvText) : [];

let labels = [];
if (options.label) {
  labels = [options.label];
} else if (policy?.jobs && typeof policy.jobs === 'object') {
  labels = Object.keys(policy.jobs);
} else {
  labels = [...new Set(rows.map((row) => row.label))];
}

if (labels.length === 0) {
  labels = ['verify_phase1'];
}

const evaluations = labels.map((label) => {
  const rule = policy?.jobs?.[label] ?? {};
  return evaluateLabel(rows, label, rule, defaults);
});

const failedCount = evaluations.filter((item) => item.status === 'failed').length;
const warningCount = evaluations.reduce((sum, item) => sum + item.warnings.length, 0);
const status = failedCount > 0 ? 'failed' : warningCount > 0 ? 'warning' : 'passed';

const report = {
  generatedAt,
  status,
  policy: {
    path: policyPath ? path.relative(root, policyPath) : null,
    loaded: Boolean(policy),
    policyVersion: String(policy?.policyVersion ?? 'unversioned'),
    defaults,
  },
  trend: {
    path: trendCsvPath ? path.relative(root, trendCsvPath) : null,
    rows: rows.length,
  },
  summary: {
    labelsChecked: evaluations.length,
    failed: failedCount,
    warnings: warningCount,
    enforcementMode: options.enforce ? 'enforced' : 'observe_only',
  },
  checks: evaluations,
};

ensureDir(outputDir);
const stamp = generatedAt.replace(/[:.]/g, '-');
const stampPath = path.join(outputDir, `ci-runtime-slo-${stamp}.json`);
const latestPath = path.join(outputDir, 'ci-runtime-slo-latest.json');
fs.writeFileSync(stampPath, JSON.stringify(report, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

console.log(`Runtime SLO status: ${status}`);
console.log(`Rows read: ${rows.length}`);
for (const check of evaluations) {
  console.log(
    `- ${check.label}: status=${check.status}, latest=${check.latest?.durationSeconds ?? 'n/a'}s, runs=${check.runCount}, violations=${check.violations.length}`,
  );
}
console.log(`Wrote ${path.relative(root, stampPath)}`);
console.log(`Wrote ${path.relative(root, latestPath)}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Runtime SLO Check',
    '',
    `- Status: \`${status}\``,
    `- Checks: \`${evaluations.length}\``,
    `- Violations: \`${failedCount}\``,
    `- Warnings: \`${warningCount}\``,
    '',
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

if (options.enforce && status === 'failed') {
  process.exit(1);
}
