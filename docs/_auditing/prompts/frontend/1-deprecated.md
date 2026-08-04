# Frontend pass 1 — deprecated and legacy patterns

Paste into a fresh session (or run via `/audit:pass frontend 1`).

---

Audit pass 1 of 6 on `./fl_frontend`. Lens: DEPRECATED AND LEGACY PATTERNS — anything written
against an older version of the stack, or a current API used in an outdated idiom.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/f1-deprecated.md`.

DELIVERABLE: one report section per row of the current CLAUDE.md deprecation table (check 1), plus sections for checks 2–4. Every row of that table gets a section even at zero occurrences, naming the searches run.

CONTEXT — derive, do not assume: read the **current** deprecation table in `.claude/CLAUDE.md` §2
at run time (never a copy — the table has been amended before) and the ratified decisions in §9 /
`docs/_decisions/`, several of which read as violations of §2 and are deliberate.

THE CHECKS:

1. **Walk every row of the current §2 deprecation table**, one report section per row, in table
   order. Per row: occurrence count, findings or an explicit zero-occurrences with the searches
   run. Where a row has a _behavioural_ equivalent a literal grep would miss, check that too — the
   canonical example: zero matches for `getServerSideProps` does not mean the caching model is
   current; audit whether `use cache` sits at the data layer and where `await connection()` opts
   renders out of prerendering (that check is what produced ADR-0009). For component-library rows,
   back a zero count with evidence: enumerate the compound sub-components actually in use, and
   check for previous-major prop idioms surviving on current components (`onClick` where react-aria
   expects `onPress`, and similar).

2. **Dead styling vocabulary.** Classes and tokens that compile and resolve to nothing — utilities
   from a previous library major, tokens renamed out from under their users, arbitrary values
   duplicating a token. The lint gate now errors on unknown classes; this check hunts what the rule
   cannot see (registered-but-dead tokens, shadowed names).

3. **Legacy idioms outside the table** — "current framework, wrong idiom": `"use server"` on files
   that are Server Components rather than action modules; deep imports into `next/dist/**` or other
   private internals; duplicated schema/type definitions that have already drifted; dead config
   keys referencing packages not in `package.json`. **Before flagging an idiom as outdated, verify
   the current recommendation against the official documentation** (CLAUDE.md lists the documentation sources).
   Never assert an idiom from memory — an audit that recommends replacing a current API with a
   deprecated one is worse than no finding.

4. **Version drift.** Installed versions (from `package.json`) versus current stable for the six
   §2-mandated technologies, with breaking changes that affect this repo. Where §2's own claims
   are contradicted by current docs, report the §2 correction as a finding.

Priority order: 1, 3, 2, 4.

BOUNDARIES — not this pass: structure/duplication/dead code → pass 2 · caching correctness beyond
the row-8 equivalence → pass 3 · security → pass 4 · a11y/UX → pass 5 · styling beyond dead
vocabulary, performance → pass 6.
