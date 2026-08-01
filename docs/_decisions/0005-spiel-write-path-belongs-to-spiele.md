# ADR-0005 — The Spiel write path belongs to `spiele`, not `admin`

**Status:** Accepted
**Date:** 2026-07-31
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** remediation ledger NEW-F9; amends CLAUDE.md §9 A7

## Context

`actions.ts`, `mutations.ts`, the patch payload schema and `AdminEditSpielDataForm` all lived in
`features/admin`, because slices were organised by **who uses them**. The consequence was that `admin`
accumulated the CRUD for every entity in the system, while the entity slices held only reads.

The patch payload also composed from `spiele`'s field schemas — a cross-slice import that existed
purely because the two halves of one entity's contract had been separated.

## Decision

**Move the Spiel write path into `features/spiele`.** Slices are organised by business entity;
`admin` remains an aggregator of views, context and its own queries — see
[ADR-0012](0012-admin-is-an-aggregator-slice.md).

## Consequences

The patch payload now composes from the read model's own field schemas **within one slice**. Read/write
drift stops being discouraged and becomes structurally awkward: the write shape is literally built from
the read shape, in the same file.

**This creates a constraint that must not be undone.** `AdminEditSpielDataForm` needs three lookup
lists — teams, venues, referees — and they are available from `useAdmin()`, since the form only ever
renders on admin routes. It must not read that context: doing so would make `spiele` depend on `admin`
again, which is the exact dependency this move removed. The lists arrive as **props**, supplied by
`AdminSpielCardsList`. Providing them is what an aggregator slice is for.

A reader will be tempted by `useAdmin()` — it is less code and obviously available. The prop signature
is the only thing preventing it, so the reason is recorded at the component.

`admin` keeps: `AdminContext`, `AdminSidemenu`, the aggregator views, and `admin/queries.ts` — which
cannot move, because it is admin-authorized data rather than Spiel data
([ADR-0013](0013-admin-action-required-uncached.md)).

## Alternatives considered

**Leave the write path in `admin` and accept the cross-slice schema import.** Rejected: it made `admin`
grow without bound as entities gained write surfaces, and it put the two halves of one entity's contract
in two places, which is how they drift.

**Move the whole admin UI into the entity slices.** Rejected: `AdminContext` genuinely needs three
entities' data at once, so something has to aggregate. Dissolving `admin` entirely would push that
aggregation into a route component, where it would be less visible and impossible to lint.
