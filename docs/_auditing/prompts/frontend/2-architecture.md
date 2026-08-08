# Frontend pass 2 — architecture, consistency, dead code, tooling

Paste into a fresh session (or run via `/audit:pass frontend 2`).

---

Audit pass 2 of 6 on `./fl_frontend`. Lens: ARCHITECTURE, CONSISTENCY, DEAD CODE, TOOLING CONFIG.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/f2-architecture.md`. Read the f1 report first; cite, do not re-report.

DELIVERABLE: the layer-edge table (check 2) is required. Every other check gets a section with its findings or an explicit zero-occurrences row.

BASELINE — verify before starting, do not trust: `tsc --noEmit`, `eslint .`, `next build` and
`node --test` should all be clean/green (state what you actually observe, with counts). Findings in
this pass are judgment calls, not lint output — do not pad the report with what the toolchain
already proves. The layer rules, a11y rules and unknown-class rules run at `error`; anything they
would catch is already impossible, so this pass hunts what they cannot see.

THE CHECKS:

1. **Feature-slice conformance.** The conventions are ratified: slice module layout (queries/
   mutations/actions/schemas/types/constants + the sanctioned optional `utils.ts`/`resolvers.ts`),
   component category folders with one allowed nesting level, named exports (all three ADR-0003),
   the aggregator exception (ADR-0012), the Spiel write path's home (ADR-0005). Which
   slices deviate — and which put data fetching, business logic or schema definitions inside
   component files instead of the designated module?

2. **Layer boundaries, as an edge table.** Derive the actual import graph (`core` ↔ `shared` ↔
   `features`, cross-feature edges) and report it as a table of edges, **never as prose** — prose
   underspecifies an edge that runs through a single constant, and the table forces every edge to be
   named. The lint rules enforce `core`/`shared` direction; audit what they do not: cross-feature
   edges outside the
   sanctioned aggregator, any `eslint-disable` on the layer rules (each needs a named justification
   or is a finding), and type-only edges that would become value edges with one keyword slip.

3. **Duplication.** Near-identical components, duplicated schemas and utilities, repeated inline
   logic that belongs in an existing shared module — the shared recipes and shells exist now
   (`card`, `formButton`, `ModalShell`, `EntityForm`, `EmptyState`, the formatters), so the new
   defect shape is **bypass**: hand-written strings or components duplicating a recipe that already
   exists. Check `docs/_decisions/` before flagging a suspect — the three `SpielCard`s are three on
   purpose (ADR-0007).

4. **Dead code.** Unused exports, unreferenced files/components/assets, unused dependencies, dead
   config keys. `pnpm dlx knip` is the sanctioned tool — run it and triage its output rather than
   grepping from scratch; anything it flags still needs a manual zero-importer confirmation before
   being reported.

5. **Naming and organisation consistency.** Export/file name mismatches, handler-naming drift from
   `handleX`, English/German drift against the rule (English identifiers, German domain nouns, wire
   contract untouched), folder-depth violations.

6. **Tooling config vs reality.** Does each config do what it claims: prettier plugins and
   `tailwindFunctions` against actual usage; tsconfig strictness (what is on, what is measurably
   free to turn on); eslint coverage gaps for the failure modes this pass finds; dependency vs
   devDependency placement for runtime-imported packages; test-runner conventions (alias hook, no
   `test-*` tooling filenames) still holding.

Priority order: 2, 1, 3, 4, 6, 5.

BOUNDARIES — not this pass: deprecated idioms → f1 · caching/RSC semantics, validation → pass 3 ·
security → pass 4 · a11y/UX states → pass 5 · styling tokens, performance → pass 6.
