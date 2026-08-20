# The documentation corpus

**Verified against:** `c90a98dc`, 2026-08-20\
**Applies to:** the `docs/` tree — its layers, its layout, and every README in the repository.

| ID    | Rule                              |
| ----- | --------------------------------- |
| OUT-1 | Two layers, two update triggers   |
| OUT-3 | A README is orientation, plus one |
| OUT-4 | The spec-sheet spine              |
| OUT-6 | The glossary                      |
| OUT-8 | The surface                       |

---

### OUT-1 — Two layers, two update triggers

**Rule:** `docs/` holds two layers — the spec sheets, which are the current contract and are edited
when a constraint changes; and the surface overviews, which say what a surface is for and are
rewritten only when that changes. A new page is one of the two, or a named exception, or it does not
go in. Why something is built this way sits at the constraint itself — a comment at the line, a
CLAUDE.md §7 line, or a spec-sheet invariant — with the argument in the commit that made it.

**Why:** each layer's update trigger is attached to work that happens anyway, which is what lets the
corpus stay true without a scheduled review.

**Exceptions:** the cross-cutting references (OUT-8), the process folders (`docs/_standard/`,
`docs/_auditing/`, `docs/_git/`, `docs/_roadmap/`), and `docs/domain.md` — a narrative over tables a
test walks, so its claims are checked rather than reviewed.

**Enforced by:** unenforced — review judgment.

### OUT-3 — A README is orientation, plus at most one bounded body section

**Rule:** a README carries a title naming the folder, a `Folder purpose:` line, a navigation table
under `## Folder overview`, and at most **one** body section — the single thing a reader needs before
opening anything in the table. **Hard cap 120 lines.** The prohibitions bind inside the body section
too: no rules, no worked examples, no precedence, no term definitions, which live in a chapter, a
spec sheet or the glossary. A second body section means the content belongs in a spec.

A closing `## Read next` is navigation rather than a body section and does not count against that
bound. It appears only where a page worth opening next is one the navigation table does not already
reach.

This binds every folder's README, `docs/_standard/`'s included. The repository's root `README.md` is
the sole exception to this rule and its template, being the project's public landing page addressed
to a reader who has not cloned anything; the line cap still reaches it.

**Why:** a README that carries rules is a second copy of them, and the copy a reader lands on first is
the one that goes stale.

**Enforced by:** gate check `readme-cap` (the line cap); `/docs:audit` (the shape read).

**Example:** [`templates/readme.md`](../templates/readme.md).

### OUT-4 — The spec-sheet spine

**Rule:** a spec sheet opens with its stamp, its scope and its section table (COR-7), then carries
exactly four sections: `1. Contract`, holding as many `1.<n>` subsections as the surface needs;
`2. Invariants`; `3. Violation → remedy`; and `4. Known-open`.

The invariant table is three columns — the number, the invariant, and what enforces it. Numbers are
permanent and never reused, `I<n>` on a surface sheet and `L<n>` on the logging sheet, because an id
is resolved across every sheet and one prefix per sheet is what keeps a cited number unambiguous.
**Section 2 holds that table and nothing else**; a symptom a reader would observe is a row in section
3, and the argument for an invariant is in the commit that made it. Every claim carries an anchored
citation (COR-6).

**Why:** fixed closing sections make separate spec sheets read as one document, and a contract that
grows inside section 1 is what keeps those numbers fixed — a fifth contract section would push
Invariants down and silently repoint every citation of "section 3". Permanent invariant numbers do
the same job one level down, for a comment citing `I<n>`. Keeping section 2 to one table is what makes
the two kinds of row distinguishable at all: a remedy row parked among the invariants reads as an
invariant and is cited as one.

**Enforced by:** gate check `spec-spine` for the four sections and the contract's `1.<n>` numbering;
gate check `invariant-row` for a row's column count, its number's uniqueness, and a row in section 2
that is neither an invariant nor its header; gate check `invariant-id` for a cited number resolving
to a defined invariant; gate checks `citation` and `path` for the anchors. The rest is `/docs:audit`
(the shape read).

**Example:** [`templates/spec-sheet.md`](../templates/spec-sheet.md).

### OUT-6 — The glossary

**Rule:** the domain vocabulary lives in one file, `docs/glossary.md`, one entry per term: a `### `
heading giving the term as code spells it and a one-line gloss, then the fields `Is`, `In code`,
`Trap` and `See`, in that order. Where the code and the domain spell one thing differently, the
spellings share an entry rather than taking one each.

**Why:** the vocabulary is load-bearing and ambiguous in ways only the pitfall lines record, and
scattering it per surface would strand the cross-cutting terms. `Trap` is the field a hurried entry
drops and the one the glossary exists for.

**Enforced by:** gate check `glossary-entry` — the heading's shape, and the four fields in order.

### OUT-8 — The surface

**Rule:** a surface is one of the three parts of the system a reader goes to as a whole — frontend
(`fl_frontend/`), backend (`fl_backend/`), and ops (the compose files, `nginx/`, `scripts/`, the
Dockerfiles). Ops owns the scripts and what they guarantee; `docs/_git/` owns the pipeline that
invokes them and the GitHub configuration. Documentation is organised by surface because that is the
granularity at which a question has one answer. A surface is not a slice, not a layer, not a
directory. The references belonging to no surface are `docs/glossary.md`, `docs/logging/` and
`docs/domain.md`.

**Why:** "how does caching work", "how is a request authenticated" and "what happens on deploy" each
has exactly one home, and that is the property worth organising around.

**Enforced by:** unenforced — review judgment.
