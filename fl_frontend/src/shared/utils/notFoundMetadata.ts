import { unstable_rethrow } from "next/navigation";

import { SERVER_COPY } from "@/core/serverCopy";

import type { Metadata } from "next";

/**
 * What a 404 tells a crawler wherever its route sets metadata. A field a layout sets is reset to `null`, never left
 * out: left out, the layout's value stands, an inherited canonical claiming its address. Its title is the one the
 * not-found card shows.
 */
export const NOT_FOUND_METADATA: Metadata = {
  title: SERVER_COPY.notFound,
  description: null,
  alternates: null,
  openGraph: null,
  twitter: null,
  robots: { index: false },
};

/**
 * A page's metadata off the read of the record its address names: `metadataOf` the record where the read finds one,
 * `NOT_FOUND_METADATA` where it finds none, so a missing record's tab carries the not-found title once the page's
 * scripts run. The first HTML is Next's bare error document, whose head holds Next's own `noindex` and the root
 * layout's title, the league's name, which a reader without scripts keeps. `found` answers `null` for a miss and never
 * throws `notFound()`: a throw from `generateMetadata` leaves the tab the layout's title on a hard load and after a
 * client navigation, a nested not-found boundary's `metadata` naming none. The page's body throws the `notFound()` off
 * the same read, which renders the boundary. A failed read stays out of the index with nothing else said: it knows
 * neither the record nor its absence, and the page's body meets the failure and reports it.
 */
export async function metadataFor<Found>(
  found: Promise<Found | null>,
  metadataOf: (record: Found) => Promise<Metadata> | Metadata,
): Promise<Metadata> {
  let record: Found | null;
  try {
    record = await found;
  } catch (error) {
    unstable_rethrow(error);
    return { robots: { index: false } };
  }
  return record === null ? NOT_FOUND_METADATA : metadataOf(record);
}
