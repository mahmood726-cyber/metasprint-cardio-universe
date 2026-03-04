import test from 'node:test';
import assert from 'node:assert/strict';

import { ctgovConnector } from '../src/data/connectors/ctgov.js';
import { pubmedConnector } from '../src/data/connectors/pubmed.js';
import { aactConnector } from '../src/data/connectors/aact.js';
import { normalizeConnectorError } from '../src/data/connectors/base.js';
import { loadUniverseFromConnectorWithMeta } from '../src/data/repository/universe-repository.js';
import { scoreIdentityPair } from '../src/engine/identity/similarity.js';
import { buildOverrideMap } from '../src/engine/identity/overrides.js';
import { buildProvenanceLedger } from '../src/engine/provenance/index.js';
import { createStore } from '../src/core/store.js';
import { createDiscoveryActions } from '../src/discovery/actions.js';
import { INITIAL_DISCOVERY_STATE } from '../src/discovery/state.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('trialId is source-scoped for explicit IDs', async (t) => {
  const originalCtgov = ctgovConnector.fetchTrials;
  const originalPubmed = pubmedConnector.fetchTrials;

  ctgovConnector.fetchTrials = async () => ({
    rows: [{ id: 'SAME-EXPLICIT-ID', title: 'HF trial', startDate: '2024-01-01' }],
    meta: {},
  });
  pubmedConnector.fetchTrials = async () => ({
    rows: [{ id: 'SAME-EXPLICIT-ID', title: 'HF trial', startDate: '2024-01-01' }],
    meta: {},
  });

  t.after(() => {
    ctgovConnector.fetchTrials = originalCtgov;
    pubmedConnector.fetchTrials = originalPubmed;
  });

  const ctgov = await loadUniverseFromConnectorWithMeta('ctgov', { query: {} });
  const pubmed = await loadUniverseFromConnectorWithMeta('pubmed', { query: {} });

  assert.equal(ctgov.records.length, 1);
  assert.equal(pubmed.records.length, 1);
  assert.notEqual(ctgov.records[0].trialId, pubmed.records[0].trialId);
  assert.match(ctgov.records[0].trialId, /^trial_ctgov_/);
  assert.match(pubmed.records[0].trialId, /^trial_pubmed_/);
});

test('connector ingestion rejects non-object rows and reports rejection telemetry', async (t) => {
  const originalCtgov = ctgovConnector.fetchTrials;
  ctgovConnector.fetchTrials = async () => ({
    rows: [null, 42, 'bad row', { id: 'NCT00000001', title: 'HF trial', startDate: '2024-01-01' }],
    meta: { statusCode: 200 },
  });
  t.after(() => {
    ctgovConnector.fetchTrials = originalCtgov;
  });

  const result = await loadUniverseFromConnectorWithMeta('ctgov', { query: {} });
  assert.equal(result.records.length, 1);
  assert.equal(result.meta.inputRowCount, 4);
  assert.equal(result.meta.acceptedRowCount, 1);
  assert.equal(result.meta.rejectedRowCount, 3);
  assert.equal(Array.isArray(result.meta.rejectedRows), true);
  assert.equal(result.meta.rejectedRows.length, 3);
  assert.match(result.meta.rejectedRows[0].reason, /not an object/);
});

test('connector ingestion sanitizes oversized text and enrollment ranges', async (t) => {
  const originalCtgov = ctgovConnector.fetchTrials;
  ctgovConnector.fetchTrials = async () => ({
    rows: [
      {
        id: 'X'.repeat(600),
        title: 'A'.repeat(2000),
        startDate: '2024-01-01',
        enrollment: -99,
        sourceType: 'unexpected_custom_type',
      },
      {
        id: 'NCT00000002',
        title: 'Very large enrollment trial',
        startDate: '2023-01-01',
        enrollment: 999999999,
        sourceType: 'publication',
      },
    ],
    meta: {},
  });
  t.after(() => {
    ctgovConnector.fetchTrials = originalCtgov;
  });

  const result = await loadUniverseFromConnectorWithMeta('ctgov', { query: {} });
  assert.equal(result.records.length, 2);
  assert.equal(result.meta.rejectedRowCount, 0);

  const [first, second] = result.records;
  assert.equal(first.title.length, 1500);
  assert.equal(first.sourceRecordId.length, 256);
  assert.equal(first.enrollment, 0);
  assert.equal(first.sourceType, 'trial');
  assert.ok(Array.isArray(first.identityKeys));
  assert.ok(first.identityKeys.length >= 1 && first.identityKeys.length <= 8);

  assert.equal(second.sourceType, 'publication');
  assert.equal(second.enrollment, 10000000);
});

test('runtime schema mode warn reports schema issues but keeps records', async (t) => {
  const originalCtgov = ctgovConnector.fetchTrials;
  ctgovConnector.fetchTrials = async () => ({
    rows: [{ id: 'row_bad_doi', title: 'HF trial', startDate: '2024-01-01', doi: 'bad doi' }],
    meta: {},
  });
  t.after(() => {
    ctgovConnector.fetchTrials = originalCtgov;
  });

  const result = await loadUniverseFromConnectorWithMeta('ctgov', {
    query: {},
    validationPolicy: { normalizedTrialSchemaMode: 'warn' },
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.meta.runtimeSchema.mode, 'warn');
  assert.equal(result.meta.runtimeSchema.validator, 'ajv');
  assert.equal(result.meta.runtimeSchema.warningCount, 1);
  assert.equal(result.meta.runtimeSchema.rejectedCount, 0);
  assert.equal(Array.isArray(result.meta.runtimeSchema.issues), true);
  assert.equal(result.meta.runtimeSchema.issues.length, 1);
  assert.match(result.meta.runtimeSchema.issues[0].reason, /schema validation/);
});

test('runtime schema mode enforce rejects schema-invalid rows', async (t) => {
  const originalCtgov = ctgovConnector.fetchTrials;
  ctgovConnector.fetchTrials = async () => ({
    rows: [
      { id: 'row_bad_doi', title: 'HF invalid doi', startDate: '2024-01-01', doi: 'bad doi' },
      { id: 'row_ok', title: 'HF valid doi', startDate: '2024-01-01', doi: '10.1000/test.123' },
    ],
    meta: {},
  });
  t.after(() => {
    ctgovConnector.fetchTrials = originalCtgov;
  });

  const result = await loadUniverseFromConnectorWithMeta('ctgov', {
    query: {},
    validationPolicy: { normalizedTrialSchemaMode: 'enforce' },
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sourceRecordId, 'row_ok');
  assert.equal(result.meta.runtimeSchema.mode, 'enforce');
  assert.equal(result.meta.runtimeSchema.validator, 'ajv');
  assert.equal(result.meta.runtimeSchema.rejectedCount, 1);
  assert.equal(result.meta.rejectedRowCount, 1);
  assert.match(result.meta.rejectedRows[0].reason, /schema validation/);
});

test('empty title token sets do not get perfect similarity boost', () => {
  const pair = scoreIdentityPair(
    {
      title: '---',
      year: 2024,
      enrollment: 0,
      subcategoryId: 'hf',
      source: 'ctgov',
      nctId: null,
      doi: null,
      pmid: null,
    },
    {
      title: '###',
      year: 2024,
      enrollment: 0,
      subcategoryId: 'hf',
      source: 'pubmed',
      nctId: null,
      doi: null,
      pmid: null,
    },
  );

  assert.equal(pair.duplicate, false);
  assert.ok(!pair.reasons.some((reason) => reason.startsWith('title_similarity')));
});

test('conflicting force merge/split overrides fail fast', () => {
  assert.throws(
    () =>
      buildOverrideMap({
        forceMerge: [{ leftTrialId: 'trial_a', rightTrialId: 'trial_b' }],
        forceSplit: [{ leftTrialId: 'trial_a', rightTrialId: 'trial_b' }],
      }),
    /Conflicting override rules/,
  );
});

test('provenance ledger preserves duplicate trialId members and penalizes placeholder titles', () => {
  const records = [
    {
      trialId: 'trial_same',
      source: 'ctgov',
      sourceType: 'trial',
      sourceRecordId: 'NCT00000001',
      nctId: 'NCT00000001',
      title: 'Untitled trial',
      year: 2021,
      subcategoryId: 'hf',
    },
    {
      trialId: 'trial_same',
      source: 'pubmed',
      sourceType: 'publication',
      sourceRecordId: '12345678',
      pmid: '12345678',
      title: 'Valid publication title',
      year: 2021,
      subcategoryId: 'hf',
    },
  ];

  const identityGraph = {
    clusters: [
      {
        clusterId: 'cluster_0001',
        canonicalTrialId: 'trial_same',
        memberCount: 2,
        members: ['trial_same', 'trial_same'],
        maxEdgeScore: 0.95,
        reasons: ['exact_pmid'],
      },
    ],
  };

  const ledger = buildProvenanceLedger(records, identityGraph);
  const cluster = ledger.clusters[0];
  assert.equal(cluster.members.length, 2);
  assert.equal(cluster.sourceCount, 2);
  const untitledMember = cluster.members.find((member) => member.source === 'ctgov');
  assert.ok(untitledMember);
  assert.ok(untitledMember.completeness < 1);
});

test('connector error URLs are redacted', () => {
  const normalized = normalizeConnectorError('openalex', new Error('boom'), {
    attemptNumber: 1,
    url: 'https://api.openalex.org/works?api_key=SECRET123&search=heart',
  });
  assert.ok(normalized.url.includes('REDACTED'));
  assert.ok(!normalized.url.includes('SECRET123'));
});

test('aact connector rejects non-allowlisted proxy hosts', async () => {
  await assert.rejects(
    () =>
      aactConnector.fetchTrials({
        query: { proxyBase: 'https://evil.example' },
        limit: 1,
        offset: 0,
      }),
    /proxy host not allowed/,
  );
});

test('sample refresh does not emit stale refresh success after source change', async () => {
  const store = createStore(INITIAL_DISCOVERY_STATE);
  store.patchState({ universeLoaded: true, dataSource: 'sample' }, 'test:seed');

  const actionsSeen = [];
  store.subscribe((_state, action) => {
    actionsSeen.push(action);
  });

  const actions = createDiscoveryActions(store, {
    refreshDelayMs: 40,
    loadingDelayMs: 0,
    loadTrialsForSource: async (source) => {
      if (source === 'sample') return [];
      await sleep(5);
      return [
        {
          trialId: `trial_${source}_1`,
          source,
          sourceType: 'trial',
          title: `${source} trial`,
          year: 2024,
          enrollment: 100,
          subcategoryId: 'hf',
        },
      ];
    },
  });

  const refreshPromise = actions.refreshUniverse();
  assert.equal(actions.setDataSource('ctgov'), true);
  const loadPromise = actions.loadUniverse();

  await Promise.all([refreshPromise, loadPromise]);

  assert.equal(store.getState().dataSource, 'ctgov');
  assert.ok(!actionsSeen.includes('refresh:success'));
});
