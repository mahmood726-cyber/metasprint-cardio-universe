export function pairKey(leftId, rightId) {
  const a = String(leftId);
  const b = String(rightId);
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function normalizeEntry(entry, decision) {
  const left = entry?.leftTrialId ?? entry?.left ?? entry?.from ?? null;
  const right = entry?.rightTrialId ?? entry?.right ?? entry?.to ?? null;
  if (!left || !right) return null;
  return {
    leftTrialId: String(left),
    rightTrialId: String(right),
    decision,
    reason: entry?.reason ? String(entry.reason) : null,
    reviewer: entry?.reviewer ? String(entry.reviewer) : null,
    decidedAt: entry?.decidedAt ? String(entry.decidedAt) : null,
  };
}

export function normalizeOverrides(raw) {
  const forceMerge = Array.isArray(raw?.forceMerge) ? raw.forceMerge : [];
  const forceSplit = Array.isArray(raw?.forceSplit) ? raw.forceSplit : [];

  return {
    forceMerge: forceMerge.map((entry) => normalizeEntry(entry, 'force_merge')).filter(Boolean),
    forceSplit: forceSplit.map((entry) => normalizeEntry(entry, 'force_split')).filter(Boolean),
  };
}

function detectOverrideConflicts(normalized) {
  const mergeKeys = new Set(
    normalized.forceMerge.map((entry) => pairKey(entry.leftTrialId, entry.rightTrialId)),
  );
  const conflicts = [];
  for (const entry of normalized.forceSplit) {
    const key = pairKey(entry.leftTrialId, entry.rightTrialId);
    if (mergeKeys.has(key)) conflicts.push(key);
  }
  return conflicts;
}

export function buildOverrideMap(raw) {
  const normalized = normalizeOverrides(raw);
  const conflicts = detectOverrideConflicts(normalized);
  if (conflicts.length > 0) {
    const preview = conflicts.slice(0, 10).join(', ');
    throw new Error(
      `Conflicting override rules found for ${conflicts.length} pair(s): ${preview}${conflicts.length > 10 ? ', ...' : ''}`,
    );
  }
  const map = new Map();

  for (const entry of normalized.forceMerge) {
    map.set(pairKey(entry.leftTrialId, entry.rightTrialId), entry);
  }
  for (const entry of normalized.forceSplit) {
    map.set(pairKey(entry.leftTrialId, entry.rightTrialId), entry);
  }

  return {
    normalized,
    map,
  };
}
