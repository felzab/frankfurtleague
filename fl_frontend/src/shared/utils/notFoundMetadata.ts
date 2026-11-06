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
 * `NOT_FOUND_METADATA` where it finds none, so every missing record's tab carries the not-found title. `found` answers
 * `null` for a miss and never throws `notFound()`: a throw from `generateMetadata` leaves the tab the layout's title,
 * since Next honours a not-found boundary's `metadata` on the root file alone. The page's body throws the
 * `notFound()` off the same read, which renders the boundary.
 */
export async function metadataFor<Found>(
  found: Promise<Found | null>,
  metadataOf: (record: Found) => Promise<Metadata> | Metadata,
): Promise<Metadata> {
  const record = await found;
  return record === null ? NOT_FOUND_METADATA : metadataOf(record);
}
