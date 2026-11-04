import { SERVER_COPY } from "@/core/serverCopy";

import type { Metadata } from "next";

/**
 * What a 404 tells a crawler wherever its route sets metadata. A field a layout sets is reset to `null`, never left
 * out: left out, the layout's value stands, an inherited canonical claiming its address. Its title is the one the
 * not-found card shows.
 */
export const NOT_FOUND_METADATA: Metadata = {
  title: SERVER_COPY.landing.notFound.title,
  description: null,
  alternates: null,
  openGraph: null,
  twitter: null,
  robots: { index: false },
};
