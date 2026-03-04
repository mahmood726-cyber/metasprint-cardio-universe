import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { SAMPLE_TRIALS } from '../../src/discovery/data/sample-data.js';

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function resolveDedupArtifactPath(root, artifactKey, fallbackRelativePath) {
  const manifestPath = path.join(root, 'reports', 'dedup', 'latest-manifest.json');
  const manifest = readJson(manifestPath, null);
  const candidate = manifest?.artifacts?.[artifactKey];
  if (candidate) return path.isAbsolute(candidate) ? candidate : path.join(root, candidate);
  return path.join(root, fallbackRelativePath);
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
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
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
    .filter((row) => row.length > 0)
    .map((row) => {
      const obj = {};
      for (let i = 0; i < header.length; i++) {
        obj[header[i]] = (row[i] ?? '').trim();
      }
      return obj;
    });
}

function readCsvObjects(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return toObjects(parseCsv(raw));
}

function formatNumber(value, digits = 4) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function scorecardRow(weekStart, kpiName, target, actual, status, owner, sourceArtifact, notes) {
  return {
    week_start: weekStart,
    kpi_name: kpiName,
    target,
    actual: actual == null ? '' : String(actual),
    status,
    owner,
    source_artifact: sourceArtifact,
    notes,
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function writeScorecardCsv(filePath, rows) {
  const headers = [
    'week_start',
    'kpi_name',
    'target',
    'actual',
    'status',
    'owner',
    'source_artifact',
    'notes',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function chooseByMajority(decisions) {
  const counts = { switch_now: 0, switch_with_conditions: 0, not_yet: 0 };
  for (const decision of decisions) {
    if (decision in counts) counts[decision] += 1;
  }
  const maxCount = Math.max(counts.switch_now, counts.switch_with_conditions, counts.not_yet);
  if (counts.not_yet === maxCount) return 'not_yet';
  if (counts.switch_with_conditions === maxCount) return 'switch_with_conditions';
  return 'switch_now';
}

const root = process.cwd();
const weekStart = '2026-03-02';
const generatedAt = new Date().toISOString();

const benchmarkIndexPath = path.join(root, 'reports', 'benchmarks', 'packs', 'v1', 'index.json');
const benchmarkIndex = readJson(benchmarkIndexPath);
if (!benchmarkIndex) {
  console.error(`Missing benchmark manifest: ${benchmarkIndexPath}`);
  process.exit(1);
}

const dedupLatestPath = resolveDedupArtifactPath(root, 'latest', 'reports/dedup/latest.json');
const dedupLatest = readJson(dedupLatestPath);
if (!dedupLatest) {
  console.error(`Missing dedup baseline: ${dedupLatestPath}`);
  process.exit(1);
}
const provenancePath = resolveDedupArtifactPath(
  root,
  'provenance',
  'reports/dedup/provenance-latest.json',
);

const reviewDashboardPath = path.join(root, 'public', 'data', 'review-dashboard.json');
const reviewDashboard = readJson(reviewDashboardPath, { aggregate: {}, cycles: [] });
const latestCycleId = reviewDashboard?.aggregate?.latestCycleId ?? 'cycle_001';

const summaryPath = path.join(root, 'reports', 'review-cycles', `${latestCycleId}-summary.json`);
const reviewSummary = readJson(summaryPath, {
  switchNow: null,
  totalReviewers: null,
});

const scoreCandidates = [
  path.join(root, 'reports', 'review-cycles', latestCycleId, 'scores.csv'),
  path.join(root, 'reports', 'review-cycles', latestCycleId, 'scores_sample_filled.csv'),
];
const scoreRows = (() => {
  for (const candidate of scoreCandidates) {
    const rows = readCsvObjects(candidate).filter((row) => String(row.decision ?? '').length > 0);
    if (rows.length > 0) return rows;
  }
  return [];
})();

const expectedNctSet = new Set();
const packCoverage = [];
for (const packMeta of benchmarkIndex.packs ?? []) {
  const packPath = path.join(root, 'reports', 'benchmarks', 'packs', 'v1', packMeta.file);
  const pack = readJson(packPath, { expectedTrialIds: [] });
  const expected = [...new Set((pack.expectedTrialIds ?? []).map((id) => String(id).toUpperCase()))];
  expected.forEach((id) => expectedNctSet.add(id));

  const observed = new Set(
    SAMPLE_TRIALS.map((trial) => String(trial.nctId ?? '').toUpperCase()).filter((id) => id.startsWith('NCT')),
  );
  const hits = expected.filter((id) => observed.has(id));
  packCoverage.push({
    packId: packMeta.packId,
    expectedTrialCount: expected.length,
    observedTrialCount: hits.length,
    recall: formatNumber(ratio(hits.length, expected.length), 4),
    observedTrials: hits,
  });
}

const observedNctSet = new Set(
  SAMPLE_TRIALS.map((trial) => String(trial.nctId ?? '').toUpperCase()).filter((id) => id.startsWith('NCT')),
);
const matchedNct = [...expectedNctSet].filter((id) => observedNctSet.has(id));
const ingestionRecall = formatNumber(ratio(matchedNct.length, expectedNctSet.size), 4);

const ingestionPayload = {
  generatedAt,
  weekStart,
  benchmarkVersion: benchmarkIndex.benchmarkVersion,
  expectedTrialCount: expectedNctSet.size,
  observedTrialCount: observedNctSet.size,
  matchedTrialCount: matchedNct.length,
  ingestionRecall,
  observedSource: 'src/discovery/data/sample-data.js',
  packCoverage,
};
writeJson(path.join(root, 'reports', 'benchmarks', 'ingestion.json'), ingestionPayload);

const ingestionLivePath = path.join(root, 'reports', 'benchmarks', 'ingestion-live.json');
const ingestionLivePayload = readJson(ingestionLivePath, null);
const ingestionLiveRecall = Number(ingestionLivePayload?.ingestionRecall);
const ingestionLiveExpectedCount = Number(ingestionLivePayload?.expectedTrialCount);
const hasLiveIngestionBaseline = Number.isFinite(ingestionLiveRecall) && Number.isFinite(ingestionLiveExpectedCount) && ingestionLiveExpectedCount > 0;
const effectiveIngestionRecall = hasLiveIngestionBaseline ? formatNumber(ingestionLiveRecall, 4) : ingestionRecall;
const effectiveIngestionSource = hasLiveIngestionBaseline ? 'reports/benchmarks/ingestion-live.json' : 'reports/benchmarks/ingestion.json';
const effectiveIngestionNote = hasLiveIngestionBaseline
  ? `Using live benchmark coverage (${Number(ingestionLivePayload?.matchedTrialCount ?? NaN)}/${ingestionLiveExpectedCount} expected trials).`
  : `${matchedNct.length}/${expectedNctSet.size} expected trials covered in sample baseline.`;

const byOpportunity = new Map();
for (const row of scoreRows) {
  const opportunityId = String(row.opportunity_id ?? '').trim();
  if (!opportunityId) continue;
  if (!byOpportunity.has(opportunityId)) byOpportunity.set(opportunityId, []);
  byOpportunity.get(opportunityId).push(String(row.decision ?? '').trim());
}

let switchNowOpportunities = 0;
for (const decisions of byOpportunity.values()) {
  if (chooseByMajority(decisions) === 'switch_now') switchNowOpportunities += 1;
}

const reviewedOpportunityCount = byOpportunity.size;
const opportunityPrecisionAt20Proxy = formatNumber(
  ratio(switchNowOpportunities, Math.max(1, Math.min(20, reviewedOpportunityCount))),
  4,
);
const ndcgAt20Proxy =
  reviewedOpportunityCount > 0 && switchNowOpportunities === reviewedOpportunityCount ? 1 : opportunityPrecisionAt20Proxy;

const proxyRankingPayload = {
  generatedAt,
  weekStart,
  sourceCycle: latestCycleId,
  proxy: true,
  reviewedOpportunityCount,
  switchNowMajorityOpportunities: switchNowOpportunities,
  opportunityPrecisionAt20Proxy,
  ndcgAt20Proxy: formatNumber(ndcgAt20Proxy, 4),
  note: 'Proxy metric from blinded board decisions until full benchmark ranking harness is online.',
};
const rankingPath = path.join(root, 'reports', 'benchmarks', 'ranking.json');
const existingRanking = readJson(rankingPath, null);
const hasNonProxyRanking =
  existingRanking != null &&
  existingRanking.proxy === false &&
  Number.isFinite(Number(existingRanking.opportunityPrecisionAt20)) &&
  Number.isFinite(Number(existingRanking.ndcgAt20));
const rankingPayload = hasNonProxyRanking ? existingRanking : proxyRankingPayload;
if (!hasNonProxyRanking) {
  writeJson(rankingPath, rankingPayload);
}

const dedupBenchmarkPath = path.join(root, 'reports', 'benchmarks', 'dedup-identity.json');
const dedupBenchmark = readJson(dedupBenchmarkPath, null);
const dedupF1 = Number.isFinite(Number(dedupBenchmark?.f1 ?? dedupBenchmark?.dedupF1))
  ? formatNumber(Number(dedupBenchmark?.f1 ?? dedupBenchmark?.dedupF1), 4)
  : null;
const dedupBenchmarkStatus = String(dedupBenchmark?.status ?? 'missing');

const ontologyCoveragePath = path.join(root, 'reports', 'ontology', 'coverage-latest.json');
const ontologyCoverage = readJson(ontologyCoveragePath, { summary: { coverage: null } });
const ontologyCoverageRatio = Number.isFinite(Number(ontologyCoverage?.summary?.coverage))
  ? formatNumber(Number(ontologyCoverage.summary.coverage) / 100, 4)
  : null;
const ontologyUnknownTermCount = Number.isFinite(Number(ontologyCoverage?.summary?.unknownTermCount))
  ? Number(ontologyCoverage.summary.unknownTermCount)
  : null;

const refreshHealthPath = path.join(root, 'reports', 'ops', 'refresh-health.json');
const refreshHealth = readJson(refreshHealthPath, {
  generatedAt,
  weekStart,
  refreshSuccessRate30d: null,
  refreshRuntimeP95Minutes: null,
  note: 'No refresh telemetry available.',
  source: 'not-instrumented-yet',
});

const uxTimingPath = path.join(root, 'reports', 'ux', 'task-timing.json');
const uxTiming = readJson(uxTimingPath, {
  generatedAt,
  weekStart,
  medianDiscoveryWorkflowMinutes: null,
  sampleSize: 0,
  note: 'No workflow timing telemetry available.',
  source: 'not-instrumented-yet',
});

const baseline = {
  generatedAt,
  weekStart,
  benchmarkVersion: benchmarkIndex.benchmarkVersion,
  metrics: {
    ingestion_recall: {
      target: 0.95,
      actual: effectiveIngestionRecall,
      status: effectiveIngestionRecall != null && effectiveIngestionRecall >= 0.95 ? 'on_track' : 'off_track',
      source: effectiveIngestionSource,
      note: effectiveIngestionNote,
    },
    opportunity_precision_at_20: {
      target: 0.9,
      actual: rankingPayload.opportunityPrecisionAt20 ?? rankingPayload.opportunityPrecisionAt20Proxy ?? null,
      status: rankingPayload.proxy ? 'proxy' : 'measured',
      source: 'reports/benchmarks/ranking.json',
      note: rankingPayload.proxy
        ? 'Proxy value from board vote-majority outcomes.'
        : 'Measured from blinded non-proxy ranking benchmark fixture.',
    },
    ndcg_at_20: {
      target: 0.82,
      actual: rankingPayload.ndcgAt20 ?? rankingPayload.ndcgAt20Proxy ?? null,
      status: rankingPayload.proxy ? 'proxy' : 'measured',
      source: 'reports/benchmarks/ranking.json',
      note: rankingPayload.proxy
        ? 'Proxy value from board vote-majority outcomes.'
        : 'Measured from blinded non-proxy ranking benchmark fixture.',
    },
    ontology_mapping_coverage: {
      target: 0.98,
      actual: ontologyCoverageRatio,
      status: ontologyCoverageRatio == null ? 'not_measured' : ontologyCoverageRatio >= 0.98 ? 'on_track' : 'off_track',
      source: 'reports/ontology/coverage-latest.json',
      note: 'Ontology benchmark mapping coverage with unknown-term queue generation.',
    },
    ontology_unknown_terms: {
      target: 0,
      actual: ontologyUnknownTermCount,
      status: ontologyUnknownTermCount == null ? 'not_measured' : ontologyUnknownTermCount === 0 ? 'on_track' : 'off_track',
      source: 'reports/ontology/coverage-latest.json',
      note: 'Lancet-tier ontology gate requires zero unknown terms on benchmark entities.',
    },
    dedup_f1: {
      target: 0.92,
      actual: dedupF1,
      status: dedupF1 == null ? 'not_measured' : dedupF1 >= 0.92 ? 'on_track' : 'off_track',
      source: dedupF1 == null ? path.relative(root, dedupLatestPath) : 'reports/benchmarks/dedup-identity.json',
      note:
        dedupF1 == null
          ? 'Requires gold duplicate labels benchmark execution.'
          : `Measured from dedup identity benchmark (${dedupBenchmarkStatus}).`,
    },
    provenance_completeness: {
      target: 1,
      actual: formatNumber(Number(dedupLatest?.provenance?.averageCompleteness ?? NaN), 4),
      status:
        Number.isFinite(Number(dedupLatest?.provenance?.averageCompleteness ?? NaN)) &&
        Number(dedupLatest?.provenance?.averageCompleteness ?? 0) >= 1
          ? 'on_track'
          : 'off_track',
      source: path.relative(root, provenancePath),
    },
    refresh_success_rate_30d: {
      target: 0.99,
      actual: refreshHealth.refreshSuccessRate30d,
      status:
        refreshHealth.refreshSuccessRate30d == null
          ? 'not_measured'
          : Number(refreshHealth.refreshSuccessRate30d) >= 0.99
            ? 'on_track'
            : 'off_track',
      source: 'reports/ops/refresh-health.json',
      note: String(refreshHealth.note ?? '30-day strict-source refresh success rate.'),
    },
    refresh_runtime_p95_minutes: {
      target: 30,
      actual: refreshHealth.refreshRuntimeP95Minutes,
      status:
        refreshHealth.refreshRuntimeP95Minutes == null
          ? 'not_measured'
          : Number(refreshHealth.refreshRuntimeP95Minutes) <= 30
            ? 'on_track'
            : 'off_track',
      source: 'reports/ops/refresh-health.json',
      note: String(refreshHealth.note ?? '30-day p95 refresh runtime (minutes).'),
    },
    median_discovery_workflow_minutes: {
      target: 10,
      actual: uxTiming.medianDiscoveryWorkflowMinutes,
      status:
        uxTiming.medianDiscoveryWorkflowMinutes == null
          ? 'not_measured'
          : Number(uxTiming.medianDiscoveryWorkflowMinutes) <= 10
            ? 'on_track'
            : 'off_track',
      source: 'reports/ux/task-timing.json',
      note: String(uxTiming.note ?? 'Median discovery workflow runtime (minutes).'),
    },
    switch_now_count: {
      target: 11,
      actual: Number(reviewSummary.switchNow),
      status: Number(reviewSummary.switchNow) >= 11 ? 'on_track' : 'off_track',
      source: `reports/review-cycles/${latestCycleId}-summary.json`,
      totalReviewers: Number(reviewSummary.totalReviewers ?? NaN),
    },
  },
};

const baselinePath = path.join(root, 'docs', 'operations', `KPI_BASELINE_${weekStart}.json`);
writeJson(baselinePath, baseline);
writeJson(path.join(root, 'docs', 'operations', 'KPI_BASELINE_LATEST.json'), baseline);

const scorecardRows = [
  scorecardRow(
    weekStart,
    'ingestion_recall',
    0.95,
    baseline.metrics.ingestion_recall.actual,
    baseline.metrics.ingestion_recall.status,
    'Data Lead',
    baseline.metrics.ingestion_recall.source,
    baseline.metrics.ingestion_recall.note,
  ),
  scorecardRow(
    weekStart,
    'opportunity_precision_at_20',
    0.9,
    baseline.metrics.opportunity_precision_at_20.actual,
    baseline.metrics.opportunity_precision_at_20.status,
    'Methods Lead',
    baseline.metrics.opportunity_precision_at_20.source,
    baseline.metrics.opportunity_precision_at_20.note,
  ),
  scorecardRow(
    weekStart,
    'ndcg_at_20',
    0.82,
    baseline.metrics.ndcg_at_20.actual,
    baseline.metrics.ndcg_at_20.status,
    'Methods Lead',
    baseline.metrics.ndcg_at_20.source,
    baseline.metrics.ndcg_at_20.note,
  ),
  scorecardRow(
    weekStart,
    'ontology_mapping_coverage',
    0.98,
    baseline.metrics.ontology_mapping_coverage.actual,
    baseline.metrics.ontology_mapping_coverage.status,
    'Methods Lead',
    baseline.metrics.ontology_mapping_coverage.source,
    baseline.metrics.ontology_mapping_coverage.note,
  ),
  scorecardRow(
    weekStart,
    'ontology_unknown_terms',
    0,
    baseline.metrics.ontology_unknown_terms.actual,
    baseline.metrics.ontology_unknown_terms.status,
    'Methods Lead',
    baseline.metrics.ontology_unknown_terms.source,
    baseline.metrics.ontology_unknown_terms.note,
  ),
  scorecardRow(
    weekStart,
    'dedup_f1',
    0.92,
    baseline.metrics.dedup_f1.actual,
    baseline.metrics.dedup_f1.status,
    'Data Lead',
    baseline.metrics.dedup_f1.source,
    baseline.metrics.dedup_f1.note,
  ),
  scorecardRow(
    weekStart,
    'provenance_completeness',
    1.0,
    baseline.metrics.provenance_completeness.actual,
    baseline.metrics.provenance_completeness.status,
    'QA Lead',
    baseline.metrics.provenance_completeness.source,
    'Cluster-level average completeness from stitched provenance ledger.',
  ),
  scorecardRow(
    weekStart,
    'refresh_success_rate_30d',
    0.99,
    baseline.metrics.refresh_success_rate_30d.actual,
    baseline.metrics.refresh_success_rate_30d.status,
    'Data Lead',
    baseline.metrics.refresh_success_rate_30d.source,
    baseline.metrics.refresh_success_rate_30d.note,
  ),
  scorecardRow(
    weekStart,
    'refresh_runtime_p95_minutes',
    30,
    baseline.metrics.refresh_runtime_p95_minutes.actual,
    baseline.metrics.refresh_runtime_p95_minutes.status,
    'Data Lead',
    baseline.metrics.refresh_runtime_p95_minutes.source,
    baseline.metrics.refresh_runtime_p95_minutes.note,
  ),
  scorecardRow(
    weekStart,
    'median_discovery_workflow_minutes',
    10,
    baseline.metrics.median_discovery_workflow_minutes.actual,
    baseline.metrics.median_discovery_workflow_minutes.status,
    'UX Lead',
    baseline.metrics.median_discovery_workflow_minutes.source,
    baseline.metrics.median_discovery_workflow_minutes.note,
  ),
  scorecardRow(
    weekStart,
    'switch_now_count',
    11,
    baseline.metrics.switch_now_count.actual,
    baseline.metrics.switch_now_count.status,
    'Methods Lead',
    baseline.metrics.switch_now_count.source,
    `Current gate result: ${baseline.metrics.switch_now_count.actual}/${baseline.metrics.switch_now_count.totalReviewers}.`,
  ),
];

writeScorecardCsv(path.join(root, 'docs', 'operations', 'KPI_SCORECARD_90D_TEMPLATE.csv'), scorecardRows);

console.log(`Wrote reports/benchmarks/ingestion.json`);
console.log(`Wrote reports/benchmarks/ranking.json`);
console.log(`Used telemetry source reports/ops/refresh-health.json`);
console.log(`Used telemetry source reports/ux/task-timing.json`);
console.log(`Wrote ${path.relative(root, baselinePath)}`);
console.log(`Wrote docs/operations/KPI_BASELINE_LATEST.json`);
console.log(`Updated docs/operations/KPI_SCORECARD_90D_TEMPLATE.csv`);
