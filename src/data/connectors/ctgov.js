import { clampInteger, fetchWithRetry } from './base.js';

function buildCtGovUrl(query, limit = 100) {
  const pageSize = clampInteger(limit, { min: 1, max: 1000, fallback: 100 });
  const params = new URLSearchParams();
  if (query?.condition) params.set('query.cond', String(query.condition));
  if (query?.term) params.set('query.term', String(query.term));
  params.set('pageSize', String(pageSize));
  params.set('format', 'json');
  return `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;
}

export const ctgovConnector = {
  id: 'ctgov',
  async fetchTrials(request) {
    const url = buildCtGovUrl(request.query, request.limit ?? 100);
    const policy = request?.connectorPolicy ?? {};
    const response = await fetchWithRetry({
      connectorId: 'ctgov',
      url,
      init: { method: 'GET' },
      timeoutMs: policy.timeoutMs,
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
    });
    const rows = Array.isArray(response?.json?.studies) ? response.json.studies : [];
    return {
      rows,
      meta: {
        attempts: response.attempts,
        statusCode: response.statusCode,
      },
    };
  },
};
