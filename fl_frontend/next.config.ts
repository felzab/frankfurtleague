import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These run *ahead of* src/proxy.ts -- observed, not assumed: GET /admin returns its redirect
  // without the proxy running at all. Any redirect added here must land inside the proxy matcher,
  // or the destination is never authorization-checked.
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/spielplan#top",
        permanent: true, // HTTP 308 (permanent, method-preserving) -- not 301
      },
      {
        source: "/admin",
        destination: "/admin/action_required#top",
        permanent: true, // HTTP 308 (permanent, method-preserving) -- not 301
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico))",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2629800, s-maxage=2629800, immutable",
          },
        ],
      },
    ];
  },
  logging: {
    fetches: {
      fullUrl: false, // Prevents giant URLs in the terminal
    },
  },
  experimental: {
    optimizePackageImports: ["@heroui/react", "@gravity-ui/icons", "@heroui/styles"],
  },
  output: "standalone",
  cacheComponents: true,
};

export default nextConfig;
