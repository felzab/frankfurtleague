import { COPY } from "@/core/copy";

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: COPY.marke.name,
    short_name: COPY.marke.kurzname,
    description: COPY.marke.beschreibung,
    start_url: "/",
    display: "standalone",
    // Both copied from `fl_frontend/src/app/tokens.css` because the manifest is JSON. The title bar
    // takes the light theme's `--bg-surface`, the browser bar's colour: the manifest offers no
    // colour-scheme media, and the dark value is the viewport's in `layout.tsx`.
    theme_color: "#f5f5f5",
    // `--brand-solid`, not white: `background_color` paints the splash before the first frame, so an
    // installed app would open on a white flash.
    background_color: "#033f11",
    icons: [
      // Both purposes stay: without the `any` pair, platforms honouring it show the padded image.
      { src: "/icons/manifest/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/manifest-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/manifest/manifest-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
