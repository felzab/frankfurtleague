# ADR-0036 — A pull request body summarises the branch; the Commits tab indexes the commits

**Status:** Accepted
**Date:** 2026-08-05
**Surface:** ops
**Supersedes:** —
**Superseded by:** —
**Source:** My decision, 2026-08-05, on roadmap item OPS-6

## Context

Commit bodies are this repository's most valuable artifact, which is why merges are never squashed
and why `docs/workflows/message-templates.md` spends most of its length on them. That raises a fair
question: if every commit already carries its own reasoning, a pull request body could be one short
sentence per change plus a link to each commit, and carry nothing else.

`gh` is deliberately not installed, so the forty-five merged pull requests were read in the browser
on 2026-08-05. Four facts came out of that reading and together they decide the question.

- **GitHub already renders the per-commit view.** Every pull request has a Commits tab listing each
  commit with its full body one click away. A body listing one line per commit reproduces it in a
  worse medium.
- **A body does not decompose by commit.** Pull request 47 (merged as `9ffbbfc`) has three commits
  and a body of roughly eight paragraphs, each led by a theme — a roadmap entry whose proposed rule
  described an empty set, a gate-scope carve-out, two stale citations, an index table's removal.
  Every paragraph cuts across the three commits. There is no mapping to write.
- **The proposal scales inversely with branch size.** Pull request 43 (merged as `738c2b3`) has
  fifteen commits. One sentence each would be fifteen lines; its actual body groups the fifteen into
  themes in a single paragraph, which is the only form a reader can hold at once.
- **The headings carry what no commit can.** That same body's _Left undone_ names four things
  proposed to me and awaiting my decision. It appears in no commit body because it is not a
  change anyone made — and neither is a gate invocation covering the whole branch, or a divergence
  resolved across two commits.

The proposal's kernel is real all the same. Pull request 29 (merged as `636d568`) is the
best-oriented body in the corpus precisely because it opens by saying how many commits there are and
what each does: "Two commits, one item. `1acfc49` closes DB-3 … and `41b158e` removes the entry."
Pull request 43, with fifteen commits and the greatest need for that sentence, has nothing like it.

## Decision

**A pull request body summarises the branch. It never indexes the branch's commits.**

- **A single-commit pull request gets a pointer.** The commit body already says it.
- **A multi-commit pull request opens with one orientation sentence** — how many commits, and what
  they do **grouped by theme**, not listed one per line. The four headings follow it.
- **Link an individual commit only where that commit is the thing a reader must find.** The standing
  example is a roadmap closure, where naming both SHAs is the point: the closing commit is what the
  `Closed in` column of `docs/roadmap/closed-items.md` points at, and the removal commit is what
  proves the two-commit protocol was followed.
- **Never write one line per commit.** The Commits tab is that view, kept current by git rather than
  by hand.

The four headings — _Verified_, _Decisions taken_, _Left undone_, _Governed by_ — stay as they are,
and stay mandatory in the sense the templates already give them: drop a heading rather than pad it.

**This governs human-authored pull requests only.** Dependabot writes its own bodies and the
template does not reach them; leave them alone.

## Consequences

- The orientation sentence is the one part of a body that grows with the branch, and it is written
  by hand each time. That is the cost, and it is the cost of the thing being a summary at all.
- A reader wanting per-commit detail is sent to the Commits tab rather than served a copy of it.
  That is one extra click, and it buys a view that cannot go stale against the branch.
- `.github/PULL_REQUEST_TEMPLATE.md` and `docs/workflows/message-templates.md` now state the rule in
  the same words. They already had to change together (CLAUDE.md, documentation); this adds one more
  claim to keep in step.
- The Titles-and-bodies section of `docs/workflows/README.md` stops being marked unverifiable. It
  was written as a derivation from the commit convention; it has now been checked against the
  bodies themselves, and they follow it.

## Alternatives considered

**Adopt the proposal as stated** — a per-commit list with links, replacing the summary paragraph.
Rejected on pull request 43: fifteen lines duplicating a tab the reviewer already has, while the
paragraph that groups those fifteen into four themes is the only part that orients anyone.

**Split the rule by branch size** — a per-commit list up to three commits, a summary above that.
Rejected because the threshold would be arbitrary and the two shapes answer different questions: a
list says what changed, a summary says what the branch achieves. Pull request 47 has three commits
and still does not decompose, so the threshold would already be wrong at its first case.

**Change nothing and record the finding.** The convention as written does answer the question —
a pointer for one commit, a summary for many. Rejected because it says nothing about how a body
opens, and the corpus shows exactly one body that opens well.
