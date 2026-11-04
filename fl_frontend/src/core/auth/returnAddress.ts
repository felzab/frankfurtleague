/** The query parameter a sign-in carries the address it returns to under, from the proxy's redirect to the landing. */
export const RETURN_PARAMETER = "return";

/**
 * The sign-in pages' referrer: the return address can hold the mailed deletion link with its token, so no request a
 * sign-in page makes names more than the site's origin, its own requests included. Not `no-referrer`, the mailed pages'
 * (`fl_frontend/src/kit/MailedPage.tsx :: MAILED_PAGE_METADATA`): the bot check's widget on `/signin` is still told
 * which site it is drawn on.
 */
export const SIGN_IN_REFERRER = { referrer: "strict-origin" } as const;

/**
 * The addresses a sign-in may return to, written out rather than parsed: a page under `/area`, `/admin` or
 * `/account`, the three the proxy turns away signed out, and the mailed deletion link with its token. Each segment is letters, digits, `-` and `_` alone, so no `.`, `%`, `\` or second
 * `/` can turn a path into another host or a decoded one into another path.
 */
// The query's mark as a class, so `scripts/checks/check_public_routes.py` reads no minted link here.
const ALLOWED = /^\/(?:(?:area|admin|account)(?:\/[A-Za-z0-9_-]+)*|erasure[?]token=[A-Za-z0-9_-]+)$/;

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
