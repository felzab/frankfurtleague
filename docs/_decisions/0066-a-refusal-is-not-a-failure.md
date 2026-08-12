# ADR-0066 — A checker answers four exit codes, and a refusal is not a failure

**Status:** Accepted\
**Date:** 2026-08-10\
**Surface:** ops\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My decision of 2026-08-10, taken with the output standard for `scripts/`, after a
checker that could not parse itself on an older interpreter had exited with the findings code and
refused every commit as though the message were wrong.

## Context

The Python checkers under `scripts/` are run by `scripts/verify.sh`, by the git hooks and by CI, and
all three learn what happened from one number. Under the ordinary convention — zero for success,
non-zero for everything else — three different events arrive as the same one:

- **the check judged the change and found something**, which the author fixes;
- **the check read its input and declined to judge it**, which ADR-0030's scope refusal is, and
  which the author answers by running something wider rather than by changing a line;
- **the check did not run at all**, which is a repair to the tool and says nothing about the change.

Both collapses were paid. A kernel carrying syntax an older interpreter could not parse exited with
the findings code, so the `commit-msg` hook on such a clone refused every commit with a message
about the commit. And a scope refusal was indistinguishable from a failed check, which is the one
distinction ADR-0030 exists to make.

The number crosses a process boundary and a language boundary at the same time. Nothing type-checks
it, no linter on either side can see the other, and the gate's shell half branches on it in control
flow rather than printing it.

## Decision

**Four codes, one meaning each**, declared once in `scripts/checker_kernel.py`: `EXIT_OK` for green,
`EXIT_FINDINGS` for a check that judged and found something, `EXIT_REFUSED` for a check that read
its input and declined to judge it, and `EXIT_CRASH` for a check that did not finish.
`EXIT_INTERRUPTED` keeps the shell's own convention for a signal.

- **The kernel decides a crash and a checker never does.** `scripts/checker_kernel.py :: run` wraps
  every checker's entry point, so an unexpected exception answers `EXIT_CRASH` and can never be
  reported as a finding.
- **A checker decides a refusal itself**, because only the checker knows it read its input and
  declined; from outside, that is indistinguishable from a broken environment.
- **The shell half gives each code its own ending.** `scripts/verify.sh :: run_checker` maps them,
  and `scripts/_lib.sh` gives a refusal a run ending and a closing statement of its own rather than
  a shade of the other two. A refusal ends the run in both of `run_checker`'s modes, `collect`
  included: a pair collects so that two sets of findings reach the reader together, and a check
  that could not judge its input has none.
- **Both halves are one change.** A code added on one side and unhandled on the other is silent, so
  the consumers move with the constants, and `scripts/selfcheck.sh` is what reaches both.

## Consequences

**Every consumer pays an arm it would not otherwise need**, and getting it wrong is invisible to
every tool in the repository. A shell `case` with no arm for a refusal announces it as a crash; one
testing the wrong number announces a crash as something else. Neither shape is a syntax error, a
lint finding or a type error, and both have occurred here. That is the standing cost of a contract
carried by an integer across two languages, and the self-check is the only thing that can hold it.

**Two failures escape the contract by construction, both at import** — syntax the running
interpreter cannot parse, and a sibling module it cannot find. Nothing has started that could catch
either, so both exit with the findings code, which is the one outcome this decision exists to keep
them out of. `scripts/checker_kernel.py :: PARSE_FLOOR` is what keeps the first away.

**The exit code becomes readable evidence.** Someone looking at a failed required check can tell
"this branch fails a check" from "this check could not read this branch" without opening the log,
which is the whole return on the extra arms.

## Alternatives considered

**Two codes, the ordinary convention.** Rejected because the events it merges call for three
different actions — fix the change, widen the run, repair the tool — and a gate that cannot tell
them apart tells an author to fix a change when the tool is what broke. That is also the failure
mode most likely to get a check switched off.

**Keep the code at one and draw the distinction in the text.** The cheap half, and it fails on who
the consumers are. The `commit-msg` hook, CI's step status and `scripts/verify.sh`'s own control
flow each branch on the number and none of them reads prose, so the distinction would exist only for
whoever happened to scroll.

**Let a refusal exit zero and carry a caveat in the output.** Rejected because a green exit is a
green exit: whatever the caveat says, the machinery that acts on the number never sees it, and a
green verdict printed beneath a line saying nothing was checked is worse than either half alone.

**Let each checker choose its own codes.** Rejected because the value of one shared kernel is that
one number means one thing whichever checker answered it. A per-checker convention becomes a
per-checker arm in the gate, which is the drift this contract is trying to avoid rather than a way
of managing it.
