function findTrigger(eventTarget) {
  if (!eventTarget) return null;
  const ElementCtor = globalThis.Element;
  const isElement = typeof ElementCtor === 'function' && eventTarget instanceof ElementCtor;
  const element = isElement ? eventTarget : eventTarget.parentElement;
  if (!element) return null;
  return element.closest('[data-action]');
}

function isNativeInteractiveElement(node) {
  if (!node || typeof node.matches !== 'function') return false;
  return node.matches('button, input, select, textarea, a[href], summary');
}

function reportHandlerError(error, action, trigger, event, onError) {
  if (typeof onError === 'function') {
    onError(error, { action, trigger, event });
    return;
  }
  if (globalThis.console && typeof globalThis.console.error === 'function') {
    globalThis.console.error(`[delegates] handler "${action}" failed`, error);
  }
}

export function attachActionDelegates(root, handlers, options = {}) {
  const allowedActions = new Set(Object.keys(handlers));
  const onError = typeof options.onError === 'function' ? options.onError : null;

  function invoke(eventTarget, event) {
    const trigger = findTrigger(eventTarget);
    if (!trigger || !root.contains(trigger)) return;
    const action = trigger.dataset.action;
    if (!allowedActions.has(action)) return;
    try {
      const result = handlers[action](trigger, event);
      if (result && typeof result.then === 'function') {
        result.catch((error) => {
          reportHandlerError(error, action, trigger, event, onError);
        });
      }
    } catch (error) {
      reportHandlerError(error, action, trigger, event, onError);
    }
  }

  const onClick = (event) => invoke(event.target, event);
  const onKeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.repeat) return;
    const trigger = findTrigger(event.target);
    if (!trigger || !root.contains(trigger)) return;
    if (isNativeInteractiveElement(trigger)) return;
    event.preventDefault();
    const action = trigger.dataset.action;
    if (!allowedActions.has(action)) return;
    invoke(trigger, event);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeydown);

  return () => {
    if (typeof root.removeEventListener === 'function') {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeydown);
    }
  };
}
