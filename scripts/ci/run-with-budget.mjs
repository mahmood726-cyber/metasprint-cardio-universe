import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const options = {
    label: 'job',
    budgetSeconds: 1800,
    command: [],
  };

  let atCommand = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      atCommand = true;
      options.command = argv.slice(i + 1);
      break;
    }
    if (arg === '--label') {
      options.label = String(argv[i + 1] ?? options.label);
      i += 1;
      continue;
    }
    if (arg === '--budget-seconds') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) options.budgetSeconds = value;
      i += 1;
      continue;
    }
  }

  if (!atCommand || options.command.length === 0) {
    throw new Error('Usage: node scripts/ci/run-with-budget.mjs --label <name> --budget-seconds <n> -- <command...>');
  }

  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendCsv(filePath, row) {
  const header = 'generated_at,label,duration_seconds,budget_seconds,status,sha,ref,event\n';
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header);
  }
  fs.appendFileSync(filePath, `${row.join(',')}\n`);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve(Number.isFinite(code) ? code : 1);
    });
  });
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const reportsDir = path.join(root, 'reports', 'ci');
ensureDir(reportsDir);

const [cmd, ...cmdArgs] = options.command;
const startedAt = Date.now();
const generatedAt = new Date().toISOString();
const exitCode = await runCommand(cmd, cmdArgs);
const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
const overBudget = durationSeconds > options.budgetSeconds;
const status = exitCode === 0 && !overBudget ? 'passed' : overBudget ? 'budget_exceeded' : 'failed';

const payload = {
  generatedAt,
  label: options.label,
  command: options.command,
  durationSeconds,
  budgetSeconds: options.budgetSeconds,
  status,
  commandExitCode: exitCode,
  sha: process.env.GITHUB_SHA ?? null,
  ref: process.env.GITHUB_REF ?? null,
  event: process.env.GITHUB_EVENT_NAME ?? null,
};

const jsonPath = path.join(reportsDir, `${options.label}-runtime.json`);
fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

const csvPath = path.join(reportsDir, 'runtime-trend.csv');
appendCsv(csvPath, [
  generatedAt,
  options.label,
  durationSeconds,
  options.budgetSeconds,
  status,
  process.env.GITHUB_SHA ?? '',
  process.env.GITHUB_REF ?? '',
  process.env.GITHUB_EVENT_NAME ?? '',
]);

if (process.env.GITHUB_STEP_SUMMARY) {
  const summaryLines = [
    `### Runtime Budget: ${options.label}`,
    '',
    `- Duration: \`${durationSeconds}s\``,
    `- Budget: \`${options.budgetSeconds}s\``,
    `- Status: \`${status}\``,
    `- Artifact: \`${path.relative(root, jsonPath)}\``,
    '',
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summaryLines.join('\n')}\n`);
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
if (overBudget) {
  console.error(
    `Runtime budget exceeded for ${options.label}: ${durationSeconds}s > ${options.budgetSeconds}s`,
  );
  process.exit(1);
}
