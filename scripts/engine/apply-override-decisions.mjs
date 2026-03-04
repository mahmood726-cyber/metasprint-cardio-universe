import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { pairKey } from '../../src/engine/identity/index.js';

function parseNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function blockingSleep(ms) {
  const waitMs = parseNonNegativeInt(ms, 0);
  if (waitMs <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, waitMs);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      if (current.length > 0 || row.length > 0) {
        row.push(current);
        rows.push(row);
      }
      row = [];
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function toObjects(rows) {
  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((r) => r.length > 0)
    .map((r) => {
      const obj = {};
      for (let i = 0; i < header.length; i++) {
        obj[header[i]] = (r[i] ?? '').trim();
      }
      return obj;
    });
}

function loadOverrides(filePath) {
  if (!fs.existsSync(filePath)) {
    return { forceMerge: [], forceSplit: [] };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  return {
    forceMerge: Array.isArray(raw.forceMerge) ? raw.forceMerge : [],
    forceSplit: Array.isArray(raw.forceSplit) ? raw.forceSplit : [],
  };
}

function buildMaps(overrides) {
  const mergeMap = new Map();
  const splitMap = new Map();
  for (const entry of overrides.forceMerge) {
    mergeMap.set(pairKey(entry.leftTrialId, entry.rightTrialId), entry);
  }
  for (const entry of overrides.forceSplit) {
    splitMap.set(pairKey(entry.leftTrialId, entry.rightTrialId), entry);
  }
  return { mergeMap, splitMap };
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, filePath);
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
        console.error(`Another override apply process is running (lock exists): ${lockPath}${ownerSuffix}`);
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

function parseCli(argv, root) {
  const positional = [];
  const options = {
    lockWaitMs: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lock-wait-ms') {
      options.lockWaitMs = parseNonNegativeInt(argv[i + 1], 0);
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  return {
    options,
    queuePath: positional[0] ? path.resolve(root, positional[0]) : path.join(root, 'reports', 'dedup', 'override-queue.csv'),
    overridesPath: positional[1]
      ? path.resolve(root, positional[1])
      : path.join(root, 'reports', 'dedup', 'overrides.json'),
  };
}

const root = process.cwd();
const parsedCli = parseCli(process.argv.slice(2), root);
const queuePath = parsedCli.queuePath;
const overridesPath = parsedCli.overridesPath;
const lockPath = `${overridesPath}.lock`;
const lockMetrics = acquireFileLock(lockPath, { waitLimitMs: parsedCli.options.lockWaitMs });
installLockCleanup(lockPath, lockMetrics.fd);
maybeHoldLockForTest();

if (!fs.existsSync(queuePath)) {
  console.error(`Queue CSV not found: ${queuePath}`);
  process.exit(1);
}

const rows = toObjects(parseCsv(fs.readFileSync(queuePath, 'utf8').replace(/^\uFEFF/, '')));
const overrides = loadOverrides(overridesPath);
const { mergeMap, splitMap } = buildMaps(overrides);

let applied = 0;
let cleared = 0;
for (const row of rows) {
  const decision = String(row.decision ?? '').trim().toLowerCase();
  const leftTrialId = String(row.left_trial_id ?? '').trim();
  const rightTrialId = String(row.right_trial_id ?? '').trim();
  if (!leftTrialId || !rightTrialId) continue;
  const key = pairKey(leftTrialId, rightTrialId);

  if (decision === 'clear') {
    mergeMap.delete(key);
    splitMap.delete(key);
    cleared += 1;
    continue;
  }

  if (decision !== 'force_merge' && decision !== 'force_split') continue;

  const entry = {
    leftTrialId,
    rightTrialId,
    reason: row.reason ? String(row.reason) : null,
    reviewer: row.reviewer ? String(row.reviewer) : null,
    decidedAt: new Date().toISOString(),
  };

  if (decision === 'force_merge') {
    splitMap.delete(key);
    mergeMap.set(key, entry);
  } else {
    mergeMap.delete(key);
    splitMap.set(key, entry);
  }
  applied += 1;
}

const nextOverrides = {
  forceMerge: [...mergeMap.values()].sort((a, b) =>
    pairKey(a.leftTrialId, a.rightTrialId).localeCompare(pairKey(b.leftTrialId, b.rightTrialId)),
  ),
  forceSplit: [...splitMap.values()].sort((a, b) =>
    pairKey(a.leftTrialId, a.rightTrialId).localeCompare(pairKey(b.leftTrialId, b.rightTrialId)),
  ),
};

fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
writeJsonAtomic(overridesPath, nextOverrides);

console.log(`Wrote ${path.relative(root, overridesPath)}`);
console.log(`Applied decisions: ${applied}`);
console.log(`Cleared decisions: ${cleared}`);
console.log(`forceMerge=${nextOverrides.forceMerge.length}, forceSplit=${nextOverrides.forceSplit.length}`);
console.log(
  `Lock metrics: wait_ms=${lockMetrics.waitMs}, collisions=${lockMetrics.collisionCount}, owner_pid=${lockMetrics.lockOwnerPid ?? 'n/a'}`,
);
