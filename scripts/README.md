# Scripts

The scripts that check, run and deploy this project. Each script's header is its usage, and
`--help` prints it. On Windows, run them from Git Bash.

| Path                                    | Run on        | Purpose                                                                                         |
| --------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `scripts/gate/verify.sh`                | any           | The pre-merge gate: every scope, or the scopes a run names                                      |
| `scripts/gate/selfcheck.sh`             | any           | Every shell script parses, is executable in git and lints clean, and every workflow lints clean |
| `scripts/gate/zizmor/requirements.txt`  | —             | The zizmor release the ops scope installs, by its hashes                                        |
| `scripts/checks/check_compose_model.py` | any           | Each stack's rendered Compose model against what it may publish, mount, trust and hand out      |
| `scripts/checks/check_public_routes.py` | any           | Every route handler, link page and metadata convention against the edge location metering it    |
| `scripts/ops/local.sh`                  | dev — Windows | The production images built from this tree, behind nginx, with a database of its own            |
| `scripts/ops/seed/seed.js`              | dev, CI       | The made-up league `local.sh --seed-made-up` and `--e2e` load                                   |
| `scripts/ops/deploy.sh`                 | prod — Linux  | Put one published build live by its tag, and go back to the build before it if it fails         |
| `scripts/lib/_lib.sh`                   | —             | Strict mode, the traps, the output verbs and the exit contract; sourced, never run              |
| `scripts/lib/checker_kernel.py`         | —             | The repository root and the exit contract every checker shares; imported, never run             |
| `scripts/tests/`                        | any           | pytest over the gate's scripts and the checkers                                                 |
| `scripts/ruff.toml`                     | —             | ruff's configuration for the Python below this folder                                           |
| `scripts/pyrightconfig.json`            | —             | pyright's configuration for the Python below this folder                                        |

**`deploy.sh` is the one script that reaches production.** Every other script stays on the machine
it runs on. `local.sh --fresh` deletes the local stack's volumes, and with them its database and
Next's build cache.

## Read next

- [`../docs/ops/spec.md`](../docs/ops/spec.md): the gate's scopes, the environments, and the
  conventions every script shares
- [`../docs/ops/runbooks.md`](../docs/ops/runbooks.md): the procedures these scripts serve
