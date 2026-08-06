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
  // Development-only, all of it: Next reads `logging.fetches` and `logging.incomingRequests` in the
  // dev server alone, which is also why the production frontend writes no per-request line of its
  // own -- that record is nginx's access log (docs/logging.md).
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
  // **These two are a pair, and running the first without the second is a misconfiguration.** Next's
  // own guide states the split: Cache Components produces the App Shell — the generic part of a route
  // that does not depend on URL data — and Partial Prefetching is what upgrades that shell to a full
  // route once the params are known. Omitting `partialPrefetching` is documented as doing nothing at
  // all ("the legacy behavior, where dynamic data is included in the prefetch"), which leaves the
  // three dynamic segments here serving a shell that nothing ever upgrades. It requires
  // `cacheComponents`, and the build refuses the combination the other way round.
  // https://nextjs.org/docs/app/guides/incremental-static-regeneration-cache-components
  cacheComponents: true,
  partialPrefetching: true,
  // No `reactCompiler`: measured at +40 KB gzipped per page load for memoization this app needs in
  // two admin views, both hand-written (ADR-0020).
};

export default nextConfig;
