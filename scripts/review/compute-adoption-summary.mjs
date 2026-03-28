import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { evaluateGate } from '../../src/review/gate-policy.js';

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
        row = [];
        current = '';
      }
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

function chooseReviewerDecision(counts) {
  const maxCount = Math.max(counts.switch_now, counts.switch_with_conditions, counts.not_yet);
  if (counts.not_yet === maxCount) return 'not_yet';
  if (counts.switch_with_conditions === maxCount) return 'switch_with_conditions';
  return 'switch_now';
}

const root = process.cwd();
const csvPath = process.argv[2] || path.join(root, 'docs', 'review', 'templates', 'cycle_scoring_template.csv');

if (!fs.existsSync(csvPath)) {
  console.error(`Input CSV not found: ${csvPath}`);
  process.exit(1);
}

const rawCsv = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const rows = parseCsv(rawCsv);
if (rows.length < 2) {
  console.error('CSV must include header and at least one row.');
  process.exit(1);
}

const data = toObjects(rows).filter((r) => r.decision);
if (data.length === 0) {
  console.error('No scored rows found (decision column empty).');
  process.exit(1);
}

const byReviewer = new Map();
for (const row of data) {
  if (!byReviewer.has(row.reviewer_id)) byReviewer.set(row.reviewer_id, []);
  byReviewer.get(row.reviewer_id).push(row);
}

const reviewerDecision = [];
for (const [reviewer, items] of byReviewer.entries()) {
  const counts = { switch_now: 0, switch_with_conditions: 0, not_yet: 0 };
  for (const item of items) {
    if (item.decision in counts) counts[item.decision] += 1;
  }
  const decision = chooseReviewerDecision(counts);

  reviewerDecision.push({ reviewer_id: reviewer, decision, counts });
}

const totalReviewers = reviewerDecision.length;
const switchNow = reviewerDecision.filter((r) => r.decision === 'switch_now').length;
const switchWithConditions = reviewerDecision.filter((r) => r.decision === 'switch_with_conditions').length;
const notYet = reviewerDecision.filter((r) => r.decision === 'not_yet').length;

const adoptionGate = evaluateGate({
  switchNow,
  responsesReceived: totalReviewers,
});

const cycleId = data[0].cycle_id || 'unspecified_cycle';

const summary = {
  cycleId,
  generatedAt: new Date().toISOString(),
  totalReviewers,
  switchNow,
  switchWithConditions,
  notYet,
  adoptionGate,
  reviewerDecision,
};

const outDir = path.join(root, 'reports', 'review-cycles');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${cycleId}-summary.json`);
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote summary: ${outPath}`);

if (!adoptionGate.passed) process.exitCode = 2;
