# `scripts/`

Operational scripts for building, testing, running and deploying Frankfurt-League.

## Quick reference

| Script                         | Run on        | Purpose                                                          |
| ------------------------------ | ------------- | ---------------------------------------------------------------- |
| `verify.sh`                    | any           | Full pre-merge gate: checks, both test suites, both image builds |
| `local.sh`                     | dev — Windows | Run the production image locally, behind nginx                   |
| `publish.sh`                   | dev — Windows | Build, tag with the commit, push to ghcr.io                      |
| `deploy.sh`                    | prod — Linux  | Pull and restart, verify health, roll back                       |
| `revalidate_reference_data.sh` | prod — Linux  | Drop the frontend cache for one reference resource               |
| `selfcheck.sh`                 | any           | Test the scripts themselves                                      |
| `_lib.sh`                      | —             | Shared helpers; sourced, never run directly                      |

One script lives outside this directory, because it needs `sharp` from the frontend's own
dependencies: **`fl_frontend/scripts/generate-brand-assets.mjs`**, run as `pnpm brand` from
`fl_frontend/`. It regenerates every brand asset — favicon, app icons, both manifest sets, the
Open Graph card and the `FLLogo` component — from one parameterised source. The mark's erosion is
three numbers at the top of that file. **Re-run it rather than editing any of its outputs**, or
the header mark and the icons drift apart.

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

Every script takes `--help` and prints its own documentation. Only `publish.sh` and `deploy.sh` affect
real users; the rest are safe to run at any time.

---

## Environments

Three, deliberately separated. Machine-specific scripts refuse to start on the wrong one.

| Environment | What it is                                        | Entry point                  |
| ----------- | ------------------------------------------------- | ---------------------------- |
| **dev**     | `next dev` from source, hot reload, no Docker     | `pnpm dev` in `fl_frontend/` |
| **local**   | the production image, on your machine, with nginx | `./scripts/local.sh`         |
| **prod**    | published images on the server, never builds      | `./scripts/deploy.sh`        |

**dev** is fast but does not exercise the standalone build, the startup environment gate, nginx or the
security headers. **local** runs the same image production runs, so all of those are live — it is the
only place a packaging problem is visible before a deploy. **prod** only pulls; a server that builds is
a server that can fail a build.

---

## Restoring a server checkout

A clone cannot bring four things, because all four are gitignored or generated elsewhere:

| Path               | What it is                         | Restored from                                          |
| ------------------ | ---------------------------------- | ------------------------------------------------------ |
| `fl_backend/.env`  | Backend configuration and secrets  | Password manager                                       |
| `fl_frontend/.env` | Frontend configuration and secrets | Password manager                                       |
| `certs/`           | TLS certificate and key            | The renewal process, which lives outside this repo     |
| `nginx/prod.conf`  | Mounted read-only by nginx         | The repository — present after any clone or `git pull` |

`deploy.sh` checks all four **exist** before it pulls anything, and Compose refuses to start a
service whose `env_file` is missing. **Nothing checks that their contents are valid.** A malformed
value passes every preflight and surfaces as a container that never becomes healthy — so run the
checks below after restoring, before deploying.

### Shape checks

Each reveals structure without printing a secret.

```bash
# prod (Linux) — required backend names. Prints only the names that are absent.
for k in API_TRUSTED_HOSTS API_CORS_ALLOWED_ORIGINS MONGODB_URI DB_BASE_NAME INTERNAL_API_KEY_BASE INTERNAL_API_KEY_SYSTEM INTERNAL_API_KEY_ADMIN; do
  grep -q "^${k}=" fl_backend/.env || echo "MISSING: ${k}"
done
```

```bash
# prod (Linux) — required frontend names.
for k in API_URL API_VERSION AUTH_URL AUTH_SECRET AUTH_RESEND_KEY ALLOWED_ADMIN_EMAILS MONGODB_URI INTERNAL_API_KEY_BASE INTERNAL_API_KEY_SYSTEM INTERNAL_API_KEY_ADMIN; do
  grep -q "^${k}=" fl_frontend/.env || echo "MISSING: ${k}"
done
```

```bash
# prod (Linux) — the Mongo host, credentials stripped. Expect a real SRV hostname ending in a
# public suffix, identical in both files.
for f in fl_backend/.env fl_frontend/.env; do
  printf '%s: ' "$f"; grep '^MONGODB_URI=' "$f" | sed 's|.*@||; s|/.*||'
done
```

```bash
# prod (Linux) — the three API keys are 64 characters and identical across both files.
# `[:cntrl:]` strips a stray CR from a file written on Windows. ${#a} is a length, never a value.
for k in INTERNAL_API_KEY_BASE INTERNAL_API_KEY_SYSTEM INTERNAL_API_KEY_ADMIN; do
  a=$(grep "^${k}=" fl_backend/.env  | cut -d= -f2- | tr -d '[:cntrl:]')
  b=$(grep "^${k}=" fl_frontend/.env | cut -d= -f2- | tr -d '[:cntrl:]')
  # Without this guard a key absent from both files reports len=0/0 match=yes, which reads as a pass.
  if [ -z "$a" ] || [ -z "$b" ]; then echo "$k ABSENT from one or both files"; continue; fi
  echo "$k len=${#a}/${#b} match=$([ "$a" = "$b" ] && echo yes || echo NO)"
done
```

One value cannot be checked locally at all: `AUTH_URL` has to be the real public origin over https,
or the session cookie loses its `Secure` flag. The backend's API version is no longer among them —
it is a constant in `app/core/config.py`, so it cannot drift from the compose healthcheck by
configuration. The frontend keeps its own `API_VERSION`, which is legitimate: a client chooses which
version of an API to call.

### Why this exists

The re-clone on 2026-08-01 restored a `MONGODB_URI` whose host had been truncated from
`…mongodb.net` to `…mon>` — most likely a shell redirection swallowing part of the string as the
file was written. Every preflight passed: the file existed, the key was present, the URI parsed.
pymongo then resolved an SRV name that cannot exist, the startup ping raised `ConfigurationError`,
and the container crash-looped.

Two things from that are worth carrying forward. **An empty health log with `"FailingStreak": 0`
means the application died before the first probe** rather than failing its check — read the
container log, not the healthcheck. And **a rollback cannot help when the host's configuration is
the cause**, because every published tag fails identically against the same bad value.

The containment worked as designed: nginx waits on `service_healthy` for both upstreams, so it never
started and visitors got a refused connection rather than a page of 502s.

---

## `verify.sh` — pre-merge gate

```bash
./scripts/verify.sh            # everything
./scripts/verify.sh --quick    # skip the image builds
```

Runs, cheapest-to-fail first:

1. `selfcheck.sh` — the scripts themselves
2. `pnpm verify` — types, lint, formatting, `next build`, unit tests
3. `pnpm audit:prod` — runtime dependency advisories
4. `ruff` + `pytest` — `fl_backend` lint and the default test tier
5. `docker build` — both images
6. an image check — that `instrumentation.js` is present in the frontend image

Step 4 exists because `pnpm verify` runs **nothing** against `fl_backend`. The backend holds ~40
validation constraints that the frontend mirrors rather than enforces, and until this step they had
no regression net at all — see [`fl_backend/tests/README.md`](../fl_backend/tests/README.md) and
ledger row BE-5. It needs the backend virtualenv: `cd fl_backend && uv sync --dev`.

**Step 4 runs the default tier only, and that is deliberate.** The `db`-marked tests start a real
`mongod` ([ADR-0030](../docs/_decisions/0030-a-real-mongod-behind-a-deselected-marker.md)); pulling
them into the gate would make `--quick` — the path CI runs on every pull request — require a Docker
daemon it currently does not. They run in the `backend-db` CI job, or by hand with
`cd fl_backend && uv run pytest -m db`.

Steps 5 and 6 exist because `pnpm verify` cannot see packaging problems: code that compiles can still
fail to build inside the image, or be omitted from `output: "standalone"` entirely.

> `--quick` is **not** sufficient before a merge that touches `src/core/config.ts`, `src/core/auth.ts`
> or `src/instrumentation.ts`. Those are where packaging problems live.

---

## `local.sh` — production image, locally

```bash
./scripts/local.sh             # build changed layers, start, wait for health
./scripts/local.sh --fresh     # delete volumes first, then build and start
./scripts/local.sh --logs      # start, then follow the frontend log
./scripts/local.sh --down      # stop the stack
```

Serves on <http://localhost:3000>, and waits until both services report healthy before returning.

**`--fresh` is not the default** because it runs `docker compose down -v`, deleting the volumes that
hold Next.js's build cache — turning a seconds-long start into a minutes-long one. The default is
correct almost always, since Docker rebuilds any layer whose inputs changed. Reach for `--fresh` when
the stack behaves in a way the code does not explain, which usually means a stale cached asset.

---

## `publish.sh` — build and push

```bash
./scripts/publish.sh                  # from a clean tree
./scripts/publish.sh --dry-run        # build and label, do not push
./scripts/publish.sh --allow-dirty    # deliberate hotfix; the tag gets a -dirty suffix
```

Builds both images **before** pushing either, so a failed backend build cannot leave production able to
pull a frontend that expects it. Refuses a dirty working tree by default: a tag naming a commit must be
rebuildable from that commit.

### Authentication — it needs a classic token

```bash
docker login ghcr.io -u felzab
```

**A fine-grained personal access token is not enough, even though it appears to work.** Verified on
2026-08-01: `docker login ghcr.io` _succeeds_ with a fine-grained repo token, and the push then fails
with

```
error from registry: permission_denied: The token provided does not match expected scopes.
```

ghcr accepts credentials at the login endpoint and only evaluates package write permission at push
time — and a first push is a _create_ in your account's namespace, which repository scopes do not
cover. Use a **classic** token (Settings → Developer settings → Tokens (classic)) with
**`write:packages`**, which auto-selects `read:packages`. Nothing else is needed: the packages are
public and the repository is public, so no `repo` scope. Add `delete:packages` only if you ever want
to prune versions from the command line rather than the UI.

If a previous login stored a different token, `docker logout ghcr.io` first — otherwise Docker reuses
it and the push fails again with the same message.

**The server needs none of this.** Public packages pull anonymously; there is no token on the
production host.

### Tags

Each service has its own package on GitHub Container Registry, so the service name lives in the
repository and the tag says only which build it is ([ADR-0017](../docs/_decisions/0017-ghcr-two-public-packages.md)).
Each publish writes four tags, two per package:

| Package                                   | Tag            | Kind      | Used for               |
| ----------------------------------------- | -------------- | --------- | ---------------------- |
| `ghcr.io/felzab/frankfurtleague-frontend` | `latest`       | moving    | what `deploy.sh` pulls |
| `ghcr.io/felzab/frankfurtleague-frontend` | `sha-<commit>` | immutable | rollback target        |
| `ghcr.io/felzab/frankfurtleague-backend`  | `latest`       | moving    | what `deploy.sh` pulls |
| `ghcr.io/felzab/frankfurtleague-backend`  | `sha-<commit>` | immutable | rollback target        |

**Both packages are public**, which is what lets the server pull anonymously — there is no token on
the production host to manage or expire. A pull failing there with an authentication or "not found"
error almost always means a package was left private after a first push, not that credentials are
missing.

Every image also carries OCI labels — `org.opencontainers.image.revision`, `.created` and `.version` —
recording the commit it was built from.

### Keeping old tags from piling up

**Locally, `publish.sh` handles it.** After every push succeeds it deletes local `:sha-*` tags in
both packages other than the one it just built. That is safe because `deploy.sh` rolls back by _pulling_ a pinned tag, so
the registry is the rollback mechanism and a local sha tag is only a build byproduct.

Left alone they never expire on their own. Each publish re-points the moving tag, but the superseded
image keeps its own sha tag — so it never becomes dangling, and `docker image prune` never reclaims
it. That is roughly **750 MB per publish**, with no upper bound.

**In the registry, pruning is now optional.** It used to be necessary: Docker Hub's free private
repository had finite storage. Public packages on ghcr are free and unlimited, so nothing forces a
delete — the only reason left is keeping the rollback list readable, and that is a matter of taste
rather than capacity. **When you do prune, do it by hand.** This is deliberately not automated: a
botched registry delete destroys rollback history, and rollback is the one thing that has to work on
your worst day.

To establish that a version is genuinely orphaned rather than merely untagged, list every digest the
tags you are keeping depend on, and delete only what is absent from that set:

```bash
# dev — every digest reachable from the tags you intend to keep
for t in latest sha-e340056; do
  docker manifest inspect ghcr.io/felzab/frankfurtleague-frontend:"$t" \
    | grep -o 'sha256:[a-f0-9]\{64\}'
done | sort -u
```

> **Untagged versions are not junk — do not bulk-delete them.** Each package shows untagged entries
> alongside the tagged ones. They are **BuildKit provenance attestations**: a signed record of how
> and where the image was built, which GitHub lists without a tag because they carry none. Confirmed
> 2026-08-01 — `docker manifest inspect` on `:latest` returns an OCI image _index_ whose second
> entry has `"architecture": "unknown", "os": "unknown"`, the standard marker for one.
>
> **The tagged image references them by digest, so deleting one corrupts the tag it belongs to** and
> a later `docker pull` fails on a missing manifest. Delete a version only when it is untagged **and**
> its creation date matches a publish you have genuinely superseded — never one created at the same
> moment as a tag still in use. Building with `--provenance=false` would stop them appearing, at the
> cost of the provenance record itself; on a public repository that is the wrong trade.

Keep roughly the last five `sha-` tags in each package. To decide what goes:

1. **Never delete what is live.** Read it from the server, do not recall it:

   ```bash
   ./scripts/deploy.sh --status
   ```

   The `commit` line comes from the image's own OCI label, so it is true even if a tag was moved.

2. **Never delete what the moving tag points at.** In the package's version list, `latest` and
   `sha-<commit>` sharing a digest means they are the same image — deleting that version removes
   both tags at once.

3. **Map the rest back to history.** The suffix is the git short SHA, so a tag is one `git log`
   away from its commit:

   ```bash
   git log --oneline -15
   ```

   Anything older than the last five, and not live, is safe to remove.

Then delete them from the package: **the package page → Package settings → Manage versions**, which
lists versions newest first. Reach it from https://github.com/felzab?tab=packages. Deleting a tag never affects an image already pulled onto the server — only the ability to
pull it again.

---

## `deploy.sh` — go live

```bash
./scripts/deploy.sh                  # deploy the current frontend/backend tags
./scripts/deploy.sh sha-1a2b3c4      # deploy, or roll back to, one published build
./scripts/deploy.sh --status         # report what is running; change nothing
```

Never builds. It checks the files nginx mounts, pulls, records the currently-live commit, recreates the
containers **in place** — so the interruption is seconds rather than the full outage `docker compose
down` would cause — waits for health, then confirms the live security headers.

If the new version does not become healthy it prints the rollback command and exits non-zero. nginx
waits on the frontend's health, so an unhealthy deploy is never served to anyone.

### You do not need to remember tags

`publish.sh` moves `frontend` and `backend` to your newest build every run, and `deploy.sh` with no
arguments pulls those. Publish, then deploy, always means "the latest thing I published".

Tags matter only for going backwards — and you read them rather than recall them:

```
$ ./scripts/deploy.sh --status
frontend:  healthy
           image    ghcr.io/felzab/frankfurtleague-frontend:latest
           commit   1a2b3c4
           built    2026-07-30T09:12:44Z
```

That `commit` line comes from the image's own label, not from the tag name: a tag can be moved, a label
cannot.

---

## `revalidate_reference_data.sh` — clear a stale cache

```bash
./scripts/revalidate_reference_data.sh saisons
./scripts/revalidate_reference_data.sh spieler
./scripts/revalidate_reference_data.sh spieltage
```

Run it after editing one of those three collections **directly in MongoDB**. They are cached for a day
and have no admin write surface, so nothing invalidates them automatically. Everything else — matches,
venues, referees — the admin UI already invalidates when you save.

The request runs inside the frontend container, because `/api/revalidate` is not exposed through nginx
and the API key is read from the container's own environment. The key never reaches your shell history.

Forgetting to run it is not harmful; the cache expires within 24 hours regardless.

---

## `selfcheck.sh` — test the scripts

```bash
./scripts/selfcheck.sh
```

`verify.sh` runs this first, so you rarely need it directly — reach for it after editing anything in
`scripts/`. Nine checks:

| #   | Check                                       |
| --- | ------------------------------------------- |
| 1   | every script parses                         |
| 2   | line endings are LF                         |
| 3   | the executable bit is set in git            |
| 4   | every helper a script calls is defined      |
| 5   | `--help` works from any directory           |
| 6   | unknown options are rejected                |
| 7   | machine-specific scripts declare a platform |
| 8   | `--help` matches the flags the code accepts |
| 9   | shellcheck reports nothing                  |

`bash -n` validates syntax only. It cannot see a call to a function that does not exist, a CRLF line
ending or a missing executable bit that breaks the script on Linux, or documentation that has drifted
from behaviour. These checks cover what it misses.

Checks 2 and 3 exist because Windows hides both problems: it tolerates CRLF, and it has no real
executable bit, so `chmod +x` in Git Bash never reaches git. Either one produces a script that works on
your machine and fails on the server.

Check 9 uses a local `shellcheck` if you have one, otherwise `koalaman/shellcheck:stable` via Docker.
It is the only check that needs Docker, and you do not need to install anything.

---

## Conventions

All scripts source `_lib.sh`, which provides:

- **Strict mode** — `set -euo pipefail` plus `IFS` hardening, so a failure stops the script instead of
  letting it continue with bad state.
- **An error trap** naming the script, the line and the exact command that failed.
- **Guards** — `require_platform`, `require_docker`, `require_file`, `require_dir`. Each says what is
  wrong and what to do about it.
- **`wait_healthy`** — waits for a Compose service and, on failure, surfaces the application's own
  error lines.
- **`usage`** — prints the calling script's header comment, so `--help` cannot drift from the code.

Two conventions worth knowing: every script resolves the repository root itself, so it behaves the same
from any working directory; and arguments are parsed before any environmental check, so a typo fails
immediately rather than after a platform or Docker check.

---

## Troubleshooting

| Symptom                                                   | Cause and fix                                                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `failed to connect to the docker API at npipe:...`        | Docker Desktop is not running. Start it and wait for it to settle.                                                                             |
| `Invalid environment variables: <NAMES>` then no traffic  | The startup environment gate. Fix those names in the relevant `.env`.                                                                          |
| `not a directory` from nginx                              | A mounted config file was missing, so Docker created a directory. `git pull`.                                                                  |
| `EBUSY`, or `.next` locked during a build                 | A `pnpm dev` is still running, or the folder is open in an editor.                                                                             |
| Deploy reports healthy but the site is unreachable        | Check nginx: `docker compose logs nginx`.                                                                                                      |
| Container unhealthy, health log empty, `FailingStreak: 0` | The app died before the first probe. Read `docker compose logs <service>`; usually a malformed `.env` value — see Restoring a server checkout. |
| A directory appeared named `something;C`                  | See the Windows note below.                                                                                                                    |

### Windows

Run the scripts from Git Bash. Do not hand-type `docker run -v` there: MSYS rewrites POSIX-looking
paths, so a container path becomes a Windows one and Docker creates a directory at the mangled name.
The Compose files declare every mount in YAML, where this cannot happen. If you must pass a container
path on a command line, prefix the command with `MSYS_NO_PATHCONV=1`.
