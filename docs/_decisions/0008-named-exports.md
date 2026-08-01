# ADR-0008 — Named exports everywhere; default exports only where Next.js requires them

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** remediation ledger decision D4; recorded as a rule in CLAUDE.md §6

## Context

Components used default exports, which is the conventional React shape. Roughly 51 files were affected.

The audit had found three separate bugs of one kind: a file renamed without its export being renamed, an
import alias misspelled, and a component imported under a name that no longer matched what the file
exported. All three compiled.

## Decision

**Named exports everywhere under `src/`** — components, hooks and modules alike.

**Default exports only where Next.js requires them:** `page`, `layout`, `error`, `loading`,
`not-found`, `template`, `default`, and the `app/` metadata files. A route needing one re-exports it
explicitly:

```ts
export { SomeView as default } from "…";
```

## Consequences

The reason is type safety, not taste. **A default export has no name at the import site**, so
`import Foo from "./bar"` succeeds whatever `bar` exports and whatever it is called. Rename the file's
component, misspell the alias, point the path at the wrong module — all of it compiles, and the failure
appears at runtime as a component that renders nothing or the wrong thing.

A named import must match a name the module actually exports. Every one of those three bugs becomes a
compile error.

`src/features`, `src/shared` and `src/core` contain **zero** default exports as of Wave 8. The explicit
re-export in route files is slightly more verbose than the alternative and is the price of the rule
holding without exceptions.

## Alternatives considered

**Default exports for components, named for everything else.** The most common convention in React
codebases. Rejected: components are exactly where the rename-and-misspell bugs occurred, so exempting
them exempts the problem.

**Keep default exports and add a lint rule requiring the filename and export name to match.** Rejected:
it catches the rename case but not a misspelled import alias, and it enforces a naming convention rather
than the property actually wanted, which is that the import resolves to something that exists.
