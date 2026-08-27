from dataclasses import dataclass
from itertools import combinations, product
from typing import AbstractSet, Any, Callable, Iterable, Mapping, Sequence, get_args

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import (
    SONDEREREIGNIS_COUNTED_AS_ABSAGE,
    SONDEREREIGNIS_PRODUCING_A_RECORD,
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLSpielCommon,
    records_an_absence,
)
from app.api.teams.schemas import (
    FLGruppen,
    FLGruppenNames,
    FLGruppenTeam,
    FLPublicTeamsFilterParams,
    FLTeam,
    FLTeamsFilterParams,
    FLTeamStatistik,
    FLTeamStatistikScope,
)
from app.core.collections import Collection
from app.core.crud import build_query
from app.core.exceptions import WriteRefusal
from app.shared.schemas.custom import CustomObjectId

SPIELE_COLLECTION_NAME = "spiele"
AS_NAME = "saison_data"
STATISTIK_AS_NAME = "statistik_data"
ABSAGE_AS_NAME = "absage_data"
ABSAGE_COUNT_NAME = "anzahl"

# Derived from the model, so a field added to `FLTeamStatistik` cannot be forgotten here.
ZERO_STATISTIK: Mapping[str, int] = {field_name: 0 for field_name in FLTeamStatistik.model_fields}

# For a `$lookup` whose `let` binds `team_oid`.
_IS_THIS_TEAM_IN_SLOT_ONE: Mapping[str, Any] = {"$eq": ["$team1.team_id", "$$team_oid"]}


def _fixtures_of_this_team(saison_id: str, scope: FLTeamStatistikScope) -> dict[str, Any]:
    """Shared by the `$lookup` stages below: a `$match` per stage is another place to forget the phase filter."""

    return {
        "saison_id": saison_id,
        # Absent under "gesamt" rather than negated: an `$in` over every phase needs widening by
        # hand the day one is added.
        **({"saison_phase": "gruppenphase"} if scope == "gruppenphase" else {}),
        "$expr": {"$or": [_IS_THIS_TEAM_IN_SLOT_ONE, {"$eq": ["$team2.team_id", "$$team_oid"]}]},
    }


def _counting_fixtures_match() -> dict[str, Any]:
    """Whether a fixture counts. A forfeit does, and a shoot-out is a draw (`docs/backend/spec.md :: I25a`)."""

    return {
        "ergebnis": {"$ne": None},
        # Redundant with `ergebnis` except on a hand-edited document, where a null count would group
        # as a 0:0 draw instead of dropping out.
        "team1.tore": {"$ne": None},
        "team2.tore": {"$ne": None},
    }


def build_statistik_lookup_stage(saison_id: str, rules: FLSaisonRules, scope: FLTeamStatistikScope) -> Mapping[str, Any]:
    """One team's statistics, derived from the season's matches; `scope` is the whole difference between the table and a team page."""

    return {
        "$lookup": {
            "from": SPIELE_COLLECTION_NAME,
            "let": {"team_oid": "$_id"},
            "pipeline": [
                {
                    "$match": {
                        **_fixtures_of_this_team(saison_id, scope),
                        **_counting_fixtures_match(),
                    }
                },
                {
                    # Both teams sit in one document, so each match is turned to face THIS one first.
                    "$project": {
                        "_id": 0,
                        "tore_self": {"$cond": [_IS_THIS_TEAM_IN_SLOT_ONE, "$team1.tore", "$team2.tore"]},
                        "tore_opponent": {"$cond": [_IS_THIS_TEAM_IN_SLOT_ONE, "$team2.tore", "$team1.tore"]},
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
                    # A defeat adds nothing: `FLSaisonRules` carries no `loss_points`.
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


def build_absage_lookup_stage(saison_id: str, scope: FLTeamStatistikScope) -> Mapping[str, Any]:
    """This team's called-off fixtures, counted in a stage of their own.

    Never a second accumulator inside the counting `$lookup`: aggregation `$eq: [null, null]` is
    TRUE, so a goalless cancellation would score as a draw.
    """

    return {
        "$lookup": {
            "from": SPIELE_COLLECTION_NAME,
            "let": {"team_oid": "$_id"},
            "pipeline": [
                {
                    "$match": {
                        **_fixtures_of_this_team(saison_id, scope),
                        # The flag is the whole rule: `ergebnis: None` beside it would drop the
                        # forfeits, which are nearly every cancellation here.
                        "sonderereignis": {"$in": list(SONDEREREIGNIS_COUNTED_AS_ABSAGE)},
                    }
                },
                {"$count": ABSAGE_COUNT_NAME},
            ],
            "as": ABSAGE_AS_NAME,
        }
    }


def build_team_pipeline(filters: FLPublicTeamsFilterParams, rules: FLSaisonRules | None, team_id: Any | None = None) -> list[Mapping[str, Any]]:
    # Without a season the junction join stops being strict -- one row per season a club played --
    # and the statistics below match nothing, handing back a table of zeros that reads as an answer.
    if filters.saison_id is None:
        raise ValueError("build_team_pipeline requires a resolved saison_id -- the junction join and the statistics are both season-scoped.")

    pipeline: list[Mapping[str, Any]] = []

    base_match: dict[str, Any] = {}

    # Clubs that left the league -- never a team that left one season, which keeps its row. The switch
    # is on the ADMIN model alone: a standings row carries no field that would mark one (`READ-SQUAD-002`).
    if not (isinstance(filters, FLTeamsFilterParams) and filters.include_inactive):
        base_match["inactive_since"] = None

    if team_id is not None:
        base_match["_id"] = team_id

    if base_match:
        pipeline.append({"$match": base_match})

    # Translated, not dumped: the row stores a record, never a boolean (`docs/backend/spec.md :: I31`).
    # Two independent terms, so "left the season" and "left it THIS way" compose into one match.
    austritt_terms: dict[str, Any] = {}
    if filters.has_austritt is not None:
        austritt_terms["austritt"] = {"$ne": None} if filters.has_austritt else None
    if filters.austritt_type is not None:
        austritt_terms["austritt.type"] = filters.austritt_type

    lookup_filters = build_query(
        filters,
        terms={"saison_id", "gruppe"},
        compiled=austritt_terms or None,
    )

    lookup_pipeline: list[Mapping[str, Any]] = [{"$match": {"$expr": {"$eq": ["$team_id", "$$base_team_id"]}}}]

    if lookup_filters:
        lookup_pipeline.append({"$match": lookup_filters})

    # Withheld at the JOIN rather than downstream: the outer `$project` is an allow-list too, so this
    # is DEPTH -- two of this pipeline's callers are base-tier and the row carries contact records.
    lookup_pipeline.append({"$project": {"_id": 0, "saison_id": 1, "gruppe": 1, "austritt": 1, "name": 1, "shorthand": 1}})

    pipeline.append(
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "let": {"base_team_id": "$_id"},
                "pipeline": lookup_pipeline,
                "as": AS_NAME,
            }
        }
    )

    strict_join = bool(getattr(filters, "saison_id", None))
    pipeline.append(
        {
            "$unwind": {
                "path": f"${AS_NAME}",
                "preserveNullAndEmptyArrays": not strict_join,
            }
        }
    )

    # After the strict unwind, so the matches are only summed for teams that survive the join.
    # A scoring rule IS the table, so `rules=None` derives none -- `build_statistik_by_team` is
    # the other way to one, over fixtures this collection has not stored.
    if rules is not None:
        pipeline.append(build_statistik_lookup_stage(saison_id=filters.saison_id, rules=rules, scope=filters.statistik_scope))
        pipeline.append(build_absage_lookup_stage(saison_id=filters.saison_id, scope=filters.statistik_scope))

    # One projection, one team shape: a reduced variant trims the response and saves no query work,
    # since every lookup runs either way.
    pipeline.append(
        {
            "$project": {
                "_id": 1,
                # From the JUNCTION, not the club: this read is season-scoped, and a finished season
                # is the record of the name it was played under rather than of today's.
                "name": f"${AS_NAME}.name",
                "shorthand": f"${AS_NAME}.shorthand",
                "address": 1,
                "description": 1,
                "full_name": 1,
                "schulform": 1,
                "website_url": 1,
                "inactive_since": 1,
                # `$group` emits nothing for an empty input rather than a row of zeros. Left out
                # entirely without `rules`, so a row reaching `FLTeam` unfilled is REFUSED rather
                # than read as a table of zeros.
                **(
                    {
                        "statistik": {
                            "$mergeObjects": [
                                {"$ifNull": [{"$first": f"${STATISTIK_AS_NAME}"}, ZERO_STATISTIK]},
                                {"anzahl_abgesagte_spiele": {"$ifNull": [{"$first": f"${ABSAGE_AS_NAME}.{ABSAGE_COUNT_NAME}"}, 0]}},
                            ]
                        }
                    }
                    if rules is not None
                    else {}
                ),
                "saison_id": f"${AS_NAME}.saison_id",
                "gruppe": f"${AS_NAME}.gruppe",
                "austritt": f"${AS_NAME}.austritt",
            }
        }
    )

    pipeline.append({"$sort": {filters.sort_by: 1 if filters.order == "asc" else -1, "name": 1}})

    if getattr(filters, "limit", None) is not None:
        pipeline.append({"$limit": filters.limit})

    return pipeline


# The walk tries every combination of outcomes, so the work is 3^n. Past the bound nothing is
# reported as final, which is the safe direction.
CERTAINTY_FIXTURE_LIMIT = 10


def _counted_goals(spiel: FLSpielCommon) -> tuple[CustomObjectId, int, CustomObjectId, int] | None:
    """`_counting_fixtures_match` restated in Python, for a standing asking it of a match the pipeline already summed."""

    if spiel.ergebnis is None or spiel.team1 is None or spiel.team2 is None:
        return None
    if spiel.team1.tore is None or spiel.team2.tore is None:
        return None

    return spiel.team1.team_id, spiel.team1.tore, spiel.team2.team_id, spiel.team2.tore


def build_statistik_by_team(spiele: Iterable[FLSpielCommon], rules: FLSaisonRules) -> Mapping[CustomObjectId, FLTeamStatistik]:
    """Every team's figures over the fixtures GIVEN, for a caller holding a season the collection does not.

    `build_statistik_lookup_stage` and `build_absage_lookup_stage` restated. It filters nothing:
    pass exactly the fixtures the scope names.
    """

    figures: dict[CustomObjectId, dict[str, int]] = {}

    for spiel in spiele:
        # Distinct, because the `$lookup` matches a fixture holding one club twice -- a fault state
        # -- once, and a second count here would put the two tables at odds over it.
        sides = {side.team_id for side in (spiel.team1, spiel.team2) if side is not None}
        for team_id in sides:
            figures.setdefault(team_id, dict(ZERO_STATISTIK))

        if spiel.sonderereignis in SONDEREREIGNIS_COUNTED_AS_ABSAGE:
            for team_id in sides:
                figures[team_id]["anzahl_abgesagte_spiele"] += 1

        counted = _counted_goals(spiel)
        if counted is None:
            continue

        team1_id, tore1, team2_id, tore2 = counted
        for team_id in sides:
            # Slot one first, as the projection's `$cond` on `_IS_THIS_TEAM_IN_SLOT_ONE` is, so the
            # degenerate fixture above is oriented the one way both derivations orient it.
            tore_self, tore_opponent = (tore1, tore2) if team_id == team1_id else (tore2, tore1)

            row = figures[team_id]
            row["anzahl_gespielte_spiele"] += 1
            row["tore_geschossen"] += tore_self
            row["tore_kassiert"] += tore_opponent

            if tore_self > tore_opponent:
                row["siege"] += 1
                row["punkte"] += rules.win_points
            elif tore_self == tore_opponent:
                row["unentschieden"] += 1
                row["punkte"] += rules.draw_points
            else:
                # No `punkte` arm: `FLSaisonRules` carries no `loss_points`.
                row["niederlagen"] += 1

    return {team_id: FLTeamStatistik.model_validate(row) for team_id, row in figures.items()}


def _goal_key(team: FLTeam) -> tuple[int, int]:
    return (team.statistik.tore_geschossen - team.statistik.tore_kassiert, team.statistik.tore_geschossen)


@dataclass(frozen=True)
class _MiniTable:
    """The mini-table over one set of teams, and whether it can rank the ones that can place.

    A vacuous (0, 0, 0) -- a team that met none of the others -- is indistinguishable from a real
    one inside the keys, so the caller is told separately.
    """

    keys: Mapping[CustomObjectId, tuple[int, int, int]]
    every_pair_met: bool

    def key_of(self, team: FLTeam) -> tuple[int, ...]:
        return self.keys[team.id]


def _head_to_head_table(
    teams: Sequence[FLTeam],
    spiele: Iterable[FLSpielCommon],
    rules: FLSaisonRules,
    placeable: AbstractSet[CustomObjectId],
) -> _MiniTable:
    """The mini-table over the matches `teams` played against EACH OTHER.

    Over the whole tied set, never pair by pair: with three level, "who beat whom" is not
    transitive, so a pairwise rule can order A above B above C above A.
    """

    ids = {team.id for team in teams}
    punkte = dict.fromkeys(ids, 0)
    geschossen = dict.fromkeys(ids, 0)
    kassiert = dict.fromkeys(ids, 0)
    met: set[frozenset[CustomObjectId]] = set()

    for spiel in spiele:
        counted = _counted_goals(spiel)
        if counted is None:
            continue

        team1_id, tore1, team2_id, tore2 = counted
        if team1_id not in ids or team2_id not in ids:
            continue

        met.add(frozenset((team1_id, team2_id)))
        geschossen[team1_id] += tore1
        kassiert[team1_id] += tore2
        geschossen[team2_id] += tore2
        kassiert[team2_id] += tore1

        if tore1 == tore2:
            punkte[team1_id] += rules.draw_points
            punkte[team2_id] += rules.draw_points
        else:
            punkte[team1_id if tore1 > tore2 else team2_id] += rules.win_points

    return _MiniTable(
        keys={team_id: (punkte[team_id], geschossen[team_id] - kassiert[team_id], geschossen[team_id]) for team_id in ids},
        # Asked of the clubs that can hold a placing, pair by pair rather than counted: a club that
        # has left the season is ranked here but can place nowhere, so the meetings it never played
        # decide nothing for the ones that can.
        every_pair_met=all(frozenset(pair) in met for pair in combinations(ids & placeable, 2)),
    )


def _grouped(band: Sequence[FLTeam], key_of: Callable[[FLTeam], tuple[int, ...]]) -> list[list[FLTeam]]:
    """`band` split into descending groups by one criterion; a group of one is decided."""

    grouped: dict[tuple[int, ...], list[FLTeam]] = {}
    for team in band:
        grouped.setdefault(key_of(team), []).append(team)

    return [grouped[key] for key in sorted(grouped, reverse=True)]


def _break_tie(
    band: Sequence[FLTeam],
    spiele: Sequence[FLSpielCommon],
    rules: FLSaisonRules,
    placeable: AbstractSet[CustomObjectId],
) -> list[list[FLTeam]]:
    """Teams level on points, split by one criterion then the other; `tiebreak_order` picks which leads, where it can.

    Every member's figures must already be final -- the caller checks: a team with a match left has
    an unbounded goal difference.
    """

    lead_table = _head_to_head_table(band, spiele, rules, placeable) if rules.tiebreak_order == "direkter_vergleich" else None
    if lead_table is not None and not lead_table.every_pair_met:
        # A team that has met none of the others scores a vacuous 0:0, above everyone who lost, so a
        # comparison missing a pair cannot rank the band: it takes the goal keys, and the mini-table
        # follows as it does under `tordifferenz`.
        lead_table = None

    tiers: list[list[FLTeam]] = []
    outer = _grouped(band, lead_table.key_of) if lead_table is not None else _grouped(band, _goal_key)

    # One pass, never a recursion back up the chain: a set the second criterion cannot separate is a
    # genuine tie, reported as one.
    for still_level in outer:
        if len(still_level) == 1:
            tiers.append(still_level)
            continue

        if lead_table is not None:
            tiers.extend(_grouped(still_level, _goal_key))
            continue

        # Recomputed over THESE teams and refused where they have not all met: a table that cannot
        # rank them ranks nobody, wherever it sits in the chain, and the criterion that led is
        # already level across them -- so what is left is a genuine tie.
        inner_table = _head_to_head_table(still_level, spiele, rules, placeable)
        tiers.extend(_grouped(still_level, inner_table.key_of) if inner_table.every_pair_met else [still_level])

    return tiers


def _tiers(
    teams: Sequence[FLTeam],
    punkte: Mapping[CustomObjectId, int],
    settled: AbstractSet[CustomObjectId],
    spiele: Sequence[FLSpielCommon],
    rules: FLSaisonRules,
) -> list[list[FLTeam]]:
    """`teams` in descending bands; a band of one is a decided position.

    `punkte` is an argument because `build_decided_standings` ranks these same teams under results
    that have not happened yet.
    """

    by_punkte: dict[int, list[FLTeam]] = {}
    for team in teams:
        by_punkte.setdefault(punkte[team.id], []).append(team)

    # Derived here so both callers ask one question: each ranks a club that has left and neither lets
    # one hold a placing, so completeness judged over whoever is present would split the two surfaces
    # (`docs/backend/spec.md :: I24b`).
    still_to_play = _still_to_play(spiele)
    placeable = frozenset(team.id for team in teams if _may_hold_a_platz(team, still_to_play.get(team.id, 0)))

    tiers: list[list[FLTeam]] = []
    for score in sorted(by_punkte, reverse=True):
        band = by_punkte[score]
        # A band holding a team whose goals are not final stays whole: nothing bounds a goal margin,
        # so ordering the rest around it asserts a placing that is still moving.
        if len(band) == 1 or not all(team.id in settled for team in band):
            tiers.append(band)
            continue

        tiers.extend(_break_tie(band, spiele, rules, placeable))

    return tiers


def _may_hold_a_platz(team: FLTeam, still_to_play: int) -> bool:
    """Whether a team can hold a placing a bracket slot could name (`docs/backend/spec.md :: I24b`)."""

    return team.austritt is None and (team.statistik.anzahl_gespielte_spiele + still_to_play) > 0


def _spiele_by_gruppe(
    spiele: Iterable[FLSpielCommon],
    gruppe_of: Mapping[CustomObjectId, FLGruppenNames],
) -> tuple[dict[FLGruppenNames, list[FLSpielCommon]], set[FLGruppenNames]]:
    """Each group's own fixtures, and the groups holding a fixture attributable to none.

    A fixture belongs to a group when BOTH sides are teams of it; one that is not can still award
    points inside it, so no placing there is final while it stands.
    """

    by_gruppe: dict[FLGruppenNames, list[FLSpielCommon]] = {name: [] for name in get_args(FLGruppenNames)}
    unattributable: set[FLGruppenNames] = set()

    for spiel in spiele:
        left = gruppe_of.get(spiel.team1.team_id) if spiel.team1 is not None else None
        right = gruppe_of.get(spiel.team2.team_id) if spiel.team2 is not None else None

        if left is not None and left == right:
            by_gruppe[left].append(spiel)
            continue

        if _counted_goals(spiel) is None and spiel.sonderereignis not in SONDEREREIGNIS_WITHOUT_A_RESULT:
            if spiel.team1 is None and spiel.team2 is None:
                # NO side to attribute, so nothing can say which group it lands in.
                unattributable.update(get_args(FLGruppenNames))
            else:
                unattributable.update(name for name in (left, right) if name is not None)

    return by_gruppe, unattributable


def _still_to_play(spiele: Iterable[FLSpielCommon]) -> Mapping[CustomObjectId, int]:
    """How many fixtures each team has left: neither counted nor called off, so still to be awarded."""

    counts: dict[CustomObjectId, int] = {}
    for spiel in spiele:
        if _counted_goals(spiel) is not None or spiel.sonderereignis in SONDEREREIGNIS_WITHOUT_A_RESULT:
            continue
        for side in (spiel.team1, spiel.team2):
            if side is not None:
                counts[side.team_id] = counts.get(side.team_id, 0) + 1

    return counts


@dataclass(frozen=True)
class DecidedStanding:
    """Which placings in one group no remaining result can still change.

    An absent `by_platz` entry means "not yet" while `is_complete` is false, and a tie the chain
    could not break once it is true.
    """

    eligible: int
    is_complete: bool
    by_platz: Mapping[int, FLTeam]


def _decide_one_gruppe(
    teams: Sequence[FLTeam],
    spiele: Sequence[FLSpielCommon],
    rules: FLSaisonRules,
    still_to_play: Mapping[CustomObjectId, int],
    has_unattributable: bool,
) -> DecidedStanding:
    """One group's decided placings, by walking every way its outstanding fixtures could still go."""

    # `_spiele_by_gruppe` attributes only fixtures with both sides known, so the two side checks
    # below narrow the type rather than branch.
    open_pairs: list[tuple[CustomObjectId, CustomObjectId]] = [
        (spiel.team1.team_id, spiel.team2.team_id)
        for spiel in spiele
        if _counted_goals(spiel) is None
        and spiel.sonderereignis not in SONDEREREIGNIS_WITHOUT_A_RESULT
        and spiel.team1 is not None
        and spiel.team2 is not None
    ]

    placeable = frozenset(team.id for team in teams if _may_hold_a_platz(team, still_to_play.get(team.id, 0)))
    is_complete = not open_pairs and not has_unattributable

    if has_unattributable or len(open_pairs) > CERTAINTY_FIXTURE_LIMIT:
        return DecidedStanding(eligible=len(placeable), is_complete=is_complete, by_platz={})

    # Every member, never `placeable` alone: filtering before the ranking drops a departed club's
    # results from the mini-table the DISPLAYED table computes with them, so the two surfaces order
    # one group differently (`docs/backend/spec.md :: I24b`).
    settled = frozenset(team.id for team in teams if still_to_play.get(team.id, 0) == 0)
    base = {team.id: team.statistik.punkte for team in teams}
    order = [team.id for team in teams]

    # Deduplicated by the points table each outcome set produces, and ranked AS the walk goes, so it
    # stops the moment no placing survives: this runs inside the write transaction.
    decided: Mapping[int, FLTeam] | None = None
    seen: set[tuple[int, ...]] = set()
    for outcomes in product((1, 0, 2), repeat=len(open_pairs)):
        punkte = dict(base)
        for (left, right), outcome in zip(open_pairs, outcomes, strict=True):
            # Added to unguarded: `_spiele_by_gruppe` attributes a fixture to this group only when
            # both its teams are of it, so `base` already holds every side.
            if outcome == 0:
                for side in (left, right):
                    punkte[side] += rules.draw_points
                continue

            # Only the winner is added to: `FLSaisonRules` carries no `loss_points`.
            punkte[left if outcome == 1 else right] += rules.win_points

        vector = tuple(punkte[team_id] for team_id in order)
        if vector in seen:
            continue
        seen.add(vector)

        placings = _placings(teams, dict(zip(order, vector, strict=True)), settled, spiele, rules, placeable)

        # A placing survives only while every table so far has put the SAME team there.
        if decided is None:
            decided = placings
        else:
            decided = {platz: team for platz, team in placings.items() if platz in decided and decided[platz].id == team.id}

        if not decided:
            break

    return DecidedStanding(eligible=len(placeable), is_complete=is_complete, by_platz=decided or {})


def _placings(
    teams: Sequence[FLTeam],
    punkte: Mapping[CustomObjectId, int],
    settled: AbstractSet[CustomObjectId],
    spiele: Sequence[FLSpielCommon],
    rules: FLSaisonRules,
    placeable: AbstractSet[CustomObjectId],
) -> Mapping[int, FLTeam]:
    """The placings one points table pins down. A band holding several teams that can place pins none of them."""

    placings: dict[int, FLTeam] = {}
    platz = 1

    for band in _tiers(teams, punkte, settled, spiele, rules):
        # Only a club that can hold a placing advances the number, so a departed one takes no place
        # and hides none -- the walk `fl_frontend/src/features/teams/utils.ts :: computePlatzByTeamId`
        # runs over the same order (`docs/backend/spec.md :: I24b`).
        holders = [team for team in band if team.id in placeable]
        if len(holders) == 1:
            placings[platz] = holders[0]
        platz += len(holders)

    return placings


def build_gruppen(teams: Iterable[FLTeam], spiele: Iterable[FLSpielCommon], rules: FLSaisonRules) -> FLGruppen:
    """The four groups, each ordered by the competition's tiebreak chain.

    Seeded with every group name, never from the teams present: a season with nobody in group D
    would omit the key (`docs/backend/spec.md :: I10`).
    """

    teams = list(teams)
    # Materialised because the fixtures are walked twice below, and a caller may pass a generator.
    spiele = list(spiele)

    gruppe_of: dict[CustomObjectId, FLGruppenNames] = {team.id: team.gruppe for team in teams}
    by_gruppe, _ = _spiele_by_gruppe(spiele, gruppe_of)

    grouped: dict[FLGruppenNames, list[FLTeam]] = {name: [] for name in get_args(FLGruppenNames)}
    for team in teams:
        # `model_construct` is the one way round `FLGruppenNames`. Tested against `grouped`, not for
        # falsiness -- `not team.gruppe` lets "X" through to a KeyError.
        if team.gruppe not in grouped:
            raise ValueError(f"Team {team.id} has gruppe {team.gruppe!r}, which is not one of A/B/C/D")
        grouped[team.gruppe].append(team)

    # Every figure is final AS A READING OF NOW, which is what lets the whole chain apply.
    everyone = frozenset(gruppe_of)

    # Over the WHOLE scoped list, as `build_decided_standings` derives it: a fixture attributable to
    # no group would otherwise count on one surface and not the other.
    still_to_play = _still_to_play(spiele)

    return FLGruppen(
        {
            name: [
                _standing_row(team, still_to_play.get(team.id, 0))
                for band in _tiers(members, {team.id: team.statistik.punkte for team in members}, everyone, by_gruppe[name], rules)
                for team in band
            ]
            for name, members in grouped.items()
        }
    )


def _standing_row(team: FLTeam, still_to_play: int) -> FLGruppenTeam:
    """One ranked team as the table publishes it, with the still-to-play term the placing rule needs.

    Narrowed on purpose: this response reaches a public client component, so every field on it is in
    the page source whether a column renders it or not.
    """

    return FLGruppenTeam(
        id=team.id,
        name=team.name,
        shorthand=team.shorthand,
        statistik=team.statistik,
        austritt_type=team.austritt.type if team.austritt is not None else None,
        anzahl_ausstehende_spiele=still_to_play,
    )


def build_decided_standings(
    teams: Iterable[FLTeam],
    spiele: Iterable[FLSpielCommon],
    rules: FLSaisonRules,
    gruppen: AbstractSet[FLGruppenNames] | None = None,
) -> Mapping[FLGruppenNames, DecidedStanding]:
    """Which placing in each group is beyond doubt, and which is still anybody's.

    Pass the season's GROUP-PHASE matches. `gruppen` narrows to the groups worth deciding: the walk
    is the expensive half of a save.
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


def build_team_memberships_pipeline() -> list[Mapping[str, Any]]:
    """Every club with every junction row it holds.

    UNLIKE `build_team_pipeline`: no season resolution, no strict join, no statistics -- the
    question is club-centric, so retired clubs stay in.
    """

    return [
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "localField": "_id",
                "foreignField": "team_id",
                # ADMIN-only, unlike `build_team_pipeline`'s join, so the contact records are in --
                # they are what the club editor edits. Still an allow-list, so the next field added
                # to the junction reaches this read only when somebody names it.
                "pipeline": [{"$project": {"_id": 0, "saison_id": 1, "gruppe": 1, "austritt": 1, "trikot_farbe": 1, "kontakte": 1}}],
                "as": "memberships",
            }
        },
        {"$sort": {"name": 1}},
    ]


# What every code below refuses is `docs/logging/error-codes.md`.
ENTRY_SAISON_NOT_FUTURE = "REQ-ENTER-001"
ENTRY_GRUPPE_NOT_OFFERED = "REQ-ENTER-002"
ENTRY_GRUPPE_FULL = "REQ-ENTER-003"
ENTRY_GRUPPE_LOCKED = "REQ-ENTER-004"
CLUB_RETIRED = "REQ-ENTER-005"


def find_club_entry_refusal(*, inactive_since: str | None) -> WriteRefusal | None:
    """Why this CLUB may not be entered into any season, or `None`.

    Its own function beside `find_entry_refusal`, which judges the season and the group: a group
    move re-uses that one, and a club's standing in the LEAGUE is not what a move is about.
    """

    if inactive_since is not None:
        return WriteRefusal(
            error_code=CLUB_RETIRED,
            message=f"this club left the league on {inactive_since}; reactivate it before entering it into a season",
        )

    return None


def offered_gruppen(number_of_groups: int) -> tuple[FLGruppenNames, ...]:
    return get_args(FLGruppenNames)[:number_of_groups]


def find_gruppe_move_refusal(*, fixtures_drawn: int) -> WriteRefusal | None:
    """Why this team's group move must be refused, or `None`.

    The window is a season where THIS team holds no fixture, whatever the season's status: a move
    rewrites none, so a later one leaves one round robin holding the club and the other short.
    """

    if fixtures_drawn == 0:
        return None

    noun = "fixture" if fixtures_drawn == 1 else "fixtures"

    return WriteRefusal(
        error_code=ENTRY_GRUPPE_LOCKED,
        message=f"the team already has {fixtures_drawn} {noun} drawn in this season; "
        "a group change would leave them played against the group it left, and the group swap is what rewrites both",
    )


def find_entry_refusal(saison_status: str, gruppe: FLGruppenNames, rules: FLSaisonRules, occupied: int) -> WriteRefusal | None:
    """Why entering this team into the season must be refused, or `None`.

    `occupied` is the group's row count, rows carrying an `austritt` included: a team never leaves a
    season, so its place stays taken.
    """

    if saison_status != "future":
        return WriteRefusal(
            error_code=ENTRY_SAISON_NOT_FUTURE, message=f"season is {saison_status}; a team enters a season only while it is future"
        )

    if gruppe not in offered_gruppen(rules.number_of_groups):
        return WriteRefusal(
            error_code=ENTRY_GRUPPE_NOT_OFFERED, message=f"gruppe {gruppe} is not offered; this season runs {rules.number_of_groups} group(s)"
        )

    if occupied >= rules.teams_per_group:
        return WriteRefusal(error_code=ENTRY_GRUPPE_FULL, message=f"gruppe {gruppe} is full ({occupied}/{rules.teams_per_group} teams)")

    return None


# A swap is neither an entry nor the move `REQ-ENTER-004` locks, so it carries codes of its own.
# One code covers the three "not a swap" shapes, because the control offers only pairs that are one.
SWAP_NOT_A_SWAP = "REQ-SWAP-001"
SWAP_KNOCKOUT_STARTED = "REQ-SWAP-002"
SWAP_SAISON_FINISHED = "REQ-SWAP-003"
SWAP_GRUPPENPHASE_PLAYED = "REQ-SWAP-004"
SWAP_SPIELTAG_CLASH = "REQ-SWAP-005"
# `REQ-SWAP-006` is FORWARDS ONLY, exactly as `REQ-ELIGIBILITY-001` is: the past is left alone.
SWAP_FIELDS_DISQUALIFIED = "REQ-SWAP-006"


def fixtures_newly_fielding_a_departed_club(
    *,
    team1_id: Any,
    team2_id: Any,
    departed_since: Mapping[Any, str | None],
    gruppenphase_spiele: Sequence[Mapping[str, Any]],
) -> int:
    """How many group fixtures the exchange would newly field a departed club on.

    The date and the carve-outs are `find_eligibility_refusal`'s, read through the predicate it
    reads; an UNDATED one counts, since it can still be dated after the exit.
    """

    arriving = {team1_id: team2_id, team2_id: team1_id}

    offending = 0
    for spiel in gruppenphase_spiele:
        for slot in ("team1", "team2"):
            standing = (spiel.get(slot) or {}).get("team_id")
            # A side holding neither club does not move, so it can field nobody new.
            incoming = arriving.get(standing)
            if incoming is None:
                continue

            effective_from = departed_since.get(incoming)
            if effective_from is None:
                continue

            # `REQ-SWAP-004` answers an abandonment and a no-show terminally before this count is
            # read, so what reaches the carve-out here is the state it deliberately leaves open: a
            # fixture called off or annulled, which awards nothing.
            if records_an_absence(side=slot, sonderereignis=spiel.get("sonderereignis"), saison_phase="gruppenphase"):
                continue

            datum = spiel.get("datum")
            if datum is None or str(datum) >= effective_from:
                offending += 1

    return offending


def find_gruppe_swap_refusal(
    *,
    is_same_team: bool,
    team1_gruppe: str | None,
    team2_gruppe: str | None,
    saison_status: str,
    played_knockout_fixtures: int,
    played_gruppenphase_fixtures: int,
    clashing_spieltage: int,
    departed_fixtures: int,
) -> WriteRefusal | None:
    """Why exchanging these two clubs' groups must be refused, or `None`.

    **The order is the argument**: it narrows from "not a swap" through the season to the two clubs,
    and the REPAIRABLE refusals come last, so nobody does work a terminal refusal wastes.
    """

    if is_same_team:
        return WriteRefusal(error_code=SWAP_NOT_A_SWAP, message="both ids name one club; a swap exchanges two of them")

    missing = [label for label, gruppe in (("team1", team1_gruppe), ("team2", team2_gruppe)) if gruppe is None]
    if missing:
        return WriteRefusal(
            error_code=SWAP_NOT_A_SWAP,
            message=f"no saison_teams row for {' and '.join(missing)}; a swap exchanges two clubs that are both entered in the season",
        )

    if team1_gruppe == team2_gruppe:
        return WriteRefusal(
            error_code=SWAP_NOT_A_SWAP, message=f"both clubs stand in gruppe {team1_gruppe}; a swap exchanges two different groups"
        )

    if saison_status == "past":
        return WriteRefusal(
            error_code=SWAP_SAISON_FINISHED,
            message="season is past; its groups are frozen because the league table is derived from them on every read",
        )

    # The season's count, because the bracket consumed a standing whoever it named.
    if played_knockout_fixtures > 0:
        noun = "fixture has" if played_knockout_fixtures == 1 else "fixtures have"

        return WriteRefusal(
            error_code=SWAP_KNOCKOUT_STARTED,
            message=(f"{played_knockout_fixtures} knockout {noun} already left a record; the bracket has been seeded from these groups"),
        )

    # Narrowed to these two clubs: this rule is about their own participation.
    if played_gruppenphase_fixtures > 0:
        noun = "fixture has" if played_gruppenphase_fixtures == 1 else "fixtures have"

        return WriteRefusal(
            error_code=SWAP_GRUPPENPHASE_PLAYED,
            message=f"{played_gruppenphase_fixtures} gruppenphase {noun} already left a record for these two clubs; "
            "a club that has played inside its group cannot leave it without leaving a round robin that is not one",
        )

    if clashing_spieltage > 0:
        noun = "spieltag would" if clashing_spieltage == 1 else "spieltage would"

        return WriteRefusal(
            error_code=SWAP_SPIELTAG_CLASH,
            message=f"{clashing_spieltage} {noun} field one of the two clubs twice after the exchange; "
            "a club plays at most one match per spieltag, and a bracket side does not move with the swap",
        )

    if departed_fixtures > 0:
        noun = "fixture" if departed_fixtures == 1 else "fixtures"

        return WriteRefusal(
            error_code=SWAP_FIELDS_DISQUALIFIED,
            message=f"the exchange would field a club that has left the season in {departed_fixtures} {noun} dated on or "
            "after its exit; lift the austritt, swap, then re-apply it",
        )

    return None


# A replacement is neither an entry nor a swap: ONE junction row changes hands and the season's
# fixtures follow it, so it carries codes of its own.
REPLACE_SAISON_FINISHED = "REQ-REPLACE-001"
REPLACE_OUTGOING_HAS_A_RECORD = "REQ-REPLACE-002"
REPLACE_INCOMING_ALREADY_ENTERED = "REQ-REPLACE-003"


def has_taken_place(spiel: Mapping[str, Any]) -> bool:
    """Whether this fixture happened. NOT `unplayed_spiel_nrs` negated: a half-entered score reads unfinished there."""

    # An abandonment and a no-show each left a record that a rewrite would hand to another club. A
    # fixture called off or struck out left none, so its sides are still free to move.
    if spiel.get("ergebnis") is not None or spiel.get("sonderereignis") in SONDEREREIGNIS_PRODUCING_A_RECORD:
        return True

    # A fixture can hold `team1.tore` with no `ergebnis` at all, and nothing refuses that shape.
    return any((spiel.get(slot) or {}).get("tore") is not None for slot in ("team1", "team2"))


def find_replacement_refusal(
    *,
    saison_status: str,
    fixtures_with_a_record: int,
    incoming_inactive_since: str | None,
    incoming_already_entered: bool,
) -> WriteRefusal | None:
    """Why handing this row to another club must be refused, or `None`.

    **The order is the argument**: the season, then the outgoing club's record, then the incoming
    club -- so a repairable refusal never sends anyone to repair a doomed replacement.
    """

    if saison_status == "past":
        return WriteRefusal(
            error_code=REPLACE_SAISON_FINISHED,
            message="season is past; its fixtures and the table derived from them are the record of who played, and a replacement rewrites it",
        )

    # The OUTGOING club's own fixtures, whatever the phase: the incoming club inherits the schedule
    # entire, so a record on any of it would be credited to a club that never played it.
    if fixtures_with_a_record > 0:
        noun = "fixture has" if fixtures_with_a_record == 1 else "fixtures have"

        return WriteRefusal(
            error_code=REPLACE_OUTGOING_HAS_A_RECORD,
            message=f"{fixtures_with_a_record} {noun} already left a record for the outgoing club; "
            "a replacement carries its fixtures over, and a played one cannot change hands",
        )

    # The LEAGUE before the season, as `post_saison_team` judges it: a club that has left the league
    # is a candidate for no season at all, and picking a different one would not repair it.
    retired = find_club_entry_refusal(inactive_since=incoming_inactive_since)
    if retired is not None:
        return retired

    if incoming_already_entered:
        return WriteRefusal(
            error_code=REPLACE_INCOMING_ALREADY_ENTERED,
            # Also the arm that catches one club named on both ends: the row being replaced is
            # itself a row the incoming club holds, so replacing a club by itself lands here.
            message="the incoming club already holds a row in this season; a replacement brings in a club that is not entered yet",
        )

    return None


RETIRE_BLOCKED = "REQ-RETIRE-001"


def find_retire_refusal(saison_statuses: Iterable[str]) -> WriteRefusal | None:
    """Why retiring this club must be refused, or `None`; a club whose seasons are all `past` may be retired."""

    blocking = sorted({saison_status for saison_status in saison_statuses if saison_status in ("active", "future")})
    if not blocking:
        return None

    return WriteRefusal(
        error_code=RETIRE_BLOCKED,
        message=f"club is entered in a season with status {'/'.join(blocking)}; only a club whose seasons are all past may be retired",
    )
