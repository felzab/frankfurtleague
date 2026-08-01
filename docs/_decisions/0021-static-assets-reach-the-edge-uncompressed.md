# ADR-0021 — Static assets reach the edge uncompressed

**Status:** Accepted
**Date:** 2026-08-01
**Surface:** ops, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Found while reading response headers after a PageSpeed re-run, when the deployed
stylesheet measured 35.9 KiB against the 28.0 KiB the same file compresses to under brotli.

## Context

The largest render-blocking resource on every page is the stylesheet. Measured on the deployed file:

| encoding               | bytes   |
| ---------------------- | ------- |
| identity               | 330,847 |
| gzip (what was served) | 35,862  |
| brotli `-q 11`         | 27,984  |

**Cloudflare passes through any response that already carries a `Content-Encoding` rather than
recompressing it.** For a cached, immutable asset that decision is permanent: whichever layer
compresses first fixes the encoding for the whole cache lifetime. The evidence is in the site's own
headers — dynamic HTML, which the edge does not cache, comes back `zstd`; the cached CSS and JS
chunks come back `gzip`. The edge is willing and able; it was simply never given the chance.

The layer doing the compressing was **not** the obvious one. `nginx/prod.conf` has `gzip on` with
`text/css` and `application/javascript` in `gzip_types`, which makes nginx look responsible. Asked
directly, with nginx nowhere in the path, the frontend container answered:

```
$ wget -S http://frontend:3000/_next/static/chunks/<hash>.css
  Content-Encoding: gzip
```

Next's `compress` option defaults to `true` and nothing had overridden it. **Turning gzip off in
nginx alone would have been a no-op**, because the response arrives already encoded and nginx cannot
compress it twice — which is exactly what the first reading of this problem proposed doing.

## Decision

**Let `/_next/static/` reach Cloudflare as identity, and let the edge choose the encoding.**

Two changes, both required, neither sufficient alone:

- `compress: false` in `fl_frontend/next.config.ts` — Next stops encoding its own responses.
- `gzip off` in `nginx/prod.conf`'s `/_next/static/` block — nginx does not take over the job.

`nginx/local.conf` **deliberately keeps gzip** on the same block, and says so at the site. There is no
edge in front of the local stack, so nginx is the only compressor left once Next stops.

## Consequences

**The edge picks per client**, so a browser advertising `br` or `zstd` gets it instead of gzip. Worth
roughly 8 KiB on the stylesheet and a similar proportion of the JavaScript payload, against a
resource that blocks rendering.

**Server-level `gzip on` still covers everything else** — HTML, API responses, the manifest. Only the
one location is exempt, and only because only that location is edge-cached and immutable.

**The origin now depends on the edge for asset compression.** If Cloudflare is ever bypassed —
testing against the origin IP, or a future decision to drop the proxy — `/_next/static/` is served
raw. This is the real cost of the decision. It is acceptable because those files are `immutable` and
cache-HIT, so each one leaves the origin roughly once, but **removing the Cloudflare tier means
reverting this ADR in the same change.**

**`local.conf` and `prod.conf` now differ on purpose**, and the difference is invisible unless you
read the comments. Syncing them, in either direction, breaks one environment: copying prod's
`gzip off` into local serves every chunk raw on localhost; copying local's silence into prod restores
the passthrough this decision exists to prevent.

**The production result is unverified at merge time.** Everything above was measured against the
local stack and the previously deployed build; the edge's chosen encoding and quality can only be
confirmed after a deploy.

## Alternatives considered

**Enable Brotli in the Cloudflare dashboard.** The obvious move, and it addresses nothing — the
setting is evidently already on, since dynamic HTML from the same host returns `zstd`. The problem was
never the edge's willingness to compress.

**`gzip off` in nginx, without touching Next.** This was the first proposal, and it was wrong.
Measured: the response reaches nginx already gzipped by Next, so the directive has nothing to act on.
Recorded because the setup makes nginx look like the culprit and someone will reach the same wrong
conclusion again.

**Compress at the origin with brotli instead**, via `brotli_static` or an nginx brotli module.
Rejected on two counts: Next emits no `.br` files, so it would mean a build step or per-request
compression on the origin for assets the edge serves anyway; and it re-creates the passthrough
coupling at a lower compression quality than the edge's, with no zstd for clients that prefer it.

**Leave it as gzip.** Rejected on the measurement: 8 KiB on the single resource that blocks the first
paint, for a two-line change.

## See also

- `fl_frontend/next.config.ts` and `nginx/prod.conf` — the two halves, each commented
- [`docs/ops/overview.md`](../ops/overview.md) — the Cloudflare tier and which edge settings are off
