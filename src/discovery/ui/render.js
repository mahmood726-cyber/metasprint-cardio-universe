import { append, byId, clearNode, el, setText } from '../../core/dom.js';

function formatTime(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString();
}

function getViewLabel(view) {
  const labels = {
    ayat: 'Ayat evidence signal radar',
    network: 'Intervention-endpoint network',
    treemap: 'Subcategory evidence treemap',
    timeline: 'Trial timeline by year',
    matrix: 'Intervention x outcome matrix',
    gapscatter: 'Gap score vs evidence volume',
    pipeline: 'Evidence pipeline by recency stage',
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

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasPlotly() {
  return typeof globalThis.Plotly?.newPlot === 'function';
}

function trialPrimaryLabel(trial) {
  if (!trial) return 'Unknown trial';
  if (trial.nctId) return trial.nctId;
  if (trial.pmid) return `PMID ${trial.pmid}`;
  if (trial.doi) return `DOI ${trial.doi}`;
  return trial.trialId ?? 'Unknown trial';
}

function trialHref(trial) {
  if (!trial) return null;
  if (trial.nctId) return `https://clinicaltrials.gov/study/${encodeURIComponent(trial.nctId)}`;
  if (trial.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(trial.pmid)}/`;
  if (trial.doi) return `https://doi.org/${encodeURIComponent(trial.doi)}`;
  return null;
}

function renderTrialDrilldown(host, heading, trialIds, trialById) {
  clearNode(host);
  host.appendChild(el('div', { className: 'drilldown-title', text: heading }));

  if (!Array.isArray(trialIds) || trialIds.length === 0) {
    host.appendChild(el('div', { text: 'No linked trials for this selection.' }));
    return;
  }

  const list = el('ul', { className: 'trial-list' });
  for (const trialId of trialIds.slice(0, 40)) {
    const trial = trialById.get(trialId);
    const li = el('li');
    const href = trialHref(trial);
    const label = trialPrimaryLabel(trial);
    const title = String(trial?.title ?? '').trim();

    if (href) {
      const link = el('a', {
        text: label,
        attrs: { href, target: '_blank', rel: 'noopener noreferrer' },
      });
      li.appendChild(link);
    } else {
      li.appendChild(el('span', { text: label }));
    }

    if (title) {
      li.appendChild(el('span', { text: ` - ${title}` }));
    }
    list.appendChild(li);
  }

  if (trialIds.length > 40) {
    host.appendChild(el('div', { text: `Showing first 40 of ${trialIds.length} linked trials.` }));
  }
  host.appendChild(list);
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
    ['Intervention Classes', state.kpis.subcategories],
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

  const trialsBySubcategory = new Map();
  for (const trial of state.trials ?? []) {
    const key = String(trial?.subcategoryId ?? 'general');
    if (!trialsBySubcategory.has(key)) trialsBySubcategory.set(key, []);
    trialsBySubcategory.get(key).push(trial);
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

    const scoreBreakdown = item.scoreBreakdown;
    const formula = scoreBreakdown
      ? `Formula: 100 - evidence ${scoreBreakdown.evidencePenalty} - recency ${scoreBreakdown.recencyPenalty} - scale ${scoreBreakdown.scalePenalty}`
      : 'Formula: 100 - evidence - recency - scale';

    const formulaNode = el('div', { className: 'meta formula', text: formula });
    const rationale = el('div', { className: 'meta', text: item.rationale });
    const factors = item.factors;
    let breakdownText = '';
    if (factors && typeof factors === 'object') {
      const parts = Object.entries(FACTOR_ABBREVS)
        .map(([key, abbr]) => `${abbr}:${Math.round(Number(factors[key]) || 0)}`)
        .join(' ');
      breakdownText = `${Math.round(item.compositeScore ?? item.score)} = ${parts}`;
    }
    const breakdown = el('div', { className: 'score-breakdown', text: breakdownText });

    append(li, title, meta, formulaNode, rationale, breakdown);

    const linkedTrials = (trialsBySubcategory.get(String(item.subcategoryId ?? 'general')) ?? [])
      .slice()
      .sort((a, b) => toNumber(b?.year, 0) - toNumber(a?.year, 0));
    const details = el('details', { className: 'opportunity-trials' });
    const summary = el('summary', {
      text: `Show trials (${linkedTrials.length})`,
    });
    details.appendChild(summary);
    const trialsList = el('ul', { className: 'trial-list' });
    for (const trial of linkedTrials.slice(0, 20)) {
      const liTrial = el('li');
      const href = trialHref(trial);
      const label = trialPrimaryLabel(trial);
      const year = trial?.year ? ` (${trial.year})` : '';
      if (href) {
        const link = el('a', {
          text: `${label}${year}`,
          attrs: { href, target: '_blank', rel: 'noopener noreferrer' },
        });
        liTrial.appendChild(link);
      } else {
        liTrial.appendChild(el('span', { text: `${label}${year}` }));
      }
      if (trial?.title) {
        liTrial.appendChild(el('span', { text: ` - ${trial.title}` }));
      }
      trialsList.appendChild(liTrial);
    }
    details.appendChild(trialsList);
    if (linkedTrials.length > 20) {
      details.appendChild(el('div', { className: 'meta', text: `Showing first 20 of ${linkedTrials.length} trials.` }));
    }
    li.appendChild(details);
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

function appendViewIntro(frame, state) {
  const provenance = state.provenance ?? {};
  const requested = sourceLabel(provenance.requestedSource ?? state.dataSource);
  const loaded = sourceLabel(provenance.loadedSource ?? state.dataSource);
  const intro = el('div', {
    className: 'view-intro',
    text:
      `${getViewLabel(state.currentView)}. ` +
      `${state.trials.length} trials loaded from ${loaded}` +
      (requested !== loaded ? ` (requested ${requested}).` : '.') +
      ` Sorted by ${state.sortMode}.`,
  });
  frame.appendChild(intro);
}

function appendPlotHost(frame, label, className = 'discovery-plot') {
  const host = el('div', { className });
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', label);
  frame.appendChild(host);
  return host;
}

function renderPlotlyUnavailable(frame) {
  frame.appendChild(
    el('div', {
      text: 'Chart library unavailable in this browser context. Reload this page to retry.',
    }),
  );
}

function renderAyatView(frame, state) {
  appendViewIntro(frame, state);
  if (!hasPlotly()) {
    renderPlotlyUnavailable(frame);
    return;
  }

  const totalNorm = Math.min(100, Math.round((Number(state.kpis.totalTrials || 0) / 500) * 100));
  const subcatNorm = Math.min(100, Math.round((Number(state.kpis.subcategories || 0) / 10) * 100));
  const recentNorm =
    state.kpis.totalTrials > 0 ? Math.round((Number(state.kpis.recentTrials3y || 0) / state.kpis.totalTrials) * 100) : 0;
  const gapNorm =
    state.opportunities.length > 0
      ? Math.round(state.opportunities.reduce((sum, item) => sum + Number(item.score || 0), 0) / state.opportunities.length)
      : 0;
  const coverageNorm =
    state.matrixSummary?.totalTrials > 0
      ? Math.round((Number(state.matrixSummary.matchedTrials || 0) / state.matrixSummary.totalTrials) * 100)
      : 0;

  const host = appendPlotHost(frame, 'Ayat evidence signal radar');
  void globalThis.Plotly.newPlot(
    host,
    [
      {
        type: 'scatterpolar',
        r: [totalNorm, subcatNorm, recentNorm, gapNorm, coverageNorm, totalNorm],
        theta: ['Volume', 'Breadth', 'Recency', 'Gap Signal', 'Ontology Coverage', 'Volume'],
        fill: 'toself',
        line: { color: '#0f766e', width: 2 },
        marker: { size: 5, color: '#0f766e' },
        name: 'Signal profile',
      },
    ],
    {
      margin: { l: 30, r: 30, t: 18, b: 24 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      polar: {
        radialaxis: { visible: true, range: [0, 100], tickfont: { size: 10 } },
        angularaxis: { tickfont: { size: 10 } },
      },
      showlegend: false,
    },
    { displayModeBar: false, responsive: true },
  );
}

function renderTreemapView(frame, state) {
  appendViewIntro(frame, state);
  if (!hasPlotly()) {
    renderPlotlyUnavailable(frame);
    return;
  }

  const counts = new Map();
  for (const trial of state.trials) {
    const key = String(trial?.subcategoryId ?? 'general').toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const labels = [...counts.keys()];
  const values = labels.map((label) => counts.get(label));

  const host = appendPlotHost(frame, 'Treemap of evidence by subcategory');
  void globalThis.Plotly.newPlot(
    host,
    [
      {
        type: 'treemap',
        labels,
        parents: labels.map(() => ''),
        values,
        marker: {
          colors: ['#0f766e', '#0e7490', '#0369a1', '#0284c7', '#0891b2', '#14b8a6', '#22c55e', '#65a30d', '#4d7c0f'],
        },
        textinfo: 'label+value',
      },
    ],
    {
      margin: { l: 8, r: 8, t: 8, b: 8 },
      paper_bgcolor: 'rgba(0,0,0,0)',
    },
    { displayModeBar: false, responsive: true },
  );
}

function renderTimelineView(frame, state) {
  appendViewIntro(frame, state);
  if (!hasPlotly()) {
    renderPlotlyUnavailable(frame);
    return;
  }

  const byYear = new Map();
  for (const trial of state.trials) {
    const year = Number(trial?.year);
    if (!Number.isFinite(year)) continue;
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length === 0) {
    frame.appendChild(el('div', { text: 'No publication/start-year data available for timeline.' }));
    return;
  }

  const host = appendPlotHost(frame, 'Timeline of trials by year');
  void globalThis.Plotly.newPlot(
    host,
    [
      {
        type: 'bar',
        x: years,
        y: years.map((year) => byYear.get(year)),
        marker: { color: '#0369a1' },
      },
    ],
    {
      margin: { l: 40, r: 12, t: 12, b: 36 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { title: { text: 'Year', font: { size: 11 } } },
      yaxis: { title: { text: 'Trials', font: { size: 11 } }, dtick: 1 },
      showlegend: false,
    },
    { displayModeBar: false, responsive: true },
  );
}

function renderGapScatterView(frame, state) {
  appendViewIntro(frame, state);
  if (!hasPlotly()) {
    renderPlotlyUnavailable(frame);
    return;
  }

  if (state.opportunities.length === 0) {
    frame.appendChild(el('div', { text: 'No opportunities available for gap scatter.' }));
    return;
  }

  const colorByPriority = {
    high: '#b91c1c',
    moderate: '#b45309',
    low: '#166534',
  };

  const host = appendPlotHost(frame, 'Scatter of gap score against trial volume');
  void globalThis.Plotly.newPlot(
    host,
    [
      {
        type: 'scatter',
        mode: 'markers+text',
        x: state.opportunities.map((item) => Number(item.trialCount || 0)),
        y: state.opportunities.map((item) => Number(item.score || 0)),
        text: state.opportunities.map((item) => String(item.subcategoryId ?? '').toUpperCase()),
        textposition: 'top center',
        marker: {
          size: state.opportunities.map((item) => 9 + Math.min(18, Number(item.recentTrials || 0))),
          color: state.opportunities.map((item) => colorByPriority[item.priority] ?? '#0f766e'),
          opacity: 0.82,
          line: { width: 1, color: '#fff' },
        },
        hovertemplate:
          '<b>%{text}</b><br>Trials: %{x}<br>Gap score: %{y}<br><extra></extra>',
      },
    ],
    {
      margin: { l: 44, r: 14, t: 10, b: 40 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { title: { text: 'Trial count', font: { size: 11 } } },
      yaxis: { title: { text: 'Gap score', font: { size: 11 } }, range: [0, 100] },
      showlegend: false,
    },
    { displayModeBar: false, responsive: true },
  );
}

function renderPipelineView(frame, state) {
  appendViewIntro(frame, state);
  if (!hasPlotly()) {
    renderPlotlyUnavailable(frame);
    return;
  }

  const classifyStage = (year) => {
    const y = Number(year);
    if (!Number.isFinite(y)) return 'Unspecified';
    if (y <= 2014) return 'Legacy';
    if (y <= 2019) return 'Established';
    if (y <= 2022) return 'Active';
    return 'Frontier';
  };

  const order = ['Legacy', 'Established', 'Active', 'Frontier', 'Unspecified'];
  const counts = new Map(order.map((key) => [key, 0]));
  for (const trial of state.trials) {
    const stage = classifyStage(trial?.year);
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }

  const host = appendPlotHost(frame, 'Pipeline of evidence stages');
  void globalThis.Plotly.newPlot(
    host,
    [
      {
        type: 'bar',
        x: order,
        y: order.map((label) => counts.get(label) ?? 0),
        marker: {
          color: ['#64748b', '#0369a1', '#0f766e', '#15803d', '#a3a3a3'],
        },
      },
    ],
    {
      margin: { l: 40, r: 10, t: 10, b: 40 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      yaxis: { dtick: 1, title: { text: 'Trials', font: { size: 11 } } },
      xaxis: { title: { text: 'Recency stage', font: { size: 11 } } },
      showlegend: false,
    },
    { displayModeBar: false, responsive: true },
  );
}

function renderNetworkView(frame, state) {
  appendViewIntro(frame, state);
  if (!hasPlotly()) {
    renderPlotlyUnavailable(frame);
    return;
  }

  const matrix = state.matrixSummary ?? { rows: [], columns: [] };
  const rows = (matrix.rows ?? []).slice(0, 8);
  const cols = (matrix.columns ?? []).slice(0, 8);

  if (rows.length === 0 || cols.length === 0) {
    frame.appendChild(el('div', { text: 'Insufficient ontology matches for network view.' }));
    return;
  }

  const leftY = rows.map((_, idx) => 1 - (idx + 1) / (rows.length + 1));
  const rightY = cols.map((_, idx) => 1 - (idx + 1) / (cols.length + 1));

  const edgeTraces = [];
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < cols.length; c += 1) {
      const count = Number(rows[r].cells?.find((cell) => cell.id === cols[c].id)?.count ?? 0);
      if (count <= 0) continue;
      edgeTraces.push({
        type: 'scatter',
        mode: 'lines',
        x: [0.18, 0.82],
        y: [leftY[r], rightY[c]],
        line: {
          width: 1 + Math.min(7, Math.sqrt(count)),
          color: 'rgba(30, 64, 175, 0.28)',
        },
        hoverinfo: 'text',
        hovertext: `${rows[r].label} ↔ ${cols[c].label}: ${count} trial(s)`,
        showlegend: false,
      });
    }
  }

  const nodeTrace = {
    type: 'scatter',
    mode: 'markers+text',
    x: [...rows.map(() => 0.14), ...cols.map(() => 0.86)],
    y: [...leftY, ...rightY],
    text: [...rows.map((row) => row.label), ...cols.map((col) => col.label)],
    textposition: [...rows.map(() => 'middle left'), ...cols.map(() => 'middle right')],
    marker: {
      size: [...rows.map((row) => 8 + Math.min(20, row.trialCount)), ...cols.map((col) => 8 + Math.min(20, col.trialCount))],
      color: [...rows.map(() => '#0f766e'), ...cols.map(() => '#0369a1')],
      line: { color: '#fff', width: 1 },
    },
    hovertemplate: '%{text}<extra></extra>',
    showlegend: false,
  };

  const host = appendPlotHost(frame, 'Network between intervention classes and endpoint domains');
  void globalThis.Plotly.newPlot(
    host,
    [...edgeTraces, nodeTrace],
    {
      margin: { l: 24, r: 24, t: 10, b: 10 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { visible: false, range: [0, 1] },
      yaxis: { visible: false, range: [0, 1] },
      showlegend: false,
    },
    { displayModeBar: false, responsive: true },
  );

  // Click-to-drilldown: clicking a node shows its linked trials
  const allNodes = [...rows, ...cols];
  const trialById = new Map((state.trials ?? []).map((t) => [String(t?.trialId ?? ''), t]));
  const drilldown = el('div', { className: 'drilldown-panel', attrs: { style: 'margin-top:12px' } });
  frame.appendChild(drilldown);

  host.on('plotly_click', (eventData) => {
    if (!eventData?.points?.length) return;
    const pt = eventData.points[0];
    // Only node trace (last trace) has text labels
    if (pt.curveNumber < edgeTraces.length) return;
    const nodeIdx = pt.pointNumber;
    if (nodeIdx == null || nodeIdx < 0 || nodeIdx >= allNodes.length) return;
    const node = allNodes[nodeIdx];
    const heading = `${node.label} — ${node.trialCount ?? 0} trial(s)`;
    const ids = Array.isArray(node.trialIds) ? node.trialIds.map(String) : [];
    renderTrialDrilldown(drilldown, heading, ids, trialById);
  });
}

function renderMatrixView(frame, state) {
  const matrix = state.matrixSummary ?? { rows: [], columns: [], totalTrials: 0, matchedTrials: 0 };
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const columns = Array.isArray(matrix.columns) ? matrix.columns : [];
  const trialById = new Map((state.trials ?? []).map((trial) => [String(trial?.trialId ?? ''), trial]));

  appendViewIntro(frame, state);
  frame.appendChild(
    el('div', {
      className: 'matrix-summary',
      text: `Ontology-matched trials: ${matrix.matchedTrials ?? 0}/${matrix.totalTrials ?? state.trials.length}.`,
    }),
  );

  if (rows.length === 0 || columns.length === 0) {
    frame.appendChild(el('div', { text: 'No matrix signals found for this dataset.' }));
    return;
  }

  if (hasPlotly()) {
    const host = appendPlotHost(frame, 'Heatmap of intervention and endpoint-domain counts', 'discovery-plot small');
    const z = rows.map((row) => columns.map((column) => Number(row.cells?.find((cell) => cell.id === column.id)?.count ?? 0)));
    void globalThis.Plotly.newPlot(
      host,
      [
        {
          type: 'heatmap',
          z,
          x: columns.map((column) => column.label),
          y: rows.map((row) => row.label),
          colorscale: [
            [0, '#eff6ff'],
            [0.35, '#93c5fd'],
            [0.7, '#3b82f6'],
            [1, '#1d4ed8'],
          ],
          hovertemplate: '%{y} | %{x}: %{z} trials<extra></extra>',
        },
      ],
      {
        margin: { l: 120, r: 20, t: 8, b: 32 },
        paper_bgcolor: 'rgba(0,0,0,0)',
      },
      { displayModeBar: false, responsive: true },
    );
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
  const drilldown = el('div', {
    className: 'drilldown-panel',
    text: 'Select a matrix cell with count > 0 to inspect linked trials.',
  });

  for (const row of rows) {
    const tr = el('tr');
    tr.appendChild(el('th', { text: row.label }));
    for (const cell of row.cells ?? []) {
      const count = Number(cell.count ?? 0);
      const td = el('td');
      if (count > 0) {
        td.classList.add('hit');
        const button = el('button', {
          className: 'matrix-cell-btn',
          text: String(count),
          attrs: { type: 'button' },
        });
        const columnLabel = columns.find((col) => col.id === cell.id)?.label ?? cell.id;
        button.addEventListener('click', () => {
          renderTrialDrilldown(
            drilldown,
            `${row.label} x ${columnLabel} (${count})`,
            cell.trialIds ?? [],
            trialById,
          );
        });
        td.appendChild(button);
      } else {
        td.textContent = '0';
      }
      tr.appendChild(td);
    }
    const totalTd = el('td');
    const totalCount = Number(row.trialCount ?? 0);
    if (totalCount > 0) {
      const button = el('button', {
        className: 'matrix-cell-btn total',
        text: String(totalCount),
        attrs: { type: 'button' },
      });
      button.addEventListener('click', () => {
        renderTrialDrilldown(
          drilldown,
          `${row.label} (all linked trials: ${totalCount})`,
          row.trialIds ?? [],
          trialById,
        );
      });
      totalTd.appendChild(button);
    } else {
      totalTd.textContent = '0';
    }
    tr.appendChild(totalTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  frame.appendChild(table);
  frame.appendChild(drilldown);
}

function renderViewFrame(state) {
  const frame = byId('viewFrame');
  clearNode(frame);

  if (!state.universeLoaded) {
    frame.classList.remove('view-frame-rich');
    frame.appendChild(el('div', { text: 'Load Universe to initialize discovery views.' }));
    return;
  }

  frame.classList.add('view-frame-rich');

  if (state.currentView === 'ayat') {
    renderAyatView(frame, state);
    return;
  }
  if (state.currentView === 'network') {
    renderNetworkView(frame, state);
    return;
  }
  if (state.currentView === 'treemap') {
    renderTreemapView(frame, state);
    return;
  }
  if (state.currentView === 'timeline') {
    renderTimelineView(frame, state);
    return;
  }
  if (state.currentView === 'matrix') {
    renderMatrixView(frame, state);
    return;
  }
  if (state.currentView === 'gapscatter') {
    renderGapScatterView(frame, state);
    return;
  }
  if (state.currentView === 'pipeline') {
    renderPipelineView(frame, state);
    return;
  }

  appendViewIntro(frame, state);
  frame.appendChild(el('div', { text: 'View renderer is not configured.' }));
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

const FACTOR_LABELS = {
  clinicalImpact: 'Clinical Impact',
  uncertaintyReduction: 'Uncertainty Reduction',
  feasibility: 'Feasibility',
  freshness: 'Freshness',
  provenanceConfidence: 'Provenance Confidence',
};

const FACTOR_ABBREVS = {
  clinicalImpact: 'CI',
  uncertaintyReduction: 'UR',
  feasibility: 'F',
  freshness: 'EF',
  provenanceConfidence: 'PC',
};

function renderWeightsPanel(state) {
  const panel = byId('weightsPanel');
  const grid = byId('weightsGrid');
  const toggle = document.querySelector('[data-action="toggle-weights"]');
  if (!panel || !grid) return;

  const open = Boolean(state.rankingSensitivityOpen);
  panel.hidden = !open;
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open) return;

  clearNode(grid);
  const weights = state.rankingWeights ?? {};

  for (const [factorId, label] of Object.entries(FACTOR_LABELS)) {
    const weight = Number(weights[factorId]) || 0;
    const pct = Math.round(weight * 100);

    const control = el('div', { className: 'weight-control' });
    const labelEl = el('label', { text: label, attrs: { for: `weight-${factorId}` } });

    const row = el('div', { className: 'weight-row' });
    const input = el('input', {
      attrs: {
        type: 'range',
        id: `weight-${factorId}`,
        min: '0',
        max: '100',
        value: String(pct),
        'data-factor': factorId,
        'aria-label': `${label} weight`,
      },
    });
    const pctLabel = el('span', { className: 'weight-pct', text: `${pct}%` });

    append(row, input, pctLabel);
    append(control, labelEl, row);
    grid.appendChild(control);
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
  renderWeightsPanel(state);
}
