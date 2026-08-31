# Ops — spec

**Scope:** `docker-compose*.yml`, `nginx/`, `scripts/`, both Dockerfiles

| Section                                                | Answers                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| [1.1 Service inventory](#11-service-inventory)         | What runs in production, with which limits and health checks         |
| [1.2 Mounts](#12-mounts)                               | Which host paths must exist before `up`                              |
| [1.3 nginx routing](#13-nginx-routing)                 | Which upstream serves which path                                     |
| [1.4 Security headers](#14-security-headers)           | What is set, and why `'unsafe-inline'` survives                      |
| [1.5 The scripts](#15-the-scripts)                     | Which script to reach for, and which environment it belongs to       |
| [1.6 The verification gate](#16-the-verification-gate) | Which scopes exist, what each runs, and what each needs              |
| [1.7 Script conventions](#17-script-conventions)       | What every script shares, and what every line of output goes through |
| [2. Invariants](#2-invariants)                         | The rules that must hold                                             |
| [3. Violation → remedy](#3-violation--remedy)          | A symptom, its cause, and what to do about it                        |
| [4. Known-open](#4-known-open)                         | The accepted gaps                                                    |

The recurring procedures — the constraints checker, the brand mark, an admin revocation — are in
[`runbooks.md`](runbooks.md). This page covers the contracts and constraints those procedures depend
on, and the scripts that carry them.

---

## 1. Contract

### 1.1 Service inventory

| Service    | Image                                            | Ports published | Resource limits                   | Health check                         |
| ---------- | ------------------------------------------------ | --------------- | --------------------------------- | ------------------------------------ |
| `frontend` | `ghcr.io/felzab/frankfurtleague-frontend:latest` | none            | 1.5 CPU / 2 GB, 512 MB reserved   | `wget` on `/favicon.ico`             |
| `backend`  | `ghcr.io/felzab/frankfurtleague-backend:latest`  | none            | 0.8 CPU / 512 MB, 128 MB reserved | `urllib` on `/api/v0/system/is_live` |
| `nginx`    | `nginx:1.31-alpine`                              | **80, 443**     | 0.5 CPU / 256 MB, 128 MB reserved | none                                 |

All three: `restart: unless-stopped`, and JSON file logging capped at 3 × 10 MB, on the
`frankfurtleague-net` bridge network. **`cap_drop: ALL` and `no-new-privileges:true` are the two
application services' only** — `nginx` declares neither `cap_drop` nor `security_opt`
(`docker-compose.yml :: nginx`), which is recorded in §4 rather than assumed to be deliberate.

`nginx` declares `depends_on` both services with `condition: service_healthy`.

**Note:** `API_VERSION` is a constant of the code rather than a setting
([`docs/backend/spec.md`](../backend/spec.md) §1.5), so bumping it is a code change — and the version is
spelled again outside the code, at sites a commit does not all reach. §4 names the sites where a version
left behind breaks something rather than every string that spells it; the tests under `fl_backend/tests/api/`
spell it too and fail loudly at the gate. §3 carries what each failure looks like.

### 1.2 Mounts

| Host path           | Container path                   | Mode      |
| ------------------- | -------------------------------- | --------- |
| `./nginx/prod.conf` | `/etc/nginx/conf.d/default.conf` | read-only |
| `./certs`           | `/etc/nginx/certs`               | read-only |

Both are files or directories that must exist before `up`. If a mounted config file is missing, Docker
creates a **directory** at that path and nginx fails with `not a directory` — `deploy.sh` checks for
this before starting.

### 1.3 nginx routing

Longest-prefix match. Order in the file is irrelevant; specificity decides.

| Location                    | Upstream        | Notes                                                                                                                                                                                                |
| --------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`                 | `frontend:3000` | Auth.js's catch-all route handler                                                                                                                                                                    |
| `= /api/client-error`       | `frontend:3000` | Next route handler, paired `limit_req` — `zone=clienterr burst=3` and `zone=clienterr48 burst=30` ([`docs/logging/spec.md`](../logging/spec.md))                                                     |
| `= /api/bewerbung`          | `frontend:3000` | Next route handler, the public application form's submit — paired `limit_req` `zone=bewerbung burst=2` and `zone=bewerbung48 burst=20`, and `client_max_body_size 64k` overriding the server block's |
| `= /api/bewerbung/kuerzel`  | `frontend:3000` | Next route handler, that form's Kürzel check — paired `limit_req` `zone=kuerzel burst=10` and `zone=kuerzel48 burst=100`                                                                             |
| `= /signin/`                | `frontend:3000` | Trailing-slash twin of `= /signin`, carrying the same paired zones                                                                                                                                   |
| `= /api/client-error/`      | `frontend:3000` | Trailing-slash twin of `= /api/client-error`, carrying the same paired zones                                                                                                                         |
| `= /api/bewerbung/`         | `frontend:3000` | Trailing-slash twin of `= /api/bewerbung`, same paired zones and the same `client_max_body_size 64k`                                                                                                 |
| `= /api/bewerbung/kuerzel/` | `frontend:3000` | Trailing-slash twin of `= /api/bewerbung/kuerzel`, carrying the same paired zones                                                                                                                    |
| `/api/admin/`               | `frontend:3000` | The page-owned editors' undo handlers                                                                                                                                                                |
| `= /api/v0/system/is_live`  | `backend:8000`  | The liveness probe, and the only backend endpoint the edge exposes — `Cache-Control: no-store` (I13, §3)                                                                                             |
| `= /signin`                 | `frontend:3000` | Paired `limit_req` — `zone=signin burst=3` and `zone=signin48 burst=30`                                                                                                                              |
| `/_next/static/`            | `frontend:3000` | `expires max`, `Cache-Control: public, max-age=31536000, immutable`                                                                                                                                  |
| `/`                         | `frontend:3000` | Catch-all — `limit_conn conn 50`, the only ceiling that reaches it                                                                                                                                   |

**Every `/api/...` path but the liveness probe reaches Next** — some through a block naming it, the rest
through the catch-all, which answers Next's HTML 404 where nothing routes the path, and a 308 where the path
carries a trailing slash (§3). The liveness location is exact-match precisely so that nothing can join it
there. Nothing in the application meets that 404: every application
read of the API is a server-side fetch across `frankfurtleague-net` to `API_URL`
([`../frontend/overview.md`](../frontend/overview.md)) rather than a request through the edge, so a browser
or anything off this host is what meets it.

**Exact-match binds the path nginx matched, not the URI FastAPI is handed.** nginx merges repeated slashes
and resolves `.` and `..` before choosing a location, and `proxy_pass` with no URI part then forwards the
request line as the client wrote it — so `/api/v0//system/is_live` and `/api/v0/system/./is_live` match this
block and are answered by FastAPI's own `{"detail":"Not Found"}` rather than by Next (measured 2026-08-28).
No further route opens up: both sides percent-decode, and only nginx collapses and resolves, operations that
can only remove path segments, so a URI this block matches decodes either to the probe or to nothing. What
does escape is a fingerprint — a FastAPI error body on the public internet names the framework the origin
runs.

**`$remote_addr` is the visitor rather than the Cloudflare edge.** `realip` rewrites it from the
header `nginx/prod.conf :: real_ip_header` names, for a request arriving from one of Cloudflare's
published ranges (`nginx/prod.conf :: set_real_ip_from`), and every `limit_req` zone here keys on what
that rewrite produced — through `nginx/prod.conf :: map $remote_addr $client_net` and
`nginx/prod.conf :: map $remote_addr $client_net48`, and for all but the two Kürzel zones through a
method map as well; `limit_conn` on the catch-all keys on the narrow map alone. Without the rewrite every visitor behind one point of
presence would share a key. **The range list is maintained by hand and goes stale**, and the trust it
grants reaches every Cloudflare customer rather than this account alone (§4); the access line records
what the rewrite produced ([`docs/logging/spec.md`](../logging/spec.md) §1.2).

**Every zone here is keyed on a POST map, the two Kürzel zones excepted.** `$signin_limit_key` is empty for
anything but a POST and an empty key is exempt from `limit_req` altogether, which is what lets the method maps
serve `signin`, `clienterr` and `bewerbung` without limiting the GETs that reach those paths. There are two
of them, `$signin_limit_key` and `$signin_limit_key48`, because a `map` takes one source variable and the
wide key needs the same POST-only shape rather than a second condition. The Kürzel
check IS a GET — the browser fires it when the Kürzel field loses focus — so keyed there it would
read as limited and be unlimited, with nothing to say so. Its zones key on `$client_net` and `$client_net48`
unconditionally instead, at a rate well above the submission's, the two being different shapes of
traffic on one form.

**Underneath both, the key is a NETWORK rather than an address, and there are two of them.**
`nginx/prod.conf :: map $remote_addr $client_net` answers the /64 for an IPv6 visitor and the whole address
for an IPv4 one, `nginx/prod.conf :: map $remote_addr $client_net48` answers the /48, and the method maps
chain onto both, so the POST-only gate and the network keys compose rather than competing. IPv4 has no room
to walk and keys whole under either.

**A /64 is the FLOOR of what one subscriber holds, not the ceiling — which is why the /48 key exists.** It is
the smallest block anyone is allocated, so keying the /128 would let a customer walk every zone using
addresses they already hold; but RFC 6177 puts an end site at "at least one /64, and in most cases
significantly more", and RIPE-690 strongly discourages assigning longer than a /56, making /48 the business
allocation and /56 the residential one. One subscriber therefore holds between 256 and 65,536 /64s, and a /64
key alone bounds nothing at that scale. The narrow key keeps ordinary visitors apart; the wide one caps the
walk across a subscriber's own blocks.

**A /56 key is not expressible from these strings, which is why the wide key is a /48.** A /56 needs the top
byte of the fourth group, and nginx prints a group with its leading zeros stripped, so character position
stops tracking bit position: `0034` and `00ff` share a /56 and print `34` and `ff`, splitting it, while
`3400` prints `3400`, whose first two characters are `34` again though its /56 differs from both. Three whole
groups have no such problem.

**Every render shape is enumerated rather than matched by a prefix, in both maps, and that is what makes
each key exact.** nginx compresses the longest run of two or more zero groups, and where that run falls
depends on the HOST bits — which are no part of the prefix — so one prefix reaches a map written several ways,
and a shape the map misses splits it into two buckets and doubles its allowance. The `$client_net` branches
anchored on `::` cover a run followed by five or six groups, where the tail reaches back into the /64;
`$client_net48` needs one such branch, for a `::` followed by exactly six groups, that being the only shape
whose third group survives compression — fewer groups put a zero there, which the trailing branches already
answer.

Both maps were verified against a RUNNING nginx rather than a reimplementation of one. Their bodies were
extracted from the `.conf` files into a throwaway `nginx:1.31-alpine` that answered with `$remote_addr`,
`$client_net` and `$client_net48` for an address supplied per request, so what came back is what nginx itself
renders and keys rather than what a second implementation predicts. Over 9,560 requests covering 7,953 /64s
and 7,027 /48s, spanning every zero/non-zero group pattern, global unicast, link-local, ULA and the
IPv4-embedded forms: no prefix split across two keys, no two prefixes shared one, no address reached the
fail-open `default`, and every key equalled its true prefix exactly rather than merely staying consistent. A
hierarchy check found no two addresses sharing a /64 while differing in /48, so the wide key never cuts
across the narrow one. The single-zero-group shapes were driven explicitly and render UNCOMPRESSED, one
address showing both behaviours at once: `2001:db8:0:1::3:4` compresses its two-group run and leaves its lone
zero as `0` (measured 2026-08-30). Both files carry byte-identical map bodies, though nothing enforces that
(§4, OPS-78).

**Both zones are repeated inside every limited location rather than declared once at server level.**
nginx inherits `limit_req` only where the level declares none, so a server-level pair would be dropped whole
by each of the four blocks that declares one of its own — the replace-rather-than-extend rule I2 records for
`add_header`, reaching a third directive. `limit_conn` inherits the same way, and `location /` declares it
alone.

**Each metered path has a trailing-slash twin carrying the same zones.** An exact match is exact: `=
/api/bewerbung` does not match `/api/bewerbung/`, which fell to the catch-all and reached Next unmetered, 18
requests of 18 passing before the twins existed. Next answers every such form with a 308 to the canonical
path and no handler runs, so the twins change nothing a visitor sees; what they close is unmetered upstream
work. They proxy rather than answering at the edge, a `return 308` here being nginx deciding a
trailing-slash policy that is Next's, which would then have to be kept in step with it. Percent-encoded,
double-slash and dot-segment forms need no twin: nginx decodes, merges and resolves each before matching, and
all three were measured reaching their zone (measured 2026-08-30, the twins refusing after the burst).

**Each pair is one narrow zone and one wide one, the wide at ten times the rate and the burst.** The narrow
zone is what decides an ordinary visitor's request and the wide one never does, while a walk across a
subscriber's own /64s meets a ceiling ten times its twin's rather than 65,536 times it. The pairs are held
apart per endpoint rather than pooled, a Kürzel keystroke and an outbound email costing differently and one
shared ceiling letting the cheap traffic spend what guards the expensive. Each wide zone is sized `5m`
against its twin's `10m`, any traffic mix holding fewer /48s than /64s.

**The application form's submission carries the lowest rate here, and the wide zone is the lever.** Its
handler mails an address the REQUEST supplied, so every allowed request is a message to a chosen stranger.
The narrow rate sets a single /64's ceiling at 120 requests an hour; the wide zone is what moves a /48
holder's reachable ceiling from the roughly 7.8 million an hour that many /64s would otherwise buy down to
1,200. Lowering the ceiling again is the wide multiplier's job rather than the narrow rate's.

**`location /` takes a connection ceiling rather than a rate zone.** It carries every page and every server
action, and a `limit_req` there would meter `/_next/static` too and stall an ordinary page load, so
`limit_conn conn 50` on the narrow key bounds the same flood without metering anything;
`limit_conn_status` matches `limit_req_status`, so one access line's `status` means the same thing whichever
refused. It is sized for HTTP/2, where nginx counts each CONCURRENT REQUEST as a connection, so one
navigation spends many at once. It bites a direct-to-origin flood; through Cloudflare, whose edge pools
origin connections, it is a backstop rather than a per-visitor control.

**That makes one directive count differently in the two files.** `nginx/local.conf` serves HTTP/1.1 where
`nginx/prod.conf` sets `http2 on`, so a byte-identical `limit_conn conn 50` bounds whole connections locally
and concurrent requests in production. Nothing compares the pair (§4, OPS-78), and text identical across
them is not behaviour identical across them.

**Three 15-second timeouts bound the gap between two reads, not a transfer.** `client_header_timeout`,
`client_body_timeout` and `send_timeout` are set at server level, and each governs the interval between two
successive operations rather than a request's total duration, so a slow upload from a phone is unaffected
while a connection held open without sending is not.

**The public write caps its body at `64k` against the server block's `20M`.**
`fl_frontend/src/features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema` is a fixed-shape object
with no array a caller can grow, so the server-level allowance was headroom for an attacker alone. It is the
one location overriding that server-level value. Measured 2026-08-30: a 100,049-byte POST is refused `413` at
the edge without reaching Next, while a 4,049-byte POST reaches the handler and is answered by schema
validation, so the cap clears a realistic payload by a wide margin.

**A zone has now been observed refusing, and what that does and does not establish is worth separating.** A
16-request burst at the Kürzel check through a running edge was answered twelve times and then refused four
(twelve rather than eleven being the burst plus a slot that leaked while it ran). The status is `429` rather
than nginx's `503` default; every `add_header` the server block sets is present ON the refusal, which is what
`always` buys; and the `fl_json` access line carries `"status":429` with an empty `upstream_duration_s`, the
refusal never having reached Next. Beside that line `limit_req` writes an `error`-level record to the error
log, outside the JSON envelope, which is nginx's own behaviour rather than anything this file configures.

**What that establishes is the MECHANISM, not the numbers.** The key, the status, the headers and the log
line are now measured. No rate here is: 2r/m, 6r/m, 30r/m and the rest remain judgement calls, and observing
a zone refuse correctly says nothing about whether it refuses at the right threshold. The `limit_conn` figure
is further back still, derived from HTTP/2 semantics and never exercised against a real page load
(measured 2026-08-30).

**The liveness location carries no `limit_req` zone, and that is a decision rather than an omission.**
Every other exact-match location here carries one; this one does not, and it inherits the server
block's `client_max_body_size 20M`. It answers a GET that takes no key, touches no database and returns the
same short body every time; Cloudflare sits in front of it; and a zone would throttle the uptime monitor the
path is published for (§3) before it throttled anything else.

Server blocks: port 80 redirects to HTTPS and strips `www.`; a `default_server` block on 443 rejects
unknown hosts with `ssl_reject_handshake`; a second HTTPS block serves `www.frankfurtleague.de` and
301s to the apex; the real server block serves `frankfurtleague.de`.

**The www block over HTTPS is not redundant with the port-80 redirect.** HSTS carries
`includeSubDomains`, so a browser that has visited once forces `https://` on `www` and never issues
the plaintext request the port-80 block would have caught. Without a `www` HTTPS block that request
matches the catch-all and has its handshake rejected — observed 2026-08-01 as a public `525`.

**A Cloudflare proxy sits in front of nginx** (see the [overview](overview.md)), so a visitor's TLS
terminates there and an origin-side failure can surface as a Cloudflare status code that names
neither nginx nor the block responsible.

Proxy headers are declared at server level: `Host`, `X-Real-IP`, `X-Forwarded-For`,
`X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`, HTTP/1.1 — plus two the edge controls
outright, `X-Correlation-ID`, minted from `$request_id` so a client-supplied id never reaches a log,
and `X-FL-Actor`, blanked so a visitor cannot name the administrator a write is attributed to
([`docs/logging/spec.md`](../logging/spec.md) §1.1, L7 and L10).

**A `location` declaring any `proxy_set_header` REPLACES that whole inherited set rather than extending
it** — the mechanism I2 records for `add_header`, applied to the other directive — so the server-level
list reaches a location only where the location declares no proxy header of its own. Both nginx configs
hold the same locations that declare one:

- `location = /api/v0/system/is_live` restates the server block's list in full with one value changed,
  `Host $proxy_host`, so FastAPI is addressed as the upstream `proxy_pass` names and the public hostname
  needs no place in `api_trusted_hosts` (`fl_backend/app/core/config.py :: api_trusted_hosts`). Both
  edge-controlled headers are applied here, which is what makes them true of every backend request (I13).
- `location /_next/static/` declares `Host $http_host` and nothing else, so neither `X-Correlation-ID`
  nor `X-FL-Actor` is applied to a static asset. Nothing under that prefix runs application code or
  reaches a write, and the access line nginx writes for it carries `$request_id` either way.

Every SERVING block writes the `fl_json` access format, which carries the id, `$request_time` and
`$upstream_response_time`.

Buffers are enlarged (`proxy_buffer_size 128k`, `proxy_buffers 4 256k`) specifically to stop 502s from
large Auth.js cookies.

### 1.4 Security headers

Set at server level with `always`:

| Header                      | Value                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`                                                                                                                                                                                                     |
| `X-Frame-Options`           | `SAMEORIGIN`                                                                                                                                                                                                                                       |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                                                                                          |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                                                                                                                  |
| `Content-Security-Policy`   | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self';` |

`'unsafe-inline'` remains on `script-src` because a per-request nonce cannot cover build-time
prerendered HTML, and this application prerenders one for its routes (`cacheComponents` in
`fl_frontend/next.config.ts`). The compensating control is the `react/no-danger` ESLint rule
(`fl_frontend/eslint.config.mjs`, set to `error`), which forbids `dangerouslySetInnerHTML` — the only
realistic path for injected markup to enter this codebase.

`style-src` carries it for a narrower reason: several components set a runtime-computed inline
`style` **attribute**, for which CSP offers no nonce or hash — the toast's timer bar states its
duration (`fl_frontend/src/core/providers/AppToaster.tsx`), `FilterPanel` states its column count
(`fl_frontend/src/shared/components/ui/FilterPanel.tsx`), and react-aria writes a resolved position
onto every portalled overlay. The prerendered HTML carries no inline `<style>` block, so the policy
could still be narrowed to `style-src 'self'` with `style-src-attr 'unsafe-inline'` — an nginx change
rather than a documentation one, and `docs/_roadmap/tooling-items.md :: OPS-66` owns it.

**The rest of the policy is load-bearing and does not depend on `script-src`:** `frame-ancestors
'none'` blocks framing, `object-src 'none'` blocks plugin content, `base-uri 'self'` blocks base-tag
hijacking, and `form-action 'self'` blocks exfiltration through a form post.

### 1.5 The scripts

`scripts/README.md` navigates the folder; each script's own header carries its usage and prints it
with `--help`. What spans the scripts lives here.

| Environment | What it is                                            | Database                                                        | Entry point                                                                      |
| ----------- | ----------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **dev**     | source with hot reload, no Docker                     | whichever cluster the `.env` files name                         | `pnpm dev` in `fl_frontend/` · `uv run fastapi dev app/asgi.py` in `fl_backend/` |
| **local**   | the production image built from your tree, with nginx | its own, inside the stack (`docker-compose.local.yml :: mongo`) | `./scripts/local.sh`                                                             |
| **prod**    | published images on the server, never builds          | the managed cluster                                             | `./scripts/deploy.sh`                                                            |

**local** is the only place a packaging problem — a missing standalone file, a failing startup env
gate, a header nginx does not set — is visible before a deploy: **dev** exercises none of that
machinery, and **prod** only pulls (I6). Machine-specific scripts will not start on the wrong
platform.

**The local stack points both application services at its own database through compose's
`environment`**, which overrides what `env_file` carries, so no `.env` is edited and no run is left
aimed at the wrong cluster. The frontend needs that override as much as the backend does: Auth.js
reaches MongoDB directly, into a separate `authjs` database in the same cluster
([`../frontend/overview.md`](../frontend/overview.md)), so leaving its `MONGODB_URI` alone would sign
the local stack in against production while every other read came from the container.

**That database is a single-node replica set rather than a standalone**, the argument being written
at `docker-compose.local.yml :: mongo`. Its healthcheck initiates the set and reports healthy only
once the node has elected itself primary, and both application services wait on `service_healthy` —
the backend because its lifespan applies every validator before it yields, so a node that has not
elected fails the whole start.

**`./scripts/local.sh --seed` fills it from production**, through two containers of which only one
is handed the production credentials, and that one is handed a `mongodump` command and no other. It
is a discipline rather than a boundary — the image carries both tools — and what it buys, along with
what it costs a failure's diagnostics, is written at `scripts/local.sh :: take_dump`. A copy already
on disk is reused, `--refresh-db` takes a new one, and `--fresh` deletes the volume so the next
start begins empty. The copy lands in `.local-db/`, which `.gitignore` and `.prettierignore` both
cover because it is real data and this repository is public — its log with it, a failed copy quoting
the cluster it could not reach.

**A seed runs before the application services exist**, and two things follow from that ordering
rather than from care. Nothing renders a page against an empty database, so no read of one is
cached for the days `getTeams` and its siblings hold a value
([`../frontend/spec.md`](../frontend/spec.md) §1.2). And the copy step may clear the directory this
file bind-mounts, which is only safe while no container holds that mount. What the seed checks
before restoring is that the database container can see collections under it: `mongorestore` pointed
at an empty directory writes nothing and still exits 0, and counting what the database holds
afterwards cannot tell a fresh restore from the one before it.

**The copy is the application database and not the Auth.js store beside it.** The backend's
credential is scoped to one database, which is the two-users split in [`overview.md`](overview.md)
working as intended, so the local stack starts with an empty `authjs` and a sign-in builds it.
Nothing is lost with it: the allowlist deciding who may sign in is an environment value rather than
a stored row (`fl_frontend/src/core/auth.ts :: isUserAdmin`).

**The production tier's limitations shape that command**, and they are the fastest-rotting fact on
this page: read from MongoDB's Atlas Flex limitations documentation, 2026-08-27. The tier denies all
access to `admin` and throttles past an operations-per-second cap, and what each of those costs the
command is written at `scripts/local.sh :: take_dump`. It supports neither `--oplog` nor
`--dumpDbUsersAndRoles`, so the copy carries no users or roles and is consistent per collection
rather than at one instant across the database.
Two things fix the local image's major version rather than one — that tier's MongoDB floor, and the
tag the db tier already runs against (`fl_backend/tests/conftest.py :: mongo_replica_set_url`) — and
mongorestore refuses a dump whose source carries a different one.

**`deploy.sh` reads the server's Docker Engine version before it stops anything**
(`scripts/deploy.sh :: ENGINE_MIN`). Both compose files set a healthcheck `start_interval`, which an
older engine refuses outright rather than ignores, and the refusal arrives at container-create time —
which under `--force-recreate` is after the running containers would already be down. Asking in
preflight turns that into a precondition the script states while the site is still serving.

**`scripts/ci_scopes.sh` is the one copy of the path-to-scope mapping.** Every CI workflow that maps
paths reads it, and so does `scripts/check_scope.py` through its `--stdin` mode, which asks the same
mapping about a file list the caller has already filtered rather than one computed from a diff. Every
other statement of which paths select which scope — including the packaging list — cites that file
rather than repeating it.

**The checkers are python, and one kernel is what makes their answers comparable.**
`scripts/checker_kernel.py` holds the git wrapper that never raises, the branch's base resolved
`origin`-first, the `Finding` record and the tail that turns findings into an exit code, so one number
means one thing whichever checker answered it (§1.7). It also fixes the interpreter floor
(`scripts/checker_kernel.py :: PYTHON_FLOOR`) and, below it, exits at import as a crash rather than a
refusal (§1.7) — at the earliest line of any checker an old interpreter reaches, early enough that a
checker's own body may use syntax that interpreter cannot parse. `check_docs.py`, `check_commits.py`,
`check_scope.py` and `check_compose_mirror.py` are steps of `verify.sh`, while **`check_pr_body.py`
runs only in CI** — a pull request body is not in the repository and does not exist when the gate
runs, so `.github/workflows/pr-body.yml` is the only place it is addressable. One helper is javascript
for a reason: `scripts/ts_normalize.mjs` decides whether two versions of a TypeScript file differ by
anything but comments, and only TypeScript's own parser knows that a `//` inside a string is not a
comment.

**A documentation check that stopped reporting would still pass, and a floor a shell spells for itself
would drift in silence.** `scripts/tests/` is the pytest suite the scripts scope runs against both. It plants
one violation per check `scripts/check_docs.py` registers and asserts the check finds it, so the
documentation gate's own coverage is proved rather than assumed (PRE-4). Beside that it holds the
kernel's floors to what depends on them: that the python in `scripts/` parses at
`scripts/checker_kernel.py :: PARSE_FLOOR`, without which the refusal an old interpreter is owed
cannot itself be parsed, and that every shell arm degrading on a crash spells
`scripts/checker_kernel.py :: EXIT_CRASH` as its own literal, a copy left behind being invisible to
the run it silently reprieves.

**`scripts/selfcheck.sh` tests the scripts themselves**, and it is the scripts scope's first step.
Reach for it directly after editing anything in `scripts/`, `.claude/hooks/` or `.githooks/` — its
syntax, line-ending and shellcheck passes cover the shell in each, and its executable-bit pass the
scripts in `scripts/` that something runs by name. It probes the assistant guards against a throwaway
repository whose branch, ignore file and index each case controls, while probing the hook that serves
the rules index against this one. `bash -n` validates syntax only — a script can call a helper that
does not exist and still parse — so the passes around it are what catch the rest, the defects Windows
hides among them: CRLF endings, and an executable bit that `chmod +x` in Git Bash never reaches,
either of which works locally and fails on the server (I10). It also drives `check_scope.py`'s
comment-only classifier over fixtures in both directions,
because that is the one gate decision whose wrong answer is silent, and byte-compares the blocks the
guards duplicate rather than source —
the write shapes the bash guards share, and the exemption tail the bash and PowerShell branch
guards share — between the sentinel markers bounding each, so a fix made to one copy and not the rest
fails the gate rather than leaving a hole.

**That classifier's TypeScript half needs the frontend's `typescript`, and the scope does not require
it.** `--scripts` stays runnable on a clone that has never run `pnpm install`: where `typescript` does
not resolve, the classifier is required to answer "code", and the self-check asserts that degradation
instead of the real answer. CI's `scripts` job installs the frontend dependencies for exactly this
reason — otherwise the half that needs a parser rather than a regex would be exercised on no machine
but the author's.

**shellcheck and actionlint are pinned, and nothing but a person bumps them.** Both versions are
written in the self-check itself (`scripts/selfcheck.sh :: SHELLCHECK_VERSION`, and the image tag in
`scripts/selfcheck.sh :: run_actionlint`), and no dependency ecosystem can read a version string
inside a shell script, so these are the deliberate manual half of a pinning policy Dependabot
otherwise maintains ([`docs/_git/spec.md`](../_git/spec.md) §1.6). A `shellcheck` already on PATH is
used, and warned about where its version is not the pinned one, since a finding it produces need not
reproduce anywhere else; without one the pinned official image runs through Docker, which is slow
enough that CI installs the binary instead. With neither — no binary on PATH and no daemon
answering — each step skips rather than fails outside CI, so the shell and the workflows go unlinted
while the rest of the scope passes; in CI the same shortfall is a finding, that install and the
runner's own daemon being what carry them there. `require_docker` runs for the ops, database
and image scopes alone, so nothing announces the shortfall before a `--scripts` run starts.

**Publishing needs a classic token with `write:packages`** (`docker login ghcr.io -u felzab`). A
fine-grained token _appears_ to work — login succeeds — and then the push fails with
`permission_denied: The token provided does not match expected scopes`, because ghcr evaluates package
write permission only at push time and a first push is a _create_ that repository scopes do not cover.
If a previous login stored another token, `docker logout ghcr.io` first. The server needs no token at
all: both packages are public and pull anonymously.

**`publish.sh` refuses at exit 2 wherever it is asked to judge something it could not read, and
pushes nothing when it does.** The probe container that checks the built frontend image for
`instrumentation.js` refuses where the container could not run at all: a different answer from the
exit 1 it gives where the file is genuinely missing, since an image with no `sh` in it, or a container
that will not start, says nothing about the file either way. The preflight refuses where a remote
could not be asked which branches it has, which is not evidence the commit is missing but only that
nothing established it is there — and at that point nothing has been built either (I12).

**`publish.sh` prunes the SUPERSEDED local sha tags after a successful push**, keeping the one it just
built (`scripts/publish.sh`). A superseded build keeps its own sha tag, so it never becomes dangling and
`docker image prune` never reaches it — without this step several hundred megabytes of tagged layers
accumulate on the development machine per publish.

The registry side is untouched by it: **registry pruning stays manual and optional**, public packages
being free, and a botched delete destroys rollback history (§4). When pruning, keep roughly the last
five `sha-` tags per package and never delete what is live (`./scripts/deploy.sh --status`), what
`latest` shares a digest with, or an **untagged version created alongside a tag still in use** — those
are BuildKit provenance attestations the tagged image references by digest, so deleting one corrupts the
tag it belongs to.

**`--status` has two endings of its own, and pruning is decided from what it prints.** It **refuses
at exit 2** where any one of the services could not be asked, because an unasked service reads
exactly like a stopped one and a report that named nothing would otherwise be indistinguishable from
a host running nothing. It **fails at exit 1** where the two running services are different builds,
naming both and the tag that puts them back on one build (§3).

### 1.6 The verification gate

`scripts/verify.sh` reports its scopes in cheapest-to-fail order, so the answer that costs seconds
arrives before the one that costs minutes: the scope check, then the scripts scope, the documentation
gate and the backend tier, then the formatter and the frontend build, and last the scopes that need
Docker — the ops checks, the database test tier and both image builds. A bare invocation runs
everything; scope flags name surfaces and combine, and `--frontend` implies `--format`, the frontend
scope reading exactly the files the formatter governs.

Scopes **run concurrently by default**, one worker process each, and `verify.sh` replays their
captured output in that order — so a parallel run reads as the serial one, byte for byte. The match
is per stream: a terminal that merges stdout and stderr sees a scope's error lines after its output
rather than between it. `--serial` runs them one at a time and is what a byte-identity comparison is
measured against; `--verbose`, a run covering one scope, and CI are serial too, CI because it already
runs one scope per job, as is a machine with no interpreter at the checkers' floor, the pool being
python. One scope is constrained: `ops` follows `backend`, `db` and `frontend`, whose trees its
stand-in `.env` files appear in, which makes it the tail of the run rather than a member of it. **The
`--frontend` implication above is the parent's, never a worker's** — a worker
runs the one scope it is given. `scripts/gate_pool.py` owns the spawning and nothing else; the
sections, the closing table and the closing statements stay in `scripts/_lib.sh`.

**The scripts scope carries that shape one level down.** Its checks read this tree and write only
their own caches and throwaway trees, so they start together and each is collected at its own step,
and the scope costs its slowest check rather than the sum of them. Every verdict is still reached in
written order and the run still ends at the first check that fails, because a job records an exit
status and never speaks — and a job that left no status is read as a crash rather than as a pass.
`--serial` and `--verbose` take the serial path here too, for the reasons they take it above, and
nothing else does: CI, a run covering one scope, and a machine with no interpreter at the checkers'
floor are the pool's exceptions alone. This level is bash, so no interpreter decides it, and in CI —
where each scope is already its own job — it is the only concurrency the gate itself creates. A
step joined after its work ran beside its neighbours is re-dated to that work's own length
(`scripts/_lib.sh :: step_took_ms`), without which the first step joined absorbs the whole stretch and
every step after it reads as free.

**One tool a scope runs makes concurrency of its own, and the value it is given answers a diagnostic
rather than the clock.** `fl_frontend/package.json`'s `lint` — the eslint step of `--frontend` — passes
`--concurrency=2`. eslint measures how much of a worker's life went on linting rather than on starting
up and reading files, and warns through `ESLintPoorConcurrencyWarning` below the floor the installed
package sets; on this tree `auto` misses that floor by a margin no rounding covers, while the shipped
value clears it, and `auto` is markedly slower than a serial run against a cold V8 compile cache. Every
larger setting measured warns too, so raising the number buys its time by suppressing a correct
diagnostic — which is why node's `--disable-warning`, used elsewhere in that same file, is deliberately
absent here. The measurements behind the value, and the CI-runner condition still open against it, are
`docs/_roadmap/tooling-items.md :: OPS-19`.

**No formatter the gate runs writes a tracked file.** prettier runs in check mode
everywhere — locally, in CI and on `main` — so a run cannot hand back a tree different from the one
its later steps measured, and nothing a run did has to be read back and committed. Formatting happens
at commit time instead: `.githooks/pre-commit` formats what is staged and re-stages it, and refuses a
file staged in part rather than folding its unstaged half into the commit. The hook is convenience
and never the enforcement — a clone that has not pointed `core.hooksPath` at it, or has never
installed the frontend, has no hook at all, and this scope and CI are what bind.

**One tracked file a gate run writes is not a formatter's doing.** `next build` rewrites
`fl_frontend/tsconfig.json` whenever a `compilerOptions` key it checks for is absent, then repairs it
and carries on, so the frontend scope stays green having read a different config from the `tsc` step
before it; the frontend job in `.github/workflows/verify.yml` diffs that one path and fails on it.

CI runs the same checks as parallel jobs mapped from the paths a pull request touches, and both sides
name the same scopes: `scripts/ci_scopes.sh` emits one `name=true|false` line per `verify.sh` flag, so
a scope's name in the mapping and the flag that proves it are one word and nothing translates between
them. Which paths select `format` is decided by extension, because prettier's reach is — a
python-only or hook-only branch asks for no formatter job — and CI's `format` job stands down where
the frontend job runs, which already covers it.

| Scope        | Runs                                                                                                                                                                                                                                  | Needs                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `--scripts`  | `selfcheck.sh`, `ruff` and `pyright` over the python in `scripts/`, then the pytest suite in `scripts/tests/` (§1.5)                                                                                                                  | the backend venv, `pytest` included; shellcheck and actionlint from PATH, else Docker |
| `--docs`     | `check_docs.py`, whose registry is `scripts/docs_gate/kernel.py :: CHECKS`; then `check_commits.py`; then `fl_backend/tests/openapi_document.py` in `--check` mode, the published document against the docstrings it is composed from | the backend venv                                                                      |
| `--backend`  | `uv lock --check`, then `ruff` + `pyright` + `pytest`, default tier                                                                                                                                                                   | the backend venv, and `uv` for the lockfile check                                     |
| `--format`   | prettier in check mode over the whole repository                                                                                                                                                                                      | pnpm install                                                                          |
| `--frontend` | the frozen lockfile check, then tsc, eslint, `next build`, unit tests, audit                                                                                                                                                          | pnpm install                                                                          |
| `--ops`      | both compose files parse; the local stack mirrors production; nginx accepts `prod.conf`                                                                                                                                               | Docker, and an interpreter at the checkers' floor for the mirror                      |
| `--db`       | `pytest -m db` against a real `mongod`                                                                                                                                                                                                | venv + Docker                                                                         |
| `--images`   | both `docker build`s + the `instrumentation.js` presence check                                                                                                                                                                        | Docker                                                                                |

Docker is checked before any check runs on a run covering the ops, database or image scopes, and the
backend virtualenv on one covering the scripts, documentation, backend or database scopes; the
frontend's `pnpm install` prerequisite is checked nowhere, so a missing one surfaces at the first
step running a tool out of `node_modules` — prettier in the formatter's scope, `tsc` in the
frontend's, the lockfile check before it needing only pnpm itself. Each tool is its own step, tool
output is captured and shown only when its step fails, and `--verbose` streams everything instead
(§1.7). **The self-check is the exception**, and it is
replayed rather than captured: what it skipped and what it warned about reach the screen through a
ledger even on a step that passed, because a skip nobody sees reads as a pass (§1.7).

**A manifest is compared against its lockfile before anything reads the installed tree.** The frontend
scope resolves the lockfile against `package.json` and the backend scope runs `uv lock --check`,
both of them cheap; without them the rule that the two agree was enforced only where discovering the
breach is expensive — the image build, the CI jobs that install, and a clean clone. The frontend check
passes `--lockfile-only`, which is what keeps it a check rather than an install: it compares without
linking `node_modules`, so it writes nothing. It also passes `--no-optimistic-repeat-install`, which
is what keeps it a check at all — that setting is on by default and answers from file timestamps, so
a manifest restored with its mtime preserved passes while disagreeing with the lockfile.

**Before any of them runs, `check_scope.py` compares the scopes named against what the branch actually
changed**. It refuses a run
whose diff reaches the image build with a change that is more than comments, and merely reports every
other surface the run leaves unproven. What counts as "more than comments" is decided by a
parser and never by a `#` rule: TypeScript through its own parser, Python through `ast` with docstrings
stripped, TOML through `tomllib`, and everything else — Dockerfiles, YAML, shell — is code, because
that is the safe answer where no parser is available. The classifier suppresses the scope complaints
and adds the documentation and formatter ones; it removes no CI job. The check is skipped in CI, which
maps its own scopes from the paths.

**The scripts scope lints and type-checks its own python**, and the configuration files beside that
python are what make it possible. Ruff resolves configuration by walking up from the file it is
checking, so `fl_backend/pyproject.toml` governs `fl_backend/` and nothing else: without a config
beside them, the python in `scripts/` resolves none at all and falls back to ruff's defaults — a
different rule set from the one this repository chose, under which an editor reports findings the gate
cannot produce. `scripts/ruff.toml` `extend`s the backend's configuration rather than copying it, and
adds and overrides nothing, so the selection stays in one file and the two cannot disagree. **It sits
in `scripts/` rather than at the repository root**, because a root config would also become the
nearest one for `fl_backend/`, which moves isort's idea of the source root: `app` stops resolving as
first-party and every import block in the backend is reshuffled.

`scripts/pyrightconfig.json` sits beside it and answers the same question for types. The
`[tool.pyright]` block in `fl_backend/pyproject.toml` declares its own `include`, so it governs
`fl_backend/` and nothing else, and a config at the repository root would become the nearest one for
that tree too and override the choice. It pins the python version rather than letting pyright infer
one, because with no virtualenv declared pyright falls back to whichever interpreter it finds — a
different version on this machine and on a runner, and therefore a different answer about what parses.

**Commit messages ride in the docs scope**, because in this repository the commit bodies are
documentation and merges are never squashed precisely so they survive
([`docs/_git/spec.md`](../_git/spec.md) §1.4). Every scope combination `.claude/CLAUDE.md`'s gate table
prescribes carries `--docs`, so locally the check rides along with it; in CI it can ride nowhere, a
commit message being the one thing with no path to filter on, so it runs in the always-on `changes`
job instead.

The **ops** scope exists because the compose files and the nginx config have no compiler and no test
suite — without it, a typo in either surfaces on the server, at deploy time. `nginx -t` runs against
throwaway self-signed certificates and loopback upstream hosts, because a config test loads both.

**The scope also holds the local stack to production's shape.** Both compose files parse whatever they
say, so nothing else catches a setting production gains and the local stack does not — the one class
of difference the local stack is structurally unable to reveal. The differences meant to be there are
the local file's own declared list, restated as data in `scripts/check_compose_mirror.py` so the claim
is testable rather than held by discipline, and a declared delta matching no real difference is a
finding too: the list stays honest in both directions. A compose construct outside the reader's parsed
subset is a refusal rather than a verdict (§1.7).

**The largest of those differences is a whole service**: the local stack's database, the volume behind
it and the `depends_on` key each application service gains are all declared deltas
(`scripts/check_compose_mirror.py :: DECLARED_DELTAS`), and `docker-compose.local.yml`'s own header
carries why production never gains one. **A declared delta covering a whole service covers its ports
with it**, which is why I1 is held by a check of its own over both files rather than by that list.

**One path reaches across the boundary on purpose.** `fl_backend/openapi.json` selects the **frontend**
scope alongside the backend ones, because the frontend scope holds the test comparing the Zod mirror
against that document — it is the only `fl_backend/` path selecting the frontend at all, so without
this arm a Pydantic model change would never run the check that exists to catch it (the arm itself is
in `scripts/ci_scopes.sh`).

**In CI the images scope caches layers through the Actions cache service**, which
`VERIFY_IMAGES_CACHE=gha` selects. buildx authenticates
to that service with a credential the runner gives to JavaScript actions and never to a `run:` step, so
`.github/actions/actions-runtime-env` re-exports it first. **The scope stops before building when that
variable is set and the credential is missing** — buildx would fail too, but only after every layer has
been built, and with a message naming a missing token rather than the missing step. Locally the variable
is unset and the build is a plain `docker build` against the daemon's own warm layer cache.

**The documentation gate** (`scripts/check_docs.py`) reads `/docs`, the source comments beside the code and
the configuration files scanned with them, and its byte-level checks read every tracked file
`.gitattributes` declares as text — so a finding this scope raises need not be about a document at all. It
is the one currency defence that does not depend on somebody remembering, and its checks are registered in
`scripts/docs_gate/kernel.py :: CHECKS` and nowhere else.

**The backend steps** exist because the frontend's toolchain runs nothing against `fl_backend`, so the
constraints the frontend only mirrors would otherwise have no regression net
([`docs/backend/spec.md`](../backend/spec.md) §1.6). `pyright` is separate from `ruff` because ruff
checks no types. All of it needs the backend virtualenv (`cd fl_backend && uv sync --dev`).

**Both test tiers run.** The `db`-marked tests need a real `mongod`, so they are their own scope behind
`require_docker` — which is what lets `--quick` skip them and need no daemon — and in CI they are the
concurrent `backend-db` job, so the coverage costs no extra waiting.

**The image scope** exists because code that compiles can still fail to build inside the image, or be
omitted from the standalone output entirely.

`--quick` is the scopes that need no Docker — scripts, docs, backend, format and frontend. It
therefore skips the ops checks as well as the database tier and both image builds, and it is **not
sufficient** before a merge touching a packaging path: those are where packaging problems live,
`scripts/ci_scopes.sh` holds the list, and CI builds both images on any pull request touching one. An
audit remediation wave runs the full form regardless of what it touched, unless it changed
documentation only.

### 1.7 Script conventions

All scripts source `scripts/_lib.sh`: strict mode (`set -euo pipefail`, hardened `IFS`), an error trap
naming the script, line and command that failed, an interrupt trap that exits through each script's
own cleanup rather than around it, guards (`require_platform`, `require_docker`, `require_file`,
`require_dir`), `wait_healthy` for Compose services, and `usage`, which prints the calling script's own
header so `--help` cannot drift from the code. Every script resolves the repository root itself, so it
behaves the same from any working directory; arguments are parsed before any environmental check, so a
typo fails instantly.

**The output standard.** One vocabulary, one verb per meaning, and no script writes formatting of its
own:

| Verb          | Means                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| `section`     | Opens a phase group, closing the one before it, and one fold in the Actions log          |
| `end_section` | Closes the open group without ending the run, for a line that belongs outside every fold |
| `step`        | Opens a step and starts its timer                                                        |
| `ok`          | The step passed, with the time it took                                                   |
| `info`        | Neutral detail                                                                           |
| `skip`        | Something was deliberately not run, dim so it can never read as a pass                   |
| `warn`        | An advisory: a problem the run is meant to survive, on stderr                            |
| `fail`        | A finding recorded, the run continuing — for a caller collecting several before it ends  |
| `die`         | A finding that ends the run, on stderr                                                   |
| `refuse`      | The check ran and its answer cannot stand as a verdict, so the run ends without one      |
| `detail`      | Supporting output belonging to the line above it, from arguments or from stdin           |
| `excerpt`     | The first few lines of something long, then a count of what `--verbose` would show       |
| `finish`      | Ends a run that reached its end, printing the closing table and statement                |

**A run has exactly one ending, and its exit code names which.** Nothing else may be inferred from
the number: a caller that cannot tell "the change needs work" from "the check never ran" acts on the
wrong one.

| Ending        | Exit      | What it says                                                                           |
| ------------- | --------- | -------------------------------------------------------------------------------------- |
| `green`       | 0         | Everything that ran passed; a run covering every scope adds that it is safe to merge   |
| `findings`    | 1         | The change needs work, and each finding names what, in the section it came from        |
| `refused`     | 2         | A check declined to judge its input, so nothing here stands as a verdict on the change |
| `crashed`     | 3 or more | The script itself failed, so nothing past that line ran                                |
| `interrupted` | 130       | Ctrl-C — the sections that had opened are all there is, and none of them is a verdict  |

The checkers answer on the same scale: `scripts/checker_kernel.py` fixes 0 for a pass, 1 for findings,
2 for a check that could not judge its input and 3 or more for a broken environment, in one place, so
a step reading a checker's status has one meaning to route rather than a private convention per
checker.

`info`, `skip`, `warn`, `fail`, `ok`, `die` and `refuse` funnel through `scripts/_lib.sh :: _emit`,
which prints the tag in a fixed gutter, the message in a single shared column, and every continuation
line indented to that column; `section`, `step`, `detail` and `excerpt` own their own line shapes. A
run closes with one row per section — its verdict, its duration and its finding count — and then the
statement for whichever ending it reached, so the total a reader acts on is itemised by the rows above
it, and a section that closed with no verdict at all is recorded as a finding rather than passed over.
Colour is decided centrally rather than per script, and `FL_GATE_COLOR` is read ahead of everything
else — the gate's own variable, which is how a parent hands a worker its answer without exporting one
that every tool a scope runs would take as an instruction of its own. Failing that, colour is off
under `NO_COLOR` or `FORCE_COLOR=0`, and on for a terminal, under any other `FORCE_COLOR`, or inside
GitHub Actions, whose log renders ANSI. A spinner draws only where somebody is watching one: on a
terminal, outside CI, off under `NO_SPINNER` where a terminal mangles a carriage return, and never
under `--verbose`, whose whole purpose is the tool's own output as it arrives.
`scripts/check_docs.py` prints to the same columns, so the whole gate reads as one voice.

**Every script a person reads accepts `--verbose`**, which streams each tool's own output instead of
capturing it — the one thing a captured run cannot give back afterwards.

**A script whose output only a machine reads is exempt, and the interface is what decides, never the
folder.** `scripts/ci_scopes.sh` writes `$GITHUB_OUTPUT`'s `key=value` lines and the assistant hooks
answer with a JSON verdict, so a heading, a fold marker or a colour code in either is a corrupt answer
rather than a nicer log. `ci_scopes.sh` is accordingly the one script with no `--verbose`, and puts
its human-readable line on stderr, where it cannot reach the outputs.

## 2. Invariants

| #   | Invariant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Enforced by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Only nginx publishes a port another host can reach — the local database's is bound to `127.0.0.1`                                                                                                                                                                                                                                                                                                                                                                                                                                               | `scripts/check_compose_mirror.py :: off_host_ports`, over both files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I2  | Security headers are repeated in every `location` that sets any header                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `nginx/prod.conf :: location /_next/static/` and `:: location = /api/v0/system/is_live`, each restating the set its own `add_header` replaced; observed 2026-08-30 on a `429` from `zone=kuerzel` and on the liveness `200`, both carrying the full set                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| I3  | A `default_server` block rejects unknown hosts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `ssl_reject_handshake on`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| I4  | Sign-in rate limiting applies to POST only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | the `map` producing an empty key otherwise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I5  | The builder stage has no reachable backend or real env                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `SKIP_ENV_VALIDATION=true`, placeholder `MONGODB_URI`, no `API_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| I6  | Production never builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `deploy.sh` only pulls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I7  | Both images build before either is pushed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `publish.sh`; and `deploy.sh`, which compares the pulled `:latest` builds' `version` labels before recreating anything — refusing where a label could not be read, and warning where an image carries none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I8  | Publishing stops on a dirty tree by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `publish.sh`, whose `--allow-dirty` escape suffixes the tag `-dirty` and a fingerprint of the tree (`scripts/publish.sh :: DIRTY_ID`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| I9  | Deploy recreates containers in place                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `deploy.sh`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| I10 | Scripts use LF line endings and carry the git executable bit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `selfcheck.sh` (its LF and executable-bit checks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| I11 | The three API keys are 64 characters and match on both sides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `fl_frontend/src/core/config.ts` alone (`length(64)`); the backend requires presence only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| I12 | Publishing stops on a commit no remote holds — any remote branch clears the bar, not only an ancestor of `main`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `publish.sh`, whose preflight asks the remotes for their branches (`git ls-remote --heads`) and requires HEAD to be an ancestor of a tip this clone holds, `--dry-run` included; a remote that could not be asked refuses at exit 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| I13 | Exactly one backend endpoint is reachable from the edge — `= /api/v0/system/is_live`, exact-match so nothing joins it, restating the whole `proxy_set_header` set with `Host $proxy_host` among it (§1.3). Every other `/api/...` path reaches Next, some through a block naming it and the rest through `location /` (§1.3). A URI nginx normalises onto the liveness path is proxied as written and collects FastAPI's 404 rather than Next's, which routes to nothing and fingerprints the stack (§1.3)                                      | unenforced — the ops scope's `nginx -t` parses `prod.conf` without reading which locations it declares (§1.6), `nginx/local.conf` is parsed by nothing (§4, OPS-78), and no test issues a request to a backend path through the edge. The normalisation half WAS observed 2026-08-30: `//api/v0/system/is_live` collects FastAPI's `{"detail":"Not Found"}` under this location's own `Cache-Control: no-store`, so nginx merged the slash for matching and proxied the URI as written                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I14 | **Every `limit_req` zone is PAIRED and keys on the visitor's own networks — the /64 and the /48 for IPv6, the whole address for IPv4 — never on the Cloudflare edge, and neither prefix split across two keys in the verification §1.3 records**. The three failures it stands between are shared keying, where one point of presence buckets every visitor behind it; a walkable key, where the /64s one subscriber is allocated outlast any rate the narrow zone can set; and a SPLIT key, where one prefix written two ways is allowed twice | `nginx/prod.conf :: map $remote_addr $client_net` with `nginx/prod.conf :: map $remote_addr $client_net48` for the network half, each enumerating every render shape rather than matching a prefix, on the one-off measurement §1.3 records rather than on anything re-run; `nginx/prod.conf :: set_real_ip_from` with `nginx/prod.conf :: real_ip_header` and `nginx/prod.conf :: real_ip_recursive` for the visitor half, the last of which is what makes a chained value take its final element. Unenforced by the GATE, as I13 is — `nginx -t` parses the file without reading what it keys on, and no test issues a request through the edge. That is no longer true of the EVIDENCE: §1.3 records both maps driven through a running nginx and a zone observed refusing correctly. A measurement taken once is not a check that runs again, and nothing re-runs either. What the halves fail back to is §4, OPS-92 and OPS-93 |

## 3. Violation → remedy

| Symptom                                                                       | Cause                                                                                                                                                        | Remedy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not a directory` from nginx                                                  | A mounted config file was missing, so Docker created a directory                                                                                             | `git pull`, remove the stray directory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Invalid environment variables: <NAMES>` then no traffic                      | Startup environment gate                                                                                                                                     | Fix those names in the relevant `.env`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Deploy reports healthy but the site is unreachable                            | nginx                                                                                                                                                        | prod: `docker compose logs nginx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `failed to connect to the docker API at npipe:...`                            | Docker Desktop is not running                                                                                                                                | Start it and wait for it to settle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Deploy stops in preflight naming the Docker Engine version                    | The host's engine is below what the compose files' `start_interval` needs                                                                                    | Nothing was stopped or pulled. Upgrade the engine, or drop `start_interval` from both compose files (§1.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `./scripts/deploy.sh --status` exits 1 naming two different builds            | A publish moved one package's `:latest` and failed on the other, so this host pulled a pair no build names                                                   | Deploy the build both packages have: `./scripts/deploy.sh <tag>`, the tag the report names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `./scripts/publish.sh` refuses, naming a remote it could not ask              | The remote did not answer `git ls-remote --heads`, so nothing establishes that this commit is fetchable                                                      | Nothing was built or pushed. Restore the network or the credentials and re-run (I12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `EBUSY`, or `.next` locked during a build                                     | A `pnpm dev` is still running, or the folder is open in an editor                                                                                            | Stop the dev server; nothing else may hold port 3000 while the local stack runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `./scripts/local.sh` reports `mongo` unhealthy                                | The local database has not elected itself primary, so no transaction opens and no validator applies                                                          | `docker compose -f docker-compose.local.yml logs mongo`. The script waits on `mongo` by name so this reports as itself rather than as two services that never started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `./scripts/local.sh --seed` dies during the copy from production              | The production tier throttles past its operations-per-second cap, and anything else querying the cluster shares that budget                                  | Nothing was written to the local database. Re-run with nothing else talking to production; the dump already takes one collection at a time (§1.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The local stack's data disagrees with production, in either direction         | Working as intended — `--seed` reuses the copy already on disk however old it is, so it holds rows production has dropped and lacks rows it has since gained | `./scripts/local.sh --refresh-db` takes a fresh one (§1.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A db-tier run reports a wall of failures naming validators and unique indexes | Another `pytest -m db` was running beside it; the mechanism is unestablished                                                                                 | Trust neither verdict, the green one included. Re-run with nothing else running, and take any db-tier measurement alone (`docs/_roadmap/tooling-items.md :: OPS-70`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Container unhealthy, health log empty, `FailingStreak: 0`                     | The app died before the first probe                                                                                                                          | Usually a malformed `.env` value restored by hand. Read `docker compose logs <service>` on the server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A directory appeared named `something;C`                                      | MSYS rewrote a POSIX-looking path in a hand-typed `docker run -v`                                                                                            | Delete it, and prefix the command with `MSYS_NO_PATHCONV=1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `UnicodeEncodeError: 'charmap' codec` from `fastapi dev`                      | Windows only, when the output is piped or redirected                                                                                                         | The CLI banner needs UTF-8. Prefix the command with `PYTHONUTF8=1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Static assets served without security headers                                 | A `location` block set a header and dropped the inherited set                                                                                                | I2 — repeat every header in that block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Backend healthcheck fails after an API version bump                           | The healthcheck spells the API version itself                                                                                                                | Move the path in both compose files, and in both nginx configs with them (§4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The uptime monitor 404s while the backend container reports healthy           | The nginx liveness location still spells the old version, so the probe matches `location /` and Next answers it                                              | Move the path in both nginx configs, then re-point the monitor at the apex host with no trailing slash. The healthcheck and the edge are separate spellings of the version, and neither proves the other (§4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Sign-in returns 429                                                           | Working as intended — the sign-in POST is rate-limited at the edge                                                                                           | Nothing. The limit is `nginx/prod.conf`'s `signin` zone, and it applies to POST alone (I4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Uptime monitor shows green during a backend outage                            | The error page streams after headers, so the edge status is 200                                                                                              | Monitor `GET https://frankfurtleague.de/api/v0/system/is_live` — the apex host, no trailing slash. That location is exact-match, so a trailing slash falls to `location /` and Next answers a 308, and the `www` server block only 301s to the apex without proxying anything; `curl -f` exits 0 on a 3xx and a monitor reads one as up, so either spelling reports green straight through the outage this path is published to catch. The method is part of the prescription: the endpoint declares `GET` and nothing else (`fl_backend/app/api/system/router.py :: check_is_live`), so a monitor left on a `HEAD` default is answered 405 and reports a healthy site down for as long as it runs (both measured 2026-08-28; §1.3, [`docs/logging/spec.md`](../logging/spec.md)) |
| Container logs are empty right after a deploy                                 | Working as intended — `json-file` logs live in the container, and `--force-recreate` replaces it                                                             | Nothing. Copy them off before deploying ([`docs/logging/spec.md`](../logging/spec.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Reference data stale for up to a day                                          | Working as intended — an out-of-band MongoDB edit invalidates nothing                                                                                        | Nothing. The bound is the cache lifetime: wait for the daily expiry, or recreate the frontend container                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| League table or fixtures stale after a season edit                            | Same cause — a season decides the default season and the points                                                                                              | Same remedy; recreation drops every cached page at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 4. Known-open

| #      | Item                                                                  | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —      | The API version is spelled outside the code                           | Open — every spelling works today and an API version bump has to reach all of them. The tracked files one commit moves together are the backend healthcheck in each compose file (`docker-compose.yml :: backend`, `docker-compose.local.yml :: backend`), the liveness location in each nginx config (`nginx/prod.conf :: location = /api/v0/system/is_live`, `nginx/local.conf :: location = /api/v0/system/is_live`) and the deploy script's own check of the edge (`scripts/deploy.sh :: The liveness probe, through the edge`, which spells the path again in the warning it prints). The healthcheck and the location each break silently, and §3 carries both symptoms; the deploy check breaks loudly instead — left at the old version it asks the edge for a path no location names, so every deploy of a healthy site warns and withholds its closing `The pulled build is live.` The remaining site is the frontend's `API_VERSION` environment value (`fl_frontend/src/core/config.ts :: frontend_config`, which `fl_frontend/src/core/api.ts` builds every call's base URL from, constrained by [`docs/frontend/spec.md`](../frontend/spec.md) §1.7) — a deployed per-environment value rather than a tracked file, so no commit can carry it and the deploy has to. Left behind, it breaks loudly and all at once: every frontend fetch targets the old version, matches `location /` and collects Next's HTML 404 (I13) |
| —      | Registry tag pruning is manual                                        | Accepted — a botched delete destroys rollback history. The retention procedure is in §1.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| —      | Revoking admin access needs a restart                                 | Accepted — the allowlist is validated at boot; after it, `role` is re-derived per request and the session dies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| —      | `nginx` drops no capabilities                                         | Open — the two application services carry `cap_drop: ALL` and `no-new-privileges:true` and `nginx` carries neither, and the asymmetry is undecided                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| —      | Certificate renewal is outside this repository                        | Accepted — they are mounted from `./certs`, and nothing here issues or rotates them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| —      | The local database runs unauthenticated, holding real contact records | Accepted — it holds a copy rather than the source, and I1 is what keeps it off every interface but this host's. `--replSet` with authentication also wants a bind-mounted keyfile whose permissions `mongod` checks, which a Windows host does not reliably give it (`fl_backend/tests/conftest.py :: mongo_replica_set_url` declines it for the same reason). What the copy contains is people, so `--fresh` is what a machine that no longer needs one should be left in: it removes the volume and the copy under `.local-db/` together                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DOC-14 | INC-9 measures none of a renamed file's comment blocks                | Open — `scripts/docs_gate/structure.py :: check_comment_length` reads a block only where every one of its lines sits in the branch's added set, and a detected rename leaves a carried block's lines as context, so no length is measured under the new path. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DOC-15 | A refusal code's meaning is written three times over                  | Open — `fl_backend/app/core/domain.py :: RULES` gives each code a summary, [`docs/logging/error-codes.md`](../logging/error-codes.md) a row and the frontend a German sentence, and no check compares any pair of them; **DOC-13** covers the spellings and this the meanings. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| OPS-78 | No gate scope parses or compares `nginx/local.conf`                   | Open — its header claims production's routing, rate limits and security headers, and nothing reads the claim: `nginx -t` runs against `prod.conf` alone and `scripts/check_compose_mirror.py` compares the compose pair (§1.6). It parses cleanly in the pinned image when run by hand, which is not the same as the gate running it; and §1.3 records one directive the two files spell identically and HTTP/2 makes behave differently. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| OPS-83 | A guard the database tier stays green without                         | Open — the `session=` argument that keeps a transactional read in `fl_backend/app/api/saisons/admin_router.py` inside its own snapshot is stated by a comment beside it, and dropping it reportedly leaves `--db` (§1.6) green, so the scope this page runs as the backend's regression net is not what holds it. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OPS-84 | The linter behind §1.4's compensating control is past end of life     | Open — `fl_frontend/package.json` holds eslint at a 9.x line that will take no further fix of any kind, and both the `react/no-danger` rule §1.4 names as the CSP's compensating control and the lint step of `--frontend` (§1.6) run on it. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| OPS-87 | A call site's key tier is held to its route by nothing                | Open — `fl_frontend/src/core/api.ts :: apiClient` takes the tier as an option, and omitting it is loud, an admin router refusing the base key with `REQ-AUTH-004`; declaring `authType: "admin"` where a public route would have answered succeeds identically, sending an admin key and an actor header for nothing. `fl_backend/openapi.json` flattens every tier to one `HTTPBearer` scheme, so neither side publishes what a check would compare. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| OPS-90 | A scope that passed leaves the report when an earlier one fails       | Open — `scripts/verify.sh :: replay_scope` walks the scopes in a fixed order and `scripts/_lib.sh :: finish` exits on the first non-zero status, so a later scope's ledger is never adopted and §1.6's closing table cannot tell a passing scope from one that never ran. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| OPS-91 | A citation continuing a file already named is checked by nothing      | Open — `scripts/docs_gate/references.py :: CITATION_RE` needs a file part before the separator, so a continuation resolves to nothing: its anchor is never proved. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| OPS-92 | Real-IP recovery can fall back with nothing to say so                 | Open — §1.3's zones are per visitor only while realip replaces the Cloudflare address; a published range added after the hand-copied fetch, or the header it reads not arriving in a usable shape, restores shared keying silently, and no check tests whether the recovered address is still inside a trusted range. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| OPS-93 | The origin trusts every source inside Cloudflare's ranges             | Open — `set_real_ip_from` trusts the published ranges, which are every Cloudflare customer's egress rather than this account's, so a request from inside them sets §1.3's rate-limit key and the access line's `client` itself; `docker-compose.yml` publishes 80 and 443 and no origin authentication, tunnel or firewall stands in front. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
