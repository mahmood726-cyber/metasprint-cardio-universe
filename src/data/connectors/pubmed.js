import { clampInteger, fetchWithRetry } from './base.js';
import { createRateLimiter } from './rate-limit.js';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const waitNoKey = createRateLimiter(3);
const waitWithKey = createRateLimiter(10);

function parseYear(text) {
  const match = String(text ?? '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function buildSearchTerm(query) {
  const chunks = [
    String(query?.condition ?? 'cardiovascular').trim(),
    String(query?.term ?? 'heart failure').trim(),
  ].filter(Boolean);
  if (chunks.length === 0) return 'cardiovascular';
  return chunks.map((value) => `(${value})`).join(' AND ');
}

function pickDoi(articleIds) {
  if (!Array.isArray(articleIds)) return null;
  const doi = articleIds.find((entry) => String(entry?.idtype).toLowerCase() === 'doi');
  return doi?.value ? String(doi.value) : null;
}

export const pubmedConnector = {
  id: 'pubmed',
  async fetchTrials(request) {
    const limit = clampInteger(request?.limit, { min: 1, max: 200, fallback: 50 });
    const env = globalThis?.process?.env ?? {};
    const policy = request?.connectorPolicy ?? {};
    const apiKey = request?.query?.apiKey
      ? String(request.query.apiKey)
      : env.NCBI_API_KEY
        ? String(env.NCBI_API_KEY)
        : null;
    const wait = apiKey ? waitWithKey : waitNoKey;

    const searchParams = new URLSearchParams();
    searchParams.set('db', 'pubmed');
    searchParams.set('retmode', 'json');
    searchParams.set('retmax', String(limit));
    searchParams.set('term', buildSearchTerm(request?.query));
    if (apiKey) searchParams.set('api_key', apiKey);

    const searchUrl = `${EUTILS_BASE}/esearch.fcgi?${searchParams.toString()}`;
    const searchResponse = await fetchWithRetry({
      connectorId: 'pubmed',
      url: searchUrl,
      init: { method: 'GET' },
      timeoutMs: policy.timeoutMs,
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
      rateWait: wait,
    });
    const ids = searchResponse?.json?.esearchresult?.idlist;
    if (!Array.isArray(ids) || ids.length === 0) {
      return {
        rows: [],
        meta: {
          attempts: searchResponse.attempts,
          statusCode: searchResponse.statusCode,
        },
      };
    }

    const summaryParams = new URLSearchParams();
    summaryParams.set('db', 'pubmed');
    summaryParams.set('retmode', 'json');
    summaryParams.set('id', ids.join(','));
    if (apiKey) summaryParams.set('api_key', apiKey);

    const summaryUrl = `${EUTILS_BASE}/esummary.fcgi?${summaryParams.toString()}`;
    const summaryResponse = await fetchWithRetry({
      connectorId: 'pubmed',
      url: summaryUrl,
      init: { method: 'GET' },
      timeoutMs: policy.timeoutMs,
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
      rateWait: wait,
    });
    const result = summaryResponse?.json?.result ?? {};

    const rows = ids
      .map((id) => result[id])
      .filter(Boolean)
      .map((entry) => {
        const pmid = String(entry.uid ?? '');
        const year = parseYear(entry.pubdate ?? entry.sortpubdate ?? entry.epubdate);
        const doi = pickDoi(entry.articleids);
        return {
          id: `PMID${pmid}`,
          pmid,
          doi,
          title: entry.title ?? 'Untitled publication',
          year,
          startDate: year != null ? `${year}-01-01` : null,
          enrollment: 0,
          sourceType: 'publication',
        };
      });

    return {
      rows,
      meta: {
        attempts: searchResponse.attempts + summaryResponse.attempts,
        statusCode: summaryResponse.statusCode,
      },
    };
  },
};
