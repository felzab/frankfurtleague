# ADR-0063 — A cancellation is counted by a `$lookup` of its own, never beside the scoring

**Status:** Accepted\
**Date:** 2026-08-10\
**Surface:** backend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Roadmap item FB-7, whose entry pre-authorised a new counted field and required the
boundary to be written down at the stage: "the next reader will see `is_canceled` in a pipeline an
ADR says does not consult it."

## Context

[ADR-0019](0019-team-statistics-are-derived-from-spiele.md) derives a team's table figures from the
`spiele` documents on every read, and fixes the counting rule: a match counts **exactly when it
carries an `ergebnis`**, with `is_canceled` deliberately not consulted, because a cancelled match
carrying a result is a forfeit and a forfeit counts.

FB-7 then asked for a team's short match count to explain itself — a badge saying how many of that
team's fixtures were called off and never played. That number cannot come from the shortfall between
a group's fixtures and a team's played matches, because the shortfall is a mixture of cancellations
and fixtures nobody has played yet, and no stored field distinguishes them. It has to come from the
documents that positively carry `is_canceled: true` with a null `ergebnis`.

So the figure requires reading, inside `build_team_pipeline`, the one flag ADR-0019 says the
derivation does not consult. Both keys are required on every `spiele` document by the `$jsonSchema`
validator ([ADR-0020](0020-the-database-enforces-its-own-invariants.md)), so a `$match` on either is
exact rather than dependent on a key being present.

**The obvious construction is one `$lookup` that counts both**, since the two counts read the same
collection, filtered by the same season, the same team and the same
scope ([ADR-0022](0022-the-league-table-counts-the-gruppenphase.md)). One measurement decides against
it, and it is a property of MongoDB rather than of this schema: **`$eq: [null, null]` evaluates to
true.** A cancelled fixture carries no goal counts, so under a widened `$match` its projected
`tore_self` and `tore_opponent` are both null, and the draw accumulator — `$cond: [{$eq:
["$tore_self", "$tore_opponent"]}, 1, 0]` — increments on it.

## Decision

**The cancellation count is derived by a second `$lookup` of its own, and the `$match` deriving the
scoring figures is never widened to admit a document without a result.**

- `build_ausfall_lookup_stage` selects `is_canceled: true` together with `ergebnis: null`, counts
  what it finds with `$count`, and feeds `anzahl_ausgefallene_spiele` and nothing else.
- `build_statistik_lookup_stage` selects on `ergebnis` and the goal counts, and no clause of the
  stage it builds names `is_canceled`.
- Both take their in-scope match from one builder, so `statistik_scope` keeps a single
  implementation and the two counts can never answer for different sets of matches.
- The outer projection merges the cancellation count **over** the scoring figures, so a team whose
  season holds no counting match — served the zeroed fallback rather than a `$group` document —
  still receives a real cancellation count.

**`is_canceled` deciding a figure is not ADR-0019 reversed while that figure reaches neither
`punkte` nor any criterion the table sorts on.** ADR-0019's clause is scoped to the counting rule,
and this is a count beside it. What would reverse ADR-0019 is the flag reaching the scoring.

## Consequences

**`GET /teams` gains a second lookup into `spiele` per team**, on every call. ADR-0019 already
accepted the first on the ground that a season is a few dozen match documents and correctness is the
scarce resource; the same bound carries this one, and this decision is sound only while it holds.

**The two `$match` clauses do not partition the fixtures, and one shape falls between them**: a
cancellation carrying an `ergebnis` whose goal counts are null. The scoring lookup drops it on the
null goals, this one drops it on the non-null `ergebnis`, so it is absent from every figure rather
than wrong in one. No endpoint produces it, because `apply_payload_to_spiel` composes `ergebnis`
from the goal counts; a hand-edited or legacy document can. Widening either clause to claim it would
make that clause guess which of the document's two disagreeing facts was meant, so it is recorded in
`docs/backend/spec.md`'s known-open table rather than repaired.

**A reader meeting two lookups over one collection will reach to merge them.** That is this decision
being reversed, not an optimisation, and the cost is silent: a cancellation scores as a draw, and no
test in either pipeline suite fails. Cite this ADR at the stage.

**The seeded corpus carries called-off fixtures**, so the boundary is executed rather than asserted:
`fl_backend/tests/api/test_teams_pipeline_execution.py` proves the scoring figures do not move, as a
whole-set equality derived from `FLTeamStatistik.model_fields` rather than a spot check.

## Alternatives considered

**One `$lookup` counting both, with the accumulators guarded.** The construction this decision
exists to refuse. Its `$match` becomes an `$or` over the counting rule and the cancellation rule,
and every accumulator then needs a `$cond` distinguishing the two kinds of row. Rejected because
those guards do not fail alike, and the one that matters is invisible. Four of them forgive being
forgotten: goals sum harmlessly over a null, and wins and losses fall out on `$gt` and `$lt` against
nulls. `anzahl_gespielte_spiele` does not forgive it — unguarded it is a `$sum` of 1 over the
widened `$match` and counts the cancellation as played — but it fails in the open, contradicting the
cancellation count standing beside it. **The draw accumulator is the one that fails silently:**
`$eq: [null, null]` is true, so each cancellation becomes a draw, one point under the season's
rules, while every other figure stays right and every existing assertion passes. A defect whose only
symptom is a standing that is quietly one point out is worse than a second lookup over a few dozen
documents.

**Counting cancellations in Python, from the fixtures the standing already loads.**
`build_decided_standings` reads `is_canceled` per match, so the number could be derived there and
attached without touching the pipeline. Rejected because `statistik` is served by `GET /teams` on
every read including the compact shape, while the standing is computed on far fewer paths — the
field would be absent exactly where the badge renders. It also splits one team's figures across two
derivations, which is the two-sources-of-truth shape ADR-0019 removed.

**Deriving the badge from the shortfall** — a group's fixture count minus the team's played matches
— with no new field at all. Rejected because the shortfall is a mixture: it counts fixtures nobody
has played yet as though they had been called off, which is the false statement FB-7 named as worse
than saying nothing. How many fixtures a season should hold is itself derived from the season's
rules ([ADR-0052](0052-a-seasons-schedule-is-derived-from-its-rules.md)) and is no evidence about
any individual fixture.

**Storing the count on the junction row.** Rejected on ADR-0019's own argument, which this decision
does not reopen: a stored derivation is a cache with no invalidation, and every future write path
would have to remember it.
