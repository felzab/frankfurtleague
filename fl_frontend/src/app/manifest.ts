/**
 * APP · web app manifest
 *
 * The icons referenced here are GENERATED, not hand-maintained. Re-run `pnpm brand` in `fl_frontend`
 * rather than editing any icon or manifest entry by hand — `fl_frontend/scripts/generate-brand-assets.mjs`
 * produces the favicon, app icons, both manifest sets, the Open Graph card and the logo component
 * from one source, and editing an output makes the header mark and the icons drift apart.
 *
 * Invariants:
 * - Both icon purposes stay declared; the reason is at the array below.
 */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Frankfurt-League",
    short_name: "FL",
    description: "Die Frankfurt-League ist die Oberstufenliga der Frankfurter Schulen. Finde heraus, welche Schule gewinnt!",
    start_url: "/",
    display: "standalone",
    // The brand maroon, not white: `theme_color` tints the OS chrome around an installed app, and
    // `background_color` paints the splash before the first frame — left white, the installed app
    // opens on a white flash.
    theme_color: "#82181a",
    background_color: "#82181a",
    icons: [
      // Both purposes, deliberately: `maskable` is full-bleed artwork the OS crops to its own shape,
      // `any` is shown as supplied. Drop the `any` pair and platforms honouring it fall back to the
      // padded image, so the mark reads as shrunken in a hard square.
      { src: "/icons/manifest/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/manifest-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/manifest/manifest-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
