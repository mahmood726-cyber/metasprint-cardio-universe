import { listConnectors } from '../../data/connectors/index.js';
import { attachActionDelegates } from '../../core/delegates.js';

const ALLOWED_VIEWS = new Set(['ayat', 'network', 'treemap', 'timeline', 'matrix', 'gapscatter', 'pipeline']);
const ALLOWED_SORTS = new Set(['gap', 'recent', 'count']);
const ALLOWED_SOURCES = new Set(['sample', ...listConnectors()]);
const ALLOWED_FACTORS = new Set([
  'clinicalImpact', 'uncertaintyReduction', 'feasibility', 'freshness', 'provenanceConfidence',
]);

export function attachDiscoveryHandlers(root, actions) {
  const detach = attachActionDelegates(root, {
    'load-universe': () => actions.loadUniverse(),
    'refresh-universe': () => actions.refreshUniverse(),
    'switch-view': (trigger) => {
      const view = trigger.dataset.view;
      if (!ALLOWED_VIEWS.has(view)) return;
      actions.switchView(view);
    },
    'sort-opportunities': (trigger) => {
      const sort = trigger.dataset.sort;
      if (!ALLOWED_SORTS.has(sort)) return;
      actions.sortOpportunities(sort);
    },
    'set-data-source': async (trigger) => {
      const source = trigger.dataset.source;
      if (!ALLOWED_SOURCES.has(source)) return;
      const changed = actions.setDataSource(source);
      if (!changed) return;
      await actions.loadUniverse();
    },
    'toggle-weights': () => actions.toggleSensitivityPanel(),
    'reset-weights': () => actions.resetRankingWeights(),
  });

  const onWeightInput = (event) => {
    const input = event.target;
    if (!input || input.type !== 'range' || !input.dataset.factor) return;
    const factorId = input.dataset.factor;
    if (!ALLOWED_FACTORS.has(factorId)) return;
    actions.setRankingWeight(factorId, Number(input.value));
  };

  root.addEventListener('input', onWeightInput);

  return () => {
    if (typeof detach === 'function') detach();
    root.removeEventListener('input', onWeightInput);
  };
}
