import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    enforce: false,
    effectThreshold: 0.05,
    topProbabilityThreshold: 0.15,
    pothThreshold: 0.2,
    certaintyShiftThreshold: 0,
    kappaThreshold: 0.15,
    historyPath: 'reports/ops/living-drift-history.json',
    thresholdPackPath: 'reports/ops/packs/living_drift_thresholds.v1.json',
    lockWaitMs: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--enforce') {
      options.enforce = true;
    } else if (arg === '--effect-threshold') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.effectThreshold = value;
      i += 1;
    } else if (arg === '--top-probability-threshold') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.topProbabilityThreshold = value;
      i += 1;
    } else if (arg === '--poth-threshold') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.pothThreshold = value;
      i += 1;
    } else if (arg === '--certainty-shift-threshold') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.certaintyShiftThreshold = Math.floor(value);
      i += 1;
    } else if (arg === '--kappa-threshold') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.kappaThreshold = value;
      i += 1;
    } else if (arg === '--history') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.historyPath = value;
      i += 1;
    } else if (arg === '--threshold-pack') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.thresholdPackPath = value;
      i += 1;
    } else if (arg === '--lock-wait-ms') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) options.lockWaitMs = Math.floor(value);
      i += 1;
    }
  }

  return options;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

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

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
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
        console.error(`Another living-drift run is in progress (lock exists): ${lockPath}${ownerSuffix}`);
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

function toFixed(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function toNonNegativeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function judgementRank(value) {
  const table = { low: 0, some_concerns: 1, high: 2 };
  return table[String(value ?? '').toLowerCase()] ?? null;
}

function byScenario(rows, pick) {
  const out = {};
  for (const row of rows ?? []) {
    const key = String(row?.scenarioId ?? '').trim();
    if (!key) continue;
    out[key] = pick(row);
  }
  return out;
}

function collectSnapshot(root) {
  const pairwiseEval = readJson(path.join(root, 'reports', 'benchmarks', 'pairwise-v2-eval-latest.json'), {});
  const biasEval = readJson(path.join(root, 'reports', 'benchmarks', 'bias-sensitivity-eval-latest.json'), {});
  const networkEval = readJson(path.join(root, 'reports', 'benchmarks', 'network-v1-eval-latest.json'), {});
  const certaintyCrosswalk = readJson(path.join(root, 'reports', 'benchmarks', 'certainty-crosswalk.json'), {});
  const primaryKappa = toFixed(certaintyCrosswalk?.primaryScenarioMetrics?.weightedKappa);
  const weightedKappa = toFixed(certaintyCrosswalk?.weightedKappa);
  const kappaMetricMode = primaryKappa != null ? 'primary_scenario' : 'weighted_all_scenarios';
  const kappaForDrift = primaryKappa ?? weightedKappa;
  const primaryKappaCi95Width = toFixed(certaintyCrosswalk?.primaryScenarioMetrics?.weightedKappaCi95Width);

  const pairwiseScenarios = byScenario(pairwiseEval?.details, (row) => ({
    estimate: toFixed(row?.result?.pooled?.estimate),
    tau2: toFixed(row?.result?.heterogeneity?.tau2),
    i2: toFixed(row?.result?.heterogeneity?.i2),
  }));

  const biasScenarios = byScenario(biasEval?.scenarios, (row) => ({
    baselineEstimate: toFixed(row?.baseline?.estimate),
    envelopeWidth: toFixed(row?.envelope?.width),
    robMeOverall: String(row?.robMe?.overallJudgement ?? ''),
  }));

  const networkScenarios = byScenario(networkEval?.scenarios, (row) => ({
    topTreatment: String(row?.result?.ranking?.topTreatment ?? ''),
    topTreatmentProbability: toFixed(row?.result?.ranking?.topTreatmentProbability),
    poth: toFixed(row?.result?.ranking?.precision?.poth),
    pothTop3: toFixed(row?.result?.ranking?.precision?.pothTop3),
    tau2: toFixed(row?.result?.heterogeneity?.tau2),
    phi: toFixed(row?.result?.multiplicativeHeterogeneity?.phi),
  }));

  return {
    generatedAt: new Date().toISOString(),
    benchmarkStatus: {
      pairwise: String(pairwiseEval?.summary?.status ?? 'missing'),
      bias: String(biasEval?.summary?.status ?? 'missing'),
      network: String(networkEval?.summary?.status ?? 'missing'),
      certaintyCrosswalk: String(certaintyCrosswalk?.status ?? 'missing'),
    },
    pairwise: pairwiseScenarios,
    bias: {
      overallRobMeJudgement: String(biasEval?.summary?.overallRobMeJudgement ?? ''),
      scenarios: biasScenarios,
    },
    network: {
      overallRobNmaJudgement: String(networkEval?.summary?.overallRobNmaJudgement ?? ''),
      scenarios: networkScenarios,
    },
    certaintyCrosswalk: {
      weightedKappa: weightedKappa,
      primaryScenarioWeightedKappa: primaryKappa,
      kappaMetricMode,
      kappaForDrift,
      primaryScenarioWeightedKappaCi95Width: primaryKappaCi95Width,
      weightedExactAgreement: toFixed(certaintyCrosswalk?.weightedExactAgreement),
      weightedAdjacentAgreement: toFixed(certaintyCrosswalk?.weightedAdjacentAgreement),
      weightedSevereDisagreementRate: toFixed(certaintyCrosswalk?.weightedSevereDisagreementRate),
    },
  };
}

function resolveThresholds(root, options) {
  const defaults = {
    effectThreshold: options.effectThreshold,
    topProbabilityThreshold: options.topProbabilityThreshold,
    pothThreshold: options.pothThreshold,
    certaintyShiftThreshold: options.certaintyShiftThreshold,
    kappaThreshold: options.kappaThreshold,
  };

  const thresholdPackPath = path.isAbsolute(options.thresholdPackPath)
    ? options.thresholdPackPath
    : path.join(root, options.thresholdPackPath);
  const pack = readJson(thresholdPackPath, null);
  if (!pack) {
    return {
      sourcePath: null,
      defaults,
      pairwise: {},
      network: {},
      certainty: {
        robMeShiftThreshold: defaults.certaintyShiftThreshold,
        robNmaShiftThreshold: defaults.certaintyShiftThreshold,
        kappaThreshold: defaults.kappaThreshold,
      },
    };
  }

  const packDefaults = pack?.defaults ?? {};
  const mergedDefaults = {
    effectThreshold: toNonNegativeNumber(packDefaults.effectThreshold, defaults.effectThreshold),
    topProbabilityThreshold: toNonNegativeNumber(
      packDefaults.topProbabilityThreshold,
      defaults.topProbabilityThreshold,
    ),
    pothThreshold: toNonNegativeNumber(packDefaults.pothThreshold, defaults.pothThreshold),
    certaintyShiftThreshold: Math.floor(
      toNonNegativeNumber(packDefaults.certaintyShiftThreshold, defaults.certaintyShiftThreshold),
    ),
    kappaThreshold: toNonNegativeNumber(packDefaults.kappaThreshold, defaults.kappaThreshold),
  };

  const pairwise = {};
  for (const [scenarioId, entry] of Object.entries(pack?.pairwise ?? {})) {
    pairwise[scenarioId] = {
      effectThreshold: toNonNegativeNumber(entry?.effectThreshold, mergedDefaults.effectThreshold),
    };
  }

  const network = {};
  for (const [scenarioId, entry] of Object.entries(pack?.network ?? {})) {
    network[scenarioId] = {
      topProbabilityThreshold: toNonNegativeNumber(
        entry?.topProbabilityThreshold,
        mergedDefaults.topProbabilityThreshold,
      ),
      pothThreshold: toNonNegativeNumber(entry?.pothThreshold, mergedDefaults.pothThreshold),
    };
  }

  const certaintyPack = pack?.certainty ?? {};
  const certainty = {
    robMeShiftThreshold: Math.floor(
      toNonNegativeNumber(certaintyPack?.robMeShiftThreshold, mergedDefaults.certaintyShiftThreshold),
    ),
    robNmaShiftThreshold: Math.floor(
      toNonNegativeNumber(certaintyPack?.robNmaShiftThreshold, mergedDefaults.certaintyShiftThreshold),
    ),
    kappaThreshold: toNonNegativeNumber(certaintyPack?.kappaThreshold, mergedDefaults.kappaThreshold),
  };

  return {
    sourcePath: thresholdPackPath,
    defaults: mergedDefaults,
    pairwise,
    network,
    certainty,
  };
}

function compareSnapshots(current, previous, thresholds) {
  const alerts = [];
  const effectDrift = [];
  const rankDrift = [];
  const certaintyDrift = [];

  const pairwiseIds = Object.keys(current.pairwise ?? {});
  for (const scenarioId of pairwiseIds) {
    const curr = current.pairwise[scenarioId];
    const prev = previous?.pairwise?.[scenarioId];
    if (!curr || !prev) continue;
    const thresholdUsed =
      thresholds?.pairwise?.[scenarioId]?.effectThreshold ?? thresholds.defaults.effectThreshold;
    const deltaEstimate = Math.abs(Number(curr.estimate) - Number(prev.estimate));
    effectDrift.push({
      scenarioId,
      deltaEstimate: toFixed(deltaEstimate, 6),
      thresholdUsed: toFixed(thresholdUsed, 6),
    });
    if (deltaEstimate > thresholdUsed) {
      alerts.push({
        type: 'effect_drift',
        severity: 'major',
        scenarioId,
        message: `Pairwise estimate drift ${toFixed(deltaEstimate, 6)} exceeded threshold ${thresholdUsed}.`,
      });
    }
  }

  const networkIds = Object.keys(current.network?.scenarios ?? {});
  for (const scenarioId of networkIds) {
    const curr = current.network.scenarios[scenarioId];
    const prev = previous?.network?.scenarios?.[scenarioId];
    if (!curr || !prev) continue;
    const topProbThreshold =
      thresholds?.network?.[scenarioId]?.topProbabilityThreshold ??
      thresholds.defaults.topProbabilityThreshold;
    const pothThreshold =
      thresholds?.network?.[scenarioId]?.pothThreshold ?? thresholds.defaults.pothThreshold;
    const topChanged = String(curr.topTreatment) !== String(prev.topTreatment);
    const deltaTopProb = Math.abs(
      Number(curr.topTreatmentProbability) - Number(prev.topTreatmentProbability),
    );
    const deltaPoth = Math.abs(Number(curr.poth) - Number(prev.poth));
    rankDrift.push({
      scenarioId,
      topChanged,
      deltaTopProbability: toFixed(deltaTopProb, 6),
      deltaPoth: toFixed(deltaPoth, 6),
      topProbabilityThreshold: toFixed(topProbThreshold, 6),
      pothThreshold: toFixed(pothThreshold, 6),
    });
    if (topChanged) {
      alerts.push({
        type: 'rank_drift',
        severity: 'major',
        scenarioId,
        message: `Top treatment changed from '${prev.topTreatment}' to '${curr.topTreatment}'.`,
      });
    }
    if (deltaTopProb > topProbThreshold) {
      alerts.push({
        type: 'rank_probability_drift',
        severity: 'major',
        scenarioId,
        message: `Top treatment probability drift ${toFixed(deltaTopProb, 6)} exceeded threshold ${topProbThreshold}.`,
      });
    }
    if (deltaPoth > pothThreshold) {
      alerts.push({
        type: 'ranking_precision_drift',
        severity: 'major',
        scenarioId,
        message: `POTH drift ${toFixed(deltaPoth, 6)} exceeded threshold ${pothThreshold}.`,
      });
    }
  }

  const currentRobMeRank = judgementRank(current?.bias?.overallRobMeJudgement);
  const previousRobMeRank = judgementRank(previous?.bias?.overallRobMeJudgement);
  if (currentRobMeRank != null && previousRobMeRank != null) {
    const shift = Math.abs(currentRobMeRank - previousRobMeRank);
    const thresholdUsed = thresholds.certainty.robMeShiftThreshold;
    certaintyDrift.push({
      metric: 'rob_me_overall',
      previous: previous.bias.overallRobMeJudgement,
      current: current.bias.overallRobMeJudgement,
      shift,
      thresholdUsed,
    });
    if (shift > thresholdUsed) {
      alerts.push({
        type: 'certainty_shift',
        severity: 'major',
        message: `ROB-ME overall judgement shifted from '${previous.bias.overallRobMeJudgement}' to '${current.bias.overallRobMeJudgement}'.`,
      });
    }
  }

  const currentRobNmaRank = judgementRank(current?.network?.overallRobNmaJudgement);
  const previousRobNmaRank = judgementRank(previous?.network?.overallRobNmaJudgement);
  if (currentRobNmaRank != null && previousRobNmaRank != null) {
    const shift = Math.abs(currentRobNmaRank - previousRobNmaRank);
    const thresholdUsed = thresholds.certainty.robNmaShiftThreshold;
    certaintyDrift.push({
      metric: 'rob_nma_overall',
      previous: previous.network.overallRobNmaJudgement,
      current: current.network.overallRobNmaJudgement,
      shift,
      thresholdUsed,
    });
    if (shift > thresholdUsed) {
      alerts.push({
        type: 'certainty_shift',
        severity: 'major',
        message: `RoB NMA overall judgement shifted from '${previous.network.overallRobNmaJudgement}' to '${current.network.overallRobNmaJudgement}'.`,
      });
    }
  }

  const previousKappaMode = String(previous?.certaintyCrosswalk?.kappaMetricMode ?? 'weighted_all_scenarios');
  const currentKappaMode = String(current?.certaintyCrosswalk?.kappaMetricMode ?? 'weighted_all_scenarios');
  const previousKappa = Number(previous?.certaintyCrosswalk?.kappaForDrift);
  const currentKappa = Number(current?.certaintyCrosswalk?.kappaForDrift);
  if (previousKappaMode !== currentKappaMode) {
    certaintyDrift.push({
      metric: 'certainty_crosswalk_kappa_metric_mode',
      previous: previousKappaMode,
      current: currentKappaMode,
      shift: 'definition_changed',
    });
  }
  if (Number.isFinite(previousKappa) && Number.isFinite(currentKappa)) {
    const deltaKappa = Math.abs(currentKappa - previousKappa);
    const thresholdUsed = thresholds.certainty.kappaThreshold;
    certaintyDrift.push({
      metric: 'certainty_crosswalk_weighted_kappa',
      previous: toFixed(previousKappa, 6),
      current: toFixed(currentKappa, 6),
      shift: toFixed(deltaKappa, 6),
      mode: currentKappaMode,
      thresholdUsed: toFixed(thresholdUsed, 6),
    });
    if (deltaKappa > thresholdUsed && previousKappaMode === currentKappaMode) {
      alerts.push({
        type: 'crosswalk_kappa_drift',
        severity: 'major',
        message: `Certainty crosswalk kappa drift ${toFixed(deltaKappa, 6)} exceeded threshold ${thresholdUsed}.`,
      });
    }
  }

  return { alerts, effectDrift, rankDrift, certaintyDrift };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const thresholds = resolveThresholds(root, options);
const historyPath = path.isAbsolute(options.historyPath)
  ? options.historyPath
  : path.join(root, options.historyPath);
const historyLockPath = `${historyPath}.lock`;
const historyLockMetrics = acquireFileLock(historyLockPath, { waitLimitMs: options.lockWaitMs });
installLockCleanup(historyLockPath, historyLockMetrics.fd);
maybeHoldLockForTest();
const history = readJson(historyPath, { snapshots: [] });
const snapshots = Array.isArray(history?.snapshots) ? history.snapshots : [];

const snapshot = collectSnapshot(root);
const previousSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
const comparison = previousSnapshot ? compareSnapshots(snapshot, previousSnapshot, thresholds) : null;

const allBenchmarksPassed = Object.values(snapshot.benchmarkStatus).every((value) => value === 'passed');
let status = 'baseline_established';
let summary = 'No prior snapshot. Baseline established.';
if (previousSnapshot) {
  status = comparison.alerts.length === 0 && allBenchmarksPassed ? 'passed' : 'failed';
  summary =
    comparison.alerts.length === 0
      ? 'No drift alerts above configured thresholds.'
      : `${comparison.alerts.length} drift alert(s) above threshold.`;
}
if (!allBenchmarksPassed) {
  status = 'failed';
  summary = 'One or more prerequisite benchmark outputs are missing or failed.';
}

const report = {
  generatedAt: snapshot.generatedAt,
  status,
  summary,
  lock: {
    waitMs: historyLockMetrics.waitMs,
    collisionCount: historyLockMetrics.collisionCount,
    lockOwnerPid: historyLockMetrics.lockOwnerPid,
  },
  comparedAgainst: previousSnapshot?.generatedAt ?? null,
  thresholds: {
    sourcePath: thresholds.sourcePath ? path.relative(root, thresholds.sourcePath) : null,
    defaults: thresholds.defaults,
    certainty: thresholds.certainty,
    pairwise: thresholds.pairwise,
    network: thresholds.network,
  },
  benchmarkStatus: snapshot.benchmarkStatus,
  drift: comparison ?? {
    alerts: [],
    effectDrift: [],
    rankDrift: [],
    certaintyDrift: [],
  },
};

const updatedSnapshots = [...snapshots, snapshot].slice(-200);
writeJson(historyPath, { generatedAt: report.generatedAt, snapshots: updatedSnapshots });

const opsDir = path.join(root, 'reports', 'ops');
const stamp = report.generatedAt.replace(/[:.]/g, '-');
const stampFile = path.join(opsDir, `living-drift-${stamp}.json`);
const latestFile = path.join(opsDir, 'living-drift-latest.json');
writeJson(stampFile, report);
writeJson(latestFile, report);

console.log(`Wrote ${path.relative(root, historyPath)}`);
console.log(`Wrote ${path.relative(root, stampFile)}`);
console.log(`Wrote ${path.relative(root, latestFile)}`);
console.log(
  `Lock metrics: wait_ms=${historyLockMetrics.waitMs}, collisions=${historyLockMetrics.collisionCount}, owner_pid=${historyLockMetrics.lockOwnerPid ?? 'n/a'}`,
);
if (thresholds.sourcePath) {
  console.log(`Threshold pack: ${path.relative(root, thresholds.sourcePath)}`);
}
console.log(`Living drift status: ${status}`);
if (comparison?.alerts?.length > 0) {
  console.log(`Drift alerts: ${comparison.alerts.length}`);
}

if (options.enforce && report.status === 'failed') {
  process.exit(1);
}
