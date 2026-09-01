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
      {
        // `?status=vergangen` is the Status facet's own parameter and value, and it is what makes
        // this a fold rather than a redirect to a blank search: `SpielsucheView` renders results as
        // soon as a filter is active, without anything typed.
        source: "/dashboard/spielhistorie",
        destination: "/dashboard/spielsuche?status=vergangen",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // Scoped to `public/` — and not `immutable`: that promise holds only for a content-hashed
        // filename, and `pnpm brand` rewrites these URLs in place. `/_next/static` is
        // untouched, where Next sets its own immutable header.
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
  // Development-only: Next reads `logging.fetches` and `logging.incomingRequests` in the dev server
  // alone, which is why the production frontend writes no per-request line — that record is nginx's
  // access log (docs/logging/spec.md).
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
  // No `typescript.ignoreBuildErrors`: the build's own pass is the only one that ever compiles
  // `.next/types/validator.ts`, which is generated after the gate's tsc step has run and is absent
  // from a CI checkout entirely, so skipping it leaves every route's contract checked by nothing.
  output: "standalone",
  // No `partialPrefetching`, although Next's ISR guide presents it as `cacheComponents`' partner:
  // enabling it was measured to change nothing this app needed.
  // https://nextjs.org/docs/app/guides/incremental-static-regeneration-cache-components

  // What it does change is how aggressively a route's payload is prefetched and retained on the
  // client — the subsystem behind an admin opening the match editor on stale values. Turn it on
  // only with a measurement, and re-check the editor's freshness.
  cacheComponents: true,
  // No `reactCompiler`: measured at +40 KB gzipped per page load for memoization this app needs in
  // two admin views, both hand-written.
};

export default nextConfig;
