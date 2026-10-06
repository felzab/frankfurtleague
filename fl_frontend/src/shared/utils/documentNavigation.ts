/**
 * A full document load, where a soft navigation is the wrong tool: the session has just changed, so
 * every payload the router holds was rendered for somebody else's verdict.
 */
export function leaveDocumentFor(path: string): void {
  window.location.assign(path);
}

/**
 * This page loaded again whole, never `router.refresh()`: a server action's id lives in the page's
 * scripts, which only a new document replaces.
 */
export function reloadDocument(): void {
  window.location.reload();
}
