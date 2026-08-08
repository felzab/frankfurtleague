# ADR-0037 — The gate refuses a run that skips the image build, and only reports the rest

**Status:** Accepted
**Date:** 2026-08-05
**Surface:** ops
**Supersedes:** —
**Superseded by:** —
**Source:** Roadmap item OPS-7, closed 2026-08-05

## Context

`scripts/verify.sh` takes scope flags naming the surfaces a change touched, and **nothing read the
diff back**. The scope was whatever the author typed. Three pages state the rule it should follow —
CLAUDE.md's gate section, `scripts/README.md` and `docs/workflows/README.md` — including its
carve-out: a comment-only edit is a documentation change whatever file holds it, so correcting a
citation inside `fl_frontend/src/core/config.ts` is `--docs` and not the full form.

The two ways of getting that wrong are not comparable. A full gate for a comment costs minutes of
Docker and nothing else. A `--docs` run for a change that reaches the image means the packaging
build never ran before the push, and packaging is the one class the frontend toolchain cannot see:
code that compiles can still fail to build inside the image, or be dropped from
`output: "standalone"` entirely.

**Two facts about the pipeline decided the shape of the answer.**

- **CI already enforces the floor, by path.** `scripts/ci_scopes.sh` maps a changed path to scopes
  conservatively — an unrecognised path turns every scope on — and `.github/workflows/verify.yml`'s
  aggregate `verify` job is a required status check on `main`. A change to a packaging path builds
  both images before it can merge, whatever the author ran locally. So the mistake this is about
  cannot reach production through the merge button; it reaches a **red CI run**, minutes after a
  push, on a branch whose author believed it was finished.
- **A check that refuses a legitimate run gets suppressed.** `verify.sh` is invoked mid-work with one
  scope as often as it is invoked as a gate, and there is nothing in the invocation that
  distinguishes the two. Refusing every under-covering run would refuse most correct ones.

## Decision

**`scripts/check_scope.py` runs first in every local `verify.sh` invocation, compares the scopes named
against the branch's own diff, and splits its findings the way the two checkers before it do.**

- **It fails on one thing:** the diff asks for the images scope, that scope did not run, and the
  change to at least one of the files asking for it is more than comments. That is the floor.
- **It reports everything else** — any other scope the diff asks for that did not run, and the
  formatter when no frontend scope ran to carry it.
- **The path mapping is `scripts/ci_scopes.sh`, through a new `--stdin` mode**, so the repository
  keeps one copy of it rather than growing a second that drifts.
- **A change counts as comments only where a parser proves it**: TypeScript through its own parser
  and printer (`scripts/ts_normalize.mjs`), Python through `ast` with docstrings stripped, TOML
  through `tomllib`. Everything else is code, Dockerfiles, YAML and shell included.
- **The classifier may only suppress a complaint.** It never removes a CI job, and it never widens
  what a run is held to. CI's mapping stays purely path-based.
- **It is skipped in CI**, where the scopes are separate jobs an aggregate check combines and the
  mapping is derived rather than typed.

## Consequences

- The mistake is now caught before the push instead of by a red CI run, which is where it is
  cheapest to fix. That is the whole benefit, and it is a feedback-time benefit rather than a new
  guarantee — CI's floor was already there.
- `verify.sh` no longer ends with a blanket warning that the image build did not run. It fired on
  every scoped invocation regardless of the diff, which is the definition of a check nobody reads;
  the new one names the file.
- A mid-work `--frontend` run on a branch that touched `next.config.ts` now fails. That is the cost
  of the floor being a floor, and the message names the flag that satisfies it.
- The classifier can only ever be too conservative, and being too conservative costs the minutes in
  the table above. A Dockerfile whose only change is a comment still asks for the full form.
- `verify.sh` gains a dependency on **any** python — not the backend virtualenv — plus node for the
  TypeScript half. Both are absent-tolerant: a missing interpreter skips the check with a line
  saying so, and a missing toolchain makes the classifier answer "code".

## Alternatives considered

**A second CI check, so the rule binds there too.** Rejected on the evidence above: `ci_scopes.sh`
maps paths conservatively and the `verify` job is required, so CI already refuses to merge a
packaging change whose images job did not pass. A check comparing CI's scopes to CI's own mapping
would compare a value with itself.

**Let the classifier shrink CI's scopes**, skipping the images job for a comment-only change to a
packaging path — the ceiling rather than the floor. Rejected because a classifier bug then removes
the build that catches packaging breaks, converting a conservative check into the exact failure it
exists to prevent. The waste it would save is minutes of Docker on a rare change.

**Pick the scope for the author instead of checking it.** Rejected for the same reason: an inferred
scope is trusted, and a wrong inference is silent. A refusal is read.

**Fail on every under-covering scope, not just images.** Rejected because `verify.sh --frontend`
mid-work is a legitimate invocation and nothing in it says whether a push follows, so the check
would fail correct runs until somebody stopped running it (`docs/_standard/5-currency.md`).

**A `--partial` flag to acknowledge a deliberately narrow run.** Rejected as a suppression switch
for the one finding that must not be suppressible; the reported findings need no acknowledgement
because they do not fail anything.

**A line-level `#` and `//` rule instead of parsers.** Rejected because it is wrong exactly where it
matters: a `//` inside a string or a regular expression is not a comment, and neither is a `#` inside
a Dockerfile heredoc. Where no parser is available the answer is "code", not a rule stretched to
cover it.
