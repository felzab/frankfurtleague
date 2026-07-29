# scripts/

Three environments, strictly separated. Every script names its target platform and refuses to run
against the wrong one.

| Environment      | What it is                                     | Runs where          | Entry point                   |
| ---------------- | ---------------------------------------------- | ------------------- | ----------------------------- |
| **dev**          | `next dev`, no Docker, hot reload              | Windows (your PC)   | `pnpm dev` in `fl_frontend/`  |
| **local**        | the production image, built and run locally    | Windows (your PC)   | `scripts/local.sh`            |
| **prod**         | published images, on the server                | Linux (the server)  | `scripts/deploy.sh`           |

## Why three and not two

**dev** is fast and lies to you. It runs the app from source with `SKIP_ENV_VALIDATION` off but no
Docker, so it never exercises the standalone build, the env gate, nginx, the CSP headers, or
`output: "standalone"` file tracing. Wave 3 found two defects that **every** dev-mode check passed:
`instrumentation.ts` at the repo root is silently dropped from the image, and a module-scope
`new URL(AUTH_URL)` fails only in the builder stage.

**local** is the same image prod runs, on your machine, behind the same nginx. It is the only place
those defects are visible before a deploy.

**prod** pulls published images and never builds. A server that builds is a server that can fail a
build.

## The scripts

| Script                          | Target   | What it does                                                          |
| ------------------------------- | -------- | --------------------------------------------------------------------- |
| `local.sh`                      | Windows  | Build + run the full local stack. `--fresh` wipes volumes first.       |
| `verify.sh`                     | Windows  | `pnpm verify` **and** the image build — the full pre-merge gate.       |
| `publish.sh`                    | Windows  | Build, tag with the git SHA, push. Refuses on a dirty tree.            |
| `deploy.sh`                     | Linux    | Pull a tag and restart. Verifies health; rolls back on failure.        |
| `revalidate_reference_data.sh`  | Linux    | Drop the frontend cache for one reference resource (BE-3 runbook).     |
| `_lib.sh`                       | —        | Shared helpers. Not run directly.                                     |

## Windows: run these from Git Bash, but never `docker run -v` by hand

Git Bash (MSYS) rewrites arguments that look like POSIX paths. A hand-typed
`docker run -v ./nginx.conf:/etc/nginx/conf.d/default.conf` becomes
`./nginx.conf;C:/Program Files/Git/etc/...`, and Docker then **creates a directory** called
`nginx.conf;C`. That is where the two empty `nginx.conf;C` / `nginx.local.conf;C` directories in this
repo came from. They are now gitignored, but the fix is not to type such commands: the compose files
already declare every mount, and compose reads them from YAML where MSYS cannot interfere.

If you ever must pass a container path on a command line, prefix the command with `MSYS_NO_PATHCONV=1`.

## Common failures, and what they actually mean

| Symptom                                                    | Cause                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `failed to connect to the docker API at npipe:...`         | Docker Desktop is not running. Start it and wait for the whale to settle.    |
| `unable to prepare context: path "fl_frontend" not found`  | Wrong working directory. These scripts `cd` to the repo root themselves.     |
| `Invalid environment variables: <NAMES>` then no traffic   | The env gate working as designed. Fix those variables in the `.env`.         |
| `EBUSY` / `.next` locked during a build                    | A `next dev` is still running, or the folder is open in an editor/terminal.  |
| A directory appeared named `something;C`                   | See the Git Bash section above.                                             |
