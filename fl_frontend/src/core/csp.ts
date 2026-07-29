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
export function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
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
