import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { fetchWithRetry } from '../../src/data/connectors/base.js';

function parseArgs(argv) {
  const options = {
    timeoutMs: 15000,
    maxAttempts: 3,
    baseDelayMs: 250,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--timeout-ms') {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) options.timeoutMs = Math.floor(v);
      i += 1;
    } else if (arg === '--max-attempts') {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) options.maxAttempts = Math.floor(v);
      i += 1;
    } else if (arg === '--retry-base-ms') {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) options.baseDelayMs = Math.floor(v);
      i += 1;
    }
  }

  return options;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function toPct(value) {
  return Number((value * 100).toFixed(2));
}

async function lookupCtgovNct(nctId, policy) {
  const params = new URLSearchParams();
  params.set('query.term', nctId);
  params.set('pageSize', '3');
  params.set('format', 'json');
  const url = `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;

  const response = await fetchWithRetry({
    connectorId: 'ctgov',
    url,
    init: { method: 'GET' },
    timeoutMs: policy.timeoutMs,
    maxAttempts: policy.maxAttempts,
    baseDelayMs: policy.baseDelayMs,
  });

  const studies = Array.isArray(response?.json?.studies) ? response.json.studies : [];
  const matched = studies.some((study) => {
    const found = String(study?.protocolSection?.identificationModule?.nctId ?? '').toUpperCase();
    return found === nctId;
  });

  return {
    found: matched,
    attempts: response.attempts,
    statusCode: response.statusCode,
    returnedStudies: studies.length,
  };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const packsDir = path.join(root, 'reports', 'benchmarks', 'packs', 'v1');
const indexPath = path.join(packsDir, 'index.json');
const outFile = path.join(root, 'reports', 'benchmarks', 'ingestion-live.json');

const index = readJson(indexPath, null);
if (!index) {
  console.error(`Missing benchmark manifest: ${path.relative(root, indexPath)}`);
  process.exit(1);
}

const packResults = [];
const totalExpected = new Set();
const totalMatched = new Set();
const trialChecks = [];

for (const packMeta of index.packs ?? []) {
  const packPath = path.join(packsDir, packMeta.file);
  const pack = readJson(packPath, { expectedTrialIds: [] });
  const expected = [...new Set((pack.expectedTrialIds ?? []).map((id) => String(id).toUpperCase()).filter((id) => id.startsWith('NCT')))];

  if (expected.length === 0) {
    packResults.push({
      packId: packMeta.packId,
      expectedTrialCount: 0,
      matchedTrialCount: 0,
      recall: null,
      missingTrialIds: [],
    });
    continue;
  }

  const matched = [];
  const missing = [];
  for (const nctId of expected) {
    totalExpected.add(nctId);
    try {
      const check = await lookupCtgovNct(nctId, options);
      trialChecks.push({
        trialId: nctId,
        packId: packMeta.packId,
        found: check.found,
        attempts: check.attempts,
        statusCode: check.statusCode,
        returnedStudies: check.returnedStudies,
      });
      if (check.found) {
        matched.push(nctId);
        totalMatched.add(nctId);
      } else {
        missing.push(nctId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trialChecks.push({
        trialId: nctId,
        packId: packMeta.packId,
        found: false,
        attempts: Number(error?.attempts ?? 1),
        statusCode: Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : null,
        returnedStudies: 0,
        error: message,
        failureClass: error?.failureClass ? String(error.failureClass) : 'unknown',
      });
      missing.push(nctId);
    }
  }

  packResults.push({
    packId: packMeta.packId,
    expectedTrialCount: expected.length,
    matchedTrialCount: matched.length,
    recall: Number((matched.length / expected.length).toFixed(4)),
    matchedTrialIds: matched,
    missingTrialIds: missing,
  });
}

const overallRecall = totalExpected.size > 0 ? Number((totalMatched.size / totalExpected.size).toFixed(4)) : null;
const payload = {
  generatedAt: new Date().toISOString(),
  benchmarkVersion: index.benchmarkVersion ?? null,
  source: 'clinicaltrials_gov_live_lookup',
  connectorPolicy: options,
  expectedTrialCount: totalExpected.size,
  matchedTrialCount: totalMatched.size,
  ingestionRecall: overallRecall,
  ingestionRecallPct: overallRecall == null ? null : toPct(overallRecall),
  packCoverage: packResults,
  trialChecks,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
console.log(`Wrote ${path.relative(root, outFile)}`);
console.log(
  `Live ingestion recall: ${overallRecall == null ? 'n/a' : `${toPct(overallRecall)}%`} (${totalMatched.size}/${totalExpected.size})`,
);
