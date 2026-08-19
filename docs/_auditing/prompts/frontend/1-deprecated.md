# Frontend pass 1 — deprecated and legacy patterns

Audit pass `frontend 1` on `./fl_frontend`. Lens: DEPRECATED AND LEGACY PATTERNS — anything written
against an older version of the stack, or a current API used in an outdated idiom.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/f1-deprecated.md`.

CONTEXT — derive, do not assume: read the **current** deprecation table in `.claude/CLAUDE.md` (the
"Deprecations the toolchain will NOT catch" table) at run time, never a copy, and the
ratified-decisions index beside it, several rows of which read as violations of that table and are
deliberate. **Cite CLAUDE.md's sections by name — its numbering moves.**

THE CHECKS:

1. **Walk every row of the current deprecation table**, one report section per row, in table order,
   each carrying its occurrence count and its findings or an explicit zero-occurrences with the
   searches run — the pass's deliverable. Where a row has a _behavioural_ equivalent a literal grep
   would miss, check that too: zero matches for `getServerSideProps` does not mean the caching model
   is current, so audit whether `use cache` sits at the data layer and where `await connection()`
   opts renders out of prerendering. For component-library rows, back a zero count with evidence —
   enumerate the compound sub-components actually in use, and check for previous-major prop idioms
   surviving on current components (`onClick` where react-aria expects `onPress`, and similar).

2. **Dead styling vocabulary.** Classes and tokens that compile and resolve to nothing — utilities
   from a previous library major, tokens renamed out from under their users, arbitrary values
   duplicating a token. The unknown-class lint rule (`fl_frontend/eslint.config.mjs`) covers one part
   of this; the check hunts what that rule cannot see (registered-but-dead tokens, shadowed names).

3. **Legacy idioms outside the table** — "current framework, wrong idiom": `"use server"` on files
   that are Server Components rather than action modules; deep imports into `next/dist/**` or other
   private internals; dead config keys referencing packages not in `package.json`. **Verify the
   current recommendation against the official documentation before flagging an idiom as outdated**
   (CLAUDE.md's stack section lists the documentation sources).

4. **Version drift.** Installed versions (from `package.json`) versus current stable for the
   technologies CLAUDE.md's stack section mandates, with the breaking changes that affect this repo.
   Where one of CLAUDE.md's own claims is contradicted by current docs, report that correction as a
   finding.

Priority order: 1, 3, 2, 4.

BOUNDARIES — not this pass: structure, duplication, excess and dead code → f2 · caching correctness
beyond the deprecation table's behavioural equivalents, schema and type drift → f3 · security → f4 ·
accessibility and UX → f5 · styling beyond dead vocabulary, performance → f6.
