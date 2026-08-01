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
    // `@heroui/styles` is deliberately absent: it is consumed as CSS, so there are no named imports
    // for this to barrel-optimise and listing it was a no-op (R1 §9).
    optimizePackageImports: ["@heroui/react", "@gravity-ui/icons"],
  },
  output: "standalone",
  cacheComponents: true,
  // No `reactCompiler` here, and that is a measured decision rather than an oversight (NEW-P1,
  // reversed by the owner 2026-07-31). Enabling it cost **+40 KB gzipped** on every page load
  // (734,544 → 774,793) and +1.3 s of build, to write memoization this app needed in exactly two
  // places — both now hand-written, in `AdminSpieleActionRequiredView` and `AdminContextProvider`.
  // For scale: a payload finding worth 3.5 KB (NEW-P2) was rejected as not worth its cost in the
  // same wave.
  // **Reversal trigger:** Next enabling the compiler by default, or a React feature that requires
  // it. Turning it back on is this one key plus `babel-plugin-react-compiler` as a devDependency;
  // delete the two `useMemo`s at that point rather than leaving them beside the compiler's own.
};

export default nextConfig;
