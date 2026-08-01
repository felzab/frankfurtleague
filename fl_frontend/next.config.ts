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
        // Scoped to `public/`, which is everything under /icons — and NOT `immutable`, which is a
        // promise that the bytes at a URL never change. That promise is only true for a
        // content-hashed filename; these are stable URLs whose contents `pnpm brand` rewrites in
        // place, so `immutable` made a changed asset unreachable for a month at every cache between
        // here and the reader. It did exactly that to the Open Graph image (ADR-0024).
        // `/_next/static` is untouched here: Next sets its own immutable header there, correctly,
        // because those filenames carry a content hash.
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, must-revalidate",
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
    // `@heroui/styles` is deliberately absent: it is consumed as CSS, so there are no named imports
    // for this to barrel-optimise and listing it was a no-op.
    optimizePackageImports: ["@heroui/react", "@gravity-ui/icons"],
  },
  output: "standalone",
  cacheComponents: true,
  // Left at the default `true` deliberately: Cloudflare's on-the-fly compression measured WORSE than
  // this gzip on the same file, so the origin must keep encoding (ADR-0022, reversing ADR-0021).
  // No `reactCompiler`: measured at +40 KB gzipped per page load for memoization this app needs in
  // two admin views, both hand-written (ADR-0020).
};

export default nextConfig;
