# ADR-0022 — The origin keeps compressing; the edge does not do it better

**Status:** Accepted
**Date:** 2026-08-01
**Surface:** ops, frontend
**Supersedes:** [ADR-0021](0021-static-assets-reach-the-edge-uncompressed.md)
**Superseded by:** —
**Source:** ADR-0021 was deployed, then measured against the live site. It made the payload larger.

## Context

ADR-0021 stopped the origin compressing `/_next/static/` so Cloudflare could apply brotli. Its premise
was that the edge would compress better than the origin. **Measured against the deployed site, it does
not.**

Same file, 330,847 bytes uncompressed, asking Cloudflare for each encoding in turn:

| Accept-Encoding           | served | bytes      |
| ------------------------- | ------ | ---------- |
| `zstd, br, gzip` (Chrome) | zstd   | **38,671** |
| `br`                      | br     | 36,779     |
| `gzip`                    | gzip   | 35,924     |
| _origin gzip, before_     | gzip   | ~35,862    |

Cloudflare picks **zstd** for a real browser, and zstd is the largest of the three. The change made
every first visit roughly **2.8 KB heavier** than before it.

The same file compressed locally:

| method         | bytes      |
| -------------- | ---------- |
| `gzip -9`      | 35,807     |
| `brotli -q 5`  | 32,467     |
| `brotli -q 11` | **28,134** |

The 28 KB that justified ADR-0021 comes from `brotli -q 11`. **No CDN runs q11 on the fly** — it is far
too CPU-expensive per request, so edges compress at roughly q4. Benchmarking a CDN against a local best
setting was the error; the comparison should always have been against what an edge actually returns.

## Decision

**Revert ADR-0021.** Next keeps its default `compress: true`, and `nginx/prod.conf` has no `gzip off`
exemption. `local.conf` loses the comment explaining a difference that no longer exists.

**Do not pursue build-time brotli precompression** (owner, 2026-08-01). It is the only route to the
28 KB — precompress at q11, serve the `.br`, let Cloudflare pass it through — but this stack proxies
static assets through nginx to the Next container rather than serving them from disk, and `nginx:alpine`
ships no `ngx_brotli`. That means a custom nginx image or conditional proxy rewriting with per-extension
`Content-Type` fixing and a 404 fallback, for under 8 KB. The payload was attacked at the source instead
(ADR-0023).

## Consequences

**Visitors get ~35.9 KB again** instead of 38.7 KB, and the origin does the work once per cache fill.

**The passthrough behaviour ADR-0021 described is real and still true** — Cloudflare will not recompress
what already carries a `Content-Encoding`. That fact simply cuts the other way: because the origin
compresses _better_ than the edge, passthrough is now the thing to want. Anyone re-reading ADR-0021 and
finding its mechanism correct should note that only its conclusion was wrong.

**The 28 KB is left on the table, deliberately.** If this stack ever serves static assets from disk at
the nginx layer, precompression becomes cheap and this decision is worth revisiting — but not before.

## Alternatives considered

**Keep ADR-0021 and enable a higher brotli level at Cloudflare.** There is no such control on this plan;
compression level is not exposed.

**Keep ADR-0021 and accept the 2.8 KB.** Rejected: it is a regression with no compensating benefit.

**Precompress at build time.** The only path to 28 KB, and rejected on cost above rather than on merit.

## See also

- [ADR-0021](0021-static-assets-reach-the-edge-uncompressed.md) — the decision this reverses
- [ADR-0023](0023-admin-only-css-split.md) — where the payload was actually reduced
