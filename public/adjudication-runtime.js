import {
  parseOverrideQueue,
  loadDecisions,
  saveDecision,
  removeDecision,
  setReviewerId,
  getReviewerId,
  detectConflicts,
  exportOverridesJson,
  importOverridesJson,
} from '../src/engine/adjudication/index.js';

const QUEUE_CSV_PATH = '../reports/dedup/override-queue.csv';

const state = {
  queue: [],
  filter: 'all',
};

function byId(id) {
  return document.getElementById(id);
}

function scoreClass(score) {
  if (score >= 0.9) return 'high';
  if (score >= 0.7) return 'medium';
  return 'low';
}

function getDecisionForPair(pairId) {
  const store = loadDecisions(localStorage);
  return store.decisions[pairId] ?? null;
}

function getReviewer() {
  return byId('reviewerInput').value.trim() || getReviewerId(localStorage);
}

function updateStats() {
  const store = loadDecisions(localStorage);
  const decided = state.queue.filter((q) => store.decisions[q.pairId]).length;
  const pending = state.queue.length - decided;

  const allDecisions = store.decisions;
  const reviewerGroups = {};
  for (const [pid, entry] of Object.entries(allDecisions)) {
    if (!reviewerGroups[pid]) reviewerGroups[pid] = [];
    reviewerGroups[pid].push(entry);
  }

  let conflictCount = 0;
  for (const q of state.queue) {
    const d = allDecisions[q.pairId];
    if (d && q.recommendedDecision && d.decision !== q.recommendedDecision && d.decision !== 'clear') {
      conflictCount += 1;
    }
  }

  byId('statTotal').textContent = String(state.queue.length);
  byId('statDecided').textContent = String(decided);
  byId('statPending').textContent = String(pending);
  byId('statConflicts').textContent = String(conflictCount);
}

function renderRow(item, index) {
  const decision = getDecisionForPair(item.pairId);
  const decisionValue = decision?.decision ?? 'pending';
  const hasConflict = decision && item.recommendedDecision &&
    decision.decision !== item.recommendedDecision && decision.decision !== 'clear';

  const tr = document.createElement('tr');
  if (hasConflict) tr.classList.add('conflict');
  tr.dataset.pairId = item.pairId;

  tr.innerHTML = `
    <td>${index + 1}</td>
    <td><span class="score-badge ${scoreClass(item.score)}">${item.score.toFixed(2)}</span></td>
    <td title="${item.leftTrialId}">${item.leftTrialId}</td>
    <td title="${item.rightTrialId}">${item.rightTrialId}</td>
    <td>${item.leftSource} / ${item.rightSource}</td>
    <td><span class="decision-badge ${item.recommendedDecision || 'pending'}">${item.recommendedDecision || 'none'}</span></td>
    <td><span class="decision-badge ${decisionValue}">${decisionValue}</span></td>
    <td class="action-btns">
      <button class="merge-btn" data-action="merge" data-pair="${item.pairId}" type="button">Merge</button>
      <button class="split-btn" data-action="split" data-pair="${item.pairId}" type="button">Split</button>
      <button data-action="clear" data-pair="${item.pairId}" type="button">Clear</button>
    </td>
  `;
  return tr;
}

function renderTable() {
  const tbody = byId('queueBody');
  const empty = byId('emptyState');
  tbody.replaceChildren();

  if (state.queue.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const store = loadDecisions(localStorage);
  const filtered = state.queue.filter((item) => {
    const d = store.decisions[item.pairId];
    if (state.filter === 'pending') return !d;
    if (state.filter === 'decided') return !!d;
    if (state.filter === 'conflicts') {
      return d && item.recommendedDecision &&
        d.decision !== item.recommendedDecision && d.decision !== 'clear';
    }
    return true;
  });

  for (let i = 0; i < filtered.length; i++) {
    tbody.appendChild(renderRow(filtered[i], i));
  }

  updateStats();
}

async function loadQueue() {
  try {
    const response = await fetch(QUEUE_CSV_PATH);
    if (!response.ok) {
      byId('emptyState').innerHTML =
        '<p>Could not load override queue.</p><p>Make sure the dedup pipeline has been run.</p>';
      return;
    }
    const csv = await response.text();
    state.queue = parseOverrideQueue(csv);

    if (state.queue.length === 0) {
      byId('emptyState').innerHTML =
        '<p>Override queue is empty.</p><p>No duplicate pairs require adjudication.</p>';
    }

    renderTable();
  } catch (err) {
    byId('emptyState').innerHTML =
      `<p>Error loading queue: ${err.message}</p>`;
  }
}

function handleDecision(pairId, decision) {
  const reviewer = getReviewer();
  if (!reviewer) {
    byId('reviewerInput').focus();
    byId('reviewerInput').style.outline = '2px solid #b91c1c';
    setTimeout(() => { byId('reviewerInput').style.outline = ''; }, 1500);
    return;
  }

  if (decision === 'clear') {
    removeDecision(pairId, localStorage);
  } else {
    const actionMap = { merge: 'force_merge', split: 'force_split' };
    saveDecision(pairId, actionMap[decision] ?? decision, reviewer, '', localStorage);
  }

  renderTable();
}

function exportDecisions() {
  const store = loadDecisions(localStorage);
  const json = exportOverridesJson(store.decisions);
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'overrides.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importDecisions(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      const store = loadDecisions(localStorage);
      const { merged, conflicts } = importOverridesJson(json, store.decisions);

      if (conflicts.length > 0) {
        const msg = conflicts.slice(0, 5).map((c) =>
          `${c.pairId}: ${c.existing.reviewer}=${c.existing.decision} vs ${c.imported.reviewer}=${c.imported.decision}`
        ).join('\n');
        if (!confirm(`${conflicts.length} conflict(s) found. Import will overwrite.\n\n${msg}\n\nContinue?`)) {
          return;
        }
      }

      const newStore = { decisions: merged, reviewerId: store.reviewerId };
      localStorage.setItem('metasprint_adjudication_decisions', JSON.stringify(newStore));
      renderTable();
    } catch (err) {
      alert(`Import error: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function init() {
  const savedReviewer = getReviewerId(localStorage);
  if (savedReviewer) {
    byId('reviewerInput').value = savedReviewer;
  }

  byId('reviewerInput').addEventListener('change', (e) => {
    setReviewerId(e.target.value.trim(), localStorage);
  });

  byId('loadQueueBtn').addEventListener('click', loadQueue);

  byId('exportBtn').addEventListener('click', exportDecisions);

  byId('importBtn').addEventListener('click', () => {
    byId('importFile').click();
  });
  byId('importFile').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importDecisions(file);
    e.target.value = '';
  });

  byId('filterTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    for (const tab of byId('filterTabs').querySelectorAll('.tab-btn')) {
      tab.classList.toggle('active', tab.dataset.filter === state.filter);
    }
    renderTable();
  });

  byId('queueBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const pairId = btn.dataset.pair;
    if (action && pairId) {
      handleDecision(pairId, action);
    }
  });

  loadQueue();
}

init();
