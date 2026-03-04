/**
 * @typedef {Object} ConnectorRequest
 * @property {string} domain
 * @property {Record<string, string|number|boolean>} query
 * @property {number} [limit]
 * @property {number} [offset]
 * @property {{ timeoutMs?: number, maxAttempts?: number, baseDelayMs?: number }} [connectorPolicy]
 */

/**
 * @typedef {Object} UniverseConnector
 * @property {string} id
 * @property {(request: ConnectorRequest) => Promise<Array<Record<string, unknown>>|{ rows: Array<Record<string, unknown>>, meta?: Record<string, unknown> }>} fetchTrials
 */

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const SENSITIVE_QUERY_KEY_RE = /^(api[_-]?key|apikey|access[_-]?token|token|key|secret|password|authorization)$/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPositiveInt(value, fallback) {
  return clampInteger(value, { min: 1, fallback });
}

export function clampInteger(value, options = {}) {
  const min = Number.isFinite(Number(options.min)) ? Math.floor(Number(options.min)) : 0;
  const max = Number.isFinite(Number(options.max))
    ? Math.floor(Number(options.max))
    : Number.MAX_SAFE_INTEGER;
  const fallbackInput = options.fallback ?? min;
  const fallback = Number.isFinite(Number(fallbackInput))
    ? Math.floor(Number(fallbackInput))
    : min;
  const boundedFallback = Math.max(min, Math.min(max, fallback));
  const n = Number(value);
  if (!Number.isFinite(n)) return boundedFallback;
  const floored = Math.floor(n);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

function extractErrorCode(error) {
  if (!error || typeof error !== 'object') return null;
  const direct = typeof error.code === 'string' ? error.code : null;
  const causeCode = typeof error.cause?.code === 'string' ? error.cause.code : null;
  return direct ?? causeCode;
}

function redactUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY_RE.test(key)) {
        parsed.searchParams.set(key, 'REDACTED');
      }
    }
    return parsed.toString();
  } catch {
    return raw.replace(
      /([?&](?:api[_-]?key|apikey|access[_-]?token|token|key|secret|password|authorization)=)[^&]*/gi,
      '$1REDACTED',
    );
  }
}

function classifyHttpStatus(statusCode) {
  if (statusCode === 401 || statusCode === 403) {
    return { failureClass: 'auth_error', retryable: false };
  }
  if (statusCode === 404) {
    return { failureClass: 'not_found', retryable: false };
  }
  if (statusCode === 429) {
    return { failureClass: 'rate_limited', retryable: true };
  }
  if (statusCode >= 500) {
    return { failureClass: 'upstream_unavailable', retryable: true };
  }
  if (statusCode === 408) {
    return { failureClass: 'timeout', retryable: true };
  }
  return {
    failureClass: statusCode >= 400 ? 'bad_request' : 'unknown',
    retryable: RETRYABLE_HTTP_STATUS.has(statusCode),
  };
}

function classifyNonHttpError(error, fallbackMessage) {
  const code = extractErrorCode(error);
  const name = String(error?.name ?? '');
  const message = String(error?.message ?? fallbackMessage ?? '');
  const lcMessage = message.toLowerCase();

  if (name === 'AbortError' || lcMessage.includes('aborted') || lcMessage.includes('timeout')) {
    return { failureClass: 'timeout', retryable: true };
  }
  if (code && NETWORK_ERROR_CODES.has(code)) {
    return { failureClass: 'network_unreachable', retryable: true };
  }
  if (lcMessage.includes('network') && lcMessage.includes('failed')) {
    return { failureClass: 'network_unreachable', retryable: true };
  }
  if (lcMessage.includes('budget') && lcMessage.includes('exceeded')) {
    return { failureClass: 'budget_exhausted', retryable: false };
  }
  if (lcMessage.includes('invalid json')) {
    return { failureClass: 'invalid_response', retryable: false };
  }
  return { failureClass: 'unknown', retryable: false };
}

function computeBackoffMs(baseDelayMs, attemptNumber) {
  const base = Math.max(50, Number(baseDelayMs) || 250);
  const expo = base * 2 ** Math.max(0, attemptNumber - 1);
  const jitter = Math.floor(Math.random() * Math.min(250, Math.floor(expo * 0.2)));
  return Math.min(5000, expo + jitter);
}

export class ConnectorError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.connectorId = details.connectorId ?? null;
    this.failureClass = details.failureClass ?? 'unknown';
    this.retryable = Boolean(details.retryable);
    this.statusCode = Number.isFinite(Number(details.statusCode)) ? Number(details.statusCode) : null;
    this.attempts = clampPositiveInt(details.attempts, 1);
    this.url = details.url ? redactUrl(details.url) : null;
    this.code = details.code ? String(details.code) : null;
    if (details.cause) {
      this.cause = details.cause;
    }
  }

  static fromHttp(connectorId, statusCode, url, attemptNumber) {
    const classification = classifyHttpStatus(statusCode);
    return new ConnectorError(`${connectorId} HTTP ${statusCode}`, {
      connectorId,
      failureClass: classification.failureClass,
      retryable: classification.retryable,
      statusCode,
      attempts: attemptNumber,
      url,
    });
  }
}

export function normalizeConnectorError(connectorId, error, context = {}) {
  if (error instanceof ConnectorError) {
    if (!error.connectorId && connectorId) {
      error.connectorId = connectorId;
    }
    if (!error.url && context.url) {
      error.url = redactUrl(context.url);
    }
    if (!error.attempts && context.attemptNumber) {
      error.attempts = clampPositiveInt(context.attemptNumber, 1);
    }
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const classification = classifyNonHttpError(error, message);
  return new ConnectorError(`${connectorId} ${message}`, {
    connectorId,
    failureClass: classification.failureClass,
    retryable: classification.retryable,
    attempts: clampPositiveInt(context.attemptNumber, 1),
    url: context.url ? redactUrl(context.url) : null,
    code: extractErrorCode(error),
    cause: error instanceof Error ? error : undefined,
  });
}

export function createSimulatedOutageError(connectorId) {
  return new ConnectorError(`${connectorId} simulated outage`, {
    connectorId,
    failureClass: 'simulated_outage',
    retryable: false,
    attempts: 1,
  });
}

/**
 * @param {{
 *   connectorId: string,
 *   url: string,
 *   init?: RequestInit,
 *   timeoutMs?: number,
 *   maxAttempts?: number,
 *   baseDelayMs?: number,
 *   rateWait?: (() => Promise<void>) | null,
 *   parseJson?: boolean
 * }} options
 */
export async function fetchWithRetry(options) {
  const connectorId = String(options?.connectorId ?? 'unknown');
  const url = String(options?.url ?? '');
  const init = options?.init ?? { method: 'GET' };
  const timeoutMs = clampPositiveInt(options?.timeoutMs, 15000);
  const maxAttempts = clampPositiveInt(options?.maxAttempts, 3);
  const baseDelayMs = clampPositiveInt(options?.baseDelayMs, 250);
  const rateWait = typeof options?.rateWait === 'function' ? options.rateWait : null;
  const parseJson = options?.parseJson !== false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let timeoutHandle = null;
    try {
      if (rateWait) {
        await rateWait();
      }

      const controller = new AbortController();
      timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw ConnectorError.fromHttp(connectorId, response.status, url, attempt);
      }

      if (!parseJson) {
        return {
          body: await response.text(),
          attempts: attempt,
          statusCode: response.status,
          url: redactUrl(url),
        };
      }

      try {
        const json = await response.json();
        return {
          json,
          attempts: attempt,
          statusCode: response.status,
          url: redactUrl(url),
        };
      } catch (error) {
        throw new ConnectorError(`${connectorId} invalid JSON response`, {
          connectorId,
          failureClass: 'invalid_response',
          retryable: false,
          attempts: attempt,
          statusCode: response.status,
          url,
          cause: error instanceof Error ? error : undefined,
        });
      }
    } catch (error) {
      const normalized = normalizeConnectorError(connectorId, error, { attemptNumber: attempt, url });
      if (!normalized.retryable || attempt >= maxAttempts) {
        throw normalized;
      }
      await sleep(computeBackoffMs(baseDelayMs, attempt));
    } finally {
      if (timeoutHandle != null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  throw new ConnectorError(`${connectorId} request failed`, {
    connectorId,
    failureClass: 'unknown',
    retryable: false,
  });
}
