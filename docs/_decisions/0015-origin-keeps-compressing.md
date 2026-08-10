# ADR-0015 — The origin keeps compressing; the edge does not do it better

**Status:** Accepted\
**Date:** 2026-08-01\
**Surface:** ops, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** A PageSpeed remediation change, since retired, was deployed, then measured against
the live site. It made the payload larger.

## Context

The largest render-blocking resource on every page is the stylesheet. Measured on the deployed file,
330,847 bytes uncompressed, the origin's gzip served it at roughly 35.9 KiB while `brotli -q 11`
compresses the same file to 28.0 KiB — a gap worth chasing on the one resource that blocks first
paint.

**Cloudflare passes through any response that already carries a `Content-Encoding` rather than
recompressing it.** For a cached, immutable asset that decision is permanent: whichever layer
compresses first fixes the encoding for the whole cache lifetime. And the layer doing the
compressing was not the obvious one: `nginx/prod.conf` has `gzip on`, which makes nginx look
responsible, but asked directly — with nginx nowhere in the path — the frontend container already
answered `Content-Encoding: gzip`. Next's `compress` option defaults to `true`, and nothing had
overridden it. Turning gzip off in nginx alone would therefore have been a no-op: the response
arrives already encoded, and nginx cannot compress it twice.

On that reading, the retired change stopped the origin compressing `/_next/static/` —
`compress: false` in `fl_frontend/next.config.ts` plus a `gzip off` exemption in `nginx/prod.conf` —
so the edge could pick the encoding per client. Its premise was that the edge would compress better
than the origin. **Measured against the deployed site, it does not.**

Same file, asking Cloudflare for each encoding in turn:

| Accept-Encoding           | served | bytes      |
| ------------------------- | ------ | ---------- |
| `zstd, br, gzip` (Chrome) | zstd   | **38,671** |
| `br`                      | br     | 36,779     |
| `gzip`                    | gzip   | 35,924     |
| _origin gzip, before_     | gzip   | ~35,862    |

Cloudflare picks **zstd** for a real browser, and zstd is the largest of the three. The change made
every first visit roughly **2.8 KB heavier** than before it. The 28 KB that justified the experiment
comes from `brotli -q 11`, and **no CDN runs q11 on the fly** — it is far too CPU-expensive per
request, so edges compress at roughly q4. Benchmarking a CDN against a local best setting was the
error; the comparison should always have been against what an edge actually returns.

## Decision

**The origin compresses.** Next keeps its default `compress: true`, and `nginx/prod.conf` carries no
`gzip off` exemption on `/_next/static/`. `local.conf` and `prod.conf` stay in agreement, with no
comment explaining a difference, because there is none.

**Do not pursue build-time brotli precompression** (decision, 2026-08-01). It is the only route to
the 28 KB — precompress at q11, serve the `.br`, let Cloudflare pass it through — but this stack
proxies static assets through nginx to the Next container rather than serving them from disk, and
`nginx:alpine` ships no `ngx_brotli`. That means a custom nginx image or conditional proxy rewriting
with per-extension `Content-Type` fixing and a 404 fallback, for under 8 KB. The payload was
attacked at the source instead ([ADR-0016](0016-admin-only-css-split.md)).

## Consequences

**Visitors get ~35.9 KB again** instead of 38.7 KB, and the origin does the work once per cache
fill.

**The passthrough behaviour is real and now works in this stack's favour** — Cloudflare will not
recompress what already carries a `Content-Encoding`, and because the origin compresses _better_
than the edge, passthrough is the thing to want. Anyone re-deriving the original experiment should
note that its mechanism was correct and only its conclusion was wrong.

**The 28 KB is left on the table, deliberately.** If this stack ever serves static assets from disk
at the nginx layer, precompression becomes cheap and this decision is worth revisiting — but not
before.

## Alternatives considered

**Let the edge choose the encoding** — the retired experiment itself: `compress: false` plus a
per-location `gzip off`, leaving `/_next/static/` to reach Cloudflare as identity. Deployed,
measured, reverted: the edge's zstd is larger than the origin's gzip.

**Enable Brotli in the Cloudflare dashboard.** It addresses nothing — the setting is evidently
already on, since dynamic HTML from the same host returns `zstd`. The problem was never the edge's
willingness to compress.

**`gzip off` in nginx, without touching Next.** A no-op, and recorded because the setup makes nginx
look like the culprit: the response reaches nginx already gzipped by Next, so the directive has
nothing to act on. Someone will reach the same wrong conclusion again.

**Keep the edge experiment and enable a higher brotli level at Cloudflare.** No such control exists
on this plan; compression level is not exposed.

**Precompress at build time.** The only path to 28 KB, and rejected on cost above rather than on
merit.
