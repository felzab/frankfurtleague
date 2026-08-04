# Principles — the rules every document obeys

**Verified against:** `55966d7`, 2026-08-04

These apply to **everything written down in this repository**: module headers, symbol docs, inline
comments, `/docs` pages, ADRs, prompts, command files, commit bodies and pull request descriptions.
**A comment is documentation** and carries every rule below, including the mechanical ones — the gate
checks the citations inside source comments exactly as it checks a spec sheet's (DS20).
The later chapters describe particular shapes. This chapter describes what all of them must be.

Read this before writing anything. Nine rules, and the first one decides most arguments.

---

## P1 — Write for a reader who has no context

**Every document must be fully understandable to someone encountering this repository for the first
time, with no prior conversation, no memory of a past session, and no access to a deleted file.**

This is the rule that is broken most often, because the person writing has the context and cannot
feel its absence. The failure is invisible to its author by construction.

**Banned outright:**

| Shape                               | Example of the failure                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Addressing one person               | "the use case you described", "your own material"                         |
| Referring to a session              | "as discussed", "the decision we took earlier"                            |
| Naming a past effort as a fact      | "the frontend programme found", "wave 7 fixed this"                       |
| An identifier that resolves nowhere | "see item P3-1", "ledger row BE-4" — neither resolves to anything tracked |
| A reference to a deleted file       | "extracting them is tracked in the ledger"                                |
| Persuasion for a settled decision   | Arguing why the repo should adopt something it already uses               |

**When the lesson is worth keeping, restate it as a rule in the present.** The information in "wave 7
took three rounds on one flicker because the first two fixes addressed plausible causes" is worth
having. What survives is: "when a fix does not work, measure rather than trying plausible causes."

**An identifier may be cited only if it resolves to something tracked in this repository.** An ADR
number, a roadmap item id, a file path, a commit SHA. Anything else dangles, and a dangling reference
is worse than none — it still reads as though it means something.

## P2 — Say it once

**A fact stated in two places will eventually disagree, and the copy nobody revisits is the one that
goes stale.**

Before writing a sentence, ask where it belongs, and put it only there:

| The fact is…                            | It belongs in                     |
| --------------------------------------- | --------------------------------- |
| Why this line looks like this           | An inline comment, at the line    |
| True of this module                     | The module header                 |
| A decision with rejected alternatives   | An ADR — cited, never restated    |
| A contract someone will look up         | The surface spec sheet            |
| What a surface is for                   | The surface overview              |
| A rule the assistant must always follow | CLAUDE.md, pointing at the source |

**State the claim in full; cite the argument.** A header says what is true here, and gives the ADR
number for why. A reader who never opens the ADR must still know not to violate the rule — what they
lose by not opening it is the reasoning, never the rule. (DS15)

## P3 — Name only what exists

**No document may refer to a file, symbol, field, endpoint or behaviour that is not in the repository
right now.** Two shapes are banned by name: narrating an edit, and documenting an absence for its own
sake.

A **rejected alternative is not an absence** and stays — written in the present, as a constraint aimed
at the reader about to propose it again. "Never branch a reduced variant off it, because…" rather
than "a reduced variant used to exist and was removed".

A **measurement with a date is not history** and stays. What is banned is the change, not the
timestamp.

**Four documents are exempt, and only within their stated job**, because recording what changed is
what they are for: an ADR's `Context`, an ADR's `Superseded by`,
[`roadmap/closed-items.md`](../roadmap/closed-items.md), and a final report in `_auditing/reports/`.
The list is closed — a document that wants the past tense and is not on it is a document in the wrong
shape (DS21).

Full argument: [DS14](6-decisions.md#ds14--documentation-names-only-what-exists).

## P4 — A stale fact is worse than no fact

**A document that confidently states something untrue sends a reader hunting a world that does not
exist**, and costs more than the document saved. This outranks completeness: where something cannot
be verified, say so plainly rather than writing plausible prose.

The three that rot fastest, in order:

1. **Counts and measurements.** "N ADRs", "N slices", "N files carry a header" — every one of these
   is wrong at some point after it is written, and a reader who checks and finds it wrong stops
   trusting the page. Derive a count at read time or omit it. **A count is worth writing only when
   it is the point of the sentence**, and then it carries the date it was measured, which makes it a
   record rather than a claim about now.

   **This applies inside an ADR's `Context` too.** That section may describe the prior state, but a
   bare number there still reads to a skimming reader as a current fact. Describe the shape of the
   problem — "an index that had fallen behind its own contents" — rather than counting it.

2. **What a tool currently does** — which lint rules are on, which files a script checks. Cite the
   config; never restate it.
3. **Line numbers.** See [P6](#p6--anchor-a-citation-to-something-that-survives-an-edit).

## P5 — Be concise by selecting, never by compressing

**Length is not the constraint; readability is.** A longer explanation that reads easily beats a
compressed one that has to be decoded.

The way to be shorter is to include less, not to write more densely. Cut whole sentences that carry
no instruction. Never cut the words that make a sentence readable.

What to cut on sight:

- Preamble, and any restatement of what a section just said.
- A closing summary of the paragraph above it.
- An explanation of why the document exists, where the title already says.
- Justification for a decision the repository has already taken.

What never to cut: a caveat that changes what someone would do, the failure mode behind a rule, or the
reason a constraint exists.

## P6 — Anchor a citation to something that survives an edit

**Never cite a line number.** `actions.ts:42-43` is wrong the moment anything is inserted above line
42, and nothing anywhere detects it.

Cite in this order of preference:

| Form                                | Example                                                                   | Survives            |
| ----------------------------------- | ------------------------------------------------------------------------- | ------------------- |
| A file plus a symbol                | `fl_frontend/src/features/spiele/actions.ts :: patchAdminSpielDataAction` | Any edit above it   |
| A file plus a short quoted fragment | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")`       | Any edit above it   |
| A file alone                        | `app/core/constraints.py`                                                 | Anything but a move |
| An ADR number                       | ADR-0001                                                                  | Permanently         |

Both anchored forms are machine-checkable: the file must exist and the symbol or fragment must still
appear in it. That is what turns a citation from an assertion into something the gate can verify — see
[`5-currency.md`](5-currency.md).

## P7 — A document states what it is for and who it is for

**The first lines of any document say what question it answers**, so a reader can tell in seconds
whether to keep reading. A page whose purpose has to be inferred from its contents is a page that gets
read in full by people who did not need it.

For anything longer than roughly a hundred lines, add navigation — a table of sections against the
question each answers. Prose alone does not let a reader skip.

## P8 — Every document serves a human reader and an assistant, and neither is sacrificed

**Everything written here is read by both.** A page optimised only for a person becomes prose an
assistant has to infer rules from; a page optimised only for an assistant becomes a rule dump nobody
can orient in. Where the two genuinely pull apart, the human reader wins on **structure** and the
assistant wins on **precision** — a clear heading and an unambiguous rule under it satisfies both.

In practice they want the same things:

- **Rules as lists, one rule per item**, so a rule can be quoted without dragging its neighbours.
- **Tables for anything enumerable**: options, mappings, contracts, comparisons.
- **Prose for anything that needs explaining.** A table cannot carry a "because".
- **Bold the claim, not the paragraph.** If half a page is bold, none of it is emphasised.
- **Headings that state the rule**, not the topic. "Name only what exists" beats "Naming".
- **No nesting past three levels.** Deeper means the document needs splitting.

## P9 — Accuracy outranks volume, and doubt is stated

A gap that is named is a gap someone can close. A gap that is filled with a confident guess is a
defect with a long half-life.

- Where something could not be verified, **say so, and say why**.
- Where two readings are possible, give the one you believe and name the other.
- Where a claim rests on a measurement, give the measurement.
- **Never present a plan as a description.** "The pass writes a report" and "the pass will write a
  report once built" are different sentences and only one of them is documentation.

---

## Applying these to a document you did not write

When editing an existing page, these rules apply to what you touch and to anything you read while
touching it. Where you find a violation you are not fixing, say so rather than leaving it silently —
`docs/roadmap/open-items.md` is where it goes if it is bigger than the change in hand.

**These rules govern this folder too.** `_standard/` is documentation and gets no exemption from its
own principles ([DS19](6-decisions.md#ds19--the-standard-is-not-exempt-from-itself)).
