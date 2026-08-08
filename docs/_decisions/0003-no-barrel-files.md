# ADR-0003 — The frontend file layout: no barrels, named exports, category folders, optional slice modules

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** CLAUDE.md §9 rules A3 and A4, and remediation-ledger decisions D4 and D5, all of
2026-07-29. Retired numbers 0004, 0006 and 0008 recorded the optional slice modules, the category
folders and the export rule as separate decisions; they are one layout and are kept as one.

## Context

Twelve feature slices, none with an `index.ts`. Every import names the file it wants
(`@/features/spiele/queries`), never the slice. This reads like an omission — a barrel per slice is the
conventional shape — and it is not.

A slice's canonical modules are `queries.ts`, `mutations.ts`, `actions.ts`, `schemas.ts`, `types.ts` and
`components/`. Four slices also carry a `utils.ts` or a `resolvers.ts`, which looks like drift — two
extra module kinds with no obvious rule about when they apply.

Components sat at inconsistent depths across slices: some in category folders, some flat in
`components/`, some nested two or three levels deep with no rule about when. And components used
default exports, the conventional React shape, across roughly 51 files — where the audit had found
three separate bugs of one kind: a file renamed without its export being renamed, an import alias
misspelled, and a component imported under a name that no longer matched what the file exported. All
three compiled.

## Decision

### No barrel files, anywhere

**Zero barrel files. Import from the file you mean.**

### Named exports everywhere

**Named exports everywhere under `src/`** — components, hooks and modules alike.

**Default exports only where Next.js requires them:** `page`, `layout`, `error`, `loading`,
`not-found`, `template`, `default`, and the `app/` metadata files. A route needing one re-exports it
explicitly:

```ts
export { SomeView as default } from "…";
```

### Component category folders

**`features/<slice>/components/<category>/Component.tsx`**, where `<category>` is one of `views`,
`collections`, `forms`, `modals`, `providers`, `ui`.

**One extra level is permitted for a multi-section form** — `forms/AdminEditSpielDataForm/` is the
reference example, holding the form plus its four section files and three helpers.

Nothing nests deeper. Nothing sits flat in `components/`.

### The optional slice modules

**`utils.ts` and `resolvers.ts` are sanctioned. They hold code that must not live in `queries.ts`.**

- `utils.ts` — pure domain derivation. `computeSpielStatus`, `formatSpielDisplay`,
  `computeErgebnisFor`, `formatMapsLink`.
- `resolvers.ts` — bridges a route parameter to a validated value. `resolveSaisonId` serves nine page
  components; `resolveTeamId` validates a dynamic segment.

## Consequences

**Imports are longer and name a path rather than a slice.** That is the whole cost of the barrel rule.
The benefit is that tree-shaking survives the server/client boundary. A barrel re-exporting a slice's
public surface pulls the entire slice into any module that imports one symbol from it — and across the
RSC boundary that means client bundles acquiring server-only modules, or at best a great deal of dead
code the bundler cannot prove is dead. This is the same problem `optimizePackageImports` in
`next.config.ts` exists to undo for third-party packages that ship barrels; adding our own would be
introducing the defect that config works around. There is a second, smaller benefit: an import path
names a file, so a reader can find the definition without following a re-export chain.

**The export rule is type safety, not taste.** A default export has no name at the import site, so
`import Foo from "./bar"` succeeds whatever `bar` exports and whatever it is called. Rename the file's
component, misspell the alias, point the path at the wrong module — all of it compiles, and the failure
appears at runtime as a component that renders nothing or the wrong thing. A named import must match a
name the module actually exports, so every one of the three audit bugs becomes a compile error.
`src/features`, `src/shared` and `src/core` contain **zero** default exports (verified in the
remediation's Wave 8, 2026-07-29). The explicit re-export in route files is slightly more verbose than
the alternative and is the price of the rule holding without exceptions.

**A component's category is inferable from its path alone**, which is what makes the layout navigable
without opening files. The one-level form exception is bounded so it cannot become a general escape
hatch: a form large enough to want two extra levels is a form that should be split into separate forms.
The categories are not arbitrary — they carry different rendering constraints:

- `views` are page-level compositions, usually the thing a route renders
- `collections` place many of one thing
- `ui` are leaves
- `modals` and `forms` are overwhelmingly client components
- `providers` hold context

Knowing the category tells you roughly whether to expect `"use client"`, which matters because that
directive has a non-obvious failure mode — see [ADR-0009](0009-connection-guards-every-data-fetch.md)'s
sibling note on render props in CLAUDE.md's repo-specific traps.

**The slice-module split is mechanical, not stylistic: `queries.ts` is a `"use cache"` module.**
Putting a pure function inside it makes that function part of a cached module for no reason, and
`resolveSaisonId` in particular reads `searchParams`, which is exactly the kind of request-scoped
input a cached function must not touch. The rule for a reader deciding where something goes: if it
performs I/O or caches, it belongs in `queries.ts` or `mutations.ts`. If it derives a value from data
already in hand, it belongs in `utils.ts`. If it turns a URL into a validated value, it belongs in
`resolvers.ts`. There is a placement corollary worth stating, because it has bitten: a derivation that
takes a slice's own type must live in that slice, not in `shared`. `formatMapsLink` takes an
`FLSpielort`, so hosting it in `shared/utils/format.ts` would force a `shared → features` type import
and break the layer boundary that ESLint enforces.

## Alternatives considered

**A barrel per slice, exposing an intentional public surface.** The usual argument for barrels is
encapsulation — the slice decides what is importable. Rejected on cost: it buys a convention that a lint
rule can enforce for free, and pays for it with a bundling problem that is invisible until a client
bundle is inspected. **If per-slice public surfaces are wanted later, express them with
`no-restricted-imports`** — a rule that forbids reaching into a slice's internals, with no runtime
module involved. The layer boundaries on `core` and `shared` are already enforced exactly that way, so
the mechanism is proven in this codebase.

**Default exports for components, named for everything else.** The most common convention in React
codebases. Rejected: components are exactly where the rename-and-misspell bugs occurred, so exempting
them exempts the problem.

**Keep default exports and add a lint rule requiring the filename and export name to match.** Rejected:
it catches the rename case but not a misspelled import alias, and it enforces a naming convention rather
than the property actually wanted, which is that the import resolves to something that exists.

**Flat `components/` per slice.** Rejected: a slice like `spiele` has nineteen components, and a flat
directory gives a reader no signal about which are pages, which are leaves, and which carry client
state.

**Category folders with no exception at all.** Rejected: `AdminEditSpielDataForm` is one form split
across four section files plus helpers, and flattening those into `forms/` would mix eight files
belonging to one component with the other forms in the slice.

**Unlimited nesting where it seems natural.** Rejected: that is the state this decision replaced.
"Where it seems natural" produced three different depths for the same kind of thing.

**Fold `utils.ts` and `resolvers.ts` into `queries.ts` for a uniform five-module slice.** Rejected for
the `"use cache"` reason above — uniformity would be bought by putting non-caching code inside a
caching module.

**A single `lib.ts` per slice holding both kinds.** Rejected: derivation and route-parameter resolution
have different callers and different risks. `resolvers.ts` is a trust boundary — it validates URL input
that reaches the backend under an API key — and merging it with formatting helpers would bury that.
