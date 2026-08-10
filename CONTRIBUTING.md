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
  [`docs/_roadmap/open-items.md`](docs/_roadmap/open-items.md) with their full reasoning, rather than
  in the tracker.

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

Run the gate before opening the PR:

```bash
./scripts/verify.sh --quick
```

CI runs the same script's scopes as parallel jobs, mapped to the paths your PR touches, and `main`
requires the aggregate `verify` check to pass. The full form — no flags — also builds both Docker
images, and is what you want if you touched `src/core/config.ts`, `src/core/auth.ts`,
`src/instrumentation.ts`, or anything about packaging; CI builds the images for exactly those paths
on a pull request. [`scripts/README.md`](scripts/README.md) covers the rest of the tooling,
including the scope flags and the Windows-specific traps.

## Licence

This project is under the [Elastic License 2.0](LICENSE) — source-available, not open source. By
contributing you agree your contribution is licensed on the same terms. The name, the logo and the
league's data are **not** covered by that licence.
