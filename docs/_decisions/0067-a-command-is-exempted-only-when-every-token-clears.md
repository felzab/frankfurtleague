# ADR-0067 — A command is exempted only when every path-like token clears, and the shared block stays a copy

**Status:** Accepted\
**Date:** 2026-08-10\
**Surface:** ops\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My decision of 2026-08-10, taken with the write-guard rework, and re-grounded on
2026-08-11 by a probe of the sourced-fragment alternative described below.

## Context

[ADR-0060](0060-the-branch-guard-compares-canonical-paths.md) settled how a write to a **tracked
file** is refused while HEAD is `main`, for a hook handed **one path**: canonicalise, compare
structurally, and deny anything that is not an explicit verdict. It also warned that the guard is a
poor place to add a convenience exemption later, because anything widening it widens it silently.

The shell route is the same edit by another name and in practice the more common one — a redirect,
`sed -i`, a heredoc, a `python -c` that writes — and guarding only the tool route left the rule
looking enforced while the usual way around it stayed open. A hook on Bash is therefore handed a
**command**, not a path, and the two differ in a way that matters: a command names several tokens,
any of them might be the one written, and some commands write paths they never name at all.

That makes ADR-0060's exemption untransferable as written. The same words — "allow it when it lies
outside the working tree, or is ignored and untracked inside it" — have no single subject to be
true of.

A second problem arrived with the first. Two hooks need the identical notion of what counts as a
write: the one that refuses a write on `main`, and the one that asks before a write reaches
`docs/_standard/`. Their answers must never diverge, because a shape one treats as a write and the
other does not is a hole in whichever is weaker.

## Decision

**The exemption is stated positively, over every token, and the shared block is a deliberate copy.**

- **Every path-like token in the command is held to ADR-0060's test, and at least one must be aimed
  at the exempt class.** Asking the inverse question — whether anything _tracked_ is named — would
  release every path git cannot place: a file that does not exist yet, a case-varied spelling, a
  path hidden inside a `--flag=value`.
- **The token pass is gated, because a command that satisfies any of these writes a path it never
  names:** one simple command only, with no chain, substitution, newline or `cd`; a program whose
  writes are fully described by its arguments, expressed as a closed allowlist rather than a list of
  bad verbs; and no deletion, since the tool route grants writing an ignored path and can remove
  nothing.
- **Credential shapes are refused ahead of all of it**, whatever the ignore file says.
- **Anything the guard cannot place denies**, which is ADR-0060's posture inherited rather than
  restated.
- **The write-shape block is duplicated verbatim in both bash guards rather than sourced from one
  file**, between sentinel comments, and `scripts/selfcheck.sh` byte-compares the two and fails the
  gate when they drift.

## Consequences

**On `main`, a write-shaped command mixing a repository path with a scratch path is denied**, and
that includes copying a file out of the tree. The ways through are to split the command, to use a
tool the other guard governs, or to be on a branch. This is the cost of the rule being stated over
every token rather than over the one a reader considers important, and it was accepted with that
example in front of it.

**The exemption reaches only the shapes the guard knows.** A program that reads its target out of a
file rather than off the command line is invisible here, and the allowlist is never consulted for
it. What this enforces is a set of shapes, not a proof about writing.

**Duplication is a standing cost paid deliberately.** Two copies must be edited together, and
nothing but the self-check's byte comparison makes that true. The comparison is therefore
load-bearing rather than a nicety: if its sentinels are reworded in one file the extraction returns
nothing, and two empty extractions compare equal — which is why the assertion checks that it
extracted something before it compares.

## Alternatives considered

**Source the shared block from one fragment both guards read.** The obvious refactor, and the
headers' own stated reason — that the two must never disagree — argues _for_ it, since one file
cannot disagree with itself. Rejected on what happens when the fragment is not there.

Probed on 2026-08-11 against a throwaway repository on `main`, with the block replaced by a `source`
line and the fragment absent: the guard **exits 0 and prints nothing**, where the intact guard
prints its deny verdict for the same write-shaped command. Nothing is denied, because a hook that
prints no verdict has not refused anything — silence is how a guard says it has no objection, which
is the contract `scripts/selfcheck.sh` asserts for every hook it drives. Adding `set -euo pipefail`
changes the exit code to 1 and not the silence. The failure is invisible in both spellings: no
message, no finding, and every write on `main` allowed.

So the trade is not "one file that cannot go missing" against "two files that cannot disagree". It
is a guard that fails **closed** against one that fails **open**, and a divergence is loud — the
gate fails on it — where a missing fragment is silent. That asymmetry is the same one ADR-0060
decided, and it decides this the same way.

**Carry a list of directories the exemption allows.** Rejected for ADR-0060's reason: the exemption
is a property of the repository rather than of a set of names, so asking git keeps a path that
becomes ignored tomorrow covered without editing a hook, and a list drifts with nothing detecting
it.

**Release a command when its target token clears, ignoring the rest.** The reading that makes
`cp <scratch>/x <tracked>/y` work. Rejected because no scan of a command can identify which token is
the target, so this releases a command that merely _contains_ an exempt path alongside one it will
write.
