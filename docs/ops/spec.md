# Ops — spec

**Verified against:** `74b7df3`, 2026-08-12\
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
machinery, and **prod** only pulls (I6). Machine-specific scripts will not start on the wrong
platform.

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

**A documentation check that stopped reporting would still pass.** `scripts/tests/` plants one
violation per check `scripts/check_docs.py` registers and asserts the check finds it, so the
documentation gate's own coverage is proved rather than assumed (CUR-5). It is a pytest suite, and the
scripts scope runs it.

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
guards duplicate rather than source ([ADR-0067](../_decisions/0067-a-command-is-exempted-only-when-every-token-clears.md)) —
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
python. Only two scopes are constrained: `db` follows `backend`, which shares its `__pycache__` and
`.pytest_cache`, and `ops` follows `backend`, `db` and `frontend`, whose trees its stand-in `.env`
files appear in. **The `--frontend` implication above is the parent's, never a worker's** — a worker
runs the one scope it is given. `scripts/gate_pool.py` owns the spawning and nothing else; the
sections, the closing table and the closing statements stay in `scripts/_lib.sh`.

**No formatter the gate runs writes a tracked file**
([ADR-0065](../_decisions/0065-formatting-happens-at-commit-time.md)). prettier runs in check mode
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

| Scope        | Runs                                                                                                          | Needs                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `--scripts`  | `selfcheck.sh`, `ruff` and `pyright` over the python in `scripts/`, then the documentation gate's fixture net | the backend venv, `pytest` included; shellcheck and actionlint from PATH, else Docker    |
| `--docs`     | `check_docs.py` — citations, links, stamps; then `check_commits.py`                                           | the backend venv, plus node and an `fl_frontend` install for full-fidelity branch impact |
| `--backend`  | `uv lock --check`, then `ruff` + `pyright` + `pytest`, default tier                                           | the backend venv, and `uv` for the lockfile check                                        |
| `--format`   | prettier in check mode over the whole repository                                                              | pnpm install                                                                             |
| `--frontend` | the frozen lockfile check, then tsc, eslint, `next build`, unit tests, audit                                  | pnpm install                                                                             |
| `--ops`      | both compose files parse; the local stack mirrors production; nginx accepts `prod.conf`                       | Docker, and an interpreter at the checkers' floor for the mirror                         |
| `--db`       | `pytest -m db` against a real `mongod`                                                                        | venv + Docker                                                                            |
| `--images`   | both `docker build`s + the `instrumentation.js` presence check                                                | Docker                                                                                   |

Docker is checked before any check runs on a run covering the ops, database or image scopes, and the
backend virtualenv on one covering the scripts, documentation, backend or database scopes; the
frontend's `pnpm install` prerequisite is checked nowhere, so a missing one surfaces at the first
frontend step. Each tool is its own step, tool output is captured and shown only when its step fails,
and `--verbose` streams everything instead (§1.7). **The self-check is the exception**, and it is
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
changed** ([ADR-0030](../_decisions/0030-the-gate-refuses-an-undersized-scope.md)). It refuses a run
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
`.github/actions/actions-runtime-env` re-exports it first. **The scope stops before building when that
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

**A run has exactly one ending, and its exit code names which**
([ADR-0066](../_decisions/0066-a-refusal-is-not-a-failure.md)). Nothing else may be inferred from the
number: a caller that cannot tell "the change needs work" from "the check never ran" acts on the wrong
one.

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

| #   | Invariant                                                                                                       | Enforced by                                                                                                                                                                                                                         | Breaks how                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Only nginx publishes ports                                                                                      | `docker-compose.yml`                                                                                                                                                                                                                | Application containers become directly reachable from the host network                                                                            |
| I2  | Security headers are repeated in every `location` that sets any header                                          | `/_next/static/` block                                                                                                                                                                                                              | `add_header` in a location **replaces** the inherited set — the location silently loses HSTS, CSP and the rest                                    |
| I3  | A `default_server` block rejects unknown hosts                                                                  | `ssl_reject_handshake on`                                                                                                                                                                                                           | Any `Host` header reaches Next, forwarded verbatim by the proxy                                                                                   |
| I4  | Sign-in rate limiting applies to POST only                                                                      | the `map` producing an empty key otherwise                                                                                                                                                                                          | An empty key is exempt from `limit_req`; without the map, GET `/signin` would be throttled too                                                    |
| I5  | The builder stage has no reachable backend or real env                                                          | `SKIP_ENV_VALIDATION=true`, placeholder `MONGODB_URI`, no `API_URL`                                                                                                                                                                 | Anything fetching the API or parsing `AUTH_URL` at module scope fails the image build                                                             |
| I6  | Production never builds                                                                                         | `deploy.sh` only pulls                                                                                                                                                                                                              | A failed build on the server is an outage                                                                                                         |
| I7  | Both images build before either is pushed                                                                       | `publish.sh`; and `deploy.sh`, which compares the pulled `:latest` builds' `version` labels before recreating anything — refusing where a label could not be read, and warning where an image carries none                          | Production could pull a frontend whose backend does not exist                                                                                     |
| I8  | Publishing stops on a dirty tree by default                                                                     | `publish.sh`, whose `--allow-dirty` escape suffixes the tag `-dirty` and a fingerprint of the tree (`scripts/publish.sh :: DIRTY_ID`)                                                                                               | A `sha-` tag would name a commit that cannot rebuild the image it points at, so a rollback to it restores a tree no commit describes              |
| I9  | Deploy recreates containers in place                                                                            | `deploy.sh`                                                                                                                                                                                                                         | `down`/`up` turns a seconds-long interruption into a full outage                                                                                  |
| I10 | Scripts use LF line endings and carry the git executable bit                                                    | `selfcheck.sh` (its LF and executable-bit checks)                                                                                                                                                                                   | Windows hides both; the script works locally and fails on the server                                                                              |
| I11 | The three API keys are 64 characters and match on both sides                                                    | `fl_frontend/src/core/config.ts` alone (`length(64)`); the backend requires presence only                                                                                                                                           | Every request 401s with `REQ-AUTH-00x`, and a key short on the backend side is refused nowhere                                                    |
| I12 | Publishing stops on a commit no remote holds — any remote branch clears the bar, not only an ancestor of `main` | `publish.sh`, whose preflight asks the remotes for their branches (`git ls-remote --heads`) and requires HEAD to be an ancestor of a tip this clone holds, `--dry-run` included; a remote that could not be asked refuses at exit 2 | `:latest` moves to code nobody else can fetch, and the `sha-` tag `deploy.sh --status` offers as a rollback target names a commit one machine has |

## 3. Violation → remedy

| Symptom                                                            | Cause                                                                                                      | Remedy                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `not a directory` from nginx                                       | A mounted config file was missing, so Docker created a directory                                           | `git pull`, remove the stray directory                                                                             |
| `Invalid environment variables: <NAMES>` then no traffic           | Startup environment gate                                                                                   | Fix those names in the relevant `.env`                                                                             |
| Deploy reports healthy but the site is unreachable                 | nginx                                                                                                      | prod: `docker compose logs nginx`                                                                                  |
| `failed to connect to the docker API at npipe:...`                 | Docker Desktop is not running                                                                              | Start it and wait for it to settle                                                                                 |
| Deploy stops in preflight naming the Docker Engine version         | The host's engine is below what the compose files' `start_interval` needs                                  | Nothing was stopped or pulled. Upgrade the engine, or drop `start_interval` from both compose files (§1.5)         |
| `./scripts/deploy.sh --status` exits 1 naming two different builds | A publish moved one package's `:latest` and failed on the other, so this host pulled a pair no build names | Deploy the build both packages have: `./scripts/deploy.sh <tag>`, the tag the report names                         |
| `./scripts/publish.sh` refuses, naming a remote it could not ask   | The remote did not answer `git ls-remote --heads`, so nothing establishes that this commit is fetchable    | Nothing was built or pushed. Restore the network or the credentials and re-run (I12)                               |
| `EBUSY`, or `.next` locked during a build                          | A `pnpm dev` is still running, or the folder is open in an editor                                          | Stop the dev server; nothing else may hold port 3000 while the local stack runs                                    |
| Container unhealthy, health log empty, `FailingStreak: 0`          | The app died before the first probe                                                                        | Usually a malformed `.env` value restored by hand. Read `docker compose logs <service>` on the server              |
| A directory appeared named `something;C`                           | MSYS rewrote a POSIX-looking path in a hand-typed `docker run -v`                                          | Delete it, and prefix the command with `MSYS_NO_PATHCONV=1`                                                        |
| `UnicodeEncodeError: 'charmap' codec` from `fastapi dev`           | Windows only, when the output is piped or redirected                                                       | The CLI banner needs UTF-8. Prefix the command with `PYTHONUTF8=1`                                                 |
| Static assets served without security headers                      | A `location` block set a header and dropped the inherited set                                              | I2 — repeat every header in that block                                                                             |
| Backend healthcheck fails after an API version bump                | The check hardcodes `/api/v0/`                                                                             | Update the healthcheck path in `docker-compose.yml`                                                                |
| Sign-in returns 429                                                | Working as intended — the sign-in POST is rate-limited at the edge                                         | Nothing. The limit is `nginx/prod.conf`'s `signin` zone, and it applies to POST alone (I4)                         |
| Uptime monitor shows green during a backend outage                 | The error page streams after headers, so the edge status is 200                                            | Monitor `GET /api/v0/system/is_live` through the edge instead ([`docs/logging/spec.md`](../logging/spec.md))       |
| Container logs are empty right after a deploy                      | Working as intended — `json-file` logs live in the container, and `--force-recreate` replaces it           | Nothing. Copy them off before deploying ([`docs/logging/spec.md`](../logging/spec.md))                             |
| Reference data stale for up to a day                               | Working as intended — an out-of-band MongoDB edit invalidates nothing                                      | Nothing. The bound is the cache lifetime (ADR-0028): wait for the daily expiry, or recreate the frontend container |
| League table or fixtures stale after a season edit                 | Same cause — a season decides the default season and the points                                            | Same remedy; recreation drops every cached page at once                                                            |

## 4. Known-open

| #   | Item                                           | State                                                                                                                                       |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Backend healthcheck hardcodes `/api/v0/`       | Open — it works today and breaks silently on an API version bump (§3 carries the symptom)                                                   |
| —   | Registry tag pruning is manual                 | Accepted — a botched delete destroys rollback history. The retention procedure is in §1.5                                                   |
| —   | Revoking admin access needs a restart          | Accepted — the allowlist is validated at boot; after it, `role` is re-derived per request and the session dies                              |
| —   | `nginx` drops no capabilities                  | Open — the two application services carry `cap_drop: ALL` and `no-new-privileges:true` and `nginx` carries neither, with no ADR deciding it |
| —   | Certificate renewal is outside this repository | Accepted — they are mounted from `./certs`, and nothing here issues or rotates them                                                         |
