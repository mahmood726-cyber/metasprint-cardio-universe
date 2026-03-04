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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnNode(scriptPath, args, options = {}) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

function waitChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
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

async function runNode(scriptPath, args, options = {}) {
  const child = spawnNode(scriptPath, args, options);
  return waitChild(child);
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}

test('run-identity-dedup lock contention returns code 2 for second process', async () => {
  const cwd = makeTempDir('metasprint-lock-dedup-');
  const scriptPath = path.join(repoRoot, 'scripts', 'engine', 'run-identity-dedup.mjs');
  const lockPath = path.join(cwd, 'reports', 'dedup', '.run-identity-dedup.lock');

  const first = spawnNode(scriptPath, ['--sources', 'sample', '--strict-integrity'], {
    cwd,
    env: { CODEX_LOCK_HOLD_MS: '800' },
  });

  await waitForFile(lockPath);

  const second = await runNode(scriptPath, ['--sources', 'sample', '--strict-integrity'], { cwd });
  const firstResult = await waitChild(first);

  assert.equal(second.code, 2);
  assert.match(`${second.stdout}\n${second.stderr}`, /lock exists/i);
  assert.equal(firstResult.code, 0);
});

test('apply-override-decisions lock contention returns code 2 for second process', async () => {
  const cwd = makeTempDir('metasprint-lock-overrides-');
  const scriptPath = path.join(repoRoot, 'scripts', 'engine', 'apply-override-decisions.mjs');
  const reportsDir = path.join(cwd, 'reports', 'dedup');
  fs.mkdirSync(reportsDir, { recursive: true });

  const queuePath = path.join(reportsDir, 'override-queue.csv');
  const overridesPath = path.join(reportsDir, 'overrides.json');
  fs.writeFileSync(
    queuePath,
    'left_trial_id,right_trial_id,decision,reviewer,reason\ntrial_a,trial_b,force_merge,reviewer1,seed\n',
  );
  fs.writeFileSync(overridesPath, JSON.stringify({ forceMerge: [], forceSplit: [] }, null, 2));

  const first = spawnNode(scriptPath, [queuePath, overridesPath], {
    cwd,
    env: { CODEX_LOCK_HOLD_MS: '800' },
  });

  await waitForFile(`${overridesPath}.lock`);

  const second = await runNode(scriptPath, [queuePath, overridesPath], { cwd });
  const firstResult = await waitChild(first);

  assert.equal(second.code, 2);
  assert.match(`${second.stdout}\n${second.stderr}`, /lock exists/i);
  assert.equal(firstResult.code, 0);
});

test('compute-living-drift lock contention returns code 2 for second process', async () => {
  const cwd = makeTempDir('metasprint-lock-drift-');
  const scriptPath = path.join(repoRoot, 'scripts', 'operations', 'compute-living-drift.mjs');
  const lockPath = path.join(cwd, 'reports', 'ops', 'living-drift-history.json.lock');

  const first = spawnNode(scriptPath, [], {
    cwd,
    env: { CODEX_LOCK_HOLD_MS: '800' },
  });

  await waitForFile(lockPath);

  const second = await runNode(scriptPath, [], { cwd });
  const firstResult = await waitChild(first);

  assert.equal(second.code, 2);
  assert.match(`${second.stdout}\n${second.stderr}`, /lock exists/i);
  assert.equal(firstResult.code, 0);
});
