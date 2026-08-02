# ADR-0026 — Team statistics are derived from `spiele`, never stored

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item DB-1, the database structure review, which inherited this question from F4's
verification on the same day.

## Context

`FLTeamStatistik` carries seven numbers per team per season: matches played, wins, draws, losses,
goals for, goals against and points. Until this decision they were **stored** on the `saison_teams`
junction and maintained as `$inc` deltas by `update_team_statistik`, called inside the transaction in
`patch_spiel_data`.

That arrangement had already failed. Open item F4 established — statically, then against the live
database on 2026-08-02 — that the increments were written to the base `teams` collection while the
teams endpoint read from the junction. Entering or correcting a result did not move the league table,
and had not since commit `0b832d5` introduced the junction. The junction's figures were correct only
because somebody maintained them by hand.

Three facts from that verification and from DB-1's inspection bear directly on the choice:

- **A recomputation from the `spiele` documents reproduced every stored figure exactly** — all seven
  fields, all seventeen teams, season 2026. The stored numbers and a derivation are not merely
  compatible; they are identical on the real data, so switching between them can be proved to change
  nothing before it is done.
- **The database is tiny and will stay tiny.** A whole season is 31 matches, 17 teams and 362
  players; all nine collections together hold about 130 KB, less than their own `_id` indexes. Adding
  a season a year, read cost never becomes the binding constraint. Correctness is the only scarce
  resource.
- **The delta arithmetic has no test coverage.** `get_stats_contribution` and `update_team_statistik`
  are the trickiest ~100 lines in the backend — a two-case revert-and-apply structure whose own module
  header warns that "both functions have to be exactly right or the error accumulates silently across
  every subsequent edit" — and `tests/api/test_teams.py` exercises `FLTeamStatistik` only as a model.

Two open items were waiting on the answer. FB-1 must narrow the Saisontabelle to Gruppenphase
matches, and FE-3 must keep showing the all-games figures; under a stored field that is a schema
change, a backfill and two objects to keep in step for ever.

## Decision

**Derive `statistik` from the `spiele` documents on read. Do not store it.**

Concretely, for whoever implements F4:

- `build_team_pipeline` computes the seven fields, so the response shape is unchanged and no consumer
  moves. `statistik` remains an `FLTeamStatistik` on `FLTeam` and `FLTeamCompact`.
- Delete `update_team_statistik` and the `$inc` path entirely. `patch_spiel_data` keeps its
  transaction for the match document itself.
- **A match contributes to the table exactly when it carries an `ergebnis`.** `is_canceled` is not
  consulted: a cancelled match with a recorded result is a **forfeit**, and its result counts. This
  is the behaviour the `$inc` path had by accident — three matches in season 2026 are in that state —
  and it is hereby the intended rule, written down rather than inherited. State it in the pipeline
  and in `docs/glossary.md`, not only here.
- Points come from `FLSaison.rules.win_points` / `draw_points` rather than a hardcoded 3/1/0 once the
  season is in the pipeline. That field exists today and is read by nothing.
- Remove `statistik` from the `saison_teams` documents once the derived path is live. Leaving a stale
  copy in the database is precisely the condition F4 describes.

## Consequences

**What it costs.**

- `GET /teams` gains a lookup into `spiele` and a grouping stage, on every call including the
  `compact` shape. At 31 match documents this is not measurable; the cost is real but the scale
  makes it irrelevant, and this ADR is only sound while that stays true.
- The arithmetic moves from a pure Python function into aggregation stages, which cannot be
  unit-tested without a database. The suite loses the _ability_ to test it cheaply — though it was
  not testing it anyway. Whoever implements this should add integration coverage rather than assume
  the pipeline is obvious.
- `GET /teams` now fails if a `spiel` document is malformed, where before the two were independent.
  `ergebnis` is pattern-constrained and `tore` is `ge=0`, so the surface is narrow, but it exists.

**What it enables.**

- The drift category disappears. There is no second copy to be wrong, so no future write path —
  BE-4's season editing, FB-2's disqualifications, FB-4's auto-advance — can forget to update it.
- **FB-1 stops being a schema change.** A Gruppenphase-only table is
  `$match: {saison_phase: "gruppenphase"}` in the pipeline; FE-3's all-games figures are the same
  pipeline without it. FB-1's XL rating was largely the data correction, and should be revisited.
- `FLSaison.rules` becomes live instead of decorative, so a season may change its points scheme.

**A constraint this creates.** Anyone reading `build_team_pipeline` afterwards will see a table
recomputed on every request and reach for a cached or stored copy. That is this decision being
reversed, not an optimisation. Cite this ADR at the pipeline.

**Recorded, not decided:** `spieltage.anzahl_spiele` is the same pattern — a stored count of
something countable, maintained by hand, correct on all six matchdays as measured on 2026-08-02. It
is the obvious second candidate and is carried in `docs/roadmap/open-items.md` under DB-2.

## Alternatives considered

**Keep it stored and fix the write path** — point `update_team_statistik` at `saison_teams`, filtered
by team and season. This was F4's original mechanical fix and is the smallest change available; the
season is already in hand inside the transaction, so the payload would not have moved. Rejected
because it repairs this instance of the bug without touching the category. Two sources of truth
remain two sources of truth, the untested delta arithmetic remains load-bearing for ever, and FB-1
still needs a second stored object plus a backfill.

**Keep it stored, but recompute and `$set` the whole object after each edit** rather than applying
deltas. The genuine runner-up: self-healing, reads stay cheap, and the arithmetic stays a pure,
testable function. Rejected because it still requires a write path that fires on _every_ mutation,
including the ones that do not exist yet — a season edit under BE-4, a disqualification under FB-2 —
and forgetting one is silent in exactly the way F4 was. It also still needs the backfill and the
second stored object for FB-1, so it buys a read cost that does not matter at the price of the
maintenance burden that does.

**Store it, but have Mongo maintain it** — a materialised view refreshed by `$merge`, or a change
stream on `spiele`. Rejected as machinery out of all proportion to 31 documents: it adds an
operational component to keep alive, on an Atlas Flex cluster, to avoid a lookup that costs nothing.
