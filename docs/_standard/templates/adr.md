<!--
TEMPLATE — copy to docs/_decisions/NNNN-short-slug.md and fill in. Delete this comment block.
Guidance: ../4-adr-guide.md

BEFORE WRITING, apply the test: would someone reasonably propose the opposite, and would you have to
re-derive the argument to refuse? If no, this is not an ADR — it is documentation, and it belongs in
a spec sheet or a module header.

THREE THINGS THAT MAKE THE LOG WORTH KEEPING:

  1. AN ACCEPTED ADR IS NEVER REWRITTEN. Reversing a decision means writing the next number and
     changing exactly two lines here: Status, and Superseded by. Fix a typo, never a rationale.
  2. CONTEXT IS THE ONE PLACE PAST TENSE IS ALLOWED, because it has to describe the state the
     decision replaced. Decision and Consequences are present tense, aimed at the reader about to
     break the rule.
  3. NUMBERS ARE NEVER REUSED, and only an ADR that exists may be cited — the documentation gate
     fails on a number resolving to no file, so writing this is part of the change that cites it.
-->

# ADR-NNNN — \<the decision, as a short statement, not a question\>

**Status:** Accepted
**Date:** \<when the decision was taken, not when this file was written\>
**Surface:** \<frontend | backend | ops — every one it touches; several is normal\>
**Supersedes:** —
**Superseded by:** —

## Context

What was true that forced a choice. Facts, not opinions: the problem, the constraints, and what
circumstance had already ruled out. A reader who knows nothing about the situation should be able to
feel the pressure that made a decision necessary.

## Decision

What was decided, in the active voice, as an instruction. "Keep X and Y. Delete the rest."

## Consequences

What this costs and what it enables, **including the bad parts**. An ADR with no negative
consequences is usually hiding one.

Name any constraint this creates for future work, because that is what a reader is most likely to
trip over.

## Alternatives considered

**\<Alternative\>.** Why it lost.

This is the section that actually gets read. One paragraph per alternative is plenty — what matters
is that the reason is recorded, not that the list is exhaustive.
