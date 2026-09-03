import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Frankfurt-League",
    short_name: "FL",
    description: "Die Frankfurt-League ist die Oberstufenliga der Frankfurter Schulen. Finde heraus, welche Schule gewinnt!",
    start_url: "/",
    display: "standalone",
    // Not white: `background_color` paints the splash before the first frame, so an installed app
    // would open on a white flash.
    theme_color: "#82181a",
    background_color: "#82181a",
    icons: [
      // Both purposes stay: without the `any` pair, platforms honouring it show the padded image.
      { src: "/icons/manifest/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/manifest/manifest-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/manifest/manifest-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
