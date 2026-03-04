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

function toFixedNumber(value, digits = 3) {
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

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const opsDir = path.join(root, 'reports', 'ops');
const uxDir = path.join(root, 'reports', 'ux');

if (!fs.existsSync(opsDir)) {
  console.error(`Missing ops reports directory: ${path.relative(root, opsDir)}`);
  process.exit(1);
}

const rows = fs
  .readdirSync(opsDir)
  .filter((name) => /^release-gates-.*\.json$/i.test(name) && !name.toLowerCase().endsWith('latest.json'))
  .map((name) => {
    const filePath = path.join(opsDir, name);
    const data = readJson(filePath);
    const generatedAt = data?.generatedAt ?? null;
    const gateDurations = Array.isArray(data?.gates)
      ? data.gates.map((gate) => Number(gate?.durationMs)).filter((ms) => Number.isFinite(ms) && ms >= 0)
      : [];
    const totalDurationMs = gateDurations.reduce((sum, ms) => sum + ms, 0);
    return {
      name,
      generatedAt,
      status: String(data?.summary?.status ?? 'unknown'),
      totalDurationMs: totalDurationMs > 0 ? totalDurationMs : null,
    };
  })
  .filter((row) => Number.isFinite(Date.parse(row.generatedAt ?? '')))
  .sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));

const nowMs = Date.now();
const windowMs = options.windowDays * 24 * 60 * 60 * 1000;
const windowStartMs = nowMs - windowMs;
const inWindow = rows.filter((row) => Date.parse(row.generatedAt) >= windowStartMs);
const successful = inWindow.filter((row) => row.status === 'passed');
const durationMs = successful.map((row) => row.totalDurationMs).filter((ms) => Number.isFinite(ms) && ms >= 0);

const medianMinutes = percentile(durationMs, 0.5);
const p75Minutes = percentile(durationMs, 0.75);

const generatedAt = new Date().toISOString();
const payload = {
  generatedAt,
  windowDays: options.windowDays,
  windowStart: new Date(windowStartMs).toISOString(),
  sampleSize: durationMs.length,
  successfulRuns: successful.length,
  failedRuns: inWindow.length - successful.length,
  medianDiscoveryWorkflowMinutes: toFixedNumber(medianMinutes == null ? null : medianMinutes / 60000),
  p75DiscoveryWorkflowMinutes: toFixedNumber(p75Minutes == null ? null : p75Minutes / 60000),
  source: 'reports/ops/release-gates-*.json',
  workflowDefinition: 'verify:release-gates total runtime (phase1 + resilience)',
  note:
    durationMs.length > 0
      ? `Computed from ${durationMs.length} successful release-gate runs in the last ${options.windowDays} days.`
      : `No successful release-gate runs found in the last ${options.windowDays} days.`,
};

fs.mkdirSync(uxDir, { recursive: true });
const stamp = generatedAt.replace(/[:.]/g, '-');
const stampPath = path.join(uxDir, `task-timing-${stamp}.json`);
const latestPath = path.join(uxDir, 'task-timing-latest.json');
const legacyPath = path.join(uxDir, 'task-timing.json');
fs.writeFileSync(stampPath, JSON.stringify(payload, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));
fs.writeFileSync(legacyPath, JSON.stringify(payload, null, 2));

console.log(`Wrote ${path.relative(root, stampPath)}`);
console.log(`Wrote ${path.relative(root, latestPath)}`);
console.log(`Wrote ${path.relative(root, legacyPath)}`);
console.log(
  `Workflow timing: medianMin=${payload.medianDiscoveryWorkflowMinutes == null ? 'n/a' : payload.medianDiscoveryWorkflowMinutes}, sample=${payload.sampleSize}`,
);
