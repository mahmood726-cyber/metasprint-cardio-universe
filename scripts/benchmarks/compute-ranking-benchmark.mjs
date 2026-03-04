import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = {
    topK: 20,
    relevantThreshold: 2,
    fixturePath: 'reports/benchmarks/packs/v1/ranking_judgments.v1.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--top-k') {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) options.topK = Math.floor(v);
      i += 1;
    } else if (arg === '--relevant-threshold') {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v >= 0) options.relevantThreshold = v;
      i += 1;
    } else if (arg === '--fixture') {
      const v = String(argv[i + 1] ?? '').trim();
      if (v) options.fixturePath = v;
      i += 1;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function toFixedNumber(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function relevanceAt(entry) {
  const n = Number(entry?.blindedRelevance ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dcg(entries, k) {
  let sum = 0;
  for (let i = 0; i < Math.min(k, entries.length); i++) {
    const rel = relevanceAt(entries[i]);
    const gain = 2 ** rel - 1;
    const discount = Math.log2(i + 2);
    sum += gain / discount;
  }
  return sum;
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const fixturePath = path.isAbsolute(options.fixturePath) ? options.fixturePath : path.join(root, options.fixturePath);
const outDir = path.join(root, 'reports', 'benchmarks');

if (!fs.existsSync(fixturePath)) {
  console.error(`Missing ranking fixture: ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

const fixture = readJson(fixturePath);
const opportunities = Array.isArray(fixture.opportunities) ? fixture.opportunities : [];
if (opportunities.length === 0) {
  console.error('Ranking fixture has no opportunities.');
  process.exit(1);
}

const ranked = [...opportunities]
  .map((row) => ({
    opportunityId: String(row.opportunityId),
    title: String(row.title ?? ''),
    subcategoryId: String(row.subcategoryId ?? 'general'),
    predictedScore: Number(row.predictedScore ?? 0),
    blindedRelevance: relevanceAt(row),
  }))
  .sort((a, b) => b.predictedScore - a.predictedScore || b.blindedRelevance - a.blindedRelevance || a.opportunityId.localeCompare(b.opportunityId));

const ideal = [...ranked].sort((a, b) => b.blindedRelevance - a.blindedRelevance || b.predictedScore - a.predictedScore);
const topK = Math.min(options.topK, ranked.length);
const topKRows = ranked.slice(0, topK);
const relevantAtK = topKRows.filter((row) => row.blindedRelevance >= options.relevantThreshold).length;
const precisionAtK = topK > 0 ? relevantAtK / topK : 0;

const dcgAtK = dcg(ranked, topK);
const idcgAtK = dcg(ideal, topK);
const ndcgAtK = idcgAtK > 0 ? dcgAtK / idcgAtK : 0;

const generatedAt = new Date().toISOString();
const rankingPayload = {
  generatedAt,
  sourceFixture: path.relative(root, fixturePath),
  proxy: false,
  judgedOpportunityCount: ranked.length,
  topK,
  relevantThreshold: options.relevantThreshold,
  relevantInTopK: relevantAtK,
  opportunityPrecisionAt20: toFixedNumber(precisionAtK),
  ndcgAt20: toFixedNumber(ndcgAtK),
  note: 'Non-proxy ranking metrics computed from blinded relevance judgments fixture.',
};

const detailPayload = {
  generatedAt,
  fixture: {
    schemaVersion: fixture.schemaVersion ?? null,
    file: path.relative(root, fixturePath),
    description: fixture.description ?? null,
  },
  metrics: {
    topK,
    relevantThreshold: options.relevantThreshold,
    relevantInTopK: relevantAtK,
    precisionAtK: toFixedNumber(precisionAtK),
    dcgAtK: toFixedNumber(dcgAtK, 6),
    idcgAtK: toFixedNumber(idcgAtK, 6),
    ndcgAtK: toFixedNumber(ndcgAtK),
  },
  rankedTopK: topKRows,
  rankedAll: ranked,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'ranking.json'), JSON.stringify(rankingPayload, null, 2));
fs.writeFileSync(path.join(outDir, 'ranking-eval-latest.json'), JSON.stringify(detailPayload, null, 2));

console.log(`Wrote reports/benchmarks/ranking.json`);
console.log(`Wrote reports/benchmarks/ranking-eval-latest.json`);
console.log(`Ranking benchmark: precision@${topK}=${toFixedNumber(precisionAtK)}, ndcg@${topK}=${toFixedNumber(ndcgAtK)}`);
