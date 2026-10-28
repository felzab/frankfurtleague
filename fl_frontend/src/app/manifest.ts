import { COPY } from "@/core/copy";

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: COPY.marke.name,
    short_name: COPY.marke.kurzname,
    description: COPY.marke.beschreibung,
    start_url: "/",
    display: "standalone",
    // `fl_frontend/src/app/tokens.css :: --brand-solid`, copied because the manifest is JSON. Not
    // white: `background_color` paints the splash before the first frame, so an installed app would
    // open on a white flash.
    theme_color: "#033f11",
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
