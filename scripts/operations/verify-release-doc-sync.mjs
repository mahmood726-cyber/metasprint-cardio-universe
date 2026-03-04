import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    manifestPath: 'docs/operations/RELEASE_DOC_SYNC.v1.json',
    outputDir: 'reports/ops',
    enforce: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.manifestPath = value;
      i += 1;
      continue;
    }
    if (arg === '--output-dir') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.outputDir = value;
      i += 1;
      continue;
    }
    if (arg === '--enforce') {
      options.enforce = true;
    }
  }

  return options;
}

function resolvePath(root, targetPath) {
  if (!targetPath) return null;
  return path.isAbsolute(targetPath) ? targetPath : path.join(root, targetPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseDateOnly(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function ageDaysFrom(dateMs, nowMs) {
  if (!Number.isFinite(dateMs)) return null;
  return (nowMs - dateMs) / (24 * 60 * 60 * 1000);
}

function validateEntry(root, sectionName, entry, defaultMaxAgeDays, nowMs) {
  const violations = [];
  const warnings = [];
  const relativePath = String(entry?.path ?? '').trim();
  const ownerRole = String(entry?.ownerRole ?? '').trim();
  const reviewedOn = String(entry?.reviewedOn ?? '').trim();
  const maxAgeDaysRaw = Number(entry?.maxAgeDays);
  const maxAgeDays = Number.isFinite(maxAgeDaysRaw) && maxAgeDaysRaw > 0 ? maxAgeDaysRaw : defaultMaxAgeDays;
  const mustExist = entry?.mustExist !== false;

  if (!relativePath) {
    violations.push(`[${sectionName}] entry has empty path.`);
    return {
      section: sectionName,
      path: relativePath,
      ownerRole,
      reviewedOn,
      status: 'failed',
      maxAgeDays,
      ageDays: null,
      exists: false,
      violations,
      warnings,
    };
  }

  const absolutePath = resolvePath(root, relativePath);
  const exists = fs.existsSync(absolutePath);
  if (mustExist && !exists) {
    violations.push(`[${sectionName}] file not found: ${relativePath}`);
  } else if (!exists) {
    warnings.push(`[${sectionName}] optional file not found: ${relativePath}`);
  }

  const reviewedMs = parseDateOnly(reviewedOn);
  if (reviewedMs == null) {
    violations.push(`[${sectionName}] invalid reviewedOn date for ${relativePath} (expected YYYY-MM-DD).`);
  }

  const ageDays = ageDaysFrom(reviewedMs, nowMs);
  if (Number.isFinite(ageDays) && Number.isFinite(maxAgeDays) && ageDays > maxAgeDays) {
    violations.push(
      `[${sectionName}] ${relativePath} is stale (${ageDays.toFixed(1)}d old; max ${maxAgeDays}d).`,
    );
  }

  const mtime = exists ? fs.statSync(absolutePath).mtime.toISOString() : null;
  const status = violations.length > 0 ? 'failed' : warnings.length > 0 ? 'warning' : 'passed';
  return {
    section: sectionName,
    path: relativePath,
    ownerRole,
    reviewedOn: reviewedOn || null,
    exists,
    mtime,
    maxAgeDays,
    ageDays: Number.isFinite(ageDays) ? Number(ageDays.toFixed(2)) : null,
    status,
    violations,
    warnings,
  };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const manifestPath = resolvePath(root, options.manifestPath);
const outputDir = resolvePath(root, options.outputDir);

if (!manifestPath || !fs.existsSync(manifestPath)) {
  console.error(`Missing doc sync manifest: ${manifestPath ? path.relative(root, manifestPath) : options.manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
const nowMs = Date.now();
const defaultMaxAgeDays = Number.isFinite(Number(manifest?.defaultMaxAgeDays))
  ? Math.max(1, Number(manifest.defaultMaxAgeDays))
  : 35;
const generatedAt = new Date().toISOString();

const documentEntries = Array.isArray(manifest?.documents) ? manifest.documents : [];
const evidenceEntries = Array.isArray(manifest?.evidenceDocs) ? manifest.evidenceDocs : [];

const checks = [
  ...documentEntries.map((entry) => validateEntry(root, 'documents', entry, defaultMaxAgeDays, nowMs)),
  ...evidenceEntries.map((entry) => validateEntry(root, 'evidenceDocs', entry, defaultMaxAgeDays, nowMs)),
];

const failedCount = checks.filter((check) => check.status === 'failed').length;
const warningCount = checks.reduce((sum, check) => sum + check.warnings.length, 0);
const status = failedCount > 0 ? 'failed' : warningCount > 0 ? 'warning' : 'passed';

const report = {
  generatedAt,
  status,
  manifest: {
    path: path.relative(root, manifestPath),
    manifestVersion: String(manifest?.manifestVersion ?? 'unversioned'),
    releaseCycleId: String(manifest?.releaseCycleId ?? 'unspecified'),
    updatedOn: String(manifest?.updatedOn ?? ''),
    defaultMaxAgeDays,
  },
  summary: {
    totalChecks: checks.length,
    failed: failedCount,
    warnings: warningCount,
    enforcementMode: options.enforce ? 'enforced' : 'observe_only',
  },
  checks,
};

ensureDir(outputDir);
const stamp = generatedAt.replace(/[:.]/g, '-');
const stampPath = path.join(outputDir, `release-doc-sync-${stamp}.json`);
const latestPath = path.join(outputDir, 'release-doc-sync-latest.json');
fs.writeFileSync(stampPath, JSON.stringify(report, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

console.log(`Release doc sync status: ${status}`);
console.log(`Checks: ${checks.length}, failed: ${failedCount}, warnings: ${warningCount}`);
console.log(`Wrote ${path.relative(root, stampPath)}`);
console.log(`Wrote ${path.relative(root, latestPath)}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Release Doc Sync',
    '',
    `- Status: \`${status}\``,
    `- Checks: \`${checks.length}\``,
    `- Failed: \`${failedCount}\``,
    `- Warnings: \`${warningCount}\``,
    '',
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

if (options.enforce && status === 'failed') {
  process.exit(1);
}
