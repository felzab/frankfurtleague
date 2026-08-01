# ADR-0001 — Keep two granular cache tags, delete twenty

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend, backend
**Supersedes:** —
**Superseded by:** —
**Source:** remediation ledger decision D2; recorded as a rule in CLAUDE.md §6

## Context

The frontend declared 22 granular cache tags — `spiele:status:*`, `teams:gruppe:*`, `saisons:current`
and so on — alongside the coarse per-resource tags.

**Not one of them was ever invalidated.** No `updateTag` or `revalidateTag` call anywhere in the
codebase referenced any granular tag. They read as a caching strategy and functioned as decoration:
every one of them would have persisted until its entry aged out, whatever it was named.

Two of them were also misnamespaced (`spieler:` on a referee query), and one sat on a branch that never
executed, which is how long they had gone unexamined.

The choice was to wire all 22 up, or to delete the ones that could not work.

## Decision

**Keep `spiele:saison_id:*` and `teams:saison_id:*`, wire both up in the admin patch action, and delete
the other twenty.**

A granular tag earns its place only if both hold:

1. its resource has a frontend write surface that could invalidate it, and
2. a mutation exists that changes _some_ rows and not others along that dimension.

Only four resources have any frontend write surface at all: `spiele`, `teams`, `spielorte`,
`schiedsrichter`.

**Base tags stay, and are invalidated unconditionally.** They are not made redundant by the granular
ones — see Consequences.

## Consequences

Editing one match in one season no longer evicts every other season's cached lists. That was the
original goal.

`teams:saison_id:*` had to be included for a non-obvious reason: the same backend call that writes the
match also rewrites both teams' statistics, so team caches are stale too.

**The base tags are load-bearing, not belt-and-braces.** Since [ADR-0002](0002-omitted-season-means-current.md)
the default read path sends no `saison_id` at all, so the most frequently hit cache entries in the
application carry _only_ `spiele` and `teams`. Invalidating by season alone would leave exactly those
entries stale. Both layers are required.

A prerequisite surfaced that none of the five audit passes had found: `FLSpielSchema` did not declare
`saison_id`, so Zod's default `strip` mode discarded a field the backend was sending on every response
— and the action therefore had no season id to invalidate with. Worth carrying as a general suspicion:
a strict schema hides a _missing_ field as effectively as a loose one hides a wrong value.

**Standing rule, now in CLAUDE.md §6:** every granular tag added must ship with its matching
`updateTag` call in the same change. That rule is what prevents recreating the twenty.

The deleted set, by reason:

| Group                                                                   | Count | Why it could not work                                                            |
| ----------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| No write surface at all (`saisons`, `spieler`, `spieltage`, `system`)   | 11    | Nothing in the app can invalidate them                                           |
| Dimension the mutation itself changes (`spiele:status`, `spiele:phase`) | 2     | Correct invalidation needs the old value _and_ the new one; the action holds one |
| `teams` dimensions no mutation touches (gruppe, disqualification, …)    | 5     | The only mutation reaching teams is the statistics update                        |
| Unreachable branch                                                      | 2     | The declaring query is only ever called with no arguments                        |

## Alternatives considered

**Wire up all 22.** Rejected on the status and phase tags specifically, and that is the interesting
case: a result edit _changes_ a match's status, so invalidating `spiele:status:vergangen` correctly
would require knowing both the status before the edit and the status after. The action knows one of
them. A tag that is right half the time is worse than no tag, because the half it is wrong about is
invisible — the page simply serves stale data and nothing reports it.

**Delete all 22 and keep only base tags.** Simpler, and it was close. Rejected because the season
dimension is the one that genuinely matters at this data volume: a league accumulates seasons forever,
and evicting every historical season's cache on every result edit during the current season is the
exact waste the tags were introduced for.

**Rename the two misnamespaced tags rather than deleting them.** Moot — both fell in the delete set for
independent reasons, so the rename would have edited lines that no longer exist.
