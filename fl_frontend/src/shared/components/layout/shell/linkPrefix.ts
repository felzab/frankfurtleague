"use client";

import { useParams } from "next/navigation";

export type AddressParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * A function of the address where each team and season is an area root of its own: the shell's frame
 * paints before any segment is known.
 */
export type LinkPrefix = string | ((params: AddressParams) => string);

/**
 * **Under a Suspense boundary only**: `useParams()` hangs in a prerender wherever a segment is unknown
 * until the request, and with no boundary above it the build fails
 * (https://nextjs.org/docs/app/api-reference/functions/use-params#cache-components).
 */
export function useLinkPrefix(linkPrefix: LinkPrefix): string {
  // Called whichever form the shell declares, as a hook may not be called conditionally.
  const params = useParams<Record<string, string | string[]>>();

  return typeof linkPrefix === "string" ? linkPrefix : linkPrefix(params ?? {});
}
