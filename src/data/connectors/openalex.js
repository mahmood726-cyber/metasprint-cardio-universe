import { clampInteger, ConnectorError, fetchWithRetry } from './base.js';
import { createRateLimiter, createRequestBudget } from './rate-limit.js';

const waitOpenAlex = createRateLimiter(10);
const processEnv = globalThis?.process?.env ?? {};
const defaultBudget = clampInteger(processEnv.OPENALEX_DAILY_BUDGET, {
  min: 1,
  max: 10_000_000,
  fallback: 5000,
});
const budget = createRequestBudget(defaultBudget, 'openalex daily budget');

function extractPmid(value) {
  const text = String(value ?? '');
  const match = text.match(/(\d{5,12})/);
  return match ? match[1] : null;
}

function normalizeDoi(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.replace(/^https?:\/\/doi\.org\//i, '');
}

export const openalexConnector = {
  id: 'openalex',
  async fetchTrials(request) {
    const limit = clampInteger(request?.limit, { min: 1, max: 200, fallback: 50 });
    const offset = clampInteger(request?.offset, { min: 0, fallback: 0 });
    const page = Math.floor(offset / limit) + 1;
    const policy = request?.connectorPolicy ?? {};
    const queryTerm = String(request?.query?.term ?? request?.query?.condition ?? 'cardiovascular').trim();
    const apiKey = request?.query?.apiKey
      ? String(request.query.apiKey)
      : processEnv.OPENALEX_API_KEY
        ? String(processEnv.OPENALEX_API_KEY)
        : null;
    const mailto = request?.query?.mailto
      ? String(request.query.mailto)
      : processEnv.OPENALEX_EMAIL
        ? String(processEnv.OPENALEX_EMAIL)
        : null;

    try {
      budget.reserve();
    } catch (error) {
      throw new ConnectorError(`openalex ${error instanceof Error ? error.message : String(error)}`, {
        connectorId: 'openalex',
        failureClass: 'budget_exhausted',
        retryable: false,
        attempts: 1,
        cause: error instanceof Error ? error : undefined,
      });
    }

    const params = new URLSearchParams();
    params.set('search', queryTerm || 'cardiovascular');
    params.set('per-page', String(limit));
    params.set('page', String(page));
    if (apiKey) params.set('api_key', apiKey);
    if (mailto) params.set('mailto', mailto);

    const url = `https://api.openalex.org/works?${params.toString()}`;
    const response = await fetchWithRetry({
      connectorId: 'openalex',
      url,
      init: { method: 'GET' },
      timeoutMs: policy.timeoutMs,
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
      rateWait: waitOpenAlex,
    });
    const works = Array.isArray(response?.json?.results) ? response.json.results : [];

    const rows = works.map((work) => {
      const pmid = extractPmid(work?.ids?.pmid);
      const doi = normalizeDoi(work?.ids?.doi ?? work?.doi);
      const year = Number.isFinite(Number(work?.publication_year)) ? Number(work.publication_year) : null;

      return {
        id: String(work?.id ?? ''),
        title: work?.display_name ?? 'Untitled publication',
        pmid,
        doi,
        year,
        startDate: year != null ? `${year}-01-01` : null,
        enrollment: 0,
        sourceType: 'publication',
      };
    });

    return {
      rows,
      meta: {
        attempts: response.attempts,
        statusCode: response.statusCode,
      },
    };
  },
};
