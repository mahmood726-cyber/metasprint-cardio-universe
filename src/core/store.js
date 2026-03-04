function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

function cloneAndFreeze(value) {
  return deepFreeze(structuredClone(value));
}

function assertStateShape(candidate) {
  if (candidate == null || typeof candidate !== 'object') {
    throw new TypeError('Store state must be a non-null object');
  }
}

export function createStore(initialState) {
  assertStateShape(initialState);
  let state = cloneAndFreeze(initialState);
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(updater, action = 'anonymous') {
    const next = typeof updater === 'function' ? updater(state) : updater;
    assertStateShape(next);
    state = cloneAndFreeze(next);

    const errors = [];
    for (const listener of listeners) {
      try {
        listener(state, action);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, `Store listeners failed for action "${action}"`);
    }
    return state;
  }

  function patchState(partial, action = 'patch') {
    return setState((prev) => ({ ...prev, ...partial }), action);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Store listener must be a function');
    }
    listeners.add(listener);
    listener(state, 'init');
    return () => listeners.delete(listener);
  }

  return {
    getState,
    setState,
    patchState,
    subscribe,
  };
}

