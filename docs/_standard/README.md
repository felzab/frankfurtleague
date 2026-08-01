# `_standard` — the documentation standard

Everything about **how this repo is documented** lives in this folder. Underscore-prefixed so it sorts
to the top of `docs/`.

**Adopted 2026-08-01.** Applies to `fl_frontend`, `fl_backend`, and the deployment/ops surface.

| File                                   | What it covers                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`1-in-code.md`](1-in-code.md)         | Documentation inside source files: module headers, symbol docs, inline comments                 |
| [`2-out-of-code.md`](2-out-of-code.md) | Documentation in `/docs`: the three layers, per-surface layout, currency rules                  |
| [`3-adr-guide.md`](3-adr-guide.md)     | How ADRs work, how to write one, how to use them                                                |
| [`4-decisions.md`](4-decisions.md)     | Every decision _about the standard itself_ — DS1–DS11, with rationale and rejected alternatives |
| [`templates/`](templates/)             | Copy-paste starting points: ADR, spec sheet, surface overview, module header                    |

Work in progress is tracked in [`../0-documentation-ledger.md`](../0-documentation-ledger.md). That file
tracks _what has been documented_; this folder defines _how_.

---

## Terms used throughout

### Surface

One of the three parts of this system a reader would go to **as a whole**:

| Surface      | Is                                   | Directory                                                    |
| ------------ | ------------------------------------ | ------------------------------------------------------------ |
| **frontend** | the Next.js app                      | `fl_frontend/`                                               |
| **backend**  | the FastAPI app                      | `fl_backend/`                                                |
| **ops**      | how it is built, routed and deployed | `docker-compose*.yml`, `nginx/`, `scripts/`, the Dockerfiles |

Three, because that is the granularity at which a question has **one** answer. "How does caching work"
is a frontend question and nothing else. "How is a request authenticated" is a backend question. "What
happens on deploy" is ops.

A surface is **not** a slice, a layer, or a directory. `features/spiele` is smaller than a surface —
it is one of twelve slices inside the frontend, and it gets its own page only if it deviates from the
pattern the frontend spec sheet already describes.

### Spec sheet

The **reference** document for one surface. It answers _what exactly is the contract, and is it still
true?_ Four sections: contract tables, numbered invariants, violation → remedy, known-open. Every claim
cites a file/line or an ADR, which is what makes it checkable rather than merely plausible.

### The three document types, by the question they answer

| You are asking                                                 | Read           | Shape                          |
| -------------------------------------------------------------- | -------------- | ------------------------------ |
| "What is this part of the system, and how is it put together?" | **overview**   | ~120 lines of prose, read once |
| "What exactly does this take? What breaks if I change it?"     | **spec sheet** | tables, looked up              |
| "Why is it like this — and may I change it?"                   | **ADR**        | one decision, argued           |

Worked through on one real question — _may I delete the `updateTag("spiele")` call, since the granular
tag covers it?_

- The **overview** tells you the frontend owns all caching because the browser never talks to FastAPI
  directly. Context, not an answer.
- The **spec sheet** gives you invariant I2: base tags are invalidated unconditionally, enforced at
  `actions.ts:42-43`, and breaks because the default read path sends no `saison_id`. That is the
  answer: no.
- The **ADR** tells you why that is so, what the twenty deleted tags were, and what would have to
  change for the answer to become yes.

---

## The one rule everything else follows

**Code documents the local and the changeable. `/docs` documents the cross-cutting and the decided.**

An inline comment says what not to do, at the line where doing it is tempting. An ADR says why, once,
in full. The comment cites the ADR number, so the argument exists in exactly one place.

Worked through on a real example:

| Fact about the `spiele` cache design                                                        | Lives in                       | Because                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| "Tags by phase or status were deleted — a result edit _changes_ a match's status"           | inline comment in `queries.ts` | It is the reason _this line_ looks like it does, and you need it at the moment you are tempted to add a tag |
| "Every granular tag declared here is invalidated in this same file"                         | module header                  | It is a property of the module, not of any one line                                                         |
| "Twenty of twenty-two granular tags were deleted; here is the test that decided which"      | `ADR-0001`                     | It is a decision with rejected alternatives, and it governs three slices, not one file                      |
| "`spiele:saison_id:{id}` is set by `getSpiele`, invalidated by `patchAdminSpielDataAction`" | frontend spec sheet            | It is a cross-file contract someone needs to look up                                                        |

Nothing appears twice. If you find yourself writing the same sentence in two places, one of them is the
wrong place.

## The two layers, side by side

### In code — three altitudes

1. **Module header** — what the module is, its invariants, which ADRs govern it.
2. **Symbol docs** — _why_, plus one line of _what_ only when the name does not carry it.
3. **Inline comments** — at the surprising line, on the line.

One rule that no tool can check and that matters more than the rest: **never restate a type.**

### In `/docs` — three layers

1. **ADR log** (`docs/_decisions/`) — append-only, numbered, never rewritten. Cited from code.
2. **Spec sheets** (`docs/<surface>/`) — contract tables and numbered invariants, each citing a
   file/line.
3. **Surface overviews** — ~120 lines of narrative saying what a surface is for and linking onward.

Plus the **glossary** (`docs/glossary.md`), which is cross-cutting and belongs to no surface.

Each layer has a **different update trigger**, which is the point: an ADR is written once and never
edited, a spec sheet is edited when a constraint changes, an overview is rewritten only when a
surface's purpose changes. Nothing here needs a scheduled review, because nothing here depends on one.

## Relationship to CLAUDE.md

CLAUDE.md is the **enforcement layer**: rules, imperative, loaded into every assistant session, kept
short. This folder and `/docs` are the **reasoning layer**: read on demand.

**If CLAUDE.md and an ADR disagree, the ADR is the source and CLAUDE.md is the summary** — so
CLAUDE.md gets corrected, never the ADR. That single rule is what stops the two from contradicting
each other.
