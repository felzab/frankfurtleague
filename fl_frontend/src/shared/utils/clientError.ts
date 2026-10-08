/**
 * A fault only the browser saw, logged as FE-CLIENT-001. Cut to the route's ceilings, so a long message is
 * recorded short rather than refused whole; never throws, a lost report being no second fault.
 */
export function postClientError(message: string, stack?: string): void {
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: message.slice(0, 500),
      path: window.location.pathname.slice(0, 300),
      stack: stack?.slice(0, 4000),
    }),
  }).catch(() => {});
}
