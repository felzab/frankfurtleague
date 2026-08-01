# ADR-0024 — `immutable` is only for content-hashed URLs

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** frontend, ops
**Supersedes:** —
**Superseded by:** —
**Source:** Found while diagnosing why every Open Graph checker showed an out-of-date preview image,
after the origin access log proved the scrapers were fetching successfully and getting correct HTML.

## Context

`next.config.ts` set one header rule for every image the app serves, matched by extension:

```
source: "/(.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico))"
Cache-Control: public, max-age=2629800, s-maxage=2629800, immutable
```

**`immutable` tells every cache that the bytes at this URL will never change.** A conforming cache is
then entitled to skip revalidation entirely for the lifetime of `max-age` — here, 30 days, restarted
on each fetch.

That promise is true for `/_next/static/*`, where the filename carries a content hash: change the
file and you change the URL, so a stale entry is unreachable by construction. It is **false** for
everything in `public/`. Those are stable URLs whose contents `pnpm brand` rewrites in place.

The Open Graph image is the case that surfaced it. Measured while the two disagreed:

|                                                 | bytes  | md5            |
| ----------------------------------------------- | ------ | -------------- |
| origin (`public/icons/opengraph/opengraph.png`) | 73,261 | `06f18e7805b4` |
| what Cloudflare served                          | 21,797 | `6ebb45ce20ac` |

with `cf-cache-status: HIT`, `Age: 179984` and `last-modified: Mon, 04 May 2026`. Every Open Graph
checker showed the May artwork, and each new fetch restarted the 30-day clock. The origin log showed
`facebookexternalhit`, `Twitterbot` and `LinkedInBot` all fetching the page and receiving `200` with
correct markup — the HTML was never the problem, and neither were the tools' own caches, which is
where the investigation looked first.

The failure is silent by construction: the asset updates in the repository, the deploy succeeds, and
nothing anywhere reports that readers are still being served the old bytes.

## Decision

**`immutable` is used only on URLs whose filename contains a content hash.** In practice that means
`/_next/static/*`, where Next already sets it, and nowhere else in this repository.

`public/` — everything under `/icons` — takes `public, max-age=86400, must-revalidate`. The rule is
scoped by path rather than by file extension, so it cannot drift onto hashed assets as new formats
appear.

## Consequences

**A changed brand asset is visible within a day** rather than within a month, and a conditional
request after that returns `304` against the existing `ETag`, so the recheck is nearly free.

**The rule no longer overlaps `/_next/static`.** The old extension regex matched hashed assets too;
scoping to `/icons/:path*` leaves Next's own — correct — `immutable` header as the only one there.

**Caching is weaker for nine small files**, which is the whole cost. They are brand marks fetched
once per visitor per day at worst.

**Purging is still required once.** Changing a header does not evict what edges already hold under
the old one, so the Open Graph image needs a manual Cloudflare purge to clear the May copy. Future
changes will not.

**The general rule to carry forward:** a long `max-age` is a guess that can be corrected; `immutable`
is a promise that cannot. Only make it where the URL changes with the content.

## Alternatives considered

**Content-hash the brand assets** — `opengraph.<hash>.png` emitted by `pnpm brand`, with the metadata
referencing the hashed name. This keeps the year-long cache and makes it honest, and is the better
answer for an asset fetched on every page. Rejected for these: it adds a build-time indirection and a
manifest to resolve names through, for nine files that change perhaps twice a year.

**Keep `immutable` and purge Cloudflare on every deploy.** Rejected because it only fixes the edge.
Browsers and third-party scrapers hold their own copies for the same 30 days and cannot be purged.

**Shorten `max-age` but keep `immutable`.** Rejected as incoherent: the directive would still forbid
revalidation, so the two would contradict each other for the shortened window.

## See also

- `fl_frontend/next.config.ts` — the scoped rule
- `fl_frontend/scripts/generate-brand-assets.mjs` — what rewrites these files in place
