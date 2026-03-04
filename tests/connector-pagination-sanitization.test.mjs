import test from 'node:test';
import assert from 'node:assert/strict';

import { ctgovConnector } from '../src/data/connectors/ctgov.js';
import { pubmedConnector } from '../src/data/connectors/pubmed.js';
import { openalexConnector } from '../src/data/connectors/openalex.js';
import { europePmcConnector } from '../src/data/connectors/europepmc.js';
import { aactConnector } from '../src/data/connectors/aact.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('connectors sanitize non-finite pagination values before issuing requests', async (t) => {
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const asText = String(url);
    fetchCalls.push(asText);
    if (asText.includes('clinicaltrials.gov')) return jsonResponse({ studies: [] });
    if (asText.includes('/esearch.fcgi')) return jsonResponse({ esearchresult: { idlist: [] } });
    if (asText.includes('api.openalex.org')) return jsonResponse({ results: [] });
    if (asText.includes('europepmc/webservices/rest/search')) {
      return jsonResponse({ resultList: { result: [] } });
    }
    if (asText.includes('127.0.0.1:8765')) return jsonResponse({ trials: [] });
    throw new Error(`Unexpected URL in connector test: ${asText}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await ctgovConnector.fetchTrials({
    query: { condition: 'cardiovascular', term: 'heart' },
    limit: 'not-a-number',
  });
  await pubmedConnector.fetchTrials({
    query: { condition: 'cardiovascular', term: 'heart' },
    limit: 'NaN',
  });
  await openalexConnector.fetchTrials({
    query: { term: 'cardiovascular' },
    limit: 'bad-limit',
    offset: 'bad-offset',
  });
  await europePmcConnector.fetchTrials({
    query: { condition: 'cardiovascular', term: 'heart' },
    limit: 'invalid',
  });
  await aactConnector.fetchTrials({
    query: { category: 'cardiovascular' },
    limit: 'invalid',
    offset: 'invalid',
  });

  const ctgovUrl = fetchCalls.find((url) => url.includes('clinicaltrials.gov'));
  assert.ok(ctgovUrl);
  assert.equal(new URL(ctgovUrl).searchParams.get('pageSize'), '100');

  const pubmedSearchUrl = fetchCalls.find((url) => url.includes('/esearch.fcgi'));
  assert.ok(pubmedSearchUrl);
  assert.equal(new URL(pubmedSearchUrl).searchParams.get('retmax'), '50');

  const openalexUrl = fetchCalls.find((url) => url.includes('api.openalex.org'));
  assert.ok(openalexUrl);
  assert.equal(new URL(openalexUrl).searchParams.get('per-page'), '50');
  assert.equal(new URL(openalexUrl).searchParams.get('page'), '1');

  const europePmcUrl = fetchCalls.find((url) => url.includes('europepmc/webservices/rest/search'));
  assert.ok(europePmcUrl);
  assert.equal(new URL(europePmcUrl).searchParams.get('pageSize'), '50');

  const aactUrl = fetchCalls.find((url) => url.includes('127.0.0.1:8765'));
  assert.ok(aactUrl);
  assert.equal(new URL(aactUrl).searchParams.get('limit'), '1000');
  assert.equal(new URL(aactUrl).searchParams.get('offset'), '0');
});

