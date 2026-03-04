import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    enforce: false,
    targetIngestionRecall: 0.95,
    targetPrecisionAt20: 0.9,
    targetNdcgAt20: 0.82,
    targetPairwiseStatus: 'passed',
    targetBiasSensitivityStatus: 'passed',
    targetRobMeCoverage: 1,
    targetNetworkStatus: 'passed',
    targetRobNmaCoverage: 1,
    targetCertaintyCrosswalkStatus: 'passed',
    targetCertaintyCrosswalkSourceMode: 'live_extracted',
    targetCertaintyCrosswalkMinComparisons: 100,
    targetCertaintyCrosswalkMinKappa: 0.3,
    targetCertaintyCrosswalkMaxKappaCi95Width: 0.5,
    targetDedupStatus: 'passed',
    targetDedupF1: 0.92,
    targetLivingDriftStatuses: ['passed', 'baseline_established'],
    targetProvenanceCompleteness: 1,
    targetOntologyCoverage: 0.98,
    targetOntologyUnknownTermCount: 0,
    minLiveSources: 4,
    targetSwitchNow: 11,
    targetTotalReviewers: 12,
    targetConsecutiveCycles: 2,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--enforce') {
      options.enforce = true;
    }
  }
  return options;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function fileHashSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(raw);
  return hash.digest('hex');
}

function resolveDedupArtifactPath(root, artifactKey, fallbackRelativePath) {
  const manifestPath = path.join(root, 'reports', 'dedup', 'latest-manifest.json');
  const manifest = readJson(manifestPath, null);
  const candidate = manifest?.artifacts?.[artifactKey];
  if (candidate) return path.isAbsolute(candidate) ? candidate : path.join(root, candidate);
  return path.join(root, fallbackRelativePath);
}

function ratioFromMaybePercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1) return n / 100;
  return n;
}

function compareCycleId(a, b) {
  const re = /^cycle_(\d+)$/i;
  const ma = re.exec(a);
  const mb = re.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  return a.localeCompare(b);
}

function listReviewSummaries(reportsRoot) {
  const reviewDir = path.join(reportsRoot, 'review-cycles');
  if (!fs.existsSync(reviewDir)) return [];
  return fs
    .readdirSync(reviewDir)
    .filter((name) => name.endsWith('-summary.json'))
    .map((name) => {
      const fullPath = path.join(reviewDir, name);
      const cycleId = name.replace(/-summary\.json$/i, '');
      return {
        cycleId,
        fullPath,
        data: readJson(fullPath, null),
      };
    })
    .filter((entry) => entry.data != null)
    .sort((a, b) => compareCycleId(a.cycleId, b.cycleId));
}

function gate(id, label, target, actual, passed, severity, evidencePath, note = null) {
  return {
    id,
    label,
    target,
    actual,
    passed: Boolean(passed),
    severity,
    evidencePath,
    note,
  };
}

function toPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number((n * 100).toFixed(2));
}

function statusLabel(passed) {
  return passed ? 'PASS' : 'FAIL';
}

function toChecklistRows(gates) {
  return gates.map((g) => ({
    criterion_id: g.id,
    criterion: g.label,
    target: g.target,
    actual: g.actual == null ? '' : String(g.actual),
    status: g.passed ? 'pass' : 'fail',
    severity: g.severity,
    evidence: g.evidencePath,
    note: g.note ?? '',
  }));
}

function writeChecklistCsv(filePath, rows) {
  const headers = ['criterion_id', 'criterion', 'target', 'actual', 'status', 'severity', 'evidence', 'note'];
  const escape = (value) => {
    const text = String(value ?? '');
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const reportsRoot = path.join(root, 'reports');
const editorialOutDir = path.join(reportsRoot, 'editorial');
const editorialDocsDir = path.join(root, 'docs', 'editorial');
fs.mkdirSync(editorialOutDir, { recursive: true });
fs.mkdirSync(editorialDocsDir, { recursive: true });
const dedupLatestPath = resolveDedupArtifactPath(root, 'latest', 'reports/dedup/latest.json');
const dedupProvenancePath = resolveDedupArtifactPath(
  root,
  'provenance',
  'reports/dedup/provenance-latest.json',
);

const evidenceFiles = {
  ingestion: path.join(reportsRoot, 'benchmarks', 'ingestion.json'),
  ingestionLive: path.join(reportsRoot, 'benchmarks', 'ingestion-live.json'),
  ranking: path.join(reportsRoot, 'benchmarks', 'ranking.json'),
  pairwiseV2: path.join(reportsRoot, 'benchmarks', 'pairwise-v2.json'),
  biasSensitivity: path.join(reportsRoot, 'benchmarks', 'bias-sensitivity.json'),
  networkV1: path.join(reportsRoot, 'benchmarks', 'network-v1.json'),
  dedupBenchmark: path.join(reportsRoot, 'benchmarks', 'dedup-identity.json'),
  certaintyCrosswalk: path.join(reportsRoot, 'benchmarks', 'certainty-crosswalk.json'),
  livingDrift: path.join(reportsRoot, 'ops', 'living-drift-latest.json'),
  dedupLatest: dedupLatestPath,
  provenance: dedupProvenancePath,
  ontology: path.join(reportsRoot, 'ontology', 'coverage-latest.json'),
  releaseGates: path.join(reportsRoot, 'ops', 'release-gates-latest.json'),
  sourceHealth: fs.existsSync(path.join(reportsRoot, 'ops', 'source-health-live-latest.json'))
    ? path.join(reportsRoot, 'ops', 'source-health-live-latest.json')
    : path.join(reportsRoot, 'ops', 'source-health-latest.json'),
};

const ingestionLive = readJson(evidenceFiles.ingestionLive, null);
const ingestion = ingestionLive ?? readJson(evidenceFiles.ingestion, {});
const ranking = readJson(evidenceFiles.ranking, {});
const pairwiseV2 = readJson(evidenceFiles.pairwiseV2, {});
const biasSensitivity = readJson(evidenceFiles.biasSensitivity, {});
const networkV1 = readJson(evidenceFiles.networkV1, {});
const dedupBenchmark = readJson(evidenceFiles.dedupBenchmark, {});
const certaintyCrosswalk = readJson(evidenceFiles.certaintyCrosswalk, {});
const livingDrift = readJson(evidenceFiles.livingDrift, {});
const provenance = readJson(evidenceFiles.provenance, {});
const ontology = readJson(evidenceFiles.ontology, {});
const releaseGates = readJson(evidenceFiles.releaseGates, {});
const sourceHealth = readJson(evidenceFiles.sourceHealth, {});
const reviewSummaries = listReviewSummaries(reportsRoot);
const latestReviewSummaryEntry = reviewSummaries.length > 0 ? reviewSummaries[reviewSummaries.length - 1] : null;

const gates = [];

const ingestionRecall = ratioFromMaybePercent(ingestion.ingestionRecall);
gates.push(
  gate(
    'ingestion_recall',
    'Benchmark ingestion recall',
    `>= ${toPct(options.targetIngestionRecall)}%`,
    ingestionRecall == null ? null : `${toPct(ingestionRecall)}%`,
    ingestionRecall != null && ingestionRecall >= options.targetIngestionRecall,
    'critical',
    path.relative(root, ingestionLive ? evidenceFiles.ingestionLive : evidenceFiles.ingestion),
    ingestionLive
      ? 'Live ctgov benchmark lookup is active for expected trial IDs.'
      : 'Requires broad live-source coverage of benchmark trial IDs.',
  ),
);

const certaintyCrosswalkStatus = String(certaintyCrosswalk?.status ?? 'missing');
const certaintyCrosswalkSourceMode = String(certaintyCrosswalk?.sourceMode ?? 'missing');
const certaintyCrosswalkComparisons = Number(certaintyCrosswalk?.uniqueComparisonCount ?? certaintyCrosswalk?.totalComparisons ?? NaN);
const certaintyCrosswalkKappa = Number(certaintyCrosswalk?.weightedKappa);
const certaintyCrosswalkKappaCi95Width = Number(
  certaintyCrosswalk?.primaryScenarioMetrics?.weightedKappaCi95Width ?? NaN,
);
const livingDriftStatus = String(livingDrift?.status ?? 'missing');
gates.push(
  gate(
    'living_certainty_drift_control',
    'Certainty crosswalk and living drift control',
    `certainty_crosswalk=${options.targetCertaintyCrosswalkStatus}, source_mode=${options.targetCertaintyCrosswalkSourceMode}, unique_comparisons>=${options.targetCertaintyCrosswalkMinComparisons}, weighted_kappa>=${options.targetCertaintyCrosswalkMinKappa}, kappa_ci95_width<=${options.targetCertaintyCrosswalkMaxKappaCi95Width}, living_drift in [${options.targetLivingDriftStatuses.join(', ')}]`,
    `certainty_crosswalk=${certaintyCrosswalkStatus}; source_mode=${certaintyCrosswalkSourceMode}; unique_comparisons=${Number.isFinite(certaintyCrosswalkComparisons) ? certaintyCrosswalkComparisons : 'n/a'}; weighted_kappa=${Number.isFinite(certaintyCrosswalkKappa) ? certaintyCrosswalkKappa : 'n/a'}; kappa_ci95_width=${Number.isFinite(certaintyCrosswalkKappaCi95Width) ? certaintyCrosswalkKappaCi95Width : 'n/a'}; living_drift=${livingDriftStatus}`,
    certaintyCrosswalkStatus === options.targetCertaintyCrosswalkStatus &&
      certaintyCrosswalkSourceMode === options.targetCertaintyCrosswalkSourceMode &&
      Number.isFinite(certaintyCrosswalkComparisons) &&
      certaintyCrosswalkComparisons >= options.targetCertaintyCrosswalkMinComparisons &&
      Number.isFinite(certaintyCrosswalkKappa) &&
      certaintyCrosswalkKappa >= options.targetCertaintyCrosswalkMinKappa &&
      Number.isFinite(certaintyCrosswalkKappaCi95Width) &&
      certaintyCrosswalkKappaCi95Width <= options.targetCertaintyCrosswalkMaxKappaCi95Width &&
      options.targetLivingDriftStatuses.includes(livingDriftStatus),
    'major',
    `${path.relative(root, evidenceFiles.certaintyCrosswalk)}; ${path.relative(root, evidenceFiles.livingDrift)}`,
    'Cross-framework certainty disagreement and living-update drift must be monitored each cycle.',
  ),
);

const pairwiseStatus = String(pairwiseV2?.status ?? 'missing');
const biasStatus = String(biasSensitivity?.status ?? 'missing');
const robMeCoverage = ratioFromMaybePercent(biasSensitivity?.robMeCoverage);
const networkStatus = String(networkV1?.status ?? 'missing');
const robNmaCoverage = ratioFromMaybePercent(networkV1?.robNmaCoverage);
gates.push(
  gate(
    'advanced_stats_bias_robustness',
    'Advanced statistics and bias robustness suite',
    `pairwise=${options.targetPairwiseStatus}, bias=${options.targetBiasSensitivityStatus}, network=${options.targetNetworkStatus}, ROB-ME coverage>=${toPct(options.targetRobMeCoverage)}%, RoB NMA coverage>=${toPct(options.targetRobNmaCoverage)}%`,
    `pairwise=${pairwiseStatus}; bias=${biasStatus}; network=${networkStatus}; ROB-ME coverage=${robMeCoverage == null ? 'n/a' : `${toPct(robMeCoverage)}%`}; RoB NMA coverage=${robNmaCoverage == null ? 'n/a' : `${toPct(robNmaCoverage)}%`}`,
    pairwiseStatus === options.targetPairwiseStatus &&
      biasStatus === options.targetBiasSensitivityStatus &&
      networkStatus === options.targetNetworkStatus &&
      robMeCoverage != null &&
      robMeCoverage >= options.targetRobMeCoverage &&
      robNmaCoverage != null &&
      robNmaCoverage >= options.targetRobNmaCoverage,
    'critical',
    `${path.relative(root, evidenceFiles.pairwiseV2)}; ${path.relative(root, evidenceFiles.biasSensitivity)}; ${path.relative(root, evidenceFiles.networkV1)}`,
    'Phase-A/Phase-B/Phase-C advanced statistics and missing-evidence robustness must pass before submission lock.',
  ),
);

const dedupStatus = String(dedupBenchmark?.status ?? 'missing');
const dedupF1 = Number(dedupBenchmark?.f1 ?? dedupBenchmark?.dedupF1 ?? NaN);
gates.push(
  gate(
    'dedup_identity_quality',
    'Identity dedup benchmark quality',
    `status=${options.targetDedupStatus}, f1>=${options.targetDedupF1}`,
    `status=${dedupStatus}; f1=${Number.isFinite(dedupF1) ? dedupF1 : 'n/a'}`,
    dedupStatus === options.targetDedupStatus && Number.isFinite(dedupF1) && dedupF1 >= options.targetDedupF1,
    'major',
    path.relative(root, evidenceFiles.dedupBenchmark),
    'Gold-labeled dedup benchmark must control false merges and false splits.',
  ),
);

const precisionAt20 = ratioFromMaybePercent(ranking.opportunityPrecisionAt20 ?? ranking.opportunityPrecisionAt20Proxy);
const ndcgAt20 = ratioFromMaybePercent(ranking.ndcgAt20 ?? ranking.ndcgAt20Proxy);
const rankingProxy = Boolean(ranking.proxy);
gates.push(
  gate(
    'ranking_non_proxy',
    'Ranking quality measured from non-proxy benchmark judgments',
    `precision@20 >= ${toPct(options.targetPrecisionAt20)}%, ndcg@20 >= ${toPct(options.targetNdcgAt20)}%, proxy=false`,
    `precision@20=${precisionAt20 == null ? 'n/a' : `${toPct(precisionAt20)}%`}; ndcg@20=${ndcgAt20 == null ? 'n/a' : `${toPct(ndcgAt20)}%`}; proxy=${rankingProxy}`,
    precisionAt20 != null &&
      ndcgAt20 != null &&
      precisionAt20 >= options.targetPrecisionAt20 &&
      ndcgAt20 >= options.targetNdcgAt20 &&
      !rankingProxy,
    'critical',
    path.relative(root, evidenceFiles.ranking),
    'Proxy metrics are insufficient for top-tier editorial claims.',
  ),
);

const provenanceCompleteness = ratioFromMaybePercent(provenance.averageCompleteness);
gates.push(
  gate(
    'provenance_completeness',
    'Provenance completeness',
    `>= ${toPct(options.targetProvenanceCompleteness)}%`,
    provenanceCompleteness == null ? null : `${toPct(provenanceCompleteness)}%`,
    provenanceCompleteness != null && provenanceCompleteness >= options.targetProvenanceCompleteness,
    'critical',
    path.relative(root, evidenceFiles.provenance),
    'Lancet-level trust requires complete traceability for displayed evidence.',
  ),
);

const ontologyCoverage = ratioFromMaybePercent(ontology?.summary?.coverage);
const ontologyUnknownTermCount = Number(ontology?.summary?.unknownTermCount ?? NaN);
gates.push(
  gate(
    'ontology_coverage',
    'Ontology mapping coverage',
    `coverage>=${toPct(options.targetOntologyCoverage)}%, unknown_terms<=${options.targetOntologyUnknownTermCount}`,
    `coverage=${ontologyCoverage == null ? 'n/a' : `${toPct(ontologyCoverage)}%`}; unknown_terms=${Number.isFinite(ontologyUnknownTermCount) ? ontologyUnknownTermCount : 'n/a'}`,
    ontologyCoverage != null &&
      ontologyCoverage >= options.targetOntologyCoverage &&
      Number.isFinite(ontologyUnknownTermCount) &&
      ontologyUnknownTermCount <= options.targetOntologyUnknownTermCount,
    'major',
    path.relative(root, evidenceFiles.ontology),
    'Unknown-term queue must remain at zero for benchmark entities.',
  ),
);

const releaseGatePassed = String(releaseGates?.summary?.status ?? '') === 'passed';
gates.push(
  gate(
    'release_gates',
    'Release gate health',
    'status=passed',
    String(releaseGates?.summary?.status ?? 'missing'),
    releaseGatePassed,
    'major',
    path.relative(root, evidenceFiles.releaseGates),
    'Includes phase verification and strict outage/recovery checks.',
  ),
);

const strictStatus = String(sourceHealth?.summary?.strictStatus ?? 'missing');
const okSources = Number(sourceHealth?.summary?.okSources ?? 0);
const failedSources = Number(sourceHealth?.summary?.failedSources ?? 0);
gates.push(
  gate(
    'source_breadth',
    'Strict live-source breadth',
    `strictStatus=passed, failedSources=0, okSources>=${options.minLiveSources}`,
    `strictStatus=${strictStatus}; okSources=${okSources}; failedSources=${failedSources}`,
    strictStatus === 'passed' && failedSources === 0 && okSources >= options.minLiveSources,
    'major',
    path.relative(root, evidenceFiles.sourceHealth),
    'Sample-only runs are not sufficient for editorial-grade external validity.',
  ),
);

const adoptionWindow =
  reviewSummaries.length >= options.targetConsecutiveCycles
    ? reviewSummaries.slice(-options.targetConsecutiveCycles)
    : reviewSummaries.slice();
const adoptionCycleEvaluations = adoptionWindow.map((entry) => {
  const switchNow = Number(entry?.data?.switchNow ?? NaN);
  const totalReviewers = Number(entry?.data?.totalReviewers ?? NaN);
  const passed =
    Number.isFinite(switchNow) &&
    Number.isFinite(totalReviewers) &&
    switchNow >= options.targetSwitchNow &&
    totalReviewers >= options.targetTotalReviewers &&
    entry?.data?.adoptionGate?.passed === true;
  return {
    cycleId: entry.cycleId,
    switchNow,
    totalReviewers,
    passed,
    summaryPath: path.relative(root, entry.fullPath),
  };
});
const adoptionPass =
  adoptionCycleEvaluations.length >= options.targetConsecutiveCycles &&
  adoptionCycleEvaluations.every((cycle) => cycle.passed === true);
const latestSwitchNow = Number(latestReviewSummaryEntry?.data?.switchNow ?? NaN);
const latestTotalReviewers = Number(latestReviewSummaryEntry?.data?.totalReviewers ?? NaN);
const adoptionActual =
  adoptionCycleEvaluations.length === 0
    ? 'no_cycle_summaries'
    : `${adoptionCycleEvaluations.filter((cycle) => cycle.passed).length}/${options.targetConsecutiveCycles} consecutive cycles passed; latest=${Number.isFinite(latestSwitchNow) && Number.isFinite(latestTotalReviewers) ? `${latestSwitchNow}/${latestTotalReviewers}` : 'n/a'}`;
const adoptionEvidencePath =
  adoptionCycleEvaluations.length > 0
    ? adoptionCycleEvaluations.map((cycle) => cycle.summaryPath).join('; ')
    : 'reports/review-cycles/*-summary.json';
gates.push(
  gate(
    'methodologist_adoption',
    'Methodologist switch gate',
    `${options.targetConsecutiveCycles} consecutive cycles with switch_now>=${options.targetSwitchNow} out of ${options.targetTotalReviewers}`,
    adoptionActual,
    adoptionPass,
    'major',
    adoptionEvidencePath,
    'Consecutive-cycle pass is required for submission-level confidence.',
  ),
);

const blockers = gates
  .filter((g) => !g.passed)
  .sort((a, b) => {
    const order = { critical: 0, major: 1, minor: 2 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
  });

const recommendationsByGate = {
  ingestion_recall: 'Run strict multisource ingestion against benchmark ID lists and close missing trial IDs pack-by-pack.',
  ranking_non_proxy: 'Replace proxy vote-derived ranking metrics with blinded per-opportunity judgments across top-20 and compute true NDCG.',
  advanced_stats_bias_robustness:
    'Pass pairwise, bias, and network advanced-statistics suites with ROB-ME and RoB NMA coverage at 100%.',
  dedup_identity_quality:
    'Run identity dedup benchmark and calibrate rules/overrides until F1 reaches threshold with controlled false merges.',
  living_certainty_drift_control:
    'Maintain passing certainty crosswalk and no unresolved living-drift alerts above threshold.',
  provenance_completeness: 'Increase per-record identifiers/links (PMID/DOI/NCT and endpoint derivation paths) until completeness is 100%.',
  ontology_coverage: 'Adjudicate unknown terms immediately and keep ontology benchmark queue at zero.',
  source_breadth: 'Use strict multisource run as the canonical editorial build and require >=4 healthy live sources.',
  methodologist_adoption:
    'Maintain >=11/12 switch_now across two consecutive blinded cycles and resolve dissent themes before manuscript lock.',
  release_gates: 'Resolve failing quality gates before generating submission figures/tables.',
};

const readiness = {
  generatedAt: new Date().toISOString(),
  scope: 'Lancet-tier publication readiness for cardio discovery platform',
  overallStatus: blockers.length === 0 ? 'ready_for_submission' : 'not_ready',
  score: {
    passed: gates.filter((g) => g.passed).length,
    total: gates.length,
    percent: Number(((gates.filter((g) => g.passed).length / gates.length) * 100).toFixed(2)),
  },
  gates,
  blockers: blockers.map((b) => ({
    ...b,
    recommendedAction: recommendationsByGate[b.id] ?? 'Resolve failing gate.',
  })),
  adoptionWindow: adoptionCycleEvaluations,
  evidence: Object.entries(evidenceFiles).map(([id, file]) => ({
    id,
    file: path.relative(root, file),
    exists: fs.existsSync(file),
    sha256: fileHashSha256(file),
  })),
};

const stamp = readiness.generatedAt.replace(/[:.]/g, '-');
const jsonStamp = path.join(editorialOutDir, `lancet-readiness-${stamp}.json`);
const jsonLatest = path.join(editorialOutDir, 'lancet-readiness-latest.json');
fs.writeFileSync(jsonStamp, JSON.stringify(readiness, null, 2));
fs.writeFileSync(jsonLatest, JSON.stringify(readiness, null, 2));

const checklistRows = toChecklistRows(gates);
const checklistCsv = path.join(editorialOutDir, 'lancet-submission-checklist.csv');
writeChecklistCsv(checklistCsv, checklistRows);

const mdLines = [];
mdLines.push('# Lancet Readiness Report');
mdLines.push('');
mdLines.push(`Generated: ${readiness.generatedAt}`);
mdLines.push(`Overall status: **${readiness.overallStatus}**`);
mdLines.push(`Gate score: **${readiness.score.passed}/${readiness.score.total} (${readiness.score.percent}%)**`);
mdLines.push('');
mdLines.push('## Gates');
for (const g of gates) {
  mdLines.push(`- ${statusLabel(g.passed)} [${g.severity}] ${g.label}`);
  mdLines.push(`  target: ${g.target}`);
  mdLines.push(`  actual: ${g.actual ?? 'n/a'}`);
  mdLines.push(`  evidence: \`${g.evidencePath}\``);
}
mdLines.push('');
mdLines.push('## Blockers');
if (blockers.length === 0) {
  mdLines.push('- None. Submission gates are all green.');
} else {
  for (const b of blockers) {
    mdLines.push(`- [${b.severity}] ${b.label}`);
    mdLines.push(`  action: ${recommendationsByGate[b.id] ?? 'Resolve failing gate.'}`);
  }
}

const mdStamp = path.join(editorialOutDir, `lancet-readiness-${stamp}.md`);
const mdLatest = path.join(editorialDocsDir, 'LANCET_READINESS_REPORT_LATEST.md');
fs.writeFileSync(mdStamp, `${mdLines.join('\n')}\n`);
fs.writeFileSync(mdLatest, `${mdLines.join('\n')}\n`);

console.log(`Wrote ${path.relative(root, jsonStamp)}`);
console.log(`Wrote ${path.relative(root, jsonLatest)}`);
console.log(`Wrote ${path.relative(root, checklistCsv)}`);
console.log(`Wrote ${path.relative(root, mdStamp)}`);
console.log(`Wrote ${path.relative(root, mdLatest)}`);
console.log(`Lancet readiness: ${readiness.overallStatus} (${readiness.score.passed}/${readiness.score.total})`);

if (options.enforce && readiness.overallStatus !== 'ready_for_submission') {
  process.exit(1);
}
