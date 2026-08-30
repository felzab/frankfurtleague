/**
 * Whether the URL parser left an endpoint's path as the call site spelled it.
 *
 * Its own module because `fl_frontend/src/core/api.ts` is `server-only` and reads the environment at
 * import, so nothing can exercise a predicate living there.
 *
 * Catches renavigation — `..`, `.`, an empty segment — and nothing else. An id carrying a plain `/`
 * survives parsing untouched and reads exactly like a nested endpoint, so only the caller can refuse it.
 */
export function isPathAsSpelled(endpoint: string, builtPathname: string, basePathname: string): boolean {
  // Dropped rather than compared: the query is the URL's own, and a call site may spell an inline `?a=b`.
  const spelled = endpoint.split(/[?#]/)[0] ?? "";

  return builtPathname === `${basePathname}${spelled}`;
}
