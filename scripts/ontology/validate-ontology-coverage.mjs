import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { ENDPOINT_ONTOLOGY_V1, INTERVENTION_DICTIONARY_V1, mapEndpointTerm, mapInterventionTerm, normalizeText } from '../../src/ontology/index.js';

function parseArgs(argv) {
  const options = {
    minCoverage: 0.98,
    maxUnknownTerms: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--min-coverage') {
      const value = Number(argv[i + 1] ?? options.minCoverage);
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        options.minCoverage = value;
      }
      i += 1;
      continue;
    }
    if (arg === '--max-unknown-terms') {
      const value = Number(argv[i + 1] ?? options.maxUnknownTerms);
      if (Number.isFinite(value) && value >= 0) {
        options.maxUnknownTerms = Math.floor(value);
      }
      i += 1;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toPct(value) {
  return Number((value * 100).toFixed(2));
}

function addUnknown(map, termType, term, entity, packId) {
  const normalized = normalizeText(term);
  const key = `${termType}:${normalized}`;
  const current = map.get(key) ?? {
    termType,
    term: String(term),
    normalizedTerm: normalized,
    frequency: 0,
    packs: new Set(),
    entityIds: new Set(),
    suggestedAction: 'review_ontology_dictionary',
  };
  current.frequency += 1;
  current.packs.add(packId);
  current.entityIds.add(entity.entityId);
  map.set(key, current);
}

function makePackStats() {
  return {
    totalInterventionTerms: 0,
    mappedInterventionTerms: 0,
    totalEndpointTerms: 0,
    mappedEndpointTerms: 0,
  };
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const benchmarkPath = path.join(root, 'reports', 'benchmarks', 'packs', 'v1', 'ontology_entities.v1.json');
const outDir = path.join(root, 'reports', 'ontology');

if (!fs.existsSync(benchmarkPath)) {
  console.error(`Missing benchmark file: ${path.relative(root, benchmarkPath)}`);
  process.exit(1);
}

const benchmark = readJson(benchmarkPath);
const entities = Array.isArray(benchmark.entities) ? benchmark.entities : [];

if (entities.length === 0) {
  console.error('No ontology benchmark entities found.');
  process.exit(1);
}

let totalInterventionTerms = 0;
let mappedInterventionTerms = 0;
let totalEndpointTerms = 0;
let mappedEndpointTerms = 0;

const unknownMap = new Map();
const packStatsMap = new Map();
const entityResults = [];

for (const entity of entities) {
  const packId = String(entity.packId ?? 'unknown_pack');
  const interventionTerms = Array.isArray(entity.interventionTerms) ? entity.interventionTerms : [];
  const endpointTerms = Array.isArray(entity.endpointTerms) ? entity.endpointTerms : [];

  const packStats = packStatsMap.get(packId) ?? makePackStats();

  const matchedInterventions = new Set();
  const matchedEndpoints = new Set();

  for (const term of interventionTerms) {
    totalInterventionTerms += 1;
    packStats.totalInterventionTerms += 1;
    const matches = mapInterventionTerm(term);
    if (matches.length > 0) {
      mappedInterventionTerms += 1;
      packStats.mappedInterventionTerms += 1;
      for (const match of matches) {
        matchedInterventions.add(match.classId);
      }
    } else {
      addUnknown(unknownMap, 'intervention', term, entity, packId);
    }
  }

  for (const term of endpointTerms) {
    totalEndpointTerms += 1;
    packStats.totalEndpointTerms += 1;
    const matches = mapEndpointTerm(term);
    if (matches.length > 0) {
      mappedEndpointTerms += 1;
      packStats.mappedEndpointTerms += 1;
      for (const match of matches) {
        matchedEndpoints.add(match.endpointId);
      }
    } else {
      addUnknown(unknownMap, 'endpoint', term, entity, packId);
    }
  }

  packStatsMap.set(packId, packStats);
  entityResults.push({
    entityId: entity.entityId,
    packId,
    interventionTerms: interventionTerms.length,
    endpointTerms: endpointTerms.length,
    mappedInterventionClassIds: [...matchedInterventions].sort(),
    mappedEndpointIds: [...matchedEndpoints].sort(),
  });
}

const totalTerms = totalInterventionTerms + totalEndpointTerms;
const mappedTerms = mappedInterventionTerms + mappedEndpointTerms;
const coverage = totalTerms > 0 ? mappedTerms / totalTerms : 0;

const packSummaries = [...packStatsMap.entries()].map(([packId, stats]) => {
  const totalPackTerms = stats.totalInterventionTerms + stats.totalEndpointTerms;
  const mappedPackTerms = stats.mappedInterventionTerms + stats.mappedEndpointTerms;
  const packCoverage = totalPackTerms > 0 ? mappedPackTerms / totalPackTerms : 0;
  return {
    packId,
    totalInterventionTerms: stats.totalInterventionTerms,
    mappedInterventionTerms: stats.mappedInterventionTerms,
    interventionCoverage: toPct(stats.totalInterventionTerms > 0 ? stats.mappedInterventionTerms / stats.totalInterventionTerms : 0),
    totalEndpointTerms: stats.totalEndpointTerms,
    mappedEndpointTerms: stats.mappedEndpointTerms,
    endpointCoverage: toPct(stats.totalEndpointTerms > 0 ? stats.mappedEndpointTerms / stats.totalEndpointTerms : 0),
    totalTerms: totalPackTerms,
    mappedTerms: mappedPackTerms,
    coverage: toPct(packCoverage),
  };
});

packSummaries.sort((a, b) => a.packId.localeCompare(b.packId));

const unknownQueue = [...unknownMap.values()]
  .map((entry) => ({
    termType: entry.termType,
    term: entry.term,
    normalizedTerm: entry.normalizedTerm,
    frequency: entry.frequency,
    packIds: [...entry.packs].sort(),
    entityIds: [...entry.entityIds].sort(),
    suggestedAction: entry.suggestedAction,
  }))
  .sort((a, b) => b.frequency - a.frequency || a.termType.localeCompare(b.termType) || a.normalizedTerm.localeCompare(b.normalizedTerm));

const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  benchmark: {
    file: path.relative(root, benchmarkPath),
    schemaVersion: benchmark.schemaVersion ?? null,
    entityCount: entities.length,
  },
  ontology: {
    interventionSchemaVersion: INTERVENTION_DICTIONARY_V1.schemaVersion,
    interventionClassCount: Array.isArray(INTERVENTION_DICTIONARY_V1.classes) ? INTERVENTION_DICTIONARY_V1.classes.length : 0,
    endpointSchemaVersion: ENDPOINT_ONTOLOGY_V1.schemaVersion,
    endpointCount: Array.isArray(ENDPOINT_ONTOLOGY_V1.endpoints) ? ENDPOINT_ONTOLOGY_V1.endpoints.length : 0,
  },
  thresholds: {
    minCoverage: options.minCoverage,
    maxUnknownTerms: options.maxUnknownTerms,
  },
  summary: {
    totalInterventionTerms,
    mappedInterventionTerms,
    interventionCoverage: toPct(totalInterventionTerms > 0 ? mappedInterventionTerms / totalInterventionTerms : 0),
    totalEndpointTerms,
    mappedEndpointTerms,
    endpointCoverage: toPct(totalEndpointTerms > 0 ? mappedEndpointTerms / totalEndpointTerms : 0),
    totalTerms,
    mappedTerms,
    coverage: toPct(coverage),
    unknownTermCount: unknownQueue.length,
    passed: coverage >= options.minCoverage && unknownQueue.length <= options.maxUnknownTerms,
  },
  perPack: packSummaries,
  entities: entityResults,
  unknownTermQueue: unknownQueue,
};

fs.mkdirSync(outDir, { recursive: true });
const stamp = generatedAt.replace(/[:.]/g, '-');
const reportStamp = path.join(outDir, `coverage-${stamp}.json`);
const reportLatest = path.join(outDir, 'coverage-latest.json');
const unknownStamp = path.join(outDir, `unknown-term-queue-${stamp}.json`);
const unknownLatest = path.join(outDir, 'unknown-term-queue-latest.json');
const unknownCsv = path.join(outDir, 'unknown-term-queue.csv');

fs.writeFileSync(reportStamp, JSON.stringify(report, null, 2));
fs.writeFileSync(reportLatest, JSON.stringify(report, null, 2));
fs.writeFileSync(unknownStamp, JSON.stringify({ generatedAt, items: unknownQueue }, null, 2));
fs.writeFileSync(unknownLatest, JSON.stringify({ generatedAt, items: unknownQueue }, null, 2));

const csvHeader = ['term_type', 'term', 'normalized_term', 'frequency', 'pack_ids', 'entity_ids', 'suggested_action'];
const csvLines = [csvHeader.join(',')];
for (const row of unknownQueue) {
  csvLines.push(
    [
      row.termType,
      row.term,
      row.normalizedTerm,
      row.frequency,
      row.packIds.join('|'),
      row.entityIds.join('|'),
      row.suggestedAction,
    ]
      .map(csvEscape)
      .join(','),
  );
}
fs.writeFileSync(unknownCsv, `${csvLines.join('\n')}\n`);

console.log(`Ontology coverage: ${toPct(coverage)}% (${mappedTerms}/${totalTerms})`);
console.log(`Unknown queue terms: ${unknownQueue.length}`);
console.log(`Wrote ${path.relative(root, reportStamp)}`);
console.log(`Wrote ${path.relative(root, reportLatest)}`);
console.log(`Wrote ${path.relative(root, unknownStamp)}`);
console.log(`Wrote ${path.relative(root, unknownLatest)}`);
console.log(`Wrote ${path.relative(root, unknownCsv)}`);

if (coverage < options.minCoverage) {
  console.error(`Coverage gate failed: ${toPct(coverage)}% < ${toPct(options.minCoverage)}%`);
  process.exit(1);
}

if (unknownQueue.length > options.maxUnknownTerms) {
  console.error(`Unknown-term gate failed: ${unknownQueue.length} > ${options.maxUnknownTerms}`);
  process.exit(1);
}
