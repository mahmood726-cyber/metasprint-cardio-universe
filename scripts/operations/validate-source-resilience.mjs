import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const RUNTIME_SCHEMA_MODES = new Set(['off', 'warn', 'enforce']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function runDedup(root, args) {
  const scriptPath = path.join(root, 'scripts', 'engine', 'run-identity-dedup.mjs');
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureRuntimeSchemaSummary(summary, label) {
  const runtimeSchema = summary?.runtimeSchema;
  ensure(runtimeSchema && typeof runtimeSchema === 'object', `${label} summary.runtimeSchema must be present.`);
  const requestedMode = String(runtimeSchema.requestedMode ?? '').trim().toLowerCase();
  ensure(RUNTIME_SCHEMA_MODES.has(requestedMode), `${label} runtimeSchema.requestedMode must be one of off|warn|enforce.`);
  ensure(
    Number.isFinite(Number(runtimeSchema.sourcesWithRuntimeSchema ?? NaN)),
    `${label} runtimeSchema.sourcesWithRuntimeSchema must be numeric.`,
  );
  ensure(
    Number.isFinite(Number(runtimeSchema.unreportedSourceCount ?? NaN)),
    `${label} runtimeSchema.unreportedSourceCount must be numeric.`,
  );
  ensure(runtimeSchema.modeCounts && typeof runtimeSchema.modeCounts === 'object', `${label} runtimeSchema.modeCounts missing.`);
  ensure(Number.isFinite(Number(runtimeSchema.modeCounts.off ?? NaN)), `${label} runtimeSchema.modeCounts.off must be numeric.`);
  ensure(Number.isFinite(Number(runtimeSchema.modeCounts.warn ?? NaN)), `${label} runtimeSchema.modeCounts.warn must be numeric.`);
  ensure(
    Number.isFinite(Number(runtimeSchema.modeCounts.enforce ?? NaN)),
    `${label} runtimeSchema.modeCounts.enforce must be numeric.`,
  );
  ensure(Number.isFinite(Number(runtimeSchema.validatedCount ?? NaN)), `${label} runtimeSchema.validatedCount must be numeric.`);
  ensure(Number.isFinite(Number(runtimeSchema.warningCount ?? NaN)), `${label} runtimeSchema.warningCount must be numeric.`);
  ensure(Number.isFinite(Number(runtimeSchema.rejectedCount ?? NaN)), `${label} runtimeSchema.rejectedCount must be numeric.`);
  ensure(
    Number.isFinite(Number(runtimeSchema.validatorUnavailableCount ?? NaN)),
    `${label} runtimeSchema.validatorUnavailableCount must be numeric.`,
  );
  ensure(Number.isFinite(Number(runtimeSchema.sourcesWithIssues ?? NaN)), `${label} runtimeSchema.sourcesWithIssues must be numeric.`);
}

const root = process.cwd();
const opsDir = path.join(root, 'reports', 'ops');
const latestHealthFile = path.join(opsDir, 'source-health-latest.json');

const outageArgs = ['--sources', 'sample', '--strict-sources', '--simulate-outage', 'sample'];
const outageRun = runDedup(root, outageArgs);
ensure(outageRun.status === 2, `Outage scenario expected exit code 2, got ${outageRun.status}.`);
ensure(fs.existsSync(latestHealthFile), 'Outage scenario did not produce source-health-latest.json.');

const outageHealth = readJson(latestHealthFile);
const outageSample = (outageHealth.sources ?? []).find((entry) => entry.source === 'sample');
ensure(outageHealth.summary?.strictStatus === 'failed', 'Outage strict status should be failed.');
ensureRuntimeSchemaSummary(outageHealth.summary, 'Outage');
ensure(outageSample?.status === 'failed', 'Outage sample source should be failed.');
ensure(outageSample?.failureClass === 'simulated_outage', 'Outage failure class should be simulated_outage.');

const recoveryArgs = ['--sources', 'sample', '--strict-sources'];
const recoveryRun = runDedup(root, recoveryArgs);
ensure(recoveryRun.status === 0, `Recovery scenario expected exit code 0, got ${recoveryRun.status}.`);
ensure(fs.existsSync(latestHealthFile), 'Recovery scenario did not produce source-health-latest.json.');

const recoveryHealth = readJson(latestHealthFile);
const recoverySample = (recoveryHealth.sources ?? []).find((entry) => entry.source === 'sample');
ensure(recoveryHealth.summary?.strictStatus === 'passed', 'Recovery strict status should be passed.');
ensureRuntimeSchemaSummary(recoveryHealth.summary, 'Recovery');
ensure(recoverySample?.status === 'ok', 'Recovery sample source should be ok.');

const report = {
  generatedAt: new Date().toISOString(),
  scenarios: {
    outage: {
      args: outageArgs,
      exitCode: outageRun.status,
      strictStatus: outageHealth.summary?.strictStatus ?? null,
      sampleStatus: outageSample?.status ?? null,
      sampleFailureClass: outageSample?.failureClass ?? null,
      runtimeSchemaSummary: outageHealth.summary?.runtimeSchema ?? null,
    },
    recovery: {
      args: recoveryArgs,
      exitCode: recoveryRun.status,
      strictStatus: recoveryHealth.summary?.strictStatus ?? null,
      sampleStatus: recoverySample?.status ?? null,
      runtimeSchemaSummary: recoveryHealth.summary?.runtimeSchema ?? null,
    },
  },
};

fs.mkdirSync(opsDir, { recursive: true });
const stamp = report.generatedAt.replace(/[:.]/g, '-');
const stampFile = path.join(opsDir, `source-resilience-check-${stamp}.json`);
const latestFile = path.join(opsDir, 'source-resilience-check-latest.json');
fs.writeFileSync(stampFile, JSON.stringify(report, null, 2));
fs.writeFileSync(latestFile, JSON.stringify(report, null, 2));

console.log(`Outage scenario exit: ${outageRun.status}`);
console.log(`Recovery scenario exit: ${recoveryRun.status}`);
console.log(`Wrote ${path.relative(root, stampFile)}`);
console.log(`Wrote ${path.relative(root, latestFile)}`);
