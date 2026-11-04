/** The query parameter a sign-in carries the address it returns to under, from the proxy's redirect to the landing. */
export const RETURN_PARAMETER = "return";

/**
 * The addresses a sign-in may return to, written out rather than parsed: a page under `/area`, `/admin` or
 * `/account`, the three the proxy turns away signed out, and the deletion link's page, whose token the proxy holds in
 * a cookie and never in an address (`fl_frontend/src/core/mailedLink.ts`). Each segment is letters, digits, `-` and
 * `_` alone, and no query is held, so no `.`, `%`, `\`, `?` or second `/` can turn a path into another host, a
 * decoded one into another path, or carry a secret into the sign-in's address.
 */
const ALLOWED = /^\/(?:(?:area|admin|account)(?:\/[A-Za-z0-9_-]+)*|erasure)$/;

/**
 * The address a sign-in returns to, or `null` for any the allowlist does not hold, an absent one included: a
 * destination from a request is honoured only once it is checked (`docs/decisions.md`, **auth**).
 */
export function allowedReturnAddress(asked: string | null | undefined): string | null {
  return typeof asked === "string" && ALLOWED.test(asked) ? asked : null;
}

/** `path` carrying the return address, where one is allowed; `path` as it stands otherwise. */
export function withReturnAddress(path: string, asked: string | null | undefined): string {
  const allowed = allowedReturnAddress(asked);
  return allowed === null ? path : `${path}?${new URLSearchParams({ [RETURN_PARAMETER]: allowed }).toString()}`;
}
