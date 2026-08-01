# ADR-0004 — `utils.ts` and `resolvers.ts` are sanctioned optional slice modules

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** CLAUDE.md §9 A4

## Context

A slice's canonical modules are `queries.ts`, `mutations.ts`, `actions.ts`, `schemas.ts`, `types.ts` and
`components/`. Four slices also carry a `utils.ts` or a `resolvers.ts`, which looks like drift — two
extra module kinds with no obvious rule about when they apply.

## Decision

**Both are sanctioned. They hold code that must not live in `queries.ts`.**

- `utils.ts` — pure domain derivation. `computeSpielStatus`, `formatSpielDisplay`,
  `computeErgebnisFor`, `formatMapsLink`.
- `resolvers.ts` — bridges a route parameter to a validated value. `resolveSaisonId` serves nine page
  components; `resolveTeamId` validates a dynamic segment.

## Consequences

The reason they cannot be folded into `queries.ts` is mechanical: **`queries.ts` is a `"use cache"`
module.** Putting a pure function inside it makes that function part of a cached module for no reason,
and `resolveSaisonId` in particular reads `searchParams`, which is exactly the kind of request-scoped
input a cached function must not touch.

So the split is not stylistic. It follows from what `"use cache"` means.

The rule for a reader deciding where something goes: if it performs I/O or caches, it belongs in
`queries.ts` or `mutations.ts`. If it derives a value from data already in hand, it belongs in
`utils.ts`. If it turns a URL into a validated value, it belongs in `resolvers.ts`.

There is a placement corollary worth stating, because it has bitten: a derivation that takes a slice's
own type must live in that slice, not in `shared`. `formatMapsLink` takes an `FLSpielort`, so hosting it
in `shared/utils/format.ts` would force a `shared → features` type import and break the layer boundary
that ESLint enforces.

## Alternatives considered

**Fold both into `queries.ts` for a uniform five-module slice.** Rejected for the `"use cache"` reason
above — uniformity would be bought by putting non-caching code inside a caching module.

**A single `lib.ts` per slice holding both kinds.** Rejected: derivation and route-parameter resolution
have different callers and different risks. `resolvers.ts` is a trust boundary — it validates URL input
that reaches the backend under an API key — and merging it with formatting helpers would bury that.
