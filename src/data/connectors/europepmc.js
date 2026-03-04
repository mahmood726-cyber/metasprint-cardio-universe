import { clampInteger, fetchWithRetry } from './base.js';
import { createRateLimiter } from './rate-limit.js';

const waitEuropePmc = createRateLimiter(10);
const EUROPE_PMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

function buildQuery(query) {
  const condition = String(query?.condition ?? 'cardiovascular').trim();
  const term = String(query?.term ?? 'heart failure').trim();
  const parts = [];
  if (condition) parts.push(`(${condition})`);
  if (term) parts.push(`(${term})`);
  return parts.join(' AND ') || 'cardiovascular';
}

function normalizeDoi(value) {
  if (!value) return null;
  return String(value).replace(/^https?:\/\/doi\.org\//i, '').trim() || null;
}

export const europePmcConnector = {
  id: 'europepmc',
  async fetchTrials(request) {
    const policy = request?.connectorPolicy ?? {};
    const limit = clampInteger(request?.limit, { min: 1, max: 100, fallback: 50 });
    const cursorMark = request?.query?.cursorMark ? String(request.query.cursorMark) : '*';

    const params = new URLSearchParams();
    params.set('query', buildQuery(request?.query));
    params.set('resultType', 'core');
    params.set('format', 'json');
    params.set('pageSize', String(limit));
    params.set('cursorMark', cursorMark);
    const url = `${EUROPE_PMC_BASE}?${params.toString()}`;

    const response = await fetchWithRetry({
      connectorId: 'europepmc',
      url,
      init: { method: 'GET' },
      timeoutMs: policy.timeoutMs,
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
      rateWait: waitEuropePmc,
    });
    const rows = Array.isArray(response?.json?.resultList?.result) ? response.json.resultList.result : [];

    return {
      rows: rows.map((row) => {
        const year = Number.isFinite(Number(row?.pubYear)) ? Number(row.pubYear) : null;
        const pmid = row?.pmid ? String(row.pmid) : null;
        const doi = normalizeDoi(row?.doi);

        return {
          id: row?.id ? String(row.id) : pmid ? `PMID${pmid}` : String(row?.source ?? 'europepmc'),
          title: row?.title ?? 'Untitled publication',
          pmid,
          doi,
          year,
          startDate: year != null ? `${year}-01-01` : null,
          enrollment: 0,
          sourceType: 'publication',
        };
      }),
      meta: {
        attempts: response.attempts,
        statusCode: response.statusCode,
      },
    };
  },
};
