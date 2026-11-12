import optimizeLocales from "@react-aria/optimize-locales-plugin";

import type { NextConfig } from "next";

// Every locale an `I18nProvider` sets belongs here: React Aria's strings for any other are emptied
// from the server bundle and the client's alike.
const localeOptimization = optimizeLocales.turbopack({ locales: ["de-DE"] });

const nextConfig: NextConfig = {
  // The image's version, from the image's build argument: a page opened before a deploy
  // loads the new build whole on its next navigation rather than asking the new server for the old
  // build's chunks and actions. A build handed none, the gate's and the local stack's, sets no id.
  deploymentId: process.env.APP_VERSION || undefined,
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
  // access log.
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
    // Off because the router otherwise re-requests one link's payload without end on every page
    // with record rows (vercel/next.js#100055), until a Next release carries the fix.
    optimisticRouting: false,
    // Off, or every `next dev` and `next build` checks for advisories and reminds of an upgrade: in a
    // terminal the command's output waits behind the reminder's prompt for up to ten seconds, and run
    // by a coding agent, the gate's build included, the command stops with instructions for that
    // agent and passes when retried. The gate's advisory check is `pnpm audit:prod`.
    agentUpgrade: false,
  },
  output: "standalone",
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
  // No `reactCompiler`: it adds kilobytes to every page for memoization this app needs in two admin
  // views, both hand-written.

  // Off, or `next dev` run by an agent writes its own block into an `AGENTS.md` here, which an agent
  // then loads as instructions nobody reviewed.
  agentRules: false,
};

export default nextConfig;
