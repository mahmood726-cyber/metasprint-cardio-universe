import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createSimulatedOutageError } from '../../src/data/connectors/base.js';
import { loadUniverseFromConnectorWithMeta } from '../../src/data/repository/universe-repository.js';
import { buildIdentityGraph } from '../../src/engine/identity/index.js';
import { buildProvenanceLedger } from '../../src/engine/provenance/index.js';
import { SAMPLE_TRIALS } from '../../src/discovery/data/sample-data.js';

const RUNTIME_SCHEMA_MODES = new Set(['off', 'warn', 'enforce']);
const MAX_RUNTIME_SCHEMA_ISSUES_PER_SOURCE = 10;

function parseNumberArg(value, fallback, min = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

function parseCsvArg(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function normalizeRuntimeSchemaMode(value, fallback = 'off') {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (RUNTIME_SCHEMA_MODES.has(normalized)) return normalized;
  const normalizedFallback = String(fallback ?? '').trim().toLowerCase();
  return RUNTIME_SCHEMA_MODES.has(normalizedFallback) ? normalizedFallback : 'off';
}

function sanitizeRuntimeSchema(runtimeSchema) {
  if (runtimeSchema == null || typeof runtimeSchema !== 'object' || Array.isArray(runtimeSchema)) {
    return null;
  }
  const rawIssues = Array.isArray(runtimeSchema.issues) ? runtimeSchema.issues : [];
  const issues = rawIssues
    .map((entry) => {
      const reason = String(entry?.reason ?? '').trim();
      if (!reason) return null;
      return {
        index: Number.isFinite(Number(entry?.index)) ? Number(entry.index) : null,
        reason: reason.slice(0, 300),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_RUNTIME_SCHEMA_ISSUES_PER_SOURCE);
  const validator = String(runtimeSchema.validator ?? '').trim();

  return {
    mode: normalizeRuntimeSchemaMode(runtimeSchema.mode, 'off'),
    validator: validator ? validator.slice(0, 80) : null,
    validatedCount: parseNonNegativeInt(runtimeSchema.validatedCount, 0),
    warningCount: parseNonNegativeInt(runtimeSchema.warningCount, 0),
    rejectedCount: parseNonNegativeInt(runtimeSchema.rejectedCount, 0),
    unavailableReason: runtimeSchema.unavailableReason ? String(runtimeSchema.unavailableReason).trim().slice(0, 300) : null,
    issues,
    issueCount: rawIssues.length,
  };
}

function blockingSleep(ms) {
  const waitMs = parseNonNegativeInt(ms, 0);
  if (waitMs <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, waitMs);
}

function writeTextAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, text);
  fs.renameSync(tempPath, filePath);
}

function writeJsonAtomic(filePath, payload) {
  writeTextAtomic(filePath, JSON.stringify(payload, null, 2));
}

function readLockOwnerPid(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    if (!raw) return null;
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function acquireFileLock(lockPath, options = {}) {
  const waitLimitMs = parseNonNegativeInt(options.waitLimitMs, 0);
  const pollMs = Math.max(20, parseNonNegativeInt(options.pollMs, 50));
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  let collisionCount = 0;
  let ownerPid = null;

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n`);
      return {
        fd,
        waitMs: Date.now() - startedAt,
        collisionCount,
        lockOwnerPid: ownerPid,
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      collisionCount += 1;
      ownerPid = readLockOwnerPid(lockPath);
      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= waitLimitMs) {
        const ownerSuffix = ownerPid == null ? '' : ` (owner pid ${ownerPid})`;
        console.error(`Another dedup run is in progress (lock exists): ${lockPath}${ownerSuffix}`);
        process.exit(2);
      }
      blockingSleep(Math.min(pollMs, waitLimitMs - waitedMs));
    }
  }
}

function installLockCleanup(lockPath, lockFd) {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      fs.closeSync(lockFd);
    } catch {
      // no-op
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // no-op
    }
  };

  process.on('exit', release);
  process.on('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    release();
    process.exit(143);
  });
}

function maybeHoldLockForTest() {
  const holdMs = parseNonNegativeInt(process.env.CODEX_LOCK_HOLD_MS, 0);
  if (holdMs > 0) blockingSleep(holdMs);
}

function findDuplicateTrialIds(records) {
  const counts = new Map();
  for (const record of records) {
    const trialId = String(record?.trialId ?? '').trim();
    if (!trialId) continue;
    counts.set(trialId, (counts.get(trialId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function parseArgs(argv) {
  const options = {
    sources: ['sample'],
    limit: 50,
    threshold: 0.85,
    reviewMin: 0.6,
    synthetic: false,
    strictIntegrity: false,
    strictSources: false,
    simulateOutage: [],
    lockWaitMs: 0,
    overridesPath: 'reports/dedup/overrides.json',
    aactProxyBase: null,
    runtimeSchemaMode: normalizeRuntimeSchemaMode(process.env.METASPRINT_RUNTIME_SCHEMA_MODE, 'off'),
    connectorPolicy: {
      timeoutMs: 15000,
      maxAttempts: 3,
      baseDelayMs: 250,
    },
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sources') {
      options.sources = parseCsvArg(argv[i + 1] ?? 'sample');
      i += 1;
    } else if (arg === '--limit') {
      options.limit = parseNumberArg(argv[i + 1], 50, 1);
      i += 1;
    } else if (arg === '--threshold') {
      options.threshold = Number(argv[i + 1] ?? 0.85);
      i += 1;
    } else if (arg === '--review-min') {
      options.reviewMin = Number(argv[i + 1] ?? 0.72);
      i += 1;
    } else if (arg === '--overrides') {
      options.overridesPath = String(argv[i + 1] ?? options.overridesPath);
      i += 1;
    } else if (arg === '--synthetic') {
      options.synthetic = true;
    } else if (arg === '--no-synthetic') {
      options.synthetic = false;
    } else if (arg === '--strict-sources') {
      options.strictSources = true;
    } else if (arg === '--strict-integrity') {
      options.strictIntegrity = true;
    } else if (arg === '--simulate-outage') {
      options.simulateOutage = parseCsvArg(argv[i + 1] ?? '');
      i += 1;
    } else if (arg === '--lock-wait-ms') {
      options.lockWaitMs = parseNonNegativeInt(argv[i + 1], 0);
      i += 1;
    } else if (arg === '--source-timeout-ms') {
      options.connectorPolicy.timeoutMs = parseNumberArg(argv[i + 1], options.connectorPolicy.timeoutMs, 50);
      i += 1;
    } else if (arg === '--source-max-attempts') {
      options.connectorPolicy.maxAttempts = parseNumberArg(argv[i + 1], options.connectorPolicy.maxAttempts, 1);
      i += 1;
    } else if (arg === '--source-retry-base-ms') {
      options.connectorPolicy.baseDelayMs = parseNumberArg(argv[i + 1], options.connectorPolicy.baseDelayMs, 25);
      i += 1;
    } else if (arg === '--aact-proxy-base') {
      options.aactProxyBase = String(argv[i + 1] ?? '').trim() || null;
      i += 1;
    } else if (arg === '--runtime-schema-mode') {
      options.runtimeSchemaMode = normalizeRuntimeSchemaMode(argv[i + 1], options.runtimeSchemaMode);
      i += 1;
    }
  }
  return options;
}

function createConnectorRequest(limit, options) {
  const query = {
    condition: 'heart failure',
    term: 'cardiovascular',
    category: 'cardiovascular',
    mailto: 'metasprint-cardio@example.org',
  };

  if (options.aactProxyBase) {
    query.proxyBase = options.aactProxyBase;
  }

  return {
    domain: 'cardio',
    query,
    limit,
    offset: 0,
    connectorPolicy: options.connectorPolicy,
    validationPolicy: {
      normalizedTrialSchemaMode: options.runtimeSchemaMode,
    },
  };
}

function buildSyntheticDuplicates(records) {
  if (records.length === 0) return [];
  const first = records[0];
  const duplicate = {
    ...first,
    trialId: `${first.trialId}_dup_pubmed`,
    source: 'pubmed',
    sourceType: 'publication',
    nctId: null,
    pmid: first.pmid ?? '39999001',
    doi: first.doi ?? '10.9999/synthetic.duplicate.001',
    enrollment: 0,
  };

  const second = records[Math.min(1, records.length - 1)];
  const fuzzy = {
    ...second,
    trialId: `${second.trialId}_dup_openalex`,
    source: 'openalex',
    sourceType: 'publication',
    nctId: null,
    pmid: null,
    doi: null,
    title: 'Empagliflozin cardiovascular and renal outcomes in heart-failure cohorts',
    year: second.year,
    enrollment: 0,
  };
  return [duplicate, fuzzy];
}

function toHealthEntry(source, status, details = {}) {
  const runtimeSchema = sanitizeRuntimeSchema(details.runtimeSchema);
  return {
    source,
    status,
    recordCount: Number.isFinite(Number(details.recordCount)) ? Number(details.recordCount) : 0,
    durationMs: Number.isFinite(Number(details.durationMs)) ? Number(details.durationMs) : 0,
    attempts: Number.isFinite(Number(details.attempts)) ? Number(details.attempts) : 1,
    statusCode: Number.isFinite(Number(details.statusCode)) ? Number(details.statusCode) : null,
    failureClass: details.failureClass ? String(details.failureClass) : null,
    retryable: typeof details.retryable === 'boolean' ? details.retryable : null,
    message: details.message ? String(details.message) : null,
    simulated: Boolean(details.simulated),
    runtimeSchema,
    checkedAt: new Date().toISOString(),
  };
}

function summarizeHealth(sourceHealth, strictSources, requestedRuntimeSchemaMode = 'off') {
  const summary = {
    totalSources: sourceHealth.length,
    okSources: 0,
    emptySources: 0,
    failedSources: 0,
    totalSourceDurationMs: 0,
    runtimeSchema: {
      requestedMode: normalizeRuntimeSchemaMode(requestedRuntimeSchemaMode, 'off'),
      sourcesWithRuntimeSchema: 0,
      unreportedSourceCount: 0,
      modeCounts: { off: 0, warn: 0, enforce: 0 },
      validatedCount: 0,
      warningCount: 0,
      rejectedCount: 0,
      validatorUnavailableCount: 0,
      sourcesWithIssues: 0,
    },
    strictStatus: 'passed',
  };

  for (const entry of sourceHealth) {
    if (entry.status === 'ok') summary.okSources += 1;
    else if (entry.status === 'empty') summary.emptySources += 1;
    else if (entry.status === 'failed') summary.failedSources += 1;
    if (Number.isFinite(Number(entry.durationMs)) && Number(entry.durationMs) >= 0) {
      summary.totalSourceDurationMs += Number(entry.durationMs);
    }
    const runtimeSchema = sanitizeRuntimeSchema(entry.runtimeSchema);
    if (runtimeSchema) {
      summary.runtimeSchema.sourcesWithRuntimeSchema += 1;
      summary.runtimeSchema.modeCounts[runtimeSchema.mode] += 1;
      summary.runtimeSchema.validatedCount += runtimeSchema.validatedCount;
      summary.runtimeSchema.warningCount += runtimeSchema.warningCount;
      summary.runtimeSchema.rejectedCount += runtimeSchema.rejectedCount;
      if (runtimeSchema.validator === 'unavailable') {
        summary.runtimeSchema.validatorUnavailableCount += 1;
      }
      if (runtimeSchema.issueCount > 0 || runtimeSchema.warningCount > 0 || runtimeSchema.rejectedCount > 0) {
        summary.runtimeSchema.sourcesWithIssues += 1;
      }
    }
  }
  summary.runtimeSchema.unreportedSourceCount = Math.max(0, summary.totalSources - summary.runtimeSchema.sourcesWithRuntimeSchema);

  if (strictSources && summary.failedSources > 0) {
    summary.strictStatus = 'failed';
  }

  return summary;
}

async function loadRecords(options) {
  const warnings = [];
  const sourceHealth = [];
  let records = [];
  const simulatedOutageSources = new Set(options.simulateOutage);

  for (const source of options.sources) {
    const startedAt = Date.now();
    try {
      if (simulatedOutageSources.has(source)) {
        throw createSimulatedOutageError(source);
      }

      if (source === 'sample') {
        records = records.concat(SAMPLE_TRIALS);
        sourceHealth.push(
          toHealthEntry(source, 'ok', {
            recordCount: SAMPLE_TRIALS.length,
            durationMs: Date.now() - startedAt,
            attempts: 1,
          }),
        );
        continue;
      }

      const { records: loaded, meta } = await loadUniverseFromConnectorWithMeta(source, createConnectorRequest(options.limit, options));
      const runtimeSchema = sanitizeRuntimeSchema(meta?.runtimeSchema);
      records = records.concat(loaded);
      sourceHealth.push(
        toHealthEntry(source, loaded.length > 0 ? 'ok' : 'empty', {
          recordCount: loaded.length,
          durationMs: Date.now() - startedAt,
          attempts: meta?.attempts ?? 1,
          statusCode: meta?.statusCode ?? null,
          runtimeSchema,
        }),
      );
      if (runtimeSchema?.validator === 'unavailable') {
        warnings.push(
          `source ${source} [runtime_schema_unavailable]: ${runtimeSchema.unavailableReason ?? 'validator unavailable'}`,
        );
      }
      if ((runtimeSchema?.warningCount ?? 0) > 0 || (runtimeSchema?.rejectedCount ?? 0) > 0) {
        const firstIssue = runtimeSchema?.issues?.[0]?.reason ? `; first_issue=${runtimeSchema.issues[0].reason}` : '';
        warnings.push(
          `source ${source} [runtime_schema]: mode=${runtimeSchema?.mode ?? 'off'}; warnings=${runtimeSchema?.warningCount ?? 0}; rejected=${runtimeSchema?.rejectedCount ?? 0}${firstIssue}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureClass = error?.failureClass ? String(error.failureClass) : 'unknown';
      const details = {
        durationMs: Date.now() - startedAt,
        attempts: error?.attempts ?? 1,
        statusCode: error?.statusCode ?? null,
        failureClass,
        retryable: error?.retryable ?? false,
        message,
        simulated: failureClass === 'simulated_outage',
      };
      sourceHealth.push(toHealthEntry(source, 'failed', details));
      warnings.push(`source ${source} [${failureClass}]: ${message}`);
    }
  }

  if (options.synthetic) {
    records = records.concat(buildSyntheticDuplicates(records));
  }

  return { records, warnings, sourceHealth };
}

function readOverrides(root, relativePath) {
  const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { forceMerge: [], forceSplit: [] };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
    return {
      forceMerge: Array.isArray(raw.forceMerge) ? raw.forceMerge : [],
      forceSplit: Array.isArray(raw.forceSplit) ? raw.forceSplit : [],
    };
  } catch (error) {
    throw new Error(`Failed to parse overrides file ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readRobMeSummary(root) {
  const file = path.join(root, 'reports', 'benchmarks', 'rob-me-latest.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function readRobNmaSummary(root) {
  const file = path.join(root, 'reports', 'benchmarks', 'rob-nma-latest.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function writeOverrideQueueCsv(queuePath, generatedAt, reviewQueue) {
  const header = [
    'pair_id',
    'left_trial_id',
    'right_trial_id',
    'left_source',
    'right_source',
    'score',
    'recommended_decision',
    'decision',
    'reviewer',
    'reason',
    'status',
    'generated_at',
  ];

  const lines = [header.join(',')];
  for (const item of reviewQueue.filter((entry) => entry.status === 'pending')) {
    lines.push(
      [
        item.pairId,
        item.leftTrialId,
        item.rightTrialId,
        item.leftSource,
        item.rightSource,
        item.score,
        item.recommendedDecision,
        '',
        '',
        '',
        item.status,
        generatedAt,
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  writeTextAtomic(queuePath, `${lines.join('\n')}\n`);
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const outDir = path.join(root, 'reports', 'dedup');
const opsDir = path.join(root, 'reports', 'ops');
const lockPath = path.join(outDir, '.run-identity-dedup.lock');
const lockMetrics = acquireFileLock(lockPath, { waitLimitMs: options.lockWaitMs });
installLockCleanup(lockPath, lockMetrics.fd);
maybeHoldLockForTest();
const queueCsv = path.join(outDir, 'override-queue.csv');
const overrides = readOverrides(root, options.overridesPath);

const { records, warnings, sourceHealth } = await loadRecords(options);
const duplicateTrialIds = findDuplicateTrialIds(records);
const sourceHealthSummary = summarizeHealth(sourceHealth, options.strictSources, options.runtimeSchemaMode);
const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, '-');
const hasLiveSources = options.sources.some((source) => source !== 'sample');
const sourceHealthPayload = {
  generatedAt,
  options: {
    sources: options.sources,
    strictSources: options.strictSources,
    strictIntegrity: options.strictIntegrity,
    simulateOutage: options.simulateOutage,
    lockWaitMs: options.lockWaitMs,
    runtimeSchemaMode: options.runtimeSchemaMode,
    connectorPolicy: options.connectorPolicy,
  },
  lock: {
    waitMs: lockMetrics.waitMs,
    collisionCount: lockMetrics.collisionCount,
    lockOwnerPid: lockMetrics.lockOwnerPid,
  },
  summary: sourceHealthSummary,
  warnings,
  sources: sourceHealth,
};
const sourceHealthStamp = path.join(opsDir, `source-health-${stamp}.json`);
const sourceHealthLatest = path.join(opsDir, 'source-health-latest.json');
const sourceHealthLiveStamp = path.join(opsDir, `source-health-live-${stamp}.json`);
const sourceHealthLiveLatest = path.join(opsDir, 'source-health-live-latest.json');

fs.mkdirSync(opsDir, { recursive: true });
writeJsonAtomic(sourceHealthStamp, sourceHealthPayload);
writeJsonAtomic(sourceHealthLatest, sourceHealthPayload);
if (hasLiveSources) {
  writeJsonAtomic(sourceHealthLiveStamp, sourceHealthPayload);
  writeJsonAtomic(sourceHealthLiveLatest, sourceHealthPayload);
}

console.log(`Wrote ${path.relative(root, sourceHealthStamp)}`);
console.log(`Wrote ${path.relative(root, sourceHealthLatest)}`);
if (hasLiveSources) {
  console.log(`Wrote ${path.relative(root, sourceHealthLiveStamp)}`);
  console.log(`Wrote ${path.relative(root, sourceHealthLiveLatest)}`);
}

if (records.length === 0) {
  console.error('No records loaded for dedup run.');
  console.log(
    `Source health: ok=${sourceHealthSummary.okSources}, empty=${sourceHealthSummary.emptySources}, failed=${sourceHealthSummary.failedSources}, strict=${sourceHealthSummary.strictStatus}`,
  );
  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
  if (options.strictSources && sourceHealthSummary.failedSources > 0) {
    process.exit(2);
  }
  process.exit(1);
}

if (duplicateTrialIds.length > 0) {
  const duplicateNote = `Detected ${duplicateTrialIds.length} duplicate trialId value(s).`;
  warnings.push(duplicateNote);
  if (options.strictIntegrity) {
    console.error('Strict integrity failed: duplicate trialId values were detected.');
    for (const [trialId, count] of duplicateTrialIds.slice(0, 20)) {
      console.error(`- ${trialId}: ${count}`);
    }
    process.exit(3);
  }
}

const graph = buildIdentityGraph(records, {
  threshold: options.threshold,
  reviewMin: options.reviewMin,
  overrides,
});
const provenance = buildProvenanceLedger(records, graph);
const robMeSummary = readRobMeSummary(root);
const robNmaSummary = readRobNmaSummary(root);
if (robMeSummary?.framework === 'ROB-ME' && typeof robMeSummary?.overallJudgement === 'string') {
  provenance.missingEvidenceRisk = {
    framework: 'ROB-ME',
    overallJudgement: robMeSummary.overallJudgement,
    assessedAt: String(robMeSummary.generatedAt ?? generatedAt),
    evidencePath: 'reports/benchmarks/rob-me-latest.json',
    scenarioCoverage: Number.isFinite(Number(robMeSummary.scenarioCoverage))
      ? Number(robMeSummary.scenarioCoverage)
      : 0,
  };
}
if (robNmaSummary?.framework === 'RoB NMA' && typeof robNmaSummary?.overallJudgement === 'string') {
  provenance.networkMissingEvidenceRisk = {
    framework: 'RoB NMA',
    overallJudgement: robNmaSummary.overallJudgement,
    assessedAt: String(robNmaSummary.generatedAt ?? generatedAt),
    evidencePath: 'reports/benchmarks/rob-nma-latest.json',
    networkCount: Number.isFinite(Number(robNmaSummary.networkCount))
      ? Number(robNmaSummary.networkCount)
      : 0,
  };
}

const payload = {
  generatedAt,
  options,
  warnings,
  sourceHealth,
  overrides,
  summary: {
    recordCount: graph.recordCount,
    duplicateTrialIdCount: duplicateTrialIds.length,
    edgeCount: graph.edgeCount,
    clusterCount: graph.clusterCount,
    duplicateClusterCount: graph.duplicateClusterCount,
    reviewQueueCount: graph.reviewQueueCount,
    multiSourceClusters: provenance.multiSourceClusterCount,
    sourceHealth: sourceHealthSummary,
    lock: {
      waitMs: lockMetrics.waitMs,
      collisionCount: lockMetrics.collisionCount,
      lockOwnerPid: lockMetrics.lockOwnerPid,
    },
  },
  graph,
  provenance,
};

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `identity-report-${stamp}.json`);
const latestFile = path.join(outDir, 'latest.json');
const provenanceFile = path.join(outDir, 'provenance-latest.json');
const queueStampFile = path.join(outDir, `override-queue-${stamp}.csv`);
const latestManifestFile = path.join(outDir, 'latest-manifest.json');

writeJsonAtomic(outFile, payload);
writeJsonAtomic(latestFile, payload);
writeJsonAtomic(provenanceFile, provenance);
writeOverrideQueueCsv(queueStampFile, payload.generatedAt, graph.reviewQueue);
writeOverrideQueueCsv(queueCsv, payload.generatedAt, graph.reviewQueue);
writeJsonAtomic(latestManifestFile, {
  generatedAt: payload.generatedAt,
  artifacts: {
    identityReport: path.relative(root, outFile),
    latest: path.relative(root, latestFile),
    provenance: path.relative(root, provenanceFile),
    overrideQueue: path.relative(root, queueCsv),
    sourceHealth: path.relative(root, sourceHealthLatest),
  },
});

console.log(`Wrote ${path.relative(root, outFile)}`);
console.log(`Wrote ${path.relative(root, latestFile)}`);
console.log(`Wrote ${path.relative(root, provenanceFile)}`);
console.log(`Wrote ${path.relative(root, queueStampFile)}`);
console.log(`Wrote ${path.relative(root, queueCsv)}`);
console.log(`Wrote ${path.relative(root, latestManifestFile)}`);
console.log(
  `Lock metrics: wait_ms=${lockMetrics.waitMs}, collisions=${lockMetrics.collisionCount}, owner_pid=${lockMetrics.lockOwnerPid ?? 'n/a'}`,
);
console.log(
  `Records: ${graph.recordCount}, Edges: ${graph.edgeCount}, Duplicate clusters: ${graph.duplicateClusterCount}, Pending review: ${graph.reviewQueueCount}`,
);
console.log(
  `Source health: ok=${sourceHealthSummary.okSources}, empty=${sourceHealthSummary.emptySources}, failed=${sourceHealthSummary.failedSources}, strict=${sourceHealthSummary.strictStatus}`,
);

if (warnings.length > 0) {
  console.log('Warnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (options.strictSources && sourceHealthSummary.failedSources > 0) {
  process.exitCode = 2;
}
