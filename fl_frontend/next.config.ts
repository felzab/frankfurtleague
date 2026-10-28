import optimizeLocales from "@react-aria/optimize-locales-plugin";

import type { NextConfig } from "next";

// Every locale an `I18nProvider` sets belongs here (`fl_frontend/src/core/providers/RootProviders.tsx`):
// React Aria's strings for any other are emptied from the server bundle and the client's alike.
const localeOptimization = optimizeLocales.turbopack({ locales: ["de-DE"] });

const nextConfig: NextConfig = {
  // These run *ahead of* src/proxy.ts -- observed, not assumed: GET /bereich/admin redirects without
  // the proxy running. A redirect added here must land on a page guarding itself, as each under
  // `/bereich` does (`docs/frontend/spec.md :: I122`, `:: I377`).
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/spielplan#top",
        permanent: true, // HTTP 308 (permanent, method-preserving) -- not 301
      },
      {
        source: "/bereich/admin",
        destination: "/bereich/admin/action_required#top",
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
        // filename, and a replacement asset lands at these same URLs. `/_next/static` is
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
  turbopack: {
    rules: {
      // The plugin's `LocalesPlugin.d.ts` types `locales` as `readonly string[]`, which Next's
      // `TurbopackLoaderOptions` refuses; remove the assertion once the plugin's types accept Next's.
      ...(localeOptimization.rules as NonNullable<NextConfig["turbopack"]>["rules"]),
    },
  },
  experimental: {
    // HeroUI's root is imported for `useOverlayState` alone, which no subpath publishes.
    // `@heroui/styles` is consumed as CSS and every icon by its own subpath, so neither has a root
    // import to narrow.
    optimizePackageImports: ["@heroui/react"],
    // Off, or an agent's `next build`, the gate's included, asks the registry for advisories, stops on
    // any with instructions for that agent, and passes the same build retried. The gate's advisory
    // check is `pnpm audit:prod`.
    agentUpgrade: false,
  },
  output: "standalone",
  // TypeScript alone: Next's default also serves a `route.js` or a `page.jsx`, which tsc (`allowJs` off),
  // the lint globs and every sweep over handlers and pages never read.
  pageExtensions: ["tsx", "ts"],
  cacheComponents: true,
  // On: Next's documented pairing with `cacheComponents`, unset meaning off. A prefetch never carries
  // what waits on `connection()`, which is what keeps the match editor's fixture fresh
  // (`fl_frontend/src/app/bereich/admin/spiele/[spiel_id]/page.test.ts`).
  partialPrefetching: true,
  // No `reactCompiler`: measured at +40 KB gzipped per page load for memoization this app needs in
  // two admin views, both hand-written.

  // Off, or `next dev` run by an agent writes its own block into an `AGENTS.md` here, which an agent
  // then loads as instructions nobody reviewed; `.claude/CLAUDE.md` §4 names this repository's docs.
  agentRules: false,
};

export default nextConfig;
