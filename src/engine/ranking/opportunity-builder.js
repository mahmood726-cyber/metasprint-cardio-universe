export function buildOpportunities(trials, matrixSummary) {
  const rows = Array.isArray(matrixSummary?.rows) ? matrixSummary.rows : [];
  const columns = Array.isArray(matrixSummary?.columns) ? matrixSummary.columns : [];

  if (rows.length === 0 || columns.length === 0) return [];

  const trialById = new Map();
  for (const trial of trials) {
    if (trial?.trialId) trialById.set(String(trial.trialId), trial);
  }

  const currentYear = new Date().getFullYear();
  const opportunities = [];

  for (const row of rows) {
    for (const cell of row.cells ?? []) {
      const count = Number(cell.count ?? 0);
      if (count <= 0) continue;

      const trialIds = Array.isArray(cell.trialIds) ? cell.trialIds.map(String) : [];
      const linkedTrials = trialIds.map((id) => trialById.get(id)).filter(Boolean);

      let totalEnrollment = 0;
      let minYear = Infinity;
      let maxYear = -Infinity;
      let recentTrials = 0;
      const sourceSet = new Set();

      for (const trial of linkedTrials) {
        totalEnrollment += Number.isFinite(trial.enrollment) ? trial.enrollment : 0;
        const year = Number(trial.year);
        if (Number.isFinite(year)) {
          if (year < minYear) minYear = year;
          if (year > maxYear) maxYear = year;
          if (year >= currentYear - 3) recentTrials += 1;
        }
        if (trial.source) sourceSet.add(String(trial.source));
      }

      const colMeta = columns.find((col) => col.id === cell.id);

      opportunities.push({
        id: `opp_${row.id}__${cell.id}`,
        interventionClassId: row.id,
        interventionLabel: row.label ?? row.id,
        endpointDomainId: cell.id,
        endpointLabel: colMeta?.label ?? cell.id,
        trialIds,
        trialCount: trialIds.length,
        recentTrials,
        totalEnrollment,
        yearRange: Number.isFinite(minYear) && Number.isFinite(maxYear) ? [minYear, maxYear] : [null, null],
        sourceCount: sourceSet.size,
      });
    }
  }

  return opportunities;
}
