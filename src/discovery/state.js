export const INITIAL_DISCOVERY_STATE = {
  universeLoaded: false,
  loading: false,
  lastRefreshIso: null,
  currentView: 'ayat',
  sortMode: 'gap',
  dataSource: 'sample',
  lastError: null,
  trials: [],
  opportunities: [],
  dedupSummary: {
    duplicateClusterCount: 0,
    edgeCount: 0,
    multiSourceClusterCount: 0,
  },
  kpis: {
    totalTrials: 0,
    subcategories: 0,
    recentTrials3y: 0,
    highPriorityClusters: 0,
  },
  methodologyGate: {
    label: 'Pending',
    detail: 'Run at least one loaded cycle before evaluation.',
    status: 'moderate',
  },
};
