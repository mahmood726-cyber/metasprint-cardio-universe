import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    rctRoot: 'C:/Users/user/rct-extractor-v2',
    seedPath: null,
    outputPackPath: 'reports/benchmarks/packs/v1/rct_extractor_publications.v1.json',
    outputSummaryPath: 'reports/benchmarks/rct-extractor-bridge-latest.json',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--rct-root') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.rctRoot = value;
      i += 1;
    } else if (arg === '--seed') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.seedPath = value;
      i += 1;
    } else if (arg === '--out-pack') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.outputPackPath = value;
      i += 1;
    } else if (arg === '--out-summary') {
      const value = String(argv[i + 1] ?? '').trim();
      if (value) options.outputSummaryPath = value;
      i += 1;
    }
  }

  return options;
}

function resolveSeedPath(options) {
  if (options.seedPath) {
    return path.isAbsolute(options.seedPath) ? options.seedPath : path.join(options.rctRoot, options.seedPath);
  }

  const candidates = [
    'data/benchmarks/cardiology_meta_linked_ahmad_m_trials_v3b_reextract_pdfpick_20260225/model_seed_adjudicator_only.jsonl',
    'data/benchmarks/cardiology_ahmad_subset25_20260225/model_seed_adjudicator_only.jsonl',
  ];

  for (const rel of candidates) {
    const full = path.join(options.rctRoot, rel);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const rows = [];
  const parseErrors = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push({
        lineNumber: i + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { rows, parseErrors };
}

function normalizeDigits(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? digits : null;
}

function normalizePmid(value) {
  const digits = normalizeDigits(value);
  return digits ? `PMID${digits}` : null;
}

function normalizePmidFromStudyId(value) {
  const text = String(value ?? '').trim();
  if (!/^PMID/i.test(text)) return null;
  return normalizePmid(text);
}

function extractNctIds(text) {
  const found = new Set();
  const input = String(text ?? '');
  const matches = input.match(/NCT\d{8}/gi) ?? [];
  for (const match of matches) {
    found.add(match.toUpperCase());
  }
  return found;
}

function incrementCounter(map, key) {
  const k = key || 'unknown';
  map.set(k, (map.get(k) ?? 0) + 1);
}

function toSortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const seedPath = resolveSeedPath(options);

if (!seedPath || !fs.existsSync(seedPath)) {
  console.error('Unable to locate rct-extractor seed JSONL.');
  console.error('Use --seed <path> or place one of the default files under --rct-root.');
  process.exit(1);
}

const { rows, parseErrors } = readJsonl(seedPath);
if (rows.length === 0) {
  console.error(`No valid rows parsed from ${seedPath}`);
  process.exit(1);
}

const trialPmids = new Set();
const linkedMetaPmids = new Set();
const candidateTrialIdsFromText = new Set();
const automationTierCounts = new Map();
const effectTypeCounts = new Map();
const linkedMetaFrequency = new Map();
const confidenceValues = [];

let extractedRows = 0;
let noExtractionRows = 0;
let withPmidRows = 0;
let withPmcidRows = 0;
let withLinkedMetaRows = 0;
let withSourceTextRows = 0;
let withEffectTypeRows = 0;

for (const row of rows) {
  const statusSnapshot = String(row?.status_snapshot ?? '').toLowerCase();
  if (statusSnapshot === 'extracted') extractedRows += 1;
  if (statusSnapshot === 'no_extraction') noExtractionRows += 1;

  const rowPmid = normalizePmid(row?.pmid);
  if (rowPmid) {
    trialPmids.add(rowPmid);
    withPmidRows += 1;
  }

  const studyPmid = normalizePmidFromStudyId(row?.study_id);
  if (studyPmid) trialPmids.add(studyPmid);

  if (String(row?.pmcid ?? '').trim()) withPmcidRows += 1;

  const linked = Array.isArray(row?.linked_meta_pmids) ? row.linked_meta_pmids : [];
  if (linked.length > 0) withLinkedMetaRows += 1;
  for (const metaPmid of linked) {
    const normalized = normalizePmid(metaPmid);
    if (!normalized) continue;
    linkedMetaPmids.add(normalized);
    incrementCounter(linkedMetaFrequency, normalized);
  }

  const snapshot = row?.model_snapshot_best ?? {};
  const effectType = String(snapshot?.type ?? '').trim();
  if (effectType) {
    withEffectTypeRows += 1;
    incrementCounter(effectTypeCounts, effectType);
  }

  const automationTier = String(snapshot?.automation_tier ?? '').trim() || 'unknown';
  incrementCounter(automationTierCounts, automationTier);

  const confidence = Number(snapshot?.calibrated_confidence);
  if (Number.isFinite(confidence)) confidenceValues.push(confidence);

  const sourceText = String(snapshot?.source_text ?? '');
  if (sourceText.trim().length > 0) withSourceTextRows += 1;
  for (const trialId of extractNctIds(sourceText)) {
    candidateTrialIdsFromText.add(trialId);
  }
}

const expectedPublicationIds = [...new Set([...trialPmids, ...linkedMetaPmids])].sort();
const topLinkedMetaPmids = [...linkedMetaFrequency.entries()]
  .map(([pmid, count]) => ({ pmid, count }))
  .sort((a, b) => b.count - a.count || a.pmid.localeCompare(b.pmid))
  .slice(0, 20);

const generatedAt = new Date().toISOString();
const outputPackPath = path.isAbsolute(options.outputPackPath) ? options.outputPackPath : path.join(root, options.outputPackPath);
const outputSummaryPath = path.isAbsolute(options.outputSummaryPath)
  ? options.outputSummaryPath
  : path.join(root, options.outputSummaryPath);

const packPayload = {
  packId: 'rct_extractor_author_meta_publications',
  version: '1.0.0',
  createdAt: generatedAt,
  description: 'Imported publication benchmark from rct-extractor-v2 cardiology author-meta cohort.',
  source: {
    type: 'rct-extractor-v2',
    repoPath: options.rctRoot,
    seedFile: seedPath,
  },
  expectedTrialIds: [],
  candidateTrialIdsFromText: [...candidateTrialIdsFromText].sort(),
  expectedPublicationIds,
  tags: ['cardio', 'rct-extractor', 'pdf', 'meta-linked'],
};

const confidenceSummary =
  confidenceValues.length === 0
    ? { count: 0, min: null, max: null, mean: null, median: null }
    : {
        count: confidenceValues.length,
        min: Number(Math.min(...confidenceValues).toFixed(6)),
        max: Number(Math.max(...confidenceValues).toFixed(6)),
        mean: Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(6)),
        median: Number(median(confidenceValues).toFixed(6)),
      };

const summaryPayload = {
  generatedAt,
  source: {
    rctRoot: options.rctRoot,
    seedPath,
  },
  input: {
    parsedRows: rows.length,
    parseErrors,
  },
  coverage: {
    extractedRows,
    noExtractionRows,
    extractedPct: Number(((extractedRows / rows.length) * 100).toFixed(2)),
    withPmidRows,
    withPmcidRows,
    withLinkedMetaRows,
    withSourceTextRows,
    withEffectTypeRows,
  },
  distributions: {
    automationTierCounts: toSortedObject(automationTierCounts),
    effectTypeCounts: toSortedObject(effectTypeCounts),
    confidence: confidenceSummary,
  },
  identifiers: {
    trialPmidsCount: trialPmids.size,
    linkedMetaPmidsCount: linkedMetaPmids.size,
    expectedPublicationIdsCount: expectedPublicationIds.length,
    candidateTrialIdsFromTextCount: candidateTrialIdsFromText.size,
  },
  topLinkedMetaPmids,
  outputs: {
    packPath: outputPackPath,
    summaryPath: outputSummaryPath,
  },
};

fs.mkdirSync(path.dirname(outputPackPath), { recursive: true });
fs.mkdirSync(path.dirname(outputSummaryPath), { recursive: true });
fs.writeFileSync(outputPackPath, `${JSON.stringify(packPayload, null, 2)}\n`);
fs.writeFileSync(outputSummaryPath, `${JSON.stringify(summaryPayload, null, 2)}\n`);

console.log(`Wrote ${path.relative(root, outputPackPath)}`);
console.log(`Wrote ${path.relative(root, outputSummaryPath)}`);
console.log(
  `Imported ${rows.length} rows; extracted=${extractedRows}; expectedPublicationIds=${expectedPublicationIds.length}; candidateNCTs=${candidateTrialIdsFromText.size}`,
);
