import type { Metadata } from "next";

/**
 * What a 404 tells a crawler wherever its route sets metadata. A field a layout sets is reset to `null`, never left
 * out: left out, the layout's value stands, an inherited canonical claiming its address (`docs/frontend/spec.md` §1.13).
 */
export const NOT_FOUND_METADATA: Metadata = {
  title: "Seite nicht gefunden",
  description: null,
  alternates: null,
  openGraph: null,
  twitter: null,
  robots: { index: false },
};
