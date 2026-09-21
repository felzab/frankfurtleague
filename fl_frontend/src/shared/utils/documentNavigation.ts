/**
 * A full document load, for the one moment a soft navigation is the wrong tool: the session has
 * just changed, so every payload the router holds was rendered for somebody else's verdict.
 */
export function leaveDocumentFor(path: string): void {
  window.location.assign(path);
}
