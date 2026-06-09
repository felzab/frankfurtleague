import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/spielplan#top",
        permanent: true, // HTTP 301
      },
      {
        source: "/admin",
        destination: "/admin/overview#top",
        permanent: true, // HTTP 301
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
            value: "public, max-age=604800, s-maxage=604800, immutable",
          },
        ],
      },
    ];
  },
  experimental: {
    optimizePackageImports: ["@heroui/react", "framer-motion", "@gravity-ui/icons", "@heroui/styles"],
  },
  output: "standalone",
  cacheComponents: true,
};

export default nextConfig;
