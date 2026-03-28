import { createStore } from '../src/core/store.js?v=20260304f';
import { INITIAL_DISCOVERY_STATE } from '../src/discovery/state.js?v=20260304f';
import { createDiscoveryActions } from '../src/discovery/actions.js?v=20260304f';
import { renderDiscovery } from '../src/discovery/ui/render.js?v=20260304f';
import { attachDiscoveryHandlers } from '../src/discovery/ui/handlers.js?v=20260304f';

const root = document.getElementById('discoveryShell');
if (!root) {
  throw new Error('Discovery root element #discoveryShell not found');
}

const store = createStore(INITIAL_DISCOVERY_STATE);
const actions = createDiscoveryActions(store);

store.subscribe((state) => {
  renderDiscovery(state);
});

attachDiscoveryHandlers(root, actions);
void actions.loadUniverse();
