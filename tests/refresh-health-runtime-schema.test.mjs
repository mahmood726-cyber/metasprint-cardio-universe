import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runNode(scriptPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function writeSourceHealthRun(opsDir, payload) {
  const stamp = String(payload.generatedAt).replace(/[:.]/g, '-');
  const filePath = path.join(opsDir, `source-health-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

test('compute-refresh-health aggregates runtime schema telemetry counters', async () => {
  const cwd = makeTempDir('metasprint-refresh-runtime-schema-');
  const scriptPath = path.join(repoRoot, 'scripts', 'operations', 'compute-refresh-health.mjs');
  const opsDir = path.join(cwd, 'reports', 'ops');
  fs.mkdirSync(opsDir, { recursive: true });

  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const rows = [
    {
      generatedAt: new Date(nowMs - 2 * dayMs).toISOString(),
      summary: {
        strictStatus: 'passed',
        failedSources: 0,
        totalSourceDurationMs: 1000,
        runtimeSchema: {
          warningCount: 0,
          rejectedCount: 0,
          validatedCount: 12,
          validatorUnavailableCount: 0,
          sourcesWithIssues: 0,
        },
      },
      sources: [
        {
          source: 'ctgov',
          runtimeSchema: {
            warningCount: 0,
            rejectedCount: 0,
            issueCount: 0,
            validator: 'ajv',
          },
        },
      ],
    },
    {
      generatedAt: new Date(nowMs - dayMs).toISOString(),
      summary: {
        strictStatus: 'passed',
        failedSources: 0,
        totalSourceDurationMs: 2000,
        runtimeSchema: {
          warningCount: 2,
          rejectedCount: 0,
          validatedCount: 8,
          validatorUnavailableCount: 1,
          sourcesWithIssues: 1,
        },
      },
      sources: [
        {
          source: 'ctgov',
          runtimeSchema: {
            warningCount: 2,
            rejectedCount: 0,
            issueCount: 1,
            validator: 'ajv',
          },
        },
        {
          source: 'pubmed',
          runtimeSchema: {
            warningCount: 0,
            rejectedCount: 0,
            issueCount: 0,
            validator: 'ajv',
          },
        },
      ],
    },
    {
      generatedAt: new Date(nowMs).toISOString(),
      summary: {
        strictStatus: 'failed',
        failedSources: 1,
        totalSourceDurationMs: 3000,
        runtimeSchema: {
          warningCount: 0,
          rejectedCount: 3,
          validatedCount: 5,
          validatorUnavailableCount: 0,
          sourcesWithIssues: 1,
        },
      },
      sources: [
        {
          source: 'ctgov',
          runtimeSchema: {
            warningCount: 0,
            rejectedCount: 3,
            issueCount: 1,
            validator: 'ajv',
          },
        },
        {
          source: 'openalex',
          runtimeSchema: {
            warningCount: 0,
            rejectedCount: 0,
            issueCount: 0,
            validator: 'unavailable',
          },
        },
      ],
    },
  ];

  rows.forEach((row) => writeSourceHealthRun(opsDir, row));

  const result = await runNode(scriptPath, ['--window-days', '30'], { cwd });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);

  const report = JSON.parse(fs.readFileSync(path.join(opsDir, 'refresh-health-latest.json'), 'utf8'));
  assert.equal(report.sampleSize, 3);
  assert.equal(report.runtimeSchemaTelemetryCoverage, 1);
  assert.equal(report.runtimeSchemaWarningRuns, 1);
  assert.equal(report.runtimeSchemaRejectedRuns, 1);
  assert.equal(report.runtimeSchemaValidatorUnavailableRuns, 1);
  assert.equal(report.runtimeSchemaWarningRows, 2);
  assert.equal(report.runtimeSchemaRejectedRows, 3);
  assert.equal(report.runtimeSchemaValidatedRows, 25);
  assert.equal(report.runtimeSchemaIssueRuns, 2);
  assert.equal(report.runtimeSchemaIssueSourceRunTotal, 2);
  assert.equal(report.runtimeSchemaIssueSourceCount, 2);
  assert.deepEqual(report.runtimeSchemaIssueSourceNames, ['ctgov', 'openalex']);
});

test('compute-refresh-health tolerates missing runtime schema telemetry', async () => {
  const cwd = makeTempDir('metasprint-refresh-runtime-schema-missing-');
  const scriptPath = path.join(repoRoot, 'scripts', 'operations', 'compute-refresh-health.mjs');
  const opsDir = path.join(cwd, 'reports', 'ops');
  fs.mkdirSync(opsDir, { recursive: true });

  writeSourceHealthRun(opsDir, {
    generatedAt: new Date().toISOString(),
    summary: {
      strictStatus: 'passed',
      failedSources: 0,
      totalSourceDurationMs: 900,
    },
    sources: [],
  });

  const result = await runNode(scriptPath, ['--window-days', '30'], { cwd });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);

  const report = JSON.parse(fs.readFileSync(path.join(opsDir, 'refresh-health-latest.json'), 'utf8'));
  assert.equal(report.runtimeSchemaTelemetryCoverage, 0);
  assert.equal(report.runtimeSchemaWarningRuns, 0);
  assert.equal(report.runtimeSchemaRejectedRuns, 0);
  assert.equal(report.runtimeSchemaValidatorUnavailableRuns, 0);
  assert.equal(report.runtimeSchemaWarningRows, 0);
  assert.equal(report.runtimeSchemaRejectedRows, 0);
  assert.equal(report.runtimeSchemaValidatedRows, 0);
  assert.equal(report.runtimeSchemaIssueRuns, 0);
  assert.equal(report.runtimeSchemaIssueSourceRunTotal, 0);
  assert.equal(report.runtimeSchemaIssueSourceCount, 0);
  assert.deepEqual(report.runtimeSchemaIssueSourceNames, []);
});
