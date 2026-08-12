# ADR-0065 — Formatting happens at commit time, and the gate only checks

**Status:** Accepted\
**Date:** 2026-08-10\
**Surface:** ops, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My decision of 2026-08-10, taken while rebuilding `scripts/verify.sh` and the CI
workflows.

## Context

Prettier governs markdown, YAML, JSON, CSS and TypeScript across this repository, and the gate was
what held the tree to it: the formatter ran in write mode as the frontend scope's first step, and
every step after it measured a tree the gate had just rewritten. Three costs came with that, and
each was paid on real runs.

- **A run that proves a branch also changes it.** A gate is evidence about a state, and the state it
  reported on was not the one it had been pointed at.
- **What came back was a second commit carrying nothing but whitespace**, landing after the author
  had finished — and a whitespace delta across `/docs` is what a documentation restamp then
  cascades from, so the cost did not stop at the commit.
- **CI carried a whole-tree diff guard whose only job was to notice the formatter's writes.** A
  check that rewrites the tree needs a second check watching it.

There was also a branch this must never happen on. `main` is protected, a gate run is exactly what
somebody does on `main` before deciding to branch, and a formatter invoked without a path argument
names no file for anything to guard.

## Decision

**Formatting moves to commit time. Prettier runs in write mode in one place and in check mode
everywhere else.**

- **`.githooks/pre-commit` formats the staged files and stages the result**, so a commit is born
  formatted.
- **What reaches the commit is prettier's output for the index copy, never the worktree's.** The
  staged files are formatted in place first; each file that moved is then formatted a second time
  from its own index blob through `--stdin-filepath`, and that output is hashed straight into the
  index — so an editor autosave, or a second session writing while prettier runs, cannot put
  unstaged content into the commit. Where the worktree moved underneath after that first pass, the
  hook names those files and leaves them as their writer left them.
- **A partially-staged file is refused**, with both of the commands that resolve it. Formatting it
  would carry the unstaged half into the commit, and the two ways out are different commits.
- **No formatter runs in write mode outside that hook** — `scripts/verify.sh`'s `format` scope and
  the `format` job in `.github/workflows/verify.yml` both run `pnpm format:check`, and Python is held
  the same way by `ruff format --check`. So no gate run and no CI job reformats a tracked file, on
  any branch. This is a statement about formatters and not about writes in general: the frontend
  scope also runs `next build`, which writes a tracked file of its own, and the Consequences below
  say what holds that.
- **The hook is convenience and never enforcement**, exactly as `.githooks/commit-msg` is. A clone
  that has not run `git config core.hooksPath .githooks` has no hook, and one that has not installed
  the frontend has no prettier; where prettier is absent the hook stands aside and says so. The gate
  and CI are what bind, which is what keeps this decision from depending on a local setting.

## Consequences

- **A bulk commit is slow.** Each reformatted file is formatted a second time on its own, from its
  index blob, because the index copy is the thing that gets committed. The hook says how many and
  points at `pnpm format` as the way to leave it nothing to do.
- **A commit made with `--no-verify`, or on a clone with no hooks path, reaches the gate
  unformatted** and fails there rather than being fixed where it was free. The enforcement boundary
  is where it always was; only the convenience moved.
- **Windows' command-line ceiling is a real bound here**, because the formattable tree's path
  arguments already cost most of it. The hook batches under a budget rather than passing one list
  (`.githooks/pre-commit :: ARGV_BUDGET`), and a file kind added to
  `.githooks/pre-commit :: formattable` moves that cost toward the ceiling rather than the ceiling
  away from it.
- **What prettier does not parse is formatted by nobody.** Shell scripts and Dockerfiles have no
  formatter in this repository, and adding one would be a second regime rather than an extension of
  this one.
- **One tracked file is still written by a gate run, and it is not a formatter that writes it.**
  `next build` calls Next's `writeConfigurationDefaults`, which rewrites `fl_frontend/tsconfig.json`
  whenever a `compilerOptions` key it checks for is absent — its own serialisation, not prettier's,
  and the reason `fl_frontend/tsconfig.json` declares `allowJs` rather than omitting it. Locally the
  dirty tree shows it; on a runner the repaired copy is discarded with the workspace, so CI carries
  a diff guard scoped to that one path in `.github/workflows/verify.yml`. **That guard is not a
  survival of the whole-tree one this decision retired, and this decision is not grounds for
  deleting it** — the retired guard compensated for a formatter that wrote, and this one detects a
  framework that does. A future upgrade reaching the same condition is exactly what it is there for.

## Alternatives considered

**Keep the write in the gate.** The cheapest option, since it asks for no new machinery anywhere.
Rejected on the three costs above, of which the first decides it: a check that rewrites the tree
cannot be evidence about the tree it was asked to judge, and the steps that ran after the rewrite
measured something nobody had authored.

**Format in CI and push the result.** Rejected because it needs a token that can write to the
repository, and because the commit it produces is not the commit anybody reviewed — on `main` it is
also a push to a branch that protection refuses.

**Biome in place of prettier.** Rejected on coverage. Biome's formatter covers JavaScript,
TypeScript, JSON, CSS and GraphQL, with markdown and YAML both listed as in progress (biomejs.dev,
language support, read 2026-08-11) — and markdown and YAML are most of what this repository's
formatter is pointed at. A switch would also drop the import-order and Tailwind class-order plugins,
so it adds a configuration and a second regime instead of replacing one.

**Merge the unstaged half rather than refusing a partially-staged file.** Rejected because
committing content the author did not stage is the failure this hook exists to avoid, and nothing
available to the hook can tell whether the unstaged half belonged in this commit or the next one.
