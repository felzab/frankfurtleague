/**
 * Whether the URL parser left an endpoint's path as the call site spelled it. Its own module because
 * `fl_frontend/src/core/api.ts` is `server-only` and reads the environment at import, so nothing can
 * exercise a predicate living there.
 */
export function isPathAsSpelled(endpoint: string, builtPathname: string, basePathname: string): boolean {
  // Dropped rather than compared: the query is the URL's own, and a call site may spell an inline `?a=b`.
  const spelled = endpoint.split(/[?#]/)[0] ?? "";

  // Catches renavigation — `..`, `.`, an empty segment — and nothing else: an id carrying a plain `/`
  // survives parsing untouched and reads exactly like a nested endpoint, which is why every generated path builder
  // percent-encodes its parameters (`fl_frontend/src/core/generated/client/sdk.ts`).
  return builtPathname === `${basePathname}${spelled}`;
}
