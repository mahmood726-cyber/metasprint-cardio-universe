import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { GATE_POLICY, evaluateGate } from '../../src/review/gate-policy.js';

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

function readCsvObjects(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(raw);
  return toObjects(rows);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tokenizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4);
}

function extractThemes(rows) {
  const stopWords = new Set([
    'with',
    'from',
    'that',
    'this',
    'more',
    'none',
    'minor',
    'ready',
    'into',
    'must',
    'have',
    'been',
    'than',
    'were',
    'will',
    'need',
    'show',
    'across',
    'using',
    'while',
    'there',
  ]);
  const frequency = new Map();

  for (const row of rows) {
    if (row.decision === 'switch_now') continue;
    const tokens = [...tokenizeText(row.required_improvement), ...tokenizeText(row.notes)];
    for (const token of tokens) {
      if (stopWords.has(token)) continue;
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token, count]) => ({ theme: token, count }));
}

function computeBlockers(rows) {
  let lowMethodValidity = 0;
  let lowTransparency = 0;
  let notYetRows = 0;

  for (const row of rows) {
    if (row.decision === 'not_yet') notYetRows += 1;
    if (toNumber(row.method_validity, 5) <= 2) lowMethodValidity += 1;
    if (toNumber(row.transparency_confidence, 5) <= 2) lowTransparency += 1;
  }

  const blockers = [];
  if (notYetRows > 0) blockers.push({ blocker: 'Not-yet decisions', count: notYetRows });
  if (lowMethodValidity > 0) blockers.push({ blocker: 'Method validity <=2', count: lowMethodValidity });
  if (lowTransparency > 0) blockers.push({ blocker: 'Transparency confidence <=2', count: lowTransparency });
  return blockers;
}

function averageScore(rows, field) {
  const values = rows.map((row) => toNumber(row[field], NaN)).filter((n) => Number.isFinite(n));
  if (!values.length) return null;
  const total = values.reduce((sum, n) => sum + n, 0);
  return Number((total / values.length).toFixed(2));
}

function loadBestScoreRows(scoreCandidates) {
  let fallback = null;

  for (const candidate of scoreCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const scoredRows = readCsvObjects(candidate).filter(
      (row) => String(row.decision ?? '').trim().length > 0,
    );
    if (scoredRows.length > 0) {
      return { scorePath: candidate, scoreRows: scoredRows };
    }
    if (fallback == null) {
      fallback = { scorePath: candidate, scoreRows: scoredRows };
    }
  }

  return fallback ?? { scorePath: null, scoreRows: [] };
}

function buildCycleEntry(summaryPath, scoresByCycleDir) {
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const cycleId = summary.cycleId;
  const cycleDir = path.join(scoresByCycleDir, cycleId);
  const scoreCandidates = [path.join(cycleDir, 'scores.csv'), path.join(cycleDir, 'scores_sample_filled.csv')];
  const { scorePath, scoreRows } = loadBestScoreRows(scoreCandidates);
  const themes = extractThemes(scoreRows);
  const blockers = computeBlockers(scoreRows);

  const gate = evaluateGate({
    switchNow: summary.switchNow,
    responsesReceived: summary.adoptionGate?.responsesReceived ?? summary.totalReviewers,
  });

  const gatePassed = summary.adoptionGate?.passed === true || gate.passed;

  return {
    cycleId,
    generatedAt: summary.generatedAt,
    totalReviewers: summary.totalReviewers,
    responsesReceived: gate.responsesReceived,
    switchNow: summary.switchNow,
    switchWithConditions: summary.switchWithConditions,
    notYet: summary.notYet,
    gatePassed,
    gateRequiredSwitchNow: gate.requiredSwitchNow,
    gateExpectedReviewers: gate.expectedReviewers,
    gateTarget: gate.target,
    insufficientResponses: gate.insufficientResponses,
    gapToTarget: toNumber(summary.adoptionGate?.gap, gate.gap),
    avgClinicalRelevance: averageScore(scoreRows, 'clinical_relevance'),
    avgMethodValidity: averageScore(scoreRows, 'method_validity'),
    avgNovelty: averageScore(scoreRows, 'novelty'),
    avgActionability: averageScore(scoreRows, 'actionability'),
    avgTransparencyConfidence: averageScore(scoreRows, 'transparency_confidence'),
    topDissentThemes: themes,
    criticalBlockers: blockers,
    scoreRowCount: scoreRows.length,
    sourceSummaryPath: path.relative(process.cwd(), summaryPath),
    sourceScoresPath: scorePath ? path.relative(process.cwd(), scorePath) : null,
  };
}

function compareCycleId(a, b) {
  const re = /^cycle_(\d+)$/i;
  const ma = re.exec(a);
  const mb = re.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  return a.localeCompare(b);
}

const root = process.cwd();
const reportsDir = path.join(root, 'reports', 'review-cycles');
const outFile = path.join(root, 'public', 'data', 'review-dashboard.json');

if (!fs.existsSync(reportsDir)) {
  console.error(`Missing reports directory: ${reportsDir}`);
  process.exit(1);
}

const summaryFiles = fs
  .readdirSync(reportsDir)
  .filter((name) => name.endsWith('-summary.json'))
  .map((name) => path.join(reportsDir, name));

if (summaryFiles.length === 0) {
  console.error('No *-summary.json files found in reports/review-cycles.');
  process.exit(1);
}

const cycles = summaryFiles
  .map((summaryPath) => buildCycleEntry(summaryPath, reportsDir))
  .sort((a, b) => compareCycleId(a.cycleId, b.cycleId));

const latest = cycles[cycles.length - 1];
const aggregate = {
  cyclesTracked: cycles.length,
  gatePassCount: cycles.filter((c) => c.gatePassed).length,
  latestCycleId: latest.cycleId,
  latestGatePassed: latest.gatePassed,
  latestSwitchNow: latest.switchNow,
  latestSwitchWithConditions: latest.switchWithConditions,
  latestNotYet: latest.notYet,
  latestResponsesReceived: latest.responsesReceived,
};

const dashboardPayload = {
  generatedAt: new Date().toISOString(),
  gatePolicy: {
    ...GATE_POLICY,
  },
  aggregate,
  cycles,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(dashboardPayload, null, 2));

console.log(`Wrote ${path.relative(root, outFile)}`);
console.log(`Cycles tracked: ${cycles.length}`);
