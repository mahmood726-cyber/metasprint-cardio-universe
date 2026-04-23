import { pairKey } from '../identity/overrides.js';

const STORAGE_KEY = 'metasprint-v1-adjudication-decisions';
// Pre-versioning key. Migrated on first load via readStore() and then removed.
const LEGACY_STORAGE_KEY = 'metasprint_adjudication_decisions';

function parseStoreRaw(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      decisions: parsed?.decisions && typeof parsed.decisions === 'object' ? parsed.decisions : {},
      reviewerId: typeof parsed?.reviewerId === 'string' ? parsed.reviewerId : '',
    };
  } catch {
    return null;
  }
}

function readStore(storage) {
  const versioned = parseStoreRaw(storage.getItem(STORAGE_KEY));
  if (versioned) return versioned;

  const legacy = parseStoreRaw(storage.getItem(LEGACY_STORAGE_KEY));
  if (legacy) {
    // One-shot migration: copy legacy payload into the versioned key so
    // future reads short-circuit, then drop the legacy key so an old build
    // running concurrently sees a clean state instead of stale data.
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      storage.removeItem(LEGACY_STORAGE_KEY);
    } catch { /* storage write failed — return data anyway */ }
    return legacy;
  }

  return { decisions: {}, reviewerId: '' };
}

function writeStore(data, storage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadDecisions(storage) {
  return readStore(storage);
}

export function saveDecision(pairId, decision, reviewer, reason, storage) {
  const store = readStore(storage);
  store.decisions[pairId] = {
    pairId,
    decision,
    reviewer: reviewer || '',
    reason: reason || '',
    decidedAt: new Date().toISOString(),
  };
  writeStore(store, storage);
}

export function removeDecision(pairId, storage) {
  const store = readStore(storage);
  delete store.decisions[pairId];
  writeStore(store, storage);
}

export function setReviewerId(id, storage) {
  const store = readStore(storage);
  store.reviewerId = String(id ?? '');
  writeStore(store, storage);
}

export function getReviewerId(storage) {
  return readStore(storage).reviewerId;
}

export function detectConflicts(existingDecisions, importedDecisions) {
  const conflicts = [];
  for (const [pid, imported] of Object.entries(importedDecisions)) {
    const existing = existingDecisions[pid];
    if (!existing) continue;
    if (existing.reviewer !== imported.reviewer && existing.decision !== imported.decision) {
      conflicts.push({
        pairId: pid,
        existing: { reviewer: existing.reviewer, decision: existing.decision, decidedAt: existing.decidedAt },
        imported: { reviewer: imported.reviewer, decision: imported.decision, decidedAt: imported.decidedAt },
      });
    }
  }
  return conflicts;
}

function splitPairId(pid) {
  const parts = String(pid).split('::');
  return { left: parts[0] ?? '', right: parts[1] ?? '' };
}

export function exportOverridesJson(decisions) {
  const forceMerge = [];
  const forceSplit = [];

  for (const entry of Object.values(decisions)) {
    if (entry.decision === 'clear') continue;
    const { left, right } = splitPairId(entry.pairId);
    const record = {
      leftTrialId: left,
      rightTrialId: right,
      decision: entry.decision,
      reason: entry.reason ?? null,
      reviewer: entry.reviewer ?? null,
      decidedAt: entry.decidedAt ?? null,
    };
    if (entry.decision === 'force_merge') forceMerge.push(record);
    else if (entry.decision === 'force_split') forceSplit.push(record);
  }

  return { forceMerge, forceSplit };
}

export function importOverridesJson(json, existingDecisions) {
  const incoming = {};
  const forceMerge = Array.isArray(json?.forceMerge) ? json.forceMerge : [];
  const forceSplit = Array.isArray(json?.forceSplit) ? json.forceSplit : [];

  for (const entry of forceMerge) {
    const pid = pairKey(entry.leftTrialId, entry.rightTrialId);
    incoming[pid] = {
      pairId: pid,
      decision: 'force_merge',
      reviewer: entry.reviewer ?? '',
      reason: entry.reason ?? '',
      decidedAt: entry.decidedAt ?? new Date().toISOString(),
    };
  }
  for (const entry of forceSplit) {
    const pid = pairKey(entry.leftTrialId, entry.rightTrialId);
    incoming[pid] = {
      pairId: pid,
      decision: 'force_split',
      reviewer: entry.reviewer ?? '',
      reason: entry.reason ?? '',
      decidedAt: entry.decidedAt ?? new Date().toISOString(),
    };
  }

  const conflicts = detectConflicts(existingDecisions, incoming);
  const merged = { ...existingDecisions, ...incoming };

  return { merged, conflicts };
}
