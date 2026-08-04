# Out-of-code documentation

**Verified against:** `5ad4a85`, 2026-08-04

Governs everything under `/docs`. The principles in [`1-principles.md`](1-principles.md) apply here
too; this chapter adds the shapes.

**ADRs are one of three layers, not the whole of it.** An ADR records why a decision was taken and
says nothing about what the system currently is — which is what spec sheets and overviews are for.

Every example is the `spiele` slice, the same subject as [`2-in-code.md`](2-in-code.md).

| Section                                                    | Covers                                |
| ---------------------------------------------------------- | ------------------------------------- |
| [The three layers](#the-three-layers)                      | Which shape answers which question    |
| [Folder layout](#folder-layout)                            | Where a new document goes             |
| [Layer 1 — ADRs](#layer-1--adrs)                           | Pointer to the ADR chapter            |
| [Layer 2 — spec sheets](#layer-2--spec-sheets)             | Anatomy, and the tables that carry it |
| [Layer 3 — surface overviews](#layer-3--surface-overviews) | Scope and the length ceiling          |
| [Diagrams](#diagrams)                                      | Mermaid, C4 levels 1–3                |
| [The glossary](#the-glossary)                              | One entry per domain term             |
| [Keeping pages current](#keeping-pages-current)            | Pointer to the currency chapter       |

---

## The three layers

| Layer          | Answers                                  | Format                                                | Written when        | Edited when                          |
| -------------- | ---------------------------------------- | ----------------------------------------------------- | ------------------- | ------------------------------------ |
| **ADR**        | why is it like this, and may I change it | numbered MADR, append-only                            | a decision is taken | **never** — superseded instead       |
| **Spec sheet** | is this still true, what is the contract | tables + numbered invariants, each citing a file/line | once per surface    | a constraint changes                 |
| **Overview**   | what is this surface for                 | ~120 lines of narrative                               | once per surface    | the surface's purpose changes (rare) |

Plus the **glossary**, which is cross-cutting and belongs to no surface.

The different update triggers are the design. Nothing here requires a scheduled review, because nothing
here depends on one.

---

## Folder layout

Central, organised **per surface**. No per-file documentation — that job belongs to the module headers.

```
docs/
├── _standard/              this folder — how the repo is documented
├── _decisions/             ADRs — 0001-*.md, plus README.md and the index
├── README.md               entry point
├── roadmap/                open items and future ideas
├── workflows/              how work ships, plus the commit/PR/issue templates
├── glossary.md             the German domain vocabulary
├── frontend/
│   ├── overview.md
│   ├── spec.md
│   └── slices/             only where a slice deviates from the template
├── backend/
│   ├── overview.md
│   └── spec.md
├── ops/
│   ├── overview.md
│   └── spec.md
├── _auditing/              how audit programmes are run, plus their permanent final reports
└── audit/                  gitignored, local-only — the working documents of a running audit
```

A per-slice page exists **only where a slice deviates**. Twelve slices that follow the template cost
zero pages; the template is described once in `frontend/spec.md`.

### What sits at the root of `docs/`, and why

Two rules, which between them decide where anything new goes:

- **A directory holds a collection.** `_decisions/` holds many ADRs; `_standard/` holds many rule
  documents; each surface holds its overview and spec. The underscore marks the two that are
  **cross-cutting meta** — about the docs and the decisions themselves — so they sort above the three
  surfaces and never read as a fourth one.
- **A single cross-cutting reference document sits at the root as a file.** `glossary.md` and
  belongs to no surface and has no siblings, so wrapping it in a directory would add a level of
  navigation for one file. `README.md` is the entry point. `workflows/` went the other way once it
  gained a second document on the same theme, which is this rule working as intended.

So the test for something new is: _does it belong to one surface?_ If yes, it goes in that surface's
directory. If no, it is a root-level file — until there are two or three of them on one theme, at which
point they become a directory and the underscore question is whether they are about the docs (`_`) or
about the project (no `_`).

Note that `CLAUDE.md` lives at **`.claude/CLAUDE.md`**, not in `docs/`. It is configuration for the
coding assistant rather than documentation of the project, and it is loaded automatically from there.

---

## Layer 1 — ADRs

Covered in full in [`4-adr-guide.md`](4-adr-guide.md). Template: [`templates/adr.md`](templates/adr.md).

The short version: one decision, dated, numbered, with its rejected alternatives. Never rewritten — when
reversed, you write a new one and change two lines in the old one. Cited from code by number.

The test for whether something is an ADR: **would someone reasonably propose the opposite next year, and
would you have to re-derive the argument to refuse?**

### Why ADRs are _not_ split by surface

Everything else in `/docs` is organised per surface. The ADR log deliberately is not: it is one flat,
globally numbered folder. **Surfaces own descriptions; the log owns decisions.**

Four reasons, in order of how much they bite:

1. **Decisions routinely span surfaces.** Filing one under a single surface makes it invisible from the
   others, and forces an arbitrary choice at write time. From this repo's own history:

   | Decision                         |                Frontend                 |                      Backend                      |                      Ops                      |
   | -------------------------------- | :-------------------------------------: | :-----------------------------------------------: | :-------------------------------------------: |
   | Cache tags (ADR-0001)            |      tags declared and invalidated      | `patch_spiel_data` rewrites team stats per season |                                               |
   | Season default (ADR-0002)        | removed a serialised lookup on 8 routes |                 the router change                 |                                               |
   | Revalidation route (ADR-0015)    |           Next route handler            |                    the caller                     |           nginx routing, `scripts/`           |
   | `connection()` guards (ADR-0009) |            every page fetch             |                                                   | Docker builder stage has no reachable backend |

2. **The number is a permanent identity cited from code.** A flat folder means the path never changes.
   Scope does move here — the Spiel write path migrated from `admin` to `spiele` in Wave 8 — and a
   surface-filed ADR would have wanted to move with it, breaking every citation.
3. **Numbering is global.** Split folders make "what is the next number" a multi-directory search.
   Per-surface numbering (`ADR-FE-0001`) avoids that and breaks the moment a decision spans two.
4. **The log reads chronologically.** In order, `_decisions/` is the history of the project's thinking.
   Splitting it destroys that for no gain.

**Browsing by surface is the index's job, not the filesystem's.** `_decisions/README.md` carries a
`Surface` column, so the per-surface view exists without the per-surface folders. Each surface overview
also links the ADRs relevant to it.

The underscore prefix is not decoration: `_standard/` and `_decisions/` are the two **cross-cutting**
things in `/docs`, and the prefix sorts them above the three surfaces so they never read as a fourth
one.

---

## Layer 2 — spec sheets

The layer that makes a claim checkable. Two things distinguish a spec sheet from prose:

1. **Every claim carries an anchored citation** — a file plus a symbol or a quoted fragment, or an
   ADR number. **Never a line number** (P6): it is wrong after any edit above it and nothing detects
   that. A reader who doubts a row settles it in seconds, and the gate can check the anchor still
   resolves.
2. **Invariants are numbered**, so code comments and ADRs can reference them.

### Anatomy

```markdown
# <Surface> — spec

**Governing decisions:** ADR-000N, ADR-000M

## 1. Contract what this surface exposes, as tables

## 2. Invariants numbered, each with what enforces it and what breaks

## 3. Violation → remedy symptom, cause, fix

## 4. Known-open accepted gaps, with the item that owns them
```

### Example — an invariants table

Real rows from the `spiele` cache design:

| #   | Invariant                                                                       | Enforced by                                                               | Breaks how                                                                                               |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| I1  | Every granular cache tag has a matching `updateTag` in a server action          | review (a CLAUDE.md rule)                                                 | Tag never invalidates; looks like coverage, is decoration                                                |
| I2  | Base tags `spiele`/`teams` are invalidated unconditionally on every Spiel write | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")`       | The default read path sends no `saison_id`, so its entries carry only base tags and go permanently stale |
| I3  | `saison_id` reaches the action as an argument, never on the patch body          | `fl_frontend/src/features/spiele/actions.ts :: patchAdminSpielDataAction` | Pydantic drops undeclared fields silently — a dead field that looks load-bearing                         |

Note the third column. An invariant without a stated failure mode is a preference; with one, it is a
constraint someone can weigh.

### Example — a contract table

| Param       | Type          | Default            | Notes                                                                                     |
| ----------- | ------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `saison_id` | `str \| None` | **current season** | Resolved in the router, not as a field default — a default cannot query the DB (ADR-0002) |
| `limit`     | `int`         | `1024`             | `ge=1, le=1024`                                                                           |

### Example — violation → remedy

| Symptom                               | Cause                                                         | Remedy                                             |
| ------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Edit saved, list still shows old data | Granular tag invalidated but the entry carries only base tags | Check I2 — base `updateTag`s must be unconditional |
| Team table drifts after result edits  | `ReturnDocument.AFTER` on the match write                     | Restore the pre-write read (I13)                   |

Template: [`templates/spec-sheet.md`](templates/spec-sheet.md).

---

## Layer 3 — surface overviews

**Around 120 lines, treated as a ceiling.**

The number matters less than what it forces: an overview that is growing is one that has started
explaining mechanisms, and mechanisms belong in the spec sheet. If a section is describing _how_
something works rather than _what it is and why it is shaped that way_, move it.

An overview says what the surface is for, names its major parts, and links onward. It does not explain
mechanisms — that is the spec sheet — and it does not argue — that is the ADR.

### Example, abridged

> ## Frontend — overview
>
> A Next.js 16 app on the App Router. The browser never talks to FastAPI directly: every application
> read is a server-side fetch from the Next container, which is why the whole caching design lives
> here and not in the backend.
>
> Code is organised in **slices** under `src/features/`, one per business entity. A slice holds its own
> queries, mutations, server actions, schemas and components; there are no barrel files anywhere, on
> purpose (ADR-0003). `core` is infrastructure and may not import from `shared` or `features`; `shared`
> may not import `features`. Both boundaries are enforced by ESLint.
>
> `admin` is the exception and is meant to be: it is an aggregator that legitimately imports from four
> other slices (ADR-0012).
>
> **Read next:** `spec.md` for contracts and invariants · `../glossary.md` for the domain vocabulary.

Template: [`templates/surface-overview.md`](templates/surface-overview.md).

---

## Diagrams

**Mermaid**, so they render in-repo on GitHub without a build step.

Scope, deliberately limited (DS10):

- **C4 levels 1–3 only** — system context, containers, components. **No level 4** (code diagrams): a
  class or file diagram duplicates the source and rots immediately. Code layout goes in the spec sheet
  as a directory tree, which is cheap to keep right.
- Diagrams live in **surface overviews**, plus a spec sheet where a data flow is genuinely hard in
  prose. Not in ADRs — an ADR is an argument, and an argument is prose.
- A `sequenceDiagram` is worth it when ordering carries the meaning. The Spiel write path is the
  motivating case: the backend read that returns the **pre-write** document is the source of the
  statistics delta, and that is far clearer as a numbered sequence than as a paragraph.

Avoid square brackets inside quoted mermaid node labels — write `dashboard/teams/:team_id`, not
`dashboard/teams/[team_id]`, which some renderers choke on.

---

## The glossary

`docs/glossary.md`, one file, cross-cutting (DS11).

The German domain vocabulary is load-bearing, and some of it is ambiguous in ways only the maintainer
currently knows. One entry per term:

| Field    | Content                                    |
| -------- | ------------------------------------------ |
| Term     | The German word as it appears in code      |
| Means    | A one-line English gloss                   |
| In code  | Where it lives — collection, schema, field |
| Pitfalls | The part that bites                        |

Example entry:

> ### `saison_phase`
>
> **Means:** which stage of the season a match belongs to.
> **In code:** `FLSaisonPhase` — `gruppenphase` · `viertelfinale` · `halbfinale` · `finale`
> (`fl_backend/app/api/spiele/schemas.py :: FLSaisonPhase`).
> **Pitfalls:** `"playoffs"` is _not_ one of the four values. It is a query-only alias, compiled by
> `build_spiele_filter` to `saison_phase != "gruppenphase"`. It never appears on a stored document.

That last line is the kind of thing that costs an hour to rediscover and thirty seconds to write down.

---

## Keeping pages current

The mechanisms are [`5-currency.md`](5-currency.md) — anchored citations, the same-commit rule, the
documentation gate, and the close-out question. Two things specific to `/docs`:

**Open items are tracked in [`../roadmap/open-items.md`](../roadmap/open-items.md).** A discrepancy
found while documenting is **recorded, not fixed** — it goes there with its analysis and the code
stays untouched, because a documentation change that quietly also changes behaviour is unreviewable.
When an item is concluded its entry is deleted and a pointer row is added to
[`../roadmap/closed-items.md`](../roadmap/closed-items.md), so the id stays findable and the analysis
lives in exactly one place: the closing commit.

**A confidently wrong page is worse than a missing one** (P4, P9). Where something cannot be verified,
the page says so plainly rather than filling the gap with plausible prose.

### Documents must be self-contained (DS12)

**Never cite `docs/audit/` as the substance of a claim.** The audit is expected to be deleted; a
document whose reasoning lives behind a reference to it is a document that becomes hollow the day that
happens.

So: where the audit settled a question, **write the reasoning out here, in full**, in your own words. A
reader must be able to understand and act on the claim with `docs/audit/` gone.

Audit references are permitted only as **provenance** — a `Source:` line on an extracted ADR, saying
where a decision originally came from. Provenance can rot harmlessly. Substance cannot.

The same rule applies to `/docs` pages referring to each other: a spec sheet states its invariant in
full and cites the ADR for the argument. It does not say "see ADR-0001" _instead_ of stating the
invariant.

Where the audit is out of date, say so and follow the code: **the code and git history outrank every
document here.**

### Documents name only what exists (DS14)

**No page may refer to a file, symbol, field, endpoint or behaviour that is not in the repository.** A
spec sheet naming a deleted endpoint reads exactly like one naming a live endpoint, which is why this
costs more here than in a comment — a reader has no way to tell the two apart without checking.

Two shapes are banned by name: **narrating an edit** ("this endpoint moved from `/api/v0/admin/…`") and
**documenting an absence for its own sake** (a paragraph about a variant that is gone). A **rejected
alternative** is neither, and stays — written in the present, as a constraint. Full argument:
[DS14](6-decisions.md#ds14--documentation-names-only-what-exists).

Three places are exempt because recording what changed is their job, and only within it: an **ADR's
`Context` section**, which has to describe the state the decision replaced or the decision is
unreadable; [`../roadmap/closed-items.md`](../roadmap/closed-items.md), whose rows are past-tense by
construction; and an **ADR's `Superseded by` line**. An ADR's **Decision** and **Consequences** are
present tense like any other document.
