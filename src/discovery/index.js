import { createStore } from '../core/store.js';
import { INITIAL_DISCOVERY_STATE } from './state.js';
import { createDiscoveryActions } from './actions.js';
import { renderDiscovery } from './ui/render.js';
import { attachDiscoveryHandlers } from './ui/handlers.js';

export function mountDiscovery(root = document.getElementById('discoveryShell')) {
  if (!root) {
    throw new Error('Discovery root element #discoveryShell not found');
  }

  const store = createStore(INITIAL_DISCOVERY_STATE);
  const actions = createDiscoveryActions(store);

  const unsubscribe = store.subscribe((state) => {
    renderDiscovery(state);
  });

  const detachHandlers = attachDiscoveryHandlers(root, actions);
  // Load initial sample universe so users immediately see clinical rows.
  void actions.loadUniverse();

  return {
    store,
    actions,
    unmount() {
      if (typeof detachHandlers === 'function') detachHandlers();
      if (typeof unsubscribe === 'function') unsubscribe();
    },
  };
}
