function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRateLimiter(requestsPerSecond) {
  const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, Number(requestsPerSecond) || 1)));
  let nextAllowedAt = 0;

  return async function waitTurn() {
    const now = Date.now();
    if (now < nextAllowedAt) {
      await sleep(nextAllowedAt - now);
    }
    nextAllowedAt = Date.now() + intervalMs;
  };
}

export function createRequestBudget(maxRequests, label = 'budget') {
  const cap = Math.max(1, Number(maxRequests) || 1);
  let used = 0;

  return {
    reserve() {
      if (used >= cap) {
        throw new Error(`${label} exceeded (${used}/${cap})`);
      }
      used += 1;
      return used;
    },
    status() {
      return { used, cap, remaining: Math.max(0, cap - used) };
    },
  };
}
