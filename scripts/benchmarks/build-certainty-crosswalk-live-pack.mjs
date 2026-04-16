import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    rctRoot: process.env.RCT_EXTRACTOR_ROOT || 'C:/rct-extractor-v2',
    inputFile: null,
    outputFixturePath: 'reports/benchmarks/packs/v2/certainty_crosswalk_live.v1.json',
    outputSummaryPath: 'reports/benchmarks/certainty-crosswalk-bridge-latest.json',
    minComparisons: 100,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--rct-root') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.rctRoot = value;
      i += 1;
    } else if (arg === '--input') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.inputFile = value;
      i += 1;
    } else if (arg === '--out-fixture') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.outputFixturePath = value;
      i += 1;
    } else if (arg === '--out-summary') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.outputSummaryPath = value;
      i += 1;
    } else if (arg === '--min-comparisons') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 20) options.minComparisons = Math.floor(value);
      i += 1;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function normalizeTier(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'null' || text === 'none') return 'unknown';
  return text;
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBooleanOrNull(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function inferExtracted(row) {
  if (typeof row?.extracted === 'boolean') return row.extracted;
  if (row?.best_match != null && typeof row.best_match === 'object') return true;
  if (Number(row?.n_extractions) > 0) return true;
  const status = normalizeStatus(row?.status);
  if (status.includes('no_extraction')) return false;
  if (status.includes('no_match')) return false;
  if (status.includes('exact_match')) return true;
  return false;
}

function inferQualityFlag(rawValue, status, positiveForExactMatchWithCi, positiveForExactMatch) {
  const explicit = toBooleanOrNull(rawValue);
  if (explicit != null) return explicit;
  if (status.includes('exact_match_with_ci')) return positiveForExactMatchWithCi;
  if (status.includes('exact_match')) return positiveForExactMatch;
  if (status.includes('no_extraction') || status.includes('no_match')) return false;
  return false;
}

function mapGradeCategory(tier, extracted, calibratedConfidence) {
  if (tier === 'full_auto') return 'high';
  if (tier === 'reference_fallback') return 'moderate';
  if (tier === 'manual') return 'low';
  if (!extracted) return 'very_low';
  if (calibratedConfidence != null && calibratedConfidence >= 0.9) return 'moderate';
  if (calibratedConfidence != null && calibratedConfidence >= 0.45) return 'low';
  return 'very_low';
}

function mapCinemaCategory(extracted, calibratedConfidence, within10, ciWithin10, typeMatch) {
  if (!extracted) return 'very_low';
  const strongAgreement = within10 && ciWithin10 && typeMatch;
  if (strongAgreement && calibratedConfidence != null && calibratedConfidence >= 0.9) return 'high';
  if (strongAgreement && calibratedConfidence != null && calibratedConfidence >= 0.45) return 'moderate';
  if (strongAgreement) return 'low';
  if (calibratedConfidence != null && calibratedConfidence >= 0.85) return 'moderate';
  if (calibratedConfidence != null && calibratedConfidence >= 0.45) return 'low';
  return 'very_low';
}

function toComparisonId(row, index) {
  const idCandidate =
    row?.benchmark_id ??
    row?.study_id ??
    row?.studyId ??
    row?.trial_id ??
    row?.trialId ??
    row?.id;
  const text = String(idCandidate ?? '').trim();
  if (text) return text;
  return `row_${index + 1}`;
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = String(keyFn(item));
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const next = stack.pop();
    const entries = fs.readdirSync(next, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(next, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

function scoreCandidateRows(rows) {
  if (rows.length === 0) return { score: -1, confidenceRows: 0, tierRows: 0, extractedRows: 0 };
  let confidenceRows = 0;
  let tierRows = 0;
  let extractedRows = 0;
  for (const row of rows) {
    const conf = toFiniteNumber(row?.calibrated_confidence ?? row?.best_match?.calibrated_confidence);
    if (conf != null) confidenceRows += 1;
    const tier = normalizeTier(row?.automation_tier ?? row?.best_match?.automation_tier);
    if (tier !== 'unknown') tierRows += 1;
    if (inferExtracted(row)) extractedRows += 1;
  }
  const score = rows.length * 1000 + confidenceRows * 10 + tierRows * 5 + extractedRows;
  return { score, confidenceRows, tierRows, extractedRows };
}

function discoverInputFile(options) {
  if (options.inputFile) {
    const resolved = path.isAbsolute(options.inputFile)
      ? options.inputFile
      : path.join(options.rctRoot, options.inputFile);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Specified --input file does not exist: ${resolved}`);
    }
    return {
      filePath: resolved,
      rows: extractRows(readJson(resolved)),
      meta: { source: 'explicit_input' },
    };
  }

  const outputDir = path.join(options.rctRoot, 'output');
  const candidates = [];
  const allFiles = walkFiles(outputDir);
  for (const filePath of allFiles) {
    if (!filePath.toLowerCase().endsWith('.json')) continue;
    const name = path.basename(filePath).toLowerCase();
    if (!name.includes('benchmark_eval') && !name.includes('real_rct_results')) continue;
    let payload = null;
    try {
      payload = readJson(filePath);
    } catch {
      continue;
    }
    const rows = extractRows(payload);
    const score = scoreCandidateRows(rows);
    if (score.score < 0) continue;
    const stat = fs.statSync(filePath);
    candidates.push({
      filePath,
      rows,
      score: score.score,
      confidenceRows: score.confidenceRows,
      tierRows: score.tierRows,
      extractedRows: score.extractedRows,
      mtimeMs: stat.mtimeMs,
    });
  }

  if (candidates.length === 0) {
    throw new Error(`No suitable JSON candidates found under ${outputDir}`);
  }

  candidates.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));
  const best = candidates[0];
  return {
    filePath: best.filePath,
    rows: best.rows,
    meta: {
      source: 'auto_discovery',
      candidateCount: candidates.length,
      confidenceRows: best.confidenceRows,
      tierRows: best.tierRows,
      extractedRows: best.extractedRows,
    },
  };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();

let input = null;
try {
  input = discoverInputFile(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const comparisonsAll = [];
for (let i = 0; i < input.rows.length; i += 1) {
  const row = input.rows[i];
  const extracted = inferExtracted(row);
  const status = normalizeStatus(row?.status);
  const tier = normalizeTier(row?.automation_tier ?? row?.best_match?.automation_tier);
  const calibratedConfidence = toFiniteNumber(row?.calibrated_confidence ?? row?.best_match?.calibrated_confidence);
  const within10 = inferQualityFlag(row?.within_10pct, status, true, true);
  const ciWithin10 = inferQualityFlag(row?.ci_within_10pct, status, true, false);
  const typeMatch = inferQualityFlag(row?.type_match, status, true, true);
  const grade = mapGradeCategory(tier, extracted, calibratedConfidence);
  const cinema = mapCinemaCategory(extracted, calibratedConfidence, within10, ciWithin10, typeMatch);
  comparisonsAll.push({
    comparisonId: toComparisonId(row, i),
    grade,
    cinema,
    metadata: {
      tier,
      extracted,
      calibratedConfidence,
      within10,
      ciWithin10,
      typeMatch,
    },
  });
}

if (comparisonsAll.length < options.minComparisons) {
  console.error(
    `Insufficient live comparisons for crosswalk: ${comparisonsAll.length} < ${options.minComparisons}`,
  );
  process.exit(1);
}

const reviewSensitive = comparisonsAll.filter((row) => {
  const tier = String(row?.metadata?.tier ?? 'unknown');
  return tier !== 'full_auto' || row.grade !== row.cinema;
});

const scenarioTwoRows =
  reviewSensitive.length >= 30 ? reviewSensitive : comparisonsAll.filter((row) => row.grade !== 'high' || row.cinema !== 'high');

const fixture = {
  schemaVersion: 'certainty_crosswalk.v1',
  sourceMode: 'live_extracted',
  primaryScenarioId: 'live_extracted_all_rows',
  createdAt: new Date().toISOString(),
  description:
    'Crosswalk benchmark fixture generated from real extracted study-level certainty signals (automation tier + calibrated confidence + benchmark agreement flags).',
  categories: ['high', 'moderate', 'low', 'very_low'],
  source: {
    rctRoot: options.rctRoot,
    filePath: input.filePath,
    discovery: input.meta,
    mappingVersion: 'live_bridge.v1',
  },
  scenarios: [
    {
      scenarioId: 'live_extracted_all_rows',
      description: 'All comparable live extracted rows from rct-extractor benchmark outputs.',
      comparisons: comparisonsAll.map((row) => ({
        comparisonId: row.comparisonId,
        grade: row.grade,
        cinema: row.cinema,
      })),
      expected: {
        minComparisons: 100,
        exactAgreement: { min: 0.25, max: 0.9 },
        adjacentAgreement: { min: 0.9, max: 1 },
        weightedKappa: { min: 0.4, max: 0.98 },
        maxKappaCi95Width: 0.45,
        maxSevereDisagreement: 30,
        maxMeanDistance: 0.9,
      },
    },
    {
      scenarioId: 'live_extracted_review_sensitive_rows',
      description: 'Subset emphasizing non-full-auto and disagreement-sensitive rows.',
      comparisons: scenarioTwoRows.map((row) => ({
        comparisonId: row.comparisonId,
        grade: row.grade,
        cinema: row.cinema,
      })),
      expected: {
        minComparisons: 30,
        exactAgreement: { min: 0.1, max: 0.8 },
        adjacentAgreement: { min: 0.85, max: 1 },
        weightedKappa: { min: 0.2, max: 0.95 },
        maxKappaCi95Width: 0.6,
        maxSevereDisagreement: 20,
        maxMeanDistance: 1.1,
      },
    },
  ],
};

const summary = {
  generatedAt: fixture.createdAt,
  sourceMode: fixture.sourceMode,
  sourceFile: input.filePath,
  rowCount: input.rows.length,
  comparisonCount: comparisonsAll.length,
  reviewSensitiveCount: scenarioTwoRows.length,
  gradeDistribution: countBy(comparisonsAll, (row) => row.grade),
  cinemaDistribution: countBy(comparisonsAll, (row) => row.cinema),
  tierDistribution: countBy(comparisonsAll, (row) => row.metadata.tier),
  extractedDistribution: countBy(comparisonsAll, (row) => (row.metadata.extracted ? 'extracted' : 'not_extracted')),
  confidence: (() => {
    const values = comparisonsAll
      .map((row) => row.metadata.calibratedConfidence)
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      return { count: 0, min: null, max: null, mean: null };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    return {
      count: values.length,
      min: Number(min.toFixed(6)),
      max: Number(max.toFixed(6)),
      mean: Number(mean.toFixed(6)),
    };
  })(),
  outputs: {
    fixturePath: options.outputFixturePath,
    summaryPath: options.outputSummaryPath,
  },
};

const fixtureOut = path.isAbsolute(options.outputFixturePath)
  ? options.outputFixturePath
  : path.join(root, options.outputFixturePath);
const summaryOut = path.isAbsolute(options.outputSummaryPath)
  ? options.outputSummaryPath
  : path.join(root, options.outputSummaryPath);

fs.mkdirSync(path.dirname(fixtureOut), { recursive: true });
fs.mkdirSync(path.dirname(summaryOut), { recursive: true });
fs.writeFileSync(fixtureOut, `${JSON.stringify(fixture, null, 2)}\n`);
fs.writeFileSync(summaryOut, `${JSON.stringify(summary, null, 2)}\n`);

console.log(`Wrote ${path.relative(root, fixtureOut)}`);
console.log(`Wrote ${path.relative(root, summaryOut)}`);
console.log(
  `Built live certainty crosswalk fixture from ${comparisonsAll.length} comparisons (${scenarioTwoRows.length} review-sensitive).`,
);
