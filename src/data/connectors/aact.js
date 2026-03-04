import { clampInteger, ConnectorError, fetchWithRetry } from './base.js';

const DEFAULT_AACT_PROXY = 'http://127.0.0.1:8765';
const processEnv = globalThis?.process?.env ?? {};

function buildAllowedProxyHosts() {
  const defaults = new Set(['127.0.0.1', 'localhost', '::1']);
  try {
    defaults.add(new URL(DEFAULT_AACT_PROXY).hostname.toLowerCase());
  } catch {
    // no-op: default proxy literal should always parse.
  }

  const extra = String(processEnv.AACT_PROXY_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const host of extra) defaults.add(host);
  return defaults;
}

const ALLOWED_PROXY_HOSTS = buildAllowedProxyHosts();

function resolveProxyBase(rawProxyBase) {
  const candidate = rawProxyBase ? String(rawProxyBase).trim() : DEFAULT_AACT_PROXY;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ConnectorError('aact invalid proxy base URL', {
      connectorId: 'aact',
      failureClass: 'bad_request',
      retryable: false,
      attempts: 1,
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConnectorError(`aact proxy protocol not allowed: ${parsed.protocol}`, {
      connectorId: 'aact',
      failureClass: 'bad_request',
      retryable: false,
      attempts: 1,
    });
  }

  if (parsed.username || parsed.password) {
    throw new ConnectorError('aact proxy URL must not contain credentials', {
      connectorId: 'aact',
      failureClass: 'bad_request',
      retryable: false,
      attempts: 1,
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_PROXY_HOSTS.has(host)) {
    throw new ConnectorError(`aact proxy host not allowed: ${host}`, {
      connectorId: 'aact',
      failureClass: 'bad_request',
      retryable: false,
      attempts: 1,
    });
  }

  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  return parsed;
}

export const aactConnector = {
  id: 'aact',
  async fetchTrials(request) {
    const policy = request?.connectorPolicy ?? {};
    const limit = clampInteger(request?.limit, { min: 1, max: 10000, fallback: 1000 });
    const offset = clampInteger(request?.offset, { min: 0, fallback: 0 });
    const base = resolveProxyBase(request?.query?.proxyBase);
    const params = new URLSearchParams();
    params.set('category', String(request.query?.category ?? 'cardiovascular'));
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    const endpoint = new URL('universe', base);
    endpoint.search = params.toString();
    const url = endpoint.toString();
    const response = await fetchWithRetry({
      connectorId: 'aact',
      url,
      init: { method: 'GET' },
      timeoutMs: policy.timeoutMs,
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
    });
    const rows = Array.isArray(response?.json?.trials) ? response.json.trials : [];
    return {
      rows,
      meta: {
        attempts: response.attempts,
        statusCode: response.statusCode,
      },
    };
  },
};
