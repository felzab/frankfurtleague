# scripts/

## Which machine runs what

**Check this table before running anything.** Each script enforces its own row and refuses to start on
the wrong machine, so a mistake costs you a message instead of an outage.

| Script                         | RUN IT ON              |  Needs Docker?  |   Affects real users?    |
| ------------------------------ | ---------------------- | :-------------: | :----------------------: |
| `pnpm dev` (not a script)      | **your PC** — Windows  |       no        |            no            |
| `local.sh`                     | **your PC** — Windows  |       yes       |            no            |
| `verify.sh`                    | **your PC** — Windows  |       yes       |            no            |
| `selfcheck.sh`                 | **either machine**     | only for step 8 |            no            |
| `publish.sh`                   | **your PC** — Windows  |       yes       | **yes** — uploads images |
| `deploy.sh`                    | **the server** — Linux |       yes       |   **yes** — goes live    |
| `revalidate_reference_data.sh` | **the server** — Linux |       yes       |   yes — clears a cache   |
| `_lib.sh`                      | never run directly     |        —        |            no            |

Only two scripts reach real users: **`publish.sh`** uploads, **`deploy.sh`** goes live. Everything
else you can run as often as you like.

`selfcheck.sh` is the odd one out: it tests the other scripts rather than doing anything to the
project, so it is safe anywhere and needs no Docker unless you want its shellcheck step. **You rarely
run it directly — `verify.sh` runs it first.**

---

## The full cycle, start to finish

Read this once; after that each step tells you the next one.

### 1. Write code — your PC

```bash
cd fl_frontend && pnpm dev
```

Fast and hot-reloading, all day. **But it is not the real thing** — no Docker, no nginx, no security
headers, no startup checks. Treat it as a rehearsal.

### 2. Check it properly — your PC

```bash
./scripts/verify.sh
```

Types, lint, formatting, tests, dependency advisories, **and both Docker images actually building**.
That last part earns its minutes: `pnpm verify` alone has been green while the image was broken, twice.

In a hurry, `--quick` skips the image build — but **not** if you touched `src/core/config.ts`,
`src/core/auth.ts` or `src/instrumentation.ts`.

### 3. See it the way production sees it — your PC

```bash
./scripts/local.sh
```

Runs the **real production image** on your machine, behind the real nginx, and waits until it reports
healthy. This is the only place before deployment where the standalone build, the startup environment
gate and the security headers are genuinely exercised.

Then open <http://localhost:3000>. Stop with `./scripts/local.sh --down`.

### 4. Upload it — your PC

```bash
./scripts/publish.sh
```

Builds both images, stamps each with the commit it came from, and pushes. Refuses to run with
uncommitted changes, because a tag naming a commit must be rebuildable from that commit. Prints the
deploy command when it finishes.

### 5. Make it live — the server

```bash
git pull            # so nginx/prod.conf and the compose files are current
./scripts/deploy.sh
```

Pulls the images, restarts the containers **in place** — seconds of interruption, not minutes — waits
for both services to report healthy, then prints the live security headers.

### 6. If something is wrong — the server

```bash
./scripts/deploy.sh --status        # what is running, and from which commit?
./scripts/deploy.sh sha-1a2b3c4     # go back to a known-good build
```

`deploy.sh` records the live commit **before** changing anything, and prints the exact rollback
command for you if the new version fails to become healthy.

---

## Do you need to remember tags? No.

**The everyday path never mentions one.** `publish.sh` moves the `frontend` and `backend` tags to your
newest build every time it runs, and `deploy.sh` with no arguments pulls those tags. So

```bash
./scripts/publish.sh      # your PC
./scripts/deploy.sh       # the server
```

always means "the latest thing I published".

**Tags exist only for going backwards.** Alongside the moving pointers, every publish also creates a
permanent `frontend-sha-<commit>` and `backend-sha-<commit>`. You never type those from memory — you
read them off `--status`, or off the message `deploy.sh` prints when a deployment fails.

**And you never have to trust a tag name**, because the commit is baked into the image itself:

```
$ ./scripts/deploy.sh --status
frontend:  healthy
           image    felzab/frankfurtleague:frontend
           commit   1a2b3c4
           built    2026-07-30T09:12:44Z
```

A tag is a pointer someone can move. That `commit` line is compiled in and cannot drift.

---

## Why three environments and not two

**dev** is fast and lies to you. It runs the app from source with no Docker, so it never exercises the
standalone build, the environment gate, nginx, the security headers, or `output: "standalone"` file
tracing. Wave 3 found two defects that **every** dev-mode check passed: `instrumentation.ts` at the
repo root is silently dropped from the image, and a module-scope `new URL(AUTH_URL)` fails only in the
builder stage.

**local** is the same image prod runs, on your machine, behind the same nginx. It is the only place
those defects are visible before a deploy.

**prod** pulls published images and never builds. A server that builds is a server that can fail a
build — at the worst moment, with the site down and no known-good image to fall back to.

## Changing anything in `scripts/`? Run the self-check

```bash
./scripts/selfcheck.sh
```

`bash -n` checks **syntax only**. It cannot see that a script calls a function which does not exist,
because that surfaces at run time. Exactly that shipped once: a helper in `_lib.sh` was renamed from
`require_env_file` to `require_file`, `deploy.sh` was updated, `local.sh` was not, every syntax check
passed, and it failed the first time a human ran it.

`selfcheck.sh` closes that gap. **`verify.sh` runs it first, so it cannot be forgotten.** Eight checks:

| #   | Check                                           | Why it exists                                                                                                                                                                       |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | every script parses                             | baseline                                                                                                                                                                            |
| 2   | **line endings are LF**                         | CRLF makes a script fail outright on Linux: `bad interpreter: /usr/bin/env bash^M`. `deploy.sh` runs on Linux. Windows tolerates CRLF, so this is invisible where it is introduced. |
| 3   | **every helper called is defined**              | the check that was missing                                                                                                                                                          |
| 4   | `--help` works from an unrelated directory      | catches a relative path that stops resolving after `_lib.sh` changes directory                                                                                                      |
| 5   | unknown options are rejected without Docker     | catches an argument loop placed after an environmental check                                                                                                                        |
| 6   | each script declares a target platform          | stops a prod script running on a laptop                                                                                                                                             |
| 7   | **`--help` matches the flags the code accepts** | catches documentation drifting from behaviour                                                                                                                                       |
| 8   | **shellcheck**                                  | a local binary if present, otherwise the official Docker image                                                                                                                      |

You do not need to install shellcheck: with Docker running, check 8 uses `koalaman/shellcheck:stable`
automatically. It is the only step that needs Docker.

## What the audit of these scripts found

They were audited the same way as the application code — shellcheck, plus a read of every line, plus
tests of the failure paths. Five real defects, all fixed:

- **`local.sh` exited 1 on a completely successful run.** The last line was
  `(( FOLLOW )) && docker compose logs -f`, and `(( 0 ))` evaluates to 1, so the script's exit status
  was 1 whenever `--logs` was not passed. Any automation checking the exit code read every success as
  a failure. Now an `if` block.
- **A renamed sentinel broke its own consumers.** `image_revision` was changed to return a
  human-readable "unlabelled (…)" string, but `deploy.sh` still compared against the previous
  sentinel and interpolated the result into a suggested command — it would have printed
  `./scripts/deploy.sh sha-unlabelled (image predates…)`. The helpers now return the raw value or
  empty, with formatting split into `image_revision_display`. Same class as the `require_env_file`
  rename above: change a name, miss a caller.
- **CRLF line endings throughout the working tree**, introduced by the tooling that wrote them.
  `.gitattributes` meant the committed form was LF and the server was never at risk, but shellcheck
  was unusable and one copied file would have broken the deploy. Now checked.
- **A malformed rollback tag reached the registry** and returned an opaque `manifest unknown`.
  `deploy.sh` now validates the shape first and names the problem.
- **`nginx` was never verified after a deploy.** It has no healthcheck to wait on, so "Deploy healthy"
  could print while the site was unreachable. Now reported explicitly.

Two of those were found only by _running_ the failure path rather than reading it — which is why
check 5 in the table above tests behaviour, not text.

## Every script supports `--help`

It prints the script's own header comment, so the documentation cannot drift away from the behaviour.

```bash
./scripts/deploy.sh --help
```

## When a script fails

Failures are designed to be self-explanatory. Three shapes:

**A guard refused** — one line saying what is missing and what to do:

```
✗  Missing required file: nginx/prod.conf
   nginx mounts this read-only; if it is missing, Docker creates a DIRECTORY
   at that path and nginx fails with 'not a directory'.
```

**An unexpected command failed** — the script name, the line, and the exact command:

```
✗  deploy.sh failed
   line 87:  docker pull felzab/frankfurtleague:frontend
   exit status 1
```

**A service came up unhealthy** — the script prints the application's own explanation, filtered to the
lines that matter, and then the rollback command.

## Windows: run these from Git Bash, but never `docker run -v` by hand

Git Bash (MSYS) rewrites arguments that look like POSIX paths. A hand-typed
`docker run -v ./nginx/prod.conf:/etc/nginx/conf.d/default.conf` becomes
`./nginx/prod.conf;C:/Program Files/Git/etc/...`, and Docker then **creates a directory** at the
mangled path. That is where the two empty `nginx.conf;C` / `nginx.local.conf;C` directories came from.
They are gitignored now, but the fix is not to type such commands: the compose files already declare
every mount, and compose reads them from YAML where MSYS cannot interfere.

If you ever must pass a container path on a command line, prefix it with `MSYS_NO_PATHCONV=1`.

## Common failures, and what they actually mean

| Symptom                                                   | Cause                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `failed to connect to the docker API at npipe:...`        | Docker Desktop is not running. Start it and wait for it to settle.            |
| `unable to prepare context: path "fl_frontend" not found` | Wrong working directory. These scripts `cd` to the repo root themselves.      |
| `Invalid environment variables: <NAMES>` then no traffic  | The environment gate working as designed. Fix those names in the `.env`.      |
| `not a directory` from nginx                              | A mounted config file was missing, so Docker created a directory. `git pull`. |
| `EBUSY` / `.next` locked during a build                   | A `pnpm dev` is still running, or the folder is open in an editor.            |
| A directory appeared named `something;C`                  | See the Git Bash section above.                                               |
