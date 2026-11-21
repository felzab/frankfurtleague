import optimizeLocales from "@react-aria/optimize-locales-plugin";

import { SITE_LOCALE } from "./src/core/brand";

import type { NextConfig } from "next";

// Every locale an `I18nProvider` sets belongs here: React Aria's strings for any other are emptied
// from the server bundle and the client's alike.
const localeOptimization = optimizeLocales.turbopack({ locales: [SITE_LOCALE] });

const nextConfig: NextConfig = {
  // `compress` stays at its default, on: Cloudflare passes an origin's `Content-Encoding` through to
  // the visitor, and its own zstd measured larger than Next's gzip, so the edge leaves compression here.
  // The image's version, from the image's build argument: a page opened before a deploy
  // loads the new build whole on its next navigation rather than asking the new server for the old
  // build's chunks and actions. A build handed none, the gate's and the local stack's, sets no id.
  deploymentId: process.env.APP_VERSION || undefined,
  // Next names itself on every response by default, which tells a scanner which framework's flaws to try.
  poweredByHeader: false,
  // Every `next/image` serves its file as it is, and `/_next/image` answers 404 rather than resizing for anyone who
  // asks: the one picture it draws, a sponsor's logo, is an SVG, which the optimiser has nothing to do for. A raster
  // picture drawn through `next/image` later is served at its file's full size until this key goes.
  images: { unoptimized: true },
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
  turbopack: {
    rules: {
      // The plugin's `LocalesPlugin.d.ts` types `locales` as `readonly string[]`, which Next's
      // `TurbopackLoaderOptions` refuses; remove the assertion once the plugin's types accept Next's.
      ...(localeOptimization.rules as NonNullable<NextConfig["turbopack"]>["rules"]),
    },
  },
  experimental: {
    // Off because the router otherwise re-requests one link's payload without end on every page
    // with record rows (vercel/next.js#100055), until a Next release carries the fix.
    optimisticRouting: false,
    // Off, or every `next build` checks for advisories and reminds of an upgrade: in a terminal the
    // build's output waits behind the reminder's prompt for up to ten seconds, and run by a coding
    // agent, the gate's build included, the build stops with instructions for that agent and passes
    // when retried.
    agentUpgrade: false,
  },
  output: "standalone",
  // The server's own trace carries sharp, which only the image optimiser loads, and that is off above. Next applies
  // the patterns under the key `next-server` to that trace, as its own build does for the same two packages on Vercel.
  outputFileTracingExcludes: {
    "next-server": ["**/node_modules/sharp/**/*", "**/node_modules/@img/**/*"],
  },
  // No type check inside `next build`, the image's included: the gate's frontend scope runs tsc on
  // every CI event, and the publish job needs it green. Next skips its own check whole rather than
  // hiding what it finds.
  typescript: { ignoreBuildErrors: true },
  // TypeScript alone: Next's default also serves a `route.js` or a `page.jsx`, which tsc (`allowJs` off),
  // the lint globs and every sweep over handlers and pages never read.
  pageExtensions: ["tsx", "ts"],
  cacheComponents: true,
  // On: Next's documented pairing with `cacheComponents`, unset meaning off. A prefetch never carries
  // what waits on `connection()`, which is what keeps the match editor's fixture fresh.
  partialPrefetching: true,
  // No `reactCompiler`: measured at 6.5 to 11.7 KB gzipped per page for memoization this app needs in
  // two admin views, both hand-written.
};

export default nextConfig;
