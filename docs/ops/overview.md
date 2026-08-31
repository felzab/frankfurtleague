# Ops — overview

**Scope:** `docker-compose*.yml`, `nginx/`, `scripts/`, both Dockerfiles

Three containers behind nginx on one host, deployed by pulling published images. There is no orchestrator,
no CI runner and no build on the server — deliberately, because a server that builds is a server that can
fail a build.

> **[`spec.md`](spec.md) is the operational manual** and [`runbooks.md`](runbooks.md) holds the recurring
> procedures. What follows is the topology and the constraints they assume.

## How it is organised

```mermaid
graph TB
    internet["Internet"]
    cf["Cloudflare<br/>proxy — terminates public TLS"]

    subgraph net["Docker network: frankfurtleague-net"]
        nginx["nginx<br/>:80 :443 — the only published ports"]
        fe["frontend :3000<br/>Next.js standalone, user nextjs"]
        be["backend :8000<br/>FastAPI"]
    end

    mongo[("MongoDB<br/>managed cluster, off this host")]

    internet --> cf
    cf --> nginx
    nginx -->|"/api/v0/system/is_live"| be
    nginx -->|"/api/auth · /api/client-error · /api/bewerbung · /api/bewerbung/kuerzel<br/>/api/admin/ · /signin · /_next/static · /"| fe
    fe -->|"server-side fetch"| be
    fe -->|"authjs database only"| mongo
    be --> mongo
```

**The diagram is production's.** The local stack adds a database service to the same network and points
both application services at it, so its two database arrows reach a container rather than the cluster
([`spec.md`](spec.md) §1.5).

**Only nginx publishes a port another host can reach** ([`spec.md`](spec.md) I1), so nginx's routing table
is the whole of what the internet can address on this host.

**The two arrows into the cluster are two different database users**, neither holding a `*AnyDatabase` role: the
backend on the application database alone, Auth.js on `authjs` alone, read from the cluster's users 2026-08-02
because no file here records either grant. **Never give the two a shared login** — that makes the boundary a
matter of trust rather than of configuration. Auth.js reaching **its own** database is the one sanctioned
direct reach from the frontend into MongoDB ([`../frontend/overview.md`](../frontend/overview.md)); the
backend's user also needs `collMod` ([`../backend/spec.md`](../backend/spec.md) §4).

## The Cloudflare proxy

Nothing here manages the Cloudflare account, its DNS or its SSL mode, and none of what follows is visible
from a configuration file in this repository.

- **A visitor's TLS session terminates at Cloudflare, not at nginx.** The cipher suites, session settings and
  OCSP stapling in `nginx/prod.conf` govern the Cloudflare-to-origin hop, not what a browser negotiates.
- **An origin failure can surface as a Cloudflare error code**, not as anything nginx logged. A rejected TLS
  handshake at the origin appeared publicly as `525`, naming neither nginx nor the server block behind it.
- **The headers a visitor receives are whatever survives the proxy.** They matched `prod.conf` when verified
  2026-08-01, which makes them a property to re-verify rather than assume.
- **Cloudflare compresses only what arrives uncompressed**, and its own compression measured _worse_ than the
  origin's on the same file — 2026-08-01, 38.7 KB of zstd against 35.9 KB. So the origin keeps compressing,
  and brotli is never precompressed at build time
  ([`../../.claude/CLAUDE.md`](../../.claude/CLAUDE.md) §7).

**Edge settings deliberately off**, each looking like free performance: **Rocket Loader** reorders script
execution, which React hydration and Next's streaming depend on; **Cloudflare Fonts** removes third-party font
requests and `next/font` self-hosts at build time, so there are none; **Shared Dictionary Compression** deltas
a file against an older version of itself, and every chunk here is content-hashed, so a rebuild produces a new
filename instead. **Early Hints** is the one worth turning on — the HTML already emits a `Link: rel=preload`
header Cloudflare can promote to a 103. What is actually set is readable only in the Cloudflare dashboard.

## Routing

nginx matches by longest prefix, and the rule to carry away is that **the frontend takes everything except
one exact path**: `= /api/v0/system/is_live` is the whole of what the edge hands the backend, and every other
`/api/...` request reaches Next — some through a block naming it, the rest through the catch-all. The
table, with its rate-limit zones and cache headers, is [`spec.md`](spec.md) §1.3.

That is what makes **a backend route unreachable from the internet unless an nginx location publishes it**,
and adding a location for one is what publishes it ([`spec.md`](spec.md) I13). A frontend route runs the other
way round: the catch-all carries every path nginx does not name to Next, so a route handler is reachable from
the internet the moment it exists, and its own authorization is all that stands in front of it. FastAPI's
Swagger UI is the backend half of that rule — it sits at the app root (`/docs`), which the catch-all sends to
Next, so the API documentation is a development and in-network tool.

## Security posture

The values and the arguments behind them are [`spec.md`](spec.md) §1.3–§1.4 and invariants I2–I4. The shape:

- **The origin is hardened even though a proxy sits above it** — TLS 1.2/1.3 only, one enforced CSP, the
  security header set, and a `default_server` rejecting an unknown `Host` at TLS time rather than forwarding
  it verbatim to Next ([`spec.md`](spec.md) I3).
- **The published unauthenticated writes are rate-limited at the edge** — the sign-in POST, whose action id
  ships in a client chunk, the client-error ingest, and the public application form's submit, which alone
  among them writes league data ([`spec.md`](spec.md) §1.3; the sign-in limit applies
  to POST alone, I4). **Every one of those zones is paired** — one keyed on the visitor's /64 and one on the
  /48, because the /64s a single subscriber holds would otherwise outlast any rate the narrow zone can set.
  **The liveness probe is published unauthenticated too and carries no zone**, which is a decision §1.3
  records rather than an omission, and the catch-all takes a connection ceiling instead of a rate.
- **The origin trusts Cloudflare's published address ranges** to name the visitor in the header
  `nginx/prod.conf :: real_ip_header` selects — which is what lets a rate limit key per visitor rather
  than per point of presence; bounding what one visitor's own address space can spend is the paired
  zones' job instead ([`spec.md`](spec.md) §1.3). The list is maintained by hand and goes
  stale, and it is every Cloudflare customer's egress rather than this account's.
- **`'unsafe-inline'` on `script-src` is deliberate**, its compensating control being the `react/no-danger`
  lint rule — a nonce cannot cover build-time prerendered HTML.
- **The two application containers drop all capabilities** and set `no-new-privileges`; the nginx container
  does neither ([`spec.md`](spec.md) §4). The frontend runs non-root, and `public/` stays root-owned so the
  app cannot write to it.

## Images and deployment

Both images are multi-stage; the frontend builds to Next's `standalone` output and runs under `tini`. **The
builder stage has no reachable backend and no real environment** ([`spec.md`](spec.md) I5): anything reaching
the API or constructing a URL from `AUTH_URL` at module scope fails the image build rather than at runtime.

Deployment is `pull` plus in-place container recreation, so the interruption is seconds rather than the full
outage a `down`/`up` cycle would cause ([`spec.md`](spec.md) I6 and I9), and nginx waits on **both** services'
health so an unhealthy deploy is never served. Each service's package on GitHub Container Registry is
**public**, which is what lets the server pull anonymously — production holds no registry credentials at all.
Rollback is pulling a pinned `:sha-<commit>` tag; every image carries OCI labels recording the commit it was
built from, which is why `deploy.sh --status` stays truthful even if a tag was moved.

## Environments and secrets

The environments are deliberately separated — dev, local and prod ([`spec.md`](spec.md) §1.5). Two things
to know about **local** before touching it: it runs the production image built from the working tree, behind
nginx, which makes it the only place a packaging problem is visible before a deploy, and it is the only one
with a database of its own — dev reads whatever the `.env` files point at.

Both services read a `.env` file supplied by Compose; neither is in the repository. The frontend validates its
environment at startup and **fails with variable names only, never values**. The API keys must match on both
sides, and the length rule is [`spec.md`](spec.md) I11.

## Read next

- [`spec.md`](spec.md) — the service contracts and the invariants
- [`runbooks.md`](runbooks.md) — the recurring procedures, and what this repository cannot record about the host
- [`../frontend/overview.md`](../frontend/overview.md) — the application server behind nginx
- [`../backend/overview.md`](../backend/overview.md) — the API it fetches from
