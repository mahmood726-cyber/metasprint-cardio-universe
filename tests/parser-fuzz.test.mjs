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

test('apply-override-decisions tolerates quoted CSV with commas, quotes, and newlines', async () => {
  const cwd = makeTempDir('metasprint-parser-csv-');
  const scriptPath = path.join(repoRoot, 'scripts', 'engine', 'apply-override-decisions.mjs');
  const reportsDir = path.join(cwd, 'reports', 'dedup');
  fs.mkdirSync(reportsDir, { recursive: true });

  const queuePath = path.join(reportsDir, 'override-queue.csv');
  const overridesPath = path.join(reportsDir, 'overrides.json');
  fs.writeFileSync(
    queuePath,
    [
      'left_trial_id,right_trial_id,decision,reviewer,reason',
      'trial_a,trial_b,force_merge,reviewer1,"line1, with comma',
      'line2 with ""quoted"" text"',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(overridesPath, JSON.stringify({ forceMerge: [], forceSplit: [] }, null, 2));

  const result = await runNode(scriptPath, [queuePath, overridesPath], { cwd });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);

  const nextOverrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
  assert.equal(nextOverrides.forceMerge.length, 1);
  assert.match(nextOverrides.forceMerge[0].reason, /line2 with "quoted" text/i);
});

test('run-identity-dedup reports malformed overrides JSON clearly', async () => {
  const cwd = makeTempDir('metasprint-parser-json-');
  const scriptPath = path.join(repoRoot, 'scripts', 'engine', 'run-identity-dedup.mjs');
  const reportsDir = path.join(cwd, 'reports', 'dedup');
  fs.mkdirSync(reportsDir, { recursive: true });

  const overridesPath = path.join(reportsDir, 'overrides.json');
  fs.writeFileSync(overridesPath, '{ this is malformed json ');

  const result = await runNode(scriptPath, ['--sources', 'sample', '--strict-integrity', '--overrides', overridesPath], {
    cwd,
  });

  assert.notEqual(result.code, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Failed to parse overrides file/i);
});
