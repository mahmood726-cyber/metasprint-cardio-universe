import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const options = {
    outputDir: 'reports/ops',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output-dir') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.outputDir = value;
      i += 1;
    }
  }

  return options;
}

function resolvePath(root, targetPath) {
  if (!targetPath) return null;
  return path.isAbsolute(targetPath) ? targetPath : path.join(root, targetPath);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function trimTail(text, maxLines = 40) {
  const normalized = String(text ?? '').trim();
  if (!normalized) return '';
  const lines = normalized.split(/\r?\n/);
  const tail = lines.slice(-maxLines);
  return tail.join('\n');
}

function runScenario(root, scenario) {
  const startedAt = Date.now();
  const result = spawnSync(scenario.command, scenario.args, {
    cwd: root,
    shell: Boolean(scenario.shell),
    encoding: 'utf8',
  });
  const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  const status = exitCode === 0 && !result.error ? 'passed' : 'failed';

  return {
    id: scenario.id,
    description: scenario.description,
    command: [scenario.command, ...scenario.args].join(' '),
    startedAt: new Date(startedAt).toISOString(),
    durationSeconds,
    exitCode,
    status,
    stdoutTail: trimTail(result.stdout, 30),
    stderrTail: trimTail(result.stderr, 30),
    error: result.error ? String(result.error.message ?? result.error) : null,
  };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const outputDir = resolvePath(root, options.outputDir);
const generatedAt = new Date().toISOString();

const scenarios = [
  {
    id: 'lock_contention_suite',
    description: 'Validate lock contention behavior across dedup/override/drift scripts.',
    command: process.execPath,
    args: ['--test', 'tests/lock-contention.test.mjs'],
    shell: false,
  },
  {
    id: 'source_outage_recovery',
    description: 'Validate strict outage and recovery behavior for source health.',
    command: 'npm',
    args: ['run', 'ops:resilience-check'],
    shell: true,
  },
  {
    id: 'release_doc_sync',
    description: 'Validate runbooks and evidence docs are reviewed within cadence.',
    command: 'npm',
    args: ['run', 'ops:doc-sync:enforce'],
    shell: true,
  },
];

const results = scenarios.map((scenario) => runScenario(root, scenario));
const failed = results.filter((item) => item.status === 'failed');
const status = failed.length > 0 ? 'failed' : 'passed';

const report = {
  generatedAt,
  cadence: {
    expectedFrequencyDays: 90,
    ownerRole: 'QA Lead',
  },
  summary: {
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: failed.length,
    status,
  },
  scenarios: results,
};

ensureDir(outputDir);
const stamp = generatedAt.replace(/[:.]/g, '-');
const stampPath = path.join(outputDir, `quarterly-ops-drill-${stamp}.json`);
const latestPath = path.join(outputDir, 'quarterly-ops-drill-latest.json');
fs.writeFileSync(stampPath, JSON.stringify(report, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

console.log(`Quarterly ops drill: ${status}`);
for (const item of results) {
  console.log(`- ${item.id}: ${item.status} (${item.durationSeconds}s, exit=${item.exitCode})`);
}
console.log(`Wrote ${path.relative(root, stampPath)}`);
console.log(`Wrote ${path.relative(root, latestPath)}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Quarterly Ops Drill',
    '',
    `- Status: \`${status}\``,
    `- Scenarios: \`${results.length}\``,
    `- Failed: \`${failed.length}\``,
    '',
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

if (status !== 'passed') {
  process.exit(1);
}
