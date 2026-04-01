function trimVal(value) {
  return String(value ?? '').trim();
}

export function parseOverrideQueue(csvText) {
  const text = String(csvText ?? '').trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(trimVal);
  const colIndex = {};
  for (let i = 0; i < header.length; i++) {
    colIndex[header[i]] = i;
  }

  const requiredCols = ['pair_id', 'left_trial_id', 'right_trial_id'];
  for (const col of requiredCols) {
    if (colIndex[col] == null) return [];
  }

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map(trimVal);
    if (cols.length < header.length) continue;

    const pairId = cols[colIndex['pair_id']] ?? '';
    const leftTrialId = cols[colIndex['left_trial_id']] ?? '';
    const rightTrialId = cols[colIndex['right_trial_id']] ?? '';
    if (!pairId || !leftTrialId || !rightTrialId) continue;

    const scoreRaw = parseFloat(cols[colIndex['score']] ?? '');

    results.push({
      pairId,
      leftTrialId,
      rightTrialId,
      leftSource: cols[colIndex['left_source']] ?? '',
      rightSource: cols[colIndex['right_source']] ?? '',
      score: Number.isFinite(scoreRaw) ? scoreRaw : 0,
      recommendedDecision: cols[colIndex['recommended_decision']] ?? '',
      status: cols[colIndex['status']] ?? 'pending',
      generatedAt: cols[colIndex['generated_at']] ?? '',
    });
  }

  return results;
}
