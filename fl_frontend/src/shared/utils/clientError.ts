/**
 * The longest each field of a report may run, in characters: the route refuses a longer one, and the poster cuts to
 * it. Kept free of `"use client"`, under which the route would read a client reference rather than the figures.
 */
export const CLIENT_ERROR_MAX = { message: 500, path: 300, stack: 4000 } as const;

/**
 * A fault only the browser saw, logged as `client.crash_reported`. Cut to the route's ceilings, so a long message is
 * recorded short rather than refused whole; never throws, a lost report being no second fault.
 */
export function postClientError(message: string, stack?: string): void {
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: message.slice(0, CLIENT_ERROR_MAX.message),
      path: window.location.pathname.slice(0, CLIENT_ERROR_MAX.path),
      stack: stack?.slice(0, CLIENT_ERROR_MAX.stack),
    }),
  }).catch(() => {});
}
