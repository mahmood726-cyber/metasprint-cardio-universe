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

test('release doc sync passes when reviewed dates are within max age', async () => {
  const cwd = makeTempDir('metasprint-doc-sync-pass-');
  const scriptPath = path.join(repoRoot, 'scripts', 'operations', 'verify-release-doc-sync.mjs');
  const outputDir = path.join(cwd, 'reports', 'ops');

  const docPath = path.join(cwd, 'docs', 'operations', 'STRICT_SOURCE_RUNBOOK.md');
  fs.mkdirSync(path.dirname(docPath), { recursive: true });
  fs.writeFileSync(docPath, '# Runbook\n');

  const today = new Date().toISOString().slice(0, 10);
  const manifestPath = path.join(cwd, 'docs', 'operations', 'RELEASE_DOC_SYNC.v1.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        manifestVersion: 'release_doc_sync.v1',
        releaseCycleId: '2026Q2',
        updatedOn: today,
        defaultMaxAgeDays: 35,
        documents: [
          {
            path: 'docs/operations/STRICT_SOURCE_RUNBOOK.md',
            ownerRole: 'Data Lead',
            reviewedOn: today,
          },
        ],
      },
      null,
      2,
    ),
  );

  const result = await runNode(
    scriptPath,
    ['--manifest', manifestPath, '--output-dir', outputDir, '--enforce'],
    { cwd },
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'release-doc-sync-latest.json'), 'utf8'));
  assert.equal(report.status, 'passed');
});

test('release doc sync fails when reviewed dates are stale', async () => {
  const cwd = makeTempDir('metasprint-doc-sync-fail-');
  const scriptPath = path.join(repoRoot, 'scripts', 'operations', 'verify-release-doc-sync.mjs');
  const outputDir = path.join(cwd, 'reports', 'ops');

  const docPath = path.join(cwd, 'docs', 'operations', 'STRICT_SOURCE_RUNBOOK.md');
  fs.mkdirSync(path.dirname(docPath), { recursive: true });
  fs.writeFileSync(docPath, '# Runbook\n');

  const manifestPath = path.join(cwd, 'docs', 'operations', 'RELEASE_DOC_SYNC.v1.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        manifestVersion: 'release_doc_sync.v1',
        releaseCycleId: '2026Q2',
        updatedOn: '2026-03-01',
        defaultMaxAgeDays: 30,
        documents: [
          {
            path: 'docs/operations/STRICT_SOURCE_RUNBOOK.md',
            ownerRole: 'Data Lead',
            reviewedOn: '2025-01-01',
          },
        ],
      },
      null,
      2,
    ),
  );

  const result = await runNode(
    scriptPath,
    ['--manifest', manifestPath, '--output-dir', outputDir, '--enforce'],
    { cwd },
  );

  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'release-doc-sync-latest.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.match(JSON.stringify(report.checks[0].violations), /stale/i);
});
