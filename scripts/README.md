# Scripts

**Folder purpose:** the operational scripts for building, testing, running and deploying this
project, plus the checkers the verification gate runs.

## Folder overview

Every script below sits in one of five directories named for what it is: `gate/` the gate and the
pieces it drives, `checks/` the checkers it runs, `ops/` the machine-specific operator
scripts, `lib/` what the other four are built on, and `tests/` the python suite over all of it. The
two tool configurations sit at the top of this folder instead, in none of the five.

| Path                                    | Run on        | Purpose                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/gate/verify.sh`                | any           | The pre-merge gate — every scope, or the scopes a run names                                                                                                                                                                                                                                                                           |
| `scripts/gate/selfcheck.sh`             | any           | Test the scripts themselves                                                                                                                                                                                                                                                                                                           |
| `scripts/checks/check_compose_model.py` | any           | The models Compose renders: what each stack publishes, production's services, the edge's mounts and Control API socket, and the connector the edge trusts                                                                                                                                                                             |
| `scripts/checks/check_public_routes.py` | any           | Every App Router route handler against the edge locations that meter it, every link page and its trailing-slash twin against the link pages' zone pair, declared on one identical `limit_req` line per zone, every metadata convention against its recorded decision, and every exact-match location against the file that answers it |
| `scripts/ops/local.sh`                  | dev — Windows | Run the production image locally, behind nginx and a database of its own                                                                                                                                                                                                                                                              |
| `scripts/ops/seed/seed.js`              | dev, CI       | The made-up league `local.sh --seed-made-up` and `--e2e` load, run by mongosh inside the stack's database container                                                                                                                                                                                                                   |
| `scripts/ops/deploy.sh`                 | prod — Linux  | Pull and restart in place, verify health, roll back                                                                                                                                                                                                                                                                                   |
| `scripts/ops/export_journal.sh`         | prod — Linux  | Copy the erasure journal's lines out of the backend's logs into a host file per day, run hourly by a timer `docs/ops/runbooks.md` §7 installs                                                                                                                                                                                         |
| `scripts/ops/replay_journal.sh`         | prod — Linux  | After a restore, list every journal line between its snapshot and its end, and replay what they name, `docs/ops/runbooks.md` §13                                                                                                                                                                                                      |
| `scripts/lib/_lib.sh`                   | —             | The output standard: strict mode, the traps, the sections and the exit contract; sourced, never run                                                                                                                                                                                                                                   |
| `scripts/lib/checker_kernel.py`         | —             | What every checker is built on; imported, never run directly                                                                                                                                                                                                                                                                          |
| `scripts/tests/`                        | any           | pytest over the gate and the checkers this folder holds; the directory lists what is covered                                                                                                                                                                                                                                          |
| `scripts/ruff.toml`                     | —             | ruff's configuration for every python file below this folder                                                                                                                                                                                                                                                                          |
| `scripts/pyrightconfig.json`            | —             | pyright's configuration for every python file below this folder                                                                                                                                                                                                                                                                       |

## Which of these reach real users

`deploy.sh` does, and so does `./scripts/ops/local.sh --refresh-db`, which reads the
production database to fill the local one — it copies out and never writes back. `--seed` reaches
production only when there is no copy on disk yet. `export_journal.sh` reads the production
backend's logs and writes host files beside them, never a database. `replay_journal.sh` reads the
restored production database, and with `--apply` writes the person records and log rows its lines
name.
Everything else leaves production alone.

`--fresh` is still destructive locally: it removes the volumes, the copy under `.local-db`, the
edge's access log under `.tmp-nginx-log` and the mail sink under `.tmp-mail` in
`scripts/ops/local.sh :: section "preflight"`, ahead of `scripts/ops/local.sh :: section "build"`, so
a build that fails afterwards leaves neither an image nor a database. Nothing brings a local-only
fixture back — `--fresh` alone leaves the database empty, and `--seed` fills it from production,
which never held one. Rebuilding the images from the current tree needs no flag: a bare
`./scripts/ops/local.sh` builds unconditionally and keeps the volumes, and what proves the running
images are that tree is a check against the built artefact rather than the teardown. Take `--fresh`
when an empty database or a cleared Next cache is the point, and snapshot a local-only fixture first
in a form that preserves BSON types — plain JSON restores an ObjectId as a string, which then
matches its equally broken counterpart and reads as a working restore.

On Windows, run them from Git Bash, and prefix a hand-typed `docker run -v` with
`MSYS_NO_PATHCONV=1` —
[`../docs/ops/spec.md`](../docs/ops/spec.md) §3 says what MSYS does to the path without it.

The published document's writer lives in its package rather than here, needing the application's
own dependencies: `fl_backend/app/openapi_document.py`, which `pnpm run contract` in `fl_frontend`
runs and the `--db` scope's contract check compares with the tree, the document being composed from
the application's own routes, models and docstrings.

## Read next

- [`../docs/ops/spec.md`](../docs/ops/spec.md) — the naming scheme a new file goes into, the gate's
  scopes and the reasoning behind each, the environments, the conventions every script shares, and
  why the tool configurations sit here
- [`../docs/ops/runbooks.md`](../docs/ops/runbooks.md) — the recurring procedures these scripts serve
