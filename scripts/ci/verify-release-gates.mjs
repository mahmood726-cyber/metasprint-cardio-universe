import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const gates = [
  { id: 'phase1', script: 'verify:phase1' },
  { id: 'resilience', script: 'ops:resilience-check' },
  { id: 'doc_sync', script: 'ops:doc-sync:enforce' },
];

function parseArgs(argv) {
  const skip = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) skip.add(value);
      i += 1;
    }
  }
  return { skip };
}

function runGate(root, gate) {
  const startedAt = Date.now();
  const result = spawnSync(`npm run ${gate.script}`, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
  });

  const durationMs = Date.now() - startedAt;
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  const errored = Boolean(result.error);
  return {
    id: gate.id,
    script: gate.script,
    exitCode,
    durationMs,
    status: !errored && exitCode === 0 ? 'passed' : 'failed',
    error: result.error ? String(result.error.message ?? result.error) : null,
  };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const outDir = path.join(root, 'reports', 'ops');
const generatedAt = new Date().toISOString();
const results = [];

for (const gate of gates) {
  if (options.skip.has(gate.id)) continue;
  const result = runGate(root, gate);
  results.push(result);
  if (result.status === 'failed') {
    break;
  }
}

const requiredCount = gates.filter((gate) => !options.skip.has(gate.id)).length;
const passed = results.every((r) => r.status === 'passed') && results.length === requiredCount;
const report = {
  generatedAt,
  summary: {
    total: gates.length,
    required: requiredCount,
    executed: results.length,
    skipped: [...options.skip],
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    status: passed ? 'passed' : 'failed',
  },
  gates: results,
};

fs.mkdirSync(outDir, { recursive: true });
const stamp = generatedAt.replace(/[:.]/g, '-');
const stampFile = path.join(outDir, `release-gates-${stamp}.json`);
const latestFile = path.join(outDir, 'release-gates-latest.json');
fs.writeFileSync(stampFile, JSON.stringify(report, null, 2));
fs.writeFileSync(latestFile, JSON.stringify(report, null, 2));

console.log(`Wrote ${path.relative(root, stampFile)}`);
console.log(`Wrote ${path.relative(root, latestFile)}`);
console.log(`Release gate status: ${report.summary.status}`);

if (!passed) {
  process.exit(1);
}
