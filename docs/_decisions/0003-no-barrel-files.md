# ADR-0003 — No barrel files, anywhere

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** CLAUDE.md §9 A3

## Context

Twelve feature slices, none with an `index.ts`. Every import names the file it wants
(`@/features/spiele/queries`), never the slice. This reads like an omission — a barrel per slice is the
conventional shape — and it is not.

## Decision

**Zero barrel files. Import from the file you mean.**

## Consequences

Imports are longer and name a path rather than a slice. That is the whole cost.

The benefit is that tree-shaking survives the server/client boundary. A barrel re-exporting a slice's
public surface pulls the entire slice into any module that imports one symbol from it — and across the
RSC boundary that means client bundles acquiring server-only modules, or at best a great deal of dead
code the bundler cannot prove is dead.

This is the same problem `optimizePackageImports` in `next.config.ts` exists to undo for third-party
packages that ship barrels. Adding our own would be introducing the defect that config works around.

There is a second, smaller benefit: an import path names a file, so a reader can find the definition
without following a re-export chain.

## Alternatives considered

**A barrel per slice, exposing an intentional public surface.** The usual argument for barrels is
encapsulation — the slice decides what is importable. Rejected on cost: it buys a convention that a lint
rule can enforce for free, and pays for it with a bundling problem that is invisible until a client
bundle is inspected.

**If per-slice public surfaces are wanted later, express them with `no-restricted-imports`** — a rule
that forbids reaching into a slice's internals, with no runtime module involved. The layer boundaries
on `core` and `shared` are already enforced exactly that way, so the mechanism is proven in this
codebase.
