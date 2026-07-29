/**
 * Content-Security-Policy emitted per request by `src/proxy.ts`.
 *
 * Shipped as `Content-Security-Policy-Report-Only`. The *enforced* policy lives in `nginx.conf` /
 * `nginx.local.conf` and still carries `'unsafe-inline'` on `script-src`; this one is the candidate
 * replacement, gathering violation evidence before anyone flips it (ledger row R3b-S9.1b).
 *
 * Deliberately no `'strict-dynamic'`, despite the audit recommending it. `'strict-dynamic'` voids
 * `'self'`, and 24 routes ship a build-time prerendered shell whose script tags carry no nonce --
 * a nonce is only available at request time. With `'strict-dynamic'` every script on every
 * prerendered page is blocked. `'self'` is what keeps the prerendered chunk scripts loading.
 */
/**
 * Hashes of the inline scripts that Next writes into the **build-time prerendered shell**.
 *
 * A nonce cannot cover these: it is generated per request, and this HTML was rendered during
 * `next build`, so its script tags carry no nonce and Next never re-stamps them. A hash is a
 * fingerprint of the script body instead of a per-visit password, so it survives prerendering.
 *
 * Measured, not guessed -- `csp.test.ts` recomputes them from `.next/server/app/*.html` on every
 * `pnpm verify` and fails with the exact replacement value if a dependency upgrade changes one.
 * Without that test a `next-themes` or React bump would silently break the theme script under an
 * enforcing policy, which shows up as a white flash before dark mode and nothing in the logs.
 */
export const PRERENDERED_INLINE_SCRIPT_HASHES = [
  // next-themes: applies the stored theme before first paint, to avoid a flash of the wrong theme.
  "'sha256-aKvoDLXHTwlsAHHIm9Kw3G8YoJNe4ZdKZn5KPuTqzYA='",
  // React: `requestAnimationFrame(function(){$RT=performance.now()})` -- Suspense reveal timing.
  "'sha256-7mu4H06fwDCjmnxxr/xNHyuQC6pLTHr4M2E4jXw5WZs='",
] as const;

export function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    // 'self' covers the prerendered external chunks, the nonce covers scripts rendered per request,
    // and the hashes cover the two inline scripts baked into the prerendered shell. Between them
    // every script in the app is accounted for, which is what lets 'unsafe-inline' finally go.
    `script-src 'self' 'nonce-${nonce}' ${PRERENDERED_INLINE_SCRIPT_HASHES.join(" ")}`,
    // Tailwind v4 and HeroUI inject styles at runtime; style injection is far less dangerous than script.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    // 'self' rather than https: -- the wildcard was an open exfiltration channel.
    "connect-src 'self'",
    // frame-ancestors does not fall back to default-src, and base-uri has no fallback at all.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}
