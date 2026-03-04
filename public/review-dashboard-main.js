function el(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value == null) continue;
      node.setAttribute(key, String(value));
    }
  }
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatDate(iso) {
  if (!iso) return 'n/a';
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? String(iso) : dt.toLocaleString();
}

function hasPlotly() {
  return typeof globalThis.Plotly?.newPlot === 'function' && typeof globalThis.Plotly?.downloadImage === 'function';
}

const PLOTLY_CDN_URL = 'https://cdn.plot.ly/plotly-2.27.0.min.js';
let plotlyLoadPromise = null;

function loadPlotlyWithTimeout(timeoutMs = 4500) {
  if (hasPlotly()) return Promise.resolve(true);
  if (plotlyLoadPromise) return plotlyLoadPromise;

  plotlyLoadPromise = new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    const existing = document.querySelector('script[data-plotly-loader="1"]');
    if (existing) {
      existing.addEventListener(
        'load',
        () => {
          clearTimeout(timer);
          finish(hasPlotly());
        },
        { once: true },
      );
      existing.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          finish(false);
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = PLOTLY_CDN_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.plotlyLoader = '1';
    script.addEventListener(
      'load',
      () => {
        clearTimeout(timer);
        finish(hasPlotly());
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        finish(false);
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return plotlyLoadPromise;
}

function announceStatus(text) {
  const host = document.getElementById('srAnnouncements');
  if (!host) return;
  host.textContent = '';
  setTimeout(() => {
    host.textContent = String(text ?? '');
  }, 10);
}

function setActionStatus(text) {
  const host = document.getElementById('chartActionStatus');
  if (host) host.textContent = String(text ?? '');
}

function setChartNote(id, text) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = String(text ?? '');
}

function setChartData(id, text) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = String(text ?? '');
}

function setChartFallback(id, text) {
  const host = document.getElementById(id);
  if (!host) return;
  host.textContent = String(text ?? '');
}

function normalizeThemes(themes) {
  const safeThemes = Array.isArray(themes) ? themes : [];
  return safeThemes
    .map((theme) => ({
      theme: String(theme?.theme ?? '').trim(),
      count: toNumber(theme?.count, 0),
    }))
    .filter((theme) => theme.theme.length > 0)
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
}

function normalizeBlockers(blockers) {
  const safeBlockers = Array.isArray(blockers) ? blockers : [];
  return safeBlockers
    .map((blocker) => ({
      blocker: String(blocker?.blocker ?? '').trim(),
      count: toNumber(blocker?.count, 0),
    }))
    .filter((blocker) => blocker.blocker.length > 0);
}

function normalizeCycle(cycle, index) {
  const cycleId = String(cycle?.cycleId ?? `cycle_${String(index + 1).padStart(3, '0')}`).trim();
  return {
    cycleId: cycleId || `cycle_${String(index + 1).padStart(3, '0')}`,
    generatedAt: cycle?.generatedAt ?? null,
    totalReviewers: Math.max(1, toNumber(cycle?.totalReviewers, 12)),
    switchNow: Math.max(0, toNumber(cycle?.switchNow, 0)),
    switchWithConditions: Math.max(0, toNumber(cycle?.switchWithConditions, 0)),
    notYet: Math.max(0, toNumber(cycle?.notYet, 0)),
    gatePassed: cycle?.gatePassed === true,
    gapToTarget: Math.max(0, toNumber(cycle?.gapToTarget, 0)),
    avgMethodValidity: cycle?.avgMethodValidity == null ? null : toNumber(cycle.avgMethodValidity, null),
    avgTransparencyConfidence:
      cycle?.avgTransparencyConfidence == null ? null : toNumber(cycle.avgTransparencyConfidence, null),
    topDissentThemes: normalizeThemes(cycle?.topDissentThemes),
    criticalBlockers: normalizeBlockers(cycle?.criticalBlockers),
    sourceSummaryPath: cycle?.sourceSummaryPath ?? null,
  };
}

function normalizePayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('Invalid dashboard payload: expected object.');
  }
  const cyclesRaw = Array.isArray(rawPayload.cycles) ? rawPayload.cycles : [];
  if (cyclesRaw.length === 0) {
    throw new Error('Invalid dashboard payload: no cycles were found.');
  }
  const cycles = cyclesRaw.map((cycle, index) => normalizeCycle(cycle, index));
  const latest = cycles[cycles.length - 1];
  const aggregateRaw = rawPayload.aggregate ?? {};

  return {
    generatedAt: rawPayload.generatedAt ?? null,
    aggregate: {
      cyclesTracked: Math.max(1, toNumber(aggregateRaw.cyclesTracked, cycles.length)),
      gatePassCount: Math.max(0, toNumber(aggregateRaw.gatePassCount, cycles.filter((cycle) => cycle.gatePassed).length)),
      latestCycleId: String(aggregateRaw.latestCycleId ?? latest.cycleId),
      latestGatePassed: aggregateRaw.latestGatePassed === true || latest.gatePassed === true,
      latestSwitchNow: Math.max(0, toNumber(aggregateRaw.latestSwitchNow, latest.switchNow)),
      latestSwitchWithConditions: Math.max(
        0,
        toNumber(aggregateRaw.latestSwitchWithConditions, latest.switchWithConditions),
      ),
      latestNotYet: Math.max(0, toNumber(aggregateRaw.latestNotYet, latest.notYet)),
    },
    cycles,
  };
}

function renderKpis(payload) {
  const host = document.getElementById('kpiGrid');
  clearNode(host);

  const items = [
    ['Cycles tracked', payload.aggregate.cyclesTracked],
    ['Gate pass cycles', payload.aggregate.gatePassCount],
    ['Latest cycle', payload.aggregate.latestCycleId],
    ['Latest gate passed', yesNo(payload.aggregate.latestGatePassed)],
    ['Latest switch now', payload.aggregate.latestSwitchNow],
    ['Latest switch cond.', payload.aggregate.latestSwitchWithConditions],
    ['Latest not yet', payload.aggregate.latestNotYet],
    ['Generated', formatDate(payload.generatedAt)],
  ];

  for (const [label, value] of items) {
    const card = el('div', { className: 'kpi' });
    card.appendChild(el('div', { className: 'label', text: label }));
    card.appendChild(el('div', { className: 'value', text: value }));
    host.appendChild(card);
  }
}

function renderCycleRows(payload) {
  const tbody = document.getElementById('cycleRows');
  clearNode(tbody);

  for (const cycle of payload.cycles) {
    const tr = el('tr');
    const firstCell = el('th', { text: cycle.cycleId, attrs: { scope: 'row' } });
    tr.appendChild(firstCell);

    const cells = [
      cycle.gatePassed ? 'Pass' : 'Fail',
      `${cycle.switchNow}/${cycle.totalReviewers}`,
      String(cycle.switchWithConditions),
      String(cycle.notYet),
      cycle.avgMethodValidity ?? 'n/a',
      cycle.avgTransparencyConfidence ?? 'n/a',
      cycle.gapToTarget,
    ];
    for (const value of cells) {
      tr.appendChild(el('td', { text: value }));
    }
    tbody.appendChild(tr);
  }
}

function renderThemes(payload) {
  const host = document.getElementById('themeList');
  clearNode(host);

  const latest = payload.cycles[payload.cycles.length - 1];
  const themes = latest?.topDissentThemes ?? [];
  if (themes.length === 0) {
    host.appendChild(el('li', { text: 'No dissent themes detected.' }));
    return;
  }
  for (const theme of themes) {
    host.appendChild(el('li', { text: `${theme.theme} (${theme.count})` }));
  }
}

function renderBlockers(payload) {
  const host = document.getElementById('blockerList');
  clearNode(host);

  const latest = payload.cycles[payload.cycles.length - 1];
  const blockers = latest?.criticalBlockers ?? [];
  if (blockers.length === 0) {
    host.appendChild(el('li', { text: 'No critical blockers in latest scored cycle.' }));
    return;
  }
  for (const blocker of blockers) {
    host.appendChild(el('li', { text: `${blocker.blocker} (${blocker.count})` }));
  }
}

function renderMeta(payload) {
  document.getElementById('generatedAt').textContent = formatDate(payload.generatedAt);
  const latest = payload.cycles[payload.cycles.length - 1];
  document.getElementById('latestPath').textContent = latest?.sourceSummaryPath ?? 'n/a';
}

function renderError(message) {
  const host = document.getElementById('loadError');
  host.textContent = String(message ?? '');
  host.style.display = 'block';
  if (typeof host.focus === 'function') host.focus();
  announceStatus(message);
}

async function renderSwitchTrendChart(payload) {
  const cycles = payload.cycles;
  const x = cycles.map((cycle) => cycle.cycleId);
  const switchNow = cycles.map((cycle) => cycle.switchNow);
  const gateVotesNeeded = cycles.map((cycle) => Math.ceil((cycle.totalReviewers * 11) / 12));
  const maxReviewers = Math.max(...cycles.map((cycle) => cycle.totalReviewers), 12);
  const maxPlotted = Math.max(maxReviewers, ...switchNow, ...gateVotesNeeded);
  const invalidCycles = cycles.filter((cycle) => cycle.switchNow > cycle.totalReviewers).map((cycle) => cycle.cycleId);

  await globalThis.Plotly.newPlot(
    'chartSwitchTrend',
    [
      {
        x,
        y: switchNow,
        mode: 'lines+markers',
        line: { color: '#0b7a75', width: 3 },
        marker: { size: 8, color: '#0b7a75' },
        name: 'Switch now',
      },
      {
        x,
        y: gateVotesNeeded,
        mode: 'lines',
        line: { color: '#b45309', width: 2, dash: 'dot' },
        name: 'Votes needed (11/12)',
      },
    ],
    {
      margin: { l: 44, r: 18, t: 14, b: 38 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { tickfont: { size: 11 } },
      yaxis: { range: [0, maxPlotted], dtick: 1, title: { text: 'Reviewers', font: { size: 11 } } },
      legend: { orientation: 'h', y: -0.24, x: 0 },
    },
    { displayModeBar: false, responsive: true },
  );

  const latest = cycles[cycles.length - 1];
  const latestGate = Math.ceil((latest.totalReviewers * 11) / 12);
  const gateMet = latest.switchNow >= latestGate;
  const warning =
    invalidCycles.length > 0
      ? ` Data warning: switch-now exceeds total reviewers in ${invalidCycles.join(', ')}.`
      : '';
  setChartNote(
    'chartSwitchTrendNote',
    `Shows switch-now votes over time against the 11/12 gate. Latest ${latest.cycleId} is ${latest.switchNow}/${latest.totalReviewers}, with ${latestGate} needed, ${gateMet ? 'meeting' : 'below'} the gate.${warning}`,
  );
  const trendDetails = cycles
    .map((cycle) => {
      const gateVotes = Math.ceil((cycle.totalReviewers * 11) / 12);
      const status = cycle.switchNow >= gateVotes ? 'gate met' : 'gate not met';
      return `${cycle.cycleId}: switch-now ${cycle.switchNow}/${cycle.totalReviewers}, gate ${gateVotes}, ${status}`;
    })
    .join('; ');
  setChartData('chartSwitchTrendData', `Switch-now trend data by cycle: ${trendDetails}.`);
}

async function renderDecisionMixChart(payload) {
  const cycles = payload.cycles;
  const x = cycles.map((cycle) => cycle.cycleId);

  await globalThis.Plotly.newPlot(
    'chartDecisionMix',
    [
      {
        x,
        y: cycles.map((cycle) => cycle.switchNow),
        type: 'bar',
        name: 'Switch now',
        marker: { color: '#0b7a75' },
      },
      {
        x,
        y: cycles.map((cycle) => cycle.switchWithConditions),
        type: 'bar',
        name: 'Switch with conditions',
        marker: { color: '#2563eb' },
      },
      {
        x,
        y: cycles.map((cycle) => cycle.notYet),
        type: 'bar',
        name: 'Not yet',
        marker: { color: '#b42318' },
      },
    ],
    {
      barmode: 'stack',
      margin: { l: 44, r: 18, t: 14, b: 38 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { tickfont: { size: 11 } },
      yaxis: { dtick: 1, title: { text: 'Count', font: { size: 11 } } },
      legend: { orientation: 'h', y: -0.24, x: 0 },
    },
    { displayModeBar: false, responsive: true },
  );

  const latest = cycles[cycles.length - 1];
  setChartNote(
    'chartDecisionMixNote',
    `Shows decision composition per cycle. Latest ${latest.cycleId} has ${latest.switchNow} switch-now, ${latest.switchWithConditions} conditional, and ${latest.notYet} not-yet ratings.`,
  );
  const mixDetails = cycles
    .map(
      (cycle) =>
        `${cycle.cycleId}: switch-now ${cycle.switchNow}, switch-with-conditions ${cycle.switchWithConditions}, not-yet ${cycle.notYet}`,
    )
    .join('; ');
  setChartData('chartDecisionMixData', `Decision-mix data by cycle: ${mixDetails}.`);
}

async function renderDissentThemeChart(payload) {
  const latest = payload.cycles[payload.cycles.length - 1];
  const themes = latest?.topDissentThemes ?? [];

  if (themes.length === 0) {
    await globalThis.Plotly.newPlot(
      'chartDissentThemes',
      [],
      {
        margin: { l: 10, r: 10, t: 10, b: 10 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        annotations: [
          {
            text: 'No dissent themes in latest cycle',
            xref: 'paper',
            yref: 'paper',
            x: 0.5,
            y: 0.5,
            showarrow: false,
            font: { size: 13, color: '#4e647f' },
          },
        ],
        xaxis: { visible: false },
        yaxis: { visible: false },
      },
      { displayModeBar: false, responsive: true },
    );
    setChartNote('chartDissentThemesNote', 'Shows top dissent themes in the latest cycle. Result: no dissent themes were recorded.');
    setChartData('chartDissentThemesData', 'Dissent-theme data: no dissent themes in the latest cycle.');
    return;
  }

  await globalThis.Plotly.newPlot(
    'chartDissentThemes',
    [
      {
        x: themes.map((theme) => theme.count),
        y: themes.map((theme) => theme.theme),
        type: 'bar',
        orientation: 'h',
        marker: { color: '#11698c' },
      },
    ],
    {
      margin: { l: 120, r: 20, t: 14, b: 32 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { dtick: 1, title: { text: 'Mentions', font: { size: 11 } } },
      yaxis: { autorange: 'reversed' },
    },
    { displayModeBar: false, responsive: true },
  );

  const topTheme = themes[0];
  setChartNote(
    'chartDissentThemesNote',
    `Shows most frequent dissent themes in the latest cycle. Result: "${topTheme.theme}" is top with ${topTheme.count} mention(s).`,
  );
  const themeDetails = themes.map((theme) => `${theme.theme}: ${theme.count}`).join('; ');
  setChartData('chartDissentThemesData', `Dissent-theme data in latest cycle: ${themeDetails}.`);
}

async function renderCharts(payload) {
  if (!hasPlotly()) {
    setChartFallback('chartSwitchTrend', 'Chart library unavailable in this browser context.');
    setChartFallback('chartDecisionMix', 'Chart library unavailable in this browser context.');
    setChartFallback('chartDissentThemes', 'Chart library unavailable in this browser context.');
    setChartNote('chartSwitchTrendNote', 'Switch-now trend could not be rendered because Plotly failed to load.');
    setChartNote('chartDecisionMixNote', 'Decision-mix chart could not be rendered because Plotly failed to load.');
    setChartNote('chartDissentThemesNote', 'Dissent-theme chart could not be rendered because Plotly failed to load.');
    setChartData('chartSwitchTrendData', 'Switch-now trend data unavailable because Plotly failed to load.');
    setChartData('chartDecisionMixData', 'Decision-mix data unavailable because Plotly failed to load.');
    setChartData('chartDissentThemesData', 'Dissent-theme data unavailable because Plotly failed to load.');
    return { total: 3, failed: 3, plotlyAvailable: false };
  }

  const renderers = [
    {
      id: 'chartSwitchTrend',
      noteId: 'chartSwitchTrendNote',
      label: 'Switch-now trend chart',
      run: () => renderSwitchTrendChart(payload),
    },
    {
      id: 'chartDecisionMix',
      noteId: 'chartDecisionMixNote',
      label: 'Decision-mix chart',
      run: () => renderDecisionMixChart(payload),
    },
    {
      id: 'chartDissentThemes',
      noteId: 'chartDissentThemesNote',
      label: 'Dissent-themes chart',
      run: () => renderDissentThemeChart(payload),
    },
  ];

  let failed = 0;
  for (const entry of renderers) {
    try {
      await entry.run();
    } catch (error) {
      failed += 1;
      setChartFallback(entry.id, `${entry.label} failed to render.`);
      setChartNote(entry.noteId, `${entry.label} failed to render in this browser context.`);
      if (entry.id === 'chartSwitchTrend') {
        setChartData('chartSwitchTrendData', 'Switch-now trend data unavailable because chart rendering failed.');
      } else if (entry.id === 'chartDecisionMix') {
        setChartData('chartDecisionMixData', 'Decision-mix data unavailable because chart rendering failed.');
      } else if (entry.id === 'chartDissentThemes') {
        setChartData('chartDissentThemesData', 'Dissent-theme data unavailable because chart rendering failed.');
      }
    }
  }
  return { total: renderers.length, failed, plotlyAvailable: true };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadChart(targetId, fileName) {
  if (!hasPlotly()) {
    return { ok: false, message: 'Plotly is unavailable.' };
  }

  const host = document.getElementById(targetId);
  if (!host) {
    return { ok: false, message: `Missing chart container: ${targetId}` };
  }

  try {
    await globalThis.Plotly.downloadImage(host, {
      format: 'png',
      filename: `${fileName}_${new Date().toISOString().slice(0, 10)}`,
      width: 1100,
      height: 520,
    });
    return { ok: true, message: 'ok' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: reason };
  }
}

function wireChartDownloads() {
  const buttons = [...document.querySelectorAll('[data-chart-download]')];
  const allButton = document.getElementById('downloadAllCharts');
  const downloadsEnabled = hasPlotly();

  for (const button of buttons) {
    button.disabled = !downloadsEnabled;
    button.setAttribute('aria-disabled', String(!downloadsEnabled));
    button.dataset.busy = '0';
    button.addEventListener('click', async () => {
      if (!downloadsEnabled || button.dataset.busy === '1') return;
      const targetId = button.dataset.chartDownload;
      const fileName = button.dataset.chartFile || targetId || 'chart';
      button.dataset.busy = '1';
      const shouldRestoreFocus = document.activeElement === button;
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      setActionStatus(`Downloading ${fileName}...`);
      try {
        const result = await downloadChart(targetId, fileName);
        if (result.ok) {
          setActionStatus(`Downloaded ${fileName}.`);
        } else {
          setActionStatus(`Download failed for ${fileName}: ${result.message}`);
        }
      } finally {
        button.dataset.busy = '0';
        button.disabled = false;
        button.setAttribute('aria-disabled', 'false');
        if (shouldRestoreFocus) button.focus();
      }
    });
  }

  if (!allButton) return;
  allButton.disabled = !downloadsEnabled;
  allButton.setAttribute('aria-disabled', String(!downloadsEnabled));
  allButton.dataset.busy = '0';
  allButton.addEventListener('click', async () => {
    if (!downloadsEnabled || allButton.dataset.busy === '1') return;
    allButton.dataset.busy = '1';
    const shouldRestoreFocus = document.activeElement === allButton;
    allButton.disabled = true;
    allButton.setAttribute('aria-disabled', 'true');
    setActionStatus('Downloading all charts...');
    let successCount = 0;
    let failCount = 0;

    try {
      for (const button of buttons) {
        const targetId = button.dataset.chartDownload;
        const fileName = button.dataset.chartFile || targetId || 'chart';
        const result = await downloadChart(targetId, fileName);
        if (result.ok) {
          successCount += 1;
        } else {
          failCount += 1;
        }
        await wait(180);
      }
    } finally {
      allButton.dataset.busy = '0';
      allButton.disabled = false;
      allButton.setAttribute('aria-disabled', 'false');
      if (shouldRestoreFocus) allButton.focus();
    }

    setActionStatus(`Download all complete: ${successCount} succeeded, ${failCount} failed.`);
  });
}

async function loadDashboardData() {
  const response = await fetch('./data/review-dashboard.json', { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading dashboard data`);
  }
  return response.json();
}

function renderCore(payload) {
  renderKpis(payload);
  renderCycleRows(payload);
  renderThemes(payload);
  renderBlockers(payload);
  renderMeta(payload);
}

async function boot() {
  let rawPayload;
  try {
    rawPayload = await loadDashboardData();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderError(
      `Failed to load ./data/review-dashboard.json (${message}). Run "npm run review:dashboard-data" and serve public/ via a local HTTP server.`,
    );
    return;
  }

  let payload;
  try {
    payload = normalizePayload(rawPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderError(`Invalid dashboard payload format: ${message}`);
    return;
  }

  try {
    renderCore(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderError(`Dashboard rendering failed: ${message}`);
    return;
  }

  await loadPlotlyWithTimeout();
  const chartSummary = await renderCharts(payload);
  wireChartDownloads();
  if (!chartSummary.plotlyAvailable) {
    setActionStatus('Charts are unavailable because Plotly did not load. Download buttons are disabled.');
    return;
  }
  if (chartSummary.failed > 0) {
    setActionStatus(`Charts loaded with ${chartSummary.failed} rendering issue(s). Download completed charts individually.`);
    return;
  }
  setActionStatus('Charts and downloads are ready.');
}

boot();
