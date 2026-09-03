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
| `/api/auth/signin`         | `frontend:3000` | Auth.js's own sign-in POST, metered on `signin`/`signin48` — a PREFIX, so no trailing-slash twin                                                                                                     |
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

**`$remote_addr` is the visitor rather than the Cloudflare edge**, and every zone keys on what that
rewrite produced (`nginx/prod.conf :: real_ip_header`, `:: set_real_ip_from`); the access line
records it ([`docs/logging/spec.md`](../logging/spec.md) §1.2). **The range list is maintained by
hand and goes stale**, and the trust it grants reaches every Cloudflare customer rather than this
account alone (§4). **A fallback inside the trusted ranges is marked rather than silent**: the
access line carries `realip_fallback`, `1` where the rewrite did not take (each case measured
2026-08-31 against a running nginx: recovered `0`, absent `1`, malformed `1`). The marker costs a
second hand-kept copy of the ranges per file, held to the first by nothing (§4, db2a-9qu3), and
reaches only that route: an address from a range published after the fetch falls back **outside**
both copies, so keeping the list current stays the only answer there.

**Every zone is keyed on a POST map, the two Kürzel zones excepted** — an empty key is exempt from
`limit_req`, so `signin`, `clienterr` and `bewerbung` limit no GET on their paths. The Kürzel check
IS a GET, so keyed there it would read as limited and be unlimited; its zones key on the network
maps unconditionally, at a rate well above the submission's.

**Underneath both, the key is a NETWORK rather than an address, and there are two of them** —
`nginx/prod.conf :: map $remote_addr $client_net` for the /64 and `:: map $remote_addr
$client_net48` for the /48, the whole address on IPv4 either way. A /56 key is not expressible from
these strings at all, nginx stripping a group's leading zeros.

**Both maps were verified against a RUNNING nginx** — their bodies extracted into a throwaway
`nginx:1.31-alpine` answering with what it rendered, driven across every zero/non-zero group
pattern and address class: no prefix split across two keys, no two prefixes shared one, no address
reached the fail-open `default`, and no two addresses shared a /64 while differing in /48 (measured
2026-08-30). Both files carry byte-identical map bodies, though nothing enforces that (§4,
db2a-9qu3).

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

**Each pair is one narrow zone and one wide one, the wide at ten times the rate and the burst**, and
the pairs are held apart per unit of WORK rather than pooled — two paths reaching the same work
share one pair. `bewerbung48` is the one deliberate exception to the multiplier, and it is on the
RATE alone: three times rather than ten, on a count of applications per season rather than a ratio.
What decides that number, and what it risks, is at the zone in `nginx/prod.conf`.

**`location /` takes a connection ceiling rather than a rate zone**, `limit_conn conn 50` on the
narrow key, sized for HTTP/2 where nginx counts each concurrent request as a connection. **That
makes one directive count differently in the two files**: `nginx/local.conf` serves HTTP/1.1, so
the byte-identical line bounds whole connections locally, and nothing compares the pair (§4,
db2a-9qu3).

**The public write caps its body at `64k` against the server block's `20M`.** Measured 2026-08-30:
a 100,049-byte POST is refused `413` at the edge, while a 4,049-byte POST reaches the handler.

**A zone has been observed refusing, and what that establishes is the MECHANISM, not the numbers.**
A burst at the Kürzel check was refused past the burst as `429` (not nginx's `503` default), the
`fl_json` line carrying `"status":429` with an empty `upstream_duration_s` and the headers on the
refusal being I2's observation; `limit_req` also writes an `error`-level record outside the JSON
envelope, nginx's own behaviour. No rate here is measured — the figures remain judgement calls, and
the `limit_conn` figure is derived from HTTP/2 semantics and never exercised (measured 2026-08-30).

**The liveness location carries no `limit_req` zone, and that is a decision rather than an
omission**: a zone would throttle the uptime monitor the path is published for (§3) before it
throttled anything else.

**The www block over HTTPS is not redundant with the port-80 redirect**: HSTS carries
`includeSubDomains`, so a browser that has visited once never issues the plaintext request the
port-80 block would have caught — without the block that request has its handshake rejected,
observed 2026-08-01 as a public `525`. **A Cloudflare proxy sits in front of nginx** (see the
[overview](overview.md)), so an origin-side failure can surface as a Cloudflare status code that
names neither nginx nor the block responsible.

**A `location` declaring any `proxy_set_header` REPLACES that whole inherited set rather than
extending it** — the mechanism I2 records for `add_header`, and what decides which of the two
edge-controlled headers, `X-Correlation-ID` and `X-FL-Actor`, reaches an upstream (L7 and L10,
[`docs/logging/spec.md`](../logging/spec.md) §1.1). The liveness location restates the set in full
so that FastAPI is addressed as the upstream `proxy_pass` names and the public hostname needs no
place in `api_trusted_hosts` (I13); `location /_next/static/` restates none of it, nothing under
that prefix running application code.

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
`docs/_roadmap/items.md :: qw6j-scru` owns it.

**The rest of the policy is load-bearing and does not depend on `script-src`:** `frame-ancestors
'none'` blocks framing, `object-src 'none'` blocks plugin content, `base-uri 'self'` blocks base-tag
hijacking, and `form-action 'self'` blocks exfiltration through a form post.

### 1.5 The scripts

`scripts/README.md` navigates the folder; each script's own header carries its usage and prints it
with `--help`. What spans the scripts lives here.

| Environment | What it is                                            | Database                                                        | Entry point                                                                      |
| ----------- | ----------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **dev**     | source with hot reload, no Docker                     | whichever cluster the `.env` files name                         | `pnpm dev` in `fl_frontend/` · `uv run fastapi dev app/asgi.py` in `fl_backend/` |
| **local**   | the production image built from your tree, with nginx | its own, inside the stack (`docker-compose.local.yml :: mongo`) | `./scripts/ops/local.sh`                                                         |
| **prod**    | published images on the server, never builds          | the managed cluster                                             | `./scripts/ops/deploy.sh`                                                        |

**local** is the only place a packaging problem — a missing standalone file, a failing startup env
gate, a header nginx does not set — is visible before a deploy: **dev** exercises none of that
machinery, and **prod** only pulls (I6). Machine-specific scripts will not start on the wrong
platform.

**The local stack points both application services at its own database through compose's
`environment`**, so no `.env` is edited and no run is left aimed at the wrong cluster
(`docker-compose.local.yml`, whose invariant block holds the argument for each override).

**`./scripts/ops/local.sh --seed` fills it from production**, through two containers of which only
one is handed the production credentials — a discipline rather than a boundary, its costs written
at `scripts/ops/local.sh :: take_dump`. A copy already on disk is reused however old it is,
`--refresh-db` takes a new one and `--fresh` deletes the volume. The copy lands in `.local-db/`,
which `.gitignore` and `.prettierignore` both cover because it is real data and this repository is
public.

**A seed runs before the application services exist**, so nothing renders a page against an empty
database and no empty read is cached for the days the reference reads hold a value
([`../frontend/spec.md`](../frontend/spec.md) §1.2).

**The copy is the application database and not the Auth.js store beside it** — the backend's
credential is scoped to one database (the two-users split in [`overview.md`](overview.md)), so the
local stack starts with an empty `authjs` and a sign-in builds it; the allowlist deciding who may
sign in is an environment value rather than a stored row.

**The production tier's limitations shape that command**, and they are the fastest-rotting fact on
this page: read from MongoDB's Atlas Flex limitations documentation, 2026-08-27. What each denial
costs the command is written at `scripts/ops/local.sh :: take_dump`; the copy carries no users or
roles, is taken one collection at a time against the tier's rate cap, and is consistent per
collection rather than at one instant. Two things fix the local image's major version — that tier's
MongoDB floor, and the tag the db tier runs against
(`fl_backend/tests/conftest.py :: mongo_replica_set_url`) — and mongorestore refuses a dump whose
source carries a different one.

**`deploy.sh` reads the server's Docker Engine version in preflight, before it stops or pulls
anything**, the compose files' `start_interval` being what needs it
(`scripts/ops/deploy.sh :: ENGINE_MIN`).

**`scripts/gate/scope_map.sh` is the one copy of the path-to-scope mapping.** Every CI workflow that
maps paths reads it, and so does `scripts/checks/check_scope.py` through its `--stdin` mode; every other
statement of which paths select which scope — the packaging list included — cites that file rather
than repeating it.

**The checkers are python, and one kernel is what makes their answers comparable** —
`scripts/lib/checker_kernel.py`, whose own header holds the inventory (§1.7). It fixes the interpreter
floor (`scripts/lib/checker_kernel.py :: PYTHON_FLOOR`), below which it exits at import as a crash — at
the earliest line an old interpreter reaches, a checker's own body being free to use syntax it
cannot parse. **`check_pr_body.py` runs only in CI** — a pull request body is not in the
repository, so `.github/workflows/pr-body.yml` is the only place it is addressable. The one
javascript helper is `scripts/checks/ts_normalize.mjs`, whose comment at
`scripts/checks/ts_normalize.mjs :: printer` argues the exception.

**`scripts/tests/` is the pytest suite that proves the gate's own coverage** (PRE-4); what a module
covers is its own header, and a check `scripts/checks/docs_gate/kernel.py :: CHECKS` registers
without a planted violation beside it fails
(`scripts/tests/test_check_docs.py :: test_every_registered_check_and_verdict_has_a_plant`).

**`scripts/gate/selfcheck.sh` tests the scripts themselves**, and it is the scripts scope's first
step — reach for it directly after editing anything in `scripts/`, `.claude/hooks/` or
`.githooks/`. Its passes catch the defects Windows hides: CRLF endings, and an executable bit that
`chmod +x` in Git Bash never reaches, either of which works locally and fails on the server (I10).
It also holds the two decisions that are silent when wrong — `check_scope.py`'s comment-only
classifier, and `_lib.sh`'s log redaction (§1.7), whose failure is either a credential on the
operator's terminal or the host redacted out of the log a failing deploy is read from.

**That classifier's TypeScript half needs the frontend's `typescript`, and the scope does not
require it**: where `typescript` does not resolve, the classifier is required to answer "code", and
the self-check asserts that degradation. CI's `scripts` job installs the frontend dependencies for
exactly this reason — otherwise the parser half would be exercised on no machine but the author's.

**shellcheck and actionlint are pinned, and nothing but a person bumps them** — the versions are
written in the self-check itself, where no dependency ecosystem can read them, the deliberate
manual half of a pinning policy Dependabot otherwise maintains
([`docs/_git/spec.md`](../_git/spec.md) §1.6). **With no binary and no daemon each step skips
rather than fails outside CI**, so the shell and the workflows go unlinted while the rest of the
scope passes; in CI the same shortfall is a finding. `require_docker` runs for the ops, database
and image scopes alone, so nothing announces the shortfall before a `--scripts` run starts.

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
(`./scripts/ops/deploy.sh --status`), what `latest` shares a digest with, or an **untagged version
created alongside a tag still in use** — BuildKit provenance attestations the tagged image
references by digest, so deleting one corrupts the tag it belongs to.

**`--status` reads and changes nothing, and it ends green, with findings or refused (§1.7)** —
pruning is decided from what it prints, so which ending it reached is the first thing to read.
**Green is the
only ending a registry may be pruned from**: findings mean something definite is wrong with what is
running, and a refusal means a question the report is built from went unanswered, so the rollback
list it printed may be short by whatever went unread and "never delete what is live" cannot be
applied to it.

**A stopped service is graded as a finding rather than an advisory**, because the edge can still
answer 200 from a worker that outlived it: a green probe over a stopped pair is what a stale nginx
or a stray container looks like, and it is the state that most resembles a healthy one from
outside. That probe is the only line in the report not taken from a container, nginx resolving its
upstreams once as it loads, so a healthy pair says nothing about whether the edge is still pointed
at it (I9).

**`curl` writing `000`, on the other hand, is an advisory**, because `deploy.sh` runs on the server:
the read is the host asking for its own public hostname, so a host that does not resolve the domain
publicly, or whose network does not route 443 back to it, answers `000` while the site is perfectly
well. The deploy's own probe of the same URL grades it the same way.

### 1.6 The verification gate

`scripts/gate/verify.sh` reports its scopes in cheapest-to-fail order, so the answer that costs seconds
arrives before the one that costs minutes. A bare invocation runs everything; scope flags name
surfaces and combine, and `--frontend` implies `--format`, the frontend scope reading exactly the
files the formatter governs.

Scopes **run concurrently by default**, one worker process each, and `verify.sh` replays their
captured output in written order — so a parallel run reads as the serial one, byte for byte, per
stream: a terminal merging stdout and stderr sees a scope's error lines after its output rather
than between it, which is the merge and not a defect. A failing scope still ends the run at its
own replay, but only after every later scope that finished with a verdict has its ledger rows
adopted — rows alone, never the captured output — so the closing table tells a passing scope from
one that never ran, and a session fixing the failure knows what it need not pay for again.
Byte-identity with the serial run is a green run's property, a failing serial run having stopped
where the parallel one did not, and `--serial` is what that comparison is measured against.
**No scope waits on another**, so every scope starts at once and the run's floor is its longest.

**A worker's exit status and the rows it sent home are two accounts of one run, and the parent holds
them to each other** (`scripts/lib/_lib.sh :: adopt_ending`): one whose rows name neither a finding
nor a refusal **ends the run at 3, never at 2**. Read a 3 there as the code for the environment
says: the fault is in this gate's own handoff, and nothing in the tree under test can be changed to
answer for it.

**Most scopes carry that shape one level down, through the same pool**, so a scope costs its
slowest check rather than the sum; the format, ops and database scopes run theirs in place. **A
pool's own wiring is refused at 3 before anything runs**, each refusal carrying its argument at the
line it guards.

**A failure is reported once the pool is done, never while it runs**, so a scope whose first check
fails still costs its longest unit before saying so; what that buys is one mechanism for both
levels, the alternative being a second per-unit join living beside the pool, and a green run — the
common one — costs the same either way. **The pool ends its units rather than outliving them**
(`scripts/gate/gate_pool.py :: terminate`), down to the build a unit was waiting on. **None of that
is installed off POSIX** (`scripts/gate/gate_pool.py :: arm`), so on Windows a run under way is
only ever waited out, and an interrupt there leaves the builds running.

**`next typegen` goes first and alone** because it writes the route types under
`fl_frontend/.next/types/` and `fl_frontend/next-env.d.ts` that `tsc` reads: without them a
checkout that has never built type-checks a smaller program than a development machine does. The
two phases are data (`scripts/gate/verify.sh :: FRONTEND_POOL`, `:: FRONTEND_WRITERS`) and a unit
in both is refused. Prettier is in neither: the format section runs it in place, before the
frontend's opens.

**The eslint step is cached and deliberately not threaded.** The two levers compose, so the choice
is the clock's and not the source's: threading buys the cold fill and costs the warm run, which
eslint measures itself — a warm threaded run emits `ESLintPoorConcurrencyWarning`, whose advice is
to disable concurrency. A development machine mostly pays the warm run, so the step takes it and
gives up the cold arm, which a fresh worktree and a CI job each pay once. **What makes the cached
verdict honest is `fl_frontend/eslint.config.mjs :: crossFileDigest`**, which hashes the inputs
deciding a verdict from outside eslint's own key into `settings`; **nothing restores that cache in
CI**, which is the bound on the digest rather than an omission — a cross-file input it has not
grown to cover costs a false green on a development machine rather than a merged one. The
measurements behind the trade are in the body of the commit that added
`fl_frontend/eslint.config.mjs :: filesUnder`.

**No formatter the gate runs writes a tracked file** — prettier runs in check mode everywhere, so a
run cannot hand back a tree different from the one its later steps measured. Formatting happens at
commit time instead: `.githooks/pre-commit` formats what is staged and re-stages it, and refuses a
file staged in part. The hook is convenience and never the enforcement — a clone that has not
pointed `core.hooksPath` at it has no hook at all, and this scope and CI are what bind. The
formatter's own cache is keyed on content, and what it cannot see is a prettier plugin's own
change, so a plugin bump warrants deleting that cache file — prettier's documented caveat, accepted
because a plugin moves only through the lockfile and CI runs uncached either way. **What the cache
spares is the parse and never the walk**: prettier reads every file under a directory argument
before it consults the cache, so `.prettierignore` sets this scope's floor, and a tool cache that
file does not name is read on every run.

**An editor formats earlier still, and binds no more than the hook does**: `.vscode/settings.json`
names the module, the configuration and the ignore file the gate itself reads, and a developer
without the extension is held by this scope and CI alone. `.editorconfig` carries the same
conventions to the files prettier never opens and stays clear of every setting `.prettierrc.json`
decides.

**Every untracked file a run writes is gitignored where it lands**, the three caches this repository
opts into — `tsc`'s, eslint's and prettier's — among them, so none of it is a tracked file the gate
wrote. **Outside
CI the two Next commands install as well as write**: handed a missing `typescript` or `@types/*`
package, `next typegen` and `next build` add it to `node_modules` rather than failing, where a
runner takes the refusing branch, keyed off Next's own `isCI`.

**One tracked file a gate run writes is not a formatter's doing**: `next typegen` and `next build`
each rewrite `fl_frontend/tsconfig.json` where a `compilerOptions` key is absent (Next's
`writeConfigurationDefaults`), so every reader after typegen measures a config the committed file
does not hold; the frontend job in `.github/workflows/verify.yml` diffs that one path after the
scope and fails on it.

**The conflict-marker check reads every tracked file and exempts no path**: each of its rules
wants its marker at the start of a line, so a document quoting one in backticks or mid-sentence
is never a finding, while a fenced block reproducing a conflict as git writes it is one
(`scripts/checks/check_conflict_markers.py`).

**The estate check refuses three silences the backend suite would otherwise pass**
(`scripts/checks/check_test_estate.py`): a test whose transitive reach — through a helper it calls
or a fixture it takes — needs a server and carries no `@pytest.mark.db`, so it runs in the default
tier that starts no container; a fixture no test and no other fixture consumes; and a pytest
configuration leaving `empty_parameter_set_mark` at its default, where a parametrised sweep whose
discovery found nothing passes as one skip. **The database rule exempts a client built from a URI
written into the module**, which is a server nothing here starts — the idiom that tells a guard's
refusal from a route that does not exist — and that exemption follows the constant into a helper it
is passed to, so it releases the call site rather than the helper.

CI runs the same checks as parallel jobs mapped from the paths a pull request touches:
`scripts/gate/scope_map.sh` emits one `name=true|false` line per `verify.sh` flag, so a scope's name in
the mapping and the flag that proves it are one word. Which paths select `format` is decided by
extension, because prettier's reach is, and CI's `format` job stands down where the frontend job
runs, which already covers it. **The `frontend` job maps its own scope** in its first step rather
than waiting on `changes`, so the run's longest job starts with no job in front of it; the argument,
and why a job mapped off reads as `skipped`, is at that job in `.github/workflows/verify.yml`.

**Every CI job that needs the backend virtualenv creates it with `uv sync --locked`**, the dev group
alone where nothing imports the application, on the uv `fl_backend/pyproject.toml` pins through
`version-file`; each flag's argument is at the `commits` job in `.github/workflows/verify.yml`.

| Scope        | Runs                                                                                                                                                                                                                      | Needs                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scripts`  | `selfcheck.sh`, `ruff` and `pyright` over the python in `scripts/`, and the pytest suite in `scripts/tests/` (§1.5)                                                                                                       | the backend venv, `pytest` included; shellcheck and actionlint from PATH, else Docker                                                        |
| `--docs`     | `check_conflict_markers.py` over every tracked file; `check_docs.py`; `check_commits.py`; and `fl_backend/tests/openapi_document.py` in `--check` mode, the published document against the docstrings it is composed from | the backend venv                                                                                                                             |
| `--backend`  | `uv lock --check` alone and first, then `ruff`, `pyright`, `pytest` (default tier) and `check_test_estate.py` started together behind it                                                                                  | the backend venv, and for the lockfile check the uv `fl_backend/pyproject.toml`'s `required-version` names; any other uv refuses at start-up |
| `--format`   | prettier in check mode over the whole repository                                                                                                                                                                          | pnpm install                                                                                                                                 |
| `--frontend` | the frozen lockfile check, `next typegen`, then tsc, eslint and the dependency audit as one pool, then the unit tests, then `next build` alone                                                                            | pnpm install                                                                                                                                 |
| `--ops`      | both compose files parse; the local stack mirrors production; nginx accepts `prod.conf`, and its access line carries no credential                                                                                        | Docker, and an interpreter at the checkers' floor for the mirror                                                                             |
| `--db`       | `pytest -m db -n auto --dist loadfile`, capped at `scripts/gate/verify.sh :: GATE_WIDTH_DB_PYTEST`, against the two real `mongod`s the xdist controller starts (`docs/backend/spec.md` §1.6)                              | venv + Docker                                                                                                                                |
| `--images`   | both `docker build`s, then what a build does not prove: `instrumentation.js` present, neither image running as uid 0, neither holding a file its dockerignore excludes                                                    | Docker                                                                                                                                       |

**Each of the images scope's three probes answers three ways, and the third is a refusal**: an
image that would not run at all is refused at exit 2 rather than graded, as `publish.sh`'s
`instrumentation.js` probe refuses the same answer (§1.5). The context probe and both
`.dockerignore` files hold the same list of credential shapes, and
`scripts/tests/test_image_assertions.py` holds the two to each other.

Docker is checked before any check runs on a run covering the ops, database or image scopes, and
the backend virtualenv on one covering the scripts, documentation, backend or database scopes; the
frontend's `pnpm install` prerequisite is checked nowhere, so a missing one surfaces at the first
step running a tool out of `node_modules`. Each tool is its own step, tool output is captured and
shown only when its step fails, and `--verbose` streams everything instead (§1.7). **Two checkers
are the exception, both because a passing run's output is worth reading**: the self-check, whose
skips and warnings would otherwise read as passes, and the documentation gate, whose printed
population is what says the sweep read the tree rather than an empty collection (§1.5).

**A manifest is compared against its lockfile before anything reads the installed tree** — the
frontend scope resolves the lockfile against `package.json` and the backend scope runs
`uv lock --check`, both cheap, where otherwise the breach surfaced only where discovery is
expensive.

**Before any of them runs, `check_scope.py` compares the scopes named against what the branch
actually changed.** It refuses a run whose diff reaches the image build with a change that is more
than comments, and merely reports every other surface the run leaves unproven. **What counts as
"more than comments" is decided by a parser, and anything unproven counts as code**; two shapes a
parser calls a comment are excluded by name because a tool downstream reads them
(`scripts/checks/check_scope.py :: TOOLCHAIN_DIRECTIVE`, `:: DOCSTRINGS_ARE_PUBLISHED`), and those
two exclusions are pattern matches on comment text where the rest of the decision deliberately is
not. The check is skipped in CI, which maps its own scopes from the paths.

**The scripts scope lints and type-checks its own python**, through configs that sit at the top of
`scripts/` rather than at the repository root or inside one of its five directories: a root config
would become the nearest one for `fl_backend/` too, moving isort's idea of the source root and
overriding the backend's pyright block, while a copy inside `gate/`, `checks/`, `lib/`, `ops/` or
`tests/` would reach that directory alone. `scripts/ruff.toml` `extend`s the backend's configuration
and adds nothing, so the selection stays in one file; `scripts/pyrightconfig.json` pins the python
version rather than letting pyright infer one, which would answer differently per machine.

**A checker resolves `scripts/lib/` for itself**, each entry point inserting it at its own top, and
`pyrightconfig.json`'s `extraPaths` is the second listing of that fact. A `PYTHONPATH` set by the
caller would be the alternative, and it would have to be spelled again in every workflow `run:`
line, every hook and every test.

**Commit messages ride in the docs scope**, the commit bodies being documentation and merges never
squashed precisely so they survive ([`docs/_git/spec.md`](../_git/spec.md) §1.4). In CI the check
can ride nowhere, a commit message having no path to filter on, so `.github/workflows/verify.yml`
gives it a `commits` job of its own that the `verify` aggregate lists among its `needs`, which is
what keeps the required check gating on it.

**The two call sites resolve the base differently, and the difference is safe in one direction
only.** CI passes `--base origin/<the pull request's base>`; the gate passes nothing and takes
`scripts/lib/checker_kernel.py :: DEFAULT_BASE`, which is `main`. They agree for a pull request into
`main`, which is every pull request here — `main` is the only long-lived branch
([`docs/_git/spec.md`](../_git/spec.md) §1.2). Where a branch is stacked on another and merges into
it, the default reads from `main` instead and so covers the commits below the fork as well: a
superset, already checked when the branch beneath was, so the local run is stricter than CI rather
than blinder.

**The `changes` job writes a line-delta glance** into its run summary on every pull request. It
decides nothing and can shrink no scope.

The **ops** scope exists because the compose files have no compiler and no test suite, and the
nginx config has no compiler — without it, a typo in either surfaces on the server, at deploy
time. What the nginx half does have is `nginx/redaction_test.sh`, which drives a real request
through a real edge and reads the access line back (`docs/logging/spec.md` L11).

**The scope also holds the local stack to production's shape.** The differences meant to be there
are the local file's declared list, restated as data in `scripts/checks/check_compose_mirror.py` so
the claim is testable, and a declared delta matching no real difference is a finding too: the list
stays honest in both directions. A compose construct outside the reader's parsed subset is a
refusal rather than a verdict (§1.7). **A declared delta covering a whole service covers its ports
with it**, which is why I1 is held by a check of its own over both files rather than by that list.

**One path reaches across the boundary on purpose**: `fl_backend/openapi.json` selects the
**frontend** scope alongside the backend ones, because the frontend scope holds the Zod-mirror
comparison — without this arm (in `scripts/gate/scope_map.sh`) a Pydantic model change would never run
the check that exists to catch it.

**In CI the images scope caches layers through the Actions cache service**
(`VERIFY_IMAGES_CACHE=gha`), and **stops before building where the variable is set and the
credential `.github/actions/actions-runtime-env` re-exports is missing** — buildx would fail too,
but only after every layer has been built, naming a missing token rather than the missing step.
Locally the variable is unset and the build runs against the daemon's own cache.

**The aggregate `verify` job writes a wall-clock report** into its run summary on every push to
main: per-job medians over the completed main runs already on record, against
[`.github/gate-wall-clock.tsv`](../../.github/gate-wall-clock.tsv), which holds one reference figure
and one floor per job. Main pushes are the only comparable population — they alone run every scope,
where a pull request's jobs are path-filtered. How a median is taken, and which jobs the report
leaves out of one, are at that job in `.github/workflows/verify.yml`.

**The reference is carried forward, never recomputed from the recent past.** A report comparing a
window against the window before it ratchets: each window silently becomes the next one's normal, so
the accumulated growth is several times anything a single report can display, and a slowdown large
enough to matter is reported as a fraction of itself. The table is a fixed reference updated by hand,
so growth against it accumulates in the number rather than in the baseline.

**A row appears only where that job's median has moved past that job's own floor**, and a report with
nothing past a floor says so in one line. The floors are per job because one figure is wrong for most
of them: measured by resampling whole runs, a 12-run median moves 8% on `docs` at p95, 10% on
`frontend` and 22% on `backend-db`, so a single global figure dismisses a real move on the quiet
jobs and cries wolf on the noisy ones. Each floor in the table is that job's own p95, so a delta under it is a reshuffle.

**The report decides nothing** — no threshold in it refuses anything and pull requests skip it, so
the seconds it costs land where no merge is waiting; the budget below is where a figure refuses.
What the report cannot see it names itself rather than leaving to be assumed, and which jobs it
counts apart from the ones it measures are at that job in `.github/workflows/verify.yml`.

**Every job has a wall-clock budget, and the aggregate job refuses the run that breaks one.** The
same table carries two more columns: `budget`, the most a single run of the job may span from its
first step to its last, and `measured`, the completed runs the row was taken over, as
`<runs>@<date>`. After the scope verdict and on every event, `scripts/checks/check_gate_budget.py` under
`--jobs` reads this run's own jobs from the runs API and fails the required check on a job over its budget,
naming the job and both figures; on a job that ran with no row, so a check added to the gate arrives
with its measured cost or goes red; and on a successful job the API carries no step timestamp for,
a length nothing measured being no pass. A single run swings far wider than a median — inside the 24
main runs the budgets were set from, `backend-db` reached 1.6 times its median and `ops` 2.3 times —
so each budget is the population's highest single-run span plus a quarter of it or ten seconds,
whichever is more, rounded up to the next five, a rule the table's header records. **One exceedance
fails**: the ceiling sits above every run in the population it was set from, so a run over it is a
re-run or a regression, and the re-run is the repeat measurement at the cost of a click rather than
a commit. Two decisions sit beside the measurements. `images` is measured and not budgeted, its span
being the layer cache's before it is the tree's — a cold cache costs five times the median, and the
Dockerfile change most worth catching is the one that empties it — so the median report is its only
guard. `commits` and `format` run on pull requests alone, so their rows are measured from
pull-request runs and carry `-` where the report, cut from main runs, would read a reference.
**Raising a budget or a reference costs a measurement.** In the `commits` job,
`scripts/checks/check_gate_budget.py` under `--base` holds the file against the pull request's base and refuses a
figure that rose on an unchanged stamp, a stamp dated after today or before the one it replaces, or a
budget dropped to `-`; lowering is free, and so is deleting the row of a job the gate no longer
runs. What the ceiling cannot see is a slowdown that stays under it — a check costing seconds on a
job with a minute of headroom — which the median report names after the fact and the `gate` clause
in [`.claude/rules/ops.md`](../../.claude/rules/ops.md) forbids before it; the ceiling, the report
and the clause are one mechanism's three parts, and `scripts/tests/test_check_gate_budget.py`
drives the committed table red and green against its own budgets so the file can never become one
the check reads but cannot fail on.

**The documentation gate** (`scripts/checks/check_docs.py`) reads `/docs`, the source comments
beside the code and the configuration files scanned with them, and its byte-level checks read every
tracked text file — so a finding this scope raises need not be about a document at all. Its checks
are registered in `scripts/checks/docs_gate/kernel.py :: CHECKS` and nowhere else.

**Two of its checks read code rather than prose** (`scripts/checks/docs_gate/platform.py`), and I15 and
I16 are what they hold. `platform-branch` holds four clauses. PLAT-1: a Python read of the platform
is a module-level UPPER_CASE `Final`, or an allowlist row. PLAT-2: no test under
`scripts/checks/docs_gate/platform.py :: TEST_SCOPES` skips, returns early or exits on the platform. PLAT-3:
every admitted constant is bound to both values somewhere in that same test corpus. PLAT-4: a
platform word in the _code_ of a shell script under `scripts/checks/docs_gate/platform.py :: SHELL_SCOPES`
or `.githooks/` is an allowlist row, where the same word in a comment is not one. The allowlist is
`scripts/checks/docs_gate/platform.py :: PLATFORM_ALLOW`, keyed by a COR-6 anchor with the reason beside
it, and a row the tree no longer bears out is itself a finding. **The honest limit**: a
platform-conditional _branch_ can be made visible statically, a platform-conditional _effect_
cannot, and only this gate's Linux run in CI proves one. `crlf-write` holds
[`../../.claude/CLAUDE.md`](../../.claude/CLAUDE.md) §6's first trap over the Python that
`scripts/checks/docs_gate/platform.py :: PYTHON_SCOPES` names: a text-mode writer passes `newline=""` or
`"\n"`, or is a row of `scripts/checks/docs_gate/platform.py :: TEXT_WRITE_ALLOW` with its reason. A
redirect of a program's stdout leaves no call in the source to read, so that half of the trap stays
with the reader.

**The backend steps** exist because the frontend's toolchain runs nothing against `fl_backend`
([`docs/backend/spec.md`](../backend/spec.md) §1.6); `pyright` is separate from `ruff` because ruff
checks no types. **Both test tiers run**: the `db`-marked tests need a real `mongod`, so they are
their own scope behind `require_docker` — which is what lets `--quick` skip them — and in CI the
concurrent `backend-db` job, which pulls the tier's `mongod` image in an advisory step of its own
before pytest, so the download is attributed in the log rather than hidden inside the test span.
**The image scope** exists because code that compiles can still fail to build inside the image, or
be omitted from the standalone output entirely.

`--quick` is the scopes that need no Docker — scripts, docs, backend, format and frontend — and is
**not sufficient** before a merge touching a packaging path: `scripts/gate/scope_map.sh` holds the list,
and CI builds both images on any pull request touching one. An audit remediation wave runs the full
form regardless of what it touched, unless it changed documentation only.

### 1.7 Script conventions

All scripts source `scripts/lib/_lib.sh`, which applies strict mode and installs the error and
interrupt traps, and which carries the guards, `wait_healthy` and the output verbs below. Two
things a caller may rely on across every one of them: a script resolves the repository root itself,
so it behaves the same from any working directory, and arguments are parsed before any
environmental check, so a typo fails instantly rather than after a Docker probe.

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

The checkers answer on the same scale: `scripts/lib/checker_kernel.py` fixes 0 for a pass, 1 for findings,
2 for a check that could not judge its input and 3 or more for a broken environment, in one place, so
a step reading a checker's status has one meaning to route rather than a private convention per
checker.

A run closes with one row per section and then the statement for whichever ending it reached, and a
section that closed with no verdict at all is recorded as a finding rather than passed over. **A
scope the run announced and then never opened takes a row of its own, reading `unreached` over two
dashes** (`scripts/lib/_lib.sh :: _find_unreached`). It is neither a scope nobody selected, which
the not-run line names, nor one that reached a verdict, which a rank would say — and an ending
reached partway through a run would otherwise leave it named nowhere at all, having been announced
as covered. The row is reporting alone: the finding, refusal or crash that stopped the run short of
the scope is what the exit code still answers for. **Colour is decided centrally, through
`FL_GATE_COLOR` ahead of everything else** — the gate's own variable, how a parent hands a worker
its answer without exporting one every tool would take as an instruction.

**A CONTAINER's own log passes through one filter more before any of those verbs.**
`scripts/lib/_lib.sh :: redact_uri_credentials` replaces the userinfo in every `mongodb://` and
`mongodb+srv://` URI on the line and leaves the host, port and options standing: a driver quotes the
configured connection string back in precisely the failures `wait_healthy` greps a failing service's
log for, and a truncated host is what the tc3c-nudr incident was diagnosed from.
`scripts/gate/selfcheck.sh :: redact_case` pins both directions against fixtures.

**What still gets through is recorded as accepted in [`docs/logging/spec.md`](../logging/spec.md)
section 4**: a credential arriving with no URI around it, which no filter of this shape reaches, and
a URI carrying **no** userinfo that shares its line with a later `@`, whose host is replaced
although nothing on the line was secret. That last one is the fail-safe half of the trade — bounding
the match to spare it is what lets a real credential through.

**Every script a person reads accepts `--verbose`**, which streams each tool's own output instead of
capturing it — the one thing a captured run cannot give back afterwards.

**A script whose output only a machine reads is exempt, and the interface is what decides, never the
folder.** `scripts/gate/scope_map.sh` writes `$GITHUB_OUTPUT`'s `key=value` lines and the assistant hooks
answer with a JSON verdict, so a heading, a fold marker or a colour code in either is a corrupt answer
rather than a nicer log. `scope_map.sh` is accordingly the one script with no `--verbose`, and puts
its human-readable line on stderr, where it cannot reach the outputs.

## 2. Invariants

| #    | Invariant                                                                                                                                                                     | Enforced by                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1   | Only nginx publishes a port another host can reach — the local database's is bound to `127.0.0.1`                                                                             | `scripts/checks/check_compose_mirror.py :: off_host_ports`, over both files                                                                                                                        |
| I2   | Security headers are repeated in every `location` that sets any header                                                                                                        | `nginx/prod.conf :: location /_next/static/` and `:: location = /api/v0/system/is_live`, each restating the set its own `add_header` replaced; both observed carrying the full set, 2026-08-30     |
| I3   | A `default_server` block rejects unknown hosts                                                                                                                                | `ssl_reject_handshake on`                                                                                                                                                                          |
| I4   | Sign-in rate limiting applies to POST only                                                                                                                                    | the `map` producing an empty key otherwise                                                                                                                                                         |
| I5   | The builder stage has no reachable backend or real env                                                                                                                        | `SKIP_ENV_VALIDATION=true`, placeholder `MONGODB_URI`, no `API_URL`                                                                                                                                |
| I6   | Production never builds                                                                                                                                                       | `deploy.sh` only pulls                                                                                                                                                                             |
| I7   | Both images build before either is pushed                                                                                                                                     | `publish.sh`; and `deploy.sh`, which compares the pulled `:latest` builds' `version` labels before recreating anything, warning rather than failing where an image carries none                    |
| I8   | Publishing stops on a dirty tree by default                                                                                                                                   | `publish.sh`, whose `--allow-dirty` escape suffixes the tag `-dirty` and a fingerprint of the tree (`scripts/ops/publish.sh :: DIRTY_ID`)                                                          |
| I9   | Deploy recreates the application containers in place, leaving nginx running and reloading it                                                                                  | `deploy.sh`                                                                                                                                                                                        |
| I10  | Scripts use LF line endings and carry the git executable bit                                                                                                                  | `selfcheck.sh` (its LF and executable-bit checks)                                                                                                                                                  |
| I11  | The three API keys are 64 characters and match on both sides                                                                                                                  | `fl_frontend/src/core/config.ts` alone (`length(64)`); the backend requires presence only                                                                                                          |
| I12  | Publishing stops on a commit no remote holds — any remote branch clears the bar, not only an ancestor of `main`                                                               | `publish.sh`, whose preflight requires HEAD to be an ancestor of a branch tip a remote answered for, `--dry-run` included (§1.5)                                                                   |
| I13  | Exactly one backend endpoint is reachable from the edge — `= /api/v0/system/is_live`, exact-match so nothing joins it, restating the whole `proxy_set_header` set (§1.3)      | unenforced — `nginx -t` reads no location it parses (§1.6), nothing compares `nginx/local.conf` against production's (§4, db2a-9qu3), and no test requests a backend path                          |
| I14  | Every `limit_req` zone is PAIRED, one narrow key and one wide, the wide at a multiple of the narrow's rate and burst (§1.3)                                                   | `nginx/prod.conf`'s paired zones, each declared inside every limited location (§1.3); unenforced by the gate, as I13 is                                                                            |
| I15  | Every platform-conditional branch `scripts/checks/docs_gate/platform.py` reaches is a named module constant or an allowlist row carrying its reason (§1.6, PLAT-1 to PLAT-4)  | gate check `platform-branch`, over `scripts/checks/docs_gate/platform.py :: PLATFORM_ALLOW`; the effect a branch selects is proven by the `verify` workflow's Linux run alone                      |
| I16  | No Python in `scripts/checks/docs_gate/platform.py :: PYTHON_SCOPES` opens a text-mode writer without `newline=""`, so nothing it writes carries CRLF to a Linux shell (§1.6) | gate check `crlf-write`, over `scripts/checks/docs_gate/platform.py :: TEXT_WRITE_ALLOW`; a shell redirect of a program's stdout carries no call to read and stays the reader's                    |
| I17  | No `verify` job spans longer than its budget in `.github/gate-wall-clock.tsv`, no job runs without a row, and no figure rises unmeasured (§1.6)                               | `scripts/checks/check_gate_budget.py`, `--jobs` in the aggregate `verify` job and `--base` in `commits`; `scripts/tests/test_check_gate_budget.py` drives the committed table red and green (§1.6) |
| I18  | A rate-limit key is the visitor's own network, never the Cloudflare edge, and no prefix splits across two keys (§1.3)                                                         | `nginx/prod.conf :: map $remote_addr $client_net`, `:: map $remote_addr $client_net48`, `:: set_real_ip_from` and `:: real_ip_header`; unenforced by the gate, on §1.3's one-off measurement alone |
| I133 | The catch-all makes a Next route handler reachable the moment it exists, its OWN authorization the only guard in front of it (§1.3)                                           | unenforced — `nginx/prod.conf :: location /` is a prefix matching everything, and nothing sweeps a new route handler for its guard                                                                 |
| I134 | FastAPI's `/docs`, `/redoc` and `/openapi.json` are served by the app but reachable from no edge route, so nothing off this host meets them (I13)                             | unenforced — `fl_backend/app/main.py :: create_app` sets no `docs_url`, `nginx/prod.conf` names no `/docs` location, and nothing checks either                                                     |

## 3. Violation → remedy

| Symptom                                                                           | Cause                                                                                                                                           | Remedy                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not a directory` from nginx                                                      | A mounted config file was missing, so Docker created a directory                                                                                | `git pull`, remove the stray directory                                                                                                                                                                               |
| `Invalid environment variables: <NAMES>` then no traffic                          | Startup environment gate                                                                                                                        | Fix those names in the relevant `.env`                                                                                                                                                                               |
| Deploy reports healthy but the site is unreachable                                | nginx                                                                                                                                           | prod: `docker compose logs nginx`                                                                                                                                                                                    |
| `failed to connect to the docker API at npipe:...`                                | Docker Desktop is not running                                                                                                                   | Start it and wait for it to settle                                                                                                                                                                                   |
| Deploy stops in preflight naming the Docker Engine version                        | The host's engine is below what the compose files' `start_interval` needs                                                                       | Nothing was stopped or pulled. Upgrade the engine, or drop `start_interval` from both compose files (§1.5)                                                                                                           |
| `./scripts/ops/deploy.sh --status` exits 1 naming two different builds            | A publish moved one package's `:latest` and failed on the other, so this host pulled a pair no build names                                      | Deploy the build both packages have: `./scripts/ops/deploy.sh <tag>`, the tag the report names                                                                                                                       |
| `./scripts/ops/deploy.sh --status` exits 1 over a pair it has just called healthy | The edge is not serving them — nginx resolved its upstreams as it loaded, and nothing has re-resolved them since those containers were replaced | Reload the edge, then re-run `--status`; the report's own detail line names the command (`scripts/ops/deploy.sh :: serve_through_nginx`)                                                                             |
| `./scripts/ops/publish.sh` refuses, naming a remote it could not ask              | The remote did not answer `git ls-remote --heads`, so nothing establishes that this commit is fetchable                                         | Nothing was built or pushed. Restore the network or the credentials and re-run (I12)                                                                                                                                 |
| `EBUSY`, or `.next` locked during a build                                         | A `pnpm dev` is still running, or the folder is open in an editor                                                                               | Stop the dev server; nothing else may hold port 3000 while the local stack runs                                                                                                                                      |
| `./scripts/ops/local.sh` reports `mongo` unhealthy                                | The local database has not elected itself primary, so no transaction opens and no validator applies                                             | `docker compose -f docker-compose.local.yml logs mongo`; the script waits on `mongo` by name, so this reports as itself                                                                                              |
| `./scripts/ops/local.sh --seed` dies during the copy from production              | The production tier throttles past its operations-per-second cap, and anything else querying the cluster shares that budget                     | Nothing was written to the local database. Re-run with nothing else talking to production; the dump already takes one collection at a time (§1.5)                                                                    |
| The local stack's data disagrees with production, in either direction             | Working as intended — `--seed` reuses the copy already on disk however old it is                                                                | `./scripts/ops/local.sh --refresh-db` takes a fresh one (§1.5)                                                                                                                                                       |
| A db-tier run reports a wall of failures naming validators and unique indexes     | Another `pytest -m db` was running beside it; the mechanism is unestablished                                                                    | Trust neither verdict, the green one included. Re-run with nothing else running, and take any db-tier measurement alone (`docs/_roadmap/items.md :: eg48-8863`)                                                      |
| Container unhealthy, health log empty, `FailingStreak: 0`                         | The app died before the first probe                                                                                                             | Usually a malformed `.env` value restored by hand. Read `docker compose logs <service>` on the server                                                                                                                |
| A directory appeared named `something;C`                                          | MSYS rewrote a POSIX-looking path in a hand-typed `docker run -v`                                                                               | Delete it, and prefix the command with `MSYS_NO_PATHCONV=1`                                                                                                                                                          |
| `UnicodeEncodeError: 'charmap' codec` from `fastapi dev`                          | Windows only, when the output is piped or redirected                                                                                            | The CLI banner needs UTF-8. Prefix the command with `PYTHONUTF8=1`                                                                                                                                                   |
| Static assets served without security headers                                     | A `location` block set a header and dropped the inherited set                                                                                   | I2 — repeat every header in that block                                                                                                                                                                               |
| Backend healthcheck fails after an API version bump                               | The healthcheck spells the API version itself                                                                                                   | Move the path in both compose files, and in both nginx configs with them (§4)                                                                                                                                        |
| The uptime monitor 404s while the backend container reports healthy               | The nginx liveness location still spells the old version, so the probe matches `location /` and Next answers it                                 | Move the path in both nginx configs, then re-point the monitor at the apex host with no trailing slash (§4)                                                                                                          |
| Sign-in returns 429                                                               | Working as intended — the sign-in POST is rate-limited at the edge                                                                              | Nothing. The limit is `nginx/prod.conf`'s `signin` zone, and it applies to POST alone (I4)                                                                                                                           |
| Uptime monitor shows green during a backend outage                                | The error page streams after headers, so the edge status is 200                                                                                 | Monitor `GET https://frankfurtleague.de/api/v0/system/is_live` at the apex host: a trailing slash redirects and reads green, a `HEAD` is answered 405 (`fl_backend/app/api/system/router.py :: check_is_live`, §1.3) |
| Application container logs are empty right after a deploy                         | Working as intended — `json-file` logs live in the container, and the deploy replaces both application containers; nginx keeps its own          | Nothing. Copy them off before deploying ([`docs/logging/spec.md`](../logging/spec.md))                                                                                                                               |
| Reference data stale for up to a day                                              | Working as intended — an out-of-band MongoDB edit invalidates nothing                                                                           | Nothing. The bound is the cache lifetime: wait for the daily expiry, or recreate the frontend container                                                                                                              |
| League table or fixtures stale after a season edit                                | Same cause — a season decides the default season and the points                                                                                 | Same remedy, and the backend's own season cache expires separately ([`docs/backend/spec.md`](../backend/spec.md) I131); recreation drops every cached page at once                                                   |
| The `verify` check is red naming a job, its seconds and a budget                  | The job spanned longer than its ceiling in `.github/gate-wall-clock.tsv` — a cost the change added, or a slow runner (§1.6)                     | Re-run first, then take the cost out rather than raise the figure; a right raise stamps the row with its measuring runs (§1.6)                                                                                       |
| The `commits` job is red naming a row that rose on an unchanged stamp             | A budget or a reference in `.github/gate-wall-clock.tsv` was raised by editing the number alone (§1.6)                                          | Measure on CI's own runs, never a development machine, and write the count and the newest run's day into the row's `measured` column (§1.6)                                                                          |

## 4. Known-open

| Item                                                                | State                                                                                                                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The API version is spelled in tracked files outside the code        | Open — the backend healthcheck in each compose file, the liveness location in each nginx config, and `scripts/ops/deploy.sh :: PROBE_URL`; §3 carries each symptom                                 |
| The frontend's `API_VERSION` is deployed rather than committed      | Open — `fl_frontend/src/core/config.ts :: frontend_config` reads a per-environment value no commit carries, so a stale one sends every fetch to `location /` (I13)                                 |
| A rollback moves nothing in the registry                            | Accepted — `scripts/ops/deploy.sh :: roll_back` re-tags this host's local `:latest` and reaches no registry, so a re-deploy pulls the failed build back ([`runbooks.md`](runbooks.md) §1)          |
| Registry tag pruning is manual                                      | Accepted — a botched delete destroys rollback history. The retention procedure is in §1.5                                                                                                          |
| Revoking admin access needs a restart                               | Accepted — the allowlist is validated at boot; after it, `role` is re-derived per request and the session dies                                                                                     |
| `nginx` drops no capabilities                                       | Open — the two application services carry `cap_drop: ALL` and `no-new-privileges:true` and `nginx` carries neither, and the asymmetry is undecided                                                 |
| Certificate renewal is outside this repository                      | Accepted — they are mounted from `./certs`, and nothing here issues or rotates them                                                                                                                |
| The local database runs unauthenticated                             | Accepted — authentication on `--replSet` wants a keyfile whose permissions `mongod` checks, which a Windows host does not reliably give it (`fl_backend/tests/conftest.py :: _replica_set_mongod`) |
| The local database holds real contact records                       | Accepted — it holds a copy, and I1 keeps it off every interface but this host's; `--fresh` removes the volume and the `.local-db/` copy                                                            |
| INC-9 measures none of a renamed file's comment blocks              | Open — `scripts/checks/docs_gate/branch.py :: check_comment_length` reads every block the branch added a line to, and a rename's carried lines arrive as context                                   |
| No gate scope COMPARES `nginx/local.conf` against production's      | Open — its header claims production's routing and headers, and nothing compares the pair. The parse half is closed: `nginx/redaction_test.sh` serves `local.conf` itself (§1.6)                    |
| A guard the database tier stays green without                       | Open — dropping the `session=` argument in `fl_backend/app/api/saisons/admin_router.py` reportedly leaves `--db` (§1.6) green, so that scope is not what holds it                                  |
| The linter behind §1.4's compensating control is past end of life   | Open — `fl_frontend/package.json` holds eslint at a line taking no further fix, and both §1.4's `react/no-danger` control and `--frontend`'s lint step run on it                                   |
| A call site's key tier is held to its route by nothing              | Open — omitting `fl_frontend/src/core/api.ts :: apiClient`'s tier is loud, but over-declaring one succeeds identically, and `fl_backend/openapi.json` flattens every tier to one scheme            |
| Real-IP recovery can fall back on a range published after the fetch | Open — that route falls back OUTSIDE both hand-kept copies, so `realip_fallback` does not mark it and shared keying returns silently (§1.3)                                                        |
| The origin trusts every source inside Cloudflare's ranges           | Open — `nginx/prod.conf :: set_real_ip_from` trusts every Cloudflare customer's egress, so any of them sets §1.3's rate-limit key, and nothing stands in front (2pqm-yxyu)                         |
