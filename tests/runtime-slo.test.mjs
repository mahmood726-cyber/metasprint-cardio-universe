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

test('runtime SLO check fails on regression cap breach when enforced', async () => {
  const cwd = makeTempDir('metasprint-runtime-slo-fail-');
  const scriptPath = path.join(repoRoot, 'scripts', 'operations', 'check-runtime-slo.mjs');
  const trendDir = path.join(cwd, 'reports', 'ci');
  const outputDir = path.join(cwd, 'reports', 'ops');
  fs.mkdirSync(trendDir, { recursive: true });

  const trendCsvPath = path.join(trendDir, 'runtime-trend.csv');
  fs.writeFileSync(
    trendCsvPath,
    [
      'generated_at,label,duration_seconds,budget_seconds,status,sha,ref,event',
      '2026-02-20T00:00:00.000Z,verify_phase1,100,1800,passed,,,',
      '2026-02-21T00:00:00.000Z,verify_phase1,102,1800,passed,,,',
      '2026-02-22T00:00:00.000Z,verify_phase1,98,1800,passed,,,',
      '2026-02-23T00:00:00.000Z,verify_phase1,101,1800,passed,,,',
      '2026-02-24T00:00:00.000Z,verify_phase1,130,1800,passed,,,',
      '',
    ].join('\n'),
  );

  const policyPath = path.join(cwd, 'policy.json');
  fs.writeFileSync(
    policyPath,
    JSON.stringify(
      {
        policyVersion: 'test',
        defaults: {
          historyWindow: 4,
          minHistoricalSamples: 3,
          maxRegressionRatio: 0.1,
          maxConsecutiveFailures: 1,
        },
        jobs: {
          verify_phase1: {
            maxRegressionRatio: 0.1,
          },
        },
      },
      null,
      2,
    ),
  );

  const result = await runNode(
    scriptPath,
    [
      '--policy',
      policyPath,
      '--trend-csv',
      trendCsvPath,
      '--output-dir',
      outputDir,
      '--label',
      'verify_phase1',
      '--enforce',
    ],
    { cwd },
  );

  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  const latestPath = path.join(outputDir, 'ci-runtime-slo-latest.json');
  assert.ok(fs.existsSync(latestPath));
  const report = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.match(JSON.stringify(report.checks[0].violations), /regression cap/i);
});

test('runtime SLO check returns warning (not failure) when no trend rows exist', async () => {
  const cwd = makeTempDir('metasprint-runtime-slo-warn-');
  const scriptPath = path.join(repoRoot, 'scripts', 'operations', 'check-runtime-slo.mjs');
  const outputDir = path.join(cwd, 'reports', 'ops');

  const policyPath = path.join(cwd, 'policy.json');
  fs.writeFileSync(
    policyPath,
    JSON.stringify(
      {
        policyVersion: 'test',
        jobs: {
          verify_phase1: {},
        },
      },
      null,
      2,
    ),
  );

  const result = await runNode(
    scriptPath,
    [
      '--policy',
      policyPath,
      '--trend-csv',
      path.join(cwd, 'reports', 'ci', 'runtime-trend.csv'),
      '--output-dir',
      outputDir,
      '--label',
      'verify_phase1',
      '--enforce',
    ],
    { cwd },
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'ci-runtime-slo-latest.json'), 'utf8'));
  assert.equal(report.status, 'warning');
});
