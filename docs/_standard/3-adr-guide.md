> **Part of the documentation standard** — see [`README.md`](README.md) for the whole of it.
> Governs `docs/_decisions/`. The ADRs themselves are not written yet; extracting them is item **P3-1**
> in [`../roadmap/open-items.md`](../roadmap/open-items.md).

# Architecture Decision Records

## What an ADR is

An ADR is a short document recording **one decision, at the moment it was taken, with the reasoning
that made it the right call and the alternatives that lost**. It is dated, numbered, and never
rewritten afterwards.

That last property is the whole point, and it is what makes an ADR different from every other kind of
documentation you have. A spec sheet describes how the system is _now_, so it must be edited whenever
the system changes, and it is wrong in the window between the change and the edit. An ADR describes
what you decided _then_, which cannot become false — the code may move on, but "on 2026-07-29 I decided
to delete twenty cache tags because nothing could invalidate them" stays true forever. When a decision
is reversed, you do not edit the old ADR. You write a new one and mark the old one superseded.

So the maintenance cost of an ADR log does not grow with the codebase. It grows with the number of
decisions you take, and you only take a decision once.

### What is _not_ an ADR

- How to run the project, how to add a slice, what a function returns — that is documentation, not a
  decision.
- Anything with no rejected alternative. If there was only one sane option, there was no decision.
  "We use TypeScript" is not an ADR unless you seriously considered not to.
- Anything you can read off the code in ten seconds. The value is in the part that left no trace:
  _why not the other thing_.

A useful test: **would someone reasonably propose the opposite next year, and would you have to
re-derive the argument to refuse?** If yes, it is an ADR. Every one of CLAUDE.md §9's eight items
passes that test — that is literally why §9 exists, and §9 opens by warning that each one "reads as a
violation at a glance".

## Anatomy

The format is MADR, trimmed. Six parts, in this order:

```markdown
# ADR-0001 — Keep two granular cache tags, delete twenty

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend, backend
**Supersedes:** —
**Superseded by:** —

## Context

What was true that forced a choice. Facts, not opinions. The problem, the constraints, and what
was already ruled out by circumstance.

## Decision

What was decided, in the active voice, as an instruction: "Keep X and Y. Delete the rest."

## Consequences

What this costs and enables — including the bad parts. An ADR with no negative consequences is
usually hiding one.

## Alternatives considered

What else was on the table and why each lost. This is the section future-you will actually read.
```

Two fields matter more than they look:

**Status** is one of `Proposed` (written, not yet agreed — rare with one maintainer), `Accepted` (in
force), `Superseded by ADR-00NN` (reversed or replaced), or `Deprecated` (no longer relevant, but not
replaced — e.g. the subsystem was deleted). A superseded ADR stays in the folder, readable, with its
original text intact.

**Date** is the date the decision was taken, not the date the file was written. Yours are known: the
§9 ratifications are 2026-07-29 with amendments on 2026-07-31, and the ledger records dates on D1–D5.

## Numbering and filenames

Sequential, zero-padded, never reused: `docs/_decisions/0001-two-granular-cache-tags.md`. The number is
permanent and is what code comments cite. The slug is for humans skimming the directory and can be
adjusted; the number cannot.

Do not group by area or renumber to make things tidy. A gap or an odd ordering is fine — an ADR's
number is an identity, not a position in a taxonomy. If you want them grouped for reading, that is what
an index file is for.

## The lifecycle, concretely

You are about to change how cache tags work. You write the next free number — say `ADR-0017` — status
`Accepted`, dated today. In its **Supersedes** field you put `ADR-0001`. Then you open `ADR-0001`, and
you change exactly two things: `**Status:** Superseded by ADR-0017` and the `Superseded by` field. You
touch nothing else — not the context, not the reasoning, not a typo.

Someone reading `ADR-0001` in a year sees the original argument _and_ a pointer to what replaced it.
Someone reading only `ADR-0017` sees what it replaced. Neither has to guess whether the old document is
current, because the status line says so. That is the entire mechanism, and it is why ADRs survive
neglect better than anything else in this plan.

## How you actually use them

**Day to day, you mostly don't.** You write one when you take a decision, which for a project this size
is maybe once or twice a month, and it takes fifteen minutes. That is the honest workload.

**When you come back after months away**, you read the index — one line per ADR — and it is the fastest
possible summary of why the codebase is shaped the way it is. This is the use case you described at the
start.

**When you are about to change something and it feels oddly constrained**, you grep the code for the
ADR number in the nearest comment and read it. This is where the citation rule earns itself: the
comment at `queries.ts` says _what_ not to do inline, and `ADR-0001` says _why_, once, in full. Before
this, that argument existed only in a 298 KB ledger you cannot practically open.

**When an assistant works on the repo**, it reads the ADR for the file it is touching instead of
re-deriving the reasoning — or worse, "fixing" a deliberate choice. §9 exists because that already
happened often enough to need a standing warning.

**When you disagree with your past self**, you write the next ADR. That is the supported path, and it
is much cheaper than arguing with a document.

## What this repo would get

You already have roughly fifteen ADRs written and argued. They are just scattered across three formats
and two enormous files:

| Source                     | Count          | Notes                                                                                           |
| -------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| CLAUDE.md §9 A1–A8         | 8              | Already in near-ADR shape: decision, rationale, consequences, and an explicit "do not fix this" |
| Ledger Part 1, D1–D5       | 5              | Owner decisions with dates, options and full derivations — D2 alone runs to ~45 lines           |
| Ledger BE-1 … BE-9, Q4, Q5 | ~4 substantive | Backend decisions with sequencing constraints and rejected alternatives                         |
| Wave reports               | several        | Trade-offs taken mid-programme, plus the places the audit turned out wrong                      |

Extraction is mostly transcription. The §9 entries need almost no rewriting — they need a status line,
a date, and their alternatives split out of the prose. D2 is already a better ADR than most people
write; it just lives at line 131 of a file nothing can load.

**This is the single highest-value piece of the whole documentation programme**, because it is the only
part that recovers knowledge currently trapped in files too large to open. Everything else documents
code you can still read.

## A worked example, from your own material

CLAUDE.md §9 A5 today reads:

> **A5 — `SpielCard` / `SpielCardCompact` / `SpielCardUltraCompact` stay as three components.**
> Justified variance, not copy-paste: 2 chips / 1 chip / 0 chips … **Do not merge them.**

As an ADR:

```markdown
# ADR-0007 — Three Spiel cards stay three components

**Status:** Accepted
**Date:** 2026-07-29
**Source:** audit 2-architecture §3.12, ratified as CLAUDE.md §9 A5

## Context

`SpielCard`, `SpielCardCompact` and `SpielCardUltraCompact` render the same entity and read as
copy-paste. Audit pass 2 flagged them as duplication.

## Decision

Keep all three. Extract only their shared derivation.

## Consequences

- Three files to touch when the match card's data shape changes.
- Their shared derivation lives in `utils.ts` as `formatSpielDisplay`. That extraction was itself a
  bug fix: an unplayed match rendered "- : -" in one card and "-:-" in the other two, on the same
  screen.
- A reviewer or assistant will propose merging them again. The citation in each component is what
  stops that costing an afternoon.

## Alternatives considered

**One component with a `variant` prop.** Rejected: the three differ in chip count (2/1/0), in full
names versus two-letter shorthands, and in the container driving them (grid, vertical timeline,
horizontal bracket). No flag collapses them without producing a three-mode component, which is
harder to read and change than three single-mode ones.
```

Note what happened: nothing was invented. The reasoning was already yours — it gained a number, a date,
a status, and a home that is not line 400-something of a 3,000-line brief.

## How CLAUDE.md and the ADR log stay consistent

They have different jobs, and the rule is a one-way pointer.

- **CLAUDE.md is the enforcement layer**, loaded into every assistant session. It states rules in the
  imperative and stays short.
- **The ADR log is the reasoning layer.** It is read on demand, by you or by an assistant that needs to
  know whether a constraint still applies.

So §9 A5 becomes one line — _"Three `SpielCard` variants stay separate — ADR-0007"_ — and the argument
moves into ADR-0007. There is exactly one copy of the reasoning, and CLAUDE.md stops growing.

The consistency risk runs one way: if the ADR and CLAUDE.md disagree, **CLAUDE.md is the summary and
the ADR is the source**, so the ADR wins and CLAUDE.md gets corrected. Recording that rule in CLAUDE.md
itself is what makes it impossible for the two to contradict each other for long.

## Failure modes worth knowing about

- **Editing an accepted ADR's reasoning.** Destroys the one property that makes the log trustworthy.
  Fix a typo, never a rationale. If the rationale was wrong, that is a new ADR.
- **Writing ADRs for non-decisions.** The log fills with "we use Tailwind" and stops being worth
  reading. Apply the rejected-alternative test.
- **Numbers in code comments that point at nothing.** Only cite an ADR that exists. This is the failure
  mode your current inline audit IDs already have in waiting.
- **A stale index.** One line per ADR, appended when you write one. If it is ever more work than that,
  the index is doing too much.
- **Retrospective ADRs pretending to be contemporaneous.** For the extraction, use the real decision
  date and add a `**Source:**` line naming where it came from — as in the worked example above. Honest,
  and it keeps the audit trail intact.
