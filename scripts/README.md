# `scripts/`

**Verified against:** `09f903d`, 2026-08-08
**Scope:** every script in `scripts/`, and the conventions they share

Operational scripts for building, testing, running and deploying Frankfurt-League. This page says
which script to reach for and carries only the knowledge that spans scripts; **each script's own
header carries its usage and its reasoning**, printed by `--help`, and nothing below restates
either.

| Script         | Run on        | Purpose                                                       |
| -------------- | ------------- | ------------------------------------------------------------- |
| `verify.sh`    | any           | The pre-merge gate — whole, or scoped to the surfaces touched |
| `local.sh`     | dev — Windows | Run the production image locally, behind nginx                |
| `publish.sh`   | dev — Windows | Build both images, tag with the commit, push to ghcr.io       |
| `deploy.sh`    | prod — Linux  | Pull and restart in place, verify health, roll back           |
| `selfcheck.sh` | any           | Test the scripts themselves                                   |
| `ci_scopes.sh` | any           | Map changed paths to gate scopes; both CI workflows read it   |
| `_lib.sh`      | —             | Shared helpers; sourced, never run directly                   |

**`ci_scopes.sh` is the one copy of the path-to-scope mapping.** Both workflows read it, and so does
`check_scope.py` through its `--stdin` mode, which asks the same mapping about a file list the
caller has already filtered rather than one computed from a diff.

Four checkers are python rather than shell, and one of them never runs in the gate:
`check_docs.py`, `check_commits.py` and `check_scope.py` are steps of `verify.sh`, while
**`check_pr_body.py` runs only in CI** — a pull request body is not in the repository and does not
exist when the gate runs, so `.github/workflows/pr-body.yml` is the only place it is addressable.
One helper is javascript for a reason: `ts_normalize.mjs` decides whether two versions of a
TypeScript file differ by anything but comments, and only TypeScript's own parser knows that a `//`
inside a string is not a comment.

```bash
# ship a change
./scripts/verify.sh                     # dev:  everything must be green
./scripts/local.sh                      # dev:  see it as production sees it
./scripts/publish.sh                    # dev:  build, tag, push
git pull && ./scripts/deploy.sh         # prod: go live

# when something is wrong
./scripts/deploy.sh --status            # prod: what is running, from which commit
./scripts/deploy.sh sha-1a2b3c4         # prod: roll back to a known-good build
```

Only `publish.sh` and `deploy.sh` affect real users; the rest are safe to run at any time. One
generator lives outside this directory because it needs the frontend's own dependencies:
`fl_frontend/scripts/generate-brand-assets.mjs` (`pnpm brand` from `fl_frontend/`) regenerates every
brand asset from one parameterised source — re-run it rather than editing any of its outputs, or the
header mark and the icons drift apart.

## Environments

| Environment | What it is                                        | Entry point                                                                      |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| **dev**     | source with hot reload, no Docker                 | `pnpm dev` in `fl_frontend/` · `uv run fastapi dev app/asgi.py` in `fl_backend/` |
| **local**   | the production image, on your machine, with nginx | `./scripts/local.sh`                                                             |
| **prod**    | published images on the server, never builds      | `./scripts/deploy.sh`                                                            |

**local** is the only place a packaging problem — a missing standalone file, a failing startup env
gate, a header nginx does not set — is visible before a deploy: **dev** exercises none of that
machinery, and **prod** only pulls, because a server that builds is a server that can fail a build
at the worst moment. Machine-specific scripts refuse to start on the wrong platform.

## `verify.sh` — the pre-merge gate

Seven scopes, run in cheapest-to-fail order — the self-check and the documentation gate are
instant, the backend tier takes seconds, a `next build` takes minutes, an image build longer still.
No flag means every scope; scope flags combine freely; `--quick` is the four scopes that need no
Docker. Missing prerequisites fail immediately, before any check runs. Each tool is its own step,
tool output is captured and shown only when its step fails, and `--verbose` streams everything
instead.

| Scope        | Runs                                                                | Needs            |
| ------------ | ------------------------------------------------------------------- | ---------------- |
| `--scripts`  | `selfcheck.sh`, then `ruff` over `scripts/*.py`                     | the backend venv |
| `--docs`     | `check_docs.py` — citations, links, stamps; then `check_commits.py` | the backend venv |
| `--backend`  | `ruff` + `pyright` + `pytest`, default tier                         | the backend venv |
| `--frontend` | prettier (write), tsc, eslint, `next build`, unit tests, audit      | pnpm install     |
| `--ops`      | both compose files parse; nginx accepts `prod.conf`                 | Docker           |
| `--db`       | `pytest -m db` against a real `mongod`                              | venv + Docker    |
| `--images`   | both `docker build`s + the `instrumentation.js` presence check      | Docker           |

**Before any of them runs, `check_scope.py` compares the scopes named against what the branch
actually changed** ([ADR-0037](../docs/_decisions/0037-the-gate-refuses-an-undersized-scope.md)). It
refuses a run whose diff reaches the image build with a change that is more than comments, and
merely reports every other surface the run leaves unproven — a run with one scope flag is as often
mid-work as it is a gate, and a check that fails those gets suppressed. What counts as "more than
comments" is decided by a parser and never by a `#` rule: TypeScript through its own parser, Python
through `ast` with docstrings stripped, TOML through `tomllib`, and everything else — Dockerfiles,
YAML, shell — is code, because that is the safe answer where no parser is available. The check is
skipped in CI, which maps its own scopes from the paths.

**The scripts scope lints its own python**, and `scripts/ruff.toml` is what makes that possible.
ruff resolves configuration by walking up from the file it is checking, so `fl_backend/pyproject.toml`
governs the backend and nothing else — `check_docs.py` and `check_commits.py` resolved no
configuration at all and fell back to ruff's defaults. An editor could therefore report a finding
this gate had no way to produce, which is the failure the `[tool.pyright]` block in that same
pyproject records for types. `scripts/ruff.toml` carries one `extend` line and must never grow a
`select` of its own, or the two can disagree again. It is scoped to `scripts/` rather than placed at
the repository root because a root config would become the nearest config for `fl_backend/` too,
moving isort's source root: `app` stops resolving as first-party and every backend import block is
reshuffled. The cost of the scope is that `--scripts` now needs the backend venv.

**Commit messages ride in the docs scope**, which is not a filing accident: in this repository the
commit bodies are documentation — merges are never squashed so that they survive — and `--docs` is
part of every scope combination CLAUDE.md prescribes, so a `--commits` flag would be a flag nobody
remembers to pass on the change that needed it. `check_commits.py` reads only the branch's own
commits and imports nothing outside the standard library, which is what lets CI run it on a bare
runner. The `--ops` scope alone is the one combination that omits it locally; CI closes that gap by
running the check in the always-on `changes` job, since a commit message has no path to filter on.

The **ops** scope exists because the compose files and the nginx config have no compiler and no
test suite — without it, a typo in either surfaces on the server, at deploy time. `nginx -t` runs
against throwaway self-signed certificates and loopback upstream hosts, because a config test loads
both.

Three scopes carry the reasoning worth knowing. The **backend** scope exists because the frontend
toolchain runs nothing against `fl_backend`, whose validation constraints the frontend mirrors rather than
enforces — [`fl_backend/tests/README.md`](../fl_backend/tests/README.md). The **db** scope is
separate because its tests start a real `mongod`
([ADR-0030](../docs/_decisions/0030-a-real-mongod-behind-a-deselected-marker.md)), and folding them
into the backend scope would give a Docker prerequisite to a scope that needs none. The **images**
scope exists because the frontend toolchain cannot see packaging problems: code that compiles can still fail
to build inside the image, or be omitted from `output: "standalone"` entirely — so a run without it
is **not sufficient** before a merge touching `src/core/config.ts`, `src/core/auth.ts`,
`src/instrumentation.ts`, `next.config.ts`, a lockfile or a Dockerfile — **unless the change is
confined to comments**, which cannot reach the image at all and are a documentation change wherever
they sit. That carve-out is no longer a thing to remember: `check_scope.py` decides it from the diff
and refuses the run when the answer is no. The dependency audit warns
rather than fails — an advisory published upstream overnight should not block an unrelated merge.

**One path selects two scopes on purpose.** `fl_backend/openapi.json` maps to **backend and
frontend** both ([ADR-0040](../docs/_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md)),
because the frontend scope holds the test comparing the Zod mirror against that document. Everything
else under `fl_backend/` selects the backend scope alone, so without this arm a Pydantic model change
would never run the check that exists to catch it. The document is committed for precisely this
reason: regenerating it is what carries a model change into the frontend job.

CI (`.github/workflows/verify.yml`) runs these scopes as parallel jobs, mapped from the paths a
pull request touches — including the images scope for exactly the packaging paths above; a push to
`main` runs all of them.

**In CI the images scope caches layers through the Actions cache service**, which `VERIFY_IMAGES_CACHE=gha`
selects ([ADR-0038](../docs/_decisions/0038-the-image-cache-is-the-actions-cache-service.md)). buildx
authenticates to that service with a credential the runner gives to JavaScript actions and never to a
`run:` step, so `.github/actions/actions-runtime-env` re-exports it first. **The scope refuses to build
when that variable is set and the credential is missing.** buildx would fail too — a cache export
error is fatal unless `ignore-error` is turned on, and it must not be — but only after every layer
has been built, and with a message naming a missing token rather than the missing step. Locally the
variable is unset and the build is a plain `docker build` against the daemon's own warm layer
cache.

## `local.sh` — production image, locally

Serves on <http://localhost:3000> and waits until both services report healthy. Why dev mode proves
nothing about packaging, and why `--fresh` is not the default, are reasoned in the script's own
header — `./scripts/local.sh --help`.

## `publish.sh` — build and push

Builds, tags and pushes both images. The ordering (both built before either is pushed), the tag
scheme ([ADR-0017](../docs/_decisions/0017-ghcr-two-public-packages.md)), the OCI labels and the
automatic pruning of superseded local `sha-` tags are all reasoned in the script's own header. Two
things live only here:

**Authentication needs a classic token with `write:packages`** (`docker login ghcr.io -u felzab`).
A fine-grained token _appears_ to work — login succeeds — and then the push fails with
`permission_denied: The token provided does not match expected scopes`, because ghcr evaluates
package write permission only at push time and a first push is a _create_ that repository scopes do
not cover. If a previous login stored another token, `docker logout ghcr.io` first. The server
needs no token at all: both packages are public and pull anonymously.

**Registry pruning stays manual and optional** (public packages are free). When pruning, keep
roughly the last five `sha-` tags per package and never delete what is live
(`./scripts/deploy.sh --status`), what `latest` shares a digest with, or an **untagged version
created alongside a tag still in use** — those are BuildKit provenance attestations the tagged
image references by digest, and deleting one corrupts the tag it belongs to.

## `deploy.sh` — go live

Never builds — pulls, recreates the containers in place, waits for health, and prints the rollback
command on failure; the steps and their reasoning are in the script's own header. With a
`sha-<commit>` argument it deploys, or rolls back to, exactly that build: rollback works by pulling
the pinned tag, so **the registry is the rollback mechanism**, and an unhealthy deploy is never
served because nginx waits on `service_healthy`.

## `selfcheck.sh` — test the scripts

`verify.sh` runs this first; reach for it directly after editing anything in `scripts/` — or in
`.claude/hooks/`, whose shell scripts the syntax, line-ending and shellcheck passes cover too, and
whose branch and compose guards a dedicated step probes against a throwaway repository
(`ci_scopes.sh` maps a hook edit to this scope for exactly that reason). `bash -n`
validates syntax only — the checks, listed in the script's own header, cover what it misses:
undefined helpers, drifted `--help` text, workflow files that only fail on their first live run
(actionlint), and the two defects Windows hides (CRLF endings, and an executable bit that
`chmod +x` in Git Bash never reaches), either of which works locally and fails on the server. It
also drives `check_scope.py`'s comment-only classifier over fixtures in both directions, because
that is the one gate decision whose wrong answer is silent.

**That classifier's TypeScript half needs the frontend's `typescript`, and the scope does not
require it.** `--scripts` stays runnable on a clone that has never run `pnpm install`: when
`typescript` does not resolve, the classifier is required to answer "code", and the self-check
asserts that degradation instead of the real answer. CI's `scripts` job installs the frontend
dependencies for exactly this reason — otherwise the half that needs a parser rather than a regex
would be exercised on no machine but the author's.

## Conventions

All scripts source `_lib.sh`: strict mode (`set -euo pipefail`, hardened `IFS`), an error trap
naming the script, line and command that failed, guards (`require_platform`, `require_docker`,
`require_file`, `require_dir`), `wait_healthy` for Compose services, and `usage`, which prints the
calling script's own header so `--help` cannot drift from the code. Every script resolves the
repository root itself, so it behaves the same from any working directory; arguments are parsed
before any environmental check, so a typo fails instantly.

### The output standard

Every line a script prints goes through the helpers in `scripts/_lib.sh` — no script writes its own
formatting. One vocabulary, one verb per meaning — `step`, `ok`, `info`, `skip`, `warn`, `die`,
with `detail` for supporting output — one message column that the helpers align themselves, and
colour decided centrally. **The standard is recorded at the definitions in `scripts/_lib.sh`**;
`scripts/check_docs.py` prints to the same columns, so the whole gate reads as one voice.

## Troubleshooting

| Symptom                                                   | Cause and fix                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `failed to connect to the docker API at npipe:...`        | Docker Desktop is not running. Start it and wait for it to settle.                                                             |
| `Invalid environment variables: <NAMES>` then no traffic  | The startup environment gate. Fix those names in the relevant `.env`.                                                          |
| `not a directory` from nginx                              | A mounted config file was missing, so Docker created a directory. `git pull`.                                                  |
| `EBUSY`, or `.next` locked during a build                 | A `pnpm dev` is still running, or the folder is open in an editor.                                                             |
| Deploy reports healthy but the site is unreachable        | Check nginx: `docker compose logs nginx`.                                                                                      |
| Container unhealthy, health log empty, `FailingStreak: 0` | The app died before the first probe — usually a malformed `.env` value restored by hand. Read `docker compose logs <service>`. |
| A directory appeared named `something;C`                  | See the Windows note below.                                                                                                    |
| `UnicodeEncodeError: 'charmap' codec` from `fastapi dev`  | Windows-only, when the output is piped or redirected: the CLI banner needs UTF-8. Prefix the command with `PYTHONUTF8=1`.      |

### Windows

Run the scripts from Git Bash. Do not hand-type `docker run -v` there: MSYS rewrites POSIX-looking
paths, so a container path becomes a Windows one and Docker creates a directory at the mangled
name. The Compose files declare every mount in YAML, where this cannot happen; if you must pass a
container path on a command line, prefix the command with `MSYS_NO_PATHCONV=1`.
