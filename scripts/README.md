# `scripts/`

Operational scripts for building, testing, running and deploying Frankfurt-League.

## Quick reference

| Script                         | Run on        | Purpose                                                          |
| ------------------------------ | ------------- | ---------------------------------------------------------------- |
| `verify.sh`                    | any           | Full pre-merge gate: checks, both test suites, both image builds |
| `local.sh`                     | dev — Windows | Run the production image locally, behind nginx                   |
| `publish.sh`                   | dev — Windows | Build, tag with the commit, push to Docker Hub                   |
| `deploy.sh`                    | prod — Linux  | Pull and restart, verify health, roll back                       |
| `revalidate_reference_data.sh` | prod — Linux  | Drop the frontend cache for one reference resource               |
| `selfcheck.sh`                 | any           | Test the scripts themselves                                      |
| `_lib.sh`                      | —             | Shared helpers; sourced, never run directly                      |

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

## `verify.sh` — pre-merge gate

```bash
./scripts/verify.sh            # everything
./scripts/verify.sh --quick    # skip the image builds
```

Runs, cheapest-to-fail first:

1. `selfcheck.sh` — the scripts themselves
2. `pnpm verify` — types, lint, formatting, `next build`, unit tests
3. `pnpm audit:prod` — runtime dependency advisories
4. `ruff` + `pytest` — `fl_backend` lint and schema-constraint tests
5. `docker build` — both images
6. an image check — that `instrumentation.js` is present in the frontend image

Step 4 exists because `pnpm verify` runs **nothing** against `fl_backend`. The backend holds ~40
validation constraints that the frontend mirrors rather than enforces, and until this step they had
no regression net at all — see [`fl_backend/tests/README.md`](../fl_backend/tests/README.md) and
ledger row BE-5. It needs the backend virtualenv: `cd fl_backend && uv sync --dev`.

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

### Tags

Docker Hub's free plan allows one private repository, so both services share it and tag prefixes tell
them apart. Each publish writes four tags:

| Tag                     | Kind      | Used for               |
| ----------------------- | --------- | ---------------------- |
| `frontend`              | moving    | what `deploy.sh` pulls |
| `frontend-sha-<commit>` | immutable | rollback target        |
| `backend`               | moving    | what `deploy.sh` pulls |
| `backend-sha-<commit>`  | immutable | rollback target        |

Ordered `<service>-<qualifier>` so that alphabetical listings group each service together.

Every image also carries OCI labels — `org.opencontainers.image.revision`, `.created` and `.version` —
recording the commit it was built from.

### Keeping old tags from piling up

**Locally, `publish.sh` handles it.** After every push succeeds it deletes local `*-sha-*` tags other
than the one it just built. That is safe because `deploy.sh` rolls back by _pulling_ a pinned tag, so
the registry is the rollback mechanism and a local sha tag is only a build byproduct.

Left alone they never expire on their own. Each publish re-points the moving tag, but the superseded
image keeps its own sha tag — so it never becomes dangling, and `docker image prune` never reclaims
it. That is roughly **750 MB per publish**, with no upper bound.

**In the registry, prune by hand.** This is deliberately not automated: a botched registry delete
destroys rollback history, and rollback is the one thing that has to work on your worst day.

Keep roughly the last five sha tags per service. To decide what goes:

1. **Never delete what is live.** Read it from the server, do not recall it:

   ```bash
   ./scripts/deploy.sh --status
   ```

   The `commit` line comes from the image's own OCI label, so it is true even if a tag was moved.

2. **Never delete what the moving tag points at.** On Docker Hub, `frontend` and
   `frontend-sha-<commit>` sharing a digest means they are the same image.

3. **Map the rest back to history.** The suffix is the git short SHA, so a tag is one `git log`
   away from its commit:

   ```bash
   git log --oneline -15
   ```

   Anything older than the last five, and not live, is safe to remove.

Then delete them in the Docker Hub UI: **Repository → Tags**, sort by _Last pushed_, and delete from
the bottom. Deleting a tag never affects an image already pulled onto the server — only the ability to
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
           image    felzab/frankfurtleague:frontend
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

| Symptom                                                  | Cause and fix                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `failed to connect to the docker API at npipe:...`       | Docker Desktop is not running. Start it and wait for it to settle.            |
| `Invalid environment variables: <NAMES>` then no traffic | The startup environment gate. Fix those names in the relevant `.env`.         |
| `not a directory` from nginx                             | A mounted config file was missing, so Docker created a directory. `git pull`. |
| `EBUSY`, or `.next` locked during a build                | A `pnpm dev` is still running, or the folder is open in an editor.            |
| Deploy reports healthy but the site is unreachable       | Check nginx: `docker compose logs nginx`.                                     |
| A directory appeared named `something;C`                 | See the Windows note below.                                                   |

### Windows

Run the scripts from Git Bash. Do not hand-type `docker run -v` there: MSYS rewrites POSIX-looking
paths, so a container path becomes a Windows one and Docker creates a directory at the mangled name.
The Compose files declare every mount in YAML, where this cannot happen. If you must pass a container
path on a command line, prefix the command with `MSYS_NO_PATHCONV=1`.
