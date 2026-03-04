import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../src/core/store.js';

test('store state is deeply frozen', () => {
  const store = createStore({
    nested: { value: 1 },
    rows: [{ id: 'a' }],
  });
  const state = store.getState();

  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.nested), true);
  assert.equal(Object.isFrozen(state.rows), true);
  assert.equal(Object.isFrozen(state.rows[0]), true);
});

test('store rejects non-object state updates', () => {
  const store = createStore({ ok: true });
  assert.throws(() => store.setState(null), /non-null object/);
  assert.throws(() => store.setState(123), /non-null object/);
});

test('store invokes all listeners and aggregates multiple listener errors', () => {
  const store = createStore({ count: 0 });
  let called = 0;

  store.subscribe((_state, action) => {
    if (action === 'init') return;
    called += 1;
    throw new Error('listener one');
  });
  store.subscribe((_state, action) => {
    if (action === 'init') return;
    called += 1;
    throw new Error('listener two');
  });

  assert.throws(
    () => store.patchState({ count: 1 }, 'test:update'),
    /Store listeners failed/,
  );
  assert.equal(called, 2);
});

test('store rethrows single listener error after notifying others', () => {
  const store = createStore({ count: 0 });
  const seen = [];

  store.subscribe((_state, action) => {
    if (action === 'init') return;
    seen.push('first');
    throw new Error('listener failed');
  });
  store.subscribe((_state, action) => {
    if (action === 'init') return;
    seen.push('second');
  });

  assert.throws(
    () => store.patchState({ count: 1 }, 'test:update'),
    /listener failed/,
  );
  assert.deepEqual(seen, ['first', 'second']);
});

