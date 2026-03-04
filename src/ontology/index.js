import { ENDPOINT_ONTOLOGY_V1 } from './endpoint-ontology.js';
import { INTERVENTION_DICTIONARY_V1 } from './intervention-dictionary.js';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function toPattern(term) {
  const normalized = normalizeText(term);
  if (!normalized) return null;
  const body = normalized
    .split(' ')
    .map((part) => escapeRegExp(part))
    .join('\\s+');
  return new RegExp(`(^|\\s)${body}(?=\\s|$)`, 'i');
}

function compileInterventionPatterns(dictionary) {
  const rows = [];
  for (const entry of dictionary.classes ?? []) {
    const aliases = [...new Set([entry.canonicalName, ...(entry.aliases ?? [])].map((s) => normalizeText(s)).filter(Boolean))];
    aliases.sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const pattern = toPattern(alias);
      if (!pattern) continue;
      rows.push({
        classId: entry.classId,
        canonicalName: entry.canonicalName,
        alias,
        pattern,
      });
    }
  }
  return rows;
}

function compileEndpointPatterns(ontology) {
  const rows = [];
  for (const entry of ontology.endpoints ?? []) {
    const aliases = [...new Set([entry.canonicalName, ...(entry.aliases ?? [])].map((s) => normalizeText(s)).filter(Boolean))];
    aliases.sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const pattern = toPattern(alias);
      if (!pattern) continue;
      rows.push({
        endpointId: entry.endpointId,
        canonicalName: entry.canonicalName,
        domain: entry.domain,
        alias,
        pattern,
      });
    }
  }
  return rows;
}

const INTERVENTION_PATTERNS = compileInterventionPatterns(INTERVENTION_DICTIONARY_V1);
const ENDPOINT_PATTERNS = compileEndpointPatterns(ENDPOINT_ONTOLOGY_V1);

function dedupeById(items, idField) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const id = item[idField];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

export function mapInterventionTerm(term, dictionary = INTERVENTION_DICTIONARY_V1) {
  const normalized = normalizeText(term);
  if (!normalized) return [];

  const patterns = dictionary === INTERVENTION_DICTIONARY_V1 ? INTERVENTION_PATTERNS : compileInterventionPatterns(dictionary);
  const hits = [];
  for (const row of patterns) {
    if (!row.pattern.test(normalized)) continue;
    hits.push({
      classId: row.classId,
      canonicalName: row.canonicalName,
      matchedAlias: row.alias,
    });
  }
  return dedupeById(hits, 'classId');
}

export function mapEndpointTerm(term, ontology = ENDPOINT_ONTOLOGY_V1) {
  const normalized = normalizeText(term);
  if (!normalized) return [];

  const patterns = ontology === ENDPOINT_ONTOLOGY_V1 ? ENDPOINT_PATTERNS : compileEndpointPatterns(ontology);
  const hits = [];
  for (const row of patterns) {
    if (!row.pattern.test(normalized)) continue;
    hits.push({
      endpointId: row.endpointId,
      canonicalName: row.canonicalName,
      domain: row.domain,
      matchedAlias: row.alias,
    });
  }
  return dedupeById(hits, 'endpointId');
}

export function mapOntologyFromText(text) {
  const interventions = mapInterventionTerm(text);
  const endpoints = mapEndpointTerm(text);
  return {
    interventions,
    endpoints,
    interventionClassIds: interventions.map((m) => m.classId),
    endpointIds: endpoints.map((m) => m.endpointId),
  };
}

export function enrichTrialWithOntologySignals(trial) {
  const textParts = [trial?.title, ...(Array.isArray(trial?.conditions) ? trial.conditions : []), ...(Array.isArray(trial?.identityKeys) ? trial.identityKeys : [])]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
  const mergedText = textParts.join(' ');
  const mapped = mapOntologyFromText(mergedText);

  return {
    ...trial,
    interventionClassIds: mapped.interventionClassIds,
    endpointIds: mapped.endpointIds,
  };
}

export { ENDPOINT_ONTOLOGY_V1, INTERVENTION_DICTIONARY_V1 };
