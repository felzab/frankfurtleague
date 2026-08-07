# Architecture Decision Records

**Verified against:** `dcc4c47`, 2026-08-06

Governs `docs/_decisions/`. Template: [`templates/adr.md`](templates/adr.md).

An ADR records **one decision, at the moment it was taken, with the reasoning that made it the right
call and the alternatives that lost**. It is dated, numbered, and never rewritten.

That last property is what makes it different from every other document here. A spec sheet describes
the system now, so it must be edited whenever the system changes and it is wrong in the window
between. An ADR describes what was decided then, which cannot become false — the code may move on,
but the decision was still taken. When a decision is reversed you do not edit the old ADR; you write a
new one and mark the old one superseded.

So the maintenance cost of the log does not grow with the codebase. It grows with the number of
decisions taken, and a decision is taken once.

---

## Is it an ADR?

**The test: would someone reasonably propose the opposite, and would you have to re-derive the
argument to refuse?**

If yes, write one. If no, it is documentation and belongs in a spec sheet or a module header.

Three things that fail the test:

- **How to do something.** How to run the project, how to add a slice, what a function returns.
- **Anything with no rejected alternative.** If there was only one sane option there was no decision.
  "We use TypeScript" is not an ADR unless not using it was seriously considered.
- **Anything readable off the code in ten seconds.** The value of an ADR is the part that left no
  trace in the source: why not the other thing.

## Anatomy

MADR, trimmed. Six parts, in this order.

```markdown
# ADR-NNNN — <the decision, as a short statement>

**Status:** Accepted
**Date:** <when the decision was taken, not when the file was written>
**Surface:** <frontend | backend | ops — every one it touches>
**Supersedes:** —
**Superseded by:** —

## Context

What was true that forced a choice. Facts, not opinions: the problem, the constraints, and what
circumstance had already ruled out.

## Decision

What was decided, in the active voice, as an instruction. "Keep X and Y. Delete the rest."

## Consequences

What this costs and enables, including the bad parts. An ADR with no negative consequences is
usually hiding one.

## Alternatives considered

What else was on the table and why each lost. This is the section that gets read.
```

**Status** is one of `Accepted` (in force), `Proposed` (written, not yet agreed), `Superseded by
ADR-NNNN` (reversed or replaced), or `Deprecated` (no longer relevant and not replaced — the
subsystem went away). A superseded ADR stays in the folder with its original text intact.

**Date** is when the decision was taken. For an ADR written up later than the decision, use the real
date and add a `**Source:**` line naming where it came from. Honest, and it keeps the trail intact.

## Context is the one place past tense is allowed

P3 forbids naming what does not exist. **An ADR's `Context` is exempt, and only `Context`** — it has
to describe the state the decision replaced or the decision is unreadable. So is `Superseded by`.

`Decision` and `Consequences` are present tense like any other document. They describe a rule that is
in force, aimed at the reader about to break it.

## Numbering and filenames

Sequential, zero-padded, never reused: `docs/_decisions/0001-two-granular-cache-tags.md`. The number
is a permanent identity and is what code cites; the slug is for humans skimming the directory and can
be adjusted.

Do not group by area or renumber for tidiness. A gap or an odd ordering is fine — a number is an
identity, not a position in a taxonomy. Grouping for reading is the index's job.

**Only cite an ADR that exists.** The gate fails on a citation resolving to no file
([`5-currency.md`](5-currency.md)), so writing the ADR is part of the change that needs it rather
than a follow-up.

## Reversing a decision

Write the next free number, status `Accepted`, dated today, with `**Supersedes:** ADR-NNNN`. Then open
the old one and change **exactly two things**: its `Status` to `Superseded by ADR-NNNN`, and its
`Superseded by` field. Touch nothing else — not the context, not the reasoning, not a typo in the
reasoning.

Someone reading the old one then sees the original argument and a pointer to what replaced it. Someone
reading only the new one sees what it replaced. Neither has to guess whether what they are reading is
current, because the status line says so.

## Why the log is not split by surface

Everything else in `/docs` is organised per surface. The ADR log is one flat, globally numbered
folder. **Surfaces own descriptions; the log owns decisions.** Four reasons, in the order they bite:

1. **Decisions routinely span surfaces.** Filing one under a single surface makes it invisible from
   the others and forces an arbitrary choice at write time. Cache tags, the season default, the
   revalidation route and the `connection()` guards each touch two or three.
2. **The number is a permanent identity cited from code.** A flat folder means the path never changes.
   Scope does move between surfaces, and a surface-filed ADR would want to move with it, breaking
   every citation.
3. **Numbering is global.** Split folders make "what is the next number" a multi-directory search.
   Per-surface numbering breaks the moment a decision spans two.
4. **The log reads chronologically.** In order, it is the history of the project's thinking.

Browsing by surface is the index's job: `_decisions/README.md` carries a `Surface` column, and each
surface overview links the ADRs relevant to it.

## Keeping CLAUDE.md and the log consistent

They have different jobs and the pointer runs one way.

- **CLAUDE.md is the enforcement layer**, loaded into every assistant session. Rules, imperative,
  short. Each ratified decision is one line plus its ADR number.
- **The ADR log is the reasoning layer**, read on demand.

**If the two disagree, the ADR is the source and CLAUDE.md is the summary** — so CLAUDE.md gets
corrected, never the ADR. That rule is itself recorded in CLAUDE.md, which is what stops the two
contradicting each other for long.

## Failure modes

- **Editing an accepted ADR's reasoning.** Destroys the one property that makes the log trustworthy.
  Fix a typo, never a rationale; a wrong rationale is a new ADR.
- **Writing ADRs for non-decisions.** The log fills with "we use Tailwind" and stops being worth
  reading. Apply the rejected-alternative test.
- **Citing a number that does not exist.** The gate catches this one.
- **A stale index.** One line per ADR, appended when you write one. If it is ever more work than
  that, the index is doing too much.
