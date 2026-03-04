import { append, byId, clearNode, el, setText } from '../../core/dom.js';

function formatTime(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString();
}

function getViewLabel(view) {
  const labels = {
    ayat: 'Ayat Universe map (modular shell)',
    network: 'Network graph (modular shell)',
    treemap: 'Treemap (modular shell)',
    timeline: 'Timeline (modular shell)',
    matrix: 'Intervention x Outcome matrix (modular shell)',
    gapscatter: 'Gap scatter (modular shell)',
    pipeline: 'Phase pipeline (modular shell)',
  };
  return labels[view] ?? view;
}

function sourceLabel(source) {
  const labels = {
    sample: 'Sample',
    ctgov: 'ClinicalTrials.gov',
    aact: 'AACT',
    pubmed: 'PubMed',
    openalex: 'OpenAlex',
    europepmc: 'Europe PMC',
  };
  return labels[source] ?? source;
}

function renderSourceButtons(state) {
  const root = byId('controlBar');
  const buttons = root.querySelectorAll('[data-action="set-data-source"]');
  for (const button of buttons) {
    const active = button.dataset.source === state.dataSource;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function renderSortButtons(state) {
  const root = byId('controlBar');
  const buttons = root.querySelectorAll('[data-action="sort-opportunities"]');
  for (const button of buttons) {
    const active = button.dataset.sort === state.sortMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function renderKpis(state) {
  const host = byId('kpiGrid');
  clearNode(host);

  const items = [
    ['Total Trials', state.kpis.totalTrials],
    ['Subcategories', state.kpis.subcategories],
    ['Recent Trials (3y)', state.kpis.recentTrials3y],
    ['High Priority', state.kpis.highPriorityClusters],
  ];

  for (const [label, value] of items) {
    const card = el('div', { className: 'kpi' });
    append(
      card,
      el('div', { className: 'label', text: label }),
      el('div', { className: 'value', text: value }),
    );
    host.appendChild(card);
  }
}

function renderOpportunityList(state) {
  const host = byId('opportunityList');
  clearNode(host);

  if (!state.universeLoaded || state.opportunities.length === 0) {
    host.appendChild(el('li', { className: 'opportunity-item', text: 'No opportunities loaded.' }));
    return;
  }

  for (const item of state.opportunities) {
    const li = el('li', { className: 'opportunity-item' });
    const title = el('div', { className: 'title' });
    setText(title, item.title);

    const badge = el('span', {
      className: `badge ${item.priority}`,
      text: item.priority.toUpperCase(),
    });
    title.appendChild(badge);

    const metaParts = [`${item.subcategoryId.toUpperCase()}`, `Score ${item.score}`];
    if (item.trialCount != null) metaParts.push(`${item.trialCount} trials`);
    if (item.recentTrials != null) metaParts.push(`${item.recentTrials} recent`);

    const meta = el('div', {
      className: 'meta',
      text: metaParts.join(' | '),
    });

    const rationale = el('div', { className: 'meta', text: item.rationale });
    append(li, title, meta, rationale);
    host.appendChild(li);
  }
}

function renderTabs(state) {
  const tabRoot = byId('viewTabs');
  const tabs = tabRoot.querySelectorAll('[data-action="switch-view"]');
  for (const tab of tabs) {
    const active = tab.dataset.view === state.currentView;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

function renderViewFrame(state) {
  const frame = byId('viewFrame');
  clearNode(frame);

  const text = !state.universeLoaded
    ? 'Load Universe to initialize discovery views.'
    : `${getViewLabel(state.currentView)}\n${state.trials.length} trials indexed from ${sourceLabel(state.dataSource)}, sorted by ${state.sortMode}.`;

  frame.appendChild(el('div', { text }));
}

function renderMethodologyGate(state) {
  const host = byId('methodologyGate');
  clearNode(host);

  const label = el('div', { text: `Gate: ${state.methodologyGate.label}` });
  label.style.fontWeight = '700';
  label.style.marginBottom = '6px';

  const detail = el('div', { text: state.methodologyGate.detail });
  detail.style.color = '#475569';
  detail.style.fontSize = '0.76rem';

  append(host, label, detail);

  const dedup = el('div', {
    text:
      `Dedup signals: ${state.dedupSummary.duplicateClusterCount} duplicate clusters, ` +
      `${state.dedupSummary.multiSourceClusterCount} cross-source clusters, ` +
      `${state.dedupSummary.edgeCount} duplicate edges.`,
  });
  dedup.style.marginTop = '8px';
  dedup.style.color = '#1f4f78';
  dedup.style.fontSize = '0.75rem';
  host.appendChild(dedup);

  if (state.lastError) {
    const error = el('div', { text: state.lastError });
    error.style.marginTop = '8px';
    error.style.color = '#b91c1c';
    error.style.fontSize = '0.75rem';
    host.appendChild(error);
  }
}

export function renderDiscovery(state) {
  setText(byId('statusText'), `Status: ${state.loading ? 'loading' : state.universeLoaded ? 'ready' : 'idle'} (${sourceLabel(state.dataSource)})`);
  setText(byId('refreshText'), `Last refresh: ${formatTime(state.lastRefreshIso)}`);

  renderSourceButtons(state);
  renderSortButtons(state);
  renderTabs(state);
  renderKpis(state);
  renderViewFrame(state);
  renderOpportunityList(state);
  renderMethodologyGate(state);
}
