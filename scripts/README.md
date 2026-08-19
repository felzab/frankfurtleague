# Scripts

**Verified against:** `889c31dd`, 2026-08-19\
**Folder purpose:** the operational scripts for building, testing, running and deploying
Frankfurt-League, plus the checkers the verification gate runs.

## Folder overview

| Path                              | Run on        | Purpose                                                               |
| --------------------------------- | ------------- | --------------------------------------------------------------------- |
| `scripts/verify.sh`               | any           | The pre-merge gate — whole, or scoped to the surfaces touched         |
| `scripts/local.sh`                | dev — Windows | Run the production image locally, behind nginx                        |
| `scripts/publish.sh`              | dev — Windows | Build both images, tag with the commit, push to ghcr.io               |
| `scripts/deploy.sh`               | prod — Linux  | Pull and restart in place, verify health, roll back                   |
| `scripts/selfcheck.sh`            | any           | Test the scripts themselves                                           |
| `scripts/ci_scopes.sh`            | any           | Map changed paths to gate scopes; the one copy CI reads               |
| `scripts/gate_pool.py`            | any           | The gate's scopes as concurrent processes, for `verify.sh` to replay  |
| `scripts/_lib.sh`                 | —             | Shared helpers; sourced, never run directly                           |
| `scripts/checker_kernel.py`       | —             | What every checker is built on; imported, never run directly          |
| `scripts/check_docs.py`           | any           | The documentation gate                                                |
| `scripts/docs_gate/`              | —             | The documentation gate's checks, one module per seam                  |
| `scripts/check_commits.py`        | any           | The branch's commit messages                                          |
| `scripts/check_scope.py`          | any           | The scopes a run named, against the diff it was given                 |
| `scripts/check_compose_mirror.py` | any           | The local stack against production, minus the differences it declares |
| `scripts/check_pr_body.py`        | CI only       | A pull request body, which is not in the repository                   |
| `scripts/ts_normalize.mjs`        | any           | Whether two TypeScript files differ by anything but comments          |
| `scripts/tests/`                  | any           | pytest over the documentation gate's own checks                       |
| `scripts/ruff.toml`               | —             | ruff's configuration for the python in this folder                    |
| `scripts/pyrightconfig.json`      | —             | pyright's configuration for the python in this folder                 |

**The scope table, the reasoning behind each scope, and the conventions every script shares are in
[`../docs/ops/spec.md`](../docs/ops/spec.md)**, which also says why the tool configurations sit here
rather than at the repository root.

## Which of these reach real users

`publish.sh` and `deploy.sh` do; everything else is safe to run at any time. On Windows, run them
from Git Bash, and prefix a hand-typed `docker run -v` with `MSYS_NO_PATHCONV=1` —
[`../docs/ops/spec.md`](../docs/ops/spec.md) §3 says what MSYS does to the path without it.

One generator sits outside this folder because it needs the frontend's own dependencies:
`fl_frontend/scripts/generate-brand-assets.mjs`, run as `pnpm brand` from `fl_frontend/`.

## Read next

- [`../docs/ops/spec.md`](../docs/ops/spec.md) — the gate's scopes, the environments, the output standard
- [`../docs/ops/runbooks.md`](../docs/ops/runbooks.md) — the recurring procedures these scripts serve
