import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Frankfurt-League",
    short_name: "FL",
    description: "Die Frankfurt-League ist die Oberstufenliga der Frankfurter Schulen. Finde heraus, welche Schule gewinnt!",
    start_url: "/",
    theme_color: "#ffffff",
    background_color: "#ffffff",
    icons: [
      {
        src: "/icons/manifest/manifest-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/manifest/manifest-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
