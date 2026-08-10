# ADR-0060 — The branch guard compares canonical paths, and denies what it cannot answer

**Status:** Accepted\
**Date:** 2026-08-08\
**Surface:** ops\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open item OPS-9, closed 2026-08-08, whose probes in `scripts/selfcheck.sh` hold this
guard to the spellings below.

## Context

`main` is protected and takes changes only through a pull request, and nothing about editing it
announces the mistake at the moment it is made: `git checkout -b` carries the working tree across,
so a write on `main` costs nothing and shows nothing until the push is rejected.
`.claude/hooks/guard-branch.sh` is what makes that rule impossible to skip — a PreToolUse hook that
refuses a write to a tracked file while HEAD is `main`.

Ahead of everything else it asks whether the target lies inside the working tree, because the
exemption it honours is stated as a boundary rather than as a list of directories: a path outside
the repository writes no tracked file and is allowed, which is what covers the scratchpad and the
system temp directory without naming either. It answered that question by comparing the target
against the repository root as raw strings.

A string comparison is wrong on the spellings a tool actually emits, and reproducing them against
the previous logic on 2026-08-05 confirmed it: a `./` segment, a `..` that re-enters, a doubled
separator and the Windows `//?/` device form each name a file inside the repository, and each was
allowed. Nothing observed any of that. A guard's failure is silent by construction — a refusal that
does not happen announces nothing — and at the time nothing in the repository executed this file at
all.

## Decision

Canonicalise both paths and compare them structurally, inside the node process the hook already runs
to read its payload (`.claude/hooks/guard-branch.sh :: decision`). `path.resolve` collapses every
spelling into one form, and `path.relative` then answers containment without prefix arithmetic: a
leading `..` means the target climbed out of the tree, an absolute result means another drive, and
an empty result is the root itself. On Windows the comparison is case-folded, because spellings of
one path there differ only in case; the repository-relative path handed to git afterwards is
re-derived unfolded, because git matches a pathspec as it is spelt.

Anything that is not an explicit verdict denies. That covers node being absent, node crashing, git
failing to name the branch or the root, and a payload naming no path at all. A detached HEAD is where
silence is an answer rather than a missing one: `git branch --show-current` prints nothing and
succeeds when no branch is checked out, so `main` is demonstrably not checked out, and denying would
break every write during a rebase or a bisect.

## Consequences

The guard cannot answer without node, and answers deny when node is missing. That is not a cost this
comparison introduced — the payload arrives as JSON and `jq` is not installed on this machine, so
node already had to run in order to read a path out of it. What the comparison adds is that a node
failure and a target node could not place are now indistinguishable, and both refuse.

The refusal is deliberately the cheap side of an asymmetry: a false refusal is one
`git checkout -b` away from resolved, while a hole is not observable at all. The same asymmetry is
why this guard is a poor place to add a convenience exemption later — anything that widens it
widens it silently.

Substituting a cheaper containment test later cannot be done from a reading of the call site, since
the spellings that defeat one are not visible in the code that uses it. What holds the rule instead
is `scripts/selfcheck.sh`, which runs the hook exactly as the hook runner does — a JSON payload on
stdin, the verdict on stdout — and asserts a refusal for each spelling above against a throwaway
repository whose branch it controls. The device form is probed on Windows alone, because elsewhere
it is not an absolute path.

## Alternatives considered

**Compare the target against the repository root as text.** The obvious test, and a prefix match: it
accepts any spelling that happens to share the prefix and rejects any that does not. Ordinary
variation defeats it, and the failure runs in the dangerous direction — an inside path spelt
unusually reads as outside and is allowed. A better pattern only moves the boundary to the next
spelling nobody thought of, which is why the answer is canonicalisation rather than a stricter
match.

**Carry a list of directories the guard will allow.** Rejected because the exemption it implements
is a property of the repository, not of a set of names: asking git where the root is, and asking git
whether a path is ignored and untracked, means a directory that becomes gitignored tomorrow is
covered without editing this file. A list drifts against `.gitignore` and nothing detects the drift.

**Allow a target the guard could not place.** The friendlier default, and it inverts the cost. An
allowed write on `main` is discovered when a push is rejected, at the point where undoing it is most
expensive; a refused write is undone by creating the branch that should have existed. Only the
detached HEAD is exempt, and it is exempt because git answered rather than because the answer was
inconvenient.
