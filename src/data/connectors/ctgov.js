import { clampInteger, fetchWithRetry } from './base.js';

function buildCtGovUrl(query, pageSize = 100, pageToken = null) {
  const normalizedPageSize = clampInteger(pageSize, { min: 1, max: 1000, fallback: 100 });
  const params = new URLSearchParams();
  if (query?.condition) params.set('query.cond', String(query.condition));
  if (query?.term) params.set('query.term', String(query.term));
  if (pageToken) params.set('pageToken', String(pageToken));
  params.set('pageSize', String(normalizedPageSize));
  params.set('format', 'json');
  return `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;
}

export const ctgovConnector = {
  id: 'ctgov',
  async fetchTrials(request) {
    const targetLimit = clampInteger(request?.limit, { min: 1, max: 5000, fallback: 100 });
    const policy = request?.connectorPolicy ?? {};
    const rows = [];
    let nextPageToken = null;
    let totalAttempts = 0;
    let statusCode = null;
    let pagesFetched = 0;

    while (rows.length < targetLimit) {
      const remaining = targetLimit - rows.length;
      const pageSize = Math.min(1000, remaining);
      const url = buildCtGovUrl(request.query, pageSize, nextPageToken);
      const response = await fetchWithRetry({
        connectorId: 'ctgov',
        url,
        init: { method: 'GET' },
        timeoutMs: policy.timeoutMs,
        maxAttempts: policy.maxAttempts,
        baseDelayMs: policy.baseDelayMs,
      });
      totalAttempts += Number(response?.attempts ?? 1);
      statusCode = response?.statusCode ?? statusCode;
      pagesFetched += 1;

      const pageRows = Array.isArray(response?.json?.studies) ? response.json.studies : [];
      rows.push(...pageRows);
      const candidateNext = String(response?.json?.nextPageToken ?? '').trim();
      nextPageToken = candidateNext || null;

      if (pageRows.length === 0 || !nextPageToken) break;
    }

    return {
      rows: rows.slice(0, targetLimit),
      meta: {
        attempts: totalAttempts,
        statusCode,
        pagesFetched,
        requestedLimit: targetLimit,
      },
    };
  },
};
