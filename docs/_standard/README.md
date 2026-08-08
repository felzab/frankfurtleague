# `_standard` — how this repository is documented

**Verified against:** `b5324b8`, 2026-08-08

Read [`1-principles.md`](1-principles.md) before writing anything. Everything else in this folder
describes a particular shape; that chapter describes what all of them must be.

| Chapter                                | Answers                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| [`1-principles.md`](1-principles.md)   | What rules does every document obey, whatever its shape?       |
| [`2-in-code.md`](2-in-code.md)         | What goes in a module header, a symbol doc, an inline comment? |
| [`3-out-of-code.md`](3-out-of-code.md) | What goes in `/docs`, and where?                               |
| [`4-adr-guide.md`](4-adr-guide.md)     | Is this a decision, and how do I record it?                    |
| [`5-currency.md`](5-currency.md)       | How does any of this stay true as the code moves?              |
| [`6-decisions.md`](6-decisions.md)     | Why is the standard itself shaped this way? (the DS log)       |
| [`templates/`](templates/)             | Copy-paste starting points                                     |

Applies to `fl_frontend`, `fl_backend`, and the deployment and ops surface.

---

## The one rule everything else follows

**Code documents the local and the changeable. `/docs` documents the cross-cutting and the decided.**

An inline comment says what not to do, at the line where doing it is tempting. An ADR says why, once,
in full. The comment cites the ADR number, so the argument exists in exactly one place.

Worked through on one subject — the `spiele` cache design:

| The fact                                                                             | Lives in                       | Because                                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------- |
| "Tags by phase or status are never added — a result edit _changes_ a match's status" | inline comment in `queries.ts` | It explains _this line_, and you need it when you are tempted to add a tag |
| "Every granular tag declared here is invalidated in this same file"                  | module header                  | It is a property of the module, not of any one line                        |
| "Twenty of twenty-two granular tags were deleted; here is the test that decided"     | ADR-0001                       | It is a decision with rejected alternatives, governing three slices        |
| "`spiele:saison_id:{id}` is set by `getSpiele`, invalidated by the patch action"     | frontend spec sheet            | It is a cross-file contract someone needs to look up                       |

**Nothing appears twice.** Writing the same sentence in two places means one of them is the wrong
place (P2).

## Terms

### Surface

One of the three parts of the system a reader goes to **as a whole**:

| Surface      | Is                                   | Lives in                                                     |
| ------------ | ------------------------------------ | ------------------------------------------------------------ |
| **frontend** | the Next.js app                      | `fl_frontend/`                                               |
| **backend**  | the FastAPI app                      | `fl_backend/`                                                |
| **ops**      | how it is built, routed and deployed | `docker-compose*.yml`, `nginx/`, `scripts/`, the Dockerfiles |

Three, because that is the granularity at which a question has **one** answer. "How does caching
work" is a frontend question and nothing else. "How is a request authenticated" is a backend
question. "What happens on deploy" is ops.

A surface is **not** a slice, a layer or a directory. `features/spiele` is smaller than a surface, and
gets its own page only if it deviates from the pattern the frontend spec sheet already describes.

### The three document types

| You are asking                                                 | Read           | Shape                          |
| -------------------------------------------------------------- | -------------- | ------------------------------ |
| "What is this part of the system, and how is it put together?" | **overview**   | ~120 lines of prose, read once |
| "What exactly does this take? What breaks if I change it?"     | **spec sheet** | tables, looked up              |
| "Why is it like this — and may I change it?"                   | **ADR**        | one decision, argued           |

Worked through on one real question — _may I delete the unconditional `updateTag("spiele")`, since
the granular tag covers it?_

- The **overview** says the frontend owns all caching because the browser never talks to FastAPI
  directly. Context, not an answer.
- The **spec sheet** gives invariant I2: base tags are invalidated unconditionally, and the reason it
  breaks is that the default read path sends no `saison_id`. That is the answer: no.
- The **ADR** says why, what the deleted tags were, and what would have to change for the answer to
  become yes.

Plus two pages that are cross-cutting and belong to no surface: the **glossary**
(`docs/glossary.md`), and the **domain model** (`docs/domain.md`). The second is a fourth shape — a
narrative over tables a test walks, so its claims are checked rather than reviewed
([ADR-0066](../_decisions/0066-the-domain-model-is-declared-and-conformance-checked.md)).

**Each layer has a different update trigger**, which is the point: an ADR is written once and never
edited, a spec sheet is edited when a constraint changes, an overview is rewritten only when a
surface's purpose changes. Nothing here needs a scheduled review, because nothing depends on one.

## Precedence

When two sources disagree, higher wins:

1. **The code**, and what it actually does.
2. **An ADR**, for anything it decided.
3. **A spec sheet**, for a current contract.
4. **CLAUDE.md**, which is a summary of 2 and 3.
5. **An overview**, which is orientation.

**If CLAUDE.md and an ADR disagree, the ADR is the source and CLAUDE.md is the summary** — so
CLAUDE.md gets corrected, never the ADR. Where a document disagrees with the code, the document is
wrong: fix it in the same commit that discovered it.

CLAUDE.md is the **enforcement layer** — rules, imperative, loaded into every assistant session, kept
short. This folder and `/docs` are the **reasoning layer**, read on demand.
