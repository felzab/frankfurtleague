# Frontend pass 2 — architecture, excess, dead code, tooling

Audit pass `frontend 2` on `./fl_frontend`. Lens: ARCHITECTURE, CONSISTENCY, EXCESS, TOOLING CONFIG.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/f2-architecture.md`.

DELIVERABLE: required tables — the layer-edge table (check 2) and the excess table (check 3).
Every other check gets a section with its findings or an explicit zero-occurrences row.

BASELINE — run these before starting, and state the counts you observe: `tsc --noEmit`, `eslint .`,
`next build`, `node --test`. **A non-green baseline ends the pass** — report it and stop, because
what the toolchain already fails on is cheaper to fix than to audit around. Green, they define this
pass's floor: the layer rules, a11y rules and unknown-class rules run at `error`, so anything they
would catch is already impossible and this pass hunts what they cannot see. Do not pad the report
with what the toolchain already proves.

THE CHECKS:

1. **Feature-slice conformance.** The conventions are ratified: slice module layout (queries /
   mutations / actions / schemas / types / constants plus the sanctioned optional
   `utils.ts` / `resolvers.ts`), component category folders with one allowed nesting level, and named
   exports — ADR-0003 settles each of those — plus the aggregator exception (ADR-0008) and the Spiel
   write path's home (ADR-0004). Which slices deviate — and which put data fetching, business logic
   or schema definitions inside component files instead of the designated module?

2. **Layer boundaries, as an edge table.** Derive the actual import graph (`core` ↔ `shared` ↔
   `features`, cross-feature edges) and report it as a table of edges, **never as prose** — prose
   underspecifies an edge that runs through a single constant, and the table forces every edge to be
   named. The lint rules enforce `core` / `shared` direction; audit what they do not: cross-feature
   edges outside the sanctioned aggregator, any `eslint-disable` on the layer rules (each needs a
   named justification or is a finding), and type-only edges that would become value edges with one
   keyword slip.

3. **EXCESS — code that should not exist.** The required table, one row per candidate: what | every
   site as `<file> :: <symbol>` | class from the table below | which copy or construct dies, and what
   replaces it | size removed, in lines and exports | verdict.

   | Class         | The candidate                                                                                     |
   | ------------- | ------------------------------------------------------------------------------------------------- |
   | `duplicated`  | The same logic, component, schema or constant defined in two or more modules                      |
   | `one-caller`  | An abstraction — wrapper, hook, helper, context, indirection — with a single call site            |
   | `hand-rolled` | A reimplementation of what React, Next, HeroUI, zod or another installed package already provides |
   | `simpler`     | A plainly simpler construction reaching the same result                                           |
   | `dead-export` | Exported and imported by nothing                                                                  |
   | `dead-config` | A config key, script, asset or dependency nothing reads                                           |
   - **Every `duplicated` row names which copy dies** and confirms the survivor is reachable from
     where the dying copy's importers stand. A row proposing "extract a shared helper" without naming
     what it deletes adds a module and removes nothing.
   - **Every `one-caller` row states what inlining it would cost.** A single caller is a candidate,
     not a verdict.
   - **Every `hand-rolled` row cites the package API that replaces it**, verified at the installed
     version.
   - **Measure before proposing.** State the lines and exports each row removes; a row with no number
     is filed INFO.
   - `pnpm dlx knip` is the sanctioned tool for `dead-export` and `dead-config` — run it and triage
     its output rather than grepping from scratch, and confirm zero importers by hand before
     reporting anything it flags.
   - The shared recipes and shells (`card`, `formButton`, `ModalShell`, `EntityForm`, `EmptyState`,
     the formatters) are the enforcement layer, so the `duplicated` shape to hunt hardest is
     **bypass**: hand-written strings or components duplicating a recipe that already exists.
   - Check `docs/_decisions/` before flagging a suspect. The `SpielCard` variants are kept separate
     on purpose (ADR-0005), and ADR-0003 forbids the barrel file that would make several dead exports look
     reachable.

4. **Naming and organisation consistency.** Export and file name mismatches, handler-naming drift
   from `handleX`, folder-depth violations, and English/German drift: the domain vocabulary appears
   verbatim in code and is never translated (`docs/glossary.md`), everything that is not domain
   vocabulary is English, and neither rule reaches the wire contract.

5. **Tooling config vs reality.** Does each config do what it claims: prettier plugins and
   `tailwindFunctions` against actual usage; tsconfig strictness (what is on, what is measurably free
   to turn on); eslint coverage gaps for the failure modes this pass finds; dependency versus
   devDependency placement for runtime-imported packages; test-runner conventions (alias hook, no
   `test-*` tooling filenames) still holding.

Priority order: 2, 3, 1, 5, 4.

BOUNDARIES — not this pass: deprecated idioms and dead styling vocabulary → f1 · caching and RSC
semantics, validation, schema-to-type drift → f3 · security → f4 · accessibility and UX states →
f5 · styling tokens and performance → f6 · the same concept defined once per surface → the crosscut
pass.
