import { listConnectors } from '../data/connectors/index.js';
import { loadUniverseFromConnector } from '../data/repository/universe-repository.js';
import { buildIdentityGraph } from '../engine/identity/index.js';
import { ENDPOINT_ONTOLOGY_V1, INTERVENTION_DICTIONARY_V1, mapOntologyFromText } from '../ontology/index.js';
import { SAMPLE_TRIALS, SAMPLE_OPPORTUNITIES } from './data/sample-data.js';
import { buildAndScoreOpportunities, normalizeWeights, DEFAULT_WEIGHTS } from '../engine/ranking/index.js';

const CONNECTOR_IDS = listConnectors();
const ALLOWED_SOURCES = new Set(['sample', ...CONNECTOR_IDS]);

const SUBCATEGORY_LABELS = {
  hf: 'Heart Failure',
  af: 'Atrial Fibrillation',
  htn: 'Hypertension',
  acs: 'Acute Coronary Syndromes',
  valve: 'Valve Disease',
  pad: 'Peripheral Arterial Disease',
  lipids: 'Lipid Management',
  rhythm: 'Rhythm and Devices',
  ph: 'Pulmonary Hypertension',
  general: 'General Cardiology',
};

const ENDPOINT_DOMAIN_LABELS = {
  mace: 'MACE',
  mortality: 'Mortality',
  hf: 'Heart Failure',
  renal: 'Renal',
  safety: 'Safety',
  frailty: 'Frailty',
  other: 'Other',
};

const DOMAIN_ORDER = ['mace', 'mortality', 'hf', 'renal', 'safety', 'frailty', 'other'];

const INTERVENTION_LABELS = new Map(
  INTERVENTION_DICTIONARY_V1.classes.map((entry) => [entry.classId, entry.canonicalName]),
);

const ENDPOINT_TO_DOMAIN = new Map(
  ENDPOINT_ONTOLOGY_V1.endpoints.map((entry) => [entry.endpointId, entry.domain ?? 'other']),
);

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function computeKpis(trials, opportunities) {
  const nowYear = new Date().getFullYear();
  const recentTrials3y = trials.filter((t) => t.year != null && t.year >= nowYear - 3).length;
  const subcategories = new Set(trials.map((t) => t.subcategoryId ?? 'general')).size;
  const highPriorityClusters = opportunities.filter((o) => o.priority === 'high').length;

  return {
    totalTrials: trials.length,
    subcategories,
    recentTrials3y,
    highPriorityClusters,
  };
}

function sortOpportunities(opportunities, mode) {
  const sorted = [...opportunities];
  const byScore = (item) => toFiniteNumber(item?.score, 0);
  const byRecent = (item) => toFiniteNumber(item?.recentTrials, 0);
  const byCount = (item) => toFiniteNumber(item?.trialCount, 0);
  if (mode === 'recent') {
    sorted.sort((a, b) => byRecent(b) - byRecent(a) || byScore(b) - byScore(a));
  } else if (mode === 'count') {
    sorted.sort((a, b) => byCount(b) - byCount(a) || byScore(b) - byScore(a));
  } else {
    sorted.sort((a, b) => byScore(b) - byScore(a));
  }
  return sorted;
}

function toPriority(score) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'moderate';
  return 'low';
}

function toLabel(subcategoryId) {
  return SUBCATEGORY_LABELS[subcategoryId] ?? SUBCATEGORY_LABELS.general;
}

function buildOpportunitiesFromTrials(trials) {
  if (!trials.length) return [];

  const bySubcategory = new Map();
  const nowYear = new Date().getFullYear();

  for (const trial of trials) {
    const id = trial.subcategoryId ?? 'general';
    const entry = bySubcategory.get(id) ?? {
      subcategoryId: id,
      trialCount: 0,
      recentTrials: 0,
      enrollmentSum: 0,
      maxYear: null,
    };

    entry.trialCount += 1;
    entry.enrollmentSum += toFiniteNumber(trial.enrollment, 0);
    if (trial.year != null && trial.year >= nowYear - 3) {
      entry.recentTrials += 1;
    }
    if (trial.year != null && (entry.maxYear == null || trial.year > entry.maxYear)) {
      entry.maxYear = trial.year;
    }

    bySubcategory.set(id, entry);
  }

  const opportunities = [];
  for (const entry of bySubcategory.values()) {
    const avgEnrollment =
      entry.trialCount > 0 ? toFiniteNumber(entry.enrollmentSum / entry.trialCount, 0) : 0;
    const evidencePenalty = Math.min(entry.trialCount * 8, 40);
    const recencyPenalty = Math.min(entry.recentTrials * 12, 36);
    const scalePenalty = Math.min(avgEnrollment / 350, 20);
    const rawScore = 100 - evidencePenalty - recencyPenalty - scalePenalty;
    const score = Math.max(20, Math.round(toFiniteNumber(rawScore, 20)));
    const priority = toPriority(score);
    const label = toLabel(entry.subcategoryId);

    opportunities.push({
      id: `opp_${entry.subcategoryId}`,
      title: `${label} evidence synthesis opportunity`,
      subcategoryId: entry.subcategoryId,
      score,
      priority,
      trialCount: entry.trialCount,
      recentTrials: entry.recentTrials,
      scoreBreakdown: {
        evidencePenalty: Math.round(evidencePenalty),
        recencyPenalty: Math.round(recencyPenalty),
        scalePenalty: Math.round(scalePenalty),
      },
      rationale:
        `${entry.trialCount} trials indexed, ${entry.recentTrials} in last 3 years` +
        (entry.maxYear ? `, latest ${entry.maxYear}.` : '.'),
    });
  }

  return opportunities;
}

function createConnectorRequest(source) {
  const sourceKey = String(source ?? '').toLowerCase();
  const limitBySource = {
    ctgov: 500,
    aact: 1000,
    pubmed: 150,
    openalex: 150,
    europepmc: 100,
  };
  return {
    domain: 'cardio',
    query: {
      condition: 'cardiovascular',
      term: 'heart',
      category: 'cardiovascular',
      mailto: 'metasprint-cardio@example.org',
    },
    limit: limitBySource[sourceKey] ?? 100,
    offset: 0,
  };
}

async function loadTrialsForSource(source, request = null) {
  if (source === 'sample') return SAMPLE_TRIALS;
  return loadUniverseFromConnector(source, request ?? createConnectorRequest(source));
}

function createGate(source, totalTrials, detail, status = 'high') {
  const sourceLabel = source === 'sample' ? 'Sample' : String(source).toUpperCase();
  return {
    label: status === 'high' ? 'Ingestion OK' : 'Fallback Loaded',
    detail: detail ?? `${sourceLabel} source loaded with ${totalTrials} normalized trials.`,
    status,
  };
}

function summarizeDedup(trials) {
  const graph = buildIdentityGraph(trials, { threshold: 0.9 });
  return {
    duplicateClusterCount: graph.duplicateClusterCount,
    edgeCount: graph.edgeCount,
    multiSourceClusterCount: graph.clusters.filter((cluster) => cluster.sources.length > 1).length,
  };
}

function collectMatrixSignals(trial) {
  const text = [trial?.title, ...(Array.isArray(trial?.conditions) ? trial.conditions : [])]
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean)
    .join(' ');

  const inferred = mapOntologyFromText(text);
  const interventionIds = uniqueStrings([
    ...asArray(trial?.interventionClassIds),
    ...asArray(inferred?.interventionClassIds),
  ]);
  const endpointIds = uniqueStrings([...asArray(trial?.endpointIds), ...asArray(inferred?.endpointIds)]);
  const domains = uniqueStrings(
    endpointIds.map((endpointId) => String(ENDPOINT_TO_DOMAIN.get(endpointId) ?? 'other')),
  );

  return {
    interventionIds: interventionIds.length > 0 ? interventionIds : ['unspecified_intervention'],
    domains: domains.length > 0 ? domains : ['other'],
    hasSignals: interventionIds.length > 0 || endpointIds.length > 0,
  };
}

function buildMatrixSummary(trials) {
  if (!Array.isArray(trials) || trials.length === 0) {
    return { rows: [], columns: [], totalTrials: 0, matchedTrials: 0 };
  }

  const rowCounts = new Map();
  const colCounts = new Map();
  const cellCounts = new Map();
  const matchedTrialIds = new Set();

  for (let index = 0; index < trials.length; index += 1) {
    const trial = trials[index];
    const trialKey = String(trial?.trialId ?? `trial_${index}`);
    const signals = collectMatrixSignals(trial);
    if (signals.hasSignals) matchedTrialIds.add(trialKey);

    for (const interventionId of signals.interventionIds) {
      if (!rowCounts.has(interventionId)) rowCounts.set(interventionId, new Set());
      rowCounts.get(interventionId).add(trialKey);
    }

    for (const domainId of signals.domains) {
      if (!colCounts.has(domainId)) colCounts.set(domainId, new Set());
      colCounts.get(domainId).add(trialKey);
    }

    for (const interventionId of signals.interventionIds) {
      for (const domainId of signals.domains) {
        const key = `${interventionId}__${domainId}`;
        if (!cellCounts.has(key)) cellCounts.set(key, new Set());
        cellCounts.get(key).add(trialKey);
      }
    }
  }

  const columns = [...colCounts.keys()]
    .sort((a, b) => {
      const aIdx = DOMAIN_ORDER.indexOf(a);
      const bIdx = DOMAIN_ORDER.indexOf(b);
      const left = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
      const right = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
      if (left !== right) return left - right;
      return a.localeCompare(b);
    })
    .map((columnId) => ({
      id: columnId,
      label: ENDPOINT_DOMAIN_LABELS[columnId] ?? columnId,
      trialCount: colCounts.get(columnId)?.size ?? 0,
      trialIds: [...(colCounts.get(columnId) ?? new Set())].sort(),
    }));

  const rows = [...rowCounts.keys()]
    .sort((a, b) => (rowCounts.get(b)?.size ?? 0) - (rowCounts.get(a)?.size ?? 0))
    .map((rowId) => ({
      id: rowId,
      label:
        rowId === 'unspecified_intervention'
          ? 'Unspecified intervention'
          : INTERVENTION_LABELS.get(rowId) ?? rowId,
      trialCount: rowCounts.get(rowId)?.size ?? 0,
      trialIds: [...(rowCounts.get(rowId) ?? new Set())].sort(),
      cells: columns.map((column) => ({
        id: column.id,
        count: cellCounts.get(`${rowId}__${column.id}`)?.size ?? 0,
        trialIds: [...(cellCounts.get(`${rowId}__${column.id}`) ?? new Set())].sort(),
      })),
    }));

  return {
    rows,
    columns,
    totalTrials: trials.length,
    matchedTrials: matchedTrialIds.size,
  };
}

export function createDiscoveryActions(store, deps = {}) {
  let latestLoadToken = 0;
  const nextRequestToken = () => {
    latestLoadToken += 1;
    return latestLoadToken;
  };
  const loadTrials = typeof deps.loadTrialsForSource === 'function' ? deps.loadTrialsForSource : loadTrialsForSource;
  const loadingDelayMs = Number.isFinite(Number(deps.loadingDelayMs))
    ? Math.max(0, Number(deps.loadingDelayMs))
    : 120;
  const refreshDelayMs = Number.isFinite(Number(deps.refreshDelayMs))
    ? Math.max(0, Number(deps.refreshDelayMs))
    : 100;

  const loadUniverse = async () => {
    const loadToken = nextRequestToken();
    const { dataSource } = store.getState();
    const request = createConnectorRequest(dataSource);
    store.patchState({ loading: true, lastError: null }, 'load:start');

    await new Promise((resolve) => setTimeout(resolve, loadingDelayMs));

    try {
      const loadedTrials = asArray(await loadTrials(dataSource, request));
      if (loadToken !== latestLoadToken) return;
      const trials = loadedTrials.length > 0 ? loadedTrials : SAMPLE_TRIALS;
      const usedFallbackTrials = loadedTrials.length === 0 && dataSource !== 'sample';
      const currentSortMode = store.getState().sortMode;

      const matrixSummary = buildMatrixSummary(trials);
      const currentWeights = store.getState().rankingWeights ?? DEFAULT_WEIGHTS;
      const globalContext = { usedFallback: usedFallbackTrials };
      const computedOpportunities = buildAndScoreOpportunities(trials, matrixSummary, currentWeights, globalContext);
      const opportunities = sortOpportunities(
        computedOpportunities.length > 0 ? computedOpportunities : SAMPLE_OPPORTUNITIES,
        currentSortMode,
      );
      const kpis = computeKpis(trials, opportunities);
      const dedupSummary = summarizeDedup(trials);

      const gate = usedFallbackTrials
        ? createGate(
            'sample',
            trials.length,
            `Connector ${dataSource.toUpperCase()} returned no rows; sample baseline loaded.`,
            'moderate',
          )
        : createGate(
            dataSource,
            trials.length,
            `${String(dataSource).toUpperCase()} source loaded with ${trials.length} normalized records; ${dedupSummary.duplicateClusterCount} duplicate clusters flagged.`,
          );

      store.patchState(
        {
          universeLoaded: true,
          loading: false,
          lastRefreshIso: new Date().toISOString(),
          provenance: {
            requestedSource: dataSource,
            loadedSource: usedFallbackTrials ? 'sample' : dataSource,
            requestedLimit: request.limit ?? null,
            loadedCount: trials.length,
            usedFallback: usedFallbackTrials,
            fallbackReason: usedFallbackTrials ? `No rows returned from ${String(dataSource).toUpperCase()}.` : null,
          },
          trials,
          opportunities,
          matrixSummary,
          dedupSummary,
          kpis,
          methodologyGate: gate,
        },
        'load:success',
      );
    } catch (error) {
      if (loadToken !== latestLoadToken) return;
      const message = error instanceof Error ? error.message : String(error);
      const fallbackTrials = SAMPLE_TRIALS;
      const fallbackWeights = store.getState().rankingWeights ?? DEFAULT_WEIGHTS;
      const fallbackGlobalCtx = { usedFallback: true };
      const fallbackMatrixSummary = buildMatrixSummary(fallbackTrials);
      const fallbackScoredOpportunities = buildAndScoreOpportunities(fallbackTrials, fallbackMatrixSummary, fallbackWeights, fallbackGlobalCtx);
      const fallbackOpportunities = sortOpportunities(
        fallbackScoredOpportunities.length > 0 ? fallbackScoredOpportunities : SAMPLE_OPPORTUNITIES,
        store.getState().sortMode,
      );
      const matrixSummary = fallbackMatrixSummary;
      const dedupSummary = summarizeDedup(fallbackTrials);

      store.patchState(
        {
          universeLoaded: true,
          loading: false,
          lastRefreshIso: new Date().toISOString(),
          lastError: `Connector ${dataSource.toUpperCase()} failed: ${message}`,
          provenance: {
            requestedSource: dataSource,
            loadedSource: 'sample',
            requestedLimit: request.limit ?? null,
            loadedCount: fallbackTrials.length,
            usedFallback: true,
            fallbackReason: `Connector ${String(dataSource).toUpperCase()} failed.`,
          },
          trials: fallbackTrials,
          opportunities: fallbackOpportunities,
          matrixSummary,
          dedupSummary,
          kpis: computeKpis(fallbackTrials, fallbackOpportunities),
          methodologyGate: createGate(
            'sample',
            fallbackTrials.length,
            `Connector ${dataSource.toUpperCase()} failed; sample baseline loaded.`,
            'moderate',
          ),
        },
        'load:fallback',
      );
    }
  };

  const refreshUniverse = async () => {
    if (!store.getState().universeLoaded) {
      await loadUniverse();
      return;
    }

    if (store.getState().dataSource === 'sample') {
      const refreshToken = nextRequestToken();
      store.patchState({ loading: true }, 'refresh:start');
      await new Promise((resolve) => setTimeout(resolve, refreshDelayMs));
      if (refreshToken !== latestLoadToken) return;
      if (store.getState().dataSource !== 'sample') return;
      store.patchState({ loading: false, lastRefreshIso: new Date().toISOString() }, 'refresh:success');
      return;
    }

    await loadUniverse();
  };

  return {
    async loadUniverse() {
      await loadUniverse();
    },

    async refreshUniverse() {
      await refreshUniverse();
    },

    switchView(view) {
      store.patchState({ currentView: view }, 'view:switch');
    },

    sortOpportunities(mode) {
      const sorted = sortOpportunities(store.getState().opportunities, mode);
      store.patchState({ sortMode: mode, opportunities: sorted }, 'opportunities:sort');
    },

    setDataSource(source) {
      if (!ALLOWED_SOURCES.has(source)) return false;
      if (store.getState().dataSource === source) return false;
      store.patchState({ dataSource: source }, 'source:set');
      return true;
    },

    setRankingWeight(factorId, rawValue) {
      const currentWeights = { ...store.getState().rankingWeights };
      currentWeights[factorId] = Math.max(0, Number(rawValue) || 0);
      const normalized = normalizeWeights(currentWeights);

      const { trials, matrixSummary, provenance, sortMode } = store.getState();
      const globalContext = { usedFallback: Boolean(provenance?.usedFallback) };
      const scored = buildAndScoreOpportunities(trials, matrixSummary, normalized, globalContext);
      const opportunities = sortOpportunities(scored, sortMode);

      store.patchState({ rankingWeights: normalized, opportunities }, 'weights:set');
    },

    resetRankingWeights() {
      const weights = { ...DEFAULT_WEIGHTS };
      const { trials, matrixSummary, provenance, sortMode } = store.getState();
      const globalContext = { usedFallback: Boolean(provenance?.usedFallback) };
      const scored = buildAndScoreOpportunities(trials, matrixSummary, weights, globalContext);
      const opportunities = sortOpportunities(scored, sortMode);

      store.patchState({ rankingWeights: weights, opportunities }, 'weights:reset');
    },

    toggleSensitivityPanel() {
      const open = !store.getState().rankingSensitivityOpen;
      store.patchState({ rankingSensitivityOpen: open }, 'sensitivity:toggle');
    },
  };
}
