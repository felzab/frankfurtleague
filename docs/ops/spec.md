# Ops — spec

**Verified against:** `3ab1688`, 2026-08-10\
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
| [2. Invariants](#2-invariants)                         | The rules that must hold, and how each one breaks                    |
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

**Note:** the backend healthcheck hardcodes `/api/v0/...`, and `API_VERSION` is a constant of the code
rather than a setting ([`docs/backend/spec.md`](../backend/spec.md) §1.5). Bumping it is a code change,
made in the same commit as this healthcheck — §4 carries the gap that leaves.

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

| Location              | Upstream        | Notes                                                                                                                      |
| --------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`           | `frontend:3000` | Auth.js — more specific than `/api`, so it wins                                                                            |
| `= /api/client-error` | `frontend:3000` | Next route handler, `limit_req zone=clienterr` ([`docs/logging/spec.md`](../logging/spec.md))                              |
| `/api/admin/`         | `frontend:3000` | The page-owned editors' undo handlers ([ADR-0049](../_decisions/0049-every-page-owned-editors-undo-is-a-route-handler.md)) |
| `/api`                | `backend:8000`  | Everything else API                                                                                                        |
| `= /signin`           | `frontend:3000` | `limit_req zone=signin burst=3 nodelay`                                                                                    |
| `/_next/static/`      | `frontend:3000` | `expires max`, `Cache-Control: public, max-age=31536000, immutable`                                                        |
| `/`                   | `frontend:3000` | Catch-all                                                                                                                  |

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

Proxy headers set globally: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`,
`X-Forwarded-Host`, `X-Forwarded-Port`, HTTP/1.1 — plus `X-Correlation-ID`, minted from
`$request_id` unconditionally so a client-supplied id never reaches a log
([`docs/logging/spec.md`](../logging/spec.md), ADR-0032). Every SERVING block writes the `fl_json` access
format, which carries the id, `$request_time` and `$upstream_response_time`.

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
prerendered HTML. The compensating control is the `react/no-danger` ESLint rule, which closes the only realistic injection
entry point in the codebase.

### 1.5 The scripts

`scripts/README.md` navigates the folder; each script's own header carries its usage and prints it
with `--help`. What spans the scripts lives here.

| Environment | What it is                                            | Entry point                                                                      |
| ----------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| **dev**     | source with hot reload, no Docker                     | `pnpm dev` in `fl_frontend/` · `uv run fastapi dev app/asgi.py` in `fl_backend/` |
| **local**   | the production image built from your tree, with nginx | `./scripts/local.sh`                                                             |
| **prod**    | published images on the server, never builds          | `./scripts/deploy.sh`                                                            |

**local** is the only place a packaging problem — a missing standalone file, a failing startup env
gate, a header nginx does not set — is visible before a deploy: **dev** exercises none of that
machinery, and **prod** only pulls (I6). Machine-specific scripts refuse to start on the wrong
platform.

**`scripts/ci_scopes.sh` is the one copy of the path-to-scope mapping.** Both CI workflows read it, and
so does `scripts/check_scope.py` through its `--stdin` mode, which asks the same mapping about a file
list the caller has already filtered rather than one computed from a diff. Every other statement of
which paths select which scope — including the packaging list — cites that file rather than repeating
it.

The checkers are python rather than shell, and one of them never runs in the gate: `check_docs.py`,
`check_commits.py` and `check_scope.py` are steps of `verify.sh`, while **`check_pr_body.py` runs only
in CI** — a pull request body is not in the repository and does not exist when the gate runs, so
`.github/workflows/pr-body.yml` is the only place it is addressable. One helper is javascript for a
reason: `scripts/ts_normalize.mjs` decides whether two versions of a TypeScript file differ by anything
but comments, and only TypeScript's own parser knows that a `//` inside a string is not a comment.

**`scripts/selfcheck.sh` tests the scripts themselves**, and `verify.sh` runs it first. Reach for it
directly after editing anything in `scripts/` — or in `.claude/hooks/`, whose shell scripts its syntax,
line-ending and shellcheck passes cover too, and whose branch and compose guards it probes against a
throwaway repository while probing the rules-index hook against this one. `bash -n` validates syntax
only — a script can call a helper that does not exist and still parse — so the passes around it are
what catch the rest, the defects Windows hides among them: CRLF endings, and an executable bit that
`chmod +x` in Git Bash never reaches, either of which works locally and fails on the server (I10). It
also drives `check_scope.py`'s comment-only classifier over fixtures in both directions, because that
is the one gate decision whose wrong answer is silent.

**That classifier's TypeScript half needs the frontend's `typescript`, and the scope does not require
it.** `--scripts` stays runnable on a clone that has never run `pnpm install`: where `typescript` does
not resolve, the classifier is required to answer "code", and the self-check asserts that degradation
instead of the real answer. CI's `scripts` job installs the frontend dependencies for exactly this
reason — otherwise the half that needs a parser rather than a regex would be exercised on no machine
but the author's.

**Publishing needs a classic token with `write:packages`** (`docker login ghcr.io -u felzab`). A
fine-grained token _appears_ to work — login succeeds — and then the push fails with
`permission_denied: The token provided does not match expected scopes`, because ghcr evaluates package
write permission only at push time and a first push is a _create_ that repository scopes do not cover.
If a previous login stored another token, `docker logout ghcr.io` first. The server needs no token at
all: both packages are public and pull anonymously.

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

### 1.6 The verification gate

`scripts/verify.sh` runs its scopes in cheapest-to-fail order: the script self-check and the
documentation gate are instant, the backend tier (ruff, pyright, pytest) takes seconds, the frontend
(prettier, tsc, eslint, `next build`, unit tests, then the advisory dependency audit) takes minutes, and
the ops checks (both compose files parse, `nginx -t` accepts `prod.conf`), the database test tier and
both image builds — with the check that `instrumentation.js` is present in the frontend image — need
Docker on top. A bare invocation runs everything; scope flags name surfaces and combine.

CI runs the same checks as parallel jobs mapped from the paths a pull request touches, and its scope
vocabulary differs from `verify.sh`'s in two places: `scripts/ci_scopes.sh` emits a `format` scope that
no `verify.sh` flag names — the frontend scope runs prettier itself, so CI's `format` job covers the
paths that change no frontend code — and it emits no `db` scope, the `backend-db` job being gated on
`backend`.

| Scope        | Runs                                                                | Needs            |
| ------------ | ------------------------------------------------------------------- | ---------------- |
| `--scripts`  | `selfcheck.sh`, then `ruff` and `pyright` over `scripts/*.py`       | the backend venv |
| `--docs`     | `check_docs.py` — citations, links, stamps; then `check_commits.py` | the backend venv |
| `--backend`  | `ruff` + `pyright` + `pytest`, default tier                         | the backend venv |
| `--frontend` | prettier (write), tsc, eslint, `next build`, unit tests, audit      | pnpm install     |
| `--ops`      | both compose files parse; nginx accepts `prod.conf`                 | Docker           |
| `--db`       | `pytest -m db` against a real `mongod`                              | venv + Docker    |
| `--images`   | both `docker build`s + the `instrumentation.js` presence check      | Docker           |

Docker and the backend virtualenv are checked before any check runs; the frontend's `pnpm install`
prerequisite is not, so a missing one surfaces at the first frontend step. Each tool is its own step,
tool output is captured and shown only when its step fails, and `--verbose` streams everything instead.

**Before any of them runs, `check_scope.py` compares the scopes named against what the branch actually
changed** ([ADR-0030](../_decisions/0030-the-gate-refuses-an-undersized-scope.md)). It refuses a run
whose diff reaches the image build with a change that is more than comments, and merely reports every
other surface the run leaves unproven. What counts as "more than comments" is decided by a
parser and never by a `#` rule: TypeScript through its own parser, Python through `ast` with docstrings
stripped, TOML through `tomllib`, and everything else — Dockerfiles, YAML, shell — is code, because
that is the safe answer where no parser is available. The classifier suppresses the scope complaints
and adds the documentation and formatter ones; it removes no CI job. The check is skipped in CI, which
maps its own scopes from the paths.

**The scripts scope lints its own python**, and `scripts/ruff.toml` is what makes that possible. Ruff
resolves configuration by walking up from the file it is checking, so `fl_backend/pyproject.toml`
governs `fl_backend/` and nothing else: without a config beside them, the python in `scripts/` resolves
none at all and falls back to ruff's defaults — a different rule set from the one this repository
chose, under which an editor reports findings the gate cannot produce. It `extend`s the backend's
configuration rather than copying it, and adds and overrides nothing, so the selection stays in one
file and the two cannot disagree. **It sits in `scripts/` rather than at the repository root**, because
a root config would also become the nearest one for `fl_backend/`, which moves isort's idea of the
source root: `app` stops resolving as first-party and every import block in the backend is reshuffled.

**Commit messages ride in the docs scope**, which is part of every prescribed scope combination,
because in this repository the commit bodies are documentation and merges are never squashed precisely
so they survive ([`docs/_git/spec.md`](../_git/spec.md) §1.4). The `--ops` scope alone is the one
combination that omits it locally; CI closes that gap by running the check in the always-on `changes`
job, since a commit message has no path to filter on.

The **ops** scope exists because the compose files and the nginx config have no compiler and no test
suite — without it, a typo in either surfaces on the server, at deploy time. `nginx -t` runs against
throwaway self-signed certificates and loopback upstream hosts, because a config test loads both.

**One path selects two scopes on purpose.** `fl_backend/openapi.json` maps to **backend and frontend**
both, because the frontend scope holds the test comparing the Zod mirror against that document — and
everything else under `fl_backend/` selects the backend scope alone, so without this arm a Pydantic
model change would never run the check that exists to catch it
([ADR-0033](../_decisions/0033-the-zod-mirror-is-checked-against-the-published-document.md), and the arm
itself in `scripts/ci_scopes.sh`).

**In CI the images scope caches layers through the Actions cache service**, which
`VERIFY_IMAGES_CACHE=gha` selects
([ADR-0031](../_decisions/0031-the-image-cache-is-the-actions-cache-service.md)). buildx authenticates
to that service with a credential the runner gives to JavaScript actions and never to a `run:` step, so
`.github/actions/actions-runtime-env` re-exports it first. **The scope refuses to build when that
variable is set and the credential is missing** — buildx would fail too, but only after every layer has
been built, and with a message naming a missing token rather than the missing step. Locally the variable
is unset and the build is a plain `docker build` against the daemon's own warm layer cache.

**The documentation gate** (`scripts/check_docs.py`) reads `/docs` and source comments alike, and it is
the one currency defence that does not depend on somebody remembering. Its checks are listed in CUR-5's
table and nowhere else.

**The backend steps** exist because the frontend's toolchain runs nothing against `fl_backend`, so the
constraints the frontend only mirrors would otherwise have no regression net
([`docs/backend/spec.md`](../backend/spec.md) §1.6). `pyright` is separate from `ruff` because ruff
checks no types. All of it needs the backend virtualenv (`cd fl_backend && uv sync --dev`).

**Both test tiers run.** The `db`-marked tests need a real `mongod`, so they are their own scope behind
`require_docker` — which is what lets `--quick` skip them and need no daemon — and in CI they are the
concurrent `backend-db` job, so the coverage costs no extra waiting
([ADR-0023](../_decisions/0023-a-real-mongod-behind-a-deselected-marker.md)).

**The image scope** exists because code that compiles can still fail to build inside the image, or be
omitted from the standalone output entirely.

`--quick` is the scopes that need no Docker — scripts, docs, backend, frontend. It therefore skips
the ops checks as well as the database tier and both image builds, and it is **not sufficient** before
a merge touching a packaging path: those are where packaging problems live, `scripts/ci_scopes.sh`
holds the list, and CI builds both images on any pull request touching one. An audit remediation wave
runs the full form regardless of what it touched, unless it changed documentation only.

### 1.7 Script conventions

All scripts source `scripts/_lib.sh`: strict mode (`set -euo pipefail`, hardened `IFS`), an error trap
naming the script, line and command that failed, guards (`require_platform`, `require_docker`,
`require_file`, `require_dir`), `wait_healthy` for Compose services, and `usage`, which prints the
calling script's own header so `--help` cannot drift from the code. Every script resolves the
repository root itself, so it behaves the same from any working directory; arguments are parsed before
any environmental check, so a typo fails instantly.

**The output standard.** One vocabulary, one verb per meaning, and no script writes formatting of its
own:

| Verb     | Means                                                                          |
| -------- | ------------------------------------------------------------------------------ |
| `step`   | Opens a phase and starts its timer                                             |
| `ok`     | The phase passed — its elapsed time is appended once that is worth reading     |
| `info`   | Neutral detail                                                                 |
| `skip`   | Something was deliberately not run, dim so it can never read as a pass         |
| `warn`   | A problem that does not stop the run, on stderr                                |
| `die`    | A problem that does, on stderr, exiting non-zero                               |
| `detail` | Supporting output belonging to the line above it, from arguments or from stdin |

`info`, `skip`, `warn`, `ok` and `die` funnel through `scripts/_lib.sh :: _emit`, which prints the tag
in a fixed gutter, the message in a single shared column, and every continuation line indented to that
column; `step` and `detail` own their own line shapes. Colour is decided centrally rather than per
script — on for a terminal and inside GitHub Actions, whose log renders ANSI, and off under `NO_COLOR`
or `FORCE_COLOR=0`. `scripts/check_docs.py` prints to the same columns, so the whole gate reads as one
voice.

## 2. Invariants

| #   | Invariant                                                              | Enforced by                                                                               | Breaks how                                                                                                                           |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | Only nginx publishes ports                                             | `docker-compose.yml`                                                                      | Application containers become directly reachable from the host network                                                               |
| I2  | Security headers are repeated in every `location` that sets any header | `/_next/static/` block                                                                    | `add_header` in a location **replaces** the inherited set — the location silently loses HSTS, CSP and the rest                       |
| I3  | A `default_server` block rejects unknown hosts                         | `ssl_reject_handshake on`                                                                 | Any `Host` header reaches Next, forwarded verbatim by the proxy                                                                      |
| I4  | Sign-in rate limiting applies to POST only                             | the `map` producing an empty key otherwise                                                | An empty key is exempt from `limit_req`; without the map, GET `/signin` would be throttled too                                       |
| I5  | The builder stage has no reachable backend or real env                 | `SKIP_ENV_VALIDATION=true`, placeholder `MONGODB_URI`, no `API_URL`                       | Anything fetching the API or parsing `AUTH_URL` at module scope fails the image build                                                |
| I6  | Production never builds                                                | `deploy.sh` only pulls                                                                    | A failed build on the server is an outage                                                                                            |
| I7  | Both images build before either is pushed                              | `publish.sh`                                                                              | Production could pull a frontend whose backend does not exist                                                                        |
| I8  | Publishing refuses a dirty tree by default                             | `publish.sh`, whose `--allow-dirty` escape suffixes the tag `-dirty`                      | A `sha-` tag would name a commit that cannot rebuild the image it points at, so a rollback to it restores a tree no commit describes |
| I9  | Deploy recreates containers in place                                   | `deploy.sh`                                                                               | `down`/`up` turns a seconds-long interruption into a full outage                                                                     |
| I10 | Scripts use LF line endings and carry the git executable bit           | `selfcheck.sh` (its LF and executable-bit checks)                                         | Windows hides both; the script works locally and fails on the server                                                                 |
| I11 | The three API keys are 64 characters and match on both sides           | `fl_frontend/src/core/config.ts` alone (`length(64)`); the backend requires presence only | Every request 401s with `REQ-AUTH-00x`, and a key short on the backend side is refused nowhere                                       |

## 3. Violation → remedy

| Symptom                                                   | Cause                                                                                            | Remedy                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `not a directory` from nginx                              | A mounted config file was missing, so Docker created a directory                                 | `git pull`, remove the stray directory                                                                             |
| `Invalid environment variables: <NAMES>` then no traffic  | Startup environment gate                                                                         | Fix those names in the relevant `.env`                                                                             |
| Deploy reports healthy but the site is unreachable        | nginx                                                                                            | prod: `docker compose logs nginx`                                                                                  |
| `failed to connect to the docker API at npipe:...`        | Docker Desktop is not running                                                                    | Start it and wait for it to settle                                                                                 |
| `EBUSY`, or `.next` locked during a build                 | A `pnpm dev` is still running, or the folder is open in an editor                                | Stop the dev server; nothing else may hold port 3000 while the local stack runs                                    |
| Container unhealthy, health log empty, `FailingStreak: 0` | The app died before the first probe                                                              | Usually a malformed `.env` value restored by hand. Read `docker compose logs <service>` on the server              |
| A directory appeared named `something;C`                  | MSYS rewrote a POSIX-looking path in a hand-typed `docker run -v`                                | Delete it, and prefix the command with `MSYS_NO_PATHCONV=1`                                                        |
| `UnicodeEncodeError: 'charmap' codec` from `fastapi dev`  | Windows only, when the output is piped or redirected                                             | The CLI banner needs UTF-8. Prefix the command with `PYTHONUTF8=1`                                                 |
| Static assets served without security headers             | A `location` block set a header and dropped the inherited set                                    | I2 — repeat every header in that block                                                                             |
| Backend healthcheck fails after an API version bump       | The check hardcodes `/api/v0/`                                                                   | Update the healthcheck path in `docker-compose.yml`                                                                |
| Sign-in returns 429                                       | Working as intended — the sign-in POST is rate-limited at the edge                               | Nothing. The limit is `nginx/prod.conf`'s `signin` zone, and it applies to POST alone (I4)                         |
| Uptime monitor shows green during a backend outage        | The error page streams after headers, so the edge status is 200                                  | Monitor `GET /api/v0/system/is_live` through the edge instead ([`docs/logging/spec.md`](../logging/spec.md))       |
| Container logs are empty right after a deploy             | Working as intended — `json-file` logs live in the container, and `--force-recreate` replaces it | Nothing. Copy them off before deploying ([`docs/logging/spec.md`](../logging/spec.md))                             |
| Reference data stale for up to a day                      | Working as intended — an out-of-band MongoDB edit invalidates nothing                            | Nothing. The bound is the cache lifetime (ADR-0028): wait for the daily expiry, or recreate the frontend container |
| League table or fixtures stale after a season edit        | Same cause — a season decides the default season and the points                                  | Same remedy; recreation drops every cached page at once                                                            |

## 4. Known-open

| #   | Item                                           | State                                                                                                                                       |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Backend healthcheck hardcodes `/api/v0/`       | Open — it works today and breaks silently on an API version bump (§3 carries the symptom)                                                   |
| —   | Registry tag pruning is manual                 | Accepted — a botched delete destroys rollback history. The retention procedure is in §1.5                                                   |
| —   | Revoking admin access needs a restart          | Accepted — the allowlist is validated at boot; after it, `role` is re-derived per request and the session dies                              |
| —   | `nginx` drops no capabilities                  | Open — the two application services carry `cap_drop: ALL` and `no-new-privileges:true` and `nginx` carries neither, with no ADR deciding it |
| —   | Certificate renewal is outside this repository | Accepted — they are mounted from `./certs`, and nothing here issues or rotates them                                                         |
