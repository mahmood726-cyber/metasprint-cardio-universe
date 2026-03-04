import test from 'node:test';
import assert from 'node:assert/strict';

import { attachActionDelegates } from '../src/core/delegates.js';

class FakeElement {
  constructor(tagName, action = null) {
    this.tagName = String(tagName).toLowerCase();
    this.dataset = {};
    if (action) this.dataset.action = action;
    this.parentElement = null;
    this.href = null;
  }

  closest(selector) {
    if (selector !== '[data-action]') return null;
    let current = this;
    while (current) {
      if (current.dataset?.action) return current;
      current = current.parentElement ?? null;
    }
    return null;
  }

  matches(selector) {
    const parts = String(selector)
      .split(',')
      .map((part) => part.trim());

    for (const part of parts) {
      if (part === 'a[href]') {
        if (this.tagName === 'a' && this.href) return true;
        continue;
      }
      if (part === this.tagName) return true;
    }
    return false;
  }
}

class FakeRoot {
  constructor() {
    this.listeners = new Map();
    this.members = new Set();
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  removeEventListener(type, handler) {
    if (this.listeners.get(type) === handler) {
      this.listeners.delete(type);
    }
  }

  contains(node) {
    return this.members.has(node);
  }

  register(node) {
    this.members.add(node);
  }

  emit(type, event) {
    const handler = this.listeners.get(type);
    if (handler) handler(event);
  }
}

function withFakeElement(testBody) {
  return async (t) => {
    const previousElement = globalThis.Element;
    globalThis.Element = FakeElement;
    t.after(() => {
      if (previousElement === undefined) {
        delete globalThis.Element;
      } else {
        globalThis.Element = previousElement;
      }
    });
    await testBody(t);
  };
}

test(
  'keydown on native button does not trigger delegated action twice',
  withFakeElement(async () => {
    const root = new FakeRoot();
    const button = new FakeElement('button', 'run');
    root.register(button);

    let count = 0;
    let prevented = false;
    attachActionDelegates(root, {
      run: () => {
        count += 1;
      },
    });

    root.emit('keydown', {
      key: 'Enter',
      target: button,
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(count, 0);
    assert.equal(prevented, false);

    root.emit('click', { target: button });
    assert.equal(count, 1);
  }),
);

test(
  'keydown on non-native action target invokes handler and prevents default',
  withFakeElement(async () => {
    const root = new FakeRoot();
    const trigger = new FakeElement('div', 'run');
    root.register(trigger);
    const textNode = { parentElement: trigger };

    let count = 0;
    let prevented = false;
    attachActionDelegates(root, {
      run: () => {
        count += 1;
      },
    });

    root.emit('keydown', {
      key: ' ',
      target: textNode,
      preventDefault: () => {
        prevented = true;
      },
    });

    assert.equal(count, 1);
    assert.equal(prevented, true);
  }),
);

test(
  'keydown repeat does not trigger delegated action',
  withFakeElement(async () => {
    const root = new FakeRoot();
    const trigger = new FakeElement('div', 'run');
    root.register(trigger);

    let count = 0;
    attachActionDelegates(root, {
      run: () => {
        count += 1;
      },
    });

    root.emit('keydown', {
      key: 'Enter',
      repeat: true,
      target: trigger,
      preventDefault: () => {},
    });

    assert.equal(count, 0);
  }),
);

test(
  'attachActionDelegates returns disposer that detaches listeners',
  withFakeElement(async () => {
    const root = new FakeRoot();
    const trigger = new FakeElement('div', 'run');
    root.register(trigger);

    let count = 0;
    const dispose = attachActionDelegates(root, {
      run: () => {
        count += 1;
      },
    });

    root.emit('click', { target: trigger });
    assert.equal(count, 1);

    dispose();
    root.emit('click', { target: trigger });
    assert.equal(count, 1);
  }),
);

test(
  'async delegate rejections are routed to onError',
  withFakeElement(async () => {
    const root = new FakeRoot();
    const trigger = new FakeElement('div', 'run');
    root.register(trigger);

    /** @type {{ error: Error, action: string } | null} */
    let seen = null;
    attachActionDelegates(
      root,
      {
        run: async () => {
          throw new Error('async boom');
        },
      },
      {
        onError: (error, context) => {
          seen = {
            error: /** @type {Error} */ (error),
            action: context.action,
          };
        },
      },
    );

    root.emit('click', { target: trigger });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(seen);
    assert.equal(seen.action, 'run');
    assert.equal(seen.error.message, 'async boom');
  }),
);
