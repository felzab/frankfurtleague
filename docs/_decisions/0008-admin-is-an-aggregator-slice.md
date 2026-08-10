# ADR-0008 — `admin` is an aggregator slice, and cross-feature lints must be scoped

**Status:** Accepted\
**Date:** 2026-07-29\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Ratified 2026-07-29 by the frontend audit and remediation programme, whose permanent
record is `docs/_auditing/reports/2026-07-frontend.md`.

## Context

Slices are meant to be independent. `admin` imports from four others, and accounts for 27 of the 47
cross-feature import sites in the codebase — by a wide margin the largest violator of a rule the
architecture otherwise holds to.

The obvious remedy is a lint rule banning cross-feature imports.

## Decision

**`admin` is an aggregator, and its cross-slice imports are correct.**

**Any cross-feature import lint must be scoped to `core` and `shared` only.**

## Consequences

The concrete reason is `AdminContext`: it needs teams, venues and referees simultaneously, to feed the
lookup lists every admin form uses. No single slice owns all three. Something has to aggregate them, and
a slice whose job is aggregation is a better home than a route component, because it is named and
findable.

**A blanket cross-feature ban would flag 47 sites, of which 44 are correct.** A lint rule with that
signal-to-noise ratio gets suppressed at the call site or disabled outright, and then catches nothing —
which is worse than not having it. The scoped version (`core` must not import `shared` or `features`;
`shared` must not import `features`) fires only on real violations and is enforced in
`eslint.config.mjs` today.

The boundary this decision does **not** relax: entity slices must not depend on `admin`. Aggregation
flows one way. That is why the Spiel edit form takes its lookup lists as props rather than reading
`useAdmin()` — see [ADR-0004](0004-spiel-write-path-belongs-to-spiele.md).

## Alternatives considered

**Ban cross-feature imports everywhere and thread the three lists through props from each route.**
Rejected: it moves the aggregation into route components, where it is duplicated per route and invisible
to any tool.

**Move the shared lookup lists into `shared`.** Rejected: `shared` must not import `features`, and these
lists are typed as `FLTeam[]`, `FLSpielort[]`, `FLSchiedsrichter[]` — feature types. Putting them there
would invert the layer boundary that actually matters.

**Dissolve `admin` and give each entity slice its own admin components.** Partially adopted — the Spiel
write path did move out under [ADR-0004](0004-spiel-write-path-belongs-to-spiele.md). What cannot move
is the part that is genuinely multi-entity: the context, the sidemenu, and the aggregator views.
