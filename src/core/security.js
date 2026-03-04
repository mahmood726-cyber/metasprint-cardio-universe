const INLINE_HANDLER_RE = /\s(onclick|onchange|onkeydown|onkeyup|onkeypress|oninput)\s*=/i;

export function hasInlineHandlers(markup) {
  return INLINE_HANDLER_RE.test(markup);
}

export function assertNoInlineHandlers(markup, context = 'markup') {
  if (hasInlineHandlers(markup)) {
    throw new Error(`Inline handler detected in ${context}`);
  }
}

export function isSafeAction(action, allowedActions) {
  return allowedActions.has(action);
}
