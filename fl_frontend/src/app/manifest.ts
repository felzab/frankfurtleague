import { BRAND_SOLID } from "@/core/brand";
import { COPY } from "@/core/copy/shared";
import { THEME_COLOR } from "@/core/themeColor";

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: COPY.brand.name,
    short_name: COPY.brand.shortName,
    description: COPY.brand.description,
    start_url: "/",
    display: "standalone",
    // The browser bar's light value: the manifest offers no colour-scheme media, and the dark value is the kit's
    // `ThemeColor`, which the root layout renders.
    theme_color: THEME_COLOR.light,
    // The brand fill, not white: `background_color` paints the splash before the first frame, so an installed app
    // would open on a white flash.
    background_color: BRAND_SOLID,
    icons: [
      // Both purposes stay: without the `any` pair, platforms honouring it show the padded image.
      { src: "/icons/manifest/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/manifest-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/manifest/manifest-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
