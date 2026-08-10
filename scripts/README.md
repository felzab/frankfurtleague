# Scripts

**Verified against:** `7555ecd`, 2026-08-10\
**Folder purpose:** the operational scripts for building, testing, running and deploying
Frankfurt-League, plus the checkers the verification gate runs.

## Folder overview

| Script             | Run on        | Purpose                                                       |
| ------------------ | ------------- | ------------------------------------------------------------- |
| `verify.sh`        | any           | The pre-merge gate — whole, or scoped to the surfaces touched |
| `local.sh`         | dev — Windows | Run the production image locally, behind nginx                |
| `publish.sh`       | dev — Windows | Build both images, tag with the commit, push to ghcr.io       |
| `deploy.sh`        | prod — Linux  | Pull and restart in place, verify health, roll back           |
| `selfcheck.sh`     | any           | Test the scripts themselves                                   |
| `ci_scopes.sh`     | any           | Map changed paths to gate scopes; the one copy CI reads       |
| `_lib.sh`          | —             | Shared helpers; sourced, never run directly                   |
| `check_docs.py`    | any           | The documentation gate                                        |
| `check_commits.py` | any           | The branch's commit messages                                  |
| `check_scope.py`   | any           | The scopes a run named, against the diff it was given         |
| `check_pr_body.py` | CI only       | A pull request body, which is not in the repository           |
| `ts_normalize.mjs` | any           | Whether two TypeScript files differ by anything but comments  |

**The scope table, the reasoning behind each scope, and the conventions every script shares are in
[`../docs/ops/spec.md`](../docs/ops/spec.md)** — `scripts/` is part of the ops surface. Each script's
own header carries its usage and prints it with `--help`.

## Which of these reach real users

`publish.sh` and `deploy.sh` do; everything else is safe to run at any time. On Windows, run them from
Git Bash — and never hand-type a `docker run -v` there, because MSYS rewrites POSIX-looking paths and
Docker then creates a directory at the mangled name. Prefix such a command with `MSYS_NO_PATHCONV=1`.

One generator lives outside this directory because it needs the frontend's own dependencies:
`fl_frontend/scripts/generate-brand-assets.mjs` (`pnpm brand` from `fl_frontend/`) regenerates every
brand asset from one parameterised source.

## Read next

- [`../docs/ops/spec.md`](../docs/ops/spec.md) — the gate's scopes, the environments, the output standard
- [`../docs/ops/runbooks.md`](../docs/ops/runbooks.md) — the recurring procedures these scripts serve
