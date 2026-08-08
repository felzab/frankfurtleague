/**
 * SAISONS · pure derivations
 *
 * No fetching and no framework: everything here is a function of its arguments, which is what makes it
 * testable without a request. `resolvers.ts` decides WHEN to navigate; this decides WHERE to.
 */

import type { NextPageProps } from "@/shared/types/types";

/**
 * The current query string minus `saison_id`, as a relative reference.
 *
 * Relative on purpose: a Server Component cannot read its own pathname, and "this page, one parameter
 * fewer" is exactly what a query-only reference means — so this stays correct if a route ever moves,
 * where a hardcoded path per call site would not. Next resolves it against the current URL on both
 * paths a `redirect()` can take: `new URL(href, location.href)` in the client router, and the
 * document's base URL in the streamed `<meta http-equiv="refresh">` fallback.
 *
 * **`"?"` when nothing else survives, never `""`.** An empty `Location` names no resource, while `"?"`
 * resolves to the same page with an empty query — and `URL.search` is `""` for a bare `?`, so the
 * router's canonical href drops it and the address bar shows the clean path.
 *
 * Every other parameter is preserved, repeats included: a facet selection and a sort survive having
 * an unknown season taken out from under them.
 */
export function searchWithoutSaisonId(searchParams: Awaited<NextPageProps["searchParams"]>): string {
  const remaining = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "saison_id" || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) remaining.append(key, entry);
  }

  const query = remaining.toString();

  return query === "" ? "?" : `?${query}`;
}
