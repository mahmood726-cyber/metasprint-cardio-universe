import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { buildIdentityGraph, pairKey } from '../../src/engine/identity/index.js';

function parseArgs(argv) {
  const options = {
    fixturePath: 'reports/benchmarks/packs/v2/dedup_identity.v1.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fixture') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.fixturePath = value;
      i += 1;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toFixedNumber(value, digits = 4) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function parsePairValue(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return [String(value[0]), String(value[1])];
  }
  if (value && typeof value === 'object') {
    const left = value.leftTrialId ?? value.left ?? value.a ?? null;
    const right = value.rightTrialId ?? value.right ?? value.b ?? null;
    if (left && right) {
      return [String(left), String(right)];
    }
  }
  return null;
}

function pairSetFromValues(values) {
  const out = new Set();
  for (const value of values ?? []) {
    const pair = parsePairValue(value);
    if (!pair) continue;
    out.add(pairKey(pair[0], pair[1]));
  }
  return out;
}

function pairSetFromClusters(clusters) {
  const out = new Set();
  for (const cluster of clusters ?? []) {
    const members = Array.isArray(cluster?.members) ? cluster.members.map((id) => String(id)) : [];
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        out.add(pairKey(members[i], members[j]));
      }
    }
  }
  return out;
}

function toSortedArray(setLike) {
  return [...setLike].sort((a, b) => a.localeCompare(b));
}

function intersectionSize(a, b) {
  let size = 0;
  for (const key of a) {
    if (b.has(key)) size += 1;
  }
  return size;
}

function differenceSet(a, b) {
  const out = new Set();
  for (const key of a) {
    if (!b.has(key)) out.add(key);
  }
  return out;
}

function check(id, expected, actual, passed) {
  return { id, expected, actual, passed: Boolean(passed) };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const fixturePath = path.isAbsolute(options.fixturePath) ? options.fixturePath : path.join(root, options.fixturePath);
const outDir = path.join(root, 'reports', 'benchmarks');

if (!fs.existsSync(fixturePath)) {
  console.error(`Missing dedup fixture: ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

const fixture = readJson(fixturePath);
const records = Array.isArray(fixture.records) ? fixture.records : [];
if (records.length < 2) {
  console.error('Dedup identity fixture requires at least 2 records.');
  process.exit(1);
}

const threshold = toNumber(fixture?.options?.threshold, 0.85);
const reviewMin = toNumber(fixture?.options?.reviewMin, 0.65);
const expected = fixture.expected ?? {};

const graph = buildIdentityGraph(records, {
  threshold,
  reviewMin,
});

const expectedDuplicatePairs = pairSetFromValues(expected.duplicatePairs ?? []);
const predictedDuplicatePairs = pairSetFromClusters(graph.clusters);
const expectedReviewPairs = pairSetFromValues(expected.reviewPairs ?? []);
const predictedReviewPairs = pairSetFromValues((graph.reviewQueue ?? []).map((item) => [item.leftTrialId, item.rightTrialId]));

const truePositives = intersectionSize(predictedDuplicatePairs, expectedDuplicatePairs);
const falsePositives = differenceSet(predictedDuplicatePairs, expectedDuplicatePairs);
const falseNegatives = differenceSet(expectedDuplicatePairs, predictedDuplicatePairs);

const precision = safeRatio(truePositives, predictedDuplicatePairs.size);
const recall = safeRatio(truePositives, expectedDuplicatePairs.size);
const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;

const reviewTruePositives = intersectionSize(predictedReviewPairs, expectedReviewPairs);
const reviewPrecision = expectedReviewPairs.size === 0 ? null : safeRatio(reviewTruePositives, predictedReviewPairs.size);
const reviewRecall = expectedReviewPairs.size === 0 ? null : safeRatio(reviewTruePositives, expectedReviewPairs.size);

const minPrecision = toNumber(expected.minPrecision, 0.9);
const minRecall = toNumber(expected.minRecall, 0.9);
const minF1 = toNumber(expected.minF1, 0.92);
const maxFalsePositives = toNumber(expected.maxFalsePositives, null);
const maxFalseNegatives = toNumber(expected.maxFalseNegatives, null);
const expectedDuplicateClusterCount = toNumber(expected.duplicateClusterCount, null);
const minReviewRecall = toNumber(expected.minReviewRecall, null);

const checks = [
  check('min_precision', minPrecision, precision == null ? null : toFixedNumber(precision), precision != null && precision >= minPrecision),
  check('min_recall', minRecall, recall == null ? null : toFixedNumber(recall), recall != null && recall >= minRecall),
  check('min_f1', minF1, f1 == null ? null : toFixedNumber(f1), f1 != null && f1 >= minF1),
];

if (maxFalsePositives != null) {
  checks.push(check('max_false_positives', maxFalsePositives, falsePositives.size, falsePositives.size <= maxFalsePositives));
}
if (maxFalseNegatives != null) {
  checks.push(check('max_false_negatives', maxFalseNegatives, falseNegatives.size, falseNegatives.size <= maxFalseNegatives));
}
if (expectedDuplicateClusterCount != null) {
  checks.push(
    check(
      'duplicate_cluster_count',
      expectedDuplicateClusterCount,
      graph.duplicateClusterCount,
      graph.duplicateClusterCount === expectedDuplicateClusterCount,
    ),
  );
}
if (expectedReviewPairs.size > 0 && minReviewRecall != null) {
  checks.push(
    check(
      'review_pair_recall',
      minReviewRecall,
      reviewRecall == null ? null : toFixedNumber(reviewRecall),
      reviewRecall != null && reviewRecall >= minReviewRecall,
    ),
  );
}

const passedChecks = checks.filter((row) => row.passed).length;
const status = passedChecks === checks.length ? 'passed' : 'failed';
const generatedAt = new Date().toISOString();

const summary = {
  generatedAt,
  sourceFixture: path.relative(root, fixturePath),
  schemaVersion: fixture.schemaVersion ?? null,
  status,
  threshold,
  reviewMin,
  recordCount: records.length,
  duplicateClusterCount: graph.duplicateClusterCount,
  expectedDuplicateClusterCount,
  expectedDuplicatePairCount: expectedDuplicatePairs.size,
  predictedDuplicatePairCount: predictedDuplicatePairs.size,
  truePositivePairs: truePositives,
  falsePositivePairs: falsePositives.size,
  falseNegativePairs: falseNegatives.size,
  precision: toFixedNumber(precision),
  recall: toFixedNumber(recall),
  f1: toFixedNumber(f1),
  dedupF1: toFixedNumber(f1),
  expectedReviewPairCount: expectedReviewPairs.size,
  predictedReviewPairCount: predictedReviewPairs.size,
  reviewPrecision: toFixedNumber(reviewPrecision),
  reviewRecall: toFixedNumber(reviewRecall),
  checkCount: checks.length,
  passedCheckCount: passedChecks,
  note: 'Gold-label dedup benchmark for identity clustering and review-queue behavior.',
};

const detail = {
  generatedAt,
  fixture: {
    file: path.relative(root, fixturePath),
    schemaVersion: fixture.schemaVersion ?? null,
    description: fixture.description ?? null,
  },
  status,
  checks,
  metrics: summary,
  expected: {
    duplicatePairs: toSortedArray(expectedDuplicatePairs),
    reviewPairs: toSortedArray(expectedReviewPairs),
  },
  predicted: {
    duplicatePairs: toSortedArray(predictedDuplicatePairs),
    reviewPairs: toSortedArray(predictedReviewPairs),
  },
  errors: {
    falsePositiveDuplicatePairs: toSortedArray(falsePositives),
    falseNegativeDuplicatePairs: toSortedArray(falseNegatives),
  },
  graphSummary: {
    duplicateClusterCount: graph.duplicateClusterCount,
    reviewQueueCount: graph.reviewQueueCount,
    edgeCount: graph.edgeCount,
    clusterCount: graph.clusterCount,
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'dedup-identity.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'dedup-identity-eval-latest.json'), JSON.stringify(detail, null, 2));

console.log('Wrote reports/benchmarks/dedup-identity.json');
console.log('Wrote reports/benchmarks/dedup-identity-eval-latest.json');
console.log(
  `Dedup benchmark: precision=${summary.precision}, recall=${summary.recall}, f1=${summary.f1}, checks ${passedChecks}/${checks.length}`,
);

if (status !== 'passed') {
  process.exit(1);
}
