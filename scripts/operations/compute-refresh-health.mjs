import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    windowDays: 30,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--window-days') {
      const value = Number(argv[i + 1] ?? options.windowDays);
      if (Number.isFinite(value) && value > 0) {
        options.windowDays = Math.floor(value);
      }
      i += 1;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function toFixedNumber(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
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

function computeRuntimeMs(row) {
  const summaryRuntime = Number(row?.summary?.totalSourceDurationMs);
  if (Number.isFinite(summaryRuntime) && summaryRuntime >= 0) return summaryRuntime;
  const sources = Array.isArray(row?.sources) ? row.sources : [];
  const sourceSum = sources.reduce((sum, source) => {
    const value = Number(source?.durationMs);
    return Number.isFinite(value) && value >= 0 ? sum + value : sum;
  }, 0);
  return sourceSum > 0 ? sourceSum : null;
}

function computeRuntimeSchemaSummary(row) {
  const runtimeSchema = row?.summary?.runtimeSchema;
  if (!runtimeSchema || typeof runtimeSchema !== 'object') {
    return null;
  }
  return {
    warningCount: Number(runtimeSchema.warningCount),
    rejectedCount: Number(runtimeSchema.rejectedCount),
    validatedCount: Number(runtimeSchema.validatedCount),
    validatorUnavailableCount: Number(runtimeSchema.validatorUnavailableCount),
    sourcesWithIssues: Number(runtimeSchema.sourcesWithIssues),
  };
}

function isRuntimeSchemaIssue(runtimeSchema) {
  if (!runtimeSchema || typeof runtimeSchema !== 'object' || Array.isArray(runtimeSchema)) {
    return false;
  }
  const warningCount = Number(runtimeSchema.warningCount);
  const rejectedCount = Number(runtimeSchema.rejectedCount);
  const issueCount = Number(runtimeSchema.issueCount);
  if (Number.isFinite(warningCount) && warningCount > 0) return true;
  if (Number.isFinite(rejectedCount) && rejectedCount > 0) return true;
  if (Number.isFinite(issueCount) && issueCount > 0) return true;
  return String(runtimeSchema.validator ?? '').trim().toLowerCase() === 'unavailable';
}

function computeRuntimeSchemaIssueSourceNames(row) {
  const sources = Array.isArray(row?.sources) ? row.sources : [];
  const names = new Set();
  for (const source of sources) {
    const sourceName = String(source?.source ?? '').trim();
    if (!sourceName) continue;
    if (isRuntimeSchemaIssue(source?.runtimeSchema)) {
      names.add(sourceName);
    }
  }
  return [...names];
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const opsDir = path.join(root, 'reports', 'ops');

if (!fs.existsSync(opsDir)) {
  console.error(`Missing ops reports directory: ${path.relative(root, opsDir)}`);
  process.exit(1);
}

const files = fs
  .readdirSync(opsDir)
  .filter((name) => /^source-health-live-.*\.json$/i.test(name) && !name.toLowerCase().endsWith('latest.json'));

const useLive = files.length > 0;
const fallbackFiles = useLive
  ? files
  : fs
      .readdirSync(opsDir)
      .filter((name) => /^source-health-.*\.json$/i.test(name) && !name.toLowerCase().includes('live-') && !name.toLowerCase().endsWith('latest.json'));

const selected = (useLive ? files : fallbackFiles)
  .map((name) => ({
    name,
    filePath: path.join(opsDir, name),
    data: readJson(path.join(opsDir, name)),
  }))
  .filter((entry) => Number.isFinite(Date.parse(entry?.data?.generatedAt ?? '')))
  .sort((a, b) => Date.parse(a.data.generatedAt) - Date.parse(b.data.generatedAt));

const nowMs = Date.now();
const windowMs = options.windowDays * 24 * 60 * 60 * 1000;
const windowStartMs = nowMs - windowMs;
const windowRows = selected.filter((entry) => Date.parse(entry.data.generatedAt) >= windowStartMs);

const successfulRuns = windowRows.filter((entry) => {
  const strictStatus = String(entry?.data?.summary?.strictStatus ?? 'failed');
  const failedSources = Number(entry?.data?.summary?.failedSources ?? 1);
  return strictStatus === 'passed' && failedSources === 0;
});

const runtimeMsValues = windowRows
  .map((entry) => computeRuntimeMs(entry.data))
  .filter((value) => Number.isFinite(value) && value >= 0);

const successRate = windowRows.length > 0 ? successfulRuns.length / windowRows.length : null;
const p95RuntimeMs = percentile(runtimeMsValues, 0.95);
const medianRuntimeMs = percentile(runtimeMsValues, 0.5);
const runtimeSchemaRows = windowRows
  .map((entry) => computeRuntimeSchemaSummary(entry.data))
  .filter((entry) => entry != null);
const runtimeSchemaCoverage = windowRows.length > 0 ? runtimeSchemaRows.length / windowRows.length : null;
const runtimeSchemaTotals = runtimeSchemaRows.reduce(
  (acc, entry) => {
    const hasIssue =
      (Number.isFinite(entry.warningCount) && entry.warningCount > 0) ||
      (Number.isFinite(entry.rejectedCount) && entry.rejectedCount > 0) ||
      (Number.isFinite(entry.validatorUnavailableCount) && entry.validatorUnavailableCount > 0) ||
      (Number.isFinite(entry.sourcesWithIssues) && entry.sourcesWithIssues > 0);
    if (Number.isFinite(entry.warningCount) && entry.warningCount > 0) acc.warningRuns += 1;
    if (Number.isFinite(entry.rejectedCount) && entry.rejectedCount > 0) acc.rejectedRuns += 1;
    if (Number.isFinite(entry.validatorUnavailableCount) && entry.validatorUnavailableCount > 0) acc.validatorUnavailableRuns += 1;
    if (hasIssue) acc.issueRuns += 1;
    acc.warningRows += Number.isFinite(entry.warningCount) && entry.warningCount > 0 ? entry.warningCount : 0;
    acc.rejectedRows += Number.isFinite(entry.rejectedCount) && entry.rejectedCount > 0 ? entry.rejectedCount : 0;
    acc.validatedRows += Number.isFinite(entry.validatedCount) && entry.validatedCount > 0 ? entry.validatedCount : 0;
    acc.issueSourceRunTotal += Number.isFinite(entry.sourcesWithIssues) && entry.sourcesWithIssues > 0 ? entry.sourcesWithIssues : 0;
    return acc;
  },
  {
    warningRuns: 0,
    rejectedRuns: 0,
    validatorUnavailableRuns: 0,
    issueRuns: 0,
    warningRows: 0,
    rejectedRows: 0,
    validatedRows: 0,
    issueSourceRunTotal: 0,
  },
);
const runtimeSchemaIssueSourceNames = new Set();
for (const row of windowRows) {
  const issueSourceNames = computeRuntimeSchemaIssueSourceNames(row.data);
  for (const name of issueSourceNames) {
    runtimeSchemaIssueSourceNames.add(name);
  }
}
const runtimeSchemaIssueSourceNameList = [...runtimeSchemaIssueSourceNames].sort((a, b) => a.localeCompare(b));

const generatedAt = new Date().toISOString();
const payload = {
  generatedAt,
  windowDays: options.windowDays,
  windowStart: new Date(windowStartMs).toISOString(),
  sampleSize: windowRows.length,
  successfulRuns: successfulRuns.length,
  failedRuns: windowRows.length - successfulRuns.length,
  refreshSuccessRate30d: toFixedNumber(successRate),
  refreshRuntimeP95Minutes: toFixedNumber(p95RuntimeMs == null ? null : p95RuntimeMs / 60000, 3),
  refreshRuntimeMedianMinutes: toFixedNumber(medianRuntimeMs == null ? null : medianRuntimeMs / 60000, 3),
  runtimeSchemaTelemetryCoverage: toFixedNumber(runtimeSchemaCoverage),
  runtimeSchemaWarningRuns: runtimeSchemaTotals.warningRuns,
  runtimeSchemaRejectedRuns: runtimeSchemaTotals.rejectedRuns,
  runtimeSchemaValidatorUnavailableRuns: runtimeSchemaTotals.validatorUnavailableRuns,
  runtimeSchemaWarningRows: runtimeSchemaTotals.warningRows,
  runtimeSchemaRejectedRows: runtimeSchemaTotals.rejectedRows,
  runtimeSchemaValidatedRows: runtimeSchemaTotals.validatedRows,
  runtimeSchemaIssueRuns: runtimeSchemaTotals.issueRuns,
  runtimeSchemaIssueSourceRunTotal: runtimeSchemaTotals.issueSourceRunTotal,
  runtimeSchemaIssueSourceCount: runtimeSchemaIssueSourceNameList.length,
  runtimeSchemaIssueSourceNames: runtimeSchemaIssueSourceNameList,
  source: useLive ? 'reports/ops/source-health-live-*.json' : 'reports/ops/source-health-*.json',
  note:
    windowRows.length > 0
      ? `Computed from ${windowRows.length} strict-source telemetry runs in the last ${options.windowDays} days.`
      : `No source-health telemetry runs found in the last ${options.windowDays} days.`,
};

const stamp = generatedAt.replace(/[:.]/g, '-');
const stampPath = path.join(opsDir, `refresh-health-${stamp}.json`);
const latestPath = path.join(opsDir, 'refresh-health-latest.json');
const legacyPath = path.join(opsDir, 'refresh-health.json');
fs.writeFileSync(stampPath, JSON.stringify(payload, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));
fs.writeFileSync(legacyPath, JSON.stringify(payload, null, 2));

console.log(`Wrote ${path.relative(root, stampPath)}`);
console.log(`Wrote ${path.relative(root, latestPath)}`);
console.log(`Wrote ${path.relative(root, legacyPath)}`);
console.log(
  `Refresh health: successRate=${payload.refreshSuccessRate30d == null ? 'n/a' : payload.refreshSuccessRate30d}, p95Min=${payload.refreshRuntimeP95Minutes == null ? 'n/a' : payload.refreshRuntimeP95Minutes}, sample=${payload.sampleSize}`,
);
