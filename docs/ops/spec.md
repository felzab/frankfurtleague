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
application services' only** — `nginx` declares neither, which is recorded in §4 rather than
assumed to be deliberate. `nginx` declares `depends_on` both services with
`condition: service_healthy`.

**Note:** `API_VERSION` is a constant of the code rather than a setting
([`docs/backend/spec.md`](../backend/spec.md) §1.5), so bumping it is a code change — and the
version is spelled again outside the code, at sites a commit does not all reach. §4 names the sites
where a version left behind breaks something; §3 carries what each failure looks like.

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

| Location                   | Upstream        | Notes                                                                                                                                                                                                |
| -------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`                | `frontend:3000` | Auth.js's catch-all route handler                                                                                                                                                                    |
| `= /api/client-error`      | `frontend:3000` | Next route handler, paired `limit_req` — `zone=clienterr burst=3` and `zone=clienterr48 burst=30` ([`docs/logging/spec.md`](../logging/spec.md))                                                     |
| `= /api/bewerbung`         | `frontend:3000` | Next route handler, the public application form's submit — paired `limit_req` `zone=bewerbung burst=2` and `zone=bewerbung48 burst=20`, and `client_max_body_size 64k` overriding the server block's |
| `= /api/bewerbung/kuerzel` | `frontend:3000` | Next route handler, that form's Kürzel check — paired `limit_req` `zone=kuerzel burst=10` and `zone=kuerzel48 burst=100`                                                                             |
| the four `/` twins         | `frontend:3000` | Each metered exact-match path above has a trailing-slash twin carrying its canonical's zones — the `bewerbung` twin its `64k` cap too                                                                |
| `/api/admin/`              | `frontend:3000` | The page-owned editors' undo handlers                                                                                                                                                                |
| `= /api/v0/system/is_live` | `backend:8000`  | The liveness probe, and the only backend endpoint the edge exposes — `Cache-Control: no-store` (I13, §3)                                                                                             |
| `= /signin`                | `frontend:3000` | Paired `limit_req` — `zone=signin burst=3` and `zone=signin48 burst=30`                                                                                                                              |
| `/_next/static/`           | `frontend:3000` | `expires max`, `Cache-Control: public, max-age=31536000, immutable`                                                                                                                                  |
| `/`                        | `frontend:3000` | Catch-all — `limit_conn conn 50`, the only ceiling that reaches it                                                                                                                                   |

**Every `/api/...` path but the liveness probe reaches Next** — some through a block naming it, the
rest through the catch-all, which answers Next's HTML 404 where nothing routes the path (§3). The
liveness location is exact-match precisely so that nothing can join it there; nothing in the
application meets that 404, every application read of the API being a server-side fetch to `API_URL`
([`../frontend/overview.md`](../frontend/overview.md)), so a browser or anything off this host is
what meets it.

**Exact-match binds the path nginx matched, not the URI FastAPI is handed**: nginx merges slashes
and resolves dot segments before choosing a location, then `proxy_pass` with no URI part forwards
the request line as written, so `/api/v0//system/is_live` is answered by FastAPI's own
`{"detail":"Not Found"}` rather than by Next (measured 2026-08-28). No further route opens up — a
URI this block matches decodes either to the probe or to nothing — but the error body fingerprints
the framework the origin runs.

**`$remote_addr` is the visitor rather than the Cloudflare edge**: `realip` rewrites it from the
header `nginx/prod.conf :: real_ip_header` names, for a request arriving from
`nginx/prod.conf :: set_real_ip_from`'s ranges, and every zone keys on what that rewrite produced —
without it every visitor behind one point of presence would share a key. **The range list is
maintained by hand and goes stale**, and the trust it grants reaches every Cloudflare customer
rather than this account alone (§4); the access line records what the rewrite produced
([`docs/logging/spec.md`](../logging/spec.md) §1.2). **A fallback inside the trusted ranges is
marked rather than silent**: `nginx/prod.conf :: geo $realip_fallback` re-tests `$remote_addr`
after `realip` has run — a header that is absent or unparseable leaves the edge address in place —
and the access line carries the verdict as `realip_fallback`, `1` on the fallback (each case
measured 2026-08-31 against a running nginx: recovered `0`, absent `1`, malformed `1`). The marker
costs a second hand-kept copy of the ranges per file, held to the first by nothing (§4, OPS-78),
and reaches only that route: an address from a range published after the fetch falls back
**outside** both copies, so keeping the list current stays the only answer there.

**Every zone is keyed on a POST map, the two Kürzel zones excepted.** `$signin_limit_key` (and its
`48` twin — a `map` takes one source variable) is empty for anything but a POST, and an empty key
is exempt from `limit_req`, which is what lets the method maps serve `signin`, `clienterr` and
`bewerbung` without limiting the GETs on those paths. The Kürzel check IS a GET, so keyed there it
would read as limited and be unlimited; its zones key on the network maps unconditionally, at a
rate well above the submission's.

**Underneath both, the key is a NETWORK rather than an address, and there are two of them**:
`nginx/prod.conf :: map $remote_addr $client_net` answers the /64 for an IPv6 visitor and the whole
address for an IPv4 one, `nginx/prod.conf :: map $remote_addr $client_net48` the /48, and the
method maps chain onto both. A /64 is the floor of what one subscriber holds, so the narrow key
keeps ordinary visitors apart while the wide one caps the walk across a subscriber's own blocks; a
/56 key is not expressible from these strings, nginx stripping a group's leading zeros. **Every
render shape is enumerated rather than matched by a prefix, in both maps** — nginx's zero-run
compression falls where the HOST bits put it, so a shape a map missed would split one prefix into
two buckets and double its allowance.

**Both maps were verified against a RUNNING nginx** — their bodies extracted into a throwaway
`nginx:1.31-alpine` answering with what it rendered, driven across every zero/non-zero group
pattern and address class: no prefix split across two keys, no two prefixes shared one, no address
reached the fail-open `default`, and no two addresses shared a /64 while differing in /48 (measured
2026-08-30). Both files carry byte-identical map bodies, though nothing enforces that (§4, OPS-78).

**Both zones are repeated inside every limited location rather than declared once at server
level**: nginx inherits `limit_req` only where the level declares none — the
replace-rather-than-extend rule I2 records for `add_header`, reaching a third directive.
`limit_conn` inherits the same way, and `location /` declares it alone.

**Each metered path has a trailing-slash twin carrying the same zones.** An exact match is exact,
so the slashed form fell to the catch-all and reached Next unmetered before the twins existed. Next
answers it with a 308 and no handler runs, so the twins change nothing a visitor sees; they proxy
rather than `return 308`, which would be nginx deciding a trailing-slash policy that is Next's.
Percent-encoded, double-slash and dot-segment forms need no twin: nginx decodes, merges and
resolves each before matching, all three measured reaching their zone (measured 2026-08-30).

**Each pair is one narrow zone and one wide one, the wide at ten times the rate and the burst** —
the narrow zone decides an ordinary visitor's request, the wide one caps the walk. The pairs are
held apart per endpoint rather than pooled, one shared ceiling letting cheap traffic spend what
guards the expensive. **The application form's submission carries the lowest rate here**, its
handler mailing an address the REQUEST supplied — every allowed request is a message to a chosen
stranger — and lowering the reachable ceiling again is the wide multiplier's job rather than the
narrow rate's.

**`location /` takes a connection ceiling rather than a rate zone** — a `limit_req` there would
meter `/_next/static` too and stall an ordinary page load, so `limit_conn conn 50` on the narrow
key bounds the same flood without metering anything, `limit_conn_status` matching
`limit_req_status`. It is sized for HTTP/2, where nginx counts each CONCURRENT REQUEST as a
connection; through Cloudflare, whose edge pools origin connections, it is a backstop rather than a
per-visitor control. **That makes one directive count differently in the two files**:
`nginx/local.conf` serves HTTP/1.1, so the byte-identical line bounds whole connections locally,
and nothing compares the pair (§4, OPS-78).

**Three 15-second timeouts bound the gap between two reads, not a transfer** —
`client_header_timeout`, `client_body_timeout` and `send_timeout`, so a slow upload from a phone is
unaffected while a connection held open without sending is not.

**The public write caps its body at `64k` against the server block's `20M`**:
`FLPostBewerbungPayloadSchema` is a fixed-shape object with no array a caller can grow, so the
server-level allowance was headroom for an attacker alone. Measured 2026-08-30: a 100,049-byte POST
is refused `413` at the edge, while a 4,049-byte POST reaches the handler.

**A zone has been observed refusing, and what that establishes is the MECHANISM, not the numbers.**
A burst at the Kürzel check was refused past the burst as `429` (not nginx's `503` default), the
`fl_json` line carrying `"status":429` with an empty `upstream_duration_s` and the headers on the
refusal being I2's observation; `limit_req` also writes an `error`-level record outside the JSON
envelope, nginx's own behaviour. No rate here is measured — the figures remain judgement calls, and
the `limit_conn` figure is derived from HTTP/2 semantics and never exercised (measured 2026-08-30).

**The liveness location carries no `limit_req` zone, and that is a decision rather than an
omission**: it answers a GET that takes no key and touches no database, Cloudflare sits in front of
it, and a zone would throttle the uptime monitor the path is published for (§3) before it throttled
anything else.

Server blocks: port 80 redirects to HTTPS and strips `www.`; a `default_server` block on 443
rejects unknown hosts with `ssl_reject_handshake`; a second HTTPS block serves
`www.frankfurtleague.de` and 301s to the apex; the real server block serves `frankfurtleague.de`.
**The www block over HTTPS is not redundant with the port-80 redirect**: HSTS carries
`includeSubDomains`, so a browser that has visited once never issues the plaintext request the
port-80 block would have caught — without the block that request has its handshake rejected,
observed 2026-08-01 as a public `525`. **A Cloudflare proxy sits in front of nginx** (see the
[overview](overview.md)), so an origin-side failure can surface as a Cloudflare status code that
names neither nginx nor the block responsible.

Proxy headers are declared at server level: `Host`, `X-Real-IP`, `X-Forwarded-For`,
`X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`, HTTP/1.1 — plus the two the edge
controls outright, `X-Correlation-ID` minted and `X-FL-Actor` blanked, which are L7 and L10's rows
([`docs/logging/spec.md`](../logging/spec.md) §1.1).

**A `location` declaring any `proxy_set_header` REPLACES that whole inherited set rather than
extending it** — the mechanism I2 records for `add_header`. Both nginx configs hold the same two
locations that declare one: `location = /api/v0/system/is_live` restates the server block's list in
full with `Host $proxy_host`, so FastAPI is addressed as the upstream `proxy_pass` names and the
public hostname needs no place in `api_trusted_hosts`, both edge-controlled headers applied there
(I13); and `location /_next/static/` declares `Host $http_host` and nothing else, so neither
edge-controlled header reaches a static asset — nothing under that prefix runs application code,
and its access line carries `$request_id` either way.

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
prerendered HTML, which this application prerenders (`cacheComponents` in
`fl_frontend/next.config.ts`). The compensating control is the `react/no-danger` rule
[`docs/frontend/spec.md`](../frontend/spec.md) §1.8 records.

`style-src` carries it for a narrower reason: several components set a runtime-computed inline
`style` **attribute**, for which CSP offers no nonce or hash. The prerendered HTML carries no
inline `<style>` block, so the policy could still be narrowed to `style-src 'self'` with
`style-src-attr 'unsafe-inline'` — an nginx change rather than a documentation one, and
`docs/_roadmap/tooling-items.md :: OPS-66` owns it.

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
reaches MongoDB directly ([`../frontend/overview.md`](../frontend/overview.md)), so leaving its
`MONGODB_URI` alone would sign the local stack in against production.

**That database is a single-node replica set rather than a standalone**, the argument written at
`docker-compose.local.yml :: mongo`; its healthcheck reports healthy only once the node has elected
itself primary, and both application services wait on `service_healthy` — the backend because its
lifespan applies every validator before it yields.

**`./scripts/local.sh --seed` fills it from production**, through two containers of which only one
is handed the production credentials, and that one a `mongodump` command and no other — a
discipline rather than a boundary, its costs written at `scripts/local.sh :: take_dump`. A copy
already on disk is reused, `--refresh-db` takes a new one, and `--fresh` deletes the volume. The
copy lands in `.local-db/`, which `.gitignore` and `.prettierignore` both cover because it is real
data and this repository is public — its log with it, a failed copy quoting the cluster it could
not reach.

**A seed runs before the application services exist**: nothing renders a page against an empty
database, so no empty read is cached for the days the reference reads hold a value
([`../frontend/spec.md`](../frontend/spec.md) §1.2), and the copy step may clear the directory this
file bind-mounts, which is only safe while no container holds that mount. What the seed checks
before restoring is that the database container can see collections under it — `mongorestore`
pointed at an empty directory writes nothing and still exits 0.

**The copy is the application database and not the Auth.js store beside it** — the backend's
credential is scoped to one database (the two-users split in [`overview.md`](overview.md)), so the
local stack starts with an empty `authjs` and a sign-in builds it; the allowlist deciding who may
sign in is an environment value rather than a stored row.

**The production tier's limitations shape that command**, and they are the fastest-rotting fact on
this page: read from MongoDB's Atlas Flex limitations documentation, 2026-08-27. What each denial
costs the command is written at `scripts/local.sh :: take_dump`; the copy carries no users or roles
and is consistent per collection rather than at one instant. Two things fix the local image's major
version — that tier's MongoDB floor, and the tag the db tier runs against
(`fl_backend/tests/conftest.py :: mongo_replica_set_url`) — and mongorestore refuses a dump whose
source carries a different one.

**`deploy.sh` reads the server's Docker Engine version before it stops anything** — the comment at
`scripts/deploy.sh :: ENGINE_MIN` holds why preflight asks rather than the deploy.

**`scripts/ci_scopes.sh` is the one copy of the path-to-scope mapping.** Every CI workflow that
maps paths reads it, and so does `scripts/check_scope.py` through its `--stdin` mode; every other
statement of which paths select which scope — the packaging list included — cites that file rather
than repeating it.

**The checkers are python, and one kernel is what makes their answers comparable** —
`scripts/checker_kernel.py`, whose own header holds the inventory (§1.7). It fixes the interpreter
floor (`scripts/checker_kernel.py :: PYTHON_FLOOR`), below which it exits at import as a crash — at
the earliest line an old interpreter reaches, a checker's own body being free to use syntax it
cannot parse. **`check_pr_body.py` runs only in CI** — a pull request body is not in the
repository, so `.github/workflows/pr-body.yml` is the only place it is addressable. The one
javascript helper is `scripts/ts_normalize.mjs`, whose header argues the exception.

**`scripts/tests/` is the pytest suite that proves the gate's own coverage** (PRE-4): it plants one
violation per check `scripts/check_docs.py` registers and asserts the check finds it, holds the
python in `scripts/` to parsing at `scripts/checker_kernel.py :: PARSE_FLOOR`, and asserts every
shell arm degrading on a crash spells `scripts/checker_kernel.py :: EXIT_CRASH` as its own literal
— a copy left behind being invisible to the run it silently reprieves.

**`scripts/selfcheck.sh` tests the scripts themselves**, and it is the scripts scope's first step —
reach for it directly after editing anything in `scripts/`, `.claude/hooks/` or `.githooks/`. Its
passes catch the defects Windows hides: CRLF endings, and an executable bit that `chmod +x` in Git
Bash never reaches, either of which works locally and fails on the server (I10). It probes the
assistant guards against a throwaway repository, drives `check_scope.py`'s comment-only classifier
over fixtures in both directions — the one gate decision whose wrong answer is silent — and
byte-compares the blocks the guards duplicate rather than source, between their sentinel markers,
so a fix made to one copy and not the rest fails the gate rather than leaving a hole.

**That classifier's TypeScript half needs the frontend's `typescript`, and the scope does not
require it**: where `typescript` does not resolve, the classifier is required to answer "code", and
the self-check asserts that degradation. CI's `scripts` job installs the frontend dependencies for
exactly this reason — otherwise the parser half would be exercised on no machine but the author's.

**shellcheck and actionlint are pinned, and nothing but a person bumps them** — the versions are
written in the self-check itself, where no dependency ecosystem can read them, the deliberate
manual half of a pinning policy Dependabot otherwise maintains
([`docs/_git/spec.md`](../_git/spec.md) §1.6). A `shellcheck` on PATH is used and warned about off
the pin; with no binary and no daemon each step skips rather than fails outside CI, so the shell
and the workflows go unlinted while the rest of the scope passes — in CI the same shortfall is a
finding. `require_docker` runs for the ops, database and image scopes alone, so nothing announces
the shortfall before a `--scripts` run starts.

**Publishing needs a classic token with `write:packages`** (`docker login ghcr.io -u felzab`): a
fine-grained token logs in and then fails the push with `permission_denied`, ghcr evaluating
package write only at push time, a first push being a create that repository scopes do not cover.
If a previous login stored another token, `docker logout ghcr.io` first; the server needs no token,
both packages pulling anonymously.

**`publish.sh` refuses at exit 2 wherever it is asked to judge something it could not read, and
pushes nothing when it does**: the `instrumentation.js` probe refuses where the container could not
run at all — a different answer from the exit 1 where the file is genuinely missing — and the
preflight refuses where a remote could not be asked which branches it has (I12). **It prunes the
SUPERSEDED local sha tags after a successful push**, which never become dangling and so escape
`docker image prune`.

**Registry pruning stays manual and optional**, a botched delete destroying rollback history (§4).
When pruning, keep roughly the last five `sha-` tags per package and never delete what is live
(`./scripts/deploy.sh --status`), what `latest` shares a digest with, or an **untagged version
created alongside a tag still in use** — BuildKit provenance attestations the tagged image
references by digest, so deleting one corrupts the tag it belongs to.

**`--status` has two endings of its own, and pruning is decided from what it prints**: it refuses
at exit 2 where any service could not be asked — an unasked service reads exactly like a stopped
one — and fails at exit 1 where the two running services are different builds, naming both and the
tag that puts them back on one build (§3).

### 1.6 The verification gate

`scripts/verify.sh` reports its scopes in cheapest-to-fail order, so the answer that costs seconds
arrives before the one that costs minutes. A bare invocation runs everything; scope flags name
surfaces and combine, and `--frontend` implies `--format`, the frontend scope reading exactly the
files the formatter governs.

Scopes **run concurrently by default**, one worker process each, and `verify.sh` replays their
captured output in that order — so a parallel run reads as the serial one, byte for byte, per
stream: a terminal merging stdout and stderr sees a scope's error lines after its output rather
than between it, which is the merge and not a defect. `--serial` runs them one at a time and is
what a byte-identity comparison is measured
against; `--verbose`, a run covering one scope, CI (already one scope per job) and a machine with
no interpreter at the checkers' floor are serial too. `ops` follows `backend`, `db` and `frontend`,
whose trees its stand-in `.env` files appear in. **The `--frontend` implication above is the
parent's, never a worker's** — a worker runs the one scope it is given. `scripts/gate_pool.py` owns
the spawning and nothing else; the sections and closing statements stay in `scripts/_lib.sh`.

**The scripts scope carries that shape one level down**: its checks start together and each is
collected at its own step, so the scope costs its slowest check rather than the sum. Every verdict
is still reached in written order, a job records an exit status and never speaks, and a job that
left no status is read as a crash rather than as a pass; the serial exceptions above are this
level's too. A step joined after its work ran beside its neighbours is re-dated to that work's own
length (`scripts/_lib.sh :: step_took_ms`), without which the first step joined absorbs the whole
stretch and every step after it reads as free.

**The eslint step passes `--concurrency=2`, a value answering a diagnostic rather than the clock**:
`auto` warns through `ESLintPoorConcurrencyWarning` and every larger measured setting warns too, so
raising the number buys its time by suppressing a correct diagnostic — the measurements are
`docs/_roadmap/tooling-items.md :: OPS-19`.

**No formatter the gate runs writes a tracked file** — prettier runs in check mode everywhere, so a
run cannot hand back a tree different from the one its later steps measured. Formatting happens at
commit time instead: `.githooks/pre-commit` formats what is staged and re-stages it, and refuses a
file staged in part. The hook is convenience and never the enforcement — a clone that has not
pointed `core.hooksPath` at it has no hook at all, and this scope and CI are what bind.

**One tracked file a gate run writes is not a formatter's doing**: `next build` rewrites
`fl_frontend/tsconfig.json` whenever a `compilerOptions` key it checks for is absent, so the
frontend scope stays green having read a different config from the `tsc` step before it; the
frontend job in `.github/workflows/verify.yml` diffs that one path and fails on it.

CI runs the same checks as parallel jobs mapped from the paths a pull request touches:
`scripts/ci_scopes.sh` emits one `name=true|false` line per `verify.sh` flag, so a scope's name in
the mapping and the flag that proves it are one word. Which paths select `format` is decided by
extension, because prettier's reach is, and CI's `format` job stands down where the frontend job
runs, which already covers it.

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

Docker is checked before any check runs on a run covering the ops, database or image scopes, and
the backend virtualenv on one covering the scripts, documentation, backend or database scopes; the
frontend's `pnpm install` prerequisite is checked nowhere, so a missing one surfaces at the first
step running a tool out of `node_modules`. Each tool is its own step, tool output is captured and
shown only when its step fails, and `--verbose` streams everything instead (§1.7). **The self-check
is the exception**, replayed rather than captured: what it skipped and warned about reaches the
screen through a ledger even on a step that passed, because a skip nobody sees reads as a pass
(§1.7).

**A manifest is compared against its lockfile before anything reads the installed tree** — the
frontend scope resolves the lockfile against `package.json` and the backend scope runs
`uv lock --check`, both cheap, where otherwise the breach surfaced only where discovery is
expensive. The frontend check passes `--lockfile-only`, which keeps it a check rather than an
install, and `--no-optimistic-repeat-install`, which keeps it a check at all — the default answers
from file timestamps, so a manifest restored with its mtime preserved passes while disagreeing with
the lockfile.

**Before any of them runs, `check_scope.py` compares the scopes named against what the branch
actually changed.** It refuses a run whose diff reaches the image build with a change that is more
than comments, and merely reports every other surface the run leaves unproven. What counts as "more
than comments" is decided by a parser and never by a `#` rule: TypeScript through its own parser,
Python through `ast` with docstrings stripped, TOML through `tomllib`, and everything else is code,
the safe answer where no parser is available. The check is skipped in CI, which maps its own scopes
from the paths.

**The scripts scope lints and type-checks its own python**, through configs that sit in `scripts/`
rather than at the repository root: a root config would become the nearest one for `fl_backend/`
too, moving isort's idea of the source root and overriding the backend's pyright block.
`scripts/ruff.toml` `extend`s the backend's configuration and adds nothing, so the selection stays
in one file; `scripts/pyrightconfig.json` pins the python version rather than letting pyright infer
one, which would answer differently per machine.

**Commit messages ride in the docs scope**, the commit bodies being documentation and merges never
squashed precisely so they survive ([`docs/_git/spec.md`](../_git/spec.md) §1.4). In CI the check
can ride nowhere, a commit message having no path to filter on, so it runs in the always-on
`changes` job instead.

The **ops** scope exists because the compose files and the nginx config have no compiler and no
test suite — without it, a typo in either surfaces on the server, at deploy time. `nginx -t` runs
against throwaway self-signed certificates and loopback upstream hosts, because a config test loads
both.

**The scope also holds the local stack to production's shape.** The differences meant to be there
are the local file's declared list, restated as data in `scripts/check_compose_mirror.py` so the
claim is testable, and a declared delta matching no real difference is a finding too: the list
stays honest in both directions. A compose construct outside the reader's parsed subset is a
refusal rather than a verdict (§1.7). **The largest declared delta is a whole service** — the local
database, its volume and the `depends_on` keys (`scripts/check_compose_mirror.py ::
DECLARED_DELTAS`) — and a delta covering a whole service covers its ports with it, which is why I1
is held by a check of its own over both files rather than by that list.

**One path reaches across the boundary on purpose**: `fl_backend/openapi.json` selects the
**frontend** scope alongside the backend ones, because the frontend scope holds the Zod-mirror
comparison — without this arm (in `scripts/ci_scopes.sh`) a Pydantic model change would never run
the check that exists to catch it.

**In CI the images scope caches layers through the Actions cache service**
(`VERIFY_IMAGES_CACHE=gha`). buildx authenticates with a credential the runner gives only to
JavaScript actions, so `.github/actions/actions-runtime-env` re-exports it first, and **the scope
stops before building when the variable is set and the credential is missing** — buildx would fail
too, but only after every layer has been built, naming a missing token rather than the missing
step. Locally the variable is unset and the build runs against the daemon's own cache.

**The documentation gate** (`scripts/check_docs.py`) reads `/docs`, the source comments beside the
code and the configuration files scanned with them, and its byte-level checks read every tracked
text file — so a finding this scope raises need not be about a document at all. Its checks are
registered in `scripts/docs_gate/kernel.py :: CHECKS` and nowhere else.

**The backend steps** exist because the frontend's toolchain runs nothing against `fl_backend`
([`docs/backend/spec.md`](../backend/spec.md) §1.6); `pyright` is separate from `ruff` because ruff
checks no types. **Both test tiers run**: the `db`-marked tests need a real `mongod`, so they are
their own scope behind `require_docker` — which is what lets `--quick` skip them — and in CI the
concurrent `backend-db` job. **The image scope** exists because code that compiles can still fail
to build inside the image, or be omitted from the standalone output entirely.

`--quick` is the scopes that need no Docker — scripts, docs, backend, format and frontend — and is
**not sufficient** before a merge touching a packaging path: `scripts/ci_scopes.sh` holds the list,
and CI builds both images on any pull request touching one. An audit remediation wave runs the full
form regardless of what it touched, unless it changed documentation only.

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

`info`, `skip`, `warn`, `fail`, `ok`, `die` and `refuse` funnel through `scripts/_lib.sh :: _emit`;
`section`, `step`, `detail` and `excerpt` own their own line shapes, and `scripts/check_docs.py`
prints to the same columns, so the whole gate reads as one voice. A run closes with one row per
section and then the statement for whichever ending it reached, and a section that closed with no
verdict at all is recorded as a finding rather than passed over. Colour is decided centrally:
`FL_GATE_COLOR` is read ahead of everything else — the gate's own variable, how a parent hands a
worker its answer without exporting one every tool would take as an instruction — then `NO_COLOR` /
`FORCE_COLOR`, a terminal, and GitHub Actions, whose log renders ANSI. A spinner draws only where
somebody is watching one — off under `NO_SPINNER` where a terminal mangles a carriage return, and
never under `--verbose`, whose whole purpose is the tool's own output as it arrives.

**Every script a person reads accepts `--verbose`**, which streams each tool's own output instead of
capturing it — the one thing a captured run cannot give back afterwards.

**A script whose output only a machine reads is exempt, and the interface is what decides, never the
folder.** `scripts/ci_scopes.sh` writes `$GITHUB_OUTPUT`'s `key=value` lines and the assistant hooks
answer with a JSON verdict, so a heading, a fold marker or a colour code in either is a corrupt answer
rather than a nicer log. `ci_scopes.sh` is accordingly the one script with no `--verbose`, and puts
its human-readable line on stderr, where it cannot reach the outputs.

## 2. Invariants

| #   | Invariant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Enforced by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | Only nginx publishes a port another host can reach — the local database's is bound to `127.0.0.1`                                                                                                                                                                                                                                                                                                                                                                                                                                               | `scripts/check_compose_mirror.py :: off_host_ports`, over both files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| I2  | Security headers are repeated in every `location` that sets any header                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `nginx/prod.conf :: location /_next/static/` and `:: location = /api/v0/system/is_live`, each restating the set its own `add_header` replaced; observed 2026-08-30 on a `429` from `zone=kuerzel` and on the liveness `200`, both carrying the full set                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I3  | A `default_server` block rejects unknown hosts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `ssl_reject_handshake on`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| I4  | Sign-in rate limiting applies to POST only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | the `map` producing an empty key otherwise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I5  | The builder stage has no reachable backend or real env                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `SKIP_ENV_VALIDATION=true`, placeholder `MONGODB_URI`, no `API_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I6  | Production never builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `deploy.sh` only pulls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| I7  | Both images build before either is pushed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `publish.sh`; and `deploy.sh`, which compares the pulled `:latest` builds' `version` labels before recreating anything — refusing where a label could not be read, and warning where an image carries none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I8  | Publishing stops on a dirty tree by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `publish.sh`, whose `--allow-dirty` escape suffixes the tag `-dirty` and a fingerprint of the tree (`scripts/publish.sh :: DIRTY_ID`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I9  | Deploy recreates containers in place                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `deploy.sh`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I10 | Scripts use LF line endings and carry the git executable bit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `selfcheck.sh` (its LF and executable-bit checks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I11 | The three API keys are 64 characters and match on both sides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `fl_frontend/src/core/config.ts` alone (`length(64)`); the backend requires presence only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| I12 | Publishing stops on a commit no remote holds — any remote branch clears the bar, not only an ancestor of `main`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `publish.sh`, whose preflight asks the remotes for their branches (`git ls-remote --heads`) and requires HEAD to be an ancestor of a tip this clone holds, `--dry-run` included; a remote that could not be asked refuses at exit 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I13 | Exactly one backend endpoint is reachable from the edge — `= /api/v0/system/is_live`, exact-match so nothing joins it, restating the whole `proxy_set_header` set with `Host $proxy_host` among it (§1.3). Every other `/api/...` path reaches Next, some through a block naming it and the rest through `location /` (§1.3). A URI nginx normalises onto the liveness path is proxied as written and collects FastAPI's 404 rather than Next's, which routes to nothing and fingerprints the stack (§1.3)                                      | unenforced — the ops scope's `nginx -t` parses `prod.conf` without reading which locations it declares (§1.6), `nginx/local.conf` is parsed by nothing (§4, OPS-78), and no test issues a request to a backend path through the edge. The normalisation half WAS observed 2026-08-30: `//api/v0/system/is_live` collects FastAPI's `{"detail":"Not Found"}` under this location's own `Cache-Control: no-store`, so nginx merged the slash for matching and proxied the URI as written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| I14 | **Every `limit_req` zone is PAIRED and keys on the visitor's own networks — the /64 and the /48 for IPv6, the whole address for IPv4 — never on the Cloudflare edge, and neither prefix split across two keys in the verification §1.3 records**. The three failures it stands between are shared keying, where one point of presence buckets every visitor behind it; a walkable key, where the /64s one subscriber is allocated outlast any rate the narrow zone can set; and a SPLIT key, where one prefix written two ways is allowed twice | `nginx/prod.conf :: map $remote_addr $client_net` with `nginx/prod.conf :: map $remote_addr $client_net48` for the network half, each enumerating every render shape rather than matching a prefix, on the one-off measurement §1.3 records rather than on anything re-run; `nginx/prod.conf :: set_real_ip_from` with `nginx/prod.conf :: real_ip_header` and `nginx/prod.conf :: real_ip_recursive` for the visitor half, the last of which is what makes a chained value take its final element. Unenforced by the GATE, as I13 is — `nginx -t` parses the file without reading what it keys on, and no test issues a request through the edge. That is no longer true of the EVIDENCE: §1.3 records both maps driven through a running nginx and a zone observed refusing correctly. A measurement taken once is not a check that runs again, and nothing re-runs either. What the halves fail back to is §4 and OPS-93 — a header-route fallback marking its access line with `realip_fallback` while a stale-range one stays silent (§1.3) |

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
| A db-tier run reports a wall of failures naming validators and unique indexes | Another `pytest -m db` was running beside it; the mechanism is unestablished                                                                                 | Trust neither verdict, the green one included. Re-run with nothing else running, and take any db-tier measurement alone — a figure counts only as a pair of runs within a fifth of a second of each other on an idle machine (`docs/_roadmap/tooling-items.md :: OPS-70`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
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

| Item                                                                  | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The API version is spelled outside the code                           | Open — every spelling works today and an API version bump has to reach all of them. The tracked files one commit moves together are the backend healthcheck in each compose file (`docker-compose.yml :: backend`, `docker-compose.local.yml :: backend`), the liveness location in each nginx config (`nginx/prod.conf :: location = /api/v0/system/is_live`, `nginx/local.conf :: location = /api/v0/system/is_live`) and the deploy script's own check of the edge (`scripts/deploy.sh :: The liveness probe, through the edge`, which spells the path again in the warning it prints). The healthcheck and the location each break silently, and §3 carries both symptoms; the deploy check breaks loudly instead — left at the old version it asks the edge for a path no location names, so every deploy of a healthy site warns and withholds its closing `The pulled build is live.` The remaining site is the frontend's `API_VERSION` environment value (`fl_frontend/src/core/config.ts :: frontend_config`, which `fl_frontend/src/core/api.ts` builds every call's base URL from, constrained by [`docs/frontend/spec.md`](../frontend/spec.md) §1.7) — a deployed per-environment value rather than a tracked file, so no commit can carry it and the deploy has to. Left behind, it breaks loudly and all at once: every frontend fetch targets the old version, matches `location /` and collects Next's HTML 404 (I13) |
| Registry tag pruning is manual                                        | Accepted — a botched delete destroys rollback history. The retention procedure is in §1.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Revoking admin access needs a restart                                 | Accepted — the allowlist is validated at boot; after it, `role` is re-derived per request and the session dies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `nginx` drops no capabilities                                         | Open — the two application services carry `cap_drop: ALL` and `no-new-privileges:true` and `nginx` carries neither, and the asymmetry is undecided                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Certificate renewal is outside this repository                        | Accepted — they are mounted from `./certs`, and nothing here issues or rotates them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The local database runs unauthenticated, holding real contact records | Accepted — it holds a copy rather than the source, and I1 is what keeps it off every interface but this host's. `--replSet` with authentication also wants a bind-mounted keyfile whose permissions `mongod` checks, which a Windows host does not reliably give it (`fl_backend/tests/conftest.py :: mongo_replica_set_url` declines it for the same reason). What the copy contains is people, so `--fresh` is what a machine that no longer needs one should be left in: it removes the volume and the copy under `.local-db/` together                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| INC-9 measures none of a renamed file's comment blocks                | Open — `scripts/docs_gate/branch.py :: check_comment_length` reads a block only where every one of its lines sits in the branch's added set, and a detected rename leaves a carried block's lines as context, so no length is measured under the new path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| No gate scope parses or compares `nginx/local.conf`                   | Open — its header claims production's routing, rate limits and security headers, and nothing reads the claim: `nginx -t` runs against `prod.conf` alone and `scripts/check_compose_mirror.py` compares the compose pair (§1.6). It parses cleanly in the pinned image when run by hand, which is not the same as the gate running it; and §1.3 records one directive the two files spell identically and HTTP/2 makes behave differently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A guard the database tier stays green without                         | Open — the `session=` argument that keeps a transactional read in `fl_backend/app/api/saisons/admin_router.py` inside its own snapshot is stated by a comment beside it, and dropping it reportedly leaves `--db` (§1.6) green, so the scope this page runs as the backend's regression net is not what holds it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The linter behind §1.4's compensating control is past end of life     | Open — `fl_frontend/package.json` holds eslint at a 9.x line that will take no further fix of any kind, and both the `react/no-danger` rule §1.4 names as the CSP's compensating control and the lint step of `--frontend` (§1.6) run on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A call site's key tier is held to its route by nothing                | Open — `fl_frontend/src/core/api.ts :: apiClient` takes the tier as an option, and omitting it is loud, an admin router refusing the base key with `REQ-AUTH-004`; declaring `authType: "admin"` where a public route would have answered succeeds identically, sending an admin key and an actor header for nothing. `fl_backend/openapi.json` flattens every tier to one `HTTPBearer` scheme, so neither side publishes what a check would compare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A scope that passed leaves the report when an earlier one fails       | Open — `scripts/verify.sh :: replay_scope` walks the scopes in a fixed order and `scripts/_lib.sh :: finish` exits on the first non-zero status, so a later scope's ledger is never adopted and §1.6's closing table cannot tell a passing scope from one that never ran.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A citation continuing a file already named is checked by nothing      | Open — `scripts/docs_gate/checks.py :: CITATION_RE` needs a file part before the separator, so a continuation resolves to nothing: its anchor is never proved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Real-IP recovery can fall back with nothing to say so                 | Open — §1.3's zones are per visitor only while realip replaces the Cloudflare address; a published range added after the hand-copied fetch, or the header it reads not arriving in a usable shape, restores shared keying silently, and no check tests whether the recovered address is still inside a trusted range.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The origin trusts every source inside Cloudflare's ranges             | Open — `set_real_ip_from` trusts the published ranges, which are every Cloudflare customer's egress rather than this account's, so a request from inside them sets §1.3's rate-limit key and the access line's `client` itself; `docker-compose.yml` publishes 80 and 443 and no origin authentication, tunnel or firewall stands in front.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
