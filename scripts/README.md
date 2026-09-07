# Scripts

**Folder purpose:** the operational scripts for building, testing, running and deploying this
project, plus the checkers the verification gate runs.

## Folder overview

Every script below sits in one of five directories named for what it is: `gate/` the gate and the
pieces it drives, `checks/` the checkers it runs, `ops/` the machine-specific operator
scripts, `lib/` what the other four are built on, and `tests/` the python suite over all of it. The
two tool configurations sit at the top of this folder instead, in none of the five.

| Path                                          | Run on        | Purpose                                                                                                                              |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/gate/verify.sh`                      | any           | The pre-merge gate — whole, or scoped to the surfaces touched                                                                        |
| `scripts/gate/selfcheck.sh`                   | any           | Test the scripts themselves                                                                                                          |
| `scripts/gate/scope_map.sh`                   | any           | Map changed paths to gate scopes; the one copy CI reads                                                                              |
| `scripts/gate/gate_pool.py`                   | any           | The gate's units as concurrent processes, for `verify.sh` to replay                                                                  |
| `scripts/checks/check_docs.py`                | any           | The documentation gate                                                                                                               |
| `scripts/checks/docs_gate/`                   | —             | The documentation gate's package: every check `scripts/checks/docs_gate/kernel.py :: CHECKS` registers, and the readers they share   |
| `scripts/checks/check_commits.py`             | any           | The branch's commit messages                                                                                                         |
| `scripts/checks/check_scope.py`               | any           | The scopes a run named, against the diff it was given                                                                                |
| `scripts/checks/check_compose_mirror.py`      | any           | The local stack against production, minus the differences it declares                                                                |
| `scripts/checks/check_nginx_mirror.py`        | any           | The local edge against production's, directive by directive, minus the differences it declares                                       |
| `scripts/checks/check_csp_identity.py`        | any           | Each nginx file's Content-Security-Policy copies against that file's first                                                           |
| `scripts/checks/check_public_routes.py`       | any           | Every App Router route handler against the edge locations that meter it, and every metadata convention against its recorded decision |
| `scripts/checks/check_regenerate_spelling.py` | any           | Every file printing the command that regenerates `openapi.json`, against the spelling the backend declares                           |
| `scripts/checks/check_log_quoting_class.py`   | any           | The console format's quoting class in one package against the other's, character by character                                        |
| `scripts/checks/check_test_estate.py`         | any           | The backend suite's silent shapes: a db read in the wrong tier, an empty parametrize, an unconsumed fixture                          |
| `scripts/checks/check_conflict_markers.py`    | any           | Every tracked file, for a merge conflict marker left in it                                                                           |
| `scripts/checks/check_pr_body.py`             | CI only       | A pull request body, which is not in the repository                                                                                  |
| `scripts/checks/check_gate_budget.py`         | any           | The gate's wall-clock budget: a run's jobs against their ceilings, and a raised figure against its measurement                       |
| `scripts/checks/ts_normalize.mjs`             | any           | Whether two TypeScript files differ by anything but comments                                                                         |
| `scripts/ops/local.sh`                        | dev — Windows | Run the production image locally, behind nginx and a database of its own                                                             |
| `scripts/ops/publish.sh`                      | dev — Windows | Build both images, tag with the commit, push to ghcr.io                                                                              |
| `scripts/ops/deploy.sh`                       | prod — Linux  | Pull and restart in place, verify health, roll back                                                                                  |
| `scripts/ops/make-icons.mjs`                  | dev — either  | Redraw the committed rasters from `fl_frontend/src/app/icon.svg`; `--out` writes elsewhere for a comparison                          |
| `scripts/lib/_lib.sh`                         | —             | The output standard: strict mode, the traps, the sections and the exit contract; sourced, never run                                  |
| `scripts/lib/checker_kernel.py`               | —             | What every checker is built on; imported, never run directly                                                                         |
| `scripts/tests/`                              | any           | pytest over the gate and the checkers this folder holds; the directory lists what is covered                                         |
| `scripts/ruff.toml`                           | —             | ruff's configuration for every python file below this folder                                                                         |
| `scripts/pyrightconfig.json`                  | —             | pyright's configuration for every python file below this folder                                                                      |

**The naming scheme a new file goes into, the scope table, the reasoning behind each scope, and the
conventions every script shares are in [`../docs/ops/spec.md`](../docs/ops/spec.md)**, which also
says why the tool configurations sit here rather than at the repository root.

## Which of these reach real users

`publish.sh` and `deploy.sh` do, and so does `./scripts/ops/local.sh --refresh-db`, which reads the
production database to fill the local one — it copies out and never writes back. `--seed` reaches
production only when there is no copy on disk yet. Everything else leaves production alone.

`--fresh` is still destructive locally: it removes the volumes, the copy under `.local-db` and the
edge's access log under `.tmp-nginx-log` in
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

One runs from outside this folder, because it needs its package's own dependencies:
`fl_backend/tests/openapi_document.py`, which the `--docs` scope runs in `--check` mode because the
published document is composed from the application's own docstrings
([`../docs/ops/spec.md`](../docs/ops/spec.md) §1.6).

## Read next

- [`../docs/ops/spec.md`](../docs/ops/spec.md) — the gate's scopes, the environments, the output standard
- [`../docs/ops/runbooks.md`](../docs/ops/runbooks.md) — the recurring procedures these scripts serve
