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
  // Top-level, not under `experimental` — that was the Next 15 spelling and is silently ignored here.
  // Needs `babel-plugin-react-compiler` installed; Next pre-filters with SWC so Babel only ever sees
  // files with JSX or hooks. Opt-in in Next 16, but Next's own announcement says a future release
  // enables it by default, so this is where the project is heading regardless.
  // Measured on this repo (NEW-P1), clean builds: 14.8 s → 16.1 s, client chunks 2,415,735 →
  // 2,500,541 bytes (+84 KB raw, the memo caches it writes).
  // It is what closes R4-18.2 and R4-18.3 — do not add hand-written useMemo for those.
  reactCompiler: true,
};

export default nextConfig;
