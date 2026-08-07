"""
TEAMS · aggregation pipeline, and the group standing

Two halves. `build_team_pipeline` and `build_statistik_lookup_stage` build the read pipeline for
`GET /teams`. `build_gruppen` and `build_decided_standings` order each group by the competition's
tiebreak chain and answer which placings no remaining result can still change (ADR-0043) -- pure
throughout, so the whole ranking is testable without a database.

The pipeline's shape exists because a team document is SEASON-INDEPENDENT: name, shorthand, address
and description live on `teams`, while `gruppe` and `disqualifikation` are scoped to a season and live
on the `saison_teams` junction, joined here. `statistik` is season-scoped too and is joined from
nowhere -- it is DERIVED from that season's `spiele` documents by a second lookup. `FLTeam` flattens
all of it back together, which is why the model looks like one document and is not.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `statistik` is COMPUTED on every read and stored nowhere. There is no second copy to drift, which
    is the whole point -- see the DECISIONS note below before reaching for a cache.
  • A match counts towards the table exactly when it carries an `ergebnis`. `is_canceled` is
    deliberately NOT consulted: a cancelled match with a recorded result is a FORFEIT, and a forfeit
    counts. Three matches in season 2026 are in that state.
  • `elfmeterschiessen` is NOT consulted either. A knockout settled on penalties is a draw for every
    figure here, while the bracket advances a winner from it -- the two disagree about that fixture
    deliberately (ADR-0044).
  • WHICH matches are in scope is `filters.statistik_scope`, and it defaults to the Gruppenphase. The
    league table is a group standing, so a playoff result must not move it; `"gesamt"` is the same
    pipeline without the phase filter, and is what a team's own page asks for.
  • Points come from the season's own `rules`, so the pipeline cannot be built from the filters
    alone -- it takes an `FLSaisonRules` as well.
  • A resolved `saison_id` is REQUIRED. The statistics are per season, so building without one would
    silently return every team's table as zeros rather than raise.
  • With a `saison_id` the junction join is STRICT (`preserveNullAndEmptyArrays: False`). A team with
    no junction row for that season disappears from results entirely rather than returning with unset
    `gruppe`, which would fail response validation.
  • The base `$match` runs BEFORE both lookups, on purpose -- filtering after a join costs memory.
  • ONE ordering serves the displayed table and the bracket. `build_gruppen` sorts what the
    Saisontabelle renders and `build_decided_standings` decides what a `gruppe` reference seeds, and
    both run the same chain over the same `_tiers` -- so the two cannot say different things about who
    finished second.
  • Points are passed INTO `_tiers` rather than read off `statistik`, because the certainty check ranks
    the same teams under results that have not happened. The base numbers still come from the pipeline,
    so ADR-0026's counting rule has exactly one implementation.
  • A tie is only broken below points for teams whose figures are FINAL. Nothing bounds a goal margin,
    so a team with a match still to play has an unbounded goal difference and a points tie involving
    one cannot be settled by anything under it.

 DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────

  ADR-0026  team statistics are derived from `spiele`, never stored -- so caching or storing the
            table here is that decision reversed, not an optimisation
  ADR-0029  the league table counts the Gruppenphase, and that is the default scope
  ADR-0043  the tiebreak chain, who may hold a placing, and what makes one final
  ADR-0044  a shoot-out is its own scoreline, so the table counts the fixture as a draw

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/_decisions/0026-team-statistics-are-derived-from-spiele.md -- the decision, and what it rejected
  docs/_decisions/0029-the-league-table-counts-the-gruppenphase.md -- the scope, and why it defaults
  docs/_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md
  docs/glossary.md -- "Statistik", the same counting rules in domain terms
"""

from dataclasses import dataclass
from itertools import product
from typing import AbstractSet, Any, Iterable, Mapping, Sequence, get_args

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSpiel
from app.api.teams.schemas import FLGruppen, FLGruppenNames, FLTeam, FLTeamsFilterParams, FLTeamStatistik, FLTeamStatistikScope
from app.shared.schemas.custom import CustomObjectId

SAISON_TEAMS_COLLECTION_NAME = "saison_teams"
SPIELE_COLLECTION_NAME = "spiele"
AS_NAME = "saison_data"
STATISTIK_AS_NAME = "statistik_data"

# What a team whose season holds no counting match gets. Derived from the model rather than written
# out, so a field added to FLTeamStatistik cannot be forgotten here and fail response validation.
ZERO_STATISTIK: Mapping[str, int] = {field_name: 0 for field_name in FLTeamStatistik.model_fields}


def build_statistik_lookup_stage(saison_id: str, rules: FLSaisonRules, scope: FLTeamStatistikScope) -> Mapping[str, Any]:
    """
    The `$lookup` deriving one team's seven statistics from the season's matches (ADR-0026).

    A match counts exactly when it carries an `ergebnis`. `is_canceled` is deliberately not consulted:
    a cancelled match with a result is a forfeit, and a forfeit counts.

    **`elfmeterschiessen` is not consulted either, and that is the same kind of deliberate omission.** A
    knockout settled on penalties is a DRAW here -- one point each, one entry in `unentschieden`, and
    the shoot-out's own counts nowhere in `tore_geschossen` (ADR-0044). The bracket reads that fixture
    the other way and advances a winner from it
    (`fl_backend/app/api/spiele/services.py :: _outcome_of`), so the table and
    the bracket say different things about the same match ON PURPOSE. That is what every competition
    scoring a shoot-out does, and it is why the two counts are a scoreline of their own rather than
    goals: adding them to `tore` would move a league table on kicks that were never part of the match.

    `scope` decides which matches are in scope at all (ADR-0029): `"gruppenphase"` is the league table
    and narrows to that phase, `"gesamt"` is every phase and is what a team's own page shows.
    """

    is_this_team_in_slot_one = {"$eq": ["$team1.team_id", "$$team_oid"]}

    phase_match: Mapping[str, Any] = {"saison_phase": "gruppenphase"} if scope == "gruppenphase" else {}

    return {
        "$lookup": {
            "from": SPIELE_COLLECTION_NAME,
            "let": {"team_oid": "$_id"},
            "pipeline": [
                {
                    "$match": {
                        "saison_id": saison_id,
                        # The phase rule (ADR-0029), and the only difference between the two tables.
                        # Absent entirely under "gesamt" rather than negated -- there is no
                        # `saison_phase` value meaning "any", and an `$in` over all four would have to
                        # be widened by hand the day a fifth phase is added.
                        **phase_match,
                        # The counting rule, in one place. Note what is absent: `is_canceled`
                        # (ADR-0026) and `elfmeterschiessen` (ADR-0044). A shoot-out decides the
                        # bracket and never the table -- see the docstring above.
                        "ergebnis": {"$ne": None},
                        # `ergebnis` is derived from these two by the admin write path, so this restates
                        # the line above rather than adding a rule. It is restated because a document
                        # edited by hand is the one place the two can disagree, and a null goal count
                        # would then group as a 0:0 draw instead of dropping out.
                        "team1.tore": {"$ne": None},
                        "team2.tore": {"$ne": None},
                        "$expr": {"$or": [is_this_team_in_slot_one, {"$eq": ["$team2.team_id", "$$team_oid"]}]},
                    }
                },
                {
                    # Both teams are embedded in the one match document, so each match is first turned
                    # around to face THIS team before anything is counted.
                    "$project": {
                        "_id": 0,
                        "tore_self": {"$cond": [is_this_team_in_slot_one, "$team1.tore", "$team2.tore"]},
                        "tore_opponent": {"$cond": [is_this_team_in_slot_one, "$team2.tore", "$team1.tore"]},
                    }
                },
                {
                    "$group": {
                        "_id": None,
                        "anzahl_gespielte_spiele": {"$sum": 1},
                        "siege": {"$sum": {"$cond": [{"$gt": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "unentschieden": {"$sum": {"$cond": [{"$eq": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "niederlagen": {"$sum": {"$cond": [{"$lt": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "tore_geschossen": {"$sum": "$tore_self"},
                        "tore_kassiert": {"$sum": "$tore_opponent"},
                    }
                },
                {
                    # Points come last, from the season's own rules. A defeat adds nothing because
                    # FLSaisonRules carries no loss_points -- that is the model's statement, not a
                    # third constant chosen here.
                    "$project": {
                        "_id": 0,
                        "anzahl_gespielte_spiele": 1,
                        "siege": 1,
                        "unentschieden": 1,
                        "niederlagen": 1,
                        "tore_geschossen": 1,
                        "tore_kassiert": 1,
                        "punkte": {
                            "$add": [
                                {"$multiply": ["$siege", rules.win_points]},
                                {"$multiply": ["$unentschieden", rules.draw_points]},
                            ]
                        },
                    }
                },
            ],
            "as": STATISTIK_AS_NAME,
        }
    }


def build_team_pipeline(filters: FLTeamsFilterParams, rules: FLSaisonRules, team_id: Any | None = None) -> list[Mapping[str, Any]]:
    # Not a filter that may be omitted: the statistics below are per season, so without one this would
    # match no match at all and hand back a table of zeros that looks like a real answer. The router
    # resolves it (ADR-0002) before calling.
    if filters.saison_id is None:
        raise ValueError("build_team_pipeline requires a resolved saison_id -- statistics are derived per season (ADR-0026).")

    pipeline: list[Mapping[str, Any]] = []

    # ==========================================
    # STAGE 1: PRE-LOOKUP FILTER (Base Collection)
    # ==========================================
    base_match: dict[str, Any] = {}

    # Clubs that have left the league (ADR-0032). Not the same as a team disqualified FOR a season --
    # that is `disqualifikation` on the junction, filtered inside the lookup below, and a disqualified
    # team stays in the table.
    if not filters.include_inactive:
        base_match["inactive_since"] = None

    # An argument rather than a filter field: `GET /teams/{team_id}` addresses one document, and the
    # difference between "this team" and "teams matching" is the difference between a path and a query.
    if team_id is not None:
        base_match["_id"] = team_id

    # Apply the base match BEFORE the lookup to save memory
    if base_match:
        pipeline.append({"$match": base_match})

    # ==========================================
    # STAGE 2: IN-LOOKUP FILTER (Junction Collection)
    # ==========================================
    # Use Pydantic's model_dump with your specific includes for the season data
    lookup_filters = filters.model_dump(
        include={"saison_id", "gruppe"},
        exclude_none=True,
        context={"keep_oid": True},
    )

    # Translated rather than dumped: `is_disqualified` is a question about whether the junction row
    # holds a `disqualifikation` record, and the row stores no boolean to match it against (ADR-0059).
    # `$ne: null` also excludes a row missing the key entirely, which is the state the runbook's first
    # step removes and the validator then forbids.
    if filters.is_disqualified is not None:
        lookup_filters["disqualifikation"] = {"$ne": None} if filters.is_disqualified else None

    lookup_pipeline: list[Mapping[str, Any]] = [{"$match": {"$expr": {"$eq": ["$team_id", "$$base_team_id"]}}}]

    if lookup_filters:
        lookup_pipeline.append({"$match": lookup_filters})

    pipeline.append(
        {
            "$lookup": {
                "from": SAISON_TEAMS_COLLECTION_NAME,
                "let": {"base_team_id": "$_id"},
                "pipeline": lookup_pipeline,
                "as": AS_NAME,
            }
        }
    )

    # ==========================================
    # STAGE 3: FLATTENING
    # ==========================================
    strict_join = bool(getattr(filters, "saison_id", None))
    pipeline.append(
        {
            "$unwind": {
                "path": f"${AS_NAME}",
                "preserveNullAndEmptyArrays": not strict_join,
            }
        }
    )

    # ==========================================
    # STAGE 4: DERIVED STATISTICS
    # ==========================================
    # After the strict unwind, so the matches are only summed for teams that survive the join.
    pipeline.append(build_statistik_lookup_stage(saison_id=filters.saison_id, rules=rules, scope=filters.statistik_scope))

    # ==========================================
    # STAGE 5: PROJECTION
    # ==========================================
    # One projection, because there is one team shape. Never branch a reduced variant off it: measured
    # 2026-08-02, the trim is 26 KiB across all 17 teams and no query work at all -- both lookups above
    # run either way -- in exchange for a second hand-mirrored model pair (ADR-0034).
    pipeline.append(
        {
            "$project": {
                "_id": 1,
                "name": 1,
                "shorthand": 1,
                "address": 1,
                "description": 1,
                "full_name": 1,
                "website_url": 1,
                "inactive_since": 1,
                # The lookup yields one grouped document, or none at all for a team with no counting
                # match -- `$group` emits nothing for an empty input rather than a row of zeros.
                "statistik": {"$ifNull": [{"$first": f"${STATISTIK_AS_NAME}"}, ZERO_STATISTIK]},
                "saison_id": f"${AS_NAME}.saison_id",
                "gruppe": f"${AS_NAME}.gruppe",
                "disqualifikation": f"${AS_NAME}.disqualifikation",
            }
        }
    )

    # ==========================================
    # STAGE 6: SORTING & LIMITING
    # ==========================================
    pipeline.append({"$sort": {filters.sort_by: 1 if filters.order == "asc" else -1, "name": 1}})

    if getattr(filters, "limit", None) is not None:
        pipeline.append({"$limit": filters.limit})

    return pipeline


# =====================================================================================================
# THE GROUP STANDING
# =====================================================================================================

# How many fixtures a group may still have to play before the certainty check gives up. Every
# combination of outcomes is walked, so the work is 3^n: a four-team group is six fixtures and a
# five-team group is ten, which is where this sits. Beyond it nothing is reported as final, which is
# both the safe direction and the honest one -- a group with eleven matches left holds no placing
# anybody could have clinched.
CERTAINTY_FIXTURE_LIMIT = 10


def _counted_goals(spiel: FLSpiel) -> tuple[CustomObjectId, int, CustomObjectId, int] | None:
    """
    One match as `(team1_id, tore1, team2_id, tore2)`, or `None` when it does not count.

    The counting rule is `build_statistik_lookup_stage`'s, restated in Python because a standing has to
    ask the same question of a match the pipeline has already summed: a match contributes exactly when
    it carries an `ergebnis` and both sides' goals (ADR-0026). `is_canceled` is deliberately not
    consulted -- a cancelled match with a result is a forfeit, and a forfeit counts. Neither is
    `elfmeterschiessen`: a shoot-out is a draw everywhere a standing is derived, including the
    head-to-head mini-table this feeds (ADR-0044).
    """

    if spiel.ergebnis is None or spiel.team1 is None or spiel.team2 is None:
        return None
    if spiel.team1.tore is None or spiel.team2.tore is None:
        return None

    return spiel.team1.team_id, spiel.team1.tore, spiel.team2.team_id, spiel.team2.tore


def _goal_key(team: FLTeam) -> tuple[int, int]:
    """Goal difference, then goals scored -- the two criteria under points that `statistik` answers."""

    return (team.statistik.tore_geschossen - team.statistik.tore_kassiert, team.statistik.tore_geschossen)


def _head_to_head_keys(
    teams: Sequence[FLTeam],
    spiele: Iterable[FLSpiel],
    rules: FLSaisonRules,
) -> Mapping[CustomObjectId, tuple[int, int, int]]:
    """
    The mini-table over the matches `teams` played against EACH OTHER: points, goal difference, goals.

    Applied to a whole tied set rather than pair by pair, which is what makes it the standard
    formulation: with three teams level, "who beat whom" is not even transitive, so a pairwise rule
    can order A above B above C above A.

    Points come from the season's own `rules`, exactly as the full table's do, and a defeat again adds
    nothing because `FLSaisonRules` carries no `loss_points`.
    """

    ids = {team.id for team in teams}
    punkte = dict.fromkeys(ids, 0)
    geschossen = dict.fromkeys(ids, 0)
    kassiert = dict.fromkeys(ids, 0)

    for spiel in spiele:
        counted = _counted_goals(spiel)
        if counted is None:
            continue

        team1_id, tore1, team2_id, tore2 = counted
        if team1_id not in ids or team2_id not in ids:
            continue

        geschossen[team1_id] += tore1
        kassiert[team1_id] += tore2
        geschossen[team2_id] += tore2
        kassiert[team2_id] += tore1

        if tore1 == tore2:
            punkte[team1_id] += rules.draw_points
            punkte[team2_id] += rules.draw_points
        else:
            punkte[team1_id if tore1 > tore2 else team2_id] += rules.win_points

    return {team_id: (punkte[team_id], geschossen[team_id] - kassiert[team_id], geschossen[team_id]) for team_id in ids}


def _break_tie(band: Sequence[FLTeam], spiele: Iterable[FLSpiel], rules: FLSaisonRules) -> list[list[FLTeam]]:
    """
    Teams level on points, split by everything below it.

    Goal difference, then goals scored, then the head-to-head table among whoever is still level.

    Every member's figures are final -- the caller checks that before asking, because a team with a
    match left has an unbounded goal difference and ordering on it would be ordering on a guess.
    """

    by_goals: dict[tuple[int, int], list[FLTeam]] = {}
    for team in band:
        by_goals.setdefault(_goal_key(team), []).append(team)

    tiers: list[list[FLTeam]] = []
    for goal_key in sorted(by_goals, reverse=True):
        still_level = by_goals[goal_key]
        if len(still_level) == 1:
            tiers.append(still_level)
            continue

        head_to_head = _head_to_head_keys(still_level, spiele, rules)
        by_head_to_head: dict[tuple[int, int, int], list[FLTeam]] = {}
        for team in still_level:
            by_head_to_head.setdefault(head_to_head[team.id], []).append(team)

        # One pass, not a recursion back to the top of the chain: a set that the head-to-head table
        # cannot separate either is a genuine tie, and it is reported as one rather than resolved by
        # a further criterion nobody has chosen (ADR-0043).
        tiers.extend(by_head_to_head[key] for key in sorted(by_head_to_head, reverse=True))

    return tiers


def _tiers(
    teams: Sequence[FLTeam],
    punkte: Mapping[CustomObjectId, int],
    settled: AbstractSet[CustomObjectId],
    spiele: Iterable[FLSpiel],
    rules: FLSaisonRules,
) -> list[list[FLTeam]]:
    """
    `teams` split into descending bands, highest first.

    A band of one is a team whose position is decided; a band of several is a tie nothing in the chain
    could break.

    `punkte` is passed in rather than read off `statistik` because `build_decided_standings` ranks these
    same teams under results that have not happened yet. The base numbers are still the pipeline's, so
    ADR-0026's counting rule keeps exactly one implementation.

    `settled` names the teams whose goals are final. A band containing one that is not stays whole:
    nothing bounds a goal margin, so a team with a match left can end anywhere within its points band
    and ordering the rest around it would assert a placing that is still moving.

    Within a band the input order survives, which is the pipeline's sort by `name` -- so a tie the chain
    cannot break renders alphabetically rather than arbitrarily.
    """

    by_punkte: dict[int, list[FLTeam]] = {}
    for team in teams:
        by_punkte.setdefault(punkte[team.id], []).append(team)

    tiers: list[list[FLTeam]] = []
    for score in sorted(by_punkte, reverse=True):
        band = by_punkte[score]
        if len(band) == 1 or not all(team.id in settled for team in band):
            tiers.append(band)
            continue

        tiers.extend(_break_tie(band, spiele, rules))

    return tiers


def _may_hold_a_platz(team: FLTeam, still_to_play: int) -> bool:
    """
    Whether a team can occupy a placing a bracket slot could name.

    Two exclusions, and both exist so the table and the bracket say the same thing (ADR-0043). A
    DISQUALIFIED team keeps its row in the standing and cannot advance out of it, so the placings walk
    past it and the team below takes the place. A team with NO MATCH THAT COUNTS OR STILL COULD holds no
    placing at all: the pipeline serves it a zeroed `statistik`, which ranks above every team with a
    negative goal difference, and `SaisontabelleView` already prints `N/A` rather than a position there.

    `still_to_play` is what makes this one rule rather than two. Read on the table as it stands it is
    zero, and the second clause is "has played"; read while a group is running it also admits a team
    whose first fixture is still to come.
    """

    return team.disqualifikation is None and (team.statistik.anzahl_gespielte_spiele + still_to_play) > 0


def _spiele_by_gruppe(
    spiele: Iterable[FLSpiel],
    gruppe_of: Mapping[CustomObjectId, FLGruppenNames],
) -> tuple[dict[FLGruppenNames, list[FLSpiel]], set[FLGruppenNames]]:
    """
    Each group's own fixtures, and the groups holding a fixture that cannot be attributed to one.

    A fixture belongs to a group when BOTH of its sides are teams of that group. The second half of the
    answer is the exception that matters: a fixture still to be played with a side nobody has entered
    yet will award points inside some group and can be given no outcome, so no placing in a group it
    touches is final while it stands -- and one with NO entered side touches every group, because
    nothing bounds which teams it will turn out to involve.
    """

    by_gruppe: dict[FLGruppenNames, list[FLSpiel]] = {name: [] for name in get_args(FLGruppenNames)}
    unattributable: set[FLGruppenNames] = set()

    for spiel in spiele:
        left = gruppe_of.get(spiel.team1.team_id) if spiel.team1 is not None else None
        right = gruppe_of.get(spiel.team2.team_id) if spiel.team2 is not None else None

        if left is not None and left == right:
            by_gruppe[left].append(spiel)
            continue

        if _counted_goals(spiel) is None and not spiel.is_canceled:
            if spiel.team1 is None and spiel.team2 is None:
                # NO side to attribute at all -- a hand-built fixture, since the season's fixtures are
                # created with their teams. It will award points inside some group and nothing can say
                # which, so no group's placing is final while it stands. A fixture whose sides are
                # known but outside the standings entirely is the opposite case and falls through: its
                # points reach no team a placing could name.
                unattributable.update(get_args(FLGruppenNames))
            else:
                unattributable.update(name for name in (left, right) if name is not None)

    return by_gruppe, unattributable


def _still_to_play(spiele: Iterable[FLSpiel]) -> Mapping[CustomObjectId, int]:
    """How many fixtures each team has left -- neither counted nor called off, so still to be awarded."""

    counts: dict[CustomObjectId, int] = {}
    for spiel in spiele:
        if _counted_goals(spiel) is not None or spiel.is_canceled:
            continue
        for side in (spiel.team1, spiel.team2):
            if side is not None:
                counts[side.team_id] = counts.get(side.team_id, 0) + 1

    return counts


@dataclass(frozen=True)
class DecidedStanding:
    """
    Which placings in one group no remaining result can still change (ADR-0043).

    `by_platz` holds only the placings that come out the same however the group's outstanding fixtures
    go. An absent placing means one of two different things, and the caller can tell them apart:
    `is_complete` false is "not yet", which is the ordinary state of a running group, while
    `is_complete` true is a tie the chain could not break and needs a person.

    `eligible` counts the teams that can hold a placing at all, so a reference naming a `platz` beyond
    it is naming one this group will never produce.
    """

    eligible: int
    is_complete: bool
    by_platz: Mapping[int, FLTeam]


def _decide_one_gruppe(
    teams: Sequence[FLTeam],
    spiele: Sequence[FLSpiel],
    rules: FLSaisonRules,
    still_to_play: Mapping[CustomObjectId, int],
    has_unattributable: bool,
) -> DecidedStanding:
    """One group's decided placings, by walking every way its outstanding fixtures could still go."""

    # Both sides are known for every fixture `_spiele_by_gruppe` attributes to a group, so the two
    # checks below narrow the type rather than branching on anything.
    open_pairs: list[tuple[CustomObjectId, CustomObjectId]] = [
        (spiel.team1.team_id, spiel.team2.team_id)
        for spiel in spiele
        if _counted_goals(spiel) is None and not spiel.is_canceled and spiel.team1 is not None and spiel.team2 is not None
    ]

    eligible = [team for team in teams if _may_hold_a_platz(team, still_to_play.get(team.id, 0))]
    is_complete = not open_pairs and not has_unattributable

    if has_unattributable or len(open_pairs) > CERTAINTY_FIXTURE_LIMIT:
        return DecidedStanding(eligible=len(eligible), is_complete=is_complete, by_platz={})

    settled = frozenset(team.id for team in eligible if still_to_play.get(team.id, 0) == 0)
    base = {team.id: team.statistik.punkte for team in eligible}
    order = [team.id for team in eligible]

    # Deduplicated by the points table each set of outcomes produces, because that table is the whole
    # input to the ranking below. Different results awarding the same points rank identically, so ten
    # outstanding fixtures produce far fewer distinct tables than the 3^10 ways of playing them.
    #
    # Ranked as the walk goes rather than after collecting every table, so the walk STOPS the moment
    # no placing survives -- which is the ordinary state of a group with most of its fixtures open,
    # and what keeps a week-one save from enumerating 3^10 outcomes whose answer is already known to
    # be "nothing is decided". Measured before the interleave: a five-team group with all ten
    # fixtures open cost ~850 ms per save inside the write transaction; it now exits within the first
    # few outcomes. The full product still runs where something IS decided, because certainty is a
    # claim about every outcome and cannot be had cheaper.
    #
    # A group with nothing left to play falls through here as a single empty product, which is the same
    # code path reading the table as it stands.
    decided: Mapping[int, FLTeam] | None = None
    seen: set[tuple[int, ...]] = set()
    for outcomes in product((1, 0, 2), repeat=len(open_pairs)):
        punkte = dict(base)
        for (left, right), outcome in zip(open_pairs, outcomes, strict=True):
            if outcome == 0:
                for side in (left, right):
                    if side in punkte:
                        punkte[side] += rules.draw_points
                continue

            # The loser is added to deliberately: a defeat scores nothing, because `FLSaisonRules`
            # carries no `loss_points` (ADR-0026).
            winner = left if outcome == 1 else right
            if winner in punkte:
                punkte[winner] += rules.win_points

        vector = tuple(punkte[team_id] for team_id in order)
        if vector in seen:
            continue
        seen.add(vector)

        placings = _placings(eligible, dict(zip(order, vector, strict=True)), settled, spiele, rules)

        # A placing survives only while every table so far has put the SAME team there. One outcome
        # that moves a team is enough to make its placing something a person still decides.
        if decided is None:
            decided = placings
        else:
            decided = {platz: team for platz, team in placings.items() if platz in decided and decided[platz].id == team.id}

        if not decided:
            break

    return DecidedStanding(eligible=len(eligible), is_complete=is_complete, by_platz=decided or {})


def _placings(
    teams: Sequence[FLTeam],
    punkte: Mapping[CustomObjectId, int],
    settled: AbstractSet[CustomObjectId],
    spiele: Iterable[FLSpiel],
    rules: FLSaisonRules,
) -> Mapping[int, FLTeam]:
    """The placings one points table pins down. A band holding several teams pins none of them."""

    placings: dict[int, FLTeam] = {}
    platz = 1

    for band in _tiers(teams, punkte, settled, spiele, rules):
        if len(band) == 1:
            placings[platz] = band[0]
        platz += len(band)

    return placings


def build_gruppen(teams: Iterable[FLTeam], spiele: Iterable[FLSpiel], rules: FLSaisonRules) -> FLGruppen:
    """
    The four groups, always all four, each ordered by the competition's tiebreak chain (ADR-0043).

    Seeded with every group name rather than built from the teams present: a season with nobody in group
    D would otherwise omit the "D" key, the frontend's `FLGruppenSchema` requires all four, and
    /dashboard/saisontabelle fails to parse the response. Every season so far has had teams in all four
    groups, so that failure hides until it does not.

    Ordered as the table STANDS, so every figure in it is current and the whole chain applies. What
    remaining fixtures could still do to it is `build_decided_standings`' question and not this one --
    a table is a statement about now.

    A disqualified team keeps its row here. It is excluded from holding a *placing*, which is a
    different question and is `_may_hold_a_platz`'s.
    """

    teams = list(teams)
    gruppe_of: dict[CustomObjectId, FLGruppenNames] = {team.id: team.gruppe for team in teams}
    by_gruppe, _ = _spiele_by_gruppe(spiele, gruppe_of)

    grouped: dict[FLGruppenNames, list[FLTeam]] = {name: [] for name in get_args(FLGruppenNames)}
    for team in teams:
        # FLTeam.gruppe is FLGruppenNames, so validation already rejects a blank or unknown group --
        # earlier and louder than here. This still guards the one way round that: an FLTeam built with
        # model_construct, which skips validation entirely.
        #
        # Tested against `grouped` rather than for falsiness: `not team.gruppe` catches "" and None but
        # lets "X" through to a bare KeyError -- an unhandled 500 instead of the deliberate error this
        # guard exists to raise.
        if team.gruppe not in grouped:
            raise ValueError(f"Team {team.id} has gruppe {team.gruppe!r}, which is not one of A/B/C/D")
        grouped[team.gruppe].append(team)

    # Every figure on the table is final AS A READING OF NOW, which is what lets the whole chain apply.
    everyone = frozenset(gruppe_of)

    return FLGruppen(
        {
            name: [
                team
                for band in _tiers(members, {team.id: team.statistik.punkte for team in members}, everyone, by_gruppe[name], rules)
                for team in band
            ]
            for name, members in grouped.items()
        }
    )


def build_decided_standings(
    teams: Iterable[FLTeam],
    spiele: Iterable[FLSpiel],
    rules: FLSaisonRules,
    gruppen: AbstractSet[FLGruppenNames] | None = None,
) -> Mapping[FLGruppenNames, DecidedStanding]:
    """
    Which placing in each group is already beyond doubt, and which is still anybody's (ADR-0043).

    Pass the season's GROUP-PHASE matches and the teams of that season, in the pipeline's `name` order.
    A placing is reported only when it comes out the same however every outstanding fixture in its group
    goes -- so a slot seeded from one cannot be overturned by a result nobody has entered yet.

    `gruppen` names the groups worth deciding -- the ones a stored `gruppe` reference actually seeds
    from -- and `None` means all four. The walk over a group's outcomes is the expensive half of a
    result entry, and a group no bracket slot reads from buys nothing with it; a group absent from the
    returned mapping reads to `_seed_from_gruppe` as "no standing supplied", which leaves a slot
    exactly as it stands and is unreachable while every referenced group is in `gruppen`.
    """

    spiele = list(spiele)
    teams = list(teams)

    gruppe_of: dict[CustomObjectId, FLGruppenNames] = {team.id: team.gruppe for team in teams}
    by_gruppe, unattributable = _spiele_by_gruppe(spiele, gruppe_of)
    still_to_play = _still_to_play(spiele)

    teams_by_gruppe: dict[FLGruppenNames, list[FLTeam]] = {name: [] for name in get_args(FLGruppenNames)}
    for team in teams:
        if team.gruppe in teams_by_gruppe:
            teams_by_gruppe[team.gruppe].append(team)

    return {
        name: _decide_one_gruppe(
            teams=teams_by_gruppe[name],
            spiele=by_gruppe[name],
            rules=rules,
            still_to_play=still_to_play,
            has_unattributable=name in unattributable,
        )
        for name in get_args(FLGruppenNames)
        if gruppen is None or name in gruppen
    }


# =====================================================================================================
# RETIRING A CLUB
# =====================================================================================================

# A club still entered in a season that is running or planned. Retiring it would pull it out of every
# picker while its fixtures are still being played or drawn -- the state the soft delete exists to
# prevent, reached through the soft delete itself. Leaving a season is not an option either: a team
# never leaves a season, disqualification is the only way out (ADR-0033).
RETIRE_BLOCKED = "REQ-RETIRE-001"


def find_retire_refusal(saison_statuses: Iterable[str]) -> str | None:
    """
    Why retiring this club must be refused, or `None` when it may be retired.

    One rule (owner, 2026-08-07): a club whose seasons are all `past` -- or that is in no season at
    all -- may be retired; a club entered in an `active` or `future` season may not. The message is
    the English log detail; the code is what the client reads (docs/logging.md).
    """

    blocking = sorted({saison_status for saison_status in saison_statuses if saison_status in ("active", "future")})
    if not blocking:
        return None

    return f"club is entered in a season with status {'/'.join(blocking)}; only a club whose seasons are all past may be retired"
