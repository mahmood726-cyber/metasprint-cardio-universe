import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../src/core/store.js';
import { createDiscoveryActions } from '../src/discovery/actions.js';
import { INITIAL_DISCOVERY_STATE } from '../src/discovery/state.js';

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeTrial({ trialId, source, title, subcategoryId, year, enrollment = 100 }) {
  return {
    trialId,
    source,
    sourceType: 'trial',
    nctId: null,
    pmid: null,
    doi: null,
    title,
    year,
    enrollment,
    subcategoryId,
  };
}

test('loadUniverse ignores stale in-flight response from older request', async () => {
  const resolvers = new Map();
  const loadTrialsForSource = (source) =>
    new Promise((resolve) => {
      resolvers.set(source, resolve);
    });

  const store = createStore(INITIAL_DISCOVERY_STATE);
  const actions = createDiscoveryActions(store, {
    loadTrialsForSource,
    loadingDelayMs: 0,
  });

  assert.equal(actions.setDataSource('ctgov'), true);
  const firstLoad = actions.loadUniverse();

  assert.equal(actions.setDataSource('pubmed'), true);
  const secondLoad = actions.loadUniverse();

  await nextTick();

  const pubmedResolve = resolvers.get('pubmed');
  const ctgovResolve = resolvers.get('ctgov');
  assert.equal(typeof pubmedResolve, 'function');
  assert.equal(typeof ctgovResolve, 'function');

  pubmedResolve([
    makeTrial({
      trialId: 'trial_pubmed_live',
      source: 'pubmed',
      title: 'PubMed live trial',
      subcategoryId: 'af',
      year: 2024,
    }),
  ]);

  ctgovResolve([
    makeTrial({
      trialId: 'trial_ctgov_old',
      source: 'ctgov',
      title: 'CTGov stale trial',
      subcategoryId: 'hf',
      year: 2020,
    }),
  ]);

  await Promise.all([firstLoad, secondLoad]);

  const state = store.getState();
  assert.equal(state.dataSource, 'pubmed');
  assert.equal(state.trials.length, 1);
  assert.equal(state.trials[0].trialId, 'trial_pubmed_live');
  assert.match(state.methodologyGate.detail, /PUBMED/i);
});

test('loadUniverse uses latest sortMode when request resolves', async () => {
  let resolveCtgov = null;
  const loadTrialsForSource = (source) =>
    new Promise((resolve) => {
      if (source === 'ctgov') {
        resolveCtgov = resolve;
        return;
      }
      resolve([]);
    });

  const store = createStore(INITIAL_DISCOVERY_STATE);
  const actions = createDiscoveryActions(store, {
    loadTrialsForSource,
    loadingDelayMs: 0,
  });

  assert.equal(actions.setDataSource('ctgov'), true);
  const loadPromise = actions.loadUniverse();
  actions.sortOpportunities('count');

  await nextTick();

  assert.equal(typeof resolveCtgov, 'function');
  resolveCtgov([
    makeTrial({ trialId: 'hf_1', source: 'ctgov', title: 'HF trial 1', subcategoryId: 'hf', year: 2017 }),
    makeTrial({ trialId: 'hf_2', source: 'ctgov', title: 'HF trial 2', subcategoryId: 'hf', year: 2018 }),
    makeTrial({ trialId: 'hf_3', source: 'ctgov', title: 'HF trial 3', subcategoryId: 'hf', year: 2019 }),
    makeTrial({ trialId: 'hf_4', source: 'ctgov', title: 'HF trial 4', subcategoryId: 'hf', year: 2020 }),
    makeTrial({ trialId: 'af_1', source: 'ctgov', title: 'AF trial 1', subcategoryId: 'af', year: 2021 }),
  ]);

  await loadPromise;

  const state = store.getState();
  assert.equal(state.sortMode, 'count');
  assert.equal(state.opportunities[0].subcategoryId, 'hf');
  assert.ok((state.opportunities[0].trialCount ?? 0) > (state.opportunities[1].trialCount ?? 0));
});

test('loadUniverse tolerates non-finite enrollment inputs and keeps finite scores', async () => {
  const store = createStore(INITIAL_DISCOVERY_STATE);
  const actions = createDiscoveryActions(store, {
    loadingDelayMs: 0,
    loadTrialsForSource: async () => [
      makeTrial({
        trialId: 'trial_bad_enrollment',
        source: 'ctgov',
        title: 'HF malformed enrollment',
        subcategoryId: 'hf',
        year: 2024,
        enrollment: 'not-a-number',
      }),
      makeTrial({
        trialId: 'trial_good_enrollment',
        source: 'ctgov',
        title: 'HF valid enrollment',
        subcategoryId: 'hf',
        year: 2023,
        enrollment: 250,
      }),
    ],
  });

  await actions.loadUniverse();
  const state = store.getState();

  assert.equal(state.universeLoaded, true);
  assert.equal(state.opportunities.length > 0, true);
  assert.ok(state.opportunities.every((item) => Number.isFinite(item.score)));
  assert.ok(state.opportunities.every((item) => Number.isFinite(item.trialCount)));
  assert.ok(state.opportunities.every((item) => Number.isFinite(item.recentTrials)));
});

test('sortOpportunities remains stable when metrics contain non-finite values', () => {
  const store = createStore({
    ...INITIAL_DISCOVERY_STATE,
    opportunities: [
      { id: 'opp_nan', score: Number.NaN, trialCount: 'bad', recentTrials: 'bad' },
      { id: 'opp_good', score: 85, trialCount: 6, recentTrials: 2 },
      { id: 'opp_missing', score: null, trialCount: null, recentTrials: undefined },
    ],
  });
  const actions = createDiscoveryActions(store);

  actions.sortOpportunities('count');
  const state = store.getState();

  assert.equal(state.sortMode, 'count');
  assert.equal(state.opportunities[0].id, 'opp_good');
});

test('loadUniverse records provenance and matrix summary metadata', async () => {
  const store = createStore(INITIAL_DISCOVERY_STATE);
  const actions = createDiscoveryActions(store, {
    loadingDelayMs: 0,
    loadTrialsForSource: async () => [
      {
        trialId: 'trial_1',
        source: 'ctgov',
        sourceType: 'trial',
        title: 'Empagliflozin trial with cardiovascular death endpoint',
        year: 2024,
        enrollment: 3200,
        subcategoryId: 'hf',
        interventionClassIds: ['sglt2_inhibitor'],
        endpointIds: ['cv_death'],
      },
      {
        trialId: 'trial_2',
        source: 'ctgov',
        sourceType: 'trial',
        title: 'Apixaban trial with stroke endpoint',
        year: 2023,
        enrollment: 1800,
        subcategoryId: 'af',
        interventionClassIds: ['doac'],
        endpointIds: ['stroke'],
      },
    ],
  });

  assert.equal(actions.setDataSource('ctgov'), true);
  await actions.loadUniverse();

  const state = store.getState();
  assert.equal(state.provenance.requestedSource, 'ctgov');
  assert.equal(state.provenance.loadedSource, 'ctgov');
  assert.equal(state.provenance.usedFallback, false);
  assert.equal(state.provenance.loadedCount, 2);
  assert.ok(Number.isFinite(Number(state.provenance.requestedLimit)));
  assert.equal(state.matrixSummary.totalTrials, 2);
  assert.ok(state.matrixSummary.rows.length > 0);
  assert.ok(state.matrixSummary.columns.length > 0);
});
