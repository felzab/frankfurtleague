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
  // No `partialPrefetching`. Next's ISR guide presents it as `cacheComponents`' partner — Cache
  // Components produces the App Shell, Partial Prefetching upgrades it once the params are known —
  // and enabling it here was measured to change nothing this app needed. What it does change is how
  // aggressively a route's payload is prefetched and retained on the client, which is the subsystem
  // behind an admin opening the match editor on values that have since moved. **Turn it on only with
  // a measurement showing what it buys, and re-check the editor's freshness in the same pass.**
  // https://nextjs.org/docs/app/guides/incremental-static-regeneration-cache-components
  cacheComponents: true,
  // No `reactCompiler`: measured at +40 KB gzipped per page load for memoization this app needs in
  // two admin views, both hand-written (ADR-0020).
};

export default nextConfig;
