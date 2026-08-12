# Contributing

Thanks for looking. This is a school league site maintained by one person alongside other work, so
replies take a few days.

## Reporting something

- **A bug or a wrong result on the site** — [open an
  issue](https://github.com/felzab/frankfurtleague/issues/new/choose) using the bug form. If you saw
  an error page, include its **digest**: that string is written to the server log, and it turns a
  report into an exact stack trace.
- **A suspected vulnerability** — **not** a public issue. Follow [`SECURITY.md`](SECURITY.md), which
  also says what is in and out of scope.
- **An idea that needs thinking through before anyone can decide on it** — those live in
  [`docs/_roadmap/`](docs/_roadmap/) with their full reasoning, rather than in the tracker.

## Changing code

Fork, branch from `main`, open a pull request. Before you do, two things are worth ten minutes:

- [`docs/_git/`](docs/_git/) — branching, commits, pull requests and the verification gate, with the
  reasoning for each. Its sibling
  [`templates.md`](docs/_git/templates.md) has the copy-paste forms for commit
  messages and PR bodies.
- [`docs/_decisions/`](docs/_decisions/) — the ADRs. Several patterns in this codebase look wrong at
  a glance and are deliberate, each with a recorded argument. If you think one is mistaken, say so
  in an issue rather than changing it.

Two conventions that are load-bearing rather than stylistic:

- **Commit bodies are the documentation here.** They explain why, record what was verified and how,
  and name where an earlier assumption turned out to be wrong. That is why merges are never
  squashed. Please write them that way.
- **A change that invalidates a documented claim updates that documentation in the same commit.**

### What a clone needs

Development is on Windows with Git Bash and the server is Linux. The shell scripts under `scripts/`
— the gate among them — run under bash, so reach for Git Bash rather than PowerShell.

| Tool       | Which version, and where it is declared                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| **Node**   | what [`fl_frontend/package.json`](fl_frontend/package.json) declares under `engines` |
| **pnpm**   | `packageManager` in that same file, which pins it exactly                            |
| **Python** | [`fl_backend/.python-version`](fl_backend/.python-version)                           |
| **uv**     | no manifest declares a version                                                       |
| **Docker** | for the gate scopes that need a daemon, and for running the stack locally            |

**uv is the prerequisite nothing in the repository declares.** It is what builds the backend
virtualenv, and it reads the Python version declared above;
[install it first](https://docs.astral.sh/uv/getting-started/installation/). CI installs it with
`astral-sh/setup-uv`.

**Node and pnpm are yours to install.** `packageManager` is corepack's contract, but nothing here
uses corepack: [`fl_frontend/Dockerfile`](fl_frontend/Dockerfile) installs pnpm globally at the
pinned version, which is the route to match on a development machine.

Then, once per clone, from the repository root:

```bash
(cd fl_backend  && uv sync --dev)   # the virtualenv every checker and the backend tests run from
(cd fl_frontend && pnpm install)    # what tsc, eslint, next build and prettier read
git config core.hooksPath .githooks # the commit-message check, and the formatter that runs on commit
```

The hooks are opt-in per clone: without that last line the gate and CI are the only checks
([`docs/_git/spec.md`](docs/_git/spec.md) §1.3, and [`docs/ops/spec.md`](docs/ops/spec.md) §1.6 for
the formatter).

**The gate needs no `.env` file.** [`scripts/verify.sh`](scripts/verify.sh) passes placeholder values
to `next build` and creates empty stand-ins for the compose parse, removing them again on the way
out. Running the application does need real credentials, and those are not in the repository.

Run the gate before opening the PR:

```bash
./scripts/verify.sh
```

The bare form runs every scope, the image builds included, and is the answer whenever you are
unsure. Scope flags name surfaces and combine — `--quick` is the scopes that need no Docker — but
before any of them runs, the gate compares the scopes you named against your diff and **refuses a
run too narrow for the image build**, naming the files that ask for it and the flag to add
([ADR-0030](docs/_decisions/0030-the-gate-refuses-an-undersized-scope.md)). A change that reaches
packaging is stopped rather than half-checked, whichever flags you typed.

CI runs the same scopes as parallel jobs, mapped from the paths your PR touches, and `main` requires
the status checks [`docs/_git/spec.md`](docs/_git/spec.md) §1.6 records. The scope table, and what
each scope needs, is in [`docs/ops/spec.md`](docs/ops/spec.md) §1.6;
[`scripts/README.md`](scripts/README.md) maps the tooling and the Windows-specific traps.

**The gate checks formatting rather than fixing it**
([ADR-0065](docs/_decisions/0065-formatting-happens-at-commit-time.md)), so a formatting failure is
yours to resolve: `pnpm format` from `fl_frontend/` reformats the whole repository
([`docs/_git/spec.md`](docs/_git/spec.md) §1.5).

## Licence

This project is under the [Elastic License 2.0](LICENSE) — source-available, not open source. By
contributing you agree your contribution is licensed on the same terms. The name, the logo and the
league's data are **not** covered by that licence.
