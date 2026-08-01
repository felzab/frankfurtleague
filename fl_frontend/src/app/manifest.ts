/**
 * APP · web app manifest
 *
 * The icons referenced here are GENERATED, not hand-maintained. Re-run `pnpm brand` in `fl_frontend`
 * rather than editing any icon or manifest entry by hand — the generator produces the favicon, app
 * icons, both manifest sets, the Open Graph card and the logo component from one source, and editing
 * an output makes the header mark and the icons drift apart.
 */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Frankfurt-League",
    short_name: "FL",
    description: "Die Frankfurt-League ist die Oberstufenliga der Frankfurter Schulen. Finde heraus, welche Schule gewinnt!",
    start_url: "/",
    display: "standalone",
    // The brand maroon, not white. `theme_color` tints the OS chrome around an installed app, and
    // `background_color` paints the splash screen before the first frame renders — left white, an
    // installed Frankfurt-League opened on a white flash and only then became maroon.
    theme_color: "#82181a",
    background_color: "#82181a",
    icons: [
      // Both purposes, deliberately. `maskable` is full-bleed artwork the OS crops to its own shape;
      // `any` is displayed exactly as supplied. With only `maskable` declared — which this was —
      // platforms honouring `any` fall back to the padded full-bleed image, so the mark shows up
      // shrunken inside a hard square. They are two different renders of the same mark, both from
      // `scripts/generate-brand-assets.mjs`.
      { src: "/icons/manifest/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/manifest-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/manifest/manifest-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
