import type { NextPageProps } from "@/shared/types/types";

/**
 * The query string minus `saison_id`, relative on purpose: a Server Component cannot read its own
 * pathname, and Next resolves a query-only reference against the current URL.
 *
 * **`"?"` and never `""`**: an empty `Location` names no resource.
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
