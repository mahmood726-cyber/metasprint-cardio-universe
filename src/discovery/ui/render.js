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
    matrix: 'Intervention x outcome matrix (live trial coverage)',
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

function renderProvenanceBanner(state) {
  const host = byId('provenanceBanner');
  if (!host) return;
  if (!state.universeLoaded) {
    host.hidden = true;
    host.textContent = '';
    host.className = 'provenance-banner';
    return;
  }

  const provenance = state.provenance ?? {};
  const requestedSource = sourceLabel(provenance.requestedSource ?? state.dataSource);
  const loadedSource = sourceLabel(provenance.loadedSource ?? state.dataSource);
  const requestedLimit = provenance.requestedLimit != null ? provenance.requestedLimit : 'n/a';
  const loadedCount = provenance.loadedCount != null ? provenance.loadedCount : state.trials.length;
  const usedFallback = Boolean(provenance.usedFallback);

  host.hidden = false;
  host.className = usedFallback ? 'provenance-banner warning' : 'provenance-banner';
  host.textContent = usedFallback
    ? `Fallback mode: requested ${requestedSource} (limit ${requestedLimit}), loaded ${loadedCount} from ${loadedSource}. ${provenance.fallbackReason ?? ''}`
    : `Data provenance: requested ${requestedSource} (limit ${requestedLimit}), loaded ${loadedCount} from ${loadedSource}.`;
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
      text: `${item.priority.toUpperCase()} GAP`,
    });
    title.appendChild(badge);

    const metaParts = [`${item.subcategoryId.toUpperCase()}`, `Gap score ${item.score}`];
    if (item.trialCount != null) metaParts.push(`${item.trialCount} trials`);
    if (item.recentTrials != null) metaParts.push(`${item.recentTrials} recent`);

    const meta = el('div', {
      className: 'meta',
      text: metaParts.join(' | '),
    });

    const breakdown = item.scoreBreakdown;
    const formula = breakdown
      ? `Formula: 100 - evidence ${breakdown.evidencePenalty} - recency ${breakdown.recencyPenalty} - scale ${breakdown.scalePenalty}`
      : 'Formula: 100 - evidence - recency - scale';

    const formulaNode = el('div', { className: 'meta formula', text: formula });
    const rationale = el('div', { className: 'meta', text: item.rationale });
    append(li, title, meta, formulaNode, rationale);
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

function renderMatrixView(frame, state) {
  const matrix = state.matrixSummary ?? { rows: [], columns: [], totalTrials: 0, matchedTrials: 0 };
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const columns = Array.isArray(matrix.columns) ? matrix.columns : [];

  const intro = el('div', {
    className: 'matrix-summary',
    text: `Intervention x endpoint-domain coverage from ${matrix.totalTrials ?? state.trials.length} trials. Ontology-matched trials: ${matrix.matchedTrials ?? 0}.`,
  });
  frame.appendChild(intro);

  if (rows.length === 0 || columns.length === 0) {
    frame.appendChild(el('div', { text: 'No matrix signals found for this dataset.' }));
    return;
  }

  const table = el('table', { className: 'matrix-table' });
  const thead = el('thead');
  const headRow = el('tr');
  append(
    headRow,
    el('th', { text: 'Intervention class' }),
    ...columns.map((column) => el('th', { text: `${column.label} (${column.trialCount})` })),
    el('th', { text: 'Trials' }),
  );
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    tr.appendChild(el('th', { text: row.label }));
    for (const cell of row.cells ?? []) {
      const td = el('td', { text: String(cell.count ?? 0) });
      if ((cell.count ?? 0) > 0) td.classList.add('hit');
      tr.appendChild(td);
    }
    tr.appendChild(el('td', { text: String(row.trialCount ?? 0) }));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  frame.appendChild(table);
}

function renderViewFrame(state) {
  const frame = byId('viewFrame');
  clearNode(frame);

  const isMatrix = state.universeLoaded && state.currentView === 'matrix';
  frame.classList.toggle('view-frame-rich', isMatrix);

  if (!state.universeLoaded) {
    frame.appendChild(el('div', { text: 'Load Universe to initialize discovery views.' }));
    return;
  }

  if (isMatrix) {
    renderMatrixView(frame, state);
    return;
  }

  const provenance = state.provenance ?? {};
  const requested = sourceLabel(provenance.requestedSource ?? state.dataSource);
  const loaded = sourceLabel(provenance.loadedSource ?? state.dataSource);
  const text =
    `${getViewLabel(state.currentView)}\n` +
    `${state.trials.length} trials loaded from ${loaded}` +
    (requested !== loaded ? ` (requested ${requested}).` : '.') +
    ` Sorted by ${state.sortMode}.`;

  frame.appendChild(el('div', { text }));
}

function renderMethodologyGate(state) {
  const host = byId('methodologyGate');
  clearNode(host);

  const label = el('div', { text: `Status: ${state.methodologyGate.label}` });
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
  const provenance = state.provenance ?? {};
  const requestedSource = sourceLabel(provenance.requestedSource ?? state.dataSource);
  const loadedSource = sourceLabel(provenance.loadedSource ?? state.dataSource);
  const sourceText =
    state.universeLoaded && requestedSource !== loadedSource
      ? `${requestedSource} -> ${loadedSource}`
      : requestedSource;

  setText(byId('statusText'), `Status: ${state.loading ? 'loading' : state.universeLoaded ? 'ready' : 'idle'} (${sourceText})`);
  setText(byId('refreshText'), `Last refresh: ${formatTime(state.lastRefreshIso)}`);

  renderSourceButtons(state);
  renderSortButtons(state);
  renderTabs(state);
  renderProvenanceBanner(state);
  renderKpis(state);
  renderViewFrame(state);
  renderOpportunityList(state);
  renderMethodologyGate(state);
}
